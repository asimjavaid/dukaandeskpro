import { formatQty } from '../shared/productUnits';
/**
 * Slice 9/10 — Receipt payload + share/copy helpers (no PDF server, no SMS).
 * Cash + udhaar + split tender. Amounts in paisa.
 */

export type ReceiptLineInput = {
  name: string;
  qtyInput: number;
  unit: string;
  unitPricePaisa: number;
  lineTotalPaisa: number;
};

/** Fields available after sale Done (client-side summary). */
export type SaleReceiptFields = {
  saleId: string;
  shortId?: string;
  storeName: string;
  paymentMethod: 'cash' | 'udhaar' | 'split' | string;
  lines: ReceiptLineInput[];
  totalPaisa: number;
  cashAmountPaisa?: number | null;
  udhaarAmountPaisa?: number | null;
  /** Cash handed over. Omitted on older sales. */
  tenderedPaisa?: number | null;
  /** Change to return. Not used for a pure udhaar sale. */
  changePaisa?: number | null;
  partyName?: string | null;
  clientDeviceAt: string;
  /** Server apply time (Nest `recorded_at`). */
  recordedAt?: string | null;
  /** Optional store receipt footer (Slice 13). */
  receiptFooter?: string | null;
  /**
   * Tax V1 snapshot from the sale (never the live setting). When false /
   * omitted the receipt has no tax line at all (R3).
   */
  taxEnabled?: boolean | null;
  /** Rate in basis points at sale time (17% = 1700). */
  taxRateBp?: number | null;
  /** Tax extracted from the shelf prices (already inside the total). */
  taxPaisa?: number | null;
  /** Batch 2: bill discount, rounding, JazzCash / Easypaisa / bank part. */
  subtotalPaisa?: number | null;
  discountPaisa?: number | null;
  discountLabel?: string | null;
  roundingPaisa?: number | null;
  digitalPaisa?: number | null;
  digitalMethod?: string | null;
  digitalRef?: string | null;
  loyaltyEarned?: number;
  loyaltyBalance?: number | null;
};

export const DIGITAL_LABEL: Record<string, string> = { jazzcash: 'JazzCash', easypaisa: 'Easypaisa', bank: 'Bank' };

export type ReceiptPayload = {
  store_name: string;
  sale_id: string;
  sale_id_short: string;
  lines: Array<{
    name: string;
    qty_input: number;
    unit: string;
    unit_price_paisa: number;
    line_total_paisa: number;
    /** Display: "2×pc" */
    qty_unit_label: string;
  }>;
  total_paisa: number;
  currency: string;
  payment_method: string;
  payment_breakdown: {
    method: string;
    cash_paisa: number | null;
    udhaar_paisa: number | null;
    tendered_paisa: number | null;
    change_paisa: number | null;
    party_name: string | null;
  };
  client_device_at: string;
  recorded_at: string | null;
  receipt_footer: string | null;
  /** Tax V1 — null when the sale had Sales Tax OFF (no tax row, no 0% badge). */
  sales_tax: { rate_bp: number; rate_text: string; tax_paisa: number } | null;
  /** Rows shown above Total / under payment (Batch 2). */
  extras: {
    subtotal_paisa: number | null;
    discount_paisa: number;
    discount_label: string | null;
    rounding_paisa: number;
    digital_paisa: number;
    digital_label: string | null;
    digital_ref: string | null;
    points_earned?: number;
    points_balance?: number | null;
  };
};

/** 1700 → "17", 1750 → "17.5". */
export function taxRateText(rateBp: number): string {
  const r = Math.max(0, Math.round(Number(rateBp) || 0));
  return String(Number((r / 100).toFixed(2)));
}

/** "Incl. Sales Tax 17%" — amount is shown separately (LTR-isolated). */
export function salesTaxLabel(label: string, rateText: string): string {
  return `${label} ${rateText}%`;
}

export function shortSaleId(saleId: string, shortId?: string): string {
  if (shortId && String(shortId).trim()) {
    return String(shortId).trim().toUpperCase();
  }
  const clean = (saleId || '').replace(/-/g, '');
  return clean.slice(0, 8).toUpperCase() || '--------';
}

export function unitLabel(code: string): string {
  if (code === 'carton') return 'carton';
  if (code === 'piece') return 'pc';
  return code || 'pc';
}

function paisaToRs(paisa: number): string {
  return (Math.round(Number(paisa) || 0) / 100).toFixed(2);
}

/** Build a printable/shareable receipt from Done-sale fields. */
export function buildReceiptPayload(fields: SaleReceiptFields): ReceiptPayload {
  const method = (fields.paymentMethod || 'cash').toLowerCase().trim();
  let cash: number | null = null;
  let udhaar: number | null = null;
  const total = Math.round(Number(fields.totalPaisa) || 0);
  const cashGiven =
    fields.cashAmountPaisa != null
      ? Math.round(Number(fields.cashAmountPaisa) || 0)
      : null;
  const udhaarGiven =
    fields.udhaarAmountPaisa != null
      ? Math.round(Number(fields.udhaarAmountPaisa) || 0)
      : null;

  let tendered: number | null = null;
  let change: number | null = null;
  if (method === 'cash') {
    cash = cashGiven != null ? cashGiven : total;
    udhaar = 0;
    tendered =
      fields.tenderedPaisa != null
        ? Math.round(Number(fields.tenderedPaisa) || 0)
        : cash;
    change =
      fields.changePaisa != null
        ? Math.round(Number(fields.changePaisa) || 0)
        : Math.max(0, tendered - (cash ?? 0));
  } else if (method === 'udhaar') {
    cash = 0;
    udhaar = udhaarGiven != null ? udhaarGiven : total;
    tendered = 0;
    change = 0;
  } else if (method === 'split') {
    cash = cashGiven != null ? cashGiven : null;
    udhaar = udhaarGiven != null ? udhaarGiven : null;
    tendered =
      fields.tenderedPaisa != null
        ? Math.round(Number(fields.tenderedPaisa) || 0)
        : cash;
    change =
      fields.changePaisa != null
        ? Math.round(Number(fields.changePaisa) || 0)
        : Math.max(0, (tendered ?? 0) - (cash ?? 0));
  } else {
    cash = null;
    udhaar = null;
  }

  const lines = (fields.lines ?? []).map((l) => {
    const qty = Math.round((Number(l.qtyInput) || 0) * 1000) / 1000;
    const u = unitLabel(l.unit);
    const unitPrice = Math.round(Number(l.unitPricePaisa) || 0);
    const lineTotal =
      l.lineTotalPaisa != null
        ? Math.round(Number(l.lineTotalPaisa) || 0)
        : Math.round(qty * unitPrice);
    return {
      name: l.name || 'Item',
      qty_input: qty,
      unit: l.unit || 'piece',
      unit_price_paisa: unitPrice,
      line_total_paisa: lineTotal,
      qty_unit_label: `${formatQty(qty)}×${u}`,
    };
  });

  return {
    store_name: fields.storeName || 'Store',
    sale_id: fields.saleId,
    sale_id_short: shortSaleId(fields.saleId, fields.shortId),
    lines,
    total_paisa: total,
    currency: 'PKR',
    payment_method: method,
    payment_breakdown: {
      method,
      cash_paisa: cash,
      udhaar_paisa: udhaar,
      tendered_paisa: tendered,
      change_paisa: change,
      party_name: fields.partyName ?? null,
    },
    client_device_at: fields.clientDeviceAt,
    recorded_at: fields.recordedAt ?? null,
    receipt_footer: fields.receiptFooter?.trim()
      ? fields.receiptFooter.trim()
      : null,
    sales_tax: receiptSalesTax(fields),
    extras: {
      subtotal_paisa:
        (fields.discountPaisa ?? 0) > 0 || (fields.roundingPaisa ?? 0) !== 0
          ? Math.round(Number(fields.subtotalPaisa) || 0)
          : null,
      discount_paisa: Math.round(Number(fields.discountPaisa) || 0),
      discount_label: fields.discountLabel ?? null,
      rounding_paisa: Math.round(Number(fields.roundingPaisa) || 0),
      digital_paisa: Math.round(Number(fields.digitalPaisa) || 0),
      digital_label: fields.digitalMethod ? (DIGITAL_LABEL[fields.digitalMethod] ?? fields.digitalMethod) : null,
      digital_ref: fields.digitalRef ?? null,
      points_earned: Math.max(0, Math.round(Number(fields.loyaltyEarned) || 0)),
      points_balance: fields.loyaltyBalance ?? null,
    },
  };
}

function receiptSalesTax(
  _fields: SaleReceiptFields,
): ReceiptPayload['sales_tax'] {
  // D31: no receipt tax line (inclusive Sales Tax removed).
  return null;
}

/** Plain-text receipt for navigator.share / clipboard. */
export function formatReceiptText(
  payload: ReceiptPayload,
  labels?: {
    total?: string;
    cash?: string;
    udhaar?: string;
    paid?: string;
    change?: string;
    party?: string;
    split?: string;
    clientTime?: string;
    recordedTime?: string;
    sale?: string;
    salesTaxIncl?: string;
  },
): string {
  const L = {
    total: labels?.total ?? 'Total',
    cash: labels?.cash ?? 'Cash',
    udhaar: labels?.udhaar ?? 'Udhaar',
    paid: labels?.paid ?? 'Paid',
    change: labels?.change ?? 'Change / to return',
    party: labels?.party ?? 'Customer',
    split: labels?.split ?? 'Split',
    clientTime: labels?.clientTime ?? 'Device time',
    recordedTime: labels?.recordedTime ?? 'Recorded',
    sale: labels?.sale ?? 'Sale',
  };
  const rows: string[] = [
    payload.store_name,
    `${L.sale}: ${payload.sale_id_short}`,
    '------------------------',
  ];
  for (const line of payload.lines) {
    rows.push(
      `${line.name}  ${line.qty_unit_label} @ Rs ${paisaToRs(line.unit_price_paisa)} = Rs ${paisaToRs(line.line_total_paisa)}`,
    );
  }
  rows.push('------------------------');
  const ex = payload.extras;
  if (ex?.subtotal_paisa != null) rows.push(`Subtotal: Rs ${paisaToRs(ex.subtotal_paisa)}`);
  if (ex && ex.discount_paisa > 0) rows.push(`Discount${ex.discount_label ? ` (${ex.discount_label})` : ''}: -Rs ${paisaToRs(ex.discount_paisa)}`);
  if (ex && ex.rounding_paisa !== 0) rows.push(`Rounding: Rs ${paisaToRs(ex.rounding_paisa)}`);
  rows.push(`${L.total}: Rs ${paisaToRs(payload.total_paisa)}`);
  if (ex && ex.digital_paisa > 0) {
    rows.push(`${ex.digital_label ?? 'Digital'}: Rs ${paisaToRs(ex.digital_paisa)}${ex.digital_ref ? ` (Ref ${ex.digital_ref})` : ''}`);
  }
  if (ex?.points_balance != null) rows.push(`Points: +${ex.points_earned ?? 0} (balance ${ex.points_balance})`);
  if (payload.sales_tax) {
    rows.push(
      `${salesTaxLabel(labels?.salesTaxIncl ?? 'Incl. Sales Tax', payload.sales_tax.rate_text)} Rs ${paisaToRs(payload.sales_tax.tax_paisa)}`,
    );
  }
  const pb = payload.payment_breakdown;
  if (pb.method === 'udhaar') {
    rows.push(`${L.udhaar}: Rs ${paisaToRs(pb.udhaar_paisa ?? payload.total_paisa)}`);
  } else if (pb.method === 'cash') {
    rows.push(`${L.cash}: Rs ${paisaToRs(pb.cash_paisa ?? payload.total_paisa)}`);
  } else if (pb.method === 'split') {
    rows.push(`${L.split}: ${L.cash} Rs ${paisaToRs(pb.cash_paisa ?? 0)} + ${L.udhaar} Rs ${paisaToRs(pb.udhaar_paisa ?? 0)}`);
  } else {
    rows.push(`Paid: ${pb.method}`);
  }
  if (pb.method === 'cash' || pb.method === 'split') {
    if (pb.tendered_paisa != null) {
      rows.push(`${L.paid}: Rs ${paisaToRs(pb.tendered_paisa)}`);
    }
    if (pb.change_paisa != null) {
      rows.push(`${L.change}: Rs ${paisaToRs(pb.change_paisa)}`);
    }
  }
  if (pb.party_name) {
    rows.push(`${L.party}: ${pb.party_name}`);
  }
  rows.push(`${L.clientTime}: ${payload.client_device_at}`);
  if (payload.recorded_at) {
    rows.push(`${L.recordedTime}: ${payload.recorded_at}`);
  }
  if (payload.receipt_footer) {
    rows.push('------------------------');
    rows.push(payload.receipt_footer);
  }
  return rows.join('\n');
}

export function canNativeShare(): boolean {
  return (
    typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  );
}

/** Share via Web Share API when available; otherwise copy to clipboard. */
export async function shareOrCopyReceipt(
  text: string,
  title: string,
): Promise<'shared' | 'copied' | 'failed'> {
  if (canNativeShare()) {
    try {
      await navigator.share({ title, text });
      return 'shared';
    } catch (e) {
      // User cancel — not a failure to fall back
      if (e instanceof Error && e.name === 'AbortError') {
        return 'failed';
      }
      // fall through to clipboard
    }
  }
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      await navigator.clipboard.writeText(text);
      return 'copied';
    }
    // Legacy fallback
    if (typeof document !== 'undefined') {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok ? 'copied' : 'failed';
    }
  } catch {
    /* ignore */
  }
  return 'failed';
}

export function printReceipt(): void {
  if (typeof window !== 'undefined' && typeof window.print === 'function') {
    window.print();
  }
}
