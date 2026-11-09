-- Allow a per-page monthly section (used for before/after comparison of optimisation records)
-- and an Excel-ready monthly export; order sites as in the department's monthly table.
alter table public.seo_snapshots drop constraint seo_snapshots_section_check;
alter table public.seo_snapshots add constraint seo_snapshots_section_check
  check (section in ('overview','opportunities','keywords','content','monthly','pages'));

update public.seo_sites s set sort_order = v.ord
from (values ('autelonline',1),('autel-uk',2),('autel-eu',3),
             ('launchx431online',4),('launchonline-uk',5),('launchonline-eu',6),
             ('otofix',7),('otofix-uk',8),('otofix-eu',9),
             ('launchpro',10),('launchpro-uk',11),('launchx431pro-us',12)) as v(id,ord)
where s.id = v.id;
