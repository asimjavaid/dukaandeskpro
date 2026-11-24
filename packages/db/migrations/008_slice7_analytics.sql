-- DukaanDesk Slice 7 — Owner analytics (SQLite aggregates).
-- No new business tables. Indexes help today / last-7-day sales + low-stock scans.
-- Threshold for low stock is app default (5); not stored this slice.

PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS sales_store_recorded_idx
  ON sales (store_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS sales_payment_recorded_idx
  ON sales (payment_method, recorded_at DESC);

CREATE INDEX IF NOT EXISTS stock_balances_qty_idx
  ON stock_balances (qty_on_hand);
