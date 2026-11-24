import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { SalesService, SaleLineInput, PaymentMethod, CompleteSaleResult } from './sales.service';
import { karachiYmd, reverseSaleInTxn, writeAudit } from './sale-reversal';

export type VoidResult =
  | { ok: true; sale: { id: string; short_id: string; voided_at: string } }
  | { ok: false; error: string };

class ReplaceRefused extends Error {
  constructor(public readonly result: Extract<CompleteSaleResult, { ok: false }>) {
    super(result.error);
  }
}

/**
 * Remove (void) and Edit (void + reissue). Owner only, same PKT day only.
 */
@Injectable()
export class SalesWriteService {
  constructor(
    private readonly db: DbService,
    private readonly sales: SalesService,
  ) {}

  private gate(
    saleId: string,
    role: string,
    now: Date,
  ): { ok: true; id: string; short_id: string } | { ok: false; error: string } {
    if (role !== 'owner') return { ok: false, error: 'owner_only' };
    const sid = (saleId ?? '').trim();
    const row = this.db.raw
      .prepare(
        `SELECT id, short_id, recorded_at, voided_at,
                (SELECT COUNT(*) FROM sale_returns r WHERE r.sale_id = sales.id) AS returns
         FROM sales WHERE id = ? OR short_id = ? LIMIT 1`,
      )
      .get(sid, sid.replace(/^#/, '').toUpperCase()) as
      | { id: string; short_id: string; recorded_at: string; voided_at: string | null; returns: number }
      | undefined;
    if (!row) return { ok: false, error: 'sale_not_found' };
    if (row.voided_at) return { ok: false, error: 'sale_already_voided' };
    if (Number(row.returns) > 0) return { ok: false, error: 'sale_has_returns' };
    if (karachiYmd(new Date(row.recorded_at)) !== karachiYmd(now)) {
      return { ok: false, error: 'sale_not_today' };
    }
    return { ok: true, id: row.id, short_id: row.short_id };
  }

  voidSale(input: {
    saleId: string;
    reason?: string | null;
    role: string;
    userId?: string | null;
    storeId?: string | null;
    now?: Date;
  }): VoidResult {
    const now = input.now ?? new Date();
    const reason = String(input.reason ?? '').trim().slice(0, 200);
    if (input.role !== 'owner') return { ok: false, error: 'owner_only' };
    if (!reason) return { ok: false, error: 'reason_required' };
    const g = this.gate(input.saleId, input.role, now);
    if (!g.ok) return g;
    const nowIso = now.toISOString();
    try {
      this.db.raw.transaction(() => {
        const rev = reverseSaleInTxn(this.db.raw, g.id, {
          now: nowIso,
          voidedBy: input.userId ?? null,
          reason,
          note: `Bill ${g.short_id} removed`,
        });
        writeAudit(this.db.raw, {
          action: 'sale.void',
          userId: input.userId,
          storeId: input.storeId,
          subjectType: 'sale',
          subjectId: g.id,
          payload: {
            short_id: g.short_id,
            reason,
            total_paisa: rev.total_paisa,
            cash_amount_paisa: rev.cash_amount_paisa,
            udhaar_reversed_paisa: rev.udhaar_reversed_paisa,
            surplus_reversed_paisa: rev.surplus_reversed_paisa,
          },
        });
      })();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (['sale_not_found', 'sale_already_voided', 'sale_has_returns'].includes(msg)) {
        return { ok: false, error: msg };
      }
      throw err;
    }
    return { ok: true, sale: { id: g.id, short_id: g.short_id, voided_at: nowIso } };
  }

  /**
   * Edit = remove the old bill and issue a new one, one transaction.
   * Products on the old bill keep their old unit price; new items use today's.
   * Stock check sees on-hand plus the old bill's qty (old is restocked first).
   */
  replaceSale(input: {
    saleId: string;
    role: string;
    userId?: string | null;
    storeId?: string | null;
    lines: SaleLineInput[];
    paymentMethod: PaymentMethod;
    partyId?: string | null;
    cashAmountPaisa?: number | null;
    udhaarAmountPaisa?: number | null;
    tenderedPaisa?: number | null;
    applySurplusToKhata?: boolean | null;
    extras?: import('./sales.service').SaleExtras | null;
    clientDeviceAt?: string;
    now?: Date;
  }): CompleteSaleResult & { replaces?: { id: string; short_id: string } } {
    const now = input.now ?? new Date();
    const g = this.gate(input.saleId, input.role, now);
    if (!g.ok) return g;
    const oldLines = this.db.raw
      .prepare(`SELECT product_id, unit_price_paisa FROM sale_lines WHERE sale_id = ?`)
      .all(g.id) as Array<{ product_id: string; unit_price_paisa: number }>;
    const fixed = new Map<string, number>();
    for (const l of oldLines) {
      if (!fixed.has(l.product_id)) fixed.set(l.product_id, Number(l.unit_price_paisa));
    }
    const nowIso = now.toISOString();
    let result: CompleteSaleResult | null = null;
    try {
      this.db.raw.transaction(() => {
        reverseSaleInTxn(this.db.raw, g.id, {
          now: nowIso,
          voidedBy: input.userId ?? null,
          reason: 'Edited',
          note: `Bill ${g.short_id} edited`,
        });
        const r = this.sales.completeSale({
          lines: input.lines,
          paymentMethod: input.paymentMethod,
          partyId: input.partyId,
          cashAmountPaisa: input.cashAmountPaisa,
          udhaarAmountPaisa: input.udhaarAmountPaisa,
          tenderedPaisa: input.tenderedPaisa,
          applySurplusToKhata: input.applySurplusToKhata,
          clientDeviceAt: input.clientDeviceAt,
          soldBy: input.userId ?? undefined,
          storeId: input.storeId ?? undefined,
          fixedPrices: fixed,
          replacesSaleId: g.id,
          extras: input.extras ?? null,
        });
        if (!r.ok) throw new ReplaceRefused(r);
        this.db.raw
          .prepare(`UPDATE sales SET replaced_by_sale_id = ? WHERE id = ?`)
          .run(r.sale.id, g.id);
        writeAudit(this.db.raw, {
          action: 'sale.replace',
          userId: input.userId,
          storeId: input.storeId,
          subjectType: 'sale',
          subjectId: g.id,
          payload: {
            short_id: g.short_id,
            new_sale_id: r.sale.id,
            new_short_id: r.sale.shortId,
            total_paisa: r.sale.totalPaisa,
          },
        });
        result = r;
      })();
    } catch (err) {
      if (err instanceof ReplaceRefused) return err.result;
      const msg = err instanceof Error ? err.message : String(err);
      if (['sale_not_found', 'sale_already_voided', 'sale_has_returns'].includes(msg)) {
        return { ok: false, error: msg };
      }
      throw err;
    }
    const ok = result as unknown as CompleteSaleResult;
    if (!ok || !ok.ok) return { ok: false, error: 'replace_failed' };
    return { ...ok, replaces: { id: g.id, short_id: g.short_id } };
  }
}
