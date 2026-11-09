"""Build one month's dashboard snapshots from the raw exports.

Usage (from the repo root):
    python -m pipeline.build --month 2026-10 --input inputs/2026-10 --out out/2026-10 [--prev out/2026-09/import.json]

Folder layout and file names: see docs/月度数据导入说明.md.
Writes out/<month>/import.json (for the dashboard's admin import), report.md (checks and warnings)
and monthly_column.xlsx (the value column for the department table).
"""
import argparse, json, re, statistics
from datetime import date, timedelta
from pathlib import Path

from . import config as C
from .readers import (InputError, read_gsc_zip, read_query_page, read_ga4, read_ga4_with_purchase_flag,
                      read_unindexed, read_table_dicts, url_path, base_path, page_type, num, month_bounds)


def pct(a, b):
    return a / b if b else None


def full_url(site_id, path):
    return "https://" + C.SITES[site_id]["domain"] + (path if path.startswith("/") else "/" + path)


def first_file(folder, *patterns):
    for pat in patterns:
        hits = sorted(folder.glob(pat))
        if hits:
            return hits[0]
    return None


# ------------------------------------------------------------------ GA4 organic classification
def classify(source_medium, channel):
    """-> (bucket, include, note). bucket is the channel shown on the dashboard."""
    sm = (source_medium or "").strip().lower()
    ch = (channel or "").strip().lower()
    src, _, med = [x.strip() for x in sm.partition("/")]
    if sm in C.EXCLUDED_SOURCE_MEDIUMS:
        return "Bing 广告（剔除）", False, C.EXCLUDED_SOURCE_MEDIUMS[sm]
    if src and C.AI_SOURCE_RE.search(src):
        return "AI Assistant", True, ("GA4 归入 " + channel) if channel and ch != "ai assistant" else ""
    note = C.UNVERIFIED_SOURCE_MEDIUMS.get(sm, "")
    if not note and med == "organic" and src and not C.SEARCH_ENGINES_RE.match(src):
        note = "来源不是搜索引擎、媒介写成 organic（如联盟平台），GA4 按规则计入自然搜索，建议核实"
    if ch:
        if ch in C.ORGANIC_CHANNELS:
            return channel, True, note
        return channel, False, ""
    # No channel column: infer with GA4's default rules (search engine + non-paid medium).
    if med == "organic" or (src and C.SEARCH_ENGINES_RE.match(src) and med and not C.PAID_MEDIUM_RE.match(med)
                            and med not in ("referral", "email", "(none)")):
        return "Organic Search", True, note or ("导出未含渠道组，按来源/媒介推断" if med != "organic" else "")
    return "其他渠道", False, ""


def summarize_ga4(rows):
    """Aggregate GA4 rows into channel table + totals for natural traffic."""
    agg = {}
    for r in rows:
        bucket, inc, note = classify(r.get("source_medium"), r.get("channel"))
        key = (bucket, r.get("source_medium") or "—")
        a = agg.setdefault(key, {"channel": bucket, "source_medium": key[1], "sessions": 0, "purchases": 0,
                                 "revenue": 0.0, "included": inc, "note": note})
        for k in ("sessions", "purchases", "revenue"):
            a[k] += r.get(k) or 0
    table = sorted(agg.values(), key=lambda x: (not x["included"], -x["sessions"]))
    inc = [x for x in table if x["included"]]

    def tot(rs):
        s = sum(x["sessions"] for x in rs)
        p = sum(x["purchases"] for x in rs)
        return {"sessions": s, "purchases": p, "revenue": round(sum(x["revenue"] for x in rs), 2),
                "conversion": pct(p, s)}
    google = [x for x in inc if x["source_medium"].lower() == "google / organic"]
    ai = [x for x in inc if x["channel"] == "AI Assistant"]
    by_channel = {}
    for x in inc:
        by_channel.setdefault(x["channel"], []).append(x)
    return {
        "organic": tot(inc), "google_organic": tot(google), "ai": tot(ai),
        "by_channel": [{"channel": k, **tot(v)} for k, v in sorted(by_channel.items(), key=lambda kv: -tot(kv[1])["sessions"])],
        "channels": [{**x, "revenue": round(x["revenue"], 2)} for x in table if x["included"] or x["sessions"] >= 20
                     or x["channel"].startswith("Bing 广告")],
    }


# ------------------------------------------------------------------ helpers for opportunities
def is_brand(site_id, q):
    rx = C.SITES[site_id].get("brand")
    return bool(rx and re.search(rx, q, re.I))


def shopping_title(q, pos, ptype):
    if not ptype.startswith("产品页") or pos is None:
        return False
    words = len(q.split())
    return any(words >= w and pos <= p for w, p in C.SHOPPING_TITLE_RULES)


def band_of(pos):
    for i, (lo, hi) in enumerate(C.CTR_BANDS):
        if pos is not None and lo < pos <= hi:
            return i
    return None


def priority(value, cut_high, cut_mid):
    return "高" if value >= cut_high else "中" if value >= cut_mid else "低"


def opp(category, site_id, path, query=None, action="", evidence="", prio="中", **m):
    row = {"category": category, "page_url": full_url(site_id, path) if path and path.startswith("/") else path,
           "page_type": page_type(path) if path and path.startswith("/") else "", "query": query,
           "evidence": evidence, "action": action, "priority": prio}
    for k in ("impressions", "clicks", "ctr", "position", "sessions", "purchases", "prev_clicks", "change"):
        row[k] = m.get(k)
    return row


# ------------------------------------------------------------------ main per-site build
def build_site(site_id, month, folder, prev, warnings, extras):
    gsc = read_gsc_zip(first_file(folder, "gsc_performance*.zip", "*.zip"), month, warnings) \
        if first_file(folder, "gsc_performance*.zip", "*.zip") else None
    if gsc is None:
        raise InputError(f"{site_id}：缺少 GSC 效果报告 ZIP（gsc_performance.zip）。")
    qp_file = first_file(folder, "gsc_query_page*.csv", "query_page*.csv")
    if qp_file is None:
        raise InputError(f"{site_id}：缺少查询词×着陆页明细（gsc_query_page.csv）。")
    qp = read_query_page(qp_file, month, warnings)
    land_file = first_file(folder, "ga4_landing*.csv", "ga4_landing*.xlsx")
    acq_file = first_file(folder, "ga4_acquisition*.csv", "ga4_acquisition*.xlsx")
    if land_file is None or acq_file is None:
        raise InputError(f"{site_id}：缺少 GA4 着陆页（ga4_landing.csv）或流量获取报告（ga4_acquisition.csv）。")
    landing, land_cols = read_ga4(land_file, month, warnings, need_landing=True)
    acq, acq_cols = read_ga4(acq_file, month, warnings, need_landing=False)
    unindexed = []
    for f in sorted(folder.glob("gsc_unindexed*")):
        unindexed += read_unindexed(f, warnings)
    if not unindexed:
        warnings.append(f"{site_id}：没有未编入索引的导出，本月收录类机会为空。")

    # ---- GA4 natural traffic
    ga = summarize_ga4(acq)
    ga_land = summarize_ga4(landing)
    if ga["organic"]["sessions"] and ga_land["organic"]["sessions"]:
        diff = abs(ga_land["organic"]["sessions"] - ga["organic"]["sessions"]) / ga["organic"]["sessions"]
        if diff > 0.05:
            warnings.append(f"{site_id}：着陆页明细的自然会话（{ga_land['organic']['sessions']:.0f}）与流量获取报告"
                            f"（{ga['organic']['sessions']:.0f}）相差 {diff:.0%}，请确认两份导出的筛选条件一致。")
    checks = []
    gclk = gsc["totals"]["clicks"]
    gs = ga["google_organic"]["sessions"]
    if gclk and gs:
        ratio = gs / gclk
        checks.append(f"GA4 google / organic 会话 ÷ GSC 点击 = {ratio:.2f}（正常约 1.4–1.6）")
        if ratio < 1.0 or ratio > 2.2:
            warnings.append(f"{site_id}：GA4 google / organic 会话是 GSC 点击的 {ratio:.2f} 倍，偏离正常范围，请检查渠道归类或跟踪。")
    notset = sum(r["sessions"] or 0 for r in landing if (r.get("path") or "").startswith("(not set)")
                 and classify(r.get("source_medium"), r.get("channel"))[1])
    if ga_land["organic"]["sessions"] and notset / ga_land["organic"]["sessions"] > 0.05:
        checks.append(f"自然流量着陆页为“(not set)”的会话占 {notset / ga_land['organic']['sessions']:.0%}，属于跟踪问题")

    # ---- pages (GSC page report first, query x page as fallback; GA4 natural landing rows)
    pages = {}
    for p in gsc.get("pages", []):
        path = url_path(p["key"])
        d = pages.setdefault(path, {"path": path})
        d.update(gsc_clicks=p["clicks"], gsc_impressions=p["impressions"], gsc_position=p["position"], gsc_source="网页报告")
    qp_page = {}
    for r in qp:
        a = qp_page.setdefault(r["path"], [0, 0, 0.0])
        a[0] += r["impressions"]; a[1] += r["clicks"]; a[2] += (r["position"] or 0) * r["impressions"]
    for path, a in qp_page.items():
        d = pages.setdefault(path, {"path": path})
        if "gsc_clicks" not in d:
            d.update(gsc_clicks=a[1], gsc_impressions=a[0], gsc_position=round(a[2] / a[0], 2) if a[0] else None,
                     gsc_source="查询词明细")
    for r in landing:
        if not classify(r.get("source_medium"), r.get("channel"))[1]:
            continue
        path = r.get("path") or "(not set)"
        d = pages.setdefault(path, {"path": path})
        for k in ("sessions", "purchases", "revenue", "items_viewed", "add_to_carts"):
            d["ga_" + k] = (d.get("ga_" + k) or 0) + (r.get(k) or 0)
        d["_eng_w"] = d.get("_eng_w", 0) + (r.get("avg_engagement") or 0) * (r.get("sessions") or 0)
        d["_er_w"] = d.get("_er_w", 0) + (r.get("engagement_rate") or 0) * (r.get("sessions") or 0)
    for d in pages.values():
        s = d.get("ga_sessions") or 0
        d["ga_avg_engagement"] = round(d.pop("_eng_w", 0) / s, 1) if s else None
        d["ga_engagement_rate"] = round(d.pop("_er_w", 0) / s, 4) if s else None
        d["gsc_ctr"] = pct(d.get("gsc_clicks") or 0, d.get("gsc_impressions") or 0) if d.get("gsc_impressions") else None
        d["page_type"] = page_type(d["path"]) if d["path"].startswith("/") else "跟踪问题"
    page_rows = [d for d in pages.values() if (d.get("gsc_impressions") or 0) >= C.PAGES_MIN_IMPR
                 or (d.get("ga_sessions") or 0) >= C.PAGES_MIN_SESSIONS]
    page_rows.sort(key=lambda d: (-(d.get("gsc_clicks") or 0), -(d.get("ga_sessions") or 0)))

    pkey = lambda path: path.lower().rstrip("/") or "/"
    prev_pages = {pkey(d["path"]): d for d in (prev.get("pages", {}).get("rows") or [])}
    prev_kw = {k["query"]: k for k in (prev.get("keywords", {}).get("rows") or [])}
    O = []
    lim = C.PER_CATEGORY_LIMIT

    # 1 core pages
    for d in [x for x in page_rows if x["path"].startswith("/")][:C.CORE_TOP_N]:
        pv = prev_pages.get(pkey(d["path"]))
        pc = pv.get("gsc_clicks") if pv else None
        ch = (d["gsc_clicks"] / pc - 1) if pc else None
        alert = ch is not None and ch <= -C.CORE_DROP_ALERT
        O.append(opp("核心页面", site_id, d["path"], action="保护为主，不轻易大改；下滑时先查排名、点击率和曝光哪项变了",
                     evidence=("上月无数据" if pc is None else f"点击 {pc:.0f} → {d['gsc_clicks'] or 0:.0f}"
                               + (f"（{ch:+.0%}）" if ch is not None else ""))
                     + ("，跌幅超过 20%" if alert else ""), prio="高" if alert else "中",
                     impressions=d.get("gsc_impressions"), clicks=d.get("gsc_clicks"), ctr=d.get("gsc_ctr"),
                     position=d.get("gsc_position"), sessions=d.get("ga_sessions"), purchases=d.get("ga_purchases"),
                     prev_clicks=pc, change=ch))

    # 2 declining pages
    if prev_pages:
        dec = []
        for d in page_rows:
            pv = prev_pages.get(pkey(d["path"]))
            if not pv or (pv.get("gsc_clicks") or 0) < C.DECLINE_MIN_PREV_CLICKS:
                continue
            ch = (d.get("gsc_clicks") or 0) / pv["gsc_clicks"] - 1
            if ch > -C.DECLINE_MIN_DROP:
                continue
            pos_now, pos_prev = d.get("gsc_position"), pv.get("gsc_position")
            ctr_now, ctr_prev = d.get("gsc_ctr"), pv.get("gsc_ctr")
            imp_ch = pct(d.get("gsc_impressions") or 0, pv.get("gsc_impressions") or 0)
            if pos_now and pos_prev and pos_now - pos_prev >= 1:
                why, act = f"排名下降（{pos_prev:.1f} → {pos_now:.1f}）", "查核心词排名和竞争页面，更新内容"
            elif ctr_now is not None and ctr_prev and ctr_now < ctr_prev * 0.8 and imp_ch and imp_ch > 0.8:
                why, act = f"排名基本不变，点击率下降（{ctr_prev:.1%} → {ctr_now:.1%}）", "在谷歌上看搜索结果页是否变化（精选摘要、购物广告等），再改标题"
            elif imp_ch is not None and imp_ch < 0.8:
                why, act = f"排名和点击率基本不变，曝光下降 {1 - imp_ch:.0%}", "可能是需求或季节性下降，先观察"
            else:
                why, act = "多项指标同时变化", "逐项核对排名、点击率、曝光"
            dec.append(opp("下滑页面", site_id, d["path"], action=act, evidence=f"点击 {pv['gsc_clicks']:.0f} → "
                           f"{d.get('gsc_clicks') or 0:.0f}（{ch:+.0%}）；{why}",
                           prio=priority(pv["gsc_clicks"] - (d.get("gsc_clicks") or 0), 50, 15),
                           impressions=d.get("gsc_impressions"), clicks=d.get("gsc_clicks"), ctr=ctr_now,
                           position=pos_now, prev_clicks=pv["gsc_clicks"], change=ch))
        dec.sort(key=lambda r: (r["clicks"] or 0) - (r["prev_clicks"] or 0))
        O += dec[:lim]
    else:
        warnings.append(f"{site_id}：没有上月数据，“下滑页面”本月不计算。")

    # 3 rank 11-20
    thr = C.SITES[site_id].get("rank_min_impr", 30)
    rk = [r for r in qp if r["position"] and C.RANK_BAND[0] <= r["position"] <= C.RANK_BAND[1]
          and r["impressions"] >= thr and not C.LOCALE_PREFIX_RE.match(r["path"])]
    groups = {"排名11–20（产品/集合页）": [], "排名11–20（博客）": [], "排名11–20（其他）": []}
    for r in rk:
        t = page_type(r["path"])
        g = "排名11–20（产品/集合页）" if t in ("产品页", "集合页", "首页") else "排名11–20（博客）" if t == "博客" else "排名11–20（其他）"
        groups[g].append(r)
    acts = {"排名11–20（产品/集合页）": "补型号词和叫法（Title、H1、正文），从相关博客和集合页加内链",
            "排名11–20（博客）": "补内容深度和 PAA 问题，加内链指向产品页",
            "排名11–20（其他）": "确认这个词该由哪个页面承接，再补内容或内链"}
    for g, rs in groups.items():
        rs.sort(key=lambda r: -r["impressions"])
        for r in rs[:lim]:
            O.append(opp(g, site_id, r["path"], r["query"], acts[g],
                         f"排名 {r['position']:.1f}，曝光 {r['impressions']:.0f}，点击 {r['clicks']:.0f}"
                         + ("（品牌词）" if is_brand(site_id, r["query"]) else ""),
                         priority(r["impressions"], thr * 10, thr * 3), impressions=r["impressions"],
                         clicks=r["clicks"], ctr=pct(r["clicks"], r["impressions"]), position=r["position"]))

    # 4 low CTR (page level, same position band, shopping long titles excluded)
    filt = [r for r in qp if not shopping_title(r["query"], r["position"], page_type(r["path"]))]
    band_tot = {}
    for r in filt:
        b = band_of(r["position"])
        if b is not None:
            t = band_tot.setdefault(b, [0, 0]); t[0] += r["clicks"]; t[1] += r["impressions"]
    band_avg = {b: pct(c, i) for b, (c, i) in band_tot.items()}
    pg = {}
    for r in filt:
        a = pg.setdefault(r["path"], [0, 0, 0.0]); a[0] += r["impressions"]; a[1] += r["clicks"]; a[2] += (r["position"] or 0) * r["impressions"]
    low = []
    for path, (imp, clk, wp) in pg.items():
        if imp < C.LOW_CTR_MIN_IMPR or C.LOCALE_PREFIX_RE.match(path):
            continue
        pos = wp / imp
        b = band_of(pos)
        if b is None or not band_avg.get(b):
            continue
        ctr = clk / imp
        if ctr < C.LOW_CTR_RATIO * band_avg[b]:
            low.append(opp("点击率偏低", site_id, path, action="去谷歌上看这个页面的搜索结果，对比竞争对手，改 Title 和 Meta Description",
                           evidence=f"排名 {pos:.1f}，点击率 {ctr:.2%}，本站同排名段平均 {band_avg[b]:.2%}"
                                    f"（通用参考 {C.CTR_REFERENCE[b]}）；已排除购物类长标题查询",
                           prio=priority(imp, 3000, 800), impressions=imp, clicks=clk, ctr=ctr, position=round(pos, 1)))
    low.sort(key=lambda r: -r["impressions"])
    O += low[:lim]

    # 5 mismatch / missing content (needs the keyword mapping)
    mapping = extras.get("mapping", {}).get(site_id)
    by_query = {}
    for r in qp:
        by_query.setdefault(r["query"], []).append(r)
    if mapping:
        mm = []
        for kw, target in mapping.items():
            rs = by_query.get(kw)
            if not rs:
                continue
            tot_imp = sum(r["impressions"] for r in rs)
            if tot_imp < thr:
                continue
            top = max(rs, key=lambda r: r["impressions"])
            if base_path(top["path"]) != base_path(target):
                tgt = [r for r in rs if base_path(r["path"]) == base_path(target)]
                mm.append(opp("错位：实际页面≠规划页面", site_id, top["path"], kw,
                              f"规划由 {target} 承接：在规划页补这个词，从实际排名页加内链过去；确认两页分工",
                              f"实际排名页 排名 {top['position']:.1f}、曝光 {top['impressions']:.0f}；规划页"
                              + (f" 排名 {tgt[0]['position']:.1f}、曝光 {tgt[0]['impressions']:.0f}" if tgt else " 没有曝光"),
                              priority(tot_imp, thr * 10, thr * 3), impressions=tot_imp,
                              clicks=sum(r["clicks"] for r in rs), position=top["position"]))
        mm.sort(key=lambda r: -r["impressions"])
        O += mm[:lim]
        miss = []
        for q, rs in by_query.items():
            if q in mapping or is_brand(site_id, q):
                continue
            tot_imp = sum(r["impressions"] for r in rs)
            top = max(rs, key=lambda r: r["impressions"])
            if tot_imp >= C.MISSING_CONTENT_MIN_IMPR and (top["position"] or 99) > 10:
                miss.append(opp("机会词：未规划承接页", site_id, top["path"], q,
                                "判断这个词有没有价值：有的话新写一篇或扩充现有页面，并补进关键词归属表",
                                f"曝光 {tot_imp:.0f}，最好排名 {top['position']:.1f}，归属表里没有这个词",
                                priority(tot_imp, 2000, 800), impressions=tot_imp,
                                clicks=sum(r["clicks"] for r in rs), position=top["position"]))
        miss.sort(key=lambda r: -r["impressions"])
        O += miss[:lim]
    else:
        warnings.append(f"{site_id}：没有关键词归属表，本月不计算错位和机会词。")

    # 6 low engagement / 7 conversion (GA4 natural landing pages)
    lp = [d for d in page_rows if (d.get("ga_sessions") or 0) > 0 and d["path"].startswith("/")
          and not C.NOISE_PATH_RE.search(d["path"])]
    tot_s = sum(d["ga_sessions"] for d in lp)
    avg_eng = sum((d["ga_avg_engagement"] or 0) * d["ga_sessions"] for d in lp) / tot_s if tot_s else None
    site_conv = ga["organic"]["conversion"]
    for d in lp:
        s = d["ga_sessions"]
        if s >= C.LOW_ENGAGEMENT_MIN_SESSIONS and avg_eng and (
                (d["ga_avg_engagement"] or 0) < C.LOW_ENGAGEMENT_TIME_RATIO * avg_eng
                or (d["ga_engagement_rate"] or 0) < C.LOW_ENGAGEMENT_RATE):
            O.append(opp("互动差", site_id, d["path"], action="查首屏、产品推荐、CTA 和页面结构；先确认产品是否还在卖",
                         evidence=f"自然会话 {s:.0f}，平均互动 {d['ga_avg_engagement'] or 0:.0f} 秒（全站 {avg_eng:.0f} 秒），"
                                  f"互动率 {d['ga_engagement_rate'] or 0:.0%}",
                         prio=priority(s, 150, 50), sessions=s, purchases=d.get("ga_purchases")))
    if site_conv:
        hi = sorted([d for d in lp if d["ga_sessions"] >= C.CONV_HIGH_TRAFFIC_MIN_SESSIONS
                     and (d.get("ga_purchases") or 0) / d["ga_sessions"] < C.CONV_LOW_RATIO * site_conv],
                    key=lambda d: -d["ga_sessions"])
        for d in hi[:lim]:
            atc = d.get("ga_add_to_carts") or 0
            O.append(opp("流量高、转化低", site_id, d["path"],
                         action="查搜索意图、产品推荐、价格和信任信息" + ("；有加购没成交，查价格、运费和结账流程" if atc >= 5 else ""),
                         evidence=f"自然会话 {d['ga_sessions']:.0f}，订单 {d.get('ga_purchases') or 0:.0f}，加购 {atc:.0f}；"
                                  f"全站自然转化率 {site_conv:.2%}",
                         prio=priority(d["ga_sessions"], 200, 80), sessions=d["ga_sessions"], purchases=d.get("ga_purchases")))
        lo_, hi_ = C.CONV_SMALL_TRAFFIC
        sm = sorted([d for d in lp if lo_ <= d["ga_sessions"] < hi_ and (d.get("ga_purchases") or 0) >= C.CONV_MIN_PURCHASES
                     and (d["ga_purchases"] / d["ga_sessions"]) >= C.CONV_HIGH_RATIO * site_conv],
                    key=lambda d: -(d["ga_purchases"] / d["ga_sessions"]))
        for d in sm[:lim]:
            O.append(opp("流量低、转化高", site_id, d["path"], action="加内链，写相关博客引流",
                         evidence=f"自然会话 {d['ga_sessions']:.0f}，订单 {d['ga_purchases']:.0f}，"
                                  f"转化率 {d['ga_purchases'] / d['ga_sessions']:.1%}（全站 {site_conv:.2%}）",
                         prio="高" if d["ga_purchases"] >= 3 else "中", sessions=d["ga_sessions"], purchases=d["ga_purchases"]))

    # 8 indexing
    seen = set()
    for u in unindexed:
        p = u["path"]
        if C.LOCALE_PREFIX_RE.match(p) or C.NOISE_PATH_RE.search(p) or p in seen:
            continue
        seen.add(p)
        t = page_type(p)
        act = ("查 canonical、robots、sitemap、内链和重复内容" if "已抓取" in u["reason"]
               else "加内链、确认在 sitemap 里，重要页面用网址检查请求编入索引")
        if t == "产品页" and "/collections/" in p:
            act = "带集合路径的产品网址，确认 canonical 指向 /products/ 主网址，一般不需要收录"
        O.append(opp("未收录", site_id, p, action=act, evidence=u["reason"] + (f"，上次抓取 {u['last_crawl']}" if u["last_crawl"] else ""),
                     prio="高" if t in ("产品页", "集合页", "博客") and "/collections/" not in p.split("/products/")[0][1:] else "中"))
    blog = extras.get("blog", {}).get(site_id) or []
    ms, me = month_bounds(month)
    with_impr = {base_path(d["path"]) for d in page_rows if (d.get("gsc_impressions") or 0) > 0}
    for a in blog:
        pub = a.get("published_on")
        if pub and pub <= me - timedelta(days=C.NEW_ARTICLE_DAYS) and pub >= me - timedelta(days=120) \
                and base_path(a["path"]) not in with_impr and a["path"] not in seen:
            O.append(opp("新文章无曝光", site_id, a["path"], action="用网址检查确认是否收录；没收录就加内链并请求编入索引",
                         evidence=f"{pub} 上线，超过 {C.NEW_ARTICLE_DAYS} 天在 GSC 仍无曝光（抽查线索，不等于确认未收录）", prio="中"))

    # 9 ads x organic (optional)
    ads = extras.get("ads", {}).get(site_id)
    if ads:
        for t in sorted(ads, key=lambda a: -(a["conversions"] or 0)):
            if (t["conversions"] or 0) < 1:
                continue
            rs = by_query.get(t["term"])
            top = max(rs, key=lambda r: r["impressions"]) if rs else None
            if top and (top["position"] or 99) <= 10:
                continue
            O.append(opp("广告有转化、自然排名弱", site_id, top["path"] if top else "", t["term"],
                         "按搜索意图匹配到产品页、集合页或博客承接",
                         f"广告转化 {t['conversions']:.1f}、点击 {t['clicks'] or 0:.0f}；自然"
                         + (f"排名 {top['position']:.1f}（{top['path']}）" if top else "没有曝光"),
                         priority(t["conversions"], 5, 2), position=top["position"] if top else None))

    # ---- keywords
    kws = extras.get("keywords", {}).get(site_id)
    if not kws and mapping:
        ranked = sorted(((kw, sum(r["impressions"] for r in by_query.get(kw, []))) for kw in mapping), key=lambda x: -x[1])
        kws = {kw: mapping[kw] for kw, imp in ranked[:C.KEYWORD_AUTO_TOP_N] if imp > 0}
        warnings.append(f"{site_id}：关键词监控词表未确认，暂按归属表中曝光最高的 {len(kws)} 个词自动选取。")
    kw_rows = []
    for kw, target in (kws or {}).items():
        rs = by_query.get(kw, [])
        imp = sum(r["impressions"] for r in rs)
        clk = sum(r["clicks"] for r in rs)
        top = max(rs, key=lambda r: r["impressions"]) if rs else None
        status = ("本月无曝光" if not top else "一致" if not target or base_path(top["path"]) == base_path(target) else "错位")
        pv = prev_kw.get(kw)
        kw_rows.append({"query": kw, "position": top["position"] if top else None,
                        "previous_position": pv.get("position") if pv else None,
                        "actual_url": full_url(site_id, top["path"]) if top else None,
                        "planned_url": full_url(site_id, target) if target else None, "status": status,
                        "impressions": imp, "clicks": clk, "ctr": pct(clk, imp), "brand": is_brand(site_id, kw)})
    kw_rows.sort(key=lambda r: -(r["impressions"] or 0))

    # ---- content (blog performance)
    unidx = {base_path(u["path"]): u["reason"] for u in unindexed}
    pmap = {base_path(d["path"]): d for d in page_rows}
    content_rows = []
    articles = blog or [{"path": d["path"], "title": None, "published_on": None, "topic": None}
                        for d in page_rows if page_type(d["path"]) == "博客"]
    for a in articles:
        d = pmap.get(base_path(a["path"]), {})
        pub = a.get("published_on")
        if base_path(a["path"]) in unidx:
            st = unidx[base_path(a["path"])]
        elif (d.get("gsc_impressions") or 0) > 0:
            st = "有曝光（已收录）"
        elif pub and pub > me - timedelta(days=C.NEW_ARTICLE_DAYS):
            st = "新上线，待观察"
        else:
            st = "无曝光，待抽查"
        content_rows.append({"title": a.get("title"), "page_url": full_url(site_id, a["path"]),
                             "published_on": str(pub) if pub else None, "topic": a.get("topic"), "index_status": st,
                             "impressions": d.get("gsc_impressions"), "clicks": d.get("gsc_clicks"),
                             "position": d.get("gsc_position"), "sessions": d.get("ga_sessions"),
                             "product_views": d.get("ga_items_viewed"), "purchases": d.get("ga_purchases")})
    content_rows.sort(key=lambda r: -(r["impressions"] or 0))
    topics = {}
    for r in content_rows:
        if r.get("topic"):
            t = topics.setdefault(r["topic"], {"topic": r["topic"], "articles": 0, "impressions": 0, "clicks": 0, "sessions": 0})
            t["articles"] += 1
            for k in ("impressions", "clicks", "sessions"):
                t[k] += r.get(k) or 0
    for t in topics.values():
        t["clicks_per_article"] = round(t["clicks"] / t["articles"], 1)

    # ---- overview
    def dev_rows():
        out = []
        for d in gsc.get("devices", []):
            out.append({"device": d["key"], "clicks": d["clicks"], "impressions": d["impressions"],
                        "ctr": pct(d["clicks"], d["impressions"]), "position": d["position"]})
        return out
    devices = dev_rows()
    dmap = {re.sub(r"\s", "", d["device"].lower()): d for d in devices}
    mob = dmap.get("mobile") or dmap.get("移动设备") or dmap.get("手机")
    desk = dmap.get("desktop") or dmap.get("桌面设备") or dmap.get("桌面")
    if mob and desk and mob["ctr"] is not None and desk["ctr"]:
        if mob["ctr"] < 0.7 * desk["ctr"] or ((mob["position"] or 0) - (desk["position"] or 0)) >= 2:
            checks.append(f"移动端明显弱于桌面端：点击率 {mob['ctr']:.2%} vs {desk['ctr']:.2%}，排名 "
                          f"{mob['position'] or 0:.1f} vs {desk['position'] or 0:.1f}")
    countries = sorted(gsc.get("countries", []), key=lambda c: -c["clicks"])[:15]
    overview = {
        "gsc": gsc["totals"], "ga4": {**ga, "currency": "USD"},
        "devices": devices,
        "countries": [{"country": c["key"], "clicks": c["clicks"], "impressions": c["impressions"],
                       "ctr": pct(c["clicks"], c["impressions"]), "position": c["position"]} for c in countries],
        "checks": checks,
    }
    O.sort(key=lambda r: ({"高": 0, "中": 1, "低": 2}[r["priority"]],))
    files = [str(p.name) for p in sorted(folder.iterdir())]
    prov = {"files": files, "date_range": f"{ms} 至 {me}", "ga4_columns": {"landing": land_cols, "acquisition": acq_cols},
            "organic_definition": "Organic Search/Shopping/Social/Video + AI Assistant（含被归入其他渠道的 AI 来源），"
                                  "剔除 bing / search_bra、bing / pla", "gsc_query_coverage":
                f"查询词明细点击 {sum(r['clicks'] for r in qp):.0f} / 总点击 {gsc['totals']['clicks']:.0f}"}
    return {
        "overview": overview,
        "opportunities": {"rows": O},
        "keywords": {"rows": kw_rows},
        "content": {"rows": content_rows, "topics": sorted(topics.values(), key=lambda t: -t["clicks_per_article"])},
        "pages": {"rows": [{k: v for k, v in d.items() if not k.startswith("_")} for d in page_rows[:3000]]},
    }, prov


# ------------------------------------------------------------------ monthly (12 sites)
def build_monthly(month, root, site_totals, warnings):
    rows = {}
    sem = first_file(root, "semrush*.csv", "semrush*.xlsx")
    if sem:
        al = {"site": ["site_id", "站点", "domain", "网址"], "database": ["database", "数据库"],
              "snapshot_date": ["snapshot_date", "日期", "date"], "metric": ["traffic_metric", "流量指标名称", "metric"],
              "traffic": ["traffic", "自然流量"], "r1": ["rank_1_3", "1-3"], "r2": ["rank_4_10", "4-10"],
              "r3": ["rank_11_20", "11-20"], "r4": ["rank_21_50", "21-50"], "r5": ["rank_51_plus", "51+"],
              "total": ["rank_total", "总数", "total"]}
        for r in read_table_dicts(sem, al, required=("site", "traffic", "total")):
            sid = resolve_site(r["site"])
            if not sid:
                raise InputError(f"Semrush 模板：无法识别站点“{r['site']}”。")
            bands = [num(r[k]) for k in ("r1", "r2", "r3", "r4", "r5")]
            tot = num(r["total"])
            if tot is not None and all(b is not None for b in bands) and abs(sum(bands) - tot) > 0.5:
                warnings.append(f"Semrush {sid}：各排名段相加 {sum(bands):.0f} ≠ 总数 {tot:.0f}。")
            rows.setdefault(sid, {}).update(
                semrush_traffic=num(r["traffic"]), rank_1_3=bands[0], rank_4_10=bands[1], rank_11_20=bands[2],
                rank_21_50=bands[3], rank_51_plus=bands[4], rank_total=tot, rank_tool="Semrush",
                semrush_meta={"database": r.get("database"), "snapshot_date": r.get("snapshot_date"), "metric": r.get("metric")})
    else:
        warnings.append("没有 Semrush 模板（semrush.csv），月度表的 Semrush 行为空。")
    for sid, t in site_totals.items():
        rows.setdefault(sid, {}).update(gsc_clicks=t["clicks"], gsc_impressions=t["impressions"], gsc_source=t.get("source"))
    man = first_file(root, "summary_sites/monthly_gsc_manual*.csv", "monthly_gsc_manual*.csv")
    if man:
        for r in read_table_dicts(man, {"site": ["site_id", "站点", "domain"], "clicks": ["clicks", "点击"],
                                        "impressions": ["impressions", "曝光", "展示"], "range": ["date_range", "日期范围"]},
                                  required=("site", "clicks", "impressions")):
            sid = resolve_site(r["site"])
            if sid and sid not in site_totals:
                rows.setdefault(sid, {}).update(gsc_clicks=num(r["clicks"]), gsc_impressions=num(r["impressions"]),
                                                gsc_source=f"手工填写（{r.get('range') or '未注明日期'}）")
    for sid in C.SITES:
        if "gsc_clicks" not in rows.get(sid, {}):
            warnings.append(f"月度表：{sid} 缺少 GSC 点击和曝光。")
    return rows


def resolve_site(s):
    s = str(s or "").strip().lower().replace("https://", "").replace("http://", "").strip("/")
    for sid, v in C.SITES.items():
        if s in (sid, v["domain"], v["domain"].replace("www.", "")):
            return sid
    return None


# ------------------------------------------------------------------ extras
def load_extras(root, warnings):
    ex = {"mapping": {}, "blog": {}, "ads": {}, "keywords": {}}
    for sid in C.DEEP_SITES:
        f = first_file(root / "reference", f"{sid}_keyword_page_mapping*.csv", f"{sid}_mapping*.csv") if (root / "reference").exists() else None
        f = f or first_file(root, f"{sid}/keyword_page_mapping*.csv")
        if f:
            m = {}
            for r in read_table_dicts(f, {"kw": ["keyword", "关键词"], "url": ["目标url", "target url", "url", "目标页面"]},
                                      required=("kw", "url")):
                if r["kw"] and r["url"]:
                    m[str(r["kw"]).strip().lower()] = url_path(r["url"])
            ex["mapping"][sid] = m
        f = first_file(root, f"{sid}/keywords_monitor*.csv")
        if f:
            ex["keywords"][sid] = {str(r["kw"]).strip().lower(): (url_path(r["url"]) if r.get("url") else None)
                                   for r in read_table_dicts(f, {"kw": ["keyword", "关键词"], "url": ["目标url", "target url", "url"]},
                                                             required=("kw",)) if r["kw"]}
        f = first_file(root, f"{sid}/ads_search_terms*.csv")
        if f:
            ex["ads"][sid] = [{"term": str(r["term"]).strip().lower(), "clicks": num(r["clicks"]),
                               "cost": num(r["cost"]), "conversions": num(r["conv"]), "value": num(r["value"])}
                              for r in read_table_dicts(f, {"term": ["搜索字词", "search term"], "clicks": ["点击次数", "clicks"],
                                                            "cost": ["费用", "cost"], "conv": ["转化次数", "conversions"],
                                                            "value": ["转化价值", "conv. value", "conversion value"]},
                                                        required=("term", "conv")) if r["term"]]
    bf = first_file(root, "blog_articles*.csv", "blog_articles*.xlsx")
    if bf:
        for r in read_table_dicts(bf, {"url": ["url", "网址", "blog url"], "title": ["title", "标题", "文章话题"],
                                       "pub": ["published_on", "上线日期", "上传日期"], "topic": ["topic", "主题"],
                                       "site": ["site_id", "站点", "品牌"]}, required=("url",)):
            u = str(r["url"]).strip()
            sid = resolve_site(re.sub(r"^https?://", "", u).split("/")[0]) or resolve_site(r.get("site"))
            if not sid:
                continue
            pub = r.get("pub")
            if hasattr(pub, "date"):
                pub = pub.date()
            elif pub:
                try:
                    pub = date.fromisoformat(str(pub)[:10].replace("/", "-"))
                except ValueError:
                    pub = None
            ex["blog"].setdefault(sid, []).append({"path": url_path(u), "title": r.get("title"), "published_on": pub,
                                                   "topic": r.get("topic")})
    return ex


def load_prev(path):
    if not path:
        return {}
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    items = data.get("snapshots", data) if isinstance(data, dict) else data
    prev = {}
    for s in items:
        prev.setdefault(s["site_id"], {})[s["section"]] = s["payload"]
    return prev


# ------------------------------------------------------------------ entry point
def run(month, input_dir, out_dir, prev_path=None, publish=True):
    root = Path(input_dir)
    out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    warnings, errors, snaps = [], [], []
    extras = load_extras(root, warnings)
    prev = load_prev(prev_path)
    site_totals = {}
    for sid in C.DEEP_SITES:
        folder = root / sid
        if not folder.exists():
            warnings.append(f"{sid}：没有 {folder} 文件夹，本月跳过。")
            continue
        try:
            sections, prov = build_site(sid, month, folder, prev.get(sid, {}), warnings, extras)
        except InputError as e:
            errors.append(str(e))
            continue
        site_totals[sid] = {**sections["overview"]["gsc"], "source": "GSC 效果报告"}
        for sec, payload in sections.items():
            snaps.append({"site_id": sid, "month": month + "-01", "section": sec, "published": publish,
                          "payload": payload, "provenance": prov})
    summary = root / "summary_sites"
    if summary.exists():
        for z in sorted(summary.glob("*.zip")):
            sid = resolve_site(z.stem)
            if not sid:
                errors.append(f"summary_sites/{z.name}：文件名要用站点 id 或域名，例如 autel-uk.zip。")
                continue
            try:
                g = read_gsc_zip(z, month, warnings)
                site_totals[sid] = {**g["totals"], "source": "GSC 效果报告"}
            except InputError as e:
                errors.append(str(e))
    try:
        monthly = build_monthly(month, root, site_totals, warnings)
    except InputError as e:
        errors.append(str(e)); monthly = {}
    for sid, payload in monthly.items():
        snaps.append({"site_id": sid, "month": month + "-01", "section": "monthly", "published": publish,
                      "payload": payload, "provenance": {"files": ["semrush.csv", "GSC"], "month": month}})
    (out / "import.json").write_text(json.dumps({"snapshots": snaps}, ensure_ascii=False, default=str), encoding="utf-8")
    from .monthly_excel import write_monthly_column
    write_monthly_column(month, monthly, out / "monthly_column.xlsx")
    rep = [f"# {month} 数据处理报告", "", f"生成快照 {len(snaps)} 份。", ""]
    rep += ["## 错误（需要处理后重跑）", ""] + ([f"- {e}" for e in errors] or ["- 无"]) + [""]
    rep += ["## 提醒", ""] + ([f"- {w}" for w in warnings] or ["- 无"])
    (out / "report.md").write_text("\n".join(rep), encoding="utf-8")
    return snaps, warnings, errors


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", required=True, help="YYYY-MM")
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--prev", help="上月 import.json，用于环比、下滑页面和关键词上月排名")
    ap.add_argument("--draft", action="store_true", help="导入为草稿（仅管理员可见）")
    a = ap.parse_args()
    snaps, warnings, errors = run(a.month, a.input, a.out, a.prev, publish=not a.draft)
    print(f"快照 {len(snaps)} 份，提醒 {len(warnings)} 条，错误 {len(errors)} 条。详见 {a.out}/report.md")
    for e in errors:
        print("错误：", e)
    raise SystemExit(1 if errors else 0)


if __name__ == "__main__":
    main()
