import { allowsFraction } from '../shared/productUnits';
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { translateError, useI18n } from '../../i18n';
import { apiGet, apiPostRaw, apiPutRaw } from '../../lib/api';
import { ConfirmModal } from '../shared/ConfirmModal';
import { EmptyState } from '../shared/EmptyState';
import { MoneyInput } from '../shared/MoneyInput';
import { Pager } from '../shared/Pager';
import {
  type CountLine,
  type ExecutionFocus,
  type Progress,
  type WorksheetItem,
  type WorksheetResponse,
  Num,
  ProductCell,
  fillNodes,
  parseCounted,
} from './stockCountModel';

const PAGE_SIZE = 20;
const SAVE_DEBOUNCE_MS = 400;
const SEARCH_DEBOUNCE_MS = 250;
const STEPS = [1, 5, 10] as const;

type Filter = 'all' | 'uncounted' | 'counted';
const FILTERS: Array<{ id: Filter; key: 'stockCountFilterAll' | 'stockCountFilterUncounted' | 'stockCountFilterCounted' }> = [
  { id: 'all', key: 'stockCountFilterAll' },
  { id: 'uncounted', key: 'stockCountFilterUncounted' },
  { id: 'counted', key: 'stockCountFilterCounted' },
];

type Props = {
  sessionId: string;
  /** Re-count Item: open filtered to this product, counted input focused. */
  focus?: ExecutionFocus | null;
  /** Shows "Back To Review" (came from Review). */
  fromReview?: boolean;
  dirtyRef: MutableRefObject<boolean>;
  onOpenCatalog?: () => void;
  onDashboard: (flash?: string) => void;
  onReview: () => void;
};

type FlushResult = { ok: boolean; counted: number | null };

/** S-SC6: Active Counting — worksheet, steppers, autosave. Never posts. */
export function StockCountExecution({
  sessionId,
  focus,
  fromReview,
  dirtyRef,
  onOpenCatalog,
  onDashboard,
  onReview,
}: Props) {
  const { t, locale } = useI18n();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState(focus?.query ?? '');
  const [query, setQuery] = useState(focus?.query ?? '');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<WorksheetItem[]>([]);
  const [total, setTotal] = useState(0);
  const [progress, setProgress] = useState<Progress>({ counted: 0, total: 0 });
  const [loaded, setLoaded] = useState(false);
  const [notDraft, setNotDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  /** productId → counted text typed locally (overrides server value until saved). */
  const [edits, setEdits] = useState<Record<string, string>>({});

  const editsRef = useRef<Record<string, string>>({});
  const pendingRef = useRef<Map<string, string>>(new Map());
  const timerRef = useRef<number | null>(null);
  const inflightRef = useRef<Promise<FlushResult>>(Promise.resolve({ ok: true, counted: null }));
  const inflightCountRef = useRef(0);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  /** After worksheet reload: focus counted input (recount) or flash row + keep scan focused. */
  const focusAfterLoadRef = useRef<{ productId: string; mode: 'edit' | 'scan' } | null>(
    focus?.productId ? { productId: focus.productId, mode: 'edit' } : null,
  );
  /** Skip one search→query debounce after barcode scan clears the field. */
  const skipSearchSyncRef = useRef(false);
  const highlightTimerRef = useRef<number | null>(null);

  const syncDirty = useCallback(() => {
    dirtyRef.current = pendingRef.current.size > 0 || inflightCountRef.current > 0;
  }, [dirtyRef]);

  /* ── load worksheet ─────────────────────────────────────────── */

  useEffect(() => {
    if (skipSearchSyncRef.current) {
      skipSearchSyncRef.current = false;
      return;
    }
    const h = window.setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(h);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      filter,
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    if (query) params.set('q', query);
    apiGet<WorksheetResponse>(`/stock/counts/${encodeURIComponent(sessionId)}/items?${params}`)
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) {
          setError(r.error ?? 'stock_count_failed');
          setLoaded(true);
          return;
        }
        if (r.session && r.session.status !== 'draft') {
          setNotDraft(true);
        }
        setItems(r.items ?? []);
        setTotal(r.total ?? 0);
        if (r.progress) setProgress(r.progress);
        setLoaded(true);
        const want = focusAfterLoadRef.current;
        if (want && (r.items ?? []).some((i) => i.product_id === want.productId)) {
          focusAfterLoadRef.current = null;
          window.setTimeout(() => {
            if (want.mode === 'scan') {
              setHighlightId(want.productId);
              if (highlightTimerRef.current != null) {
                window.clearTimeout(highlightTimerRef.current);
              }
              highlightTimerRef.current = window.setTimeout(() => {
                highlightTimerRef.current = null;
                setHighlightId((h) => (h === want.productId ? null : h));
              }, 1200);
              inputRefs.current[want.productId]?.scrollIntoView({
                block: 'nearest',
                behavior: 'smooth',
              });
              searchRef.current?.focus();
            } else {
              const el = inputRefs.current[want.productId];
              el?.focus();
              el?.select();
            }
          }, 0);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError('catalog_unavailable');
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, filter, query, page]);

  useEffect(() => {
    if (!focus) searchRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  /* ── autosave ───────────────────────────────────────────────── */

  const applyLines = useCallback((lines: CountLine[], sent: Map<string, string>) => {
    const byProduct = new Map(lines.map((l) => [l.product_id, l]));
    setItems((prev) =>
      prev.map((it) => {
        const line = byProduct.get(it.product_id);
        if (!line) {
          return sent.has(it.product_id)
            ? { ...it, counted_qty: null, counted: false, variance: null }
            : it;
        }
        return {
          ...it,
          line_id: line.id,
          system_qty_snapshot: line.system_qty_snapshot,
          counted_qty: line.counted_qty,
          counted: line.counted_qty != null,
          variance:
            line.counted_qty == null ? null : line.counted_qty - line.system_qty_snapshot,
        };
      }),
    );
    // Drop local overrides that the server now reflects.
    const next = { ...editsRef.current };
    let changed = false;
    for (const [pid, text] of sent) {
      if (next[pid] === text && !pendingRef.current.has(pid)) {
        delete next[pid];
        changed = true;
      }
    }
    if (changed) {
      editsRef.current = next;
      setEdits(next);
    }
  }, []);

  const flush = useCallback((): Promise<FlushResult> => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const batch = new Map(pendingRef.current);
    pendingRef.current.clear();
    if (batch.size === 0) {
      syncDirty();
      return inflightRef.current;
    }
    inflightCountRef.current += 1;
    syncDirty();
    setSaveState('saving');
    const run = inflightRef.current.then(async (): Promise<FlushResult> => {
      const lines = Array.from(batch, ([productId, text]) => ({
        productId,
        countedQty: parseCounted(text),
      }));
      try {
        const r = await apiPutRaw<{ ok: boolean; error?: string; lines?: CountLine[] }>(
          `/stock/counts/${encodeURIComponent(sessionId)}/lines`,
          { lines },
        );
        if (!r.ok || !r.json?.ok) {
          for (const [pid, text] of batch) {
            if (!pendingRef.current.has(pid)) pendingRef.current.set(pid, text);
          }
          if (r.json?.error === 'not_draft') setNotDraft(true);
          setError(r.json?.error ?? 'stock_count_failed');
          return { ok: false, counted: null };
        }
        const all = r.json.lines ?? [];
        const counted = all.filter((l) => l.counted_qty != null).length;
        setProgress((p) => ({ ...p, counted }));
        applyLines(all, batch);
        setError(null);
        return { ok: true, counted };
      } catch {
        for (const [pid, text] of batch) {
          if (!pendingRef.current.has(pid)) pendingRef.current.set(pid, text);
        }
        setError('stock_count_failed');
        return { ok: false, counted: null };
      } finally {
        inflightCountRef.current -= 1;
        syncDirty();
        if (inflightCountRef.current === 0) {
          setSaveState(pendingRef.current.size > 0 ? 'idle' : 'saved');
        }
      }
    });
    inflightRef.current = run.catch(() => ({ ok: false, counted: null }));
    return run;
  }, [applyLines, sessionId, syncDirty]);

  const scheduleSave = useCallback(() => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void flush();
    }, SAVE_DEBOUNCE_MS);
  }, [flush]);

  // Leaving the view (nav, Review, Dashboard): push anything still queued.
  useEffect(
    () => () => {
      if (pendingRef.current.size > 0) void flush();
    },
    [flush],
  );

  function setValue(productId: string, text: string) {
    const next = { ...editsRef.current, [productId]: text };
    editsRef.current = next;
    setEdits(next);
    pendingRef.current.set(productId, text);
    syncDirty();
    setSaveState('idle');
    setNotFound(null);
    scheduleSave();
  }

  function displayValue(it: WorksheetItem): string {
    const local = edits[it.product_id];
    if (local !== undefined) return local;
    return it.counted_qty == null ? '' : String(it.counted_qty);
  }

  function step(it: WorksheetItem, delta: number) {
    const current = parseCounted(displayValue(it)) ?? 0;
    setValue(it.product_id, String(Math.round(Math.max(0, current + delta) * 1000) / 1000));
  }

  function focusRow(productId: string) {
    const el = inputRefs.current[productId];
    el?.focus();
    el?.select();
  }

  function flashScanHit(productId: string) {
    setHighlightId(productId);
    if (highlightTimerRef.current != null) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => {
      highlightTimerRef.current = null;
      setHighlightId((h) => (h === productId ? null : h));
    }, 1200);
    inputRefs.current[productId]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function focusNext(currentId: string) {
    const idx = items.findIndex((i) => i.product_id === currentId);
    const next = idx >= 0 ? items[idx + 1] : undefined;
    if (next) focusRow(next.product_id);
  }

  /* ── search / barcode ──────────────────────────────────────── */

  /**
   * Barcode Enter (USB scanner): exact barcode match among count products →
   * counted qty +1, persist via autosave, clear field, highlight row.
   * Name search Enter still focuses a single match.
   */
  async function onSearchEnter() {
    const q = search.trim();
    setNotFound(null);
    if (!q || notDraft) return;

    if (/^\d{4,}$/.test(q)) {
      try {
        let item: WorksheetItem | undefined = items.find((i) => (i.barcode ?? '') === q);

        if (!item) {
          const params = new URLSearchParams({
            filter: 'all',
            page: '1',
            pageSize: '100',
            q,
          });
          const r = await apiGet<WorksheetResponse>(
            `/stock/counts/${encodeURIComponent(sessionId)}/items?${params}`,
          );
          if (!r.ok) throw new Error('lookup failed');
          const rows = r.items ?? [];
          item = rows.find((i) => (i.barcode ?? '') === q);
          if (!item) {
            // Exact barcode miss (soft LIKE noise): resolve via catalog, then match product id.
            try {
              const cat = await apiGet<{ ok: boolean; product?: { id: string } }>(
                `/catalog/lookup?barcode=${encodeURIComponent(q)}`,
              );
              const id = cat.product?.id;
              if (id) item = rows.find((i) => i.product_id === id);
            } catch {
              /* treat as not found below */
            }
          }
        }

        if (!item) {
          setNotFound(q);
          searchRef.current?.focus();
          return;
        }

        const local = editsRef.current[item.product_id];
        const current =
          local !== undefined ? (parseCounted(local) ?? 0) : (item.counted_qty ?? 0);
        setValue(item.product_id, String(current + 1));

        // Clear scan field for the next scan; filter worksheet to this barcode so the row is visible.
        skipSearchSyncRef.current = true;
        setSearch('');
        const alreadyShowing =
          filter === 'all' &&
          query === q &&
          items.some((i) => i.product_id === item!.product_id);
        if (alreadyShowing) {
          flashScanHit(item.product_id);
          searchRef.current?.focus();
        } else {
          focusAfterLoadRef.current = { productId: item.product_id, mode: 'scan' };
          setFilter('all');
          setPage(1);
          setQuery(q);
        }
      } catch {
        setNotFound(q);
        searchRef.current?.focus();
      }
      return;
    }

    if (query === q && items.length === 1) focusRow(items[0].product_id);
  }

  /* ── actions ───────────────────────────────────────────────── */

  const localCounted = Object.values(edits).some((v) => v.trim() !== '');
  const canReview = (progress.counted > 0 || localCounted) && !notDraft;

  async function saveDraft() {
    setBusy(true);
    const r = await flush();
    setBusy(false);
    if (r.ok) onDashboard(t('stockCountDraftSaved'));
  }

  async function goReview() {
    setBusy(true);
    const r = await flush();
    setBusy(false);
    if (!r.ok) return;
    const counted = r.counted ?? progress.counted;
    if (counted === 0) {
      setError('nothing_to_post');
      return;
    }
    onReview();
  }

  async function doCancel() {
    setBusy(true);
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    pendingRef.current.clear();
    await inflightRef.current;
    syncDirty();
    try {
      const r = await apiPostRaw<{ ok: boolean; error?: string }>(
        `/stock/counts/${encodeURIComponent(sessionId)}/cancel`,
        {},
      );
      if (!r.ok || !r.json?.ok) {
        setError(r.json?.error ?? 'stock_count_failed');
        setConfirmCancel(false);
        return;
      }
      dirtyRef.current = false;
      setConfirmCancel(false);
      onDashboard(t('stockCountCancelled'));
    } catch {
      setError('stock_count_failed');
      setConfirmCancel(false);
    } finally {
      setBusy(false);
    }
  }

  const pct = progress.total > 0 ? Math.min(100, Math.round((progress.counted / progress.total) * 100)) : 0;
  const emptyCatalog = loaded && progress.total === 0;

  return (
    <section className="card stock-count stock-count--exec">
      <header className="stock-count__head stock-count__head--exec">
        <div className="stock-count__head-main">
          <h2 className="stock-count__title">{t('stockCountInProgress')}</h2>
          <div className="stock-count-progress">
            <p className="stock-count-progress__label">
              {fillNodes(t('stockCountProgress'), {
                x: <Num className="stock-count-progress__num">{progress.counted}</Num>,
                y: <Num>{progress.total}</Num>,
              })}
              <span className="muted stock-count-progress__save" role="status" aria-live="polite">
                {saveState === 'saving'
                  ? t('stockCountSaving')
                  : saveState === 'saved'
                    ? t('stockCountSaved')
                    : ''}
              </span>
            </p>
            <div
              className="stock-count-progress__bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.counted}
              aria-label={t('stockCountItemsCounted')}
            >
              <span style={{ inlineSize: `${pct}%` }} />
            </div>
          </div>
        </div>
        <div className="stock-count__head-actions">
          {fromReview ? (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy}
              onClick={() => void goReview()}
            >
              {t('stockCountBackToReview')}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={() => void saveDraft()}
          >
            {t('stockCountSaveDraft')}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--danger"
            disabled={busy || notDraft}
            onClick={() => setConfirmCancel(true)}
          >
            {t('stockCountCancelCount')}
          </button>
        </div>
      </header>

      {error ? (
        <p className="form-error" role="alert">
          {translateError(t, error)}
        </p>
      ) : null}
      {notDraft ? (
        <div className="form-error stock-count__notice" role="alert">
          <span>{t('stockCountNotDraft')}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => onDashboard()}>
            {t('stockCountBackToDashboard')}
          </button>
        </div>
      ) : null}

      {emptyCatalog ? (
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
      ) : (
        <>
          <div className="catalog__toolbar stock-count__toolbar">
            <div className="catalog-search field">
              <label htmlFor="stock-count-search" className="visually-hidden">
                {t('stockCountSearch')}
              </label>
              <input
                id="stock-count-search"
                ref={searchRef}
                className="catalog-search__input"
                type="search"
                autoComplete="off"
                placeholder={t('stockCountSearch')}
                value={search}
                aria-invalid={notFound ? true : undefined}
                aria-describedby={notFound ? 'stock-count-not-found' : undefined}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setNotFound(null);
                  setPage(1);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void onSearchEnter();
                  }
                }}
              />
              {notFound ? (
                <span id="stock-count-not-found" className="form-error stock-count__not-found">
                  {fillNodes(t('stockCountNotFound'), { code: <Num>{notFound}</Num> })}
                </span>
              ) : null}
            </div>
            <div className="settings-tabs stock-count-tabs" role="tablist" aria-label={t('stockCountTitle')}>
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  className={`settings-tab${filter === f.id ? ' is-active' : ''}`}
                  aria-selected={filter === f.id}
                  onClick={() => {
                    setFilter(f.id);
                    setPage(1);
                    if (f.id === 'all') {
                      setSearch('');
                      setQuery('');
                    }
                  }}
                >
                  {t(f.key)}
                </button>
              ))}
            </div>
          </div>

          {!loaded ? (
            <p className="muted catalog-empty" role="status">
              {t('loading')}
            </p>
          ) : items.length === 0 ? (
            <p className="muted catalog-empty" role="status">
              {query
                ? t('catalogNoMatches')
                : filter === 'uncounted'
                  ? t('stockCountAllCounted')
                  : t('stockCountNoneCounted')}
            </p>
          ) : (
            <>
              <p className="catalog-table-count muted">
                {t('catalogShowing')
                  .replace('{from}', String((page - 1) * PAGE_SIZE + 1))
                  .replace('{to}', String((page - 1) * PAGE_SIZE + items.length))
                  .replace('{total}', String(total))}
              </p>
              <div className="catalog-table-wrap">
                <table className="catalog-table stock-count-table">
                  <caption className="visually-hidden">{t('stockCountInProgress')}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="catalog-table__col-product">
                        {t('catalogColProduct')}
                      </th>
                      <th scope="col" className="catalog-table__num">
                        {t('stockCountSystemQty')}
                      </th>
                      <th scope="col" className="stock-count-table__count-col">
                        {t('stockCountCounted')}
                      </th>
                      <th scope="col">{t('stockCountColStatus')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => {
                      const raw = displayValue(it);
                      const value = parseCounted(raw);
                      const isCounted = value != null;
                      const system = it.system_qty_snapshot ?? it.qty_on_hand;
                      return (
                        <tr
                          key={it.product_id}
                          className={[
                            isCounted ? 'is-counted' : '',
                            highlightId === it.product_id ? 'is-scan-hit' : '',
                          ]
                            .filter(Boolean)
                            .join(' ') || undefined}
                        >
                          <td className="catalog-table__col-product">
                            <ProductCell
                              name={it.name}
                              nameUr={it.name_ur}
                              showUr={locale === 'ur'}
                              barcode={it.barcode}
                              barcodeLabel={t('barcode')}
                            />
                          </td>
                          <td className="catalog-table__num">
                            <Num>{system}</Num>
                          </td>
                          <td className="stock-count-table__count-col">
                            <div className="stock-count-stepper">
                              <button
                                type="button"
                                className="stock-count-stepper__btn"
                                aria-label={`−1 ${it.name}`}
                                disabled={notDraft || value == null || value === 0}
                                onClick={() => step(it, -1)}
                              >
                                <Num>−1</Num>
                              </button>
                              <MoneyInput
                                maxDecimals={3}
                                whole={!allowsFraction(it.unit_label ?? 'piece')}
                                className="stock-count-stepper__input"
                                aria-label={`${t('stockCountCounted')}: ${it.name}`}
                                value={raw}
                                disabled={notDraft}
                                ref={(el) => {
                                  inputRefs.current[it.product_id] = el;
                                }}
                                onValueChange={(v) => setValue(it.product_id, v)}
                                onBlur={() => {
                                  if (pendingRef.current.has(it.product_id)) void flush();
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    focusNext(it.product_id);
                                  }
                                }}
                              />
                              {STEPS.map((n) => (
                                <button
                                  key={n}
                                  type="button"
                                  className="stock-count-stepper__btn"
                                  aria-label={`+${n} ${it.name}`}
                                  disabled={notDraft}
                                  onClick={() => step(it, n)}
                                >
                                  <Num>+{n}</Num>
                                </button>
                              ))}
                            </div>
                          </td>
                          <td>
                            <span
                              className={`stock-count-pill${isCounted ? ' stock-count-pill--done' : ''}`}
                            >
                              {isCounted ? <span aria-hidden="true">✓</span> : null}
                              {isCounted ? t('stockCountStatusCounted') : t('stockCountStatusNotCounted')}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager
                page={page}
                pageSize={PAGE_SIZE}
                total={total}
                disabled={busy}
                onPage={(p) => {
                  void flush();
                  setPage(p);
                }}
              />
            </>
          )}
        </>
      )}

      <div className="stock-count-sticky">
        <p className="muted stock-count-sticky__hint">
          {fillNodes(t('stockCountProgress'), {
            x: <Num>{progress.counted}</Num>,
            y: <Num>{progress.total}</Num>,
          })}
        </p>
        <button
          type="button"
          className="btn btn--teal stock-count-sticky__cta"
          disabled={busy || !canReview}
          onClick={() => void goReview()}
        >
          {t('stockCountReviewSubmit')}
        </button>
      </div>

      {confirmCancel ? (
        <ConfirmModal
          title={t('stockCountCancelTitle')}
          message={t('stockCountCancelBody')}
          confirmLabel={t('stockCountCancelCount')}
          cancelLabel={t('cancel')}
          busy={busy}
          onConfirm={() => void doCancel()}
          onCancel={() => {
            if (!busy) setConfirmCancel(false);
          }}
        />
      ) : null}
    </section>
  );
}
