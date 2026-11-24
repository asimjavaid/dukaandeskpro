-- Pricing: markup suggestions, printed-price (MRP) items, supplier line totals.
ALTER TABLE products ADD COLUMN fixed_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN markup_bp INTEGER;
ALTER TABLE store ADD COLUMN default_markup_bp INTEGER NOT NULL DEFAULT 3000;
ALTER TABLE store ADD COLUMN price_round_paisa INTEGER NOT NULL DEFAULT 500;
ALTER TABLE store ADD COLUMN price_round_mode TEXT NOT NULL DEFAULT 'up';
ALTER TABLE store ADD COLUMN min_margin_bp INTEGER NOT NULL DEFAULT 500;
ALTER TABLE purchase_lines ADD COLUMN line_total_paisa INTEGER;
ALTER TABLE purchase_order_lines ADD COLUMN line_total_paisa INTEGER;
