import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { lineMoney, parseQty, r3 } from '../common/qty';
import { karachiYmd, writeAudit } from '../sales/sale-reversal';

type Fail = { ok: false; error: string };

/**
 * Goods sent back to a supplier (debit note). Stock goes down; the value is
 * taken off what we owe that supplier (counted with payments).
 */
@Injectable()
export class SupplierReturnsService {
  constructor(private readonly db: DbService) {}

  create(input: {
    supplierId: string;
    lines?: Array<{ productId?: unknown; qty?: unknown; unitCostRs?: unknown }>;
    note?: unknown;
    userId: string;
    storeId?: string | null;
  }) {
    const sup = this.db.raw.prepare(`SELECT id, name FROM suppliers WHERE id = ? AND active = 1`).get(input.supplierId) as
      | { id: string; name: string }
      | undefined;
    if (!sup) return { ok: false, error: 'supplier_not_found' } as Fail;
    const raw = Array.isArray(input.lines) ? input.lines : [];
    if (raw.length < 1 || raw.length > 200) return { ok: false, error: 'lines_required' } as Fail;
    const lines: Array<{ productId: string; name: string; qty: number; cost: number; total: number }> = [];
    const demand = new Map<string, number>();
    for (const l of raw) {
      const p = this.db.raw
        .prepare(
          `SELECT p.id, p.name, p.unit_label, p.last_unit_cost_paisa, COALESCE(s.qty_on_hand, 0) AS qty
           FROM products p LEFT JOIN stock_balances s ON s.product_id = p.id WHERE p.id = ?`,
        )
        .get(String(l.productId ?? '')) as
        | { id: string; name: string; unit_label: string; last_unit_cost_paisa: number | null; qty: number }
        | undefined;
      if (!p) return { ok: false, error: 'product_not_found' } as Fail;
      const q = parseQty(l.qty, p.unit_label);
      if (!q.ok) return { ok: false, error: 'invalid_qty' } as Fail;
      let cost = p.last_unit_cost_paisa == null ? 0 : Math.round(Number(p.last_unit_cost_paisa));
      if (l.unitCostRs != null && String(l.unitCostRs).trim() !== '') {
        const c = Number(l.unitCostRs);
        if (!Number.isFinite(c) || c < 0) return { ok: false, error: 'invalid_cost' } as Fail;
        cost = Math.round(c * 100);
      }
      demand.set(p.id, r3((demand.get(p.id) ?? 0) + q.n));
      if ((demand.get(p.id) ?? 0) > r3(p.qty) + 1e-9) return { ok: false, error: 'qty_exceeds_stock' } as Fail;
      lines.push({ productId: p.id, name: p.name, qty: q.n, cost, total: lineMoney(q.n, cost) });
    }
    const total = lines.reduce((s, l) => s + l.total, 0);
    if (total <= 0) return { ok: false, error: 'nothing_to_return' } as Fail;
    const id = randomUUID();
    const shortId = id.replace(/-/g, '').slice(0, 8).toUpperCase();
    const note = String(input.note ?? '').trim().slice(0, 240) || null;
    const now = new Date();
    try {
      this.db.raw.transaction(() => {
        this.db.raw
          .prepare(
            `INSERT INTO supplier_returns (id, short_id, supplier_id, total_paisa, note, returned_on, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(id, shortId, sup.id, total, note, karachiYmd(now), input.userId, now.toISOString());
        const ins = this.db.raw.prepare(
          `INSERT INTO supplier_return_lines (id, return_id, product_id, product_name, qty, unit_cost_paisa, line_total_paisa)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        const dec = this.db.raw.prepare(
          `UPDATE stock_balances SET qty_on_hand = ROUND(qty_on_hand - ?, 3), updated_at = datetime('now')
           WHERE product_id = ? AND qty_on_hand >= ? - 0.0000001`,
        );
        for (const l of lines) {
          ins.run(randomUUID(), id, l.productId, l.name, l.qty, l.cost, l.total);
          if (dec.run(l.qty, l.productId, l.qty).changes !== 1) throw new Error('stock_race');
        }
        writeAudit(this.db.raw, {
          action: 'supplier.return',
          userId: input.userId,
          storeId: input.storeId ?? null,
          subjectType: 'supplier',
          subjectId: sup.id,
          payload: { short_id: shortId, total_paisa: total, lines: lines.length },
        });
      })();
    } catch (e) {
      if (e instanceof Error && e.message === 'stock_race') return { ok: false, error: 'qty_exceeds_stock' } as Fail;
      throw e;
    }
    return { ok: true as const, return: this.get(id)! };
  }

  get(id: string) {
    const r = this.db.raw
      .prepare(
        `SELECT r.*, s.name AS supplier_name FROM supplier_returns r JOIN suppliers s ON s.id = r.supplier_id
         WHERE r.id = ? OR r.short_id = ?`,
      )
      .get(id, id.toUpperCase()) as Record<string, unknown> | undefined;
    if (!r) return null;
    const lines = this.db.raw
      .prepare(`SELECT product_id, product_name, qty, unit_cost_paisa, line_total_paisa FROM supplier_return_lines WHERE return_id = ?`)
      .all(String(r.id));
    return { ...r, lines };
  }
}
