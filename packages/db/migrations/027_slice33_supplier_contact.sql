-- DukaanDesk — supplier contact person + address (additive).
-- phone stays as contact number. Nullable; create/edit optional.

ALTER TABLE suppliers ADD COLUMN contact_name TEXT;
ALTER TABLE suppliers ADD COLUMN address TEXT;
