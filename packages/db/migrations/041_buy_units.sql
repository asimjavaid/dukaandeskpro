-- How each product is bought: carton / crate / piece (normal items). Bulk items are bought by kg (NULL here).
ALTER TABLE products ADD COLUMN buy_unit TEXT CHECK (buy_unit IS NULL OR buy_unit IN ('carton', 'crate', 'piece'));
-- 'auto' = set by the sorter; 'manual' = set in Catalog (sorter never overrides).
ALTER TABLE products ADD COLUMN buy_unit_source TEXT;
-- 1 = order line counts packages (cartons / crates); units per package are entered on receive.
ALTER TABLE purchase_order_lines ADD COLUMN by_package INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS buy_unit_runs (
  id           TEXT PRIMARY KEY,
  ran_at       TEXT NOT NULL DEFAULT (datetime('now')),
  user_id      TEXT,
  changes_json TEXT NOT NULL,
  undone_at    TEXT
);
