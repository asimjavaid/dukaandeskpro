import { exportBatch2, restoreBatch2, wipeBatch2, type Batch2Bundle } from './batch2-backup';
import { r3 } from '../common/qty';
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { AuthService } from '../auth/auth.service';
import { CatalogService } from '../catalog/catalog.service';
import { isValidPinFormat } from '../auth/pin.util';
import { normalizeRateBp } from '../tax/inclusive';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  IMAGE_FILE_RE,
  decodeImagePayload,
  writeImageFile,
} from '../catalog/product-images';
import {
  BACKUP_AUDIT_ACTION,
  BACKUP_DATA_REGION,
  BACKUP_FORMAT,
  BACKUP_MIN_SCHEMA_VERSION,
  BACKUP_PRODUCT,
  BACKUP_PURCHASE_KEYS,
  BACKUP_RESTORE_AUDIT_ACTION,
  BACKUP_SCHEMA_VERSION,
  BACKUP_STOCK_COUNT_KEYS,
  BackupStatus,
  FORBIDDEN_EXPORT_KEY_RE,
  FORBIDDEN_EXPORT_SUBSTRINGS,
  RestoreHeaderErrorCode,
  RestoreRunErrorCode,
  StoreExportBundle,
} from './backup.types';

export type ExportResult =
  | {
      ok: true;
      bundle: StoreExportBundle;
      /** Id to pass to confirmSaved() once the file is really on disk. */
      copyId: string;
      filename: string;
    }
  | { ok: false; code: 'bad_pin' | 'invalid_pin' | 'not_found'; reason: string };

export type ConfirmSavedResult =
  | { ok: true; last_export_at: string }
  | { ok: false; code: 'not_found'; reason: string };

/** A copy handed to the client but not yet confirmed as saved. */
type PendingCopy = {
  storeId: string;
  userId: string;
  createdAt: number;
  payload: Record<string, unknown>;
};

/** Unconfirmed copies are forgotten after this long. */
const PENDING_COPY_TTL_MS = 60 * 60 * 1000;

export type RestoreResult =
  | {
      ok: true;
      auditId: string;
      restored_at: string;
      counts: {
        products: number;
        stock_balances: number;
        parties: number;
        party_ledger: number;
        sales: number;
        sale_lines: number;
        tax_documents: number;
        stock_count_sessions: number;
        stock_count_lines: number;
        stock_adjustments: number;
        suppliers: number | null;
        supplier_payments: number | null;
        purchase_invoices: number | null;
        purchase_lines: number | null;
        stock_receives: number | null;
        expenses: number | null;
      };
      /** Groups the copy did not contain and were left as they were. */
      kept: string[];
    }
  | {
      ok: false;
      code:
        | 'bad_pin'
        | 'invalid_pin'
        | 'not_found'
        | RestoreHeaderErrorCode
        | RestoreRunErrorCode;
      reason: string;
    };

@Injectable()
export class BackupService {
  private readonly log = new Logger(BackupService.name);
  private readonly pendingCopies = new Map<string, PendingCopy>();

  constructor(
    private readonly db: DbService,
    private readonly auth: AuthService,
    private readonly catalog: CatalogService,
  ) {}

  status(storeId: string): BackupStatus {
    const exportRow = this.db.raw
      .prepare(
        `SELECT created_at FROM audit_log
         WHERE action = ? AND store_id = ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(BACKUP_AUDIT_ACTION, storeId) as { created_at: string } | undefined;

    const restoreRow = this.db.raw
      .prepare(
        `SELECT created_at FROM audit_log
         WHERE action = ? AND store_id = ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(BACKUP_RESTORE_AUDIT_ACTION, storeId) as
      | { created_at: string }
      | undefined;

    return {
      last_export_at: exportRow?.created_at ?? null,
      last_restore_at: restoreRow?.created_at ?? null,
      data_region_disclosed: BACKUP_DATA_REGION,
      product: BACKUP_PRODUCT,
      schema_version: BACKUP_SCHEMA_VERSION,
      min_schema_version: BACKUP_MIN_SCHEMA_VERSION,
    };
  }

  /**
   * Record "last saved" only after the client confirms the file was written
   * (desktop save dialog finished / browser download started). Writes the
   * backup.export audit row with the copy id from exportStore().
   */
  confirmSaved(input: {
    storeId: string;
    userId: string;
    copyId: string;
  }): ConfirmSavedResult {
    this.prunePendingCopies();
    const pending = this.pendingCopies.get(input.copyId);
    if (!pending || pending.storeId !== input.storeId) {
      return { ok: false, code: 'not_found', reason: 'unknown or expired copy id' };
    }
    this.pendingCopies.delete(input.copyId);
    this.db.raw
      .prepare(
        `INSERT INTO audit_log
           (id, action, user_id, store_id, subject_type, subject_id, payload_json)
         VALUES (?, ?, ?, ?, 'store', ?, ?)`,
      )
      .run(
        input.copyId,
        BACKUP_AUDIT_ACTION,
        input.userId,
        input.storeId,
        input.storeId,
        JSON.stringify({ ...pending.payload, saved_confirmed: true }),
      );
    const row = this.db.raw
      .prepare(`SELECT created_at FROM audit_log WHERE id = ?`)
      .get(input.copyId) as { created_at: string } | undefined;
    return { ok: true, last_export_at: row?.created_at ?? new Date().toISOString() };
  }

  private prunePendingCopies() {
    const cutoff = Date.now() - PENDING_COPY_TTL_MS;
    for (const [id, p] of this.pendingCopies) {
      if (p.createdAt < cutoff) this.pendingCopies.delete(id);
    }
  }

  /**
   * Build JSON store export after Owner PIN confirm.
   * Omits pin_hash, session secrets, and raw tax provider fields.
   * Writes audit_log row action=backup.export.
   */
  exportStore(input: {
    storeId: string;
    userId: string;
    pin: string;
  }): ExportResult {
    return this.exportCore(input, true);
  }

  /** Automatic daily copy: same bundle, no PIN (runs inside the API). */
  exportForAuto(storeId: string): ExportResult {
    return this.exportCore({ storeId, userId: '', pin: '' }, false);
  }

  private exportCore(
    input: { storeId: string; userId: string; pin: string },
    checkPin: boolean,
  ): ExportResult {
    if (checkPin) {
    if (!isValidPinFormat(input.pin)) {
      return { ok: false, code: 'invalid_pin', reason: 'invalid PIN format' };
    }

    const pinCheck = this.auth.pinLogin(input.userId, input.pin);
    if (!pinCheck.ok) {
      return { ok: false, code: 'bad_pin', reason: 'invalid owner PIN' };
    }
    if (pinCheck.user.role !== 'owner') {
      return { ok: false, code: 'bad_pin', reason: 'owner PIN required' };
    }
    }

    const store = this.db.raw
      .prepare(
        `SELECT id, name, phone, address, receipt_footer, locale_default,
                sales_tax_enabled, sales_tax_rate_bp,
                receipt_printer_name, receipt_width_mm, receipt_print_enabled,
                reports_printer_name, reports_paper,
                label_printer_name, label_size, label_per_row,
                created_at, updated_at
         FROM store WHERE id = ?`,
      )
      .get(input.storeId) as Record<string, unknown> | undefined;
    if (!store) {
      return { ok: false, code: 'not_found', reason: 'store not found' };
    }

    const products = this.db.raw
      .prepare(
        `SELECT id, sku, name, name_ur, unit_label, price_paisa, active,
                pieces_per_carton, last_unit_cost_paisa, barcode, image_file,
                discount_kind, discount_value, discount_start_at, discount_end_at,
                created_at, updated_at
         FROM products ORDER BY name`,
      )
      .all() as Array<Record<string, unknown>>;

    // v4: picture files, base64. Missing files are left out (product keeps no picture).
    const imagesDir = this.catalog.imagesDir();
    const product_images: Array<{ file: string; data_base64: string }> = [];
    for (const p of products) {
      const file = typeof p.image_file === 'string' ? p.image_file : '';
      if (!IMAGE_FILE_RE.test(file)) continue;
      try {
        const data = fs.readFileSync(path.join(imagesDir, file));
        product_images.push({ file, data_base64: data.toString('base64') });
      } catch {
        p.image_file = null;
      }
    }

    const stock_balances = this.db.raw
      .prepare(
        `SELECT product_id, qty_on_hand, updated_at FROM stock_balances
         ORDER BY product_id`,
      )
      .all();

    const parties = this.db.raw
      .prepare(
        `SELECT id, store_id, name, phone, address, created_at, updated_at
         FROM parties ORDER BY name`,
      )
      .all();

    const party_ledger = this.db.raw
      .prepare(
        `SELECT id, party_id, entry_type, amount_paisa, sale_id, note,
                collected_on, created_at, return_id
         FROM party_ledger ORDER BY created_at`,
      )
      .all();

    const sales = this.db.raw
      .prepare(
        `SELECT id, short_id, store_id, sold_by, payment_method, party_id,
                total_paisa, cash_amount_paisa, udhaar_amount_paisa,
                tendered_paisa, change_paisa,
                client_device_at, recorded_at, created_at,
                voided_at, tax_flagged,
                tax_enabled, tax_rate_bp, tax_paisa, tax_base_paisa,
                voided_by, void_reason, replaces_sale_id, replaced_by_sale_id,
                till_id, bill_no
         FROM sales ORDER BY recorded_at`,
      )
      .all();

    const sale_returns = this.db.raw
      .prepare(
        `SELECT id, short_id, sale_id, store_id, party_id, returned_by, total_paisa,
                refund_cash_paisa, refund_khata_paisa, reason, client_device_at,
                recorded_at, created_at
         FROM sale_returns ORDER BY recorded_at, id`,
      )
      .all();

    const sale_return_lines = this.db.raw
      .prepare(
        `SELECT id, return_id, sale_line_id, product_id, product_name, qty_pieces,
                unit_price_paisa, line_total_paisa, unit_cost_paisa, restocked, line_no
         FROM sale_return_lines ORDER BY return_id, line_no`,
      )
      .all();

    const sale_lines = this.db.raw
      .prepare(
        `SELECT id, sale_id, product_id, product_name, qty_input, unit,
                qty_pieces, unit_price_paisa, line_total_paisa, line_no,
                unit_cost_paisa, tax_rate_bp, tax_paisa
         FROM sale_lines ORDER BY sale_id, line_no`,
      )
      .all();

    // Statuses only — omit payload_json / raw_detail (raw tax provider secrets)
    const tax_documents = this.db.raw
      .prepare(
        `SELECT id, sale_id, status, provider_ref, reason_stub,
                disposition, disposed_at, disposed_by,
                client_device_at, created_at, updated_at
         FROM tax_documents ORDER BY created_at`,
      )
      .all();

    // Stock count history (D29-l) — export so Dashboard/shrinkage survive restore
    const stock_count_sessions = this.db.raw
      .prepare(
        `SELECT id, store_id, status, source, started_by, posted_by, note,
                started_at, posted_at, cancelled_at, items_total_at_post
         FROM stock_count_sessions
         WHERE store_id = ?
         ORDER BY started_at`,
      )
      .all(input.storeId);

    const stock_count_lines = this.db.raw
      .prepare(
        `SELECT l.id, l.session_id, l.product_id, l.system_qty_snapshot,
                l.counted_qty, l.reason_code, l.unit_cost_paisa_snapshot, l.updated_at
         FROM stock_count_lines l
         JOIN stock_count_sessions s ON s.id = l.session_id
         WHERE s.store_id = ?
         ORDER BY l.session_id, l.updated_at`,
      )
      .all(input.storeId);

    const stock_adjustments = this.db.raw
      .prepare(
        `SELECT a.id, a.product_id, a.session_id, a.line_id, a.delta_pieces,
                a.qty_before, a.qty_after, a.reason, a.reason_code, a.unit_cost_paisa,
                a.created_by, a.created_at, a.note
         FROM stock_adjustments a
         LEFT JOIN stock_count_sessions s ON s.id = a.session_id
         WHERE s.store_id = ? OR a.session_id IS NULL
         ORDER BY a.created_at`,
      )
      .all(input.storeId);

    // v2 — suppliers, purchases, payments, receives, expenses (restore clears these).
    const suppliers = this.db.raw
      .prepare(
        `SELECT id, name, contact_name, phone, address, active, created_at, updated_at
         FROM suppliers ORDER BY created_at, id`,
      )
      .all();

    const supplier_payments = this.db.raw
      .prepare(
        `SELECT id, supplier_id, amount_paisa, paid_on, note, created_at
         FROM supplier_payments ORDER BY created_at, id`,
      )
      .all();

    const purchase_invoices = this.db.raw
      .prepare(
        `SELECT id, supplier_id, subtotal_paisa, discount_paisa, total_paisa,
                paid_paisa, due_paisa, purchased_on, note, created_by, created_at
         FROM purchase_invoices ORDER BY created_at, id`,
      )
      .all();

    const purchase_lines = this.db.raw
      .prepare(
        `SELECT id, invoice_id, product_id, pieces, line_amount_paisa,
                discount_share_paisa, unit_cost_paisa, mode, cartons, units_per_carton
         FROM purchase_lines ORDER BY invoice_id, rowid`,
      )
      .all();

    const stock_receives = this.db.raw
      .prepare(
        `SELECT id, product_id, qty_input, unit, qty_pieces, received_by, note,
                amount_paisa, unit_cost_paisa, supplier_id, paid_now,
                purchase_invoice_id, created_at
         FROM stock_receives ORDER BY created_at, rowid`,
      )
      .all();

    const expenses = this.db.raw
      .prepare(
        `SELECT id, kind, amount_paisa, expense_date, note, created_by, created_at,
                staff_id, from_drawer
         FROM expenses ORDER BY expense_date, created_at, id`,
      )
      .all();

    // v5: staff profiles (no PIN data) and salary khata.
    const staff = this.db.raw
      .prepare(
        `SELECT id, user_id, name, role_code, position, phone, address, monthly_salary_paisa,
                left_at, created_at, updated_at
         FROM staff ORDER BY created_at, id`,
      )
      .all();
    const staff_ledger = this.db.raw
      .prepare(
        `SELECT id, staff_id, entry_date, kind, amount_paisa, period, expense_id, note,
                created_by, created_at, voided_at
         FROM staff_ledger ORDER BY created_at, rowid`,
      )
      .all();
    const till_shifts = this.db.raw
      .prepare(
        `SELECT id, opened_at, opened_by, opening_float_paisa, closed_at, closed_by,
                expected_paisa, counted_paisa, over_short_paisa, summary_json, note, till_id
         FROM till_shifts ORDER BY opened_at, id`,
      )
      .all();
    const till_moves = this.db.raw
      .prepare(
        `SELECT id, shift_id, kind, amount_paisa, reason, created_by, created_at
         FROM till_moves ORDER BY created_at, id`,
      )
      .all();

    const exportedAt = new Date().toISOString();
    const raw: StoreExportBundle = {
      header: {
        product: BACKUP_PRODUCT,
        format: BACKUP_FORMAT,
        schema_version: BACKUP_SCHEMA_VERSION,
        exported_at: exportedAt,
        data_region_disclosed: BACKUP_DATA_REGION,
        store_id: String(store.id),
      },
      store,
      products,
      stock_balances,
      parties,
      party_ledger,
      sales,
      sale_lines,
      sale_returns,
      sale_return_lines,
      tax_documents,
      stock_count_sessions,
      stock_count_lines,
      stock_adjustments,
      suppliers,
      supplier_payments,
      purchase_invoices,
      purchase_lines,
      stock_receives,
      expenses,
      product_images,
      staff,
      staff_ledger,
      till_shifts,
      till_moves,
      batch2: exportBatch2(this.db.raw),
    };

    const scrubbed = scrubSecrets(raw) as StoreExportBundle;

    // "Last saved" is recorded later by confirmSaved(), once the file is on disk.
    const copyId = randomUUID();
    this.prunePendingCopies();
    this.pendingCopies.set(copyId, {
      storeId: input.storeId,
      userId: input.userId,
      createdAt: Date.now(),
      payload: {
        exported_at: exportedAt,
        data_region_disclosed: BACKUP_DATA_REGION,
        schema_version: BACKUP_SCHEMA_VERSION,
        product_count: scrubbed.products.length,
        sale_count: scrubbed.sales.length,
        party_count: scrubbed.parties.length,
        tax_document_count: scrubbed.tax_documents.length,
        purchase_invoice_count: purchase_invoices.length,
        supplier_count: suppliers.length,
        expense_count: expenses.length,
      },
    });

    const day = exportedAt.slice(0, 10);
    const filename = `dukaandesk-backup-${String(store.id).slice(0, 8)}-${day}.json`;

    this.log.log(
      `backup.export store=${store.id} products=${scrubbed.products.length} sales=${scrubbed.sales.length}`,
    );

    return {
      ok: true,
      bundle: scrubbed,
      copyId,
      filename,
    };
  }

  /**
   * Validate export header (no DB writes). Wrong product/format/version → clear code.
   */
  validateRestoreHeader(
    bundle: unknown,
  ):
    | { ok: true; bundle: StoreExportBundle }
    | { ok: false; code: RestoreHeaderErrorCode; reason: string } {
    if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
      return {
        ok: false,
        code: 'invalid_backup_bundle',
        reason: 'bundle must be a JSON object',
      };
    }
    const b = bundle as Record<string, unknown>;
    const header = b.header;
    if (!header || typeof header !== 'object' || Array.isArray(header)) {
      return {
        ok: false,
        code: 'invalid_backup_bundle',
        reason: 'bundle.header required',
      };
    }
    const h = header as Record<string, unknown>;

    if (h.product !== BACKUP_PRODUCT) {
      return {
        ok: false,
        code: 'invalid_backup_product',
        reason: `product must be ${BACKUP_PRODUCT}`,
      };
    }
    if (h.format !== BACKUP_FORMAT) {
      return {
        ok: false,
        code: 'invalid_backup_format',
        reason: `format must be ${BACKUP_FORMAT}`,
      };
    }
    const version = h.schema_version;
    if (
      typeof version !== 'number' ||
      !Number.isInteger(version) ||
      version < BACKUP_MIN_SCHEMA_VERSION ||
      version > BACKUP_SCHEMA_VERSION
    ) {
      return {
        ok: false,
        code: 'invalid_backup_schema_version',
        reason: `schema_version must be ${BACKUP_MIN_SCHEMA_VERSION}..${BACKUP_SCHEMA_VERSION}`,
      };
    }

    if (!b.store || typeof b.store !== 'object' || Array.isArray(b.store)) {
      return {
        ok: false,
        code: 'invalid_backup_bundle',
        reason: 'bundle.store required',
      };
    }

    for (const key of [
      'products',
      'stock_balances',
      'parties',
      'party_ledger',
      'sales',
      'sale_lines',
      'tax_documents',
    ] as const) {
      if (!Array.isArray(b[key])) {
        return {
          ok: false,
          code: 'invalid_backup_bundle',
          reason: `bundle.${key} must be an array`,
        };
      }
    }

    // v2 copies must carry every table restore clears.
    if (version >= 2) {
      for (const key of [
        ...BACKUP_STOCK_COUNT_KEYS,
        ...BACKUP_PURCHASE_KEYS,
        'expenses',
      ] as const) {
        if (!Array.isArray(b[key])) {
          return {
            ok: false,
            code: 'invalid_backup_bundle',
            reason: `bundle.${key} must be an array`,
          };
        }
      }
    }

    if (version >= 7 && (typeof b.batch2 !== 'object' || b.batch2 == null)) {
      return { ok: false, code: 'invalid_backup_bundle', reason: 'bundle.batch2 must be an object' };
    }

    if (version >= 6) {
      for (const key of ['till_shifts', 'till_moves'] as const) {
        if (!Array.isArray(b[key])) {
          return { ok: false, code: 'invalid_backup_bundle', reason: `bundle.${key} must be an array` };
        }
      }
    }

    if (version >= 5) {
      for (const key of ['staff', 'staff_ledger'] as const) {
        if (!Array.isArray(b[key])) {
          return { ok: false, code: 'invalid_backup_bundle', reason: `bundle.${key} must be an array` };
        }
      }
    }

    // v3 copies carry returns.
    if (version >= 3) {
      for (const key of ['sale_returns', 'sale_return_lines'] as const) {
        if (!Array.isArray(b[key])) {
          return {
            ok: false,
            code: 'invalid_backup_bundle',
            reason: `bundle.${key} must be an array`,
          };
        }
      }
    }

    // Optional on older schema_version=1 bundles (missing → left untouched).
    for (const key of [
      ...BACKUP_STOCK_COUNT_KEYS,
      ...BACKUP_PURCHASE_KEYS,
      'expenses',
    ] as const) {
      if (b[key] !== undefined && !Array.isArray(b[key])) {
        return {
          ok: false,
          code: 'invalid_backup_bundle',
          reason: `bundle.${key} must be an array when present`,
        };
      }
    }

    return { ok: true, bundle: b as StoreExportBundle };
  }

  /**
   * Replace local shop domain data from a prior export.
   * Keeps users / roles so Owner PIN still works. Validates header before mutate.
   */
  restoreStore(input: {
    storeId: string;
    userId: string;
    pin: string;
    bundle: unknown;
  }): RestoreResult {
    const headerCheck = this.validateRestoreHeader(input.bundle);
    if (!headerCheck.ok) {
      return {
        ok: false,
        code: headerCheck.code,
        reason: headerCheck.reason,
      };
    }
    const bundle = headerCheck.bundle;

    if (!isValidPinFormat(input.pin)) {
      return { ok: false, code: 'invalid_pin', reason: 'invalid PIN format' };
    }

    const pinCheck = this.auth.pinLogin(input.userId, input.pin);
    if (!pinCheck.ok) {
      return { ok: false, code: 'bad_pin', reason: 'invalid owner PIN' };
    }
    if (pinCheck.user.role !== 'owner') {
      return { ok: false, code: 'bad_pin', reason: 'owner PIN required' };
    }

    const localStore = this.db.raw
      .prepare(
        `SELECT id, name, phone, address, receipt_footer, locale_default,
                receipt_printer_name, receipt_width_mm, receipt_print_enabled,
                reports_printer_name, reports_paper,
                label_printer_name, label_size, label_per_row,
                created_at, updated_at
         FROM store WHERE id = ?`,
      )
      .get(input.storeId) as Record<string, unknown> | undefined;
    if (!localStore) {
      return { ok: false, code: 'not_found', reason: 'store not found' };
    }

    const localUserIds = new Set(
      (
        this.db.raw.prepare(`SELECT id FROM users`).all() as Array<{ id: string }>
      ).map((r) => r.id),
    );

    const srcStore = bundle.store as Record<string, unknown>;
    const storeName =
      typeof srcStore.name === 'string' && srcStore.name.trim()
        ? String(srcStore.name).trim()
        : String(localStore.name);
    const storeAddress =
      srcStore.address === null || srcStore.address === undefined
        ? null
        : String(srcStore.address);
    // Optional Slice 13 fields — tolerate missing keys on older schema_version=1 bundles.
    const storePhone =
      srcStore.phone === undefined
        ? localStore.phone == null
          ? null
          : String(localStore.phone)
        : srcStore.phone === null
          ? null
          : String(srcStore.phone);
    const storeReceiptFooter =
      srcStore.receipt_footer === undefined
        ? localStore.receipt_footer == null
          ? null
          : String(localStore.receipt_footer)
        : srcStore.receipt_footer === null
          ? null
          : String(srcStore.receipt_footer);
    const localeDefault =
      typeof srcStore.locale_default === 'string' && srcStore.locale_default
        ? String(srcStore.locale_default)
        : 'en';
    // Tax V1 — tolerant: pre-028 bundles have no tax keys → OFF / 0 (R1).
    const storeTaxRateBp = normalizeRateBp(srcStore.sales_tax_rate_bp ?? 0);
    const storeTaxEnabled =
      Number(srcStore.sales_tax_enabled ?? 0) === 1 && storeTaxRateBp > 0 ? 1 : 0;
    const storeCreatedAt =
      typeof srcStore.created_at === 'string'
        ? srcStore.created_at
        : String(localStore.created_at);
    const storeUpdatedAt =
      typeof srcStore.updated_at === 'string'
        ? srcStore.updated_at
        : new Date().toISOString();

    const products = bundle.products as Array<Record<string, unknown>>;
    const stockBalances = bundle.stock_balances as Array<
      Record<string, unknown>
    >;
    const parties = bundle.parties as Array<Record<string, unknown>>;
    const partyLedger = bundle.party_ledger as Array<Record<string, unknown>>;
    const sales = bundle.sales as Array<Record<string, unknown>>;
    const saleLines = bundle.sale_lines as Array<Record<string, unknown>>;
    const taxDocuments = bundle.tax_documents as Array<Record<string, unknown>>;

    // Table groups the copy carries. A group the copy lacks (older copies) is
    // left exactly as it is today instead of being wiped.
    const b = bundle as unknown as Record<string, unknown>;
    const rows = (key: string) =>
      (Array.isArray(b[key]) ? b[key] : []) as Array<Record<string, unknown>>;
    const restoreCounts = BACKUP_STOCK_COUNT_KEYS.some((k) => Array.isArray(b[k]));
    const restorePurchases = BACKUP_PURCHASE_KEYS.every((k) => Array.isArray(b[k]));
    const restoreExpenses = Array.isArray(b.expenses);
    // v4 copies carry pictures. Older copies keep each product's current one.
    const copyHasImages = Number(bundle.header?.schema_version ?? 0) >= 4;
    const copyImages = new Map<string, Buffer>();
    if (copyHasImages && Array.isArray(b.product_images)) {
      for (const img of b.product_images as Array<Record<string, unknown>>) {
        const file = String(img?.file ?? '');
        if (!IMAGE_FILE_RE.test(file)) continue;
        const data = decodeImagePayload(img?.data_base64);
        if (data) copyImages.set(file, data);
      }
    }
    const currentImages = new Map(
      (
        this.db.raw
          .prepare(`SELECT id, image_file FROM products WHERE image_file IS NOT NULL`)
          .all() as Array<{ id: string; image_file: string }>
      ).map((r) => [r.id, r.image_file]),
    );

    const stockCountSessions = rows('stock_count_sessions');
    const stockCountLines = rows('stock_count_lines');
    const stockAdjustments = rows('stock_adjustments');
    const suppliers = rows('suppliers');
    const supplierPayments = rows('supplier_payments');
    const purchaseInvoices = rows('purchase_invoices');
    const purchaseLines = rows('purchase_lines');
    const stockReceives = rows('stock_receives');
    const expenses = rows('expenses');
    // v5 copies carry staff + salary khata. Older copies keep staff profiles;
    // the khata goes when expenses are replaced (its payments live there).
    const copyHasStaff = Number(bundle.header?.schema_version ?? 0) >= 5;
    const staffRows = rows('staff');
    const staffLedger = rows('staff_ledger');
    // v6 copies carry till shifts. Older copies clear them (their bills are replaced).
    const tillShifts = rows('till_shifts');
    const tillMoves = rows('till_moves');

    const kept: string[] = [];
    if (!restoreCounts) kept.push('stock_counts');
    if (!restorePurchases) kept.push('purchases');
    if (!restoreExpenses) kept.push('expenses');

    const restoredAt = new Date().toISOString();
    const auditId = randomUUID();

    const str = (v: unknown): string | null =>
      v === null || v === undefined ? null : String(v);
    const int = (v: unknown, fallback = 0): number => {
      const n = Math.round(Number(v));
      return Number.isFinite(n) ? n : fallback;
    };
    const intOrNull = (v: unknown): number | null =>
      v === null || v === undefined || v === '' ? null : int(v);
    /** Nullable user reference: keep only users that exist on this PC. */
    const userOrNull = (v: unknown): string | null => {
      const id = str(v);
      return id && localUserIds.has(id) ? id : null;
    };

    const run = this.db.raw.transaction(() => {
      // Rows are wiped and re-inserted in one go; check foreign keys at commit
      // so the delete / insert order cannot trip a temporary mismatch.
      this.db.raw.pragma('defer_foreign_keys = ON');

      // Wipe tables the copy carries. Keep users, roles, audit_log,
      // schema_migrations, store row id, and any group the copy lacks.
      wipeBatch2(this.db.raw);
      this.db.raw.prepare(`DELETE FROM till_moves`).run();
      this.db.raw.prepare(`DELETE FROM till_shifts`).run();
      this.db.raw.prepare(`DELETE FROM party_ledger`).run();
      // Returns hang off the bills being replaced; they go with them.
      this.db.raw.prepare(`DELETE FROM sale_return_lines`).run();
      this.db.raw.prepare(`DELETE FROM sale_returns`).run();
      this.db.raw.prepare(`DELETE FROM sale_lines`).run();
      this.db.raw.prepare(`DELETE FROM tax_documents`).run();
      // Lite: stock review items point at bills; a JSON copy does not carry them.
      this.db.raw.prepare(`DELETE FROM stock_reviews`).run();
      this.db.raw.prepare(`DELETE FROM sales`).run();
      if (restorePurchases) {
        this.db.raw.prepare(`DELETE FROM purchase_extras`).run();
        this.db.raw.prepare(`DELETE FROM purchase_lines`).run();
        this.db.raw.prepare(`DELETE FROM supplier_payments`).run();
        this.db.raw.prepare(`DELETE FROM stock_receives`).run();
        this.db.raw.prepare(`DELETE FROM purchase_invoices`).run();
        this.db.raw.prepare(`DELETE FROM suppliers`).run();
      }
      if (restoreCounts) {
        this.db.raw.prepare(`DELETE FROM stock_adjustments`).run();
        this.db.raw.prepare(`DELETE FROM stock_count_lines`).run();
        this.db.raw.prepare(`DELETE FROM stock_count_sessions`).run();
      }
      if (restoreExpenses || copyHasStaff) {
        this.db.raw.prepare(`DELETE FROM staff_ledger`).run();
      }
      if (restoreExpenses) {
        this.db.raw.prepare(`DELETE FROM expenses`).run();
      }
      if (copyHasStaff) {
        this.db.raw.prepare(`DELETE FROM staff`).run();
      }

      // Products still used by kept rows (older copy, newer purchase / count)
      // but missing from the copy stay as they are, with their stock.
      const copyProductIds = new Set(products.map((p) => String(p.id)));
      const keepProductIds = new Set<string>();
      const keepRefs: string[] = [];
      if (!restorePurchases) {
        keepRefs.push(
          `SELECT product_id FROM purchase_lines`,
          `SELECT product_id FROM stock_receives`,
        );
      }
      if (!restoreCounts) {
        keepRefs.push(
          `SELECT product_id FROM stock_count_lines`,
          `SELECT product_id FROM stock_adjustments`,
        );
      }
      for (const sql of keepRefs) {
        for (const r of this.db.raw.prepare(sql).all() as Array<{
          product_id: string;
        }>) {
          if (!copyProductIds.has(r.product_id)) keepProductIds.add(r.product_id);
        }
      }
      const keepJson = JSON.stringify([...keepProductIds]);
      this.db.raw
        .prepare(
          `DELETE FROM stock_balances
           WHERE product_id NOT IN (SELECT value FROM json_each(?))`,
        )
        .run(keepJson);
      this.db.raw.prepare(`DELETE FROM parties`).run();
      this.db.raw
        .prepare(
          `DELETE FROM products WHERE id NOT IN (SELECT value FROM json_each(?))`,
        )
        .run(keepJson);

      this.db.raw
        .prepare(
          `UPDATE store
           SET name = ?, phone = ?, address = ?, receipt_footer = ?,
               locale_default = ?,
               sales_tax_enabled = ?, sales_tax_rate_bp = ?,
               receipt_printer_name = ?, receipt_width_mm = ?,
               receipt_print_enabled = ?, reports_printer_name = ?,
               reports_paper = ?, label_printer_name = ?, label_size = ?,
               label_per_row = ?,
               created_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          storeName,
          storePhone,
          storeAddress,
          storeReceiptFooter,
          localeDefault,
          storeTaxEnabled,
          storeTaxRateBp,
          ...restorePrinterSettings(srcStore, localStore),
          storeCreatedAt,
          storeUpdatedAt,
          input.storeId,
        );

      const insertProduct = this.db.raw.prepare(
        `INSERT INTO products
           (id, sku, name, name_ur, unit_label, price_paisa, active,
            pieces_per_carton, last_unit_cost_paisa, barcode, image_file,
            discount_kind, discount_value, discount_start_at, discount_end_at,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const imageFor = (p: Record<string, unknown>): string | null => {
        if (!copyHasImages) return currentImages.get(String(p.id)) ?? null;
        const f = typeof p.image_file === 'string' ? p.image_file : '';
        return copyImages.has(f) ? f : null;
      };
      for (const p of products) {
        const rawBarcode = p.barcode == null ? '' : String(p.barcode);
        const barcode = rawBarcode.trim() ? rawBarcode.trim() : null;
        // Older backups have no discount columns: restore as no discount.
        const discountKind =
          p.discount_kind === 'percent' || p.discount_kind === 'fixed'
            ? p.discount_kind
            : null;
        const discountValue = discountKind
          ? Math.max(0, Math.round(Number(p.discount_value ?? 0)) || 0)
          : null;
        const discountDate = (v: unknown): string | null => {
          if (!discountKind || typeof v !== 'string' || !v.trim()) return null;
          return Number.isNaN(Date.parse(v)) ? null : v.trim();
        };
        insertProduct.run(
          String(p.id),
          p.sku == null ? null : String(p.sku),
          String(p.name ?? ''),
          p.name_ur == null ? null : String(p.name_ur),
          String(p.unit_label ?? 'piece'),
          Number(p.price_paisa ?? 0),
          Number(p.active ?? 1),
          Number(p.pieces_per_carton ?? 1),
          p.last_unit_cost_paisa == null || p.last_unit_cost_paisa === undefined
            ? null
            : Math.round(Number(p.last_unit_cost_paisa)),
          barcode,
          imageFor(p),
          discountKind,
          discountKind === 'percent'
            ? Math.min(10000, discountValue ?? 0)
            : discountValue,
          discountDate(p.discount_start_at),
          discountDate(p.discount_end_at),
          String(p.created_at ?? restoredAt),
          String(p.updated_at ?? restoredAt),
        );
      }
      this.catalog.backfillMissingBarcodes();

      const insertStock = this.db.raw.prepare(
        `INSERT INTO stock_balances (product_id, qty_on_hand, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(product_id) DO UPDATE SET qty_on_hand = excluded.qty_on_hand, updated_at = excluded.updated_at`,
      );
      for (const s of stockBalances) {
        insertStock.run(
          String(s.product_id),
          Math.max(0, Number(s.qty_on_hand ?? 0)),
          String(s.updated_at ?? restoredAt),
        );
      }

      if (restorePurchases) {
        const insertSupplier = this.db.raw.prepare(
          `INSERT INTO suppliers
             (id, name, contact_name, phone, address, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const sup of suppliers) {
          insertSupplier.run(
            String(sup.id),
            String(sup.name ?? ''),
            str(sup.contact_name),
            str(sup.phone),
            str(sup.address),
            Number(sup.active ?? 1) === 0 ? 0 : 1,
            String(sup.created_at ?? restoredAt),
            String(sup.updated_at ?? restoredAt),
          );
        }

        const insertInvoice = this.db.raw.prepare(
          `INSERT INTO purchase_invoices
             (id, supplier_id, subtotal_paisa, discount_paisa, total_paisa,
              paid_paisa, due_paisa, purchased_on, note, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const inv of purchaseInvoices) {
          insertInvoice.run(
            String(inv.id),
            String(inv.supplier_id),
            Math.max(0, int(inv.subtotal_paisa)),
            Math.max(0, int(inv.discount_paisa)),
            Math.max(0, int(inv.total_paisa)),
            Math.max(0, int(inv.paid_paisa)),
            Math.max(0, int(inv.due_paisa)),
            String(inv.purchased_on ?? restoredAt.slice(0, 10)),
            str(inv.note),
            userOrNull(inv.created_by),
            String(inv.created_at ?? restoredAt),
          );
        }

        const insertPurchaseLine = this.db.raw.prepare(
          `INSERT INTO purchase_lines
             (id, invoice_id, product_id, pieces, line_amount_paisa,
              discount_share_paisa, unit_cost_paisa, mode, cartons, units_per_carton)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const line of purchaseLines) {
          insertPurchaseLine.run(
            String(line.id),
            String(line.invoice_id),
            String(line.product_id),
            Math.max(0.001, r3(Number(line.pieces ?? 1)) || 1),
            Math.max(0, int(line.line_amount_paisa)),
            Math.max(0, int(line.discount_share_paisa)),
            Math.max(0, int(line.unit_cost_paisa)),
            line.mode === 'carton' ? 'carton' : 'loose',
            intOrNull(line.cartons),
            intOrNull(line.units_per_carton),
          );
        }

        const insertReceive = this.db.raw.prepare(
          `INSERT INTO stock_receives
             (id, product_id, qty_input, unit, qty_pieces, received_by, note,
              amount_paisa, unit_cost_paisa, supplier_id, paid_now,
              purchase_invoice_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const r of stockReceives) {
          insertReceive.run(
            String(r.id),
            String(r.product_id),
            Math.max(0.001, r3(Number(r.qty_input ?? 1)) || 1),
            r.unit === 'carton' ? 'carton' : 'piece',
            Math.max(0.001, r3(Number(r.qty_pieces ?? 1)) || 1),
            userOrNull(r.received_by),
            str(r.note),
            intOrNull(r.amount_paisa),
            intOrNull(r.unit_cost_paisa),
            str(r.supplier_id),
            Number(r.paid_now ?? 0) === 1 ? 1 : 0,
            str(r.purchase_invoice_id),
            String(r.created_at ?? restoredAt),
          );
        }

        const insertPayment = this.db.raw.prepare(
          `INSERT INTO supplier_payments
             (id, supplier_id, amount_paisa, paid_on, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        );
        for (const pay of supplierPayments) {
          insertPayment.run(
            String(pay.id),
            String(pay.supplier_id),
            Math.max(1, int(pay.amount_paisa, 1)),
            String(pay.paid_on ?? restoredAt.slice(0, 10)),
            str(pay.note),
            String(pay.created_at ?? restoredAt),
          );
        }
      }

      const insertParty = this.db.raw.prepare(
        `INSERT INTO parties (id, store_id, name, phone, address, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const party of parties) {
        const addr =
          party.address == null || party.address === undefined
            ? null
            : String(party.address);
        insertParty.run(
          String(party.id),
          input.storeId,
          String(party.name ?? ''),
          party.phone == null ? null : String(party.phone),
          addr && addr.trim() ? addr.trim().slice(0, 240) : null,
          String(party.created_at ?? restoredAt),
          String(party.updated_at ?? restoredAt),
        );
      }

      const insertSale = this.db.raw.prepare(
        `INSERT INTO sales
           (id, short_id, store_id, sold_by, payment_method, party_id,
            total_paisa, cash_amount_paisa, udhaar_amount_paisa,
            tendered_paisa, change_paisa,
            client_device_at, recorded_at, created_at, voided_at, tax_flagged,
            tax_enabled, tax_rate_bp, tax_paisa, tax_base_paisa,
            voided_by, void_reason, replaces_sale_id, replaced_by_sale_id, till_id, bill_no)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      // Lite: keep the till and bill number when that till exists here; else Till 1 without a number.
      const tillIds = new Set(
        (this.db.raw.prepare(`SELECT id FROM tills`).all() as Array<{ id: string }>).map((r) => r.id),
      );
      for (const sale of sales) {
        const soldByRaw =
          sale.sold_by == null ? null : String(sale.sold_by);
        const soldBy =
          soldByRaw && localUserIds.has(soldByRaw) ? soldByRaw : input.userId;
        const total = Number(sale.total_paisa ?? 0);
        let cash = Number(sale.cash_amount_paisa ?? 0);
        let udhaar = Number(sale.udhaar_amount_paisa ?? 0);
        const method = String(sale.payment_method ?? 'cash');
        // Normalize split amounts if older export omitted them.
        if (method === 'cash') {
          cash = total;
          udhaar = 0;
        } else if (method === 'udhaar') {
          cash = 0;
          udhaar = total;
        } else if (cash + udhaar !== total) {
          // Prefer explicit fields; fall back to treating remainder as udhaar.
          if (cash === 0 && udhaar === 0) {
            cash = 0;
            udhaar = total;
          } else {
            udhaar = Math.max(0, total - cash);
            cash = total - udhaar;
          }
        }
        const tenderedRaw = sale.tendered_paisa;
        const changeRaw = sale.change_paisa;
        const tendered =
          tenderedRaw == null || tenderedRaw === undefined
            ? cash
            : Math.max(0, Math.round(Number(tenderedRaw)));
        const change =
          changeRaw == null || changeRaw === undefined
            ? Math.max(0, tendered - cash)
            : Math.max(0, Math.round(Number(changeRaw)));
        insertSale.run(
          String(sale.id),
          String(sale.short_id),
          input.storeId,
          soldBy,
          method,
          sale.party_id == null ? null : String(sale.party_id),
          total,
          cash,
          udhaar,
          tendered,
          change,
          String(sale.client_device_at ?? restoredAt),
          String(sale.recorded_at ?? restoredAt),
          String(sale.created_at ?? restoredAt),
          sale.voided_at == null ? null : String(sale.voided_at),
          Number(sale.tax_flagged ?? 0),
          ...restoreSaleTax(sale, total),
          userOrNull(sale.voided_by),
          str(sale.void_reason),
          str(sale.replaces_sale_id),
          str(sale.replaced_by_sale_id),
          sale.till_id && tillIds.has(String(sale.till_id)) ? String(sale.till_id) : 'till-1',
          sale.till_id && tillIds.has(String(sale.till_id)) && sale.bill_no != null ? Number(sale.bill_no) : null,
        );
      }
      // Bill counters always continue after the highest number now on file.
      this.db.raw
        .prepare(
          `UPDATE tills SET next_bill_no = GREATEST(next_bill_no,
             COALESCE((SELECT MAX(s.bill_no) FROM sales s WHERE s.till_id = tills.id), 0) + 1)`,
        )
        .run();

      const insertLine = this.db.raw.prepare(
        `INSERT INTO sale_lines
           (id, sale_id, product_id, product_name, qty_input, unit,
            qty_pieces, unit_price_paisa, line_total_paisa, line_no,
            unit_cost_paisa, tax_rate_bp, tax_paisa)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const line of saleLines) {
        insertLine.run(
          String(line.id),
          String(line.sale_id),
          String(line.product_id),
          String(line.product_name ?? ''),
          Number(line.qty_input ?? 1),
          String(line.unit ?? 'piece'),
          Number(line.qty_pieces ?? 1),
          Number(line.unit_price_paisa ?? 0),
          Number(line.line_total_paisa ?? 0),
          Number(line.line_no ?? 0),
          line.unit_cost_paisa == null || line.unit_cost_paisa === undefined
            ? null
            : Math.round(Number(line.unit_cost_paisa)),
          normalizeRateBp(line.tax_rate_bp ?? 0),
          Math.max(0, Math.round(Number(line.tax_paisa ?? 0)) || 0),
        );
      }

      const insertLedger = this.db.raw.prepare(
        `INSERT INTO party_ledger
           (id, party_id, entry_type, amount_paisa, sale_id, note,
            collected_on, created_at, return_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertReturn = this.db.raw.prepare(
        `INSERT INTO sale_returns
           (id, short_id, sale_id, store_id, party_id, returned_by, total_paisa,
            refund_cash_paisa, refund_khata_paisa, reason, client_device_at,
            recorded_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      // Returns only come back from v3+ copies; older copies clear them.
      const withReturns = Number(bundle.header?.schema_version ?? 0) >= 3;
      for (const r of withReturns ? rows('sale_returns') : []) {
        insertReturn.run(
          String(r.id),
          String(r.short_id),
          String(r.sale_id),
          input.storeId,
          str(r.party_id),
          userOrNull(r.returned_by),
          int(r.total_paisa),
          int(r.refund_cash_paisa),
          int(r.refund_khata_paisa),
          str(r.reason),
          String(r.client_device_at ?? restoredAt),
          String(r.recorded_at ?? restoredAt),
          String(r.created_at ?? restoredAt),
        );
      }
      const insertReturnLine = this.db.raw.prepare(
        `INSERT INTO sale_return_lines
           (id, return_id, sale_line_id, product_id, product_name, qty_pieces,
            unit_price_paisa, line_total_paisa, unit_cost_paisa, restocked, line_no)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const l of withReturns ? rows('sale_return_lines') : []) {
        insertReturnLine.run(
          String(l.id),
          String(l.return_id),
          String(l.sale_line_id),
          String(l.product_id),
          String(l.product_name ?? ''),
          Math.max(0.001, r3(Number(l.qty_pieces ?? 1)) || 1),
          int(l.unit_price_paisa),
          int(l.line_total_paisa),
          intOrNull(l.unit_cost_paisa),
          int(l.restocked, 1) === 0 ? 0 : 1,
          int(l.line_no),
        );
      }
      for (const entry of partyLedger) {
        const createdAt = String(entry.created_at ?? restoredAt);
        const collectedRaw = entry.collected_on;
        const returnId = withReturns ? str(entry.return_id) : null;
        // Key present with null = not cash (removed / returned bills). Only a
        // missing key (very old copies) falls back to the entry date.
        const collectedOn =
          collectedRaw === undefined
            ? entry.entry_type === 'credit' && createdAt.length >= 10
              ? createdAt.slice(0, 10)
              : null
            : collectedRaw === null
              ? null
              : String(collectedRaw);
        insertLedger.run(
          String(entry.id),
          String(entry.party_id),
          String(entry.entry_type),
          Number(entry.amount_paisa),
          entry.sale_id == null ? null : String(entry.sale_id),
          entry.note == null ? null : String(entry.note),
          collectedOn,
          createdAt,
          returnId,
        );
      }

      const insertTax = this.db.raw.prepare(
        `INSERT INTO tax_documents
           (id, sale_id, status, payload_json, provider_ref, reason_stub,
            raw_detail, disposition, disposed_at, disposed_by,
            client_device_at, created_at, updated_at)
         VALUES (?, ?, ?, '{}', ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      );
      for (const doc of taxDocuments) {
        insertTax.run(
          String(doc.id),
          doc.sale_id == null ? null : String(doc.sale_id),
          String(doc.status ?? 'queued'),
          doc.provider_ref == null ? null : String(doc.provider_ref),
          doc.reason_stub == null ? null : String(doc.reason_stub),
          doc.disposition == null ? null : String(doc.disposition),
          doc.disposed_at == null ? null : String(doc.disposed_at),
          doc.disposed_by == null ? null : String(doc.disposed_by),
          String(doc.client_device_at ?? restoredAt),
          String(doc.created_at ?? restoredAt),
          String(doc.updated_at ?? restoredAt),
        );
      }

      const reasonOrNull = (v: unknown): string | null => {
        if (v == null || v === undefined || v === '') return null;
        const s = String(v);
        return ['damaged', 'expired', 'stolen_lost', 'admin_error'].includes(s)
          ? s
          : null;
      };

      const insertSession = this.db.raw.prepare(
        `INSERT INTO stock_count_sessions
           (id, store_id, status, source, started_by, posted_by, note,
            started_at, posted_at, cancelled_at, items_total_at_post)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const s of stockCountSessions) {
        const startedByRaw =
          s.started_by == null ? null : String(s.started_by);
        const startedBy =
          startedByRaw && localUserIds.has(startedByRaw)
            ? startedByRaw
            : input.userId;
        const postedByRaw =
          s.posted_by == null ? null : String(s.posted_by);
        const postedBy =
          postedByRaw && localUserIds.has(postedByRaw) ? postedByRaw : null;
        const status = String(s.status ?? 'posted');
        const source = String(s.source ?? 'full_screen');
        insertSession.run(
          String(s.id),
          input.storeId,
          status === 'draft' || status === 'posted' || status === 'cancelled'
            ? status
            : 'posted',
          source === 'catalog_quick' ? 'catalog_quick' : 'full_screen',
          startedBy,
          postedBy,
          s.note == null ? null : String(s.note),
          String(s.started_at ?? restoredAt),
          s.posted_at == null ? null : String(s.posted_at),
          s.cancelled_at == null ? null : String(s.cancelled_at),
          s.items_total_at_post == null || s.items_total_at_post === undefined
            ? null
            : Math.round(Number(s.items_total_at_post)),
        );
      }

      const insertCountLine = this.db.raw.prepare(
        `INSERT INTO stock_count_lines
           (id, session_id, product_id, system_qty_snapshot, counted_qty,
            reason_code, unit_cost_paisa_snapshot, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const line of stockCountLines) {
        insertCountLine.run(
          String(line.id),
          String(line.session_id),
          String(line.product_id),
          r3(Number(line.system_qty_snapshot ?? 0)),
          line.counted_qty == null || line.counted_qty === undefined
            ? null
            : Math.max(0, r3(Number(line.counted_qty))),
          reasonOrNull(line.reason_code),
          line.unit_cost_paisa_snapshot == null ||
            line.unit_cost_paisa_snapshot === undefined
            ? null
            : Math.round(Number(line.unit_cost_paisa_snapshot)),
          String(line.updated_at ?? restoredAt),
        );
      }

      const insertAdj = this.db.raw.prepare(
        `INSERT INTO stock_adjustments
           (id, product_id, session_id, line_id, delta_pieces,
            qty_before, qty_after, reason, reason_code, unit_cost_paisa,
            created_by, created_at, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const a of stockAdjustments) {
        const delta = r3(Number(a.delta_pieces ?? 0));
        if (delta === 0) continue;
        const createdByRaw =
          a.created_by == null ? null : String(a.created_by);
        const createdBy =
          createdByRaw && localUserIds.has(createdByRaw)
            ? createdByRaw
            : input.userId;
        insertAdj.run(
          String(a.id),
          String(a.product_id),
          a.session_id == null ? null : String(a.session_id),
          a.line_id == null ? null : String(a.line_id),
          delta,
          r3(Number(a.qty_before ?? 0)),
          Math.max(0, r3(Number(a.qty_after ?? 0))),
          String(a.reason ?? 'stock_count'),
          reasonOrNull(a.reason_code),
          a.unit_cost_paisa == null || a.unit_cost_paisa === undefined
            ? null
            : Math.round(Number(a.unit_cost_paisa)),
          createdBy,
          String(a.created_at ?? restoredAt),
          a.note == null ? null : String(a.note),
        );
      }

      if (restoreExpenses) {
        const insertExpense = this.db.raw.prepare(
          `INSERT INTO expenses
             (id, kind, amount_paisa, expense_date, note, created_by, created_at, staff_id, from_drawer)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const e of expenses) {
          const kind = String(e.kind ?? 'bill');
          insertExpense.run(
            String(e.id),
            kind === 'salary' || kind === 'commission' ? kind : 'bill',
            Math.max(1, int(e.amount_paisa, 1)),
            String(e.expense_date ?? restoredAt.slice(0, 10)),
            str(e.note),
            userOrNull(e.created_by),
            String(e.created_at ?? restoredAt),
            copyHasStaff ? str(e.staff_id) : null,
            e.from_drawer === 0 || e.from_drawer === '0' ? 0 : 1,
          );
        }
      }

      if (copyHasStaff) {
        const roles = new Set(['owner', 'manager', 'cashier', 'data_entry', 'helper']);
        const insStaff = this.db.raw.prepare(
          `INSERT INTO staff
             (id, user_id, name, role_code, position, phone, address, monthly_salary_paisa,
              left_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, name = excluded.name, role_code = excluded.role_code,
             position = excluded.position, phone = excluded.phone, address = excluded.address,
             monthly_salary_paisa = excluded.monthly_salary_paisa, left_at = excluded.left_at,
             created_at = excluded.created_at, updated_at = excluded.updated_at`,
        );
        for (const s of staffRows) {
          const role = String(s.role_code ?? 'helper');
          // Logins stay as they are on this PC; a copy's login without a local user becomes no-login.
          insStaff.run(
            String(s.id),
            userOrNull(s.user_id),
            String(s.name ?? 'Staff').slice(0, 80),
            roles.has(role) ? role : 'helper',
            str(s.position),
            str(s.phone),
            str(s.address),
            intOrNull(s.monthly_salary_paisa),
            str(s.left_at),
            String(s.created_at ?? restoredAt),
            String(s.updated_at ?? restoredAt),
          );
        }
        // Local logins missing from the copy keep a profile.
        this.db.raw
          .prepare(
            `INSERT OR IGNORE INTO staff (id, user_id, name, role_code, left_at, created_at, updated_at)
             SELECT u.id, u.id, u.display_name, r.code, u.disabled_at, u.created_at, u.updated_at
             FROM users u JOIN roles r ON r.id = u.role_id
             WHERE u.pin_hash IS NOT NULL AND u.id NOT IN (SELECT COALESCE(user_id, '') FROM staff)`,
          )
          .run();
        const staffIds = new Set(
          (this.db.raw.prepare(`SELECT id FROM staff`).all() as Array<{ id: string }>).map((r) => r.id),
        );
        const expenseIds = new Set(
          (this.db.raw.prepare(`SELECT id FROM expenses`).all() as Array<{ id: string }>).map((r) => r.id),
        );
        const kinds = new Set(['salary_due', 'payment', 'advance', 'deduction', 'bonus']);
        const insLedger = this.db.raw.prepare(
          `INSERT INTO staff_ledger
             (id, staff_id, entry_date, kind, amount_paisa, period, expense_id, note, created_by, created_at, voided_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const l of staffLedger) {
          const sid = String(l.staff_id ?? '');
          const kind = String(l.kind ?? '');
          if (!staffIds.has(sid) || !kinds.has(kind)) continue;
          const exp = str(l.expense_id);
          insLedger.run(
            String(l.id),
            sid,
            String(l.entry_date ?? restoredAt.slice(0, 10)),
            kind,
            Math.max(1, int(l.amount_paisa, 1)),
            str(l.period),
            exp && expenseIds.has(exp) ? exp : null,
            str(l.note),
            userOrNull(l.created_by),
            String(l.created_at ?? restoredAt),
            str(l.voided_at),
          );
        }
      }

      {
        const insShift = this.db.raw.prepare(
          `INSERT INTO till_shifts (id, opened_at, opened_by, opening_float_paisa, closed_at, closed_by,
             expected_paisa, counted_paisa, over_short_paisa, summary_json, note, till_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        const shiftIds = new Set<string>();
        const shiftTills = new Set(
          (this.db.raw.prepare(`SELECT id FROM tills`).all() as Array<{ id: string }>).map((r) => r.id),
        );
        // At most one open shift per till survives.
        const openSeen = new Set<string>();
        for (const t of tillShifts) {
          const tillId = t.till_id && shiftTills.has(String(t.till_id)) ? String(t.till_id) : 'till-1';
          let closedAt = str(t.closed_at);
          if (!closedAt) {
            if (openSeen.has(tillId)) closedAt = restoredAt;
            openSeen.add(tillId);
          }
          insShift.run(
            String(t.id),
            String(t.opened_at ?? restoredAt),
            userOrNull(t.opened_by),
            Math.max(0, int(t.opening_float_paisa)),
            closedAt,
            userOrNull(t.closed_by),
            intOrNull(t.expected_paisa),
            intOrNull(t.counted_paisa),
            intOrNull(t.over_short_paisa),
            str(t.summary_json),
            str(t.note),
            tillId,
          );
          shiftIds.add(String(t.id));
        }
        const insMove = this.db.raw.prepare(
          `INSERT INTO till_moves (id, shift_id, kind, amount_paisa, reason, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const m of tillMoves) {
          const sid = String(m.shift_id ?? '');
          const kind = String(m.kind ?? '');
          if (!shiftIds.has(sid) || (kind !== 'in' && kind !== 'out')) continue;
          insMove.run(String(m.id), sid, kind, Math.max(1, int(m.amount_paisa, 1)), str(m.reason),
            userOrNull(m.created_by), String(m.created_at ?? restoredAt));
        }
      }

      // v7: Batch 2 columns + supplier returns + price history.
      restoreBatch2(this.db.raw, (bundle as { batch2?: Batch2Bundle }).batch2);

      this.db.raw
        .prepare(
          `INSERT INTO audit_log
             (id, action, user_id, store_id, subject_type, subject_id, payload_json)
           VALUES (?, ?, ?, ?, 'store', ?, ?)`,
        )
        .run(
          auditId,
          BACKUP_RESTORE_AUDIT_ACTION,
          input.userId,
          input.storeId,
          input.storeId,
          JSON.stringify({
            restored_at: restoredAt,
            source_exported_at: bundle.header.exported_at ?? null,
            schema_version: bundle.header.schema_version,
            kept_as_is: kept,
            product_count: products.length,
            sale_count: sales.length,
            party_count: parties.length,
            tax_document_count: taxDocuments.length,
            stock_count_session_count: stockCountSessions.length,
            stock_adjustment_count: stockAdjustments.length,
            supplier_count: restorePurchases ? suppliers.length : null,
            purchase_invoice_count: restorePurchases ? purchaseInvoices.length : null,
            expense_count: restoreExpenses ? expenses.length : null,
          }),
        );
    });

    // Pictures first: a failed restore only leaves unused files behind.
    if (copyImages.size) {
      const dir = this.catalog.imagesDir();
      for (const [file, data] of copyImages) {
        try {
          writeImageFile(dir, file, data);
        } catch (err) {
          this.log.warn(`backup.restore image ${file}: ${(err as Error)?.message ?? err}`);
        }
      }
    }

    try {
      run();
    } catch (err) {
      // Transaction rolled back — today's data is unchanged.
      this.log.warn(
        `backup.restore failed store=${input.storeId}: ${(err as Error)?.message ?? err}`,
      );
      return {
        ok: false,
        code: 'restore_failed',
        reason: 'copy data could not be restored; nothing was changed',
      };
    }

    this.log.log(
      `backup.restore store=${input.storeId} products=${products.length} sales=${sales.length}`,
    );

    return {
      ok: true,
      auditId,
      restored_at: restoredAt,
      counts: {
        products: products.length,
        stock_balances: stockBalances.length,
        parties: parties.length,
        party_ledger: partyLedger.length,
        sales: sales.length,
        sale_lines: saleLines.length,
        tax_documents: taxDocuments.length,
        stock_count_sessions: stockCountSessions.length,
        stock_count_lines: stockCountLines.length,
        stock_adjustments: stockAdjustments.length,
        suppliers: restorePurchases ? suppliers.length : null,
        supplier_payments: restorePurchases ? supplierPayments.length : null,
        purchase_invoices: restorePurchases ? purchaseInvoices.length : null,
        purchase_lines: restorePurchases ? purchaseLines.length : null,
        stock_receives: restorePurchases ? stockReceives.length : null,
        expenses: restoreExpenses ? expenses.length : null,
      },
      kept,
    };
  }
}

/** Deep-scrub forbidden keys from export payload. */
export function scrubSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(scrubSecrets);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_EXPORT_KEY_RE.test(k)) continue;
      out[k] = scrubSecrets(v);
    }
    return out;
  }
  return value;
}

/** True if serialized export mentions forbidden secret material. */
export function exportContainsSecrets(bundle: unknown): boolean {
  const raw = JSON.stringify(bundle);
  for (const s of FORBIDDEN_EXPORT_SUBSTRINGS) {
    if (raw.includes(s)) return true;
  }
  if (/"pin_hash"\s*:/.test(raw)) return true;
  if (/"payload_json"\s*:/.test(raw)) return true;
  if (/"raw_detail"\s*:/.test(raw)) return true;
  return false;
}

/**
 * Tax V1 sale snapshot from a backup row. Older bundles (pre-028) omit the
 * keys → OFF / 0 / NULL base, so historic totals never change.
 */
function restoreSaleTax(
  sale: Record<string, unknown>,
  totalPaisa: number,
): [number, number, number, number | null] {
  const enabled = Number(sale.tax_enabled ?? 0) === 1 ? 1 : 0;
  if (!enabled) return [0, 0, 0, null];
  const rateBp = normalizeRateBp(sale.tax_rate_bp ?? 0);
  const taxPaisa = Math.max(0, Math.round(Number(sale.tax_paisa ?? 0)) || 0);
  const baseRaw = sale.tax_base_paisa;
  const basePaisa =
    baseRaw == null ? totalPaisa - taxPaisa : Math.round(Number(baseRaw));
  return [1, rateBp, taxPaisa, basePaisa];
}

/**
 * Printer / receipt settings from the copy. Older copies have none → keep this
 * PC's current settings. Values are normalised again when Settings reads them.
 */
function restorePrinterSettings(
  src: Record<string, unknown>,
  local: Record<string, unknown>,
): [
  string | null,
  number,
  number,
  string | null,
  string,
  string | null,
  string,
  number,
] {
  const pick = (key: string) => (src[key] === undefined ? local[key] : src[key]);
  const name = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    const t = String(v).trim().slice(0, 200);
    return t ? t : null;
  };
  const num = (v: unknown, fallback: number): number => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? n : fallback;
  };
  const text = (v: unknown, fallback: string): string =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : fallback;
  return [
    name(pick('receipt_printer_name')),
    num(pick('receipt_width_mm'), 80),
    Number(pick('receipt_print_enabled') ?? 1) === 0 ? 0 : 1,
    name(pick('reports_printer_name')),
    text(pick('reports_paper'), 'a4'),
    name(pick('label_printer_name')),
    text(pick('label_size'), '50x25'),
    num(pick('label_per_row'), 3),
  ];
}
