-- DukaanDesk — product measure label. Not a second sell mode.
-- Sell still adds one of this unit at a time (no carton at the till).
-- Allowed labels: piece, packet, kg, gram, litre, ml.
-- Blank or unknown labels become piece. Known labels stay.

PRAGMA foreign_keys = ON;

UPDATE products
SET unit_label = 'piece'
WHERE unit_label IS NULL
   OR TRIM(unit_label) = ''
   OR unit_label NOT IN ('piece', 'packet', 'kg', 'gram', 'litre', 'ml');
