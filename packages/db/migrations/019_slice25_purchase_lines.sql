-- DukaanDesk — purchase line mode.
-- loose: pieces is the quantity in the product unit. line_amount is that line's total.
-- carton: cartons × units_per_carton is the stock added. line_amount is carton cost × cartons.
-- Supplier due stays on the invoice (total − paid). These columns do not change it.

PRAGMA foreign_keys = ON;

ALTER TABLE purchase_lines ADD COLUMN mode TEXT NOT NULL DEFAULT 'loose'
  CHECK (mode IN ('loose', 'carton'));
ALTER TABLE purchase_lines ADD COLUMN cartons INTEGER;
ALTER TABLE purchase_lines ADD COLUMN units_per_carton INTEGER;
