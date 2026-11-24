-- DukaanDesk Slice 6 — local backup export audit.
-- Export is Owner + PIN only. No restore-from-file this slice. No cloud backup.
-- Audit action: backup.export

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS audit_log (
  id            TEXT PRIMARY KEY,
  action        TEXT NOT NULL,
  user_id       TEXT REFERENCES users(id),
  store_id      TEXT REFERENCES store(id),
  subject_type  TEXT,
  subject_id    TEXT,
  payload_json  TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS audit_log_action_idx
  ON audit_log (action, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_store_idx
  ON audit_log (store_id, created_at DESC);
