-- Link staff titles and drum instruments to periods in one history column.
begin;
lock table public.staff_history, public.drum_corps, public.staff_titles in access exclusive mode;
insert into public.staff_titles(title) values
 ('Club Director'),
 ('Friend Counselor'),
 ('Companion Counselor'),
 ('Explorer Counselor'),
 ('Ranger Counselor'),
 ('Voyager Counselor'),
 ('Guide Counselor'),
 ('Pioneer Counselor'),
 ('Navigator Counselor'),
 ('Master Guide Leader'),
 ('PBE Leader'),
 ('Drum Corps Leader'),
 ('Drill Leader'),
 ('TLT Leader'),
 ('PBE Instructor'),
 ('Drum Instructor'),
 ('Drill Instructor'),
 ('TLT Instructor'),
 ('Associate Director'),
 ('Treasurer'),
 ('Administrative Assistant'),
 ('Equipment'),
 ('Trailer'),
 ('Camping'),
 ('IT'),
 ('Audio/Visual'),
 ('Medical'),
 ('Security'),
 ('Social Media'),
 ('Photography'),
 ('Junior Staff'),
 ('Master Guide')
on conflict(title) do nothing;
-- Keep every original row before consolidating IDs into one row per member/role.
create table private.staff_drum_history_backup as
select 'staff_history'::text as source_table, to_jsonb(h) as record from public.staff_history h
union all select 'drum_corps', to_jsonb(d) from public.drum_corps d;
revoke all on private.staff_drum_history_backup from public, anon, authenticated;
drop view public.member_search;

create function private.valid_period_details(value jsonb, detail_key text, allowed text[]) returns boolean
language plpgsql immutable set search_path='' as $$
declare entry jsonb; seen text[] := array[]::text[];
begin
 if value is null or jsonb_typeof(value)<>'array' or value='[]'::jsonb then return false; end if;
 for entry in select jsonb_array_elements(value) loop
  if jsonb_typeof(entry)<>'object' then return false; end if;
  if not (entry ?& array['year',detail_key]) or entry-array['year',detail_key]<>'{}'::jsonb then return false; end if;
  if jsonb_typeof(entry->'year')<>'string' or jsonb_typeof(entry->detail_key)<>'array' then return false; end if;
  if not private.valid_school_years(jsonb_build_array(entry->'year')) or entry->>'year'=any(seen) then return false; end if;
  if not private.valid_string_array(entry->detail_key,allowed) then return false; end if;
  seen := array_append(seen,entry->>'year');
 end loop;
 return true;
end $$;
revoke all on function private.valid_period_details(jsonb,text,text[]) from public,anon;
grant execute on function private.valid_period_details(jsonb,text,text[]) to authenticated,service_role;

alter table public.staff_history add column history jsonb;
with periods as (
 select pathfinder_id, y, coalesce(jsonb_agg(distinct title order by title) filter(where title is not null),'[]'::jsonb) as titles
 from public.staff_history cross join lateral jsonb_array_elements_text(years) y group by pathfinder_id,y
), histories as (
 select pathfinder_id,jsonb_agg(jsonb_build_object('year',y,'titles',titles) order by y) as history from periods group by pathfinder_id
)
update public.staff_history h set history=s.history from histories s where h.pathfinder_id=s.pathfinder_id;
delete from public.staff_history h using public.staff_history keep where h.pathfinder_id=keep.pathfinder_id and h.id>keep.id;
alter table public.staff_history drop column years, drop column title;
alter table public.staff_history alter column history set not null;
alter table public.staff_history add unique(pathfinder_id);

create function private.validate_staff_history() returns trigger
language plpgsql security definer set search_path='' as $$
declare allowed text[];
begin
 -- Lock catalog rows against concurrent removal while validating references.
 perform title from public.staff_titles order by title for share;
 select coalesce(array_agg(title),array[]::text[]) into allowed from public.staff_titles;
 if not private.valid_period_details(new.history,'titles',allowed) then
  raise exception 'Staff history requires unique periods and valid title arrays' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function private.validate_staff_history() from public,anon,authenticated;
create trigger validate_staff_history before insert or update on public.staff_history for each row execute function private.validate_staff_history();
-- Validate migrated rows too.
update public.staff_history set history=history;
create or replace function private.protect_staff_title() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.title=old.title then return new; end if;
 if exists(select 1 from public.current_data where status='staff' and current_title=old.title)
 or exists(select 1 from public.staff_history h cross join lateral jsonb_array_elements(h.history) e where e->'titles' ? old.title) then
  raise exception 'Title is in use' using errcode='23503';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;

alter table public.drum_corps add column history jsonb;
with periods as (
 select pathfinder_id,history_role,y,jsonb_agg(distinct drum_played order by drum_played) as drums
 from public.drum_corps cross join lateral jsonb_array_elements_text(years) y group by pathfinder_id,history_role,y
), histories as (
 select pathfinder_id,history_role,jsonb_agg(jsonb_build_object('year',y,'drums',drums) order by y) as history from periods group by pathfinder_id,history_role
)
update public.drum_corps d set history=h.history from histories h where d.pathfinder_id=h.pathfinder_id and d.history_role=h.history_role;
delete from public.drum_corps d using public.drum_corps keep where d.pathfinder_id=keep.pathfinder_id and d.history_role=keep.history_role and d.id>keep.id;
alter table public.drum_corps drop column years, drop column drum_played;
alter table public.drum_corps alter column history set not null;
alter table public.drum_corps add unique(pathfinder_id,history_role);
alter table public.drum_corps add constraint drum_history_check check(private.valid_period_details(history,'drums',array['Snare','Quad','Bass','Tenor','Cymbol']));

create or replace view public.member_search with (security_invoker = true) as
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
grant select on public.member_search to authenticated;
grant select on public.member_search to authenticated,service_role;
notify pgrst, 'reload schema';
commit;
