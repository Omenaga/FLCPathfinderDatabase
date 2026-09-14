begin;

-- A form keeps this identifier across retries, including lost HTTP responses.
alter table public.pathfinders add column creation_request_id uuid unique;

create function public.add_member_record(
  p_request_id uuid,
  p_first_name text,
  p_last_name text,
  p_birth_date date,
  p_status text,
  p_current_title jsonb,
  p_school_year text
) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  member_id integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in to add a record' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'A creation request identifier is required' using errcode = '22023';
  end if;
  -- Serialize retries for this request; unrelated registrations remain independent.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text, 0));
  select id into member_id from public.pathfinders where creation_request_id = p_request_id;
  if found then
    if not exists (
      select 1 from public.pathfinders p join public.current_data c on c.pathfinder_id = p.id
      where p.id = member_id
        and p.first_name = btrim(p_first_name)
        and p.last_name = btrim(coalesce(p_last_name, ''))
        and p.birth_date is not distinct from p_birth_date
        and c.status = p_status
        and c.current_title is not distinct from p_current_title
        and c.school_year = p_school_year
    ) then
      raise exception 'This request already created a different record. Check Search before adding again.' using errcode = '22023';
    end if;
    return member_id;
  end if;
  if p_school_year is distinct from public.current_club_year() then
    raise exception 'The current club year changed. Reopen Add Record to refresh it.' using errcode = '22023';
  end if;

  insert into public.pathfinders(first_name, last_name, birth_date, creation_request_id)
    values (btrim(p_first_name), btrim(coalesce(p_last_name, '')), p_birth_date, p_request_id)
    returning id into member_id;
  insert into public.current_data(pathfinder_id, status, current_title, school_year)
    values (member_id, p_status, p_current_title, p_school_year);
  return member_id;
end;
$$;

revoke all on function public.add_member_record(uuid,text,text,date,text,jsonb,text) from public, anon;
grant execute on function public.add_member_record(uuid,text,text,date,text,jsonb,text) to authenticated;
notify pgrst, 'reload schema';
commit;
