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
