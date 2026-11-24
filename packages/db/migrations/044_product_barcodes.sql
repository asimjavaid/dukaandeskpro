-- Extra barcodes per product (maker codes next to the in-store one). A code belongs to one product only:
-- never two products, never both a primary and an extra.
CREATE TABLE IF NOT EXISTS product_barcodes (
  barcode     TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL REFERENCES products(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS product_barcodes_product_idx ON product_barcodes (product_id);

CREATE TRIGGER IF NOT EXISTS product_barcodes_no_primary_ins BEFORE INSERT ON product_barcodes
WHEN EXISTS (SELECT 1 FROM products WHERE barcode = NEW.barcode)
BEGIN SELECT RAISE(ABORT, 'duplicate_barcode'); END;

CREATE TRIGGER IF NOT EXISTS product_barcodes_no_primary_upd BEFORE UPDATE OF barcode ON product_barcodes
WHEN EXISTS (SELECT 1 FROM products WHERE barcode = NEW.barcode)
BEGIN SELECT RAISE(ABORT, 'duplicate_barcode'); END;

CREATE TRIGGER IF NOT EXISTS products_barcode_no_extra_ins BEFORE INSERT ON products
WHEN NEW.barcode IS NOT NULL AND EXISTS (SELECT 1 FROM product_barcodes WHERE barcode = NEW.barcode)
BEGIN SELECT RAISE(ABORT, 'duplicate_barcode'); END;

CREATE TRIGGER IF NOT EXISTS products_barcode_no_extra_upd BEFORE UPDATE OF barcode ON products
WHEN NEW.barcode IS NOT NULL AND EXISTS (SELECT 1 FROM product_barcodes WHERE barcode = NEW.barcode)
BEGIN SELECT RAISE(ABORT, 'duplicate_barcode'); END;
