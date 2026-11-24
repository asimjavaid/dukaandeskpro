-- DukaanDesk — one barcode per product.
-- Manufacturer codes are stored as scanned (trimmed).
-- Empty codes are filled on API startup with a unique EAN-13
-- in the GS1 in-store range (prefix 20) plus a check digit.
-- barcode_seq.next_n is the next monotonic counter for those codes.

PRAGMA foreign_keys = ON;

ALTER TABLE products ADD COLUMN barcode TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_uq ON products (barcode);

CREATE TABLE IF NOT EXISTS barcode_seq (
  id     INTEGER PRIMARY KEY CHECK (id = 1),
  next_n INTEGER NOT NULL
);

INSERT INTO barcode_seq (id, next_n)
SELECT 1, 1
WHERE NOT EXISTS (SELECT 1 FROM barcode_seq WHERE id = 1);
