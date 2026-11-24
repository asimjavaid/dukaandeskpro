-- Till shifts (opening float, cash in/out, close with counted cash) and
-- automatic daily backup settings. Quantities for kg/litre may now be decimals
-- (stored as REAL values in the existing columns; no column change needed).
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS till_shifts (
  id                   TEXT PRIMARY KEY,
  opened_at            TEXT NOT NULL,
  opened_by            TEXT REFERENCES users(id),
  opening_float_paisa  INTEGER NOT NULL DEFAULT 0 CHECK (opening_float_paisa >= 0),
  closed_at            TEXT,
  closed_by            TEXT REFERENCES users(id),
  expected_paisa       INTEGER,
  counted_paisa        INTEGER,
  over_short_paisa     INTEGER,
  summary_json         TEXT,
  note                 TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_till_one_open ON till_shifts ((1)) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_till_shifts_opened ON till_shifts (opened_at DESC);

CREATE TABLE IF NOT EXISTS till_moves (
  id            TEXT PRIMARY KEY,
  shift_id      TEXT NOT NULL REFERENCES till_shifts(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('in', 'out')),
  amount_paisa  INTEGER NOT NULL CHECK (amount_paisa > 0),
  reason        TEXT,
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_till_moves_shift ON till_moves (shift_id, created_at);

CREATE TABLE IF NOT EXISTS auto_backup (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  enabled      INTEGER NOT NULL DEFAULT 0,
  folder       TEXT,
  keep_count   INTEGER NOT NULL DEFAULT 14 CHECK (keep_count BETWEEN 1 AND 365),
  last_at      TEXT,
  last_file    TEXT,
  last_error   TEXT,
  last_error_at TEXT
);
INSERT OR IGNORE INTO auto_backup (id) VALUES (1);
