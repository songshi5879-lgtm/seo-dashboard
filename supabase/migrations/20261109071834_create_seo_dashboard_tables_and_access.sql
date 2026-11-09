-- Exported from the live project (supabase_migrations.schema_migrations) on 2026-11-09.
create schema if not exists seo_private;
revoke all on schema seo_private from public, anon, authenticated;
create table seo_private.admins(user_id uuid primary key references auth.users(id));
create function public.seo_is_admin() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from seo_private.admins where user_id=(select auth.uid())) $$;
revoke all on function public.seo_is_admin() from public;
grant execute on function public.seo_is_admin() to anon,authenticated;
create table public.seo_sites (
 id text primary key, name text not null, domain text not null unique, deep_analysis boolean not null default false, sort_order integer not null
);
create table public.seo_snapshots (
 id uuid primary key default gen_random_uuid(),site_id text not null references public.seo_sites(id),
 month date not null check(extract(day from month)=1),
 section text not null check(section in ('overview','opportunities','keywords','content','monthly')),
 payload jsonb not null check(jsonb_typeof(payload)='object'), provenance jsonb not null default '{}'::jsonb,
 published boolean not null default false, updated_at timestamptz not null default now(),
 unique(site_id,month,section)
);
create table public.seo_optimizations (
 id uuid primary key default gen_random_uuid(),site_id text not null references public.seo_sites(id),
 page_url text not null check(page_url ~ '^https://'), optimized_on date not null,
 category text not null check(category in ('Title/Meta','内容','内链','技术','其他')),
 description text not null check(length(description) between 1 and 5000),
 published boolean not null default true, created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now()
);
alter table public.seo_sites enable row level security;
alter table public.seo_snapshots enable row level security;
alter table public.seo_optimizations enable row level security;
revoke all on public.seo_sites, public.seo_snapshots, public.seo_optimizations from anon,authenticated;
grant select on public.seo_sites, public.seo_snapshots, public.seo_optimizations to anon,authenticated;
grant insert,update,delete on public.seo_snapshots, public.seo_optimizations to authenticated;
create policy seo_sites_read on public.seo_sites for select to anon,authenticated using(true);
create policy seo_snapshots_read on public.seo_snapshots for select to anon,authenticated using(published or (select public.seo_is_admin()));
create policy seo_snapshots_insert on public.seo_snapshots for insert to authenticated with check((select public.seo_is_admin()));
create policy seo_snapshots_update on public.seo_snapshots for update to authenticated using((select public.seo_is_admin())) with check((select public.seo_is_admin()));
create policy seo_snapshots_delete on public.seo_snapshots for delete to authenticated using((select public.seo_is_admin()));
create policy seo_records_read on public.seo_optimizations for select to anon,authenticated using(published or (select public.seo_is_admin()));
create policy seo_records_insert on public.seo_optimizations for insert to authenticated with check((select public.seo_is_admin()) and created_by=(select auth.uid()));
create policy seo_records_update on public.seo_optimizations for update to authenticated using((select public.seo_is_admin())) with check((select public.seo_is_admin()));
create policy seo_records_delete on public.seo_optimizations for delete to authenticated using((select public.seo_is_admin()));
create index seo_records_site_date on public.seo_optimizations(site_id,optimized_on desc);
create index seo_records_created_by on public.seo_optimizations(created_by);
