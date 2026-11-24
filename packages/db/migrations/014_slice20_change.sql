-- DukaanDesk — cash handed over and change to return.
-- cash_amount_paisa stays the amount kept against the bill (sum with udhaar = total).
-- tendered_paisa is the cash the customer handed over. change_paisa is the return.
-- Pure udhaar stays tendered 0 / change 0. Existing rows: exact tender, no change.

PRAGMA foreign_keys = ON;

ALTER TABLE sales ADD COLUMN tendered_paisa INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN change_paisa INTEGER NOT NULL DEFAULT 0;

UPDATE sales
SET tendered_paisa = cash_amount_paisa,
    change_paisa = 0
WHERE tendered_paisa = 0
  AND change_paisa = 0
  AND cash_amount_paisa > 0;
