-- DukaanDesk Slice 4 — parties + append-only party_ledger; udhaar sales.
-- Balance = SUM(debits) - SUM(credits); debit increases what the party owes.
-- No split tender / collections this slice. Oversell refuse unchanged (app layer).
-- Note: migrate.js disables foreign_keys around each migration so sales rebuild works.

CREATE TABLE IF NOT EXISTS parties (
  id          TEXT PRIMARY KEY,
  store_id    TEXT REFERENCES store(id),
  name        TEXT NOT NULL,
  phone       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS parties_name_idx ON parties (name);
CREATE INDEX IF NOT EXISTS parties_store_idx ON parties (store_id, name);

-- Rebuild sales to allow payment_method cash|udhaar and optional party_id.
-- SQLite cannot ALTER CHECK constraints in place.
CREATE TABLE sales_slice4 (
  id                TEXT PRIMARY KEY,
  short_id          TEXT NOT NULL,
  store_id          TEXT REFERENCES store(id),
  sold_by           TEXT REFERENCES users(id),
  payment_method    TEXT NOT NULL CHECK (payment_method IN ('cash', 'udhaar')),
  party_id          TEXT REFERENCES parties(id),
  total_paisa       INTEGER NOT NULL CHECK (total_paisa >= 0),
  client_device_at  TEXT NOT NULL,
  recorded_at       TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (payment_method = 'cash' AND party_id IS NULL)
    OR (payment_method = 'udhaar' AND party_id IS NOT NULL)
  )
);

INSERT INTO sales_slice4 (
  id, short_id, store_id, sold_by, payment_method, party_id,
  total_paisa, client_device_at, recorded_at, created_at
)
SELECT
  id, short_id, store_id, sold_by, payment_method, NULL,
  total_paisa, client_device_at, recorded_at, created_at
FROM sales;

DROP TABLE sales;
ALTER TABLE sales_slice4 RENAME TO sales;

CREATE UNIQUE INDEX IF NOT EXISTS sales_short_id_idx ON sales (short_id);
CREATE INDEX IF NOT EXISTS sales_recorded_at_idx ON sales (recorded_at DESC);
CREATE INDEX IF NOT EXISTS sales_party_idx ON sales (party_id);

-- Append-only ledger after sales rebuild (FK to sales).
-- Debit = party owes more (udhaar sale); credit = payment (later slice).
CREATE TABLE IF NOT EXISTS party_ledger (
  id            TEXT PRIMARY KEY,
  party_id      TEXT NOT NULL REFERENCES parties(id),
  entry_type    TEXT NOT NULL CHECK (entry_type IN ('debit', 'credit')),
  amount_paisa  INTEGER NOT NULL CHECK (amount_paisa > 0),
  sale_id       TEXT REFERENCES sales(id),
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS party_ledger_party_idx
  ON party_ledger (party_id, created_at DESC);
CREATE INDEX IF NOT EXISTS party_ledger_sale_idx
  ON party_ledger (sale_id);
