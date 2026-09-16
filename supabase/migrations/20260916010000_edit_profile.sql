begin;

-- Read and write the same snapshot; timestamps and row identities are immutable.
create function public.get_profile_for_edit(p_id integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb := '{}'::jsonb; tab text; rows jsonb;
begin
 if not exists(select 1 from public.pathfinders where id=p_id) then
  raise exception 'Profile is no longer available.';
 end if;
 foreach tab in array array['pathfinders','current_data','staff_history','drill','drum_corps','pbe','tlt','red_zone_drill_performance','red_zone_drum_performance','red_zone_honor_evaluations','red_zone_bible_events','red_zone_knots','red_zone_tents','red_zone_jump_rope','red_zone_archery','red_zone_lashing','red_zone_burning_twine','honors_earned'] loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by %I), ''[]''::jsonb) from public.%I t where %I=$1',
   case when tab='current_data' then 'pathfinder_id' else 'id' end, tab,
   case when tab='pathfinders' then 'id' else 'pathfinder_id' end) into rows using p_id;
  result := result || jsonb_build_object(tab,rows);
 end loop;
 return result;
end $$;

create function public.update_profile(p_id integer, p_original jsonb, p_profile jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare
 allowed constant jsonb := '{"pathfinders": ["first_name", "last_name", "birth_date", "years_active", "levels", "notes"], "current_data": ["school_year", "status", "current_title", "current_activities"], "staff_history": ["history"], "drill": ["team", "years"], "drum_corps": ["history"], "pbe": ["history"], "tlt": ["history"], "red_zone_drill_performance": ["year", "placement"], "red_zone_drum_performance": ["year", "placement"], "red_zone_honor_evaluations": ["year", "placement", "name"], "red_zone_bible_events": ["year", "placement", "name"], "red_zone_knots": ["year", "placement"], "red_zone_tents": ["year", "placement"], "red_zone_jump_rope": ["year", "placement"], "red_zone_archery": ["year", "placement"], "red_zone_lashing": ["year", "placement"], "red_zone_burning_twine": ["year", "placement"], "honors_earned": ["honor_id", "year_earned"]}'::jsonb;
 tab text; cols jsonb; column_names text[]; assignments text; key_name text;
 old_row jsonb; new_row jsonb; affected integer;
begin
 -- Serialize this workflow with Add to Record and lock existing detail rows as well.
 perform 1 from public.pathfinders where id=p_id for update;
 if not found then raise exception 'Profile is no longer available.'; end if;
 for tab in select jsonb_object_keys(allowed) order by 1 loop
  if tab <> 'pathfinders' then
   execute format('select 1 from public.%I where pathfinder_id=$1 for update',tab) using p_id;
  end if;
 end loop;
 if p_original is distinct from public.get_profile_for_edit(p_id) then
  raise exception 'This profile changed since you opened the editor. Cancel and reopen Edit Profile to load the latest data.' using errcode='40001';
 end if;
 if jsonb_typeof(p_profile) is distinct from 'object' or
    (select array_agg(k order by k) from jsonb_object_keys(p_profile) k) is distinct from
    (select array_agg(k order by k) from jsonb_object_keys(allowed) k) then
  raise exception 'Invalid profile data.';
 end if;
 for tab,cols in select * from jsonb_each(allowed) loop
  select array_agg(value) into column_names from jsonb_array_elements_text(cols);
  key_name := case when tab='current_data' then 'pathfinder_id' else 'id' end;
  if jsonb_typeof(p_profile->tab) is distinct from 'array' then raise exception 'Invalid records for %.',tab; end if;
  if jsonb_array_length(p_profile->tab) <> jsonb_array_length(p_original->tab) then
   raise exception 'Use Add to Record to create history. Existing rows cannot be removed here.';
  end if;
  for old_row in select value from jsonb_array_elements(p_original->tab) loop
   if (select count(*) from jsonb_array_elements(p_profile->tab) r where r->key_name=old_row->key_name) <> 1 then
    raise exception 'Record identities cannot be changed.';
   end if;
   select value into new_row from jsonb_array_elements(p_profile->tab) where value->key_name=old_row->key_name;
   if new_row - column_names is distinct from old_row - column_names then
    raise exception 'Only profile fields may be changed.';
   end if;
   if new_row is distinct from old_row then
    select string_agg(format('%I = src.%I',c,c),', ') into assignments from unnest(column_names) c;
    execute format('update public.%I as dest set %s from jsonb_populate_record(null::public.%I,$1) src where dest.%I=$2 and dest.%I=$3',
      tab,assignments,tab,key_name,case when tab='pathfinders' then 'id' else 'pathfinder_id' end)
      using new_row,(old_row->>key_name)::integer,p_id;
    get diagnostics affected = row_count;
    if affected <> 1 then raise exception 'Could not update the profile.'; end if;
   end if;
  end loop;
 end loop;
end $$;
revoke all on function public.get_profile_for_edit(integer) from public,anon;
revoke all on function public.update_profile(integer,jsonb,jsonb) from public,anon;
grant execute on function public.get_profile_for_edit(integer) to authenticated;
grant execute on function public.update_profile(integer,jsonb,jsonb) to authenticated;
commit;
