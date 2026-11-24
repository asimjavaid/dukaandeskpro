import type Database from 'better-sqlite3';

/** One stable row. Not created again on later purchases. */
export const NO_SUPPLIER_ID = 'system-no-supplier';

export function ensureNoSupplier(db: Database.Database): void {
  db.prepare(
    `INSERT OR IGNORE INTO suppliers (id, name, phone, active)
     VALUES (?, 'No supplier', NULL, 1)`,
  ).run(NO_SUPPLIER_ID);
}
