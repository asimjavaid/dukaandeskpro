-- DukaanDesk — optional customer address on parties.
-- Create/edit may store a street/area note; nullable; no UI wording "parties".

ALTER TABLE parties ADD COLUMN address TEXT;
