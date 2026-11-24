/** Reverse one migration: SQLITE_PATH=... node src/down.js 040_product_types */
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
function down(dbPath, name) {
  const file = path.join(__dirname, '..', 'migrations-down', `${name}.down.sql`);
  if (!fs.existsSync(file)) throw new Error(`no down script for ${name}`);
  const db = new Database(dbPath);
  const has = db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get(`${name}.sql`);
  if (!has) { db.close(); return { ok: true, skipped: true }; }
  db.pragma('foreign_keys = OFF');
  db.transaction(() => db.exec(fs.readFileSync(file, 'utf8')))();
  db.pragma('foreign_keys = ON');
  db.close();
  return { ok: true, skipped: false };
}
module.exports = { down };
if (require.main === module) {
  const [name] = process.argv.slice(2);
  console.log(JSON.stringify(down(process.env.SQLITE_PATH, name)));
}
