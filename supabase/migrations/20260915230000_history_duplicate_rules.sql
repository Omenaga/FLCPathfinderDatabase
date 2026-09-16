begin;

-- Levels and TLT operations are earned once per member, independently of year.
create or replace function public.add_to_records(p_ids integer[], p_year text, p_entry jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 person integer; person_name text; person_status text; years jsonb; levels_value jsonb;
 new_operations jsonb; skipped_operations jsonb; receipt_note text;
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
  if not private.valid_pbe_results(coalesce(p_entry->'results','{}')) then raise exception 'Choose a valid placement for each PBE region.'; end if;
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
  person_name := 'Profile ' || person; changed := false; year_added := false; receipt_note := null;
  begin
   select concat_ws(' ',first_name,nullif(last_name,'')),years_active,levels into person_name,years,levels_value
     from public.pathfinders where id=person for update;
   if not found then raise exception 'Profile is unavailable or you no longer have access.'; end if;
   select status into person_status from public.current_data where pathfinder_id=person and school_year=public.current_club_year() for share;
   if kind='staff' and person_status='pathfinder' then raise exception 'Current Pathfinders cannot receive a Staff title.'; end if;
   if kind='level' then
    entry_value := jsonb_build_object('name',p_entry->>'name','outcome',p_entry->>'outcome','year',p_year);
    changed := not (levels_value @> jsonb_build_array(jsonb_build_object('name',p_entry->>'name')));
    if not changed then receipt_note := 'This level is already recorded. Its existing year and outcome were kept.'; end if;
    if changed then update public.pathfinders set levels=levels_value || jsonb_build_array(entry_value) where id=person; end if;
   elsif kind='drill' then
    select id,d.years into row_id,old_history from public.drill d where pathfinder_id=person and team is not distinct from (p_entry->>'team') for update;
    changed := row_id is null or not (old_history @> jsonb_build_array(p_year));
    if row_id is null then insert into public.drill(pathfinder_id,team,years) values(person,p_entry->>'team',jsonb_build_array(p_year));
    elsif changed then update public.drill set years=old_history || jsonb_build_array(p_year) where id=row_id; end if;
   elsif kind='tlt' then
    select id,history into row_id,old_history from public.tlt where pathfinder_id=person for update;
    select coalesce(jsonb_agg(operation order by operation),'[]') into new_operations
    from (select distinct value as operation from jsonb_array_elements(details)) requested
    where not exists(select 1 from jsonb_array_elements(coalesce(old_history,'[]')) e where e->'operations' @> jsonb_build_array(operation));
    select coalesce(jsonb_agg(operation order by operation),'[]') into skipped_operations
    from (select distinct value as operation from jsonb_array_elements(details)) requested
    where exists(select 1 from jsonb_array_elements(coalesce(old_history,'[]')) e where e->'operations' @> jsonb_build_array(operation));
    changed := new_operations <> '[]'::jsonb;
    if skipped_operations <> '[]'::jsonb then
     select 'Already recorded operations: ' || string_agg(value,', ' order by value) || '. Existing years were kept.' into receipt_note from jsonb_array_elements_text(skipped_operations);
    end if;
    if changed then
     merged := private.append_period_details(old_history,p_year,'operations',new_operations);
     if row_id is null then insert into public.tlt(pathfinder_id,history) values(person,merged);
     else update public.tlt set history=merged where id=row_id; end if;
    end if;
   elsif kind in ('staff','drums','pbe') then
    table_name := case kind when 'staff' then 'staff_history' when 'drums' then 'drum_corps' else kind end;
    detail_key := case kind when 'staff' then 'titles' when 'drums' then 'drums' when 'pbe' then 'books' else 'operations' end;
    row_id := null; old_history := null;
    if kind='staff' then
     select id,history into row_id,old_history from public.staff_history where pathfinder_id=person for update;
    else
     execute format('select id,history from public.%I where pathfinder_id=$1 for update',table_name) into row_id,old_history using person;
    end if;
    changed := not coalesce(old_history @> jsonb_build_array(jsonb_build_object('year',p_year,detail_key,details)),false);
    if kind='pbe' then
     changed := changed or not coalesce(old_history @> jsonb_build_array(jsonb_build_object('year',p_year,'results',coalesce(p_entry->'results','{}'))),false) and coalesce(p_entry->'results','{}') <> '{}'::jsonb;
     merged := private.append_pbe_history(old_history,p_year,details,coalesce(p_entry->'results','{}'));
    else
     merged := private.append_period_details(old_history,p_year,detail_key,details);
    end if;
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
   year_added := not (years @> jsonb_build_array(p_year)) and (changed or kind not in ('level','tlt'));
   if year_added then update public.pathfinders set years_active=years || jsonb_build_array(p_year) where id=person; end if;
   results := results || jsonb_build_array(jsonb_build_object('id',person,'name',person_name,'status',case when changed then 'added' else 'already' end,'year_added',year_added,'reason',receipt_note));
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

