-- DukaanDesk Batch 2: digital payments, bill discount + rounding, pack units,
-- credit limits, price history, expiry dates, supplier returns, return undo,
-- reorder levels, session revocation, persistent PIN throttle.

-- Sales: cash_amount_paisa stays "paid now"; digital_paisa is the JazzCash /
-- Easypaisa / bank part of it (real drawer cash = cash_amount − digital).
ALTER TABLE sales ADD COLUMN digital_paisa INTEGER NOT NULL DEFAULT 0 CHECK (digital_paisa >= 0);
ALTER TABLE sales ADD COLUMN digital_method TEXT CHECK (digital_method IS NULL OR digital_method IN ('jazzcash', 'easypaisa', 'bank'));
ALTER TABLE sales ADD COLUMN digital_ref TEXT;
-- Σ line totals before the bill discount and rounding (NULL on older bills = total).
ALTER TABLE sales ADD COLUMN subtotal_paisa INTEGER;
ALTER TABLE sales ADD COLUMN discount_paisa INTEGER NOT NULL DEFAULT 0 CHECK (discount_paisa >= 0);
ALTER TABLE sales ADD COLUMN discount_label TEXT;
ALTER TABLE sales ADD COLUMN rounding_paisa INTEGER NOT NULL DEFAULT 0;

-- Pack sold at the till (dozen / carton): qty_pieces holds pieces, these keep what was typed.
ALTER TABLE sale_lines ADD COLUMN pack_label TEXT;
ALTER TABLE sale_lines ADD COLUMN pack_qty REAL;
ALTER TABLE sale_lines ADD COLUMN pack_size INTEGER;

ALTER TABLE store ADD COLUMN round_to_paisa INTEGER NOT NULL DEFAULT 0 CHECK (round_to_paisa IN (0, 100, 500, 1000));
ALTER TABLE store ADD COLUMN cashier_discount_max_bp INTEGER NOT NULL DEFAULT 0 CHECK (cashier_discount_max_bp BETWEEN 0 AND 10000);
ALTER TABLE store ADD COLUMN credit_limit_mode TEXT NOT NULL DEFAULT 'warn' CHECK (credit_limit_mode IN ('warn', 'block'));
ALTER TABLE store ADD COLUMN drawer_kick INTEGER NOT NULL DEFAULT 0 CHECK (drawer_kick IN (0, 1));
ALTER TABLE store ADD COLUMN expiry_alert_days INTEGER NOT NULL DEFAULT 30 CHECK (expiry_alert_days BETWEEN 1 AND 365);

ALTER TABLE parties ADD COLUMN credit_limit_paisa INTEGER CHECK (credit_limit_paisa IS NULL OR credit_limit_paisa >= 0);

ALTER TABLE products ADD COLUMN reorder_level REAL CHECK (reorder_level IS NULL OR reorder_level >= 0);

CREATE TABLE IF NOT EXISTS price_history (
  id               TEXT PRIMARY KEY,
  product_id       TEXT NOT NULL REFERENCES products(id),
  old_price_paisa  INTEGER NOT NULL,
  new_price_paisa  INTEGER NOT NULL,
  changed_by       TEXT REFERENCES users(id),
  changed_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS price_history_product_idx ON price_history (product_id, changed_at DESC);

ALTER TABLE purchase_lines ADD COLUMN expiry_date TEXT;
ALTER TABLE purchase_lines ADD COLUMN batch_no TEXT;
-- Pieces of this batch still on the shelf (FIFO by expiry on sale / write-off).
ALTER TABLE purchase_lines ADD COLUMN batch_left REAL;
CREATE INDEX IF NOT EXISTS purchase_lines_expiry_idx ON purchase_lines (expiry_date) WHERE expiry_date IS NOT NULL;

CREATE TABLE IF NOT EXISTS supplier_returns (
  id           TEXT PRIMARY KEY,
  short_id     TEXT NOT NULL,
  supplier_id  TEXT NOT NULL REFERENCES suppliers(id),
  total_paisa  INTEGER NOT NULL CHECK (total_paisa > 0),
  note         TEXT,
  returned_on  TEXT NOT NULL,
  created_by   TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS supplier_returns_supplier_idx ON supplier_returns (supplier_id, created_at DESC);

CREATE TABLE IF NOT EXISTS supplier_return_lines (
  id               TEXT PRIMARY KEY,
  return_id        TEXT NOT NULL REFERENCES supplier_returns(id) ON DELETE CASCADE,
  product_id       TEXT NOT NULL REFERENCES products(id),
  product_name     TEXT NOT NULL,
  qty              REAL NOT NULL CHECK (qty > 0),
  unit_cost_paisa  INTEGER NOT NULL CHECK (unit_cost_paisa >= 0),
  line_total_paisa INTEGER NOT NULL CHECK (line_total_paisa >= 0)
);


-- Sessions signed before this (unix ms) are refused.
ALTER TABLE users ADD COLUMN sessions_valid_after INTEGER;
CREATE TRIGGER IF NOT EXISTS users_revoke_sessions
AFTER UPDATE OF pin_hash, disabled_at ON users
WHEN NEW.pin_hash IS NOT OLD.pin_hash OR NEW.disabled_at IS NOT OLD.disabled_at
BEGIN
  UPDATE users SET sessions_valid_after = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) WHERE id = NEW.id;
END;

CREATE TABLE IF NOT EXISTS auth_throttle (
  key              TEXT PRIMARY KEY,
  fail_count       INTEGER NOT NULL DEFAULT 0,
  window_start_ms  INTEGER NOT NULL
);

-- Every selling-price change, from any screen or import. changed_by is filled in by the API.
CREATE TRIGGER IF NOT EXISTS products_price_history
AFTER UPDATE OF price_paisa ON products
WHEN NEW.price_paisa IS NOT OLD.price_paisa
BEGIN
  INSERT INTO price_history (id, product_id, old_price_paisa, new_price_paisa, changed_by, changed_at)
  VALUES (lower(hex(randomblob(16))), NEW.id, OLD.price_paisa, NEW.price_paisa, NULL,
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
END;
