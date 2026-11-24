import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { allowsFraction, parseQty, r3 } from '../common/qty';
import { writeAudit, karachiYmd } from '../sales/sale-reversal';

type Fail = { ok: false; error: string };

/** Batch 2: damaged / expired write-off, reorder suggestions, near-expiry batches. */
@Injectable()
export class StockExtraService {
  constructor(private readonly db: DbService) {}

  writeOff(input: {
    productId?: unknown;
    qty?: unknown;
    reason?: unknown;
    note?: unknown;
    batchLineId?: unknown;
    userId: string;
    storeId?: string | null;
  }): { ok: true; id: string; qty_after: number; value_paisa: number } | Fail {
    const reason = String(input.reason ?? '');
    if (reason !== 'damaged' && reason !== 'expired') return { ok: false, error: 'invalid_reason' };
    const p = this.db.raw
      .prepare(
        `SELECT p.id, p.name, p.unit_label, p.last_unit_cost_paisa, COALESCE(s.qty_on_hand, 0) AS qty
         FROM products p LEFT JOIN stock_balances s ON s.product_id = p.id WHERE p.id = ?`,
      )
      .get(String(input.productId ?? '')) as
      | { id: string; name: string; unit_label: string; last_unit_cost_paisa: number | null; qty: number }
      | undefined;
    if (!p) return { ok: false, error: 'product_not_found' };
    const q = parseQty(input.qty, p.unit_label);
    if (!q.ok) return { ok: false, error: 'invalid_qty' };
    if (q.n > r3(p.qty) + 1e-9) return { ok: false, error: 'qty_exceeds_stock' };
    const after = r3(p.qty - q.n);
    const cost = p.last_unit_cost_paisa == null ? null : Math.round(Number(p.last_unit_cost_paisa));
    const note = String(input.note ?? '').trim().slice(0, 200) || null;
    const id = randomUUID();
    const batchId = String(input.batchLineId ?? '').trim();
    this.db.raw.transaction(() => {
      this.db.raw
        .prepare(
          `INSERT INTO stock_adjustments (id, product_id, delta_pieces, qty_before, qty_after, reason,
             created_by, note, reason_code, unit_cost_paisa, created_at)
           VALUES (?, ?, ?, ?, ?, 'write_off', ?, ?, ?, ?, datetime('now'))`,
        )
        .run(id, p.id, -q.n, p.qty, after, input.userId, note, reason, cost);
      this.db.raw
        .prepare(`UPDATE stock_balances SET qty_on_hand = ?, updated_at = datetime('now') WHERE product_id = ?`)
        .run(after, p.id);
      if (batchId) {
        this.db.raw
          .prepare(`UPDATE purchase_lines SET batch_left = MAX(0, ROUND(COALESCE(batch_left, 0) - ?, 3)) WHERE id = ? AND product_id = ?`)
          .run(q.n, batchId, p.id);
      }
      writeAudit(this.db.raw, {
        action: 'stock.write_off',
        userId: input.userId,
        storeId: input.storeId ?? null,
        subjectType: 'product',
        subjectId: p.id,
        payload: { name: p.name, qty: q.n, reason, note },
      });
    })();
    return { ok: true, id, qty_after: after, value_paisa: cost == null ? 0 : Math.round(cost * q.n) };
  }

  writeOffs(opts: { from?: string; to?: string }) {
    const to = opts.to && /^\d{4}-\d{2}-\d{2}$/.test(opts.to) ? opts.to : karachiYmd(new Date());
    const from =
      opts.from && /^\d{4}-\d{2}-\d{2}$/.test(opts.from)
        ? opts.from
        : karachiYmd(new Date(Date.now() - 29 * 86400000));
    const rows = this.db.raw
      .prepare(
        `SELECT a.id, a.product_id, p.name AS product_name, p.unit_label, -a.delta_pieces AS qty,
                a.reason_code AS reason, a.note, a.unit_cost_paisa, a.created_at, u.display_name AS by_name
         FROM stock_adjustments a
         JOIN products p ON p.id = a.product_id
         LEFT JOIN users u ON u.id = a.created_by
         WHERE a.reason = 'write_off'
           AND date(a.created_at, '+5 hours') BETWEEN ? AND ?
         ORDER BY a.created_at DESC LIMIT 500`,
      )
      .all(from, to) as Array<Record<string, unknown>>;
    const items = rows.map((r) => ({
      ...r,
      reason: String(r.reason ?? ''),
      qty: r3(Number(r.qty)),
      value_paisa: r.unit_cost_paisa == null ? 0 : Math.round(Number(r.unit_cost_paisa) * Number(r.qty)),
    }));
    return {
      from,
      to,
      items,
      total_value_paisa: items.reduce((s, i) => s + i.value_paisa, 0),
      damaged_value_paisa: items.filter((i) => i.reason === 'damaged').reduce((s, i) => s + i.value_paisa, 0),
      expired_value_paisa: items.filter((i) => i.reason === 'expired').reduce((s, i) => s + i.value_paisa, 0),
      // Already inside packet cost; shown for information, not added to the total.
      repack_wastage: this.repackWastage(from, to),
    };
  }

  private repackWastage(from: string, to: string) {
    const rows = this.db.raw
      .prepare(
        `SELECT r.id, r.short_id, p.name AS product_name, p.unit_label, r.wastage_qty AS qty, r.bulk_unit_cost_paisa, r.created_at
         FROM repacks r JOIN products p ON p.id = r.bulk_product_id
         WHERE r.voided_at IS NULL AND r.wastage_qty > 0 AND date(r.created_at, '+5 hours') BETWEEN ? AND ?
         ORDER BY r.created_at DESC`,
      )
      .all(from, to) as Array<{ qty: number; bulk_unit_cost_paisa: number }>;
    const items = rows.map((r) => ({ ...r, value_paisa: Math.round(r.qty * r.bulk_unit_cost_paisa) }));
    return { items, value_paisa: items.reduce((s, i) => s + i.value_paisa, 0) };
  }

  /** Items at or under their reorder level, with a suggested buy (up to 2× level). */
  reorder() {
    const rows = this.db.raw
      .prepare(
        `SELECT p.id, p.name, p.unit_label, p.reorder_level, p.last_unit_cost_paisa, p.pieces_per_carton,
                COALESCE(s.qty_on_hand, 0) AS qty_on_hand,
                (SELECT su.name FROM stock_receives r JOIN suppliers su ON su.id = r.supplier_id
                  WHERE r.product_id = p.id ORDER BY r.rowid DESC LIMIT 1) AS last_supplier,
                p.repack_from_id, p.size_qty, b.name AS bulk_name, b.unit_label AS bulk_unit,
                COALESCE(bs.qty_on_hand, 0) AS bulk_on_hand
         FROM products p
         LEFT JOIN products b ON b.id = p.repack_from_id
         LEFT JOIN stock_balances bs ON bs.product_id = p.repack_from_id LEFT JOIN stock_balances s ON s.product_id = p.id
         WHERE p.active = 1 AND p.reorder_level IS NOT NULL
           AND COALESCE(s.qty_on_hand, 0) <= p.reorder_level
         ORDER BY (COALESCE(s.qty_on_hand, 0) - p.reorder_level) ASC, p.name COLLATE NOCASE`,
      )
      .all() as Array<{
      id: string;
      name: string;
      unit_label: string;
      reorder_level: number;
      last_unit_cost_paisa: number | null;
      pieces_per_carton: number;
      qty_on_hand: number;
      last_supplier: string | null;
      repack_from_id: string | null;
      size_qty: number | null;
      bulk_name: string | null;
      bulk_unit: string | null;
      bulk_on_hand: number;
    }>;
    return rows.map((r) => {
      const frac = allowsFraction(r.unit_label);
      const raw = Math.max(0, Number(r.reorder_level) * 2 - Number(r.qty_on_hand));
      const suggest = frac ? r3(raw) : Math.max(1, Math.ceil(raw));
      // Packets that bulk stock can make: repack instead of buying.
      const canMake = r.repack_from_id && r.size_qty ? Math.floor((Number(r.bulk_on_hand) + 1e-9) / Number(r.size_qty)) : 0;
      const repack = canMake > 0 ? { bulk_id: r.repack_from_id, bulk_name: r.bulk_name, bulk_unit: r.bulk_unit, bulk_on_hand: r3(r.bulk_on_hand), can_make: canMake } : null;
      return { ...r, qty_on_hand: r3(r.qty_on_hand), suggested_qty: suggest, repack };
    });
  }

  /** Batches with an expiry date inside the alert window (or already past), still on the shelf. */
  expiring(days?: number) {
    const store = this.db.raw.prepare(`SELECT expiry_alert_days FROM store LIMIT 1`).get() as
      | { expiry_alert_days: number }
      | undefined;
    const window = Math.max(1, Math.min(365, Math.floor(Number(days ?? store?.expiry_alert_days ?? 30)) || 30));
    const today = karachiYmd(new Date());
    const until = karachiYmd(new Date(Date.now() + window * 86400000));
    const rows = this.db.raw
      .prepare(
        `SELECT l.id AS batch_line_id, l.product_id, p.name AS product_name, p.unit_label, l.expiry_date, l.batch_no,
                l.batch_left, COALESCE(s.qty_on_hand, 0) AS qty_on_hand, i.purchased_on, su.name AS supplier_name
         FROM purchase_lines l
         JOIN products p ON p.id = l.product_id
         JOIN purchase_invoices i ON i.id = l.invoice_id
         LEFT JOIN suppliers su ON su.id = i.supplier_id
         LEFT JOIN stock_balances s ON s.product_id = l.product_id
         WHERE l.expiry_date IS NOT NULL AND l.expiry_date <= ? AND COALESCE(l.batch_left, 0) > 0
           AND COALESCE(s.qty_on_hand, 0) > 0
         ORDER BY l.expiry_date ASC, p.name COLLATE NOCASE`,
      )
      .all(until) as Array<Record<string, unknown>>;
    return {
      window_days: window,
      today,
      items: rows.map((r) => {
        const left = r3(Math.min(Number(r.batch_left), Number(r.qty_on_hand)));
        const exp = String(r.expiry_date);
        const daysLeft = Math.round((Date.parse(`${exp}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
        return { ...r, qty_left: left, days_left: daysLeft, expired: daysLeft < 0 };
      }),
    };
  }

  /** Stop alerting for a batch (sold through or checked). */
  dismissBatch(batchLineId: string): { ok: true } | Fail {
    const r = this.db.raw.prepare(`UPDATE purchase_lines SET batch_left = 0 WHERE id = ? AND expiry_date IS NOT NULL`).run(batchLineId);
    return r.changes === 1 ? { ok: true } : { ok: false, error: 'not_found' };
  }
}
