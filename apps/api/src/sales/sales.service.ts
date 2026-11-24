import { readShopRules } from '../settings/shop-rules';
import { lineMoney, parseQty, r3 } from '../common/qty';
import { Injectable, Optional } from '@nestjs/common';
import { TillsService } from '../tills/tills.service';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import { effectivePricePaisa } from '../catalog/discount';
import { billLabel, currentTillId, offlineBillLabel } from '../tills/till-context';
import { isSupervisor } from '../auth/session.types';

export type SaleUnit = 'piece';
export type PaymentMethod = 'cash' | 'udhaar' | 'split';

export type SaleLineInput = {
  productId: string;
  qty: number;
  unit?: string;
  /**
   * Optional: the unit price the till showed. If the product's current price
   * (after any active discount) differs, the sale is refused with
   * `price_changed` so the cashier never charges a total they did not see.
   */
  expectedUnitPricePaisa?: number | null;
  /** Manager price for this line (owner / manager, or a cashier with a manager approval). */
  overridePricePaisa?: number | null;
};

export type PriceChange = {
  productId: string;
  productName: string;
  /** Price the till charges now (after an active discount). */
  unitPricePaisa: number;
  /** Normal piece price. */
  normalPricePaisa: number;
};

export type Shortage = {
  productId: string;
  productName: string;
  requestedPieces: number;
  onHand: number;
};

export type CompletedSale = {
  id: string;
  tillId: string;
  billNo: number | null;
  loyaltyRedeemPoints: number;
  loyaltyEarnedPoints: number;
  loyaltyBalance: number | null;
  subtotalPaisa: number;
  discountPaisa: number;
  discountLabel: string | null;
  roundingPaisa: number;
  digitalPaisa: number;
  digitalMethod: string | null;
  digitalRef: string | null;
  shortId: string;
  paymentMethod: PaymentMethod;
  partyId: string | null;
  totalPaisa: number;
  cashAmountPaisa: number;
  udhaarAmountPaisa: number;
  /** Cash the customer handed over. 0 on pure udhaar. */
  tenderedPaisa: number;
  /** Change to return. 0 when nothing is handed back. */
  changePaisa: number;
  /** Surplus cash credited to customer khata (0 when returned as change). */
  surplusCreditedPaisa: number;
  clientDeviceAt: string;
  recordedAt: string;
  lines: Array<{
    productId: string;
    productName: string;
    qtyInput: number;
    unit: SaleUnit;
    qtyPieces: number;
    unitPricePaisa: number;
    lineTotalPaisa: number;
    packLabel: string | null;
    packQty: number | null;
    packSize: number | null;
    /** Tax V1 per-line snapshot (0 when tax was OFF). */
    taxRateBp: number;
    taxPaisa: number;
  }>;
  /** Tax V1 snapshot — Sales Tax ON at commit. False → no tax UI anywhere. */
  taxEnabled: boolean;
  /** Global store rate at commit (basis points). 0 when OFF. */
  taxRateBp: number;
  /** Σ line tax extracted from the shelf price. 0 when OFF. */
  taxPaisa: number;
  /** total − tax when ON; null when OFF. */
  taxBasePaisa: number | null;
};

/** Batch 2 extras on a bill: bill discount, digital tender, credit limit override. */
export type SaleExtras = {
  /** Whole-bill discount: Rs amount or percent (0–100). */
  discount?: { kind?: string; value?: number } | null;
  /** JazzCash / Easypaisa / bank part of the paid-now amount (paisa). */
  digitalPaisa?: number | null;
  digitalMethod?: string | null;
  digitalRef?: string | null;
  /** Owner only: go over a customer's credit limit in block mode. */
  overrideCreditLimit?: boolean | null;
  /** Loyalty points to spend on this bill (needs a customer and loyalty on). */
  loyaltyRedeemPoints?: number | null;
  role?: string | null;
  /** Who allowed the line price overrides (the manager / owner user id). */
  overrideBy?: string | null;
};

/** Points a customer holds now. */
export function loyaltyBalance(db: { prepare: (sql: string) => { get: (...a: unknown[]) => unknown } }, partyId: string): number {
  const r = db.prepare(`SELECT COALESCE(SUM(points), 0) AS p FROM loyalty_ledger WHERE party_id = ?`).get(partyId) as { p: number };
  return Number(r?.p ?? 0);
}

export const DIGITAL_METHODS = ['jazzcash', 'easypaisa', 'bank'] as const;

/** Bill total after the whole-bill discount and the store rounding (nearest). */
export function billTotals(
  subtotalPaisa: number,
  discountPaisa: number,
  roundToPaisa: number,
): { totalPaisa: number; roundingPaisa: number } {
  const after = Math.max(0, subtotalPaisa - discountPaisa);
  if (!roundToPaisa || roundToPaisa <= 0) return { totalPaisa: after, roundingPaisa: 0 };
  const total = Math.max(0, Math.round(after / roundToPaisa) * roundToPaisa);
  return { totalPaisa: total, roundingPaisa: total - after };
}

export type CompleteSaleResult =
  | {
      ok: true;
      sale: CompletedSale;
      creditWarning?: { limitPaisa: number; balanceAfterPaisa: number } | null;
      stockConflicts?: Array<{ productId: string; productName: string; qtyAfter: number }>;
    }
  | {
      ok: false;
      error: string;
      shortages?: Shortage[];
      prices?: PriceChange[];
    };

type ProductRow = {
  id: string;
  name: string;
  price_paisa: number;
  last_unit_cost_paisa: number | null;
  active: number;
  discount_kind: string | null;
  discount_value: number | null;
  discount_start_at: string | null;
  discount_end_at: string | null;
};

@Injectable()
export class SalesService {
  constructor(
    private readonly db: DbService,
    @Optional() private readonly tills?: TillsService,
  ) {}

  /**
   * Complete a cash, udhaar, or split sale in one SQLite transaction:
   * sales + sale_lines + stock decrement (full);
   * party_id optional on all methods (walk-in remainder allowed).
   * ledger debit = udhaar_amount only when party_id is set.
   * Overpay default: tendered > cash portion → change returned.
   * With party + applySurplusToKhata: surplus → party_ledger credit, change 0.
   * Refuses oversell (409 path) — stock unchanged.
   */
  completeSale(input: {
    lines: SaleLineInput[];
    paymentMethod: PaymentMethod;
    partyId?: string | null;
    cashAmountPaisa?: number | null;
    udhaarAmountPaisa?: number | null;
    /** Cash handed over. Omitted → exact cash portion, change 0. */
    tenderedPaisa?: number | null;
    /**
     * When party is set and tendered > cash portion: credit surplus to khata
     * instead of returning change. Ignored without party (walk-in safe).
     */
    applySurplusToKhata?: boolean | null;
    clientDeviceAt?: string;
    soldBy?: string;
    storeId?: string;
    /**
     * Edit (replace) only: unit prices kept from the original bill, by product.
     * Lines for these products are charged this price instead of today's.
     */
    fixedPrices?: Map<string, number> | null;
    /** Edit (replace) only: the bill this new bill replaces. */
    replacesSaleId?: string | null;
    extras?: SaleExtras | null;
    /** Till to number the bill on (default: the till this request comes from). */
    tillId?: string | null;
    /**
     * Lite: a sale made on a till while the main PC was down, sent later. Numbered T2-OFF-000045,
     * deduplicated by clientUuid, recorded even when stock runs out (stock goes below zero and a
     * stock review item is added), priced at the till's price (fixedPrices).
     */
    offline?: { clientUuid: string; offlineNo: number } | null;
    /** Lite: the till's id for this payment attempt (retries of the same bill never record twice). */
    clientUuid?: string | null;
  }): CompleteSaleResult {
    const offline = input.offline ?? null;
    const extras = input.extras ?? {};
    let tillId = input.tillId ?? currentTillId();
    if (!tillId && input.replacesSaleId) {
      const o = this.db.raw.prepare(`SELECT till_id FROM sales WHERE id = ?`).get(input.replacesSaleId) as { till_id?: string } | undefined;
      tillId = o?.till_id ?? null;
    }
    if (!tillId) return { ok: false, error: 'no_till' };
    // Licence shrank below the active tills: the extra tills (highest numbers) stop selling.
    if (!offline && !input.replacesSaleId && this.tills && !this.tills.withinLimit(tillId)) return { ok: false, error: 'till_limit' };
    const method = input.paymentMethod;
    if (method !== 'cash' && method !== 'udhaar' && method !== 'split') {
      return { ok: false, error: 'payment_method_not_supported' };
    }

    const rawLines = Array.isArray(input.lines) ? input.lines : [];
    if (rawLines.length === 0) {
      return { ok: false, error: 'empty_cart' };
    }

    const clientDeviceAt = this.normalizeClientAt(input.clientDeviceAt);
    // One clock for the whole sale: every line is priced at the same instant.
    const pricedAt = new Date();
    const recordedAt = pricedAt.toISOString();

    type Prepared = {
      productId: string;
      productName: string;
      qtyInput: number;
      unit: SaleUnit;
      qtyPieces: number;
      unitPricePaisa: number;
      unitCostPaisa: number | null;
      lineTotalPaisa: number;
      pack: { label: string; qty: number; size: number } | null;
      overrideFromPaisa: number | null;
    };

    const prepared: Prepared[] = [];
    const demand = new Map<string, number>();
    const priceChanges: PriceChange[] = [];

    for (const line of rawLines) {
      const productId = (line.productId ?? '').trim();
      if (!productId) {
        return { ok: false, error: 'invalid_product' };
      }

      const product = this.db.raw
        .prepare(
          `SELECT id, name, price_paisa, last_unit_cost_paisa, active, unit_label, pieces_per_carton,
                  discount_kind, discount_value, discount_start_at, discount_end_at, product_type
           FROM products WHERE id = ?`,
        )
        .get(productId) as (ProductRow & { product_type?: string }) | undefined;

      // Offline sales are kept even if the item was switched off since.
      if (!product || (product.active !== 1 && !offline)) {
        return { ok: false, error: 'product_not_found' };
      }
      // Loose items are never sold by kg; they are packed first (Repack).
      if (product.product_type === 'bulk') return { ok: false, error: 'bulk_not_sold_loose' };

      const q = parseQty(line.qty, (product as { unit_label?: string }).unit_label);
      if (!q.ok) {
        return { ok: false, error: 'invalid_qty' };
      }
      const qtyInput = q.n;

      // Sizes are separate products; dozen / carton selling was removed (old pack sales stay as stored).
      const unitRaw = (line.unit ?? 'piece').toLowerCase().trim();
      if (unitRaw !== 'piece') return { ok: false, error: 'invalid_unit' };
      const packSize = 1;
      const unit: SaleUnit = 'piece';
      const qtyPieces = r3(qtyInput * packSize);
      const pack = packSize > 1 ? { label: unitRaw, qty: qtyInput, size: packSize } : null;

      // Piece price after the product's discount, if one is active right now.
      const fixed = input.fixedPrices?.get(productId);
      let unitPricePaisa =
        fixed != null ? Math.max(0, Math.round(fixed)) : effectivePricePaisa(product, pricedAt);
      let overrideFromPaisa: number | null = null;
      if (line.overridePricePaisa != null) {
        const o = Math.round(Number(line.overridePricePaisa));
        if (!Number.isFinite(o) || o < 0 || o > 100_000_000_00) return { ok: false, error: 'invalid_price' };
        if (!extras.overrideBy) return { ok: false, error: 'manager_approval_needed' };
        if (o !== unitPricePaisa) {
          overrideFromPaisa = unitPricePaisa;
          unitPricePaisa = o;
        }
      }
      const expected = line.expectedUnitPricePaisa;
      if (
        overrideFromPaisa == null &&
        expected != null &&
        Math.round(Number(expected)) !== unitPricePaisa &&
        !priceChanges.some((c) => c.productId === productId)
      ) {
        priceChanges.push({
          productId,
          productName: product.name,
          unitPricePaisa,
          normalPricePaisa: Math.max(0, Math.round(product.price_paisa)),
        });
      }
      const lineTotalPaisa = lineMoney(qtyPieces, unitPricePaisa);
      const rawCost = product.last_unit_cost_paisa;
      const unitCostPaisa =
        rawCost == null ? null : Math.round(Number(rawCost));

      prepared.push({
        productId,
        productName: product.name,
        qtyInput,
        unit,
        qtyPieces,
        unitPricePaisa,
        unitCostPaisa,
        lineTotalPaisa,
        pack,
        overrideFromPaisa,
      });
      demand.set(productId, r3((demand.get(productId) ?? 0) + qtyPieces));
    }

    if (priceChanges.length > 0) {
      return { ok: false, error: 'price_changed', prices: priceChanges };
    }

    const shortages: Shortage[] = [];
    for (const [productId, requestedPieces] of demand) {
      const bal = this.db.raw
        .prepare(`SELECT qty_on_hand FROM stock_balances WHERE product_id = ?`)
        .get(productId) as { qty_on_hand: number } | undefined;
      const onHand = bal?.qty_on_hand ?? 0;
      if (requestedPieces > r3(onHand) + 1e-9) {
        const name =
          prepared.find((p) => p.productId === productId)?.productName ??
          productId;
        shortages.push({
          productId,
          productName: name,
          requestedPieces,
          onHand,
        });
      }
    }

    if (shortages.length > 0 && !offline) {
      return { ok: false, error: 'insufficient_stock', shortages };
    }
    const stockConflicts: Array<{ productId: string; productName: string; qtyAfter: number }> = [];

    const subtotalPaisa = prepared.reduce((s, l) => s + l.lineTotalPaisa, 0);
    const storeRow = this.db.raw
      .prepare(`SELECT round_to_paisa, cashier_discount_max_bp, credit_limit_mode FROM store LIMIT 1`)
      .get() as { round_to_paisa: number; cashier_discount_max_bp: number; credit_limit_mode: string } | undefined;

    // Whole-bill discount (Rs or %); cashiers stay inside the owner's limit.
    let discountPaisa = 0;
    let discountLabel: string | null = null;
    if (extras.discount && extras.discount.value != null && Number(extras.discount.value) > 0) {
      const v = Number(extras.discount.value);
      const kind = String(extras.discount.kind ?? 'amount');
      if (!Number.isFinite(v) || v < 0) return { ok: false, error: 'invalid_discount' };
      if (kind === 'percent') {
        if (v > 100) return { ok: false, error: 'invalid_discount' };
        discountPaisa = Math.round((subtotalPaisa * v) / 100);
        discountLabel = `${Math.round(v * 100) / 100}%`;
      } else if (kind === 'amount') {
        discountPaisa = Math.round(v * 100);
        discountLabel = 'Rs';
      } else {
        return { ok: false, error: 'invalid_discount' };
      }
      if (discountPaisa > subtotalPaisa) return { ok: false, error: 'invalid_discount' };
      if (!isSupervisor(extras.role)) {
        const maxBp = Number(storeRow?.cashier_discount_max_bp ?? 0);
        if (discountPaisa * 10000 > subtotalPaisa * maxBp) {
          return { ok: false, error: 'discount_over_limit' };
        }
      }
    }
    const partyResolved = this.resolveOptionalParty(input.partyId);
    if (!partyResolved.ok) return partyResolved;
    const partyId = partyResolved.partyId;

    // Loyalty: points spent count as part of the bill discount.
    const rules = readShopRules(this.db.raw);
    const redeemPoints = Math.round(Number(extras.loyaltyRedeemPoints ?? 0) || 0);
    let redeemPaisa = 0;
    if (redeemPoints < 0) return { ok: false, error: 'invalid_loyalty_points' };
    if (redeemPoints > 0) {
      if (!rules.loyalty_enabled) return { ok: false, error: 'loyalty_off' };
      if (!partyId) return { ok: false, error: 'loyalty_needs_customer' };
      if (redeemPoints > loyaltyBalance(this.db.raw, partyId)) return { ok: false, error: 'loyalty_not_enough' };
      redeemPaisa = redeemPoints * rules.loyalty_point_value_paisa;
      if (discountPaisa + redeemPaisa > subtotalPaisa) return { ok: false, error: 'loyalty_over_bill' };
      discountPaisa += redeemPaisa;
      if (!discountLabel) discountLabel = 'Points';
    }
    const { totalPaisa, roundingPaisa } = billTotals(
      subtotalPaisa,
      discountPaisa,
      Number(storeRow?.round_to_paisa ?? 0),
    );

    // Resolve cash / udhaar breakdown. Customer (party) is always optional.
    // Walk-in remainder: udhaar/split with party_id NULL — amount stored on the
    // sale row only; no party_ledger debit until a customer is attached.
    let cashAmountPaisa = 0;
    let udhaarAmountPaisa = 0;

    if (method === 'cash') {
      cashAmountPaisa = totalPaisa;
      udhaarAmountPaisa = 0;
    } else if (method === 'udhaar') {
      cashAmountPaisa = 0;
      udhaarAmountPaisa = totalPaisa;
    } else {
      // split
      const cashRaw = input.cashAmountPaisa;
      const udhaarRaw = input.udhaarAmountPaisa;
      if (cashRaw == null || udhaarRaw == null) {
        return { ok: false, error: 'split_amounts_required' };
      }
      cashAmountPaisa = Math.round(Number(cashRaw));
      udhaarAmountPaisa = Math.round(Number(udhaarRaw));
      if (
        !Number.isFinite(cashAmountPaisa) ||
        !Number.isFinite(udhaarAmountPaisa) ||
        cashAmountPaisa <= 0 ||
        udhaarAmountPaisa <= 0
      ) {
        return { ok: false, error: 'invalid_split_amounts' };
      }
      if (cashAmountPaisa + udhaarAmountPaisa !== totalPaisa) {
        return { ok: false, error: 'split_amounts_mismatch' };
      }
    }

    if (udhaarAmountPaisa > 0 && !partyId) {
      return { ok: false, error: 'udhaar_needs_customer' };
    }

    // JazzCash / Easypaisa / bank: part (or all) of the paid-now amount.
    const digitalPaisa = Math.round(Number(extras.digitalPaisa ?? 0) || 0);
    let digitalMethod: string | null = null;
    let digitalRef: string | null = null;
    if (digitalPaisa < 0 || digitalPaisa > cashAmountPaisa) return { ok: false, error: 'invalid_digital_amount' };
    if (digitalPaisa > 0) {
      digitalMethod = String(extras.digitalMethod ?? '').trim().toLowerCase();
      if (!(DIGITAL_METHODS as readonly string[]).includes(digitalMethod)) {
        return { ok: false, error: 'invalid_digital_method' };
      }
      digitalRef = String(extras.digitalRef ?? '').trim().slice(0, 64) || null;
    }

    // Customer credit limit: warn (default) or block; owner may override a block.
    let creditWarning: { limitPaisa: number; balanceAfterPaisa: number } | null = null;
    if (partyId && udhaarAmountPaisa > 0) {
      const lim = this.db.raw
        .prepare(
          `SELECT p.credit_limit_paisa AS lim,
                  COALESCE((SELECT SUM(CASE WHEN entry_type = 'debit' THEN amount_paisa ELSE -amount_paisa END)
                            FROM party_ledger WHERE party_id = p.id), 0) AS bal
           FROM parties p WHERE p.id = ?`,
        )
        .get(partyId) as { lim: number | null; bal: number } | undefined;
      if (lim?.lim != null) {
        const after = Number(lim.bal) + udhaarAmountPaisa;
        if (after > Number(lim.lim)) {
          creditWarning = { limitPaisa: Number(lim.lim), balanceAfterPaisa: after };
          const block = storeRow?.credit_limit_mode === 'block';
          if (block && !(extras.overrideCreditLimit && isSupervisor(extras.role))) {
            return { ok: false, error: 'credit_limit_exceeded' };
          }
        }
      }
    }

    const tender = this.resolveTender(
      method,
      totalPaisa,
      cashAmountPaisa - digitalPaisa,
      input.tenderedPaisa,
    );
    if (!tender.ok) return tender;

    // Prefer ignore when flag set without party (walk-in mistake) — keep change.
    const applySurplus = Boolean(input.applySurplusToKhata) && Boolean(partyId);
    let changePaisa = tender.changePaisa;
    let surplusCreditedPaisa = 0;
    if (applySurplus && tender.changePaisa > 0) {
      surplusCreditedPaisa = tender.changePaisa;
      changePaisa = 0;
    }

    const earnedPoints =
      rules.loyalty_enabled && partyId ? Math.floor(totalPaisa / (rules.loyalty_rs_per_point * 100)) : 0;

    const saleId = randomUUID();
    let shortId = this.makeShortId(saleId);
    let billNo: number | null = null;

    // D31: inclusive sales tax snapshots are off — always write 0 / OFF.
    const taxSnap = {
      enabled: false,
      rateBp: 0,
      taxPaisa: 0,
      basePaisa: null as number | null,
      lineTax: prepared.map(() => 0),
    };

    try {
      const run = this.db.raw.transaction(() => {
        // Per-till bill number (T2-000123): taken inside the sale, so a failed sale leaves no gap.
        if (offline) {
          const t = this.db.raw.prepare(`SELECT code FROM tills WHERE id = ?`).get(tillId) as { code: number } | undefined;
          if (!t) throw new Error('till_off');
          shortId = offlineBillLabel(Number(t.code), offline.offlineNo);
        } else {
          const seq = this.db.raw
            .prepare(
              `UPDATE tills SET next_bill_no = next_bill_no + 1 WHERE id = ? AND active = 1
               RETURNING next_bill_no - 1 AS n, code`,
            )
            .get(tillId) as { n: number; code: number } | undefined;
          if (!seq) throw new Error('till_off');
          billNo = Number(seq.n);
          shortId = billLabel(Number(seq.code), billNo);
        }
        this.db.raw
          .prepare(
            `INSERT INTO sales
               (till_id, bill_no, id, short_id, store_id, sold_by, payment_method, party_id,
                total_paisa, cash_amount_paisa, udhaar_amount_paisa,
                tendered_paisa, change_paisa,
                client_device_at, recorded_at,
                tax_enabled, tax_rate_bp, tax_paisa, tax_base_paisa, replaces_sale_id,
                digital_paisa, digital_method, digital_ref,
                subtotal_paisa, discount_paisa, discount_label, rounding_paisa,
                loyalty_redeem_points, loyalty_redeem_paisa, loyalty_earned_points)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            tillId,
            billNo,
            saleId,
            shortId,
            input.storeId ?? null,
            input.soldBy ?? null,
            method,
            partyId,
            totalPaisa,
            cashAmountPaisa,
            udhaarAmountPaisa,
            tender.tenderedPaisa,
            changePaisa,
            clientDeviceAt,
            recordedAt,
            taxSnap.enabled ? 1 : 0,
            taxSnap.rateBp,
            taxSnap.taxPaisa,
            taxSnap.basePaisa,
            input.replacesSaleId ?? null,
            digitalPaisa,
            digitalMethod,
            digitalRef,
            subtotalPaisa,
            discountPaisa,
            discountLabel,
            roundingPaisa,
            redeemPoints,
            redeemPaisa,
            earnedPoints,
          );
        if (partyId && (redeemPoints > 0 || earnedPoints > 0)) {
          const insL = this.db.raw.prepare(
            `INSERT INTO loyalty_ledger (id, party_id, sale_id, points, kind) VALUES (?, ?, ?, ?, ?)`,
          );
          if (redeemPoints > 0) insL.run(randomUUID(), partyId, saleId, -redeemPoints, 'redeem');
          if (earnedPoints > 0) insL.run(randomUUID(), partyId, saleId, earnedPoints, 'earn');
        }

        const insertLine = this.db.raw.prepare(
          `INSERT INTO sale_lines
             (id, sale_id, product_id, product_name, qty_input, unit,
              qty_pieces, unit_price_paisa, line_total_paisa, line_no,
              unit_cost_paisa, tax_rate_bp, tax_paisa, pack_label, pack_qty, pack_size,
              override_from_paisa, override_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );

        prepared.forEach((line, idx) => {
          insertLine.run(
            randomUUID(),
            saleId,
            line.productId,
            line.productName,
            line.qtyInput,
            line.unit,
            line.qtyPieces,
            line.unitPricePaisa,
            line.lineTotalPaisa,
            idx + 1,
            line.unitCostPaisa,
            taxSnap.rateBp,
            taxSnap.lineTax[idx] ?? 0,
            line.pack?.label ?? null,
            line.pack?.qty ?? null,
            line.pack?.size ?? null,
            line.overrideFromPaisa,
            line.overrideFromPaisa != null ? extras.overrideBy ?? null : null,
          );
        });

        const dec = this.db.raw.prepare(
          `UPDATE stock_balances
           SET qty_on_hand = ROUND(qty_on_hand - ?, 3),
               updated_at = datetime('now')
           WHERE product_id = ? AND qty_on_hand >= ? - 0.0000001`,
        );

        if (!offline && input.clientUuid) {
          this.db.raw.prepare(`UPDATE sales SET client_uuid = ? WHERE id = ?`).run(input.clientUuid, saleId);
        }
        if (offline) {
          this.db.raw
            .prepare(`UPDATE sales SET client_uuid = ?, offline_no = ?, synced_at = ? WHERE id = ?`)
            .run(offline.clientUuid, offline.offlineNo, recordedAt, saleId);
          // The sale happened: take the stock even below zero, and flag it for a manager.
          const take = this.db.raw.prepare(
            `UPDATE stock_balances SET qty_on_hand = ROUND(qty_on_hand - ?, 3), updated_at = datetime('now')
             WHERE product_id = ? RETURNING qty_on_hand`,
          );
          for (const [productId, pieces] of demand) {
            let row = take.get(pieces, productId) as { qty_on_hand: number } | undefined;
            if (!row) {
              this.db.raw
                .prepare(`INSERT INTO stock_balances (product_id, qty_on_hand) VALUES (?, ?)`)
                .run(productId, -pieces);
              row = { qty_on_hand: -pieces };
            }
            const after = Number(row.qty_on_hand);
            if (after < -1e-9) {
              this.db.raw
                .prepare(
                  `INSERT INTO stock_reviews (id, product_id, sale_id, till_id, qty_sold, qty_after) VALUES (?, ?, ?, ?, ?, ?)`,
                )
                .run(randomUUID(), productId, saleId, tillId, pieces, after);
              stockConflicts.push({
                productId,
                productName: prepared.find((p) => p.productId === productId)?.productName ?? productId,
                qtyAfter: after,
              });
            }
          }
        } else {
          for (const [productId, pieces] of demand) {
            const info = dec.run(pieces, productId, pieces);
            if (info.changes !== 1) {
              throw new Error('insufficient_stock_race');
            }
          }
        }

        // Ledger debit = udhaar portion only (full for udhaar, remainder for split).
        if (udhaarAmountPaisa > 0 && partyId) {
          this.db.raw
            .prepare(
              `INSERT INTO party_ledger
                 (till_id, id, party_id, entry_type, amount_paisa, sale_id, note)
               VALUES (?, ?, ?, 'debit', ?, ?, ?)`,
            )
            .run(
              tillId,
              randomUUID(),
              partyId,
              udhaarAmountPaisa,
              saleId,
              method === 'split' ? 'split sale udhaar' : 'udhaar sale',
            );
        }

        // Overpay kept on khata: credit surplus (may exceed current due = prepaid).
        if (surplusCreditedPaisa > 0 && partyId) {
          const collectedOn = this.karachiYmd(pricedAt);
          this.db.raw
            .prepare(
              `INSERT INTO party_ledger
                 (till_id, id, party_id, entry_type, amount_paisa, sale_id, note, collected_on)
               VALUES (?, ?, ?, 'credit', ?, ?, ?, ?)`,
            )
            .run(
              tillId,
              randomUUID(),
              partyId,
              surplusCreditedPaisa,
              saleId,
              'sale surplus keep',
              collectedOn,
            );
        }
      });

      run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'insufficient_stock_race') {
        return { ok: false, error: 'insufficient_stock' };
      }
      if (msg === 'till_off') return { ok: false, error: 'till_off' };
      if ((offline || input.clientUuid) && /idx_sales_client_uuid/i.test(msg)) return { ok: false, error: 'duplicate' };
      throw err;
    }

    return {
      ok: true,
      creditWarning,
      ...(offline ? { stockConflicts } : {}),
      sale: {
        id: saleId,
        tillId,
        billNo,
        loyaltyRedeemPoints: redeemPoints,
        loyaltyEarnedPoints: earnedPoints,
        loyaltyBalance: partyId ? loyaltyBalance(this.db.raw, partyId) : null,
        subtotalPaisa,
        discountPaisa,
        discountLabel,
        roundingPaisa,
        digitalPaisa,
        digitalMethod,
        digitalRef,
        shortId,
        paymentMethod: method,
        partyId,
        totalPaisa,
        cashAmountPaisa,
        udhaarAmountPaisa,
        tenderedPaisa: tender.tenderedPaisa,
        changePaisa,
        surplusCreditedPaisa,
        clientDeviceAt,
        recordedAt,
        lines: prepared.map((l, idx) => ({
          productId: l.productId,
          productName: l.productName,
          qtyInput: l.qtyInput,
          unit: l.unit,
          qtyPieces: l.qtyPieces,
          unitPricePaisa: l.unitPricePaisa,
          lineTotalPaisa: l.lineTotalPaisa,
          packLabel: l.pack?.label ?? null,
          packQty: l.pack?.qty ?? null,
          packSize: l.pack?.size ?? null,
          taxRateBp: taxSnap.rateBp,
          taxPaisa: taxSnap.lineTax[idx] ?? 0,
        })),
        taxEnabled: taxSnap.enabled,
        taxRateBp: taxSnap.rateBp,
        taxPaisa: taxSnap.taxPaisa,
        taxBasePaisa: taxSnap.basePaisa,
      },
    };
  }


  /** @deprecated Slice 3 name — prefer completeSale. */
  completeCash(input: {
    lines: SaleLineInput[];
    clientDeviceAt?: string;
    soldBy?: string;
    storeId?: string;
  }): CompleteSaleResult {
    return this.completeSale({
      ...input,
      paymentMethod: 'cash',
    });
  }

  /**
   * Customer is optional on every payment method.
   * Empty / omitted → walk-in (party_id null). Invalid id → party_not_found.
   */
  private resolveOptionalParty(
    partyIdIn: string | null | undefined,
  ):
    | { ok: true; partyId: string | null }
    | { ok: false; error: string } {
    const pid = (partyIdIn ?? '').trim();
    if (!pid) {
      return { ok: true, partyId: null };
    }
    const party = this.db.raw
      .prepare(`SELECT id FROM parties WHERE id = ?`)
      .get(pid) as { id: string } | undefined;
    if (!party) {
      return { ok: false, error: 'party_not_found' };
    }
    return { ok: true, partyId: party.id };
  }

  /**
   * Change is only on cash actually received.
   * Pure udhaar stores tendered 0 and change 0.
   * Omitted tender means the cash portion was exact (change 0).
   * A cash or split sale cannot be short of its cash portion.
   */
  private resolveTender(
    method: PaymentMethod,
    _totalPaisa: number,
    cashAmountPaisa: number,
    tenderedIn: number | null | undefined,
  ):
    | { ok: true; tenderedPaisa: number; changePaisa: number }
    | { ok: false; error: string } {
    if (method === 'udhaar') {
      return { ok: true, tenderedPaisa: 0, changePaisa: 0 };
    }
    if (tenderedIn == null) {
      return { ok: true, tenderedPaisa: cashAmountPaisa, changePaisa: 0 };
    }
    const tendered = Math.round(Number(tenderedIn));
    if (!Number.isFinite(tendered) || tendered < 0) {
      return { ok: false, error: 'invalid_tendered' };
    }
    if (tendered < cashAmountPaisa) {
      return { ok: false, error: 'short_tender' };
    }
    return {
      ok: true,
      tenderedPaisa: tendered,
      changePaisa: tendered - cashAmountPaisa,
    };
  }

  private normalizeClientAt(raw?: string): string {
    if (raw != null && String(raw).trim()) {
      const d = new Date(String(raw).trim());
      if (!Number.isNaN(d.getTime())) {
        return d.toISOString();
      }
    }
    return new Date().toISOString();
  }

  /** Shop-day date Asia/Karachi YYYY-MM-DD (for ledger collected_on). */
  private karachiYmd(d: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Karachi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  }

  /** Short display id — first 8 hex of UUID (no dashes), uppercase. */
  /** Audit row for a bill with manager price overrides. */
  /** A bill already saved for this client UUID (minimal shape for the till). */
  findByClientUuid(clientUuid: string) {
    const r = this.db.raw
      .prepare(
        `SELECT id, short_id, till_id, bill_no, total_paisa, payment_method, party_id, cash_amount_paisa,
                udhaar_amount_paisa, tendered_paisa, change_paisa, client_device_at, recorded_at
         FROM sales WHERE client_uuid = ?`,
      )
      .get(clientUuid) as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      id: String(r.id),
      shortId: String(r.short_id),
      tillId: r.till_id as string,
      billNo: r.bill_no == null ? null : Number(r.bill_no),
      totalPaisa: Number(r.total_paisa),
      paymentMethod: r.payment_method as string,
      partyId: (r.party_id as string | null) ?? null,
      cashAmountPaisa: Number(r.cash_amount_paisa),
      udhaarAmountPaisa: Number(r.udhaar_amount_paisa),
      tenderedPaisa: r.tendered_paisa == null ? undefined : Number(r.tendered_paisa),
      changePaisa: r.change_paisa == null ? undefined : Number(r.change_paisa),
      clientDeviceAt: String(r.client_device_at),
      recordedAt: String(r.recorded_at),
      lines: [],
    };
  }

  auditOverride(saleId: string, cashierId: string, approverId: string): void {
    const lines = this.db.raw
      .prepare(
        `SELECT product_name, override_from_paisa, unit_price_paisa FROM sale_lines
         WHERE sale_id = ? AND override_from_paisa IS NOT NULL ORDER BY line_no`,
      )
      .all(saleId) as Array<{ product_name: string; override_from_paisa: number; unit_price_paisa: number }>;
    if (!lines.length) return;
    this.db.raw
      .prepare(`INSERT INTO audit_log (id, action, user_id, subject_type, subject_id, payload_json) VALUES (?, 'sale.price_override', ?, 'sale', ?, ?)`)
      .run(randomUUID(), approverId, saleId, JSON.stringify({ cashier: cashierId, approved_by: approverId, lines }));
  }

  private makeShortId(saleId: string): string {
    return saleId.replace(/-/g, '').slice(0, 8).toUpperCase();
  }
}
