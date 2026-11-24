-- Purchase orders: ask a supplier for goods, then receive them into purchase bills.
CREATE TABLE IF NOT EXISTS purchase_orders (
  id          TEXT PRIMARY KEY,
  number      INTEGER NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  status      TEXT NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft','sent','partial','received','cancelled')),
  note        TEXT,
  sent_at     TEXT,
  closed_at   TEXT,
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS purchase_orders_status_idx ON purchase_orders (status, created_at);
CREATE INDEX IF NOT EXISTS purchase_orders_supplier_idx ON purchase_orders (supplier_id);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id                  TEXT PRIMARY KEY,
  order_id            TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id          TEXT NOT NULL REFERENCES products(id),
  qty_ordered         REAL NOT NULL CHECK (qty_ordered > 0),
  qty_received        REAL NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  expected_cost_paisa INTEGER CHECK (expected_cost_paisa IS NULL OR expected_cost_paisa >= 0),
  sort                INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS purchase_order_lines_order_idx ON purchase_order_lines (order_id);

ALTER TABLE purchase_invoices ADD COLUMN purchase_order_id TEXT REFERENCES purchase_orders(id);
ALTER TABLE purchase_lines ADD COLUMN order_line_id TEXT REFERENCES purchase_order_lines(id);
CREATE INDEX IF NOT EXISTS purchase_invoices_order_idx ON purchase_invoices (purchase_order_id);
