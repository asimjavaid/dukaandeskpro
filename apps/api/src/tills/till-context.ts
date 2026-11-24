import { AsyncLocalStorage } from 'node:async_hooks';

/** The till a request comes from (resolved once per request by the till middleware). */
export type TillRef = { id: string; code: number; name: string; kind: 'main' | 'remote' };

export type TillCtx = {
  till: TillRef | null;
  /** A device key was sent but is unknown or switched off. */
  keyRejected: boolean;
  /** Request came from this PC (127.0.0.1 / ::1). */
  local: boolean;
};

export const TILL_HEADER = 'x-dd-till';

export const tillAls = new AsyncLocalStorage<TillCtx>();

export function currentTill(): TillRef | null {
  return tillAls.getStore()?.till ?? null;
}

export function currentTillId(): string | null {
  return currentTill()?.id ?? null;
}

/** Bill number printed on receipts: T2-000123. */
export function billLabel(code: number, no: number): string {
  return `T${code}-${String(no).padStart(6, '0')}`;
}

/** Bill number of a sale made while the main PC was down: T2-OFF-000045. */
export function offlineBillLabel(code: number, no: number): string {
  return `T${code}-OFF-${String(no).padStart(6, '0')}`;
}

/**
 * Bill-number search: "T2-0001…" prefix, a plain number (bill 123 on any till), or an old P1
 * hex bill id prefix. Returns SQL fragments for an OR list over sales alias `s`.
 */
export function billNoSearch(q: string, minHex = 1): { ors: string[]; params: unknown[] } {
  const bill = q.trim().replace(/^#/, '').toUpperCase();
  const ors: string[] = [];
  const params: unknown[] = [];
  if (/^T\d{1,2}(-\d{0,6})?$/.test(bill) || /^T\d{1,2}-OFF(-\d{0,6})?$/.test(bill)) {
    ors.push(`s.short_id LIKE ?`);
    params.push(`${bill}%`);
  }
  if (/^\d{1,6}$/.test(bill)) {
    ors.push(`s.bill_no = ?`);
    params.push(Number(bill));
  }
  if (/^[0-9A-F]{1,8}$/.test(bill) && bill.length >= minHex) {
    ors.push(`s.short_id LIKE ?`);
    params.push(`${bill}%`);
  }
  return { ors, params };
}
