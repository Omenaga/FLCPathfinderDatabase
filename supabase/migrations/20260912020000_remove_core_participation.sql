-- Historical participation is stored exclusively in the activity/event tables.
begin;
drop view public.member_search;
alter table public.pathfinders drop column extracurriculars, drop column red_zone_participation;
create view public.member_search with (security_invoker = true) as
select p.id,p.name,p.years_active,p.levels,p.created_at,p.updated_at,
  c.pathfinder_id is not null as has_current_data,
  case when p.graduated then 'graduated'::text
    when c.pathfinder_id is null then 'unregistered'::text
    else c.status end as status,
  c.grade,c.class_level,c.current_activities,
  p.years_active || case when not p.graduated and c.status in ('new','returning')
    then jsonb_build_array(c.school_year) else '[]'::jsonb end as search_years,
  coalesce((select jsonb_agg(distinct split_part(value,' (',1)) from jsonb_array_elements_text(activity_pairs.years)), '[]'::jsonb) as search_activities,
  activity_pairs.years as search_activity_years,
  event_pairs.years as search_event_years,
  coalesce((select jsonb_agg(distinct split_part(value,' (',1)) from jsonb_array_elements_text(event_pairs.years)), '[]'::jsonb) as search_events
from public.pathfinders p left join public.current_data c
  on c.pathfinder_id=p.id and c.school_year=public.current_club_year()
cross join lateral (select
  coalesce((select jsonb_agg(distinct activity || ' (' || calendar_year || ')') from (
    select 'Drill'::text as activity, jsonb_array_elements_text(d.years) as year from public.drill d where d.pathfinder_id=p.id
    union all
    select 'Drums', jsonb_array_elements_text(d.years) from public.drum_corps d where d.pathfinder_id=p.id
    union all
    select 'PBE', entry->>'year' from public.pbe b cross join lateral jsonb_array_elements(b.history) entry where b.pathfinder_id=p.id
    union all
    select 'TLT', entry->>'year' from public.tlt t cross join lateral jsonb_array_elements(t.history) entry where t.pathfinder_id=p.id
  ) pairs cross join lateral unnest(case when activity='TLT' then array[year]
    else array[split_part(year,'-',1),split_part(year,'-',2)] end) calendar_year), '[]'::jsonb) as years) activity_pairs
cross join lateral (select
  coalesce((select jsonb_agg(distinct event || ' (' || year || ')') from (
    select 'Drill Performance'::text as event, e.year from public.red_zone_drill_performance e where e.pathfinder_id=p.id
    union all
    select 'Drum Performance'::text as event, e.year from public.red_zone_drum_performance e where e.pathfinder_id=p.id
    union all
    select 'Honor Evaluations'::text as event, e.year from public.red_zone_honor_evaluations e where e.pathfinder_id=p.id
    union all
    select 'Bible Events'::text as event, e.year from public.red_zone_bible_events e where e.pathfinder_id=p.id
    union all
    select 'Knots Relay'::text as event, e.year from public.red_zone_knots e where e.pathfinder_id=p.id
    union all
    select 'Tents'::text as event, e.year from public.red_zone_tents e where e.pathfinder_id=p.id
    union all
    select 'Jump Rope'::text as event, e.year from public.red_zone_jump_rope e where e.pathfinder_id=p.id
    union all
    select 'Archery'::text as event, e.year from public.red_zone_archery e where e.pathfinder_id=p.id
    union all
    select 'Lashing'::text as event, e.year from public.red_zone_lashing e where e.pathfinder_id=p.id
    union all
    select 'Burning Twine'::text as event, e.year from public.red_zone_burning_twine e where e.pathfinder_id=p.id
  ) pairs), '[]'::jsonb) as years) event_pairs;
grant select on public.member_search to authenticated;
notify pgrst, 'reload schema';
commit;
