/**
 * Apply SQL migrations from packages/db/migrations to a SQLite file.
 * Usage: SQLITE_PATH=... node src/migrate.js
 * Or: require('./migrate').migrate(dbPath)
 */
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

function resolveDbPath(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.SQLITE_PATH) return path.resolve(process.env.SQLITE_PATH);
  // Default for CLI / Nest without Electron
  return path.resolve(
    __dirname,
    '../../../apps/api/data/dukaandesk.sqlite',
  );
}

function listMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function migrate(dbPath) {
  if (require('./pg').isPgMode()) return require('./pg').migratePg(resolveDbPath(dbPath));
  const resolved = resolveDbPath(dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id),
  );

  const files = listMigrations();
  const ran = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    // FK off outside the txn so rebuilds (DROP/RENAME sales) can run.
    // SQLite ignores foreign_keys pragma changes inside an open transaction.
    db.pragma('foreign_keys = OFF');
    try {
      const tx = db.transaction(() => {
        db.exec(sql);
        db.prepare(
          'INSERT INTO schema_migrations (id) VALUES (?)',
        ).run(file);
      });
      tx();
    } finally {
      db.pragma('foreign_keys = ON');
    }
    ran.push(file);
  }

  db.close();
  return { dbPath: resolved, applied: ran, skipped: files.filter((f) => applied.has(f)) };
}

if (require.main === module) {
  const result = migrate(process.argv[2]);
  console.log(
    JSON.stringify({ ok: true, ...result }, null, 2),
  );
}

module.exports = { migrate, resolveDbPath, MIGRATIONS_DIR };
