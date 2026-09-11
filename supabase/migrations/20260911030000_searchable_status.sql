-- Expose the effective status for server-side filtering, including absent registration.
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
    then c.current_activities else '[]'::jsonb end as search_activities
from public.pathfinders p left join public.current_data c
  on c.pathfinder_id=p.id and c.school_year=public.current_club_year();
notify pgrst, 'reload schema';
