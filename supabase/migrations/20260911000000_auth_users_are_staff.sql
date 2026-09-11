-- Disable public signup in hosted Auth settings before applying this migration.
-- Keep the RPC compatible with older clients and existing table policies.
create or replace function public.current_staff_role() returns text
language sql stable security invoker set search_path = '' as $$
  select case when (select auth.uid()) is not null then 'editor'::text else null::text end;
$$;
-- Preserve old assignments as historical data; they no longer control access.
comment on table private.staff_access is 'Legacy allowlist, no longer used for authorization.';
notify pgrst, 'reload schema';
