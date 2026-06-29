// MAM Email Triage — unit tests (Vitest)
// Exercises pure logic functions and the HTTP router via a mock env.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(method, path, body, token = 'test-secret') {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return new Request(`https://worker.test${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Minimal D1 stub backed by an in-memory array */
function makeDB(rows = []) {
  let nextId = 1;
  const store = [...rows];

  const stmtFor = (sql) => ({
    bind: (...bindings) => ({
      run: async () => {
        if (/^INSERT/i.test(sql)) {
          const id = nextId++;
          store.push({ id });
          return { meta: { last_row_id: id, changes: 1 } };
        }
        if (/^UPDATE/i.test(sql)) {
          return { meta: { changes: store.length > 0 ? 1 : 0 } };
        }
        return { meta: { changes: 0, last_row_id: 0 } };
      },
      all: async () => {
        // For SELECT * FROM emails WHERE id = ? return the last inserted row
        if (/WHERE id = \?/.test(sql)) {
          const id = bindings[bindings.length - 1];
          return { results: store.filter(r => r.id === id) };
        }
        return { results: store };
      },
    }),
  });

  return { prepare: (sql) => stmtFor(sql) };
}

function makeSalesforceMCP(contacts = []) {
  return {
    fetch: async () => {
      const text = JSON.stringify(contacts);
      return new Response(JSON.stringify({
        result: { content: [{ text }] },
      }), { status: 200 });
    },
  };
}

function makeAI(label = 'follow_up', confidence = 0.85, reasoning = 'looks relevant') {
  return {
    run: async () => ({
      response: JSON.stringify({ label, confidence, reasoning }),
    }),
  };
}

function makeEnv(overrides = {}) {
  return {
    API_KEY: 'test-secret',
    DB: makeDB(),
    SALESFORCE_MCP: makeSalesforceMCP(),
    AI: makeAI(),
    MCP_SECRET: 'mcp-secret',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe('auth', () => {
  it('rejects missing token', async () => {
    const res = await worker.fetch(makeRequest('GET', '/emails', null, null), makeEnv());
    expect(res.status).toBe(401);
  });

  it('rejects wrong token', async () => {
    const res = await worker.fetch(makeRequest('GET', '/emails', null, 'bad-token'), makeEnv());
    expect(res.status).toBe(401);
  });

  it('accepts correct token', async () => {
    const res = await worker.fetch(makeRequest('GET', '/emails', null, 'test-secret'), makeEnv());
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /ingest-email
// ---------------------------------------------------------------------------

describe('POST /ingest-email', () => {
  it('returns 400 when required fields are missing', async () => {
    const res = await worker.fetch(
      makeRequest('POST', '/ingest-email', { sender_email: 'x@x.com' }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/required/i);
  });

  it('returns 201 and triage result for a valid email', async () => {
    const env = makeEnv({ AI: makeAI('urgent', 0.9, 'hot prospect') });
    const res = await worker.fetch(
      makeRequest('POST', '/ingest-email', {
        received_at:  '2026-06-29T10:00:00Z',
        sender_email: 'buyer@acme.com',
        subject:      'Urgent quote request',
        body_preview: 'Need pricing ASAP for 10 units.',
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeTypeOf('number');
    expect(body.triage_label).toBe('urgent');
  });

  it('auto-ignores LinkedIn notification emails without calling AI', async () => {
    const aiSpy = vi.fn();
    const env = makeEnv({
      AI: { run: aiSpy },
      SALESFORCE_MCP: makeSalesforceMCP([]), // SF not called either for noise
    });

    const res = await worker.fetch(
      makeRequest('POST', '/ingest-email', {
        received_at:  '2026-06-29T11:00:00Z',
        sender_email: 'noreply@linkedin.com',
        subject:      'You have 3 new connections',
        body_preview: 'See who connected with you this week.',
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.triage_label).toBe('ignore');
    expect(aiSpy).not.toHaveBeenCalled();
  });

  it('auto-ignores quarantine notification subjects', async () => {
    const aiSpy = vi.fn();
    const env = makeEnv({ AI: { run: aiSpy } });
    const res = await worker.fetch(
      makeRequest('POST', '/ingest-email', {
        received_at:  '2026-06-29T12:00:00Z',
        sender_email: 'security@barracudanetworks.com',
        subject:      'Quarantine Notification — 3 messages held',
        body_preview: 'Review your quarantined messages.',
      }),
      env,
    );
    expect(res.status).toBe(201);
    expect((await res.json()).triage_label).toBe('ignore');
    expect(aiSpy).not.toHaveBeenCalled();
  });

  it('promotes SF-matched contacts from fyi to follow_up', async () => {
    const env = makeEnv({
      AI: makeAI('fyi', 0.6, 'product announcement'),
      SALESFORCE_MCP: makeSalesforceMCP([{
        Id: 'sf001', FirstName: 'Jane', LastName: 'Doe',
        Email: 'jane@customer.com', Title: 'Buyer', Account: { Name: 'Customer Corp' },
      }]),
    });

    const res = await worker.fetch(
      makeRequest('POST', '/ingest-email', {
        received_at:  '2026-06-29T13:00:00Z',
        sender_email: 'jane@customer.com',
        subject:      'Product update from your team',
        body_preview: 'Check out what is new.',
      }),
      env,
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.triage_label).toBe('follow_up');
    expect(body.sf_contact_name).toBe('Jane Doe');
    expect(body.sf_account_name).toBe('Customer Corp');
  });

  it('handles AI errors gracefully (falls back to unclassified)', async () => {
    const env = makeEnv({
      AI: { run: async () => { throw new Error('model unavailable'); } },
      SALESFORCE_MCP: makeSalesforceMCP([]),
    });
    const res = await worker.fetch(
      makeRequest('POST', '/ingest-email', {
        received_at:  '2026-06-29T14:00:00Z',
        sender_email: 'unknown@example.com',
        subject:      'Random inquiry',
        body_preview: 'Hello.',
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(['unclassified', 'follow_up']).toContain(body.triage_label);
  });

  it('truncates body_preview to 500 chars before storing', async () => {
    const longPreview = 'x'.repeat(800);
    const insertSpy = vi.fn().mockResolvedValue({ meta: { last_row_id: 1 } });

    // Capture what gets bound to the INSERT
    const capturedBindings = [];
    const env = makeEnv({
      DB: {
        prepare: (sql) => ({
          bind: (...args) => {
            capturedBindings.push(...args);
            return { run: insertSpy, all: async () => ({ results: [] }) };
          },
        }),
      },
    });

    await worker.fetch(
      makeRequest('POST', '/ingest-email', {
        received_at:  '2026-06-29T15:00:00Z',
        sender_email: 'test@example.com',
        subject:      'Long email',
        body_preview: longPreview,
      }),
      env,
    );

    // body_preview is the 5th bound value (index 4)
    const storedPreview = capturedBindings[4];
    expect(typeof storedPreview === 'string' ? storedPreview.length : 0).toBeLessThanOrEqual(500);
  });
});

// ---------------------------------------------------------------------------
// GET /emails
// ---------------------------------------------------------------------------

describe('GET /emails', () => {
  it('returns email list', async () => {
    const env = makeEnv({
      DB: makeDB([{ id: 1, subject: 'Test', triage_label: 'urgent', status: 'new' }]),
    });
    const res = await worker.fetch(makeRequest('GET', '/emails'), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.emails)).toBe(true);
  });

  it('accepts label filter in query string', async () => {
    const res = await worker.fetch(makeRequest('GET', '/emails?label=urgent&limit=10'), makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(10);
  });

  it('caps limit at 200', async () => {
    const res = await worker.fetch(makeRequest('GET', '/emails?limit=9999'), makeEnv());
    const body = await res.json();
    expect(body.limit).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// PATCH /emails/:id/triage
// ---------------------------------------------------------------------------

describe('PATCH /emails/:id/triage', () => {
  it('returns 400 for invalid label', async () => {
    const res = await worker.fetch(
      makeRequest('PATCH', '/emails/1/triage', { label: 'banana' }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid label/i);
  });

  it('returns 400 for invalid status', async () => {
    const res = await worker.fetch(
      makeRequest('PATCH', '/emails/1/triage', { status: 'deleted' }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is empty', async () => {
    const res = await worker.fetch(
      makeRequest('PATCH', '/emails/1/triage', {}),
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it('updates label successfully', async () => {
    const row = { id: 1, subject: 'Hi', triage_label: 'unclassified', status: 'new' };
    const db = makeDB([row]);
    // Patch the update stub so changes = 1
    const origPrepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      const stmt = origPrepare(sql);
      if (/^UPDATE/i.test(sql)) {
        return {
          bind: (...args) => ({
            run: async () => ({ meta: { changes: 1 } }),
            all: async () => ({ results: [{ ...row, triage_label: 'urgent' }] }),
          }),
        };
      }
      return stmt;
    };

    const env = makeEnv({ DB: db });
    const res = await worker.fetch(
      makeRequest('PATCH', '/emails/1/triage', { label: 'urgent' }),
      env,
    );
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /reclassify
// ---------------------------------------------------------------------------

describe('POST /reclassify', () => {
  it('reports 0 processed when no unclassified emails exist', async () => {
    const env = makeEnv({
      DB: {
        prepare: () => ({
          bind: () => ({ all: async () => ({ results: [] }) }),
        }),
      },
    });
    const res = await worker.fetch(makeRequest('POST', '/reclassify'), env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(0);
  });

  it('classifies unclassified emails and returns counts', async () => {
    let updateCalled = 0;
    const env = makeEnv({
      AI: makeAI('follow_up', 0.75, 'vendor update'),
      DB: {
        prepare: (sql) => ({
          bind: (...args) => ({
            all: async () => ({
              results: /SELECT/i.test(sql)
                ? [{ id: 1, sender_email: 'v@vendor.com', subject: 'Update', body_preview: 'Hi', sf_match_status: 'unmatched' }]
                : [],
            }),
            run: async () => { updateCalled++; return { meta: { changes: 1 } }; },
          }),
        }),
      },
    });

    const res = await worker.fetch(makeRequest('POST', '/reclassify'), env);
    const body = await res.json();
    expect(body.processed).toBe(1);
    expect(body.updated).toBe(1);
    expect(body.errors).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 404 for unknown routes
// ---------------------------------------------------------------------------

describe('routing', () => {
  it('returns 404 for unknown path', async () => {
    const res = await worker.fetch(makeRequest('GET', '/unknown'), makeEnv());
    expect(res.status).toBe(404);
  });

  it('returns 404 for wrong method on known path', async () => {
    const res = await worker.fetch(makeRequest('DELETE', '/emails'), makeEnv());
    expect(res.status).toBe(404);
  });
});
