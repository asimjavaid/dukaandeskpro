-- Linked sizes: separate products (own stock) sharing a size group; size_qty = how many base units one of this size holds.
ALTER TABLE products ADD COLUMN size_group_id TEXT;
ALTER TABLE products ADD COLUMN size_qty REAL CHECK (size_qty IS NULL OR size_qty > 0);
CREATE INDEX IF NOT EXISTS products_size_group_idx ON products (size_group_id);
