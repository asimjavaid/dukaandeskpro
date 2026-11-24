import { BadRequestException, Body, Controller, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SessionGuard } from '../auth/session.guard';
import { writeXlsx, type Cell, type SheetSpec } from '../common/xlsx';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_SHEETS = 10;
const MAX_ROWS = 100_000;
const MAX_COLS = 60;

/** Clean an untrusted sheet list from the app (reports are built in the browser). */
export function cleanSheets(input: unknown): SheetSpec[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_SHEETS) return null;
  const out: SheetSpec[] = [];
  for (const s of input) {
    if (!s || typeof s !== 'object') return null;
    const o = s as Record<string, unknown>;
    if (!Array.isArray(o.rows) || o.rows.length > MAX_ROWS) return null;
    const rows: Cell[][] = [];
    for (const r of o.rows) {
      if (!Array.isArray(r) || r.length > MAX_COLS) return null;
      rows.push(r.map((c) => (typeof c === 'number' && Number.isFinite(c) ? c : c == null ? '' : String(c).slice(0, 32_000))));
    }
    const nums = (v: unknown) => (Array.isArray(v) ? v.filter((n) => typeof n === 'number' && Number.isFinite(n)).slice(0, MAX_COLS) as number[] : undefined);
    out.push({ name: typeof o.name === 'string' && o.name.trim() ? o.name : `Sheet${out.length + 1}`, rows, widths: nums(o.widths), textCols: nums(o.textCols) });
  }
  return out;
}

export function cleanFileName(v: unknown): string {
  const base = (typeof v === 'string' ? v : 'dukaandesk-export').replace(/\.xlsx$/i, '').replace(/[^\w.\- ]+/g, '-').replace(/\s+/g, '-').slice(0, 80) || 'dukaandesk-export';
  return `${base}.xlsx`;
}

/**
 * POST /export/xlsx — turn a report built in the app into a real Excel file (no data is written,
 * so it stays open in read-only mode). Signed-in users only.
 */
@Controller('export')
@UseGuards(SessionGuard)
export class ExportController {
  @Post('xlsx')
  @HttpCode(200)
  xlsx(@Body() body: { fileName?: unknown; sheets?: unknown }, @Res() res: Response) {
    const sheets = cleanSheets(body?.sheets);
    if (!sheets) throw new BadRequestException({ code: 'invalid_sheets' });
    const file = writeXlsx(sheets);
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${cleanFileName(body?.fileName)}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(file);
  }
}
