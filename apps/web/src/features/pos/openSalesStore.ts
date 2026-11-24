/**
 * S1: open Sell bills outlive the Sell screen.
 * PosShell keeps its tabs here (per signed-in user) so Today ↔ Sell ↔ Catalog… keeps every bill.
 * Bills are only lost on Sign Out (App asks first) or closing the app (browser asks first).
 * In memory only: a page reload / app restart starts clean, same as before.
 */
export type OpenSalesSnapshot<T> = {
  userId: string;
  sales: T[];
  activeId: string;
  seq: number;
};

type AnySale = { lines: unknown[] };

let snap: OpenSalesSnapshot<AnySale> | null = null;

export function readOpenSales<T extends AnySale>(userId: string): OpenSalesSnapshot<T> | null {
  if (!snap || snap.userId !== userId) return null;
  return snap as OpenSalesSnapshot<T>;
}

export function writeOpenSales<T extends AnySale>(next: OpenSalesSnapshot<T>): void {
  snap = next as OpenSalesSnapshot<AnySale>;
}

export function clearOpenSales(): void {
  snap = null;
}

/** Bills with at least one item for this user (0 when none / another user). */
export function openBillsWithItems(userId?: string): number {
  if (!snap || (userId && snap.userId !== userId)) return 0;
  return snap.sales.filter((s) => s.lines.length > 0).length;
}

const isElectron = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent);
if (typeof window !== 'undefined' && !isElectron) {
  // Closing / reloading the browser tab would drop open bills: let the browser ask.
  window.addEventListener('beforeunload', (e) => {
    if (openBillsWithItems() === 0) return;
    e.preventDefault();
    e.returnValue = '';
  });
}
