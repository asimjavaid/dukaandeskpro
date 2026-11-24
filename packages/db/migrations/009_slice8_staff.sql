-- DukaanDesk Slice 8 — Owner Staff (cashiers).
-- users.disabled_at + roles owner|cashier already in 001.
-- Soft-disable sets disabled_at; PIN login rejects disabled users.
-- No new tables; index helps staff list / active filters.

PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS users_disabled_idx ON users (disabled_at);
