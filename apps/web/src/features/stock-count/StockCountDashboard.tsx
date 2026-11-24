import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '../shared/PageHeader';
import { UrHint, translateError, useI18n } from '../../i18n';
import { apiGet, apiPostRaw } from '../../lib/api';
import { ConfirmModal } from '../shared/ConfirmModal';
import { EmptyState } from '../shared/EmptyState';
import {
  type CountSession,
  type HistoryItem,
  type HistoryResponse,
  type Progress,
  type WorksheetResponse,
  DateText,
  Num,
  daysAgoPkt,
  diffClass,
  fillNodes,
  formatPkt,
  formatRs,
  formatSigned,
} from './stockCountModel';

const HISTORY_LIMIT = 20;

type Props = {
  displayName: string;
  flash: string | null;
  onOpenCatalog?: () => void;
  onOpenExecution: (sessionId: string) => void;
  onOpenReport: (sessionId: string) => void;
};

type DraftInfo = {
  session: CountSession;
  progress: Progress | null;
  discrepancies: number;
};

function historyDate(s: CountSession): string | null {
  return s.status === 'posted' ? s.posted_at ?? s.started_at : s.started_at;
}

/** S-SC5: landing view — draft card, quick stats, history. */
export function StockCountDashboard({
  displayName,
  flash,
  onOpenCatalog,
  onOpenExecution,
  onOpenReport,
}: Props) {
  const { t, locale } = useI18n();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [stats, setStats] = useState<Pick<HistoryResponse, 'lastFullCount' | 'monthlyShrinkage'> | null>(null);
  const [draft, setDraft] = useState<DraftInfo | null>(null);
  const [catalogTotal, setCatalogTotal] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [message, setMessage] = useState<string | null>(flash);

  const load = useCallback(async () => {
    const [list, draftRes, catalog] = await Promise.all([
      apiGet<HistoryResponse>(`/stock/counts?limit=${HISTORY_LIMIT}`),
      apiGet<{ session: CountSession | null }>('/stock/counts/draft'),
      apiGet<{ total?: number; items: unknown[] }>('/catalog/products?page=1&pageSize=1').catch(
        () => null,
      ),
    ]);
    setHistory(list.items ?? []);
    setHasMore((list.items ?? []).length >= HISTORY_LIMIT);
    setStats({ lastFullCount: list.lastFullCount, monthlyShrinkage: list.monthlyShrinkage });
    setCatalogTotal(catalog ? catalog.total ?? catalog.items.length : null);

    if (draftRes.session) {
      const s = draftRes.session;
      const agg = (list.items ?? []).find((h) => h.session.id === s.id)?.aggregates;
      let progress: Progress | null = null;
      try {
        const ws = await apiGet<WorksheetResponse>(
          `/stock/counts/${encodeURIComponent(s.id)}/items?filter=counted&page=1&pageSize=1`,
        );
        progress = ws.progress ?? null;
      } catch {
        progress = null;
      }
      setDraft({
        session: s,
        progress,
        discrepancies: agg ? agg.items_missing + agg.items_extra : 0,
      });
    } else {
      setDraft(null);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    load().catch(() => {
      setError('stock_count_failed');
      setLoaded(true);
    });
  }, [load]);

  async function loadMore() {
    const last = history[history.length - 1];
    if (!last) return;
    const before = historyDate(last.session);
    if (!before) return;
    setBusy(true);
    try {
      const r = await apiGet<HistoryResponse>(
        `/stock/counts?limit=${HISTORY_LIMIT}&before=${encodeURIComponent(before)}`,
      );
      const seen = new Set(history.map((h) => h.session.id));
      const more = (r.items ?? []).filter((h) => !seen.has(h.session.id));
      setHistory((prev) => [...prev, ...more]);
      setHasMore((r.items ?? []).length >= HISTORY_LIMIT && more.length > 0);
    } catch {
      setError('stock_count_failed');
    } finally {
      setBusy(false);
    }
  }

  async function startNew() {
    if (draft) {
      setError('draft_exists');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const r = await apiPostRaw<{
        ok: boolean;
        error?: string;
        session?: CountSession | null;
      }>('/stock/counts', { source: 'full_screen' });
      if (r.ok && r.json?.ok && r.json.session) {
        onOpenExecution(r.json.session.id);
        return;
      }
      // D28 one-draft: another draft appeared — surface it, don't open it silently.
      setError(r.json?.error ?? 'stock_count_failed');
      await load();
    } catch {
      setError('stock_count_failed');
    } finally {
      setBusy(false);
    }
  }

  async function doDiscard() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiPostRaw<{ ok: boolean; error?: string }>(
        `/stock/counts/${encodeURIComponent(draft.session.id)}/cancel`,
        {},
      );
      if (!r.ok || !r.json?.ok) {
        setError(r.json?.error ?? 'stock_count_failed');
      } else {
        setMessage(t('stockCountCancelled'));
      }
      setConfirmDiscard(false);
      await load();
    } catch {
      setError('stock_count_failed');
      setConfirmDiscard(false);
    } finally {
      setBusy(false);
    }
  }

  const lastFull = stats?.lastFullCount ?? null;
  const lastFullDays = lastFull ? daysAgoPkt(lastFull.posted_at) : null;
  const shrink = stats?.monthlyShrinkage ?? null;
  const emptyCatalog = catalogTotal === 0;

  function ageLabel(days: number | null): string {
    if (days == null) return t('stockCountNever');
    if (days === 0) return t('stockCountToday');
    if (days === 1) return t('stockCountOneDayAgo');
    return t('stockCountDaysAgo').replace('{n}', String(days));
  }

  return (
    <section className="card stock-count stock-count--dashboard">
      <PageHeader
        title={<>{t('stockCountTitle')}<UrHint k="stockCountTitle" /></>}
        subtitle={displayName}
        actions={
          <button
            type="button"
            className="btn btn--teal stock-count__start"
            disabled={busy || !loaded || !!draft || emptyCatalog}
            aria-describedby={draft ? 'stock-count-start-blocked' : undefined}
            onClick={() => void startNew()}
          >
            + {t('stockCountStartNew')}
          </button>
        }
      />

      {error ? (
        <p className="form-error" role="alert">
          {translateError(t, error)}
        </p>
      ) : null}
      {message ? (
        <p className="catalog-success" role="status">
          {message}
        </p>
      ) : null}

      {draft ? (
        <div className="stock-count-draft" role="region" aria-label={t('stockCountDraftAlertTitle')}>
          <div className="stock-count-draft__body">
            <p className="stock-count-draft__title">
              <span className="chip chip--warn">{t('stockCountStatusDraft')}</span>
              {t('stockCountDraftAlertTitle')}
            </p>
            <p className="muted stock-count-draft__meta">
              {fillNodes(t('stockCountDraftStarted'), {
                when: <DateText>{formatPkt(draft.session.started_at, locale)}</DateText>,
              })}
              {draft.progress ? (
                <>
                  {' · '}
                  {fillNodes(t('stockCountCoverageCounted'), {
                    x: <Num>{draft.progress.counted}</Num>,
                    y: <Num>{draft.progress.total}</Num>,
                  })}
                </>
              ) : null}
              {' · '}
              {fillNodes(t('stockCountDraftDiscrepancies'), {
                n: <Num>{draft.discrepancies}</Num>,
              })}
            </p>
            <p id="stock-count-start-blocked" className="muted stock-count-draft__hint">
              {t('stockCountStartBlocked')}
            </p>
          </div>
          <div className="stock-count-draft__actions">
            <button
              type="button"
              className="btn btn--teal"
              disabled={busy}
              onClick={() => onOpenExecution(draft.session.id)}
            >
              {t('stockCountResumeDraft')}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--danger"
              disabled={busy}
              onClick={() => setConfirmDiscard(true)}
            >
              {t('stockCountDiscard')}
            </button>
          </div>
        </div>
      ) : null}

      {loaded ? (
        <div className="stock-count-stats">
          <div className="stock-count-stat">
            <p className="stock-count-stat__label">{t('stockCountLastFullCount')}</p>
            <p className="stock-count-stat__value">{ageLabel(lastFull ? lastFullDays : null)}</p>
            {lastFull ? (
              <p className="muted stock-count-stat__foot">
                <DateText>{formatPkt(lastFull.posted_at, locale)}</DateText>
                {' · '}
                {lastFull.session.items_total_at_post != null
                  ? fillNodes(t('stockCountCoverage'), {
                      x: <Num>{lastFull.items_counted}</Num>,
                      y: <Num>{lastFull.session.items_total_at_post}</Num>,
                    })
                  : fillNodes(t('stockCountItemsN'), { n: <Num>{lastFull.items_counted}</Num> })}
              </p>
            ) : null}
          </div>
          <div className="stock-count-stat stock-count-stat--loss dd-money">
            <p className="stock-count-stat__label">{t('stockCountShrinkMonth')}</p>
            <p className="stock-count-stat__value">
              <Num>{formatRs(shrink?.loss_paisa ?? 0)}</Num>
            </p>
            <p className="muted stock-count-stat__foot">
              {t('stockCountShrinkNote')}
              {shrink && shrink.uncosted_loss_items > 0 ? (
                <>
                  {' · '}
                  {fillNodes(t('stockCountUncostedNote'), {
                    n: <Num>{shrink.uncosted_loss_items}</Num>,
                  })}
                </>
              ) : null}
            </p>
          </div>
        </div>
      ) : null}

      {!loaded ? (
        <p className="muted catalog-empty" role="status">
          {t('loading')}
        </p>
      ) : emptyCatalog && history.length === 0 ? (
        <EmptyState
          className="catalog-empty"
          title={t('emptyStateCatalogTitle')}
          description={t('stockCountEmptyDesc')}
          action={
            onOpenCatalog ? (
              <button type="button" className="btn btn--teal" onClick={onOpenCatalog}>
                {t('catalog')}
              </button>
            ) : null
          }
        />
      ) : history.length === 0 ? (
        <EmptyState
          className="catalog-empty"
          title={t('stockCountHistoryEmptyTitle')}
          description={t('stockCountHistoryEmptyDesc')}
          action={
            !draft ? (
              <button
                type="button"
                className="btn btn--teal"
                disabled={busy}
                onClick={() => void startNew()}
              >
                + {t('stockCountStartNew')}
              </button>
            ) : null
          }
        />
      ) : (
        <>
          <h3 className="stock-count__section-title">{t('stockCountHistoryTitle')}</h3>
          <div className="catalog-table-wrap">
            <table className="catalog-table stock-count-history">
              <caption className="visually-hidden">{t('stockCountHistoryTitle')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('stockCountColDate')}</th>
                  <th scope="col">{t('stockCountColType')}</th>
                  <th scope="col" className="catalog-table__num">
                    {t('stockCountItemsCounted')}
                  </th>
                  <th scope="col" className="catalog-table__num">
                    {t('stockCountColDiscrepancy')}
                  </th>
                  <th scope="col">{t('stockCountColStatus')}</th>
                  <th scope="col">
                    <span className="visually-hidden">{t('stockCountColAction')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => {
                  const s = h.session;
                  const a = h.aggregates;
                  const discrepant = a.items_missing + a.items_extra;
                  const showRs =
                    discrepant > a.items_uncosted && a.value_delta_paisa != null;
                  const isDraft = s.status === 'draft';
                  return (
                    <tr key={s.id}>
                      <td>
                        <DateText>{formatPkt(historyDate(s), locale)}</DateText>
                      </td>
                      <td>
                        {s.source === 'catalog_quick'
                          ? t('stockCountTypeQuick')
                          : t('stockCountTypeFull')}
                      </td>
                      <td className="catalog-table__num">
                        <Num>
                          {s.items_total_at_post != null
                            ? `${a.items_counted} / ${s.items_total_at_post}`
                            : a.items_counted}
                        </Num>
                      </td>
                      <td className="catalog-table__num">
                        {a.abs_delta_units === 0 ? (
                          <span className="stock-count-var--muted">
                            <Num>0</Num>
                          </span>
                        ) : (
                          <span className="stock-count-history__disc">
                            <span className={diffClass(a.net_delta_units)}>
                              {fillNodes(t('stockCountPcs'), {
                                n: <Num>{a.abs_delta_units}</Num>,
                              })}
                            </span>
                            <span className="muted">
                              {fillNodes(t('stockCountNet'), {
                                n: <Num>{formatSigned(a.net_delta_units)}</Num>,
                              })}
                              <span className="dd-money">{' · '}</span>
                              {showRs ? (
                                <span className="dd-money"><Num>{formatRs(a.value_delta_paisa ?? 0, true)}</Num></span>
                              ) : (
                                <span className="dd-money" title={t('stockCountUncosted')}>—</span>
                              )}
                            </span>
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`chip ${isDraft ? 'chip--warn' : 'chip--success'}`}>
                          {isDraft ? t('stockCountStatusDraft') : t('stockCountStatusCompleted')}
                        </span>
                      </td>
                      <td className="stock-count-history__action">
                        {isDraft ? (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            disabled={busy}
                            onClick={() => onOpenExecution(s.id)}
                          >
                            {t('stockCountResumeDraft')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            disabled={busy}
                            onClick={() => onOpenReport(s.id)}
                          >
                            {t('stockCountViewReport')}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {hasMore ? (
            <div className="stock-count__more">
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busy}
                onClick={() => void loadMore()}
              >
                {t('stockCountLoadMore')}
              </button>
            </div>
          ) : null}
        </>
      )}

      {confirmDiscard ? (
        <ConfirmModal
          title={t('stockCountCancelTitle')}
          message={t('stockCountCancelBody')}
          confirmLabel={t('stockCountDiscard')}
          cancelLabel={t('cancel')}
          busy={busy}
          onConfirm={() => void doDiscard()}
          onCancel={() => {
            if (!busy) setConfirmDiscard(false);
          }}
        />
      ) : null}
    </section>
  );
}
