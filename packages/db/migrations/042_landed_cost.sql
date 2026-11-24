-- Landed cost: delivery / extra charges on a purchase bill, spread over its lines by value.
-- Bill extras total; the part owed to this supplier is in total_paisa / due_paisa (paid-separately part is not).
ALTER TABLE purchase_invoices ADD COLUMN extras_paisa INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchase_invoices ADD COLUMN extras_owed_paisa INTEGER NOT NULL DEFAULT 0;
-- Share of the bill extras carried by this line; unit_cost_paisa is the landed cost (net + share) / pieces.
ALTER TABLE purchase_lines ADD COLUMN extra_share_paisa INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS purchase_extras (
  id               TEXT PRIMARY KEY,
  invoice_id       TEXT NOT NULL REFERENCES purchase_invoices(id),
  label            TEXT NOT NULL,
  amount_paisa     INTEGER NOT NULL CHECK (amount_paisa >= 0),
  paid_separately  INTEGER NOT NULL DEFAULT 0,
  sort             INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_purchase_extras_invoice ON purchase_extras(invoice_id);
