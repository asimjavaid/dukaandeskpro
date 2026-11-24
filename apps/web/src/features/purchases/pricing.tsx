import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { apiGet, apiPost } from '../../lib/api';
import { formatRsShort as rs, rupeesPlain } from '../../lib/money';
import { parseMoneyRs } from '../shared/amount';
import { MoneyInput } from '../shared/MoneyInput';

export type PriceCheckRow = {
  product_id: string;
  name: string;
  unit_label: string;
  cost_paisa: number;
  prev_cost_paisa: number | null;
  markup_bp: number;
  markup_custom: boolean;
  current_paisa: number;
  suggested_paisa: number;
  current_margin_bp: number | null;
  suggested_margin_bp: number | null;
  needs: boolean;
};

export type Pricing = { default_markup_bp: number; round_paisa: number; round_mode: 'up' | 'nearest'; min_margin_bp: number };
export const DEFAULT_PRICING: Pricing = { default_markup_bp: 3000, round_paisa: 500, round_mode: 'up', min_margin_bp: 500 };

let cache: Pricing | null = null;
export function usePricing(): Pricing {
  const [p, setP] = useState<Pricing>(cache ?? DEFAULT_PRICING);
  useEffect(() => {
    if (cache) return;
    apiGet<{ pricing: Pricing }>('/pricing/settings')
      .then((r) => {
        cache = r.pricing;
        setP(r.pricing);
      })
      .catch(() => undefined);
  }, []);
  return p;
}
export const setPricingCache = (p: Pricing) => {
  cache = p;
};

export const pct = (bp: number | null) => (bp == null ? '—' : `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 1)}%`);
export const marginBp = (price: number, cost: number) => (price > 0 ? Math.round(((price - cost) / price) * 10000) : null);

/** Printed-price (MRP) check for one line: revenue at MRP vs cost. */
export function mrpCheck(mrpPaisa: number, units: number, costPaisa: number | null, minMarginBp: number) {
  const revenue = Math.round(mrpPaisa * units);
  if (costPaisa == null || revenue <= 0) return null;
  const profit = revenue - costPaisa;
  const m = marginBp(revenue, costPaisa) ?? 0;
  return { revenue, profit, margin: m, level: costPaisa >= revenue ? 'loss' : m < minMarginBp ? 'low' : 'ok' } as const;
}

export function MrpStrip({ mrp, units, cost, minMarginBp, per }: { mrp: number; units: number; cost: number | null; minMarginBp: number; per: string }) {
  const { t } = useI18n();
  const c = mrpCheck(mrp, units, cost, minMarginBp);
  return (
    <span className={`mrp-strip mrp-strip--${c?.level ?? 'ok'}`} data-mrp>
      <span className="ltr-isolate">{t('poMrp')} {rs(mrp)}</span>
      <span className="ltr-isolate">{t('ppMax')} {rs(Math.round(mrp * units))} / {per}</span>
      {c ? (
        <span className="ltr-isolate">
          {c.level === 'loss' ? t('ppLoss') : t('ppProfit')} {rs(Math.abs(c.profit))} · {pct(c.margin)}
        </span>
      ) : null}
    </span>
  );
}

/** Suggested sale prices after a bill / receive / repack. Owner confirms. */
export function PriceCheck({ rows, onDone }: { rows: PriceCheckRow[]; onDone: (applied: number) => void }) {
  const { t } = useI18n();
  const [pick, setPick] = useState<Record<string, { on: boolean; price: string }>>(() =>
    Object.fromEntries(rows.map((r) => [r.product_id, { on: r.needs, price: rupeesPlain(r.suggested_paisa) }])),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const chosen = rows
    .map((r) => ({ r, p: pick[r.product_id]!, paisa: Math.round((parseMoneyRs(pick[r.product_id]!.price) ?? 0) * 100) }))
    .filter((x) => x.p.on);
  async function apply() {
    if (chosen.length === 0) return onDone(0);
    if (chosen.some((x) => !(x.paisa > 0))) return setErr(t('ppPriceQ'));
    setBusy(true);
    try {
      const r = await apiPost<{ ok: boolean; updated?: number; error?: string }>('/pricing/apply', {
        items: chosen.map((x) => ({ productId: x.r.product_id, pricePaisa: x.paisa })),
      });
      if (!r.ok) return setErr(r.error ?? t('ppNotSaved'));
      onDone(r.updated ?? 0);
    } catch {
      setErr(t('ppNotSaved'));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void apply();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onDone(0);
      }
    };
    // capture: runs before the screens' own Escape (back) handlers, which skip prevented events
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  });
  return (
    <div className="modal-backdrop price-check-backdrop" role="presentation">
      <section className="purchases-card price-check" role="dialog" aria-modal="true" aria-labelledby="pc-title" data-price-check>
        <h2 id="pc-title" className="price-check__title">{t('ppSalePrices')}</h2>
        <table className="catalog-table po-table">
          <thead>
            <tr>
              <th scope="col" aria-label={t('ppApply')} />
              <th scope="col">{t('ppProduct')}</th>
              <th scope="col" className="catalog-table__num">{t('ppCost2')}</th>
              <th scope="col" className="catalog-table__num">{t('ppMarkup')}</th>
              <th scope="col" className="catalog-table__num">{t('ppNow')}</th>
              <th scope="col" className="catalog-table__num">{t('ppMargin2')}</th>
              <th scope="col" className="catalog-table__num">{t('ppNewPrice')}</th>
              <th scope="col" className="catalog-table__num">{t('ppMargin2')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const p = pick[r.product_id]!;
              const np = Math.round((parseMoneyRs(p.price) ?? 0) * 100);
              const nm = marginBp(np, r.cost_paisa);
              const set = (x: Partial<{ on: boolean; price: string }>) => setPick((s) => ({ ...s, [r.product_id]: { ...s[r.product_id]!, ...x } }));
              return (
                <tr key={r.product_id} className={p.on ? '' : 'price-check__off'}>
                  <td>
                    <input type="checkbox" checked={p.on} onChange={(e) => set({ on: e.target.checked })} aria-label={t('ppAriaApply').replace('{name}', r.name)} />
                  </td>
                  <td dir="auto">{r.name}</td>
                  <td className="catalog-table__num ltr-isolate">
                    {rs(r.cost_paisa)}
                    {r.prev_cost_paisa != null && r.prev_cost_paisa !== r.cost_paisa ? <span className="po-was muted">was {rs(r.prev_cost_paisa)}</span> : null}
                  </td>
                  <td className="catalog-table__num ltr-isolate">{pct(r.markup_bp)}</td>
                  <td className="catalog-table__num ltr-isolate">{rs(r.current_paisa)}</td>
                  <td className={`catalog-table__num ltr-isolate${(r.current_margin_bp ?? -1) < 0 ? ' price-check__bad' : ''}`}>{pct(r.current_margin_bp)}</td>
                  <td className="catalog-table__num">
                    <MoneyInput
                      className="po-cost"
                      value={p.price}
                      autoFocus={i === 0}
                      aria-label={t('ppAriaNewPrice').replace('{name}', r.name)}
                      onFocus={(e) => e.currentTarget.select()}
                      onValueChange={(v) => set({ price: v, on: true })}
                    />
                  </td>
                  <td className={`catalog-table__num ltr-isolate${np > 0 && np <= r.cost_paisa ? ' price-check__bad' : ''}`}>{pct(nm)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {err ? <p className="pos-alert" role="alert">{err}</p> : null}
        <div className="po-actions">
          <button className="btn btn--ghost" type="button" onClick={() => onDone(0)} disabled={busy}>
            {t('ppSkip')} <kbd>Esc</kbd>
          </button>
          <button className="btn btn--teal" type="button" onClick={() => void apply()} disabled={busy}>
            {chosen.length === rows.length ? t('ppApplyAll') : t('ppApplyN').replace('{n}', String(chosen.length))} <kbd>Ctrl+Enter</kbd>
          </button>
        </div>
      </section>
    </div>
  );
}
