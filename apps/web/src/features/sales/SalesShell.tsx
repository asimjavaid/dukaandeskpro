import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UrHint, useI18n, type MessageKey } from '../../i18n';
import { PageHeader } from '../shared/PageHeader';
import { Pager } from '../shared/Pager';
import { NavIcon } from '../shared/NavIcons';
import { apiGet, apiPostRaw } from '../../lib/api';
import { ProductThumb } from '../shared/ProductThumb';
import { ConfirmModal } from '../shared/ConfirmModal';
import { formatRsShort } from '../../lib/money';
import { printThermalReceipt } from '../pos/printReceipt';
import type { SaleReceiptFields } from '../pos/receipt';

type Role = 'owner' | 'manager' | 'cashier' | 'data_entry';
type Range = 'all' | 'today' | '7d' | 'month' | 'custom';
type Paid = 'all' | 'cash' | 'khata' | 'both';
type StatusFilter = 'all' | 'active' | 'removed' | 'returned';
type SaleStatus = 'active' | 'removed' | 'replaced';
type ReturnState = 'none' | 'part' | 'full';

type SaleRow = {
  id: string;
  short_id: string;
  recorded_at: string;
  party_id: string | null;
  party_name: string | null;
  item_count: number;
  qty_total: number;
  total_paisa: number;
  payment_method: string;
  cash_amount_paisa: number;
  udhaar_amount_paisa: number;
  status: SaleStatus;
  return_state: ReturnState;
  sold_by_name: string | null;
};

type SalesPage = {
  ok: true;
  range: Range;
  from: string;
  to: string;
  today: string;
  page: number;
  page_size: number;
  total: number;
  sale_count: number;
  total_paisa: number;
  items: SaleRow[];
};

type SaleLine = {
  id: string;
  line_no: number;
  product_id: string;
  product_name: string;
  unit_label: string;
  barcode: string | null;
  image_file?: string | null;
  qty: number;
  unit_price_paisa: number;
  line_total_paisa: number;
  returned_qty: number;
};

type SaleDetail = {
  id: string;
  short_id: string;
  recorded_at: string;
  client_device_at: string;
  status: SaleStatus;
  return_state: ReturnState;
  voided_at: string | null;
  void_reason: string | null;
  voided_by_name: string | null;
  replaces: { id: string; short_id: string } | null;
  replaced_by: { id: string; short_id: string } | null;
  payment_method: string;
  total_paisa: number;
  cash_amount_paisa: number;
  udhaar_amount_paisa: number;
  tendered_paisa: number;
  change_paisa: number;
  kept_on_khata_paisa: number;
  subtotal_paisa?: number;
  discount_paisa?: number;
  discount_label?: string | null;
  rounding_paisa?: number;
  digital_paisa?: number;
  digital_method?: string | null;
  digital_ref?: string | null;
  party: { id: string; name: string; phone: string | null } | null;
  sold_by: { id: string; name: string } | null;
  lines: SaleLine[];
  day: string;
  today: string;
  returns: Array<{
    id: string;
    short_id: string;
    recorded_at: string;
    total_paisa: number;
    refund_cash_paisa: number;
    refund_khata_paisa: number;
  }>;
};

export type EditableSale = SaleDetail;

type StoreInfo = {
  name: string;
  footer: string | null;
  widthMm: 58 | 80;
  printerName: string | null;
};

type Props = {
  displayName: string;
  role: Role;
  /** Open this bill once (e.g. from Today). */
  initialSaleId?: string | null;
  onInitialConsumed?: () => void;
  /** Open the Returns screen with this bill. */
  onReturnItems?: (saleId: string) => void;
  /** Owner: open this bill in Sell as an Edit tab. */
  onEditSale?: (sale: EditableSale) => void;
};

const REMOVE_REASONS: MessageKey[] = [
  'salesReasonWrongItems',
  'salesReasonCancelled',
  'salesReasonDuplicate',
  'salesReasonOther',
];

const PAGE_SIZE = 50;
const formatRs = formatRsShort;

const RANGES: Array<{ id: Range; key: MessageKey }> = [
  { id: 'all', key: 'salesAll' },
  { id: 'today', key: 'salesRangeToday' },
  { id: '7d', key: 'salesRange7d' },
  { id: 'month', key: 'salesRangeMonth' },
  { id: 'custom', key: 'salesRangeCustom' },
];
const PAIDS: Array<{ id: Paid; key: MessageKey }> = [
  { id: 'all', key: 'salesAll' },
  { id: 'cash', key: 'salesPaidCash' },
  { id: 'khata', key: 'salesPaidKhata' },
  { id: 'both', key: 'salesPaidBoth' },
];
const STATUSES: Array<{ id: StatusFilter; key: MessageKey }> = [
  { id: 'all', key: 'salesAll' },
  { id: 'active', key: 'salesStatusActive' },
  { id: 'removed', key: 'salesStatusRemoved' },
  { id: 'returned', key: 'salesStatusReturned' },
];

function paidKey(method: string): MessageKey {
  if (method === 'udhaar') return 'salesPaidKhata';
  if (method === 'split') return 'salesPaidBoth';
  return 'salesPaidCash';
}

function paidChipClass(method: string): string {
  if (method === 'udhaar') return 'chip chip--method-udhaar';
  if (method === 'split') return 'chip chip--method-split';
  return 'chip chip--method-cash';
}

function receiptUnit(label: string): string {
  return label && label !== 'piece' ? label : 'piece';
}

export function SalesShell({
  displayName,
  role,
  initialSaleId,
  onInitialConsumed,
  onReturnItems,
  onEditSale,
}: Props) {
  const { t, locale } = useI18n();
  const isOwner = role === 'owner';

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [range, setRange] = useState<Range>(role === 'owner' ? 'all' : 'today');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [paid, setPaid] = useState<Paid>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);

  const [data, setData] = useState<SalesPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(initialSaleId ?? null);
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [printing, setPrinting] = useState(false);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const [removing, setRemoving] = useState(false);
  const [removeReason, setRemoveReason] = useState<MessageKey | null>(null);
  const [removeNote, setRemoveNote] = useState('');
  const [removeBusy, setRemoveBusy] = useState(false);

  const searchRef = useRef<HTMLInputElement | null>(null);
  const tableRef = useRef<HTMLTableSectionElement | null>(null);
  const reqSeq = useRef(0);

  useEffect(() => {
    if (initialSaleId) onInitialConsumed?.();
    // one-shot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebounced(query.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(id);
  }, [query]);

  useEffect(() => {
    apiGet<{
      store?: {
        name: string;
        receipt_footer?: string | null;
        receipt_width_mm?: number;
        receipt_printer_name?: string | null;
      } | null;
    }>('/auth/status')
      .then((s) =>
        setStore({
          name: s.store?.name || t('storeNamePlaceholder'),
          footer: s.store?.receipt_footer?.trim() ? s.store.receipt_footer : null,
          widthMm: s.store?.receipt_width_mm === 58 ? 58 : 80,
          printerName: s.store?.receipt_printer_name?.trim()
            ? s.store.receipt_printer_name.trim()
            : null,
        }),
      )
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (debounced) p.set('q', debounced);
    p.set('range', isOwner ? range : 'today');
    if (isOwner && range === 'custom' && from && to) {
      p.set('from', from <= to ? from : to);
      p.set('to', from <= to ? to : from);
    }
    if (paid !== 'all') p.set('paid', paid);
    if (status !== 'all') p.set('status', status);
    p.set('page', String(page));
    p.set('pageSize', String(PAGE_SIZE));
    return p.toString();
  }, [debounced, isOwner, range, from, to, paid, status, page]);

  const load = useCallback(async () => {
    if (isOwner && range === 'custom' && (!from || !to)) return;
    const seq = ++reqSeq.current;
    setLoading(true);
    try {
      const r = await apiGet<SalesPage>(`/sales?${queryString}`);
      if (seq !== reqSeq.current) return;
      setData(r);
      setLoadFailed(false);
    } catch {
      if (seq !== reqSeq.current) return;
      setLoadFailed(true);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [queryString, isOwner, range, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailFailed(false);
    try {
      const r = await apiGet<{ ok: true; sale: SaleDetail }>(`/sales/${encodeURIComponent(id)}`);
      setDetail(r.sale);
      // Stacked layout (narrow window): bring the bill into view.
      if (window.matchMedia?.('(max-width: 1100px)').matches) {
        window.requestAnimationFrame(() =>
          document.querySelector('.sales__panel')?.scrollIntoView({ block: 'nearest' }),
        );
      }
    } catch {
      setDetail(null);
      setDetailFailed(true);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailFailed(false);
      return;
    }
    if (detail?.id === selectedId) return;
    void loadDetail(selectedId);
  }, [selectedId, detail?.id, loadDetail]);

  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 3200);
    return () => window.clearTimeout(id);
  }, [flash]);

  function pickRange(next: Range) {
    if (next === 'custom' && (!from || !to) && data) {
      setFrom(data.from);
      setTo(data.to);
    }
    setRange(next);
    setPage(1);
  }

  const timeFmt = useMemo(() => {
    const loc = locale === 'ur' ? 'ur-PK' : 'en-PK';
    const time = new Intl.DateTimeFormat(loc, {
      timeStyle: 'short',
      timeZone: 'Asia/Karachi',
      numberingSystem: 'latn',
    });
    const dateTime = new Intl.DateTimeFormat(loc, {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Asia/Karachi',
      numberingSystem: 'latn',
    });
    const full = new Intl.DateTimeFormat(loc, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Karachi',
      numberingSystem: 'latn',
    });
    return { time, dateTime, full };
  }, [locale]);

  function rowTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const sameDay = data && data.from === data.to;
    return sameDay ? timeFmt.time.format(d) : timeFmt.dateTime.format(d);
  }

  function statusTag(s: { status: SaleStatus; return_state: ReturnState }) {
    if (s.status === 'removed') {
      return <span className="chip chip--danger sales-tag">{t('salesStatusRemoved')}</span>;
    }
    if (s.status === 'replaced') {
      return <span className="chip chip--neutral sales-tag">{t('salesTagReplaced')}</span>;
    }
    if (s.return_state === 'full') {
      return <span className="chip chip--warn sales-tag">{t('salesTagReturned')}</span>;
    }
    if (s.return_state === 'part') {
      return <span className="chip chip--warn sales-tag">{t('salesTagPartReturned')}</span>;
    }
    return null;
  }

  const items = data?.items ?? [];

  function moveSelection(delta: number) {
    if (items.length === 0) return;
    const idx = items.findIndex((s) => s.id === selectedId);
    const next = idx < 0 ? (delta > 0 ? 0 : items.length - 1) : idx + delta;
    const clamped = Math.max(0, Math.min(items.length - 1, next));
    const row = items[clamped];
    setSelectedId(row.id);
    window.requestAnimationFrame(() => {
      tableRef.current
        ?.querySelector<HTMLElement>(`[data-sale-id="${row.id}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    });
  }

  async function reprint() {
    if (!detail || printing) return;
    setPrinting(true);
    const fields: SaleReceiptFields = {
      saleId: detail.id,
      shortId: detail.short_id,
      storeName: store?.name || t('storeNamePlaceholder'),
      paymentMethod: detail.payment_method,
      lines: detail.lines.map((l) => ({
        name: l.product_name,
        qtyInput: l.qty,
        unit: receiptUnit(l.unit_label),
        unitPricePaisa: l.unit_price_paisa,
        lineTotalPaisa: l.line_total_paisa,
      })),
      totalPaisa: detail.total_paisa,
      cashAmountPaisa: detail.cash_amount_paisa,
      udhaarAmountPaisa: detail.udhaar_amount_paisa,
      tenderedPaisa: detail.tendered_paisa,
      changePaisa: detail.change_paisa,
      partyName: detail.party?.name ?? null,
      clientDeviceAt: detail.client_device_at,
      recordedAt: detail.recorded_at,
      receiptFooter: store?.footer ?? null,
      subtotalPaisa: detail.subtotal_paisa ?? null,
      discountPaisa: detail.discount_paisa ?? 0,
      discountLabel: detail.discount_label ?? null,
      roundingPaisa: detail.rounding_paisa ?? 0,
      digitalPaisa: detail.digital_paisa ?? 0,
      digitalMethod: detail.digital_method ?? null,
      digitalRef: detail.digital_ref ?? null,
    };
    const result = await printThermalReceipt({
      fields,
      widthMm: store?.widthMm ?? 80,
      printerName: store?.printerName ?? null,
      copyMark: t('receiptCopy'),
      noteLine: detail.replaces ? t('receiptReplaces').replace('{id}', detail.replaces.short_id) : null,
      labels: {
        total: t('receiptTotal'),
        payment: t('receiptPayment'),
        cash: t('receiptCash'),
        udhaar: t('receiptUdhaar'),
        paid: t('receiptPaid'),
        change: t('receiptChange'),
        party: t('receiptParty'),
        split: t('receiptSplit'),
        clientTime: t('receiptClientTime'),
        recordedTime: t('receiptRecordedTime'),
        sale: t('receiptSaleId'),
        salesTaxIncl: t('receiptSalesTaxIncl'),
      },
    });
    setPrinting(false);
    setFlash(
      result === 'ok'
        ? { kind: 'ok', msg: t('salesReprinted').replace('{id}', detail.short_id) }
        : { kind: 'err', msg: t('salesReprintFailed') },
    );
  }

  const reasonText =
    removeReason === 'salesReasonOther' ? removeNote.trim() : removeReason ? t(removeReason) : '';

  async function confirmRemove() {
    if (!detail || !reasonText || removeBusy) return;
    setRemoveBusy(true);
    const r = await apiPostRaw<{ ok: boolean }>(`/sales/${encodeURIComponent(detail.id)}/void`, {
      reason: reasonText,
    });
    setRemoveBusy(false);
    if (!r.ok || !r.json?.ok) {
      setFlash({ kind: 'err', msg: t('salesRemoveFailed') });
      return;
    }
    setRemoving(false);
    setFlash({ kind: 'ok', msg: t('salesRemoved').replace('{id}', detail.short_id) });
    await loadDetail(detail.id);
    void load();
  }

  function openRemove() {
    setRemoveReason(null);
    setRemoveNote('');
    setRemoving(true);
  }

  // Keyboard: / or F3 search · ↑/↓ move · Esc close · P reprint.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (e.key === 'F3' || (e.key === '/' && !typing)) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (typing && target !== searchRef.current) return;
        e.preventDefault();
        moveSelection(e.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (e.key === 'Escape' && selectedId) {
        if (typing && target === searchRef.current && query) return;
        setSelectedId(null);
        return;
      }
      if (!typing && (e.key === 'p' || e.key === 'P') && detail && detail.status === 'active') {
        e.preventDefault();
        void reprint();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const panelOpen = Boolean(selectedId);
  const showRangeDates = isOwner && data && data.from !== data.to && range !== 'custom';

  return (
    <div className="card sales">
      <PageHeader
        title={<>{t('salesTitle')}<UrHint k="salesTitle" /></>}
        subtitle={displayName}
      />

      <div className="sales__toolbar">
        <div className="sales-search field">
          <label htmlFor="sales-search" className="visually-hidden">
            {t('salesSearch')}
          </label>
          <input
            id="sales-search"
            ref={searchRef}
            className="sales-search__input"
            type="search"
            placeholder={t('salesSearch')}
            value={query}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setDebounced(query.trim());
                setPage(1);
                if (items.length > 0 && !selectedId) setSelectedId(items[0].id);
              }
            }}
          />
        </div>
        {isOwner ? (
          <div className="sales-seg" role="group" aria-label={t('salesFilterDate')}>
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`sales-seg__btn${range === r.id ? ' is-active' : ''}`}
                aria-pressed={range === r.id}
                onClick={() => pickRange(r.id)}
              >
                {t(r.key)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {isOwner && range === 'custom' ? (
        <div className="sales__dates">
          <div className="field">
            <label htmlFor="sales-from">{t('salesFrom')}</label>
            <input
              id="sales-from"
              type="date"
              className="ltr-isolate"
              value={from}
              max={data?.today}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="sales-to">{t('salesTo')}</label>
            <input
              id="sales-to"
              type="date"
              className="ltr-isolate"
              value={to}
              max={data?.today}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
      ) : null}

      <div className="sales__filters">
        <div className="sales__filter">
          <span className="sales__filter-label muted" id="sales-paid-label">
            {t('salesFilterPaid')}
          </span>
          <div className="sales-seg sales-seg--sm" role="group" aria-labelledby="sales-paid-label">
            {PAIDS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`sales-seg__btn${paid === p.id ? ' is-active' : ''}`}
                aria-pressed={paid === p.id}
                onClick={() => {
                  setPaid(p.id);
                  setPage(1);
                }}
              >
                {t(p.key)}
              </button>
            ))}
          </div>
        </div>
        <div className="sales__filter">
          <span className="sales__filter-label muted" id="sales-status-label">
            {t('salesFilterStatus')}
          </span>
          <div className="sales-seg sales-seg--sm" role="group" aria-labelledby="sales-status-label">
            {STATUSES.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`sales-seg__btn${status === s.id ? ' is-active' : ''}`}
                aria-pressed={status === s.id}
                onClick={() => {
                  setStatus(s.id);
                  setPage(1);
                }}
              >
                {t(s.key)}
              </button>
            ))}
          </div>
        </div>
        {data ? (
          <p className="sales__summary" aria-live="polite">
            {showRangeDates ? (
              <span className="muted ltr-isolate sales__summary-range">
                {data.from} – {data.to}
              </span>
            ) : null}
            <span className="sales__summary-count">
              {t('salesSummaryBills').replace('{count}', String(data.sale_count))}
            </span>
            <span className="sales__summary-total ltr-isolate">{formatRs(data.total_paisa)}</span>
          </p>
        ) : null}
      </div>

      {flash ? (
        <p
          className={flash.kind === 'ok' ? 'sales-flash sales-flash--ok' : 'sales-flash sales-flash--err'}
          role={flash.kind === 'ok' ? 'status' : 'alert'}
        >
          {flash.msg}
        </p>
      ) : null}

      <div className={`sales__body${panelOpen ? '' : ' sales__body--solo'}`}>
        <section className="sales__list-pane" aria-label={t('salesTitle')}>
          {loadFailed ? (
            <div className="sales-empty" role="alert">
              <p>{t('salesLoadFailed')}</p>
              <button type="button" className="btn btn--ghost" onClick={() => void load()}>
                {t('retry')}
              </button>
            </div>
          ) : !data && loading ? (
            <p className="muted sales-empty" role="status">
              {t('loading')}
            </p>
          ) : items.length === 0 ? (
            <p className="muted sales-empty" role="status">
              {t('salesNoBills')}
            </p>
          ) : (
            <>
              <div className="catalog-table-wrap sales-table-wrap">
                <table className={`catalog-table sales-table${panelOpen ? ' sales-table--compact' : ''}`}>
                  <caption className="visually-hidden">{t('salesTitle')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('salesColBill')}</th>
                      <th scope="col">{t('salesColTime')}</th>
                      <th scope="col">{t('salesColCustomer')}</th>
                      <th scope="col" className="catalog-table__num sales-table__opt">
                        {t('salesColItems')}
                      </th>
                      <th scope="col" className="sales-table__opt">{t('salesColPaid')}</th>
                      <th scope="col" className="catalog-table__num">
                        {t('salesColTotal')}
                      </th>
                    </tr>
                  </thead>
                  <tbody ref={tableRef}>
                    {items.map((s) => {
                      const active = s.id === selectedId;
                      const gone = s.status !== 'active';
                      return (
                        <tr
                          key={s.id}
                          data-sale-id={s.id}
                          className={[active ? 'is-selected' : '', gone ? 'sales-row--gone' : '']
                            .filter(Boolean)
                            .join(' ') || undefined}
                          onClick={() => setSelectedId(s.id)}
                        >
                          <td>
                            <button
                              type="button"
                              className="sales-table__bill"
                              aria-pressed={active}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedId(s.id);
                              }}
                            >
                              <span className="ltr-isolate">#{s.short_id}</span>
                            </button>
                            {statusTag(s)}
                          </td>
                          <td className="ltr-isolate sales-table__time">{rowTime(s.recorded_at)}</td>
                          <td className="sales-table__customer" dir="auto">
                            {s.party_name ? (
                              s.party_name
                            ) : (
                              <span className="muted">{t('walkInDefault')}</span>
                            )}
                          </td>
                          <td className="catalog-table__num ltr-isolate sales-table__opt">
                            {s.item_count}
                          </td>
                          <td className="sales-table__opt">
                            <span className={paidChipClass(s.payment_method)}>
                              {t(paidKey(s.payment_method))}
                            </span>
                          </td>
                          <td className="catalog-table__num sales-table__total">
                            <span className="ltr-isolate">{formatRs(s.total_paisa)}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager
                page={data?.page ?? 1}
                pageSize={PAGE_SIZE}
                total={data?.total ?? 0}
                disabled={loading}
                onPage={setPage}
              />
            </>
          )}
        </section>

        {panelOpen ? (
          <aside className="sales__panel" aria-label={t('salesBillDetail')}>
            {detailFailed ? (
              <div className="sales-empty" role="alert">
                <p>{t('salesLoadFailed')}</p>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => selectedId && void loadDetail(selectedId)}
                >
                  {t('retry')}
                </button>
              </div>
            ) : !detail || detail.id !== selectedId ? (
              <p className="muted" role="status">
                {t('loading')}
              </p>
            ) : (
              <SaleDetailPanel
                sale={detail}
                full={timeFmt.full}
                printing={printing}
                onReprint={() => void reprint()}
                onClose={() => setSelectedId(null)}
                onOpen={(id) => setSelectedId(id)}
                canChange={isOwner}
                onRemove={openRemove}
                onReturn={onReturnItems ? () => onReturnItems(detail.id) : undefined}
                onEdit={onEditSale ? () => onEditSale(detail) : undefined}
              />
            )}
          </aside>
        ) : null}
      </div>

      {removing && detail ? (
        <ConfirmModal
          title={t('salesRemoveTitle').replace('{id}', detail.short_id)}
          message={t('salesRemoveMsg')}
          confirmLabel={t('salesRemove')}
          cancelLabel={t('cancel')}
          busy={removeBusy}
          confirmDisabled={!reasonText}
          onConfirm={() => void confirmRemove()}
          onCancel={() => setRemoving(false)}
        >
          <div className="sales-remove">
            <span className="sales-remove__label">{t('salesReason')}</span>
            <div className="sales-remove__reasons" role="group" aria-label={t('salesReason')}>
              {REMOVE_REASONS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`sales-seg__btn sales-remove__reason${removeReason === k ? ' is-active' : ''}`}
                  aria-pressed={removeReason === k}
                  onClick={() => setRemoveReason(k)}
                >
                  {t(k)}
                </button>
              ))}
            </div>
            {removeReason === 'salesReasonOther' ? (
              <input
                className="sales-remove__note"
                autoFocus
                maxLength={200}
                aria-label={t('salesReason')}
                value={removeNote}
                onChange={(e) => setRemoveNote(e.target.value)}
              />
            ) : null}
          </div>
        </ConfirmModal>
      ) : null}
    </div>
  );
}

function SaleDetailPanel({
  sale,
  full,
  printing,
  onReprint,
  onClose,
  onOpen,
  canChange,
  onRemove,
  onReturn,
  onEdit,
}: {
  sale: SaleDetail;
  full: Intl.DateTimeFormat;
  printing: boolean;
  onReprint: () => void;
  onClose: () => void;
  onOpen: (id: string) => void;
  canChange: boolean;
  onRemove: () => void;
  onReturn?: () => void;
  onEdit?: () => void;
}) {
  const { t } = useI18n();
  const when = (() => {
    const d = new Date(sale.recorded_at);
    return Number.isNaN(d.getTime()) ? '' : full.format(d);
  })();
  const removedWhen = (() => {
    if (!sale.voided_at) return '';
    const d = new Date(sale.voided_at);
    return Number.isNaN(d.getTime()) ? '' : full.format(d);
  })();
  const isCashPart = sale.payment_method === 'cash' || sale.payment_method === 'split';

  return (
    <div className="sale-detail">
      <header className="sale-detail__head">
        <div className="sale-detail__title-row">
          <h3 className="sale-detail__title">
            {t('salesColBill')} <span className="ltr-isolate">#{sale.short_id}</span>
          </h3>
          {sale.status === 'removed' ? (
            <span className="chip chip--danger">{t('salesStatusRemoved')}</span>
          ) : sale.status === 'replaced' ? (
            <span className="chip chip--neutral">{t('salesTagReplaced')}</span>
          ) : sale.return_state === 'full' ? (
            <span className="chip chip--warn">{t('salesTagReturned')}</span>
          ) : sale.return_state === 'part' ? (
            <span className="chip chip--warn">{t('salesTagPartReturned')}</span>
          ) : null}
          <button
            type="button"
            className="sale-detail__close"
            aria-label={t('salesClose')}
            title={t('salesClose')}
            onClick={onClose}
          >
            <NavIcon name="close" />
          </button>
        </div>
        <p className="muted sale-detail__meta">
          <span className="ltr-isolate">{when}</span>
          {sale.sold_by?.name ? (
            <>
              {' · '}
              <span dir="auto">{sale.sold_by.name}</span>
            </>
          ) : null}
        </p>
      </header>

      {sale.status !== 'active' ? (
        <div className="sale-detail__removed" role="note">
          {sale.replaced_by ? (
            <p>
              {t('salesReplacedBy')}{' '}
              <button
                type="button"
                className="sale-detail__link ltr-isolate"
                onClick={() => onOpen(sale.replaced_by!.id)}
              >
                #{sale.replaced_by.short_id}
              </button>
            </p>
          ) : null}
          {sale.void_reason ? (
            <p>
              <span className="muted">{t('salesReason')}: </span>
              <span dir="auto">{sale.void_reason}</span>
            </p>
          ) : null}
          <p className="muted">
            {sale.voided_by_name ? (
              <span dir="auto">{sale.voided_by_name} · </span>
            ) : null}
            <span className="ltr-isolate">{removedWhen}</span>
          </p>
        </div>
      ) : null}

      {sale.replaces ? (
        <p className="sale-detail__replaces muted">
          {t('salesReplaces')}{' '}
          <button
            type="button"
            className="sale-detail__link ltr-isolate"
            onClick={() => onOpen(sale.replaces!.id)}
          >
            #{sale.replaces.short_id}
          </button>
        </p>
      ) : null}

      <div className="sale-detail__customer">
        {sale.party ? (
          <>
            <span className="sale-detail__customer-name" dir="auto">
              {sale.party.name}
            </span>
            {sale.party.phone ? (
              <span className="muted ltr-isolate">{sale.party.phone}</span>
            ) : null}
          </>
        ) : (
          <span className="muted">{t('walkInDefault')}</span>
        )}
      </div>

      <ul className="sale-detail__lines" aria-label={t('salesColItems')}>
        {sale.lines.map((l) => (
          <li key={l.id} className="sale-detail__line">
            <div className="sale-detail__line-top">
              <span className="sale-detail__line-name sale-line-thumb" dir="auto">
                <ProductThumb name={l.product_name} imageFile={l.image_file} className="initial-badge--sm" />
                {l.product_name}
              </span>
              <span className="ltr-isolate sale-detail__line-total">
                {formatRs(l.line_total_paisa)}
              </span>
            </div>
            <div className="muted sale-detail__line-meta">
              <span className="ltr-isolate">
                {l.qty} × {formatRs(l.unit_price_paisa)}
              </span>
              {l.returned_qty > 0 ? (
                <span className="chip chip--warn sale-detail__returned">
                  {t('salesReturnedQty').replace('{qty}', String(l.returned_qty))}
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <dl className="sale-detail__totals">
        <div className="sale-detail__row sale-detail__row--total">
          <dt>{t('salesColTotal')}</dt>
          <dd className="ltr-isolate">{formatRs(sale.total_paisa)}</dd>
        </div>
        <div className="sale-detail__row">
          <dt>{t('salesColPaid')}</dt>
          <dd>
            <span className={paidChipClass(sale.payment_method)}>
              {t(paidKey(sale.payment_method))}
            </span>
          </dd>
        </div>
        {sale.payment_method === 'split' ? (
          <>
            <div className="sale-detail__row">
              <dt>{t('salesPaidCash')}</dt>
              <dd className="ltr-isolate">{formatRs(sale.cash_amount_paisa)}</dd>
            </div>
            <div className="sale-detail__row">
              <dt>{t('salesPaidKhata')}</dt>
              <dd className="ltr-isolate">{formatRs(sale.udhaar_amount_paisa)}</dd>
            </div>
          </>
        ) : null}
        {isCashPart && sale.tendered_paisa > sale.cash_amount_paisa ? (
          <div className="sale-detail__row">
            <dt>{t('salesCashReceived')}</dt>
            <dd className="ltr-isolate">{formatRs(sale.tendered_paisa)}</dd>
          </div>
        ) : null}
        {isCashPart && sale.change_paisa > 0 ? (
          <div className="sale-detail__row">
            <dt>{t('salesChange')}</dt>
            <dd className="ltr-isolate">{formatRs(sale.change_paisa)}</dd>
          </div>
        ) : null}
        {sale.kept_on_khata_paisa > 0 ? (
          <div className="sale-detail__row">
            <dt>{t('salesKeptOnKhata')}</dt>
            <dd className="ltr-isolate">{formatRs(sale.kept_on_khata_paisa)}</dd>
          </div>
        ) : null}
      </dl>

      {sale.returns.length > 0 ? (
        <div className="sale-detail__returns">
          <h4 className="sale-detail__returns-title">{t('salesReturnsHeading')}</h4>
          <ul>
            {sale.returns.map((r) => (
              <li key={r.id} className="sale-detail__row">
                <span>
                  <span className="ltr-isolate">{r.short_id}</span>{' '}
                  <span className="muted ltr-isolate">{full.format(new Date(r.recorded_at))}</span>
                </span>
                <span className="ltr-isolate">−{formatRs(r.total_paisa)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {sale.status === 'active' ? (
        <div className="sale-detail__actions">
          <button
            type="button"
            className="btn btn--teal sale-detail__reprint"
            onClick={onReprint}
            disabled={printing}
          >
            <NavIcon name="receipt" />
            <span>{t('salesReprint')}</span>
          </button>
          {onReturn && sale.return_state !== 'full' ? (
            <button type="button" className="btn btn--ghost" onClick={onReturn}>
              {t('salesReturnItems')}
            </button>
          ) : null}
          {canChange && sale.day === sale.today && sale.returns.length === 0 ? (
            <>
              {onEdit ? (
                <button type="button" className="btn btn--ghost" onClick={onEdit}>
                  {t('salesEdit')}
                </button>
              ) : null}
              <button type="button" className="btn btn--ghost btn--danger" onClick={onRemove}>
                {t('salesRemove')}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
