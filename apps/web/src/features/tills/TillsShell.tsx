import { useCallback, useEffect, useState } from 'react';
import { UrHint, translateError, useI18n } from '../../i18n';
import { apiGet, apiPostRaw } from '../../lib/api';
import { formatRsShort } from '../../lib/money';
import { ConfirmModal } from '../shared/ConfirmModal';
import { PageHeader } from '../shared/PageHeader';
import { fmtDateTime } from '../shared/dates';
import { formatQty } from '../shared/productUnits';

export type TillView = {
  id: string;
  code: number;
  label: string;
  name: string;
  kind: 'main' | 'remote';
  active: boolean;
  paired: boolean;
  pairing: boolean;
  pair_expires_at: string | null;
  device_name: string | null;
  last_seen_at: string | null;
  online: boolean;
  next_bill_no: number;
  shift: { id: string; opened_at: string; opened_by_name: string | null; opening_float_paisa: number } | null;
  today_sales: number;
  today_total_paisa: number;
};

type List = { ok: boolean; mode: 'main_till' | 'server_only'; limit: number; used: number; tills: TillView[] };
type Pairing = { till: TillView; code: string; expiresAt: string };
type Ask = { kind: 'off' | 'on' | 'code' | 'mode'; till?: TillView } | null;

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (d.toDateString() === new Date().toDateString()) {
    return d.toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  }
  return fmtDateTime(d);
}

function useClock(on: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [on]);
  return now;
}

/** Owner / manager: every till in the shop, its shift and status. Keys: ↑↓ pick, Enter shift, N add, R rename, C code. */
export function TillsShell({
  isOwner,
  onOpenTill,
}: {
  isOwner: boolean;
  onOpenTill: (tillId: string) => void;
}) {
  const { t } = useI18n();
  const [list, setList] = useState<List | null>(null);
  const [here, setHere] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [renaming, setRenaming] = useState<TillView | null>(null);
  const [nameText, setNameText] = useState('');
  const [ask, setAsk] = useState<Ask>(null);
  const now = useClock(!!pairing);

  const load = useCallback(async () => {
    const r = await apiGet<List>('/tills');
    setList(r);
    setSel((i) => Math.min(i, Math.max(0, (r.tills?.length ?? 1) - 1)));
  }, []);

  useEffect(() => {
    load().catch(() => setError('error_generic'));
    apiGet<{ till: { id: string } | null }>('/tills/me')
      .then((m) => setHere(m.till?.id ?? null))
      .catch(() => undefined);
    const id = window.setInterval(() => void load().catch(() => undefined), 10_000);
    return () => window.clearInterval(id);
  }, [load]);

  async function post<T>(path: string, body?: unknown): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      const r = await apiPostRaw<{ ok: boolean; error?: string; message?: { error?: string } } & T>(path, body ?? {});
      if (!r.json?.ok) {
        setError(r.json?.error ?? r.json?.message?.error ?? 'error_generic');
        return null;
      }
      return r.json as T;
    } finally {
      setBusy(false);
    }
  }

  async function addTill() {
    const r = await post<{ till: TillView; pairCode: string; pairExpiresAt: string }>('/tills', {});
    if (r) {
      setPairing({ till: r.till, code: r.pairCode, expiresAt: r.pairExpiresAt });
      await load();
    }
  }

  async function newCode(till: TillView) {
    const r = await post<{ till: TillView; pairCode: string; pairExpiresAt: string }>(`/tills/${encodeURIComponent(till.id)}/pair-code`);
    if (r) {
      setPairing({ till: r.till, code: r.pairCode, expiresAt: r.pairExpiresAt });
      await load();
    }
  }

  async function saveName() {
    if (!renaming || !nameText.trim()) return;
    const id = renaming.id;
    setRenaming(null);
    if (await post(`/tills/${encodeURIComponent(id)}`, { name: nameText.trim() })) await load();
  }

  async function confirmAsk() {
    const a = ask;
    setAsk(null);
    if (!a) return;
    if (a.kind === 'code' && a.till) return void newCode(a.till);
    if ((a.kind === 'off' || a.kind === 'on') && a.till) {
      if (await post(`/tills/${encodeURIComponent(a.till.id)}`, { active: a.kind === 'on' })) await load();
      return;
    }
    if (a.kind === 'mode' && list) {
      if (await post('/tills/mode', { mode: list.mode === 'main_till' ? 'server_only' : 'main_till' })) await load();
    }
  }

  const tills = list?.tills ?? [];
  const cur = tills[sel] ?? null;
  const modal = !!(pairing || renaming || ask);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (modal || e.altKey || e.ctrlKey || e.metaKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSel((i) => Math.min(tills.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSel((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter' && cur?.active) {
        e.preventDefault();
        onOpenTill(cur.id);
      } else if (isOwner && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        void addTill();
      } else if (isOwner && (e.key === 'r' || e.key === 'R') && cur) {
        e.preventDefault();
        setNameText(cur.name);
        setRenaming(cur);
      } else if (isOwner && (e.key === 'c' || e.key === 'C') && cur && cur.kind === 'remote' && cur.active) {
        e.preventDefault();
        setAsk({ kind: 'code', till: cur });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const left = pairing ? Math.max(0, Math.floor((Date.parse(pairing.expiresAt) - now) / 1000)) : 0;
  const atLimit = !!list && list.used >= list.limit;

  return (
    <div className="card" data-tills>
      <PageHeader
        title={
          <>
            {t('tillsTitle')}
            <UrHint k="tillsTitle" />
          </>
        }
        actions={
          <>
            {list ? (
              <span className="chip chip--neutral tills-count" data-tills-count>
                {t('tillsUsed').replace('{used}', String(list.used)).replace('{limit}', String(list.limit))}
              </span>
            ) : null}
            {isOwner && list ? (
              <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => setAsk({ kind: 'mode' })} data-tills-mode>
                {list.mode === 'main_till' ? t('tillsModeMain') : t('tillsModeServer')}
              </button>
            ) : null}
            {isOwner ? (
              <button type="button" className="btn btn--teal" disabled={busy || atLimit} onClick={() => void addTill()} data-tills-add>
                {t('tillsAdd')} <kbd className="pos-kbd">N</kbd>
              </button>
            ) : null}
          </>
        }
      />

      {error ? (
        <p className="muted" role="alert" style={{ color: 'var(--danger)' }}>
          {translateError(t, error)}
        </p>
      ) : null}

      <div className="catalog-table-wrap">
        <table className="catalog-table parties-table tills-table" data-tills-table>
          <thead>
            <tr>
              <th scope="col">{t('tillsColTill')}</th>
              <th scope="col" className="catalog-table__col-product">{t('tillsColName')}</th>
              <th scope="col">{t('tillsColStatus')}</th>
              <th scope="col">{t('tillsColShift')}</th>
              <th scope="col" className="catalog-table__num">{t('tillsColToday')}</th>
              <th scope="col">{t('tillsColSeen')}</th>
              <th scope="col" className="parties-table__col-actions">{t('partiesColActions')}</th>
            </tr>
          </thead>
          <tbody>
            {tills.map((x, i) => {
              const status = !x.active
                ? { cls: 'chip--neutral', label: t('tillsOffState') }
                : !x.paired
                  ? { cls: 'chip--warn', label: t('tillsNotPaired') }
                  : x.online || x.id === here
                    ? { cls: 'chip--success', label: t('tillsOnline') }
                    : { cls: 'chip--danger', label: t('tillsOffline') };
              return (
                <tr
                  key={x.id}
                  className={i === sel ? 'is-selected' : ''}
                  data-till-row={x.label}
                  onClick={() => setSel(i)}
                  onDoubleClick={() => x.active && onOpenTill(x.id)}
                >
                  <td>
                    <span className="tills-code ltr-isolate">{x.label}</span>
                  </td>
                  <td className="catalog-table__col-product">
                    <span className="catalog-table__name">{x.name}</span>
                    <span className="catalog-table__meta">
                      {[x.id === here ? t('tillsThisPc') : null, x.device_name].filter(Boolean).join(' · ') || '\u00a0'}
                    </span>
                  </td>
                  <td>
                    <span className={`chip ${status.cls}`}>{status.label}</span>
                  </td>
                  <td>
                    {x.shift ? (
                      <>
                        <span className="chip chip--success">{t('tillOpenNow')}</span>
                        <span className="catalog-table__meta">
                          {[x.shift.opened_by_name, fmtTime(x.shift.opened_at)].filter(Boolean).join(' · ')}
                        </span>
                      </>
                    ) : (
                      <span className="muted">{t('tillsShiftNone')}</span>
                    )}
                  </td>
                  <td className="catalog-table__num">
                    <span className="ltr-isolate">{formatRsShort(x.today_total_paisa)}</span>
                    <span className="catalog-table__meta">{t('tillsBills').replace('{n}', String(x.today_sales))}</span>
                  </td>
                  <td>
                    <span className="ltr-isolate">{x.id === here ? '—' : fmtTime(x.last_seen_at)}</span>
                  </td>
                  <td className="parties-table__col-actions tills-actions">
                    {i !== sel ? null : (
                    <>
                    {x.active ? (
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => onOpenTill(x.id)}>
                        {t('tillsOpenTill')}
                      </button>
                    ) : null}
                    {isOwner ? (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy}
                        onClick={() => {
                          setNameText(x.name);
                          setRenaming(x);
                        }}
                      >
                        {t('tillsRename')}
                      </button>
                    ) : null}
                    {isOwner && x.kind === 'remote' && x.active ? (
                      <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => setAsk({ kind: 'code', till: x })}>
                        {t('tillsNewCode')}
                      </button>
                    ) : null}
                    {isOwner && !(x.kind === 'main' && list?.mode === 'server_only') ? (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy || (!x.active && atLimit)}
                        onClick={() => setAsk({ kind: x.active ? 'off' : 'on', till: x })}
                      >
                        {x.active ? t('tillsTurnOff') : t('tillsTurnOn')}
                      </button>
                    ) : null}
                    </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <StockReview />

      {pairing ? (
        <ConfirmModal
          title={`${pairing.till.label} · ${pairing.till.name}`}
          message=""
          tone="primary"
          confirmLabel={t('close')}
          cancelLabel=""
          onConfirm={() => setPairing(null)}
          onCancel={() => setPairing(null)}
        >
          <div className="tills-pair" data-tills-pair>
            <div className="muted">{t('tillsPairCode')}</div>
            <div className="tills-pair__code ltr-isolate" data-pair-code>
              {pairing.code.slice(0, 3)} {pairing.code.slice(3)}
            </div>
            <div className="muted ltr-isolate">
              {t('tillsPairExpires')} {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
            </div>
          </div>
        </ConfirmModal>
      ) : null}

      {renaming ? (
        <ConfirmModal
          title={t('tillsRenameTitle')}
          message=""
          tone="primary"
          confirmLabel={t('save')}
          cancelLabel={t('cancel')}
          busy={busy}
          confirmDisabled={!nameText.trim()}
          onConfirm={() => void saveName()}
          onCancel={() => setRenaming(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveName();
            }}
          >
            <div className="field">
              <label htmlFor="till-name">{t('tillsColName')}</label>
              <input id="till-name" value={nameText} maxLength={40} autoFocus onChange={(e) => setNameText(e.target.value)} />
            </div>
            <button type="submit" hidden />
          </form>
        </ConfirmModal>
      ) : null}

      {ask ? (
        <ConfirmModal
          title={
            ask.kind === 'mode'
              ? t('tillsModeAsk')
              : ask.kind === 'code'
                ? t('tillsNewCode')
                : ask.kind === 'off'
                  ? t('tillsTurnOff')
                  : t('tillsTurnOn')
          }
          message={
            ask.kind === 'mode'
              ? list?.mode === 'main_till'
                ? t('tillsModeServer')
                : t('tillsModeMain')
              : ask.kind === 'code'
                ? `${ask.till?.label} · ${t('tillsNewCodeAsk')}`
                : ask.kind === 'off'
                  ? `${ask.till?.label} · ${t('tillsTurnOffAsk')}`
                  : `${ask.till?.label} · ${ask.till?.name}`
          }
          tone={ask.kind === 'off' || ask.kind === 'code' ? 'danger' : 'primary'}
          confirmLabel={t('confirm')}
          cancelLabel={t('cancel')}
          busy={busy}
          onConfirm={() => void confirmAsk()}
          onCancel={() => setAsk(null)}
        />
      ) : null}
    </div>
  );
}

type ReviewRow = {
  id: string;
  product_name: string;
  short_id: string | null;
  till_label: string | null;
  qty_sold: number;
  qty_after: number;
  qty_now: number | null;
  created_at: string;
};

/** Sales made offline that took stock below zero: a manager checks and clears them. */
function StockReview() {
  const { t } = useI18n();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await apiGet<{ ok: boolean; items: ReviewRow[] }>('/stock/reviews').catch(() => null);
    if (r?.ok) setRows(r.items);
  }, []);
  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(id);
  }, [load]);
  if (rows.length === 0) return null;
  return (
    <section className="tills-review" data-stock-review>
      <h3>{t('reviewTitle')}</h3>
      {err ? <div className="banner banner--error">{translateError(t, err)}</div> : null}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t('reviewColItem')}</th>
              <th>{t('reviewColBill')}</th>
              <th className="num">{t('reviewColSold')}</th>
              <th className="num">{t('reviewColAfter')}</th>
              <th className="num">{t('reviewColNow')}</th>
              <th />
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.product_name}</td>
                <td className="ltr-isolate">{r.short_id ?? '—'}</td>
                <td className="num ltr-isolate">{formatQty(r.qty_sold)}</td>
                <td className="num ltr-isolate">{formatQty(r.qty_after)}</td>
                <td className="num ltr-isolate">{r.qty_now == null ? '—' : formatQty(r.qty_now)}</td>
                <td className="muted ltr-isolate">{fmtTime(r.created_at)}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={busy}
                    data-review-resolve
                    onClick={async () => {
                      setBusy(true);
                      setErr(null);
                      const res = await apiPostRaw<{ ok: boolean; error?: string }>(`/stock/reviews/${r.id}/resolve`, {});
                      setBusy(false);
                      if (!res.json?.ok) setErr(res.json?.error ?? 'request_failed');
                      void load();
                    }}
                  >
                    {t('reviewResolve')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
