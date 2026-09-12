-- Calendar-year TLT history, one row per Pathfinder.
begin;
lock table public.tlt in access exclusive mode;
-- A school year cannot be mapped to a calendar year without staff input.
-- The linked database was verified empty before this migration.
do $$ begin
 if exists(select 1 from public.tlt) then
   raise exception 'TLT contains school-year records. Export and explicitly map them to calendar years before applying this migration; no data was changed';
 end if;
end $$;
drop trigger validate_activity_arrays on public.tlt;
drop function private.validate_activity_arrays();
alter table public.tlt drop column years, drop column operations;
alter table public.tlt add column history jsonb not null;
alter table public.tlt add constraint tlt_pathfinder_id_key unique(pathfinder_id);

-- STABLE because the allowed upper year follows the database date.
create function private.valid_tlt_history(value jsonb) returns boolean
language plpgsql stable set search_path = '' as $$
declare entry jsonb; y integer; seen integer[] := array[]::integer[];
begin
 if value is null or jsonb_typeof(value)<>'array' or value='[]'::jsonb then return false; end if;
 for entry in select jsonb_array_elements(value) loop
   if jsonb_typeof(entry)<>'object' then return false; end if;
   if not (entry ?& array['year','operations']) or entry - array['year','operations'] <> '{}'::jsonb then return false; end if;
   if jsonb_typeof(entry->'year')<>'number' or jsonb_typeof(entry->'operations')<>'array' then return false; end if;
   if (entry->>'year') !~ '^[0-9]{4}$' then return false; end if;
   y := (entry->>'year')::integer;
   if y<2017 or y>extract(year from current_date)::integer or y=any(seen) then return false; end if;
   if not private.valid_string_array(entry->'operations',array['Administrative','Outreach','Teaching','Activity','Records','Counseling']) then return false; end if;
   seen := array_append(seen,y);
 end loop;
 return true;
end;
$$;
revoke all on function private.valid_tlt_history(jsonb) from public, anon;
grant execute on function private.valid_tlt_history(jsonb) to authenticated, service_role;
alter table public.tlt add constraint tlt_history_check check(private.valid_tlt_history(history));
notify pgrst, 'reload schema';
commit;
