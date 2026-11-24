import { useEffect, useState } from 'react';
import { apiGet } from '../../lib/api';

/** Shop rules from /auth/status (Settings → Shop rules). */
export type ShopRules = {
  round_to_paisa: 0 | 100 | 500 | 1000;
  cashier_discount_max_bp: number;
  credit_limit_mode: 'warn' | 'block';
  drawer_kick: boolean;
  expiry_alert_days: number;
  loyalty_enabled: boolean;
  loyalty_rs_per_point: number;
  loyalty_point_value_paisa: number;
  cashier_refund_needs_manager: boolean;
};

export const DEFAULT_RULES: ShopRules = {
  round_to_paisa: 0,
  cashier_discount_max_bp: 0,
  credit_limit_mode: 'warn',
  drawer_kick: false,
  expiry_alert_days: 30,
  loyalty_enabled: false,
  loyalty_rs_per_point: 100,
  loyalty_point_value_paisa: 100,
  cashier_refund_needs_manager: true,
};

let cache: ShopRules | null = null;
const listeners = new Set<(r: ShopRules) => void>();

export async function loadShopRules(): Promise<ShopRules> {
  try {
    const s = await apiGet<{ store?: { rules?: ShopRules } | null }>('/auth/status');
    cache = { ...DEFAULT_RULES, ...(s.store?.rules ?? {}) };
  } catch {
    cache = cache ?? DEFAULT_RULES;
  }
  listeners.forEach((fn) => fn(cache!));
  return cache;
}

/** Set after Settings saves, so Sell picks it up without reload. */
export function setShopRulesCache(r: ShopRules) {
  cache = r;
  listeners.forEach((fn) => fn(r));
}

export function useShopRules(): ShopRules {
  const [rules, setRules] = useState<ShopRules>(cache ?? DEFAULT_RULES);
  useEffect(() => {
    listeners.add(setRules);
    void loadShopRules();
    return () => {
      listeners.delete(setRules);
    };
  }, []);
  return rules;
}

/** Client twin of the API billTotals (whole-bill discount, then rounding to nearest). */
export function billTotals(subtotalPaisa: number, discountPaisa: number, roundToPaisa: number) {
  const after = Math.max(0, subtotalPaisa - discountPaisa);
  if (!roundToPaisa || roundToPaisa <= 0) return { totalPaisa: after, roundingPaisa: 0 };
  const total = Math.max(0, Math.round(after / roundToPaisa) * roundToPaisa);
  return { totalPaisa: total, roundingPaisa: total - after };
}

export type BillDiscount = { kind: 'amount' | 'percent'; value: number };

export function discountPaisaOf(subtotalPaisa: number, d: BillDiscount | null | undefined): number {
  if (!d || !(d.value > 0)) return 0;
  const p = d.kind === 'percent' ? Math.round((subtotalPaisa * d.value) / 100) : Math.round(d.value * 100);
  return Math.min(subtotalPaisa, Math.max(0, p));
}

export type PayType = 'cash' | 'jazzcash' | 'easypaisa' | 'bank';
export const PAY_TYPES: PayType[] = ['cash', 'jazzcash', 'easypaisa', 'bank'];

/** Open the cash drawer through the receipt printer (desktop app only). */
export async function kickDrawer(printerName: string | null | undefined): Promise<boolean> {
  const bridge = (window as unknown as { dukaandesk?: { kickDrawer?: (p: string | null) => Promise<{ ok: boolean }> } }).dukaandesk;
  if (!bridge?.kickDrawer) return false;
  try {
    const r = await bridge.kickDrawer(printerName ?? null);
    return Boolean(r?.ok);
  } catch {
    return false;
  }
}
