"""Blog summary sheet (月度数据总结表): per-article GA4 numbers, site baseline and the 指数 block.

Inputs per brand, all optional, in inputs/YYYY-MM/blog_summary/<site_id>/ (use the same date
window for all three files; the sheet is usually a cumulative window, not one month):
  ga4_pages.csv            GA4 报告 → 互动 → 网页和屏幕（维度：网页路径和屏幕类），不加过滤
  ga4_acquisition_blog.csv GA4 报告 → 流量获取（会话来源/媒介），过滤“着陆页 包含 /blogs/”
  ga4_acquisition_all.csv  同一报告，不加过滤（全站基准）
GA4 standard-report exports carry no total row, so de-duplicated user counts (全站活跃用户,
博客去重活跃用户) cannot be computed from them; those cells stay empty for manual entry.
"""
from .readers import read_rows, find_col, num, url_path, base_path, ga4_date_range, InputError

SITES = {"autelonline": "/blogs/news", "launchx431online": "/blogs/news", "otofix": "/blogs/otofix-blog"}
TOTAL_LABELS = {"", "总计", "合计", "total", "totals", "grand total"}


def _first(folder, pattern):
    fs = sorted(folder.glob(pattern)) if folder.exists() else []
    return fs[0] if fs else None


def read_pages(path, warnings):
    header, rows, meta = read_rows(path)
    src = path.name
    ip = find_col(header, ["网页路径和屏幕类", "page path and screen class", "网页路径", "page path", "着陆页", "landing page"],
                  label="网页路径和屏幕类", source=src)
    iv = find_col(header, ["浏览次数", "views"], label="浏览次数", source=src)
    iu = find_col(header, ["活跃用户", "active users"], label="活跃用户", source=src)
    ie = find_col(header, ["每位活跃用户的平均互动时长", "average engagement time per active user", "平均互动时长"],
                  required=False, source=src)
    pages, total, totals_row = {}, {"views": 0}, None
    for r in rows:
        key = str(r[ip] if ip < len(r) else "").strip()
        v, u = num(r[iv]), num(r[iu])
        e = num(r[ie]) if ie is not None else None
        if key.lower() in TOTAL_LABELS:
            totals_row = {"views": v, "users": u, "eng": e}
            continue
        p = base_path(url_path(key))
        d = pages.setdefault(p, {"views": 0, "users": 0, "_ew": 0.0})
        d["views"] += v or 0
        d["users"] += u or 0
        d["_ew"] += (e or 0) * (u or 0)
        total["views"] += v or 0
    as_int = lambda v: int(v) if isinstance(v, float) and v.is_integer() else v
    for d in pages.values():
        ew = d.pop("_ew")
        d["eng"] = round(ew / d["users"]) if d["users"] else None
        d["views"], d["users"] = as_int(d["views"]), as_int(d["users"])
    total["views"] = as_int(total["views"])
    if totals_row:
        site = {"views": totals_row["views"], "users": totals_row["users"], "eng": totals_row["eng"]}
    else:
        site = {"views": total["views"], "users": None, "eng": None}
        warnings.append(f"{src}：GA4 导出没有总计行，全站基准只填了浏览次数（各页相加）；"
                        "全站活跃用户和每位活跃用户平均互动时长请在看板里手动填写。")
    if site.get("views") and site.get("users"):
        site["vpu"] = round(site["views"] / site["users"], 2)
    return pages, site, ga4_date_range(meta)


ACQ = {"users": ["活跃用户", "active users"], "sessions": ["会话数", "sessions"],
       "key_events": ["关键事件数", "关键事件", "key events"], "revenue": ["总收入", "total revenue"],
       "engaged": ["感兴趣的会话数", "互动会话数", "engaged sessions"],
       "eng_per_session": ["每次会话的平均互动时长", "在线会话平均互动时长", "average engagement time per session"],
       "events": ["事件数", "event count"], "bounce": ["跳出率", "bounce rate"]}


def read_acq(path):
    header, rows, meta = read_rows(path)
    src = path.name
    idx = {}
    for k, al in ACQ.items():
        excl = ()
        if k == "events":  # “每次会话的事件数”/“在线会话事件数” also contain 事件数
            excl = tuple(i for i, h in enumerate(header) if "每次" in str(h) or "会话事件" in str(h) or "per session" in str(h).lower())
        idx[k] = find_col(header, al, required=k == "sessions", exclude=excl, source=src)
    s = {k: 0.0 for k in ("users", "sessions", "key_events", "revenue", "engaged", "events")}
    ew = 0.0
    has = {k: idx[k] is not None for k in idx}
    for r in rows:
        first = str(r[0] if r else "").strip().lower()
        if first in TOTAL_LABELS and len(rows) > 1:
            continue
        sess = num(r[idx["sessions"]]) or 0
        for k in s:
            if idx[k] is not None:
                s[k] += num(r[idx[k]]) or 0
        if idx["eng_per_session"] is not None:
            ew += (num(r[idx["eng_per_session"]]) or 0) * sess
    out = {k: (round(v, 2) if k == "revenue" else int(round(v))) for k, v in s.items() if has[k]}
    S = s["sessions"]
    if S:
        if has["eng_per_session"]:
            out["eng_per_session"] = round(ew / S)
        if has["events"]:
            out["events_per_session"] = round(s["events"] / S, 2)
        if has["engaged"]:
            out["engaged_rate"] = round(s["engaged"] / S, 4)
            out["bounce"] = round(1 - s["engaged"] / S, 4)
        if has["key_events"]:
            out["key_event_rate"] = round(s["key_events"] / S, 4)
    return out, ga4_date_range(meta)


def build(sid, folder, warnings, indexed=None):
    """-> payload or None when no file is present."""
    pf = _first(folder, "ga4_pages*.csv") or _first(folder, "ga4_pages*.xlsx")
    bf = _first(folder, "ga4_acquisition_blog*.csv") or _first(folder, "ga4_acquisition_blog*.xlsx")
    af = _first(folder, "ga4_acquisition_all*.csv") or _first(folder, "ga4_acquisition_all*.xlsx")
    if not (pf or bf or af or indexed):
        return None, []
    payload, ranges, files = {"pages": {}, "site": {}, "acq": {}}, {}, []
    try:
        if pf:
            pages, site, rg = read_pages(pf, warnings)
            payload["pages"] = {p: d for p, d in pages.items() if p.startswith("/blogs/")}
            payload["site"] = site
            ranges[pf.name] = rg; files.append(pf.name)
        if bf:
            payload["acq"]["blog"], ranges[bf.name] = read_acq(bf); files.append(bf.name)
        if af:
            payload["acq"]["site"], ranges[af.name] = read_acq(af); files.append(af.name)
    except InputError as e:
        warnings.append(f"博客数据总结表 {sid}：{e}")
    if payload["acq"]:
        warnings.append(f"博客数据总结表 {sid}：指数一栏的活跃用户是按来源/媒介逐行相加，会比 GA4 界面上的去重人数略高，需要精确值请手动改。")
    if indexed:
        payload["indexed"] = indexed
    rs = {f"{s} 至 {e}" for s, e in ranges.values() if s and e}
    if len(rs) > 1:
        warnings.append(f"博客数据总结表 {sid}：三份 GA4 导出的日期范围不一致（{'；'.join(sorted(rs))}）。")
    payload["date_range"] = "；".join(sorted(rs)) or None
    if not pf:
        warnings.append(f"博客数据总结表 {sid}：没有 ga4_pages.csv，文章的浏览次数和活跃用户为空。")
    return payload, files
