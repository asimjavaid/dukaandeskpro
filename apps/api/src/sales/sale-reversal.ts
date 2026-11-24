import { randomUUID } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3';
type Database = BetterSqlite3.Database;

/**
 * Shared "remove a bill" reversal. Must run inside a db transaction.
 * - Restock every line.
 * - Khata (named customer only): credit back the udhaar debit and debit back
 *   any "kept on khata" surplus credit. Both written with collected_on NULL so
 *   they are never counted as cash received.
 * - Mark the sale voided (who / why / replaced_by).
 * Throws Error(code) on refusal so the surrounding transaction rolls back.
 */
export type ReverseSaleOpts = {
  now: string;
  voidedBy?: string | null;
  reason?: string | null;
  replacedBySaleId?: string | null;
  /** Ledger note label, e.g. "Bill 1A2B3C4D removed". */
  note?: string | null;
  /** Refuse when the bill has returns (default true). */
  refuseIfReturns?: boolean;
};

export type ReversedSale = {
  id: string;
  short_id: string;
  party_id: string | null;
  payment_method: string;
  total_paisa: number;
  cash_amount_paisa: number;
  udhaar_amount_paisa: number;
  recorded_at: string;
  udhaar_reversed_paisa: number;
  surplus_reversed_paisa: number;
  lines: Array<{ product_id: string; qty_pieces: number }>;
};

export function reverseSaleInTxn(
  raw: Database,
  saleId: string,
  opts: ReverseSaleOpts,
): ReversedSale {
  const sale = raw
    .prepare(
      `SELECT id, short_id, payment_method, party_id, total_paisa,
              cash_amount_paisa, udhaar_amount_paisa, voided_at, recorded_at
       FROM sales WHERE id = ?`,
    )
    .get(saleId) as
    | {
        id: string;
        short_id: string;
        payment_method: string;
        party_id: string | null;
        total_paisa: number;
        cash_amount_paisa: number;
        udhaar_amount_paisa: number | null;
        voided_at: string | null;
        recorded_at: string;
      }
    | undefined;
  if (!sale) throw new Error('sale_not_found');
  if (sale.voided_at) throw new Error('sale_already_voided');
  if (opts.refuseIfReturns !== false) {
    const r = raw
      .prepare(`SELECT COUNT(*) AS n FROM sale_returns WHERE sale_id = ?`)
      .get(saleId) as { n: number };
    if (Number(r?.n ?? 0) > 0) throw new Error('sale_has_returns');
  }

  const lines = raw
    .prepare(`SELECT product_id, qty_pieces FROM sale_lines WHERE sale_id = ?`)
    .all(saleId) as Array<{ product_id: string; qty_pieces: number }>;
  const ensure = raw.prepare(
    `INSERT OR IGNORE INTO stock_balances (product_id, qty_on_hand) VALUES (?, 0)`,
  );
  const restore = raw.prepare(
    `UPDATE stock_balances SET qty_on_hand = ROUND(qty_on_hand + ?, 3), updated_at = datetime('now')
     WHERE product_id = ?`,
  );
  for (const l of lines) {
    ensure.run(l.product_id);
    restore.run(l.qty_pieces, l.product_id);
  }

  const note = opts.note ?? `Bill ${sale.short_id} removed`;
  let udhaarReversed = 0;
  let surplusReversed = 0;
  if (sale.party_id) {
    // Udhaar debits written by the sale itself.
    const deb = raw
      .prepare(
        `SELECT COALESCE(SUM(amount_paisa), 0) AS t FROM party_ledger
         WHERE sale_id = ? AND entry_type = 'debit' AND return_id IS NULL`,
      )
      .get(saleId) as { t: number };
    // Surplus kept on khata (dated credit written at sale time).
    const cred = raw
      .prepare(
        `SELECT COALESCE(SUM(amount_paisa), 0) AS t FROM party_ledger
         WHERE sale_id = ? AND entry_type = 'credit' AND collected_on IS NOT NULL
           AND return_id IS NULL`,
      )
      .get(saleId) as { t: number };
    udhaarReversed = Number(deb?.t ?? 0);
    surplusReversed = Number(cred?.t ?? 0);
    const ins = raw.prepare(
      `INSERT INTO party_ledger (id, party_id, entry_type, amount_paisa, sale_id, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    if (udhaarReversed > 0) {
      ins.run(randomUUID(), sale.party_id, 'credit', udhaarReversed, sale.id, note);
    }
    if (surplusReversed > 0) {
      ins.run(randomUUID(), sale.party_id, 'debit', surplusReversed, sale.id, note);
    }
  }

  // Loyalty points earned / spent on this bill go back.
  const pts = raw
    .prepare(`SELECT party_id, COALESCE(SUM(points), 0) AS p FROM loyalty_ledger WHERE sale_id = ? GROUP BY party_id`)
    .all(saleId) as Array<{ party_id: string; p: number }>;
  for (const r of pts) {
    if (Number(r.p) !== 0) {
      raw
        .prepare(`INSERT INTO loyalty_ledger (id, party_id, sale_id, points, kind, note) VALUES (?, ?, ?, ?, 'reverse', ?)`)
        .run(randomUUID(), r.party_id, saleId, -Number(r.p), note);
    }
  }

  raw
    .prepare(
      `UPDATE sales SET voided_at = ?, voided_by = ?, void_reason = ?,
              replaced_by_sale_id = COALESCE(?, replaced_by_sale_id)
       WHERE id = ?`,
    )
    .run(
      opts.now,
      opts.voidedBy ?? null,
      opts.reason ?? null,
      opts.replacedBySaleId ?? null,
      sale.id,
    );

  return {
    id: sale.id,
    short_id: sale.short_id,
    party_id: sale.party_id,
    payment_method: sale.payment_method,
    total_paisa: Number(sale.total_paisa),
    cash_amount_paisa: Number(sale.cash_amount_paisa ?? 0),
    udhaar_amount_paisa: Number(sale.udhaar_amount_paisa ?? 0),
    recorded_at: sale.recorded_at,
    udhaar_reversed_paisa: udhaarReversed,
    surplus_reversed_paisa: surplusReversed,
    lines,
  };
}

export function karachiYmd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function writeAudit(
  raw: Database,
  a: {
    action: string;
    userId?: string | null;
    storeId?: string | null;
    subjectType: string;
    subjectId: string;
    payload: unknown;
  },
) {
  raw
    .prepare(
      `INSERT INTO audit_log (id, action, user_id, store_id, subject_type, subject_id, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      a.action,
      a.userId ?? null,
      a.storeId ?? null,
      a.subjectType,
      a.subjectId,
      JSON.stringify(a.payload ?? {}),
    );
}
