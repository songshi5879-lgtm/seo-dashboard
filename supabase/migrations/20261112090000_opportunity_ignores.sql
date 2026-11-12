create table public.seo_opportunity_ignores (
  site_id text not null references public.seo_sites(id) on delete cascade,
  page_key text not null check (left(page_key,1) = '/'),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  primary key (site_id,page_key)
);

alter table public.seo_opportunity_ignores enable row level security;
revoke all on public.seo_opportunity_ignores from public, anon, authenticated;
grant select, insert, delete on public.seo_opportunity_ignores to authenticated;
create policy seo_opportunity_ignores_admin
  on public.seo_opportunity_ignores for all to authenticated
  using ((select seo_private.seo_is_admin()))
  with check ((select seo_private.seo_is_admin()));

-- Visitors see the classification without access to the administrator's reason.
create view public.seo_opportunity_ignore_status with (security_barrier = true) as
  select site_id,page_key from public.seo_opportunity_ignores;
revoke all on public.seo_opportunity_ignore_status from public, anon, authenticated;
grant select on public.seo_opportunity_ignore_status to anon, authenticated;
