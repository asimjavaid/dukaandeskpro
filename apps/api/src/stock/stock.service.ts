import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { parseMoneyPair, parsePositiveInt } from '../common/amount';
import { parseQty } from '../common/qty';
import { DbService } from '../db/db.service';

export type StockUnit = 'piece' | 'carton';

export type StockBalanceRow = {
  product_id: string;
  product_name: string;
  unit_label: string;
  pieces_per_carton: number;
  qty_on_hand: number;
  updated_at: string;
};

export type ReceiveResult =
  | {
      ok: true;
      receive: {
        id: string;
        productId: string;
        qtyInput: number;
        unit: StockUnit;
        qtyPieces: number;
        amountPaisa: number | null;
        unitCostPaisa: number | null;
      };
      balance: { productId: string; qtyOnHand: number };
      lastUnitCostPaisa: number | null;
    }
  | { ok: false; error: string };

/**
 * Unit cost in paisa.
 * amountPaisa and pieces are integers; pieces must be > 0.
 * JS Math.round: halves round toward +∞ (0.5 → 1).
 * Example: Rs 100 / 3 pieces = 10000 / 3 → 3333 paisa.
 */
export function unitCostFromAmount(amountPaisa: number, pieces: number): number {
  return Math.round(amountPaisa / pieces);
}

@Injectable()
export class StockService {
  constructor(private readonly db: DbService) {}

  list(): StockBalanceRow[] {
    return this.db.raw
      .prepare(
        `SELECT
           sb.product_id,
           p.name AS product_name,
           p.unit_label,
           p.pieces_per_carton,
           sb.qty_on_hand,
           sb.updated_at
         FROM stock_balances sb
         JOIN products p ON p.id = sb.product_id
         WHERE p.active = 1
         ORDER BY p.name ASC`,
      )
      .all() as StockBalanceRow[];
  }

  getQty(productId: string): number {
    const row = this.db.raw
      .prepare(`SELECT qty_on_hand FROM stock_balances WHERE product_id = ?`)
      .get(productId) as { qty_on_hand: number } | undefined;
    return row?.qty_on_hand ?? 0;
  }

  /**
   * Receive stock in pieces.
   * piece: pieces + total paid.
   * carton: total pieces inside the carton + carton cost.
   * Stock += pieces either way. Sets products.last_unit_cost_paisa.
   * Does not rewrite sale_lines.
   */
  receive(input: {
    productId: string;
    qty?: unknown;
    pieces?: unknown;
    unit?: string;
    amountRs?: unknown;
    amountPaisa?: unknown;
    receivedBy?: string;
    note?: string;
    /** Sample seed only. Public receive always requires an amount and a supplier. */
    allowMissingAmount?: boolean;
    supplierId?: string;
    /** When true, the receive is not added to the supplier balance. */
    paidNow?: boolean;
  }): ReceiveResult {
    const productId = (input.productId ?? '').trim();
    if (!productId) {
      return { ok: false, error: 'invalid_product' };
    }

    const product = this.db.raw
      .prepare(`SELECT id, active, unit_label FROM products WHERE id = ?`)
      .get(productId) as { id: string; active: number; unit_label: string | null } | undefined;

    if (!product || product.active !== 1) {
      return { ok: false, error: 'product_not_found' };
    }

    const piecesRaw = input.pieces != null ? input.pieces : input.qty;
    const pieces =
      (input.unit ?? 'piece').toLowerCase().trim() === 'carton'
        ? parsePositiveInt(piecesRaw)
        : parseQty(piecesRaw, product.unit_label);
    if (!pieces.ok) return { ok: false, error: 'invalid_qty' };
    const qtyPieces = pieces.n;

    const unitRaw = (input.unit ?? 'piece').toLowerCase().trim();
    if (unitRaw !== 'piece' && unitRaw !== 'carton') {
      return { ok: false, error: 'invalid_unit' };
    }
    const unit: StockUnit = unitRaw;

    const amount = parseMoneyPair(input.amountPaisa, input.amountRs, 'missing');
    if (!amount.ok) {
      if (amount.error === 'amount_required' && input.allowMissingAmount) {
        return this.receiveWithoutCost({
          productId,
          qtyPieces,
          unit,
          receivedBy: input.receivedBy,
          note: input.note,
        });
      }
      return amount;
    }

    const supplierId = (input.supplierId ?? '').trim();
    if (!supplierId) return { ok: false, error: 'supplier_required' };
    const supplier = this.db.raw
      .prepare(`SELECT id FROM suppliers WHERE id = ? AND active = 1`)
      .get(supplierId) as { id: string } | undefined;
    if (!supplier) return { ok: false, error: 'supplier_not_found' };
    const paidNow = input.paidNow ? 1 : 0;

    const amountPaisa = amount.paisa;
    const unitCostPaisa = unitCostFromAmount(amountPaisa, qtyPieces);
    const receiveId = randomUUID();
    const note =
      input.note != null && String(input.note).trim()
        ? String(input.note).trim().slice(0, 240)
        : null;

    const run = this.db.raw.transaction(() => {
      this.db.raw
        .prepare(
          `INSERT INTO stock_receives
             (id, product_id, qty_input, unit, qty_pieces, received_by, note,
              amount_paisa, unit_cost_paisa, supplier_id, paid_now)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          receiveId,
          productId,
          qtyPieces,
          unit,
          qtyPieces,
          input.receivedBy ?? null,
          note,
          amountPaisa,
          unitCostPaisa,
          supplierId,
          paidNow,
        );

      this.db.raw
        .prepare(
          `INSERT INTO stock_balances (product_id, qty_on_hand, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT(product_id) DO UPDATE SET
             qty_on_hand = ROUND(qty_on_hand + excluded.qty_on_hand, 3),
             updated_at = datetime('now')`,
        )
        .run(productId, qtyPieces);

      this.db.raw
        .prepare(
          `UPDATE products
           SET last_unit_cost_paisa = ?, updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(unitCostPaisa, productId);

      const bal = this.db.raw
        .prepare(`SELECT qty_on_hand FROM stock_balances WHERE product_id = ?`)
        .get(productId) as { qty_on_hand: number };

      return bal.qty_on_hand;
    });

    const qtyOnHand = run();

    return {
      ok: true,
      receive: {
        id: receiveId,
        productId,
        qtyInput: qtyPieces,
        unit,
        qtyPieces,
        amountPaisa,
        unitCostPaisa,
      },
      balance: { productId, qtyOnHand },
      lastUnitCostPaisa: unitCostPaisa,
    };
  }

  /** Ensure a zero balance row exists (called on product create). */
  ensureBalance(productId: string): void {
    this.db.raw
      .prepare(
        `INSERT OR IGNORE INTO stock_balances (product_id, qty_on_hand)
         VALUES (?, 0)`,
      )
      .run(productId);
  }

  /** Stock only. Leaves last_unit_cost_paisa and past sale lines untouched. */
  private receiveWithoutCost(input: {
    productId: string;
    qtyPieces: number;
    unit: StockUnit;
    receivedBy?: string;
    note?: string;
  }): ReceiveResult {
    const receiveId = randomUUID();
    const note =
      input.note != null && String(input.note).trim()
        ? String(input.note).trim().slice(0, 240)
        : null;

    const run = this.db.raw.transaction(() => {
      this.db.raw
        .prepare(
          `INSERT INTO stock_receives
             (id, product_id, qty_input, unit, qty_pieces, received_by, note,
              amount_paisa, unit_cost_paisa, supplier_id, paid_now)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0)`,
        )
        .run(
          receiveId,
          input.productId,
          input.qtyPieces,
          input.unit,
          input.qtyPieces,
          input.receivedBy ?? null,
          note,
        );

      this.db.raw
        .prepare(
          `INSERT INTO stock_balances (product_id, qty_on_hand, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT(product_id) DO UPDATE SET
             qty_on_hand = ROUND(qty_on_hand + excluded.qty_on_hand, 3),
             updated_at = datetime('now')`,
        )
        .run(input.productId, input.qtyPieces);

      const bal = this.db.raw
        .prepare(`SELECT qty_on_hand FROM stock_balances WHERE product_id = ?`)
        .get(input.productId) as { qty_on_hand: number };
      const cost = this.db.raw
        .prepare(
          `SELECT last_unit_cost_paisa FROM products WHERE id = ?`,
        )
        .get(input.productId) as { last_unit_cost_paisa: number | null };
      return {
        qtyOnHand: bal.qty_on_hand,
        last: cost.last_unit_cost_paisa,
      };
    });

    const out = run();
    return {
      ok: true,
      receive: {
        id: receiveId,
        productId: input.productId,
        qtyInput: input.qtyPieces,
        unit: input.unit,
        qtyPieces: input.qtyPieces,
        amountPaisa: null,
        unitCostPaisa: null,
      },
      balance: { productId: input.productId, qtyOnHand: out.qtyOnHand },
      lastUnitCostPaisa: out.last,
    };
  }
}
