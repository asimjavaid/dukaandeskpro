import { ProductProfitPanel } from './ProductProfitPanel';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { UrHint, useI18n } from '../../i18n';
import { EmptyState } from '../shared/EmptyState';
import { PageHeader } from '../shared/PageHeader';
import { Pager } from '../shared/Pager';
import { NavIcon, type NavIconName } from '../shared/NavIcons';
import { InitialBadge } from '../shared/InitialBadge';
import { apiGet, downloadXlsx } from '../../lib/api';
import { formatRsShort } from '../../lib/money';
import type {
  AnalyticsInsights,
  AnalyticsSummary,
  AnalyticsTab,
  Period,
  ProfitCompare,
  RestockItem,
  SlowMoversPage,
} from './analyticsTypes';
import {
  buildReport,
  buildReportSheets,
  type ReportPaper,
  type ReportStore,
} from './reportModel';
import { AnalyticsReportPreview } from './AnalyticsReportView';

const ANALYTICS_TABS: AnalyticsTab[] = ['today', 'profit'];
const LOW_STOCK_PAGE = 8;
const SLOW_PAGE = 10;
const LINES_PAGE = 10;
/** Restock prefill cap so a long low-stock list does not flood the bill. */
const RESTOCK_MAX = 20;

/**
 * Colour rules (see .tone-* in global.css):
 * in = money in / net profit ≥ 0 (green) · due = udhaar (amber)
 * critical = out of stock, expenses, negative net (red) · neutral = counts, cost of goods.
 */
type Tone = 'in' | 'due' | 'critical' | 'neutral';

type Props = {
  displayName: string;
  onSell?: () => void;
  onCatalog?: () => void;
  /** Customers list filtered to people who owe money, biggest balance first. */
  onUdhaarList?: () => void;
  /** Open one customer's khata. */
  onOpenKhata?: (partyId: string) => void;
  /** Open New purchase prefilled with these items. */
  onRestock?: (items: RestockItem[]) => void;
};

const Rs = ({ paisa }: { paisa: number }) => (
  <span className="ltr-isolate">{formatRsShort(paisa)}</span>
);

function Kpi({
  tone,
  icon,
  label,
  value,
  sub,
  tag,
  action,
}: {
  tone: Tone;
  icon: NavIconName;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tag?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`analytics-stat tone-${tone}`}>
      <div className="analytics-stat__head">
        <span className="analytics-stat__icon">
          <NavIcon name={icon} className="analytics-icon" />
        </span>
        <span className="analytics-stat__label">{label}</span>
      </div>
      <strong className="analytics-stat__value">{value}</strong>
      {sub ? <span className="analytics-stat__sub">{sub}</span> : null}
      {tag ? <span className="analytics-stat__tag">{tag}</span> : null}
      {action ? <div className="analytics-stat__action">{action}</div> : null}
    </div>
  );
}


function TopProducts({
  title,
  period,
  qtyLabel,
  emptyLabel,
}: {
  title: string;
  period: Period;
  qtyLabel: string;
  emptyLabel: string;
}) {
  const maxRev = Math.max(1, ...period.top_products.map((p) => p.revenue_paisa));
  return (
    <section className="analytics-box">
      <h3 className="analytics-box__title">{title}</h3>
      {period.top_products.length === 0 ? (
        <p className="muted analytics-box__empty">{emptyLabel}</p>
      ) : (
        <ul className="analytics-tops">
          {period.top_products.map((p) => (
            <li key={p.product_id} className="analytics-tops__row">
              <InitialBadge name={p.product_name} />
              <div className="analytics-tops__main">
                <div className="analytics-tops__meta">
                  <span className="analytics-tops__name" dir="auto">
                    {p.product_name}
                  </span>
                  <span className="analytics-tops__rev">
                    <Rs paisa={p.revenue_paisa} />
                    <span className="muted">
                      {' · '}
                      {qtyLabel} <span className="ltr-isolate">{p.qty_pieces}</span>
                    </span>
                  </span>
                </div>
                <div className="analytics-bar" role="presentation" aria-hidden="true">
                  <div
                    className="analytics-bar__fill"
                    style={{ width: `${Math.round((p.revenue_paisa / maxRev) * 100)}%` }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FormulaTerm({
  label,
  paisa,
  unknown,
  tone,
  strong,
}: {
  label: string;
  paisa: number | null;
  unknown: string;
  tone: Tone;
  strong?: boolean;
}) {
  return (
    <div className={`analytics-term tone-${tone}${strong ? ' analytics-term--result' : ''}`}>
      <span className="analytics-term__label">{label}</span>
      <strong className="analytics-term__value">
        {paisa == null ? unknown : <Rs paisa={paisa} />}
      </strong>
    </div>
  );
}

function netTone(paisa: number | null): Tone {
  if (paisa == null) return 'neutral';
  return paisa >= 0 ? 'in' : 'critical';
}

export function AnalyticsShell({
  displayName,
  onSell,
  onCatalog,
  onUdhaarList,
  onOpenKhata,
  onRestock,
}: Props) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [insights, setInsights] = useState<AnalyticsInsights | null>(null);
  const [compare, setCompare] = useState<ProfitCompare | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<AnalyticsTab>('today');
  const [store, setStore] = useState<ReportStore | null>(null);
  const [paper, setPaper] = useState<ReportPaper>('a4');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [exportMsg, setExportMsg] = useState<{ kind: 'ok'; file: string } | { kind: 'err' } | null>(
    null,
  );
  const [lowPage, setLowPage] = useState(1);
  const [linesPage, setLinesPage] = useState(1);
  const [slowAll, setSlowAll] = useState(false);
  const [slowPage, setSlowPage] = useState(1);
  const [slowData, setSlowData] = useState<SlowMoversPage | null>(null);
  const printButtonRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    const [summary, ins, cmp] = await Promise.allSettled([
      apiGet<AnalyticsSummary>('/analytics'),
      apiGet<AnalyticsInsights>('/analytics/insights'),
      apiGet<ProfitCompare>('/analytics/profit-compare'),
    ]);
    if (summary.status === 'fulfilled') {
      setData(summary.value);
    } else {
      setData(null);
      setError('analyticsUnavailable');
    }
    setInsights(ins.status === 'fulfilled' ? ins.value : null);
    setCompare(cmp.status === 'fulfilled' ? cmp.value : null);
    setBusy(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!slowAll) return;
    let cancelled = false;
    apiGet<SlowMoversPage>(`/analytics/slow-movers?page=${slowPage}&pageSize=${SLOW_PAGE}`)
      .then((res) => {
        if (!cancelled) setSlowData(res);
      })
      .catch(() => {
        if (!cancelled) setSlowData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [slowAll, slowPage]);

  useEffect(() => {
    let cancelled = false;
    apiGet<{
      store?: { name?: string; phone?: string | null; address?: string | null; reports_paper?: string };
    }>('/settings/store')
      .then((res) => {
        if (cancelled || !res.store) return;
        setStore({
          name: res.store.name ?? '',
          phone: res.store.phone ?? null,
          address: res.store.address ?? null,
        });
        setPaper(res.store.reports_paper === 'letter' ? 'letter' : 'a4');
      })
      .catch(() => {
        /* report still works with the app name and A4 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setExportMsg(null);
  }, [tab]);

  const report = data ? buildReport(tab, t, data, store, { insights, compare }) : null;

  async function exportExcel() {
    if (!report) return;
    try {
      const file = await downloadXlsx(report.fileBase, buildReportSheets(t, report));
      setExportMsg({ kind: 'ok', file });
    } catch {
      setExportMsg({ kind: 'err' });
    }
  }

  function closePreview() {
    setPreviewOpen(false);
    window.setTimeout(() => printButtonRef.current?.focus(), 0);
  }

  function selectTab(next: AnalyticsTab) {
    setTab(next);
    queueMicrotask(() => {
      document.getElementById(`analytics-tab-${next}`)?.focus();
    });
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const rtl = locale === 'ur';
    let delta = 0;
    if (event.key === 'ArrowRight') delta = rtl ? -1 : 1;
    else if (event.key === 'ArrowLeft') delta = rtl ? 1 : -1;
    else if (event.key === 'Home') {
      event.preventDefault();
      selectTab(ANALYTICS_TABS[0]);
      return;
    } else if (event.key === 'End') {
      event.preventDefault();
      selectTab(ANALYTICS_TABS[ANALYTICS_TABS.length - 1]);
      return;
    } else {
      return;
    }
    event.preventDefault();
    const index = ANALYTICS_TABS.indexOf(tab);
    selectTab(ANALYTICS_TABS[(index + delta + ANALYTICS_TABS.length) % ANALYTICS_TABS.length]);
  }

  function dayRange(fromDay: string, toDay: string): string {
    const fmt = new Intl.DateTimeFormat(locale === 'ur' ? 'ur-PK-u-nu-latn' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
    const d = (ymd: string) => {
      const [y, m, dd] = ymd.split('-').map(Number);
      return fmt.format(new Date(Date.UTC(y, m - 1, dd)));
    };
    return `${d(fromDay)} – ${d(toDay)}`;
  }

  function sinceText(days: number | null, kind: 'paid' | 'owed'): string {
    if (days == null) return '';
    if (kind === 'paid') {
      return days === 0
        ? t('analyticsPaidToday')
        : t('analyticsPaidDaysAgo').replace('{days}', String(days));
    }
    return t('analyticsUnpaidDays').replace('{days}', String(days));
  }

  const noSalesYet =
    data !== null && data.today.sale_count === 0 && data.last_7_days.sale_count === 0;

  const outCount = data ? data.low_stock.filter((i) => i.qty_on_hand <= 0).length : 0;
  const lowOnlyCount = data ? data.low_stock.length - outCount : 0;
  const stockTone: Tone = outCount > 0 ? 'critical' : lowOnlyCount > 0 ? 'due' : 'neutral';

  function restock() {
    if (!data || !onRestock) return;
    onRestock(
      data.low_stock.slice(0, RESTOCK_MAX).map((i) => ({
        id: i.product_id,
        name: i.name,
        unit_label: i.unit_label ?? 'piece',
        last_unit_cost_paisa: i.last_unit_cost_paisa ?? null,
      })),
    );
  }

  const lowPages = data ? Math.max(1, Math.ceil(data.low_stock.length / LOW_STOCK_PAGE)) : 1;
  const lowSafe = Math.min(lowPage, lowPages);
  const lowVisible = data
    ? data.low_stock.slice((lowSafe - 1) * LOW_STOCK_PAGE, lowSafe * LOW_STOCK_PAGE)
    : [];

  const profitLines = data?.profit.lines ?? [];
  const linesPages = Math.max(1, Math.ceil(profitLines.length / LINES_PAGE));
  const linesSafe = Math.min(linesPage, linesPages);
  const linesVisible = profitLines.slice((linesSafe - 1) * LINES_PAGE, linesSafe * LINES_PAGE);

  const slow = insights?.slow_movers ?? null;
  const slowRows = slowAll && slowData ? slowData.items : (slow?.items ?? []);
  const slowTotal = slow?.total ?? 0;

  const exportActions = data ? (
    <div className="analytics-export" role="group" aria-label={t('reportActions')}>
      <button
        ref={printButtonRef}
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => setPreviewOpen(true)}
        aria-haspopup="dialog"
        aria-describedby="analytics-export-scope"
      >
        {t('reportPrint')}
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => exportExcel()}
        aria-describedby="analytics-export-scope"
      >
        {t('reportExcel')}
      </button>
      <span id="analytics-export-scope" className="visually-hidden">
        {t('reportScope').replace('{tab}', tab === 'profit' ? t('profitToday') : t('analyticsToday'))}
      </span>
    </div>
  ) : null;

  return (
    <div className="card analytics">
      <PageHeader
        title={<>{t('analytics')}<UrHint k="analytics" /></>}
        subtitle={displayName}
        actions={exportActions}
      />

      {exportMsg ? (
        <p
          className={`analytics-export__status${
            exportMsg.kind === 'err' ? ' analytics-export__status--err' : ''
          }`}
          role={exportMsg.kind === 'err' ? 'alert' : 'status'}
        >
          {exportMsg.kind === 'err'
            ? t('reportDownloadFailed')
            : t('reportDownloaded')
                .split('{file}')
                .map((part, idx) =>
                  idx === 0 ? (
                    part
                  ) : (
                    <span key={idx}>
                      <span className="ltr-isolate">{exportMsg.file}</span>
                      {part}
                    </span>
                  ),
                )}
        </p>
      ) : null}

      {error ? (
        <div className="analytics-alert" role="alert">
          <p>{t('analyticsUnavailable')}</p>
          <button type="button" className="btn btn--ghost" onClick={() => void refresh()} disabled={busy}>
            {t('retry')}
          </button>
        </div>
      ) : null}

      {!data && !error ? <p className="muted analytics__loading">{t('loading')}</p> : null}

      {data ? (
        <>
          <div className="analytics-tabs" role="tablist" aria-label={t('analytics')} onKeyDown={onTabKeyDown}>
            {(
              [
                ['today', 'analyticsToday', 'analytics-panel-today'],
                ['profit', 'profitToday', 'analytics-panel-profit'],
              ] as const
            ).map(([id, label, panelId]) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`analytics-tab-${id}`}
                className={`analytics-tab${tab === id ? ' is-active' : ''}`}
                aria-selected={tab === id}
                aria-controls={panelId}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => setTab(id)}
              >
                {t(label)}
              </button>
            ))}
          </div>

          {/* ── Today ── */}
          <div
            role="tabpanel"
            id="analytics-panel-today"
            className="analytics-panel"
            aria-labelledby="analytics-tab-today"
            hidden={tab !== 'today'}
          >
            <section className="analytics-stats" aria-label={t('analyticsToday')}>
              <Kpi
                tone="neutral"
                icon="sell"
                label={t('analyticsSalesTotal')}
                value={<Rs paisa={data.today.total_paisa} />}
                sub={t('analyticsLast7Amount')
                  .split('{amount}')
                  .map((part, idx) =>
                    idx === 0 ? (
                      part
                    ) : (
                      <span key={idx}>
                        <Rs paisa={data.last_7_days.total_paisa} />
                        {part}
                      </span>
                    ),
                  )}
              />
              <Kpi tone="in" icon="cash" label={t('analyticsCash')} value={<Rs paisa={data.today.cash_paisa} />} />
              <Kpi
                tone="due"
                icon="khata"
                label={t('analyticsUdhaar')}
                value={<Rs paisa={data.today.udhaar_paisa} />}
                sub={
                  <>
                    {t('analyticsTotalOwed')}: <Rs paisa={data.udhaar_outstanding_paisa} />
                  </>
                }
                action={
                  onUdhaarList ? (
                    <button type="button" className="btn btn--ghost btn--sm" onClick={onUdhaarList}>
                      {t('analyticsUdhaarList')}
                    </button>
                  ) : null
                }
              />
              <Kpi
                tone="neutral"
                icon="receipt"
                label={t('analyticsSaleCount')}
                value={<span className="ltr-isolate">{data.today.sale_count}</span>}
              />
              <Kpi
                tone={stockTone}
                icon="stock"
                label={t('analyticsStockAlerts')}
                value={<span className="ltr-isolate">{data.low_stock.length}</span>}
                tag={
                  data.low_stock.length === 0 ? (
                    <span className="chip chip--success">{t('analyticsAllStocked')}</span>
                  ) : (
                    <>
                      {outCount > 0 ? (
                        <span className="chip chip--danger">
                          <NavIcon name="warning" className="analytics-icon analytics-icon--sm" />
                          {t('analyticsOutOfStock').replace('{count}', String(outCount))}
                        </span>
                      ) : null}
                      {lowOnlyCount > 0 ? (
                        <span className="chip chip--warn">
                          {t('analyticsLowCount').replace('{count}', String(lowOnlyCount))}
                        </span>
                      ) : null}
                    </>
                  )
                }
                action={
                  data.low_stock.length > 0 && onRestock ? (
                    <button type="button" className="btn btn--ghost btn--sm" onClick={restock}>
                      {t('analyticsRestock')}
                    </button>
                  ) : null
                }
              />
            </section>

            {insights ? (
              <section className={`analytics-till tone-${insights.cash_till.expected_paisa < 0 ? 'critical' : 'in'}`}>
                <span className="analytics-till__icon">
                  <NavIcon name="till" className="analytics-icon analytics-icon--lg" />
                </span>
                <div className="analytics-till__body">
                  <h3 className="analytics-till__title">{t('analyticsCashInTill')}</h3>
                  <strong className="analytics-till__value">
                    <Rs paisa={insights.cash_till.expected_paisa} />
                  </strong>
                  <p className="analytics-till__math">
                    <span>
                      {t('analyticsTillCashSales')} <Rs paisa={insights.cash_till.cash_sales_paisa} />
                    </span>
                    <span className="analytics-till__op" aria-hidden="true">+</span>
                    <span>
                      {t('analyticsTillUdhaarIn')} <Rs paisa={insights.cash_till.udhaar_received_paisa} />
                    </span>
                    {insights.cash_till.cash_in_paisa ? (
                      <>
                        <span className="analytics-till__op" aria-hidden="true">+</span>
                        <span data-till-cash-in>
                          {t('tillCashIn')} <Rs paisa={insights.cash_till.cash_in_paisa} />
                        </span>
                      </>
                    ) : null}
                    <span className="analytics-till__op" aria-hidden="true">−</span>
                    <span className="analytics-till__minus">
                      {t('analyticsTillExpenses')} <Rs paisa={insights.cash_till.expenses_paisa} />
                    </span>
                    {insights.cash_till.cash_out_paisa ? (
                      <>
                        <span className="analytics-till__op" aria-hidden="true">−</span>
                        <span className="analytics-till__minus" data-till-cash-out>
                          {t('tillCashOut')} <Rs paisa={insights.cash_till.cash_out_paisa} />
                        </span>
                      </>
                    ) : null}
                  </p>
                  {insights.cash_till.digital_paisa ? (
                    <p className="muted analytics-till__math" data-till-digital>
                      {t('tillDigital')} <Rs paisa={insights.cash_till.digital_paisa} />
                    </p>
                  ) : null}
                </div>
              </section>
            ) : null}

            {insights ? (
              <div className="analytics-grid">
                <section className="analytics-box">
                  <h3 className="analytics-box__title">
                    <NavIcon name="khata" className="analytics-icon analytics-icon--due" />
                    {t('analyticsTopUdhaar')}
                  </h3>
                  {insights.top_udhaar.length === 0 ? (
                    <p className="muted analytics-box__empty">{t('analyticsTopUdhaarEmpty')}</p>
                  ) : (
                    <ul className="analytics-list">
                      {insights.top_udhaar.map((c) => (
                        <li key={c.party_id} className="analytics-list__row">
                          <InitialBadge name={c.name} />
                          <div className="analytics-list__main">
                            <span className="analytics-list__name" dir="auto">
                              {c.name}
                            </span>
                            <span className="muted">{sinceText(c.days, c.since_kind)}</span>
                          </div>
                          <strong className="analytics-list__amt tone-text-due">
                            <Rs paisa={c.balance_paisa} />
                          </strong>
                          {onOpenKhata ? (
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() => onOpenKhata(c.party_id)}
                            >
                              {t('openKhata')}
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="analytics-box">
                  <h3 className="analytics-box__title">
                    <NavIcon name="stock" className="analytics-icon" />
                    {t('analyticsSlowMovers')}
                    {slowTotal > 0 ? (
                      <span className="chip chip--neutral ltr-isolate">{slowTotal}</span>
                    ) : null}
                  </h3>
                  {slowTotal === 0 ? (
                    <p className="muted analytics-box__empty">{t('analyticsSlowMoversEmpty')}</p>
                  ) : (
                    <>
                      <p className="muted analytics-box__meta">
                        {t('analyticsStockValue')}: <Rs paisa={slow!.stock_value_paisa} />
                      </p>
                      <ul className="analytics-list">
                        {slowRows.map((m) => (
                          <li key={m.product_id} className="analytics-list__row">
                            <InitialBadge name={m.name} />
                            <div className="analytics-list__main">
                              <span className="analytics-list__name" dir="auto">
                                {m.name}
                              </span>
                              <span className="muted">
                                {t('onHand')}: <span className="ltr-isolate">{m.qty_on_hand}</span>
                              </span>
                            </div>
                            <strong className="analytics-list__amt">
                              {m.stock_value_paisa == null ? (
                                <span className="muted">{t('costUnknown')}</span>
                              ) : (
                                <Rs paisa={m.stock_value_paisa} />
                              )}
                            </strong>
                          </li>
                        ))}
                      </ul>
                      {slowAll && slowData ? (
                        <Pager
                          page={slowData.page}
                          pageSize={SLOW_PAGE}
                          total={slowData.total}
                          onPage={setSlowPage}
                        />
                      ) : null}
                      {slowTotal > SLOW_PAGE ? (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm analytics-box__more"
                          onClick={() => {
                            setSlowAll((v) => !v);
                            setSlowPage(1);
                          }}
                        >
                          {slowAll
                            ? t('analyticsShowLess')
                            : t('analyticsShowAll').replace('{count}', String(slowTotal))}
                        </button>
                      ) : null}
                    </>
                  )}
                </section>
              </div>
            ) : null}

            {noSalesYet ? (
              <EmptyState
                className="analytics-empty"
                title={t('emptyStateAnalyticsTitle')}
                description={t('emptyStateAnalyticsDesc')}
                action={
                  <>
                    {onSell ? (
                      <button type="button" className="btn btn--teal" onClick={onSell}>
                        {t('sell')}
                      </button>
                    ) : null}
                    {onCatalog ? (
                      <button type="button" className="btn btn--ghost" onClick={onCatalog}>
                        {t('catalog')}
                      </button>
                    ) : null}
                  </>
                }
              />
            ) : (
              <div className="analytics-grid">
                <TopProducts
                  title={`${t('analyticsTopProducts')} · ${t('analyticsToday')}`}
                  period={data.today}
                  qtyLabel={t('qty')}
                  emptyLabel={t('analyticsEmpty')}
                />
                <TopProducts
                  title={`${t('analyticsTopProducts')} · ${t('analyticsLast7Days')}`}
                  period={data.last_7_days}
                  qtyLabel={t('qty')}
                  emptyLabel={t('analyticsEmpty')}
                />
              </div>
            )}

            {data.low_stock.length > 0 ? (
              <section className="analytics-box">
                <h3 className="analytics-box__title">
                  <NavIcon name="warning" className="analytics-icon analytics-icon--critical" />
                  {t('analyticsLowStockAll')}
                  <span className="muted ltr-isolate">(≤ {data.low_stock_threshold})</span>
                </h3>
                <ul className="analytics-list">
                  {lowVisible.map((item) => (
                    <li key={item.product_id} className="analytics-list__row">
                      <span className="analytics-list__name" dir="auto">
                        {item.name}
                      </span>
                      <span className={`chip ${item.qty_on_hand <= 0 ? 'chip--danger' : 'chip--warn'}`}>
                        {t('onHand')}: <span className="ltr-isolate">{item.qty_on_hand}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <Pager
                  page={lowSafe}
                  pageSize={LOW_STOCK_PAGE}
                  total={data.low_stock.length}
                  onPage={setLowPage}
                />
              </section>
            ) : null}
          </div>

          {/* ── Profit ── */}
          <div
            role="tabpanel"
            id="analytics-panel-profit"
            className="analytics-panel"
            aria-labelledby="analytics-tab-profit"
            hidden={tab !== 'profit'}
          >
            <section className="analytics-box analytics-formula" aria-label={t('profitToday')}>
              <h3 className="analytics-box__title">
                <NavIcon name="trendUp" className="analytics-icon" />
                {t('profitToday')}
              </h3>
              <div className="analytics-formula__row">
                <FormulaTerm
                  label={t('analyticsSalesTotal')}
                  paisa={data.profit.sales_paisa}
                  unknown={t('costUnknown')}
                  tone="neutral"
                />
                <span className="analytics-formula__op" aria-hidden="true">−</span>
                <FormulaTerm
                  label={t('cogsToday')}
                  paisa={data.profit.cogs_paisa}
                  unknown={t('costUnknown')}
                  tone="neutral"
                />
                <span className="analytics-formula__op" aria-hidden="true">=</span>
                <FormulaTerm
                  label={t('grossProfit')}
                  paisa={data.profit.gross_profit_paisa}
                  unknown={t('costUnknown')}
                  tone={netTone(data.profit.gross_profit_paisa)}
                />
              </div>
              <div className="analytics-formula__row">
                <FormulaTerm
                  label={t('grossProfit')}
                  paisa={data.profit.gross_profit_paisa}
                  unknown={t('costUnknown')}
                  tone={netTone(data.profit.gross_profit_paisa)}
                />
                <span className="analytics-formula__op" aria-hidden="true">−</span>
                <FormulaTerm
                  label={t('analyticsExpenses')}
                  paisa={data.profit.expenses_paisa}
                  unknown={t('costUnknown')}
                  tone="critical"
                />
                <span className="analytics-formula__op" aria-hidden="true">=</span>
                <FormulaTerm
                  label={t('leftAfterExpenses')}
                  paisa={data.profit.left_paisa}
                  unknown={t('costUnknown')}
                  tone={netTone(data.profit.left_paisa)}
                  strong
                />
              </div>
              {data.profit.cost_unknown ? (
                <p className="analytics-formula__warn">
                  <span className="chip chip--warn">
                    <NavIcon name="warning" className="analytics-icon analytics-icon--sm" />
                    {t('profitUnknown')}
                  </span>
                </p>
              ) : null}
            </section>

            {compare ? (
              <div className="analytics-grid">
                <section className="analytics-box">
                  <h3 className="analytics-box__title">{t('analyticsWeekCompare')}</h3>
                  <p className="muted analytics-box__meta">{t('leftAfterExpenses')}</p>
                  <div className="analytics-compare">
                    <div className="analytics-compare__col">
                      <span className="analytics-compare__label">{t('analyticsThisWeek')}</span>
                      <strong className={`analytics-compare__value tone-text-${netTone(compare.this_week.net_profit_paisa)}`}>
                        <Rs paisa={compare.this_week.net_profit_paisa} />
                      </strong>
                      <span className="muted">{dayRange(compare.this_week.from_day, compare.this_week.to_day)}</span>
                    </div>
                    <div className="analytics-compare__col">
                      <span className="analytics-compare__label">{t('analyticsLastWeek')}</span>
                      <strong className={`analytics-compare__value tone-text-${netTone(compare.last_week.net_profit_paisa)}`}>
                        <Rs paisa={compare.last_week.net_profit_paisa} />
                      </strong>
                      <span className="muted">{dayRange(compare.last_week.from_day, compare.last_week.to_day)}</span>
                    </div>
                  </div>
                  <div className="analytics-compare__chips">
                    {compare.change_pct == null || compare.change_pct === 0 ? (
                      compare.this_week.net_profit_paisa === compare.last_week.net_profit_paisa ? (
                        <span className="chip chip--neutral">{t('analyticsNoChange')}</span>
                      ) : null
                    ) : compare.change_pct > 0 ? (
                      <span className="chip chip--success ltr-isolate">
                        <NavIcon name="trendUp" className="analytics-icon analytics-icon--sm" />
                        {compare.change_pct}%
                      </span>
                    ) : (
                      <span className="chip chip--danger ltr-isolate">
                        <NavIcon name="trendDown" className="analytics-icon analytics-icon--sm" />
                        {Math.abs(compare.change_pct)}%
                      </span>
                    )}
                    {compare.this_week.cost_unknown || compare.last_week.cost_unknown ? (
                      <span className="chip chip--warn">{t('analyticsSomeCostsMissing')}</span>
                    ) : null}
                  </div>
                </section>

                <section className="analytics-box">
                  <h3 className="analytics-box__title">
                    {t('analyticsTopProfitItems')}
                    <span className="muted">· {t('analyticsThisWeek')}</span>
                  </h3>
                  {compare.top_items.length === 0 ? (
                    <p className="muted analytics-box__empty">{t('analyticsProfitEmpty')}</p>
                  ) : (
                    <ol className="analytics-list">
                      {compare.top_items.map((item) => (
                        <li key={item.product_id} className="analytics-list__row">
                          <InitialBadge name={item.product_name} />
                          <div className="analytics-list__main">
                            <span className="analytics-list__name" dir="auto">
                              {item.product_name}
                            </span>
                            <span className="muted">
                              {t('qty')} <span className="ltr-isolate">{item.qty_pieces}</span>
                            </span>
                          </div>
                          <strong className={`analytics-list__amt tone-text-${netTone(item.profit_paisa)}`}>
                            <Rs paisa={item.profit_paisa} />
                          </strong>
                        </li>
                      ))}
                    </ol>
                  )}
                  {compare.top_items_cost_unknown ? (
                    <span className="chip chip--warn">{t('analyticsSomeCostsMissing')}</span>
                  ) : null}
                </section>
              </div>
            ) : null}

            {profitLines.length > 0 ? (
              <section className="analytics-box">
                <h3 className="analytics-box__title">{t('reportItemsSold')}</h3>
                <div className="catalog-table-wrap">
                  <table className="catalog-table analytics-lines">
                    <thead>
                      <tr>
                        <th scope="col">{t('catalogColProduct')}</th>
                        <th scope="col" className="catalog-table__num">{t('qty')}</th>
                        <th scope="col" className="catalog-table__num">{t('reportUnitCost')}</th>
                        <th scope="col" className="catalog-table__num">{t('reportUnitPrice')}</th>
                        <th scope="col" className="catalog-table__num">{t('lineProfit')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {linesVisible.map((line, idx) => (
                        <tr key={`${line.product_name}-${idx}`}>
                          <td dir="auto">{line.product_name}</td>
                          <td className="catalog-table__num ltr-isolate">{line.qty_pieces}</td>
                          <td className="catalog-table__num">
                            {line.unit_cost_paisa == null ? (
                              <span className="muted">{t('costUnknown')}</span>
                            ) : (
                              <Rs paisa={line.unit_cost_paisa} />
                            )}
                          </td>
                          <td className="catalog-table__num">
                            <Rs paisa={line.unit_price_paisa} />
                          </td>
                          <td className={`catalog-table__num tone-text-${netTone(line.profit_paisa)}`}>
                            {line.profit_paisa == null ? (
                              <span className="muted">{t('costUnknown')}</span>
                            ) : (
                              <Rs paisa={line.profit_paisa} />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager page={linesSafe} pageSize={LINES_PAGE} total={profitLines.length} onPage={setLinesPage} />
              </section>
            ) : null}
            <ProductProfitPanel />
          </div>
        </>
      ) : null}

      {previewOpen && report ? (
        <AnalyticsReportPreview report={report} paper={paper} onClose={closePreview} onExcel={() => exportExcel()} />
      ) : null}
    </div>
  );
}
