begin;

-- Keep the original rows for recovery, outside the API-exposed schema.
create table private.history_role_removal_backup (table_name text not null, row_data jsonb not null);
revoke all on private.history_role_removal_backup from public, anon, authenticated;

do $$
declare tbl text; member_id integer; keep_id integer; entry jsonb; merged jsonb; detail_key text;
begin
 foreach tbl in array array['drill','drum_corps','pbe','tlt','honors_earned',
 'red_zone_drill_performance','red_zone_drum_performance','red_zone_honor_evaluations','red_zone_bible_events',
 'red_zone_knots','red_zone_tents','red_zone_jump_rope','red_zone_archery','red_zone_lashing','red_zone_burning_twine'] loop
  execute format('lock table public.%I in access exclusive mode',tbl);
  execute format('insert into private.history_role_removal_backup select %L,to_jsonb(t) from public.%I t',tbl,tbl);
  -- PostgreSQL removes the role-based indexes and constraints with the column.
  execute format('alter table public.%I drop column history_role',tbl);
 end loop;
 foreach tbl in array array['drum_corps','pbe','tlt'] loop
  detail_key := case tbl when 'drum_corps' then 'drums' when 'pbe' then 'books' else 'operations' end;
  for member_id in execute format('select pathfinder_id from public.%I group by pathfinder_id having count(*)>1',tbl) loop
   merged := '[]';
   for entry in execute format('select e from public.%I t cross join lateral jsonb_array_elements(t.history) e where pathfinder_id=$1 order by id',tbl) using member_id loop
    merged := private.append_period_details(merged,entry->>'year',detail_key,entry->detail_key);
   end loop;
   execute format('select min(id) from public.%I where pathfinder_id=$1',tbl) into keep_id using member_id;
   execute format('delete from public.%I where pathfinder_id=$1 and id<>$2',tbl) using member_id,keep_id;
   execute format('update public.%I set history=$1 where id=$2',tbl) using merged,keep_id;
  end loop;
  execute format('alter table public.%I add unique(pathfinder_id)',tbl);
 end loop;
end $$;

with merged as (
 select pathfinder_id,team,min(id) as keep_id,jsonb_agg(distinct y order by y) as years
 from public.drill cross join lateral jsonb_array_elements(years) y group by pathfinder_id,team
)
update public.drill d set years=m.years from merged m where d.id=m.keep_id;
delete from public.drill d using public.drill keep
 where d.pathfinder_id=keep.pathfinder_id and d.team is not distinct from keep.team and d.id>keep.id;
create unique index drill_member_team_key on public.drill(pathfinder_id,team) nulls not distinct;

delete from public.honors_earned d using public.honors_earned keep
 where d.pathfinder_id=keep.pathfinder_id and d.honor_id=keep.honor_id and d.year_earned=keep.year_earned and d.id>keep.id;
alter table public.honors_earned add unique(pathfinder_id,honor_id,year_earned);

-- Collapse identical results, but preserve differing legacy placements rather than discard them.
do $$ declare tbl text; named boolean; begin
 foreach tbl in array array['red_zone_drill_performance','red_zone_drum_performance','red_zone_honor_evaluations','red_zone_bible_events',
 'red_zone_knots','red_zone_tents','red_zone_jump_rope','red_zone_archery','red_zone_lashing','red_zone_burning_twine'] loop
  named := tbl in ('red_zone_honor_evaluations','red_zone_bible_events');
  execute format('delete from public.%I d using public.%I keep where d.pathfinder_id=keep.pathfinder_id and d.year=keep.year and d.placement=keep.placement %s and d.id>keep.id',tbl,tbl,case when named then 'and d.name=keep.name' else '' end);
  execute format('alter table public.%I add unique(pathfinder_id,year,%s placement)',tbl,case when named then 'name,' else '' end);
 end loop;
end $$;

create or replace function public.add_to_records(p_ids integer[], p_year text, p_entry jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 person integer; person_name text; person_status text; years jsonb; levels_value jsonb;
 old_history jsonb; merged jsonb; detail_key text; table_name text;
 kind text := p_entry->>'kind'; details jsonb := p_entry->'details';
 entry_value jsonb; row_id integer; existing_placement text;
 changed boolean; year_added boolean; results jsonb := '[]';
begin
 if auth.uid() is null then raise exception 'Sign in to add information.' using errcode='42501'; end if;
 if coalesce(cardinality(p_ids),0)=0 then raise exception 'Select at least one profile.'; end if;
 if p_year is null or not private.valid_school_years(jsonb_build_array(p_year)) then raise exception 'Choose a valid school year.'; end if;
 if kind is null or kind not in ('level','staff','drill','drums','pbe','tlt','event','honor') then raise exception 'Choose a documentation category.'; end if;
 if kind='pbe' then
  select coalesce(jsonb_agg(book_name order by book_name),'[]') into details from public.pbe_year_books where school_year=p_year;
  if details='[]'::jsonb then raise exception 'No Bible books are configured for this year.'; end if;
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
  person_name := 'Profile ' || person; changed := false; year_added := false;
  begin
   select concat_ws(' ',first_name,nullif(last_name,'')),years_active,levels into person_name,years,levels_value
     from public.pathfinders where id=person for update;
   if not found then raise exception 'Profile is unavailable or you no longer have access.'; end if;
   select status into person_status from public.current_data where pathfinder_id=person and school_year=public.current_club_year() for share;
   if kind='staff' and person_status='pathfinder' then raise exception 'Current Pathfinders cannot receive a Staff title.'; end if;
   if kind='level' then
    entry_value := jsonb_build_object('name',p_entry->>'name','outcome',p_entry->>'outcome','year',p_year);
    changed := not (levels_value @> jsonb_build_array(entry_value));
    if changed then update public.pathfinders set levels=levels_value || jsonb_build_array(entry_value) where id=person; end if;
   elsif kind='drill' then
    select id,d.years into row_id,old_history from public.drill d where pathfinder_id=person and team is not distinct from (p_entry->>'team') for update;
    changed := row_id is null or not (old_history @> jsonb_build_array(p_year));
    if row_id is null then insert into public.drill(pathfinder_id,team,years) values(person,p_entry->>'team',jsonb_build_array(p_year));
    elsif changed then update public.drill set years=old_history || jsonb_build_array(p_year) where id=row_id; end if;
   elsif kind in ('staff','drums','pbe','tlt') then
    table_name := case kind when 'staff' then 'staff_history' when 'drums' then 'drum_corps' else kind end;
    detail_key := case kind when 'staff' then 'titles' when 'drums' then 'drums' when 'pbe' then 'books' else 'operations' end;
    row_id := null; old_history := null;
    if kind='staff' then
     select id,history into row_id,old_history from public.staff_history where pathfinder_id=person for update;
    else
     execute format('select id,history from public.%I where pathfinder_id=$1 for update',table_name) into row_id,old_history using person;
    end if;
    changed := not coalesce(old_history @> jsonb_build_array(jsonb_build_object('year',p_year,detail_key,details)),false);
    merged := private.append_period_details(old_history,p_year,detail_key,details);
    if row_id is null then
     if kind='staff' then insert into public.staff_history(pathfinder_id,history) values(person,merged);
     else execute format('insert into public.%I(pathfinder_id,history) values($1,$2)',table_name) using person,merged; end if;
    elsif changed then execute format('update public.%I set history=$1 where id=$2',table_name) using merged,row_id; end if;
   elsif kind='honor' then
    select id into row_id from public.honors_earned where pathfinder_id=person and honor_id=(p_entry->>'honor_id')::integer and year_earned=p_year;
    changed := row_id is null;
    if changed then insert into public.honors_earned(pathfinder_id,honor_id,year_earned) values(person,(p_entry->>'honor_id')::integer,p_year); end if;
   elsif kind='event' then
    row_id := null; existing_placement := null;
    if table_name in ('red_zone_honor_evaluations','red_zone_bible_events') then
     if nullif(btrim(p_entry->>'name'),'') is null then raise exception 'Enter the event or evaluation name.'; end if;
     execute format('select id,placement from public.%I where pathfinder_id=$1 and year=$2 and name=$3 order by (placement is distinct from $4) desc, id for update',table_name)
       into row_id,existing_placement using person,p_year,btrim(p_entry->>'name'),p_entry->>'placement';
    else
     execute format('select id,placement from public.%I where pathfinder_id=$1 and year=$2 order by (placement is distinct from $3) desc, id for update',table_name)
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
   year_added := not (years @> jsonb_build_array(p_year));
   if year_added then update public.pathfinders set years_active=years || jsonb_build_array(p_year) where id=person; end if;
   results := results || jsonb_build_array(jsonb_build_object('id',person,'name',person_name,'status',case when changed then 'added' else 'already' end,'year_added',year_added));
  exception when others then
   results := results || jsonb_build_array(jsonb_build_object('id',person,'name',coalesce(person_name,'Profile '||person),'status','error','reason',sqlerrm,'year_added',false));
  end;
 end loop;
 return results;
end $$;
revoke all on function public.add_to_records(integer[],text,jsonb) from public,anon;
grant execute on function public.add_to_records(integer[],text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;

