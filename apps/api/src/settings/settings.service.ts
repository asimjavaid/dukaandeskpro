import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DbService } from '../db/db.service';
import { randomUUID } from 'node:crypto';
import { hashPin, isValidPinFormat, verifyPinHash } from '../auth/pin.util';
import { throttleClear, throttleFail, throttleWait } from '../common/throttle';
import {
  normalizeRateBp,
  percentToRateBp,
} from '../tax/inclusive';

export type ReceiptWidthMm = 58 | 80;
export type ReportsPaper = 'a4' | 'letter';
export type LabelSizeId = '38x25' | '50x25' | '50x30' | '40x30';

const LABEL_SIZES: readonly LabelSizeId[] = ['38x25', '50x25', '50x30', '40x30'];

export type StoreProfile = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  receipt_footer: string | null;
  locale_default: 'en' | 'ur';
  receipt_printer_name: string | null;
  receipt_width_mm: ReceiptWidthMm;
  receipt_print_enabled: boolean;
  reports_printer_name: string | null;
  reports_paper: ReportsPaper;
  label_printer_name: string | null;
  label_size: LabelSizeId;
  label_per_row: number;
  /** Tax V1 — Sales Tax switch (default OFF, R1). */
  sales_tax_enabled: boolean;
  /** Global store rate in basis points (17% = 1700). */
  sales_tax_rate_bp: number;
  /** Same rate for display (e.g. 17, 17.5). */
  sales_tax_rate_percent: number;
  created_at: string;
  updated_at: string;
};

function receiptWidth(raw: unknown): ReceiptWidthMm {
  return Number(raw) === 58 ? 58 : 80;
}

function reportsPaper(raw: unknown): ReportsPaper {
  return String(raw ?? '').trim().toLowerCase() === 'letter' ? 'letter' : 'a4';
}

function labelSize(raw: unknown): LabelSizeId {
  const value = String(raw ?? '').trim();
  return (LABEL_SIZES as readonly string[]).includes(value)
    ? (value as LabelSizeId)
    : '50x25';
}

function labelPerRow(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1 || n > 5) return 3;
  return n;
}

function printerName(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim().slice(0, 64);
  return trimmed.length > 0 ? trimmed : null;
}

export type AboutInfo = {
  product: 'DukaanDesk Pro';
  version: string;
  tagline: string;
  sqlite_path_redacted: string;
  data_region: 'local_device';
};

@Injectable()
export class SettingsService {
  constructor(private readonly db: DbService) {}

  getStore(storeId: string): StoreProfile | null {
    const row = this.db.raw
      .prepare(
        `SELECT id, name, phone, address, receipt_footer, locale_default,
                receipt_printer_name, receipt_width_mm, receipt_print_enabled,
                reports_printer_name, reports_paper,
                label_printer_name, label_size, label_per_row,
                sales_tax_enabled, sales_tax_rate_bp,
                created_at, updated_at
         FROM store WHERE id = ?`,
      )
      .get(storeId) as
      | {
          id: string;
          name: string;
          phone: string | null;
          address: string | null;
          receipt_footer: string | null;
          locale_default: string;
          receipt_printer_name: string | null;
          receipt_width_mm: number;
          receipt_print_enabled: number | null;
          reports_printer_name: string | null;
          reports_paper: string;
          label_printer_name: string | null;
          label_size: string;
          label_per_row: number;
          sales_tax_enabled: number | null;
          sales_tax_rate_bp: number | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) return null;
    const taxRateBp = normalizeRateBp(row.sales_tax_rate_bp);
    return {
      id: row.id,
      name: row.name,
      phone: row.phone ?? null,
      address: row.address ?? null,
      receipt_footer: row.receipt_footer ?? null,
      locale_default: row.locale_default === 'ur' ? 'ur' : 'en',
      receipt_printer_name: row.receipt_printer_name ?? null,
      receipt_width_mm: receiptWidth(row.receipt_width_mm),
      receipt_print_enabled: Number(row.receipt_print_enabled) !== 0,
      reports_printer_name: row.reports_printer_name ?? null,
      reports_paper: reportsPaper(row.reports_paper),
      label_printer_name: row.label_printer_name ?? null,
      label_size: labelSize(row.label_size),
      label_per_row: labelPerRow(row.label_per_row),
      sales_tax_enabled: Number(row.sales_tax_enabled) === 1,
      sales_tax_rate_bp: taxRateBp,
      sales_tax_rate_percent: Number((taxRateBp / 100).toFixed(2)),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  patchStore(
    storeId: string,
    input: {
      name?: string;
      phone?: string | null;
      address?: string | null;
      receipt_footer?: string | null;
      locale_default?: string;
      receipt_printer_name?: string | null;
      receipt_width_mm?: number;
      receipt_print_enabled?: boolean;
      reports_printer_name?: string | null;
      reports_paper?: string;
      label_printer_name?: string | null;
      label_size?: string;
      label_per_row?: number;
      /** Tax V1 — Owner-only (controller guard). */
      sales_tax_enabled?: boolean;
      /** Percent as typed by the Owner ("17", 17.5). */
      sales_tax_rate_percent?: number | string | null;
      /** Alternative: basis points. Ignored when percent is also given. */
      sales_tax_rate_bp?: number | null;
    },
    actorUserId?: string | null,
  ):
    | { ok: true; store: StoreProfile }
    | {
        ok: false;
        code:
          | 'not_found'
          | 'invalid_name'
          | 'invalid_locale'
          | 'invalid_printer'
          | 'invalid_tax_rate'
          | 'tax_rate_required';
        reason: string;
      } {
    const existing = this.getStore(storeId);
    if (!existing) {
      return { ok: false, code: 'not_found', reason: 'store not found' };
    }

    let name = existing.name;
    if (input.name !== undefined) {
      const trimmed = String(input.name ?? '').trim();
      if (!trimmed || trimmed.length > 120) {
        return { ok: false, code: 'invalid_name', reason: 'invalid store name' };
      }
      name = trimmed;
    }

    let phone = existing.phone;
    if (input.phone !== undefined) {
      if (input.phone === null) {
        phone = null;
      } else {
        const raw = String(input.phone).trim();
        phone = raw.length > 0 ? raw.slice(0, 32) : null;
      }
    }

    let address = existing.address;
    if (input.address !== undefined) {
      if (input.address === null) {
        address = null;
      } else {
        const raw = String(input.address).trim();
        address = raw.length > 0 ? raw.slice(0, 240) : null;
      }
    }

    let receiptFooter = existing.receipt_footer;
    if (input.receipt_footer !== undefined) {
      if (input.receipt_footer === null) {
        receiptFooter = null;
      } else {
        const raw = String(input.receipt_footer).trim();
        receiptFooter = raw.length > 0 ? raw.slice(0, 280) : null;
      }
    }

    let receiptPrinterName = existing.receipt_printer_name;
    if (input.receipt_printer_name !== undefined) {
      receiptPrinterName = printerName(input.receipt_printer_name);
    }
    let receiptWidthMm = existing.receipt_width_mm;
    if (input.receipt_width_mm !== undefined) {
      const n = Number(input.receipt_width_mm);
      if (n !== 58 && n !== 80) {
        return { ok: false, code: 'invalid_printer', reason: 'receipt width must be 58 or 80' };
      }
      receiptWidthMm = n;
    }
    let receiptPrintEnabled = existing.receipt_print_enabled;
    if (input.receipt_print_enabled !== undefined) {
      receiptPrintEnabled = Boolean(input.receipt_print_enabled);
    }

    let reportsPrinterName = existing.reports_printer_name;
    if (input.reports_printer_name !== undefined) {
      reportsPrinterName = printerName(input.reports_printer_name);
    }
    let reportsPaperValue = existing.reports_paper;
    if (input.reports_paper !== undefined) {
      const paper = String(input.reports_paper ?? '').trim().toLowerCase();
      if (paper !== 'a4' && paper !== 'letter') {
        return { ok: false, code: 'invalid_printer', reason: 'reports paper must be a4 or letter' };
      }
      reportsPaperValue = paper;
    }

    let labelPrinterName = existing.label_printer_name;
    if (input.label_printer_name !== undefined) {
      labelPrinterName = printerName(input.label_printer_name);
    }
    let labelSizeValue = existing.label_size;
    if (input.label_size !== undefined) {
      const size = String(input.label_size ?? '').trim();
      if (!(LABEL_SIZES as readonly string[]).includes(size)) {
        return { ok: false, code: 'invalid_printer', reason: 'unknown label size' };
      }
      labelSizeValue = size as LabelSizeId;
    }
    let labelPerRowValue = existing.label_per_row;
    if (input.label_per_row !== undefined) {
      const n = Math.floor(Number(input.label_per_row));
      if (!Number.isFinite(n) || n < 1 || n > 5) {
        return { ok: false, code: 'invalid_printer', reason: 'stickers per row must be 1 to 5' };
      }
      labelPerRowValue = n;
    }

    let localeDefault = existing.locale_default;
    if (input.locale_default !== undefined) {
      const loc = String(input.locale_default).trim().toLowerCase();
      if (loc !== 'en' && loc !== 'ur') {
        return {
          ok: false,
          code: 'invalid_locale',
          reason: 'locale_default must be en or ur',
        };
      }
      localeDefault = loc;
    }

    // Tax V1 — Sales Tax switch + global rate. Turning ON needs a rate > 0.
    let salesTaxEnabled = existing.sales_tax_enabled;
    if (input.sales_tax_enabled !== undefined) {
      salesTaxEnabled = Boolean(input.sales_tax_enabled);
    }
    let salesTaxRateBp = existing.sales_tax_rate_bp;
    if (
      input.sales_tax_rate_percent !== undefined &&
      input.sales_tax_rate_percent !== null &&
      String(input.sales_tax_rate_percent).trim() !== ''
    ) {
      const bp = percentToRateBp(input.sales_tax_rate_percent);
      if (bp == null) {
        return {
          ok: false,
          code: 'invalid_tax_rate',
          reason: 'sales tax rate must be 0–100% with up to 2 decimals',
        };
      }
      salesTaxRateBp = bp;
    } else if (
      input.sales_tax_rate_bp !== undefined &&
      input.sales_tax_rate_bp !== null
    ) {
      const n = Number(input.sales_tax_rate_bp);
      if (!Number.isInteger(n) || n < 0 || n > 10000) {
        return {
          ok: false,
          code: 'invalid_tax_rate',
          reason: 'sales tax rate must be 0–10000 basis points',
        };
      }
      salesTaxRateBp = n;
    }
    if (salesTaxEnabled && salesTaxRateBp <= 0) {
      return {
        ok: false,
        code: 'tax_rate_required',
        reason: 'set a sales tax rate above 0% before turning tax on',
      };
    }
    const taxChanged =
      salesTaxEnabled !== existing.sales_tax_enabled ||
      salesTaxRateBp !== existing.sales_tax_rate_bp;

    const updatedAt = new Date().toISOString();
    const writeStore = this.db.raw.transaction(() => {
      this.db.raw
        .prepare(
          `UPDATE store
           SET name = ?, phone = ?, address = ?, receipt_footer = ?,
               locale_default = ?,
               receipt_printer_name = ?, receipt_width_mm = ?,
               receipt_print_enabled = ?,
               reports_printer_name = ?, reports_paper = ?,
               label_printer_name = ?, label_size = ?, label_per_row = ?,
               sales_tax_enabled = ?, sales_tax_rate_bp = ?,
               updated_at = ?
           WHERE id = ?`,
        )
        .run(
          name,
          phone,
          address,
          receiptFooter,
          localeDefault,
          receiptPrinterName,
          receiptWidthMm,
          receiptPrintEnabled ? 1 : 0,
          reportsPrinterName,
          reportsPaperValue,
          labelPrinterName,
          labelSizeValue,
          labelPerRowValue,
          salesTaxEnabled ? 1 : 0,
          salesTaxRateBp,
          updatedAt,
          storeId,
        );

      if (taxChanged) {
        this.db.raw
          .prepare(
            `INSERT INTO audit_log
               (id, action, user_id, store_id, subject_type, subject_id, payload_json)
             VALUES (?, 'tax_setting_changed', ?, ?, 'store', ?, ?)`,
          )
          .run(
            randomUUID(),
            actorUserId ?? null,
            storeId,
            storeId,
            JSON.stringify({
              from: {
                sales_tax_enabled: existing.sales_tax_enabled,
                sales_tax_rate_bp: existing.sales_tax_rate_bp,
              },
              to: {
                sales_tax_enabled: salesTaxEnabled,
                sales_tax_rate_bp: salesTaxRateBp,
              },
              at: updatedAt,
            }),
          );
      }
    });
    writeStore();

    const store = this.getStore(storeId);
    if (!store) {
      return { ok: false, code: 'not_found', reason: 'store not found' };
    }
    return { ok: true, store };
  }

  changePin(input: {
    userId: string;
    currentPin: string;
    newPin: string;
  }):
    | { ok: true }
    | {
        ok: false;
        code: 'invalid_pin' | 'bad_current_pin' | 'not_found' | 'too_many_attempts';
        reason: string;
      } {
    if (
      !isValidPinFormat(input.currentPin) ||
      !isValidPinFormat(input.newPin)
    ) {
      return {
        ok: false,
        code: 'invalid_pin',
        reason: 'PIN must be 4–6 digits',
      };
    }

    const row = this.db.raw
      .prepare(
        `SELECT u.id, u.pin_hash, r.code AS role
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE u.id = ? AND u.disabled_at IS NULL`,
      )
      .get(input.userId) as
      | { id: string; pin_hash: string | null; role: string }
      | undefined;

    if (!row || row.role !== 'owner') {
      return { ok: false, code: 'not_found', reason: 'owner not found' };
    }

    const tkey = `pincheck:${input.userId}`;
    if (throttleWait(this.db.raw, tkey) > 0) {
      return { ok: false, code: 'too_many_attempts', reason: 'too many wrong PINs' };
    }
    if (!verifyPinHash(input.currentPin, row.pin_hash)) {
      throttleFail(this.db.raw, tkey);
      return {
        ok: false,
        code: 'bad_current_pin',
        reason: 'current PIN incorrect',
      };
    }

    const pinHash = hashPin(input.newPin);
    const updatedAt = new Date().toISOString();
    this.db.raw
      .prepare(
        `UPDATE users SET pin_hash = ?, updated_at = ? WHERE id = ?`,
      )
      .run(pinHash, updatedAt, input.userId);
    throttleClear(this.db.raw, tkey);

    return { ok: true };
  }

  about(): AboutInfo {
    const version = this.readPackageVersion();
    return {
      product: 'DukaanDesk Pro',
      version,
      tagline: 'PostgreSQL 17 · multi-till',
      sqlite_path_redacted: redactSqlitePath(this.db.dbPath),
      data_region: 'local_device',
    };
  }

  private readPackageVersion(): string {
    const candidates = [
      join(__dirname, '../../../../package.json'),
      join(__dirname, '../../../package.json'),
      join(process.cwd(), 'package.json'),
      join(process.cwd(), '../../package.json'),
    ];
    for (const p of candidates) {
      try {
        const raw = readFileSync(p, 'utf8');
        const pkg = JSON.parse(raw) as { name?: string; version?: string };
        if (
          pkg.version &&
          (pkg.name === 'dukaandeskpro' || pkg.name === '@dukaandeskpro/api')
        ) {
          return String(pkg.version);
        }
      } catch {
        /* try next */
      }
    }
    return '0.0.1';
  }
}

/** Hide absolute home / username segments; keep basename for operators. */
export function redactSqlitePath(fullPath: string): string {
  const normalized = String(fullPath || '').replace(/\\/g, '/');
  const base =
    normalized.split('/').filter(Boolean).pop() || 'dukaandesk.sqlite';
  return `…/${base}`;
}
