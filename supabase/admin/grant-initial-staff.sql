-- Run as the database administrator AFTER creating this user in Supabase Auth.
-- This script does not create accounts, set passwords, or send email.
do $$
declare staff_id uuid;
begin
  select id into staff_id from auth.users
  where lower(email) = 'forestlakepathfinderpics@gmail.com';
  if staff_id is null then
    raise exception 'Create forestlakepathfinderpics@gmail.com in Supabase Authentication > Users first.';
  end if;
  insert into private.staff_access(user_id, role) values (staff_id, 'editor')
  on conflict (user_id) do update set role = excluded.role;
end;
$$;
