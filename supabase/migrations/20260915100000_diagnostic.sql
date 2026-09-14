-- Diagnostic: print actual state (no changes)
do $$
declare
  pathfinder_count int;
  current_data_count int;
  justin_cd record;
  club_year text;
begin
  select count(*) into pathfinder_count
    from public.pathfinders where first_name = 'Justin' and last_name = 'Wu';
  select count(*) into current_data_count
    from public.current_data
    where pathfinder_id in (select id from public.pathfinders where first_name = 'Justin' and last_name = 'Wu');
  select public.current_club_year() into club_year;

  raise notice 'Club year function returns: %', club_year;
  raise notice 'Pathfinder records for Justin Wu: %', pathfinder_count;
  raise notice 'current_data records for Justin Wu: %', current_data_count;

  for justin_cd in
    select c.school_year, c.status, c.current_title
    from public.current_data c
    join public.pathfinders p on p.id = c.pathfinder_id
    where p.first_name = 'Justin' and p.last_name = 'Wu'
  loop
    raise notice 'current_data row - school_year: %, status: %, current_title: %',
      justin_cd.school_year, justin_cd.status, justin_cd.current_title;
  end loop;

  if current_data_count = 0 then
    raise notice 'NO current_data row exists for Justin Wu';
  end if;
end $$;
