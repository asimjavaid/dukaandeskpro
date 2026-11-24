-- DukaanDesk Slice 2 — stock balances + receive ledger.
-- Base unit = piece. Carton receives convert via products.pieces_per_carton.
-- No oversell enforcement yet (Slice 3). No supplier costs / multi-store.

PRAGMA foreign_keys = ON;

-- Pack size for carton → piece conversion (default 1 = piece-only products)
ALTER TABLE products ADD COLUMN pieces_per_carton INTEGER NOT NULL DEFAULT 1;

-- On-hand qty in base unit (piece)
CREATE TABLE IF NOT EXISTS stock_balances (
  product_id   TEXT PRIMARY KEY REFERENCES products(id),
  qty_on_hand  INTEGER NOT NULL DEFAULT 0 CHECK (qty_on_hand >= 0),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Simple receive ledger (purchase/receive events)
CREATE TABLE IF NOT EXISTS stock_receives (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES products(id),
  qty_input     INTEGER NOT NULL CHECK (qty_input > 0),
  unit          TEXT NOT NULL CHECK (unit IN ('piece', 'carton')),
  qty_pieces    INTEGER NOT NULL CHECK (qty_pieces > 0),
  received_by   TEXT REFERENCES users(id),
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS stock_receives_product_idx
  ON stock_receives (product_id, created_at DESC);

-- Seed zero balances for any existing products
INSERT OR IGNORE INTO stock_balances (product_id, qty_on_hand)
SELECT id, 0 FROM products;
