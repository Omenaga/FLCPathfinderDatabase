begin;
-- Unknown dates may represent separate occasions; known-year uniqueness remains unchanged.
create or replace function private.valid_period_details(value jsonb, detail_key text, allowed text[]) returns boolean
language plpgsql immutable set search_path='' as $$
declare entry jsonb; seen text[] := array[]::text[];
begin
 if value is null or jsonb_typeof(value)<>'array' or value='[]'::jsonb then return false; end if;
 for entry in select jsonb_array_elements(value) loop
  if jsonb_typeof(entry)<>'object' then return false; end if;
  if not (entry ?& array['year',detail_key]) or entry-array['year',detail_key]<>'{}'::jsonb then return false; end if;
  if jsonb_typeof(entry->'year') not in ('string','null') or jsonb_typeof(entry->detail_key)<>'array' then return false; end if;
  if not private.valid_history_years(jsonb_build_array(entry->'year')) or (entry->>'year')=any(seen) then return false; end if;
  if not private.valid_string_array(entry->detail_key,allowed) then return false; end if;
  seen := array_append(seen,coalesce(entry->>'year','Unknown'));
 end loop;
 return true;
end $$;

create or replace function private.valid_pbe_history(value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare entry jsonb; seen text[] := array[]::text[]; y text;
begin
 if value is null or jsonb_typeof(value)<>'array' or value='[]'::jsonb then return false; end if;
 for entry in select jsonb_array_elements(value) loop
   if jsonb_typeof(entry)<>'object' then return false; end if;
   if not (entry ?& array['year','books']) or entry - array['year','books','results'] <> '{}'::jsonb then return false; end if;
   if jsonb_typeof(entry->'year') not in ('string','null') or jsonb_typeof(entry->'books')<>'array' then return false; end if;
   y := entry->>'year';
   if not private.valid_history_years(jsonb_build_array(y)) or y=any(seen)
     or not private.valid_string_array(entry->'books') then return false; end if;
   if entry ? 'results' and not private.valid_pbe_results(entry->'results') then return false; end if;
   seen := array_append(seen,coalesce(y,'Unknown'));
 end loop;
 return true;
end;
$$;

create or replace function private.valid_tlt_history(value jsonb) returns boolean
language plpgsql stable set search_path = '' as $$
declare entry jsonb; y integer; seen integer[] := array[]::integer[];
begin
 if value is null or jsonb_typeof(value)<>'array' or value='[]'::jsonb then return false; end if;
 for entry in select jsonb_array_elements(value) loop
   if jsonb_typeof(entry)<>'object' then return false; end if;
   if not (entry ?& array['year','operations']) or entry - array['year','operations'] <> '{}'::jsonb then return false; end if;
   if jsonb_typeof(entry->'year') not in ('string','null') or jsonb_typeof(entry->'operations')<>'array' then return false; end if;
   if not private.valid_history_years(jsonb_build_array(entry->'year')) then return false; end if;
   y := coalesce(left(entry->>'year',4)::integer,0);
   if (y<>0 and (y<2016 or y>extract(year from current_date)::integer)) or (y<>0 and y=any(seen)) then return false; end if;
   if not private.valid_string_array(entry->'operations',array['Administrative','Outreach','Teaching','Activity','Records','Counseling']) then return false; end if;
   seen := array_append(seen,y);
 end loop;
 return true;
end;
$$;


create or replace function private.valid_levels(value jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare entry jsonb;
begin
  if value is null or jsonb_typeof(value)<>'array' then return false; end if;
  for entry in select jsonb_array_elements(value) loop
    if jsonb_typeof(entry)<>'object' then return false; end if;
    if entry->>'name'='Master Guide' then
      if not (entry ?& array['name','year']) or entry-array['name','year']<>'{}'::jsonb then
        return false;
      end if;
    else
      if not (entry ?& array['name','outcome','year'])
        or entry-array['name','outcome','year']<>'{}'::jsonb then return false; end if;
      if not coalesce(entry->>'name'=any(array['Friend','Companion','Explorer','Ranger','Voyager','Guide','Pioneer','Navigator']),false)
        or not coalesce(entry->>'outcome'=any(array['basic','advanced','incomplete']),false) then
        return false;
      end if;
    end if;
    if not private.valid_history_years(jsonb_build_array(entry->'year')) then return false; end if;
  end loop;
  return (select count(*)=count(distinct item) from jsonb_array_elements(value) item where item->>'year' is not null);
end $$;


do $$ declare r record; tbl text; begin
 foreach tbl in array array['honors_earned','red_zone_drill_performance','red_zone_drum_performance','red_zone_honor_evaluations','red_zone_bible_events','red_zone_knots','red_zone_tents','red_zone_jump_rope','red_zone_archery','red_zone_lashing','red_zone_burning_twine'] loop
  for r in select conname,pg_get_constraintdef(oid) as definition from pg_constraint where conrelid=('public.'||tbl)::regclass and contype='u' loop
   execute format('alter table public.%I drop constraint %I, add constraint %I %s',tbl,r.conname,r.conname,replace(r.definition,'UNIQUE NULLS NOT DISTINCT','UNIQUE'));
  end loop;
 end loop;
end $$;

alter function private.append_period_details(jsonb,text,text,jsonb) rename to append_period_details_single_period;
create function private.append_period_details(history jsonb, period text, detail_key text, additions jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare base jsonb; extras jsonb; first_unknown bigint;
begin
 select min(ordinality) into first_unknown from jsonb_array_elements(coalesce(history,'[]')) with ordinality where value->>'year' is null;
 select coalesce(jsonb_agg(value order by ordinality),'[]') into base
 from jsonb_array_elements(coalesce(history,'[]')) with ordinality
 where period is not null or value->>'year' is not null or ordinality=first_unknown;
 select coalesce(jsonb_agg(value order by ordinality),'[]') into extras
 from jsonb_array_elements(coalesce(history,'[]')) with ordinality
 where period is null and value->>'year' is null and ordinality<>first_unknown;
 return private.append_period_details_single_period(base,period,detail_key,additions) || extras;
end $$;
revoke all on function private.append_period_details(jsonb,text,text,jsonb) from public,anon;
grant execute on function private.append_period_details(jsonb,text,text,jsonb) to authenticated,service_role;

alter function private.append_pbe_history(jsonb,text,jsonb,jsonb) rename to append_pbe_history_single_period;
create function private.append_pbe_history(history jsonb, period text, books jsonb, results jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare base jsonb; extras jsonb; first_unknown bigint;
begin
 select min(ordinality) into first_unknown from jsonb_array_elements(coalesce(history,'[]')) with ordinality where value->>'year' is null;
 select coalesce(jsonb_agg(value order by ordinality),'[]') into base
 from jsonb_array_elements(coalesce(history,'[]')) with ordinality
 where period is not null or value->>'year' is not null or ordinality=first_unknown;
 select coalesce(jsonb_agg(value order by ordinality),'[]') into extras
 from jsonb_array_elements(coalesce(history,'[]')) with ordinality
 where period is null and value->>'year' is null and ordinality<>first_unknown;
 return private.append_pbe_history_single_period(base,period,books,results) || extras;
end $$;
revoke all on function private.append_pbe_history(jsonb,text,jsonb,jsonb) from public,anon;
grant execute on function private.append_pbe_history(jsonb,text,jsonb,jsonb) to authenticated,service_role;

notify pgrst, 'reload schema';
commit;
