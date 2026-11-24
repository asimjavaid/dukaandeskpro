-- DukaanDesk Slice 1 — first-run Owner + scrypt PIN; clear Slice 0 demo stubs.
-- Roles owner/cashier already seeded in 001. Cashier role ready; no staff UI yet.
-- Catalog units: piece | carton (app-enforced).

PRAGMA foreign_keys = ON;

-- Remove demo users with unset PIN (placeholders from Slice 0)
DELETE FROM users WHERE pin_hash IS NULL;

-- Fresh install: no store until Owner setup creates one local store
DELETE FROM store;

-- Prefer piece as unit label default going forward (new rows)
-- Existing products (if any) left unchanged.
