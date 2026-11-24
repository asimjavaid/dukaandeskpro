-- DukaanDesk — suppliers the shop buys from. Not customers (parties).
-- Unpaid receives (paid_now = 0) are due. Payments are given.
-- Balance = due minus given. Old receives stay unattached.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS suppliers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS suppliers_active_name_idx
  ON suppliers (active, name);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id            TEXT PRIMARY KEY,
  supplier_id   TEXT NOT NULL REFERENCES suppliers(id),
  amount_paisa  INTEGER NOT NULL CHECK (amount_paisa > 0),
  paid_on       TEXT NOT NULL,
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS supplier_payments_supplier_idx
  ON supplier_payments (supplier_id, paid_on DESC, created_at DESC);

ALTER TABLE stock_receives ADD COLUMN supplier_id TEXT REFERENCES suppliers(id);
ALTER TABLE stock_receives ADD COLUMN paid_now INTEGER NOT NULL DEFAULT 0;
