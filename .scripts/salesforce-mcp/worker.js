/**
 * salesforce-mcp — Cloudflare Worker
 * Implements MCP Streamable HTTP Transport (protocol version 2024-11-05)
 * Exposes Salesforce as MCP tools for use in Dex / Claude Code
 *
 * Required Worker Secrets (set via `wrangler secret put`):
 *   MCP_SECRET          – Bearer token Dex uses to authenticate
 *   SF_CLIENT_ID        – Salesforce Connected App client ID
 *   SF_CLIENT_SECRET    – Salesforce Connected App client secret
 *   SF_USERNAME         – Only needed if client_credentials grant not enabled
 *   SF_PASSWORD         – Only needed if client_credentials grant not enabled
 *   SF_SECURITY_TOKEN   – Only needed if client_credentials grant not enabled
 */

const OWNER_ID = "0055Y00000GU69oQAD";

// ─── Tool Definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "search_accounts",
    description: "Search Salesforce accounts by name or keyword. Returns Id, Name, Phone, city, type.",
    inputSchema: {
      type: "object",
      properties: {
        query:  { type: "string",  description: "Account name or keyword" },
        limit:  { type: "number",  description: "Max results (default 10)" }
      },
      required: ["query"]
    }
  },
  {
    name: "search_contacts",
    description: "Search Salesforce contacts by name or email.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Contact name or email" },
        limit: { type: "number", description: "Max results (default 10)" }
      },
      required: ["query"]
    }
  },
  {
    name: "get_opportunities",
    description: "List open opportunities. Optional filters by account name or stage.",
    inputSchema: {
      type: "object",
      properties: {
        account_name: { type: "string", description: "Filter by account name (partial match)" },
        stage:        { type: "string", description: "Filter by stage name (partial match)" },
        limit:        { type: "number", description: "Max results (default 20)" }
      }
    }
  },
  {
    name: "get_account_contacts",
    description: "Get all contacts belonging to a specific account ID.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string", description: "Salesforce Account ID (18-char)" }
      },
      required: ["account_id"]
    }
  },
  {
    name: "get_account_details",
    description: "Get full account record plus last 10 activity notes.",
    inputSchema: {
      type: "object",
      properties: {
        account_id: { type: "string", description: "Salesforce Account ID (18-char)" }
      },
      required: ["account_id"]
    }
  },
  {
    name: "update_opportunity_stage",
    description: "Update the stage and optionally close date or amount on an Opportunity.",
    inputSchema: {
      type: "object",
      properties: {
        opportunity_id: { type: "string", description: "Salesforce Opportunity ID (18-char)" },
        stage:          { type: "string", description: "New stage name (e.g. 'Proposal/Price Quote', 'Closed Won')" },
        close_date:     { type: "string", description: "New close date in YYYY-MM-DD format (optional)" },
        amount:         { type: "number", description: "New opportunity amount (optional)" },
        description:    { type: "string", description: "Notes to append to the opportunity description (optional)" }
      },
      required: ["opportunity_id", "stage"]
    }
  },
  {
    name: "create_contact",
    description: "Create a new Contact in Salesforce, optionally linked to an Account.",
    inputSchema: {
      type: "object",
      properties: {
        first_name:  { type: "string", description: "Contact first name" },
        last_name:   { type: "string", description: "Contact last name" },
        email:       { type: "string", description: "Email address" },
        phone:       { type: "string", description: "Phone number (optional)" },
        title:       { type: "string", description: "Job title (optional)" },
        account_id:  { type: "string", description: "Salesforce Account ID to link to (optional)" }
      },
      required: ["first_name", "last_name"]
    }
  },
  {
    name: "log_activity",
    description: "Log a completed call or meeting note to an Account or Opportunity.",
    inputSchema: {
      type: "object",
      properties: {
        what_id:     { type: "string", description: "Account or Opportunity ID to attach to" },
        subject:     { type: "string", description: "Activity subject line" },
        description: { type: "string", description: "Call / meeting notes" },
        type:        { type: "string", enum: ["Call","Meeting","Email","Other"], description: "Activity type (default: Call)" }
      },
      required: ["what_id", "subject", "description"]
    }
  }
];

// ─── Main Fetch Handler ──────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors() });
    }

    if (url.pathname === "/health") {
      return json({ status: "ok", server: "salesforce-mcp", version: "1.0.0" });
    }

    // All other routes require Bearer auth
    const auth = request.headers.get("Authorization") || "";
    if (!env.MCP_SECRET || auth !== `Bearer ${env.MCP_SECRET}`) {
      return json({ error: "Unauthorized" }, 401);
    }

    if (url.pathname === "/mcp" && request.method === "POST") {
      return handleMCP(request, env);
    }

    return json({ error: "Not found", path: url.pathname }, 404);
  }
};

// ─── MCP Protocol Handler ────────────────────────────────────────────────────

async function handleMCP(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return mcpError(null, -32700, "Parse error"); }

  const { jsonrpc, id, method, params } = body;
  if (jsonrpc !== "2.0") return mcpError(id, -32600, "Invalid Request");

  switch (method) {
    case "initialize":
      return mcpResult(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "salesforce-mcp", version: "1.0.0" }
      });

    case "notifications/initialized":
      return new Response(null, { status: 204 });

    case "tools/list":
      return mcpResult(id, { tools: TOOLS });

    case "tools/call": {
      const { name, arguments: args } = params || {};
      try {
        const { token, instance } = await getSFToken(env);
        const result = await callTool(name, args || {}, token, instance);
        return mcpResult(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        });
      } catch (e) {
        return mcpResult(id, {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true
        });
      }
    }

    default:
      return mcpError(id, -32601, `Method not found: ${method}`);
  }
}

// ─── Salesforce Auth ─────────────────────────────────────────────────────────

async function getSFToken(env) {
  // Try client_credentials first (Connected App OAuth), fall back to SOAP password grant
  if (env.SF_CLIENT_ID && env.SF_CLIENT_SECRET) {
    const params = new URLSearchParams({
      grant_type:    "client_credentials",
      client_id:     env.SF_CLIENT_ID,
      client_secret: env.SF_CLIENT_SECRET
    });
    const res  = await fetch("https://login.salesforce.com/services/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    params.toString()
    });
    const data = await res.json();
    if (data.access_token) {
      return { token: data.access_token, instance: data.instance_url };
    }
    // Fall through to SOAP if client_credentials not enabled on the Connected App
  }

  if (!env.SF_USERNAME || !env.SF_PASSWORD || !env.SF_SECURITY_TOKEN) {
    throw new Error("Set SF_CLIENT_ID+SF_CLIENT_SECRET (OAuth) or SF_USERNAME+SF_PASSWORD+SF_SECURITY_TOKEN (SOAP) via wrangler secret put.");
  }

  const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<env:Envelope xmlns:xsd="http://www.w3.org/2001/XMLSchema"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:env="http://schemas.xmlsoap.org/soap/envelope/">
  <env:Body>
    <n1:login xmlns:n1="urn:partner.soap.sforce.com">
      <n1:username>${env.SF_USERNAME}</n1:username>
      <n1:password>${env.SF_PASSWORD}${env.SF_SECURITY_TOKEN}</n1:password>
    </n1:login>
  </env:Body>
</env:Envelope>`;

  const res = await fetch("https://login.salesforce.com/services/Soap/u/57.0", {
    method: "POST",
    headers: { "Content-Type": "text/xml", SOAPAction: "login" },
    body: soapBody
  });

  const xml    = await res.text();
  const fault  = xml.match(/<faultstring>([^<]+)<\/faultstring>/);
  if (fault) throw new Error(`SF Auth: ${fault[1]}`);

  const session = xml.match(/<sessionId>([^<]+)<\/sessionId>/);
  const server  = xml.match(/<serverUrl>([^<]+)<\/serverUrl>/);
  if (!session || !server) throw new Error("Could not parse SF login response");

  const instance = server[1].match(/(https:\/\/[^\/]+)/)[1];
  return { token: session[1], instance };
}

// ─── SOQL Helper ─────────────────────────────────────────────────────────────

async function sfQuery(soql, token, instance) {
  // Inject OwnerId filter so we only see Chris's records
  const upper = soql.toUpperCase();
  if (!upper.includes("OWNERID")) {
    if (upper.includes(" WHERE ")) {
      soql = soql.replace(/( WHERE )/i, ` WHERE OwnerId = '${OWNER_ID}' AND `);
    } else {
      const beforeKws = [" ORDER BY ", " LIMIT ", " GROUP BY "];
      let injected = false;
      for (const kw of beforeKws) {
        const idx = upper.indexOf(kw);
        if (idx !== -1) {
          soql = soql.slice(0, idx) + ` WHERE OwnerId = '${OWNER_ID}'` + soql.slice(idx);
          injected = true;
          break;
        }
      }
      if (!injected) soql += ` WHERE OwnerId = '${OWNER_ID}'`;
    }
  }

  const res  = await fetch(`${instance}/services/data/v57.0/query/?q=${encodeURIComponent(soql)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });
  const data = await res.json();
  if (data.errorCode) throw new Error(data.message || data.errorCode);
  return data.records || [];
}

// ─── Tool Implementations ────────────────────────────────────────────────────

async function callTool(name, args, token, instance) {
  const lim = args.limit || 10;

  if (name === "search_accounts") {
    const q = args.query.replace(/'/g, "\\'");
    return sfQuery(
      `SELECT Id, Name, Phone, BillingCity, BillingState, Type, Industry FROM Account WHERE Name LIKE '%${q}%' ORDER BY Name LIMIT ${lim}`,
      token, instance
    );
  }

  if (name === "search_contacts") {
    const q = args.query.replace(/'/g, "\\'");
    return sfQuery(
      `SELECT Id, FirstName, LastName, Title, Email, Phone, Account.Name FROM Contact WHERE Name LIKE '%${q}%' OR Email LIKE '%${q}%' ORDER BY LastName LIMIT ${lim}`,
      token, instance
    );
  }

  if (name === "get_opportunities") {
    let where = `StageName != 'Closed Won' AND StageName != 'Closed Lost'`;
    if (args.account_name) where += ` AND Account.Name LIKE '%${args.account_name.replace(/'/g, "\\'")}%'`;
    if (args.stage)        where += ` AND StageName LIKE '%${args.stage.replace(/'/g, "\\'")}%'`;
    return sfQuery(
      `SELECT Id, Name, StageName, Amount, CloseDate, Account.Name, Description FROM Opportunity WHERE ${where} ORDER BY CloseDate ASC LIMIT ${args.limit || 20}`,
      token, instance
    );
  }

  if (name === "get_account_contacts") {
    return sfQuery(
      `SELECT Id, FirstName, LastName, Title, Email, Phone FROM Contact WHERE AccountId = '${args.account_id}'`,
      token, instance
    );
  }

  if (name === "get_account_details") {
    const [acctRes, activities] = await Promise.all([
      fetch(`${instance}/services/data/v57.0/sobjects/Account/${args.account_id}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
      }).then(r => r.json()),
      sfQuery(
        `SELECT Id, Subject, ActivityDate, Description, Type FROM Task WHERE WhatId = '${args.account_id}' ORDER BY ActivityDate DESC LIMIT 10`,
        token, instance
      )
    ]);
    if (acctRes.errorCode) throw new Error(acctRes.message);
    return { account: acctRes, recent_activities: activities };
  }

  if (name === "update_opportunity_stage") {
    const body = { StageName: args.stage };
    if (args.close_date)  body.CloseDate   = args.close_date;
    if (args.amount)      body.Amount      = args.amount;
    if (args.description) body.Description = args.description;
    const res = await fetch(`${instance}/services/data/v57.0/sobjects/Opportunity/${args.opportunity_id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(body)
    });
    if (res.status === 204) return { success: true, id: args.opportunity_id };
    const data = await res.json();
    if (Array.isArray(data) && data[0]?.errorCode) throw new Error(data[0].message);
    return { success: true, id: args.opportunity_id };
  }

  if (name === "create_contact") {
    const body = {
      FirstName: args.first_name,
      LastName:  args.last_name,
      OwnerId:   OWNER_ID
    };
    if (args.email)      body.Email     = args.email;
    if (args.phone)      body.Phone     = args.phone;
    if (args.title)      body.Title     = args.title;
    if (args.account_id) body.AccountId = args.account_id;
    const res = await fetch(`${instance}/services/data/v57.0/sobjects/Contact`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (Array.isArray(data) && data[0]?.errorCode) throw new Error(data[0].message);
    return { success: true, id: data.id };
  }

  if (name === "log_activity") {
    const res = await fetch(`${instance}/services/data/v57.0/sobjects/Task`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        Subject:     args.subject,
        Description: args.description,
        WhatId:      args.what_id,
        Type:        args.type || "Call",
        Status:      "Completed",
        OwnerId:     OWNER_ID
      })
    });
    const data = await res.json();
    if (Array.isArray(data) && data[0]?.errorCode) throw new Error(data[0].message);
    return { success: true, id: data.id };
  }

  throw new Error(`Unknown tool: ${name}`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mcpResult(id, result) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: { "Content-Type": "application/json", ...cors() }
  });
}

function mcpError(id, code, message) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), {
    status: 400,
    headers: { "Content-Type": "application/json", ...cors() }
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors() }
  });
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}
