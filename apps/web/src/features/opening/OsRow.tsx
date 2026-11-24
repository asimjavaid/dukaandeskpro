import { memo, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n';
import { apiPutRaw } from '../../lib/api';
import { formatRsShort } from '../../lib/money';
import { TypeTag } from '../shared/TypeTag';
import { type OsDraft, type OsItem, type OsTotals, fmtQty, importErrorText, parseQty, parseRs, unitShort } from './openingModel';

type Props = {
  item: OsItem;
  onSaved: (id: string, draft: OsDraft | null, totals: OsTotals) => void;
};

const rs = (p: number) => String(Math.round(p) / 100);

/** One product line: qty (pieces / kg, or cartons × pcs per), cost per unit; saved to the server draft as you type. */
export const OsRow = memo(function OsRow({ item, onSaved }: Props) {
  const { t } = useI18n();
  const d = item.draft;
  const pack = item.pack;
  const [mode, setMode] = useState<'base' | 'pack'>(
    d ? (d.mode === 'pack' && pack ? 'pack' : 'base') : item.pack_default && pack ? 'pack' : 'base',
  );
  const [qty, setQty] = useState(d && d.mode !== 'pack' && d.qty != null ? String(d.qty) : '');
  const [packs, setPacks] = useState(d && d.mode === 'pack' && d.packs != null ? String(d.packs) : '');
  const [units, setUnits] = useState(String(d?.pack_units ?? pack?.units ?? ''));
  const [cost, setCost] = useState(d?.cost_paisa != null ? rs(d.cost_paisa) : item.last_cost_paisa != null ? rs(item.last_cost_paisa) : '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const dirty = useRef(false);

  const qN = parseQty(qty);
  const pN = parseQty(packs);
  const uN = parseQty(units);
  const base =
    mode === 'pack'
      ? pN != null && uN != null && Number.isFinite(pN) && Number.isFinite(uN)
        ? pN * uN
        : null
      : qN != null && Number.isFinite(qN)
        ? qN
        : null;
  const costP = parseRs(cost);
  const badQty =
    (mode === 'base' && qN != null && (!Number.isFinite(qN) || (!item.fraction && !Number.isInteger(qN)))) ||
    (mode === 'pack' && ((pN != null && (!Number.isFinite(pN) || !Number.isInteger(pN))) || (uN != null && (!Number.isFinite(uN) || !Number.isInteger(uN) || uN < 1))));
  const badCost = costP != null && !Number.isFinite(costP);
  const value = base != null && base > 0 && costP != null && Number.isFinite(costP) ? Math.round(base * costP) : null;
  const warn = costP != null && Number.isFinite(costP) && costP > 0 && costP >= item.price_paisa;

  const latest = useRef({ mode, qty, packs, units, cost, base, badQty, badCost });
  latest.current = { mode, qty, packs, units, cost, base, badQty, badCost };

  async function save() {
    window.clearTimeout(timer.current);
    if (!dirty.current) return;
    const L = latest.current;
    if (L.badQty || L.badCost) {
      setStatus('error');
      setErr(L.badQty ? 'invalid_qty' : 'invalid_cost');
      return;
    }
    dirty.current = false;
    const blank = L.base == null || L.base === 0;
    const body = blank
      ? { mode: L.mode, qty: null, packs: null, costRs: '' }
      : L.mode === 'pack'
        ? { mode: 'pack', packs: L.packs, packUnits: L.units, costRs: L.cost }
        : { mode: 'base', qty: L.qty, costRs: L.cost };
    const my = ++seq.current;
    setStatus('saving');
    setErr(null);
    const r = await apiPutRaw<{ ok: boolean; draft: OsDraft | null; totals: OsTotals; error?: string; message?: { error?: string } }>(
      `/opening-stock/draft/${encodeURIComponent(item.id)}`,
      body,
    );
    if (my !== seq.current) return;
    if (r.ok && r.json?.ok) {
      setStatus('saved');
      onSaved(item.id, r.json.draft, r.json.totals);
    } else {
      setStatus('error');
      setErr(r.json?.error ?? r.json?.message?.error ?? 'save_failed');
      dirty.current = true;
    }
  }
  const saveRef = useRef(save);
  saveRef.current = save;

  function touch() {
    dirty.current = true;
    setStatus('idle');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void saveRef.current(), 600);
  }

  // Leaving the row list (filter / view change) still saves what was typed.
  useEffect(() => () => {
    if (dirty.current) void saveRef.current();
  }, []);

  function switchMode(next: 'base' | 'pack') {
    if (next === mode) return;
    if (next === 'pack') {
      const u = uN && Number.isFinite(uN) ? uN : pack?.units ?? 1;
      setPacks(qN != null && Number.isFinite(qN) && Number.isInteger(qN / u) ? String(qN / u) : '');
      if (!units) setUnits(String(u));
    } else {
      setQty(base != null ? String(base) : '');
    }
    setMode(next);
    touch();
  }

  const unit = unitShort(item.unit_label);
  const entered = base != null && base > 0;
  const sub: string[] = [];
  if (item.barcode) sub.push(item.barcode);
  if (item.packed_from) sub.push(item.packed_from);
  return (
    <tr className={`pl-row os-row${entered ? ' os-row--done' : ''}`} data-os-row={item.id}>
      <td className="pl-c-name" dir="auto">
        <span className="pl-name">{item.name}</span>
        <TypeTag type={item.product_type} />
        {sub.length ? <span className="pl-sub muted ltr-isolate">{sub.join(' · ')}</span> : null}
        {item.has_activity ? (
          <span className="pl-sub os-adds">{t('osAddsTo').replace('{qty}', fmtQty(item.qty_on_hand, item.unit_label, item.fraction))}</span>
        ) : null}
        {status === 'error' ? <span className="pl-sub os-err" role="alert">{err ? importErrorText(err, t) : t('osSaveFailed')}</span> : null}
      </td>
      <td className="os-c-unit">{unit}</td>
      <td className="catalog-table__num os-c-qty">
        <span className="pl-qty">
          {mode === 'pack' ? (
            <input
              id={`os-q-${item.id}`}
              className="pl-in po-qty"
              data-os-nav
              inputMode="numeric"
              value={packs}
              aria-label={`${pack?.name ?? ''} ${item.name}`}
              aria-invalid={badQty || undefined}
              onChange={(e) => {
                setPacks(e.target.value);
                touch();
              }}
              onBlur={() => void save()}
            />
          ) : (
            <input
              id={`os-q-${item.id}`}
              className="pl-in po-qty"
              data-os-nav
              inputMode={item.fraction ? 'decimal' : 'numeric'}
              value={qty}
              aria-label={`${t('osColQty')} ${item.name}`}
              aria-invalid={badQty || undefined}
              onChange={(e) => {
                setQty(e.target.value);
                touch();
              }}
              onBlur={() => void save()}
            />
          )}
          {pack ? (
            <select
              className="pl-measure"
              value={mode}
              aria-label={`${t('osColUnit')} ${item.name}`}
              onChange={(e) => switchMode(e.target.value === 'pack' ? 'pack' : 'base')}
            >
              <option value="base">{unit === 'pcs' ? t('osPcs') : unit}</option>
              <option value="pack">{pack.name}</option>
            </select>
          ) : (
            <span className="pl-unit">{unit}</span>
          )}
          {mode === 'pack' ? (
            <>
              <span className="os-x" aria-hidden="true">×</span>
              <input
                className="pl-in po-units"
                data-os-nav
                inputMode="numeric"
                value={units}
                aria-label={`${pack?.name ?? ''} ${unit} ${item.name}`}
                onChange={(e) => {
                  setUnits(e.target.value);
                  touch();
                }}
                onBlur={() => void save()}
              />
            </>
          ) : null}
        </span>
        {mode === 'pack' && base != null ? <span className="os-eq muted ltr-isolate">= {fmtQty(base, item.unit_label, false)}</span> : null}
      </td>
      <td className="catalog-table__num os-c-cost">
        <span className="pl-qty">
          <input
            className="pl-in po-cost"
            data-os-nav
            inputMode="decimal"
            value={cost}
            aria-label={`${t('osColCost')} ${item.name}`}
            aria-invalid={badCost || undefined}
            onChange={(e) => {
              setCost(e.target.value);
              touch();
            }}
            onBlur={() => void save()}
          />
          {item.fraction ? <span className="pl-unit os-per">/kg</span> : null}
        </span>
      </td>
      <td className="catalog-table__num dd-money os-c-value ltr-isolate">{value != null ? formatRsShort(value) : '—'}</td>
      <td className={`catalog-table__num dd-money os-c-price ltr-isolate${warn ? ' os-warn' : ''}`} title={warn ? t('osCostWarn') : undefined}>
        {formatRsShort(item.price_paisa)}
      </td>
      <td className="os-c-state" aria-live="polite">
        {status === 'saving' ? <span className="os-dot os-dot--saving" title={t('osSaving')} /> : null}
        {status === 'saved' ? <span className="os-dot os-dot--saved" title={t('osSaved')} /> : null}
        {status === 'error' ? <span className="os-dot os-dot--error" title={t('osSaveFailed')} /> : null}
      </td>
    </tr>
  );
});
