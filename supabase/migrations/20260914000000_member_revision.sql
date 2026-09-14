-- Member roles, compact school-year ranges, and role-specific history.
begin;
-- Preserve the pre-migration values for administrator review; never exposed to clients.
create table private.member_revision_backup (table_name text primary key, records jsonb not null);
revoke all on private.member_revision_backup from public, anon, authenticated;
do $$ declare t text; begin
 foreach t in array array['pathfinders','current_data','drill','drum_corps','pbe','tlt','honors_earned','pbe_year_books','red_zone_drill_performance','red_zone_drum_performance','red_zone_honor_evaluations','red_zone_bible_events','red_zone_knots','red_zone_tents','red_zone_jump_rope','red_zone_archery','red_zone_lashing','red_zone_burning_twine'] loop
 execute format('lock table public.%I in access exclusive mode',t);
 execute format('insert into private.member_revision_backup select %L,coalesce(jsonb_agg(to_jsonb(r)),%L::jsonb) from public.%I r',t,'[]',t);
 end loop;
end $$;
drop view public.member_search;
drop trigger remember_graduation on public.current_data;
drop function private.remember_graduation();
alter table public.pbe disable trigger validate_pbe_history;
alter table public.pbe_year_books disable trigger protect_pbe_catalog;

create function private.compact_period(value text) returns text language sql immutable set search_path='' as $$
 select left(value,4)||'-'||right((left(value,4)::integer+1)::text,2);
$$;
create function private.compact_periods(value jsonb) returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_agg(private.compact_period(y) order by y),'[]'::jsonb) from jsonb_array_elements_text(value) y;
$$;
create or replace function private.valid_school_years(value jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare y text; begin
 if not private.valid_string_array(value) then return false; end if;
 for y in select jsonb_array_elements_text(value) loop
 if y !~ '^[0-9]{4}-[0-9]{2}$' then return false; end if;
 if left(y,4)::integer<1900 or right(y,2)<>right((left(y,4)::integer+1)::text,2) then return false; end if;
 end loop; return true;
end $$;
create or replace function private.valid_levels(value jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare e jsonb; begin
 if value is null or jsonb_typeof(value)<>'array' then return false; end if;
 for e in select jsonb_array_elements(value) loop
 if jsonb_typeof(e)<>'object' then return false; end if;
 if not(e ?& array['name','outcome','year']) or e-array['name','outcome','year']<>'{}'::jsonb then return false; end if;
 if not coalesce(e->>'name'=any(array['Friend','Companion','Explorer','Ranger','Voyager','Guide','Pioneer','Navigator']),false)
 or not coalesce(e->>'outcome'=any(array['basic','advanced','incomplete']),false) then return false; end if;
 if e->'year'<>'null'::jsonb and not private.valid_school_years(jsonb_build_array(e->'year')) then return false; end if;
 end loop;
 return jsonb_array_length(value)=(select count(distinct item) from jsonb_array_elements(value) item);
end $$;

alter table public.pathfinders drop constraint pathfinders_levels_check, drop constraint pathfinders_years_active_check;
alter table public.pathfinders add column first_name text, add column last_name text not null default '',
 add column birth_date date, add column notes text;
-- Names are preserved verbatim until an explicit split is available.
update public.pathfinders set first_name=name;
update public.pathfinders set first_name='Justin',last_name='Wu' where name='Justin Wu';
alter table public.pathfinders alter column first_name set not null;
alter table public.pathfinders add constraint first_name_check check(first_name=btrim(first_name) and length(first_name) between 1 and 200),
 add constraint last_name_check check(last_name=btrim(last_name) and length(last_name)<=200);
update public.pathfinders set years_active=private.compact_periods(years_active), levels=(select coalesce(jsonb_agg(jsonb_build_object('name',e->>'name','outcome',case when (e->>'advanced')::boolean then 'advanced' else 'basic' end,'year',null)),'[]'::jsonb) from jsonb_array_elements(levels) e);
alter table public.pathfinders add check(private.valid_levels(levels)), add check(private.valid_school_years(years_active));
alter table public.pathfinders drop column name, drop column graduated;
create index pathfinders_names_idx on public.pathfinders(last_name,first_name,id);

create table public.staff_titles(title text primary key check(title=btrim(title) and length(title) between 1 and 100));
alter table public.staff_titles enable row level security;
grant select on public.staff_titles to authenticated;
grant all on public.staff_titles to service_role;
create policy staff_read on public.staff_titles for select to authenticated using((select public.current_staff_role())='editor');
alter table public.current_data drop constraint current_data_status_check, drop constraint current_data_class_level_check;
alter table public.current_data rename column class_level to current_title;
alter table public.current_data drop column grade;
update public.current_data set school_year=private.compact_period(school_year),status='not_active',current_title=null;
update public.current_data c set status='staff' from public.pathfinders p where p.id=c.pathfinder_id and p.first_name='Justin' and p.last_name='Wu';
alter table public.current_data alter column status set default 'not_active', alter column status set not null;
alter table public.current_data add constraint current_status_check check(status in ('pathfinder','staff','parent','not_active'));
create function private.validate_current_title() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.current_title is null then return new; end if;
 if new.status='pathfinder' and new.current_title=any(array['Friend','Companion','Explorer','Ranger','Voyager','Guide','Pioneer','Navigator']) then return new; end if;
 if new.status='staff' then
 perform 1 from public.staff_titles where title=new.current_title for share;
 if found then return new; end if;
 end if;
 raise exception 'Title must match the selected status; Parent and Not Active use no title' using errcode='23514';
end $$;
revoke all on function private.validate_current_title() from public,anon,authenticated;
create trigger validate_current_title before insert or update on public.current_data for each row execute function private.validate_current_title();
create or replace function public.current_club_year() returns text language sql immutable set search_path='' as $$ select '2026-27'::text $$;

alter table public.drill drop constraint drill_pkey;
alter table public.drill add column id integer generated always as identity primary key, add column team text check(team in ('Precision','Freestyle','Adult'));
grant usage on sequence public.drill_id_seq to authenticated,service_role;
alter table public.drill add column history_role text not null default 'pathfinder' check(history_role in ('pathfinder','staff'));
alter table public.drum_corps add column history_role text not null default 'pathfinder' check(history_role in ('pathfinder','staff'));
alter table public.pbe add column history_role text not null default 'pathfinder' check(history_role in ('pathfinder','staff'));
alter table public.tlt add column history_role text not null default 'pathfinder' check(history_role in ('pathfinder','staff'));
alter table public.red_zone_drill_performance add column history_role text not null default 'pathfinder' check(history_role in ('pathfinder','staff'));
alter table public.red_zone_drum_performance add column history_role text not null default 'pathfinder' check(history_role in ('pathfinder','staff'));
alter table public.red_zone_honor_evaluations add column history_role text not null default 'pathfinder' check(history_role in ('pathfinder','staff'));
alter table public.red_zone_bible_events add column history_role text not null default 'pathfinder' check(history_role in ('pathfinder','staff'));
alter table public.red_zone_knots add column history_role text not null default 'pathfinder' check(history_role in ('pathfinder','staff'));
alter table public.red_zone_tents add column history_role text not null default 'pathfinder' check(history_role in ('pathfinder','staff'));
alter table public.red_zone_jump_rope add column history_role text not null default 'pathfinder' check(history_role in ('pathfinder','staff'));
alter table public.red_zone_archery add column history_role text not null default 'pathfinder' check(history_role in ('pathfinder','staff'));
alter table public.red_zone_lashing add column history_role text not null default 'pathfinder' check(history_role in ('pathfinder','staff'));
alter table public.red_zone_burning_twine add column history_role text not null default 'pathfinder' check(history_role in ('pathfinder','staff'));

create unique index drill_member_team_role_key on public.drill(pathfinder_id,team,history_role) nulls not distinct;
alter table public.pbe drop constraint pbe_pathfinder_id_key;
alter table public.pbe add unique(pathfinder_id,history_role);
alter table public.tlt drop constraint tlt_pathfinder_id_key;
alter table public.tlt add unique(pathfinder_id,history_role);
-- Replace detail uniqueness with role-aware keys; preserve primary and foreign keys.
do $$ declare r record; begin
 for r in select conrelid::regclass as tbl,conname from pg_constraint where contype='u'
 and conrelid in ('public.drum_corps'::regclass,'public.red_zone_drill_performance'::regclass,'public.red_zone_drum_performance'::regclass,'public.red_zone_honor_evaluations'::regclass,'public.red_zone_bible_events'::regclass,'public.red_zone_knots'::regclass,'public.red_zone_tents'::regclass,'public.red_zone_jump_rope'::regclass,'public.red_zone_archery'::regclass,'public.red_zone_lashing'::regclass,'public.red_zone_burning_twine'::regclass) loop execute format('alter table %s drop constraint %I',r.tbl,r.conname); end loop; end $$;
alter table public.drum_corps add unique(pathfinder_id,drum_played,history_role);
alter table public.red_zone_drill_performance drop constraint red_zone_drill_performance_year_check;
alter table public.red_zone_drill_performance alter column year type text using private.compact_period((year-1)::text);
alter table public.red_zone_drill_performance add check(private.valid_school_years(jsonb_build_array(year)));
alter table public.red_zone_drill_performance add unique(pathfinder_id,year,history_role);
alter table public.red_zone_drum_performance drop constraint red_zone_drum_performance_year_check;
alter table public.red_zone_drum_performance alter column year type text using private.compact_period((year-1)::text);
alter table public.red_zone_drum_performance add check(private.valid_school_years(jsonb_build_array(year)));
alter table public.red_zone_drum_performance add unique(pathfinder_id,year,history_role);
alter table public.red_zone_honor_evaluations drop constraint red_zone_honor_evaluations_year_check;
alter table public.red_zone_honor_evaluations alter column year type text using private.compact_period((year-1)::text);
alter table public.red_zone_honor_evaluations add check(private.valid_school_years(jsonb_build_array(year)));
alter table public.red_zone_honor_evaluations add unique(pathfinder_id,year,name,history_role);
alter table public.red_zone_bible_events drop constraint red_zone_bible_events_year_check;
alter table public.red_zone_bible_events alter column year type text using private.compact_period((year-1)::text);
alter table public.red_zone_bible_events add check(private.valid_school_years(jsonb_build_array(year)));
alter table public.red_zone_bible_events add unique(pathfinder_id,year,name,history_role);
alter table public.red_zone_knots drop constraint red_zone_knots_year_check;
alter table public.red_zone_knots alter column year type text using private.compact_period((year-1)::text);
alter table public.red_zone_knots add check(private.valid_school_years(jsonb_build_array(year)));
alter table public.red_zone_knots add unique(pathfinder_id,year,history_role);
alter table public.red_zone_tents drop constraint red_zone_tents_year_check;
alter table public.red_zone_tents alter column year type text using private.compact_period((year-1)::text);
alter table public.red_zone_tents add check(private.valid_school_years(jsonb_build_array(year)));
alter table public.red_zone_tents add unique(pathfinder_id,year,history_role);
alter table public.red_zone_jump_rope drop constraint red_zone_jump_rope_year_check;
alter table public.red_zone_jump_rope alter column year type text using private.compact_period((year-1)::text);
alter table public.red_zone_jump_rope add check(private.valid_school_years(jsonb_build_array(year)));
alter table public.red_zone_jump_rope add unique(pathfinder_id,year,history_role);
alter table public.red_zone_archery drop constraint red_zone_archery_year_check;
alter table public.red_zone_archery alter column year type text using private.compact_period((year-1)::text);
alter table public.red_zone_archery add check(private.valid_school_years(jsonb_build_array(year)));
alter table public.red_zone_archery add unique(pathfinder_id,year,history_role);
alter table public.red_zone_lashing drop constraint red_zone_lashing_year_check;
alter table public.red_zone_lashing alter column year type text using private.compact_period((year-1)::text);
alter table public.red_zone_lashing add check(private.valid_school_years(jsonb_build_array(year)));
alter table public.red_zone_lashing add unique(pathfinder_id,year,history_role);
alter table public.red_zone_burning_twine drop constraint red_zone_burning_twine_year_check;
alter table public.red_zone_burning_twine alter column year type text using private.compact_period((year-1)::text);
alter table public.red_zone_burning_twine add check(private.valid_school_years(jsonb_build_array(year)));
alter table public.red_zone_burning_twine add unique(pathfinder_id,year,history_role);
alter table public.honors_earned drop constraint honors_earned_year_earned_check;
alter table public.honors_earned alter column year_earned type text using private.compact_period((year_earned-1)::text);
alter table public.honors_earned add check(private.valid_school_years(jsonb_build_array(year_earned)));
alter table public.honors_earned add column history_role text not null default 'pathfinder' check(history_role in ('pathfinder','staff'));
alter table public.honors_earned drop constraint honors_earned_pathfinder_id_honor_id_year_earned_key;
alter table public.honors_earned add unique(pathfinder_id,honor_id,year_earned,history_role);
update public.drill set years=private.compact_periods(years);
update public.drum_corps set years=private.compact_periods(years);
update public.pbe_year_books set school_year=private.compact_period(school_year);
update public.pbe set history=(select jsonb_agg(e||jsonb_build_object('year',private.compact_period(e->>'year'))) from jsonb_array_elements(history) e);
create or replace function private.valid_tlt_history(value jsonb) returns boolean
language plpgsql stable set search_path = '' as $$
declare entry jsonb; y integer; seen integer[] := array[]::integer[];
begin
 if value is null or jsonb_typeof(value)<>'array' or value='[]'::jsonb then return false; end if;
 for entry in select jsonb_array_elements(value) loop
   if jsonb_typeof(entry)<>'object' then return false; end if;
   if not (entry ?& array['year','operations']) or entry - array['year','operations'] <> '{}'::jsonb then return false; end if;
   if jsonb_typeof(entry->'year')<>'string' or jsonb_typeof(entry->'operations')<>'array' then return false; end if;
   if not private.valid_school_years(jsonb_build_array(entry->'year')) then return false; end if;
   y := left(entry->>'year',4)::integer;
   if y<2016 or y>extract(year from current_date)::integer or y=any(seen) then return false; end if;
   if not private.valid_string_array(entry->'operations',array['Administrative','Outreach','Teaching','Activity','Records','Counseling']) then return false; end if;
   seen := array_append(seen,y);
 end loop;
 return true;
end;
$$;
revoke all on function private.valid_tlt_history(jsonb) from public, anon;
grant execute on function private.valid_tlt_history(jsonb) to authenticated, service_role;

update public.tlt set history=(select jsonb_agg(e||jsonb_build_object('year',private.compact_period(((e->>'year')::integer-1)::text))) from jsonb_array_elements(history) e);
alter table public.pbe enable trigger validate_pbe_history;
alter table public.pbe_year_books enable trigger protect_pbe_catalog;
create table public.staff_history (
 id integer generated always as identity primary key,
 pathfinder_id integer not null references public.pathfinders(id) on delete cascade,
 years jsonb not null check(private.valid_school_years(years) and years<>'[]'::jsonb),
 title text references public.staff_titles(title) on update cascade on delete restrict
);
create unique index staff_history_member_title_key on public.staff_history(pathfinder_id,title) nulls not distinct;
alter table public.staff_history enable row level security;
grant select,insert,update on public.staff_history to authenticated;
grant all on public.staff_history to service_role;
grant usage on sequence public.staff_history_id_seq to authenticated,service_role;
create policy staff_read on public.staff_history for select to authenticated using((select public.current_staff_role())='editor');
create policy staff_insert on public.staff_history for insert to authenticated with check((select public.current_staff_role())='editor');
create policy staff_update on public.staff_history for update to authenticated using((select public.current_staff_role())='editor') with check((select public.current_staff_role())='editor');
-- Prevent catalog changes from invalidating current titles.
create function private.protect_staff_title() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.title=old.title then return new; end if;
 if exists(select 1 from public.current_data where status='staff' and current_title=old.title) then raise exception 'Title is in use' using errcode='23503'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
revoke all on function private.protect_staff_title() from public,anon,authenticated;
create trigger protect_staff_title before update or delete on public.staff_titles for each row execute function private.protect_staff_title();
revoke all on function private.compact_period(text),private.compact_periods(jsonb) from public,anon,authenticated;
create view public.member_search with (security_invoker = true) as
select p.id,p.first_name,p.last_name,concat_ws(' ',p.first_name,nullif(p.last_name,'')) as name,p.years_active,p.levels,p.created_at,p.updated_at,
  c.pathfinder_id is not null as has_current_data,
  coalesce(c.status,'not_active') as status,
  c.current_title,c.current_activities,
  p.years_active || coalesce((select jsonb_agg(distinct y) from public.staff_history h cross join lateral jsonb_array_elements(h.years) y where h.pathfinder_id=p.id),'[]'::jsonb) || case when c.status in ('pathfinder','staff') then jsonb_build_array(c.school_year) else '[]'::jsonb end as search_years,
  coalesce((select jsonb_agg(distinct split_part(value,' (',1)) from jsonb_array_elements_text(activity_pairs.years)), '[]'::jsonb) as search_activities,
  activity_pairs.years as search_activity_years,
  event_pairs.years as search_event_years,
  coalesce((select jsonb_agg(distinct split_part(value,' (',1)) from jsonb_array_elements_text(event_pairs.years)), '[]'::jsonb) as search_events,
  coalesce((select jsonb_agg(distinct jsonb_build_object('name',name,'year',year,'detail',detail)) from (
    select 'Drill'::text as name, calendar_year::integer as year, d.team as detail from public.drill d cross join lateral jsonb_array_elements_text(d.years) y cross join lateral unnest(array[left(y,4),(left(y,4)::integer+1)::text]) calendar_year where d.pathfinder_id=p.id and d.team is not null
    union all
    select 'Drums'::text as name, calendar_year::integer as year, d.drum_played as detail
    from public.drum_corps d cross join lateral jsonb_array_elements_text(d.years) y
    cross join lateral unnest(array[split_part(y,'-',1),(left(y,4)::integer+1)::text]) calendar_year where d.pathfinder_id=p.id
    union all
    select 'TLT', calendar_year::integer, operation
    from public.tlt t cross join lateral jsonb_array_elements(t.history) entry
    cross join lateral jsonb_array_elements_text(entry->'operations') operation cross join lateral unnest(array[left(entry->>'year',4),(left(entry->>'year',4)::integer+1)::text]) calendar_year where t.pathfinder_id=p.id
  ) records), '[]'::jsonb) as search_activity_details,
  coalesce((select jsonb_agg(distinct jsonb_build_object('name',name,'year',year,'detail',placement)) from (
    select 'Drill Performance'::text as name, calendar_year::integer as year, placement from public.red_zone_drill_performance cross join lateral unnest(array[left(year,4),(left(year,4)::integer+1)::text]) calendar_year where pathfinder_id=p.id
    union all
    select 'Drum Performance'::text as name, calendar_year::integer as year, placement from public.red_zone_drum_performance cross join lateral unnest(array[left(year,4),(left(year,4)::integer+1)::text]) calendar_year where pathfinder_id=p.id
    union all
    select 'Honor Evaluations'::text as name, calendar_year::integer as year, placement from public.red_zone_honor_evaluations cross join lateral unnest(array[left(year,4),(left(year,4)::integer+1)::text]) calendar_year where pathfinder_id=p.id
    union all
    select 'Bible Events'::text as name, calendar_year::integer as year, placement from public.red_zone_bible_events cross join lateral unnest(array[left(year,4),(left(year,4)::integer+1)::text]) calendar_year where pathfinder_id=p.id
    union all
    select 'Knots Relay'::text as name, calendar_year::integer as year, placement from public.red_zone_knots cross join lateral unnest(array[left(year,4),(left(year,4)::integer+1)::text]) calendar_year where pathfinder_id=p.id
    union all
    select 'Tents'::text as name, calendar_year::integer as year, placement from public.red_zone_tents cross join lateral unnest(array[left(year,4),(left(year,4)::integer+1)::text]) calendar_year where pathfinder_id=p.id
    union all
    select 'Jump Rope'::text as name, calendar_year::integer as year, placement from public.red_zone_jump_rope cross join lateral unnest(array[left(year,4),(left(year,4)::integer+1)::text]) calendar_year where pathfinder_id=p.id
    union all
    select 'Archery'::text as name, calendar_year::integer as year, placement from public.red_zone_archery cross join lateral unnest(array[left(year,4),(left(year,4)::integer+1)::text]) calendar_year where pathfinder_id=p.id
    union all
    select 'Lashing'::text as name, calendar_year::integer as year, placement from public.red_zone_lashing cross join lateral unnest(array[left(year,4),(left(year,4)::integer+1)::text]) calendar_year where pathfinder_id=p.id
    union all
    select 'Burning Twine'::text as name, calendar_year::integer as year, placement from public.red_zone_burning_twine cross join lateral unnest(array[left(year,4),(left(year,4)::integer+1)::text]) calendar_year where pathfinder_id=p.id
  ) records), '[]'::jsonb) as search_event_details
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
  ) pairs cross join lateral unnest(array[left(year,4),(left(year,4)::integer+1)::text]) calendar_year), '[]'::jsonb) as years) activity_pairs
cross join lateral (select
  coalesce((select jsonb_agg(distinct event || ' (' || year || ')') from (
    select 'Drill Performance'::text as event, calendar_year as year from public.red_zone_drill_performance e cross join lateral unnest(array[left(e.year,4),(left(e.year,4)::integer+1)::text]) calendar_year where e.pathfinder_id=p.id
    union all
    select 'Drum Performance'::text as event, calendar_year as year from public.red_zone_drum_performance e cross join lateral unnest(array[left(e.year,4),(left(e.year,4)::integer+1)::text]) calendar_year where e.pathfinder_id=p.id
    union all
    select 'Honor Evaluations'::text as event, calendar_year as year from public.red_zone_honor_evaluations e cross join lateral unnest(array[left(e.year,4),(left(e.year,4)::integer+1)::text]) calendar_year where e.pathfinder_id=p.id
    union all
    select 'Bible Events'::text as event, calendar_year as year from public.red_zone_bible_events e cross join lateral unnest(array[left(e.year,4),(left(e.year,4)::integer+1)::text]) calendar_year where e.pathfinder_id=p.id
    union all
    select 'Knots Relay'::text as event, calendar_year as year from public.red_zone_knots e cross join lateral unnest(array[left(e.year,4),(left(e.year,4)::integer+1)::text]) calendar_year where e.pathfinder_id=p.id
    union all
    select 'Tents'::text as event, calendar_year as year from public.red_zone_tents e cross join lateral unnest(array[left(e.year,4),(left(e.year,4)::integer+1)::text]) calendar_year where e.pathfinder_id=p.id
    union all
    select 'Jump Rope'::text as event, calendar_year as year from public.red_zone_jump_rope e cross join lateral unnest(array[left(e.year,4),(left(e.year,4)::integer+1)::text]) calendar_year where e.pathfinder_id=p.id
    union all
    select 'Archery'::text as event, calendar_year as year from public.red_zone_archery e cross join lateral unnest(array[left(e.year,4),(left(e.year,4)::integer+1)::text]) calendar_year where e.pathfinder_id=p.id
    union all
    select 'Lashing'::text as event, calendar_year as year from public.red_zone_lashing e cross join lateral unnest(array[left(e.year,4),(left(e.year,4)::integer+1)::text]) calendar_year where e.pathfinder_id=p.id
    union all
    select 'Burning Twine'::text as event, calendar_year as year from public.red_zone_burning_twine e cross join lateral unnest(array[left(e.year,4),(left(e.year,4)::integer+1)::text]) calendar_year where e.pathfinder_id=p.id
  ) pairs), '[]'::jsonb) as years) event_pairs;
grant select on public.member_search to authenticated;
grant select on public.member_search to authenticated,service_role;
notify pgrst, 'reload schema';
commit;
