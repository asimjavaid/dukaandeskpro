import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { UrHint, useI18n } from '../../i18n';
import { apiGetBlob, apiGetRaw, apiPostRaw, saveBlob } from '../../lib/api';
import { formatRsShort } from '../../lib/money';
import { ConfirmModal } from '../shared/ConfirmModal';
import { PageHeader } from '../shared/PageHeader';
import { OpeningSummary } from './OpeningSummary';
import { OsRow } from './OsRow';
import {
  type OsBatch,
  type OsBatchFull,
  type OsDraft,
  type OsImport,
  type OsItem,
  type OsList,
  type OsPreview,
  type OsTotals,
  fileToBase64,
  fmtNum,
  fmtQty,
  importErrorText,
} from './openingModel';

type Filter = 'all' | 'todo' | 'done';
type Flash = { kind: 'ok' | 'err'; text: string } | null;

const isEntered = (d: OsDraft | null | undefined) => !!d && d.qty != null && d.qty > 0;

function errCode(json: unknown): string {
  const j = json as { error?: string; message?: { error?: string } | string } | null;
  if (j?.error) return j.error;
  if (j?.message && typeof j.message === 'object' && j.message.error) return j.message.error;
  return 'errorGeneric';
}

/** Inventory › Opening stock: enter what is on the shelves today (qty + cost), then post it as one batch. Owner only. */
export function OpeningStockShell({ displayName }: { displayName: string }) {
  const { t } = useI18n();
  const [items, setItems] = useState<OsItem[]>([]);
  const [totals, setTotals] = useState<OsTotals | null>(null);
  const [batches, setBatches] = useState<OsBatch[]>([]);
  const [gen, setGen] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<'entry' | 'summary'>('entry');
  const [summaryId, setSummaryId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [entered, setEntered] = useState<Set<string>>(new Set());
  const [snap, setSnap] = useState<Set<string>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const [busy, setBusy] = useState(false);
  const [imp, setImp] = useState<{ data: OsImport; file: string; name: string } | null>(null);
  const [impTab, setImpTab] = useState<'matched' | 'unmatched' | 'errors'>('matched');
  const [preview, setPreview] = useState<OsPreview | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (opts?: { pickView?: boolean }) => {
    const r = await apiGetRaw<OsList>('/opening-stock');
    if (r.status !== 200 || !r.json) {
      setFlash({ kind: 'err', text: t('errorGeneric') });
      setLoaded(true);
      return null;
    }
    const L = r.json;
    setItems(L.items);
    setTotals(L.totals);
    setBatches(L.batches);
    const e = new Set(L.items.filter((i) => isEntered(i.draft)).map((i) => i.id));
    setEntered(e);
    setSnap(e);
    setGen((g) => g + 1);
    setLoaded(true);
    if (opts?.pickView) {
      const live = L.batches.find((b) => !b.undone_at);
      if (live && L.draft_count === 0) {
        setView('summary');
        setSummaryId(live.id);
      }
    }
    return L;
  }, [t]);

  useEffect(() => {
    void load({ pickView: true });
  }, [load]);

  useEffect(() => {
    if (!focusId) return;
    const id = focusId;
    const h = window.requestAnimationFrame(() => {
      const el = document.getElementById(`os-q-${id}`) as HTMLInputElement | null;
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.focus();
        el.select();
      }
      setFocusId(null);
    });
    return () => window.cancelAnimationFrame(h);
  }, [focusId]);

  const onSaved = useCallback((id: string, draft: OsDraft | null, tt: OsTotals) => {
    setTotals(tt);
    setEntered((prev) => {
      const has = prev.has(id);
      const now = isEntered(draft);
      if (has === now) return prev;
      const n = new Set(prev);
      if (now) n.add(id);
      else n.delete(id);
      return n;
    });
  }, []);

  const byCode = useMemo(() => {
    const m = new Map<string, OsItem>();
    for (const i of items) {
      if (i.barcode) m.set(i.barcode, i);
      for (const c of i.extra_barcodes) m.set(c, i);
    }
    return m;
  }, [items]);

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) => {
      if (filter === 'done' && !snap.has(i.id)) return false;
      if (filter === 'todo' && snap.has(i.id)) return false;
      if (!s) return true;
      return i.name.toLowerCase().includes(s) || (i.barcode ?? '').includes(s) || i.extra_barcodes.some((c) => c.includes(s));
    });
  }, [items, filter, snap, q]);

  function pickFilter(f: Filter) {
    setSnap(new Set(entered));
    setFilter(f);
  }

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setQ('');
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = q.trim();
    if (!code) return;
    const hit = byCode.get(code);
    if (hit) {
      setQ('');
      if (filter !== 'all') pickFilter('all');
      setFocusId(hit.id);
      setFlash(null);
      return;
    }
    if (visible.length > 0) {
      setFocusId(visible[0].id);
      return;
    }
    if (/^\d{5,}$/.test(code)) setFlash({ kind: 'err', text: t('osNotFound').replace('{code}', code) });
  }

  function onTableKey(e: KeyboardEvent<HTMLTableElement>) {
    if (e.key !== 'Enter') return;
    const el = e.target as HTMLElement;
    if (!(el instanceof HTMLInputElement) || !el.hasAttribute('data-os-nav')) return;
    e.preventDefault();
    const all = Array.from(tableRef.current?.querySelectorAll<HTMLInputElement>('input[data-os-nav]') ?? []);
    const next = all[all.indexOf(el) + 1];
    if (next) {
      next.focus();
      next.select();
    } else {
      searchRef.current?.focus();
    }
  }

  async function downloadTemplate() {
    try {
      const { blob, filename } = await apiGetBlob('/opening-stock/template.xlsx');
      saveBlob(blob, filename ?? 'opening-stock.xlsx');
    } catch {
      setFlash({ kind: 'err', text: t('errorGeneric') });
    }
  }

  async function onFile(f: File | undefined) {
    if (fileRef.current) fileRef.current.value = '';
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) {
      setFlash({ kind: 'err', text: t('osExcelOnly') });
      return;
    }
    setBusy(true);
    try {
      const file = await fileToBase64(f);
      const r = await apiPostRaw<OsImport>('/opening-stock/import', { fileBase64: file, apply: false });
      if (!r.ok || !r.json?.ok) {
        setFlash({ kind: 'err', text: importErrorText(errCode(r.json), t) });
        return;
      }
      setImp({ data: r.json, file, name: f.name });
      setImpTab(r.json.matched.length ? 'matched' : r.json.errors.length ? 'errors' : 'unmatched');
      setFlash(null);
    } finally {
      setBusy(false);
    }
  }

  async function applyImport() {
    if (!imp) return;
    setBusy(true);
    try {
      const r = await apiPostRaw<OsImport>('/opening-stock/import', { fileBase64: imp.file, apply: true });
      if (!r.ok || !r.json?.ok) {
        setFlash({ kind: 'err', text: importErrorText(errCode(r.json), t) });
        return;
      }
      const n = r.json.matched.length;
      setImp(null);
      await load();
      setFlash({ kind: 'ok', text: t('osFilled').replace('{n}', String(n)) });
    } finally {
      setBusy(false);
    }
  }

  async function openPost() {
    // Let a row that is still typing save first.
    (document.activeElement as HTMLElement | null)?.blur();
    await new Promise((res) => window.setTimeout(res, 250));
    const r = await apiGetRaw<OsPreview>('/opening-stock/post-preview');
    if (r.status !== 200 || !r.json) {
      setFlash({ kind: 'err', text: t('errorGeneric') });
      return;
    }
    if (r.json.items === 0) {
      setFlash({ kind: 'err', text: t('osErrNothing') });
      return;
    }
    setPreview(r.json);
  }

  async function doPost() {
    setBusy(true);
    try {
      const r = await apiPostRaw<{ ok: boolean; batch: OsBatchFull }>('/opening-stock/post', { confirm: true });
      if (!r.ok || !r.json?.ok) {
        setFlash({ kind: 'err', text: importErrorText(errCode(r.json), t) });
        return;
      }
      setPreview(null);
      await load();
      setSummaryId(r.json.batch.id);
      setView('summary');
      setFlash({ kind: 'ok', text: t('osPostedFlash').replace('{n}', String(r.json.batch.number)) });
    } finally {
      setBusy(false);
    }
  }

  const draftCount = entered.size;
  const title = (
    <>
      {t('osTitle')}
      <UrHint k="osTitle" />
    </>
  );

  if (view === 'summary' && summaryId) {
    return (
      <div className="card pl os">
        <PageHeader title={title} subtitle={displayName} />
        {flash ? <p className={`os-flash os-flash--${flash.kind}`} role="status">{flash.text}</p> : null}
        <OpeningSummary
          batches={batches}
          selectedId={summaryId}
          draftCount={draftCount}
          onSelect={setSummaryId}
          onAddMore={() => {
            setFlash(null);
            setView('entry');
          }}
          onUndone={async (n) => {
            const L = await load();
            setFlash({ kind: 'ok', text: t('osUndoneFlash').replace('{n}', String(n)) });
            const live = L?.batches.find((b) => !b.undone_at);
            if (!live) setView('entry');
          }}
          onError={(code) => setFlash({ kind: 'err', text: importErrorText(code, t) })}
        />
      </div>
    );
  }

  const tq = totals;
  const qtyText = tq
    ? [tq.qty_pieces ? `${fmtNum(tq.qty_pieces)} pcs` : '', tq.qty_kg ? `${fmtNum(tq.qty_kg, true)} kg` : ''].filter(Boolean).join(' · ') || '0'
    : '0';

  return (
    <div className="card pl os">
      <PageHeader
        title={title}
        subtitle={displayName}
        actions={
          batches.length ? (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setSummaryId((batches.find((b) => !b.undone_at) ?? batches[0]).id);
                setView('summary');
              }}
            >
              {t('osPosted')} ({batches.filter((b) => !b.undone_at).length})
            </button>
          ) : null
        }
      />
      <section className="purchases-card pl-card os-card">
        <div className="pl-addbar os-bar">
          <div className="pl-addbar__search">
            <input
              id="os-search"
              ref={searchRef}
              className="os-search"
              type="search"
              autoComplete="off"
              placeholder={t('osSearch')}
              aria-label={t('osSearch')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onSearchKey}
            />
          </div>
          <div className="os-filters" role="group">
            {(
              [
                ['all', 'osFilterAll', items.length],
                ['todo', 'osFilterTodo', items.length - entered.size],
                ['done', 'osFilterDone', entered.size],
              ] as const
            ).map(([k, label, n]) => (
              <button key={k} type="button" className={`chip${filter === k ? ' is-active' : ''}`} aria-pressed={filter === k} onClick={() => pickFilter(k)}>
                {t(label)} <span className="os-count ltr-isolate">{fmtNum(n)}</span>
              </button>
            ))}
          </div>
          <div className="pl-tools">
            <button type="button" className="btn btn--ghost" onClick={() => void downloadTemplate()}>
              {t('osDownloadExcel')}
            </button>
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
              {t('osFillExcel')}
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </div>
        </div>
        {flash ? <p className={`os-flash os-flash--${flash.kind}`} role="status">{flash.text}</p> : null}
        {loaded ? (
          visible.length ? (
            <div className="os-table-wrap">
            <table ref={tableRef} className="catalog-table po-table pl-table os-table" onKeyDown={onTableKey}>
              <colgroup>
                <col className="os-col-name" />
                <col className="os-col-unit" />
                <col className="os-col-qty" />
                <col className="os-col-cost" />
                <col className="os-col-value" />
                <col className="os-col-price" />
                <col className="os-col-state" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" className="pl-c-name">{t('osColProduct')}</th>
                  <th scope="col">{t('osColUnit')}</th>
                  <th scope="col" className="catalog-table__num">{t('osColQty')}</th>
                  <th scope="col" className="catalog-table__num">{t('osColCost')}</th>
                  <th scope="col" className="catalog-table__num">{t('osColValue')}</th>
                  <th scope="col" className="catalog-table__num">{t('osColPrice')}</th>
                  <th scope="col"><span className="visually-hidden">{t('osSaved')}</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((i) => (
                  <OsRow key={`${i.id}-${gen}`} item={i} onSaved={onSaved} />
                ))}
              </tbody>
            </table>
            </div>
          ) : (
            <p className="muted os-empty">{t('osNoRows')}</p>
          )
        ) : null}
      </section>
      <div className="os-foot">
        <dl className="os-totals">
          <div>
            <dt>{t('osEntered')}</dt>
            <dd className="ltr-isolate" data-os-total="items">{fmtNum(tq?.entered ?? 0)}</dd>
          </div>
          <div>
            <dt>{t('osTotalQty')}</dt>
            <dd className="ltr-isolate" data-os-total="qty">{qtyText}</dd>
          </div>
          <div>
            <dt>{t('osTotalValue')}</dt>
            <dd className="ltr-isolate dd-money" data-os-total="value">{formatRsShort(tq?.value_paisa ?? 0)}</dd>
          </div>
        </dl>
        <button type="button" className="btn btn--teal os-post" disabled={busy || !(tq?.entered ?? 0)} onClick={() => void openPost()}>
          {t('osPost')}
        </button>
      </div>

      {imp ? (
        <ConfirmModal
          wide
          tone="primary"
          title={t('osPreviewTitle')}
          message={t('osPreviewMsg')
            .replace('{matched}', String(imp.data.matched.length))
            .replace('{unmatched}', String(imp.data.unmatched.length))
            .replace('{errors}', String(imp.data.errors.length))}
          confirmLabel={t('osApply').replace('{n}', String(imp.data.matched.length))}
          cancelLabel={t('osCancel')}
          confirmDisabled={imp.data.matched.length === 0}
          busy={busy}
          onConfirm={() => void applyImport()}
          onCancel={() => setImp(null)}
        >
          <div className="os-imp">
            <p className="muted os-imp__file">{imp.name}</p>
            <div className="os-filters" role="tablist">
              {(
                [
                  ['matched', 'osMatched', imp.data.matched.length],
                  ['unmatched', 'osUnmatched', imp.data.unmatched.length],
                  ['errors', 'osErrors', imp.data.errors.length],
                ] as const
              ).map(([k, label, n]) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={impTab === k}
                  className={`chip${impTab === k ? ' is-active' : ''}${k === 'errors' && n ? ' chip--danger' : ''}${k === 'unmatched' && n ? ' chip--warn' : ''}`}
                  onClick={() => setImpTab(k)}
                >
                  {t(label)} <span className="os-count">{n}</span>
                </button>
              ))}
            </div>
            <div className="os-imp__scroll">
              <table className="os-mini">
                {impTab === 'matched' ? (
                  <>
                    <thead>
                      <tr>
                        <th scope="col" className="catalog-table__num">{t('osRow')}</th>
                        <th scope="col" className="pl-c-name">{t('osColProduct')}</th>
                        <th scope="col" className="catalog-table__num">{t('osColQty')}</th>
                        <th scope="col" className="catalog-table__num">{t('osColCost')}</th>
                        <th scope="col" />
                      </tr>
                    </thead>
                    <tbody>
                      {imp.data.matched.map((m) => (
                        <tr key={m.row}>
                          <td className="catalog-table__num muted">{m.row}</td>
                          <td className="pl-c-name" dir="auto">{m.name}</td>
                          <td className="catalog-table__num ltr-isolate">
                            {m.mode === 'pack' && m.packs != null && m.pack_units != null ? `${fmtNum(m.packs)} × ${fmtNum(m.pack_units)} = ` : ''}
                            {m.qty != null ? fmtQty(m.qty, m.unit_label, m.unit_label === 'kg') : '—'}
                          </td>
                          <td className="catalog-table__num ltr-isolate">{m.cost_paisa != null ? formatRsShort(m.cost_paisa) : '—'}</td>
                          <td>
                            <span className={`chip ${m.change === 'new' ? 'chip--success' : m.change === 'update' ? 'chip--info' : 'chip--neutral'}`}>
                              {t(m.change === 'new' ? 'osChangeNew' : m.change === 'update' ? 'osChangeUpdate' : 'osChangeSame')}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                ) : impTab === 'unmatched' ? (
                  <>
                    <thead>
                      <tr>
                        <th scope="col" className="catalog-table__num">{t('osRow')}</th>
                        <th scope="col" className="pl-c-name">{t('osColProduct')}</th>
                        <th scope="col">{t('osBarcode')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {imp.data.unmatched.map((m) => (
                        <tr key={m.row}>
                          <td className="catalog-table__num muted">{m.row}</td>
                          <td className="pl-c-name" dir="auto">{m.name || '—'}</td>
                          <td className="ltr-isolate">{m.barcode || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                ) : (
                  <>
                    <thead>
                      <tr>
                        <th scope="col" className="catalog-table__num">{t('osRow')}</th>
                        <th scope="col" className="pl-c-name">{t('osColProduct')}</th>
                        <th scope="col">{t('osErrors')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {imp.data.errors.map((m) => (
                        <tr key={m.row}>
                          <td className="catalog-table__num muted">{m.row}</td>
                          <td className="pl-c-name" dir="auto">{m.name || '—'}</td>
                          <td className="os-err">{importErrorText(m.error, t)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                )}
              </table>
            </div>
          </div>
        </ConfirmModal>
      ) : null}

      {preview ? (
        <ConfirmModal
          wide
          tone="primary"
          title={t('osConfirmTitle')}
          message={t('osConfirmMsg').replace('{n}', fmtNum(preview.items)).replace('{value}', formatRsShort(preview.total_value_paisa))}
          confirmLabel={busy ? t('osPosting') : t('osConfirmBtn')}
          cancelLabel={t('osCancel')}
          busy={busy}
          onConfirm={() => void doPost()}
          onCancel={() => setPreview(null)}
        >
          {preview.no_cost.length ? <p className="os-warn-text">{t('osNoCost').replace('{n}', String(preview.no_cost.length))}</p> : null}
          {preview.added.length ? (
            <div className="os-imp">
              <p className="os-imp__lead">{t('osConfirmAdded')}</p>
              <div className="os-imp__scroll">
                <table className="os-mini">
                  <thead>
                    <tr>
                      <th scope="col" className="pl-c-name">{t('osColProduct')}</th>
                      <th scope="col" className="catalog-table__num">{t('osNow')}</th>
                      <th scope="col" className="catalog-table__num">{t('osAdd')}</th>
                      <th scope="col" className="catalog-table__num">{t('osAfter')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.added.map((a) => {
                      const frac = a.unit_label === 'kg';
                      return (
                        <tr key={a.product_id}>
                          <td className="pl-c-name" dir="auto">{a.name}</td>
                          <td className="catalog-table__num ltr-isolate">{fmtQty(a.qty_on_hand, a.unit_label, frac)}</td>
                          <td className="catalog-table__num ltr-isolate">+{fmtQty(a.qty, a.unit_label, frac)}</td>
                          <td className="catalog-table__num ltr-isolate">{fmtQty(a.qty_after, a.unit_label, frac)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </ConfirmModal>
      ) : null}
    </div>
  );
}
