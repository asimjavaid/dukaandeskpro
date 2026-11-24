-- DukaanDesk Slice 10 — split tender (cash + udhaar).
-- payment_method ∈ cash|udhaar|split; store cash_amount_paisa + udhaar_amount_paisa.
-- Stock − full; ledger debit = udhaar_amount only. Tax void reverses stock + udhaar debit only.
-- No collections / FBR / Bluetooth this slice.

-- Rebuild sales: CHECK cannot ALTER in place (same pattern as slice 4).
CREATE TABLE sales_slice10 (
  id                  TEXT PRIMARY KEY,
  short_id            TEXT NOT NULL,
  store_id            TEXT REFERENCES store(id),
  sold_by             TEXT REFERENCES users(id),
  payment_method      TEXT NOT NULL CHECK (payment_method IN ('cash', 'udhaar', 'split')),
  party_id            TEXT REFERENCES parties(id),
  total_paisa         INTEGER NOT NULL CHECK (total_paisa >= 0),
  cash_amount_paisa   INTEGER NOT NULL DEFAULT 0 CHECK (cash_amount_paisa >= 0),
  udhaar_amount_paisa INTEGER NOT NULL DEFAULT 0 CHECK (udhaar_amount_paisa >= 0),
  client_device_at    TEXT NOT NULL,
  recorded_at         TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  voided_at           TEXT,
  tax_flagged         INTEGER NOT NULL DEFAULT 0,
  CHECK (
    cash_amount_paisa + udhaar_amount_paisa = total_paisa
  ),
  CHECK (
    (payment_method = 'cash'
      AND party_id IS NULL
      AND cash_amount_paisa = total_paisa
      AND udhaar_amount_paisa = 0)
    OR (payment_method = 'udhaar'
      AND party_id IS NOT NULL
      AND cash_amount_paisa = 0
      AND udhaar_amount_paisa = total_paisa)
    OR (payment_method = 'split'
      AND party_id IS NOT NULL
      AND cash_amount_paisa > 0
      AND udhaar_amount_paisa > 0)
  )
);

INSERT INTO sales_slice10 (
  id, short_id, store_id, sold_by, payment_method, party_id,
  total_paisa, cash_amount_paisa, udhaar_amount_paisa,
  client_device_at, recorded_at, created_at, voided_at, tax_flagged
)
SELECT
  id, short_id, store_id, sold_by, payment_method, party_id,
  total_paisa,
  CASE WHEN payment_method = 'cash' THEN total_paisa ELSE 0 END,
  CASE WHEN payment_method = 'udhaar' THEN total_paisa ELSE 0 END,
  client_device_at, recorded_at, created_at, voided_at, tax_flagged
FROM sales;

DROP TABLE sales;
ALTER TABLE sales_slice10 RENAME TO sales;

CREATE UNIQUE INDEX IF NOT EXISTS sales_short_id_idx ON sales (short_id);
CREATE INDEX IF NOT EXISTS sales_recorded_at_idx ON sales (recorded_at DESC);
CREATE INDEX IF NOT EXISTS sales_party_idx ON sales (party_id);
CREATE INDEX IF NOT EXISTS sales_payment_recorded_idx
  ON sales (payment_method, recorded_at DESC);
