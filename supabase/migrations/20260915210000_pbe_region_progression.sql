begin;

create or replace function private.append_pbe_history(history jsonb, period text, books jsonb, results jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare previous jsonb; merged jsonb; region text; placement jsonb; combined jsonb; regions text[] := array['Area','State','Union','Divisional']; i integer;
begin
 if not private.valid_pbe_results(results) then raise exception 'Choose a valid placement for each PBE region.'; end if;
 select value into previous from jsonb_array_elements(coalesce(history,'[]')) where value->>'year'=period;
 for region,placement in select * from jsonb_each(results) loop
  if (previous->'results') ? region and previous->'results'->region is distinct from placement then
   raise exception 'A different placement is already recorded for PBE % in %. Existing data was kept.',region,period;
  end if;
 end loop;
 combined := coalesce(previous->'results','{}') || results;
 -- Existing incomplete historical results remain readable; new additions need prior regions.
 if results <> '{}'::jsonb then
  for i in 2..4 loop
   if combined ? regions[i] and not (combined ?& regions[1:i-1]) then
    raise exception 'PBE % requires placements for all earlier regions (Area, State, Union, Divisional).',regions[i];
   end if;
  end loop;
 end if;
 merged := private.append_period_details(history,period,'books',books);
 if coalesce(previous->'results','{}') || results <> '{}'::jsonb then
  select jsonb_agg(case when value->>'year'=period then value || jsonb_build_object('results',coalesce(previous->'results','{}') || results) else value end order by value->>'year') into merged from jsonb_array_elements(merged);
 end if;
 return merged;
end $$;

notify pgrst,'reload schema';
commit;
