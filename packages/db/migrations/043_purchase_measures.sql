-- Purchase measures: kg, gram, litre, piece, packet, bottle, tin, can, dozen, carton, crate, box, bag, pack.
-- Product "bought by" moves to buy_measure (buy_unit stays as it was). Lines keep the measure they were bought in.
ALTER TABLE products ADD COLUMN buy_measure TEXT;
ALTER TABLE purchase_lines ADD COLUMN unit TEXT;
ALTER TABLE purchase_order_lines ADD COLUMN unit TEXT;
-- Map the old setting (repeatable: only rows not set yet). Loose (bulk) items buy by kg.
UPDATE products SET buy_measure = 'kg' WHERE buy_measure IS NULL AND product_type = 'bulk';
UPDATE products SET buy_measure = buy_unit WHERE buy_measure IS NULL AND buy_unit IN ('carton', 'crate', 'piece');
