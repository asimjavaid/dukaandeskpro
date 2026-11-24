import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../shared/PageHeader';
import { UrHint, translateError, useI18n } from '../../i18n';
import { apiGet, apiPatchRaw, apiPost, apiPostRaw } from '../../lib/api';
import { parseMoneyRs } from '../shared/amount';
import { EmptyState } from '../shared/EmptyState';
import { Pager } from '../shared/Pager';
import { MoneyInput } from '../shared/MoneyInput';
import { formatRsShort } from '../../lib/money';
import { InitialBadge } from '../shared/InitialBadge';
import { fmtDate, fmtDateTime } from '../shared/dates';
import { khataReminderText, openWhatsApp, waPhone } from './whatsapp';
import { OffersPanel } from './OffersPanel';

const PAGE_SIZE = 20;

type Party = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  balance_paisa: number;
  credit_limit_paisa?: number | null;
  balance_hidden?: boolean;
  loyalty_points?: number;
  created_at?: string;
};

type LedgerEntry = {
  id: string;
  party_id: string;
  entry_type: 'debit' | 'credit';
  amount_paisa: number;
  sale_id: string | null;
  note: string | null;
  collected_on: string | null;
  created_at: string;
};

type Props = {
  displayName: string;
  /** Open with the "Owes money" filter on (biggest balance first), e.g. from Analytics. */
  initialOwedOnly?: boolean;
  /** Open this customer's khata directly, e.g. from Analytics. */
  initialPartyId?: string | null;
  onInitialConsumed?: () => void;
  /** Data entry: add/edit customers, no cash collection. */
  canCollect?: boolean;
  isOwner?: boolean;
};

const formatRs = formatRsShort;

/** Ledger day: the collection's business date, else when it was written. */
function formatLedgerDate(entry: LedgerEntry): string {
  if (entry.collected_on && /^\d{4}-\d{2}-\d{2}$/.test(entry.collected_on)) return fmtDate(entry.collected_on);
  return fmtDateTime(entry.created_at);
}

/** Shop-day YYYY-MM-DD in Asia/Karachi. */
function todayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

type ListFilter = 'all' | 'owes' | 'clear' | 'over';
type ListSort = 'name' | 'balance' | 'newest';

function overLimit(p: Party): boolean {
  return !p.balance_hidden && p.credit_limit_paisa != null && p.credit_limit_paisa > 0 && p.balance_paisa > p.credit_limit_paisa;
}

/** Chronological key for ledger: business date then created_at then id. */
function ledgerChronoKey(entry: LedgerEntry): string {
  const day =
    entry.collected_on && /^\d{4}-\d{2}-\d{2}$/.test(entry.collected_on)
      ? entry.collected_on
      : entry.created_at.slice(0, 10);
  return `${day}\0${entry.created_at}\0${entry.id}`;
}

/** Running balance after each entry (debits − credits), keyed by entry id. */
function runningBalances(entries: LedgerEntry[]): Map<string, number> {
  const chrono = [...entries].sort((a, b) =>
    ledgerChronoKey(a).localeCompare(ledgerChronoKey(b)),
  );
  const map = new Map<string, number>();
  let bal = 0;
  for (const e of chrono) {
    bal += e.entry_type === 'debit' ? e.amount_paisa : -e.amount_paisa;
    map.set(e.id, bal);
  }
  return map;
}

export function PartiesShell({
  displayName,
  initialOwedOnly,
  initialPartyId,
  onInitialConsumed,
  canCollect = true,
  isOwner = false,
}: Props) {
  const [offersOpen, setOffersOpen] = useState(false);
  const collectCls = canCollect ? '' : ' dd-no-collect dd-no-money';
  const [limitRs, setLimitRs] = useState('');
  const [storeName, setStoreName] = useState('');
  useEffect(() => {
    apiGet<{ store?: { name?: string } | null }>('/auth/status')
      .then((s) => setStoreName(s.store?.name ?? ''))
      .catch(() => undefined);
  }, []);
  const [limitBusy, setLimitBusy] = useState(false);
  async function saveLimit(partyId: string) {
    setLimitBusy(true);
    const v = limitRs.trim();
    const r = await apiPostRaw<{ ok: boolean; party?: Party }>(`/parties/${encodeURIComponent(partyId)}/credit-limit`, {
      limitRs: v === '' || Number(v) === 0 ? null : Number(v),
    }).catch(() => null);
    setLimitBusy(false);
    if (r?.json?.ok) {
      setDetail((d) => (d ? { ...d, credit_limit_paisa: v === '' || Number(v) === 0 ? null : Math.round(Number(v) * 100) } : d));
    }
  }
  const { t } = useI18n();
  const [items, setItems] = useState<Party[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ListFilter>(initialOwedOnly ? 'owes' : 'all');
  const [sort, setSort] = useState<ListSort>(initialOwedOnly ? 'balance' : 'name');
  const [activeIdx, setActiveIdx] = useState(-1);
  const tableRef = useRef<HTMLTableSectionElement>(null);
  const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [formMode, setFormMode] = useState<'add' | 'edit' | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Party | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [collectRs, setCollectRs] = useState('');
  const [collectDate, setCollectDate] = useState(() => todayYmd());
  const [collectNote, setCollectNote] = useState('');
  const [collectMsg, setCollectMsg] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const collectAmountRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const r = await apiGet<{ items: Party[] }>('/parties');
    setItems(r.items);
    setLoaded(true);
    return r.items;
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const r = await apiGet<{ ok: true; party: Party; ledger: LedgerEntry[] }>(
      `/parties/${id}`,
    );
    setDetail(r.party);
    setLedger(r.ledger);
  }, []);

  useEffect(() => {
    refresh().catch(() => {
      setLoaded(true);
      setError('parties_unavailable');
    });
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setLedger([]);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    loadDetail(selectedId)
      .catch(() => {
        if (!cancelled) setError('party_detail_unavailable');
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, loadDetail]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let base = items.filter((p) => {
      if (filter === 'owes') return p.balance_paisa > 0;
      if (filter === 'clear') return p.balance_paisa <= 0;
      if (filter === 'over') return overLimit(p);
      return true;
    });
    if (q) {
      base = base.filter((p) => {
        const n = p.name.toLowerCase();
        const ph = (p.phone ?? '').toLowerCase();
        const ad = (p.address ?? '').toLowerCase();
        return n.includes(q) || ph.includes(q) || ad.includes(q);
      });
    }
    const byName = (a: Party, b: Party) => a.name.localeCompare(b.name);
    if (sort === 'balance') return [...base].sort((a, b) => b.balance_paisa - a.balance_paisa || byName(a, b));
    if (sort === 'newest') return [...base].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '') || byName(a, b));
    return base;
  }, [items, search, filter, sort]);

  const stats = useMemo(() => {
    const owing = items.filter((p) => p.balance_paisa > 0);
    return {
      count: items.length,
      owed: owing.reduce((s, p) => s + p.balance_paisa, 0),
      owing: owing.length,
      over: items.filter(overLimit).length,
    };
  }, [items]);

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
    setPhone('');
    setAddress('');
    setError(null);
  }

  function openAdd() {
    setFormMode('add');
    setEditingId(null);
    setName('');
    setPhone('');
    setAddress('');
    setError(null);
    setCollectMsg(null);
    window.setTimeout(() => nameInputRef.current?.focus(), 50);
  }

  function openEdit(party: Party) {
    setFormMode('edit');
    setEditingId(party.id);
    setName(party.name);
    setPhone(party.phone ?? '');
    setAddress(party.address ?? '');
    setError(null);
    setCollectMsg(null);
    window.setTimeout(() => nameInputRef.current?.focus(), 50);
  }

  function openParty(id: string) {
    setError(null);
    setCollectMsg(null);
    setCollectRs('');
    setCollectDate(todayYmd());
    setCollectNote('');
    setAmountError(null);
    setFormMode(null);
    setEditingId(null);
    setSelectedId(id);
  }

  // One-shot deep link from Analytics (open a khata, or the owes-money list).
  useEffect(() => {
    if (initialPartyId) openParty(initialPartyId);
    if (initialPartyId || initialOwedOnly) onInitialConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function backToList() {
    setSelectedId(null);
    setDetail(null);
    setLedger([]);
    setError(null);
    setCollectMsg(null);
    setCollectRs('');
    setCollectDate(todayYmd());
    setCollectNote('');
    setAmountError(null);
  }

  useEffect(() => {
    if (!formMode) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || busy) return;
      setFormMode(null);
      setEditingId(null);
      setName('');
      setPhone('');
      setAddress('');
      setError(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [formMode, busy]);

  useEffect(() => {
    // Edit modal open over the detail: its own Escape closes it; don't also leave the detail.
    if (!selectedId || formMode) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || busy || e.defaultPrevented) return;
      setSelectedId(null);
      setDetail(null);
      setLedger([]);
      setError(null);
      setCollectMsg(null);
      setCollectRs('');
      setCollectDate(todayYmd());
      setCollectNote('');
      setAmountError(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, formMode, busy]);

  async function saveParty(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      name,
      phone: phone.trim() || null,
      address: address.trim() || null,
    };
    try {
      if (formMode === 'edit' && editingId) {
        const res = await apiPatchRaw<
          { ok: true; party: Party } | { ok: false; error: string }
        >(`/parties/${encodeURIComponent(editingId)}`, payload);
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
        setPhone('');
        setAddress('');
        setFormMode(null);
        setEditingId(null);
        await refresh();
        if (selectedId === body.party.id) {
          setDetail(body.party);
        }
        return;
      }
      const res = await apiPost<
        { ok: true; party: Party } | { ok: false; error: string }
      >('/parties', payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setName('');
      setPhone('');
      setAddress('');
      setFormMode(null);
      setEditingId(null);
      setSearch('');
      // Jump to the page the new customer landed on (list is sorted by name).
      const next = await refresh();
      const idx = next.findIndex((p) => p.id === res.party.id);
      setPage(idx >= 0 ? Math.floor(idx / PAGE_SIZE) + 1 : 1);
    } catch {
      setError(formMode === 'edit' ? 'edit_failed' : 'create_failed');
    } finally {
      setBusy(false);
    }
  }

  async function recordCollection(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !detail) return;
    setError(null);
    setCollectMsg(null);
    setAmountError(null);

    const rs = parseMoneyRs(collectRs);
    if (rs == null || rs <= 0) {
      setAmountError(t('collectAmountInvalid'));
      collectAmountRef.current?.focus();
      return;
    }
    if (!collectDate.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(collectDate)) {
      setError('invalid_date');
      return;
    }

    setBusy(true);
    try {
      const amount_paisa = Math.round(rs * 100);
      // Honesty: do not mutate balance / ledger until POST succeeds.
      const res = await apiPostRaw<{
        ok?: boolean;
        error?: string;
        message?: { ok?: boolean; error?: string; balance_paisa?: number };
        entry?: LedgerEntry;
        party?: Party;
      }>('/parties/' + selectedId + '/collections', {
        amount_paisa,
        note: collectNote.trim() || null,
        collected_on: collectDate,
      });
      if (!res.ok) {
        const nested =
          res.json && typeof res.json.message === 'object'
            ? res.json.message
            : res.json;
        const code = nested?.error ?? res.json?.error ?? 'collect_failed';
        if (code === 'amount_invalid') {
          setAmountError(t('collectAmountInvalid'));
        } else {
          setError(String(code));
        }
        return;
      }
      setCollectRs('');
      setCollectDate(todayYmd());
      setCollectNote('');
      setAmountError(null);
      setCollectMsg(t('collectRecorded'));
      // Prefer server party, then refresh detail + list from API (no optimistic drop).
      if (res.json?.party) setDetail(res.json.party);
      await loadDetail(selectedId);
      await refresh();
    } catch {
      setError('collect_failed');
    } finally {
      setBusy(false);
    }
  }

  // Keyboard: ↑/↓ move through rows, Enter opens the khata.
  useEffect(() => {
    setActiveIdx(-1);
  }, [search, filter, sort, safePage]);

  useEffect(() => {
    if (activeIdx < 0) return;
    tableRef.current?.querySelectorAll('tr')[activeIdx]?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  function onListKey(e: React.KeyboardEvent) {
    if (formMode || visible.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(visible.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && activeIdx >= 0 && visible[activeIdx]) {
      e.preventDefault();
      openParty(visible[activeIdx].id);
    }
  }

  const errorText = error
    ? translateError(t, error, { create_failed: 'addPartyFailed', edit_failed: 'editCustomerFailed' })
    : null;

  function renderForm() {
    if (!formMode) return null;
    return (
      <div className="pos-modal-backdrop" onClick={closeForm}>
        <form
          className="pos-modal cu-form"
          role="dialog"
          aria-modal="true"
          aria-labelledby="party-form-title"
          onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => void saveParty(e)}
        >
          <h3 id="party-form-title" className="cu-form__title">
            {formMode === 'edit' ? t('editCustomer') : t('addParty')}
          </h3>
          <div className="cu-form__grid">
            <div className="field cu-form__name">
              <label htmlFor="party-name">{t('partyName')}</label>
              <input
                id="party-name"
                ref={nameInputRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={120}
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="party-phone">{t('partyPhone')}</label>
              <input
                id="party-phone"
                className="ltr-isolate"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                maxLength={32}
                placeholder="03xx…"
                autoComplete="off"
              />
            </div>
            <div className="field cu-form__wide">
              <label htmlFor="party-address">{t('partyAddress')}</label>
              <input
                id="party-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                maxLength={240}
                autoComplete="street-address"
                dir="auto"
              />
            </div>
          </div>
          {errorText ? (
            <p className="parties-alert" role="alert">
              {errorText}
            </p>
          ) : null}
          <div className="pos-modal__actions cu-form__actions">
            <button type="button" className="btn btn--ghost" onClick={closeForm} disabled={busy}>
              {t('cancel')}
            </button>
            <button className="btn btn--teal" type="submit" disabled={busy || !name.trim()}>
              {busy ? t('loading') : formMode === 'edit' ? t('saveCustomer') : t('addParty')}
            </button>
          </div>
        </form>
      </div>
    );
  }

  /* ── Detail view ── */
  if (selectedId) {
    const backBtn = (
      <button type="button" className="btn btn--ghost cu-back" onClick={backToList}>
        <span aria-hidden="true">←</span> {t('backToParties')}
      </button>
    );
    if (detailLoading && !detail) {
      return (
        <div className={`card parties parties--detail cu cu-detail${collectCls}`}>
          <header className="page-head cu-detail__head">{backBtn}</header>
          <p className="muted" role="status">
            {t('loading')}
          </p>
        </div>
      );
    }

    if (!detail) {
      return (
        <div className={`card parties parties--detail cu cu-detail${collectCls}`}>
          <header className="page-head cu-detail__head">{backBtn}</header>
          {errorText ? (
            <p className="parties-alert" role="alert">
              {errorText}
            </p>
          ) : null}
        </div>
      );
    }

    const balance = detail.balance_paisa;
    const khataTotal = ledger.reduce((s, e) => s + (e.entry_type === 'debit' ? e.amount_paisa : 0), 0);
    const khataPaid = ledger.reduce((s, e) => s + (e.entry_type === 'credit' ? e.amount_paisa : 0), 0);
    const balanceAfter = runningBalances(ledger);
    const limit = detail.credit_limit_paisa ?? null;
    const usedPct = limit && limit > 0 ? Math.max(0, Math.round((balance / limit) * 100)) : null;
    const balTone = balance > 0 ? 'owed' : balance < 0 ? 'advance' : 'zero';

    return (
      <div className={`card parties parties--detail cu cu-detail${collectCls}`}>
        <header className="page-head cu-detail__head">
          {backBtn}
          <div className="cu-detail__id">
            <InitialBadge name={detail.name} className="cu-avatar cu-avatar--lg" />
            <div className="cu-detail__id-text">
              <h2 className="parties-detail__title" dir="auto">
                {detail.name}
              </h2>
              <div className="cu-detail__meta">
                {detail.phone?.trim() ? <span className="ltr-isolate">{detail.phone}</span> : null}
                {detail.address?.trim() ? <span dir="auto">{detail.address.trim()}</span> : null}
                {detail.loyalty_points ? (
                  <span className="ltr-isolate" data-party-points>
                    {t('loyaltyPoints')} {detail.loyalty_points}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <div className="page-head__actions">
            {!detail.balance_hidden && detail.balance_paisa > 0 ? (
              waPhone(detail.phone) ? (
                <button
                  type="button"
                  className="btn btn--ghost wa-btn"
                  data-wa-remind
                  onClick={() => void openWhatsApp(waPhone(detail.phone)!, khataReminderText(detail.name, storeName, detail.balance_paisa))}
                >
                  {t('waReminder')}
                </button>
              ) : (
                <button type="button" className="btn btn--ghost wa-btn" data-wa-addphone onClick={() => openEdit(detail)} disabled={busy}>
                  {t(detail.phone?.trim() ? 'waFixPhone' : 'waAddPhone')}
                </button>
              )
            ) : null}
            <button type="button" className="btn btn--ghost" onClick={() => openEdit(detail)} disabled={busy}>
              {t('editCustomer')}
            </button>
          </div>
        </header>

        <div className="cu-detail__grid">
          <aside className="cu-detail__aside">
            <section className={`cu-balance cu-balance--${balTone} dd-money`} aria-label={t('balance')}>
              <span className="cu-balance__label">{balance < 0 ? t('cuAdvance') : t('khataDue')}</span>
              <strong className="cu-balance__value ltr-isolate">{formatRs(Math.abs(balance))}</strong>
              <dl className="cu-balance__split">
                <div>
                  <dt>{t('khataTotal')}</dt>
                  <dd className="ltr-isolate">{formatRs(khataTotal)}</dd>
                </div>
                <div>
                  <dt>{t('khataPaid')}</dt>
                  <dd className="ltr-isolate">{formatRs(khataPaid)}</dd>
                </div>
                <div>
                  <dt>{t('cuColLimit')}</dt>
                  <dd className="ltr-isolate">{limit ? formatRs(limit) : t('creditLimitNone')}</dd>
                </div>
              </dl>
              {usedPct != null ? (
                <div className={`cu-limit${usedPct > 100 ? ' cu-limit--over' : usedPct >= 80 ? ' cu-limit--near' : ''}`}>
                  <div className="cu-limit__bar" aria-hidden="true">
                    <span style={{ width: `${Math.min(100, usedPct)}%` }} />
                  </div>
                  <span className="cu-limit__text ltr-isolate">{t('cuLimitUsed').replace('{pct}', String(usedPct))}</span>
                </div>
              ) : null}
            </section>

            {balance > 0 ? (
              <section className="cu-panel parties-collect" aria-label={t('cuReceivePayment')} id="parties-collect-panel">
                <h3 className="cu-panel__title">{t('cuReceivePayment')}</h3>
                <form className="cu-collect" onSubmit={(e) => void recordCollection(e)}>
                  <div className="field cu-collect__amount">
                    <label htmlFor="collect-amount">{t('collectAmountRs')}</label>
                    <MoneyInput
                      id="collect-amount"
                      ref={collectAmountRef}
                      autoComplete="off"
                      value={collectRs}
                      onValueChange={(v) => {
                        setCollectRs(v);
                        if (amountError) setAmountError(null);
                        if (collectMsg) setCollectMsg(null);
                      }}
                      placeholder="0"
                      aria-invalid={amountError ? true : undefined}
                      aria-describedby={amountError ? 'collect-amount-error' : undefined}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="collect-date">{t('purchaseDate')}</label>
                    <input
                      id="collect-date"
                      className="ltr-isolate"
                      type="date"
                      value={collectDate}
                      onChange={(e) => {
                        setCollectDate(e.target.value);
                        if (collectMsg) setCollectMsg(null);
                      }}
                      required
                    />
                  </div>
                  <div className="field cu-collect__note">
                    <label htmlFor="collect-note">{t('collectNoteOptional')}</label>
                    <input id="collect-note" value={collectNote} onChange={(e) => setCollectNote(e.target.value)} maxLength={240} />
                  </div>
                  {amountError ? (
                    <p id="collect-amount-error" className="parties-field-error cu-collect__note" role="alert">
                      {amountError}
                    </p>
                  ) : null}
                  <button className="btn btn--teal cu-collect__submit" type="submit" disabled={busy}>
                    {busy ? t('loading') : t('cuReceivePayment')}
                  </button>
                </form>
              </section>
            ) : (
              <p className="muted parties-zero cu-zero">{t('zeroBalance')}</p>
            )}

            {canCollect ? (
              <form
                className="cu-panel cu-limit-form parties-credit-limit"
                data-credit-limit
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveLimit(detail.id);
                }}
              >
                <label htmlFor="credit-limit" className="cu-panel__title">
                  {t('creditLimit')}
                </label>
                <div className="cu-limit-form__row">
                  <input
                    id="credit-limit"
                    className="input ltr-isolate"
                    inputMode="decimal"
                    placeholder={detail.credit_limit_paisa ? String(detail.credit_limit_paisa / 100) : t('creditLimitNone')}
                    value={limitRs}
                    onChange={(e) => setLimitRs(e.target.value.replace(/[^\d.]/g, ''))}
                  />
                  <button type="submit" className="btn btn--ghost" disabled={limitBusy}>
                    {t('save')}
                  </button>
                </div>
              </form>
            ) : null}

            {errorText ? (
              <p className="parties-alert" role="alert">
                {errorText}
              </p>
            ) : null}
            {collectMsg ? (
              <p className="parties-success" role="status">
                {collectMsg}
              </p>
            ) : null}
          </aside>

          <section className="cu-ledger parties-ledger" aria-label={t('ledger')}>
            <div className="cu-ledger__head">
              <h3 className="cu-panel__title">{t('ledger')}</h3>
              <span className="muted ltr-isolate">{ledger.length}</span>
            </div>
            {ledger.length === 0 ? (
              <p className="muted cu-empty">{t('emptyLedger')}</p>
            ) : (
              <div className="catalog-table-wrap parties-ledger-wrap cu-ledger__wrap">
                <table className="catalog-table parties-ledger-table cu-table">
                  <caption className="visually-hidden">{t('ledger')}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('purchaseDate')}</th>
                      <th scope="col">{t('cuColEntry')}</th>
                      <th scope="col" className="catalog-table__num">
                        {t('cuColDebit')}
                      </th>
                      <th scope="col" className="catalog-table__num">
                        {t('khataPaid')}
                      </th>
                      <th scope="col" className="catalog-table__num">
                        {t('balance')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((e) => {
                      const isDebit = e.entry_type === 'debit';
                      const run = balanceAfter.get(e.id) ?? 0;
                      const kind = isDebit ? (e.sale_id ? t('cuEntrySale') : t('cuEntryDebit')) : t('cuEntryPayment');
                      const note = e.note && !/^(udhaar sale|cash received)$/i.test(e.note.trim()) ? e.note : null;
                      return (
                        <tr key={e.id}>
                          <td className="cu-nowrap">
                            <span className="ltr-isolate parties-ledger__time">{formatLedgerDate(e)}</span>
                          </td>
                          <td>
                            <span className={`cu-kind cu-kind--${isDebit ? 'debit' : 'credit'}`}>{kind}</span>
                            {note ? <span className="cu-sub parties-ledger__note">{note}</span> : null}
                          </td>
                          <td className="catalog-table__num">
                            {isDebit ? <span className="ltr-isolate cu-amt cu-amt--debit">{formatRs(e.amount_paisa)}</span> : <span className="muted">—</span>}
                          </td>
                          <td className="catalog-table__num">
                            {!isDebit ? <span className="ltr-isolate cu-amt cu-amt--credit">{formatRs(e.amount_paisa)}</span> : <span className="muted">—</span>}
                          </td>
                          <td className="catalog-table__num">
                            <strong className="ltr-isolate parties-ledger__bal">{formatRs(run)}</strong>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
        {renderForm()}
      </div>
    );
  }

  if (offersOpen && isOwner) {
    return <OffersPanel storeName={storeName} onClose={() => setOffersOpen(false)} />;
  }

  /* ── List view ── */
  const isEmptyParties = loaded && items.length === 0;
  const isEmptySearch = !isEmptyParties && filtered.length === 0;
  const hideMoney = items.some((p) => p.balance_hidden);
  const FILTERS: Array<[ListFilter, string]> = [
    ['all', t('partiesAllCustomers')],
    ['owes', t('partiesOwedOnly')],
    ['clear', t('cuFilterClear')],
    ['over', t('cuFilterOver')],
  ];

  return (
    <div className="card parties cu cu-list">
      <PageHeader
        title={<>{t('parties')}<UrHint k="parties" /></>}
        subtitle={displayName}
        actions={
          <>
            {isOwner ? (
              <button type="button" className="btn btn--ghost" onClick={() => setOffersOpen(true)} data-offers-open-panel>
                {t('offersTitle')}
              </button>
            ) : null}
            <button type="button" className="btn btn--teal" onClick={openAdd} disabled={busy}>
              {t('addParty')}
            </button>
          </>
        }
      />

      <div className={`cu-stats${hideMoney ? ' cu-stats--count' : ''}`} role="group" aria-label={t('parties')}>
        <div className="cu-stat">
          <span className="cu-stat__label">{t('cuStatCustomers')}</span>
          <strong className="cu-stat__value ltr-isolate">{stats.count}</strong>
        </div>
        {hideMoney ? null : (<>
        <div className="cu-stat cu-stat--owed dd-money">
          <span className="cu-stat__label">{t('cuStatOwed')}</span>
          <strong className="cu-stat__value ltr-isolate">{formatRs(stats.owed)}</strong>
        </div>
        <button type="button" className={`cu-stat cu-stat--btn dd-money${filter === 'owes' ? ' is-active' : ''}`} onClick={() => { setFilter('owes'); setSort('balance'); setPage(1); }}>
          <span className="cu-stat__label">{t('cuStatOwing')}</span>
          <strong className="cu-stat__value ltr-isolate">{stats.owing}</strong>
        </button>
        <button type="button" className={`cu-stat cu-stat--btn dd-money${stats.over > 0 ? ' cu-stat--danger' : ''}${filter === 'over' ? ' is-active' : ''}`} onClick={() => { setFilter('over'); setSort('balance'); setPage(1); }}>
          <span className="cu-stat__label">{t('cuStatOverLimit')}</span>
          <strong className="cu-stat__value ltr-isolate">{stats.over}</strong>
        </button>
        </>)}
      </div>

      <div className="cu-toolbar">
        <div className="field cu-toolbar__search">
          <label className="visually-hidden" htmlFor="parties-search">
            {t('searchParties')}
          </label>
          <input
            id="parties-search"
            className="catalog-search__input"
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            onKeyDown={onListKey}
            placeholder={t('searchParties')}
            disabled={items.length === 0}
          />
        </div>
        <div className="parties__filter" role="group" aria-label={t('balance')}>
          {FILTERS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`parties__filter-btn${filter === k ? ' is-active' : ''}`}
              aria-pressed={filter === k}
              onClick={() => {
                setFilter(k);
                if (k === 'owes' || k === 'over') setSort('balance');
                setPage(1);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="field cu-toolbar__sort">
          <label className="visually-hidden" htmlFor="parties-sort">
            {t('cuSort')}
          </label>
          <select id="parties-sort" value={sort} onChange={(e) => { setSort(e.target.value as ListSort); setPage(1); }}>
            <option value="name">{t('cuSortName')}</option>
            <option value="balance">{t('cuSortBalance')}</option>
            <option value="newest">{t('cuSortNewest')}</option>
          </select>
        </div>
      </div>

      {error && !formMode ? (
        <p className="parties-alert" role="alert">
          {errorText}
        </p>
      ) : null}

      <section className="parties__list cu-list__body" aria-label={t('partyList')} onKeyDown={onListKey}>
        {!loaded && !error ? (
          <p className="muted parties-empty-search" role="status">
            {t('loading')}
          </p>
        ) : isEmptyParties ? (
          <EmptyState
            title={t('emptyStatePartiesTitle')}
            description={t('emptyStatePartiesDesc')}
            action={
              <button type="button" className="btn btn--teal" onClick={openAdd}>
                {t('addFirstParty')}
              </button>
            }
          />
        ) : isEmptySearch ? (
          <p className="muted parties-empty-search">{t('partiesNoMatches')}</p>
        ) : (
          <>
            <div className="catalog-table-wrap cu-list__wrap">
              <table className="catalog-table parties-table cu-table">
                <caption className="visually-hidden">{t('partyList')}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="catalog-table__col-product">
                      {t('partiesColCustomer')}
                    </th>
                    <th scope="col" className="parties-table__col-phone">
                      {t('partiesColPhone')}
                    </th>
                    <th scope="col" className="catalog-table__num cu-col-limit">
                      {t('cuColLimit')}
                    </th>
                    <th scope="col" className="catalog-table__num">
                      {t('balance')}
                    </th>
                    <th scope="col" className="cu-col-since">
                      {t('cuColSince')}
                    </th>
                    <th scope="col" className="parties-table__col-actions">
                      <span className="visually-hidden">{t('partiesColActions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody ref={tableRef}>
                  {visible.map((p, i) => {
                    const bal = p.balance_paisa;
                    const tone = p.balance_hidden ? 'zero' : bal > 0 ? (overLimit(p) ? 'over' : 'owed') : bal < 0 ? 'advance' : 'zero';
                    const phoneTitle = p.phone?.trim() || '';
                    const addrTitle = p.address?.trim() || '';
                    return (
                      <tr
                        key={p.id}
                        className={i === activeIdx ? 'is-active' : undefined}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest('button')) return;
                          openParty(p.id);
                        }}
                      >
                        <td className="catalog-table__col-product">
                          <button
                            type="button"
                            className="catalog-table__select cu-name"
                            title={[p.name, phoneTitle, addrTitle].filter(Boolean).join(' · ')}
                            onClick={() => openParty(p.id)}
                            onFocus={() => setActiveIdx(i)}
                          >
                            <InitialBadge name={p.name} className="cu-avatar" />
                            <span className="cu-name__text">
                              <span className="catalog-table__name" dir="auto">
                                {p.name}
                              </span>
                              {addrTitle ? (
                                <span className="cu-sub" dir="auto">
                                  {addrTitle}
                                </span>
                              ) : null}
                            </span>
                          </button>
                        </td>
                        <td className="parties-table__col-phone">
                          {phoneTitle ? (
                            <span className="parties-table__phone ltr-isolate">
                              <span className="visually-hidden">{t('partyPhone')}: </span>
                              {phoneTitle}
                            </span>
                          ) : (
                            <span className="muted ltr-isolate">—</span>
                          )}
                        </td>
                        <td className="catalog-table__num cu-col-limit">
                          {p.credit_limit_paisa ? (
                            <span className="ltr-isolate">{formatRs(p.credit_limit_paisa)}</span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className={`catalog-table__num parties-table__amount cu-bal cu-bal--${tone}${tone === 'zero' ? ' parties-table__amount--zero' : ''}`}>
                          <span className="ltr-isolate">{p.balance_hidden ? '—' : formatRs(bal)}</span>
                        </td>
                        <td className="cu-col-since">
                          <span className="muted ltr-isolate">{p.created_at ? fmtDate(p.created_at) : '—'}</span>
                        </td>
                        <td className="parties-table__col-actions">
                          <div className="parties-table__actions">
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm parties-table__khata"
                              onClick={() => openParty(p.id)}
                              disabled={busy}
                            >
                              {t('openKhata')}
                            </button>
                            <button type="button" className="btn btn--ghost btn--sm" onClick={() => openEdit(p)} disabled={busy}>
                              {t('cuEdit')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="cu-list__foot">
              <span className="muted">
                {t('catalogShowing')
                  .replace('{from}', String((safePage - 1) * PAGE_SIZE + 1))
                  .replace('{to}', String((safePage - 1) * PAGE_SIZE + visible.length))
                  .replace('{total}', String(filtered.length))}
              </span>
              <Pager page={safePage} pageSize={PAGE_SIZE} total={filtered.length} disabled={busy} onPage={setPage} />
            </div>
          </>
        )}
      </section>

      {renderForm()}
    </div>
  );
}
