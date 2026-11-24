-- DukaanDesk S-SC1 — stock count sessions + lines + adjustments ledger.
-- Absolute counted qty posts to stock_balances. Do NOT reuse stock_receives.
-- One draft session per store (partial unique index).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS stock_count_sessions (
  id            TEXT PRIMARY KEY,
  store_id      TEXT NOT NULL REFERENCES store(id),
  status        TEXT NOT NULL CHECK (status IN ('draft', 'posted', 'cancelled')),
  source        TEXT NOT NULL CHECK (source IN ('full_screen', 'catalog_quick')),
  started_by    TEXT NOT NULL REFERENCES users(id),
  posted_by     TEXT REFERENCES users(id),
  note          TEXT,
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  posted_at     TEXT,
  cancelled_at  TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS stock_count_one_draft_per_store
  ON stock_count_sessions (store_id) WHERE status = 'draft';

CREATE INDEX IF NOT EXISTS stock_count_sessions_store_idx
  ON stock_count_sessions (store_id, started_at DESC);

CREATE TABLE IF NOT EXISTS stock_count_lines (
  id                    TEXT PRIMARY KEY,
  session_id            TEXT NOT NULL REFERENCES stock_count_sessions(id),
  product_id            TEXT NOT NULL REFERENCES products(id),
  system_qty_snapshot   INTEGER NOT NULL,
  counted_qty           INTEGER CHECK (counted_qty IS NULL OR counted_qty >= 0),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_id, product_id)
);

CREATE INDEX IF NOT EXISTS stock_count_lines_session_idx
  ON stock_count_lines (session_id);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES products(id),
  session_id    TEXT REFERENCES stock_count_sessions(id),
  line_id       TEXT REFERENCES stock_count_lines(id),
  delta_pieces  INTEGER NOT NULL,
  qty_before    INTEGER NOT NULL,
  qty_after     INTEGER NOT NULL,
  reason        TEXT NOT NULL DEFAULT 'stock_count',
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  note          TEXT,
  CHECK (delta_pieces != 0),
  CHECK (qty_after >= 0)
);

CREATE INDEX IF NOT EXISTS stock_adjustments_product_idx
  ON stock_adjustments (product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS stock_adjustments_session_idx
  ON stock_adjustments (session_id);
