import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { translateError, useI18n, type MessageKey } from '../../i18n';
import { apiGet, apiPostRaw, apiPutRaw } from '../../lib/api';
import { ConfirmModal } from '../shared/ConfirmModal';
import {
  type Adjustment,
  type CountSession,
  type ExecutionFocus,
  type ReasonCode,
  type ReportResponse,
  REASON_CODES,
  DateText,
  Num,
  ProductCell,
  diffClass,
  fillNodes,
  formatPkt,
  formatRs,
  formatSigned,
} from './stockCountModel';

const REASON_KEY: Record<ReasonCode, MessageKey> = {
  damaged: 'stockCountReasonDamaged',
  expired: 'stockCountReasonExpired',
  stolen_lost: 'stockCountReasonStolenLost',
  admin_error: 'stockCountReasonAdminError',
};

type Props = {
  sessionId: string;
  /** View Past Report: no reason edit, no re-count, no approve. */
  readOnly?: boolean;
  onBackToCounting: () => void;
  onRecount: (focus: ExecutionFocus) => void;
  onDashboard: (flash?: string) => void;
  onViewReport: (sessionId: string) => void;
};

type Row = {
  productId: string;
  name: string;
  nameUr: string | null;
  barcode: string | null;
  system: number;
  physical: number;
  diff: number;
  valuePaisa: number | null;
  reason: ReasonCode | null;
  liveOnHand: number;
  snapshot: number;
};

type PostSummary = {
  adjusted: number;
  skipped: number;
  totalAbsDelta: number;
  netPaisa: number | null;
  uncosted: number;
};

type ViewFilter = 'all' | 'discrepancies';

/** S-SC7: Variance & Review (draft) and View Past Report (posted, read-only). */
export function StockCountReview({
  sessionId,
  readOnly,
  onBackToCounting,
  onRecount,
  onDashboard,
  onViewReport,
}: Props) {
  const { t, locale } = useI18n();
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savingReason, setSavingReason] = useState<string | null>(null);
  const [filter, setFilter] = useState<ViewFilter>('all');
  const [confirmPost, setConfirmPost] = useState(false);
  const [summary, setSummary] = useState<PostSummary | null>(null);
  const filterInitRef = useRef(false);

  const load = useCallback(async () => {
    const r = await apiGet<ReportResponse>(`/stock/counts/${encodeURIComponent(sessionId)}`);
    if (!r.ok) {
      setError(r.error ?? 'stock_count_failed');
      return;
    }
    setReport(r);
  }, [sessionId]);

  useEffect(() => {
    load().catch(() => setError('stock_count_failed'));
  }, [load]);

  const session: CountSession | undefined = report?.session;
  const isPosted = session?.status === 'posted';
  const editable = !readOnly && session?.status === 'draft' && !summary;

  const rows: Row[] = useMemo(() => {
    if (!report?.lines) return [];
    const adjByLine = new Map<string, Adjustment>();
    for (const a of report.adjustments ?? []) {
      if (a.line_id) adjByLine.set(a.line_id, a);
    }
    const out: Row[] = [];
    for (const l of report.lines) {
      if (l.counted_qty == null) continue;
      const base = {
        productId: l.product_id,
        name: l.product_name,
        nameUr: l.product_name_ur,
        barcode: l.barcode,
        liveOnHand: l.qty_on_hand,
        snapshot: l.system_qty_snapshot,
      };
      if (isPosted) {
        // Posted: real deltas from the ledger (absolute post vs live on-hand).
        const a = adjByLine.get(l.id);
        if (a) {
          out.push({
            ...base,
            system: a.qty_before,
            physical: a.qty_after,
            diff: a.delta_pieces,
            valuePaisa: a.unit_cost_paisa == null ? null : a.delta_pieces * a.unit_cost_paisa,
            reason: a.reason_code ?? l.reason_code,
          });
        } else {
          out.push({
            ...base,
            system: l.counted_qty,
            physical: l.counted_qty,
            diff: 0,
            valuePaisa: l.unit_cost_paisa_snapshot == null ? null : 0,
            reason: null,
          });
        }
        continue;
      }
      const diff = l.counted_qty - l.system_qty_snapshot;
      out.push({
        ...base,
        system: l.system_qty_snapshot,
        physical: l.counted_qty,
        diff,
        valuePaisa:
          l.value_delta_paisa ??
          (l.unit_cost_paisa_snapshot == null ? null : diff * l.unit_cost_paisa_snapshot),
        reason: l.reason_code,
      });
    }
    return out;
  }, [report, isPosted]);

  const stats = useMemo(() => {
    let matching = 0;
    let missing = 0;
    let missingPcs = 0;
    let extra = 0;
    let extraPcs = 0;
    let net = 0;
    let costed = 0;
    let uncosted = 0;
    for (const r of rows) {
      if (r.diff === 0) {
        matching += 1;
        continue;
      }
      if (r.diff < 0) {
        missing += 1;
        missingPcs += -r.diff;
      } else {
        extra += 1;
        extraPcs += r.diff;
      }
      if (r.valuePaisa == null) uncosted += 1;
      else {
        costed += 1;
        net += r.valuePaisa;
      }
    }
    return { matching, missing, missingPcs, extra, extraPcs, net, costed, uncosted };
  }, [rows]);

  const discrepancyCount = stats.missing + stats.extra;

  useEffect(() => {
    if (filterInitRef.current || !report) return;
    filterInitRef.current = true;
    setFilter(discrepancyCount > 0 ? 'discrepancies' : 'all');
  }, [report, discrepancyCount]);

  const visibleRows = filter === 'discrepancies' ? rows.filter((r) => r.diff !== 0) : rows;

  const notCounted = useMemo(() => {
    if (!report?.progress || !session) return 0;
    if (isPosted) {
      return session.items_total_at_post != null
        ? Math.max(0, session.items_total_at_post - rows.length)
        : 0;
    }
    return Math.max(0, report.progress.total - report.progress.counted);
  }, [report, session, isPosted, rows.length]);

  async function setReason(row: Row, value: string) {
    if (!editable) return;
    const reasonCode = value === '' ? null : (value as ReasonCode);
    setSavingReason(row.productId);
    setError(null);
    // Optimistic: reflect the pick right away.
    setReport((prev) =>
      prev?.lines
        ? {
            ...prev,
            lines: prev.lines.map((l) =>
              l.product_id === row.productId ? { ...l, reason_code: reasonCode } : l,
            ),
          }
        : prev,
    );
    try {
      const r = await apiPutRaw<{ ok: boolean; error?: string }>(
        `/stock/counts/${encodeURIComponent(sessionId)}/lines`,
        { lines: [{ productId: row.productId, countedQty: row.physical, reasonCode }] },
      );
      if (!r.ok || !r.json?.ok) setError(r.json?.error ?? 'stock_count_failed');
      await load();
    } catch {
      setError('stock_count_failed');
    } finally {
      setSavingReason(null);
    }
  }

  async function doPost() {
    setBusy(true);
    setError(null);
    try {
      const r = await apiPostRaw<{
        ok: boolean;
        error?: string;
        adjusted?: number;
        skipped?: number;
        totalAbsDelta?: number;
        adjustments?: Adjustment[];
      }>(`/stock/counts/${encodeURIComponent(sessionId)}/post`, {});
      setConfirmPost(false);
      if (!r.ok || !r.json?.ok) {
        setError(r.json?.error ?? 'stock_count_failed');
        await load().catch(() => undefined);
        return;
      }
      const adjs = r.json.adjustments ?? [];
      let net = 0;
      let costed = 0;
      let uncosted = 0;
      for (const a of adjs) {
        if (a.unit_cost_paisa == null) uncosted += 1;
        else {
          costed += 1;
          net += a.delta_pieces * a.unit_cost_paisa;
        }
      }
      setSummary({
        adjusted: r.json.adjusted ?? adjs.length,
        skipped: r.json.skipped ?? 0,
        totalAbsDelta: r.json.totalAbsDelta ?? 0,
        netPaisa: costed > 0 ? net : null,
        uncosted,
      });
    } catch {
      setError('stock_count_failed');
      setConfirmPost(false);
    } finally {
      setBusy(false);
    }
  }

  const title = readOnly || isPosted ? t('stockCountReportTitle') : t('stockCountReviewTitle');
  const showReasonCol = editable || rows.some((r) => r.reason != null);
  const showRecount = editable;

  if (summary) {
    return (
      <section className="card stock-count stock-count--review">
        <header className="stock-count__head">
          <h2 className="stock-count__title">{t('stockCountTitle')}</h2>
        </header>
        <div className="stock-count__summary purchases-card" role="status">
          <p className="stock-count__summary-lead">
            {fillNodes(t('stockCountPosted'), {
              n: <Num>{summary.adjusted}</Num>,
              delta: <Num>{summary.totalAbsDelta}</Num>,
            })}
          </p>
          <p className="muted">
            {fillNodes(t('stockCountSkipped'), { n: <Num>{summary.skipped}</Num> })}
          </p>
          {summary.netPaisa != null ? (
            <p className={`stock-count__summary-net dd-money ${diffClass(summary.netPaisa)}`}>
              {fillNodes(t('stockCountPostedNet'), {
                v: <Num>{formatRs(summary.netPaisa, true)}</Num>,
              })}
            </p>
          ) : null}
          {summary.uncosted > 0 ? (
            <p className="muted dd-money">
              {fillNodes(t('stockCountUncostedFootnote'), { n: <Num>{summary.uncosted}</Num> })}
            </p>
          ) : null}
          <div className="stock-count__summary-actions">
            <button type="button" className="btn btn--teal" onClick={() => onViewReport(sessionId)}>
              {t('stockCountViewReport')}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => onDashboard()}>
              {t('stockCountBackToDashboard')}
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="card stock-count stock-count--review">
      <header className="stock-count__head">
        <div>
          <h2 className="stock-count__title">{title}</h2>
          {session ? (
            <p className="muted stock-count__subtitle">
              {session.source === 'catalog_quick' ? t('stockCountTypeQuick') : t('stockCountTypeFull')}
              {' · '}
              {isPosted ? (
                <>
                  <span className="chip chip--success">{t('stockCountStatusCompleted')}</span>{' '}
                  <DateText>{formatPkt(session.posted_at, locale)}</DateText>
                </>
              ) : (
                fillNodes(t('stockCountDraftStarted'), {
                  when: <DateText>{formatPkt(session.started_at, locale)}</DateText>,
                })
              )}
            </p>
          ) : null}
        </div>
        <div className="stock-count__head-actions">
          {editable ? (
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={onBackToCounting}>
              {t('stockCountBackToCounting')}
            </button>
          ) : (
            <button type="button" className="btn btn--ghost" onClick={() => onDashboard()}>
              {t('stockCountBackToDashboard')}
            </button>
          )}
        </div>
      </header>

      {error ? (
        <p className="form-error" role="alert">
          {translateError(t, error)}
        </p>
      ) : null}

      {!report ? (
        !error ? (
          <p className="muted catalog-empty" role="status">
            {t('loading')}
          </p>
        ) : null
      ) : (
        <>
          <div className="stock-count-cards">
            <div className="stock-count-card">
              <p className="stock-count-card__label">{t('stockCountFilterCounted')}</p>
              <p className="stock-count-card__value">
                <Num>{rows.length}</Num>
              </p>
            </div>
            <div className="stock-count-card stock-count-card--match">
              <p className="stock-count-card__label">{t('stockCountCardMatching')}</p>
              <p className="stock-count-card__value">
                <Num>{stats.matching}</Num>
              </p>
            </div>
            <div className="stock-count-card stock-count-card--missing">
              <p className="stock-count-card__label">{t('stockCountCardMissing')}</p>
              <p className="stock-count-card__value">
                <Num>{stats.missing}</Num>
              </p>
              <p className="stock-count-card__foot">
                {fillNodes(t('stockCountPcs'), { n: <Num>{formatSigned(-stats.missingPcs)}</Num> })}
              </p>
            </div>
            <div className="stock-count-card stock-count-card--extra">
              <p className="stock-count-card__label">{t('stockCountCardExtra')}</p>
              <p className="stock-count-card__value">
                <Num>{stats.extra}</Num>
              </p>
              <p className="stock-count-card__foot">
                {fillNodes(t('stockCountPcs'), { n: <Num>{formatSigned(stats.extraPcs)}</Num> })}
              </p>
            </div>
            <div className="stock-count-card stock-count-card--value dd-money">
              <p className="stock-count-card__label">{t('stockCountCardNetValue')}</p>
              <p className={`stock-count-card__value ${diffClass(stats.costed > 0 ? stats.net : 0)}`}>
                {stats.costed > 0 || discrepancyCount === 0 ? (
                  <Num>{formatRs(stats.net, true)}</Num>
                ) : (
                  '—'
                )}
              </p>
              {stats.uncosted > 0 ? (
                <p className="stock-count-card__foot">
                  {fillNodes(t('stockCountUncostedNote'), { n: <Num>{stats.uncosted}</Num> })}
                </p>
              ) : null}
            </div>
          </div>

          {notCounted > 0 ? (
            <p className="muted stock-count__footnote">
              {fillNodes(isPosted ? t('stockCountNotCountedPosted') : t('stockCountNotCountedNote'), {
                n: <Num>{notCounted}</Num>,
              })}
            </p>
          ) : null}

          <div className="settings-tabs stock-count-tabs stock-count-tabs--review" role="tablist" aria-label={t('stockCountReviewTitle')}>
            {(['all', 'discrepancies'] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                className={`settings-tab${filter === f ? ' is-active' : ''}`}
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? t('stockCountFilterAll') : t('stockCountFilterDiscrepancies')}
                {f === 'discrepancies' ? (
                  <>
                    {' '}
                    <Num className="stock-count-tabs__n">({discrepancyCount})</Num>
                  </>
                ) : (
                  <>
                    {' '}
                    <Num className="stock-count-tabs__n">({rows.length})</Num>
                  </>
                )}
              </button>
            ))}
          </div>

          {visibleRows.length === 0 ? (
            <p className="muted catalog-empty" role="status">
              {rows.length === 0 ? t('stockCountNoLines') : t('stockCountNoDiscrepancies')}
            </p>
          ) : (
            <div className="catalog-table-wrap">
              <table className="catalog-table stock-count-review-table">
                <caption className="visually-hidden">{title}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="catalog-table__col-product">
                      {t('catalogColProduct')}
                    </th>
                    <th scope="col" className="catalog-table__num">
                      {t('stockCountColSystem')}
                    </th>
                    <th scope="col" className="catalog-table__num">
                      {t('stockCountColPhysical')}
                    </th>
                    <th scope="col" className="catalog-table__num">
                      {t('stockCountColDiff')}
                    </th>
                    <th scope="col" className="catalog-table__num dd-money">
                      {t('stockCountColValue')}
                    </th>
                    {showReasonCol ? <th scope="col">{t('stockCountColReason')}</th> : null}
                    {showRecount ? (
                      <th scope="col">
                        <span className="visually-hidden">{t('stockCountColAction')}</span>
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r) => {
                    const changed = editable && r.liveOnHand !== r.snapshot;
                    return (
                      <tr key={r.productId}>
                        <td className="catalog-table__col-product">
                          <ProductCell
                            name={r.name}
                            nameUr={r.nameUr}
                            showUr={locale === 'ur'}
                            barcode={r.barcode}
                            barcodeLabel={t('barcode')}
                          />
                          {changed ? (
                            <p className="stock-count-changed" role="note">
                              {fillNodes(t('stockCountStockChanged'), {
                                n: <Num>{r.liveOnHand}</Num>,
                              })}
                            </p>
                          ) : null}
                        </td>
                        <td className="catalog-table__num">
                          <Num>{r.system}</Num>
                        </td>
                        <td className="catalog-table__num">
                          <Num>{r.physical}</Num>
                        </td>
                        <td className={`catalog-table__num ${diffClass(r.diff)}`}>
                          <Num>{formatSigned(r.diff)}</Num>
                        </td>
                        <td className={`catalog-table__num dd-money ${diffClass(r.valuePaisa)}`}>
                          {r.valuePaisa == null ? (
                            <span className="catalog-table__none" title={t('stockCountUncosted')}>
                              —
                            </span>
                          ) : (
                            <Num>{formatRs(r.valuePaisa, true)}</Num>
                          )}
                        </td>
                        {showReasonCol ? (
                          <td className="stock-count-review-table__reason">
                            {r.diff === 0 ? null : editable ? (
                              <select
                                className="stock-count-reason"
                                aria-label={`${t('stockCountColReason')}: ${r.name}`}
                                value={r.reason ?? ''}
                                disabled={busy || savingReason === r.productId}
                                onChange={(e) => void setReason(r, e.target.value)}
                              >
                                <option value="">{t('stockCountReasonNone')}</option>
                                {REASON_CODES.map((code) => (
                                  <option key={code} value={code}>
                                    {t(REASON_KEY[code])}
                                  </option>
                                ))}
                              </select>
                            ) : r.reason ? (
                              t(REASON_KEY[r.reason])
                            ) : (
                              <span className="catalog-table__none">—</span>
                            )}
                          </td>
                        ) : null}
                        {showRecount ? (
                          <td className="stock-count-history__action">
                            {r.diff !== 0 ? (
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                disabled={busy}
                                onClick={() =>
                                  onRecount({ productId: r.productId, query: r.barcode ?? r.name })
                                }
                              >
                                {t('stockCountRecount')}
                              </button>
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {editable ? (
            <div className="stock-count-sticky">
              <p className="muted stock-count-sticky__hint">
                {fillNodes(t('stockCountApproveHint'), {
                  n: <Num>{discrepancyCount}</Num>,
                  m: <Num>{stats.matching}</Num>,
                })}
              </p>
              <button
                type="button"
                className="btn btn--teal stock-count-sticky__cta"
                disabled={busy || rows.length === 0}
                onClick={() => setConfirmPost(true)}
              >
                {t('stockCountApprove')}
              </button>
            </div>
          ) : null}
        </>
      )}

      {confirmPost ? (
        <ConfirmModal
          title={t('stockCountApproveTitle')}
          message={t('stockCountApproveBody')
            .replace('{n}', String(discrepancyCount))
            .replace('{m}', String(stats.matching))}
          confirmLabel={t('stockCountApprove')}
          cancelLabel={t('cancel')}
          tone="primary"
          busy={busy}
          onConfirm={() => void doPost()}
          onCancel={() => {
            if (!busy) setConfirmPost(false);
          }}
        />
      ) : null}
    </section>
  );
}
