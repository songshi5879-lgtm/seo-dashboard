"""Readers for the raw exports (GSC ZIP, Looker Studio, GA4, GSC indexing, Semrush template).

Every reader matches columns by name (Chinese or English UI) and fails loudly with a clear
message when a required column is missing, instead of guessing.
"""
import csv, io, re, zipfile, calendar
from datetime import date, datetime
from urllib.parse import urlsplit
from pathlib import Path


class InputError(Exception):
    pass


def norm(s):
    s = str(s or "").strip().lower().replace("﻿", "")
    s = s.replace("（", "(").replace("）", ")").replace("：", ":")
    return re.sub(r"[\s_\-·]+", "", s)


def num(v):
    """Parse '1,234', '12.3%', '00:01:27', '1 分 27 秒', '87.2' -> float; blanks -> None."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "").replace(" ", "")
    if s in ("", "-", "—", "(not set)", "N/A", "n/a"):
        return None
    if s.endswith("%"):
        try:
            return float(s[:-1]) / 100
        except ValueError:
            return None
    m = re.fullmatch(r"(\d+):(\d{1,2}):(\d{1,2})", s)
    if m:
        h, mi, se = map(int, m.groups())
        return h * 3600 + mi * 60 + se
    if "分" in s or "秒" in s:
        parts = re.findall(r"(\d+(?:\.\d+)?)\s*(小时|分|秒)", s)
        return sum(float(a) * {"小时": 3600, "分": 60, "秒": 1}[b] for a, b in parts)
    s = s.replace("$", "").replace("US", "").replace("¥", "").replace("€", "").replace("£", "")
    try:
        return float(s)
    except ValueError:
        return None


def find_col(header, aliases, required=True, exclude=(), label=None, source=""):
    """Index of the first header matching an alias (exact match first, then 'contains')."""
    nh = [norm(h) for h in header]
    na = [norm(a) for a in aliases]
    for a in na:
        for i, h in enumerate(nh):
            if i not in exclude and h == a:
                return i
    for a in na:
        for i, h in enumerate(nh):
            if i not in exclude and a and a in h and "%δ" not in h and "δ" not in h:
                return i
    if required:
        raise InputError(f"{source}：找不到“{label or aliases[0]}”列。现有列：{', '.join(map(str, header))}")
    return None


def _decode(raw):
    for enc in ("utf-8-sig", "utf-16", "gb18030"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    raise InputError("无法识别文件编码")


def read_rows(path_or_bytes, name=None):
    """Return (header, rows, meta_lines). Skips '#' comment lines (GA4) and blank lines.
    For GA4 files with several tables, returns the first table."""
    if isinstance(path_or_bytes, (str, Path)):
        p = Path(path_or_bytes)
        name = name or p.name
        if p.suffix.lower() in (".xlsx", ".xlsm"):
            import openpyxl
            ws = openpyxl.load_workbook(p, read_only=True, data_only=True).active
            data = [["" if c is None else c for c in r] for r in ws.iter_rows(values_only=True)]
            data = [r for r in data if any(str(c).strip() for c in r)]
            return [str(c).strip() for c in data[0]], data[1:], []
        text = _decode(p.read_bytes())
    else:
        text = _decode(path_or_bytes)
    meta, body, started = [], [], False
    for line in text.splitlines():
        if line.startswith("#"):
            if started:
                break
            meta.append(line.lstrip("# ").strip())
            continue
        if not line.strip():
            if started:
                break
            continue
        started = True
        body.append(line)
    data = list(csv.reader(io.StringIO("\n".join(body))))
    if not data:
        raise InputError(f"{name}：文件为空")
    return [h.strip().replace("﻿", "") for h in data[0]], data[1:], meta


def month_bounds(month):
    y, m = map(int, month.split("-"))
    return date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1])


def ga4_date_range(meta):
    """Read GA4 start/end comments or an Exploration-style YYYYMMDD-YYYYMMDD line."""
    s = e = None
    for line in meta:
        m = re.search(r"(开始日期|start date)\s*[:：]\s*(\d{8})", line, re.I)
        if m:
            s = datetime.strptime(m.group(2), "%Y%m%d").date()
        m = re.search(r"(结束日期|end date)\s*[:：]\s*(\d{8})", line, re.I)
        if m:
            e = datetime.strptime(m.group(2), "%Y%m%d").date()
        m = re.search(r"(?<!\d)(\d{8})\s*[-–—至]\s*(\d{8})(?!\d)", line)
        if m:
            s = datetime.strptime(m.group(1), "%Y%m%d").date()
            e = datetime.strptime(m.group(2), "%Y%m%d").date()
    return s, e


def check_range(start, end, month, source, warnings, required=True):
    ms, me = month_bounds(month)
    if start is None or end is None:
        msg = f"{source}：文件里没有日期范围，按 {month} 处理，请确认导出时选的是整月。"
        if required:
            raise InputError(msg)
        warnings.append(msg)
        return
    if (start, end) != (ms, me):
        raise InputError(f"{source}：日期范围是 {start} 至 {end}，应为 {ms} 至 {me}。")


def url_path(u):
    """'https://www.x.com/a/b?variant=1' -> '/a/b?variant=1'; '/a' stays; '(not set)' stays."""
    u = str(u or "").strip().strip('"')
    if not u or u.startswith("("):
        return u or "(not set)"
    if "://" in u:
        sp = urlsplit(u)
        p = sp.path or "/"
        return p + ("?" + sp.query if sp.query else "")
    u = u.split("#", 1)[0]
    return u if u.startswith("/") else "/" + u


def merge_gsc_anchors(rows, warnings, source, by_query=False):
    """Aggregate exact URL rows, then collapse only fragment differences."""
    groups = {}
    for row in rows:
        raw = row["key"]
        path = url_path(raw)
        query = row.get("query")
        fragment = raw.partition("#")[1:]
        exact = groups.setdefault((query, path), {})
        counts = exact.setdefault(fragment, [0, 0, 0, 0])
        counts[0] += row["clicks"]
        counts[1] += row["impressions"]
        if row["position"] is not None:
            counts[2] += row["position"] * row["impressions"]
            counts[3] += row["impressions"]
    out = []
    affected = set()
    for (query, path), exact in groups.items():
        main = exact.get(("", "")) or max(exact.values(), key=lambda r: r[1])
        clicks = sum(row[0] for row in exact.values())
        if any(marker for marker, _ in exact):
            affected.add(path)
        result = {"path": path, "clicks": clicks, "impressions": main[1],
                  "position": round(main[2] / main[3], 2) if main[3] else None}
        if by_query:
            result["query"] = query
        out.append(result)
    if affected:
        warnings.append(f"{source}：锚点归并涉及 {len(affected)} 个页面。")
        warnings.extend(f"{source} 锚点：{path}" for path in sorted(affected))
    return out


def base_path(p):
    p = p.split("?")[0].split("#")[0]
    if len(p) > 1:
        p = p.rstrip("/")
    return p.lower()


def page_type(p):
    b = base_path(p)
    b2 = re.sub(r"^/(es|fr|de|it|pt|nl|pl|ja|ko|zh|ar)(?=/|$)", "", b) or "/"
    if b2 == "/":
        t = "首页"
    elif "/products/" in b2:
        t = "产品页"
    elif b2.startswith("/collections"):
        t = "集合页"
    elif re.match(r"^/blogs/[^/]+/.+", b2):
        t = "博客"
    elif b2.startswith("/blogs"):
        t = "博客列表"
    elif b2.startswith("/pages/"):
        t = "其他页面"
    else:
        t = "其他页面"
    return t + ("（小语种）" if b2 != b else "")


# ---------------------------------------------------------------- GSC performance ZIP
GSC_KINDS = {
    "queries": ["top queries", "热门查询", "查询", "query", "queries"],
    "pages": ["top pages", "排名靠前的网页", "网页", "page", "pages"],
    "countries": ["country", "国家/地区", "国家", "countries"],
    "devices": ["device", "设备", "devices"],
    "dates": ["date", "日期", "dates"],
    "appearance": ["search appearance", "搜索结果呈现"],
    "filters": ["filter", "过滤条件", "过滤器"],
}
M_CLICKS = ["clicks", "点击次数", "点击"]
M_IMPR = ["impressions", "展示", "展示次数", "曝光"]
M_CTR = ["ctr", "点击率"]
M_POS = ["position", "排名", "平均排名"]


def _gsc_kind(first):
    f = norm(first)
    for k, al in GSC_KINDS.items():
        if f in [norm(a) for a in al]:
            return k
    return None


def read_gsc_zip(path, month, warnings):
    src = f"GSC 效果报告（{Path(path).name}）"
    tables = {}
    with zipfile.ZipFile(path) as z:
        for n in z.namelist():
            if not n.lower().endswith(".csv"):
                continue
            header, rows, _ = read_rows(z.read(n), n)
            k = _gsc_kind(header[0])
            if k:
                tables[k] = (header, rows)
    if "dates" not in tables:
        raise InputError(f"{src}：压缩包里没有“日期”表，无法计算月度总量。")

    def metrics(header, rows):
        ex = {0}
        ic = find_col(header, M_CLICKS, exclude=ex, source=src)
        ii = find_col(header, M_IMPR, exclude=ex, source=src)
        ip = find_col(header, M_POS, exclude=ex | {ic, ii}, source=src)
        out = []
        for r in rows:
            if not r or not str(r[0]).strip():
                continue
            out.append({"key": str(r[0]).strip(), "clicks": num(r[ic]) or 0, "impressions": num(r[ii]) or 0,
                        "position": num(r[ip])})
        return out

    dates = metrics(*tables["dates"])
    ds = sorted(datetime.strptime(d["key"][:10], "%Y-%m-%d").date() for d in dates)
    ms, me = month_bounds(month)
    if ds[0] < ms or ds[-1] > me:
        raise InputError(f"{src}：日期范围 {ds[0]} 至 {ds[-1]} 超出 {month}。")
    if len(ds) < (me - ms).days + 1:
        warnings.append(f"{src}：只有 {len(ds)} 天的数据（{ds[0]} 至 {ds[-1]}），月度总量可能偏少。")
    clicks = sum(d["clicks"] for d in dates)
    impr = sum(d["impressions"] for d in dates)
    wpos = sum((d["position"] or 0) * d["impressions"] for d in dates)
    totals = {"clicks": clicks, "impressions": impr, "ctr": clicks / impr if impr else None,
              "position": round(wpos / impr, 2) if impr else None, "days": len(ds)}
    if "filters" in tables:
        h, rows = tables["filters"]
        for r in rows:
            if (len(r) > 1 and norm(r[0]) in (norm("search type"), norm("搜索类型"))
                    and norm(r[1]) not in (norm("web"), norm("网页"), norm("网页（基于文本）"), norm("web (text results)"))):
                warnings.append(f"{src}：搜索类型是“{r[1]}”，通常应为“网页”。")
    out = {"totals": totals}
    for k in ("queries", "pages", "countries", "devices"):
        if k in tables:
            out[k] = metrics(*tables[k])
    out["pages_limited"] = len(out.get("pages", [])) >= 1000
    if out["pages_limited"]:
        warnings.append(f"{src}：网页表达到 1000 行上限，长尾页面以“查询词×页面”数据补充。")
    out["pages"] = merge_gsc_anchors(out.get("pages", []), warnings, src)
    return out


# ---------------------------------------------------------------- Looker query x page
def read_query_page(path, month, warnings):
    src = f"查询词×着陆页（{Path(path).name}）"
    header, rows, _ = read_rows(path)
    iq = find_col(header, ["query", "查询", "查询词", "热门查询", "search query"], source=src, label="查询词")
    ip = find_col(header, ["landing page", "着陆页", "网页", "page", "url"], exclude={iq}, source=src, label="页面网址")
    ii = find_col(header, ["url impressions", "impressions", "展示", "展示次数", "曝光"], source=src, label="曝光")
    ic = find_col(header, ["url clicks", "clicks", "点击次数", "点击"], source=src, label="点击")
    ipos = find_col(header, ["average position", "平均排名", "position", "排名"], exclude={iq, ip}, source=src, label="平均排名")
    idt = find_col(header, ["date", "日期"], required=False, exclude={iq, ip, ii, ic, ipos})
    if idt is not None:
        vals = sorted(str(r[idt])[:10] for r in rows if r[idt])
        ms, me = month_bounds(month)
        if vals and (vals[0] < str(ms) or vals[-1] > str(me)):
            raise InputError(f"{src}：日期 {vals[0]} 至 {vals[-1]} 超出 {month}。")
    else:
        warnings.append(f"{src}：导出没有日期列，按 {month} 处理，请确认 Looker Studio 里选的是整月。")
    detail = []
    for r in rows:
        if len(r) <= max(iq, ip, ii, ic, ipos):
            continue
        q = str(r[iq]).strip().strip('"').strip().lower()
        if not q or q.lower() in ("total", "总计", "grand total"):
            continue
        impr, clk, pos = num(r[ii]) or 0, num(r[ic]) or 0, num(r[ipos])
        detail.append({"query": q, "key": str(r[ip]).strip(), "impressions": impr, "clicks": clk, "position": pos})
    out = merge_gsc_anchors(detail, warnings, src, by_query=True)
    if not out:
        raise InputError(f"{src}：没有读到数据行。")
    return out


# ---------------------------------------------------------------- GA4
GA_DIMS = {
    "landing": ["着陆页 + 查询字符串", "着陆页", "landing page + query string", "landing page"],
    "source_medium": ["会话来源/媒介", "session source / medium", "带来会话的来源/媒介", "来源/媒介", "source / medium",
                      "会话来源", "session source"],
    "channel": ["会话默认渠道组", "会话主要渠道组", "会话主渠道组", "带来会话的主渠道组",
                "带来会话的默认渠道组", "session default channel group", "session primary channel group"],
}
GA_METRICS = {
    "sessions": ["会话数", "sessions", "会话"],
    "engagement_rate": ["互动率", "engagement rate", "感兴趣的会话占比"],
    "avg_engagement": ["每次会话的平均互动时长", "平均每次会话互动时长", "在线会话平均互动时长",
                       "average engagement time per session", "平均互动时长"],
    "items_viewed": ["已查看的商品", "items viewed", "商品浏览", "查看的商品", "查看过的商品数"],
    "add_to_carts": ["加入购物车次数", "add to carts", "已加入购物车的商品", "items added to cart", "加购",
                     "添加到购物车的次数", "加入购物车的商品数"],
    "purchases": ["电子商务购买次数", "电子商务购买", "ecommerce purchases", "购买次数", "purchases", "交易次数", "transactions"],
    "revenue": ["购买收入", "purchase revenue", "总收入", "total revenue", "收入"],
}


def read_ga4(path, month, warnings, need_landing, allow_partial=False):
    src = f"GA4（{Path(path).name}）"
    header, rows, meta = read_rows(path)
    s, e = ga4_date_range(meta)
    ms, me = month_bounds(month)
    if allow_partial and s and e and ms <= s <= e <= me:
        if (s, e) != (ms, me):
            warnings.append(f"{src}：按用户确认的可用范围 {s} 至 {e} 导入，不能视为整月。")
    else:
        check_range(s, e, month, src, warnings, required=False)
    cols = {}
    first_user = {i for i, h in enumerate(header) if "首次" in str(h) or "firstuser" in norm(h)}
    for k, al in GA_DIMS.items():
        cols[k] = find_col(header, al, required=(k == "landing" and need_landing), exclude=first_user, source=src)
    if first_user and cols["channel"] is None:
        warnings.append(f"{src}：已排除首触渠道维度；渠道按会话来源/媒介识别。")
    if cols["source_medium"] is None and cols["channel"] is None:
        raise InputError(f"{src}：需要“会话来源/媒介”或“会话渠道组”至少一列。")
    used = {i for i in cols.values() if i is not None}
    for k, al in GA_METRICS.items():
        cols[k] = find_col(header, al, required=(k == "sessions"), exclude=used, source=src)
        if cols[k] is not None:
            used.add(cols[k])
    if cols["purchases"] is None:
        # A key-event column filtered to "purchase" is accepted only when its header says so.
        i = find_col(header, ["关键事件数", "key events", "关键事件"], required=False)
        if i is not None and "purchase" in norm(header[i]):
            cols["purchases"] = i
        elif i is not None:
            warnings.append(f"{src}：只有“{header[i]}”，未明确选择 purchase，购买次数保留为空。")
        else:
            warnings.append(f"{src}：找不到购买次数列，购买次数保留为空。")
    if cols["revenue"] is None:
        raise InputError(f"{src}：找不到收入列。")
    out = []
    for r in rows:
        def g(k):
            i = cols.get(k)
            return r[i] if i is not None and i < len(r) else None
        first = str(r[0]).strip().lower() if r else ""
        last = str(r[-1]).strip().lower() if r else ""
        if not r or first in ("总计", "total", "grand total", "合计") or last in ("总计", "total", "grand total", "合计"):
            continue
        row = {k: (str(g(k)).strip() if g(k) is not None else None) for k in GA_DIMS}
        for k in GA_METRICS:
            row[k] = num(g(k))
        if row.get("landing") is not None:
            row["path"] = url_path(row["landing"])
        out.append(row)
    return out, {k: (header[i] if i is not None else None) for k, i in cols.items()}


def read_ga4_with_purchase_flag(path, month, warnings, need_landing, purchase_is_key_event=False):
    """Some existing exports (e.g. LAUNCH Aug/Sep) have '关键事件数' with the purchase event selected in
    the UI but not in the header. Allow it only when the caller explicitly says so."""
    if not purchase_is_key_event:
        return read_ga4(path, month, warnings, need_landing)
    header, rows, meta = read_rows(path)
    i = find_col(header, ["关键事件数", "key events"], source=str(path))
    tmp = Path(str(path) + ".purchase.csv")
    header[i] = header[i] + " (purchase)"
    buf = io.StringIO()
    for m in meta:
        buf.write("# " + m + "\n")
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows(rows)
    tmp.write_text(buf.getvalue(), encoding="utf-8")
    try:
        return read_ga4(tmp, month, warnings, need_landing)
    finally:
        tmp.unlink()


# ---------------------------------------------------------------- GSC indexing
def read_unindexed(path, warnings):
    """GSC 编入索引 > 网页 > <reason> export. Reason is taken from the file/folder name or a reason column."""
    src = f"未编入索引（{Path(path).name}）"
    files = []
    if str(path).lower().endswith(".zip"):
        with zipfile.ZipFile(path) as z:
            for n in z.namelist():
                if n.lower().endswith(".csv"):
                    files.append((n, z.read(n)))
    else:
        files.append((Path(path).name, Path(path).read_bytes()))
    name = Path(path).stem
    reason_default = ("已发现-尚未编入索引" if re.search(r"已发现|discovered", name, re.I)
                      else "已抓取-尚未编入索引" if re.search(r"已抓取|crawled", name, re.I) else None)
    out = []
    for n, raw in files:
        header, rows, _ = read_rows(raw, n)
        iu = find_col(header, ["url", "网址"], required=False)
        if iu is None:
            continue  # metadata / chart tables
        ir = find_col(header, ["reason", "原因", "status", "状态"], required=False, exclude={iu})
        il = find_col(header, ["last crawled", "上次抓取时间", "上次抓取"], required=False, exclude={iu})
        for r in rows:
            if not r or not r[iu].strip():
                continue
            reason = (r[ir].strip() if ir is not None else None) or reason_default
            if not reason:
                raise InputError(f"{src}：文件名里请写明原因（含“已发现”或“已抓取”），例如 unindexed_已发现.csv。")
            lc = r[il].strip() if il is not None else ""
            out.append({"path": url_path(r[iu]), "reason": reason,
                        "last_crawl": None if lc.startswith("1970") else (lc or None)})
    return out


# ---------------------------------------------------------------- simple templates
def read_table_dicts(path, aliases, required=()):
    header, rows, _ = read_rows(path)
    idx = {k: find_col(header, al, required=k in required, source=Path(path).name) for k, al in aliases.items()}
    out = []
    for r in rows:
        if not any(str(c).strip() for c in r):
            continue
        out.append({k: (r[i] if i is not None and i < len(r) else None) for k, i in idx.items()})
    return out
