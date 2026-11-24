-- DukaanDesk Slice 27 — collection business date on party_ledger credits.
-- Debits (udhaar sales) leave collected_on NULL; credits store YYYY-MM-DD (Asia/Karachi shop day).

ALTER TABLE party_ledger ADD COLUMN collected_on TEXT;

UPDATE party_ledger
SET collected_on = substr(created_at, 1, 10)
WHERE entry_type = 'credit'
  AND collected_on IS NULL
  AND length(created_at) >= 10;

CREATE INDEX IF NOT EXISTS party_ledger_party_collected_idx
  ON party_ledger (party_id, collected_on DESC, created_at DESC);
