-- Add activity/year pairs for server-side AND filtering, under the existing RLS policies.
create or replace view public.member_search with (security_invoker = true) as
select p.id,p.name,p.years_active,p.levels,p.extracurriculars,p.red_zone_participation,p.created_at,p.updated_at,
  c.pathfinder_id is not null as has_current_data,
  case when p.graduated then 'graduated'::text
    when c.pathfinder_id is null then 'unregistered'::text
    else c.status end as status,
  c.grade,c.class_level,c.current_activities,
  p.years_active || case when not p.graduated and c.status in ('new','returning')
    then jsonb_build_array(c.school_year) else '[]'::jsonb end as search_years,
  p.extracurriculars || case when not p.graduated and c.status in ('new','returning')
    then c.current_activities else '[]'::jsonb end as search_activities,
  coalesce((select jsonb_agg(distinct activity || ' (' || calendar_year || ')') from (
    select 'Drill'::text as activity, jsonb_array_elements_text(d.years) as year from public.drill d where d.pathfinder_id=p.id
    union all
    select 'Drums', jsonb_array_elements_text(d.years) from public.drum_corps d where d.pathfinder_id=p.id
    union all
    select 'PBE', entry->>'year' from public.pbe b cross join lateral jsonb_array_elements(b.history) entry where b.pathfinder_id=p.id
    union all
    select 'TLT', entry->>'year' from public.tlt t cross join lateral jsonb_array_elements(t.history) entry where t.pathfinder_id=p.id
    union all
    select activity, c.school_year from jsonb_array_elements_text(c.current_activities) activity
      where not p.graduated and c.status in ('new','returning') and activity<>'TLT'
    -- Current TLT registration confirms participation, not a calendar-year operation.
  ) pairs cross join lateral unnest(case when activity='TLT' then array[year]
    else array[split_part(year,'-',1),split_part(year,'-',2)] end) calendar_year), '[]'::jsonb) as search_activity_years
from public.pathfinders p left join public.current_data c
  on c.pathfinder_id=p.id and c.school_year=public.current_club_year();
notify pgrst, 'reload schema';
