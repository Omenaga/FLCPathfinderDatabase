begin;

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
  coalesce((select jsonb_agg(distinct event || ' (' || year || ')') from (
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
