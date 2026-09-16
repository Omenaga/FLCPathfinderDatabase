begin;

-- Preserve the source records before retiring a field and converting a title.
-- These backups are deliberately outside the API schema and unavailable to staff.
lock table public.pathfinders, public.current_data, public.staff_history, public.staff_titles
  in access exclusive mode;
create table private.achievements_registration_backup as select * from public.current_data;
create table private.master_guide_history_backup as
  select * from public.staff_history where exists (
    select 1 from jsonb_array_elements(history) entry where entry->'titles' ? 'Master Guide'
  );
create table private.master_guide_members_backup as
  select p.* from public.pathfinders p where
    exists (select 1 from private.master_guide_history_backup h where h.pathfinder_id=p.id)
    or exists (select 1 from public.current_data c where c.pathfinder_id=p.id and c.current_title ? 'Master Guide');
revoke all on private.achievements_registration_backup, private.master_guide_history_backup,
  private.master_guide_members_backup from public, anon, authenticated;

-- The eight classes retain their outcomes. Master Guide is a plain dated achievement.
create or replace function private.valid_levels(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare entry jsonb;
begin
  if value is null or jsonb_typeof(value)<>'array' then return false; end if;
  for entry in select jsonb_array_elements(value) loop
    if jsonb_typeof(entry)<>'object' then return false; end if;
    if entry->>'name'='Master Guide' then
      if not (entry ?& array['name','year']) or entry-array['name','year']<>'{}'::jsonb then
        return false;
      end if;
    else
      if not (entry ?& array['name','outcome','year'])
        or entry-array['name','outcome','year']<>'{}'::jsonb then return false; end if;
      if not coalesce(entry->>'name'=any(array['Friend','Companion','Explorer','Ranger','Voyager','Guide','Pioneer','Navigator']),false)
        or not coalesce(entry->>'outcome'=any(array['basic','advanced','incomplete']),false) then
        return false;
      end if;
    end if;
    if not private.valid_history_years(jsonb_build_array(entry->'year')) then return false; end if;
  end loop;
  return jsonb_array_length(value)=(select count(distinct item) from jsonb_array_elements(value) item);
end $$;

-- Preserve every distinct historical year, even when a legacy title occurred more than once.
-- A current-only title establishes the achievement, but not its earned date: use Unknown.
update public.pathfinders p set levels=p.levels || (
  select jsonb_agg(jsonb_build_object('name','Master Guide','year',years.year) order by years.year)
  from (
    select distinct entry->>'year' as year
    from private.master_guide_history_backup h cross join lateral jsonb_array_elements(h.history) entry
    where h.pathfinder_id=p.id and entry->'titles' ? 'Master Guide'
    union all
    select null::text where not exists (
      select 1 from private.master_guide_history_backup h where h.pathfinder_id=p.id
    )
  ) years
) where p.id in (select id from private.master_guide_members_backup);

-- Empty title arrays retain known Staff participation without inventing another title.
update public.staff_history h set history=(
  select jsonb_agg(jsonb_set(entry,'{titles}',(entry->'titles')-'Master Guide') order by position)
  from jsonb_array_elements(h.history) with ordinality entries(entry,position)
) where h.id in (select id from private.master_guide_history_backup);
update public.current_data set current_title=nullif(current_title-'Master Guide','[]'::jsonb)
  where current_title ? 'Master Guide';
delete from public.staff_titles where title='Master Guide';

-- Remove only current-registration activities; historical activity tables remain intact.
drop view public.member_search;
drop view public.member_search_base;
alter table public.current_data drop column current_activities;

create or replace function private.validate_current_title() returns trigger
language plpgsql security definer set search_path='' as $$
declare allowed text[];
begin
  if new.current_title is null then return new; end if;
  if new.status='pathfinder' then
    allowed := array['Friend','Companion','Explorer','Ranger','Voyager','Guide','Pioneer','Navigator'];
  elsif new.status='staff' then
    perform title from public.staff_titles order by title for share;
    select coalesce(array_agg(title),array[]::text[]) into allowed from public.staff_titles;
  else
    raise exception 'Parent and Not Active use no title' using errcode='23514';
  end if;
  if not private.valid_string_array(new.current_title,allowed) then
    raise exception 'Titles must be a unique array of classes or staff titles matching status' using errcode='23514';
  end if;
  return new;
end $$;

-- Replace the bulk writer while preserving its per-person rollback and duplicate rules.
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
    -- Reject outcome variants for Master Guide instead of silently discarding them.
    if p_entry->>'name'='Master Guide' then
      if p_entry ? 'outcome' then raise exception 'Master Guide has no outcome.'; end if;
      entry_value := jsonb_build_object('name','Master Guide','year',p_year);
    else
      entry_value := jsonb_build_object('name',p_entry->>'name','outcome',p_entry->>'outcome','year',p_year);
    end if;
    if not private.valid_levels(jsonb_build_array(entry_value)) then raise exception 'Choose a valid achievement and outcome.'; end if;
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



-- Rebuild search projections without the retired column.
create or replace view public.member_search_base with (security_invoker = true) as
select p.id,p.first_name,p.last_name,concat_ws(' ',p.first_name,nullif(p.last_name,'')) as name,p.years_active,p.levels,p.created_at,p.updated_at,
  c.pathfinder_id is not null as has_current_data,
  coalesce(c.status,'not_active') as status,
  c.current_title,
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



create view public.member_search with (security_invoker=true) as
select s.*,
 -- Keep title and year in one object so historical staff searches cannot cross-match years.
 coalesce((select jsonb_agg(jsonb_build_object('name',title,'year',entry->'year'))
   from public.staff_history h cross join lateral jsonb_array_elements(h.history) entry
   cross join lateral jsonb_array_elements_text(entry->'titles') title
   where h.pathfinder_id=s.id),'[]'::jsonb) as search_staff_titles,
 case status when 'pathfinder' then 0 when 'staff' then 1 when 'parent' then 2 else 3 end as sort_status,
 case status
 when 'pathfinder' then coalesce((select min(array_position(array['Friend','Companion','Explorer','Ranger','Voyager','Guide','Pioneer','Navigator'],v)) from jsonb_array_elements_text(current_title) v),1000)
 when 'staff' then coalesce((select min(t.sort_order) from public.staff_titles t where s.current_title @> jsonb_build_array(t.title)),1000)
 else 0 end as sort_title,
 lower(last_name) as sort_last_name, lower(first_name) as sort_first_name
from public.member_search_base s;
grant select on public.member_search to authenticated,service_role;



-- Only this reviewed-save RPC may delete instances. Direct table DELETE remains denied.
-- Definer privileges are scoped by authentication, a fixed table/column allowlist,
-- the original snapshot, immutable identities, and member-owned row predicates.
create or replace function public.update_profile(p_id integer, p_original jsonb, p_profile jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare
 allowed constant jsonb := '{"pathfinders": ["first_name", "last_name", "birth_date", "years_active", "levels", "notes"], "current_data": ["school_year", "status", "current_title"], "staff_history": ["history"], "drill": ["team", "years"], "drum_corps": ["history"], "pbe": ["history"], "tlt": ["history"], "red_zone_drill_performance": ["year", "placement"], "red_zone_drum_performance": ["year", "placement"], "red_zone_honor_evaluations": ["year", "placement", "name"], "red_zone_bible_events": ["year", "placement", "name"], "red_zone_knots": ["year", "placement"], "red_zone_tents": ["year", "placement"], "red_zone_jump_rope": ["year", "placement"], "red_zone_archery": ["year", "placement"], "red_zone_lashing": ["year", "placement"], "red_zone_burning_twine": ["year", "placement"], "honors_earned": ["honor_id", "year_earned"]}'::jsonb;
 tab text; cols jsonb; column_names text[]; assignments text; key_name text;
 old_row jsonb; new_row jsonb; affected integer; insert_columns text; select_columns text; normalized jsonb; entry jsonb; books jsonb;
begin
 if public.current_staff_role() is distinct from 'editor' then
  raise exception 'Staff sign-in is required.' using errcode='42501';
 end if;
 -- Serialize this workflow with Add to Record and lock existing detail rows as well.
 perform 1 from public.pathfinders where id=p_id for update;
 if not found then raise exception 'Profile is no longer available.'; end if;
 for tab in select jsonb_object_keys(allowed) order by 1 loop
  if tab <> 'pathfinders' then
   execute format('select 1 from public.%I where pathfinder_id=$1 for update',tab) using p_id;
  end if;
 end loop;
 if p_original is distinct from public.get_profile_for_edit(p_id) then
  raise exception 'This profile changed since you opened the editor. Cancel and reopen Edit Profile to load the latest data.' using errcode='40001';
 end if;
 if jsonb_typeof(p_profile) is distinct from 'object' or
    (select array_agg(k order by k) from jsonb_object_keys(p_profile) k) is distinct from
    (select array_agg(k order by k) from jsonb_object_keys(allowed) k) then
  raise exception 'Invalid profile data.';
 end if;
 for tab,cols in select * from jsonb_each(allowed) loop
  select array_agg(value) into column_names from jsonb_array_elements_text(cols);
  key_name := case when tab='current_data' then 'pathfinder_id' else 'id' end;
  if jsonb_typeof(p_profile->tab) is distinct from 'array' then raise exception 'Invalid records for %.',tab; end if;
  if tab='pathfinders' and jsonb_array_length(p_profile->tab) <> 1 then
   raise exception 'The member profile cannot be removed.';
  end if;
  if tab='current_data' and jsonb_array_length(p_profile->tab) <> 1 then
   raise exception 'Current Registration must contain one record.';
  end if;
  -- New rows have no identity or ownership columns; existing identities must match the snapshot.
  for new_row in select value from jsonb_array_elements(p_profile->tab) loop
   if jsonb_typeof(new_row) is distinct from 'object' then raise exception 'Invalid record.'; end if;
   if new_row ? key_name then
    if not exists(select 1 from jsonb_array_elements(p_original->tab) r where r->key_name=new_row->key_name) then
     raise exception 'Record identities cannot be changed.';
    end if;
   elsif tab='pathfinders' or new_row - column_names <> '{}'::jsonb then
    raise exception 'Only profile fields may be changed.';
   end if;
  end loop;
  -- The catalog is authoritative for PBE books, including newly added history entries.
  if tab='pbe' and p_profile->tab is distinct from p_original->tab then
   normalized := '[]'::jsonb;
   for new_row in select value from jsonb_array_elements(p_profile->tab) loop
    if jsonb_typeof(new_row->'history') is distinct from 'array' then raise exception 'Invalid PBE history.'; end if;
    books := '[]'::jsonb;
    for entry in select value from jsonb_array_elements(new_row->'history') loop
     entry := jsonb_set(entry,'{books}',coalesce((select jsonb_agg(book_name order by book_name) from public.pbe_year_books where school_year=entry->>'year'),'[]'::jsonb));
     books := books || jsonb_build_array(entry);
    end loop;
    normalized := normalized || jsonb_build_array(jsonb_set(new_row,'{history}',books));
   end loop;
   p_profile := jsonb_set(p_profile,array[tab],normalized);
  end if;
  -- Remove only instances from this member's reviewed snapshot, before updates that may reuse their unique keys.
  for old_row in select value from jsonb_array_elements(p_original->tab) loop
   if not exists(select 1 from jsonb_array_elements(p_profile->tab) r where r->key_name=old_row->key_name) then
    if tab in ('pathfinders','current_data') then raise exception 'The member profile and Current Registration cannot be removed.'; end if;
    execute format('delete from public.%I where %I=$1 and pathfinder_id=$2',tab,key_name)
      using (old_row->>key_name)::integer,p_id;
    get diagnostics affected = row_count;
    if affected <> 1 then raise exception 'Could not remove the history entry.'; end if;
   end if;
  end loop;
  for old_row in select old.value from jsonb_array_elements(p_original->tab) old
    where exists(select 1 from jsonb_array_elements(p_profile->tab) r where r->key_name=old.value->key_name) loop
   if (select count(*) from jsonb_array_elements(p_profile->tab) r where r->key_name=old_row->key_name) <> 1 then
    raise exception 'Record identities cannot be changed.';
   end if;
   select value into new_row from jsonb_array_elements(p_profile->tab) where value->key_name=old_row->key_name;
   if new_row - column_names is distinct from old_row - column_names then
    raise exception 'Only profile fields may be changed.';
   end if;
   if new_row is distinct from old_row then
    select string_agg(format('%I = src.%I',c,c),', ') into assignments from unnest(column_names) c;
    execute format('update public.%I as dest set %s from jsonb_populate_record(null::public.%I,$1) src where dest.%I=$2 and dest.%I=$3',
      tab,assignments,tab,key_name,case when tab='pathfinders' then 'id' else 'pathfinder_id' end)
      using new_row,(old_row->>key_name)::integer,p_id;
    get diagnostics affected = row_count;
    if affected <> 1 then raise exception 'Could not update the profile.'; end if;
   end if;
  end loop;
  select string_agg(format('%I',c),', '), string_agg(format('src.%I',c),', ')
    into insert_columns,select_columns from unnest(column_names) c;
  for new_row in select value from jsonb_array_elements(p_profile->tab) where not (value ? key_name) loop
   if tab='drill' then
    -- A team has one stored row; another instance extends its years.
    insert into public.drill(pathfinder_id,team,years) values(p_id,new_row->>'team',new_row->'years')
    on conflict(pathfinder_id,team) do update set years=(
      select jsonb_agg(distinct y) from jsonb_array_elements(public.drill.years || excluded.years) y
    );
   else
    execute format('insert into public.%I (pathfinder_id,%s) select $2,%s from jsonb_populate_record(null::public.%I,$1) src',tab,insert_columns,select_columns,tab)
      using new_row,p_id;
   end if;
  end loop;
 end loop;
end $$;
revoke all on function public.update_profile(integer,jsonb,jsonb) from public,anon;
grant execute on function public.update_profile(integer,jsonb,jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
