# email-triage — Deploy Guide

## What this is

A Cloudflare Worker that classifies incoming emails using Claude AI.
Email classification happens on ingest with categories:

- **urgent** — Requires immediate action or response (time-sensitive, critical)
- **follow_up** — Action needed but not urgent (decisions, approvals)
- **fyi** — Informational, no action needed (announcements, updates)
- **ignore** — Can be safely ignored or archived (spam, newsletters)

Each classification includes a confidence score (0.0–1.0) and reasoning.

---

## Step 1 — Deploy the Worker

From the `email-triage-worker/` folder:

```bash
npx wrangler deploy
```

Wrangler will print your Worker URL:
```
https://email-triage.cbarsanti.workers.dev
```

---

## Step 2 — Set Secrets

```bash
# Strong random string for Bearer token auth
npx wrangler secret put MCP_SECRET

# Your Claude API key (from claude.ai/settings/api-keys)
npx wrangler secret put ANTHROPIC_API_KEY
```

---

## Step 3 — Test the Endpoint

### Health Check

```bash
curl https://email-triage.cbarsanti.workers.dev/
```

Response:
```json
{
  "service": "email-triage",
  "status": "ok",
  "categories": {
    "urgent": "Requires immediate action or response",
    "follow_up": "Action needed but not urgent",
    "fyi": "Informational, no action needed",
    "ignore": "Can be safely ignored or archived"
  }
}
```

### Classify an Email

```bash
curl -X POST https://email-triage.cbarsanti.workers.dev/ingest-email \
  -H "Authorization: Bearer YOUR_MCP_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "email_id": "msg-12345",
    "from": "client@example.com",
    "to": "you@yourcompany.com",
    "subject": "URGENT: System downtime happening now",
    "body": "Our production database is down. Immediate action required.",
    "date": "2026-06-25T15:00:00Z"
  }'
```

Response:
```json
{
  "email_id": "msg-12345",
  "subject": "URGENT: System downtime happening now",
  "from": "client@example.com",
  "to": "you@yourcompany.com",
  "classification": {
    "category": "urgent",
    "confidence": 0.98,
    "reasoning": "Production system downtime requires immediate response"
  }
}
```

---

## API Reference

### POST /ingest-email

**Required Headers:**
- `Authorization: Bearer <MCP_SECRET>`
- `Content-Type: application/json`

**Request Body:**

```json
{
  "email_id": "optional-unique-id",
  "from": "sender@example.com",
  "to": "recipient@example.com",
  "subject": "Email subject line",
  "body": "Full email body text",
  "date": "ISO 8601 timestamp (optional)"
}
```

**Required Fields:**
- `subject` — Email subject
- `body` — Email body text

**Optional Fields:**
- `email_id` — Unique email identifier (returned in response)
- `from` — Sender email address
- `to` — Recipient email address(es)
- `date` — Email timestamp

**Response (200):**

```json
{
  "email_id": "optional-unique-id",
  "subject": "Email subject",
  "from": "sender@example.com",
  "to": "recipient@example.com",
  "classification": {
    "category": "urgent|follow_up|fyi|ignore",
    "confidence": 0.0,
    "reasoning": "Brief explanation of classification"
  }
}
```

**Error Responses:**

- `401 Unauthorized` — Invalid or missing Bearer token
- `400 Bad Request` — Missing `subject` or `body`
- `500 Internal Server Error` — Claude API or parsing error

---

## Integration Examples

### Node.js / JavaScript

```javascript
async function triageEmail(emailData) {
  const response = await fetch(
    "https://email-triage.cbarsanti.workers.dev/ingest-email",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.MCP_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email_id: emailData.messageId,
        from: emailData.from,
        to: emailData.to,
        subject: emailData.subject,
        body: emailData.body,
        date: emailData.date,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Triage failed: ${response.status}`);
  }

  return await response.json();
}
```

### Python

```python
import requests
import os

def triage_email(email_data):
    response = requests.post(
        "https://email-triage.cbarsanti.workers.dev/ingest-email",
        headers={
            "Authorization": f"Bearer {os.environ['MCP_SECRET']}",
            "Content-Type": "application/json",
        },
        json={
            "email_id": email_data.get("message_id"),
            "from": email_data.get("from"),
            "to": email_data.get("to"),
            "subject": email_data.get("subject"),
            "body": email_data.get("body"),
            "date": email_data.get("date"),
        },
    )
    response.raise_for_status()
    return response.json()
```

### Bash

```bash
#!/bin/bash

TRIAGE_URL="https://email-triage.cbarsanti.workers.dev/ingest-email"
MCP_SECRET="your-secret-here"

curl -X POST "$TRIAGE_URL" \
  -H "Authorization: Bearer $MCP_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "sender@example.com",
    "to": "you@example.com",
    "subject": "Test email",
    "body": "This is a test email body",
    "date": "2026-06-25T15:00:00Z"
  }'
```

---

## Common Patterns

### Bulk Triage

Process multiple emails in sequence or parallel:

```javascript
async function triageBulk(emails) {
  const results = await Promise.all(
    emails.map(email => triageEmail(email))
  );
  return results;
}
```

### Filter by Category

```javascript
async function getUrgentEmails(emails) {
  const classified = await triageBulk(emails);
  return classified.filter(r => r.classification.category === "urgent");
}
```

### Minimum Confidence

```javascript
async function getHighConfidenceTriages(email, minConfidence = 0.8) {
  const result = await triageEmail(email);
  if (result.classification.confidence < minConfidence) {
    return null; // Requires manual review
  }
  return result;
}
```

---

## Updating the Worker

To modify classification logic or add new categories:

1. Edit `worker.js`
2. Update the `CATEGORIES` object if adding new categories
3. Modify the prompt in `classifyEmail()` to adjust classification behavior
4. Run `npx wrangler deploy` to publish changes

---

## Monitoring & Logs

View Worker logs:

```bash
npx wrangler tail
```

This shows real-time logs including API errors, classification times, and authentication failures.

---

## Troubleshooting

### 401 Unauthorized
- Verify `MCP_SECRET` is set correctly with `npx wrangler secret list`
- Ensure Bearer token in request matches the secret

### 400 Bad Request
- Ensure `subject` and `body` fields are present in JSON
- Check JSON syntax with a JSON validator

### 500 Internal Server Error
- Check `npx wrangler tail` for API error details
- Verify `ANTHROPIC_API_KEY` is set and valid
- Confirm Claude API is accessible from Cloudflare Workers

### Slow Response Times
- First request to cold worker may take 1–2s (normal)
- Check `npx wrangler tail` for Claude API latency
- Classify in batches rather than single requests when possible

---

## Cost Estimation

With Claude 3.5 Sonnet:
- ~200 tokens per email classification (prompt + response)
- Input: $3/1M tokens | Output: $15/1M tokens
- ~100 emails/day = ~3¢/day cost

For cost monitoring, enable Cloudflare Analytics Engine.
