-- Reverse 044: extra barcodes go away (primary barcodes were never changed by it).
DROP TRIGGER IF EXISTS products_barcode_no_extra_upd;
DROP TRIGGER IF EXISTS products_barcode_no_extra_ins;
DROP TRIGGER IF EXISTS product_barcodes_no_primary_upd;
DROP TRIGGER IF EXISTS product_barcodes_no_primary_ins;
DROP INDEX IF EXISTS product_barcodes_product_idx;
DROP TABLE IF EXISTS product_barcodes;
DELETE FROM schema_migrations WHERE id = '044_product_barcodes.sql';
