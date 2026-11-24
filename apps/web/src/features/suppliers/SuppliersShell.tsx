import { SupplierReturnModal } from './SupplierReturnModal';
import { PageHeader } from '../shared/PageHeader';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UrHint, translateError, useI18n } from '../../i18n';
import { apiGet, apiPatchRaw, apiPost } from '../../lib/api';
import { parseMoneyRs } from '../shared/amount';
import { EmptyState } from '../shared/EmptyState';
import { NO_SUPPLIER_ID, supplierLabel } from '../shared/noSupplier';
import { Pager } from '../shared/Pager';
import { MoneyInput } from '../shared/MoneyInput';
import { formatRsShort } from '../../lib/money';
import { fmtDate } from '../shared/dates';

const PAGE_SIZE = 20;

type Supplier = {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  address: string | null;
  due_paisa: number;
  given_paisa: number;
  balance_paisa: number;
};

type Payment = {
  id: string;
  amount_paisa: number;
  paid_on: string;
  note: string | null;
};

type Invoice = {
  id: string;
  purchased_on: string;
  total_paisa: number;
  paid_paisa: number;
  due_paisa: number;
};

type Props = {
  displayName: string;
  onOpenPurchase?: (purchaseId: string) => void;
  /** Data entry: contacts and bills only, no balances or payments. */
  showMoney?: boolean;
};

const formatRs = formatRsShort;

function formatDay(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  return fmtDate(ymd);
}

function isReservedNoSupplierName(raw: string, noneLabel: string): boolean {
  const name = raw.trim().toLowerCase();
  if (!name) return false;
  const reserved = new Set(
    ['no supplier', 'کوئی سپلائر نہیں', noneLabel.trim().toLowerCase()].filter(Boolean),
  );
  return reserved.has(name);
}

export function SuppliersShell({ displayName, onOpenPurchase, showMoney = true }: Props) {
  const moneyCls = showMoney ? '' : ' dd-no-money';
  const { t } = useI18n();
  const [items, setItems] = useState<Supplier[]>([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [today, setToday] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Supplier | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [returns, setReturns] = useState<Array<{ id: string; short_id: string; total_paisa: number; note: string | null; returned_on: string }>>([]);
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [formMode, setFormMode] = useState<'add' | 'edit' | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState('');
  const [payNote, setPayNote] = useState('');
  const [payBusy, setPayBusy] = useState(false);
  const [payMsg, setPayMsg] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const payAmountRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const list = await apiGet<{
      items: Supplier[];
      total: number;
      today: string;
    }>('/suppliers');
    setItems(list.items);
    setToday(list.today);
    setPayDate((prev) => prev || list.today);
    setLoaded(true);
    return list.items;
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const res = await apiGet<
      | {
          ok: true;
          supplier: Supplier;
          payments: Payment[];
          invoices: Invoice[];
          today: string;
          returns?: Array<{ id: string; short_id: string; total_paisa: number; note: string | null; returned_on: string }>;
        }
      | { ok: false; error: string }
    >(`/suppliers/${encodeURIComponent(id)}`);
    if (!res.ok) {
      setError(res.error);
      setDetail(null);
      setPayments([]);
      setInvoices([]);
      return;
    }
    setDetail(res.supplier);
    setPayments(res.payments);
    setReturns(res.returns ?? []);
    setInvoices(res.invoices ?? []);
    setToday(res.today);
    setPayDate((prev) => prev || res.today);
    setItems((prev) =>
      prev.map((row) => (row.id === res.supplier.id ? res.supplier : row)),
    );
  }, []);

  useEffect(() => {
    refresh().catch(() => {
      setLoaded(true);
      setError('error_generic');
    });
  }, [refresh]);

  // SU2: Send Back belongs to one supplier — close it whenever the selection changes / clears.
  useEffect(() => {
    setSendBackOpen(false);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setPayments([]);
      setInvoices([]);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    loadDetail(selectedId)
      .catch(() => {
        if (!cancelled) setError('supplier_not_found');
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, loadDetail]);

  useEffect(() => {
    if (!formMode) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || busy) return;
      setFormMode(null);
      setEditingId(null);
      setName('');
      setContactName('');
      setPhone('');
      setAddress('');
      setError(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [formMode, busy]);

  useEffect(() => {
    // Send Back modal owns Escape while open (it would otherwise unmount with its lines).
    if (!selectedId || formMode || sendBackOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || busy || payBusy) return;
      setSelectedId(null);
      setDetail(null);
      setPayments([]);
      setInvoices([]);
      setError(null);
      setPayMsg(null);
      setPayAmount('');
      setPayNote('');
      setAmountError(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, formMode, sendBackOpen, busy, payBusy]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((s) => {
      const label = supplierLabel(s.id, s.name, t).toLowerCase();
      const contactText = (s.contact_name ?? '').toLowerCase();
      const phoneText = (s.phone ?? '').toLowerCase();
      const addressText = (s.address ?? '').toLowerCase();
      return (
        label.includes(q) ||
        s.name.toLowerCase().includes(q) ||
        contactText.includes(q) ||
        phoneText.includes(q) ||
        addressText.includes(q)
      );
    });
  }, [items, search, t]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  function closeForm() {
    if (busy) return;
    setFormMode(null);
    setEditingId(null);
    setName('');
    setContactName('');
    setPhone('');
    setAddress('');
    setError(null);
  }

  function openAdd() {
    setFormMode('add');
    setEditingId(null);
    setName('');
    setContactName('');
    setPhone('');
    setAddress('');
    setError(null);
    setPayMsg(null);
    window.setTimeout(() => nameInputRef.current?.focus(), 50);
  }

  function openEdit(supplier: Supplier) {
    if (supplier.id === NO_SUPPLIER_ID) {
      setError('supplier_system_locked');
      return;
    }
    setFormMode('edit');
    setEditingId(supplier.id);
    setName(supplier.name);
    setContactName(supplier.contact_name ?? '');
    setPhone(supplier.phone ?? '');
    setAddress(supplier.address ?? '');
    setError(null);
    setPayMsg(null);
    window.setTimeout(() => nameInputRef.current?.focus(), 50);
  }

  function openSupplier(id: string) {
    setError(null);
    setPayMsg(null);
    setPayAmount('');
    setPayNote('');
    setAmountError(null);
    setFormMode(null);
    setEditingId(null);
    setSelectedId(id);
  }

  function backToList() {
    setSelectedId(null);
    setDetail(null);
    setPayments([]);
    setInvoices([]);
    setError(null);
    setPayMsg(null);
    setPayAmount('');
    setPayNote('');
    setAmountError(null);
  }

  async function saveSupplier(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const trimmed = name.trim();
    try {
      if (isReservedNoSupplierName(trimmed, t('supplierNone'))) {
        setError('supplier_reserved_name');
        return;
      }
      const payload = {
        name: trimmed,
        contact_name: contactName.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
      };
      if (formMode === 'edit' && editingId) {
        const res = await apiPatchRaw<
          { ok: true; supplier: Supplier } | { ok: false; error: string }
        >(`/suppliers/${encodeURIComponent(editingId)}`, payload);
        const body = res.json;
        if (!res.ok || !body || body.ok === false) {
          const code =
            body && 'error' in body && body.error
              ? String(body.error)
              : 'edit_failed';
          setError(code);
          return;
        }
        setName('');
        setContactName('');
        setPhone('');
        setAddress('');
        setFormMode(null);
        setEditingId(null);
        await refresh();
        if (selectedId === body.supplier.id) {
          setDetail(body.supplier);
        }
        return;
      }
      const res = await apiPost<
        { ok: true; supplier: Supplier } | { ok: false; error: string }
      >('/suppliers', payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setName('');
      setContactName('');
      setPhone('');
      setAddress('');
      setFormMode(null);
      setEditingId(null);
      setSearch('');
      const next = await refresh();
      const idx = next.findIndex((s) => s.id === res.supplier.id);
      setPage(idx >= 0 ? Math.floor(idx / PAGE_SIZE) + 1 : 1);
    } catch {
      setError(formMode === 'edit' ? 'edit_failed' : 'error_generic');
    } finally {
      setBusy(false);
    }
  }

  async function paySupplier(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !detail) return;
    setError(null);
    setPayMsg(null);
    setAmountError(null);

    const amount = parseMoneyRs(payAmount);
    if (amount == null || amount <= 0) {
      setAmountError(t('collectAmountInvalid'));
      payAmountRef.current?.focus();
      return;
    }
    const amountPaisa = Math.round(amount * 100);
    if (amountPaisa > detail.balance_paisa) {
      setError('payment_too_large');
      return;
    }
    if (!payDate.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(payDate)) {
      setError('invalid_date');
      return;
    }

    setPayBusy(true);
    try {
      const res = await apiPost<
        { ok: true; supplier: Supplier } | { ok: false; error: string }
      >(`/suppliers/${encodeURIComponent(selectedId)}/payments`, {
        amountRs: amount,
        paidOn: payDate || today || undefined,
        note: payNote.trim() || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPayAmount('');
      setPayNote('');
      setPayDate(today);
      setPayMsg(t('collectRecorded'));
      if (res.supplier) setDetail(res.supplier);
      await refresh();
      await loadDetail(selectedId);
    } catch {
      setError('error_generic');
    } finally {
      setPayBusy(false);
    }
  }

  const formModal = formMode ? (
    <div className="pos-modal-backdrop" onClick={closeForm}>
      <form
        className="pos-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="supplier-form-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void saveSupplier(e)}
      >
        <h3 id="supplier-form-title">
          {formMode === 'edit' ? t('editSupplier') : t('supplierAdd')}
        </h3>
        <div className="field">
          <label htmlFor="sup-name">{t('supplierName')}</label>
          <input
            id="sup-name"
            ref={nameInputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor="sup-contact-name">{t('supplierContactNameOptional')}</label>
          <input
            id="sup-contact-name"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            maxLength={120}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor="sup-phone">{t('supplierPhoneOptional')}</label>
          <input
            id="sup-phone"
            className="ltr-isolate"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            maxLength={32}
            placeholder="03xx…"
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor="sup-address">{t('supplierAddressOptional')}</label>
          <input
            id="sup-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            maxLength={240}
            autoComplete="street-address"
          />
        </div>
        {error ? (
          <p className="parties-alert" role="alert">
            {translateError(t, error, {
              supplier_reserved_name: 'supplierReservedName',
              edit_failed: 'editSupplierFailed',
            })}
          </p>
        ) : null}
        <div className="pos-modal__actions">
          <button
            className="btn btn--teal"
            type="submit"
            disabled={busy || !name.trim()}
          >
            {busy
              ? t('loading')
              : formMode === 'edit'
                ? t('saveSupplier')
                : t('supplierAdd')}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={closeForm}
            disabled={busy}
          >
            {t('cancel')}
          </button>
        </div>
      </form>
    </div>
  ) : null;

  /* ── Detail view ── */
  if (selectedId) {
    if (detailLoading && !detail) {
      return (
        <div className={`card parties parties--detail${moneyCls}`}>
          <div className="parties-detail__nav">
            <button type="button" className="btn btn--ghost" onClick={backToList}>
              {t('supplierBack')}
            </button>
          </div>
          <p className="muted" role="status">
            {t('loading')}
          </p>
          {formModal}
        </div>
      );
    }

    if (!detail) {
      return (
        <div className={`card parties parties--detail${moneyCls}`}>
          <div className="parties-detail__nav">
            <button type="button" className="btn btn--ghost" onClick={backToList}>
              {t('supplierBack')}
            </button>
          </div>
          {error ? (
            <p className="parties-alert" role="alert">
              {translateError(t, error, {
                supplier_reserved_name: 'supplierReservedName',
                edit_failed: 'editSupplierFailed',
              })}
            </p>
          ) : null}
          {formModal}
        </div>
      );
    }

    const label = supplierLabel(detail.id, detail.name, t);
    const balance = detail.balance_paisa;
    const canEdit = detail.id !== NO_SUPPLIER_ID;

    return (
      <div className={`card parties parties--detail${moneyCls}`}>
        <div className="parties-detail__nav">
          <button type="button" className="btn btn--ghost" onClick={backToList}>
            {t('supplierBack')}
          </button>
        </div>

        <header className="parties-detail__header">
          <div className="parties-detail__identity">
            <div className="parties-detail__title-row">
              <h2 className="parties-detail__title">{label}</h2>
              {canEdit ? (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => openEdit(detail)}
                  disabled={busy}
                >
                  {t('editSupplier')}
                </button>
              ) : null}
            </div>
            <div className="parties-detail__meta">
              {detail.contact_name?.trim() ? (
                <span className="chip" dir="auto">
                  {detail.contact_name.trim()}
                </span>
              ) : null}
              {detail.phone?.trim() ? (
                <span className="chip ltr-isolate">{detail.phone}</span>
              ) : (
                <span className="muted ltr-isolate">—</span>
              )}
              {detail.address?.trim() ? (
                <span className="parties-detail__address" dir="auto">
                  {detail.address.trim()}
                </span>
              ) : null}
            </div>
            <div
              className={`parties-khata-summary${
                balance === 0 ? ' parties-khata-summary--zero' : ''
              }`}
              aria-label={t('supplierBalance')}
            >
              <div className="parties-khata-summary__item">
                <span className="parties-khata-summary__label muted">
                  {t('supplierDue')}
                </span>
                <strong className="ltr-isolate parties-khata-summary__value">
                  {formatRs(detail.due_paisa)}
                </strong>
              </div>
              <div className="parties-khata-summary__item">
                <span className="parties-khata-summary__label muted">
                  {t('supplierGiven')}
                </span>
                <strong className="ltr-isolate parties-khata-summary__value">
                  {formatRs(detail.given_paisa)}
                </strong>
              </div>
              <div className="parties-khata-summary__item parties-khata-summary__item--due">
                <span className="parties-khata-summary__label muted">
                  {t('supplierBalance')}
                </span>
                <strong
                  className={`ltr-isolate parties-khata-summary__value parties-khata-summary__due${
                    balance === 0 ? ' parties-khata-summary__due--zero' : ''
                  }`}
                >
                  {formatRs(balance)}
                </strong>
              </div>
            </div>
          </div>
        </header>

        <div className="parties-detail__body">
          {balance === 0 ? (
            <p className="muted parties-zero">{t('supplierZeroBalance')}</p>
          ) : (
            <section
              className="parties-collect"
              aria-label={t('supplierPay')}
            >
              <div className="parties-collect__head">
                <h3 className="parties-section-title">{t('supplierPay')}</h3>
              </div>
              <form
                className="parties-collect__form"
                onSubmit={(e) => void paySupplier(e)}
              >
                <div className="field parties-collect__amount-field">
                  <label htmlFor="sup-pay-amount">{t('expenseAmountRs')}</label>
                  <MoneyInput
                    id="sup-pay-amount"
                    ref={payAmountRef}
                    value={payAmount}
                    onValueChange={(v) => {
                      setPayAmount(v);
                      if (amountError) setAmountError(null);
                      if (payMsg) setPayMsg(null);
                    }}
                    placeholder="0"
                    aria-invalid={amountError ? true : undefined}
                    aria-describedby={amountError ? 'sup-pay-amount-error' : undefined}
                  />
                  {amountError ? (
                    <p id="sup-pay-amount-error" className="parties-field-error" role="alert">
                      {amountError}
                    </p>
                  ) : null}
                </div>
                <div className="field parties-collect__date-field">
                  <label htmlFor="sup-pay-date">{t('supplierPayDate')}</label>
                  <input
                    id="sup-pay-date"
                    className="ltr-isolate"
                    type="date"
                    value={payDate}
                    onChange={(e) => {
                      setPayDate(e.target.value);
                      if (payMsg) setPayMsg(null);
                    }}
                    required
                  />
                </div>
                <div className="field parties-collect__note-field">
                  <label htmlFor="sup-pay-note">{t('supplierNoteOptional')}</label>
                  <input
                    id="sup-pay-note"
                    value={payNote}
                    onChange={(e) => setPayNote(e.target.value)}
                    maxLength={240}
                  />
                </div>
                <div className="parties-collect__submit">
                  <button
                    className="btn btn--teal"
                    type="submit"
                    disabled={payBusy}
                  >
                    {payBusy ? t('loading') : t('supplierPay')}
                  </button>
                </div>
              </form>
              {error && !formMode ? (
                <p className="parties-alert" role="alert">
                  {translateError(t, error, {
                    supplier_reserved_name: 'supplierReservedName',
                    edit_failed: 'editSupplierFailed',
                  })}
                </p>
              ) : null}
              {payMsg ? (
                <p className="parties-success" role="status">
                  {payMsg}
                </p>
              ) : null}
            </section>
          )}

          {balance === 0 && error && !formMode ? (
            <p className="parties-alert" role="alert">
              {translateError(t, error, {
                supplier_reserved_name: 'supplierReservedName',
                edit_failed: 'editSupplierFailed',
              })}
            </p>
          ) : null}
          {balance === 0 && payMsg ? (
            <p className="parties-success" role="status">
              {payMsg}
            </p>
          ) : null}

          <section className="parties-ledger" aria-label={t('supplierInvoices')}>
            <h3 className="parties-section-title">{t('supplierInvoices')}</h3>
            {invoices.length === 0 ? (
              <p className="muted">{t('supplierNoInvoices')}</p>
            ) : (
              <div className="catalog-table-wrap parties-ledger-wrap">
                <table className="catalog-table parties-ledger-table">
                  <caption className="visually-hidden">{t('supplierInvoices')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('purchaseDate')}</th>
                      <th scope="col" className="catalog-table__num">
                        {t('purchaseTotal')}
                      </th>
                      <th scope="col" className="catalog-table__num">
                        {t('purchasePaid')}
                      </th>
                      <th scope="col" className="catalog-table__num">
                        {t('purchaseDue')}
                      </th>
                      {onOpenPurchase ? (
                        <th scope="col" className="parties-table__col-actions">
                          {t('suppliersColActions')}
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td>
                          <span className="ltr-isolate parties-ledger__time">
                            {formatDay(inv.purchased_on)}
                          </span>
                        </td>
                        <td className="catalog-table__num">
                          <strong className="ltr-isolate parties-ledger__amt">
                            {formatRs(inv.total_paisa)}
                          </strong>
                        </td>
                        <td className="catalog-table__num">
                          <span className="ltr-isolate">{formatRs(inv.paid_paisa)}</span>
                        </td>
                        <td className="catalog-table__num">
                          <span
                            className={`ltr-isolate parties-ledger__bal${
                              inv.due_paisa === 0 ? ' parties-table__amount--zero' : ''
                            }`}
                          >
                            {formatRs(inv.due_paisa)}
                          </span>
                        </td>
                        {onOpenPurchase ? (
                          <td className="parties-table__col-actions">
                            <button
                              type="button"
                              className="btn btn--ghost"
                              onClick={() => onOpenPurchase(inv.id)}
                            >
                              {t('viewPurchase')}
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

          <section className="parties-ledger dd-money" aria-label={t('supplierReturns')} data-supplier-returns>
            <div className="b2-toolbar">
              <h3 className="parties-section-title" style={{ margin: 0 }}>{t('supplierReturns')}</h3>
              {showMoney ? (
                <button type="button" className="btn btn--ghost" onClick={() => setSendBackOpen(true)} data-send-back>
                  {t('supplierSendBack')}
                </button>
              ) : null}
            </div>
            {returns.length === 0 ? null : (
              <div className="catalog-table-wrap parties-ledger-wrap">
                <table className="catalog-table parties-ledger-table">
                  <tbody>
                    {returns.map((r) => (
                      <tr key={r.id}>
                        <td><span className="ltr-isolate parties-ledger__time">{formatDay(r.returned_on)}</span></td>
                        <td className="ltr-isolate">#{r.short_id}</td>
                        <td className="catalog-table__num"><strong className="ltr-isolate parties-ledger__amt">{formatRs(r.total_paisa)}</strong></td>
                        <td>{r.note ? <span className="parties-ledger__note">{r.note}</span> : <span className="muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {sendBackOpen && detail ? (
            <SupplierReturnModal
              supplierId={detail.id}
              supplierName={detail.name}
              onClose={() => setSendBackOpen(false)}
              onSaved={() => {
                setSendBackOpen(false);
                void loadDetail(detail.id);
              }}
            />
          ) : null}

          <section className="parties-ledger dd-money" aria-label={t('supplierPayments')}>
            <h3 className="parties-section-title">{t('supplierPayments')}</h3>
            {payments.length === 0 ? (
              <p className="muted">{t('supplierNoPayments')}</p>
            ) : (
              <div className="catalog-table-wrap parties-ledger-wrap">
                <table className="catalog-table parties-ledger-table">
                  <caption className="visually-hidden">{t('supplierPayments')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('purchaseDate')}</th>
                      <th scope="col" className="catalog-table__num">
                        {t('supplierGiven')}
                      </th>
                      <th scope="col">{t('purchaseNote')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <span className="ltr-isolate parties-ledger__time">
                            {formatDay(p.paid_on)}
                          </span>
                        </td>
                        <td className="catalog-table__num">
                          <strong className="ltr-isolate parties-ledger__amt">
                            {formatRs(p.amount_paisa)}
                          </strong>
                        </td>
                        <td>
                          {p.note ? (
                            <span className="parties-ledger__note">{p.note}</span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
        {formModal}
      </div>
    );
  }

  /* ── List view ── */
  const isEmpty = loaded && items.length === 0;
  const isEmptySearch = !isEmpty && filtered.length === 0;

  return (
    <div className={`card parties${moneyCls}`}>
      <PageHeader
        title={<>{t('suppliersTitle')}<UrHint k="suppliersTitle" /></>}
        subtitle={displayName}
      />

      <div className="parties__toolbar">
        <div className="catalog-search field">
          <label className="visually-hidden" htmlFor="suppliers-search">
            {t('supplierSearch')}
          </label>
          <input
            id="suppliers-search"
            className="catalog-search__input"
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t('supplierSearch')}
            disabled={items.length === 0}
          />
        </div>
        <div className="parties__toolbar-actions">
          <button
            type="button"
            className="btn btn--teal"
            onClick={openAdd}
            disabled={busy}
          >
            {t('supplierAdd')}
          </button>
        </div>
      </div>

      {error && !formMode ? (
        <p className="parties-alert" role="alert">
          {translateError(t, error, {
            supplier_reserved_name: 'supplierReservedName',
            edit_failed: 'editSupplierFailed',
          })}
        </p>
      ) : null}

      <section className="parties__list" aria-label={t('supplierList')}>
        {!loaded && !error ? (
          <p className="muted parties-empty-search" role="status">
            {t('loading')}
          </p>
        ) : isEmpty ? (
          <EmptyState
            title={t('supplierEmpty')}
            description={t('supplierEmptyDesc')}
            action={
              <button type="button" className="btn btn--teal" onClick={openAdd}>
                {t('supplierAddFirst')}
              </button>
            }
          />
        ) : isEmptySearch ? (
          <p className="muted parties-empty-search">{t('supplierNoMatches')}</p>
        ) : (
          <>
            <p className="catalog-table-count muted">
              {t('catalogShowing')
                .replace('{from}', String((safePage - 1) * PAGE_SIZE + 1))
                .replace('{to}', String((safePage - 1) * PAGE_SIZE + visible.length))
                .replace('{total}', String(filtered.length))}
            </p>
            <div className="catalog-table-wrap">
              <table className="catalog-table parties-table suppliers-table">
                <caption className="visually-hidden">{t('supplierList')}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="catalog-table__col-product">
                      {t('suppliersColSupplier')}
                    </th>
                    <th scope="col" className="parties-table__col-phone">
                      {t('suppliersColPhone')}
                    </th>
                    <th scope="col" className="catalog-table__num">
                      {t('supplierDue')}
                    </th>
                    <th scope="col" className="catalog-table__num">
                      {t('supplierGiven')}
                    </th>
                    <th scope="col" className="catalog-table__num">
                      {t('supplierBalance')}
                    </th>
                    <th scope="col" className="parties-table__col-actions">
                      {t('suppliersColActions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((s) => {
                    const label = supplierLabel(s.id, s.name, t);
                    const contactTitle = s.contact_name?.trim() || '';
                    const phoneTitle = s.phone?.trim() || '';
                    const addrTitle = s.address?.trim() || '';
                    const titleBits = [label, contactTitle, phoneTitle, addrTitle].filter(
                      Boolean,
                    );
                    const canEdit = s.id !== NO_SUPPLIER_ID;
                    return (
                      <tr key={s.id}>
                        <td className="catalog-table__col-product">
                          <button
                            type="button"
                            className="catalog-table__select"
                            title={titleBits.join(' · ')}
                            onClick={() => openSupplier(s.id)}
                          >
                            <span className="catalog-table__name" dir="auto">
                              {label}
                            </span>
                            {contactTitle ? (
                              <span className="catalog-table__meta">
                                <span className="parties-table__contact" dir="auto">
                                  {contactTitle}
                                </span>
                              </span>
                            ) : null}
                          </button>
                        </td>
                        <td className="parties-table__col-phone">
                          {phoneTitle ? (
                            <span className="parties-table__phone ltr-isolate">
                              <span className="visually-hidden">
                                {t('supplierPhone')}:{' '}
                              </span>
                              {phoneTitle}
                            </span>
                          ) : (
                            <span className="muted ltr-isolate">—</span>
                          )}
                        </td>
                        <AmountCell paisa={s.due_paisa} />
                        <AmountCell paisa={s.given_paisa} />
                        <AmountCell paisa={s.balance_paisa} strong />
                        <td className="parties-table__col-actions">
                          <div className="parties-table__actions">
                            <button
                              type="button"
                              className="btn btn--ghost parties-table__khata"
                              onClick={() => openSupplier(s.id)}
                              disabled={busy}
                            >
                              {t('openSupplier')}
                            </button>
                            {canEdit ? (
                              <button
                                type="button"
                                className="btn btn--ghost parties-table__khata"
                                onClick={() => openEdit(s)}
                                disabled={busy}
                              >
                                {t('editSupplier')}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager
              page={safePage}
              pageSize={PAGE_SIZE}
              total={filtered.length}
              disabled={busy}
              onPage={setPage}
            />
          </>
        )}
      </section>

      {formModal}
    </div>
  );
}

/** Right-aligned money cell; zero amounts drop to secondary ink. */
function AmountCell({ paisa, strong = false }: { paisa: number; strong?: boolean }) {
  const cls = ['catalog-table__num'];
  if (strong) cls.push('parties-table__amount');
  if (paisa === 0) cls.push('parties-table__amount--zero');
  return (
    <td className={cls.join(' ')}>
      <span className="ltr-isolate">{formatRs(paisa)}</span>
    </td>
  );
}
