// MAM Email Triage — Cloudflare Worker

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
function checkAuth(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : '';
  return token === env.API_KEY;
}

// ---------------------------------------------------------------------------
// Salesforce contact lookup via salesforce-mcp worker
// ---------------------------------------------------------------------------
async function matchSalesforceContact(email, env) {
  const res = await env.SALESFORCE_MCP.fetch(new Request('https://salesforce-mcp/mcp', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${env.MCP_SECRET}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id:      1,
      method:  'tools/call',
      params:  {
        name:      'search_contacts',
        arguments: { query: email, limit: 1 },
      },
    }),
  }));

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`salesforce-mcp error: ${res.status} ${body}`);
  }

  const data    = await res.json();
  const text    = data?.result?.content?.[0]?.text;
  if (!text) return null;

  const records = JSON.parse(text);
  if (!records?.length) return null;

  const c = records.find(r => r.Email?.toLowerCase() === email.toLowerCase());
  if (!c) return null;

  return {
    sf_contact_id:    c.Id,
    sf_contact_name:  `${c.FirstName || ''} ${c.LastName || ''}`.trim(),
    sf_contact_title: c.Title        || null,
    sf_account_id:    null,
    sf_account_name:  c.Account?.Name || null,
  };
}

// ---------------------------------------------------------------------------
// AI triage classification
// ---------------------------------------------------------------------------

const IGNORE_DOMAINS = [
  'linkedin.com', 'jobalerts-noreply@linkedin.com',
  'barracudanetworks.com', 'mailer.linkedin.com',
  'bounce.linkedin.com', 'notifications.google.com',
  'accounts.google.com', 'mc.sendgrid.net',
  'bounce.sendgrid.net',
];

const IGNORE_SUBJECT_PATTERNS = [
  /quarantine notification/i,
  /job alert/i,
  /\d+ new connection/i,
  /storage (critical|warning)/i,
  /photos are no longer backing up/i,
];

function quickIgnoreCheck(senderEmail, subject) {
  const emailLow = (senderEmail || '').toLowerCase();
  for (const d of IGNORE_DOMAINS) {
    if (emailLow.includes(d)) return true;
  }
  for (const p of IGNORE_SUBJECT_PATTERNS) {
    if (p.test(subject || '')) return true;
  }
  return false;
}

async function classifyWithAI(env, subject, bodyPreview, sfMatched) {
  if (!env.AI) {
    return { label: sfMatched ? 'follow_up' : 'unclassified', confidence: 0.5, reasoning: 'AI binding not configured' };
  }

  const context = sfMatched
    ? 'The sender IS a known Salesforce contact (customer or prospect).'
    : 'The sender is NOT a known Salesforce contact.';

  const prompt = `You are an email triage assistant for a B2B industrial machinery sales rep named Chris at Mid Atlantic Machinery.

${context}

Classify this email into exactly one of these labels:
- urgent: Needs same-day attention. A customer with an active deal, a hot prospect, a time-sensitive ask, or a direct request that stalls a sale if ignored.
- follow_up: A real business contact (vendor, customer, colleague, partner) that needs a response within a few days but is not urgent.
- fyi: Informational. Newsletters, vendor updates, product announcements, automated reports that are worth reading but require no action.
- ignore: Spam, job listings, marketing blasts, LinkedIn notifications, security digests, quarantine reports, or anything clearly irrelevant to running a machinery business.

Email subject: ${subject}
Email preview: ${(bodyPreview || '').slice(0, 400)}

Respond in JSON only: {"label":"<label>","confidence":<0.0-1.0>,"reasoning":"<one sentence>"}`;

  try {
    const result = await env.AI.run('@cf/meta/llama-3.2-3b-instruct', {
      messages:   [{ role: 'user', content: prompt }],
      max_tokens: 100,
    });

    const raw   = result?.response ?? result?.result?.response ?? '';
    const text  = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) throw new Error('No JSON in response');

    const parsed      = JSON.parse(match[0]);
    const validLabels = ['urgent', 'follow_up', 'fyi', 'ignore'];
    if (!validLabels.includes(parsed.label)) throw new Error(`Invalid label: ${parsed.label}`);

    if (sfMatched && (parsed.label === 'ignore' || parsed.label === 'fyi')) {
      parsed.reasoning = `SF contact — promoted from ${parsed.label}. ${parsed.reasoning}`;
      parsed.label     = 'follow_up';
    }

    return {
      label:      parsed.label,
      confidence: Math.min(Math.max(parsed.confidence || 0.7, 0), 1),
      reasoning:  parsed.reasoning || '',
    };
  } catch (err) {
    console.error('AI classify error:', err.message);
    return {
      label:      sfMatched ? 'follow_up' : 'unclassified',
      confidence: 0.4,
      reasoning:  `AI error: ${err.message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Power Automate webhook — fires in background after successful ingest
// ---------------------------------------------------------------------------
async function triggerPowerAutomate(env, payload) {
  if (!env.POWER_AUTOMATE_WEBHOOK_URL) return;
  try {
    await fetch(env.POWER_AUTOMATE_WEBHOOK_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
  } catch (err) {
    console.error('Power Automate webhook error:', err.message);
  }
}

// ---------------------------------------------------------------------------
// POST /ingest-email  (requires auth)
// ---------------------------------------------------------------------------
async function handleIngestEmail(request, env, ctx) {
  if (!checkAuth(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { received_at, sender_email, sender_name, subject, body_preview, full_body,
          has_attachment, attachment_name } = payload;

  if (!received_at || !sender_email || !subject) {
    return jsonResponse({ error: 'received_at, sender_email, and subject are required' }, 400);
  }

  const isObviousNoise = quickIgnoreCheck(sender_email, subject);

  let sfFields = {
    sf_contact_id: null, sf_contact_name: null, sf_contact_title: null,
    sf_account_id: null, sf_account_name: null, sf_match_status: 'unmatched',
  };

  if (!isObviousNoise) {
    try {
      const match = await matchSalesforceContact(sender_email, env);
      if (match) sfFields = { ...match, sf_match_status: 'matched' };
    } catch (err) {
      console.error('SF match error:', err.message);
      sfFields.sf_match_status = 'error';
    }
  }

  let triage;
  if (isObviousNoise) {
    triage = { label: 'ignore', confidence: 0.95, reasoning: 'Matched ignore rule (spam/newsletter/digest)' };
  } else {
    triage = await classifyWithAI(env, subject, body_preview, sfFields.sf_match_status === 'matched');
  }

  const preview = body_preview ? body_preview.slice(0, 500) : null;

  try {
    const result = await env.DB.prepare(`
      INSERT INTO emails
        (received_at, sender_email, sender_name, subject, body_preview, full_body,
         has_attachment, attachment_name,
         sf_contact_id, sf_contact_name, sf_contact_title,
         sf_account_id, sf_account_name, sf_match_status,
         triage_label, triage_category, triage_confidence, triage_reasoning)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      received_at, sender_email, sender_name ?? null, subject,
      preview, full_body ?? null,
      has_attachment ? 1 : 0, attachment_name ?? null,
      sfFields.sf_contact_id, sfFields.sf_contact_name, sfFields.sf_contact_title,
      sfFields.sf_account_id, sfFields.sf_account_name, sfFields.sf_match_status,
      triage.label, triage.label, triage.confidence, triage.reasoning,
    ).run();

    const responsePayload = {
      id:               result.meta.last_row_id,
      triage_label:     triage.label,
      triage_reasoning: triage.reasoning,
      sf_match_status:  sfFields.sf_match_status,
      sf_contact_name:  sfFields.sf_contact_name,
      sf_account_name:  sfFields.sf_account_name,
      received_at,
      sender_email,
      sender_name:      sender_name ?? null,
      subject,
      has_attachment:   has_attachment ? true : false,
      attachment_name:  attachment_name ?? null,
    };

    ctx?.waitUntil(triggerPowerAutomate(env, responsePayload));

    return jsonResponse(responsePayload, 201);

  } catch (err) {
    if (err.message?.includes('UNIQUE constraint failed')) {
      return jsonResponse({ error: 'Duplicate email — already ingested' }, 409);
    }
    console.error('DB insert error:', err.message);
    return jsonResponse({ error: 'Database error' }, 500);
  }
}

// ---------------------------------------------------------------------------
// GET /emails  (requires auth)
// ---------------------------------------------------------------------------
async function handleListEmails(request, env) {
  if (!checkAuth(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const url     = new URL(request.url);
  const label   = url.searchParams.get('label');
  const status  = url.searchParams.get('status');
  const account = url.searchParams.get('account');
  const limit   = Math.min(parseInt(url.searchParams.get('limit')  || '50', 10), 200);
  const offset  = parseInt(url.searchParams.get('offset') || '0', 10);

  const conditions = [];
  const bindings   = [];

  if (label) { conditions.push('triage_label = ?'); bindings.push(label); }
  if (status) { conditions.push('status = ?'); bindings.push(status); }
  if (account) { conditions.push('sf_account_name LIKE ?'); bindings.push(`%${account}%`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  bindings.push(limit, offset);

  try {
    const { results } = await env.DB.prepare(
      `SELECT * FROM emails ${where} ORDER BY received_at DESC LIMIT ? OFFSET ?`
    ).bind(...bindings).all();
    return jsonResponse({ emails: results, limit, offset });
  } catch (err) {
    console.error('DB list error:', err.message);
    return jsonResponse({ error: 'Database error' }, 500);
  }
}

// ---------------------------------------------------------------------------
// PATCH /emails/:id/triage  (requires auth)
// ---------------------------------------------------------------------------
async function handleUpdateTriage(request, env, id) {
  if (!checkAuth(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: 'Invalid JSON body' }, 400); }

  const VALID_LABELS   = ['unclassified','urgent','follow_up','fyi','ignore'];
  const VALID_STATUSES = ['new','reviewed','actioned'];
  const sets = [], bindings = [];

  if (body.label !== undefined) {
    if (!VALID_LABELS.includes(body.label))
      return jsonResponse({ error: `Invalid label. Must be one of: ${VALID_LABELS.join(', ')}` }, 400);
    sets.push('triage_label = ?', 'triage_category = ?');
    bindings.push(body.label, body.label);
  }
  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status))
      return jsonResponse({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }, 400);
    sets.push('status = ?');
    bindings.push(body.status);
  }
  if (sets.length === 0) return jsonResponse({ error: 'Provide label and/or status to update' }, 400);

  bindings.push(id);
  try {
    const result = await env.DB
      .prepare(`UPDATE emails SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...bindings).run();
    if (result.meta.changes === 0) return jsonResponse({ error: 'Email not found' }, 404);
    const { results } = await env.DB.prepare('SELECT * FROM emails WHERE id = ?').bind(id).all();
    return jsonResponse(results[0]);
  } catch (err) {
    console.error('DB update error:', err.message);
    return jsonResponse({ error: 'Database error' }, 500);
  }
}

// ---------------------------------------------------------------------------
// POST /reclassify  (requires auth — batch-classifies unclassified emails)
// ---------------------------------------------------------------------------
async function handleReclassify(request, env) {
  if (!checkAuth(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const url   = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 50);

  const { results: emails } = await env.DB.prepare(
    `SELECT id, sender_email, sender_name, subject, body_preview, sf_match_status
     FROM emails WHERE triage_label = 'unclassified' ORDER BY received_at DESC LIMIT ?`
  ).bind(limit).all();

  if (!emails.length) return jsonResponse({ processed: 0, message: 'No unclassified emails' });

  let processed = 0, updated = 0, errors = 0;

  for (const email of emails) {
    processed++;
    try {
      let triage;
      if (quickIgnoreCheck(email.sender_email, email.subject)) {
        triage = { label: 'ignore', confidence: 0.95, reasoning: 'Matched ignore rule (spam/newsletter/digest)' };
      } else {
        triage = await classifyWithAI(
          env, email.subject, email.body_preview,
          email.sf_match_status === 'matched'
        );
      }

      if (triage.label !== 'unclassified') {
        await env.DB.prepare(
          `UPDATE emails SET triage_label = ?, triage_category = ?, triage_confidence = ?, triage_reasoning = ? WHERE id = ?`
        ).bind(triage.label, triage.label, triage.confidence, triage.reasoning, email.id).run();
        updated++;
      }
    } catch (err) {
      console.error(`Reclassify error for id ${email.id}:`, err.message);
      errors++;
    }
  }

  return jsonResponse({ processed, updated, errors });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const method = request.method;
    const path   = url.pathname;

    if (method === 'POST' && path === '/ingest-email')  return handleIngestEmail(request, env, ctx);
    if (method === 'GET'  && path === '/emails')         return handleListEmails(request, env);
    if (method === 'POST' && path === '/reclassify')     return handleReclassify(request, env);

    const triageMatch = path.match(/^\/emails\/(\d+)\/triage$/);
    if (method === 'PATCH' && triageMatch) return handleUpdateTriage(request, env, parseInt(triageMatch[1], 10));

    return jsonResponse({ error: 'Not found' }, 404);
  },
};
