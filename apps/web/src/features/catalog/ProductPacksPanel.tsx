import { useEffect, useState, type KeyboardEvent } from 'react';
import { apiGet, apiPost } from '../../lib/api';
import { MoneyInput } from '../shared/MoneyInput';
import { PACK_NAMES, type Pack } from '../purchases/packs';

type Hit = { id: string; name: string; unit_label?: string | null };
type Link = { bulk_id: string | null; bulk_name: string | null; bulk_unit: string | null; qty_each: number | null; packets: number };

const ERR: Record<string, string> = {
  invalid_qty: 'Check the number',
  invalid_barcode: 'Check the barcode',
  barcode_taken: 'Barcode already used',
  invalid_bulk: 'Cannot use this item',
  invalid_name: 'Choose a name',
};

/** Buying packs (Carton = 20) and "Made from" bulk link, inside product edit. */
export function ProductPacksPanel({ productId, unitLabel }: { productId: string; unitLabel: string }) {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [name, setName] = useState('Carton');
  const [units, setUnits] = useState('');
  const [barcode, setBarcode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [link, setLink] = useState<Link | null>(null);
  const [bulkQ, setBulkQ] = useState('');
  const [bulkHits, setBulkHits] = useState<Hit[]>([]);
  const [bulkPick, setBulkPick] = useState<Hit | null>(null);
  const [qtyEach, setQtyEach] = useState('');

  useEffect(() => {
    void apiGet<{ items: Pack[] }>(`/packs?productId=${encodeURIComponent(productId)}`).then((r) => setPacks(r.items ?? [])).catch(() => undefined);
    void apiGet<{ ok: boolean; link: Link }>(`/repack/link/${encodeURIComponent(productId)}`).then((r) => {
      if (!r.ok) return;
      setLink(r.link);
      setQtyEach(r.link.qty_each != null ? String(r.link.qty_each) : '');
    }).catch(() => undefined);
  }, [productId]);

  useEffect(() => {
    const q = bulkQ.trim();
    if (!q) {
      setBulkHits([]);
      return;
    }
    const h = window.setTimeout(() => {
      apiGet<{ items: Hit[] }>(`/catalog/products?q=${encodeURIComponent(q)}&page=1&pageSize=6`)
        .then((r) => setBulkHits((r.items ?? []).filter((x) => x.id !== productId)))
        .catch(() => setBulkHits([]));
    }, 180);
    return () => window.clearTimeout(h);
  }, [bulkQ, productId]);

  const stopEnter = (fn: () => void) => (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      fn();
    }
  };

  async function add() {
    setErr(null);
    const r = await apiPost<{ ok: boolean; packs?: Pack[]; error?: string }>('/packs', {
      productId,
      name,
      units: Number(units),
      barcode: barcode.trim() || null,
    });
    if (!r.ok) return setErr(ERR[r.error ?? ''] ?? 'Could not save');
    setPacks(r.packs ?? []);
    setUnits('');
    setBarcode('');
  }
  async function remove(id: string) {
    const r = await apiPost<{ ok: boolean; packs?: Pack[] }>(`/packs/${id}/remove`);
    if (r.ok) setPacks(r.packs ?? []);
  }
  async function saveLink(bulkId: string | null) {
    setErr(null);
    const r = await apiPost<{ ok: boolean; error?: string }>('/repack/link', { productId, bulkId, qtyEach: Number(qtyEach) });
    if (!r.ok) return setErr(ERR[r.error ?? ''] ?? 'Could not save');
    const g = await apiGet<{ ok: boolean; link: Link }>(`/repack/link/${encodeURIComponent(productId)}`);
    if (g.ok) setLink(g.link);
    setBulkPick(null);
    setBulkQ('');
  }

  const isBulk = (link?.packets ?? 0) > 0;
  return (
    <div className="packs-panel">
      <div className="field">
        <span className="packs-panel__label">Buying packs</span>
        {packs.length > 0 ? (
          <ul className="packs-panel__list">
            {packs.map((p) => (
              <li key={p.id}>
                <span>
                  {p.name} = <span className="ltr-isolate">{p.units}</span> {unitLabel}
                  {p.barcode ? <span className="muted ltr-isolate"> · {p.barcode}</span> : null}
                </span>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => void remove(p.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="packs-panel__add" onKeyDown={stopEnter(() => void add())}>
          <select aria-label="Pack" value={name} onChange={(e) => setName(e.target.value)}>
            {PACK_NAMES.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <span>=</span>
          <MoneyInput aria-label="Units" placeholder={unitLabel} maxDecimals={3} value={units} onValueChange={setUnits} />
          <input aria-label="Pack barcode" className="ltr-isolate" placeholder="Barcode" inputMode="numeric" value={barcode} onChange={(e) => setBarcode(e.target.value.replace(/\D/g, ''))} />
          <button type="button" className="btn btn--ghost" disabled={!(Number(units) > 0)} onClick={() => void add()}>
            Add pack
          </button>
        </div>
      </div>
      {!isBulk ? (
        <div className="field">
          <span className="packs-panel__label">Made from</span>
          {link?.bulk_id ? (
            <div className="packs-panel__add" onKeyDown={stopEnter(() => void saveLink(link.bulk_id))}>
              <span dir="auto">{link.bulk_name}</span>
              <MoneyInput aria-label="Qty each" maxDecimals={3} value={qtyEach} onValueChange={setQtyEach} />
              <span className="muted">{link.bulk_unit} each</span>
              <button type="button" className="btn btn--ghost" onClick={() => void saveLink(link.bulk_id)}>
                Save
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => void saveLink(null)}>
                Remove
              </button>
            </div>
          ) : bulkPick ? (
            <div className="packs-panel__add" onKeyDown={stopEnter(() => void saveLink(bulkPick.id))}>
              <span dir="auto">{bulkPick.name}</span>
              <MoneyInput aria-label="Qty each" autoFocus maxDecimals={3} placeholder={bulkPick.unit_label ?? ''} value={qtyEach} onValueChange={setQtyEach} />
              <span className="muted">{bulkPick.unit_label} each</span>
              <button type="button" className="btn btn--ghost" disabled={!(Number(qtyEach) > 0)} onClick={() => void saveLink(bulkPick.id)}>
                Save
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setBulkPick(null)}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="packs-panel__search">
              <input
                type="search"
                aria-label="Bulk item"
                placeholder="Bulk item"
                value={bulkQ}
                onChange={(e) => setBulkQ(e.target.value)}
                onKeyDown={stopEnter(() => bulkHits[0] && setBulkPick(bulkHits[0]))}
              />
              {bulkHits.length > 0 ? (
                <ul className="purchases-hits">
                  {bulkHits.map((h) => (
                    <li key={h.id}>
                      <button type="button" className="purchases-hits__row" onClick={() => setBulkPick(h)}>
                        <span className="purchases-hits__name">{h.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </div>
      ) : (
        <p className="muted packs-panel__label">Bulk for {link?.packets} packets</p>
      )}
      {err ? <p className="catalog-alert" role="alert">{err}</p> : null}
    </div>
  );
}
