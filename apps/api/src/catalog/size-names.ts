/**
 * Size wording in product names: below 1 kg in grams ("500 g"), 1 kg and up in kg ("1.5 kg");
 * below 1 L in ml ("500 ml"), 1 L and up in L ("1.5 L"). Always a space before the unit.
 * "500g" → "500 g", "0.25kg" → "250 g", "1KG" → "1 kg", "1.5 litre" → "1.5 L", "250ML" → "250 ml".
 */
const SIZE = /(?<![\w.])(\d+(?:\.\d+)?)\s*(kilograms?|kgs?|grams?|gms?|gm|g|millilit(?:re|er)s?|ml|lit(?:re|er)s?|ltrs?|l)(?![A-Za-z0-9])/gi;

const fmt = (n: number) => String(Number(n.toFixed(3)));

export function sizeName(name: string): string {
  const s = String(name ?? '');
  const out = s.replace(SIZE, (all, num: string, unit: string) => {
    const n = Number(num);
    if (!Number.isFinite(n) || n <= 0) return all;
    const u = unit.toLowerCase();
    const liquid = /^(m|l)/.test(u) && !/^(kg|g)/.test(u);
    const milli = u.startsWith('m');
    const big = /^(kg|kilo)/.test(u);
    if (liquid) {
      const litres = milli ? n / 1000 : n;
      return litres >= 1 ? `${fmt(litres)} L` : `${fmt(litres * 1000)} ml`;
    }
    const kg = big ? n : n / 1000;
    return kg >= 1 ? `${fmt(kg)} kg` : `${fmt(kg * 1000)} g`;
  });
  return out.replace(/\s{2,}/g, ' ').trim();
}
