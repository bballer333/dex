-- MAM Email Triage — D1 Schema

CREATE TABLE IF NOT EXISTS emails (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at      TEXT    NOT NULL,
  sender_email     TEXT    NOT NULL,
  sender_name      TEXT,
  subject          TEXT    NOT NULL,
  body_preview     TEXT    CHECK(length(body_preview) <= 500),
  full_body        TEXT,
  triage_label     TEXT    NOT NULL DEFAULT 'unclassified'
                           CHECK(triage_label IN ('unclassified','urgent','follow_up','fyi','ignore')),
  has_attachment   INTEGER NOT NULL DEFAULT 0 CHECK(has_attachment IN (0,1)),
  attachment_name  TEXT,
  sf_contact_id    TEXT,
  sf_contact_name  TEXT,
  sf_contact_title TEXT,
  sf_account_id    TEXT,
  sf_account_name  TEXT,
  sf_match_status  TEXT    NOT NULL DEFAULT 'unmatched'
                           CHECK(sf_match_status IN ('unmatched','matched','error')),
  status           TEXT    NOT NULL DEFAULT 'new'
                           CHECK(status IN ('new','reviewed','actioned')),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),

  UNIQUE(received_at, sender_email, subject)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_triage_label    ON emails(triage_label);
CREATE INDEX IF NOT EXISTS idx_status          ON emails(status);
CREATE INDEX IF NOT EXISTS idx_sf_account_name ON emails(sf_account_name);
CREATE INDEX IF NOT EXISTS idx_received_at     ON emails(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_sender_email    ON emails(sender_email);
CREATE INDEX IF NOT EXISTS idx_triage_status   ON emails(triage_label, status);
CREATE INDEX IF NOT EXISTS idx_sf_match_status ON emails(sf_match_status);

-- Auto-update updated_at on row changes
CREATE TRIGGER IF NOT EXISTS trg_emails_updated_at
  AFTER UPDATE ON emails
  FOR EACH ROW
BEGIN
  UPDATE emails SET updated_at = datetime('now') WHERE id = OLD.id;
END;
