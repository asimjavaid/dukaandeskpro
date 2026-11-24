/**
 * Short rupee display for owner screens: "Rs 19,460" (comma groups, no ".00").
 * Decimals appear only when the paisa part is non-zero: "Rs 19,460.50".
 * Western digits, LTR (wrap in .ltr-isolate inside RTL text).
 */
export function formatRsShort(paisa: number): string {
  if (!Number.isFinite(paisa)) return 'Rs 0';
  const fixed = (Math.abs(paisa) / 100).toFixed(2);
  const [whole, frac] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = paisa < 0 && fixed !== '0.00' ? '-' : '';
  return `${sign}Rs ${grouped}${frac === '00' ? '' : `.${frac}`}`;
}

/** Plain rupee number for spreadsheets: "19460" or "19460.5" — no commas, no trailing zeros. */
export function rupeesPlain(paisa: number): string {
  const fixed = (paisa / 100).toFixed(2);
  return fixed.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}
