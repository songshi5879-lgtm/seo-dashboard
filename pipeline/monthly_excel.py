"""Department monthly table: 12 sites x 11 rows, in the fixed order of the original sheet."""
from . import config as C

ROWS = [  # (payload key, 调研类目 on the site's first row of the group, 工具/工作 label)
    ("semrush_traffic", "网站流量", "Semrush（平均自然流量）"),
    ("gsc_clicks", None, "GSC（点击量）"),
    ("gsc_impressions", None, "GSC（曝光量）"),
    ("ahrefs_traffic", None, "Ahrefs（平均自然流量）"),
    ("rank_1_3", "关键词", "1-3 网站关键词（{tool}）"),
    ("rank_4_10", None, "4-10 网站关键词（{tool}）"),
    ("rank_11_20", None, "11-20网站关键词（{tool}）"),
    ("rank_21_50", None, "21-50网站关键词（{tool}）"),
    ("rank_51_plus", None, "51+网站关键词（{tool}）"),
    ("rank_total", None, "总数"),
    ("page_optimization", "Page优化", "优化页面Title, Description, QA"),
]


def fmt_value(key, v):
    if v is None or v == "":
        return None
    if key == "gsc_impressions" and isinstance(v, (int, float)) and v >= 10000:
        s = f"{v / 10000:.2f}".rstrip("0").rstrip(".")
        return s + "w"
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def table_rows(monthly):
    out = []
    for sid, site in C.SITES.items():
        p = monthly.get(sid, {})
        tool = p.get("rank_tool") or "Semrush"
        for i, (key, cat, label) in enumerate(ROWS):
            out.append({"site_id": sid, "url": f"https://{site['domain']}/" if i == 0 else None, "category": cat,
                        "label": label.format(tool=tool), "key": key, "value": fmt_value(key, p.get(key))})
    return out


def write_monthly_column(month, monthly, path):
    import openpyxl
    from openpyxl.styles import Font, Alignment
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "月度数据表"
    y, m = map(int, month.split("-"))
    from datetime import date
    ws.append(["网址", "调研类目", "工具/工作", date(y, m, 1)])
    ws.cell(1, 4).number_format = "yyyy-mm"
    for r in table_rows(monthly):
        ws.append([r["url"], r["category"], r["label"], r["value"]])
    for c in ws[1]:
        c.font = Font(bold=True)
    ws.column_dimensions["A"].width = 32
    ws.column_dimensions["B"].width = 12
    ws.column_dimensions["C"].width = 30
    ws.column_dimensions["D"].width = 14
    for row in ws.iter_rows(min_row=2, min_col=4, max_col=4):
        row[0].alignment = Alignment(horizontal="right")
    ws2 = wb.create_sheet("说明")
    ws2.append(["粘贴方法：复制“月度数据表”D2:D133（共 132 行），粘贴到部门表格新月份列的第一个数据格。"])
    ws2.append(["行顺序与部门表一致：12 个站，每站 11 行。空格表示本月没有该数据，不代表 0。"])
    ws2.append(["2026 年 10 月起关键词排名分布统一使用 Semrush，与此前 Ahrefs 数据不可直接比较。"])
    wb.save(path)
