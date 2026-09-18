-- Generated from the reviewed honors catalog and honors-integration-schema.sql.
begin;

-- Source template for the honors integration migration; generated SQL is deployed.
alter table public.honors add column is_master_award boolean not null default false;
comment on column public.honors.is_master_award is 'Master Awards share the catalog and explicit earned records; eligibility never writes an earned record.';

create table public.master_awards (
  honor_id integer primary key references public.honors(id) on delete restrict,
  required_honor_count smallint not null check (required_honor_count = 7),
  requirements_status text not null check (requirements_status in ('retrieved', 'retrieved_needs_mapping_review', 'pending_manual_input')),
  source_url text not null,
  notes jsonb not null default '[]'::jsonb check (jsonb_typeof(notes) = 'array')
);
create table public.master_award_groups (
  id integer generated always as identity primary key,
  award_id integer not null references public.master_awards(honor_id) on delete cascade,
  name text not null,
  sort_order smallint not null check (sort_order > 0),
  required_count smallint not null check (required_count between 1 and 7),
  unique (award_id, sort_order)
);
create table public.master_award_honors (
  group_id integer not null references public.master_award_groups(id) on delete cascade,
  source_url text not null,
  source_name text not null,
  source_year integer,
  honor_id integer references public.honors(id) on delete restrict,
  mapping_status text not null check (mapping_status in ('matched', 'needs_review')),
  primary key (group_id, source_url),
  check ((mapping_status = 'matched') = (honor_id is not null))
);
create index master_award_honors_honor_idx on public.master_award_honors(honor_id);

-- Requirement catalogs are readable by staff; only administrators maintain source mappings.
alter table public.master_awards enable row level security;
alter table public.master_award_groups enable row level security;
alter table public.master_award_honors enable row level security;
revoke all on public.master_awards, public.master_award_groups, public.master_award_honors from public, anon, authenticated;
grant select on public.master_awards, public.master_award_groups, public.master_award_honors to authenticated;
grant all on public.master_awards, public.master_award_groups, public.master_award_honors to service_role;
revoke all on sequence public.master_award_groups_id_seq from public, anon, authenticated;
grant all on sequence public.master_award_groups_id_seq to service_role;
create policy staff_read on public.master_awards for select to authenticated using (public.current_staff_role() is not null);
create policy staff_read on public.master_award_groups for select to authenticated using (public.current_staff_role() is not null);
create policy staff_read on public.master_award_honors for select to authenticated using (public.current_staff_role() is not null);

-- Match distinct earned honors to seven requirement slots. Augmenting paths allow
-- overlapping groups without double-counting an honor or depending on greedy ordering.
create function public.master_award_requirements_met(p_earned integer[], p_groups jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare
  slots jsonb := '[]'::jsonb; grp jsonb; candidates jsonb; needed integer;
  assigned integer[] := array_fill(null::integer, array[7]);
  visited boolean[]; parent_slots integer[]; parent_honors integer[];
  queue integer[]; cursor_index integer; current_slot integer; owner_slot integer;
  root_slot integer; honor integer; previous_slot integer; success boolean;
begin
  if jsonb_typeof(p_groups) is distinct from 'array' or coalesce(cardinality(p_earned),0) < 7 then return false; end if;
  for grp in select value from jsonb_array_elements(p_groups) loop
    needed := (grp->>'required_count')::integer;
    if needed is null or needed < 1 or needed > 7 or jsonb_array_length(slots)+needed > 7 then return false; end if;
    select coalesce(jsonb_agg(distinct h::integer),'[]') into candidates
      from jsonb_array_elements_text(grp->'honors') h where h::integer = any(p_earned);
    if jsonb_array_length(candidates) < needed then return false; end if;
    for root_slot in 1..needed loop slots := slots || jsonb_build_array(candidates); end loop;
  end loop;
  if jsonb_array_length(slots) <> 7 then return false; end if;
  for root_slot in 1..7 loop
    visited := array_fill(false,array[7]); visited[root_slot] := true;
    parent_slots := array_fill(null::integer,array[7]);
    parent_honors := array_fill(null::integer,array[7]);
    queue := array[root_slot]; cursor_index := 1; success := false;
    while cursor_index <= cardinality(queue) and not success loop
      current_slot := queue[cursor_index]; cursor_index := cursor_index+1;
      for honor in select value::integer from jsonb_array_elements_text(slots->(current_slot-1)) loop
        owner_slot := array_position(assigned,honor);
        if owner_slot is null then
          assigned[current_slot] := honor;
          while current_slot <> root_slot loop
            previous_slot := parent_slots[current_slot];
            assigned[previous_slot] := parent_honors[current_slot];
            current_slot := previous_slot;
          end loop;
          success := true; exit;
        elsif not visited[owner_slot] then
          visited[owner_slot] := true;
          parent_slots[owner_slot] := current_slot;
          parent_honors[owner_slot] := honor;
          queue := array_append(queue,owner_slot);
        end if;
      end loop;
    end loop;
    if not success then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function public.master_award_requirements_met(integer[],jsonb) from public,anon;
grant execute on function public.master_award_requirements_met(integer[],jsonb) to authenticated,service_role;

create function public.get_master_award_status(p_pathfinder_id integer)
returns table (honor_id integer, name text, earned_years jsonb, eligible boolean)
language sql stable security invoker set search_path='' as $$
  with earned as (
    select e.honor_id, jsonb_agg(e.year_earned order by e.year_earned desc nulls last) as years
    from public.honors_earned e where e.pathfinder_id=p_pathfinder_id group by e.honor_id
  ), available as (
    select coalesce(array_agg(e.honor_id),'{}'::integer[]) as ids
    from earned e join public.honors h on h.id=e.honor_id where not h.is_master_award
  ), evaluated as (
    select h.id, h.name, coalesce(e.years,'[]'::jsonb) as earned_years,
      e.honor_id is null and a.requirements_status <> 'pending_manual_input'
      and a.required_honor_count=7 and public.master_award_requirements_met(available.ids,
        coalesce((select jsonb_agg(jsonb_build_object('required_count',g.required_count,'honors',
          coalesce((select jsonb_agg(distinct c.honor_id) from public.master_award_honors c
            join public.honors ch on ch.id=c.honor_id and not ch.is_master_award
            where c.group_id=g.id and c.mapping_status='matched'),'[]'::jsonb)) order by g.sort_order)
          from public.master_award_groups g where g.award_id=a.honor_id),'[]'::jsonb)) as eligible
    from public.master_awards a join public.honors h on h.id=a.honor_id
    cross join available left join earned e on e.honor_id=a.honor_id
    where public.current_staff_role() is not null
      and exists(select 1 from public.pathfinders p where p.id=p_pathfinder_id)
  ) select id,name,earned_years,eligible from evaluated
    where jsonb_array_length(earned_years)>0 or eligible order by lower(name),id;
$$;
revoke all on function public.get_master_award_status(integer) from public,anon;
grant execute on function public.get_master_award_status(integer) to authenticated,service_role;

-- Append to the existing public projection, preserving its ordering and access rules.
create or replace view public.member_search with (security_invoker=true) as
select s.*,
 coalesce((select jsonb_agg(jsonb_build_object('name',title,'year',entry->'year'))
   from public.staff_history h cross join lateral jsonb_array_elements(h.history) entry
   cross join lateral jsonb_array_elements_text(entry->'titles') title
   where h.pathfinder_id=s.id),'[]'::jsonb) as search_staff_titles,
 case status when 'pathfinder' then 0 when 'staff' then 1 when 'parent' then 2 else 3 end as sort_status,
 case status
 when 'pathfinder' then coalesce((select min(array_position(array['Friend','Companion','Explorer','Ranger','Voyager','Guide','Pioneer','Navigator'],v)) from jsonb_array_elements_text(current_title) v),1000)
 when 'staff' then coalesce((select min(t.sort_order) from public.staff_titles t where s.current_title @> jsonb_build_array(t.title)),1000)
 else 0 end as sort_title,
 lower(last_name) as sort_last_name, lower(first_name) as sort_first_name,
 coalesce((select jsonb_agg(jsonb_build_object('honor_id',e.honor_id,'year',e.year_earned))
   from public.honors_earned e where e.pathfinder_id=s.id),'[]'::jsonb) as search_honors
from public.member_search_base s;
grant select on public.member_search to authenticated,service_role;


-- Public honor and Master Award catalogs; preserve existing IDs and member references.
insert into public.honors(name,category,skill_level,year,is_master_award) values
('3D Printing','Vocational',2,2026,false),
('Aboriginal Lore','Arts & Crafts',1,2001,false),
('Abraham & Sand Art','Florida',null,2007,false),
('Abseiling','Recreation',1,2001,false),
('Abseiling - Advanced','Recreation',3,2001,false),
('Abseiling - Instructor','Recreation',3,null,false),
('Accounting','Vocational',3,1938,false),
('Adapted Sports','Recreation',1,2012,false),
('Adolescent Mental Health Response','Health & Science',2,2024,false),
('Adventist Church Heritage','Florida',null,null,false),
('Adventist Pioneer Heritage','Outreach',2,2014,false),
('Adventurer for Christ','Outreach',1,1989,false),
('Adventurer for Christ - Advanced','Outreach',2,1989,false),
('African American Adventist Heritage in the NAD','Outreach',1,2010,false),
('African American Adventist Heritage in the NAD - Advanced','Outreach',2,2010,false),
('African Lore','Arts & Crafts',1,2001,false),
('Agriculture','Outdoor Industries',2,1929,false),
('Airplane Modeling','Arts & Crafts',1,1944,false),
('Alive Bible','Outreach',1,2014,false),
('Alternative Fuels','Nature',2,2014,false),
('Alternative Fuels - Advanced','Nature',3,2014,false),
('Amphibians','Nature',1,1945,false),
('Amphibians - Advanced','Nature',3,2001,false),
('Ancient Technology','Florida',2,2022,false),
('Angklung','Arts & Crafts',1,2023,false),
('Animal Camouflage','Nature',1,2015,false),
('Animal Camouflage - Advanced','Nature',2,2015,false),
('Animal Tracking','Nature',1,1976,false),
('Animal Tracking - Advanced','Nature',2,2001,false),
('Antelopes','Nature',1,2001,false),
('Antelopes - Advanced','Nature',2,2001,false),
('Arboriculture','Vocational',3,2024,false),
('Archery','Recreation',1,1945,false),
('Archery - Advanced','Recreation',2,1976,false),
('Artificial Intelligence','Vocational',2,2014,false),
('Audio Technician','Vocational',2,2024,false),
('Automobile Mechanics','Vocational',2,1928,false),
('Automobile Mechanics - Advanced','Vocational',3,1964,false),
('Aviators','Vocational',2,2015,false),
('Backpacking','Recreation',2,1986,false),
('Backpacking - Advanced','Recreation',3,2012,false),
('Baking','Household Arts',1,1945,false),
('Barbering and Hairstyling','Vocational',3,1938,false),
('Basic Rescue','Health & Science',1,1986,false),
('Basic Sewing','Household Arts',1,1976,false),
('Basic Water Safety','Recreation',1,2011,false),
('Basketball','Recreation',1,1999,false),
('Basketry','Arts & Crafts',2,1937,false),
('Bats','Nature',1,2004,false),
('Bats - Advanced','Nature',2,2004,false),
('Beekeeping','Outdoor Industries',2,1929,false),
('Bible Discovery I','Outreach',1,2019,false),
('Bible Discovery I - Advanced','Outreach',1,2019,false),
('Bible Discovery II','Outreach',1,2019,false),
('Bible Discovery II - Advanced','Outreach',1,2019,false),
('Bible Discovery III','Outreach',2,2019,false),
('Bible Discovery III - Advanced','Outreach',2,2019,false),
('Bible Discovery IV','Outreach',2,2019,false),
('Bible Discovery IV - Advanced','Outreach',2,2019,false),
('Bible Discovery V','Outreach',3,2019,false),
('Bible Discovery V - Advanced','Outreach',3,2019,false),
('Bible Discovery VI','Outreach',3,2019,false),
('Bible Discovery VI - Advanced','Outreach',3,2019,false),
('Bible Evangelism','Vocational',2,1938,false),
('Bible Marking','Outreach',2,2001,false),
('Bible Marking - Advanced','Outreach',3,2001,false),
('Biblical Archaeology','Outreach',2,2012,false),
('Biblical Language (Hebrew)','Outreach',1,2020,false),
('Biblical Language (Hebrew) - Advanced','Outreach',2,2020,false),
('Biodiversity','Nature',1,2024,false),
('Biosafety','Health & Science',1,2020,false),
('Bird Pets','Nature',1,1945,false),
('Birds','Nature',1,1928,false),
('Birds - Advanced','Nature',3,1949,false),
('Blacksmithing','Vocational',2,2015,false),
('Block Printing','Arts & Crafts',2,1945,false),
('Blood and the Body''s Defenses','Health & Science',2,2000,false),
('Bogs & Fens','Nature',2,2014,false),
('Bogs & Fens - Advanced','Nature',3,2014,false),
('Bones, Muscles, and Movement','Health & Science',2,1999,false),
('Bookbinding','Vocational',3,1935,false),
('Bookkeeping','Vocational',2,1937,false),
('Braiding','Arts & Crafts',1,1972,false),
('Braiding - Advanced','Arts & Crafts',2,1976,false),
('Braille','Outreach',1,2020,false),
('Brain and Behavior','Health & Science',2,1999,false),
('Bread Dough','Arts & Crafts',1,1976,false),
('Bridges','Arts & Crafts',1,2012,false),
('Bubbles','Nature',2,2015,false),
('Bully Prevention I','Outreach',1,2018,false),
('Bully Prevention II','Outreach',2,2018,false),
('Business','Vocational',2,2015,false),
('Cacti','Nature',1,1944,false),
('Cacti - Advanced','Nature',3,1999,false),
('Cake Decorating','Arts & Crafts',2,1972,false),
('Camp Craft','Recreation',1,1929,false),
('Camp Safety','Recreation',2,2009,false),
('Camp Safety - Advanced','Recreation',3,2009,false),
('Camping Skills I','Recreation',1,1986,false),
('Camping Skills II','Recreation',1,1986,false),
('Camping Skills III','Recreation',2,1986,false),
('Camping Skills IV','Recreation',2,1986,false),
('Candle Making','Arts & Crafts',1,1972,false),
('Canoe Building','Recreation',3,2001,false),
('Canoeing','Recreation',2,1945,false),
('Canoeing - Advanced','Recreation',2,2013,false),
('Card Making','Arts & Crafts',1,2010,false),
('Carpentry','Vocational',2,1929,false),
('Cats','Nature',1,1945,false),
('Cats - Advanced','Nature',2,2001,false),
('Cattle Husbandry','Outdoor Industries',2,1944,false),
('Caving','Recreation',2,1973,false),
('Caving - Advanced','Recreation',3,1973,false),
('Ceramics','Arts & Crafts',2,1956,false),
('Cetaceans','Nature',2,2001,false),
('Chemistry','Health & Science',2,1937,false),
('Child Care','Outreach',1,2001,false),
('Christian Art of Preaching','Outreach',2,2012,false),
('Christian Art of Preaching - Advanced','Outreach',3,2012,false),
('Christian Citizenship','Outreach',1,1938,false),
('Christian Drama','Outreach',2,2006,false),
('Christian Grooming & Manners','Outreach',2,1975,false),
('Christian Sales Principles','Vocational',2,1956,false),
('Christian Storytelling','Outreach',2,1928,false),
('Christian Team Building','Outreach',2,2016,false),
('Christian Visitation','Outreach',2,2016,false),
('Climate Science','Nature',2,2019,false),
('Climate Science - Advanced','Nature',3,2019,false),
('Coal','Nature',1,2024,false),
('Cold Weather Survival','Recreation',1,2012,false),
('Communications','Vocational',2,1953,false),
('Communications - Advanced','Vocational',3,1956,false),
('Community Improvement','Outreach',3,2009,false),
('Community Water Safety','Recreation',3,1929,false),
('Community Water Safety - Advanced','Recreation',3,1929,false),
('Computers','Vocational',1,1986,false),
('Computers - Advanced','Vocational',2,1986,false),
('Computers and Mobile Devices','Vocational',1,2021,false),
('Computers and Mobile Devices - Advanced','Vocational',2,2021,false),
('Cooking','Household Arts',1,1928,false),
('Cooking - Advanced','Household Arts',2,1956,false),
('Copper Enameling','Arts & Crafts',1,1972,false),
('Copper Enameling - Advanced','Arts & Crafts',3,1972,false),
('Coral Reefs','Nature',1,2018,false),
('Coral Reefs - Advanced','Nature',2,2018,false),
('Counted Cross Stitch','Arts & Crafts',2,1986,false),
('CPR','Health & Science',2,1986,false),
('Creation','Florida',null,2014,false),
('Creationism','Outreach',2,2012,false),
('Creationism - Advanced','Outreach',3,2012,false),
('Crime Prevention','Florida',null,1986,false),
('Crisis Intervention','Outreach',3,2009,false),
('Crocheting','Arts & Crafts',2,1970,false),
('Crocheting - Advanced','Arts & Crafts',3,1970,false),
('Cryptography','Vocational',1,2025,false),
('Crystals','Florida',null,null,false),
('Cultural Diversity Appreciation','Outreach',2,1929,false),
('Cultural Food Preparation','Household Arts',2,2001,false),
('Cultural Heritage','Arts & Crafts',2,null,false),
('Currency','Arts & Crafts',2,1945,false),
('Currency - Advanced','Arts & Crafts',3,1998,false),
('Cybersecurity (SSD)','Vocational',3,2024,false),
('Cybersecurity (SSD) - Advanced','Vocational',3,2024,false),
('Cycling','Recreation',1,1933,false),
('Cycling - Advanced','Recreation',2,1976,false),
('Dairying','Outdoor Industries',2,1929,false),
('Dams & Hydroelectricity','Vocational',2,2022,false),
('Dams and Levees','Arts & Crafts',2,2024,false),
('Daniel and Drama','Florida',null,2014,false),
('Decoupage','Arts & Crafts',1,1975,false),
('Dental Health','Health & Science',2,2026,false),
('Digestion','Health & Science',2,1999,false),
('Digital Photography','Arts & Crafts',2,2006,false),
('Dinosaurs','Nature',1,2012,false),
('Disability Awareness','Florida',null,null,false),
('Disability Awareness - Advanced','Florida',null,null,false),
('Disaster Ministries','Outreach',1,2009,false),
('Disc Golf','Recreation',2,2023,false),
('Disciples and Apostles','Outreach',2,2016,false),
('Dog Care and Training','Nature',2,1976,false),
('Dogs','Nature',1,1950,false),
('Drawing','Arts & Crafts',2,2013,false),
('Drawing - Advanced','Arts & Crafts',3,2013,false),
('Dressmaking','Household Arts',1,1929,false),
('Dressmaking - Advanced','Household Arts',2,1956,false),
('Drilling & Marching','Recreation',1,1976,false),
('Drilling & Marching - Advanced','Recreation',2,1976,false),
('Drones','Vocational',1,2023,false),
('Drumming & Percussion','Recreation',2,2006,false),
('Drumming & Percussion - Advanced','Recreation',3,2009,false),
('Duct Tape','Arts & Crafts',1,2016,false),
('Dunes','Nature',2,2013,false),
('Dunes - Advanced','Nature',3,2013,false),
('Dutch Oven Cooking','Recreation',2,2006,false),
('Early Adventist Missionaries','Outreach',2,2025,false),
('Ecology','Nature',2,1972,false),
('Ecology - Advanced','Nature',3,1972,false),
('Edible Wild Plants','Nature',2,1970,false),
('Electricity','Vocational',1,1929,false),
('Endangered Species','Nature',2,2005,false),
('Engineering','Vocational',2,2014,false),
('Environmental Conservation','Nature',2,1973,false),
('Esther and Gourmet Cooking','Florida',null,2007,false),
('Eucalypts','Nature',1,null,false),
('Explosion Box Craft','Arts & Crafts',2,2021,false),
('Family Life','Outreach',1,1975,false),
('Feeding Ministries','Outreach',1,2009,false),
('Felt Craft','Arts & Crafts',1,1956,false),
('Ferns','Nature',2,1944,false),
('Fire Building & Camp Cookery','Recreation',2,1956,false),
('Fire Safety','Vocational',1,2012,false),
('First Aid','Health & Science',2,1938,false),
('First Aid - Advanced','Health & Science',3,1963,false),
('First Aid, Basic','Health & Science',1,1951,false),
('First Aid, Standard','Health & Science',2,1938,false),
('Fishes','Nature',2,1945,false),
('Flag Football','Recreation',1,2018,false),
('Flags','Outreach',1,2013,false),
('Flags - Advanced','Outreach',2,2013,false),
('Flower Arrangement','Arts & Crafts',2,1938,false),
('Flower Culture','Outdoor Industries',1,1938,false),
('Flowers','Nature',2,1928,false),
('Flowers - Advanced','Nature',3,1949,false),
('Food - Canning','Household Arts',2,1929,false),
('Food - Drying','Household Arts',2,1986,false),
('Food - Freezing','Household Arts',2,1986,false),
('Foreign Mission Trips','Outreach',2,2016,false),
('Forestry','Vocational',2,2008,false),
('Forestry - Advanced','Vocational',3,2009,false),
('Fossils','Nature',2,1944,false),
('Fruit Growing','Outdoor Industries',2,1929,false),
('Fungi','Nature',2,1937,false),
('Gardening','Outdoor Industries',1,1928,false),
('Genealogy','Arts & Crafts',2,2006,false),
('Genealogy - Advanced','Arts & Crafts',3,2006,false),
('Geocaching','Recreation',1,2005,false),
('Geocaching - Advanced','Recreation',2,2005,false),
('Geological Geocaching','Recreation',2,2012,false),
('Geological Geocaching - Advanced','Recreation',3,2012,false),
('Geology','Nature',1,1975,false),
('Geology - Advanced','Nature',2,1975,false),
('Gift Wrapping','Arts & Crafts',1,2015,false),
('Glaciers','Nature',2,2024,false),
('Glass Craft','Arts & Crafts',1,1970,false),
('Glass Etching','Arts & Crafts',1,1997,false),
('Glass Painting','Arts & Crafts',1,1938,false),
('Goat Husbandry','Outdoor Industries',2,1986,false),
('God''s Messenger','Outreach',1,2014,false),
('Gold Prospecting','Recreation',1,2008,false),
('Gold Prospecting - Advanced','Recreation',2,2008,false),
('Golf','Recreation',2,2016,false),
('Grasses','Nature',3,1945,false),
('Grasslands','Nature',2,2022,false),
('Great Ball Contraption','Arts & Crafts',1,2026,false),
('Great Ball Contraption - Advanced','Arts & Crafts',2,2026,false),
('Guitar','Arts & Crafts',2,2012,false),
('Guitar - Advanced','Arts & Crafts',3,2012,false),
('Hammock Camping','Recreation',1,2026,false),
('Health and Healing','Vocational',2,1928,false),
('Heart and Circulation','Health & Science',1,2006,false),
('Herbs','Nature',1,2001,false),
('Heredity','Health & Science',3,2004,false),
('High Ropes','Florida',null,null,false),
('High Ropes - Advanced','Florida',null,null,false),
('Hiking','Recreation',1,1933,false),
('Home Maintenance','Florida',2,null,false),
('Home Nursing','Health & Science',2,1938,false),
('Horse Husbandry','Outdoor Industries',1,1944,false),
('Horsemanship','Recreation',1,1961,false),
('Horsemanship - Advanced','Recreation',2,2000,false),
('Hot Air Balloons','Arts & Crafts',1,2008,false),
('House Painting, Exterior','Vocational',3,1938,false),
('House Painting, Interior','Vocational',3,1938,false),
('House Plants','Nature',2,1976,false),
('Household Budgeting','Household Arts',2,2023,false),
('Housekeeping','Household Arts',2,1929,false),
('Hurricanes','Florida',null,null,false),
('Hydroponics and Aquaponics','Outdoor Industries',2,2021,false),
('Hydroponics and Aquaponics - Advanced','Outdoor Industries',2,2021,false),
('Hymns','Outreach',1,2017,false),
('Ice Skating','Recreation',2,2026,false),
('Identifying Community Needs','Outreach',1,2009,false),
('Insects','Nature',1,1933,false),
('Insects - Advanced','Nature',2,1949,false),
('Internet','Vocational',2,2006,false),
('Internet - Advanced','Vocational',3,2006,false),
('Introduction to Adventist Pioneer Heritage','Outreach',1,2024,false),
('Island Fishing','Outdoor Industries',2,2001,false),
('Jesus I - His Life','Outreach',1,2019,false),
('Jesus II - My Savior','Outreach',1,2019,false),
('Jesus III - His Miracles','Outreach',2,2019,false),
('Jesus IV - Method of Mission','Outreach',2,2019,false),
('Jesus V - His Teachings','Outreach',2,2019,false),
('Jesus VI - In Prophecy','Outreach',2,2019,false),
('Jonah & Paper Maché','Florida',null,null,false),
('Joseph Tie-Dying','Florida',null,2007,false),
('Journalism','Vocational',2,1938,false),
('Judges of Israel','Outreach',2,2018,false),
('Juggling','Recreation',1,2019,false),
('Junior Witness','Outreach',2,1970,false),
('Junior Youth Leadership','Outreach',3,1945,false),
('Kanzashi','Arts & Crafts',1,2015,false),
('Kayaking','Recreation',2,2001,false),
('Kings of Israel','Outreach',1,2017,false),
('Kites','Recreation',1,1986,false),
('Knitting','Arts & Crafts',2,1970,false),
('Knitting - Advanced','Arts & Crafts',3,1970,false),
('Knot Tying','Recreation',2,1975,false),
('Land Surveying','Vocational',2,2023,false),
('Language Study','Outreach',2,1938,false),
('Lapidary','Arts & Crafts',2,1967,false),
('Lashing','Recreation',1,2018,false),
('Lashing - Advanced','Recreation',2,2018,false),
('Laundering','Household Arts',1,1928,false),
('Leather Craft','Arts & Crafts',1,1937,false),
('Leather Craft - Advanced','Arts & Crafts',2,1977,false),
('Legacy of Healing','Health & Science',2,2024,false),
('LEGO® Design','Arts & Crafts',1,2014,false),
('Letterboxing','Recreation',1,2008,false),
('Letterboxing - Advanced','Recreation',2,2008,false),
('Lettering & Poster Making','Arts & Crafts',2,1933,false),
('Lichens, Liverworts & Mosses','Nature',3,1961,false),
('Lifesaving','Recreation',3,1929,false),
('Lifesaving - Advanced','Recreation',3,1963,false),
('Lighthouses','Arts & Crafts',1,2007,false),
('Lighthouses - Advanced','Arts & Crafts',3,2007,false),
('Literature Evangelism','Outreach',1,1928,false),
('Livestock','Nature',2,1945,false),
('Macramé','Arts & Crafts',1,1975,false),
('Magnets','Nature',1,2026,false),
('Mammals','Nature',1,1937,false),
('Mammals - Advanced','Nature',2,1949,false),
('Manatees','Florida',null,null,false),
('Maori Lore','Arts & Crafts',1,null,false),
('Maple Sugar','Nature',1,1989,false),
('Maple Sugar - Advanced','Nature',3,1989,false),
('Marine Algae','Nature',3,1961,false),
('Marine Invertebrates','Nature',2,1956,false),
('Marine Mammals','Nature',2,1991,false),
('Marsupials','Nature',2,2001,false),
('Masonry','Vocational',3,1937,false),
('Mat Making','Household Arts',2,null,false),
('Media Broadcast Ministry','Outreach',2,2016,false),
('Metal Craft','Arts & Crafts',2,1937,false),
('Meteorites','Nature',2,2014,false),
('Microscopic Life','Nature',2,1994,false),
('Midnight Sun','Nature',1,2014,false),
('Migration','Nature',1,2021,false),
('Missionary Life','Outreach',1,2016,false),
('Mobile Technology','Vocational',2,2016,false),
('Model Boats','Arts & Crafts',2,1991,false),
('Model Cars','Arts & Crafts',1,1928,false),
('Model Railroad','Arts & Crafts',2,1967,false),
('Model Rocketry','Arts & Crafts',1,1970,false),
('Model Rocketry - Advanced','Arts & Crafts',2,1970,false),
('Mosaic Tile','Arts & Crafts',1,2020,false),
('Moths & Butterflies','Nature',2,1933,false),
('Mountain Biking','Recreation',2,1998,false),
('Mountain Biking - Advanced','Recreation',3,2021,false),
('Mountains','Nature',1,2012,false),
('Music','Arts & Crafts',1,1929,false),
('Music - Advanced','Arts & Crafts',2,null,false),
('National Parks and Heritage Sites','Recreation',1,2021,false),
('National Parks and Heritage Sites - Advanced','Recreation',2,2021,false),
('Native American Lore','Arts & Crafts',1,1944,false),
('Native American Lore - Advanced','Arts & Crafts',2,1976,false),
('Native Brush Construction','Arts & Crafts',3,null,false),
('Natural Disasters','Florida',null,null,false),
('Navigation','Recreation',2,1953,false),
('Neckwear','Arts & Crafts',1,2024,false),
('Needle Craft','Arts & Crafts',2,1928,false),
('Noah and Balloon Animals','Florida',null,2007,false),
('Noah''s Flood','Outreach',2,2025,false),
('Nutrition','Household Arts',1,1981,false),
('Nutrition - Advanced','Household Arts',3,1986,false),
('Oceans','Nature',2,2022,false),
('Odonates','Nature',2,2011,false),
('Odonates - Advanced','Nature',2,2011,false),
('Optics','Health & Science',2,1962,false),
('Orchids','Nature',1,1964,false),
('Orienteering','Recreation',2,1956,false),
('Origami','Arts & Crafts',1,1997,false),
('Outdoor Leadership','Recreation',3,1986,false),
('Outdoor Leadership - Advanced','Recreation',3,1986,false),
('Painting','Arts & Crafts',2,2013,false),
('Painting - Advanced','Arts & Crafts',2,2013,false),
('Palm Trees','Nature',2,2001,false),
('Pandemic','Health & Science',2,2021,false),
('Paper Maché','Arts & Crafts',1,null,false),
('Paper Quilling','Arts & Crafts',1,2006,false),
('Paper Quilling - Advanced','Arts & Crafts',2,2006,false),
('Paperhanging','Vocational',3,1938,false),
('Parade Floats','Outreach',2,2009,false),
('Parade Floats - Advanced','Outreach',3,2009,false),
('Parrots and Cockatoos','Nature',2,2001,false),
('Patriarchs of the Bible','Outreach',1,2017,false),
('Peace Maker','Outreach',1,2009,false),
('Peace Maker - Advanced','Outreach',2,2009,false),
('Personal Evangelism','Outreach',2,1938,false),
('Personal Health and Wellness','Health & Science',2,2024,false),
('Pewter Casting','Vocational',1,2023,false),
('Photography','Arts & Crafts',2,1928,false),
('Physical Fitness','Recreation',2,1929,false),
('Physics','Health & Science',2,1989,false),
('Pickleball','Recreation',2,2019,false),
('Pigeon Raising','Outdoor Industries',2,1944,false),
('Pin Trading','Arts & Crafts',1,2014,false),
('Pin Trading - Advanced','Arts & Crafts',2,2014,false),
('Pinecar Derby','Arts & Crafts',1,1999,false),
('Pinecar Derby - Advanced','Arts & Crafts',2,1999,false),
('Pioneering','Recreation',2,1956,false),
('Pizza Maker','Household Arts',1,2014,false),
('Plaster Craft','Arts & Crafts',1,1967,false),
('Plastic Canvas','Arts & Crafts',1,2006,false),
('Plastic Canvas - Advanced','Arts & Crafts',2,2006,false),
('Plastics','Arts & Crafts',2,1961,false),
('Plumbing','Vocational',3,1938,false),
('Poetry and Songwriting','Arts & Crafts',1,2020,false),
('Postcards','Arts & Crafts',1,2011,false),
('Postcards - Advanced','Arts & Crafts',3,2013,false),
('Pottery','Arts & Crafts',2,1938,false),
('Poultry','Nature',2,1928,false),
('Poultry Raising','Outdoor Industries',1,1928,false),
('Power Boating','Recreation',2,1975,false),
('Praise and Worship','Outreach',2,2020,false),
('Prayer','Outreach',1,2011,false),
('Prayer - Advanced','Outreach',2,2011,false),
('Preach It','Outreach',2,2009,false),
('Preach It - Advanced','Outreach',3,2009,false),
('Predatory Plants','Nature',2,2022,false),
('Printing','Vocational',2,1929,false),
('Prophets & Prophecy','Outreach',2,2017,false),
('Prophets & Prophecy - Advanced','Outreach',3,2017,false),
('Puppetry','Outreach',2,null,false),
('Puppetry - Advanced','Outreach',3,null,false),
('Quilting','Household Arts',2,1976,false),
('Radio','Vocational',2,1928,false),
('Radio - Advanced','Vocational',2,1956,false),
('Radio Electronics','Vocational',2,1938,false),
('Rainforests','Nature',1,2016,false),
('Raptors','Nature',1,2015,false),
('Raptors - Advanced','Nature',3,2015,false),
('Recycling','Nature',1,2012,false),
('Red Alert','Health & Science',1,1986,false),
('Red Alert I','Health & Science',1,1986,false),
('Red Alert II','Health & Science',1,2022,false),
('Refugee Assistance','Outreach',1,2009,false),
('Renewable Energy','Nature',2,2014,false),
('Reptiles','Nature',1,1937,false),
('Reptiles - Advanced','Nature',3,2001,false),
('Rivers and Streams','Nature',2,2011,false),
('Rivers and Streams - Advanced','Nature',2,2012,false),
('Robotics','Vocational',1,2016,false),
('Robotics - Advanced','Vocational',2,2016,false),
('Rock Climbing','Recreation',2,1970,false),
('Rock Climbing - Advanced','Recreation',3,1970,false),
('Rocks & Minerals','Nature',2,1937,false),
('Rocks & Minerals - Advanced','Nature',3,1949,false),
('Rowing','Recreation',2,1956,false),
('Rural Development','Outreach',2,2009,false),
('Sabbath Appreciation','Outreach',1,2021,false),
('Sailing','Recreation',2,1953,false),
('Sanctuary','Outreach',2,2004,false),
('Sanctuary - Advanced','Outreach',3,2019,false),
('Sand','Nature',1,1956,false),
('Scrapbooking (2004)','Arts & Crafts',1,2004,false),
('Scrapbooking (Unknown)','Florida',2,null,false),
('Scrapbooking - Advanced (2004)','Arts & Crafts',2,2004,false),
('Scrapbooking - Advanced (Unknown)','Florida',3,null,false),
('Scuba Diving','Recreation',3,1967,false),
('Scuba Diving - Advanced','Recreation',3,1967,false),
('Sculpturing','Arts & Crafts',2,1945,false),
('Search and Rescue','Health & Science',2,2025,false),
('Seeds','Nature',1,1961,false),
('Seeds - Advanced','Nature',2,1961,false),
('Serving Communities','Outreach',1,2009,false),
('Sharks','Nature',1,2013,false),
('Sheep Husbandry','Outdoor Industries',1,1944,false),
('Shells','Nature',2,1938,false),
('Shells - Advanced','Nature',3,1949,false),
('Shoe Repair','Vocational',3,1928,false),
('Shorthand','Vocational',3,1929,false),
('Shrubs','Nature',1,1945,false),
('Sign Language','Outreach',1,1978,false),
('Sign Language - Advanced','Outreach',2,1991,false),
('Signs, Signals and Symbols','Vocational',1,2023,false),
('Silk Screen Printing','Arts & Crafts',2,1974,false),
('Silk Screen Printing - Advanced','Arts & Crafts',3,1974,false),
('Skateboarding','Recreation',2,1986,false),
('Sketching','Florida',null,null,false),
('Skiing - Cross Country','Recreation',2,1986,false),
('Skiing Downhill','Recreation',2,1938,false),
('Skin Diving','Recreation',2,1961,false),
('Slow-Pitch Softball','Recreation',1,2006,false),
('Small Engines','Vocational',2,1975,false),
('Small Fruit Growing','Outdoor Industries',2,1986,false),
('Small Group Bible Study','Outreach',1,2016,false),
('Small Group Bible Study - Advanced','Outreach',3,2016,false),
('Small Mammal Pets','Nature',2,1997,false),
('Snowshoeing','Recreation',1,2010,false),
('Snowshoeing - Advanced','Recreation',3,2010,false),
('Soap Craft','Arts & Crafts',1,1964,false),
('Soap Craft - Advanced','Arts & Crafts',2,1964,false),
('Soap Making','Vocational',3,2018,false),
('Soap Making - Advanced','Vocational',3,2018,false),
('Soccer','Recreation',1,1989,false),
('Social Determinants of Health','Health & Science',2,2024,false),
('Social Media','Vocational',2,2014,false),
('Soils','Nature',1,2006,false),
('Space Exploration','Florida',null,2006,false),
('Spiders','Nature',2,1928,false),
('Spinning Yarn','Arts & Crafts',1,2018,false),
('Springboard Diving','Recreation',2,1964,false),
('Spy Danger','Vocational',1,2024,false),
('Stamps','Arts & Crafts',2,1933,false),
('Stamps - Advanced','Arts & Crafts',3,1933,false),
('Stars','Nature',2,1928,false),
('Stars - Advanced','Nature',3,1949,false),
('State Study','Florida',null,2007,false),
('Stewardship','Outreach',2,1986,false),
('Street Art','Arts & Crafts',2,2020,false),
('String Art','Arts & Crafts',1,1975,false),
('Subsistence Farming','Outdoor Industries',2,2001,false),
('Superfoods','Health & Science',2,2024,false),
('Swimming','Recreation',2,1929,false),
('Swimming - Advanced','Recreation',2,1961,false),
('Swimming - Beginner','Recreation',1,1944,false),
('Swimming - Beginner - Advanced','Recreation',1,1963,false),
('Swimming - Intermediate','Recreation',2,1929,false),
('Taiga','Nature',1,2014,false),
('Taiga - Advanced','Nature',2,2014,false),
('Tailoring','Household Arts',3,1938,false),
('Tapa Cloth','Household Arts',1,null,false),
('Teaching','Vocational',2,1944,false),
('Temperance','Outreach',2,1976,false),
('Temperate Deciduous Forests','Nature',1,2016,false),
('Temperate Grasslands','Nature',1,2023,false),
('Temperate Grasslands - Advanced','Nature',2,2023,false),
('Tennis','Recreation',2,2018,false),
('Tents','Recreation',1,2014,false),
('Textile Painting','Arts & Crafts',2,1956,false),
('Thatching','Arts & Crafts',2,null,false),
('Three Angels'' Messages','Outreach',2,2023,false),
('Tides','Florida',null,null,false),
('Tides - Advanced','Florida',null,null,false),
('Tie-Dye','Arts & Crafts',1,2006,false),
('Tie-Dye - Advanced','Arts & Crafts',2,2015,false),
('Tile Laying','Vocational',3,2020,false),
('Tole Painting','Arts & Crafts',1,2018,false),
('Toy Boat Regatta','Arts & Crafts',1,2021,false),
('Toy Boat Regatta - Advanced','Arts & Crafts',2,2021,false),
('Track & Field','Recreation',2,1978,false),
('Travel','Recreation',1,2009,false),
('Travel - Advanced','Recreation',2,2009,false),
('Tree Climbing','Recreation',2,2001,false),
('Trees','Nature',1,1928,false),
('Trees - Advanced','Nature',3,1949,false),
('Triathlon','Recreation',2,null,false),
('Triathlon - Advanced','Recreation',2,1956,false),
('Tumbling & Balancing','Recreation',2,1976,false),
('Tumbling & Balancing - Advanced','Recreation',2,1976,false),
('Tutoring','Outreach',2,2009,false),
('Typewriting','Vocational',2,1929,false),
('Ultimate Disc','Recreation',1,2011,false),
('Ultimate Disc - Advanced','Recreation',2,2011,false),
('Ultralight Backpacking','Recreation',3,2024,false),
('Unicycling','Recreation',2,2008,false),
('Upholstery','Arts & Crafts',2,null,false),
('Video','Vocational',1,2001,false),
('Video - Advanced','Vocational',2,2020,false),
('Viruses','Health & Science',2,2012,false),
('Visual Media Critique','Vocational',2,2016,false),
('Volcanoes','Florida',1,2007,false),
('Volleyball','Recreation',1,2012,false),
('Wakeboarding','Recreation',1,2006,false),
('Water Safety Instructor','Recreation',3,2011,false),
('Water Safety Instructor - Advanced','Recreation',3,2011,false),
('Water Science','Nature',1,2015,false),
('Water Science - Advanced','Nature',2,2015,false),
('Water Skiing','Recreation',2,1961,false),
('Water Skiing - Advanced','Recreation',2,1961,false),
('Waterfalls','Nature',1,2011,false),
('Wattles','Nature',1,2001,false),
('Weather','Nature',1,1944,false),
('Weather - Advanced','Nature',2,1949,false),
('Weaving','Arts & Crafts',1,1938,false),
('Welding','Vocational',3,1978,false),
('Whistles','Arts & Crafts',1,2007,false),
('Whistles - Advanced','Arts & Crafts',2,2007,false),
('Wilderness Leadership','Recreation',2,1976,false),
('Wilderness Leadership - Advanced','Recreation',3,1976,false),
('Wilderness Living','Recreation',2,1956,false),
('Wildfire Preparation and Prevention','Vocational',2,2025,false),
('Wind Surfing','Recreation',2,1986,false),
('Winter Camping','Recreation',2,1970,false),
('Women in Adventist History','Outreach',3,2023,false),
('Wood Carving','Arts & Crafts',2,1938,false),
('Wood Handicraft','Arts & Crafts',2,1938,false),
('Woodworking','Vocational',2,1934,false),
('Word Processing','Vocational',2,2013,false),
('Worms','Nature',1,2006,false),
('Worms - Advanced','Nature',2,2006,false),
('Aquatic Master Award','Master Award',null,null,true),
('Artisan Master Award','Master Award',null,null,true),
('Conservation Master Award','Master Award',null,null,true),
('Family, Origins, and Heritage Master Award','Master Award',null,null,true),
('Farming Master Award','Master Award',null,null,true),
('Health Master Award','Master Award',null,null,true),
('Homemaking Master Award','Master Award',null,null,true),
('Modern Technology Master Award','Master Award',null,null,true),
('Naturalist Master Award','Master Award',null,null,true),
('Recreation Master Award','Master Award',null,null,true),
('Spiritual Growth and Ministries Master Award','Master Award',null,null,true),
('Sportsman Master Award','Master Award',null,null,true),
('Technician Master Award','Master Award',null,null,true),
('Wilderness Master Award','Master Award',null,null,true),
('Zoology Master Award','Master Award',null,null,true)
on conflict(name) do update set category=excluded.category, skill_level=excluded.skill_level, year=excluded.year, is_master_award=excluded.is_master_award;
insert into public.master_awards(honor_id,required_honor_count,requirements_status,source_url,notes) values ((select id from public.honors where name='Aquatic Master Award'),7,'retrieved','https://wiki.pathfindersonline.org/w/AY_Honors/Aquatic_Master_Award','["Introductory water safety and beginner swimming honors are excluded by the source."]'::jsonb);
insert into public.master_award_groups(award_id,name,sort_order,required_count) values ((select id from public.honors where name='Aquatic Master Award'),'Eligible honors',1,7);
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Aquatic Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Canoeing','Canoeing',1945,(select id from public.honors where name='Canoeing'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Aquatic Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Kayaking','Kayaking',2001,(select id from public.honors where name='Kayaking'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Aquatic Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Navigation','Navigation',1953,(select id from public.honors where name='Navigation'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Aquatic Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Power_Boating','Power Boating',1975,(select id from public.honors where name='Power Boating'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Aquatic Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Rowing','Rowing',1956,(select id from public.honors where name='Rowing'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Aquatic Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Sailing','Sailing',1953,(select id from public.honors where name='Sailing'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Aquatic Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Scuba_Diving','Scuba Diving',1967,(select id from public.honors where name='Scuba Diving'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Aquatic Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Scuba_Diving_-_Advanced','Scuba Diving - Advanced',1967,(select id from public.honors where name='Scuba Diving - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Aquatic Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Skin_Diving','Skin Diving',1961,(select id from public.honors where name='Skin Diving'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Aquatic Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Springboard_Diving','Springboard Diving',1964,(select id from public.honors where name='Springboard Diving'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Aquatic Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Swimming','Swimming',1929,(select id from public.honors where name='Swimming'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Aquatic Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Swimming_-_Advanced','Swimming - Advanced',1961,(select id from public.honors where name='Swimming - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Aquatic Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Swimming_-_Intermediate','Swimming - Intermediate',1929,(select id from public.honors where name='Swimming - Intermediate'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Aquatic Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Water_Skiing','Water Skiing',1961,(select id from public.honors where name='Water Skiing'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Aquatic Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Water_Skiing_-_Advanced','Water Skiing - Advanced',1961,(select id from public.honors where name='Water Skiing - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Aquatic Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Wind_Surfing','Wind Surfing',1986,(select id from public.honors where name='Wind Surfing'),'matched');
insert into public.master_awards(honor_id,required_honor_count,requirements_status,source_url,notes) values ((select id from public.honors where name='Artisan Master Award'),7,'retrieved_needs_mapping_review','https://wiki.pathfindersonline.org/w/AY_Honors/Artisan_Master_Award','[]'::jsonb);
insert into public.master_award_groups(award_id,name,sort_order,required_count) values ((select id from public.honors where name='Artisan Master Award'),'Eligible honors',1,7);
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Flower_Arrangement','Flower Arrangement',1938,(select id from public.honors where name='Flower Arrangement'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Genealogy_-_Advanced','Genealogy - Advanced',2006,(select id from public.honors where name='Genealogy - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Glass_Craft','Glass Craft',1970,(select id from public.honors where name='Glass Craft'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Painting','Painting',2013,(select id from public.honors where name='Painting'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Postcards','Postcards',2011,(select id from public.honors where name='Postcards'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Textile_Painting','Textile Painting',1956,(select id from public.honors where name='Textile Painting'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Wood_Handicraft','Wood Handicraft',1938,(select id from public.honors where name='Wood Handicraft'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Aboriginal_Lore','Aboriginal Lore',2001,(select id from public.honors where name='Aboriginal Lore'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/African_Lore','African Lore',2001,(select id from public.honors where name='African Lore'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Airplane_Modeling','Airplane Modeling',1944,(select id from public.honors where name='Airplane Modeling'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Amigurumi','Amigurumi',2025,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Angklung','Angklung',2023,(select id from public.honors where name='Angklung'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Basketry','Basketry',1937,(select id from public.honors where name='Basketry'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Block_Printing','Block Printing',1945,(select id from public.honors where name='Block Printing'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Braiding','Braiding',1972,(select id from public.honors where name='Braiding'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Braiding_-_Advanced','Braiding - Advanced',1976,(select id from public.honors where name='Braiding - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Bread_Dough','Bread Dough',1976,(select id from public.honors where name='Bread Dough'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Bridges','Bridges',2012,(select id from public.honors where name='Bridges'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Cake_Decorating','Cake Decorating',1972,(select id from public.honors where name='Cake Decorating'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Candle_Making','Candle Making',1972,(select id from public.honors where name='Candle Making'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Card_Making','Card Making',2010,(select id from public.honors where name='Card Making'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Ceramics','Ceramics',1956,(select id from public.honors where name='Ceramics'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Comics','Comics',2012,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Copper_Enameling','Copper Enameling',1972,(select id from public.honors where name='Copper Enameling'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Copper_Enameling_-_Advanced','Copper Enameling - Advanced',1972,(select id from public.honors where name='Copper Enameling - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Counted_Cross_Stitch','Counted Cross Stitch',1986,(select id from public.honors where name='Counted Cross Stitch'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Crocheting','Crocheting',1970,(select id from public.honors where name='Crocheting'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Crocheting_-_Advanced','Crocheting - Advanced',1970,(select id from public.honors where name='Crocheting - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Cultural_Heritage','Cultural Heritage',null,(select id from public.honors where name='Cultural Heritage'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Currency','Currency',1945,(select id from public.honors where name='Currency'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Currency_-_Advanced','Currency - Advanced',1998,(select id from public.honors where name='Currency - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Dams_and_Levees','Dams and Levees',2024,(select id from public.honors where name='Dams and Levees'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Decoration','Decoration',2012,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/D%C3%A9coupage','Decoupage',1975,(select id from public.honors where name='Decoupage'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Digital_Art','Digital Art',2025,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Digital_Photography','Digital Photography',2006,(select id from public.honors where name='Digital Photography'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Drawing','Drawing',2013,(select id from public.honors where name='Drawing'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Drawing_-_Advanced','Drawing - Advanced',2013,(select id from public.honors where name='Drawing - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Duct_Tape','Duct Tape',2016,(select id from public.honors where name='Duct Tape'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/EVA','EVA',2012,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Explosion_Box_Craft','Explosion Box Craft',2021,(select id from public.honors where name='Explosion Box Craft'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Fabric_Yo-Yo','Fabric Yo-Yo',2012,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Felt_Craft','Felt Craft',1956,(select id from public.honors where name='Felt Craft'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Folk_Art','Folk Art',2011,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Genealogy','Genealogy',2006,(select id from public.honors where name='Genealogy'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Gift_Wrapping','Gift Wrapping',2015,(select id from public.honors where name='Gift Wrapping'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Glass_Etching','Glass Etching',1997,(select id from public.honors where name='Glass Etching'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Glass_Painting','Glass Painting',1938,(select id from public.honors where name='Glass Painting'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Great_Ball_Contraption','Great Ball Contraption',2026,(select id from public.honors where name='Great Ball Contraption'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Great_Ball_Contraption_-_Advanced','Great Ball Contraption - Advanced',2026,(select id from public.honors where name='Great Ball Contraption - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Guitar','Guitar',2012,(select id from public.honors where name='Guitar'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Guitar_(SAD)','Guitar',2012,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Guitar_-_Advanced','Guitar - Advanced',2012,(select id from public.honors where name='Guitar - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Hot_Air_Balloons','Hot Air Balloons',2008,(select id from public.honors where name='Hot Air Balloons'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Kanzashi','Kanzashi',2015,(select id from public.honors where name='Kanzashi'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Knitting','Knitting',1970,(select id from public.honors where name='Knitting'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Knitting_-_Advanced','Knitting - Advanced',1970,(select id from public.honors where name='Knitting - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Lapidary','Lapidary',1967,(select id from public.honors where name='Lapidary'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Leather_Craft','Leather Craft',1937,(select id from public.honors where name='Leather Craft'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Leather_Craft_-_Advanced','Leather Craft - Advanced',1977,(select id from public.honors where name='Leather Craft - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/LEGO%C2%AE_Design','LEGO® Design',2014,(select id from public.honors where name='LEGO® Design'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Lettering','Lettering',2025,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Lettering_%26_Poster_Making','Lettering & Poster Making',1933,(select id from public.honors where name='Lettering & Poster Making'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Lighthouses','Lighthouses',2007,(select id from public.honors where name='Lighthouses'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Lighthouses_-_Advanced','Lighthouses - Advanced',2007,(select id from public.honors where name='Lighthouses - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Macram%C3%A9','Macramé',1975,(select id from public.honors where name='Macramé'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/M%C4%81ori_Lore','Maori Lore',null,(select id from public.honors where name='Maori Lore'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Metal_Craft','Metal Craft',1937,(select id from public.honors where name='Metal Craft'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Model_Boats','Model Boats',1991,(select id from public.honors where name='Model Boats'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Model_Cars','Model Cars',1928,(select id from public.honors where name='Model Cars'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Model_Railroad','Model Railroad',1967,(select id from public.honors where name='Model Railroad'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Model_Rocketry','Model Rocketry',1970,(select id from public.honors where name='Model Rocketry'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Model_Rocketry_-_Advanced','Model Rocketry - Advanced',1970,(select id from public.honors where name='Model Rocketry - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Mosaic_Tile','Mosaic Tile',2020,(select id from public.honors where name='Mosaic Tile'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Music','Music',1929,(select id from public.honors where name='Music'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Music_-_Advanced','Music - Advanced',null,(select id from public.honors where name='Music - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Music_-_Beginners','Music - Beginners',null,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Native_American_Lore','Native American Lore',1944,(select id from public.honors where name='Native American Lore'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Native_American_Lore_-_Advanced','Native American Lore - Advanced',1976,(select id from public.honors where name='Native American Lore - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Native_Brush_Construction','Native Brush Construction',null,(select id from public.honors where name='Native Brush Construction'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Neckwear','Neckwear',2024,(select id from public.honors where name='Neckwear'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Needle_Craft','Needle Craft',1928,(select id from public.honors where name='Needle Craft'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Origami','Origami',1997,(select id from public.honors where name='Origami'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Origami_-_Advanced','Origami - Advanced',2012,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Painting_-_Advanced','Painting - Advanced',2013,(select id from public.honors where name='Painting - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Paper_Mach%C3%A9','Paper Maché',null,(select id from public.honors where name='Paper Maché'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Paper_Quilling','Paper Quilling',2006,(select id from public.honors where name='Paper Quilling'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Paper_Quilling_-_Advanced','Paper Quilling - Advanced',2006,(select id from public.honors where name='Paper Quilling - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Papercraft','Papercraft',2012,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Photography','Photography',1928,(select id from public.honors where name='Photography'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Pin_Trading','Pin Trading',2014,(select id from public.honors where name='Pin Trading'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Pin_Trading_-_Advanced','Pin Trading - Advanced',2014,(select id from public.honors where name='Pin Trading - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Pinecar_Derby','Pinecar Derby',1999,(select id from public.honors where name='Pinecar Derby'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Pinecar_Derby_-_Advanced','Pinecar Derby - Advanced',1999,(select id from public.honors where name='Pinecar Derby - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Plaster_Craft','Plaster Craft',1967,(select id from public.honors where name='Plaster Craft'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Plastic_Canvas','Plastic Canvas',2006,(select id from public.honors where name='Plastic Canvas'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Plastic_Canvas_-_Advanced','Plastic Canvas - Advanced',2006,(select id from public.honors where name='Plastic Canvas - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Plastic_Models','Plastic Models',2012,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Plastics','Plastics',1961,(select id from public.honors where name='Plastics'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Poetry_and_Songwriting','Poetry and Songwriting',2020,(select id from public.honors where name='Poetry and Songwriting'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Postcards_-_Advanced','Postcards - Advanced',2013,(select id from public.honors where name='Postcards - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Pottery','Pottery',1938,(select id from public.honors where name='Pottery'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Pyrography','Pyrography',2012,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Scrapbooking','Scrapbooking',2004,(select id from public.honors where name='Scrapbooking (2004)'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Scrapbooking_-_Advanced','Scrapbooking - Advanced',2004,(select id from public.honors where name='Scrapbooking - Advanced (2004)'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Sculpturing','Sculpturing',1945,(select id from public.honors where name='Sculpturing'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Silk_Screen_Printing','Silk Screen Printing',1974,(select id from public.honors where name='Silk Screen Printing'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Silk_Screen_Printing_-_Advanced','Silk Screen Printing - Advanced',1974,(select id from public.honors where name='Silk Screen Printing - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Soap_Craft','Soap Craft',1964,(select id from public.honors where name='Soap Craft'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Soap_Craft_-_Advanced','Soap Craft - Advanced',1964,(select id from public.honors where name='Soap Craft - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Spinning_Yarn','Spinning Yarn',2018,(select id from public.honors where name='Spinning Yarn'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Stamps','Stamps',1933,(select id from public.honors where name='Stamps'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Stamps_-_Advanced','Stamps - Advanced',1933,(select id from public.honors where name='Stamps - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Street_Art','Street Art',2020,(select id from public.honors where name='Street Art'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/String_Art','String Art',1975,(select id from public.honors where name='String Art'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Thatching','Thatching',null,(select id from public.honors where name='Thatching'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Tie-Dye','Tie-Dye',2006,(select id from public.honors where name='Tie-Dye'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Tie-Dye_-_Advanced','Tie-Dye - Advanced',2015,(select id from public.honors where name='Tie-Dye - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Tole_Painting','Tole Painting',2018,(select id from public.honors where name='Tole Painting'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Toy_Boat_Regatta','Toy Boat Regatta',2021,(select id from public.honors where name='Toy Boat Regatta'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Toy_Boat_Regatta_-_Advanced','Toy Boat Regatta - Advanced',2021,(select id from public.honors where name='Toy Boat Regatta - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Upholstery','Upholstery',null,(select id from public.honors where name='Upholstery'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Vector_Drawing','Vector Drawing',2012,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Weaving','Weaving',1938,(select id from public.honors where name='Weaving'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Whistles','Whistles',2007,(select id from public.honors where name='Whistles'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Whistles_-_Advanced','Whistles - Advanced',2007,(select id from public.honors where name='Whistles - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Artisan Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Wood_Carving','Wood Carving',1938,(select id from public.honors where name='Wood Carving'),'matched');
insert into public.master_awards(honor_id,required_honor_count,requirements_status,source_url,notes) values ((select id from public.honors where name='Conservation Master Award'),7,'retrieved','https://wiki.pathfindersonline.org/w/AY_Honors/Conservation_Master_Award','[]'::jsonb);
insert into public.master_award_groups(award_id,name,sort_order,required_count) values ((select id from public.honors where name='Conservation Master Award'),'Eligible honors',1,7);
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Conservation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Alternative_Fuels','Alternative Fuels',2014,(select id from public.honors where name='Alternative Fuels'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Conservation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Alternative_Fuels_-_Advanced','Alternative Fuels - Advanced',2014,(select id from public.honors where name='Alternative Fuels - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Conservation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Bogs_%26_Fens','Bogs & Fens',2014,(select id from public.honors where name='Bogs & Fens'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Conservation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Bogs_%26_Fens_-_Advanced','Bogs & Fens - Advanced',2014,(select id from public.honors where name='Bogs & Fens - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Conservation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Dunes','Dunes',2013,(select id from public.honors where name='Dunes'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Conservation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Dunes_-_Advanced','Dunes - Advanced',2013,(select id from public.honors where name='Dunes - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Conservation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Ecology','Ecology',1972,(select id from public.honors where name='Ecology'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Conservation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Ecology_-_Advanced','Ecology - Advanced',1972,(select id from public.honors where name='Ecology - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Conservation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Endangered_Species','Endangered Species',2005,(select id from public.honors where name='Endangered Species'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Conservation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Environmental_Conservation','Environmental Conservation',1973,(select id from public.honors where name='Environmental Conservation'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Conservation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Forestry','Forestry',2008,(select id from public.honors where name='Forestry'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Conservation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Forestry_-_Advanced','Forestry - Advanced',2009,(select id from public.honors where name='Forestry - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Conservation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Fossils','Fossils',1944,(select id from public.honors where name='Fossils'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Conservation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Geology','Geology',1975,(select id from public.honors where name='Geology'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Conservation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Geology_-_Advanced','Geology - Advanced',1975,(select id from public.honors where name='Geology - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Conservation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Mountains','Mountains',2012,(select id from public.honors where name='Mountains'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Conservation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Recycling','Recycling',2012,(select id from public.honors where name='Recycling'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Conservation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Renewable_Energy','Renewable Energy',2014,(select id from public.honors where name='Renewable Energy'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Conservation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Rivers_and_Streams','Rivers and Streams',2011,(select id from public.honors where name='Rivers and Streams'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Conservation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Rivers_and_Streams_-_Advanced','Rivers and Streams - Advanced',2012,(select id from public.honors where name='Rivers and Streams - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Conservation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Rocks_%26_Minerals','Rocks & Minerals',1937,(select id from public.honors where name='Rocks & Minerals'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Conservation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Rocks_%26_Minerals_-_Advanced','Rocks & Minerals - Advanced',1949,(select id from public.honors where name='Rocks & Minerals - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Conservation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Sand','Sand',1956,(select id from public.honors where name='Sand'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Conservation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Taiga','Taiga',2014,(select id from public.honors where name='Taiga'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Conservation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Taiga_-_Advanced','Taiga - Advanced',2014,(select id from public.honors where name='Taiga - Advanced'),'matched');
insert into public.master_awards(honor_id,required_honor_count,requirements_status,source_url,notes) values ((select id from public.honors where name='Family, Origins, and Heritage Master Award'),7,'retrieved_needs_mapping_review','https://wiki.pathfindersonline.org/w/AY_Honors/Family,_Origins_and_Heritage_Master_Award','["The current source requires two of the three Heritage choices plus five additional honors. It also permits a division-specific heritage substitution; that substitution needs manual review before use."]'::jsonb);
insert into public.master_award_groups(award_id,name,sort_order,required_count) values ((select id from public.honors where name='Family, Origins, and Heritage Master Award'),'Heritage',1,2);
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Family, Origins, and Heritage Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Adventist_Pioneer_Heritage','Adventist Pioneer Heritage',2014,(select id from public.honors where name='Adventist Pioneer Heritage'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Family, Origins, and Heritage Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/God%27s_Messenger','God''s Messenger',2014,(select id from public.honors where name='God''s Messenger'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Family, Origins, and Heritage Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Introduction_to_Adventist_Pioneer_Heritage','Introduction to Adventist Pioneer Heritage',2024,(select id from public.honors where name='Introduction to Adventist Pioneer Heritage'),'matched');
insert into public.master_award_groups(award_id,name,sort_order,required_count) values ((select id from public.honors where name='Family, Origins, and Heritage Master Award'),'Additional honors',2,5);
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Family, Origins, and Heritage Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Biblical_Archaeology','Biblical Archaeology',2012,(select id from public.honors where name='Biblical Archaeology'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Family, Origins, and Heritage Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Christian_Citizenship','Christian Citizenship',1938,(select id from public.honors where name='Christian Citizenship'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Family, Origins, and Heritage Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Community_Improvement','Community Improvement',2009,(select id from public.honors where name='Community Improvement'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Family, Origins, and Heritage Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Creationism','Creationism',2012,(select id from public.honors where name='Creationism'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Family, Origins, and Heritage Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Creationism_-_Advanced','Creationism - Advanced',2012,(select id from public.honors where name='Creationism - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Family, Origins, and Heritage Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Cultural_Diversity_Appreciation','Cultural Diversity Appreciation',1929,(select id from public.honors where name='Cultural Diversity Appreciation'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Family, Origins, and Heritage Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Eschatology','Eschatology',2012,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Family, Origins, and Heritage Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Family_Life','Family Life',1975,(select id from public.honors where name='Family Life'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Family, Origins, and Heritage Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Flags','Flags',2013,(select id from public.honors where name='Flags'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Family, Origins, and Heritage Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Flags_-_Advanced','Flags - Advanced',2013,(select id from public.honors where name='Flags - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Family, Origins, and Heritage Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Genealogy','Genealogy',2006,(select id from public.honors where name='Genealogy'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Family, Origins, and Heritage Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Language_Study','Language Study',1938,(select id from public.honors where name='Language Study'),'matched');
insert into public.master_awards(honor_id,required_honor_count,requirements_status,source_url,notes) values ((select id from public.honors where name='Farming Master Award'),7,'retrieved_needs_mapping_review','https://wiki.pathfindersonline.org/w/AY_Honors/Farming_Master_Award','[]'::jsonb);
insert into public.master_award_groups(award_id,name,sort_order,required_count) values ((select id from public.honors where name='Farming Master Award'),'Eligible honors',1,7);
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Farming Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Agriculture','Agriculture',1929,(select id from public.honors where name='Agriculture'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Farming Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Beekeeping','Beekeeping',1929,(select id from public.honors where name='Beekeeping'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Farming Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Cattle_Husbandry','Cattle Husbandry',1944,(select id from public.honors where name='Cattle Husbandry'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Farming Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Dairying','Dairying',1929,(select id from public.honors where name='Dairying'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Farming Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Flower_Culture','Flower Culture',1938,(select id from public.honors where name='Flower Culture'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Farming Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Fruit_Growing','Fruit Growing',1929,(select id from public.honors where name='Fruit Growing'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Farming Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Gardening','Gardening',1928,(select id from public.honors where name='Gardening'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Farming Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Goat_Husbandry','Goat Husbandry',1986,(select id from public.honors where name='Goat Husbandry'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Farming Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Horse_Husbandry','Horse Husbandry',1944,(select id from public.honors where name='Horse Husbandry'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Farming Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Hydroponics_and_Aquaponics','Hydroponics and Aquaponics',2021,(select id from public.honors where name='Hydroponics and Aquaponics'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Farming Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Hydroponics_and_Aquaponics_-_Advanced','Hydroponics and Aquaponics - Advanced',2021,(select id from public.honors where name='Hydroponics and Aquaponics - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Farming Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Island_Fishing','Island Fishing',2001,(select id from public.honors where name='Island Fishing'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Farming Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Landscaping','Landscaping',2025,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Farming Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Pigeon_Raising','Pigeon Raising',1944,(select id from public.honors where name='Pigeon Raising'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Farming Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Poultry_Raising','Poultry Raising',1928,(select id from public.honors where name='Poultry Raising'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Farming Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Sheep_Husbandry','Sheep Husbandry',1944,(select id from public.honors where name='Sheep Husbandry'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Farming Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Small_Fruit_Growing','Small Fruit Growing',1986,(select id from public.honors where name='Small Fruit Growing'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Farming Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Subsistence_Farming','Subsistence Farming',2001,(select id from public.honors where name='Subsistence Farming'),'matched');
insert into public.master_awards(honor_id,required_honor_count,requirements_status,source_url,notes) values ((select id from public.honors where name='Health Master Award'),7,'retrieved_needs_mapping_review','https://wiki.pathfindersonline.org/w/AY_Honors/Health_Master_Award','[]'::jsonb);
insert into public.master_award_groups(award_id,name,sort_order,required_count) values ((select id from public.honors where name='Health Master Award'),'Health group 1',1,3);
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Health Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Blood_and_the_Body%27s_Defenses','Blood and the Body''s Defenses',2000,(select id from public.honors where name='Blood and the Body''s Defenses'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Health Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Bones,_Muscles,_and_Movement','Bones, Muscles, and Movement',1999,(select id from public.honors where name='Bones, Muscles, and Movement'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Health Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Brain_and_Behavior','Brain and Behavior',1999,(select id from public.honors where name='Brain and Behavior'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Health Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Child_Care','Child Care',2001,(select id from public.honors where name='Child Care'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Health Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Digestion','Digestion',1999,(select id from public.honors where name='Digestion'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Health Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Health_and_Healing_(GC)','Health and Healing',1928,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Health Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Home_Nursing','Home Nursing',1938,(select id from public.honors where name='Home Nursing'),'matched');
insert into public.master_award_groups(award_id,name,sort_order,required_count) values ((select id from public.honors where name='Health Master Award'),'Health group 2',2,2);
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Health Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Basic_Rescue','Basic Rescue',1986,(select id from public.honors where name='Basic Rescue'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Health Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/CPR','CPR',1986,(select id from public.honors where name='CPR'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Health Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/First_Aid','First Aid',1938,(select id from public.honors where name='First Aid'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Health Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/First_Aid,_Basic','First Aid, Basic',1951,(select id from public.honors where name='First Aid, Basic'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Health Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/First_Aid,_Standard','First Aid, Standard',1938,(select id from public.honors where name='First Aid, Standard'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Health Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Red_Alert','Red Alert',1986,(select id from public.honors where name='Red Alert'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Health Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Red_Alert_I','Red Alert I',1986,(select id from public.honors where name='Red Alert I'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Health Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Red_Alert_II','Red Alert II',2022,(select id from public.honors where name='Red Alert II'),'matched');
insert into public.master_award_groups(award_id,name,sort_order,required_count) values ((select id from public.honors where name='Health Master Award'),'Health group 3',3,2);
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Health Master Award') and sort_order=3),'https://wiki.pathfindersonline.org/w/AY_Honors/Chemistry','Chemistry',1937,(select id from public.honors where name='Chemistry'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Health Master Award') and sort_order=3),'https://wiki.pathfindersonline.org/w/AY_Honors/Microscopic_Life','Microscopic Life',1994,(select id from public.honors where name='Microscopic Life'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Health Master Award') and sort_order=3),'https://wiki.pathfindersonline.org/w/AY_Honors/Optics','Optics',1962,(select id from public.honors where name='Optics'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Health Master Award') and sort_order=3),'https://wiki.pathfindersonline.org/w/AY_Honors/Physics','Physics',1989,(select id from public.honors where name='Physics'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Health Master Award') and sort_order=3),'https://wiki.pathfindersonline.org/w/AY_Honors/Viruses','Viruses',2012,(select id from public.honors where name='Viruses'),'matched');
insert into public.master_awards(honor_id,required_honor_count,requirements_status,source_url,notes) values ((select id from public.honors where name='Homemaking Master Award'),7,'retrieved_needs_mapping_review','https://wiki.pathfindersonline.org/w/AY_Honors/Homemaking_Master_Award','[]'::jsonb);
insert into public.master_award_groups(award_id,name,sort_order,required_count) values ((select id from public.honors where name='Homemaking Master Award'),'Eligible honors',1,7);
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Homemaking Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Baking','Baking',1945,(select id from public.honors where name='Baking'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Homemaking Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Basic_Sewing','Basic Sewing',1976,(select id from public.honors where name='Basic Sewing'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Homemaking Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Cooking','Cooking',1928,(select id from public.honors where name='Cooking'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Homemaking Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Cooking_-_Advanced','Cooking - Advanced',1956,(select id from public.honors where name='Cooking - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Homemaking Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Cultural_Food_Preparation','Cultural Food Preparation',2001,(select id from public.honors where name='Cultural Food Preparation'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Homemaking Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Dressmaking','Dressmaking',1929,(select id from public.honors where name='Dressmaking'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Homemaking Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Dressmaking_-_Advanced','Dressmaking - Advanced',1956,(select id from public.honors where name='Dressmaking - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Homemaking Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Food_-_Canning','Food - Canning',1929,(select id from public.honors where name='Food - Canning'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Homemaking Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Food_-_Drying','Food - Drying',1986,(select id from public.honors where name='Food - Drying'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Homemaking Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Food_-_Freezing','Food - Freezing',1986,(select id from public.honors where name='Food - Freezing'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Homemaking Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Household_Budgeting','Household Budgeting',2023,(select id from public.honors where name='Household Budgeting'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Homemaking Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Household_Budgeting_(SAD)','Household Budgeting',2012,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Homemaking Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Housekeeping','Housekeeping',1929,(select id from public.honors where name='Housekeeping'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Homemaking Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Laundering','Laundering',1928,(select id from public.honors where name='Laundering'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Homemaking Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Making_Pizza','Making Pizza',2025,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Homemaking Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Mat_Making','Mat Making',null,(select id from public.honors where name='Mat Making'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Homemaking Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Nutrition','Nutrition',1981,(select id from public.honors where name='Nutrition'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Homemaking Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Nutrition_-_Advanced','Nutrition - Advanced',1986,(select id from public.honors where name='Nutrition - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Homemaking Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Pizza_Maker','Pizza Maker',2014,(select id from public.honors where name='Pizza Maker'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Homemaking Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Quilting','Quilting',1976,(select id from public.honors where name='Quilting'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Homemaking Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Tailoring','Tailoring',1938,(select id from public.honors where name='Tailoring'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Homemaking Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Tapa_Cloth','Tapa Cloth',null,(select id from public.honors where name='Tapa Cloth'),'matched');
insert into public.master_awards(honor_id,required_honor_count,requirements_status,source_url,notes) values ((select id from public.honors where name='Modern Technology Master Award'),7,'retrieved_needs_mapping_review','https://wiki.pathfindersonline.org/w/AY_Honors/Modern_Technology_Master_Award','[]'::jsonb);
insert into public.master_award_groups(award_id,name,sort_order,required_count) values ((select id from public.honors where name='Modern Technology Master Award'),'Eligible honors',1,7);
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Modern Technology Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Artificial_Intelligence','Artificial Intelligence',2014,(select id from public.honors where name='Artificial Intelligence'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Modern Technology Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Computers','Computers',1986,(select id from public.honors where name='Computers'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Modern Technology Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Computers_-_Advanced','Computers - Advanced',1986,(select id from public.honors where name='Computers - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Modern Technology Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Computers_and_Mobile_Devices','Computers and Mobile Devices',2021,(select id from public.honors where name='Computers and Mobile Devices'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Modern Technology Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Computers_and_Mobile_Devices_-_Advanced','Computers and Mobile Devices - Advanced',2021,(select id from public.honors where name='Computers and Mobile Devices - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Modern Technology Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Engineering','Engineering',2014,(select id from public.honors where name='Engineering'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Modern Technology Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Internet','Internet',2006,(select id from public.honors where name='Internet'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Modern Technology Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Internet_-_Advanced','Internet - Advanced',2006,(select id from public.honors where name='Internet - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Modern Technology Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Media_Broadcast_Ministry','Media Broadcast Ministry',2016,(select id from public.honors where name='Media Broadcast Ministry'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Modern Technology Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Mobile_Technology','Mobile Technology',2016,(select id from public.honors where name='Mobile Technology'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Modern Technology Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Robotics','Robotics',2016,(select id from public.honors where name='Robotics'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Modern Technology Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Robotics_-_Advanced','Robotics - Advanced',2016,(select id from public.honors where name='Robotics - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Modern Technology Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Social_Media','Social Media',2014,(select id from public.honors where name='Social Media'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Modern Technology Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Video','Video',2001,(select id from public.honors where name='Video'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Modern Technology Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Video_(GC)','Video',2001,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Modern Technology Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Video_-_Advanced','Video - Advanced',2020,(select id from public.honors where name='Video - Advanced'),'matched');
insert into public.master_awards(honor_id,required_honor_count,requirements_status,source_url,notes) values ((select id from public.honors where name='Naturalist Master Award'),7,'retrieved_needs_mapping_review','https://wiki.pathfindersonline.org/w/AY_Honors/Naturalist_Master_Award','[]'::jsonb);
insert into public.master_award_groups(award_id,name,sort_order,required_count) values ((select id from public.honors where name='Naturalist Master Award'),'Flora',1,4);
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Cacti','Cacti',1944,(select id from public.honors where name='Cacti'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Cacti_-_Advanced','Cacti - Advanced',1999,(select id from public.honors where name='Cacti - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Ferns','Ferns',1944,(select id from public.honors where name='Ferns'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Fungi','Fungi',1937,(select id from public.honors where name='Fungi'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/House_Plants','House Plants',1976,(select id from public.honors where name='House Plants'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Meteorites','Meteorites',2014,(select id from public.honors where name='Meteorites'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Midnight_Sun','Midnight Sun',2014,(select id from public.honors where name='Midnight Sun'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Orchids','Orchids',1964,(select id from public.honors where name='Orchids'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Palm_Trees','Palm Trees',2001,(select id from public.honors where name='Palm Trees'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Seeds','Seeds',1961,(select id from public.honors where name='Seeds'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Seeds_-_Advanced','Seeds - Advanced',1961,(select id from public.honors where name='Seeds - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Shells','Shells',1938,(select id from public.honors where name='Shells'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Shrubs','Shrubs',1945,(select id from public.honors where name='Shrubs'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Stars','Stars',1928,(select id from public.honors where name='Stars'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Trees','Trees',1928,(select id from public.honors where name='Trees'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Waterfalls','Waterfalls',2011,(select id from public.honors where name='Waterfalls'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Wattles','Wattles',2001,(select id from public.honors where name='Wattles'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Weather','Weather',1944,(select id from public.honors where name='Weather'),'matched');
insert into public.master_award_groups(award_id,name,sort_order,required_count) values ((select id from public.honors where name='Naturalist Master Award'),'Wild fauna',2,2);
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Amphibians','Amphibians',1945,(select id from public.honors where name='Amphibians'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Antelopes','Antelopes',2001,(select id from public.honors where name='Antelopes'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Bats','Bats',2004,(select id from public.honors where name='Bats'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Bats_-_Advanced','Bats - Advanced',2004,(select id from public.honors where name='Bats - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Birds','Birds',1928,(select id from public.honors where name='Birds'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Birds_-_Advanced','Birds - Advanced',1949,(select id from public.honors where name='Birds - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Dinosaurs','Dinosaurs',2012,(select id from public.honors where name='Dinosaurs'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Insects','Insects',1933,(select id from public.honors where name='Insects'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Insects_-_Advanced','Insects - Advanced',1949,(select id from public.honors where name='Insects - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Marsupials','Marsupials',2001,(select id from public.honors where name='Marsupials'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Moths_%26_Butterflies','Moths & Butterflies',1933,(select id from public.honors where name='Moths & Butterflies'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Odonates','Odonates',2011,(select id from public.honors where name='Odonates'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Odonates_(SAD)','Odonates',2012,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Odonates_-_Advanced','Odonates - Advanced',2011,(select id from public.honors where name='Odonates - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Sharks','Sharks',2013,(select id from public.honors where name='Sharks'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Sharks_(SAD)','Sharks',2012,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Spiders','Spiders',1928,(select id from public.honors where name='Spiders'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Worms','Worms',2006,(select id from public.honors where name='Worms'),'matched');
insert into public.master_award_groups(award_id,name,sort_order,required_count) values ((select id from public.honors where name='Naturalist Master Award'),'Domestic fauna',3,1);
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=3),'https://wiki.pathfindersonline.org/w/AY_Honors/Bird_Pets','Bird Pets',1945,(select id from public.honors where name='Bird Pets'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=3),'https://wiki.pathfindersonline.org/w/AY_Honors/Cats','Cats',1945,(select id from public.honors where name='Cats'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=3),'https://wiki.pathfindersonline.org/w/AY_Honors/Dogs','Dogs',1950,(select id from public.honors where name='Dogs'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=3),'https://wiki.pathfindersonline.org/w/AY_Honors/Fishes','Fishes',1945,(select id from public.honors where name='Fishes'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=3),'https://wiki.pathfindersonline.org/w/AY_Honors/Poultry','Poultry',1928,(select id from public.honors where name='Poultry'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Naturalist Master Award') and sort_order=3),'https://wiki.pathfindersonline.org/w/AY_Honors/Small_Mammal_Pets','Small Mammal Pets',1997,(select id from public.honors where name='Small Mammal Pets'),'matched');
insert into public.master_awards(honor_id,required_honor_count,requirements_status,source_url,notes) values ((select id from public.honors where name='Recreation Master Award'),7,'retrieved_needs_mapping_review','https://wiki.pathfindersonline.org/w/AY_Honors/Recreation_Master_Award','["Only the main requirement tables are captured. South Pacific variation text is excluded. The source also discusses restrictions on reusing honors across awards; confirm NAD applicability before implementing allocation rules."]'::jsonb);
insert into public.master_award_groups(award_id,name,sort_order,required_count) values ((select id from public.honors where name='Recreation Master Award'),'Eligible honors',1,7);
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Recreation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Backpacking','Backpacking',1986,(select id from public.honors where name='Backpacking'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Recreation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Caving','Caving',1973,(select id from public.honors where name='Caving'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Recreation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Drilling_%26_Marching','Drilling & Marching',1976,(select id from public.honors where name='Drilling & Marching'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Recreation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Drumming_%26_Percussion','Drumming & Percussion',2006,(select id from public.honors where name='Drumming & Percussion'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Recreation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Geocaching','Geocaching',2005,(select id from public.honors where name='Geocaching'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Recreation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Geological_Geocaching','Geological Geocaching',2012,(select id from public.honors where name='Geological Geocaching'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Recreation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Gold_Prospecting','Gold Prospecting',2008,(select id from public.honors where name='Gold Prospecting'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Recreation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Hiking','Hiking',1933,(select id from public.honors where name='Hiking'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Recreation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Horsemanship','Horsemanship',1961,(select id from public.honors where name='Horsemanship'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Recreation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Kites','Kites',1986,(select id from public.honors where name='Kites'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Recreation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Knot_Tying','Knot Tying',1975,(select id from public.honors where name='Knot Tying'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Recreation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Letterboxing','Letterboxing',2008,(select id from public.honors where name='Letterboxing'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Recreation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Orienteering','Orienteering',1956,(select id from public.honors where name='Orienteering'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Recreation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Orienteering_(SPD)','Orienteering',null,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Recreation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Outdoor_Leadership','Outdoor Leadership',1986,(select id from public.honors where name='Outdoor Leadership'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Recreation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Physical_Fitness','Physical Fitness',1929,(select id from public.honors where name='Physical Fitness'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Recreation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Rock_Climbing','Rock Climbing',1970,(select id from public.honors where name='Rock Climbing'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Recreation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Skiing_-_Cross_Country','Skiing - Cross Country',1986,(select id from public.honors where name='Skiing - Cross Country'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Recreation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Snowshoeing','Snowshoeing',2010,(select id from public.honors where name='Snowshoeing'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Recreation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Snowshoeing_(SAD)','Snowshoeing',2010,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Recreation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Snowshoeing_-_Advanced','Snowshoeing - Advanced',2010,(select id from public.honors where name='Snowshoeing - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Recreation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Snowshoeing_-_Advanced_(GC)','Snowshoeing - Advanced',2010,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Recreation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Snowshoeing_-_Advanced_(SAD)','Snowshoeing - Advanced',2010,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Recreation Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Unicycling','Unicycling',2008,(select id from public.honors where name='Unicycling'),'matched');
insert into public.master_awards(honor_id,required_honor_count,requirements_status,source_url,notes) values ((select id from public.honors where name='Spiritual Growth and Ministries Master Award'),7,'retrieved','https://wiki.pathfindersonline.org/w/AY_Honors/Spiritual_Growth_and_Ministries_Master_Award','[]'::jsonb);
insert into public.master_award_groups(award_id,name,sort_order,required_count) values ((select id from public.honors where name='Spiritual Growth and Ministries Master Award'),'Spiritual Growth',1,3);
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Spiritual Growth and Ministries Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Adventurer_for_Christ','Adventurer for Christ',1989,(select id from public.honors where name='Adventurer for Christ'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Spiritual Growth and Ministries Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Adventurer_for_Christ_-_Advanced','Adventurer for Christ - Advanced',1989,(select id from public.honors where name='Adventurer for Christ - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Spiritual Growth and Ministries Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Alive_Bible','Alive Bible',2014,(select id from public.honors where name='Alive Bible'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Spiritual Growth and Ministries Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Bible_Marking','Bible Marking',2001,(select id from public.honors where name='Bible Marking'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Spiritual Growth and Ministries Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Bible_Marking_-_Advanced','Bible Marking - Advanced',2001,(select id from public.honors where name='Bible Marking - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Spiritual Growth and Ministries Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Peace_Maker','Peace Maker',2009,(select id from public.honors where name='Peace Maker'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Spiritual Growth and Ministries Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Peace_Maker_-_Advanced','Peace Maker - Advanced',2009,(select id from public.honors where name='Peace Maker - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Spiritual Growth and Ministries Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Prayer','Prayer',2011,(select id from public.honors where name='Prayer'),'matched');
insert into public.master_award_groups(award_id,name,sort_order,required_count) values ((select id from public.honors where name='Spiritual Growth and Ministries Master Award'),'Ministries',2,4);
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Spiritual Growth and Ministries Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Bible_Evangelism','Bible Evangelism',1938,(select id from public.honors where name='Bible Evangelism'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Spiritual Growth and Ministries Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Christian_Art_of_Preaching','Christian Art of Preaching',2012,(select id from public.honors where name='Christian Art of Preaching'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Spiritual Growth and Ministries Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Christian_Art_of_Preaching_-_Advanced','Christian Art of Preaching - Advanced',2012,(select id from public.honors where name='Christian Art of Preaching - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Spiritual Growth and Ministries Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Christian_Drama','Christian Drama',2006,(select id from public.honors where name='Christian Drama'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Spiritual Growth and Ministries Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Christian_Sales_Principles','Christian Sales Principles',1956,(select id from public.honors where name='Christian Sales Principles'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Spiritual Growth and Ministries Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Christian_Storytelling','Christian Storytelling',1928,(select id from public.honors where name='Christian Storytelling'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Spiritual Growth and Ministries Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Junior_Witness','Junior Witness',1970,(select id from public.honors where name='Junior Witness'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Spiritual Growth and Ministries Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Literature_Evangelism','Literature Evangelism',1928,(select id from public.honors where name='Literature Evangelism'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Spiritual Growth and Ministries Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Personal_Evangelism','Personal Evangelism',1938,(select id from public.honors where name='Personal Evangelism'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Spiritual Growth and Ministries Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Preach_It','Preach It',2009,(select id from public.honors where name='Preach It'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Spiritual Growth and Ministries Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Preach_It_-_Advanced','Preach It - Advanced',2009,(select id from public.honors where name='Preach It - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Spiritual Growth and Ministries Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Puppetry','Puppetry',null,(select id from public.honors where name='Puppetry'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Spiritual Growth and Ministries Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Sign_Language','Sign Language',1978,(select id from public.honors where name='Sign Language'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Spiritual Growth and Ministries Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Sign_Language_-_Advanced','Sign Language - Advanced',1991,(select id from public.honors where name='Sign Language - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Spiritual Growth and Ministries Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Teaching','Teaching',1944,(select id from public.honors where name='Teaching'),'matched');
insert into public.master_awards(honor_id,required_honor_count,requirements_status,source_url,notes) values ((select id from public.honors where name='Sportsman Master Award'),7,'retrieved','https://wiki.pathfindersonline.org/w/AY_Honors/Sportsman_Master_Award','["Only the main requirement tables are captured. South Pacific variation text is excluded. The source also discusses restrictions on reusing honors across awards; confirm NAD applicability before implementing allocation rules."]'::jsonb);
insert into public.master_award_groups(award_id,name,sort_order,required_count) values ((select id from public.honors where name='Sportsman Master Award'),'Eligible honors',1,7);
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Sportsman Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Archery','Archery',1945,(select id from public.honors where name='Archery'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Sportsman Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Basketball','Basketball',1999,(select id from public.honors where name='Basketball'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Sportsman Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Cycling','Cycling',1933,(select id from public.honors where name='Cycling'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Sportsman Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Cycling_-_Advanced','Cycling - Advanced',1976,(select id from public.honors where name='Cycling - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Sportsman Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Flag_Football','Flag Football',2018,(select id from public.honors where name='Flag Football'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Sportsman Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Golf','Golf',2016,(select id from public.honors where name='Golf'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Sportsman Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Horsemanship_-_Advanced','Horsemanship - Advanced',2000,(select id from public.honors where name='Horsemanship - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Sportsman Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Physical_Fitness','Physical Fitness',1929,(select id from public.honors where name='Physical Fitness'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Sportsman Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Skiing_Downhill','Skiing Downhill',1938,(select id from public.honors where name='Skiing Downhill'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Sportsman Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Slow-Pitch_Softball','Slow-Pitch Softball',2006,(select id from public.honors where name='Slow-Pitch Softball'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Sportsman Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Soccer','Soccer',1989,(select id from public.honors where name='Soccer'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Sportsman Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Tennis','Tennis',2018,(select id from public.honors where name='Tennis'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Sportsman Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Track_%26_Field','Track & Field',1978,(select id from public.honors where name='Track & Field'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Sportsman Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Triathlon','Triathlon',null,(select id from public.honors where name='Triathlon'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Sportsman Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Tumbling_%26_Balancing','Tumbling & Balancing',1976,(select id from public.honors where name='Tumbling & Balancing'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Sportsman Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Ultimate_Disc','Ultimate Disc',2011,(select id from public.honors where name='Ultimate Disc'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Sportsman Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Volleyball','Volleyball',2012,(select id from public.honors where name='Volleyball'),'matched');
insert into public.master_awards(honor_id,required_honor_count,requirements_status,source_url,notes) values ((select id from public.honors where name='Technician Master Award'),7,'retrieved_needs_mapping_review','https://wiki.pathfindersonline.org/w/AY_Honors/Technician_Master_Award','[]'::jsonb);
insert into public.master_award_groups(award_id,name,sort_order,required_count) values ((select id from public.honors where name='Technician Master Award'),'Eligible honors',1,7);
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Accounting','Accounting',1938,(select id from public.honors where name='Accounting'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Automobile_Mechanics','Automobile Mechanics',1928,(select id from public.honors where name='Automobile Mechanics'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Automobile_Mechanics_-_Advanced','Automobile Mechanics - Advanced',1964,(select id from public.honors where name='Automobile Mechanics - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Barbering_and_Hairstyling','Barbering and Hairstyling',1938,(select id from public.honors where name='Barbering and Hairstyling'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Bible_Evangelism','Bible Evangelism',1938,(select id from public.honors where name='Bible Evangelism'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Bookbinding','Bookbinding',1935,(select id from public.honors where name='Bookbinding'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Bookkeeping','Bookkeeping',1937,(select id from public.honors where name='Bookkeeping'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Carpentry','Carpentry',1929,(select id from public.honors where name='Carpentry'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Christian_Sales_Principles','Christian Sales Principles',1956,(select id from public.honors where name='Christian Sales Principles'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Communications','Communications',1953,(select id from public.honors where name='Communications'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Communications_-_Advanced','Communications - Advanced',1956,(select id from public.honors where name='Communications - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Electricity','Electricity',1929,(select id from public.honors where name='Electricity'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Fire_Safety','Fire Safety',2012,(select id from public.honors where name='Fire Safety'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Forestry','Forestry',2008,(select id from public.honors where name='Forestry'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/House_Painting,_Exterior','House Painting, Exterior',1938,(select id from public.honors where name='House Painting, Exterior'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/House_Painting,_Interior','House Painting, Interior',1938,(select id from public.honors where name='House Painting, Interior'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Journalism','Journalism',1938,(select id from public.honors where name='Journalism'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Masonry','Masonry',1937,(select id from public.honors where name='Masonry'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Paperhanging','Paperhanging',1938,(select id from public.honors where name='Paperhanging'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Plumbing','Plumbing',1938,(select id from public.honors where name='Plumbing'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Printing','Printing',1929,(select id from public.honors where name='Printing'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Radio','Radio',1928,(select id from public.honors where name='Radio'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Radio_-_Advanced','Radio - Advanced',1956,(select id from public.honors where name='Radio - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Radio_Electronics','Radio Electronics',1938,(select id from public.honors where name='Radio Electronics'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Shoe_Repair','Shoe Repair',1928,(select id from public.honors where name='Shoe Repair'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Shorthand','Shorthand',1929,(select id from public.honors where name='Shorthand'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Small_Engines','Small Engines',1975,(select id from public.honors where name='Small Engines'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Teaching','Teaching',1944,(select id from public.honors where name='Teaching'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Typewriting','Typewriting',1929,(select id from public.honors where name='Typewriting'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Upholstery','Upholstery',null,(select id from public.honors where name='Upholstery'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Welding','Welding',1978,(select id from public.honors where name='Welding'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Welding_(GC)','Welding',1978,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Woodworking','Woodworking',1934,(select id from public.honors where name='Woodworking'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Technician Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Word_Processing','Word Processing',2013,(select id from public.honors where name='Word Processing'),'matched');
insert into public.master_awards(honor_id,required_honor_count,requirements_status,source_url,notes) values ((select id from public.honors where name='Wilderness Master Award'),7,'retrieved_needs_mapping_review','https://wiki.pathfindersonline.org/w/AY_Honors/Wilderness_Master_Award','["Only the main requirement tables are captured. South Pacific variation text is excluded. The source also discusses restrictions on reusing honors across awards; confirm NAD applicability before implementing allocation rules."]'::jsonb);
insert into public.master_award_groups(award_id,name,sort_order,required_count) values ((select id from public.honors where name='Wilderness Master Award'),'Eligible honors',1,7);
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Wilderness Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Backpacking','Backpacking',1986,(select id from public.honors where name='Backpacking'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Wilderness Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Camp_Craft','Camp Craft',1929,(select id from public.honors where name='Camp Craft'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Wilderness Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Camp_Safety','Camp Safety',2009,(select id from public.honors where name='Camp Safety'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Wilderness Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Camping_Skills_IV','Camping Skills IV',1986,(select id from public.honors where name='Camping Skills IV'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Wilderness Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Cold_Weather_Survival','Cold Weather Survival',2012,(select id from public.honors where name='Cold Weather Survival'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Wilderness Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Dutch_Oven_Cooking','Dutch Oven Cooking',2006,(select id from public.honors where name='Dutch Oven Cooking'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Wilderness Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Edible_Wild_Plants','Edible Wild Plants',1970,(select id from public.honors where name='Edible Wild Plants'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Wilderness Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Fire_Building_%26_Camp_Cookery','Fire Building & Camp Cookery',1956,(select id from public.honors where name='Fire Building & Camp Cookery'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Wilderness Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Hiking','Hiking',1933,(select id from public.honors where name='Hiking'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Wilderness Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Knot_Tying','Knot Tying',1975,(select id from public.honors where name='Knot Tying'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Wilderness Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Orienteering','Orienteering',1956,(select id from public.honors where name='Orienteering'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Wilderness Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Orienteering_(SPD)','Orienteering',null,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Wilderness Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Outdoor_Leadership','Outdoor Leadership',1986,(select id from public.honors where name='Outdoor Leadership'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Wilderness Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Pioneering','Pioneering',1956,(select id from public.honors where name='Pioneering'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Wilderness Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Tents','Tents',2014,(select id from public.honors where name='Tents'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Wilderness Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Wilderness_Leadership','Wilderness Leadership',1976,(select id from public.honors where name='Wilderness Leadership'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Wilderness Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Wilderness_Living','Wilderness Living',1956,(select id from public.honors where name='Wilderness Living'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Wilderness Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Winter_Camping','Winter Camping',1970,(select id from public.honors where name='Winter Camping'),'matched');
insert into public.master_awards(honor_id,required_honor_count,requirements_status,source_url,notes) values ((select id from public.honors where name='Zoology Master Award'),7,'retrieved_needs_mapping_review','https://wiki.pathfindersonline.org/w/AY_Honors/Zoology_Master_Award','["The wild and domestic fauna lists are presented as examples, not necessarily exhaustive. The source attributes a no-reuse restriction involving Naturalist to the South Pacific Division; do not apply that regional rule automatically to NAD."]'::jsonb);
insert into public.master_award_groups(award_id,name,sort_order,required_count) values ((select id from public.honors where name='Zoology Master Award'),'Foundation',1,1);
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Cetaceans','Cetaceans',2001,(select id from public.honors where name='Cetaceans'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Endangered_Species','Endangered Species',2005,(select id from public.honors where name='Endangered Species'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Mammals','Mammals',1937,(select id from public.honors where name='Mammals'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=1),'https://wiki.pathfindersonline.org/w/AY_Honors/Marine_Mammals','Marine Mammals',1991,(select id from public.honors where name='Marine Mammals'),'matched');
insert into public.master_award_groups(award_id,name,sort_order,required_count) values ((select id from public.honors where name='Zoology Master Award'),'Wild fauna',2,4);
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Amphibians','Amphibians',1945,(select id from public.honors where name='Amphibians'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Antelopes','Antelopes',2001,(select id from public.honors where name='Antelopes'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Bats','Bats',2004,(select id from public.honors where name='Bats'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Bats_-_Advanced','Bats - Advanced',2004,(select id from public.honors where name='Bats - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Birds','Birds',1928,(select id from public.honors where name='Birds'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Birds_-_Advanced','Birds - Advanced',1949,(select id from public.honors where name='Birds - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Dinosaurs','Dinosaurs',2012,(select id from public.honors where name='Dinosaurs'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Insects','Insects',1933,(select id from public.honors where name='Insects'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Insects_-_Advanced','Insects - Advanced',1949,(select id from public.honors where name='Insects - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Marsupials','Marsupials',2001,(select id from public.honors where name='Marsupials'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Microscopic_Life','Microscopic Life',1994,(select id from public.honors where name='Microscopic Life'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Moths_%26_Butterflies','Moths & Butterflies',1933,(select id from public.honors where name='Moths & Butterflies'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Odonates','Odonates',2011,(select id from public.honors where name='Odonates'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Odonates_(SAD)','Odonates',2012,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Odonates_-_Advanced','Odonates - Advanced',2011,(select id from public.honors where name='Odonates - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Sharks','Sharks',2013,(select id from public.honors where name='Sharks'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Sharks_(SAD)','Sharks',2012,null,'needs_review');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Spiders','Spiders',1928,(select id from public.honors where name='Spiders'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=2),'https://wiki.pathfindersonline.org/w/AY_Honors/Worms','Worms',2006,(select id from public.honors where name='Worms'),'matched');
insert into public.master_award_groups(award_id,name,sort_order,required_count) values ((select id from public.honors where name='Zoology Master Award'),'Domestic fauna',3,2);
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=3),'https://wiki.pathfindersonline.org/w/AY_Honors/Bird_Pets','Bird Pets',1945,(select id from public.honors where name='Bird Pets'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=3),'https://wiki.pathfindersonline.org/w/AY_Honors/Cats','Cats',1945,(select id from public.honors where name='Cats'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=3),'https://wiki.pathfindersonline.org/w/AY_Honors/Dog_Care_and_Training','Dog Care and Training',1976,(select id from public.honors where name='Dog Care and Training'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=3),'https://wiki.pathfindersonline.org/w/AY_Honors/Dogs','Dogs',1950,(select id from public.honors where name='Dogs'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=3),'https://wiki.pathfindersonline.org/w/AY_Honors/Fishes','Fishes',1945,(select id from public.honors where name='Fishes'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=3),'https://wiki.pathfindersonline.org/w/AY_Honors/Livestock','Livestock',1945,(select id from public.honors where name='Livestock'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=3),'https://wiki.pathfindersonline.org/w/AY_Honors/Parrots_and_Cockatoos','Parrots and Cockatoos',2001,(select id from public.honors where name='Parrots and Cockatoos'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=3),'https://wiki.pathfindersonline.org/w/AY_Honors/Poultry','Poultry',1928,(select id from public.honors where name='Poultry'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=3),'https://wiki.pathfindersonline.org/w/AY_Honors/Reptiles','Reptiles',1937,(select id from public.honors where name='Reptiles'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=3),'https://wiki.pathfindersonline.org/w/AY_Honors/Reptiles_-_Advanced','Reptiles - Advanced',2001,(select id from public.honors where name='Reptiles - Advanced'),'matched');
insert into public.master_award_honors(group_id,source_url,source_name,source_year,honor_id,mapping_status) values ((select id from public.master_award_groups where award_id=(select id from public.honors where name='Zoology Master Award') and sort_order=3),'https://wiki.pathfindersonline.org/w/AY_Honors/Small_Mammal_Pets','Small Mammal Pets',1997,(select id from public.honors where name='Small Mammal Pets'),'matched');

notify pgrst, 'reload schema';
commit;
