-- Reverse of 041_buy_units. Undo the buy-units run first (POST /product-types/buy-units/:id/undo) to put names, links and review back.
DROP TABLE IF EXISTS buy_unit_runs;
ALTER TABLE purchase_order_lines DROP COLUMN by_package;
ALTER TABLE products DROP COLUMN buy_unit_source;
ALTER TABLE products DROP COLUMN buy_unit;
DELETE FROM schema_migrations WHERE id = '041_buy_units.sql';
