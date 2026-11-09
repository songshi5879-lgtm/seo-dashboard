-- Exported from the live project on 2026-11-09.
create function public.seo_import_snapshots(items jsonb) returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 if not public.seo_is_admin() then raise exception 'Administrator access required' using errcode='42501'; end if;
 if jsonb_typeof(items) <> 'array' or jsonb_array_length(items)=0 or jsonb_array_length(items)>1000 then raise exception 'Invalid import batch'; end if;
 insert into public.seo_snapshots(site_id,month,section,payload,provenance,published,updated_at)
 select x.site_id,x.month,x.section,x.payload,x.provenance,x.published,now()
 from jsonb_to_recordset(items) as x(site_id text,month date,section text,payload jsonb,provenance jsonb,published boolean)
 on conflict(site_id,month,section) do update set payload=excluded.payload,provenance=excluded.provenance,published=excluded.published,updated_at=now();
 get diagnostics n = row_count; return n;
end $$;
revoke all on function public.seo_import_snapshots(jsonb) from public,anon;
grant execute on function public.seo_import_snapshots(jsonb) to authenticated;
