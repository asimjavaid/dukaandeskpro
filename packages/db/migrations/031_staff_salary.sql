-- Staff profiles (login optional), Data entry role, salary khata.
-- staff.id equals users.id whenever the person can log in (user_id = id);
-- helpers without login have user_id NULL and no users row.
PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO roles (id, code, name) VALUES
  ('role-data-entry', 'data_entry', 'Data entry operator');

CREATE TABLE IF NOT EXISTS staff (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT UNIQUE,
  name                  TEXT NOT NULL,
  role_code             TEXT NOT NULL CHECK (role_code IN ('owner', 'cashier', 'data_entry', 'helper')),
  position              TEXT,
  phone                 TEXT,
  address               TEXT,
  monthly_salary_paisa  INTEGER CHECK (monthly_salary_paisa IS NULL OR monthly_salary_paisa >= 0),
  left_at               TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS staff_left_idx ON staff (left_at);

-- One row per existing login user (owner + cashiers), same id.
INSERT OR IGNORE INTO staff (id, user_id, name, role_code, left_at, created_at, updated_at)
  SELECT u.id, u.id, u.display_name, r.code, u.disabled_at, u.created_at, u.updated_at
  FROM users u JOIN roles r ON r.id = u.role_id
  WHERE u.pin_hash IS NOT NULL;

-- Salary khata. Salary balance (shop owes) = salary_due + bonus - payment - deduction.
-- Advance outstanding (person owes) = advance - deduction.
CREATE TABLE IF NOT EXISTS staff_ledger (
  id            TEXT PRIMARY KEY,
  staff_id      TEXT NOT NULL REFERENCES staff(id),
  entry_date    TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('salary_due', 'payment', 'advance', 'deduction', 'bonus')),
  amount_paisa  INTEGER NOT NULL CHECK (amount_paisa > 0),
  period        TEXT,
  expense_id    TEXT,
  note          TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  voided_at     TEXT
);

CREATE INDEX IF NOT EXISTS staff_ledger_staff_idx ON staff_ledger (staff_id, entry_date, created_at);
CREATE INDEX IF NOT EXISTS staff_ledger_period_idx ON staff_ledger (period, kind);

-- Salary expenses link back to the person; outside-drawer payments still count in profit.
ALTER TABLE expenses ADD COLUMN staff_id TEXT;
ALTER TABLE expenses ADD COLUMN from_drawer INTEGER NOT NULL DEFAULT 1;
