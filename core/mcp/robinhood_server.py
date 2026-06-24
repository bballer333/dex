#!/usr/bin/env python3
"""
Robinhood MCP Server for Dex

Reads portfolio data (positions, account value, recent orders, quotes) from
Robinhood using the robin_stocks library (unofficial API).

Authentication uses username + password stored in VAULT_ROOT/.env:
  ROBINHOOD_USERNAME=you@example.com
  ROBINHOOD_PASSWORD=yourpassword

A session token is cached in System/integrations/robinhood_token.pkl at the
vault root and re-used across sessions. When the token expires, the server
logs back in automatically.

If no credentials are configured, all tools return a friendly "not connected"
message instead of erroring.

Tools:
- robinhood_check_available        Check if connected and can reach Robinhood
- robinhood_get_portfolio          Account equity, cash, buying power
- robinhood_get_positions          All open equity positions with market value
- robinhood_get_quote              Real-time quote for one or more tickers
- robinhood_get_recent_orders      Recent order history (buy/sell/cancel)
- robinhood_get_dividends          Dividend payment history
"""

import json
import logging
import os
import pickle
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import mcp.server.stdio
import mcp.types as types
from mcp.server import NotificationOptions, Server
from mcp.server.models import InitializationOptions

# ============================================================================
# CONFIGURATION
# ============================================================================

VAULT_PATH = Path(os.environ.get("VAULT_PATH", Path.cwd()))
TOKEN_FILE = VAULT_PATH / "System" / "integrations" / "robinhood_token.pkl"

NOT_CONNECTED_MESSAGE = (
    "Robinhood not connected — run /robinhood-setup to add your credentials."
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Simple in-memory cache: {cache_key: (timestamp, data)}
_cache: Dict[str, Any] = {}
_CACHE_TTL = 60  # seconds — quotes + portfolio change fast


# ============================================================================
# CREDENTIAL RESOLUTION
# ============================================================================


def _vault_root() -> Path:
    return Path(os.environ.get("VAULT_ROOT") or os.environ.get("VAULT_PATH") or Path.cwd())


def _read_env_file() -> Dict[str, str]:
    env_path = _vault_root() / ".env"
    result: Dict[str, str] = {}
    if not env_path.exists():
        return result
    try:
        for raw in env_path.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[7:].strip()
            if "=" not in line:
                continue
            name, _, value = line.partition("=")
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            result[name.strip()] = value
    except Exception as e:
        logger.warning(f"Error reading .env: {e}")
    return result


def get_credentials() -> Optional[tuple[str, str]]:
    """Return (username, password) from env or .env file, or None if absent."""
    username = os.environ.get("ROBINHOOD_USERNAME")
    password = os.environ.get("ROBINHOOD_PASSWORD")
    if not username or not password:
        env = _read_env_file()
        username = username or env.get("ROBINHOOD_USERNAME")
        password = password or env.get("ROBINHOOD_PASSWORD")
    if username and password:
        return username.strip(), password.strip()
    return None


# ============================================================================
# ROBINHOOD CLIENT (robin_stocks wrapper)
# ============================================================================


def _import_rs():
    """Import robin_stocks, raising ImportError with a helpful message if absent."""
    try:
        import robin_stocks.robinhood as rs
        return rs
    except ImportError:
        raise ImportError(
            "robin_stocks is not installed. "
            "Run: pip install robin_stocks"
        )


def _login(rs, username: str, password: str) -> bool:
    """Log in to Robinhood and cache the session token."""
    try:
        token_dir = TOKEN_FILE.parent
        token_dir.mkdir(parents=True, exist_ok=True)

        # Pass store_session=True so robin_stocks caches to its own pickle path,
        # then we also store our own copy for cross-session reuse.
        result = rs.login(
            username=username,
            password=password,
            store_session=True,
            pickle_name="robinhood",
        )
        # Persist auth token for reuse.
        TOKEN_FILE.write_bytes(pickle.dumps({"logged_in_at": time.time(), "result": result}))
        logger.info("Robinhood login successful")
        return True
    except Exception as e:
        logger.warning(f"Robinhood login failed: {e}")
        return False


def _ensure_logged_in(rs) -> bool:
    """
    Try to reuse an existing session; fall back to a fresh login.
    Returns True if we're authenticated, False otherwise.
    """
    creds = get_credentials()
    if not creds:
        return False
    username, password = creds

    # Try loading a cached session first (robin_stocks stores its own pickle).
    try:
        rs.login(
            username=username,
            password=password,
            store_session=True,
            pickle_name="robinhood",
        )
        # Quick check — if this throws we'll fall through to fresh login.
        rs.load_account_profile()
        return True
    except Exception:
        pass

    # Fresh login.
    return _login(rs, username, password)


def _cached(key: str, fn):
    """Return cached value or call fn() and cache the result."""
    now = time.time()
    if key in _cache:
        ts, val = _cache[key]
        if now - ts < _CACHE_TTL:
            return val
    val = fn()
    _cache[key] = (now, val)
    return val


# ============================================================================
# DATA FUNCTIONS
# ============================================================================


def _safe_float(val) -> Optional[float]:
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def get_portfolio(rs) -> Dict[str, Any]:
    def _fetch():
        portfolio = rs.load_portfolio_profile() or {}
        account = rs.load_account_profile() or {}
        return {
            "equity": _safe_float(portfolio.get("equity")),
            "extended_hours_equity": _safe_float(portfolio.get("extended_hours_equity")),
            "equity_previous_close": _safe_float(portfolio.get("equity_previous_close")),
            "adjusted_equity_previous_close": _safe_float(
                portfolio.get("adjusted_equity_previous_close")
            ),
            "excess_margin": _safe_float(portfolio.get("excess_margin")),
            "cash": _safe_float(account.get("cash")),
            "buying_power": _safe_float(account.get("buying_power")),
            "portfolio_cash": _safe_float(account.get("portfolio_cash")),
            "account_number": account.get("account_number"),
            "type": account.get("type"),
        }
    return _cached("portfolio", _fetch)


def get_positions(rs) -> List[Dict[str, Any]]:
    def _fetch():
        raw = rs.get_all_positions() or []
        results = []
        for pos in raw:
            qty = _safe_float(pos.get("quantity"))
            if not qty or qty == 0:
                continue
            avg_buy = _safe_float(pos.get("average_buy_price"))
            instrument_url = pos.get("instrument", "")
            results.append({
                "instrument_url": instrument_url,
                "quantity": qty,
                "average_buy_price": avg_buy,
                "intraday_quantity": _safe_float(pos.get("intraday_quantity")),
                "created_at": pos.get("created_at"),
                "updated_at": pos.get("updated_at"),
            })
        return results

    positions = _cached("positions", _fetch)

    # Enrich with current quotes.
    instrument_data = rs.get_instruments_by_url(
        [p["instrument_url"] for p in positions if p.get("instrument_url")]
    ) or []
    symbols = [i.get("symbol") for i in instrument_data if i.get("symbol")]
    quotes: Dict[str, Any] = {}
    if symbols:
        try:
            raw_quotes = rs.get_quotes(symbols) or []
            for q in raw_quotes:
                sym = q.get("symbol")
                if sym:
                    quotes[sym] = q
        except Exception as e:
            logger.warning(f"Quote fetch failed: {e}")

    # Map instrument URL → symbol.
    url_to_symbol = {i.get("url"): i.get("symbol") for i in instrument_data}

    enriched = []
    for pos in positions:
        sym = url_to_symbol.get(pos["instrument_url"])
        q = quotes.get(sym, {}) if sym else {}
        last_price = _safe_float(q.get("last_trade_price") or q.get("last_extended_hours_trade_price"))
        mkt_value = (last_price * pos["quantity"]) if (last_price and pos["quantity"]) else None
        cost_basis = (pos["average_buy_price"] * pos["quantity"]) if (pos["average_buy_price"] and pos["quantity"]) else None
        pnl = (mkt_value - cost_basis) if (mkt_value is not None and cost_basis is not None) else None
        pnl_pct = (pnl / cost_basis * 100) if (pnl is not None and cost_basis and cost_basis != 0) else None
        enriched.append({
            "symbol": sym,
            "quantity": pos["quantity"],
            "average_buy_price": pos["average_buy_price"],
            "last_price": last_price,
            "market_value": round(mkt_value, 2) if mkt_value else None,
            "cost_basis": round(cost_basis, 2) if cost_basis else None,
            "unrealized_pnl": round(pnl, 2) if pnl is not None else None,
            "unrealized_pnl_pct": round(pnl_pct, 2) if pnl_pct is not None else None,
            "created_at": pos["created_at"],
        })

    enriched.sort(key=lambda x: x.get("market_value") or 0, reverse=True)
    return enriched


def get_quote(rs, symbols: List[str]) -> List[Dict[str, Any]]:
    def _fetch():
        raw = rs.get_quotes(symbols) or []
        results = []
        for q in raw:
            results.append({
                "symbol": q.get("symbol"),
                "last_trade_price": _safe_float(q.get("last_trade_price")),
                "last_extended_hours_price": _safe_float(
                    q.get("last_extended_hours_trade_price")
                ),
                "previous_close": _safe_float(q.get("adjusted_previous_close") or q.get("previous_close")),
                "bid_price": _safe_float(q.get("bid_price")),
                "ask_price": _safe_float(q.get("ask_price")),
                "trading_halted": q.get("trading_halted"),
                "has_tradable_shares": q.get("has_tradable_shares"),
            })
        return results
    key = "quote:" + ",".join(sorted(s.upper() for s in symbols))
    return _cached(key, _fetch)


def get_recent_orders(rs, limit: int = 25) -> List[Dict[str, Any]]:
    def _fetch():
        raw = rs.get_all_orders() or []
        results = []
        for order in raw[:limit]:
            results.append({
                "id": order.get("id"),
                "side": order.get("side"),
                "type": order.get("type"),
                "state": order.get("state"),
                "quantity": _safe_float(order.get("quantity")),
                "average_price": _safe_float(order.get("average_price")),
                "price": _safe_float(order.get("price")),
                "created_at": order.get("created_at"),
                "updated_at": order.get("updated_at"),
                "instrument": order.get("instrument"),
            })
        return results
    return _cached("orders", _fetch)


def get_dividends(rs) -> List[Dict[str, Any]]:
    def _fetch():
        raw = rs.get_dividends() or []
        results = []
        for d in raw:
            results.append({
                "amount": _safe_float(d.get("amount")),
                "rate": _safe_float(d.get("rate")),
                "position": _safe_float(d.get("position")),
                "paid_at": d.get("paid_at"),
                "payable_date": d.get("payable_date"),
                "record_date": d.get("record_date"),
                "state": d.get("state"),
            })
        return results
    return _cached("dividends", _fetch)


# ============================================================================
# MCP SERVER
# ============================================================================

app = Server("dex-robinhood-mcp")


@app.list_tools()
async def handle_list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="robinhood_check_available",
            description="Check if Robinhood credentials are configured and the connection works",
            inputSchema={"type": "object", "properties": {}},
        ),
        types.Tool(
            name="robinhood_get_portfolio",
            description="Get account equity, cash, and buying power from Robinhood",
            inputSchema={"type": "object", "properties": {}},
        ),
        types.Tool(
            name="robinhood_get_positions",
            description="Get all open equity positions with current market value and unrealized P&L",
            inputSchema={"type": "object", "properties": {}},
        ),
        types.Tool(
            name="robinhood_get_quote",
            description="Get a real-time price quote for one or more stock tickers",
            inputSchema={
                "type": "object",
                "properties": {
                    "symbols": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of ticker symbols (e.g. [\"AAPL\", \"TSLA\"])",
                    }
                },
                "required": ["symbols"],
            },
        ),
        types.Tool(
            name="robinhood_get_recent_orders",
            description="Get recent buy/sell order history from Robinhood",
            inputSchema={
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Maximum orders to return (default: 25)",
                        "default": 25,
                    }
                },
            },
        ),
        types.Tool(
            name="robinhood_get_dividends",
            description="Get dividend payment history from Robinhood",
            inputSchema={"type": "object", "properties": {}},
        ),
    ]


def _no_creds() -> list[types.TextContent]:
    return [types.TextContent(type="text", text=json.dumps({
        "success": False,
        "connected": False,
        "message": NOT_CONNECTED_MESSAGE,
    }, indent=2))]


def _library_missing(err: str) -> list[types.TextContent]:
    return [types.TextContent(type="text", text=json.dumps({
        "success": False,
        "error": "robin_stocks not installed",
        "detail": str(err),
        "fix": "pip install robin_stocks",
    }, indent=2))]


@app.call_tool()
async def handle_call_tool(
    name: str, arguments: dict | None
) -> list[types.TextContent | types.ImageContent | types.EmbeddedResource]:
    arguments = arguments or {}

    valid = {
        "robinhood_check_available",
        "robinhood_get_portfolio",
        "robinhood_get_positions",
        "robinhood_get_quote",
        "robinhood_get_recent_orders",
        "robinhood_get_dividends",
    }
    if name not in valid:
        return [types.TextContent(type="text", text=json.dumps({"error": f"Unknown tool: {name}"}, indent=2))]

    if not get_credentials():
        return _no_creds()

    try:
        rs = _import_rs()
    except ImportError as e:
        return _library_missing(str(e))

    if not _ensure_logged_in(rs):
        return [types.TextContent(type="text", text=json.dumps({
            "success": False,
            "error": "Robinhood login failed — check your credentials or MFA setting in /robinhood-setup.",
        }, indent=2))]

    try:
        if name == "robinhood_check_available":
            profile = rs.load_account_profile() or {}
            return [types.TextContent(type="text", text=json.dumps({
                "success": True,
                "connected": True,
                "account_number": profile.get("account_number"),
                "account_type": profile.get("type"),
                "message": "Robinhood connected and reachable.",
            }, indent=2))]

        elif name == "robinhood_get_portfolio":
            data = get_portfolio(rs)
            return [types.TextContent(type="text", text=json.dumps({
                "success": True,
                **data,
            }, indent=2))]

        elif name == "robinhood_get_positions":
            positions = get_positions(rs)
            total_value = sum(p.get("market_value") or 0 for p in positions)
            total_pnl = sum(p.get("unrealized_pnl") or 0 for p in positions)
            return [types.TextContent(type="text", text=json.dumps({
                "success": True,
                "positions": positions,
                "count": len(positions),
                "total_market_value": round(total_value, 2),
                "total_unrealized_pnl": round(total_pnl, 2),
            }, indent=2))]

        elif name == "robinhood_get_quote":
            symbols = [str(s).upper() for s in (arguments.get("symbols") or [])]
            if not symbols:
                return [types.TextContent(type="text", text=json.dumps({
                    "success": False, "error": "symbols is required"
                }, indent=2))]
            quotes = get_quote(rs, symbols)
            return [types.TextContent(type="text", text=json.dumps({
                "success": True,
                "quotes": quotes,
                "count": len(quotes),
                "as_of": datetime.now(timezone.utc).isoformat(),
            }, indent=2))]

        elif name == "robinhood_get_recent_orders":
            limit = int(arguments.get("limit", 25))
            orders = get_recent_orders(rs, limit)
            return [types.TextContent(type="text", text=json.dumps({
                "success": True,
                "orders": orders,
                "count": len(orders),
            }, indent=2))]

        elif name == "robinhood_get_dividends":
            divs = get_dividends(rs)
            total = sum(d.get("amount") or 0 for d in divs if d.get("state") == "paid")
            return [types.TextContent(type="text", text=json.dumps({
                "success": True,
                "dividends": divs,
                "count": len(divs),
                "total_paid": round(total, 2),
            }, indent=2))]

    except Exception as e:
        logger.exception(f"Tool {name} failed")
        return [types.TextContent(type="text", text=json.dumps({
            "success": False,
            "error": str(e),
        }, indent=2))]


async def _main():
    logger.info("Starting Dex Robinhood MCP Server")
    if not get_credentials():
        logger.info(NOT_CONNECTED_MESSAGE)

    async with mcp.server.stdio.stdio_server() as (read_stream, write_stream):
        await app.run(
            read_stream,
            write_stream,
            InitializationOptions(
                server_name="dex-robinhood-mcp",
                server_version="1.0.0",
                capabilities=app.get_capabilities(
                    notification_options=NotificationOptions(),
                    experimental_capabilities={},
                ),
            ),
        )


def main():
    import asyncio
    asyncio.run(_main())


if __name__ == "__main__":
    main()
