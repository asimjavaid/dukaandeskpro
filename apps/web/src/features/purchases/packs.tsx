import { useState } from 'react';
import { apiGet, apiPost } from '../../lib/api';

export type Pack = { id: string; product_id: string; name: string; units: number; barcode?: string | null };
export type PackHint = { pack_id: string | null; pack_units: number | null; last_cost_paisa: number | null } | null;

export const PACK_NAMES = ['Carton', 'Box', 'Bag', 'Bori', 'Bundle', 'Tray', 'Dozen', 'Packet', 'Tin', 'Crate', 'Sack', 'Pack'];

export async function loadPacks(productId: string): Promise<Pack[]> {
  try {
    const r = await apiGet<{ items: Pack[] }>(`/packs?productId=${encodeURIComponent(productId)}`);
    return r.items ?? [];
  } catch {
    return [];
  }
}

export async function loadPacksFor(ids: string[]): Promise<Record<string, Pack[]>> {
  if (ids.length === 0) return {};
  try {
    const r = await apiGet<{ byProduct: Record<string, Pack[]> }>(`/packs?ids=${ids.map(encodeURIComponent).join(',')}`);
    return r.byProduct ?? {};
  } catch {
    return {};
  }
}

export async function loadHint(supplierId: string, productId: string): Promise<PackHint> {
  if (!supplierId) return null;
  try {
    const r = await apiGet<{ hint: PackHint }>(`/packs/hint?supplierId=${encodeURIComponent(supplierId)}&productId=${encodeURIComponent(productId)}`);
    return r.hint ?? null;
  } catch {
    return null;
  }
}

/** "3 Carton" / "3 Carton (24)" when units differ from the pack default. */
export function packLabel(qty: number, name: string, units?: number | null, defaultUnits?: number | null): string {
  const u = units != null && defaultUnits != null && Math.abs(units - defaultUnits) > 1e-9 ? ` (${units})` : '';
  return `${qty} ${name}${u}`;
}

type SelProps = {
  id: string;
  packs: Pack[];
  value: string;
  onChange: (packId: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLSelectElement>) => void;
  /** Label of the no-pack option (kg, piece…). */
  unit?: string;
  /** Shows "+ New pack…". */
  onNew?: () => void;
};

export const NEW_PACK = '__new';

/** kg / Carton 20 / Box 12 / + New pack… */
export function PackSelect({ id, packs, value, onChange, onKeyDown, unit, onNew }: SelProps) {
  return (
    <select
      id={id}
      className="pack-select"
      value={value}
      onChange={(e) => (e.target.value === NEW_PACK ? onNew?.() : onChange(e.target.value))}
      onKeyDown={onKeyDown}
      aria-label="Unit"
    >
      <option value="">{unit ? unitWord(unit) : 'Single'}</option>
      {packs.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} {p.units}
        </option>
      ))}
      {onNew ? <option value={NEW_PACK}>+ New pack…</option> : null}
    </select>
  );
}

const unitWord = (u: string) => (u === 'piece' ? 'Piece' : u);

/** Inline pack maker on a bill / order line. Enter saves, Esc closes. */
export function NewPackInline({ productId, unit, onDone }: { productId: string; unit: string; onDone: (p: Pack | null) => void }) {
  const [name, setName] = useState('Carton');
  const [units, setUnits] = useState('');
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    const n = Number(units);
    if (!name.trim() || !(n > 0)) return setErr('Units?');
    try {
      const r = await apiPost<{ ok: boolean; packs?: Pack[]; error?: string }>('/packs', { productId, name: name.trim(), units: n });
      if (!r.ok || !r.packs) return setErr(r.error ?? 'Not saved');
      const made = [...r.packs].reverse().find((p) => p.name === name.trim() && Math.abs(p.units - n) < 1e-9) ?? r.packs[r.packs.length - 1];
      onDone(made ?? null);
    } catch {
      setErr('Not saved');
    }
  }
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onDone(null);
    }
  };
  return (
    <span className="pack-new" data-pack-new>
      <input className="input pack-new__name" list="pack-names" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={key} aria-label="Pack name" />
      <datalist id="pack-names">
        {PACK_NAMES.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <input
        className="input pack-new__units ltr-isolate"
        inputMode="decimal"
        autoFocus
        placeholder={unitWord(unit)}
        value={units}
        onChange={(e) => setUnits(e.target.value.replace(/[^\d.]/g, ''))}
        onKeyDown={key}
        aria-label="Units in each"
      />
      <button type="button" className="btn btn--sm btn--teal" onClick={() => void save()}>
        Save
      </button>
      {err ? <span className="pos-alert">{err}</span> : null}
    </span>
  );
}

/** How a product is bought on orders and bills. */
export type BuyMode = 'kg' | 'pkg' | 'piece';
export type BuyInfo = {
  buy_unit: string | null;
  pack_name: string | null;
  last_pack_units: number | null;
  last_pack_cost_paisa?: number | null;
  /** Product's bought-by, the measure last used with this supplier, allowed measures, pcs per container. */
  buy_measure?: string;
  last_unit?: string | null;
  units?: string[];
  pack_units?: Record<string, number>;
};

export function buyModeOf(p: { product_type?: string | null; buy_unit?: string | null }): BuyMode {
  if (p.product_type === 'bulk' || p.buy_unit === 'kg') return 'kg';
  if (p.buy_unit === 'carton' || p.buy_unit === 'crate') return 'pkg';
  return 'piece';
}

export const pkgNameOf = (buyUnit?: string | null) => (buyUnit === 'crate' ? 'Crate' : 'Carton');

/** "carton" / "cartons", "crate" / "crates". */
export function pkgWord(name: string, n: number): string {
  const w = name.trim().toLowerCase() || 'carton';
  return n === 1 ? w : `${w}s`;
}

export async function loadBuyInfo(supplierId: string, ids: string[]): Promise<Record<string, BuyInfo>> {
  if (ids.length === 0) return {};
  try {
    const r = await apiGet<{ byProduct: Record<string, BuyInfo> }>(
      `/purchase-orders/buy-info?supplierId=${encodeURIComponent(supplierId)}&ids=${ids.map(encodeURIComponent).join(',')}`,
    );
    return r.byProduct ?? {};
  } catch {
    return {};
  }
}

/** Read-only cost breakdown under a line total: "50 kg · Rs 300/kg", "3 crates × 6 = 18 · Rs 1,800/crate · Rs 300 each". */
export function costLine(
  o: { kg: boolean; qty: number | null; word: string; pkg?: string | null; packages?: number | null; units?: number | null; totalPaisa: number | null },
  rs: (p: number) => string,
  fq: (n: number) => string,
): string {
  const parts: string[] = [];
  const t = o.totalPaisa;
  if (o.pkg) {
    const n = o.packages ?? 0;
    const u = o.units ?? null;
    parts.push(u ? `${fq(n)} ${pkgWord(o.pkg, n)} × ${fq(u)} = ${fq(Math.round(n * u * 1000) / 1000)}` : `${fq(n)} ${pkgWord(o.pkg, n)}`);
    if (t != null && n > 0) {
      parts.push(`${rs(Math.round(t / n))}/${o.pkg.toLowerCase()}`);
      if (u) parts.push(`${rs(Math.round(t / (n * u)))} each`);
    }
    return parts.join(' · ');
  }
  const q = o.qty;
  if (q == null) return '';
  parts.push(o.kg ? `${fq(q)} kg` : `${fq(q)} ${o.word}`);
  if (t != null && q > 0) parts.push(o.kg ? `${rs(Math.round(t / q))}/kg` : `${rs(Math.round(t / q))} each`);
  return parts.join(' · ');
}

/** Short package word for the Ordered column: "2 ctn", "3 crates". */
export function pkgShort(name: string, n: number): string {
  const w = name.trim().toLowerCase() || 'carton';
  if (w === 'carton') return 'ctn';
  return n === 1 ? w : `${w}s`;
}

/** Landed cost column: "24 pcs · Rs 103.85/pc", "Rs 305.17/kg", "Rs 210 each". */
export function landedText(
  o: { kg: boolean; pieces: number | null; word: string; pkg: boolean; landed: number | null; was?: number | null },
  rs: (p: number) => string,
  fq: (n: number) => string,
): string {
  const parts: string[] = [];
  const w = o.word === 'piece' || o.word === 'pieces' ? 'pc' : o.word;
  if (o.pkg && o.pieces != null && o.pieces > 0) parts.push(`${fq(o.pieces)} ${w === 'pc' ? 'pcs' : w}`);
  if (o.landed != null) parts.push(o.kg ? `${rs(o.landed)}/kg` : `${rs(o.landed)}/${w}`);
  if (o.was != null && o.landed != null && o.landed > o.was) parts.push(`was ${rs(o.was)}`);
  return parts.join(' · ');
}
