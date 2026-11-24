-- DukaanDesk Slice 5 — tax queue on sale + simulate process + Owner dispositions.
-- D23: simulate/queue only. No invented FBR fields or accept codes.
-- Opaque provider_ref / reason_stub only. Status: accepted | rejected (product-side).

PRAGMA foreign_keys = ON;

-- Sale void / keep+flag markers (disposition side effects)
ALTER TABLE sales ADD COLUMN voided_at TEXT;
ALTER TABLE sales ADD COLUMN tax_flagged INTEGER NOT NULL DEFAULT 0;

-- Rebuild tax_documents: accepted/rejected (replace simulated_*), provider_ref,
-- disposition columns. Map legacy simulated_* → accepted/rejected.
CREATE TABLE tax_documents_slice5 (
  id              TEXT PRIMARY KEY,
  sale_id         TEXT,
  status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN (
                      'queued',
                      'submitting',
                      'accepted',
                      'rejected',
                      'authority_down',
                      'credit_note_queued',
                      'voided'
                    )),
  payload_json    TEXT NOT NULL DEFAULT '{}',
  provider_ref    TEXT,
  reason_stub     TEXT,
  raw_detail      TEXT,
  disposition     TEXT
                    CHECK (
                      disposition IS NULL
                      OR disposition IN ('void', 'keep_flag', 'credit_note')
                    ),
  disposed_at     TEXT,
  disposed_by     TEXT,
  client_device_at TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO tax_documents_slice5 (
  id, sale_id, status, payload_json, provider_ref, reason_stub, raw_detail,
  disposition, disposed_at, disposed_by, client_device_at, created_at, updated_at
)
SELECT
  id,
  sale_id,
  CASE status
    WHEN 'simulated_ok' THEN 'accepted'
    WHEN 'simulated_reject' THEN 'rejected'
    ELSE status
  END,
  payload_json,
  external_ref,
  NULL,
  raw_detail,
  NULL,
  NULL,
  NULL,
  client_device_at,
  created_at,
  updated_at
FROM tax_documents;

DROP TABLE tax_documents;
ALTER TABLE tax_documents_slice5 RENAME TO tax_documents;

CREATE INDEX IF NOT EXISTS tax_documents_status_idx
  ON tax_documents (status, created_at DESC);
CREATE INDEX IF NOT EXISTS tax_documents_sale_idx
  ON tax_documents (sale_id);
CREATE INDEX IF NOT EXISTS tax_documents_disposition_idx
  ON tax_documents (status, disposition);
