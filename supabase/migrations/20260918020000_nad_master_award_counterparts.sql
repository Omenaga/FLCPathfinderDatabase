-- Club policy: an existing NAD counterpart satisfies its regional/GC requirement.
-- Keep original source URLs/years and catalog editions; only change eligibility links.
-- Making Pizza explicitly cross-links to the NAD-listed Pizza Maker version.
begin;

create temporary table nad_master_award_mappings (
  source_url text primary key,
  catalog_name text not null
) on commit drop;
insert into nad_master_award_mappings(source_url,catalog_name) values
  ('https://wiki.pathfindersonline.org/w/AY_Honors/Guitar_(SAD)', 'Guitar'),
  ('https://wiki.pathfindersonline.org/w/AY_Honors/Health_and_Healing_(GC)', 'Health and Healing'),
  ('https://wiki.pathfindersonline.org/w/AY_Honors/Household_Budgeting_(SAD)', 'Household Budgeting'),
  ('https://wiki.pathfindersonline.org/w/AY_Honors/Making_Pizza', 'Pizza Maker'),
  ('https://wiki.pathfindersonline.org/w/AY_Honors/Odonates_(SAD)', 'Odonates'),
  ('https://wiki.pathfindersonline.org/w/AY_Honors/Orienteering_(SPD)', 'Orienteering'),
  ('https://wiki.pathfindersonline.org/w/AY_Honors/Sharks_(SAD)', 'Sharks'),
  ('https://wiki.pathfindersonline.org/w/AY_Honors/Snowshoeing_(SAD)', 'Snowshoeing'),
  ('https://wiki.pathfindersonline.org/w/AY_Honors/Snowshoeing_-_Advanced_(GC)', 'Snowshoeing - Advanced'),
  ('https://wiki.pathfindersonline.org/w/AY_Honors/Snowshoeing_-_Advanced_(SAD)', 'Snowshoeing - Advanced'),
  ('https://wiki.pathfindersonline.org/w/AY_Honors/Video_(GC)', 'Video'),
  ('https://wiki.pathfindersonline.org/w/AY_Honors/Welding_(GC)', 'Welding');

-- Fail rather than lose a mapping if a target catalog entry is unexpectedly absent.
do $$
begin
  if exists (
    select 1 from nad_master_award_mappings m
    left join public.honors h on h.name=m.catalog_name and not h.is_master_award
    where h.id is null
  ) then raise exception 'A required NAD honor counterpart is missing from the catalog.';
  end if;
end $$;

update public.master_award_honors r
set honor_id=h.id, mapping_status='matched'
from nad_master_award_mappings m join public.honors h on h.name=m.catalog_name
where r.source_url=m.source_url and not h.is_master_award;

update public.master_awards a
set requirements_status=case when exists (
  select 1 from public.master_award_groups g
  join public.master_award_honors r on r.group_id=g.id
  where g.award_id=a.honor_id and r.mapping_status='needs_review'
) then 'retrieved_needs_mapping_review' else 'retrieved' end
where a.requirements_status in ('retrieved','retrieved_needs_mapping_review');

-- Eligibility already matches distinct honor IDs to slots, so multiple regional
-- references to one NAD honor do not create additional credit.
commit;
