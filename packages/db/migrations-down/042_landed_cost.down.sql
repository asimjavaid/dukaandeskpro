-- Reverse of 042_landed_cost. Bills keep their landed unit costs; the extras list and shares are dropped.
DROP INDEX IF EXISTS idx_purchase_extras_invoice;
DROP TABLE IF EXISTS purchase_extras;
ALTER TABLE purchase_lines DROP COLUMN extra_share_paisa;
ALTER TABLE purchase_invoices DROP COLUMN extras_owed_paisa;
ALTER TABLE purchase_invoices DROP COLUMN extras_paisa;
DELETE FROM schema_migrations WHERE id = '042_landed_cost.sql';
