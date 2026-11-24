/**
 * Cash-received quick amounts for the Sell payment panel, from the bill total.
 * Pure (no React) so it can be checked on its own: scripts/check-cash-suggestions.mjs.
 *
 * - Exact: the total.
 * - Above: what a customer realistically hands over (PKR notes 10…5000):
 *   the total rounded UP to the next 100 / 500 / 1,000 / 5,000 (and 50 for
 *   bills under Rs 1,000), strictly above the total, deduped, ascending.
 * - Below (named customer only, khata possible): Rs 0 plus up to two round
 *   amounts under the total, on a 1-2-5 step (…, 200, 500, 1,000, 2,000, …).
 * - At most 7 buttons in all; at most 4 "above" amounts.
 */

export type CashSuggestionKind = 'zero' | 'partial' | 'exact' | 'above';

export type CashSuggestion = {
  kind: CashSuggestionKind;
  /** Amount the button puts in Cash received (paisa). */
  paisa: number;
};

const RS = 100;
const MAX_BUTTONS = 7;
const MAX_ABOVE = 4;
const MAX_PARTIAL = 2;
/** Small bills: a Rs 50 round-up is a realistic hand-over (e.g. 690 → 700 also via 50). */
const SMALL_BILL_PAISA = 1000 * RS;
const ROUND_UP_STEPS_RS = [100, 500, 1000, 5000];
const PARTIAL_STEPS_RS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];

function ceilTo(paisa: number, stepPaisa: number): number {
  return Math.ceil(paisa / stepPaisa) * stepPaisa;
}

/** Amounts strictly above the total, ascending, deduped. */
export function aboveAmounts(totalPaisa: number): number[] {
  if (!(totalPaisa > 0)) return [];
  const steps = totalPaisa < SMALL_BILL_PAISA ? [50, ...ROUND_UP_STEPS_RS] : ROUND_UP_STEPS_RS;
  const out = new Set<number>();
  for (const stepRs of steps) {
    const v = ceilTo(totalPaisa, stepRs * RS);
    if (v > totalPaisa) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

/** Round partial amounts under the total (excluding 0), ascending, at most MAX_PARTIAL. */
export function partialAmounts(totalPaisa: number): number[] {
  if (!(totalPaisa > 0)) return [];
  for (const stepRs of PARTIAL_STEPS_RS) {
    const step = stepRs * RS;
    const count = Math.ceil(totalPaisa / step) - 1; // multiples strictly below total
    if (count <= 0) return [];
    if (count <= MAX_PARTIAL) {
      return Array.from({ length: count }, (_, i) => (i + 1) * step);
    }
  }
  return [];
}

export function suggestCashAmounts(
  totalPaisa: number,
  opts: { allowPartial: boolean },
): CashSuggestion[] {
  const total = Math.max(0, Math.round(totalPaisa));
  const below: CashSuggestion[] = opts.allowPartial && total > 0
    ? [
        { kind: 'zero', paisa: 0 },
        ...partialAmounts(total).map((paisa) => ({ kind: 'partial' as const, paisa })),
      ]
    : [];
  const room = Math.min(MAX_ABOVE, MAX_BUTTONS - 1 - below.length);
  const above = aboveAmounts(total)
    .slice(0, Math.max(0, room))
    .map((paisa) => ({ kind: 'above' as const, paisa }));
  return [...below, { kind: 'exact', paisa: total }, ...above];
}
