-- Product pictures. image_file is a file name inside <db dir>/product-images/
-- (e.g. "<product id>-<rand>.jpg"). NULL = no picture (letter badge shown).
ALTER TABLE products ADD COLUMN image_file TEXT;
