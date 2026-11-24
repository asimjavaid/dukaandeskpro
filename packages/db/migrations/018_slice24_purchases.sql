-- DukaanDesk — multi-line purchase invoices.
-- Supplier due for an invoice is due_paisa (total minus paid), not the
-- undiscounted line sum. Linked stock_receives are marked paid_now = 1
-- and purchase_invoice_id so they do not also increase the supplier balance.
-- Single-product receives (purchase_invoice_id NULL) keep paid_now vs due.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS purchase_invoices (
  id               TEXT PRIMARY KEY,
  supplier_id      TEXT NOT NULL REFERENCES suppliers(id),
  subtotal_paisa   INTEGER NOT NULL CHECK (subtotal_paisa >= 0),
  discount_paisa   INTEGER NOT NULL CHECK (discount_paisa >= 0),
  total_paisa      INTEGER NOT NULL CHECK (total_paisa >= 0),
  paid_paisa       INTEGER NOT NULL CHECK (paid_paisa >= 0),
  due_paisa        INTEGER NOT NULL CHECK (due_paisa >= 0),
  purchased_on     TEXT NOT NULL,
  note             TEXT,
  created_by       TEXT REFERENCES users(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS purchase_invoices_supplier_idx
  ON purchase_invoices (supplier_id, purchased_on DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS purchase_lines (
  id                    TEXT PRIMARY KEY,
  invoice_id            TEXT NOT NULL REFERENCES purchase_invoices(id),
  product_id            TEXT NOT NULL REFERENCES products(id),
  pieces                INTEGER NOT NULL CHECK (pieces > 0),
  line_amount_paisa     INTEGER NOT NULL CHECK (line_amount_paisa >= 0),
  discount_share_paisa  INTEGER NOT NULL CHECK (discount_share_paisa >= 0),
  unit_cost_paisa       INTEGER NOT NULL CHECK (unit_cost_paisa >= 0)
);

CREATE INDEX IF NOT EXISTS purchase_lines_invoice_idx
  ON purchase_lines (invoice_id);

ALTER TABLE stock_receives ADD COLUMN purchase_invoice_id TEXT REFERENCES purchase_invoices(id);
