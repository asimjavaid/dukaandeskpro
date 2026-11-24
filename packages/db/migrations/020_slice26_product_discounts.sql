-- DukaanDesk — optional product discount on the piece price.
-- price_paisa stays the normal selling price. The discount is an overlay.
--
-- discount_kind:   NULL = no discount, 'percent' or 'fixed'.
-- discount_value:  percent → basis points (12.5% = 1250, 0–10000);
--                  fixed   → paisa off one unit (0 to price_paisa when saved).
-- discount_start_at / discount_end_at: UTC ISO-8601 text or NULL.
--   Active when (start IS NULL OR now >= start) AND (end IS NULL OR now < end).
--   Start is inclusive, end is exclusive. Both NULL = on until cleared.
-- The till price never goes below 0. Sale lines keep the price actually charged.

PRAGMA foreign_keys = ON;

ALTER TABLE products ADD COLUMN discount_kind TEXT
  CHECK (discount_kind IS NULL OR discount_kind IN ('percent', 'fixed'));
ALTER TABLE products ADD COLUMN discount_value INTEGER
  CHECK (discount_value IS NULL OR discount_value >= 0);
ALTER TABLE products ADD COLUMN discount_start_at TEXT;
ALTER TABLE products ADD COLUMN discount_end_at TEXT;
