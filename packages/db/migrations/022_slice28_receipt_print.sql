-- DukaanDesk — print receipt after each sale (owner toggle).
-- 1 = print when a receipt printer name is also set. Default on.

PRAGMA foreign_keys = ON;

ALTER TABLE store ADD COLUMN receipt_print_enabled INTEGER NOT NULL DEFAULT 1;
