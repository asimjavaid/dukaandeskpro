-- Product types: normal (pieces), bulk (kg, bought in bags), packed (repacked from bulk).
ALTER TABLE products ADD COLUMN product_type TEXT NOT NULL DEFAULT 'normal' CHECK (product_type IN ('normal', 'bulk', 'packed'));
-- 'auto' = set by the type sorter; 'manual' = set by a person (sorter never overrides).
ALTER TABLE products ADD COLUMN type_source TEXT;
ALTER TABLE repacks ADD COLUMN packing_per_pack_paisa INTEGER;
ALTER TABLE store ADD COLUMN sell_bulk_loose INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS product_type_review (
  product_id      TEXT PRIMARY KEY REFERENCES products(id),
  reason          TEXT NOT NULL,
  kg              REAL,
  candidates_json TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at     TEXT,
  resolved_by     TEXT
);

CREATE TABLE IF NOT EXISTS product_type_runs (
  id           TEXT PRIMARY KEY,
  ran_at       TEXT NOT NULL DEFAULT (datetime('now')),
  user_id      TEXT,
  changes_json TEXT NOT NULL,
  undone_at    TEXT
);
CREATE INDEX IF NOT EXISTS products_type_idx ON products (product_type, active);
