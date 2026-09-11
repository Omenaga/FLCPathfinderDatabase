-- Explicit club season; change only when the club is ready to roll over.
create function public.current_club_year() returns text
language sql immutable set search_path = '' as $$ select '2026-2027'::text $$;

create table public.current_data (
  pathfinder_id integer primary key references public.pathfinders(id) on delete cascade,
  school_year text not null check (private.valid_school_years(jsonb_build_array(school_year))),
  status text check (status in ('new', 'returning', 'left', 'graduated')),
  grade smallint check (grade between 1 and 12),
  class_level text check (class_level in ('Friend','Companion','Explorer','Ranger','Voyager','Guide','Pioneer','Navigator')),
  current_activities jsonb not null default '[]' check (private.valid_string_array(current_activities, array['Drill','Drums','PBE','TLT'])),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create function private.touch_current_data() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;
create trigger touch_current_data before update on public.current_data
for each row execute function private.touch_current_data();
revoke all on function private.touch_current_data() from public, anon, authenticated;
alter table public.current_data enable row level security;
revoke all on public.current_data from public, anon, authenticated;
grant select, insert, update on public.current_data to authenticated;
grant all on public.current_data to service_role;
create policy staff_read on public.current_data for select to authenticated
using ((select public.current_staff_role()) = 'editor');
create policy staff_insert on public.current_data for insert to authenticated
with check ((select public.current_staff_role()) = 'editor');
create policy staff_update on public.current_data for update to authenticated
using ((select public.current_staff_role()) = 'editor')
with check ((select public.current_staff_role()) = 'editor');

-- One row per person, including people who have no current registration.
-- Invoker security preserves the underlying tables' RLS rules.
create view public.member_search with (security_invoker = true) as
select p.*,
  c.pathfinder_id is not null as has_current_data,
  c.status, c.grade, c.class_level, c.current_activities,
  p.years_active || case when c.status in ('new','returning')
    then jsonb_build_array(c.school_year) else '[]'::jsonb end as search_years,
  p.extracurriculars || case when c.status in ('new','returning')
    then c.current_activities else '[]'::jsonb end as search_activities
from public.pathfinders p
left join public.current_data c on c.pathfinder_id = p.id
  and c.school_year = public.current_club_year();
revoke all on public.member_search from public, anon, authenticated;
grant select on public.member_search to authenticated, service_role;
notify pgrst, 'reload schema';
