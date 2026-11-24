-- DukaanDesk — Sales screen, remove (void), edit (void + reissue), returns.
-- Additive only: new nullable columns + new empty tables. Existing rows untouched.
-- Slice 1 (Sales screen) only reads these. Remove / Edit / Returns write them later.
--
-- sales.voided_by / void_reason      — who removed a bill and why (voided_at already exists).
-- sales.replaces_sale_id             — on the new bill created by Edit.
-- sales.replaced_by_sale_id          — on the old bill an Edit replaced.
--   (plain TEXT, no FK: backup restore inserts bills oldest first)
-- sale_returns / sale_return_lines   — a return against one bill; refund as cash and/or khata.
-- party_ledger.return_id             — khata credit written by a return.

PRAGMA foreign_keys = ON;

ALTER TABLE sales ADD COLUMN voided_by TEXT;
ALTER TABLE sales ADD COLUMN void_reason TEXT;
ALTER TABLE sales ADD COLUMN replaces_sale_id TEXT;
ALTER TABLE sales ADD COLUMN replaced_by_sale_id TEXT;

CREATE TABLE IF NOT EXISTS sale_returns (
  id                  TEXT PRIMARY KEY,
  short_id            TEXT NOT NULL,
  sale_id             TEXT NOT NULL REFERENCES sales(id),
  store_id            TEXT REFERENCES store(id),
  party_id            TEXT REFERENCES parties(id),
  returned_by         TEXT,
  total_paisa         INTEGER NOT NULL CHECK (total_paisa > 0),
  refund_cash_paisa   INTEGER NOT NULL DEFAULT 0 CHECK (refund_cash_paisa >= 0),
  refund_khata_paisa  INTEGER NOT NULL DEFAULT 0 CHECK (refund_khata_paisa >= 0),
  reason              TEXT,
  client_device_at    TEXT NOT NULL,
  recorded_at         TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (refund_cash_paisa + refund_khata_paisa = total_paisa),
  CHECK (refund_khata_paisa = 0 OR party_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS sale_returns_short_id_idx ON sale_returns (short_id);
CREATE INDEX IF NOT EXISTS sale_returns_sale_idx ON sale_returns (sale_id);
CREATE INDEX IF NOT EXISTS sale_returns_recorded_at_idx ON sale_returns (recorded_at DESC);

CREATE TABLE IF NOT EXISTS sale_return_lines (
  id                TEXT PRIMARY KEY,
  return_id         TEXT NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  sale_line_id      TEXT NOT NULL REFERENCES sale_lines(id),
  product_id        TEXT NOT NULL REFERENCES products(id),
  product_name      TEXT NOT NULL,
  qty_pieces        INTEGER NOT NULL CHECK (qty_pieces > 0),
  unit_price_paisa  INTEGER NOT NULL CHECK (unit_price_paisa >= 0),
  line_total_paisa  INTEGER NOT NULL CHECK (line_total_paisa >= 0),
  unit_cost_paisa   INTEGER,
  restocked         INTEGER NOT NULL DEFAULT 1 CHECK (restocked IN (0, 1)),
  line_no           INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS sale_return_lines_return_idx ON sale_return_lines (return_id, line_no);
CREATE INDEX IF NOT EXISTS sale_return_lines_sale_line_idx ON sale_return_lines (sale_line_id);

ALTER TABLE party_ledger ADD COLUMN return_id TEXT REFERENCES sale_returns(id);

-- Sales screen search / filters.
CREATE INDEX IF NOT EXISTS sale_lines_product_idx ON sale_lines (product_id);
CREATE INDEX IF NOT EXISTS sales_party_recorded_idx ON sales (party_id, recorded_at DESC);
