-- Owner PIN recovery: one active code per owner, stored as a scrypt hash only.
CREATE TABLE IF NOT EXISTS owner_recovery (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  acknowledged_at TEXT
);
