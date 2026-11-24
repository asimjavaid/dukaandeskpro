import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Req,
  Res,
  UnauthorizedException,
  NotFoundException,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { SessionGuard, AuthedRequest } from '../auth/session.guard';
import { OwnerGuard } from '../auth/owner.guard';
import { BackupService } from './backup.service';
import { AutoBackupService } from './auto-backup.service';
import { PgBackupService, DB_COPY_EXT, isDbCopy } from './pg-backup.service';
import { AuthService } from '../auth/auth.service';
import { isValidPinFormat } from '../auth/pin.util';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Owner backup / export / restore (Slice 6 + 12).
 * GET  /backup — status (last export + data_region stub)
 * POST /backup/export — JSON bundle after PIN confirm
 * POST /backup/saved — client confirms the copy file was saved → "last saved"
 * POST /backup/restore — replace domain tables from prior export (Owner + PIN)
 * Cashier → 403 via OwnerGuard.
 */
@Controller('backup')
@UseGuards(SessionGuard, OwnerGuard)
export class BackupController {
  constructor(
    private readonly backup: BackupService,
    private readonly auto: AutoBackupService,
    private readonly pgBackup: PgBackupService,
    private readonly authSvc: AuthService,
  ) {}

  private stamp(d = new Date()): string {
    const k = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d);
    const g = (t: string) => k.find((p) => p.type === t)?.value ?? '00';
    return `${g('year')}-${g('month')}-${g('day')}-${g('hour').replace('24', '00')}${g('minute')}${g('second')}`;
  }

  /** Full database copies (.ddpro) the owner can restore: automatic copies + safety copies. */
  @Get('db')
  dbCopies() {
    const st = this.auto.status();
    const dirs = [st.folder, this.pgBackup.defaultDir(), path.join(path.dirname(this.pgBackup.defaultDir()), 'reset-backups')].filter(
      (d, i, a): d is string => !!d && a.indexOf(d) === i,
    );
    const files: Array<{ name: string; path: string; size: number; modified_at: string }> = [];
    for (const dir of dirs) {
      try {
        for (const n of fs.readdirSync(dir)) {
          if (!n.endsWith(DB_COPY_EXT)) continue;
          const full = path.join(dir, n);
          const s = fs.statSync(full);
          files.push({ name: n, path: full, size: s.size, modified_at: s.mtime.toISOString() });
        }
      } catch {
        /* folder missing */
      }
    }
    files.sort((a, b) => (a.modified_at < b.modified_at ? 1 : -1));
    return { enabled: this.pgBackup.enabled, files };
  }

  /** Restore a full database copy (Owner + PIN). Writes a safety copy of the current data first. */
  @Post('db/restore')
  dbRestore(@Req() req: AuthedRequest, @Body() body: { pin?: string; path?: string }) {
    const pin = typeof body?.pin === 'string' ? body.pin : '';
    if (!isValidPinFormat(pin)) throw new BadRequestException({ code: 'pin_required', reason: 'PIN required' });
    const check = this.authSvc.pinLogin(req.session!.userId, pin);
    if (!check.ok || check.user.role !== 'owner') throw new UnauthorizedException({ code: 'bad_pin', reason: 'invalid owner PIN' });
    const file = typeof body?.path === 'string' ? path.resolve(body.path) : '';
    if (!file || !file.endsWith(DB_COPY_EXT) || !fs.existsSync(file) || !isDbCopy(file)) {
      throw new BadRequestException({ code: 'not_a_db_copy', reason: 'choose a .ddpro copy' });
    }
    const r = this.pgBackup.restore(file, this.pgBackup.defaultDir(), this.stamp());
    if (!r.ok) throw new BadRequestException({ code: r.error, reason: r.detail ?? r.error });
    return { ok: true, safety_file: r.safety_file, restored_from: file };
  }

  @Get('auto')
  autoStatus() {
    return this.auto.status();
  }

  @Post('auto')
  autoConfigure(@Body() body: { enabled?: unknown; folder?: unknown; keepCount?: unknown; keep_count?: unknown }) {
    return this.auto.configure({ enabled: body?.enabled, folder: body?.folder, keepCount: body?.keepCount ?? body?.keep_count });
  }

  @Post('auto/run')
  autoRun() {
    const r = this.auto.runNow();
    return r.ok ? { ok: true as const, file: r.file, status: this.auto.status() } : r;
  }

  @Get()
  status(@Req() req: AuthedRequest) {
    return this.backup.status(req.session!.storeId);
  }

  @Post('export')
  @Header('Cache-Control', 'no-store')
  export(
    @Req() req: AuthedRequest,
    @Body() body: { pin?: string },
    @Res() res: Response,
  ) {
    const session = req.session!;
    const pin = typeof body?.pin === 'string' ? body.pin : '';
    if (!pin) {
      throw new BadRequestException('PIN required');
    }

    const result = this.backup.exportStore({
      storeId: session.storeId,
      userId: session.userId,
      pin,
    });

    if (!result.ok) {
      if (result.code === 'bad_pin' || result.code === 'invalid_pin') {
        throw new UnauthorizedException(result.reason);
      }
      throw new NotFoundException(result.reason);
    }

    const payload = JSON.stringify(result.bundle, null, 2);
    res.status(200);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    // Pass back to POST /backup/saved once the file is really saved.
    res.setHeader('X-Backup-Copy-Id', result.copyId);
    res.send(payload);
  }

  /** Record "last saved" only after the desktop save / browser download finished. */
  @Post('saved')
  saved(@Req() req: AuthedRequest, @Body() body: { copy_id?: string }) {
    const session = req.session!;
    const copyId = typeof body?.copy_id === 'string' ? body.copy_id.trim() : '';
    if (!copyId) {
      throw new BadRequestException({
        code: 'copy_id_required',
        reason: 'copy_id required',
      });
    }
    const result = this.backup.confirmSaved({
      storeId: session.storeId,
      userId: session.userId,
      copyId,
    });
    if (!result.ok) {
      throw new NotFoundException({ code: result.code, reason: result.reason });
    }
    return { ok: true, last_export_at: result.last_export_at };
  }

  @Post('restore')
  restore(
    @Req() req: AuthedRequest,
    @Body() body: { pin?: string; bundle?: unknown },
  ) {
    const session = req.session!;
    const pin = typeof body?.pin === 'string' ? body.pin : '';
    if (!pin) {
      throw new BadRequestException({
        code: 'pin_required',
        reason: 'PIN required',
      });
    }
    if (body?.bundle === undefined) {
      throw new BadRequestException({
        code: 'invalid_backup_bundle',
        reason: 'bundle required',
      });
    }

    const result = this.backup.restoreStore({
      storeId: session.storeId,
      userId: session.userId,
      pin,
      bundle: body.bundle,
    });

    if (!result.ok) {
      if (result.code === 'bad_pin' || result.code === 'invalid_pin') {
        throw new UnauthorizedException({
          code: result.code,
          reason: result.reason,
        });
      }
      if (result.code === 'not_found') {
        throw new NotFoundException({
          code: result.code,
          reason: result.reason,
        });
      }
      // Header / bundle validation — 400 clear code; DB untouched.
      throw new BadRequestException({
        code: result.code,
        reason: result.reason,
      });
    }

    return {
      ok: true,
      restored_at: result.restored_at,
      counts: result.counts,
      kept: result.kept,
      auditId: result.auditId,
    };
  }
}
