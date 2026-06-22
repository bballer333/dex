#!/usr/bin/env python3
"""
Dex EDA Data Scraper — UCC-1 Machine Tool Filing Intelligence

Downloads saved queries from online.edadata.com in bulk, caches locally,
and lets you filter/search without hitting the site again.

Usage:
    python3 eda-scraper.py --download                                    # Download all saved queries
    python3 eda-scraper.py --download --query "CB Accounts - Press Brakes"  # One specific query
    python3 eda-scraper.py --search "Keystone Fab"                       # Search cached data
    python3 eda-scraper.py --search "Keystone" --field buycomp1          # Search specific field
    python3 eda-scraper.py --list-queries                                 # List available queries
    python3 eda-scraper.py --cache-info                                   # Show cache stats
    python3 eda-scraper.py --no-login-cache                               # Force fresh login
    python3 eda-scraper.py --headed                                       # Show browser window

Credentials: stored in .env at vault root
    EDA_USERNAME=your@email.com
    EDA_PASSWORD=yourpassword
"""

import csv
import json
import os
import sys
import argparse
import time
from datetime import datetime
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────

VAULT_PATH    = os.environ.get("VAULT_PATH", str(Path(__file__).parent.parent.parent))
BASE_URL      = "https://online.edadata.com"
FUSABLE_HOST  = "appident.fusable.com"
LOGIN_SESSION = Path.home() / ".claude" / "eda_session.json"
DATA_CACHE    = Path.home() / ".claude" / "eda_data_cache.json"


def load_env():
    env_path = Path(VAULT_PATH) / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip())

load_env()

EDA_USERNAME = os.environ.get("EDA_USERNAME", "")
EDA_PASSWORD = os.environ.get("EDA_PASSWORD", "")


# ── HTTP Session ───────────────────────────────────────────────────────────────

def make_session():
    try:
        import requests
    except ImportError:
        print("ERROR: requests not installed. Run: pip install requests")
        sys.exit(1)
    s = requests.Session()
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
    })
    return s


def save_login_session(cookies):
    LOGIN_SESSION.parent.mkdir(parents=True, exist_ok=True)
    with open(LOGIN_SESSION, "w") as f:
        json.dump({"cookies": cookies, "saved_at": datetime.now().isoformat()}, f)


def load_login_session(session):
    if not LOGIN_SESSION.exists():
        return False
    try:
        data = json.loads(LOGIN_SESSION.read_text())
        saved = datetime.fromisoformat(data["saved_at"])
        if (datetime.now() - saved).total_seconds() > 28800:  # 8 hours
            return False
        for name, value in data["cookies"].items():
            session.cookies.set(name, value)
        return True
    except Exception:
        return False


# ── Login (Playwright / Fusable OIDC) ─────────────────────────────────────────

def login(session, headed=False):
    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
    except ImportError:
        print("ERROR: playwright not installed. Run: pip install playwright && python -m playwright install chromium")
        sys.exit(1)

    if not EDA_USERNAME or not EDA_PASSWORD:
        print(f"ERROR: EDA_USERNAME and EDA_PASSWORD not set in {Path(VAULT_PATH) / '.env'}")
        sys.exit(1)

    print("Logging in to EDA Data...", file=sys.stderr)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not headed)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
        )
        page = context.new_page()
        try:
            page.goto(f"{BASE_URL}/", timeout=30000)
            page.wait_for_url(f"**/{FUSABLE_HOST}/**", timeout=20000)

            page.wait_for_selector('input[name="Username"]', timeout=10000)
            page.fill('input[name="Username"]', EDA_USERNAME)
            _click_submit(page)

            try:
                page.wait_for_selector('input[name="Password"]', timeout=8000)
            except PWTimeout:
                if BASE_URL in page.url:
                    return _extract_cookies(context, session, browser)
                print("ERROR: Password field did not appear.", file=sys.stderr)
                browser.close()
                return False

            page.fill('input[name="Password"]', EDA_PASSWORD)
            _click_submit(page)

            try:
                page.wait_for_url("**/online.edadata.com/**", timeout=20000)
            except PWTimeout:
                print("ERROR: Login failed. Check credentials.", file=sys.stderr)
                browser.close()
                return False

            return _extract_cookies(context, session, browser)

        except Exception as e:
            print(f"ERROR during login: {e}", file=sys.stderr)
            browser.close()
            return False


def _click_submit(page):
    for sel in ['button[type="submit"]', 'input[type="submit"]',
                'button:has-text("Continue")', 'button:has-text("Login")', 'button:has-text("Sign in")']:
        btn = page.query_selector(sel)
        if btn:
            btn.click()
            return
    page.keyboard.press("Enter")


def _extract_cookies(context, session, browser):
    cookies = context.cookies()
    browser.close()
    cookie_dict = {}
    for c in cookies:
        domain = c.get("domain", "")
        if "edadata.com" in domain or "fusable.com" in domain:
            session.cookies.set(c["name"], c["value"])
            cookie_dict[c["name"]] = c["value"]
    if not cookie_dict:
        print("WARNING: No session cookies captured.", file=sys.stderr)
        return False
    save_login_session(cookie_dict)
    print("  Login successful.", file=sys.stderr)
    return True


# ── Playwright context with injected cookies ───────────────────────────────────

def _pw_context_with_cookies(playwright, session, headed=False):
    browser = playwright.chromium.launch(headless=not headed)
    context = browser.new_context(
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
    )
    pw_cookies = []
    for cookie in session.cookies:
        domain = (cookie.domain or "").lstrip(".")
        if domain:
            pw_cookies.append({"name": cookie.name, "value": cookie.value,
                               "domain": domain, "path": cookie.path or "/"})
        else:
            pw_cookies.append({"name": cookie.name, "value": cookie.value, "url": BASE_URL})
    if pw_cookies:
        context.add_cookies(pw_cookies)
    return browser, context


# ── Saved queries ──────────────────────────────────────────────────────────────

KNOWN_SAVED_QUERIES = [
    "All Data - 10 YR CB", "All Data - 10YR", "All Data - 2025 PA",
    "CB Account - NY", "CB Account Match - CNC Router",
    "CB Accounts - Benders", "CB Accounts - Coil Straightners",
    "CB Accounts - Folder", "CB Accounts - High Probability Buy",
    "CB Accounts - Ironworker", "CB Accounts - Laser",
    "CB Accounts - Med Probability Buy", "CB Accounts - Plasma",
    "CB Accounts - Plasma1", "CB Accounts - Press Brakes",
    "CB Accounts - Punch", "CB Accounts - Roll", "CB Accounts - Saw",
    "CB Accounts - Shear", "CB Accounts - Stamping Press",
    "CB Accounts - VMC/UMC", "CB Accounts - Waterjet",
    "CB Accounts Matched", "CB-PK Accounts - Waterjet",
    "Comp Waterjet Accounts", "Florida-JZ", "LVD Strippit Punch",
    "NY - 1 YR - EQUIPMENT BREAKDOWN", "NY - 1YR - Trumpf",
    "TRUMPF Press Brakes", "Vaski Metal (Rotand) - NA Installations",
    "WA, OR, CA - Copper",
]


# ── Download ───────────────────────────────────────────────────────────────────

def download_query(session, query_name, headed=False):
    """Click a saved query link, export via gear → accordion → Go, return rows."""
    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
    except ImportError:
        print("ERROR: playwright not installed.")
        sys.exit(1)

    print(f"  {query_name}...", file=sys.stderr)

    with sync_playwright() as p:
        browser, context = _pw_context_with_cookies(p, session, headed)
        page = context.new_page()
        try:
            page.goto(f"{BASE_URL}/Query", timeout=30000)

            if FUSABLE_HOST in page.url:
                print("  Session expired — re-run with --no-login-cache", file=sys.stderr)
                browser.close()
                return []

            page.wait_for_load_state("domcontentloaded", timeout=15000)
            time.sleep(1)

            # Click the saved query link by name
            found = False
            for a in page.query_selector_all("a"):
                if query_name.lower() in (a.inner_text() or "").lower():
                    a.click()
                    found = True
                    break

            if not found:
                print(f"  WARNING: '{query_name}' not found on /Query page.", file=sys.stderr)
                browser.close()
                return []

            # Wait for the summary page to load, then give JS time to render
            try:
                page.wait_for_selector("[class*='gear']", timeout=20000)
            except PWTimeout:
                pass
            time.sleep(1.5)

            # Gear icon → export ACTION panel
            page.evaluate("""() => {
                const byId = document.getElementById('gear-button');
                if (byId) { byId.click(); return; }
                const els = document.querySelectorAll('[class*="gear"]');
                if (els[0]) els[0].click();
            }""")
            time.sleep(1)

            # Export accordion → reveals Go button
            page.evaluate("""() => {
                const el = document.getElementById('export-accordion-section');
                if (el) { el.click(); return; }
                for (const a of document.querySelectorAll('a')) {
                    if (a.innerText?.trim() === 'Export' && a.offsetParent) { a.click(); return; }
                }
            }""")
            time.sleep(0.8)

            # Go button → triggers file download
            rows = []
            try:
                with page.expect_download(timeout=30000) as dl_info:
                    page.evaluate("""() => {
                        const btn = document.getElementById('export-button');
                        if (btn) { btn.click(); return; }
                        for (const b of document.querySelectorAll('button')) {
                            if ((b.innerText || '').toLowerCase().includes('go') && b.offsetParent) {
                                b.click(); return;
                            }
                        }
                    }""")
                download = dl_info.value
                fname = download.suggested_filename or "eda_export"
                suffix = Path(fname).suffix or ".xlsx"
                tmp = Path.home() / ".claude" / f"eda_export_{int(time.time())}{suffix}"
                download.save_as(str(tmp))
                rows = _parse_excel_or_csv(tmp)
                try:
                    tmp.unlink(missing_ok=True)
                except Exception:
                    pass
            except Exception as e:
                print(f"  ERROR downloading '{query_name}': {e}", file=sys.stderr)

            browser.close()
            return rows

        except Exception as e:
            print(f"  ERROR: {e}", file=sys.stderr)
            browser.close()
            return []


def _parse_excel_or_csv(path):
    path = Path(path)
    if path.suffix.lower() in (".xlsx", ".xls"):
        try:
            import openpyxl
            wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
            ws = wb.active
            rows = list(ws.iter_rows(values_only=True))
            if not rows:
                return []
            headers = [str(h).lower().strip() if h else f"col{i}" for i, h in enumerate(rows[0])]
            return [dict(zip(headers, [str(c) if c is not None else "" for c in row]))
                    for row in rows[1:] if any(c is not None for c in row)]
        except ImportError:
            print("ERROR: openpyxl not installed — run: pip install openpyxl", file=sys.stderr)
            return []
    else:
        try:
            with open(path, newline="", encoding="utf-8-sig") as f:
                return list(csv.DictReader(f))
        except Exception as e:
            print(f"ERROR parsing CSV: {e}", file=sys.stderr)
            return []


# ── Local cache ────────────────────────────────────────────────────────────────

def load_cache():
    if not DATA_CACHE.exists():
        return {}
    try:
        return json.loads(DATA_CACHE.read_text())
    except Exception:
        return {}


def save_cache(cache):
    DATA_CACHE.parent.mkdir(parents=True, exist_ok=True)
    DATA_CACHE.write_text(json.dumps(cache, indent=2))


def all_records(cache):
    seen = set()
    records = []
    for query_data in cache.get("queries", {}).values():
        for row in query_data.get("rows", []):
            key = json.dumps(row, sort_keys=True)
            if key not in seen:
                seen.add(key)
                records.append(row)
    return records


# ── Commands ───────────────────────────────────────────────────────────────────

def cmd_download(session, query_filter=None, headed=False):
    queries = KNOWN_SAVED_QUERIES
    if query_filter:
        queries = [q for q in queries if query_filter.lower() in q.lower()]
        if not queries:
            print(f"No saved queries match '{query_filter}'. Run --list-queries to see options.")
            return

    cache = load_cache()
    cache.setdefault("queries", {})
    cache.setdefault("downloaded_at", {})

    total = 0
    for q in queries:
        rows = download_query(session, q, headed=headed)
        if rows:
            cache["queries"][q] = {"rows": rows, "count": len(rows)}
            cache["downloaded_at"][q] = datetime.now().isoformat()
            total += len(rows)
            print(f"  {q}: {len(rows)} records")
        else:
            print(f"  {q}: 0 records (skipped or empty)")

    save_cache(cache)
    unique = len(all_records(cache))
    print(f"\nCache updated: {total} rows downloaded, {unique} unique records total.")
    print(f"Cache: {DATA_CACHE}")


def cmd_search(query, field=None):
    cache = load_cache()
    if not cache:
        print("No local cache found. Run --download first.")
        return

    records = all_records(cache)
    query_lower = query.lower()

    if field:
        matches = [r for r in records if query_lower in str(r.get(field, "")).lower()]
    else:
        matches = [r for r in records if any(query_lower in str(v).lower() for v in r.values())]

    if not matches:
        print(f"No results for '{query}' in {len(records)} cached records.")
        return

    print(f"Found {len(matches)} result(s) for '{query}':\n")
    print(json.dumps(matches, indent=2))


def cmd_cache_info():
    cache = load_cache()
    if not cache:
        print("No cache found. Run --download first.")
        return

    queries = cache.get("queries", {})
    downloaded_at = cache.get("downloaded_at", {})
    total = sum(v.get("count", 0) for v in queries.values())
    unique = len(all_records(cache))

    print(f"Cache: {DATA_CACHE}")
    print(f"Unique records: {unique}  |  Total rows: {total}\n")
    print(f"{'Query':<45} {'Records':>8}  {'Downloaded'}")
    print("-" * 75)
    for q, data in sorted(queries.items()):
        ts = downloaded_at.get(q, "unknown")[:16].replace("T", " ")
        print(f"{q:<45} {data.get('count',0):>8}  {ts}")


def cmd_list_queries():
    print("Saved EDA queries:")
    for q in KNOWN_SAVED_QUERIES:
        print(f"  {q}")
    print(f'\nDownload one: --download --query "CB Accounts - Press Brakes"')
    print(f"Download all: --download")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="EDA Data scraper — download all, filter locally")
    parser.add_argument("--download",       action="store_true", help="Download saved query results to local cache")
    parser.add_argument("--query",          type=str, default="", help="Filter which saved query to download (partial name match)")
    parser.add_argument("--search",         type=str, default="", help="Search cached data by any field value")
    parser.add_argument("--field",          type=str, default="", help="Restrict --search to a specific field name")
    parser.add_argument("--list-queries",   action="store_true", help="List available saved queries")
    parser.add_argument("--cache-info",     action="store_true", help="Show cache stats")
    parser.add_argument("--no-login-cache", action="store_true", help="Force fresh browser login")
    parser.add_argument("--headed",         action="store_true", help="Show browser window")
    args = parser.parse_args()

    if args.list_queries:
        cmd_list_queries()
        return

    if args.cache_info:
        cmd_cache_info()
        return

    if args.search and not args.download:
        cmd_search(args.search, field=args.field or None)
        return

    session = make_session()
    if not args.no_login_cache and load_login_session(session):
        print("Using saved login session.", file=sys.stderr)
    else:
        if not login(session, headed=args.headed):
            sys.exit(1)

    if args.download:
        cmd_download(session, query_filter=args.query or None, headed=args.headed)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
