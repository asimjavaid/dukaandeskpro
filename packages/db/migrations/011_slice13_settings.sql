-- DukaanDesk Slice 13 — Settings shell: store phone + receipt footer.
-- locale_default / name / address already on store (001). Keep schema_version=1
-- for backup: new columns are optional; restore tolerates missing fields.

PRAGMA foreign_keys = ON;

ALTER TABLE store ADD COLUMN phone TEXT;
ALTER TABLE store ADD COLUMN receipt_footer TEXT;
