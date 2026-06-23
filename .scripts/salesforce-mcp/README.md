# salesforce-mcp — Deploy Guide

## What this is
A Cloudflare Worker that exposes your Salesforce org as MCP tools.
Dex connects to it over HTTP using a Bearer token you define.

Exposes 6 tools:
- `search_accounts`      – search accounts by name
- `search_contacts`      – search contacts by name/email
- `get_opportunities`    – list open opps (filterable)
- `get_account_contacts` – contacts for an account ID
- `get_account_details`  – full account + last 10 activity notes
- `log_activity`         – log a call/meeting note to SF

---

## Step 1 — Deploy the Worker

From the `salesforce-mcp/` folder:

```bash
npx wrangler deploy
```

Wrangler will print your Worker URL:
  https://salesforce-mcp.cbarsanti.workers.dev

---

## Step 2 — Set Secrets

Run each of these (you'll be prompted to paste the value):

```bash
# Pick any strong random string — save it, you'll need it for .mcp.json
npx wrangler secret put MCP_SECRET

# Your Salesforce login
npx wrangler secret put SF_USERNAME
npx wrangler secret put SF_PASSWORD
npx wrangler secret put SF_SECURITY_TOKEN
```

SF_SECURITY_TOKEN is the token Salesforce emails you when you reset it
(Settings → Reset My Security Token).

---

## Step 3 — Add to Dex .mcp.json

In your Dex vault root, open (or create) `.mcp.json` and add:

```json
{
  "mcpServers": {
    "salesforce": {
      "type": "http",
      "url": "https://salesforce-mcp.cbarsanti.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_SECRET_HERE"
      }
    }
  }
}
```

Replace `YOUR_MCP_SECRET_HERE` with the value you set in Step 2.

---

## Step 4 — Test

Quick smoke test from terminal:

```bash
curl -X POST https://salesforce-mcp.cbarsanti.workers.dev/mcp \
  -H "Authorization: Bearer YOUR_MCP_SECRET_HERE" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Should return a list of 6 tools.

Then try a real query:

```bash
curl -X POST https://salesforce-mcp.cbarsanti.workers.dev/mcp \
  -H "Authorization: Bearer YOUR_MCP_SECRET_HERE" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_opportunities","arguments":{}}}'
```

---

## Notes
- All SOQL queries are automatically scoped to OwnerId = your Salesforce user ID
- SF auth happens per-request (SOAP login) — no session caching needed
- The /health endpoint is public (no auth) for uptime checks
