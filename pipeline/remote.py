"""Read the editable lists (content tracking, keyword monitor) from the dashboard database.

Both tables are publicly readable, so the publishable key in site/config.js is enough.
If the database cannot be reached, the pipeline falls back to local CSV files.
"""
import json
import re
import urllib.request
from pathlib import Path

CONFIG = Path(__file__).resolve().parent.parent / "site" / "config.js"


def _config():
    m = re.search(r"\{.*\}", CONFIG.read_text(encoding="utf-8"), re.S)
    return json.loads(m.group(0))


def fetch(table, select="*"):
    cfg = _config()
    out, offset = [], 0
    while True:
        req = urllib.request.Request(f"{cfg['url']}/rest/v1/{table}?select={select}&order=id&limit=1000&offset={offset}",
                                     headers={"apikey": cfg["key"], "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            batch = json.loads(r.read().decode("utf-8"))
        out += batch
        if len(batch) < 1000:
            return out
        offset += 1000


def load_lists(warnings):
    """-> ({site_id: [content rows]}, {site_id: [keyword rows]}) or (None, None) when offline."""
    try:
        content, keywords = fetch("seo_content"), fetch("seo_keywords")
    except Exception as e:  # network, DNS, proxy, bad config
        warnings.append(f"无法读取看板数据库里的内容追踪表和关键词表（{e}），改用本地 CSV。")
        return None, None
    by_c, by_k = {}, {}
    for r in content:
        by_c.setdefault(r["site_id"], []).append(r)
    for r in keywords:
        by_k.setdefault(r["site_id"], []).append(r)
    return by_c, by_k
