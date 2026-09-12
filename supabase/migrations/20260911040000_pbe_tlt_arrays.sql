-- Convert scalar histories to year-linked arrays without inventing missing details.
create table public.pbe_year_books (
  school_year text not null check (private.valid_school_years(jsonb_build_array(school_year))),
  book_name text not null check (book_name = btrim(book_name) and length(book_name) between 1 and 100),
  primary key (school_year, book_name)
);
insert into public.pbe_year_books values
('2011-2012','1 Samuel'),
('2011-2012','Mark'),
('2012-2013','Acts'),
('2012-2013','1 Thessalonians'),
('2012-2013','2 Thessalonians'),
('2013-2014','2 Samuel'),
('2014-2015','Matthew'),
('2015-2016','Exodus'),
('2016-2017','Galatians'),
('2016-2017','Ephesians'),
('2016-2017','Philippians'),
('2016-2017','Colossians'),
('2016-2017','1 Timothy'),
('2016-2017','2 Timothy'),
('2017-2018','Daniel'),
('2017-2018','Esther'),
('2018-2019','Luke'),
('2019-2020','Ezra'),
('2019-2020','Nehemiah'),
('2019-2020','Hosea'),
('2019-2020','Amos'),
('2019-2020','Jonah'),
('2019-2020','Micah'),
('2020-2021','Hebrews'),
('2020-2021','James'),
('2020-2021','1 Peter'),
('2020-2021','2 Peter'),
('2021-2022','1 Kings'),
('2021-2022','Ruth'),
('2022-2023','John'),
('2023-2024','Joshua'),
('2023-2024','Judges'),
('2024-2025','Romans'),
('2024-2025','1 Corinthians'),
('2024-2025','2 Corinthians'),
('2025-2026','Isaiah (Chapters 1–33)'),
('2026-2027','Mark'),
('2026-2027','1 Peter'),
('2026-2027','2 Peter'),
('2026-2027','1 John'),
('2026-2027','2 John'),
('2026-2027','3 John');
alter table public.pbe_year_books enable row level security;
revoke all on public.pbe_year_books from public, anon, authenticated;
grant select on public.pbe_year_books to authenticated;
grant all on public.pbe_year_books to service_role;
create policy staff_read on public.pbe_year_books for select to authenticated
using ((select public.current_staff_role()) = 'editor');

-- Stop before changing any history if a nonempty legacy detail violates the catalog.
do $$ begin
 if exists (select 1 from public.pbe p cross join lateral jsonb_array_elements_text(p.years) y
   where p.bible_book is not null and not exists
   (select 1 from public.pbe_year_books b where b.school_year=y and b.book_name=p.bible_book)) then
   raise exception 'Existing PBE year/book pairs do not match the catalog; resolve them before migration';
 end if;
end $$;

-- Group legacy values by member/year, then group years with identical detail sets.
create temporary table pbe_converted on commit drop as
with per_year as (
 select pathfinder_id,y as school_year,
   coalesce(jsonb_agg(distinct bible_book order by bible_book) filter (where bible_book is not null), '[]'::jsonb) as details
 from public.pbe cross join lateral jsonb_array_elements_text(years) y
 group by pathfinder_id,y
)
select pathfinder_id,jsonb_agg(school_year order by school_year) as years,details
from per_year group by pathfinder_id,details;
delete from public.pbe;
alter table public.pbe drop column bible_book;
alter table public.pbe add column bible_books jsonb not null default '[]';
alter table public.pbe add constraint pbe_bible_books_check check (private.valid_string_array(bible_books));
insert into public.pbe(pathfinder_id,years,bible_books) select pathfinder_id,years,details from pbe_converted;

-- Group legacy values by member/year, then group years with identical detail sets.
create temporary table tlt_converted on commit drop as
with per_year as (
 select pathfinder_id,y as school_year,
   coalesce(jsonb_agg(distinct tlt_operation order by tlt_operation) filter (where tlt_operation is not null), '[]'::jsonb) as details
 from public.tlt cross join lateral jsonb_array_elements_text(years) y
 group by pathfinder_id,y
)
select pathfinder_id,jsonb_agg(school_year order by school_year) as years,details
from per_year group by pathfinder_id,details;
delete from public.tlt;
alter table public.tlt drop column tlt_operation;
alter table public.tlt add column operations jsonb not null default '[]';
alter table public.tlt add constraint tlt_operations_check check (private.valid_string_array(operations, array['Administrative','Outreach','Teaching','Activity','Records','Counseling']));
insert into public.tlt(pathfinder_id,years,operations) select pathfinder_id,years,details from tlt_converted;

create function private.validate_activity_arrays() returns trigger
language plpgsql set search_path = '' as $$
declare overlap_found boolean; y text; book text;
begin
 -- Serialize writes affecting the same member, including writes to different rows.
 perform 1 from public.pathfinders where id=new.pathfinder_id for update;
 execute format('select exists(select 1 from public.%I where pathfinder_id=$1 and id<>$2 and years ?| array(select jsonb_array_elements_text($3)))',tg_table_name)
 into overlap_found using new.pathfinder_id,new.id,new.years;
 if overlap_found then raise exception 'This member already has a record for one of these school years' using errcode='23505'; end if;
 if tg_table_name='pbe' then
   for y in select jsonb_array_elements_text(new.years) loop
     for book in select jsonb_array_elements_text(new.bible_books) loop
       perform 1 from public.pbe_year_books where school_year=y and book_name=book for share;
       if not found then raise exception 'Bible book % is not allowed for %',book,y using errcode='23514'; end if;
     end loop;
   end loop;
 end if;
 return new;
end;
$$;
-- The catalog is read-only for staff; a narrow definer function can lock catalog rows.
alter function private.validate_activity_arrays() security definer;
revoke all on function private.validate_activity_arrays() from public, anon, authenticated;
create trigger validate_activity_arrays before insert or update on public.pbe
for each row execute function private.validate_activity_arrays();
create trigger validate_activity_arrays before insert or update on public.tlt
for each row execute function private.validate_activity_arrays();

create function private.protect_pbe_catalog() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if tg_op='UPDATE' and new.school_year=old.school_year and new.book_name=old.book_name then return new; end if;
 if exists(select 1 from public.pbe where years ? old.school_year and bible_books ? old.book_name) then
   raise exception 'This year/book pair is used by PBE history' using errcode='23503';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$$;
revoke all on function private.protect_pbe_catalog() from public, anon, authenticated;
create trigger protect_pbe_catalog before update or delete on public.pbe_year_books
for each row execute function private.protect_pbe_catalog();
notify pgrst, 'reload schema';
