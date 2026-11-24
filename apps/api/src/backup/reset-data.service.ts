import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DbService } from '../db/db.service';
import { BackupService } from './backup.service';
import { DB_COPY_EXT, PgBackupService } from './pg-backup.service';
import { BACKUP_AUDIT_ACTION } from './backup.types';
import {
  RESET_AUDIT_ACTION,
  RESET_KEEP_TABLES,
  RESET_WIPE_TABLES,
  RESET_ZERO_TABLES,
} from './reset-data';

export type ResetResult =
  | {
      ok: true;
      backup_file: string;
      backup_db_file: string;
      wiped: Record<string, number>;
      stock_rows_zeroed: number;
      kept: { products: number; users: number };
    }
  | { ok: false; error: 'backup_failed' | 'unknown_tables' | 'reset_failed' | 'not_setup'; detail?: string };

function karachiStamp(d: Date): string {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => f.find((p) => p.type === t)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')}-${g('hour').replace('24', '00')}${g('minute')}${g('second')}`;
}

@Injectable()
export class ResetDataService {
  private readonly log = new Logger('ResetData');
  private running = false;

  constructor(
    private readonly db: DbService,
    private readonly backup: BackupService,
    private readonly pgBackup: PgBackupService,
  ) {}

  /** Tables in the database that are in none of the reset lists. */
  unclassifiedTables(): string[] {
    const known = new Set<string>([...RESET_KEEP_TABLES, ...RESET_ZERO_TABLES, ...RESET_WIPE_TABLES]);
    const sql = this.db.engine === 'postgres'
      ? `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`
      : `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`;
    const rows = this.db.raw.prepare(sql).all() as Array<{ name: string }>;
    return rows.map((r) => r.name).filter((n) => !known.has(n));
  }

  /** Folder for the automatic copies made before a reset: next to the database. */
  backupDir(): string {
    const env = process.env.RESET_BACKUP_DIR;
    return env ? path.resolve(env) : path.join(path.dirname(this.db.dbPath), 'reset-backups');
  }

  reset(input: { userId: string; storeId: string }, now = new Date()): ResetResult {
    if (this.running) return { ok: false, error: 'reset_failed', detail: 'busy' };
    this.running = true;
    try {
      return this.run(input, now);
    } finally {
      this.running = false;
    }
  }

  private run(input: { userId: string; storeId: string }, now: Date): ResetResult {
    const raw = this.db.raw;
    const unknown = this.unclassifiedTables();
    if (unknown.length) return { ok: false, error: 'unknown_tables', detail: unknown.join(',') };
    const store = raw.prepare(`SELECT id FROM store LIMIT 1`).get() as { id: string } | undefined;
    if (!store) return { ok: false, error: 'not_setup' };

    // 1. Backup first: the same copy as Backup > Save a copy, plus a full database copy (.ddpro on PostgreSQL).
    const dir = this.backupDir();
    const stamp = karachiStamp(now);
    const jsonFile = path.join(dir, `dukaandesk-before-reset-${stamp}.json`);
    const dbFile = path.join(dir, `dukaandesk-before-reset-${stamp}${this.db.engine === 'postgres' ? DB_COPY_EXT : '.sqlite'}`);
    try {
      const exp = this.backup.exportForAuto(input.storeId || store.id);
      if (!exp.ok) throw new Error(exp.reason);
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${jsonFile}.part`;
      fs.writeFileSync(tmp, JSON.stringify(exp.bundle));
      fs.renameSync(tmp, jsonFile);
      if (this.db.engine === 'postgres') {
        const d = this.pgBackup.dump(dbFile);
        if (!d.ok) throw new Error(`database copy failed: ${d.detail ?? d.error}`);
      } else {
        raw.prepare(`VACUUM INTO ?`).run(dbFile);
        const st = fs.statSync(dbFile);
        if (!st.size) throw new Error('empty database copy');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn(`reset aborted, backup failed: ${msg}`);
      return { ok: false, error: 'backup_failed', detail: msg.slice(0, 200) };
    }

    // 2. Wipe in one transaction.
    const wiped: Record<string, number> = {};
    let zeroed = 0;
    try {
      raw.transaction(() => {
        raw.pragma('defer_foreign_keys = ON');
        for (const t of RESET_WIPE_TABLES) {
          wiped[t] = raw.prepare(`DELETE FROM "${t}"`).run().changes;
        }
        zeroed = raw
          .prepare(`UPDATE stock_balances SET qty_on_hand = 0, updated_at = ?`)
          .run(now.toISOString()).changes;
        const ins = raw.prepare(
          `INSERT INTO audit_log (id, action, user_id, store_id, subject_type, subject_id, payload_json)
           VALUES (?, ?, ?, ?, 'store', ?, ?)`,
        );
        // The copy made just now counts as the latest saved backup.
        ins.run(randomUUID(), BACKUP_AUDIT_ACTION, input.userId, store.id, store.id,
          JSON.stringify({ before_reset: true, file: jsonFile, saved_confirmed: true }));
        ins.run(randomUUID(), RESET_AUDIT_ACTION, input.userId, store.id, store.id,
          JSON.stringify({ backup_file: jsonFile, backup_db_file: dbFile, wiped, stock_rows_zeroed: zeroed }));
      })();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.error(`reset failed, nothing changed: ${msg}`);
      return { ok: false, error: 'reset_failed', detail: msg.slice(0, 200) };
    }
    const c = (q: string) => (raw.prepare(q).get() as { c: number }).c;
    this.log.log(`data reset by ${input.userId}; backup ${jsonFile}`);
    return {
      ok: true,
      backup_file: jsonFile,
      backup_db_file: dbFile,
      wiped,
      stock_rows_zeroed: zeroed,
      kept: { products: c(`SELECT COUNT(*) c FROM products`), users: c(`SELECT COUNT(*) c FROM users`) },
    };
  }
}
