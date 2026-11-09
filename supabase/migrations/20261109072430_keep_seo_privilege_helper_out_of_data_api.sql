-- Exported from the live project on 2026-11-09.
alter function public.seo_is_admin() set schema seo_private;
grant usage on schema seo_private to anon,authenticated;
create function public.seo_is_admin() returns boolean language sql stable security invoker set search_path='' as $$ select seo_private.seo_is_admin() $$;
revoke all on function public.seo_is_admin() from public;
grant execute on function public.seo_is_admin() to authenticated;
