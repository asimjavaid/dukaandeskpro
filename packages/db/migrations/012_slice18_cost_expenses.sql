-- DukaanDesk — piece cost snapshot + simple Owner expenses.
-- Sell stays pieces. Carton is a receive mode only (pieces inside + carton cost).
-- last_unit_cost_paisa NULL = never costed. 0 = explicit zero.
-- sale_lines.unit_cost_paisa is a snapshot; later receives must not update it.

PRAGMA foreign_keys = ON;

ALTER TABLE products ADD COLUMN last_unit_cost_paisa INTEGER;

ALTER TABLE stock_receives ADD COLUMN amount_paisa INTEGER;
ALTER TABLE stock_receives ADD COLUMN unit_cost_paisa INTEGER;

ALTER TABLE sale_lines ADD COLUMN unit_cost_paisa INTEGER;

CREATE TABLE IF NOT EXISTS expenses (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('bill', 'salary', 'commission')),
  amount_paisa  INTEGER NOT NULL CHECK (amount_paisa > 0),
  expense_date  TEXT NOT NULL,
  note          TEXT,
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS expenses_date_idx
  ON expenses (expense_date DESC, created_at DESC);
