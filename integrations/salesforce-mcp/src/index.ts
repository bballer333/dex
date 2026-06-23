import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

export interface Env {
  SF_LOGIN_URL: string;
  SF_CLIENT_ID: string;
  SF_CLIENT_SECRET: string;
  SF_USERNAME: string;
  SF_PASSWORD_TOKEN: string; // password + security token concatenated
  MCP_SECRET: string;
}

interface SalesforceToken {
  instanceUrl: string;
  accessToken: string;
}

async function getSalesforceToken(env: Env): Promise<SalesforceToken> {
  const params = new URLSearchParams({
    grant_type: "password",
    client_id: env.SF_CLIENT_ID,
    client_secret: env.SF_CLIENT_SECRET,
    username: env.SF_USERNAME,
    password: env.SF_PASSWORD_TOKEN,
  });

  const res = await fetch(`${env.SF_LOGIN_URL}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Salesforce auth failed: ${err}`);
  }

  const data = await res.json() as { instance_url: string; access_token: string };
  return { instanceUrl: data.instance_url, accessToken: data.access_token };
}

async function sfQuery(env: Env, soql: string): Promise<any[]> {
  const { instanceUrl, accessToken } = await getSalesforceToken(env);
  const url = `${instanceUrl}/services/data/v59.0/query?q=${encodeURIComponent(soql)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Salesforce query failed: ${err}`);
  }

  const data = await res.json() as { records: any[] };
  return data.records ?? [];
}

function formatContact(r: any): string {
  return [
    `Name: ${r.Name}`,
    r.Title ? `Title: ${r.Title}` : null,
    r.Email ? `Email: ${r.Email}` : null,
    r.Phone ? `Phone: ${r.Phone}` : null,
    r.Account?.Name ? `Account: ${r.Account.Name}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatAccount(r: any): string {
  return [
    `Name: ${r.Name}`,
    r.Phone ? `Phone: ${r.Phone}` : null,
    r.BillingCity ? `City: ${r.BillingCity}, ${r.BillingState ?? ""}`.trim() : null,
    r.Website ? `Website: ${r.Website}` : null,
    r.Type ? `Type: ${r.Type}` : null,
    r.OwnerId ? `Owner ID: ${r.OwnerId}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function createMcpServer(env: Env): McpServer {
  const server = new McpServer({
    name: "salesforce-mcp",
    version: "1.0.0",
  });

  server.tool(
    "search_contacts",
    "Search Salesforce contacts by name or company name",
    { query: z.string().describe("Name or company to search for") },
    async ({ query }) => {
      const safe = query.replace(/'/g, "\\'");
      const soql = `
        SELECT Id, Name, Title, Email, Phone, Account.Name
        FROM Contact
        WHERE Name LIKE '%${safe}%'
           OR Account.Name LIKE '%${safe}%'
        ORDER BY Name
        LIMIT 10
      `;
      const records = await sfQuery(env, soql);
      if (!records.length) return { content: [{ type: "text", text: `No contacts found for "${query}".` }] };
      const text = records.map(formatContact).join("\n---\n");
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "search_accounts",
    "Search Salesforce accounts by name",
    { query: z.string().describe("Account/company name to search for") },
    async ({ query }) => {
      const safe = query.replace(/'/g, "\\'");
      const soql = `
        SELECT Id, Name, Phone, BillingCity, BillingState, Website, Type
        FROM Account
        WHERE Name LIKE '%${safe}%'
        ORDER BY Name
        LIMIT 10
      `;
      const records = await sfQuery(env, soql);
      if (!records.length) return { content: [{ type: "text", text: `No accounts found for "${query}".` }] };
      const text = records.map(formatAccount).join("\n---\n");
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "get_account_contacts",
    "Get all contacts associated with a specific account",
    { account_name: z.string().describe("The account/company name") },
    async ({ account_name }) => {
      const safe = account_name.replace(/'/g, "\\'");
      const soql = `
        SELECT Id, Name, Title, Email, Phone
        FROM Contact
        WHERE Account.Name LIKE '%${safe}%'
        ORDER BY Name
        LIMIT 25
      `;
      const records = await sfQuery(env, soql);
      if (!records.length) return { content: [{ type: "text", text: `No contacts found for account "${account_name}".` }] };
      const text = records.map(formatContact).join("\n---\n");
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "get_opportunities",
    "Get open opportunities for an account",
    { account_name: z.string().describe("The account/company name") },
    async ({ account_name }) => {
      const safe = account_name.replace(/'/g, "\\'");
      const soql = `
        SELECT Id, Name, StageName, Amount, CloseDate, Probability, OwnerId
        FROM Opportunity
        WHERE Account.Name LIKE '%${safe}%'
          AND IsClosed = false
        ORDER BY CloseDate ASC
        LIMIT 10
      `;
      const records = await sfQuery(env, soql);
      if (!records.length) return { content: [{ type: "text", text: `No open opportunities found for "${account_name}".` }] };
      const text = records.map((r: any) =>
        [
          `Name: ${r.Name}`,
          `Stage: ${r.StageName}`,
          r.Amount ? `Amount: $${Number(r.Amount).toLocaleString()}` : null,
          `Close Date: ${r.CloseDate}`,
          r.Probability ? `Probability: ${r.Probability}%` : null,
        ]
          .filter(Boolean)
          .join("\n")
      ).join("\n---\n");
      return { content: [{ type: "text", text }] };
    }
  );

  return server;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Auth check
    const auth = request.headers.get("Authorization");
    if (!env.MCP_SECRET || auth !== `Bearer ${env.MCP_SECRET}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    const url = new URL(request.url);

    if (url.pathname === "/mcp" && request.method === "POST") {
      const server = createMcpServer(env);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless mode
      });

      await server.connect(transport);
      return transport.handleRequest(request);
    }

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", service: "salesforce-mcp" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};
