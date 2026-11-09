"""Fixed rules for the monthly SEO pipeline.

Change thresholds here, not inside the build code, so every month uses the same rules.
"""
import re

# id -> settings. Order is the department monthly table order (seo_sites.sort_order).
SITES = {
    "autelonline":      {"domain": "www.autelonline.com",       "deep": True,  "rank_min_impr": 80,
                         "brand": r"autel|otofix|maxi(sys|com|check|tpms|im|ap|diag)"},
    "autel-uk":         {"domain": "uk.autelonline.com",        "deep": False},
    "autel-eu":         {"domain": "eu.autelonline.com",        "deep": False},
    "launchx431online": {"domain": "www.launchx431online.com",  "deep": True,  "rank_min_impr": 30,
                         "brand": r"launch|lanzar|x\s?-?431|launchx|x431"},
    "launchonline-uk":  {"domain": "uk.launchx431online.com",   "deep": False},
    "launchonline-eu":  {"domain": "eu.launchx431online.com",   "deep": False},
    "otofix":           {"domain": "otofix.store",              "deep": False},
    "otofix-uk":        {"domain": "uk.otofix.store",           "deep": False},
    "otofix-eu":        {"domain": "eu.otofix.store",           "deep": False},
    "launchpro":        {"domain": "www.launchx431pro.com",     "deep": False},
    "launchpro-uk":     {"domain": "uk.launchx431pro.com",      "deep": False},
    "launchx431pro-us": {"domain": "us.launchx431pro.com",      "deep": True,  "rank_min_impr": 30,
                         "brand": r"launch|x\s?-?431|launchx|x431"},
}
DEEP_SITES = [k for k, v in SITES.items() if v["deep"]]

# ---- GA4 organic definition (user decision 2026-11-09) -------------------------------
# Natural traffic = these default channel groups, plus AI sources wherever GA4 put them.
ORGANIC_CHANNELS = {"organic search", "organic shopping", "organic social", "organic video", "ai assistant"}
# Confirmed ads that GA4 mis-files under Organic Search because of non-standard UTM medium.
EXCLUDED_SOURCE_MEDIUMS = {
    "bing / search_bra": "已确认为 Bing 品牌词广告（UTM 媒介不规范，GA4 误归入自然搜索）",
    "bing / pla": "已确认为 Bing 购物广告（UTM 媒介不规范，GA4 误归入自然搜索）",
}
# Counted as natural (user decision) but flagged until verified.
UNVERIFIED_SOURCE_MEDIUMS = {
    "bing / search": "按用户口径计入自然流量；媒介非标准写法，尚未核实是否为广告",
}
AI_SOURCE_RE = re.compile(
    r"chatgpt|openai|perplexity|gemini|bard\.google|claude\.ai|copilot|deepseek|doubao|kimi|"
    r"you\.com|phind|meta\.ai|grok|mistral|poe\.com", re.I)
PAID_MEDIUM_RE = re.compile(r"^(.*cp.*|ppc|retargeting|paid.*)$", re.I)
SEARCH_ENGINES_RE = re.compile(r"^(google|bing|yahoo|duckduckgo|baidu|yandex|naver|ecosia|qwant|brave|startpage|"
                               r"search\.brave\.com|seznam|so\.com|sogou|daum)\b", re.I)

# ---- Opportunity thresholds (from 00_背景与分析结论_先读.md) -------------------------
RANK_BAND = (10.5, 20.5)            # 排名 11–20
LOW_CTR_RATIO = 0.6                 # page CTR < 60% of the site's same position-band average
LOW_CTR_MIN_IMPR = 200
CTR_BANDS = [(0, 3), (3, 7), (7, 10), (10, 20.5)]
CTR_REFERENCE = {0: "15–30%", 1: "5–10%", 2: "2–5%", 3: "—"}   # general benchmark, shown only as reference
SHOPPING_TITLE_RULES = [(4, 1.3), (6, 1.5)]   # (min words, max position) on product pages -> excluded from CTR
LOW_ENGAGEMENT_MIN_SESSIONS = 20
LOW_ENGAGEMENT_RATE = 0.5
LOW_ENGAGEMENT_TIME_RATIO = 0.5
CONV_HIGH_TRAFFIC_MIN_SESSIONS = 50
CONV_LOW_RATIO = 0.5
CONV_SMALL_TRAFFIC = (5, 60)
CONV_HIGH_RATIO = 2.0
CONV_MIN_PURCHASES = 2
DECLINE_MIN_PREV_CLICKS = 20
DECLINE_MIN_DROP = 0.2
CORE_TOP_N = 10
CORE_DROP_ALERT = 0.2
NEW_ARTICLE_DAYS = 21
MISSING_CONTENT_MIN_IMPR = 300
KEYWORD_AUTO_TOP_N = 50
PAGES_MIN_IMPR = 10
PAGES_MIN_SESSIONS = 3
PER_CATEGORY_LIMIT = 40

LOCALE_PREFIX_RE = re.compile(r"^/(es|fr|de|it|pt|nl|pl|ja|ko|zh|ar)(/|$)")
NOISE_PATH_RE = re.compile(r"(\.atom$|/cdn/|sitemap|/search\b|[?&]page=|/apps/|/orders/|/account|/cart|/checkouts?/)", re.I)
