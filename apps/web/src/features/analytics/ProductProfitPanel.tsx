import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import { apiGet } from '../../lib/api';
import { formatRsShort as formatRs } from '../../lib/money';
import { formatQty, productUnitKey } from '../shared/productUnits';

type Item = {
  product_id: string;
  product_name: string;
  unit_label: string;
  qty: number;
  revenue_paisa: number;
  cogs_paisa: number;
  profit_paisa: number;
  margin_bp: number;
  cost_unknown: boolean;
};
type Res = { from_day: string; to_day: string; items: Item[]; revenue_paisa: number; profit_paisa: number };

function karachiToday(): string {
  return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Profit per item for a date range. */
export function ProductProfitPanel() {
  const { t } = useI18n();
  const today = karachiToday();
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const [data, setData] = useState<Res | null>(null);
  const [sort, setSort] = useState<'profit' | 'revenue' | 'margin'>('profit');

  const load = useCallback(async () => {
    setData(await apiGet<Res>(`/analytics/product-profit?from=${from}&to=${to}`));
  }, [from, to]);
  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const items = useMemo(() => {
    const list = [...(data?.items ?? [])];
    list.sort((a, b) =>
      sort === 'revenue' ? b.revenue_paisa - a.revenue_paisa : sort === 'margin' ? b.margin_bp - a.margin_bp : b.profit_paisa - a.profit_paisa,
    );
    return list;
  }, [data, sort]);

  return (
    <section className="analytics-box" data-product-profit>
      <h3 className="analytics-box__title">{t('productProfitTitle')}</h3>
      <div className="b2-toolbar">
        <input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label={t('dateFrom')} />
        <span className="muted">→</span>
        <input type="date" className="input" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} aria-label={t('dateTo')} />
        {(['profit', 'revenue', 'margin'] as const).map((k) => (
          <button key={k} type="button" className={`chip${sort === k ? ' is-active' : ''}`} onClick={() => setSort(k)}>
            {k === 'profit' ? t('ppProfit') : k === 'revenue' ? t('ppSales') : t('ppMargin')}
          </button>
        ))}
        {data ? (
          <span className="muted">
            {t('ppSales')} <strong className="ltr-isolate">{formatRs(data.revenue_paisa)}</strong> · {t('ppProfit')}{' '}
            <strong className="ltr-isolate">{formatRs(data.profit_paisa)}</strong>
          </span>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="muted analytics-box__empty">{t('ppEmpty')}</p>
      ) : (
        <div className="catalog-table-wrap" style={{ maxHeight: 480, overflow: 'auto' }}>
          <table className="catalog-table parties-table">
            <thead>
              <tr>
                <th className="catalog-table__col-product">{t('colItem')}</th>
                <th className="catalog-table__num">{t('qty')}</th>
                <th className="catalog-table__num">{t('ppSales')}</th>
                <th className="catalog-table__num">{t('ppCost')}</th>
                <th className="catalog-table__num">{t('ppProfit')}</th>
                <th className="catalog-table__num">{t('ppMargin')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.product_id}>
                  <td className="catalog-table__col-product">
                    {i.product_name}
                    {i.cost_unknown ? <span className="chip chip--warn"> {t('ppCostUnknown')}</span> : null}
                  </td>
                  <td className="catalog-table__num ltr-isolate">{formatQty(i.qty)} {t(productUnitKey(i.unit_label))}</td>
                  <td className="catalog-table__num ltr-isolate">{formatRs(i.revenue_paisa)}</td>
                  <td className="catalog-table__num ltr-isolate">{formatRs(i.cogs_paisa)}</td>
                  <td className={`catalog-table__num ltr-isolate${i.profit_paisa < 0 ? ' b2-warn' : ''}`}><strong>{formatRs(i.profit_paisa)}</strong></td>
                  <td className="catalog-table__num ltr-isolate">{(i.margin_bp / 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
