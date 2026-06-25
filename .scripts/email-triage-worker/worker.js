/**
 * email-triage — Cloudflare Worker
 * Classifies incoming emails using Claude AI.
 *
 * Required Worker Secrets (set via `wrangler secret put`):
 *   MCP_SECRET       – Bearer token for auth
 *   ANTHROPIC_API_KEY – Claude API key
 */

const CATEGORIES = {
  urgent: "Requires immediate action or response",
  follow_up: "Action needed but not urgent",
  fyi: "Informational, no action needed",
  ignore: "Can be safely ignored or archived"
};

/**
 * Validate Bearer token from Authorization header
 */
function validateAuth(request, mcp_secret) {
  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return false;
  }
  const token = auth.slice(7);
  return token === mcp_secret;
}

/**
 * Classify an email using Claude
 */
async function classifyEmail(email, anthropic_api_key) {
  const prompt = `Classify this email into ONE of these categories:
- urgent: Requires immediate action or response (time-sensitive, critical)
- follow_up: Action needed but not urgent (decisions, approvals, follow-ups)
- fyi: Informational, no action needed (announcements, updates, FYI)
- ignore: Can be safely ignored or archived (spam, newsletters, promotions)

Email metadata:
From: ${email.from || "unknown"}
To: ${email.to || "unknown"}
Subject: ${email.subject || "(no subject)"}
Date: ${email.date || "unknown"}

Email body:
${email.body || "(no body)"}

Respond with ONLY a JSON object in this format:
{
  "category": "urgent|follow_up|fyi|ignore",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation"
}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropic_api_key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${response.status} ${error}`);
  }

  const data = await response.json();
  const text = data.content[0].text;

  // Extract JSON from response (handle markdown code blocks if present)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to parse Claude response as JSON");
  }

  return JSON.parse(jsonMatch[0]);
}

/**
 * Handle POST /ingest-email
 */
async function handleIngestEmail(request, env) {
  if (!validateAuth(request, env.MCP_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let email;
  try {
    email = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  // Validate required fields
  if (!email.subject || !email.body) {
    return new Response(
      JSON.stringify({
        error: "Missing required fields: subject, body",
      }),
      {
        status: 400,
        headers: { "content-type": "application/json" },
      }
    );
  }

  try {
    const classification = await classifyEmail(email, env.ANTHROPIC_API_KEY);

    return new Response(
      JSON.stringify({
        email_id: email.email_id || null,
        subject: email.subject,
        from: email.from,
        to: email.to,
        classification,
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Triage error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to classify email",
        message: error.message,
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      }
    );
  }
}

/**
 * Handle GET / (health check)
 */
function handleRoot() {
  return new Response(
    JSON.stringify({
      service: "email-triage",
      status: "ok",
      categories: CATEGORIES,
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    }
  );
}

/**
 * Main worker fetch handler
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return handleRoot();
    }

    if (request.method === "POST" && url.pathname === "/ingest-email") {
      return handleIngestEmail(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
};
