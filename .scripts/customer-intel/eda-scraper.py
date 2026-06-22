#!/usr/bin/env python3
"""
Dex EDA Data Scraper — UCC-1 Machine Tool Filing Intelligence

Logs into online.edadata.com, searches for UCC filings, and syncs
key dates back to Salesforce Asset records.

Usage:
    python3 eda-scraper.py --discover          # Map site structure after login
    python3 eda-scraper.py --search "Acme"     # Search by company name
    python3 eda-scraper.py --sync              # Sync new filings to Salesforce
    python3 eda-scraper.py --export            # Export all accessible filings

Credentials: stored in .env at vault root (never committed to git)
    EDA_USERNAME=your@email.com
    EDA_PASSWORD=yourpassword
"""

import json
import os
import sys
import argparse
import time
from datetime import datetime, date
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────

VAULT_PATH   = os.environ.get("VAULT_PATH", str(Path(__file__).parent.parent.parent))
BASE_URL     = "https://online.edadata.com"
SESSION_FILE = Path.home() / ".claude" / "eda_session.json"

# Load credentials from .env
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
    """Create a requests session with browser-like headers."""
    try:
        import requests
    except ImportError:
        print("ERROR: requests not installed. Run: pip install requests beautifulsoup4")
        sys.exit(1)

    s = requests.Session()
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xhtml+xml,*/*;q=0.9",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
    })
    return s


def save_session(cookies):
    SESSION_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(SESSION_FILE, "w") as f:
        json.dump({"cookies": cookies, "saved_at": datetime.now().isoformat()}, f)


def load_session(session):
    if not SESSION_FILE.exists():
        return False
    try:
        data = json.loads(SESSION_FILE.read_text())
        # Expire sessions after 8 hours
        saved = datetime.fromisoformat(data["saved_at"])
        if (datetime.now() - saved).total_seconds() > 28800:
            return False
        for name, value in data["cookies"].items():
            session.cookies.set(name, value)
        return True
    except Exception:
        return False


# ── Login ─────────────────────────────────────────────────────────────────────
#
# EDA Data uses a two-step login at /Account/Login:
#   Step 1 — POST Username, click Continue
#   Step 2 — Password field reveals, POST Password
#
# We try both strategies:
#   A) Single POST with both fields (works if password is already in DOM)
#   B) Two sequential POSTs (handles true two-step server-side flows)

LOGIN_URL      = f"{BASE_URL}/Account/Login"
USERNAME_FIELD = "Username"
PASSWORD_FIELD = "Password"


def _collect_hidden(soup):
    """Extract all hidden input fields (CSRF tokens, view state, etc.)."""
    hidden = {}
    for inp in soup.find_all("input", type="hidden"):
        if inp.get("name"):
            hidden[inp["name"]] = inp.get("value", "")
    return hidden


def _logged_in(html):
    """Return True if the response looks like an authenticated page."""
    low = html.lower()
    return any(k in low for k in ("log out", "logout", "sign out", "signout",
                                   "dashboard", "welcome", "my account", "search filings"))


def _login_failed(html):
    low = html.lower()
    return any(k in low for k in ("invalid", "incorrect password", "login failed",
                                   "wrong password", "not recognized"))


def login(session):
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        print("ERROR: beautifulsoup4 not installed. Run: pip install requests beautifulsoup4")
        sys.exit(1)

    if not EDA_USERNAME or not EDA_PASSWORD:
        print("ERROR: EDA_USERNAME and EDA_PASSWORD not set.")
        print(f"Add them to: {Path(VAULT_PATH) / '.env'}")
        print("  EDA_USERNAME=your@email.com")
        print("  EDA_PASSWORD=yourpassword")
        sys.exit(1)

    # ── GET login page ─────────────────────────────────────────────────────────
    print("Fetching login page...", file=sys.stderr)
    resp = session.get(LOGIN_URL, timeout=30)
    if resp.status_code != 200:
        print(f"ERROR: Login page returned {resp.status_code}", file=sys.stderr)
        return False

    soup = BeautifulSoup(resp.text, "html.parser")
    hidden = _collect_hidden(soup)
    print(f"  Hidden fields: {list(hidden.keys())}", file=sys.stderr)

    # ── Strategy A: single POST with both Username + Password ─────────────────
    print("Strategy A: single POST (username + password together)...", file=sys.stderr)
    payload_a = {**hidden, USERNAME_FIELD: EDA_USERNAME, PASSWORD_FIELD: EDA_PASSWORD}
    resp_a = session.post(LOGIN_URL, data=payload_a, timeout=30, allow_redirects=True)

    if _logged_in(resp_a.text):
        print("  ✓ Login successful (single POST).", file=sys.stderr)
        save_session(dict(session.cookies))
        return True

    if _login_failed(resp_a.text):
        print("  ✗ Credentials rejected. Check EDA_USERNAME / EDA_PASSWORD in .env", file=sys.stderr)
        return False

    # ── Strategy B: two-step POST ──────────────────────────────────────────────
    # Step B1: POST username only — server may set a cookie or return a token
    print("Strategy B: two-step POST...", file=sys.stderr)
    print("  Step 1: submitting username...", file=sys.stderr)

    # Re-fetch to get a fresh page/token (session may have changed from Strategy A)
    resp = session.get(LOGIN_URL, timeout=30)
    soup = BeautifulSoup(resp.text, "html.parser")
    hidden = _collect_hidden(soup)

    payload_b1 = {**hidden, USERNAME_FIELD: EDA_USERNAME}
    resp_b1 = session.post(LOGIN_URL, data=payload_b1, timeout=30, allow_redirects=True)

    if resp_b1.status_code not in (200, 302):
        print(f"  Step 1 returned {resp_b1.status_code}", file=sys.stderr)
        return False

    # Step B2: Extract any new tokens from the response, then POST password
    print("  Step 2: submitting password...", file=sys.stderr)
    soup2 = BeautifulSoup(resp_b1.text, "html.parser")
    hidden2 = _collect_hidden(soup2)

    # Determine the correct POST URL for step 2
    form2 = soup2.find("form")
    step2_url = LOGIN_URL
    if form2 and form2.get("action"):
        action = form2["action"]
        step2_url = (action if action.startswith("http")
                     else BASE_URL + (action if action.startswith("/") else "/" + action))

    payload_b2 = {**hidden2, USERNAME_FIELD: EDA_USERNAME, PASSWORD_FIELD: EDA_PASSWORD}
    resp_b2 = session.post(step2_url, data=payload_b2, timeout=30, allow_redirects=True)

    if _logged_in(resp_b2.text):
        print("  ✓ Login successful (two-step POST).", file=sys.stderr)
        save_session(dict(session.cookies))
        return True

    if _login_failed(resp_b2.text):
        print("  ✗ Credentials rejected. Check EDA_USERNAME / EDA_PASSWORD in .env", file=sys.stderr)
        return False

    # ── Both strategies ambiguous ──────────────────────────────────────────────
    # Likely a JS-rendered site — save session and try to proceed
    print("  Login response ambiguous (may be JS-rendered). Saving session and proceeding.", file=sys.stderr)
    print("  If --discover returns empty results, run with --playwright flag (see README).", file=sys.stderr)
    save_session(dict(session.cookies))
    return True


# ── Discovery ─────────────────────────────────────────────────────────────────

def discover(session):
    """
    Map the site structure after login. Finds search pages, reports,
    export options, and API endpoints. Run this first after getting access.
    """
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        print("ERROR: beautifulsoup4 not installed.")
        sys.exit(1)

    print("\n=== EDA Data Site Discovery ===\n")

    pages_to_check = [
        "/", "/home", "/dashboard", "/search", "/report",
        "/equipment", "/filings", "/ucc", "/data", "/export",
        "/api", "/accounts", "/assets",
    ]

    found_pages = []
    for path in pages_to_check:
        try:
            r = session.get(f"{BASE_URL}{path}", timeout=15)
            if r.status_code == 200 and len(r.text) > 500:
                soup = BeautifulSoup(r.text, "html.parser")
                title = soup.find("title")
                title_text = title.get_text(strip=True) if title else "No title"
                links = len(soup.find_all("a"))
                forms = len(soup.find_all("form"))
                inputs = len(soup.find_all("input"))
                print(f"  ✓ {path:<20} [{r.status_code}] '{title_text}' "
                      f"({links} links, {forms} forms, {inputs} inputs)")
                found_pages.append({
                    "path": path,
                    "title": title_text,
                    "links": links,
                    "forms": forms,
                })

                # Look for search forms
                for form in soup.find_all("form"):
                    action = form.get("action", "")
                    fields = [i.get("name") for i in form.find_all("input") if i.get("name")]
                    if fields:
                        print(f"    Form → action='{action}' fields={fields}")

                # Look for data tables
                tables = soup.find_all("table")
                for t in tables[:2]:
                    headers = [th.get_text(strip=True) for th in t.find_all("th")]
                    if headers:
                        print(f"    Table headers: {headers}")

            elif r.status_code != 404:
                print(f"  ? {path:<20} [{r.status_code}]")
        except Exception as e:
            print(f"  ✗ {path:<20} Error: {e}")
        time.sleep(0.5)

    # Also scan all links on the homepage for navigation structure
    try:
        r = session.get(f"{BASE_URL}/", timeout=15)
        if r.status_code == 200:
            soup = BeautifulSoup(r.text, "html.parser")
            print("\n  Navigation links found on homepage:")
            for a in soup.find_all("a", href=True):
                href = a["href"]
                text = a.get_text(strip=True)
                if href.startswith("/") and text and len(text) < 50:
                    print(f"    {text:<30} → {href}")
    except Exception:
        pass

    return found_pages


# ── Search ────────────────────────────────────────────────────────────────────

def search_company(session, company_name):
    """
    Search EDA Data for a company's UCC filings.

    TODO: Update SEARCH_URL and field names once site structure is known.
    """
    print(f"\nSearching for: {company_name}", file=sys.stderr)

    # PLACEHOLDER — will be updated after discovery
    SEARCH_URL = f"{BASE_URL}/search"
    payload = {
        "company": company_name,   # update field name after discovery
        "state": "",
        "type": "equipment",
    }

    r = session.get(SEARCH_URL, params=payload, timeout=30)
    if r.status_code != 200:
        print(f"Search returned {r.status_code}", file=sys.stderr)
        return []

    return parse_results(r.text)


def parse_results(html):
    """
    Parse UCC filing results from a search results page.

    TODO: Update selectors once we know the actual HTML structure.
    Key fields to extract:
      - debtor_name (company name)
      - filing_date
      - lapse_date (= filing_date + 5 years, or continuation date)
      - filing_number (UCCID)
      - collateral_description (machine type/model/serial)
      - secured_party (financing company)
      - status (active/lapsed/terminated)
    """
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return []

    soup = BeautifulSoup(html, "html.parser")
    results = []

    # Generic table parser — works for most EDA-style result pages
    for table in soup.find_all("table"):
        headers = [th.get_text(strip=True).lower() for th in table.find_all("th")]
        if not headers:
            continue
        for row in table.find_all("tr")[1:]:
            cells = [td.get_text(strip=True) for td in row.find_all("td")]
            if cells and len(cells) >= len(headers):
                record = dict(zip(headers, cells))
                results.append(record)

    return results


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="EDA Data scraper for Dex")
    parser.add_argument("--discover",  action="store_true", help="Map site structure after login")
    parser.add_argument("--search",    type=str, default="",  help="Search by company name")
    parser.add_argument("--sync",      action="store_true", help="Sync new filings to Salesforce")
    parser.add_argument("--no-cache",  action="store_true", help="Force fresh login, ignore saved session")
    args = parser.parse_args()

    session = make_session()

    # Try saved session first, then fresh login
    if not args.no_cache and load_session(session):
        print("Using saved session.", file=sys.stderr)
    else:
        if not login(session):
            sys.exit(1)

    if args.discover:
        discover(session)
    elif args.search:
        results = search_company(session, args.search)
        if results:
            print(json.dumps(results, indent=2))
        else:
            print("No results found.")
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
