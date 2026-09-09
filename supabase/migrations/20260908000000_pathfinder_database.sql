-- Member records are private. Provision staff through the SQL editor, not the browser.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create table private.staff_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('viewer', 'editor')),
  created_at timestamptz not null default now()
);
alter table private.staff_access enable row level security;
revoke all on private.staff_access from public, anon, authenticated;

create function public.current_staff_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from private.staff_access where user_id = (select auth.uid());
$$;
revoke all on function public.current_staff_role() from public, anon;
grant execute on function public.current_staff_role() to authenticated;

create function private.valid_string_array(value jsonb, options text[] default null)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if value is null or jsonb_typeof(value) <> 'array' then return false; end if;
  return not exists (
    select 1 from jsonb_array_elements(value) e
    where jsonb_typeof(e) <> 'string' or btrim(e #>> '{}') = ''
      or (options is not null and not ((e #>> '{}') = any(options)))
  ) and jsonb_array_length(value) = (select count(distinct e) from jsonb_array_elements(value) e);
end;
$$;

create function private.valid_school_years(value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare y text;
begin
  if not private.valid_string_array(value) then return false; end if;
  for y in select jsonb_array_elements_text(value) loop
    if y !~ '^[0-9]{4}-[0-9]{4}$' then return false; end if;
    if left(y, 4)::integer < 1900 or right(y, 4)::integer <> left(y, 4)::integer + 1 then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create function private.valid_levels(value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item jsonb;
begin
  if value is null or jsonb_typeof(value) <> 'array' then return false; end if;
  for item in select jsonb_array_elements(value) loop
    if jsonb_typeof(item) <> 'object' then return false; end if;
    if not (item ?& array['name', 'advanced']) or item - 'name' - 'advanced' <> '{}'::jsonb then return false; end if;
    if jsonb_typeof(item->'advanced') <> 'boolean' or jsonb_typeof(item->'name') <> 'string'
      or not (item->>'name' = any(array['Friend','Companion','Explorer','Ranger','Voyager','Guide','Pioneer','Navigator'])) then
      return false;
    end if;
  end loop;
  return jsonb_array_length(value) = (select count(distinct e->>'name') from jsonb_array_elements(value) e);
end;
$$;

create table public.pathfinders (
  id integer generated always as identity primary key,
  name text not null check (name = btrim(name) and length(name) between 1 and 200),
  years_active jsonb not null default '[]' check (private.valid_school_years(years_active)),
  levels jsonb not null default '[]' check (private.valid_levels(levels)),
  extracurriculars jsonb not null default '[]' check (private.valid_string_array(extracurriculars, array['Drill','Drums','PBE','TLT'])),
  red_zone_participation jsonb not null default '[]' check (private.valid_string_array(red_zone_participation, array['Drill Performance','Drum Performance','Honor Evaluations','Bible Events','Knots Relay','Tents','Jump Rope','Archery','Lashing','Burning Twine'])),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pathfinders_name_id_idx on public.pathfinders (name, id);
create index pathfinders_years_idx on public.pathfinders using gin (years_active);
create index pathfinders_levels_idx on public.pathfinders using gin (levels);
create index pathfinders_extracurriculars_idx on public.pathfinders using gin (extracurriculars);
create index pathfinders_red_zone_idx on public.pathfinders using gin (red_zone_participation);

create table public.honors (
  id integer generated always as identity primary key,
  name text not null unique check (name = btrim(name) and length(name) between 1 and 200)
);
create table public.honors_earned (
  id integer generated always as identity primary key,
  pathfinder_id integer not null references public.pathfinders(id) on delete cascade,
  honor_id integer not null references public.honors(id) on delete restrict,
  year_earned integer not null check (year_earned between 1900 and 9999),
  unique (pathfinder_id, honor_id, year_earned)
);
create index honors_earned_honor_idx on public.honors_earned(honor_id);

create table public.drill (
  pathfinder_id integer primary key references public.pathfinders(id) on delete cascade,
  years jsonb not null check (private.valid_school_years(years) and years <> '[]'::jsonb)
);
create table public.drum_corps (
  id integer generated always as identity primary key,
  pathfinder_id integer not null references public.pathfinders(id) on delete cascade,
  years jsonb not null check (private.valid_school_years(years) and years <> '[]'::jsonb),
  drum_played text not null check (drum_played in ('Snare','Quad','Bass','Tenor','Cymbol')),
  unique (pathfinder_id, drum_played)
);
create table public.pbe (
  id integer generated always as identity primary key,
  pathfinder_id integer not null references public.pathfinders(id) on delete cascade,
  years jsonb not null check (private.valid_school_years(years) and years <> '[]'::jsonb),
  bible_book text not null check (bible_book = btrim(bible_book) and length(bible_book) between 1 and 100),
  unique (pathfinder_id, bible_book)
);
create table public.tlt (
  id integer generated always as identity primary key,
  pathfinder_id integer not null references public.pathfinders(id) on delete cascade,
  years jsonb not null check (private.valid_school_years(years) and years <> '[]'::jsonb),
  tlt_operation text not null check (tlt_operation in ('Administrative','Outreach','Teaching','Activity','Records','Counseling')),
  unique (pathfinder_id, tlt_operation)
);

create table public.red_zone_drill_performance (
  id integer generated always as identity primary key,
  pathfinder_id integer not null references public.pathfinders(id) on delete cascade,
  year integer not null check (year between 1900 and 9999),
  placement text not null check (placement in ('1st Place','2nd Place','3rd Place','Participation')),
  unique (pathfinder_id, year)
);
create table public.red_zone_drum_performance (
  id integer generated always as identity primary key,
  pathfinder_id integer not null references public.pathfinders(id) on delete cascade,
  year integer not null check (year between 1900 and 9999),
  placement text not null check (placement in ('1st Place','2nd Place','3rd Place','Participation')),
  unique (pathfinder_id, year)
);
create table public.red_zone_honor_evaluations (
  id integer generated always as identity primary key,
  pathfinder_id integer not null references public.pathfinders(id) on delete cascade,
  year integer not null check (year between 1900 and 9999),
  name text not null check (name = btrim(name) and length(name) between 1 and 200),
  placement text not null check (placement in ('1st Place','2nd Place','3rd Place','Participation')),
  unique (pathfinder_id, year, name)
);
create table public.red_zone_bible_events (
  id integer generated always as identity primary key,
  pathfinder_id integer not null references public.pathfinders(id) on delete cascade,
  year integer not null check (year between 1900 and 9999),
  name text not null check (name = btrim(name) and length(name) between 1 and 200),
  placement text not null check (placement in ('1st Place','2nd Place','3rd Place','Participation')),
  unique (pathfinder_id, year, name)
);
create table public.red_zone_knots (
  id integer generated always as identity primary key,
  pathfinder_id integer not null references public.pathfinders(id) on delete cascade,
  year integer not null check (year between 1900 and 9999),
  placement text not null check (placement in ('1st Place','2nd Place','3rd Place','Participation')),
  unique (pathfinder_id, year)
);
create table public.red_zone_tents (
  id integer generated always as identity primary key,
  pathfinder_id integer not null references public.pathfinders(id) on delete cascade,
  year integer not null check (year between 1900 and 9999),
  placement text not null check (placement in ('1st Place','2nd Place','3rd Place','Participation')),
  unique (pathfinder_id, year)
);
create table public.red_zone_jump_rope (
  id integer generated always as identity primary key,
  pathfinder_id integer not null references public.pathfinders(id) on delete cascade,
  year integer not null check (year between 1900 and 9999),
  placement text not null check (placement in ('1st Place','2nd Place','3rd Place','Participation')),
  unique (pathfinder_id, year)
);
create table public.red_zone_archery (
  id integer generated always as identity primary key,
  pathfinder_id integer not null references public.pathfinders(id) on delete cascade,
  year integer not null check (year between 1900 and 9999),
  placement text not null check (placement in ('1st Place','2nd Place','3rd Place','Participation')),
  unique (pathfinder_id, year)
);
create table public.red_zone_lashing (
  id integer generated always as identity primary key,
  pathfinder_id integer not null references public.pathfinders(id) on delete cascade,
  year integer not null check (year between 1900 and 9999),
  placement text not null check (placement in ('1st Place','2nd Place','3rd Place','Participation')),
  unique (pathfinder_id, year)
);
create table public.red_zone_burning_twine (
  id integer generated always as identity primary key,
  pathfinder_id integer not null references public.pathfinders(id) on delete cascade,
  year integer not null check (year between 1900 and 9999),
  placement text not null check (placement in ('1st Place','2nd Place','3rd Place','Participation')),
  unique (pathfinder_id, year)
);

-- Lock the member before validating a child write so concurrent edits serialize.
create function private.check_participation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare member public.pathfinders;
begin
  select * into member from public.pathfinders where id = new.pathfinder_id for update;
  if not found then raise exception 'Pathfinder does not exist' using errcode = '23503'; end if;
  if not ((to_jsonb(member)->tg_argv[0]) ? tg_argv[1]) then
    raise exception 'Add % to the member participation array before saving details', tg_argv[1] using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Reject removal of an activity/event while its detail records still exist.
create function private.check_member_participation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare mapping record; has_details boolean;
begin
  for mapping in select * from (values
    ('drill', 'extracurriculars', 'Drill'),
    ('drum_corps', 'extracurriculars', 'Drums'),
    ('pbe', 'extracurriculars', 'PBE'),
    ('tlt', 'extracurriculars', 'TLT'),
    ('red_zone_drill_performance', 'red_zone_participation', 'Drill Performance'),
    ('red_zone_drum_performance', 'red_zone_participation', 'Drum Performance'),
    ('red_zone_honor_evaluations', 'red_zone_participation', 'Honor Evaluations'),
    ('red_zone_bible_events', 'red_zone_participation', 'Bible Events'),
    ('red_zone_knots', 'red_zone_participation', 'Knots Relay'),
    ('red_zone_tents', 'red_zone_participation', 'Tents'),
    ('red_zone_jump_rope', 'red_zone_participation', 'Jump Rope'),
    ('red_zone_archery', 'red_zone_participation', 'Archery'),
    ('red_zone_lashing', 'red_zone_participation', 'Lashing'),
    ('red_zone_burning_twine', 'red_zone_participation', 'Burning Twine')
  ) as m(table_name, column_name, activity) loop
    if not ((to_jsonb(new)->mapping.column_name) ? mapping.activity) then
      execute format('select exists (select 1 from public.%I where pathfinder_id = $1)', mapping.table_name)
        into has_details using new.id;
      if has_details then
        raise exception 'Remove % detail records before removing participation', mapping.activity using errcode = '23514';
      end if;
    end if;
  end loop;
  new.updated_at := now();
  return new;
end;
$$;
create trigger check_member_participation before update on public.pathfinders
for each row execute function private.check_member_participation();
create trigger check_participation before insert or update on public.drill
for each row execute function private.check_participation('extracurriculars', 'Drill');
create trigger check_participation before insert or update on public.drum_corps
for each row execute function private.check_participation('extracurriculars', 'Drums');
create trigger check_participation before insert or update on public.pbe
for each row execute function private.check_participation('extracurriculars', 'PBE');
create trigger check_participation before insert or update on public.tlt
for each row execute function private.check_participation('extracurriculars', 'TLT');
create trigger check_participation before insert or update on public.red_zone_drill_performance
for each row execute function private.check_participation('red_zone_participation', 'Drill Performance');
create trigger check_participation before insert or update on public.red_zone_drum_performance
for each row execute function private.check_participation('red_zone_participation', 'Drum Performance');
create trigger check_participation before insert or update on public.red_zone_honor_evaluations
for each row execute function private.check_participation('red_zone_participation', 'Honor Evaluations');
create trigger check_participation before insert or update on public.red_zone_bible_events
for each row execute function private.check_participation('red_zone_participation', 'Bible Events');
create trigger check_participation before insert or update on public.red_zone_knots
for each row execute function private.check_participation('red_zone_participation', 'Knots Relay');
create trigger check_participation before insert or update on public.red_zone_tents
for each row execute function private.check_participation('red_zone_participation', 'Tents');
create trigger check_participation before insert or update on public.red_zone_jump_rope
for each row execute function private.check_participation('red_zone_participation', 'Jump Rope');
create trigger check_participation before insert or update on public.red_zone_archery
for each row execute function private.check_participation('red_zone_participation', 'Archery');
create trigger check_participation before insert or update on public.red_zone_lashing
for each row execute function private.check_participation('red_zone_participation', 'Lashing');
create trigger check_participation before insert or update on public.red_zone_burning_twine
for each row execute function private.check_participation('red_zone_participation', 'Burning Twine');

-- Viewer: read. Editor: read, insert, update. Deletion is reserved for database administrators.
alter table public.pathfinders enable row level security;
revoke all on public.pathfinders from public, anon, authenticated;
grant select, insert, update on public.pathfinders to authenticated;
grant all on public.pathfinders to service_role;
create policy staff_read on public.pathfinders for select to authenticated
  using ((select public.current_staff_role()) in ('viewer','editor'));
create policy editor_insert on public.pathfinders for insert to authenticated
  with check ((select public.current_staff_role()) = 'editor');
create policy editor_update on public.pathfinders for update to authenticated
  using ((select public.current_staff_role()) = 'editor')
  with check ((select public.current_staff_role()) = 'editor');
revoke all on sequence public.pathfinders_id_seq from public, anon, authenticated;
grant usage on sequence public.pathfinders_id_seq to authenticated, service_role;
alter table public.honors enable row level security;
revoke all on public.honors from public, anon, authenticated;
grant select, insert, update on public.honors to authenticated;
grant all on public.honors to service_role;
create policy staff_read on public.honors for select to authenticated
  using ((select public.current_staff_role()) in ('viewer','editor'));
create policy editor_insert on public.honors for insert to authenticated
  with check ((select public.current_staff_role()) = 'editor');
create policy editor_update on public.honors for update to authenticated
  using ((select public.current_staff_role()) = 'editor')
  with check ((select public.current_staff_role()) = 'editor');
revoke all on sequence public.honors_id_seq from public, anon, authenticated;
grant usage on sequence public.honors_id_seq to authenticated, service_role;
alter table public.honors_earned enable row level security;
revoke all on public.honors_earned from public, anon, authenticated;
grant select, insert, update on public.honors_earned to authenticated;
grant all on public.honors_earned to service_role;
create policy staff_read on public.honors_earned for select to authenticated
  using ((select public.current_staff_role()) in ('viewer','editor'));
create policy editor_insert on public.honors_earned for insert to authenticated
  with check ((select public.current_staff_role()) = 'editor');
create policy editor_update on public.honors_earned for update to authenticated
  using ((select public.current_staff_role()) = 'editor')
  with check ((select public.current_staff_role()) = 'editor');
revoke all on sequence public.honors_earned_id_seq from public, anon, authenticated;
grant usage on sequence public.honors_earned_id_seq to authenticated, service_role;
alter table public.drill enable row level security;
revoke all on public.drill from public, anon, authenticated;
grant select, insert, update on public.drill to authenticated;
grant all on public.drill to service_role;
create policy staff_read on public.drill for select to authenticated
  using ((select public.current_staff_role()) in ('viewer','editor'));
create policy editor_insert on public.drill for insert to authenticated
  with check ((select public.current_staff_role()) = 'editor');
create policy editor_update on public.drill for update to authenticated
  using ((select public.current_staff_role()) = 'editor')
  with check ((select public.current_staff_role()) = 'editor');
alter table public.drum_corps enable row level security;
revoke all on public.drum_corps from public, anon, authenticated;
grant select, insert, update on public.drum_corps to authenticated;
grant all on public.drum_corps to service_role;
create policy staff_read on public.drum_corps for select to authenticated
  using ((select public.current_staff_role()) in ('viewer','editor'));
create policy editor_insert on public.drum_corps for insert to authenticated
  with check ((select public.current_staff_role()) = 'editor');
create policy editor_update on public.drum_corps for update to authenticated
  using ((select public.current_staff_role()) = 'editor')
  with check ((select public.current_staff_role()) = 'editor');
revoke all on sequence public.drum_corps_id_seq from public, anon, authenticated;
grant usage on sequence public.drum_corps_id_seq to authenticated, service_role;
alter table public.pbe enable row level security;
revoke all on public.pbe from public, anon, authenticated;
grant select, insert, update on public.pbe to authenticated;
grant all on public.pbe to service_role;
create policy staff_read on public.pbe for select to authenticated
  using ((select public.current_staff_role()) in ('viewer','editor'));
create policy editor_insert on public.pbe for insert to authenticated
  with check ((select public.current_staff_role()) = 'editor');
create policy editor_update on public.pbe for update to authenticated
  using ((select public.current_staff_role()) = 'editor')
  with check ((select public.current_staff_role()) = 'editor');
revoke all on sequence public.pbe_id_seq from public, anon, authenticated;
grant usage on sequence public.pbe_id_seq to authenticated, service_role;
alter table public.tlt enable row level security;
revoke all on public.tlt from public, anon, authenticated;
grant select, insert, update on public.tlt to authenticated;
grant all on public.tlt to service_role;
create policy staff_read on public.tlt for select to authenticated
  using ((select public.current_staff_role()) in ('viewer','editor'));
create policy editor_insert on public.tlt for insert to authenticated
  with check ((select public.current_staff_role()) = 'editor');
create policy editor_update on public.tlt for update to authenticated
  using ((select public.current_staff_role()) = 'editor')
  with check ((select public.current_staff_role()) = 'editor');
revoke all on sequence public.tlt_id_seq from public, anon, authenticated;
grant usage on sequence public.tlt_id_seq to authenticated, service_role;
alter table public.red_zone_drill_performance enable row level security;
revoke all on public.red_zone_drill_performance from public, anon, authenticated;
grant select, insert, update on public.red_zone_drill_performance to authenticated;
grant all on public.red_zone_drill_performance to service_role;
create policy staff_read on public.red_zone_drill_performance for select to authenticated
  using ((select public.current_staff_role()) in ('viewer','editor'));
create policy editor_insert on public.red_zone_drill_performance for insert to authenticated
  with check ((select public.current_staff_role()) = 'editor');
create policy editor_update on public.red_zone_drill_performance for update to authenticated
  using ((select public.current_staff_role()) = 'editor')
  with check ((select public.current_staff_role()) = 'editor');
revoke all on sequence public.red_zone_drill_performance_id_seq from public, anon, authenticated;
grant usage on sequence public.red_zone_drill_performance_id_seq to authenticated, service_role;
alter table public.red_zone_drum_performance enable row level security;
revoke all on public.red_zone_drum_performance from public, anon, authenticated;
grant select, insert, update on public.red_zone_drum_performance to authenticated;
grant all on public.red_zone_drum_performance to service_role;
create policy staff_read on public.red_zone_drum_performance for select to authenticated
  using ((select public.current_staff_role()) in ('viewer','editor'));
create policy editor_insert on public.red_zone_drum_performance for insert to authenticated
  with check ((select public.current_staff_role()) = 'editor');
create policy editor_update on public.red_zone_drum_performance for update to authenticated
  using ((select public.current_staff_role()) = 'editor')
  with check ((select public.current_staff_role()) = 'editor');
revoke all on sequence public.red_zone_drum_performance_id_seq from public, anon, authenticated;
grant usage on sequence public.red_zone_drum_performance_id_seq to authenticated, service_role;
alter table public.red_zone_honor_evaluations enable row level security;
revoke all on public.red_zone_honor_evaluations from public, anon, authenticated;
grant select, insert, update on public.red_zone_honor_evaluations to authenticated;
grant all on public.red_zone_honor_evaluations to service_role;
create policy staff_read on public.red_zone_honor_evaluations for select to authenticated
  using ((select public.current_staff_role()) in ('viewer','editor'));
create policy editor_insert on public.red_zone_honor_evaluations for insert to authenticated
  with check ((select public.current_staff_role()) = 'editor');
create policy editor_update on public.red_zone_honor_evaluations for update to authenticated
  using ((select public.current_staff_role()) = 'editor')
  with check ((select public.current_staff_role()) = 'editor');
revoke all on sequence public.red_zone_honor_evaluations_id_seq from public, anon, authenticated;
grant usage on sequence public.red_zone_honor_evaluations_id_seq to authenticated, service_role;
alter table public.red_zone_bible_events enable row level security;
revoke all on public.red_zone_bible_events from public, anon, authenticated;
grant select, insert, update on public.red_zone_bible_events to authenticated;
grant all on public.red_zone_bible_events to service_role;
create policy staff_read on public.red_zone_bible_events for select to authenticated
  using ((select public.current_staff_role()) in ('viewer','editor'));
create policy editor_insert on public.red_zone_bible_events for insert to authenticated
  with check ((select public.current_staff_role()) = 'editor');
create policy editor_update on public.red_zone_bible_events for update to authenticated
  using ((select public.current_staff_role()) = 'editor')
  with check ((select public.current_staff_role()) = 'editor');
revoke all on sequence public.red_zone_bible_events_id_seq from public, anon, authenticated;
grant usage on sequence public.red_zone_bible_events_id_seq to authenticated, service_role;
alter table public.red_zone_knots enable row level security;
revoke all on public.red_zone_knots from public, anon, authenticated;
grant select, insert, update on public.red_zone_knots to authenticated;
grant all on public.red_zone_knots to service_role;
create policy staff_read on public.red_zone_knots for select to authenticated
  using ((select public.current_staff_role()) in ('viewer','editor'));
create policy editor_insert on public.red_zone_knots for insert to authenticated
  with check ((select public.current_staff_role()) = 'editor');
create policy editor_update on public.red_zone_knots for update to authenticated
  using ((select public.current_staff_role()) = 'editor')
  with check ((select public.current_staff_role()) = 'editor');
revoke all on sequence public.red_zone_knots_id_seq from public, anon, authenticated;
grant usage on sequence public.red_zone_knots_id_seq to authenticated, service_role;
alter table public.red_zone_tents enable row level security;
revoke all on public.red_zone_tents from public, anon, authenticated;
grant select, insert, update on public.red_zone_tents to authenticated;
grant all on public.red_zone_tents to service_role;
create policy staff_read on public.red_zone_tents for select to authenticated
  using ((select public.current_staff_role()) in ('viewer','editor'));
create policy editor_insert on public.red_zone_tents for insert to authenticated
  with check ((select public.current_staff_role()) = 'editor');
create policy editor_update on public.red_zone_tents for update to authenticated
  using ((select public.current_staff_role()) = 'editor')
  with check ((select public.current_staff_role()) = 'editor');
revoke all on sequence public.red_zone_tents_id_seq from public, anon, authenticated;
grant usage on sequence public.red_zone_tents_id_seq to authenticated, service_role;
alter table public.red_zone_jump_rope enable row level security;
revoke all on public.red_zone_jump_rope from public, anon, authenticated;
grant select, insert, update on public.red_zone_jump_rope to authenticated;
grant all on public.red_zone_jump_rope to service_role;
create policy staff_read on public.red_zone_jump_rope for select to authenticated
  using ((select public.current_staff_role()) in ('viewer','editor'));
create policy editor_insert on public.red_zone_jump_rope for insert to authenticated
  with check ((select public.current_staff_role()) = 'editor');
create policy editor_update on public.red_zone_jump_rope for update to authenticated
  using ((select public.current_staff_role()) = 'editor')
  with check ((select public.current_staff_role()) = 'editor');
revoke all on sequence public.red_zone_jump_rope_id_seq from public, anon, authenticated;
grant usage on sequence public.red_zone_jump_rope_id_seq to authenticated, service_role;
alter table public.red_zone_archery enable row level security;
revoke all on public.red_zone_archery from public, anon, authenticated;
grant select, insert, update on public.red_zone_archery to authenticated;
grant all on public.red_zone_archery to service_role;
create policy staff_read on public.red_zone_archery for select to authenticated
  using ((select public.current_staff_role()) in ('viewer','editor'));
create policy editor_insert on public.red_zone_archery for insert to authenticated
  with check ((select public.current_staff_role()) = 'editor');
create policy editor_update on public.red_zone_archery for update to authenticated
  using ((select public.current_staff_role()) = 'editor')
  with check ((select public.current_staff_role()) = 'editor');
revoke all on sequence public.red_zone_archery_id_seq from public, anon, authenticated;
grant usage on sequence public.red_zone_archery_id_seq to authenticated, service_role;
alter table public.red_zone_lashing enable row level security;
revoke all on public.red_zone_lashing from public, anon, authenticated;
grant select, insert, update on public.red_zone_lashing to authenticated;
grant all on public.red_zone_lashing to service_role;
create policy staff_read on public.red_zone_lashing for select to authenticated
  using ((select public.current_staff_role()) in ('viewer','editor'));
create policy editor_insert on public.red_zone_lashing for insert to authenticated
  with check ((select public.current_staff_role()) = 'editor');
create policy editor_update on public.red_zone_lashing for update to authenticated
  using ((select public.current_staff_role()) = 'editor')
  with check ((select public.current_staff_role()) = 'editor');
revoke all on sequence public.red_zone_lashing_id_seq from public, anon, authenticated;
grant usage on sequence public.red_zone_lashing_id_seq to authenticated, service_role;
alter table public.red_zone_burning_twine enable row level security;
revoke all on public.red_zone_burning_twine from public, anon, authenticated;
grant select, insert, update on public.red_zone_burning_twine to authenticated;
grant all on public.red_zone_burning_twine to service_role;
create policy staff_read on public.red_zone_burning_twine for select to authenticated
  using ((select public.current_staff_role()) in ('viewer','editor'));
create policy editor_insert on public.red_zone_burning_twine for insert to authenticated
  with check ((select public.current_staff_role()) = 'editor');
create policy editor_update on public.red_zone_burning_twine for update to authenticated
  using ((select public.current_staff_role()) = 'editor')
  with check ((select public.current_staff_role()) = 'editor');
revoke all on sequence public.red_zone_burning_twine_id_seq from public, anon, authenticated;
grant usage on sequence public.red_zone_burning_twine_id_seq to authenticated, service_role;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.valid_string_array(jsonb, text[]), private.valid_school_years(jsonb), private.valid_levels(jsonb) to authenticated, service_role;
notify pgrst, 'reload schema';
