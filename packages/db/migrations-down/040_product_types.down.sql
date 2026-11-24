-- Reverse 040: undo product types schema. Data in products (barcode, price, stock, packet links) is untouched;
-- undo the sorter run first (Settings > Product types > Undo) to put links back as they were.
DROP INDEX IF EXISTS products_type_idx;
DROP TABLE IF EXISTS product_type_runs;
DROP TABLE IF EXISTS product_type_review;
ALTER TABLE store DROP COLUMN sell_bulk_loose;
ALTER TABLE repacks DROP COLUMN packing_per_pack_paisa;
ALTER TABLE products DROP COLUMN type_source;
ALTER TABLE products DROP COLUMN product_type;
DELETE FROM schema_migrations WHERE id = '040_product_types.sql';
