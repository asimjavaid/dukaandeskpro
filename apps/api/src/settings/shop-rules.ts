import type BetterSqlite3 from 'better-sqlite3';

/** Batch 2 shop rules (store row). Read by the till via /auth/status. */
export type ShopRules = {
  /** Round bill totals to the nearest Rs 1 / 5 / 10 (paisa; 0 = off). */
  round_to_paisa: 0 | 100 | 500 | 1000;
  /** Most a cashier may take off a bill, basis points of the subtotal. */
  cashier_discount_max_bp: number;
  credit_limit_mode: 'warn' | 'block';
  /** Open the cash drawer (ESC/POS pulse) after a cash sale. */
  drawer_kick: boolean;
  expiry_alert_days: number;
  loyalty_enabled: boolean;
  /** Rs spent for one point. */
  loyalty_rs_per_point: number;
  /** Paisa one point is worth at redeem. */
  loyalty_point_value_paisa: number;
  /** Lite: a cashier's refund needs a manager's PIN. */
  cashier_refund_needs_manager: boolean;
};

export function readShopRules(db: BetterSqlite3.Database): ShopRules {
  const r = db
    .prepare(
      `SELECT round_to_paisa, cashier_discount_max_bp, credit_limit_mode, drawer_kick, expiry_alert_days,
              loyalty_enabled, loyalty_rs_per_point, loyalty_point_value_paisa, cashier_refund_needs_manager FROM store LIMIT 1`,
    )
    .get() as Record<string, unknown> | undefined;
  const round = Number(r?.round_to_paisa ?? 0);
  return {
    round_to_paisa: ([0, 100, 500, 1000].includes(round) ? round : 0) as ShopRules['round_to_paisa'],
    cashier_discount_max_bp: Number(r?.cashier_discount_max_bp ?? 0),
    credit_limit_mode: r?.credit_limit_mode === 'block' ? 'block' : 'warn',
    drawer_kick: Number(r?.drawer_kick ?? 0) === 1,
    expiry_alert_days: Number(r?.expiry_alert_days ?? 30) || 30,
    loyalty_enabled: Number(r?.loyalty_enabled ?? 0) === 1,
    loyalty_rs_per_point: Number(r?.loyalty_rs_per_point ?? 100) || 100,
    loyalty_point_value_paisa: Number(r?.loyalty_point_value_paisa ?? 100) || 100,
    cashier_refund_needs_manager: Number(r?.cashier_refund_needs_manager ?? 1) === 1,
  };
}

export function saveShopRules(
  db: BetterSqlite3.Database,
  input: Partial<Record<keyof ShopRules, unknown>>,
): { ok: true; rules: ShopRules } | { ok: false; error: string } {
  const cur = readShopRules(db);
  const next = { ...cur };
  if (input.round_to_paisa !== undefined) {
    const n = Number(input.round_to_paisa);
    if (![0, 100, 500, 1000].includes(n)) return { ok: false, error: 'invalid_rounding' };
    next.round_to_paisa = n as ShopRules['round_to_paisa'];
  }
  if (input.cashier_discount_max_bp !== undefined) {
    const n = Math.round(Number(input.cashier_discount_max_bp));
    if (!Number.isFinite(n) || n < 0 || n > 10000) return { ok: false, error: 'invalid_discount_limit' };
    next.cashier_discount_max_bp = n;
  }
  if (input.credit_limit_mode !== undefined) {
    if (input.credit_limit_mode !== 'warn' && input.credit_limit_mode !== 'block') {
      return { ok: false, error: 'invalid_credit_mode' };
    }
    next.credit_limit_mode = input.credit_limit_mode;
  }
  if (input.drawer_kick !== undefined) next.drawer_kick = Boolean(input.drawer_kick);
  if (input.expiry_alert_days !== undefined) {
    const n = Math.floor(Number(input.expiry_alert_days));
    if (!Number.isInteger(n) || n < 1 || n > 365) return { ok: false, error: 'invalid_expiry_days' };
    next.expiry_alert_days = n;
  }
  if (input.loyalty_enabled !== undefined) next.loyalty_enabled = Boolean(input.loyalty_enabled);
  if (input.cashier_refund_needs_manager !== undefined) next.cashier_refund_needs_manager = Boolean(input.cashier_refund_needs_manager);
  for (const k of ['loyalty_rs_per_point', 'loyalty_point_value_paisa'] as const) {
    if (input[k] === undefined) continue;
    const n = Math.round(Number(input[k]));
    if (!Number.isInteger(n) || n < 1 || n > 100000) return { ok: false, error: 'invalid_loyalty' };
    next[k] = n;
  }
  db.prepare(`UPDATE store SET cashier_refund_needs_manager = ?`).run(next.cashier_refund_needs_manager ? 1 : 0);
  db.prepare(
    `UPDATE store SET loyalty_enabled = ?, loyalty_rs_per_point = ?, loyalty_point_value_paisa = ?`,
  ).run(next.loyalty_enabled ? 1 : 0, next.loyalty_rs_per_point, next.loyalty_point_value_paisa);
  db.prepare(
    `UPDATE store SET round_to_paisa = ?, cashier_discount_max_bp = ?, credit_limit_mode = ?,
       drawer_kick = ?, expiry_alert_days = ?, updated_at = datetime('now')`,
  ).run(next.round_to_paisa, next.cashier_discount_max_bp, next.credit_limit_mode, next.drawer_kick ? 1 : 0, next.expiry_alert_days);
  return { ok: true, rules: next };
}
