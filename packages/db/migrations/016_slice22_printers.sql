-- DukaanDesk — saved printer names and paper.
-- The browser cannot list OS printers. Names are what the shop calls them.
-- Receipt width 58 or 80. Reports paper a4 or letter.
-- Label size is a sticker preset. label_per_row is 1–5.
-- Defaults: 80mm, A4, 50x25, 3 per row.

PRAGMA foreign_keys = ON;

ALTER TABLE store ADD COLUMN receipt_printer_name TEXT;
ALTER TABLE store ADD COLUMN receipt_width_mm INTEGER NOT NULL DEFAULT 80;
ALTER TABLE store ADD COLUMN reports_printer_name TEXT;
ALTER TABLE store ADD COLUMN reports_paper TEXT NOT NULL DEFAULT 'a4';
ALTER TABLE store ADD COLUMN label_printer_name TEXT;
ALTER TABLE store ADD COLUMN label_size TEXT NOT NULL DEFAULT '50x25';
ALTER TABLE store ADD COLUMN label_per_row INTEGER NOT NULL DEFAULT 3;
