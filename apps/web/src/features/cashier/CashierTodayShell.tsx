import { useCallback, useEffect, useState } from 'react';
import { UrHint, useI18n } from '../../i18n';
import { EmptyState } from '../shared/EmptyState';
import { PageHeader } from '../shared/PageHeader';
import { apiGet } from '../../lib/api';
import { formatRsShort } from '../../lib/money';

type TodaySale = {
  id: string;
  short_id: string;
  total_paisa: number;
  payment_method: string;
  recorded_at: string;
};

type TodaySummary = {
  timezone: string;
  from: string;
  to: string;
  sale_count: number;
  total_paisa: number;
  return_count?: number;
  returns_paisa?: number;
  sales: TodaySale[];
};

type Props = {
  displayName: string;
  onSell: () => void;
  /** Open the bill on the Sales screen. */
  onOpenSale?: (saleId: string) => void;
};

const formatRs = formatRsShort;

function methodLabel(
  method: string,
  t: (k: 'receiptCash' | 'receiptUdhaar' | 'receiptSplit') => string,
): string {
  if (method === 'cash') return t('receiptCash');
  if (method === 'udhaar') return t('receiptUdhaar');
  if (method === 'split') return t('receiptSplit');
  return method;
}

function formatSaleTime(iso: string, locale: string): string | null {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat(locale === 'ur' ? 'ur-PK' : 'en-PK', {
      timeStyle: 'short',
      timeZone: 'Asia/Karachi',
      numberingSystem: 'latn',
    }).format(d);
  } catch {
    return null;
  }
}

export function CashierTodayShell({ displayName, onSell, onOpenSale }: Props) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<TodaySummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await apiGet<TodaySummary>('/cashier/today');
    setData(r);
  }, []);

  useEffect(() => {
    refresh().catch(() => setError('today_unavailable'));
  }, [refresh]);

  return (
    <div className="card">
      <PageHeader
        title={<>{t('cashierToday')}<UrHint k="cashierToday" /></>}
        subtitle={
          <>
            {displayName} · {t('cashierTodayNote')}
          </>
        }
      />

      {error ? (
        <p className="muted" role="alert" style={{ color: 'var(--danger)' }}>
          {t('cashierTodayUnavailable')}
        </p>
      ) : null}

      {data ? (
        <div className="cashier-kpis">
          <div className="card cashier-kpi cashier-kpi--count">
            <div className="muted" style={{ font: 'var(--type-meta)' }}>
              {t('analyticsSaleCount')}
            </div>
            <div className="cashier-kpi__value ltr-isolate">{data.sale_count}</div>
          </div>
          <div className="card cashier-kpi cashier-kpi--total">
            <div className="muted" style={{ font: 'var(--type-meta)' }}>
              {t('analyticsSalesTotal')}
            </div>
            <div className="cashier-kpi__value cashier-kpi__value--amount ltr-isolate">
              {formatRs(data.total_paisa)}
            </div>
          </div>
          <div className="card cashier-kpi cashier-kpi--returns" data-today-returns>
            <div className="muted" style={{ font: 'var(--type-meta)' }}>
              {t('returnsTitle')}
            </div>
            <div className="cashier-kpi__value ltr-isolate">
              {data.return_count ?? 0}
              {data.returns_paisa ? <small className="muted"> · {formatRs(data.returns_paisa)}</small> : null}
            </div>
          </div>
        </div>
      ) : !error ? (
        <p className="muted">{t('loading')}</p>
      ) : null}

      <div className="nav-row" style={{ marginBlock: 12 }}>
        <button type="button" className="btn btn--teal" onClick={onSell}>
          {t('cashierGoSell')}
        </button>
      </div>

      {data && data.sales.length > 0 ? (
        <section style={{ marginTop: 16 }}>
          <h3 style={{ font: 'var(--type-subtitle)', marginTop: 0 }}>
            {t('cashierTodaySales')}
          </h3>
          <ul className="cashier-sales">
            {data.sales.map((s) => {
              const when = formatSaleTime(s.recorded_at, locale);
              return (
              <li
                key={s.id}
                className={`cashier-sales__row${onOpenSale ? ' cashier-sales__row--open' : ''}`}
                role={onOpenSale ? 'button' : undefined}
                tabIndex={onOpenSale ? 0 : undefined}
                onClick={onOpenSale ? () => onOpenSale(s.id) : undefined}
                onKeyDown={
                  onOpenSale
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onOpenSale(s.id);
                        }
                      }
                    : undefined
                }
              >
                <span>
                  <code className="ltr-isolate">{s.short_id}</code>
                  <span className="muted" style={{ marginInlineStart: 8 }}>
                    {methodLabel(s.payment_method, t)}
                  </span>
                  {when ? (
                    <span className="muted ltr-isolate" style={{ marginInlineStart: 8 }}>
                      {when}
                    </span>
                  ) : null}
                </span>
                <span className="ltr-isolate">{formatRs(s.total_paisa)}</span>
              </li>
              );
            })}
          </ul>
        </section>
      ) : data && data.sale_count === 0 ? (
        <EmptyState
          title={t('emptyStateCashierTodayTitle')}
          description={t('emptyStateCashierTodayDesc')}
          action={
            <button type="button" className="btn btn--teal" onClick={onSell}>
              {t('cashierGoSell')}
            </button>
          }
        />
      ) : null}
    </div>
  );
}
