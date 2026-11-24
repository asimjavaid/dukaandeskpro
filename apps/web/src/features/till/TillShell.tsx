import { useCallback, useEffect, useState } from 'react';
import { UrHint, translateError, useI18n } from '../../i18n';
import { apiGet, apiPostRaw } from '../../lib/api';
import { formatRsShort } from '../../lib/money';
import { ConfirmModal } from '../shared/ConfirmModal';
import { EmptyState } from '../shared/EmptyState';
import { MoneyInput } from '../shared/MoneyInput';
import { PageHeader } from '../shared/PageHeader';
import { Pager } from '../shared/Pager';
import { parseMoneyRs } from '../shared/amount';
import { printZReport, type ZLabels } from './printZReport';
import type { TillMove, TillReport, TillShift, TillSummary } from './tillTypes';
import { fmtDateTime } from '../shared/dates';

const PAGE_SIZE = 20;
const formatRs = formatRsShort;

type Current = {
  ok?: boolean;
  error?: string;
  till?: { id: string; label: string; name: string } | null;
  shift: TillShift | null;
  summary: TillSummary | null;
  moves: TillMove[];
  last_counted_paisa: number | null;
};

type History = { shifts: TillShift[]; total: number; page: number; pageSize: number };

type Store = { name: string; widthMm: 58 | 80; printerName: string | null };

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return fmtDateTime(d);
}

function signedRs(paisa: number): string {
  if (paisa === 0) return formatRs(0);
  return `${paisa > 0 ? '+' : '−'}${formatRs(Math.abs(paisa))}`;
}

type TillOpt = { id: string; label: string; name: string; active: boolean };

/** One till's shift. Owner / manager can switch to any till (tillId prop or the T1 T2 … picker). */
export function TillShell({
  displayName,
  supervisor = false,
  tillId: focusTillId = null,
}: {
  displayName: string;
  supervisor?: boolean;
  tillId?: string | null;
}) {
  const { t } = useI18n();
  const [tillOpts, setTillOpts] = useState<TillOpt[]>([]);
  const [tillId, setTillId] = useState<string | null>(focusTillId);
  const q = tillId ? `tillId=${encodeURIComponent(tillId)}` : '';
  const withTill = (body: Record<string, unknown> = {}) => (tillId ? { ...body, tillId } : body);
  const [cur, setCur] = useState<Current | null>(null);
  const [hist, setHist] = useState<History | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [store, setStore] = useState<Store | null>(null);
  const [floatText, setFloatText] = useState('');
  const [moveKind, setMoveKind] = useState<'in' | 'out' | null>(null);
  const [moveAmt, setMoveAmt] = useState('');
  const [moveReason, setMoveReason] = useState('');
  const [undoMove, setUndoMove] = useState<TillMove | null>(null);
  const [closing, setClosing] = useState(false);
  const [countedText, setCountedText] = useState('');
  const [closeNote, setCloseNote] = useState('');

  useEffect(() => {
    if (!supervisor) return;
    apiGet<{ tills?: TillOpt[] }>('/tills')
      .then((r) => setTillOpts((r.tills ?? []).filter((x) => x.active)))
      .catch(() => undefined);
    if (!focusTillId) {
      apiGet<{ till: { id: string } | null }>('/tills/me')
        .then((m) => setTillId((v) => v ?? m.till?.id ?? null))
        .catch(() => undefined);
    }
  }, [supervisor, focusTillId]);

  useEffect(() => {
    if (focusTillId) setTillId(focusTillId);
  }, [focusTillId]);

  // Server-only main PC: no till of its own, start on the first one.
  useEffect(() => {
    if (supervisor && cur?.ok === false && cur.error === 'no_till' && tillOpts.length) {
      setError(null);
      setTillId(tillOpts[0].id);
    }
  }, [supervisor, cur, tillOpts]);

  const refresh = useCallback(async () => {
    const c = await apiGet<Current>(`/cashier/till${q ? `?${q}` : ''}`);
    setCur(c);
    if (c.ok === false && c.error) setError(c.error);
    if (!c.shift && c.last_counted_paisa != null) {
      setFloatText((v) => (v === '' ? String(c.last_counted_paisa! / 100) : v));
    }
  }, [q]);

  const loadHistory = useCallback(async (p: number) => {
    const h = await apiGet<History>(`/cashier/till/shifts?page=${p}&pageSize=${PAGE_SIZE}${q ? `&${q}` : ''}`);
    setHist(h);
  }, [q]);

  useEffect(() => {
    refresh().catch(() => setError('till_unavailable'));
    apiGet<{ store?: { name: string; receipt_width_mm?: number; receipt_printer_name?: string | null } | null }>(
      '/auth/status',
    )
      .then((s) =>
        setStore({
          name: s.store?.name || t('storeNamePlaceholder'),
          widthMm: s.store?.receipt_width_mm === 58 ? 58 : 80,
          printerName: s.store?.receipt_printer_name?.trim() ? s.store.receipt_printer_name.trim() : null,
        }),
      )
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  useEffect(() => {
    loadHistory(page).catch(() => setError('till_unavailable'));
  }, [loadHistory, page]);

  // Live totals while the till is open.
  useEffect(() => {
    if (!cur?.shift) return;
    const id = window.setInterval(() => void refresh().catch(() => undefined), 30_000);
    return () => window.clearInterval(id);
  }, [cur?.shift, refresh]);

  const zLabels: ZLabels = {
    title: t('tillZTitle'),
    opened: t('tillOpened'),
    closed: t('tillClosed'),
    float: t('tillFloat'),
    cashSales: t('tillCashSales'),
    udhaarReceived: t('tillUdhaarReceived'),
    refunds: t('tillRefunds'),
    expenses: t('tillExpenses'),
    cashIn: t('tillCashIn'),
    cashOut: t('tillCashOut'),
    expected: t('tillExpected'),
    counted: t('tillCounted'),
    overShort: t('tillOverShort'),
    sales: t('tillSales'),
    udhaarGiven: t('tillUdhaarGiven'),
    returns: t('tillReturns'),
    moves: t('tillMoves'),
    signature: t('payslipSignature'),
  };

  async function printReport(id: string) {
    const r = await apiGet<TillReport & { ok?: boolean }>(`/cashier/till/shifts/${encodeURIComponent(id)}`);
    if (!r?.shift) return;
    await printZReport(store?.name ?? t('storeNamePlaceholder'), r, zLabels, fmtTime, {
      widthMm: store?.widthMm ?? 80,
      printerName: store?.printerName ?? null,
    });
  }

  async function post(path: string, body?: unknown): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    try {
      const r = await apiPostRaw<{ ok: boolean; error?: string; message?: { error?: string } }>(path, body);
      if (!r.json?.ok) {
        setError(r.json?.error ?? r.json?.message?.error ?? 'error_generic');
        return null;
      }
      return r.json as unknown as Record<string, unknown>;
    } finally {
      setBusy(false);
    }
  }

  async function openTill() {
    const rs = parseMoneyRs(floatText || '0');
    if (rs == null) return;
    if (await post('/cashier/till/open', withTill({ floatRs: rs }))) {
      setFloatText('');
      await refresh();
      await loadHistory(1);
      setPage(1);
    }
  }

  async function saveMove() {
    const rs = parseMoneyRs(moveAmt);
    if (!moveKind || rs == null || rs <= 0) return;
    const kind = moveKind;
    setMoveKind(null);
    if (await post('/cashier/till/moves', withTill({ kind, amountRs: rs, reason: moveReason.trim() || null }))) {
      await refresh();
    }
  }

  async function closeTill() {
    const rs = parseMoneyRs(countedText);
    if (rs == null) return;
    setClosing(false);
    const res = await post('/cashier/till/close', withTill({ countedRs: rs, note: closeNote.trim() || null }));
    if (res) {
      const report = res.report as TillReport | undefined;
      setCountedText('');
      setCloseNote('');
      await refresh();
      await loadHistory(1);
      setPage(1);
      if (report?.shift) void printReport(report.shift.id);
    }
  }

  const shift = cur?.shift ?? null;
  const curTill = cur?.till ?? null;
  const sum = cur?.summary ?? null;
  const countedRs = parseMoneyRs(countedText);
  const previewOverShort = sum && countedRs != null ? Math.round(countedRs * 100) - sum.expected_paisa : null;
  const moveRs = parseMoneyRs(moveAmt);

  const kpi = (label: string, value: string, mod = '') => (
    <div className={`card cashier-kpi till-kpi${mod ? ` ${mod}` : ''}`}>
      <div className="muted" style={{ font: 'var(--type-meta)' }}>
        {label}
      </div>
      <div className="cashier-kpi__value cashier-kpi__value--amount ltr-isolate">{value}</div>
    </div>
  );

  return (
    <div className="card" data-till>
      <PageHeader
        title={
          <>
            {t('tillTitle')}
            <UrHint k="tillTitle" />
            {curTill ? <span className="tills-code till-head-code ltr-isolate"> · {curTill.label} {curTill.name}</span> : null}
          </>
        }
        subtitle={
          shift ? (
            <>
              {t('tillOpenSince')} {fmtTime(shift.opened_at)}
              {shift.opened_by_name ? ` · ${shift.opened_by_name}` : ''}
            </>
          ) : (
            displayName
          )
        }
        actions={
          <>
          {supervisor && tillOpts.length > 1 ? (
            <div className="till-pick" role="group" aria-label={t('tillPick')} data-till-pick>
              {tillOpts.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`btn btn--ghost btn--sm${o.id === (cur?.till?.id ?? tillId) ? ' is-active' : ''}`}
                  title={o.name}
                  onClick={() => {
                    setTillId(o.id);
                    setPage(1);
                    setFloatText('');
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          ) : null}
          {shift ? (
            <>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busy}
                onClick={() => {
                  setMoveAmt('');
                  setMoveReason('');
                  setMoveKind('in');
                }}
                data-till-cash-in
              >
                {t('tillCashIn')}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={busy}
                onClick={() => {
                  setMoveAmt('');
                  setMoveReason('');
                  setMoveKind('out');
                }}
                data-till-cash-out
              >
                {t('tillCashOut')}
              </button>
              <button
                type="button"
                className="btn btn--teal"
                disabled={busy}
                onClick={() => {
                  setCountedText('');
                  setCloseNote('');
                  setClosing(true);
                }}
                data-till-close
              >
                {t('tillClose')}
              </button>
            </>
          ) : null}
          </>
        }
      />

      {error ? (
        <p className="muted" role="alert" style={{ color: 'var(--danger)' }}>
          {error === 'till_unavailable' ? t('errorGeneric') : translateError(t, error)}
        </p>
      ) : null}

      {!cur ? (
        <p className="muted">{t('loading')}</p>
      ) : !shift ? (
        <form
          className="till-open"
          onSubmit={(e) => {
            e.preventDefault();
            void openTill();
          }}
        >
          <div className="field">
            <label htmlFor="till-float">{t('tillFloat')}</label>
            <MoneyInput
              id="till-float"
              value={floatText}
              onValueChange={setFloatText}
              placeholder="0"
              autoFocus
            />
          </div>
          <button type="submit" className="btn btn--teal" disabled={busy || parseMoneyRs(floatText || '0') == null}>
            {t('tillOpen')}
          </button>
        </form>
      ) : sum ? (
        <>
          <div className="cashier-kpis till-kpis">
            {kpi(t('tillExpected'), formatRs(sum.expected_paisa), 'till-kpi--main')}
            {kpi(t('tillFloat'), formatRs(sum.opening_float_paisa))}
            {kpi(t('tillCashSales'), formatRs(sum.cash_sales_paisa))}
            {kpi(t('tillUdhaarReceived'), formatRs(sum.udhaar_received_paisa))}
            {kpi(t('tillRefunds'), formatRs(sum.refunds_cash_paisa))}
            {kpi(t('tillExpenses'), formatRs(sum.expenses_paisa))}
            {kpi(t('tillCashIn'), formatRs(sum.cash_in_paisa))}
            {kpi(t('tillCashOut'), formatRs(sum.cash_out_paisa))}
            {sum.digital_paisa ? kpi(t('tillDigitalShort'), formatRs(sum.digital_paisa)) : null}
          </div>
          {cur.moves.length > 0 ? (
            <section style={{ marginTop: 16 }}>
              <h3 style={{ font: 'var(--type-subtitle)', marginTop: 0 }}>{t('tillMoves')}</h3>
              <div className="catalog-table-wrap">
                <table className="catalog-table parties-table">
                  <thead>
                    <tr>
                      <th scope="col">{t('tillTime')}</th>
                      <th scope="col" className="catalog-table__col-product">
                        {t('tillReason')}
                      </th>
                      <th scope="col" className="catalog-table__num">
                        {t('expenseColAmount')}
                      </th>
                      <th scope="col" className="parties-table__col-actions">
                        {t('partiesColActions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {cur.moves.map((m) => (
                      <tr key={m.id} data-till-move={m.kind}>
                        <td>
                          <span className="ltr-isolate">{fmtTime(m.created_at)}</span>
                        </td>
                        <td className="catalog-table__col-product">
                          <span className="catalog-table__name">
                            {m.kind === 'in' ? t('tillCashIn') : t('tillCashOut')}
                          </span>
                          {m.reason || m.created_by_name ? (
                            <span className="catalog-table__meta">
                              {[m.reason, m.created_by_name].filter(Boolean).join(' · ')}
                            </span>
                          ) : null}
                        </td>
                        <td className="catalog-table__num parties-table__amount">
                          <span className="ltr-isolate">
                            {signedRs(m.kind === 'in' ? m.amount_paisa : -m.amount_paisa)}
                          </span>
                        </td>
                        <td className="parties-table__col-actions">
                          <button
                            type="button"
                            className="btn btn--ghost parties-table__khata"
                            disabled={busy}
                            onClick={() => setUndoMove(m)}
                          >
                            {t('tillUndo')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      <section style={{ marginTop: 24 }}>
        <h3 style={{ font: 'var(--type-subtitle)', marginTop: 0 }}>{t('tillHistory')}</h3>
        {hist && hist.shifts.length === 0 ? (
          <EmptyState title={t("tillNoShifts")} description="" />
        ) : hist ? (
          <>
            <div className="catalog-table-wrap">
              <table className="catalog-table parties-table" data-till-history>
                <thead>
                  <tr>
                    <th scope="col">{t('tillOpened')}</th>
                    <th scope="col">{t('tillClosed')}</th>
                    <th scope="col" className="catalog-table__num">
                      {t('tillFloat')}
                    </th>
                    <th scope="col" className="catalog-table__num">
                      {t('tillExpected')}
                    </th>
                    <th scope="col" className="catalog-table__num">
                      {t('tillCounted')}
                    </th>
                    <th scope="col" className="catalog-table__num">
                      {t('tillOverShort')}
                    </th>
                    <th scope="col" className="parties-table__col-actions">
                      {t('partiesColActions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {hist.shifts.map((s) => {
                    const os = s.over_short_paisa;
                    return (
                      <tr key={s.id}>
                        <td>
                          <span className="ltr-isolate">{fmtTime(s.opened_at)}</span>
                          {s.opened_by_name ? <span className="catalog-table__meta">{s.opened_by_name}</span> : null}
                        </td>
                        <td>
                          {s.closed_at ? (
                            <>
                              <span className="ltr-isolate">{fmtTime(s.closed_at)}</span>
                              {s.closed_by_name ? (
                                <span className="catalog-table__meta">{s.closed_by_name}</span>
                              ) : null}
                            </>
                          ) : (
                            <span className="chip chip--success">{t('tillOpenNow')}</span>
                          )}
                        </td>
                        <td className="catalog-table__num">
                          <span className="ltr-isolate">{formatRs(s.opening_float_paisa)}</span>
                        </td>
                        <td className="catalog-table__num">
                          <span className="ltr-isolate">
                            {s.expected_paisa == null ? '—' : formatRs(s.expected_paisa)}
                          </span>
                        </td>
                        <td className="catalog-table__num">
                          <span className="ltr-isolate">
                            {s.counted_paisa == null ? '—' : formatRs(s.counted_paisa)}
                          </span>
                        </td>
                        <td
                          className={`catalog-table__num${os != null && os < 0 ? ' till-short' : os != null && os > 0 ? ' till-over' : ''}`}
                        >
                          <span className="ltr-isolate">{os == null ? '—' : signedRs(os)}</span>
                        </td>
                        <td className="parties-table__col-actions">
                          <button
                            type="button"
                            className="btn btn--ghost parties-table__khata"
                            onClick={() => void printReport(s.id)}
                          >
                            {t('tillPrintZ')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager page={hist.page} pageSize={PAGE_SIZE} total={hist.total} onPage={setPage} />
          </>
        ) : null}
      </section>

      {moveKind ? (
        <ConfirmModal
          title={moveKind === 'in' ? t('tillCashIn') : t('tillCashOut')}
          message=""
          tone="primary"
          confirmLabel={t('save')}
          cancelLabel={t('cancel')}
          busy={busy}
          confirmDisabled={moveRs == null || moveRs <= 0}
          onConfirm={() => void saveMove()}
          onCancel={() => setMoveKind(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveMove();
            }}
          >
            <div className="field">
              <label htmlFor="till-move-amt">{t('expenseColAmount')}</label>
              <MoneyInput id="till-move-amt" value={moveAmt} onValueChange={setMoveAmt} autoFocus />
            </div>
            <div className="field">
              <label htmlFor="till-move-reason">{t('tillReason')}</label>
              <input
                id="till-move-reason"
                value={moveReason}
                maxLength={120}
                onChange={(e) => setMoveReason(e.target.value)}
              />
            </div>
            <button type="submit" hidden />
          </form>
        </ConfirmModal>
      ) : null}

      {undoMove ? (
        <ConfirmModal
          title={t('tillUndo')}
          message={`${undoMove.kind === 'in' ? t('tillCashIn') : t('tillCashOut')} · ${formatRs(undoMove.amount_paisa)}${undoMove.reason ? ` · ${undoMove.reason}` : ''}`}
          confirmLabel={t('confirm')}
          cancelLabel={t('cancel')}
          busy={busy}
          onConfirm={() => {
            const id = undoMove.id;
            setUndoMove(null);
            void post(`/cashier/till/moves/${encodeURIComponent(id)}/void`, withTill()).then((ok) => ok && refresh());
          }}
          onCancel={() => setUndoMove(null)}
        />
      ) : null}

      {closing && sum ? (
        <ConfirmModal
          title={t('tillClose')}
          message={`${t('tillExpected')}: ${formatRs(sum.expected_paisa)}`}
          tone="primary"
          confirmLabel={t('tillClose')}
          cancelLabel={t('cancel')}
          busy={busy}
          confirmDisabled={countedRs == null}
          onConfirm={() => void closeTill()}
          onCancel={() => setClosing(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void closeTill();
            }}
          >
            <div className="field">
              <label htmlFor="till-counted">{t('tillCounted')}</label>
              <MoneyInput id="till-counted" value={countedText} onValueChange={setCountedText} autoFocus />
            </div>
            {previewOverShort != null ? (
              <p
                className={`till-preview ${previewOverShort < 0 ? 'till-short' : previewOverShort > 0 ? 'till-over' : ''}`}
                data-till-over-short
              >
                {previewOverShort === 0
                  ? t('tillExact')
                  : `${previewOverShort < 0 ? t('tillShort') : t('tillOver')} ${formatRs(Math.abs(previewOverShort))}`}
              </p>
            ) : null}
            <div className="field">
              <label htmlFor="till-note">{t('tillNote')}</label>
              <input id="till-note" value={closeNote} maxLength={200} onChange={(e) => setCloseNote(e.target.value)} />
            </div>
            <button type="submit" hidden />
          </form>
        </ConfirmModal>
      ) : null}
    </div>
  );
}
