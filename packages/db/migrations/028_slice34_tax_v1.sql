-- DukaanDesk — Tax V1 (D30 LOCK, Asim 2026-10-06). Simple Sales Tax, NO FBR.
-- R1: Sales Tax OFF by default (fresh + upgraded installs). Never UPDATE this
--     column from a migration — the Owner flips it in Settings → Store.
-- R2: when ON, tax is extracted from the shelf/MRP price (inclusive). The
--     customer total never changes. One global store rate (basis points,
--     17% = 1700 — same convention as product discounts).
-- Snapshot on every sale so receipts / reports never read the live setting.
-- Historic sales stay OFF / 0. Historic tax_documents rows are untouched.

PRAGMA foreign_keys = ON;

ALTER TABLE store ADD COLUMN sales_tax_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (sales_tax_enabled IN (0, 1));
ALTER TABLE store ADD COLUMN sales_tax_rate_bp INTEGER NOT NULL DEFAULT 0
  CHECK (sales_tax_rate_bp BETWEEN 0 AND 10000);

-- Sale-level snapshot. tax_base_paisa NULL when tax was OFF for the sale.
-- Invariant when ON: tax_base_paisa + tax_paisa = total_paisa.
ALTER TABLE sales ADD COLUMN tax_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (tax_enabled IN (0, 1));
ALTER TABLE sales ADD COLUMN tax_rate_bp INTEGER NOT NULL DEFAULT 0
  CHECK (tax_rate_bp BETWEEN 0 AND 10000);
ALTER TABLE sales ADD COLUMN tax_paisa INTEGER NOT NULL DEFAULT 0
  CHECK (tax_paisa >= 0);
ALTER TABLE sales ADD COLUMN tax_base_paisa INTEGER;

-- Per-line extraction (half-up to the paisa on the line total).
ALTER TABLE sale_lines ADD COLUMN tax_rate_bp INTEGER NOT NULL DEFAULT 0
  CHECK (tax_rate_bp BETWEEN 0 AND 10000);
ALTER TABLE sale_lines ADD COLUMN tax_paisa INTEGER NOT NULL DEFAULT 0
  CHECK (tax_paisa >= 0);
