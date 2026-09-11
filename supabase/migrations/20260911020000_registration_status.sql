-- Graduation is a lasting member attribute, independent of annual registration.
alter table public.pathfinders add column graduated boolean not null default false;
update public.pathfinders p set graduated = true
where exists (select 1 from public.current_data c where c.pathfinder_id = p.id and c.status = 'graduated');
-- Do not silently discard legacy records if this migration is used elsewhere.
do $$ begin
  if exists (select 1 from public.current_data where status = 'left') then
    raise exception 'Archive and remove legacy Left current-data rows before applying this migration';
  end if;
end $$;
alter table public.current_data drop constraint current_data_status_check;
alter table public.current_data add constraint current_data_status_check
check (status in ('new','returning','graduated'));
create function private.remember_graduation() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'graduated' then
    update public.pathfinders set graduated = true where id = new.pathfinder_id;
  end if;
  return new;
end;
$$;
create trigger remember_graduation after insert or update on public.current_data
for each row execute function private.remember_graduation();
revoke all on function private.remember_graduation() from public, anon, authenticated;
create or replace view public.member_search with (security_invoker = true) as
select p.id,p.name,p.years_active,p.levels,p.extracurriculars,p.red_zone_participation,p.created_at,p.updated_at,
  c.pathfinder_id is not null as has_current_data,
  case when p.graduated then 'graduated'::text else c.status end as status,
  c.grade,c.class_level,c.current_activities,
  p.years_active || case when not p.graduated and c.status in ('new','returning')
    then jsonb_build_array(c.school_year) else '[]'::jsonb end as search_years,
  p.extracurriculars || case when not p.graduated and c.status in ('new','returning')
    then c.current_activities else '[]'::jsonb end as search_activities
from public.pathfinders p left join public.current_data c
  on c.pathfinder_id=p.id and c.school_year=public.current_club_year();
notify pgrst, 'reload schema';
