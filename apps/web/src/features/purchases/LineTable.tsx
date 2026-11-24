import { Fragment, useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useI18n } from '../../i18n';
import { apiGet } from '../../lib/api';
import { MoneyInput } from '../shared/MoneyInput';
import { parseMoneyRs } from '../shared/amount';
import type { ExtraRow } from './landed';
import { TypeTag } from '../shared/TypeTag';
import { MEASURE_LABEL, type Measure } from './measures';

/**
 * Shared line table for New order, PO receive and New bill.
 * Columns: Product | [Ordered] | Qty | [Price] | [Pcs / pack] | Total (Rs) | cost text | Sale price | remove.
 * Carton / crate: price per pack + pieces in it, total read-only. Loose kg: total typed. Piece: price each.
 * Enter walks qty → price → pieces → total → next row → product search.
 */

export type PlHit = {
  id: string;
  name: string;
  unit_label?: string | null;
  product_type?: string | null;
  buy_unit?: string | null;
  buy_measure?: string | null;
  last_unit_cost_paisa?: number | null;
  price_paisa?: number | null;
  fixed_price?: number | null;
  barcode?: string | null;
};

type Num = { value: string; onChange: (v: string) => void; bad?: boolean; whole?: boolean; label?: string; suffix?: string };

export type PlRow = {
  key: string;
  name: ReactNode;
  type?: string | null;
  sub?: ReactNode;
  ordered?: ReactNode;
  qty: Num;
  unitText: string;
  /** Bought in: Kg / Carton / Bottle … (replaces unitText when given). */
  measure?: { value: string; options: string[]; onChange: (m: string) => void } | null;
  each?: Num | null;
  cost?: Num | null;
  total: Num | { text: string };
  derived?: string;
  sale?: ReactNode;
  under?: ReactNode;
  onRemove?: () => void;
  up?: boolean;
};

export function useProductSearch(q: string) {
  const [hits, setHits] = useState<PlHit[]>([]);
  useEffect(() => {
    const s = q.trim();
    if (!s) {
      setHits([]);
      return;
    }
    let off = false;
    const h = window.setTimeout(() => {
      apiGet<{ items: PlHit[] }>(`/catalog/products?q=${encodeURIComponent(s)}&page=1&pageSize=8&for=purchase`)
        .then((r) => !off && setHits(r.items ?? []))
        .catch(() => !off && setHits([]));
    }, 180);
    return () => {
      off = true;
      window.clearTimeout(h);
    };
  }, [q]);
  return [hits, setHits] as const;
}

/** Product search bar above the line table. Digits + Enter try a barcode first when onCode is given. */
export function ProductAdd({
  id,
  onPick,
  onCode,
  autoFocus,
  unitText,
}: {
  id: string;
  onPick: (h: PlHit) => void;
  onCode?: (code: string) => Promise<boolean>;
  autoFocus?: boolean;
  unitText?: (h: PlHit) => string;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [hits, setHits] = useProductSearch(q);
  const [sel, setSel] = useState(0);
  useEffect(() => setSel(0), [hits]);
  const pick = (h: PlHit) => {
    onPick(h);
    setQ('');
    setHits([]);
  };
  return (
    <div className="field purchases-search po-add pl-add">
      <label htmlFor={id} className="visually-hidden">{t('plAddProduct')}</label>
      <input
        id={id}
        className="purchases-search__input"
        type="search"
        placeholder={t('plAddProduct')}
        value={q}
        autoComplete="off"
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={async (e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSel((s) => Math.min(hits.length - 1, s + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSel((s) => Math.max(0, s - 1));
          } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            const code = q.trim();
            if (onCode && /^\d{4,}$/.test(code)) {
              if (await onCode(code)) {
                setQ('');
                setHits([]);
                return;
              }
            }
            const h = hits[sel];
            if (h) pick(h);
          } else if (e.key === 'Escape' && q) {
            e.stopPropagation();
            e.preventDefault();
            setQ('');
          }
        }}
      />
      {hits.length > 0 ? (
        <ul className="purchases-hits" role="listbox">
          {hits.map((h, i) => (
            <li key={h.id}>
              <button
                type="button"
                className={`purchases-hits__row${i === sel ? ' is-active' : ''}`}
                onMouseEnter={() => setSel(i)}
                onClick={() => pick(h)}
              >
                <span className="purchases-hits__name">
                  {h.name}
                  <TypeTag type={h.product_type ?? undefined} /> {unitText ? <span className="muted">{unitText(h)}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function focusSel(el: Element | null | undefined) {
  if (el instanceof HTMLInputElement) {
    el.focus();
    el.select();
    return true;
  }
  return false;
}

/** Enter → next input in the row, then the next row, then the product search. */
export function lineEnter(e: ReactKeyboardEvent<HTMLElement>, searchId: string) {
  if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const t = e.target as HTMLElement;
  if (!(t instanceof HTMLInputElement) || !t.dataset.col) return;
  e.preventDefault();
  const tr = t.closest('tr.pl-row');
  if (!tr) return;
  const ins = [...tr.querySelectorAll<HTMLInputElement>('input[data-col]')];
  const at = ins.indexOf(t);
  if (focusSel(ins[at + 1])) return;
  let next = tr.nextElementSibling;
  while (next && !next.classList.contains('pl-row')) next = next.nextElementSibling;
  if (next && focusSel(next.querySelector('input[data-col]'))) return;
  document.getElementById(searchId)?.focus();
}

function NumIn({ id, col, n, cls, aria }: { id: string; col: string; n: Num; cls: string; aria: string }) {
  const input = (
    <MoneyInput
      id={id}
      data-col={col}
      className={`pl-in ${cls}`}
      whole={n.whole}
      maxDecimals={col === 'qty' || col === 'units' ? 3 : 2}
      value={n.value}
      aria-label={n.label ?? aria}
      aria-invalid={!!n.bad}
      onFocus={(e) => e.currentTarget.select()}
      onValueChange={n.onChange}
    />
  );
  return n.suffix ? (
    <span className="pl-qty">
      {input}
      <span className="pl-suffix">{n.suffix}</span>
    </span>
  ) : (
    input
  );
}

export function LineTable({
  idp,
  rows,
  showEach,
  showCost,
  showSale,
  costHead,
  eachHead,
  derivedHead,
  showOrdered = false,
  search,
  searchId,
  tools,
}: {
  idp: string;
  rows: PlRow[];
  showEach: boolean;
  showCost: boolean;
  showSale: boolean;
  costHead?: string;
  eachHead?: string;
  derivedHead?: string;
  showOrdered?: boolean;
  search: ReactNode;
  searchId: string;
  tools?: ReactNode;
}) {
  const { t } = useI18n();
  const anyRemove = rows.some((r) => r.onRemove);
  const cols = 4 + (showOrdered ? 1 : 0) + (showEach ? 1 : 0) + (showCost ? 1 : 0) + (showSale ? 1 : 0) + (anyRemove ? 1 : 0);
  return (
    <section className="purchases-card pl-card" onKeyDown={(e) => lineEnter(e, searchId)}>
      {/* Search stays on top in a fixed spot: adding lines never moves it. */}
      <div className="pl-addbar">
        <div className="pl-addbar__search">{search}</div>
        {tools ? <div className="pl-tools">{tools}</div> : null}
      </div>
      {rows.length > 0 ? (
        <table className="catalog-table po-table pl-table">
          <colgroup>
            <col className="pl-col-name" />
            {showOrdered ? <col className="pl-col-ord" /> : null}
            <col className="pl-col-qty" />
            {showCost ? <col className="pl-col-cost" /> : null}
            {showEach ? <col className="pl-col-each" /> : null}
            <col className="pl-col-total" />
            <col className="pl-col-derived" />
            {showSale ? <col className="pl-col-sale" /> : null}
            {anyRemove ? <col className="pl-col-x" /> : null}
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="pl-c-name">{t('plProduct')}</th>
              {showOrdered ? <th scope="col" className="catalog-table__num pl-c-ord">{t('plOrdered')}</th> : null}
              <th scope="col" className="catalog-table__num pl-c-qty">{t('plQty')}</th>
              {showCost ? <th scope="col" className="catalog-table__num pl-c-cost">{costHead ?? t('plCostRs')}</th> : null}
              {showEach ? <th scope="col" className="catalog-table__num pl-c-each">{eachHead ?? t('plEach')}</th> : null}
              <th scope="col" className="catalog-table__num dd-money pl-c-total">{t('plTotalRs')}</th>
              <th scope="col" className="pl-c-derived">{derivedHead ?? <span className="visually-hidden">{t('plCost')}</span>}</th>
              {showSale ? <th scope="col" className="catalog-table__num pl-c-sale">{t('plSalePrice')}</th> : null}
              {anyRemove ? <th scope="col" className="pl-c-x"><span className="visually-hidden">{t('plRemove')}</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <PlRowView key={r.key} r={r} idp={idp} showOrdered={showOrdered} showEach={showEach} showCost={showCost} showSale={showSale} anyRemove={anyRemove} cols={cols} />
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

function PlRowView({ r, idp, showOrdered, showEach, showCost, showSale, anyRemove, cols }: { r: PlRow; idp: string; showOrdered: boolean; showEach: boolean; showCost: boolean; showSale: boolean; anyRemove: boolean; cols: number }) {
  const { t } = useI18n();
  const total = r.total;
  return (
    <>
      <tr className={`pl-row${r.up ? ' po-row--up' : ''}`} data-row={r.key}>
        <td className="pl-c-name" dir="auto">
          <span className="pl-name">{r.name}</span>
          {r.type && r.type !== 'normal' ? <TypeTag type={r.type} /> : null}
          {r.sub ? <span className="pl-sub muted">{r.sub}</span> : null}
        </td>
        {showOrdered ? <td className="catalog-table__num pl-c-ord"><span className="muted ltr-isolate">{r.ordered}</span></td> : null}
        <td className="catalog-table__num pl-c-qty">
          <span className="pl-qty">
            <NumIn id={`${idp}-qty-${r.key}`} col="qty" n={r.qty} cls="po-qty" aria={t('poAriaQty').replace('{name}', typeof r.name === 'string' ? r.name : '')} />
            {r.measure ? (
              <select
                id={`${idp}-unit-${r.key}`}
                className="pl-measure"
                data-measure
                value={r.measure.value}
                aria-label={`Unit ${typeof r.name === 'string' ? r.name : ''}`.trim()}
                onChange={(e) => r.measure!.onChange(e.target.value)}
              >
                {r.measure.options.map((m) => (
                  <option key={m} value={m}>
                    {MEASURE_LABEL[m as Measure] ?? m}
                  </option>
                ))}
              </select>
            ) : (
              <span className="po-unit pl-unit" data-po-unit>{r.unitText}</span>
            )}
          </span>
        </td>
        {showCost ? (
          <td className="catalog-table__num pl-c-cost">
            {r.cost ? <NumIn id={`${idp}-cost-${r.key}`} col="cost" n={r.cost} cls="po-cost" aria="Cost" /> : null}
          </td>
        ) : null}
        {showEach ? (
          <td className="catalog-table__num pl-c-each">
            {r.each ? <NumIn id={`${idp}-units-${r.key}`} col="units" n={r.each} cls="po-units" aria={t('plAriaPiecesEach')} /> : null}
          </td>
        ) : null}
        <td className="catalog-table__num dd-money pl-c-total">
          {'text' in total ? (
            <span className="ltr-isolate pl-total-text">{total.text}</span>
          ) : (
            <NumIn id={`${idp}-total-${r.key}`} col="total" n={total} cls="po-cost po-total" aria="Total" />
          )}
        </td>
        <td className="pl-c-derived">
          <span className="muted ltr-isolate po-line-summary" data-line-summary>
            {(r.derived ?? '').split(' · ').filter(Boolean).map((part, i) => (
              <Fragment key={i}>
                {i > 0 ? ' · ' : ''}
                <span>{part}</span>
              </Fragment>
            ))}
          </span>
        </td>
        {showSale ? <td className="catalog-table__num pl-c-sale">{r.sale}</td> : null}
        {anyRemove ? (
          <td className="pl-c-x">
            {r.onRemove ? (
              <button className="btn btn--ghost pl-x" type="button" aria-label={t('plRemove')} title={t('plRemove')} onClick={r.onRemove}>
                ×
              </button>
            ) : null}
          </td>
        ) : null}
      </tr>
      {r.under ? (
        <tr className="pl-under">
          <td colSpan={cols}>{r.under}</td>
        </tr>
      ) : null}
    </>
  );
}

/** Header card: supplier | date | ref, same on all three screens. */
export function PlHead({ children }: { children: ReactNode }) {
  return <section className="purchases-card pl-head">{children}</section>;
}

/** Footer card: totals on the right, buttons under them. */
export function PlFoot({
  rs,
  subtotal,
  subtotalLabel,
  discount,
  paid,
  remaining,
  count,
  alert,
  extras,
  extrasOwed = 0,
  children,
}: {
  rs: (p: number) => string;
  subtotal: number;
  subtotalLabel?: string;
  discount?: { id: string; value: string; onChange: (v: string) => void; bad?: boolean };
  paid?: { id: string; value: string; onChange: (v: string) => void; bad?: boolean } | null;
  remaining?: number;
  count: number;
  alert?: ReactNode;
  /** Delivery / extra charges box (left side) and the part owed to this supplier. */
  extras?: ReactNode;
  extrasOwed?: number;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <section className="purchases-card pl-foot">
      <div className="pl-foot__left">
        <span className="muted ltr-isolate">{count} {count === 1 ? 'item' : 'items'}</span>
        {extras}
        {alert}
      </div>
      <div className="pl-foot__right">
        <dl className="pl-sum">
          <div className="dd-money">
            <dt>{subtotalLabel ?? t('plSubtotal')}</dt>
            <dd className="ltr-isolate" data-sum="subtotal">{rs(subtotal)}</dd>
          </div>
          {extrasOwed > 0 ? (
            <div className="dd-money">
              <dt>{t('plExtraCharges')}</dt>
              <dd className="ltr-isolate" data-sum="extras">{rs(extrasOwed)}</dd>
            </div>
          ) : null}
          {discount ? (
            <div>
              <dt><label htmlFor={discount.id}>{t('plDiscount')}</label></dt>
              <dd>
                <MoneyInput id={discount.id} className="pl-in" value={discount.value} aria-invalid={!!discount.bad} onFocus={(e) => e.currentTarget.select()} onValueChange={discount.onChange} />
              </dd>
            </div>
          ) : null}
          {paid ? (
            <div>
              <dt><label htmlFor={paid.id}>{t('plPaid')}</label></dt>
              <dd>
                <MoneyInput id={paid.id} className="pl-in" value={paid.value} aria-invalid={!!paid.bad} onFocus={(e) => e.currentTarget.select()} onValueChange={paid.onChange} />
              </dd>
            </div>
          ) : null}
          {remaining != null ? (
            <div className="dd-money pl-sum__due">
              <dt>{t('plRemaining')}</dt>
              <dd className="ltr-isolate" data-sum="remaining">{rs(remaining)}</dd>
            </div>
          ) : null}
        </dl>
        <div className="pl-actions">{children}</div>
      </div>
    </section>
  );
}

/** Footer box: Delivery / extra charges (Rs). At least one row; label optional; "Paid separately" keeps it off the supplier's due. */
export function PlExtras({ idp, rows, onChange }: { idp: string; rows: ExtraRow[]; onChange: (rows: ExtraRow[]) => void }) {
  const { t } = useI18n();
  const patch = (key: string, p: Partial<ExtraRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...p } : r)));
  return (
    <fieldset className="pl-extras" data-extras>
      <legend>{t('plDeliveryExtraChargesRs')}</legend>
      {rows.map((r, i) => (
        <div className="pl-extras__row" key={r.key} data-extra-row={i}>
          <label className="visually-hidden" htmlFor={`${idp}-xl-${i}`}>{t('plChargeName')}</label>
          <input id={`${idp}-xl-${i}`} className="pl-in pl-extras__label" value={r.label} placeholder={t('plDelivery')} maxLength={60} autoComplete="off" dir="auto" onChange={(e) => patch(r.key, { label: e.target.value })} />
          <label className="visually-hidden" htmlFor={`${idp}-xa-${i}`}>{t('plAmount')}</label>
          <MoneyInput id={`${idp}-xa-${i}`} className="pl-in pl-extras__amt" value={r.amount} aria-invalid={r.amount.trim() !== '' && parseMoneyRs(r.amount) == null} onFocus={(e) => e.currentTarget.select()} onValueChange={(v) => patch(r.key, { amount: v })} />
          <label className="pl-extras__sep muted">
            <input type="checkbox" id={`${idp}-xs-${i}`} checked={r.separate} onChange={(e) => patch(r.key, { separate: e.target.checked })} /> {t('plPaidSeparately')}
          </label>
          {rows.length > 1 ? (
            <button type="button" className="btn btn--ghost pl-x" aria-label={t('plRemoveCharge')} title={t('plRemove')} onClick={() => onChange(rows.filter((x) => x.key !== r.key))}>
              ×
            </button>
          ) : null}
        </div>
      ))}
      {rows.length < 10 ? (
        <button type="button" className="btn btn--ghost pl-extras__add" id={`${idp}-xadd`} onClick={() => onChange([...rows, newExtra()])}>
          + Add charge
        </button>
      ) : null}
    </fieldset>
  );
}

let extraSeq = 0;
export const newExtra = (): ExtraRow => ({ key: `x${Date.now()}-${extraSeq++}`, label: '', amount: '', separate: false });

/** Parsed extras: paisa totals, bad flag, and the body for the API. */
export function readExtras(rows: ExtraRow[]) {
  let all = 0;
  let owed = 0;
  let bad = false;
  const body: { label: string; amountRs: number; paidSeparately: boolean }[] = [];
  for (const r of rows) {
    if (!r.amount.trim()) continue;
    const v = parseMoneyRs(r.amount);
    if (v == null) {
      bad = true;
      continue;
    }
    const p = Math.round(v * 100);
    if (p <= 0) continue;
    all += p;
    if (!r.separate) owed += p;
    body.push({ label: r.label.trim() || 'Delivery', amountRs: p / 100, paidSeparately: r.separate });
  }
  return { all, owed, bad, body };
}
