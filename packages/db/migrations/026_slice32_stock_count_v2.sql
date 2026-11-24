-- DukaanDesk S-SC4 / Stock Count v2 — additive columns for reasons, cost snapshot, coverage.
-- D28 stays: absolute post, Owner-only, one draft/store, piece base, stock_adjustments ledger.
-- Q1=A cost snapshot · Q2=A no categories · Q3=A no blind · Q4=A reason optional · Q5=A no photos.

PRAGMA foreign_keys = ON;

ALTER TABLE stock_count_lines ADD COLUMN reason_code TEXT NULL
  CHECK (reason_code IS NULL OR reason_code IN ('damaged', 'expired', 'stolen_lost', 'admin_error'));

ALTER TABLE stock_count_lines ADD COLUMN unit_cost_paisa_snapshot INTEGER NULL;

ALTER TABLE stock_adjustments ADD COLUMN reason_code TEXT NULL
  CHECK (reason_code IS NULL OR reason_code IN ('damaged', 'expired', 'stolen_lost', 'admin_error'));

ALTER TABLE stock_adjustments ADD COLUMN unit_cost_paisa INTEGER NULL;

ALTER TABLE stock_count_sessions ADD COLUMN items_total_at_post INTEGER NULL;
