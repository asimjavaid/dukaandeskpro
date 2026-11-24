-- Reverse 045: drafts and batch records go away. Stock and costs already posted stay as they are
-- (their stock_adjustments rows with reason 'opening' remain).
DROP INDEX IF EXISTS opening_stock_lines_product_idx;
DROP INDEX IF EXISTS opening_stock_lines_batch_idx;
DROP TABLE IF EXISTS opening_stock_lines;
DROP TABLE IF EXISTS opening_stock_batches;
DROP TABLE IF EXISTS opening_stock_drafts;
DELETE FROM schema_migrations WHERE id = '045_opening_stock.sql';
