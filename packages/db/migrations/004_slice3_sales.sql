-- DukaanDesk Slice 3 — cash POS sales + lines; stock decrement in same txn (app layer).
-- Oversell refused (qty_on_hand never negative). Udhaar / split tender / tax UI out.
-- Dual timestamps: client_device_at (till) + recorded_at (server apply).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sales (
  id                TEXT PRIMARY KEY,
  short_id          TEXT NOT NULL,
  store_id          TEXT REFERENCES store(id),
  sold_by           TEXT REFERENCES users(id),
  payment_method    TEXT NOT NULL CHECK (payment_method IN ('cash')),
  total_paisa       INTEGER NOT NULL CHECK (total_paisa >= 0),
  client_device_at  TEXT NOT NULL,
  recorded_at       TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_short_id_idx ON sales (short_id);
CREATE INDEX IF NOT EXISTS sales_recorded_at_idx ON sales (recorded_at DESC);

CREATE TABLE IF NOT EXISTS sale_lines (
  id                 TEXT PRIMARY KEY,
  sale_id            TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id         TEXT NOT NULL REFERENCES products(id),
  product_name       TEXT NOT NULL,
  qty_input          INTEGER NOT NULL CHECK (qty_input > 0),
  unit               TEXT NOT NULL CHECK (unit IN ('piece', 'carton')),
  qty_pieces         INTEGER NOT NULL CHECK (qty_pieces > 0),
  unit_price_paisa   INTEGER NOT NULL CHECK (unit_price_paisa >= 0),
  line_total_paisa   INTEGER NOT NULL CHECK (line_total_paisa >= 0),
  line_no            INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS sale_lines_sale_idx ON sale_lines (sale_id, line_no);
