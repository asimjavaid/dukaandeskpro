import { reverseSaleInTxn } from '../sales/sale-reversal';
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import {
  TAX_ADAPTER,
  TaxAdapterPort,
  TaxSimulateOutcome,
} from './tax-adapter.port';
import { normalizeRateBp, taxFromSalesBase } from './inclusive';

export type TaxDocStatus =
  | 'queued'
  | 'submitting'
  | 'accepted'
  | 'rejected'
  | 'authority_down'
  | 'credit_note_queued'
  | 'voided';

export type TaxDisposition = 'void' | 'keep_flag' | 'credit_note';

export type TaxQueueItem = {
  id: string;
  sale_id: string | null;
  status: string;
  provider_ref: string | null;
  reason_stub: string | null;
  disposition: string | null;
  client_device_at: string;
  created_at: string;
  sale_short_id: string | null;
  sale_total_paisa: number | null;
  payment_method: string | null;
  party_id: string | null;
  voided_at: string | null;
  tax_flagged: number | null;
};

@Injectable()
export class TaxService implements OnModuleInit, OnModuleDestroy {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly db: DbService,
    @Inject(TAX_ADAPTER) private readonly adapter: TaxAdapterPort,
  ) {}

  /**
   * Tax V1 (D30 LOCK): FBR is out of scope for P1. The simulate queue is
   * dormant — no background drain, no enqueue on sale. Historic
   * tax_documents rows are kept untouched (Owner-only read API).
   */
  static fbrEnabled(): boolean {
    return false;
  }

  onModuleInit() {
    if (!TaxService.fbrEnabled()) return;
    const ms = Number(process.env.TAX_PROCESS_INTERVAL_MS ?? 5000);
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.intervalHandle = setInterval(() => {
      this.processNext().catch(() => {
        /* never block API */
      });
    }, ms);
    // Unref so interval does not keep process alive in smokes after kill.
    if (typeof this.intervalHandle.unref === 'function') {
      this.intervalHandle.unref();
    }
  }

  onModuleDestroy() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  info() {
    return {
      fbr: 'off' as const,
      adapter: this.adapter.name,
      note: 'FBR is out of scope for P1 (D30 LOCK). Queue dormant; historic documents read-only.',
    };
  }

  /**
   * Enqueue tax document after a committed sale. Non-blocking caller should
   * swallow errors — sale must already be committed.
   */
  enqueueForSale(saleId: string, clientDeviceAt?: string) {
    if (!TaxService.fbrEnabled()) {
      return { ok: false as const, error: 'fbr_disabled' };
    }
    const sid = (saleId ?? '').trim();
    if (!sid) {
      return { ok: false as const, error: 'sale_id_required' };
    }

    const existing = this.db.raw
      .prepare(
        `SELECT id FROM tax_documents WHERE sale_id = ? ORDER BY created_at ASC LIMIT 1`,
      )
      .get(sid) as { id: string } | undefined;
    if (existing) {
      return {
        ok: true as const,
        id: existing.id,
        saleId: sid,
        status: 'queued' as const,
        duplicate: true,
      };
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const at =
      clientDeviceAt && !Number.isNaN(new Date(clientDeviceAt).getTime())
        ? new Date(clientDeviceAt).toISOString()
        : now;
    // Minimal local payload — sale_id only. No invented FBR schema fields.
    const payload = JSON.stringify({ sale_id: sid });
    this.db.raw
      .prepare(
        `INSERT INTO tax_documents
           (id, sale_id, status, payload_json, client_device_at)
         VALUES (?, ?, 'queued', ?, ?)`,
      )
      .run(id, sid, payload, at);
    return {
      ok: true as const,
      id,
      saleId: sid,
      status: 'queued' as const,
      duplicate: false,
    };
  }

  /** @deprecated Slice 0/1 stub — prefer enqueueForSale. */
  enqueue(saleId?: string) {
    if (saleId) return this.enqueueForSale(saleId);
    const stub = `stub-sale-${Date.now()}`;
    return this.enqueueForSale(stub);
  }

  listQueue(opts?: { pendingOnly?: boolean }): TaxQueueItem[] {
    const pendingOnly = opts?.pendingOnly !== false;
    const sql = pendingOnly
      ? `SELECT
           t.id, t.sale_id, t.status, t.provider_ref, t.reason_stub,
           t.disposition, t.client_device_at, t.created_at,
           s.short_id AS sale_short_id,
           s.total_paisa AS sale_total_paisa,
           s.payment_method,
           s.party_id,
           s.voided_at,
           s.tax_flagged
         FROM tax_documents t
         LEFT JOIN sales s ON s.id = t.sale_id
         WHERE
           t.status IN ('queued', 'submitting')
           OR (t.status = 'rejected' AND t.disposition IS NULL)
         ORDER BY t.created_at DESC
         LIMIT 200`
      : `SELECT
           t.id, t.sale_id, t.status, t.provider_ref, t.reason_stub,
           t.disposition, t.client_device_at, t.created_at,
           s.short_id AS sale_short_id,
           s.total_paisa AS sale_total_paisa,
           s.payment_method,
           s.party_id,
           s.voided_at,
           s.tax_flagged
         FROM tax_documents t
         LEFT JOIN sales s ON s.id = t.sale_id
         ORDER BY t.created_at DESC
         LIMIT 200`;
    return this.db.raw.prepare(sql).all() as TaxQueueItem[];
  }

  /**
   * Drain one queued doc via simulate adapter → accepted | rejected.
   * Optional outcome forces deterministic result in simulate mode (smoke/dev).
   */
  async processNext(opts?: { outcome?: TaxSimulateOutcome }) {
    if (!TaxService.fbrEnabled()) {
      return { processed: false, drained: false, disabled: true as const };
    }
    const row = this.db.raw
      .prepare(
        `SELECT id, sale_id, payload_json FROM tax_documents
         WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`,
      )
      .get() as
      | { id: string; sale_id: string | null; payload_json: string }
      | undefined;

    if (!row) return { processed: false, drained: false };

    const payload = JSON.parse(row.payload_json || '{}') as Record<
      string,
      unknown
    >;
    payload.sale_id = row.sale_id ?? payload.sale_id;
    payload.id = row.id;

    this.db.raw
      .prepare(
        `UPDATE tax_documents SET status = 'submitting', updated_at = datetime('now') WHERE id = ?`,
      )
      .run(row.id);

    const result = await this.adapter.submit(payload, {
      outcome: opts?.outcome,
    });
    const status = this.adapter.mapStatus(result.raw);
    const finalStatus: TaxDocStatus =
      status === 'rejected'
        ? 'rejected'
        : status === 'accepted'
          ? 'accepted'
          : 'authority_down';

    this.db.raw
      .prepare(
        `UPDATE tax_documents
         SET status = ?,
             provider_ref = ?,
             reason_stub = ?,
             raw_detail = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(
        finalStatus,
        result.providerRef ?? null,
        result.reasonStub ?? null,
        JSON.stringify(result.raw ?? {}),
        row.id,
      );

    return {
      processed: true,
      drained: true,
      id: row.id,
      saleId: row.sale_id,
      status: finalStatus,
      adapter: this.adapter.name,
      providerRef: result.providerRef,
      reasonStub: result.reasonStub,
    };
  }

  /** Alias used by older scaffold. */
  drainOne() {
    return this.processNext();
  }

  /**
   * Cashier-safe one-liner for a sale. Never exposes disposition controls.
   */
  bySale(saleId: string): {
    saleId: string;
    status: string | null;
    oneLiner: string;
    badge: 'queued' | 'accepted' | 'rejected' | 'none' | 'voided' | 'credit_note';
  } {
    const sid = (saleId ?? '').trim();
    const row = this.db.raw
      .prepare(
        `SELECT id, status, disposition FROM tax_documents
         WHERE sale_id = ? ORDER BY created_at ASC LIMIT 1`,
      )
      .get(sid) as
      | { id: string; status: string; disposition: string | null }
      | undefined;

    if (!row) {
      return {
        saleId: sid,
        status: null,
        oneLiner: '',
        badge: 'none',
      };
    }

    if (row.status === 'queued' || row.status === 'submitting') {
      return {
        saleId: sid,
        status: row.status,
        oneLiner: 'Tax: queued',
        badge: 'queued',
      };
    }
    if (row.status === 'accepted') {
      return {
        saleId: sid,
        status: row.status,
        oneLiner: 'Tax: Accepted',
        badge: 'accepted',
      };
    }
    if (row.status === 'voided' || row.disposition === 'void') {
      return {
        saleId: sid,
        status: row.status,
        oneLiner: 'Tax: voided',
        badge: 'voided',
      };
    }
    if (
      row.status === 'credit_note_queued' ||
      row.disposition === 'credit_note'
    ) {
      return {
        saleId: sid,
        status: row.status,
        oneLiner: 'Tax: credit note queued',
        badge: 'credit_note',
      };
    }
    if (row.status === 'rejected') {
      if (row.disposition === 'keep_flag') {
        return {
          saleId: sid,
          status: row.status,
          oneLiner: 'Tax: flagged',
          badge: 'rejected',
        };
      }
      return {
        saleId: sid,
        status: row.status,
        oneLiner: 'Tax: Rejected — owner will fix.',
        badge: 'rejected',
      };
    }
    return {
      saleId: sid,
      status: row.status,
      oneLiner: 'Tax: pending',
      badge: 'queued',
    };
  }

  dispose(
    docId: string,
    disposition: TaxDisposition,
    disposedBy?: string,
  ):
    | {
        ok: true;
        disposition: TaxDisposition;
        status: string;
        message: string;
        saleId: string | null;
      }
    | { ok: false; error: string } {
    const doc = this.db.raw
      .prepare(
        `SELECT id, sale_id, status, disposition FROM tax_documents WHERE id = ?`,
      )
      .get(docId) as
      | {
          id: string;
          sale_id: string | null;
          status: string;
          disposition: string | null;
        }
      | undefined;

    if (!doc) return { ok: false, error: 'not_found' };
    if (doc.status !== 'rejected') {
      return { ok: false, error: 'not_rejected' };
    }
    if (doc.disposition) {
      return { ok: false, error: 'already_disposed' };
    }

    const now = new Date().toISOString();

    if (disposition === 'void') {
      if (!doc.sale_id) return { ok: false, error: 'sale_missing' };
      try {
        this.voidSaleInTxn(doc.sale_id, doc.id, disposedBy, now);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'sale_already_voided') {
          return { ok: false, error: 'sale_already_voided' };
        }
        if (msg === 'sale_not_found') {
          return { ok: false, error: 'sale_not_found' };
        }
        throw err;
      }
      return {
        ok: true,
        disposition: 'void',
        status: 'voided',
        message: 'Sale voided — stock restored',
        saleId: doc.sale_id,
      };
    }

    if (disposition === 'keep_flag') {
      const run = this.db.raw.transaction(() => {
        this.db.raw
          .prepare(
            `UPDATE tax_documents
             SET disposition = 'keep_flag',
                 disposed_at = ?,
                 disposed_by = ?,
                 updated_at = datetime('now')
             WHERE id = ?`,
          )
          .run(now, disposedBy ?? null, doc.id);
        if (doc.sale_id) {
          this.db.raw
            .prepare(
              `UPDATE sales SET tax_flagged = 1 WHERE id = ? AND voided_at IS NULL`,
            )
            .run(doc.sale_id);
        }
      });
      run();
      return {
        ok: true,
        disposition: 'keep_flag',
        status: 'rejected',
        message: 'Kept + flagged',
        saleId: doc.sale_id,
      };
    }

    // credit_note — product-side flag/queue only; no FBR credit submit
    const runCn = this.db.raw.transaction(() => {
      this.db.raw
        .prepare(
          `UPDATE tax_documents
           SET status = 'credit_note_queued',
               disposition = 'credit_note',
               disposed_at = ?,
               disposed_by = ?,
               updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(now, disposedBy ?? null, doc.id);
    });
    runCn();
    return {
      ok: true,
      disposition: 'credit_note',
      status: 'credit_note_queued',
      message: 'Credit note queued for tax (local only — no FBR submit)',
      saleId: doc.sale_id,
    };
  }

  /**
   * Void sale: reverse stock (+qty from sale_lines), reverse udhaar debit only
   * (credit = udhaar_amount_paisa for udhaar/split — never invent a cash refund),
   * mark sale voided + tax doc voided.
   */
  private voidSaleInTxn(
    saleId: string,
    taxDocId: string,
    disposedBy: string | undefined,
    now: string,
  ) {
    const run = this.db.raw.transaction(() => {
      // Shared reversal: restock, credit back udhaar, debit back kept-on-khata surplus.
      reverseSaleInTxn(this.db.raw, saleId, {
        now,
        voidedBy: disposedBy ?? null,
        reason: 'Tax rejected',
        refuseIfReturns: false,
      });

      this.db.raw
        .prepare(
          `UPDATE tax_documents
           SET status = 'voided',
               disposition = 'void',
               disposed_at = ?,
               disposed_by = ?,
               updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(now, disposedBy ?? null, taxDocId);
    });
    run();
  }

  // ── D31 Simple Tax Management (period × rate; optional product scope) ──

  private karachiYmd(d: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Karachi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  }

  private currentPktYear(now = new Date()): number {
    return Number(this.karachiYmd(now).slice(0, 4));
  }

  /** Inclusive PKT calendar-day window → UTC ISO bounds (match Analytics). */
  dayRangeWindow(fromYmd: string, toYmd: string): { from: string; to: string } {
    return {
      from: new Date(`${fromYmd}T00:00:00+05:00`).toISOString(),
      to: new Date(`${toYmd}T23:59:59.999+05:00`).toISOString(),
    };
  }

  monthWindow(year: number, month: number): { fromYmd: string; toYmd: string; from: string; to: string } {
    const y = Math.floor(year);
    const m = Math.floor(month);
    const fromYmd = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const toYmd = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const win = this.dayRangeWindow(fromYmd, toYmd);
    return { fromYmd, toYmd, ...win };
  }

  /**
   * Parse product_ids query into a unique list (order preserved).
   */
  parseProductIdsQuery(
    raw: string | string[] | undefined,
  ): string[] {
    if (raw === undefined || raw === null) return [];
    const parts = Array.isArray(raw) ? raw : [raw];
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const part of parts) {
      for (const bit of String(part).split(',')) {
        const id = bit.trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
    }
    return ids;
  }

  /**
   * Resolve D31.1 scope.
   * Returns error codes: invalid_scope | product_ids_required | product_ids_limit
   */
  resolveScope(
    scopeRaw: string | undefined,
    productIdsRaw: string | string[] | undefined,
  ):
    | { ok: true; scope: 'all'; productIds: null }
    | { ok: true; scope: 'products'; productIds: string[] }
    | { ok: false; error: string } {
    const scope = (scopeRaw ?? 'all').trim().toLowerCase() || 'all';
    if (scope !== 'all' && scope !== 'products') {
      return { ok: false, error: 'invalid_scope' };
    }
    if (scope === 'all') {
      return { ok: true, scope: 'all', productIds: null };
    }
    const ids = this.parseProductIdsQuery(productIdsRaw);
    if (ids.length === 0) {
      return { ok: false, error: 'product_ids_required' };
    }
    if (ids.length > 200) {
      return { ok: false, error: 'product_ids_limit' };
    }
    return { ok: true, scope: 'products', productIds: ids };
  }

  summarizePeriod(opts: {
    fromYmd: string;
    toYmd: string;
    rateBp?: number | null;
    scope: 'all' | 'products';
    productIds?: string[] | null;
  }): {
    ok: true;
    from: string;
    to: string;
    sales_base_paisa: number;
    sale_count: number;
    tax_paisa?: number;
    rate_bp?: number;
    scope: 'all' | 'products';
    product_count: number;
  } | { ok: false; error: string } {
    const fromYmd = (opts.fromYmd ?? '').trim();
    const toYmd = (opts.toYmd ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(toYmd)) {
      return { ok: false, error: 'invalid_date' };
    }
    if (toYmd < fromYmd) {
      return { ok: false, error: 'invalid_range' };
    }

    const scope = opts.scope;
    const productIds =
      scope === 'products' ? (opts.productIds ?? []) : null;
    if (scope === 'products') {
      if (!productIds || productIds.length === 0) {
        return { ok: false, error: 'product_ids_required' };
      }
      if (productIds.length > 200) {
        return { ok: false, error: 'product_ids_limit' };
      }
    }

    const win = this.dayRangeWindow(fromYmd, toYmd);
    let sales_base_paisa = 0;
    let sale_count = 0;

    if (scope === 'products' && productIds) {
      const placeholders = productIds.map(() => '?').join(', ');
      const row = this.db.raw
        .prepare(
          `SELECT
             COUNT(DISTINCT s.id) AS sale_count,
             COALESCE(SUM(sl.line_total_paisa), 0) AS sales_base_paisa
           FROM sales s
           INNER JOIN sale_lines sl ON sl.sale_id = s.id
           WHERE s.voided_at IS NULL
             AND s.recorded_at >= ?
             AND s.recorded_at <= ?
             AND sl.product_id IN (${placeholders})`,
        )
        .get(win.from, win.to, ...productIds) as {
        sale_count: number;
        sales_base_paisa: number;
      };
      sale_count = Number(row?.sale_count ?? 0);
      sales_base_paisa = Number(row?.sales_base_paisa ?? 0);
    } else {
      const row = this.db.raw
        .prepare(
          `SELECT
             COUNT(*) AS sale_count,
             COALESCE(SUM(total_paisa), 0) AS sales_base_paisa
           FROM sales
           WHERE voided_at IS NULL
             AND recorded_at >= ?
             AND recorded_at <= ?`,
        )
        .get(win.from, win.to) as {
        sale_count: number;
        sales_base_paisa: number;
      };
      sale_count = Number(row?.sale_count ?? 0);
      sales_base_paisa = Number(row?.sales_base_paisa ?? 0);
    }

    // Returns dated in the period come off the sales base (sales − returns).
    if (scope === 'products' && productIds) {
      const placeholders = productIds.map(() => '?').join(', ');
      const r = this.db.raw
        .prepare(
          `SELECT COALESCE(SUM(rl.line_total_paisa), 0) AS t
           FROM sale_return_lines rl
           INNER JOIN sale_returns r ON r.id = rl.return_id
           WHERE r.recorded_at >= ? AND r.recorded_at <= ?
             AND rl.product_id IN (${placeholders})`,
        )
        .get(win.from, win.to, ...productIds) as { t: number };
      sales_base_paisa -= Number(r?.t ?? 0);
    } else {
      const r = this.db.raw
        .prepare(
          `SELECT COALESCE(SUM(total_paisa), 0) AS t FROM sale_returns
           WHERE recorded_at >= ? AND recorded_at <= ?`,
        )
        .get(win.from, win.to) as { t: number };
      sales_base_paisa -= Number(r?.t ?? 0);
    }

    const out: {
      ok: true;
      from: string;
      to: string;
      sales_base_paisa: number;
      sale_count: number;
      tax_paisa?: number;
      rate_bp?: number;
      scope: 'all' | 'products';
      product_count: number;
    } = {
      ok: true,
      from: fromYmd,
      to: toYmd,
      sales_base_paisa,
      sale_count,
      scope,
      product_count: scope === 'products' ? (productIds?.length ?? 0) : 0,
    };

    if (opts.rateBp != null && Number(opts.rateBp) > 0) {
      const rate_bp = normalizeRateBp(opts.rateBp);
      out.rate_bp = rate_bp;
      out.tax_paisa = taxFromSalesBase(sales_base_paisa, rate_bp);
    }

    return out;
  }

  listTaxYears(): { ok: true; years: number[]; current_year: number } {
    const current = this.currentPktYear();
    const rows = this.db.raw
      .prepare(
        `SELECT recorded_at FROM sales WHERE voided_at IS NULL`,
      )
      .all() as Array<{ recorded_at: string }>;
    const set = new Set<number>([current]);
    for (const r of rows) {
      const t = Date.parse(r.recorded_at);
      if (!Number.isFinite(t)) continue;
      const n = Number(this.karachiYmd(new Date(t)).slice(0, 4));
      if (Number.isFinite(n) && n >= 2000 && n <= 2100) set.add(n);
    }
    const years = Array.from(set).sort((a, b) => b - a);
    return { ok: true, years, current_year: current };
  }

  listTaxMonths(opts: {
    year: number;
    rateBp?: number | null;
    scope: 'all' | 'products';
    productIds?: string[] | null;
  }): {
    ok: true;
    year: number;
    months: Array<{
      month: number;
      from: string;
      to: string;
      sales_base_paisa: number;
      sale_count: number;
      tax_paisa?: number;
    }>;
    rate_bp?: number;
    scope: 'all' | 'products';
    product_count: number;
  } | { ok: false; error: string } {
    const year = Math.floor(Number(opts.year));
    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
      return { ok: false, error: 'invalid_year' };
    }
    if (opts.scope === 'products') {
      const ids = opts.productIds ?? [];
      if (ids.length === 0) return { ok: false, error: 'product_ids_required' };
      if (ids.length > 200) return { ok: false, error: 'product_ids_limit' };
    }
    const rateBp =
      opts.rateBp != null && Number(opts.rateBp) > 0
        ? normalizeRateBp(opts.rateBp)
        : null;
    const months: Array<{
      month: number;
      from: string;
      to: string;
      sales_base_paisa: number;
      sale_count: number;
      tax_paisa?: number;
    }> = [];
    for (let m = 1; m <= 12; m++) {
      const win = this.monthWindow(year, m);
      const summary = this.summarizePeriod({
        fromYmd: win.fromYmd,
        toYmd: win.toYmd,
        rateBp,
        scope: opts.scope,
        productIds: opts.productIds,
      });
      if (!summary.ok) return summary;
      const row: {
        month: number;
        from: string;
        to: string;
        sales_base_paisa: number;
        sale_count: number;
        tax_paisa?: number;
      } = {
        month: m,
        from: summary.from,
        to: summary.to,
        sales_base_paisa: summary.sales_base_paisa,
        sale_count: summary.sale_count,
      };
      if (rateBp != null) row.tax_paisa = summary.tax_paisa ?? 0;
      months.push(row);
    }
    const out: {
      ok: true;
      year: number;
      months: typeof months;
      rate_bp?: number;
      scope: 'all' | 'products';
      product_count: number;
    } = {
      ok: true,
      year,
      months,
      scope: opts.scope,
      product_count:
        opts.scope === 'products' ? (opts.productIds?.length ?? 0) : 0,
    };
    if (rateBp != null) out.rate_bp = rateBp;
    return out;
  }

  // ── D31.3 Pakistan financial years (1 Jul – 30 Jun, PKT) ──

  /**
   * FY that contains a PKT Y-M-D.
   * month >= 7 → FY starts that calendar year; month <= 6 → previous year.
   * Label: FY YYYY-YY (e.g. FY 2025-26).
   */
  fiscalYearForPktYmd(ymd: string): {
    startYear: number;
    label: string;
    fromYmd: string;
    toYmd: string;
  } {
    const y = Number(ymd.slice(0, 4));
    const m = Number(ymd.slice(5, 7));
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
      throw new Error('invalid_ymd');
    }
    const startYear = m >= 7 ? y : y - 1;
    const endYear = startYear + 1;
    const yy = String(endYear).slice(-2);
    return {
      startYear,
      label: `FY ${startYear}-${yy}`,
      fromYmd: `${String(startYear).padStart(4, '0')}-07-01`,
      toYmd: `${String(endYear).padStart(4, '0')}-06-30`,
    };
  }

  currentFiscalYear(now = new Date()): {
    startYear: number;
    label: string;
    fromYmd: string;
    toYmd: string;
  } {
    return this.fiscalYearForPktYmd(this.karachiYmd(now));
  }

  /**
   * FYs with ≥1 non-voided sale + always current FY (even if empty).
   * Newest FY first. scope=all only for P1 UI.
   */
  listFiscalYears(opts?: {
    rateBp?: number | null;
  }): {
    ok: true;
    fiscal_years: Array<{
      label: string;
      from: string;
      to: string;
      sales_base_paisa: number;
      sale_count: number;
      tax_paisa?: number;
    }>;
    current: { label: string; from: string; to: string };
    rate_bp?: number;
  } {
    const current = this.currentFiscalYear();
    const rows = this.db.raw
      .prepare(
        `SELECT recorded_at FROM sales WHERE voided_at IS NULL`,
      )
      .all() as Array<{ recorded_at: string }>;

    const byStart = new Map<
      number,
      { label: string; fromYmd: string; toYmd: string }
    >();
    byStart.set(current.startYear, {
      label: current.label,
      fromYmd: current.fromYmd,
      toYmd: current.toYmd,
    });

    for (const r of rows) {
      const t = Date.parse(r.recorded_at);
      if (!Number.isFinite(t)) continue;
      const ymd = this.karachiYmd(new Date(t));
      try {
        const fy = this.fiscalYearForPktYmd(ymd);
        if (!byStart.has(fy.startYear)) {
          byStart.set(fy.startYear, {
            label: fy.label,
            fromYmd: fy.fromYmd,
            toYmd: fy.toYmd,
          });
        }
      } catch {
        /* skip bad dates */
      }
    }

    const rateBp =
      opts?.rateBp != null && Number(opts.rateBp) > 0
        ? normalizeRateBp(opts.rateBp)
        : null;

    const startYears = Array.from(byStart.keys()).sort((a, b) => b - a);
    const fiscal_years: Array<{
      label: string;
      from: string;
      to: string;
      sales_base_paisa: number;
      sale_count: number;
      tax_paisa?: number;
    }> = [];

    for (const startYear of startYears) {
      const meta = byStart.get(startYear)!;
      const summary = this.summarizePeriod({
        fromYmd: meta.fromYmd,
        toYmd: meta.toYmd,
        rateBp,
        scope: 'all',
        productIds: null,
      });
      if (!summary.ok) continue;
      // Keep FYs with sales; always keep current even if empty.
      if (
        startYear !== current.startYear &&
        summary.sale_count <= 0 &&
        summary.sales_base_paisa <= 0
      ) {
        continue;
      }
      const row: {
        label: string;
        from: string;
        to: string;
        sales_base_paisa: number;
        sale_count: number;
        tax_paisa?: number;
      } = {
        label: meta.label,
        from: summary.from,
        to: summary.to,
        sales_base_paisa: summary.sales_base_paisa,
        sale_count: summary.sale_count,
      };
      if (rateBp != null) row.tax_paisa = summary.tax_paisa ?? 0;
      fiscal_years.push(row);
    }

    const out: {
      ok: true;
      fiscal_years: typeof fiscal_years;
      current: { label: string; from: string; to: string };
      rate_bp?: number;
    } = {
      ok: true,
      fiscal_years,
      current: {
        label: current.label,
        from: current.fromYmd,
        to: current.toYmd,
      },
    };
    if (rateBp != null) out.rate_bp = rateBp;
    return out;
  }

}
