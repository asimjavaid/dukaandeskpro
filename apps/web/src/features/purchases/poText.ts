import { formatQty } from '../shared/productUnits';

/** unit: product unit (kg, piece…) or pack name when pack is true. */
export type PoTextLine = { name: string; qty: number; unit: string; pack?: boolean };

const MEASURE = new Set(['kg', 'gram', 'litre', 'ml', 'meter', 'foot']);

/** "Sugar Loose 20 kg", "Sugar Loose 500 g", "Lays Rs 30 x 2 carton", "Dalda 1 L x 12 bottle", "Eggs x 2 dozen". */
export function poLineText(l: PoTextLine): string {
  const q = formatQty(l.qty);
  const u = l.unit.trim().toLowerCase();
  if (!l.pack && u === 'gram') return `${l.name} ${q} g`;
  if (!l.pack && MEASURE.has(u)) return `${l.name} ${q} ${u}`;
  if (l.pack || (u && u !== 'piece')) return `${l.name} x ${q} ${u}`;
  return `${l.name} x ${q}`;
}

const DRINKISH = /\b(\d+(?:\.\d+)?\s*(?:ml|l|ltr|litre)|cola|pepsi|7up|sprite|fanta|mirinda|dew|sting|aquafina|water|juice|nestle pure life)\b/i;
const PACKETISH = /\b(lays|kurkure|cheetos|slanty|chips|nimco|biscuits?|wafers?|noodles|rusk|cookies)\b/i;

/** What one piece of this item is called: bottle, can, packet, piece. */
export function pieceNoun(name: string, n: number): string {
  const one = /\bcans?\b/i.test(name) ? 'can' : DRINKISH.test(name) ? 'bottle' : PACKETISH.test(name) ? 'packet' : 'piece';
  return n === 1 ? one : `${one}s`;
}

function plural(word: string, n: number): string {
  const w = word.trim().toLowerCase() || 'pack';
  if (n === 1 || w === 'dozen') return w;
  return /(s|x|ch|sh)$/.test(w) ? `${w}es` : `${w}s`;
}

const rsShort = (paisa: number) => {
  const fixed = (Math.abs(paisa) / 100).toFixed(2);
  const [whole, frac] = fixed.split('.');
  return `Rs ${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac === '00' ? '' : `.${frac}`}`;
};

/**
 * Live line summary on purchase / PO lines:
 * "2 crates x 12 = 24 bottles, Rs 150 each", "1 bag x 50 kg = 50 kg, Rs 200/kg", "20 kg, Rs 300/kg".
 */
export function lineSummary(o: {
  name: string;
  unit: string;
  packName?: string | null;
  packQty?: number | null;
  packUnits?: number | null;
  qty?: number | null;
  unitCostPaisa?: number | null;
}): string | null {
  const u = (o.unit || 'piece').trim().toLowerCase();
  const measure = MEASURE.has(u);
  const pack = !!o.packName && o.packQty != null && o.packUnits != null && o.packUnits > 0;
  const total = pack ? Math.round(o.packQty! * o.packUnits! * 1000) / 1000 : o.qty ?? null;
  if (total == null || !(total > 0)) return null;
  const noun = (n: number) => (measure ? u : u === 'piece' ? pieceNoun(o.name, n) : u);
  let text = pack
    ? `${formatQty(o.packQty!)} ${plural(o.packName!, o.packQty!)} x ${formatQty(o.packUnits!)}${measure ? ` ${u}` : ''} = ${formatQty(total)} ${noun(total)}`
    : `${formatQty(total)} ${noun(total)}`;
  if (o.unitCostPaisa != null && o.unitCostPaisa > 0) text += measure ? `, ${rsShort(o.unitCostPaisa)}/${u}` : `, ${rsShort(o.unitCostPaisa)} each`;
  return text;
}

const shortDate = (iso: string) => {
  const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' });
};

export const poNo = (n: number) => `PO-${String(n).padStart(4, '0')}`;

/** English + Urdu order message: items and qty only. */
export function poMessage(supplier: string, store: string, number: number, createdAt: string, lines: PoTextLine[]): string {
  const shop = store.trim() || 'our shop';
  const list = lines.map((l, i) => `${i + 1}. ${poLineText(l)}`);
  return [
    `Assalam o Alaikum ${supplier}, order from ${shop} (${poNo(number)}, ${shortDate(createdAt)}):`,
    ...list,
    `Total items: ${lines.length}. Please confirm. Thank you.`,
    '',
    `السلام علیکم ${supplier}، ${shop} کی طرف سے آرڈر (${poNo(number)}): اوپر دی گئی ${lines.length} اشیاء بھیج دیں۔ مہربانی فرما کر تصدیق کر دیں۔ شکریہ۔`,
  ].join('\n');
}

/** SQLite UTC timestamp ("2026-10-15 21:55:00") → shop-local (PKT) YYYY-MM-DD. */
export function shopYmd(s: string): string {
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
