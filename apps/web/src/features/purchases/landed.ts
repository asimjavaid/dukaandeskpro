/** Landed cost on the bill screens — same rules as the API (purchases.service). Money in paisa. */

export function discountSplit(amounts: number[], discount: number): number[] {
  const subtotal = amounts.reduce((sum, n) => sum + n, 0);
  if (discount <= 0 || subtotal <= 0) return amounts.map(() => 0);
  const shares = amounts.map((amount) => Math.floor((discount * amount) / subtotal));
  let leftover = discount - shares.reduce((sum, n) => sum + n, 0);
  for (let i = shares.length - 1; i >= 0 && leftover > 0; i--) {
    const take = Math.min(amounts[i] - shares[i], leftover);
    shares[i] += take;
    leftover -= take;
  }
  return shares;
}

/** Extra charges by line value; remainder on the last line so they add up exactly. */
export function splitExtras(values: number[], extra: number): number[] {
  const sum = values.reduce((a, n) => a + n, 0);
  if (extra <= 0 || values.length === 0) return values.map(() => 0);
  if (sum <= 0) {
    const out = values.map(() => 0);
    out[out.length - 1] = extra;
    return out;
  }
  const out = values.map((v) => Math.round((extra * v) / sum));
  out[out.length - 1] = extra - out.slice(0, -1).reduce((a, n) => a + n, 0);
  if (out[out.length - 1] < 0) {
    const big = out.indexOf(Math.max(...out));
    out[big] += out[out.length - 1];
    out[out.length - 1] = 0;
  }
  return out;
}

export function landedEach(netAmount: number, share: number, pieces: number): number | null {
  if (!(pieces > 0)) return null;
  return Math.round((netAmount + share) / pieces);
}

export type ExtraRow = { key: string; label: string; amount: string; separate: boolean };

/** Per line: extra share and landed cost per base unit (null where amount or pieces unknown). */
export function landedLines(lines: { amount: number | null; pieces: number }[], discount: number, extras: number) {
  const amounts = lines.map((l) => (l.amount != null && l.amount > 0 ? l.amount : 0));
  const disc = discountSplit(amounts, Math.min(discount, amounts.reduce((a, n) => a + n, 0)));
  const shares = splitExtras(amounts.map((a, i) => a - disc[i]), extras);
  return lines.map((l, i) => ({
    share: shares[i],
    landed: l.amount != null && l.amount > 0 ? landedEach(amounts[i] - disc[i], shares[i], l.pieces) : null,
  }));
}
