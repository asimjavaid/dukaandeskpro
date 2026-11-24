import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DbService } from '../db/db.service';
import { BackupService } from './backup.service';
import { DB_COPY_EXT, PgBackupService } from './pg-backup.service';

export type AutoBackupStatus = {
  enabled: boolean;
  folder: string | null;
  keep_count: number;
  last_at: string | null;
  last_file: string | null;
  last_error: string | null;
  last_error_at: string | null;
  files: Array<{ name: string; size: number; modified_at: string }>;
};

const FILE_RE = /^dukaandesk-auto-\d{4}-\d{2}-\d{2}-\d{4}\.(json|ddpro)$/;

function karachiParts(d: Date) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => f.find((p) => p.type === t)?.value ?? '00';
  return { ymd: `${g('year')}-${g('month')}-${g('day')}`, hm: `${g('hour').replace('24', '00')}${g('minute')}` };
}

/**
 * Daily automatic copy to a folder (USB stick, second drive, synced folder).
 * Runs shortly after start and then checks every hour; one copy per Karachi
 * day. Keeps the newest `keep_count` auto copies in that folder.
 */
@Injectable()
export class AutoBackupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('AutoBackup');
  private timer: NodeJS.Timeout | null = null;
  private startTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: DbService,
    private readonly backup: BackupService,
    private readonly pgBackup: PgBackupService,
  ) {}

  /**
   * Lite main PC: daily full copies are on by default. When the desktop app passes DD_BACKUP_DIR and the owner
   * has never configured automatic copies, switch them on there (keep 14).
   */
  private applyDefaults() {
    if (!this.pgBackup.enabled || !process.env.DD_BACKUP_DIR) return;
    const r = this.row();
    if (!r || r.folder || r.enabled || r.last_at) return;
    try {
      const dir = this.pgBackup.defaultDir();
      fs.mkdirSync(dir, { recursive: true });
      this.db.raw.prepare(`UPDATE auto_backup SET enabled = 1, folder = ?, keep_count = 14 WHERE id = 1`).run(dir);
      this.log.log(`automatic daily copies on: ${dir} (keep 14)`);
    } catch (e) {
      this.log.warn(`could not set default backup folder: ${e instanceof Error ? e.message : e}`);
    }
  }

  onApplicationBootstrap() {
    this.applyDefaults();
    const every = Number(process.env.AUTO_BACKUP_INTERVAL_MS ?? 60 * 60 * 1000);
    if (!Number.isFinite(every) || every <= 0) return;
    const firstDelay = Number(process.env.AUTO_BACKUP_START_DELAY_MS ?? 15_000);
    this.startTimer = setTimeout(() => void this.tick(), Math.max(0, firstDelay));
    this.timer = setInterval(() => void this.tick(), every);
    this.timer.unref?.();
    this.startTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.startTimer) clearTimeout(this.startTimer);
  }

  private row() {
    return this.db.raw.prepare(`SELECT * FROM auto_backup WHERE id = 1`).get() as
      | {
          enabled: number;
          folder: string | null;
          keep_count: number;
          last_at: string | null;
          last_file: string | null;
          last_error: string | null;
          last_error_at: string | null;
        }
      | undefined;
  }

  private listFiles(folder: string | null): AutoBackupStatus['files'] {
    if (!folder) return [];
    try {
      return fs
        .readdirSync(folder)
        .filter((n) => FILE_RE.test(n))
        .map((n) => {
          const st = fs.statSync(path.join(folder, n));
          return { name: n, size: st.size, modified_at: st.mtime.toISOString() };
        })
        .sort((a, b) => (a.name < b.name ? 1 : -1));
    } catch {
      return [];
    }
  }

  status(): AutoBackupStatus {
    const r = this.row();
    return {
      enabled: !!r?.enabled,
      folder: r?.folder ?? null,
      keep_count: r?.keep_count ?? 14,
      last_at: r?.last_at ?? null,
      last_file: r?.last_file ?? null,
      last_error: r?.last_error ?? null,
      last_error_at: r?.last_error_at ?? null,
      files: this.listFiles(r?.folder ?? null),
    };
  }

  configure(input: { enabled?: unknown; folder?: unknown; keepCount?: unknown }):
    | { ok: true; status: AutoBackupStatus }
    | { ok: false; error: string } {
    const cur = this.row();
    const enabled = input.enabled === undefined ? !!cur?.enabled : input.enabled === true || input.enabled === 1;
    let folder = input.folder === undefined ? cur?.folder ?? null : String(input.folder ?? '').trim() || null;
    const keepRaw = input.keepCount === undefined ? cur?.keep_count ?? 14 : Number(input.keepCount);
    if (!Number.isInteger(keepRaw) || keepRaw < 1 || keepRaw > 365) return { ok: false, error: 'invalid_keep_count' };
    if (folder) {
      if (!path.isAbsolute(folder)) return { ok: false, error: 'folder_not_absolute' };
      folder = path.normalize(folder);
      try {
        fs.mkdirSync(folder, { recursive: true });
        const probe = path.join(folder, `.dukaandesk-write-test-${process.pid}`);
        fs.writeFileSync(probe, 'ok');
        fs.unlinkSync(probe);
      } catch {
        return { ok: false, error: 'folder_not_writable' };
      }
    }
    if (enabled && !folder) return { ok: false, error: 'folder_required' };
    this.db.raw
      .prepare(`UPDATE auto_backup SET enabled = ?, folder = ?, keep_count = ? WHERE id = 1`)
      .run(enabled ? 1 : 0, folder, keepRaw);
    return { ok: true, status: this.status() };
  }

  /** Called on a timer: one copy per Karachi day when enabled. */
  async tick(now = new Date()) {
    const r = this.row();
    if (!r?.enabled || !r.folder) return;
    if (r.last_at && karachiParts(new Date(r.last_at)).ymd === karachiParts(now).ymd) return;
    this.runNow(now);
  }

  runNow(now = new Date()): { ok: true; file: string } | { ok: false; error: string } {
    if (this.running) return { ok: false, error: 'backup_busy' };
    const r = this.row();
    if (!r?.folder) return { ok: false, error: 'folder_required' };
    this.running = true;
    try {
      const store = this.db.raw.prepare(`SELECT id FROM store LIMIT 1`).get() as { id: string } | undefined;
      if (!store) return { ok: false, error: 'not_setup' };
      const k = karachiParts(now);
      fs.mkdirSync(r.folder, { recursive: true });
      let name: string;
      let target: string;
      if (this.pgBackup.enabled) {
        // Lite: full database copy (pg_dump custom format), restorable with Backup > Restore full copy.
        name = `dukaandesk-auto-${k.ymd}-${k.hm}${DB_COPY_EXT}`;
        target = path.join(r.folder, name);
        const d = this.pgBackup.dump(target);
        if (!d.ok) throw new Error(d.detail ?? d.error);
      } else {
        const res = this.backup.exportForAuto(store.id);
        if (!res.ok) throw new Error(res.reason ?? 'export_failed');
        name = `dukaandesk-auto-${k.ymd}-${k.hm}.json`;
        target = path.join(r.folder, name);
        const tmp = `${target}.part`;
        fs.writeFileSync(tmp, JSON.stringify(res.bundle));
        fs.renameSync(tmp, target);
      }
      // Retention: newest keep_count auto copies stay.
      for (const f of this.listFiles(r.folder).slice(r.keep_count)) {
        try {
          fs.unlinkSync(path.join(r.folder, f.name));
        } catch {
          /* ignore */
        }
      }
      this.db.raw
        .prepare(`UPDATE auto_backup SET last_at = ?, last_file = ?, last_error = NULL, last_error_at = NULL WHERE id = 1`)
        .run(now.toISOString(), name);
      this.log.log(`auto backup written ${target}`);
      return { ok: true, file: name };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.db.raw
        .prepare(`UPDATE auto_backup SET last_error = ?, last_error_at = ? WHERE id = 1`)
        .run(msg.slice(0, 300), now.toISOString());
      this.log.warn(`auto backup failed: ${msg}`);
      return { ok: false, error: 'backup_failed' };
    } finally {
      this.running = false;
    }
  }
}
