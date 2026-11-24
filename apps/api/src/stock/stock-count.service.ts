import { parseQty, r3 } from '../common/qty';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { parseNonNegativeInt } from '../common/amount';
import { DbService } from '../db/db.service';

export type CountSource = 'full_screen' | 'catalog_quick';
export type CountStatus = 'draft' | 'posted' | 'cancelled';
export type ReasonCode =
  | 'damaged'
  | 'expired'
  | 'stolen_lost'
  | 'admin_error';

export const REASON_CODES: readonly ReasonCode[] = [
  'damaged',
  'expired',
  'stolen_lost',
  'admin_error',
] as const;

export type WorksheetFilter =
  | 'all'
  | 'uncounted'
  | 'counted'
  | 'discrepancy';

export type CountSessionRow = {
  id: string;
  store_id: string;
  status: CountStatus;
  source: CountSource;
  started_by: string;
  posted_by: string | null;
  note: string | null;
  started_at: string;
  posted_at: string | null;
  cancelled_at: string | null;
  items_total_at_post: number | null;
};

export type CountLineRow = {
  id: string;
  session_id: string;
  product_id: string;
  system_qty_snapshot: number;
  counted_qty: number | null;
  reason_code: ReasonCode | null;
  unit_cost_paisa_snapshot: number | null;
  updated_at: string;
};

export type AdjustmentRow = {
  id: string;
  product_id: string;
  session_id: string | null;
  line_id: string | null;
  delta_pieces: number;
  qty_before: number;
  qty_after: number;
  reason: string;
  reason_code: ReasonCode | null;
  unit_cost_paisa: number | null;
  created_by: string;
  created_at: string;
  note: string | null;
};

export type CountAggregates = {
  items_counted: number;
  items_matching: number;
  items_missing: number;
  items_extra: number;
  abs_delta_units: number;
  net_delta_units: number;
  value_delta_paisa: number | null;
  loss_paisa: number | null;
  gain_paisa: number | null;
  items_uncosted: number;
};

export type CountHistoryItem = {
  session: CountSessionRow;
  count_type: 'Full' | 'Quick';
  aggregates: CountAggregates;
};

export type ReportLine = CountLineRow & {
  product_name: string;
  product_name_ur: string | null;
  barcode: string | null;
  variance: number | null;
  qty_on_hand: number;
  value_delta_paisa: number | null;
};

export type WorksheetItem = {
  product_id: string;
  name: string;
  name_ur: string | null;
  barcode: string | null;
  unit_label: string;
  qty_on_hand: number;
  line_id: string | null;
  system_qty_snapshot: number | null;
  counted_qty: number | null;
  reason_code: ReasonCode | null;
  unit_cost_paisa_snapshot: number | null;
  variance: number | null;
  counted: boolean;
};

type DraftPayload = {
  session: CountSessionRow;
  lines: CountLineRow[];
};

type LineInput = {
  productId?: string;
  countedQty?: unknown;
  reasonCode?: unknown;
};

const SESSION_COLS = `id, store_id, status, source, started_by, posted_by, note,
                started_at, posted_at, cancelled_at, items_total_at_post`;

const LINE_COLS = `id, session_id, product_id, system_qty_snapshot, counted_qty,
                reason_code, unit_cost_paisa_snapshot, updated_at`;

const ADJ_COLS = `id, product_id, session_id, line_id, delta_pieces,
                qty_before, qty_after, reason, reason_code, unit_cost_paisa,
                created_by, created_at, note`;

function parseReasonCode(
  raw: unknown,
): { ok: true; value: ReasonCode | null } | { ok: false } {
  if (raw == null || raw === '') return { ok: true, value: null };
  const s = String(raw).trim();
  if ((REASON_CODES as readonly string[]).includes(s)) {
    return { ok: true, value: s as ReasonCode };
  }
  return { ok: false };
}

/** Asia/Karachi calendar-month bounds as SQLite UTC datetimes (datetime('now') style). */
export function karachiMonthUtcBounds(now = new Date()): {
  startUtc: string;
  endUtc: string;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === 'year')!.value);
  const month = Number(parts.find((p) => p.type === 'month')!.value);
  // PKT = UTC+5 → month start 00:00 PKT = previous calendar day 19:00 UTC
  const startMs = Date.UTC(year, month - 1, 1, 0, 0, 0) - 5 * 3600 * 1000;
  const endMs = Date.UTC(year, month, 1, 0, 0, 0) - 5 * 3600 * 1000;
  const fmt = (ms: number) =>
    new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
  return { startUtc: fmt(startMs), endUtc: fmt(endMs) };
}

function emptyAggregates(): CountAggregates {
  return {
    items_counted: 0,
    items_matching: 0,
    items_missing: 0,
    items_extra: 0,
    abs_delta_units: 0,
    net_delta_units: 0,
    value_delta_paisa: 0,
    loss_paisa: 0,
    gain_paisa: 0,
    items_uncosted: 0,
  };
}

@Injectable()
export class StockCountService {
  constructor(private readonly db: DbService) {}

  getDraft(storeId: string): DraftPayload | null {
    const session = this.db.raw
      .prepare(
        `SELECT ${SESSION_COLS}
         FROM stock_count_sessions
         WHERE store_id = ? AND status = 'draft'
         LIMIT 1`,
      )
      .get(storeId) as CountSessionRow | undefined;
    if (!session) return null;
    const lines = this.linesFor(session.id);
    return { session, lines };
  }

  start(input: {
    storeId: string;
    userId: string;
    source?: string;
    note?: string;
  }):
    | { ok: true; session: CountSessionRow; lines: CountLineRow[] }
    | { ok: false; error: 'draft_exists' | 'invalid_source'; draft?: DraftPayload } {
    const sourceRaw = (input.source ?? 'full_screen').trim();
    if (sourceRaw !== 'full_screen' && sourceRaw !== 'catalog_quick') {
      return { ok: false, error: 'invalid_source' };
    }
    const existing = this.getDraft(input.storeId);
    if (existing) {
      return { ok: false, error: 'draft_exists', draft: existing };
    }
    const id = randomUUID();
    const note =
      input.note != null && String(input.note).trim()
        ? String(input.note).trim().slice(0, 240)
        : null;
    this.db.raw
      .prepare(
        `INSERT INTO stock_count_sessions
           (id, store_id, status, source, started_by, note)
         VALUES (?, ?, 'draft', ?, ?, ?)`,
      )
      .run(id, input.storeId, sourceRaw, input.userId, note);
    const session = this.sessionById(id)!;
    return { ok: true, session, lines: [] };
  }

  /**
   * History list (D29-c) + dashboard helpers: lastFullCount, monthlyShrinkage.
   * Cancelled excluded unless status filter includes cancelled.
   */
  listHistory(input: {
    storeId: string;
    status?: string;
    source?: string;
    limit?: number;
    before?: string;
  }): {
    items: CountHistoryItem[];
    lastFullCount: {
      session: CountSessionRow;
      items_counted: number;
      posted_at: string;
    } | null;
    monthlyShrinkage: {
      loss_paisa: number;
      uncosted_loss_items: number;
      month_start_pkt: string;
    };
  } {
    const statuses = this.parseStatusFilter(input.status);
    const source =
      input.source != null && String(input.source).trim()
        ? String(input.source).trim()
        : null;
    if (source && source !== 'full_screen' && source !== 'catalog_quick') {
      return {
        items: [],
        lastFullCount: this.lastFullCount(input.storeId),
        monthlyShrinkage: this.monthlyShrinkage(),
      };
    }
    const lim = Math.min(Math.max(1, input.limit ?? 20), 100);
    const before =
      input.before != null && String(input.before).trim()
        ? String(input.before).trim()
        : null;

    const statusPlaceholders = statuses.map(() => '?').join(',');
    const args: Array<string | number> = [input.storeId, ...statuses];
    let sql = `SELECT ${SESSION_COLS}
         FROM stock_count_sessions
         WHERE store_id = ? AND status IN (${statusPlaceholders})`;
    if (source) {
      sql += ` AND source = ?`;
      args.push(source);
    }
    if (before) {
      sql += ` AND COALESCE(posted_at, started_at) < ?`;
      args.push(before);
    }
    sql += ` ORDER BY COALESCE(posted_at, started_at) DESC LIMIT ?`;
    args.push(lim);

    const sessions = this.db.raw.prepare(sql).all(...args) as CountSessionRow[];
    const items: CountHistoryItem[] = sessions.map((session) => ({
      session,
      count_type: session.source === 'catalog_quick' ? 'Quick' : 'Full',
      aggregates: this.aggregatesFor(session),
    }));

    return {
      items,
      lastFullCount: this.lastFullCount(input.storeId),
      monthlyShrinkage: this.monthlyShrinkage(),
    };
  }

  getReport(
    sessionId: string,
    storeId: string,
  ):
    | {
        ok: true;
        session: CountSessionRow;
        lines: ReportLine[];
        adjustments: AdjustmentRow[];
        aggregates: CountAggregates;
        progress: { counted: number; total: number };
      }
    | { ok: false; error: 'session_not_found' } {
    const session = this.sessionById(sessionId);
    if (!session || session.store_id !== storeId) {
      return { ok: false, error: 'session_not_found' };
    }

    const rows = this.db.raw
      .prepare(
        `SELECT l.id, l.session_id, l.product_id, l.system_qty_snapshot,
                l.counted_qty, l.reason_code, l.unit_cost_paisa_snapshot, l.updated_at,
                p.name AS product_name, p.name_ur AS product_name_ur, p.barcode,
                COALESCE(sb.qty_on_hand, 0) AS qty_on_hand
         FROM stock_count_lines l
         JOIN products p ON p.id = l.product_id
         LEFT JOIN stock_balances sb ON sb.product_id = l.product_id
         WHERE l.session_id = ?
         ORDER BY p.name ASC`,
      )
      .all(sessionId) as Array<
      CountLineRow & {
        product_name: string;
        product_name_ur: string | null;
        barcode: string | null;
        qty_on_hand: number;
      }
    >;

    const lines: ReportLine[] = rows.map((r) => {
      const variance =
        r.counted_qty == null ? null : r3(r.counted_qty - r.system_qty_snapshot);
      let value_delta_paisa: number | null = null;
      if (variance != null && r.unit_cost_paisa_snapshot != null) {
        value_delta_paisa = Math.round(variance * r.unit_cost_paisa_snapshot);
      }
      return { ...r, variance, value_delta_paisa };
    });

    const adjustments = this.db.raw
      .prepare(
        `SELECT ${ADJ_COLS}
         FROM stock_adjustments
         WHERE session_id = ?
         ORDER BY created_at ASC`,
      )
      .all(sessionId) as AdjustmentRow[];

    const totalActive = this.activeProductCount();
    const counted = lines.filter((l) => l.counted_qty != null).length;

    return {
      ok: true,
      session,
      lines,
      adjustments,
      aggregates: this.aggregatesFor(session),
      progress: { counted, total: totalActive },
    };
  }

  getWorksheet(input: {
    sessionId: string;
    storeId: string;
    filter?: string;
    q?: string;
    page?: number;
    pageSize?: number;
  }):
    | {
        ok: true;
        session: CountSessionRow;
        items: WorksheetItem[];
        page: number;
        pageSize: number;
        total: number;
        progress: { counted: number; total: number };
      }
    | { ok: false; error: 'session_not_found' | 'invalid_filter' } {
    const session = this.sessionById(input.sessionId);
    if (!session || session.store_id !== input.storeId) {
      return { ok: false, error: 'session_not_found' };
    }
    const filterRaw = (input.filter ?? 'all').trim().toLowerCase();
    if (
      filterRaw !== 'all' &&
      filterRaw !== 'uncounted' &&
      filterRaw !== 'counted' &&
      filterRaw !== 'discrepancy'
    ) {
      return { ok: false, error: 'invalid_filter' };
    }
    const filter = filterRaw as WorksheetFilter;
    const q = (input.q ?? '').trim().toLowerCase().replace(/[%_]/g, '');
    const page = Math.max(1, Math.floor(input.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize ?? 20)));

    const whereParts = [`p.active = 1`];
    const args: Array<string | number> = [session.id];
    if (q) {
      whereParts.push(
        `(lower(p.name) LIKE ? OR lower(COALESCE(p.name_ur, '')) LIKE ? OR lower(COALESCE(p.barcode, '')) LIKE ?
          OR EXISTS (SELECT 1 FROM product_barcodes xb WHERE xb.product_id = p.id AND lower(xb.barcode) LIKE ?))`,
      );
      args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (filter === 'uncounted') {
      whereParts.push(`(l.counted_qty IS NULL)`);
    } else if (filter === 'counted') {
      whereParts.push(`(l.counted_qty IS NOT NULL)`);
    } else if (filter === 'discrepancy') {
      whereParts.push(
        `(l.counted_qty IS NOT NULL AND l.counted_qty != l.system_qty_snapshot)`,
      );
    }

    const whereSql = whereParts.join(' AND ');
    const fromSql = `FROM products p
         LEFT JOIN stock_balances sb ON sb.product_id = p.id
         LEFT JOIN stock_count_lines l
           ON l.product_id = p.id AND l.session_id = ?`;

    const totalRow = this.db.raw
      .prepare(`SELECT COUNT(*) AS c ${fromSql} WHERE ${whereSql}`)
      .get(...args) as { c: number };

    const items = this.db.raw
      .prepare(
        `SELECT p.id AS product_id, p.name, p.name_ur, p.barcode, p.unit_label,
                COALESCE(sb.qty_on_hand, 0) AS qty_on_hand,
                l.id AS line_id, l.system_qty_snapshot, l.counted_qty,
                l.reason_code, l.unit_cost_paisa_snapshot
         ${fromSql}
         WHERE ${whereSql}
         ORDER BY p.name ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...args, pageSize, (page - 1) * pageSize) as Array<{
      product_id: string;
      name: string;
      name_ur: string | null;
      barcode: string | null;
      unit_label: string;
      qty_on_hand: number;
      line_id: string | null;
      system_qty_snapshot: number | null;
      counted_qty: number | null;
      reason_code: ReasonCode | null;
      unit_cost_paisa_snapshot: number | null;
    }>;

    const mapped: WorksheetItem[] = items.map((r) => {
      const counted = r.counted_qty != null;
      const variance =
        r.counted_qty == null || r.system_qty_snapshot == null
          ? null
          : r3(r.counted_qty - r.system_qty_snapshot);
      return {
        ...r,
        variance,
        counted,
      };
    });

    const progress = this.progressFor(session.id);

    return {
      ok: true,
      session,
      items: mapped,
      page,
      pageSize,
      total: Number(totalRow?.c ?? 0),
      progress,
    };
  }

  upsertLines(input: {
    sessionId: string;
    storeId: string;
    lines: LineInput[];
  }):
    | { ok: true; session: CountSessionRow; lines: CountLineRow[] }
    | {
        ok: false;
        error:
          | 'session_not_found'
          | 'not_draft'
          | 'invalid_product'
          | 'product_not_found'
          | 'invalid_qty'
          | 'invalid_reason';
      } {
    const session = this.sessionById(input.sessionId);
    if (!session || session.store_id !== input.storeId) {
      return { ok: false, error: 'session_not_found' };
    }
    if (session.status !== 'draft') {
      return { ok: false, error: 'not_draft' };
    }
    if (!Array.isArray(input.lines) || input.lines.length === 0) {
      return { ok: true, session, lines: this.linesFor(session.id) };
    }

    const run = this.db.raw.transaction(() => {
      for (const raw of input.lines) {
        const productId = (raw.productId ?? '').trim();
        if (!productId) return { error: 'invalid_product' as const };

        const product = this.db.raw
          .prepare(
            `SELECT id, active, last_unit_cost_paisa, unit_label FROM products WHERE id = ?`,
          )
          .get(productId) as
          | { id: string; active: number; last_unit_cost_paisa: number | null; unit_label: string | null }
          | undefined;
        if (!product || product.active !== 1) {
          return { error: 'product_not_found' as const };
        }

        let counted: number | null;
        if (raw.countedQty == null || raw.countedQty === '') {
          counted = null;
        } else {
          const parsed = parseQty(raw.countedQty, product.unit_label, { allowZero: true });
          if (!parsed.ok) return { error: 'invalid_qty' as const };
          counted = parsed.n;
        }

        let reasonCode: ReasonCode | null = null;
        if (raw.reasonCode !== undefined) {
          const parsedReason = parseReasonCode(raw.reasonCode);
          if (!parsedReason.ok) return { error: 'invalid_reason' as const };
          reasonCode = parsedReason.value;
        }

        // Lines with no variance (or uncounted) store NULL reason.
        if (counted == null) {
          reasonCode = null;
        }

        const onHand = this.qtyOnHand(productId);
        const costSnap =
          product.last_unit_cost_paisa == null
            ? null
            : Math.round(Number(product.last_unit_cost_paisa));

        if (counted != null && counted === onHand) {
          reasonCode = null;
        }

        const existing = this.db.raw
          .prepare(
            `SELECT id, reason_code FROM stock_count_lines
             WHERE session_id = ? AND product_id = ?`,
          )
          .get(session.id, productId) as
          | { id: string; reason_code: ReasonCode | null }
          | undefined;

        // If reasonCode omitted on update, keep prior (unless we cleared for match/uncounted).
        let finalReason = reasonCode;
        if (raw.reasonCode === undefined && existing && counted != null && counted !== onHand) {
          finalReason = existing.reason_code;
        }

        if (existing) {
          this.db.raw
            .prepare(
              `UPDATE stock_count_lines
               SET system_qty_snapshot = ?, counted_qty = ?,
                   reason_code = ?, unit_cost_paisa_snapshot = ?,
                   updated_at = datetime('now')
               WHERE id = ?`,
            )
            .run(onHand, counted, finalReason, costSnap, existing.id);
        } else {
          this.db.raw
            .prepare(
              `INSERT INTO stock_count_lines
                 (id, session_id, product_id, system_qty_snapshot, counted_qty,
                  reason_code, unit_cost_paisa_snapshot)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              randomUUID(),
              session.id,
              productId,
              onHand,
              counted,
              finalReason,
              costSnap,
            );
        }
      }
      return { error: null };
    });

    const out = run();
    if (out.error) return { ok: false, error: out.error };
    return {
      ok: true,
      session: this.sessionById(session.id)!,
      lines: this.linesFor(session.id),
    };
  }

  post(input: {
    sessionId: string;
    storeId: string;
    userId: string;
    note?: string;
  }):
    | {
        ok: true;
        session: CountSessionRow;
        adjusted: number;
        skipped: number;
        totalAbsDelta: number;
        adjustments: AdjustmentRow[];
      }
    | {
        ok: false;
        error: 'session_not_found' | 'not_draft' | 'nothing_to_post';
      } {
    const session = this.sessionById(input.sessionId);
    if (!session || session.store_id !== input.storeId) {
      return { ok: false, error: 'session_not_found' };
    }
    if (session.status !== 'draft') {
      return { ok: false, error: 'not_draft' };
    }

    const lines = this.linesFor(session.id).filter(
      (l) => l.counted_qty != null,
    );
    if (lines.length === 0) {
      return { ok: false, error: 'nothing_to_post' };
    }

    const note =
      input.note != null && String(input.note).trim()
        ? String(input.note).trim().slice(0, 240)
        : 'stock count';

    const itemsTotalAtPost = this.activeProductCount();

    const run = this.db.raw.transaction(() => {
      const adjustments: AdjustmentRow[] = [];
      let adjusted = 0;
      let skipped = 0;
      let totalAbsDelta = 0;

      for (const line of lines) {
        const counted = line.counted_qty as number;
        const qtyBefore = this.qtyOnHand(line.product_id);
        const qtyAfter = counted;
        const delta = r3(qtyAfter - qtyBefore);

        if (delta === 0) {
          skipped += 1;
          continue;
        }

        const adjId = randomUUID();
        const unitCost =
          line.unit_cost_paisa_snapshot == null
            ? null
            : Math.round(Number(line.unit_cost_paisa_snapshot));
        this.db.raw
          .prepare(
            `INSERT INTO stock_adjustments
               (id, product_id, session_id, line_id, delta_pieces,
                qty_before, qty_after, reason, reason_code, unit_cost_paisa,
                created_by, note)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'stock_count', ?, ?, ?, ?)`,
          )
          .run(
            adjId,
            line.product_id,
            session.id,
            line.id,
            delta,
            qtyBefore,
            qtyAfter,
            line.reason_code,
            unitCost,
            input.userId,
            note,
          );

        this.db.raw
          .prepare(
            `INSERT INTO stock_balances (product_id, qty_on_hand, updated_at)
             VALUES (?, ?, datetime('now'))
             ON CONFLICT(product_id) DO UPDATE SET
               qty_on_hand = excluded.qty_on_hand,
               updated_at = datetime('now')`,
          )
          .run(line.product_id, qtyAfter);

        const row = this.db.raw
          .prepare(
            `SELECT ${ADJ_COLS}
             FROM stock_adjustments WHERE id = ?`,
          )
          .get(adjId) as AdjustmentRow;
        adjustments.push(row);
        adjusted += 1;
        totalAbsDelta += Math.abs(delta);
      }

      this.db.raw
        .prepare(
          `UPDATE stock_count_sessions
           SET status = 'posted', posted_by = ?, posted_at = datetime('now'),
               note = COALESCE(?, note), items_total_at_post = ?
           WHERE id = ?`,
        )
        .run(
          input.userId,
          note === 'stock count' ? null : note,
          itemsTotalAtPost,
          session.id,
        );

      return { adjusted, skipped, totalAbsDelta, adjustments };
    });

    const result = run();
    return {
      ok: true,
      session: this.sessionById(session.id)!,
      adjusted: result.adjusted,
      skipped: result.skipped,
      totalAbsDelta: result.totalAbsDelta,
      adjustments: result.adjustments,
    };
  }

  cancel(input: {
    sessionId: string;
    storeId: string;
  }):
    | { ok: true; session: CountSessionRow }
    | { ok: false; error: 'session_not_found' | 'not_draft' } {
    const session = this.sessionById(input.sessionId);
    if (!session || session.store_id !== input.storeId) {
      return { ok: false, error: 'session_not_found' };
    }
    if (session.status !== 'draft') {
      return { ok: false, error: 'not_draft' };
    }
    this.db.raw
      .prepare(
        `UPDATE stock_count_sessions
         SET status = 'cancelled', cancelled_at = datetime('now')
         WHERE id = ?`,
      )
      .run(session.id);
    return { ok: true, session: this.sessionById(session.id)! };
  }

  /**
   * Catalog quick-count: one-line session posted immediately.
   * If a full-screen draft is open, upsert that product onto the draft instead
   * (RE recommend a) — does not post.
   */
  quick(input: {
    storeId: string;
    userId: string;
    productId: string;
    countedQty: unknown;
    reasonCode?: unknown;
  }):
    | {
        ok: true;
        mode: 'posted' | 'draft_line';
        session: CountSessionRow;
        adjusted?: number;
        totalAbsDelta?: number;
        adjustments?: AdjustmentRow[];
        lines?: CountLineRow[];
      }
    | {
        ok: false;
        error:
          | 'invalid_product'
          | 'product_not_found'
          | 'invalid_qty'
          | 'invalid_reason'
          | 'nothing_to_post';
      } {
    const productId = (input.productId ?? '').trim();
    if (!productId) return { ok: false, error: 'invalid_product' };
    const unitRow = this.db.raw
      .prepare(`SELECT unit_label FROM products WHERE id = ?`)
      .get(productId) as { unit_label: string | null } | undefined;
    const parsed = parseQty(input.countedQty, unitRow?.unit_label, { allowZero: true });
    if (!parsed.ok) return { ok: false, error: 'invalid_qty' };
    if (input.reasonCode !== undefined) {
      const rc = parseReasonCode(input.reasonCode);
      if (!rc.ok) return { ok: false, error: 'invalid_reason' };
    }

    const product = this.db.raw
      .prepare(`SELECT id, active FROM products WHERE id = ?`)
      .get(productId) as { id: string; active: number } | undefined;
    if (!product || product.active !== 1) {
      return { ok: false, error: 'product_not_found' };
    }

    const linePayload: LineInput = {
      productId,
      countedQty: parsed.n,
      reasonCode: input.reasonCode,
    };

    const draft = this.getDraft(input.storeId);
    if (draft && draft.session.source === 'full_screen') {
      const up = this.upsertLines({
        sessionId: draft.session.id,
        storeId: input.storeId,
        lines: [linePayload],
      });
      if (!up.ok) return { ok: false, error: up.error as 'invalid_qty' };
      return {
        ok: true,
        mode: 'draft_line',
        session: up.session,
        lines: up.lines,
      };
    }

    const started = this.start({
      storeId: input.storeId,
      userId: input.userId,
      source: 'catalog_quick',
    });
    if (!started.ok) {
      // Rare race: another draft appeared
      if (started.error === 'draft_exists' && started.draft) {
        const up = this.upsertLines({
          sessionId: started.draft.session.id,
          storeId: input.storeId,
          lines: [linePayload],
        });
        if (!up.ok) return { ok: false, error: up.error as 'invalid_qty' };
        return {
          ok: true,
          mode: 'draft_line',
          session: up.session,
          lines: up.lines,
        };
      }
      return { ok: false, error: 'invalid_product' };
    }

    const up = this.upsertLines({
      sessionId: started.session.id,
      storeId: input.storeId,
      lines: [linePayload],
    });
    if (!up.ok) {
      this.cancel({ sessionId: started.session.id, storeId: input.storeId });
      return { ok: false, error: up.error as 'invalid_qty' };
    }

    const posted = this.post({
      sessionId: started.session.id,
      storeId: input.storeId,
      userId: input.userId,
      note: 'stock count',
    });
    if (!posted.ok) {
      this.cancel({ sessionId: started.session.id, storeId: input.storeId });
      return { ok: false, error: posted.error as 'nothing_to_post' };
    }
    return {
      ok: true,
      mode: 'posted',
      session: posted.session,
      adjusted: posted.adjusted,
      totalAbsDelta: posted.totalAbsDelta,
      adjustments: posted.adjustments,
    };
  }

  listAdjustments(productId?: string, limit = 50): AdjustmentRow[] {
    const lim = Math.min(Math.max(1, limit), 200);
    if (productId) {
      return this.db.raw
        .prepare(
          `SELECT ${ADJ_COLS}
           FROM stock_adjustments
           WHERE product_id = ?
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(productId, lim) as AdjustmentRow[];
    }
    return this.db.raw
      .prepare(
        `SELECT ${ADJ_COLS}
         FROM stock_adjustments
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(lim) as AdjustmentRow[];
  }

  private parseStatusFilter(raw?: string): CountStatus[] {
    const defaultStatuses: CountStatus[] = ['posted', 'draft'];
    if (raw == null || !String(raw).trim()) return defaultStatuses;
    const parts = String(raw)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const allowed = new Set<CountStatus>(['draft', 'posted', 'cancelled']);
    const out: CountStatus[] = [];
    for (const p of parts) {
      if (allowed.has(p as CountStatus) && !out.includes(p as CountStatus)) {
        out.push(p as CountStatus);
      }
    }
    return out.length > 0 ? out : defaultStatuses;
  }

  private aggregatesFor(session: CountSessionRow): CountAggregates {
    if (session.status === 'posted') {
      return this.aggregatesPosted(session.id);
    }
    return this.aggregatesFromLines(session.id);
  }

  private aggregatesFromLines(sessionId: string): CountAggregates {
    const agg = emptyAggregates();
    const lines = this.linesFor(sessionId).filter((l) => l.counted_qty != null);
    agg.items_counted = lines.length;
    for (const line of lines) {
      const variance = (line.counted_qty as number) - line.system_qty_snapshot;
      if (variance === 0) {
        agg.items_matching += 1;
      } else if (variance < 0) {
        agg.items_missing += 1;
        agg.abs_delta_units += Math.abs(variance);
        agg.net_delta_units += variance;
        if (line.unit_cost_paisa_snapshot == null) {
          agg.items_uncosted += 1;
        } else {
          const v = variance * line.unit_cost_paisa_snapshot;
          agg.value_delta_paisa = (agg.value_delta_paisa ?? 0) + v;
          agg.loss_paisa = (agg.loss_paisa ?? 0) + Math.abs(v);
        }
      } else {
        agg.items_extra += 1;
        agg.abs_delta_units += variance;
        agg.net_delta_units += variance;
        if (line.unit_cost_paisa_snapshot == null) {
          agg.items_uncosted += 1;
        } else {
          const v = variance * line.unit_cost_paisa_snapshot;
          agg.value_delta_paisa = (agg.value_delta_paisa ?? 0) + v;
          agg.gain_paisa = (agg.gain_paisa ?? 0) + v;
        }
      }
    }
    return agg;
  }

  private aggregatesPosted(sessionId: string): CountAggregates {
    const agg = emptyAggregates();
    const countedRow = this.db.raw
      .prepare(
        `SELECT COUNT(*) AS c FROM stock_count_lines
         WHERE session_id = ? AND counted_qty IS NOT NULL`,
      )
      .get(sessionId) as { c: number };
    agg.items_counted = Number(countedRow?.c ?? 0);

    const adjs = this.db.raw
      .prepare(
        `SELECT delta_pieces, unit_cost_paisa
         FROM stock_adjustments WHERE session_id = ?`,
      )
      .all(sessionId) as Array<{
      delta_pieces: number;
      unit_cost_paisa: number | null;
    }>;

    for (const a of adjs) {
      const delta = a.delta_pieces;
      if (delta < 0) {
        agg.items_missing += 1;
      } else if (delta > 0) {
        agg.items_extra += 1;
      }
      agg.abs_delta_units += Math.abs(delta);
      agg.net_delta_units += delta;
      if (a.unit_cost_paisa == null) {
        agg.items_uncosted += 1;
      } else {
        const v = delta * a.unit_cost_paisa;
        agg.value_delta_paisa = (agg.value_delta_paisa ?? 0) + v;
        if (v < 0) agg.loss_paisa = (agg.loss_paisa ?? 0) + Math.abs(v);
        if (v > 0) agg.gain_paisa = (agg.gain_paisa ?? 0) + v;
      }
    }
    agg.items_matching = Math.max(
      0,
      agg.items_counted - agg.items_missing - agg.items_extra,
    );
    return agg;
  }

  private lastFullCount(storeId: string): {
    session: CountSessionRow;
    items_counted: number;
    posted_at: string;
  } | null {
    const session = this.db.raw
      .prepare(
        `SELECT ${SESSION_COLS}
         FROM stock_count_sessions
         WHERE store_id = ? AND status = 'posted' AND source = 'full_screen'
         ORDER BY posted_at DESC
         LIMIT 1`,
      )
      .get(storeId) as CountSessionRow | undefined;
    if (!session || !session.posted_at) return null;
    const countedRow = this.db.raw
      .prepare(
        `SELECT COUNT(*) AS c FROM stock_count_lines
         WHERE session_id = ? AND counted_qty IS NOT NULL`,
      )
      .get(session.id) as { c: number };
    return {
      session,
      items_counted: Number(countedRow?.c ?? 0),
      posted_at: session.posted_at,
    };
  }

  /** Losses only (delta < 0), current PKT calendar month, forward-only costed rows. */
  private monthlyShrinkage(): {
    loss_paisa: number;
    uncosted_loss_items: number;
    month_start_pkt: string;
  } {
    const { startUtc, endUtc } = karachiMonthUtcBounds();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Karachi',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year')!.value;
    const m = parts.find((p) => p.type === 'month')!.value;
    const month_start_pkt = `${y}-${m}-01`;

    const row = this.db.raw
      .prepare(
        `SELECT
           COALESCE(SUM(
             CASE WHEN unit_cost_paisa IS NOT NULL
               THEN (-delta_pieces) * unit_cost_paisa
               ELSE 0 END
           ), 0) AS loss_paisa,
           COALESCE(SUM(
             CASE WHEN unit_cost_paisa IS NULL THEN 1 ELSE 0 END
           ), 0) AS uncosted_loss_items
         FROM stock_adjustments
         WHERE reason = 'stock_count'
           AND delta_pieces < 0
           AND created_at >= ? AND created_at < ?`,
      )
      .get(startUtc, endUtc) as {
      loss_paisa: number;
      uncosted_loss_items: number;
    };

    return {
      loss_paisa: Number(row?.loss_paisa ?? 0),
      uncosted_loss_items: Number(row?.uncosted_loss_items ?? 0),
      month_start_pkt,
    };
  }

  private progressFor(sessionId: string): { counted: number; total: number } {
    const countedRow = this.db.raw
      .prepare(
        `SELECT COUNT(*) AS c FROM stock_count_lines
         WHERE session_id = ? AND counted_qty IS NOT NULL`,
      )
      .get(sessionId) as { c: number };
    return {
      counted: Number(countedRow?.c ?? 0),
      total: this.activeProductCount(),
    };
  }

  private activeProductCount(): number {
    const row = this.db.raw
      .prepare(`SELECT COUNT(*) AS c FROM products WHERE active = 1`)
      .get() as { c: number };
    return Number(row?.c ?? 0);
  }

  private sessionById(id: string): CountSessionRow | undefined {
    return this.db.raw
      .prepare(
        `SELECT ${SESSION_COLS}
         FROM stock_count_sessions WHERE id = ?`,
      )
      .get(id) as CountSessionRow | undefined;
  }

  private linesFor(sessionId: string): CountLineRow[] {
    return this.db.raw
      .prepare(
        `SELECT ${LINE_COLS}
         FROM stock_count_lines
         WHERE session_id = ?
         ORDER BY updated_at DESC`,
      )
      .all(sessionId) as CountLineRow[];
  }

  private qtyOnHand(productId: string): number {
    const row = this.db.raw
      .prepare(`SELECT qty_on_hand FROM stock_balances WHERE product_id = ?`)
      .get(productId) as { qty_on_hand: number } | undefined;
    return row?.qty_on_hand ?? 0;
  }
}
