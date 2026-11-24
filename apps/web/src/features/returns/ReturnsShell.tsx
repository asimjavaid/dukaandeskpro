import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UrHint, translateError, useI18n } from '../../i18n';
import { ConfirmModal } from '../shared/ConfirmModal';
import { ManagerApproval } from '../tills/ManagerApproval';
import { PageHeader } from '../shared/PageHeader';
import { apiGet, apiPostRaw } from '../../lib/api';
import { allowsFraction, formatQty, parseQtyInput, r3 } from '../shared/productUnits';
import { ProductThumb } from '../shared/ProductThumb';
import { formatRsShort as formatRs } from '../../lib/money';
import { shouldAutoPrintReceipt } from '../pos/printReceipt';
import { printReturnSlip } from './printReturnSlip';

type Role = 'owner' | 'manager' | 'cashier';

type BillHit = {
  id: string;
  short_id: string;
  recorded_at: string;
  party_name: string | null;
  total_paisa: number;
  payment_method: string;
  returned_all: boolean;
};

type BillLine = {
  id: string;
  product_name: string;
  image_file?: string | null;
  unit_label: string;
  qty: number;
  unit_price_paisa: number;
  returned_qty: number;
};

type Bill = {
  id: string;
  short_id: string;
  recorded_at: string;
  status: 'active' | 'removed' | 'replaced';
  payment_method: string;
  total_paisa: number;
  party: { id: string; name: string; phone: string | null } | null;
  cash_refundable_paisa?: number;
  lines: BillLine[];
};

type ReturnRow = {
  id: string;
  short_id: string;
  recorded_at: string;
  sale_id: string;
  sale_short_id: string;
  party_name: string | null;
  total_paisa: number;
  refund_cash_paisa: number;
  refund_khata_paisa: number;
  reason?: string | null;
};

type ReturnDetail = ReturnRow & {
  lines: Array<{ product_name: string; qty: number; unit_price_paisa: number; line_total_paisa: number }>;
};

type Pick = { qty: number; restock: boolean };
type RefundMode = 'khata' | 'cash';

type StoreInfo = {
  name: string;
  footer: string | null;
  widthMm: 58 | 80;
  printerName: string | null;
  printEnabled: boolean;
};

type Props = {
  displayName: string;
  role: Role;
  /** Open this bill once (Return items from Sales). */
  initialSaleId?: string | null;
  onInitialConsumed?: () => void;
};

export function ReturnsShell({ displayName, role, initialSaleId, onInitialConsumed }: Props) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<BillHit[] | null>(null);
  const [bill, setBill] = useState<Bill | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [mode, setMode] = useState<RefundMode>('cash');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [todayList, setTodayList] = useState<ReturnRow[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [store, setStore] = useState<StoreInfo | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const seq = useRef(0);

  const fmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === 'ur' ? 'ur-PK' : 'en-PK', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Asia/Karachi',
        numberingSystem: 'latn',
      }),
    [locale],
  );
  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : fmt.format(d);
  };

  useEffect(() => {
    apiGet<{
      store?: {
        name: string;
        receipt_footer?: string | null;
        receipt_width_mm?: number;
        receipt_printer_name?: string | null;
        receipt_print_enabled?: boolean;
      } | null;
    }>('/auth/status')
      .then((s) =>
        setStore({
          name: s.store?.name || t('storeNamePlaceholder'),
          footer: s.store?.receipt_footer?.trim() ? s.store.receipt_footer : null,
          widthMm: s.store?.receipt_width_mm === 58 ? 58 : 80,
          printerName: s.store?.receipt_printer_name?.trim() ? s.store.receipt_printer_name.trim() : null,
          printEnabled: s.store?.receipt_print_enabled !== false,
        }),
      )
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadToday = useCallback(async () => {
    try {
      const r = await apiGet<{ ok: true; items: ReturnRow[] }>('/returns');
      setTodayList(r.items);
      setListFailed(false);
    } catch {
      setListFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadToday();
  }, [loadToday]);

  const openBill = useCallback(async (id: string) => {
    try {
      const r = await apiGet<{ ok: true; sale: Bill }>(`/returns/bills/${encodeURIComponent(id)}`);
      const b = r.sale;
      setBill(b);
      setHits(null);
      setQuery('');
      const p: Record<string, Pick> = {};
      for (const l of b.lines) p[l.id] = { qty: 0, restock: true };
      setPicks(p);
      setMode(b.party ? 'khata' : 'cash');
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (initialSaleId) {
      void openBill(initialSaleId);
      onInitialConsumed?.();
    } else {
      searchRef.current?.focus();
    }
    // one-shot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Search bills as the cashier types.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    const id = window.setTimeout(async () => {
      const s = ++seq.current;
      try {
        const r = await apiGet<{ ok: true; items: BillHit[] }>(`/returns/bills?q=${encodeURIComponent(q)}`);
        if (s === seq.current) setHits(r.items);
      } catch {
        if (s === seq.current) setHits([]);
      }
    }, 200);
    return () => window.clearTimeout(id);
  }, [query]);

  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 3500);
    return () => window.clearTimeout(id);
  }, [flash]);

  async function onSearchEnter() {
    const q = query.trim().replace(/^#/, '');
    if (!q) return;
    // Scanned receipt / typed bill no: open it straight away.
    if (/^[0-9a-fA-F]{8}$/.test(q) && (await openBill(q.toUpperCase()))) return;
    if (hits && hits.length > 0) void openBill(hits[0].id);
  }

  const total = useMemo(() => {
    if (!bill) return 0;
    return bill.lines.reduce((s, l) => s + Math.round((picks[l.id]?.qty ?? 0) * l.unit_price_paisa), 0);
  }, [bill, picks]);

  // Customer bills: all on khata (default) or all cash. Walk-ins: cash only.
  // Cash back never exceeds the cash taken on the bill; the rest goes off khata.
  const cashCap = bill?.cash_refundable_paisa ?? total;
  const cashPaisa = !bill?.party ? total : mode === 'cash' ? Math.min(total, cashCap) : 0;
  const khataPaisa = total - cashPaisa;
  const overCash = !bill?.party && total > cashCap;

  function setQty(lineId: string, qty: number, max: number) {
    setPicks((p) => ({ ...p, [lineId]: { ...(p[lineId] ?? { restock: true }), qty: r3(Math.max(0, Math.min(max, qty))) } }));
  }

  const [reason, setReason] = useState('');
  const [undoId, setUndoId] = useState<ReturnRow | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  async function undoReturn(r: ReturnRow) {
    setUndoBusy(true);
    const res = await apiPostRaw<{ ok: boolean; error?: string; message?: { error?: string } }>(
      `/returns/${encodeURIComponent(r.id)}/undo`,
      {},
    ).catch(() => null);
    setUndoBusy(false);
    setUndoId(null);
    if (!res?.json?.ok) {
      const code = res?.json?.message && typeof res.json.message === 'object' ? res.json.message.error : res?.json?.error;
      setFlash({ kind: 'err', msg: translateError(t, code ?? 'error_generic') });
      return;
    }
    setFlash({ kind: 'ok', msg: t('returnUndone').replace('{id}', r.short_id) });
    void loadToday();
  }

  const [approving, setApproving] = useState(false);

  async function submit(approval?: string) {
    if (!bill || total <= 0 || busy || overCash) return;
    setBusy(true);
    const lines = bill.lines
      .filter((l) => (picks[l.id]?.qty ?? 0) > 0)
      .map((l) => ({ saleLineId: l.id, qty: picks[l.id].qty, restock: picks[l.id].restock }));
    const r = await apiPostRaw<{ ok: boolean; return?: ReturnDetail; error?: string }>('/returns', {
      saleId: bill.id,
      lines,
      refundCashPaisa: cashPaisa,
      refundKhataPaisa: khataPaisa,
      reason: reason.trim() || null,
      clientDeviceAt: new Date().toISOString(),
      ...(approval ? { approval } : {}),
    });
    setBusy(false);
    if (r.status === 403 && r.json?.error === 'manager_approval_needed') {
      setApproving(true);
      return;
    }
    if (!r.ok || !r.json?.ok || !r.json.return) {
      setFlash({ kind: 'err', msg: r.json?.error === 'refund_exceeds_cash' ? t('errRefundExceedsCash') : t('returnsFailed') });
      return;
    }
    const ret = r.json.return;
    setReason('');
    setFlash({ kind: 'ok', msg: t('returnsDone').replace('{id}', ret.short_id) });
    if (store && shouldAutoPrintReceipt({ printerName: store.printerName, printEnabled: store.printEnabled })) {
      void printReturnSlip(
        {
          storeName: store.name,
          returnNo: ret.short_id,
          billNo: ret.sale_short_id,
          recordedAt: ret.recorded_at,
          partyName: bill.party?.name ?? null,
          lines: ret.lines.map((l) => ({
            name: l.product_name,
            qty: l.qty,
            unitPricePaisa: l.unit_price_paisa,
            lineTotalPaisa: l.line_total_paisa,
          })),
          totalPaisa: ret.total_paisa,
          cashPaisa: ret.refund_cash_paisa,
          khataPaisa: ret.refund_khata_paisa,
          footer: store.footer,
        },
        {
          title: t('receiptReturn'),
          returnNo: t('receiptReturnNo'),
          bill: t('receiptOnBill'),
          total: t('receiptTotal'),
          cash: t('receiptRefundCash'),
          khata: t('receiptRefundKhata'),
          party: t('receiptParty'),
        },
        { widthMm: store.widthMm, printerName: store.printerName },
      );
    }
    setBill(null);
    void loadToday();
    window.requestAnimationFrame(() => searchRef.current?.focus());
  }

  const left = (l: BillLine) => r3(Math.max(0, l.qty - l.returned_qty));
  const nothingLeft = bill ? bill.lines.every((l) => left(l) === 0) : false;

  return (
    <div className="card returns">
      {approving ? (
        <ManagerApproval
          action="refund"
          onCancel={() => setApproving(false)}
          onApproved={(tok) => {
            setApproving(false);
            void submit(tok);
          }}
        />
      ) : null}
      <PageHeader
        title={<>{t('returnsTitle')}<UrHint k="returnsTitle" /></>}
        subtitle={displayName}
      />

      {flash ? (
        <p className={`sales-flash sales-flash--${flash.kind}`} role={flash.kind === 'ok' ? 'status' : 'alert'}>
          {flash.msg}
        </p>
      ) : null}

      {!bill ? (
        <>
          <div className="sales__toolbar">
            <div className="sales-search field">
              <label htmlFor="returns-search" className="visually-hidden">
                {t('returnsFind')}
              </label>
              <input
                id="returns-search"
                ref={searchRef}
                className="sales-search__input"
                type="search"
                autoComplete="off"
                placeholder={t('returnsFind')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void onSearchEnter();
                  }
                }}
              />
            </div>
          </div>

          {hits ? (
            hits.length === 0 ? (
              <p className="muted sales-empty">{t('returnsNoBills')}</p>
            ) : (
              <ul className="returns-hits">
                {hits.map((h) => (
                  <li key={h.id}>
                    <button type="button" className="returns-hit" onClick={() => void openBill(h.id)}>
                      <span className="ltr-isolate returns-hit__bill">#{h.short_id}</span>
                      <span className="returns-hit__who" dir="auto">
                        {h.party_name ?? <span className="muted">{t('walkInDefault')}</span>}
                      </span>
                      <span className="muted ltr-isolate">{when(h.recorded_at)}</span>
                      {h.returned_all ? (
                        <span className="chip chip--warn">{t('salesTagReturned')}</span>
                      ) : null}
                      <span className="ltr-isolate returns-hit__total">{formatRs(h.total_paisa)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <section className="returns-today" aria-label={t('returnsToday')}>
              <h3 className="returns-today__title">{t('returnsToday')}</h3>
              {listFailed ? (
                <div className="sales-empty" role="alert">
                  <p>{t('returnsLoadFailed')}</p>
                  <button type="button" className="btn btn--ghost" onClick={() => void loadToday()}>
                    {t('retry')}
                  </button>
                </div>
              ) : !todayList ? (
                <p className="muted">{t('loading')}</p>
              ) : todayList.length === 0 ? (
                <p className="muted sales-empty">{t('returnsNone')}</p>
              ) : (
                <div className="catalog-table-wrap">
                  <table className="catalog-table">
                    <thead>
                      <tr>
                        <th scope="col">{t('receiptReturnNo')}</th>
                        <th scope="col">{t('salesColBill')}</th>
                        <th scope="col">{t('salesColCustomer')}</th>
                        <th scope="col">{t('salesColTime')}</th>
                        <th scope="col">{t('returnsRefund')}</th>
                        <th scope="col" className="catalog-table__num">{t('salesColTotal')}</th>
                        {role === 'owner' ? <th scope="col" /> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {todayList.map((r) => (
                        <tr key={r.id}>
                          <td className="ltr-isolate">{r.short_id}</td>
                          <td className="ltr-isolate">#{r.sale_short_id}</td>
                          <td dir="auto">{r.party_name ?? <span className="muted">{t('walkInDefault')}</span>}</td>
                          <td className="ltr-isolate">{when(r.recorded_at)}</td>
                          <td>
                            {r.refund_cash_paisa > 0 ? (
                              <span className="chip chip--method-cash">{t('returnsRefundCash')}</span>
                            ) : null}{' '}
                            {r.refund_khata_paisa > 0 ? (
                              <span className="chip chip--method-udhaar">{t('returnsRefundKhata')}</span>
                            ) : null}
                          </td>
                          <td className="catalog-table__num ltr-isolate">
                            {formatRs(r.total_paisa)}
                            {r.reason ? <div className="muted" dir="auto">{r.reason}</div> : null}
                          </td>
                          {role === 'owner' ? (
                            <td>
                              <button type="button" className="btn btn--ghost" data-return-undo onClick={() => setUndoId(r)}>
                                {t('returnUndo')}
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      ) : (
        <section className="returns-bill" aria-label={t('salesBillDetail')}>
          <header className="returns-bill__head">
            <div>
              <h3 className="returns-bill__title">
                {t('salesColBill')} <span className="ltr-isolate">#{bill.short_id}</span>
              </h3>
              <p className="muted">
                <span dir="auto">{bill.party?.name ?? t('walkInDefault')}</span> ·{' '}
                <span className="ltr-isolate">{when(bill.recorded_at)}</span> ·{' '}
                <span className="ltr-isolate">{formatRs(bill.total_paisa)}</span>
              </p>
            </div>
            <button type="button" className="btn btn--ghost" onClick={() => setBill(null)}>
              {t('returnsChangeBill')}
            </button>
          </header>

          {nothingLeft ? <p className="muted sales-empty">{t('returnsNothingLeft')}</p> : null}

          <div className="catalog-table-wrap">
            <table className="catalog-table returns-lines">
              <thead>
                <tr>
                  <th scope="col">{t('returnsColItem')}</th>
                  <th scope="col" className="catalog-table__num">{t('returnsColSold')}</th>
                  <th scope="col" className="returns-lines__qty">{t('returnsColReturn')}</th>
                  <th scope="col">{t('returnsBackToStock')}</th>
                  <th scope="col" className="catalog-table__num">{t('salesColTotal')}</th>
                </tr>
              </thead>
              <tbody>
                {bill.lines.map((l) => {
                  const max = left(l);
                  const p = picks[l.id] ?? { qty: 0, restock: true };
                  return (
                    <tr key={l.id} className={max === 0 ? 'sales-row--gone' : undefined}>
                      <td dir="auto">
                        <div className="sale-line-thumb">
                          <ProductThumb name={l.product_name} imageFile={l.image_file} className="initial-badge--sm" />
                          <div>
                            <div>{l.product_name}</div>
                            <div className="muted ltr-isolate">{formatRs(l.unit_price_paisa)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="catalog-table__num ltr-isolate">
                        {formatQty(l.qty)}
                        {l.returned_qty > 0 ? (
                          <div className="muted">{t('salesReturnedQty').replace('{qty}', formatQty(l.returned_qty))}</div>
                        ) : null}
                      </td>
                      <td className="returns-lines__qty">
                        <div className="returns-step">
                          <button
                            type="button"
                            className="returns-step__btn"
                            aria-label={t('qtyDecrease')}
                            disabled={p.qty <= 0}
                            onClick={() => setQty(l.id, Math.max(0, Math.ceil(p.qty - 1)), max)}
                          >
                            −
                          </button>
                          <input
                            className="returns-step__input ltr-isolate"
                            inputMode={allowsFraction(l.unit_label) ? 'decimal' : 'numeric'}
                            aria-label={`${t('returnsColReturn')} ${l.product_name}`}
                            defaultValue={formatQty(p.qty)}
                            key={`r-${l.id}-${p.qty}`}
                            disabled={max === 0}
                            onBlur={(e) => {
                              const v = e.target.value.trim();
                              setQty(l.id, v === '' ? 0 : (parseQtyInput(v, l.unit_label) ?? p.qty), max);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                            }}
                          />
                          <button
                            type="button"
                            className="returns-step__btn"
                            aria-label={t('qtyIncrease')}
                            disabled={p.qty >= max}
                            onClick={() => setQty(l.id, Math.floor(p.qty + 1), max)}
                          >
                            +
                          </button>
                        </div>
                      </td>
                      <td>
                        <label className="returns-stock">
                          <input
                            type="checkbox"
                            checked={p.restock}
                            disabled={max === 0}
                            onChange={(e) =>
                              setPicks((all) => ({ ...all, [l.id]: { ...p, restock: e.target.checked } }))
                            }
                          />
                          <span className="visually-hidden">{t('returnsBackToStock')}</span>
                        </label>
                      </td>
                      <td className="catalog-table__num ltr-isolate">
                        {p.qty > 0 ? formatRs(Math.round(p.qty * l.unit_price_paisa)) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <footer className="returns-pay">
            {bill.party ? (
              <div className="returns-pay__mode">
                <span className="muted">{t('returnsRefund')}</span>
                <div className="sales-seg sales-seg--sm" role="group" aria-label={t('returnsRefund')}>
                  {(['khata', 'cash'] as RefundMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`sales-seg__btn${mode === m ? ' is-active' : ''}`}
                      aria-pressed={mode === m}
                      onClick={() => setMode(m)}
                    >
                      {t(m === 'khata' ? 'returnsRefundKhata' : 'returnsRefundCash')}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="field returns-pay__reason">
              <label htmlFor="return-reason" className="visually-hidden">{t('returnReason')}</label>
              <input
                id="return-reason"
                className="input"
                maxLength={200}
                placeholder={t('returnReason')}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                data-return-reason
              />
            </div>
            <div className="returns-pay__sum">
              {overCash ? (
                <span className="returns-pay__line" role="alert">{t('errRefundExceedsCash')}</span>
              ) : null}
              {cashPaisa > 0 ? (
                <span className="returns-pay__line returns-pay__line--cash">
                  {t('returnsGiveCash')} <strong className="ltr-isolate">{formatRs(cashPaisa)}</strong>
                </span>
              ) : null}
              {khataPaisa > 0 ? (
                <span className="returns-pay__line returns-pay__line--khata">
                  {t('returnsOffKhata')} <strong className="ltr-isolate">{formatRs(khataPaisa)}</strong>
                </span>
              ) : null}
            </div>
            <button
              type="button"
              className="btn btn--teal returns-pay__go"
              disabled={total <= 0 || busy || overCash}
              onClick={() => void submit()}
            >
              {t('returnsConfirm').replace('{amount}', formatRs(total))}
            </button>
          </footer>
        </section>
      )}
      {undoId ? (
        <ConfirmModal
          title={t('returnUndo')}
          message={t('returnUndoMsg').replace('{id}', undoId.short_id).replace('{amount}', formatRs(undoId.total_paisa))}
          confirmLabel={t('returnUndo')}
          cancelLabel={t('cancel')}
          busy={undoBusy}
          onConfirm={() => void undoReturn(undoId)}
          onCancel={() => setUndoId(null)}
        />
      ) : null}
    </div>
  );
}
