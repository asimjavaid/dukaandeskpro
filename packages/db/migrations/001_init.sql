-- DukaanDesk — local SQLite SoR
-- Pure offline retail POS. No cloud sync tables. No Hybrid/Wholesale modes.
-- Tax: queue/simulate seam only — no invented FBR fields or accept codes.
-- Payments: cash + udhaar only (D24).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id         TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Single-store local install (no multi-tenant cloud org)
-- Row created by Owner first-run setup (Slice 1)
CREATE TABLE IF NOT EXISTS store (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  address         TEXT,
  locale_default  TEXT NOT NULL DEFAULT 'en',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Roles: Owner / Cashier minimum (DukaanDesk P1)
CREATE TABLE IF NOT EXISTS roles (
  id    TEXT PRIMARY KEY,
  code  TEXT NOT NULL UNIQUE, -- owner | cashier
  name  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  role_id      TEXT NOT NULL REFERENCES roles(id),
  display_name TEXT NOT NULL,
  pin_hash     TEXT,
  disabled_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS users_role_idx ON users (role_id);

-- Catalog (Slice 1 stub: name, price, unit piece|carton)
CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,
  sku         TEXT,
  name        TEXT NOT NULL,
  name_ur     TEXT,
  unit_label  TEXT NOT NULL DEFAULT 'piece',
  price_paisa INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS products_active_idx ON products (active, name);

-- Tax document queue (simulate path). No FBR credential / accept-code columns.
CREATE TABLE IF NOT EXISTS tax_documents (
  id              TEXT PRIMARY KEY,
  sale_id         TEXT,
  status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN (
                      'queued',
                      'submitting',
                      'simulated_ok',
                      'simulated_reject',
                      'authority_down'
                    )),
  payload_json    TEXT NOT NULL DEFAULT '{}',
  external_ref    TEXT,
  raw_detail      TEXT,
  client_device_at TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS tax_documents_status_idx
  ON tax_documents (status, created_at DESC);

-- Seed roles only (idempotent). Owner + store created at first-run setup.
INSERT OR IGNORE INTO roles (id, code, name) VALUES
  ('role-owner', 'owner', 'Owner'),
  ('role-cashier', 'cashier', 'Cashier');
