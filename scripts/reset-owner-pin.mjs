#!/usr/bin/env node
/**
 * Emergency Owner PIN reset. Stop the API first. Node 20.
 *   node scripts/reset-owner-pin.mjs --db apps/api/data/dukaandesk.sqlite --pin 1234
 * Sets the owner PIN and prints a new recovery code (stored as a hash).
 */
import { createRequire } from 'node:module';
import { randomBytes, randomInt, scryptSync } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../apps/api/package.json'));
const Database = require('better-sqlite3');

const args = process.argv.slice(2);
const arg = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const dbPath = arg('db') ?? path.join(here, '../apps/api/data/dukaandesk.sqlite');
const pin = arg('pin');
const fail = (m) => {
  console.error(`Error: ${m}`);
  process.exit(1);
};
if (!pin || !/^[0-9]{4,6}$/.test(pin)) fail('--pin must be 4 to 6 digits');
if (!existsSync(dbPath)) fail(`database not found: ${dbPath}`);

const hash = (s) => {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(s, salt, 64).toString('hex')}`;
};
const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
let raw = '';
for (let i = 0; i < 12; i++) raw += A[randomInt(A.length)];
const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;

const db = new Database(dbPath, { timeout: 2000 });
try {
  db.pragma('journal_mode');
  const owner = db
    .prepare(
      `SELECT u.id, u.display_name FROM users u JOIN roles r ON r.id = u.role_id
       WHERE r.code = 'owner' ORDER BY u.disabled_at IS NOT NULL, u.created_at LIMIT 1`,
    )
    .get();
  if (!owner) fail('no owner account in this database');
  const hasTable = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='owner_recovery'`)
    .get();
  if (!hasTable) fail('database is older than migration 032; start the API once, stop it, then rerun');
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`UPDATE users SET pin_hash = ?, disabled_at = NULL, updated_at = ? WHERE id = ?`).run(hash(pin), now, owner.id);
    db.prepare(
      `INSERT INTO owner_recovery (user_id, code_hash, created_at, acknowledged_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash, created_at = excluded.created_at,
         acknowledged_at = excluded.acknowledged_at`,
    ).run(owner.id, hash(raw), now, now);
    // Clear the PIN / recovery lockouts (persistent since migration 034).
    const throttle = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='auth_throttle'`).get();
    if (throttle) {
      db.prepare(`DELETE FROM auth_throttle WHERE key IN ('recovery', ?, ?)`).run(`login:${owner.id}`, `pincheck:${owner.id}`);
    }
  })();
  console.log(`Owner PIN reset for: ${owner.display_name}`);
  console.log(`New recovery code:   ${code}`);
  console.log('Write this code down. It will not be shown again.');
} finally {
  db.close();
}
