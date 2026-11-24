import type BetterSqlite3 from 'better-sqlite3';
type Database = BetterSqlite3.Database;

/** Persistent failure throttle (survives restarts): MAX fails per WINDOW per key. */
export const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
export const THROTTLE_MAX_FAILS = 5;

type Row = { fail_count: number; window_start_ms: number };

/** Seconds to wait before another try (0 = allowed). */
export function throttleWait(db: Database, key: string, now = Date.now()): number {
  const r = db.prepare(`SELECT fail_count, window_start_ms FROM auth_throttle WHERE key = ?`).get(key) as Row | undefined;
  if (!r) return 0;
  if (now - r.window_start_ms >= THROTTLE_WINDOW_MS) return 0;
  if (r.fail_count < THROTTLE_MAX_FAILS) return 0;
  return Math.max(1, Math.ceil((r.window_start_ms + THROTTLE_WINDOW_MS - now) / 1000));
}

export function throttleFail(db: Database, key: string, now = Date.now()): void {
  const r = db.prepare(`SELECT fail_count, window_start_ms FROM auth_throttle WHERE key = ?`).get(key) as Row | undefined;
  if (!r || now - r.window_start_ms >= THROTTLE_WINDOW_MS) {
    db.prepare(
      `INSERT INTO auth_throttle (key, fail_count, window_start_ms) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET fail_count = 1, window_start_ms = excluded.window_start_ms`,
    ).run(key, now);
  } else {
    db.prepare(`UPDATE auth_throttle SET fail_count = fail_count + 1 WHERE key = ?`).run(key);
  }
}

export function throttleClear(db: Database, key: string): void {
  db.prepare(`DELETE FROM auth_throttle WHERE key = ?`).run(key);
}
