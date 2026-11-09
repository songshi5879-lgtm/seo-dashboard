-- Content tracking, keyword monitor list, blog summary snapshots and manual cell edits.
-- Reads stay public (user decision 2026-11-09: all dashboard data is publicly readable);
-- writes are admin only.

alter table public.seo_snapshots drop constraint seo_snapshots_section_check;
alter table public.seo_snapshots add constraint seo_snapshots_section_check
  check (section in ('overview','opportunities','keywords','content','monthly','pages','blog_summary'));

-- One row per article/page being tracked. Also drives the rows of the blog summary sheet.
create table public.seo_content (
  id bigint generated always as identity primary key,
  site_id text not null references public.seo_sites(id),
  url text not null check (url ~ '^https://' and length(url) <= 2000),
  h1 text, main_keyword text, title text, meta text,
  published_on date, last_updated date,
  outlinks integer check (outlinks >= 0), inlinks integer check (inlinks >= 0),
  topic text, notes text,
  title_cn text, word_count integer check (word_count >= 0), stop_words integer check (stop_words >= 0),
  index_requested text,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id)
);
create unique index seo_content_site_url on public.seo_content (site_id, lower(rtrim(url, '/')));
create index seo_content_updated_by on public.seo_content (updated_by);

-- The 20–50 keywords monitored each month.
create table public.seo_keywords (
  id bigint generated always as identity primary key,
  site_id text not null references public.seo_sites(id),
  keyword text not null check (length(btrim(keyword)) between 1 and 300),
  target_url text check (target_url is null or target_url ~ '^https://'),
  volume integer check (volume >= 0),
  note text,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id)
);
create unique index seo_keywords_site_kw on public.seo_keywords (site_id, lower(btrim(keyword)));
create index seo_keywords_updated_by on public.seo_keywords (updated_by);

-- Manual values that replace a computed cell for one month (blog summary, keyword metrics).
-- A re-import never touches these, so hand-entered numbers survive monthly updates.
create table public.seo_cell_overrides (
  id bigint generated always as identity primary key,
  grid text not null check (grid in ('blog_summary','keywords')),
  site_id text not null references public.seo_sites(id),
  month date not null check (extract(day from month) = 1),
  row_key text not null check (length(row_key) between 1 and 2000),
  col text not null check (length(col) between 1 and 60),
  value text check (length(value) <= 2000),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id),
  unique (grid, site_id, month, row_key, col)
);
create index seo_cell_overrides_updated_by on public.seo_cell_overrides (updated_by);

create function seo_private.touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); new.updated_by := (select auth.uid()); return new; end $$;
create trigger seo_content_touch before update on public.seo_content for each row execute function seo_private.touch();
create trigger seo_keywords_touch before update on public.seo_keywords for each row execute function seo_private.touch();
create trigger seo_cell_overrides_touch before update on public.seo_cell_overrides for each row execute function seo_private.touch();

alter table public.seo_content enable row level security;
alter table public.seo_keywords enable row level security;
alter table public.seo_cell_overrides enable row level security;
revoke all on public.seo_content, public.seo_keywords, public.seo_cell_overrides from anon, authenticated;
grant select on public.seo_content, public.seo_keywords, public.seo_cell_overrides to anon, authenticated;
grant insert, update, delete on public.seo_content, public.seo_keywords, public.seo_cell_overrides to authenticated;

create policy seo_content_read on public.seo_content for select to anon, authenticated using (true);
create policy seo_content_insert on public.seo_content for insert to authenticated with check ((select seo_private.seo_is_admin()));
create policy seo_content_update on public.seo_content for update to authenticated using ((select seo_private.seo_is_admin())) with check ((select seo_private.seo_is_admin()));
create policy seo_content_delete on public.seo_content for delete to authenticated using ((select seo_private.seo_is_admin()));
create policy seo_keywords_read on public.seo_keywords for select to anon, authenticated using (true);
create policy seo_keywords_insert on public.seo_keywords for insert to authenticated with check ((select seo_private.seo_is_admin()));
create policy seo_keywords_update on public.seo_keywords for update to authenticated using ((select seo_private.seo_is_admin())) with check ((select seo_private.seo_is_admin()));
create policy seo_keywords_delete on public.seo_keywords for delete to authenticated using ((select seo_private.seo_is_admin()));
create policy seo_overrides_read on public.seo_cell_overrides for select to anon, authenticated using (true);
create policy seo_overrides_insert on public.seo_cell_overrides for insert to authenticated with check ((select seo_private.seo_is_admin()));
create policy seo_overrides_update on public.seo_cell_overrides for update to authenticated using ((select seo_private.seo_is_admin())) with check ((select seo_private.seo_is_admin()));
create policy seo_overrides_delete on public.seo_cell_overrides for delete to authenticated using ((select seo_private.seo_is_admin()));
