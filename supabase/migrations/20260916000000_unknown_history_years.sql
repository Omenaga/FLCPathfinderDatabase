begin;
create function private.valid_history_years(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare y jsonb; seen jsonb := '[]'; begin
 if value is null or jsonb_typeof(value)<>'array' then return false; end if;
 for y in select jsonb_array_elements(value) loop
  if seen @> jsonb_build_array(y) then return false; end if;
  if y <> 'null'::jsonb and not private.valid_school_years(jsonb_build_array(y)) then return false; end if;
  seen := seen || jsonb_build_array(y);
 end loop;
 return true;
end $$;
revoke all on function private.valid_history_years(jsonb) from public,anon;
grant execute on function private.valid_history_years(jsonb) to authenticated,service_role;


create or replace function private.valid_period_details(value jsonb, detail_key text, allowed text[]) returns boolean
language plpgsql immutable set search_path='' as $$
declare entry jsonb; seen text[] := array[]::text[];
begin
 if value is null or jsonb_typeof(value)<>'array' or value='[]'::jsonb then return false; end if;
 for entry in select jsonb_array_elements(value) loop
  if jsonb_typeof(entry)<>'object' then return false; end if;
  if not (entry ?& array['year',detail_key]) or entry-array['year',detail_key]<>'{}'::jsonb then return false; end if;
  if jsonb_typeof(entry->'year') not in ('string','null') or jsonb_typeof(entry->detail_key)<>'array' then return false; end if;
  if not private.valid_history_years(jsonb_build_array(entry->'year')) or coalesce(entry->>'year','Unknown')=any(seen) then return false; end if;
  if not private.valid_string_array(entry->detail_key,allowed) then return false; end if;
  seen := array_append(seen,coalesce(entry->>'year','Unknown'));
 end loop;
 return true;
end $$;

create or replace function private.valid_pbe_history(value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare entry jsonb; seen text[] := array[]::text[]; y text;
begin
 if value is null or jsonb_typeof(value)<>'array' or value='[]'::jsonb then return false; end if;
 for entry in select jsonb_array_elements(value) loop
   if jsonb_typeof(entry)<>'object' then return false; end if;
   if not (entry ?& array['year','books']) or entry - array['year','books','results'] <> '{}'::jsonb then return false; end if;
   if jsonb_typeof(entry->'year') not in ('string','null') or jsonb_typeof(entry->'books')<>'array' then return false; end if;
   y := entry->>'year';
   if not private.valid_history_years(jsonb_build_array(y)) or coalesce(y,'Unknown')=any(seen)
     or not private.valid_string_array(entry->'books') then return false; end if;
   if entry ? 'results' and not private.valid_pbe_results(entry->'results') then return false; end if;
   seen := array_append(seen,coalesce(y,'Unknown'));
 end loop;
 return true;
end;
$$;

create or replace function private.valid_tlt_history(value jsonb) returns boolean
language plpgsql stable set search_path = '' as $$
declare entry jsonb; y integer; seen integer[] := array[]::integer[];
begin
 if value is null or jsonb_typeof(value)<>'array' or value='[]'::jsonb then return false; end if;
 for entry in select jsonb_array_elements(value) loop
   if jsonb_typeof(entry)<>'object' then return false; end if;
   if not (entry ?& array['year','operations']) or entry - array['year','operations'] <> '{}'::jsonb then return false; end if;
   if jsonb_typeof(entry->'year') not in ('string','null') or jsonb_typeof(entry->'operations')<>'array' then return false; end if;
   if not private.valid_history_years(jsonb_build_array(entry->'year')) then return false; end if;
   y := coalesce(left(entry->>'year',4)::integer,0);
   if (y<>0 and (y<2016 or y>extract(year from current_date)::integer)) or y=any(seen) then return false; end if;
   if not private.valid_string_array(entry->'operations',array['Administrative','Outreach','Teaching','Activity','Records','Counseling']) then return false; end if;
   seen := array_append(seen,y);
 end loop;
 return true;
end;
$$;


-- Only historical tables accept missing dates; registration and Years Active stay strict.
do $$ declare r record; tbl text; col text; begin
 for r in select conname from pg_constraint where conrelid='public.drill'::regclass and contype='c' and pg_get_constraintdef(oid) like '%valid_school_years%' loop
  execute format('alter table public.drill drop constraint %I',r.conname);
 end loop;
 alter table public.drill add check(private.valid_history_years(years) and years<>'[]'::jsonb);
 foreach tbl in array array['honors_earned','red_zone_drill_performance','red_zone_drum_performance','red_zone_honor_evaluations','red_zone_bible_events','red_zone_knots','red_zone_tents','red_zone_jump_rope','red_zone_archery','red_zone_lashing','red_zone_burning_twine'] loop
  col := case when tbl='honors_earned' then 'year_earned' else 'year' end;
  for r in select conname from pg_constraint where conrelid=('public.'||tbl)::regclass and contype='c' and pg_get_constraintdef(oid) like '%valid_school_years%' loop
   execute format('alter table public.%I drop constraint %I',tbl,r.conname);
  end loop;
  execute format('alter table public.%I alter column %I drop not null, add check(private.valid_history_years(jsonb_build_array(%I)))',tbl,col,col);
  for r in select conname,pg_get_constraintdef(oid) as definition from pg_constraint where conrelid=('public.'||tbl)::regclass and contype='u' loop
   execute format('alter table public.%I drop constraint %I, add constraint %I %s',tbl,r.conname,r.conname,replace(r.definition,'UNIQUE (','UNIQUE NULLS NOT DISTINCT ('));
  end loop;
 end loop;
end $$;


create or replace function private.append_period_details(history jsonb, period text, detail_key text, additions jsonb)
returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(entry order by entry->>'year'),'[]'::jsonb) from (
  select value as entry from jsonb_array_elements(coalesce(history,'[]')) where value->>'year' is distinct from period
  union all
  select jsonb_build_object('year',period,detail_key,
   (select coalesce(jsonb_agg(v order by v),'[]') from (
    select distinct value as v from jsonb_array_elements(additions || coalesce(
      (select value->detail_key from jsonb_array_elements(coalesce(history,'[]')) where value->>'year' is not distinct from period),'[]'))
   ) details))
 ) periods
$$;

create or replace function private.append_pbe_history(history jsonb, period text, books jsonb, results jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare previous jsonb; merged jsonb; region text; placement jsonb; combined jsonb; regions text[] := array['Area','State','Union','Divisional']; i integer;
begin
 if not private.valid_pbe_results(results) then raise exception 'Choose a valid placement for each PBE region.'; end if;
 select value into previous from jsonb_array_elements(coalesce(history,'[]')) where value->>'year' is not distinct from period;
 for region,placement in select * from jsonb_each(results) loop
  if (previous->'results') ? region and previous->'results'->region is distinct from placement then
   raise exception 'A different placement is already recorded for PBE % in %. Existing data was kept.',region,period;
  end if;
 end loop;
 combined := coalesce(previous->'results','{}') || results;
 -- Existing incomplete historical results remain readable; new additions need prior regions.
 if results <> '{}'::jsonb then
  for i in 2..4 loop
   if combined ? regions[i] and not (combined ?& regions[1:i-1]) then
    raise exception 'PBE % requires placements for all earlier regions (Area, State, Union, Divisional).',regions[i];
   end if;
  end loop;
 end if;
 merged := private.append_period_details(history,period,'books',books);
 if coalesce(previous->'results','{}') || results <> '{}'::jsonb then
  select jsonb_agg(case when value->>'year' is not distinct from period then value || jsonb_build_object('results',coalesce(previous->'results','{}') || results) else value end order by value->>'year') into merged from jsonb_array_elements(merged);
 end if;
 return merged;
end $$;

create or replace function public.add_to_records(p_ids integer[], p_year text, p_entry jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 person integer; person_name text; person_status text; years jsonb; levels_value jsonb;
 new_operations jsonb; skipped_operations jsonb; receipt_note text;
 old_history jsonb; merged jsonb; detail_key text; table_name text;
 kind text := p_entry->>'kind'; details jsonb := p_entry->'details';
 entry_value jsonb; row_id integer; existing_placement text;
 changed boolean; year_added boolean; results jsonb := '[]';
begin
 if auth.uid() is null then raise exception 'Sign in to add information.' using errcode='42501'; end if;
 if coalesce(cardinality(p_ids),0)=0 then raise exception 'Select at least one profile.'; end if;
 if p_year is not null and not private.valid_school_years(jsonb_build_array(p_year)) then raise exception 'Choose a valid school year.'; end if;
 if kind is null or kind not in ('level','staff','drill','drums','pbe','tlt','event','honor') then raise exception 'Choose a documentation category.'; end if;
 if kind='pbe' then
  if not private.valid_pbe_results(coalesce(p_entry->'results','{}')) then raise exception 'Choose a valid placement for each PBE region.'; end if;
  if p_year is null then details := '[]'; else
  select coalesce(jsonb_agg(book_name order by book_name),'[]') into details from public.pbe_year_books where school_year=p_year;
  if details='[]'::jsonb then raise exception 'No Bible books are configured for this year.'; end if;
  end if;
 end if;
 if kind in ('staff','drums','pbe','tlt') and
   (details is null or jsonb_typeof(details)<>'array') then raise exception 'Choose the details to add.'; end if;
 if kind='staff' and jsonb_array_length(details)<>1 then raise exception 'Choose one Staff title.'; end if;
 if kind='event' then
  table_name := case p_entry->>'event'
    when 'Drill Performance' then 'red_zone_drill_performance' when 'Drum Performance' then 'red_zone_drum_performance'
    when 'Honor Evaluations' then 'red_zone_honor_evaluations' when 'Bible Events' then 'red_zone_bible_events'
    when 'Knots Relay' then 'red_zone_knots' when 'Tents' then 'red_zone_tents' when 'Jump Rope' then 'red_zone_jump_rope'
    when 'Archery' then 'red_zone_archery' when 'Lashing' then 'red_zone_lashing' when 'Burning Twine' then 'red_zone_burning_twine' end;
  if table_name is null then raise exception 'Choose a valid Red Zone event.'; end if;
 end if;
 -- Consistent lock order protects merges against concurrent batch additions.
 for person in select distinct unnest(p_ids) order by 1 loop
  person_name := 'Profile ' || person; changed := false; year_added := false; receipt_note := null;
  begin
   select concat_ws(' ',first_name,nullif(last_name,'')),years_active,levels into person_name,years,levels_value
     from public.pathfinders where id=person for update;
   if not found then raise exception 'Profile is unavailable or you no longer have access.'; end if;
   select status into person_status from public.current_data where pathfinder_id=person and school_year=public.current_club_year() for share;
   if kind='staff' and person_status='pathfinder' then raise exception 'Current Pathfinders cannot receive a Staff title.'; end if;
   if kind='level' then
    entry_value := jsonb_build_object('name',p_entry->>'name','outcome',p_entry->>'outcome','year',p_year);
    changed := not (levels_value @> jsonb_build_array(jsonb_build_object('name',p_entry->>'name')));
    if not changed then receipt_note := 'This level is already recorded. Its existing year and outcome were kept.'; end if;
    if changed then update public.pathfinders set levels=levels_value || jsonb_build_array(entry_value) where id=person; end if;
   elsif kind='drill' then
    select id,d.years into row_id,old_history from public.drill d where pathfinder_id=person and team is not distinct from (p_entry->>'team') for update;
    changed := row_id is null or not (old_history @> jsonb_build_array(p_year));
    if row_id is null then insert into public.drill(pathfinder_id,team,years) values(person,p_entry->>'team',jsonb_build_array(p_year));
    elsif changed then update public.drill set years=old_history || jsonb_build_array(p_year) where id=row_id; end if;
   elsif kind='tlt' then
    select id,history into row_id,old_history from public.tlt where pathfinder_id=person for update;
    select coalesce(jsonb_agg(operation order by operation),'[]') into new_operations
    from (select distinct value as operation from jsonb_array_elements(details)) requested
    where not exists(select 1 from jsonb_array_elements(coalesce(old_history,'[]')) e where e->'operations' @> jsonb_build_array(operation));
    select coalesce(jsonb_agg(operation order by operation),'[]') into skipped_operations
    from (select distinct value as operation from jsonb_array_elements(details)) requested
    where exists(select 1 from jsonb_array_elements(coalesce(old_history,'[]')) e where e->'operations' @> jsonb_build_array(operation));
    changed := new_operations <> '[]'::jsonb;
    if skipped_operations <> '[]'::jsonb then
     select 'Already recorded operations: ' || string_agg(value,', ' order by value) || '. Existing years were kept.' into receipt_note from jsonb_array_elements_text(skipped_operations);
    end if;
    if changed then
     merged := private.append_period_details(old_history,p_year,'operations',new_operations);
     if row_id is null then insert into public.tlt(pathfinder_id,history) values(person,merged);
     else update public.tlt set history=merged where id=row_id; end if;
    end if;
   elsif kind in ('staff','drums','pbe') then
    table_name := case kind when 'staff' then 'staff_history' when 'drums' then 'drum_corps' else kind end;
    detail_key := case kind when 'staff' then 'titles' when 'drums' then 'drums' when 'pbe' then 'books' else 'operations' end;
    row_id := null; old_history := null;
    if kind='staff' then
     select id,history into row_id,old_history from public.staff_history where pathfinder_id=person for update;
    else
     execute format('select id,history from public.%I where pathfinder_id=$1 for update',table_name) into row_id,old_history using person;
    end if;
    changed := not coalesce(old_history @> jsonb_build_array(jsonb_build_object('year',p_year,detail_key,details)),false);
    if kind='pbe' then
     changed := changed or not coalesce(old_history @> jsonb_build_array(jsonb_build_object('year',p_year,'results',coalesce(p_entry->'results','{}'))),false) and coalesce(p_entry->'results','{}') <> '{}'::jsonb;
     merged := private.append_pbe_history(old_history,p_year,details,coalesce(p_entry->'results','{}'));
    else
     merged := private.append_period_details(old_history,p_year,detail_key,details);
    end if;
    if row_id is null then
     if kind='staff' then insert into public.staff_history(pathfinder_id,history) values(person,merged);
     else execute format('insert into public.%I(pathfinder_id,history) values($1,$2)',table_name) using person,merged; end if;
    elsif changed then execute format('update public.%I set history=$1 where id=$2',table_name) using merged,row_id; end if;
   elsif kind='honor' then
    select id into row_id from public.honors_earned where pathfinder_id=person and honor_id=(p_entry->>'honor_id')::integer and year_earned is not distinct from p_year;
    changed := row_id is null;
    if changed then insert into public.honors_earned(pathfinder_id,honor_id,year_earned) values(person,(p_entry->>'honor_id')::integer,p_year); end if;
   elsif kind='event' then
    row_id := null; existing_placement := null;
    if table_name in ('red_zone_honor_evaluations','red_zone_bible_events') then
     if nullif(btrim(p_entry->>'name'),'') is null then raise exception 'Enter the event or evaluation name.'; end if;
     execute format('select id,placement from public.%I where pathfinder_id=$1 and year is not distinct from $2 and name=$3 order by (placement is distinct from $4) desc, id for update',table_name)
       into row_id,existing_placement using person,p_year,btrim(p_entry->>'name'),p_entry->>'placement';
    else
     execute format('select id,placement from public.%I where pathfinder_id=$1 and year is not distinct from $2 order by (placement is distinct from $3) desc, id for update',table_name)
       into row_id,existing_placement using person,p_year,p_entry->>'placement';
    end if;
    if row_id is not null and existing_placement is distinct from (p_entry->>'placement') then
      raise exception 'A different placement is already recorded for this event and year. Existing data was kept.';
    end if;
    changed := row_id is null;
    if changed then
     if table_name in ('red_zone_honor_evaluations','red_zone_bible_events') then
      execute format('insert into public.%I(pathfinder_id,year,name,placement) values($1,$2,$3,$4)',table_name) using person,p_year,btrim(p_entry->>'name'),p_entry->>'placement';
     else execute format('insert into public.%I(pathfinder_id,year,placement) values($1,$2,$3)',table_name) using person,p_year,p_entry->>'placement'; end if;
    end if;
   end if;
   year_added := p_year is not null and not (years @> jsonb_build_array(p_year)) and (changed or kind not in ('level','tlt'));
   if year_added then update public.pathfinders set years_active=years || jsonb_build_array(p_year) where id=person; end if;
   results := results || jsonb_build_array(jsonb_build_object('id',person,'name',person_name,'status',case when changed then 'added' else 'already' end,'year_added',year_added,'reason',receipt_note));
  exception when others then
   results := results || jsonb_build_array(jsonb_build_object('id',person,'name',coalesce(person_name,'Profile '||person),'status','error','reason',sqlerrm,'year_added',false));
  end;
 end loop;
 return results;
end $$;
revoke all on function public.add_to_records(integer[],text,jsonb) from public,anon;
grant execute on function public.add_to_records(integer[],text,jsonb) to authenticated;


create or replace view public.member_search_base with (security_invoker = true) as
select p.id,p.first_name,p.last_name,concat_ws(' ',p.first_name,nullif(p.last_name,'')) as name,p.years_active,p.levels,p.created_at,p.updated_at,
  c.pathfinder_id is not null as has_current_data,
  coalesce(c.status,'not_active') as status,
  c.current_title,c.current_activities,
  p.years_active || coalesce((select jsonb_agg(distinct e->'year') from public.staff_history h cross join lateral jsonb_array_elements(h.history) e where h.pathfinder_id=p.id),'[]'::jsonb) || case when c.status in ('pathfinder','staff') then jsonb_build_array(c.school_year) else '[]'::jsonb end as search_years,
  coalesce((select jsonb_agg(distinct split_part(value,' (',1)) from jsonb_array_elements_text(activity_pairs.years)), '[]'::jsonb) as search_activities,
  activity_pairs.years as search_activity_years,
  event_pairs.years as search_event_years,
  coalesce((select jsonb_agg(distinct split_part(value,' (',1)) from jsonb_array_elements_text(event_pairs.years)), '[]'::jsonb) as search_events,
  coalesce((select jsonb_agg(distinct jsonb_build_object('name',name,'year',case when length(year)=4 then to_jsonb(year::integer) else to_jsonb(year) end,'detail',detail)) from (
    select 'Drill'::text as name, calendar_year as year, d.team as detail from public.drill d cross join lateral jsonb_array_elements_text(d.years) y cross join lateral unnest(array[left(y,4),(left(y,4)::integer+1)::text,y]) calendar_year where d.pathfinder_id=p.id and d.team is not null
    union all
    select 'Drums'::text as name, calendar_year as year, instrument as detail
    from public.drum_corps d cross join lateral jsonb_array_elements(d.history) entry
    cross join lateral jsonb_array_elements_text(entry->'drums') instrument
    cross join lateral (select entry->>'year' as y) period
    cross join lateral unnest(array[left(y,4),(left(y,4)::integer+1)::text,y]) calendar_year where d.pathfinder_id=p.id
    union all
    select 'TLT', calendar_year, operation
    from public.tlt t cross join lateral jsonb_array_elements(t.history) entry
    cross join lateral jsonb_array_elements_text(entry->'operations') operation cross join lateral unnest(array[left(entry->>'year',4),(left(entry->>'year',4)::integer+1)::text,entry->>'year']) calendar_year where t.pathfinder_id=p.id
    union all
    select 'PBE', calendar_year, detail
    from public.pbe b cross join lateral jsonb_array_elements(b.history) entry
    cross join lateral jsonb_each_text(coalesce(entry->'results','{}')) result
    cross join lateral unnest(array[result.key,result.key || ' / ' || result.value]) detail
    cross join lateral unnest(array[left(entry->>'year',4),(left(entry->>'year',4)::integer+1)::text,entry->>'year']) calendar_year
    where b.pathfinder_id=p.id
  ) records), '[]'::jsonb) as search_activity_details,
  coalesce((select jsonb_agg(distinct jsonb_build_object('name',name,'year',case when length(year)=4 then to_jsonb(year::integer) else to_jsonb(year) end,'detail',placement)) from (
    select 'Drill Performance'::text as name, calendar_year as year, placement from public.red_zone_drill_performance cross join lateral unnest(array[left(year,4),(left(year,4)::integer+1)::text,year]) calendar_year where pathfinder_id=p.id
    union all
    select 'Drum Performance'::text as name, calendar_year as year, placement from public.red_zone_drum_performance cross join lateral unnest(array[left(year,4),(left(year,4)::integer+1)::text,year]) calendar_year where pathfinder_id=p.id
    union all
    select 'Honor Evaluations'::text as name, calendar_year as year, placement from public.red_zone_honor_evaluations cross join lateral unnest(array[left(year,4),(left(year,4)::integer+1)::text,year]) calendar_year where pathfinder_id=p.id
    union all
    select 'Bible Events'::text as name, calendar_year as year, placement from public.red_zone_bible_events cross join lateral unnest(array[left(year,4),(left(year,4)::integer+1)::text,year]) calendar_year where pathfinder_id=p.id
    union all
    select 'Knots Relay'::text as name, calendar_year as year, placement from public.red_zone_knots cross join lateral unnest(array[left(year,4),(left(year,4)::integer+1)::text,year]) calendar_year where pathfinder_id=p.id
    union all
    select 'Tents'::text as name, calendar_year as year, placement from public.red_zone_tents cross join lateral unnest(array[left(year,4),(left(year,4)::integer+1)::text,year]) calendar_year where pathfinder_id=p.id
    union all
    select 'Jump Rope'::text as name, calendar_year as year, placement from public.red_zone_jump_rope cross join lateral unnest(array[left(year,4),(left(year,4)::integer+1)::text,year]) calendar_year where pathfinder_id=p.id
    union all
    select 'Archery'::text as name, calendar_year as year, placement from public.red_zone_archery cross join lateral unnest(array[left(year,4),(left(year,4)::integer+1)::text,year]) calendar_year where pathfinder_id=p.id
    union all
    select 'Lashing'::text as name, calendar_year as year, placement from public.red_zone_lashing cross join lateral unnest(array[left(year,4),(left(year,4)::integer+1)::text,year]) calendar_year where pathfinder_id=p.id
    union all
    select 'Burning Twine'::text as name, calendar_year as year, placement from public.red_zone_burning_twine cross join lateral unnest(array[left(year,4),(left(year,4)::integer+1)::text,year]) calendar_year where pathfinder_id=p.id
  ) records), '[]'::jsonb) as search_event_details
from public.pathfinders p left join public.current_data c
  on c.pathfinder_id=p.id and c.school_year=public.current_club_year()
cross join lateral (select
  coalesce((select jsonb_agg(distinct activity || ' (' || calendar_year || ')') from (
    select 'Drill'::text as activity, jsonb_array_elements_text(d.years) as year from public.drill d where d.pathfinder_id=p.id
    union all
    select 'Drums', entry->>'year' from public.drum_corps d cross join lateral jsonb_array_elements(d.history) entry where d.pathfinder_id=p.id
    union all
    select 'PBE', entry->>'year' from public.pbe b cross join lateral jsonb_array_elements(b.history) entry where b.pathfinder_id=p.id
    union all
    select 'TLT', entry->>'year' from public.tlt t cross join lateral jsonb_array_elements(t.history) entry where t.pathfinder_id=p.id
  ) pairs cross join lateral unnest(array[left(year,4),(left(year,4)::integer+1)::text,year]) calendar_year), '[]'::jsonb) as years) activity_pairs
cross join lateral (select
  coalesce((select jsonb_agg(distinct event || ' (' || coalesce(year,'Unknown') || ')') from (
    select 'Drill Performance'::text as event, calendar_year as year from public.red_zone_drill_performance e cross join lateral unnest(array[left(e.year,4),(left(e.year,4)::integer+1)::text,e.year]) calendar_year where e.pathfinder_id=p.id
    union all
    select 'Drum Performance'::text as event, calendar_year as year from public.red_zone_drum_performance e cross join lateral unnest(array[left(e.year,4),(left(e.year,4)::integer+1)::text,e.year]) calendar_year where e.pathfinder_id=p.id
    union all
    select 'Honor Evaluations'::text as event, calendar_year as year from public.red_zone_honor_evaluations e cross join lateral unnest(array[left(e.year,4),(left(e.year,4)::integer+1)::text,e.year]) calendar_year where e.pathfinder_id=p.id
    union all
    select 'Bible Events'::text as event, calendar_year as year from public.red_zone_bible_events e cross join lateral unnest(array[left(e.year,4),(left(e.year,4)::integer+1)::text,e.year]) calendar_year where e.pathfinder_id=p.id
    union all
    select 'Knots Relay'::text as event, calendar_year as year from public.red_zone_knots e cross join lateral unnest(array[left(e.year,4),(left(e.year,4)::integer+1)::text,e.year]) calendar_year where e.pathfinder_id=p.id
    union all
    select 'Tents'::text as event, calendar_year as year from public.red_zone_tents e cross join lateral unnest(array[left(e.year,4),(left(e.year,4)::integer+1)::text,e.year]) calendar_year where e.pathfinder_id=p.id
    union all
    select 'Jump Rope'::text as event, calendar_year as year from public.red_zone_jump_rope e cross join lateral unnest(array[left(e.year,4),(left(e.year,4)::integer+1)::text,e.year]) calendar_year where e.pathfinder_id=p.id
    union all
    select 'Archery'::text as event, calendar_year as year from public.red_zone_archery e cross join lateral unnest(array[left(e.year,4),(left(e.year,4)::integer+1)::text,e.year]) calendar_year where e.pathfinder_id=p.id
    union all
    select 'Lashing'::text as event, calendar_year as year from public.red_zone_lashing e cross join lateral unnest(array[left(e.year,4),(left(e.year,4)::integer+1)::text,e.year]) calendar_year where e.pathfinder_id=p.id
    union all
    select 'Burning Twine'::text as event, calendar_year as year from public.red_zone_burning_twine e cross join lateral unnest(array[left(e.year,4),(left(e.year,4)::integer+1)::text,e.year]) calendar_year where e.pathfinder_id=p.id
  ) pairs), '[]'::jsonb) as years) event_pairs;
grant select on public.member_search_base to authenticated;
grant select on public.member_search_base to authenticated,service_role;


notify pgrst,'reload schema';
commit;
