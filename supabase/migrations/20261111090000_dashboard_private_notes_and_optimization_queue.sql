create table public.seo_snapshot_notes (
  snapshot_id uuid primary key references public.seo_snapshots(id) on delete cascade,
  provenance jsonb not null default '{}'::jsonb,
  checks jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  channel_notes jsonb not null default '[]'::jsonb
);
alter table public.seo_snapshot_notes enable row level security;
revoke all on public.seo_snapshot_notes from public, anon, authenticated;
grant select on public.seo_snapshot_notes to authenticated;
create policy seo_snapshot_notes_admin_read on public.seo_snapshot_notes
  for select to authenticated using ((select seo_private.seo_is_admin()));

create function seo_private.save_snapshot_notes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  safe_payload jsonb := new.payload;
  safe_provenance jsonb;
  private_checks jsonb;
  private_actions jsonb;
  private_channel_notes jsonb;
  safe_rows jsonb;
begin
  -- Only data-coverage fields are needed for public comparisons.
  safe_provenance := jsonb_strip_nulls(jsonb_build_object(
    'ga4_landing_date_range', new.provenance->'ga4_landing_date_range',
    'gsc_full_month', new.provenance->'gsc_full_month'
  ));
  if new.section = 'overview' then
    private_checks := new.payload->'checks';
    safe_payload := safe_payload - 'checks';
    if jsonb_typeof(new.payload#>'{ga4,channels}') = 'array' then
      select jsonb_agg(value - 'note' order by ord),
             case when bool_or(value ? 'note') then jsonb_agg(value->'note' order by ord) end
        into safe_rows, private_channel_notes
      from jsonb_array_elements(new.payload#>'{ga4,channels}') with ordinality as r(value,ord);
      safe_payload := jsonb_set(safe_payload, '{ga4,channels}', coalesce(safe_rows,'[]'));
    end if;
  elsif new.section = 'opportunities' and jsonb_typeof(new.payload->'rows') = 'array' then
    select jsonb_agg(value - 'action' order by ord),
           case when bool_or(value ? 'action') then jsonb_agg(value->'action' order by ord) end
      into safe_rows, private_actions
    from jsonb_array_elements(new.payload->'rows') with ordinality as r(value,ord);
    safe_payload := jsonb_set(safe_payload, '{rows}', coalesce(safe_rows,'[]'));
  end if;

  -- The cleanup update also fires this trigger. Its data is already public-safe.
  if safe_payload = new.payload and safe_provenance = new.provenance and pg_trigger_depth() > 1 then
    return null;
  end if;
  insert into public.seo_snapshot_notes(snapshot_id, provenance, checks, actions, channel_notes)
  values (new.id, new.provenance, coalesce(private_checks,'[]'),
          coalesce(private_actions,'[]'), coalesce(private_channel_notes,'[]'))
  on conflict (snapshot_id) do update
    set provenance = case when new.provenance = safe_provenance
                         then seo_snapshot_notes.provenance || new.provenance else excluded.provenance end,
        checks = case when tg_op = 'UPDATE' and old.payload = new.payload and private_checks is null
                      then seo_snapshot_notes.checks else excluded.checks end,
        actions = case when tg_op = 'UPDATE' and old.payload = new.payload and private_actions is null
                       then seo_snapshot_notes.actions else excluded.actions end,
        channel_notes = case when tg_op = 'UPDATE' and old.payload = new.payload and private_channel_notes is null
                             then seo_snapshot_notes.channel_notes else excluded.channel_notes end;
  if safe_payload <> new.payload or safe_provenance <> new.provenance then
    update public.seo_snapshots
    set payload = safe_payload, provenance = safe_provenance
    where id = new.id;
  end if;
  return null;
end;
$$;
revoke all on function seo_private.save_snapshot_notes() from public, anon, authenticated;
create trigger seo_snapshot_notes_save after insert or update of payload,provenance on public.seo_snapshots
  for each row execute function seo_private.save_snapshot_notes();

update public.seo_snapshots set payload = payload;

create function public.seo_dashboard_guidance() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'session_ratio', '会话与点击口径不同，无统一正常范围。',
    'channels', 'AI 来源统一计入 AI Assistant。bing / search_bra、bing / pla 已确认为 Bing 广告。着陆页渠道采用会话主渠道组或会话来源/媒介。',
    'opportunities', jsonb_build_array(
      '核心页面：GSC 点击前 10，环比跌幅达到 20% 标为高优先级。',
      '下滑页面：上月点击 ≥20 且下降 ≥20%，用排名、点击率和曝光变化判断排查方向。',
      '排名 11–20：平均排名 10.5–20.5。Autel 曝光 ≥80，Launch 与美国站 ≥30，排除小语种页面。',
      '点击率偏低：排除购物类长标题查询，低于本站同排名段平均值的 60%。',
      '错位与机会词：对照关键词归属表。',
      '互动差：自然会话 ≥20，且平均互动时长低于全站一半或互动率 <50%。',
      '转化：与本站自然流量整体转化率比较。',
      '未收录：以 GSC 导出当天的快照为准。',
      '同产品合计：主网址和带 variant 的网址分别记录，合计用于核对点击变化。'
    )
  )
  where (select seo_private.seo_is_admin());
$$;
revoke all on function public.seo_dashboard_guidance() from public, anon;
grant execute on function public.seo_dashboard_guidance() to authenticated;

alter table public.seo_optimizations
  alter column optimized_on drop not null,
  alter column category drop not null,
  alter column description set default '',
  drop constraint seo_optimizations_description_check,
  add constraint seo_optimizations_description_check check (length(description) <= 5000),
  add constraint seo_optimizations_pending_check check (
    (optimized_on is null and category is null and not published)
    or (optimized_on is not null and category is not null)
  );
create unique index seo_optimizations_pending_page
  on public.seo_optimizations(site_id,page_url) where optimized_on is null;
