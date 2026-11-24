-- 045: Opening stock. A server-side draft (one row per product, saved as you type),
-- posted batches and their lines. Posting writes stock_adjustments with reason 'opening'.
CREATE TABLE IF NOT EXISTS opening_stock_drafts (
  product_id   TEXT PRIMARY KEY REFERENCES products(id),
  mode         TEXT NOT NULL DEFAULT 'base' CHECK (mode IN ('base', 'pack')),
  qty          REAL CHECK (qty IS NULL OR qty >= 0),
  packs        INTEGER CHECK (packs IS NULL OR packs >= 0),
  pack_units   INTEGER CHECK (pack_units IS NULL OR pack_units > 0),
  pack_name    TEXT,
  cost_paisa   INTEGER CHECK (cost_paisa IS NULL OR cost_paisa >= 0),
  updated_by   TEXT REFERENCES users(id),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS opening_stock_batches (
  id                TEXT PRIMARY KEY,
  number            INTEGER NOT NULL,
  posted_by         TEXT REFERENCES users(id),
  posted_at         TEXT NOT NULL DEFAULT (datetime('now')),
  item_count        INTEGER NOT NULL DEFAULT 0,
  total_value_paisa INTEGER NOT NULL DEFAULT 0,
  undone_at         TEXT,
  undone_by         TEXT REFERENCES users(id),
  -- max rowid of sales / purchases / stock tables at post time: anything newer blocks undo
  marks_json        TEXT
);

CREATE TABLE IF NOT EXISTS opening_stock_lines (
  id               TEXT PRIMARY KEY,
  batch_id         TEXT NOT NULL REFERENCES opening_stock_batches(id),
  product_id       TEXT NOT NULL REFERENCES products(id),
  product_name     TEXT NOT NULL,
  unit_label       TEXT NOT NULL,
  mode             TEXT NOT NULL DEFAULT 'base',
  packs            INTEGER,
  pack_units       INTEGER,
  pack_name        TEXT,
  qty              REAL NOT NULL,
  cost_paisa       INTEGER,
  value_paisa      INTEGER NOT NULL DEFAULT 0,
  added            INTEGER NOT NULL DEFAULT 0, -- 1: item already had sales/purchases, qty was added
  qty_before       REAL NOT NULL DEFAULT 0,
  qty_after        REAL NOT NULL DEFAULT 0,
  cost_before      INTEGER,
  cost_after       INTEGER,
  adjustment_id    TEXT,
  sort             INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS opening_stock_lines_batch_idx ON opening_stock_lines (batch_id, sort);
CREATE INDEX IF NOT EXISTS opening_stock_lines_product_idx ON opening_stock_lines (product_id);
