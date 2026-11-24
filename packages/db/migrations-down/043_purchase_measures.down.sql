-- Reverse 043: drop purchase measures. buy_unit (carton / crate / piece) was never changed, so buying works as before.
ALTER TABLE purchase_order_lines DROP COLUMN unit;
ALTER TABLE purchase_lines DROP COLUMN unit;
ALTER TABLE products DROP COLUMN buy_measure;
DELETE FROM schema_migrations WHERE id = '043_purchase_measures.sql';
