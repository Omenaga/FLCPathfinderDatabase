-- One PBE row per member; every history entry pairs a year with its own books.
begin;
lock table public.pbe in access exclusive mode;
drop trigger validate_activity_arrays on public.pbe;
alter table public.pbe add column history jsonb;

create temporary table pbe_history_converted on commit drop as
select pathfinder_id, min(id) as retained_id,
  jsonb_agg(jsonb_build_object('year', y, 'books', bible_books) order by y) as history
from public.pbe cross join lateral jsonb_array_elements_text(years) y
group by pathfinder_id;

update public.pbe p set history=c.history
from pbe_history_converted c where p.id=c.retained_id;
delete from public.pbe p using pbe_history_converted c
where p.pathfinder_id=c.pathfinder_id and p.id<>c.retained_id;
alter table public.pbe drop column years, drop column bible_books;
alter table public.pbe alter column history set not null;
alter table public.pbe add constraint pbe_pathfinder_id_key unique (pathfinder_id);

create function private.valid_pbe_history(value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare entry jsonb; seen text[] := array[]::text[]; y text;
begin
 if value is null or jsonb_typeof(value)<>'array' or value='[]'::jsonb then return false; end if;
 for entry in select jsonb_array_elements(value) loop
   if jsonb_typeof(entry)<>'object' then return false; end if;
   if not (entry ?& array['year','books']) or entry - array['year','books'] <> '{}'::jsonb then return false; end if;
   if jsonb_typeof(entry->'year')<>'string' or jsonb_typeof(entry->'books')<>'array' then return false; end if;
   y := entry->>'year';
   if not private.valid_school_years(jsonb_build_array(y)) or y=any(seen)
     or not private.valid_string_array(entry->'books') then return false; end if;
   seen := array_append(seen,y);
 end loop;
 return true;
end;
$$;
revoke all on function private.valid_pbe_history(jsonb) from public, anon;
grant execute on function private.valid_pbe_history(jsonb) to authenticated, service_role;
alter table public.pbe add constraint pbe_history_check check (private.valid_pbe_history(history));

create function private.validate_pbe_history() returns trigger
language plpgsql security definer set search_path = '' as $$
declare entry jsonb; book text;
begin
 if not private.valid_pbe_history(new.history) then
   raise exception 'PBE history must contain unique school years, each with a books array' using errcode='23514';
 end if;
 for entry in select jsonb_array_elements(new.history) loop
   for book in select jsonb_array_elements_text(entry->'books') loop
     perform 1 from public.pbe_year_books
     where school_year=entry->>'year' and book_name=book for share;
     if not found then raise exception 'Bible book % is not allowed for %',book,entry->>'year' using errcode='23514'; end if;
   end loop;
 end loop;
 return new;
end;
$$;
revoke all on function private.validate_pbe_history() from public, anon, authenticated;
create trigger validate_pbe_history before insert or update on public.pbe
for each row execute function private.validate_pbe_history();

-- The existing shared validator now serves only TLT.
create or replace function private.validate_activity_arrays() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 perform 1 from public.pathfinders where id=new.pathfinder_id for update;
 if exists(select 1 from public.tlt where pathfinder_id=new.pathfinder_id and id<>new.id
   and years ?| array(select jsonb_array_elements_text(new.years))) then
   raise exception 'This member already has a record for one of these school years' using errcode='23505';
 end if;
 return new;
end;
$$;

create or replace function private.protect_pbe_catalog() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if tg_op='UPDATE' and new.school_year=old.school_year and new.book_name=old.book_name then return new; end if;
 if exists(select 1 from public.pbe cross join lateral jsonb_array_elements(history) entry
   where entry->>'year'=old.school_year and (entry->'books') ? old.book_name) then
   raise exception 'This year/book pair is used by PBE history' using errcode='23503';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$$;
notify pgrst, 'reload schema';
commit;
