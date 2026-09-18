-- Prepare the honors catalog metadata without importing any honors.
begin;

alter table public.honors
  add column category text check (category = btrim(category) and length(category) > 0),
  add column skill_level smallint check (skill_level in (1, 2, 3)),
  add column year integer;

comment on column public.honors.category is 'Source catalog category; Masters relationships are not yet modeled.';
comment on column public.honors.skill_level is 'Skill level 1, 2, or 3. NULL means the source does not publish a level.';
comment on column public.honors.year is 'Honor introduction year, not year earned or a club season. NULL means Unknown.';

commit;
