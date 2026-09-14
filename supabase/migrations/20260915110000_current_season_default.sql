-- Current records with a missing season must join the current search view.
begin;
update public.current_data set school_year=public.current_club_year() where school_year is null;
alter table public.current_data alter column school_year set default public.current_club_year();
alter table public.current_data alter column school_year set not null;
notify pgrst, 'reload schema';
commit;
