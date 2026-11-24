import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { UrHint, translateError, useI18n, type MessageKey } from '../../i18n';
import { EmptyState } from '../shared/EmptyState';
import { PageHeader } from '../shared/PageHeader';
import { ConfirmModal } from '../shared/ConfirmModal';
import { InitialBadge } from '../shared/InitialBadge';
import { MoneyInput } from '../shared/MoneyInput';
import { parseMoneyRs } from '../shared/amount';
import { apiGet, apiPatchRaw, apiPostRaw, setSessionToken } from '../../lib/api';
import { formatRsShort } from '../../lib/money';
import { printPayslip } from './printPayslip';

type RoleCode = 'owner' | 'manager' | 'cashier' | 'data_entry' | 'helper';

type Staff = {
  id: string;
  name: string;
  display_name: string;
  role: RoleCode;
  has_login: boolean;
  position: string | null;
  phone: string | null;
  address: string | null;
  monthly_salary_paisa: number | null;
  disabled_at: string | null;
  created_at: string;
  salary_balance_paisa: number;
  advance_paisa: number;
};

type LedgerKind = 'salary_due' | 'payment' | 'advance' | 'deduction' | 'bonus';
type Ledger = {
  id: string;
  entry_date: string;
  kind: LedgerKind;
  amount_paisa: number;
  period: string | null;
  note: string | null;
  from_drawer: number | null;
  created_at: string;
  voided_at: string | null;
  can_void: boolean;
};

type RunRow = {
  staff_id: string;
  name: string;
  salary_paisa: number;
  deduction_paisa: number;
  payable_paisa: number;
  already_run: boolean;
};

type EntryKind = 'payment' | 'advance' | 'bonus';

type Props = { displayName: string };

const formatRs = formatRsShort;
const LOGIN_ROLES: RoleCode[] = ['manager', 'cashier', 'data_entry'];

const ROLE_KEY: Record<RoleCode, MessageKey> = {
  owner: 'owner',
  manager: 'roleManager',
  cashier: 'cashier',
  data_entry: 'roleDataEntry',
  helper: 'roleHelper',
};

const KIND_KEY: Record<LedgerKind, MessageKey> = {
  salary_due: 'salaryKindDue',
  payment: 'salaryKindPayment',
  advance: 'salaryKindAdvance',
  deduction: 'salaryKindDeduction',
  bonus: 'salaryKindBonus',
};

function errCode(json: unknown): string {
  const j = json as { error?: unknown; message?: unknown } | null;
  if (typeof j?.message === 'string') return j.message;
  if (typeof j?.error === 'string') return j.error;
  return 'errorGeneric';
}

function karachiToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function monthLabel(period: string, locale: string): string {
  if (!/^\d{4}-\d{2}$/.test(period)) return period;
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale === 'ur' ? 'ur-PK' : 'en-PK', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function dayLabel(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-PK', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const PIN_OK = /^[0-9]{4,6}$/;

const POSITIONS: { value: string; key: MessageKey }[] = [
  { value: 'Cashier', key: 'posCashier' },
  { value: 'Salesman', key: 'posSalesman' },
  { value: 'Helper', key: 'posHelper' },
  { value: 'Store keeper', key: 'posStoreKeeper' },
  { value: 'Data entry operator', key: 'posDataEntry' },
  { value: 'Delivery boy', key: 'posDelivery' },
  { value: 'Manager', key: 'posManager' },
];

export function StaffShell({ displayName }: Props) {
  const { t, locale } = useI18n();
  const [users, setUsers] = useState<Staff[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  // Add / edit form
  const [form, setForm] = useState<null | { mode: 'add' } | { mode: 'edit'; staff: Staff }>(null);
  const [fName, setFName] = useState('');
  const [fRole, setFRole] = useState<RoleCode>('cashier');
  const [fPosition, setFPosition] = useState('');
  const [fPosOther, setFPosOther] = useState(false);
  const [fPhone, setFPhone] = useState('');
  const [fAddress, setFAddress] = useState('');
  const [fSalary, setFSalary] = useState('');
  const [fPin, setFPin] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const [shownOnce, setShownOnce] = useState<{ display_name: string; pin: string } | null>(null);
  const [pinVisible, setPinVisible] = useState(false);
  const [pinCopied, setPinCopied] = useState(false);

  // Detail
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Staff | null>(null);
  const [ledger, setLedger] = useState<Ledger[]>([]);
  const [confirm, setConfirm] = useState<
    | null
    | { kind: 'disable' | 'enable'; staff: Staff }
    | { kind: 'void'; entry: Ledger }
  >(null);

  // Entry modal
  const [entry, setEntry] = useState<EntryKind | null>(null);
  const [eAmount, setEAmount] = useState('');
  const [eDate, setEDate] = useState(karachiToday());
  const [eDrawer, setEDrawer] = useState(true);
  const [eNote, setENote] = useState('');
  const [entryError, setEntryError] = useState<string | null>(null);

  // PIN reset
  const [pinFor, setPinFor] = useState<Staff | null>(null);
  const [newPin, setNewPin] = useState('');
  const [newPin2, setNewPin2] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  // Owner's own PIN
  const [ownPin, setOwnPin] = useState(false);
  const [curPin, setCurPin] = useState('');
  const [pinDone, setPinDone] = useState(false);

  // Salary run
  const [runOpen, setRunOpen] = useState(false);
  const [runPeriod, setRunPeriod] = useState(karachiToday().slice(0, 7));
  const [runRows, setRunRows] = useState<RunRow[] | null>(null);
  const [runMsg, setRunMsg] = useState<string | null>(null);

  // Payslip
  const [slipPeriod, setSlipPeriod] = useState(karachiToday().slice(0, 7));
  const [store, setStore] = useState<{ name: string; widthMm: 58 | 80; printerName: string | null } | null>(null);

  const refresh = useCallback(async () => {
    const r = await apiGet<{ ok: boolean; users: Staff[] }>('/owner/staff');
    setUsers(r.users ?? []);
    setLoaded(true);
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const r = await apiGet<{ ok: boolean; staff: Staff; ledger: Ledger[] }>(`/owner/staff/${encodeURIComponent(id)}`);
    setDetail(r.staff);
    setLedger(r.ledger ?? []);
  }, []);

  useEffect(() => {
    refresh().catch(() => {
      setError('staff_unavailable');
      setLoaded(true);
    });
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
    if (!detailId) {
      setDetail(null);
      setLedger([]);
      return;
    }
    loadDetail(detailId).catch(() => setError('staff_unavailable'));
  }, [detailId, loadDetail]);

  async function reloadAll() {
    await refresh();
    if (detailId) await loadDetail(detailId);
  }

  // ---------- form ----------
  function openAdd() {
    setForm({ mode: 'add' });
    setFName('');
    setFRole('cashier');
    setFPosition('');
    setFPosOther(false);
    setFPhone('');
    setFAddress('');
    setFSalary('');
    setFPin('');
    setFormError(null);
  }

  function openEdit(s: Staff) {
    setForm({ mode: 'edit', staff: s });
    setFName(s.name);
    setFRole(s.role);
    setFPosition(s.position ?? '');
    setFPosOther(false);
    setFPhone(s.phone ?? '');
    setFAddress(s.address ?? '');
    setFSalary(s.monthly_salary_paisa ? String(s.monthly_salary_paisa / 100) : '');
    setFPin('');
    setFormError(null);
  }

  function closeForm() {
    if (busy) return;
    setForm(null);
  }

  const editing = form?.mode === 'edit' ? form.staff : null;
  const isOwnerRow = editing?.role === 'owner';
  const needsPin = LOGIN_ROLES.includes(fRole) && (!editing || !editing.has_login);
  const salaryBad = fSalary.trim() !== '' && parseMoneyRs(fSalary) == null;
  const formValid = !!fName.trim() && !salaryBad && (!needsPin || PIN_OK.test(fPin));

  async function saveForm(e: FormEvent) {
    e.preventDefault();
    if (!formValid || !form) return;
    setBusy(true);
    setFormError(null);
    const salaryRs = fSalary.trim() === '' ? null : parseMoneyRs(fSalary);
    const body: Record<string, unknown> = {
      name: fName.trim(),
      position: fPosition,
      phone: fPhone,
      address: fAddress,
      monthlySalaryRs: salaryRs,
    };
    if (!isOwnerRow) body.role = fRole;
    if (needsPin) body.pin = fPin;
    try {
      const r =
        form.mode === 'add'
          ? await apiPostRaw<{ ok: boolean; staff: Staff; pin_once: string | null }>('/owner/staff', body)
          : await apiPatchRaw<{ ok: boolean; staff: Staff; pin_once: string | null }>(
              `/owner/staff/${encodeURIComponent(form.staff.id)}`,
              body,
            );
      if (!r.ok || !r.json?.ok) {
        setFormError(errCode(r.json));
        return;
      }
      if (r.json.pin_once) {
        setShownOnce({ display_name: r.json.staff.name, pin: r.json.pin_once });
        setPinVisible(false);
        setPinCopied(false);
      }
      setForm(null);
      await reloadAll();
    } catch {
      setFormError('create_failed');
    } finally {
      setBusy(false);
    }
  }

  async function copyPin() {
    if (!shownOnce) return;
    try {
      await navigator.clipboard.writeText(shownOnce.pin);
      setPinCopied(true);
    } catch {
      setPinCopied(false);
    }
  }

  function openPin(st: Staff) {
    setPinFor(st);
    setOwnPin(st.role === 'owner');
    setNewPin('');
    setNewPin2('');
    setCurPin('');
    setPinError(null);
    setPinDone(false);
  }

  async function savePin(e: FormEvent) {
    e.preventDefault();
    if (!pinFor || !PIN_OK.test(newPin)) return;
    if (newPin !== newPin2) {
      setPinError('pin_mismatch');
      return;
    }
    setBusy(true);
    setPinError(null);
    if (ownPin) {
      const r = await apiPostRaw<{ ok: boolean; code?: string; sessionToken?: string }>('/settings/pin', {
        current_pin: curPin,
        new_pin: newPin,
      }).catch(() => null);
      setBusy(false);
      if (!r?.json?.ok) {
        setPinError(r?.json?.code ?? (r?.status === 401 || r?.status === 403 ? 'bad_current_pin' : 'error_generic'));
        return;
      }
      if (r.json.sessionToken) setSessionToken(r.json.sessionToken);
      setPinDone(true);
      return;
    }
    const r = await apiPostRaw<{ ok: boolean; pin_once: string }>(
      `/owner/staff/${encodeURIComponent(pinFor.id)}/pin`,
      { pin: newPin },
    ).catch(() => null);
    setBusy(false);
    if (!r?.ok || !r.json?.ok) {
      setPinError(errCode(r?.json ?? null));
      return;
    }
    setShownOnce({ display_name: pinFor.name, pin: r.json.pin_once });
    setPinVisible(false);
    setPinCopied(false);
    setPinFor(null);
    setNewPin('');
    setNewPin2('');
  }

  async function doConfirm() {
    if (!confirm) return;
    setBusy(true);
    setError(null);
    let r: { ok: boolean; json: unknown } | null = null;
    if (confirm.kind === 'void') {
      r = await apiPostRaw(
        `/owner/staff/${encodeURIComponent(detailId ?? '')}/entries/${encodeURIComponent(confirm.entry.id)}/void`,
      ).catch(() => null);
    } else {
      r = await apiPostRaw(
        `/owner/staff/${encodeURIComponent(confirm.staff.id)}/${confirm.kind === 'disable' ? 'deactivate' : 'activate'}`,
      ).catch(() => null);
    }
    setBusy(false);
    setConfirm(null);
    if (!r?.ok) setError(errCode(r?.json ?? null));
    await reloadAll();
  }

  // ---------- entries ----------
  function openEntry(kind: EntryKind) {
    if (!detail) return;
    setEntry(kind);
    setEAmount(
      kind === 'payment' && detail.salary_balance_paisa > 0 ? String(detail.salary_balance_paisa / 100) : '',
    );
    setEDate(karachiToday());
    setEDrawer(true);
    setENote('');
    setEntryError(null);
  }

  const eRs = parseMoneyRs(eAmount);
  const eValid = eRs != null && eRs > 0 && !!eDate;

  async function saveEntry(e: FormEvent) {
    e.preventDefault();
    if (!detail || !entry || !eValid) return;
    setBusy(true);
    setEntryError(null);
    const r = await apiPostRaw<{ ok: boolean }>(`/owner/staff/${encodeURIComponent(detail.id)}/entries`, {
      kind: entry,
      amountRs: eRs,
      date: eDate,
      fromDrawer: entry === 'bonus' ? undefined : eDrawer,
      note: eNote,
    }).catch(() => null);
    setBusy(false);
    if (!r?.ok || !r.json?.ok) {
      setEntryError(errCode(r?.json ?? null));
      return;
    }
    setEntry(null);
    await reloadAll();
  }

  // ---------- salary run ----------
  const loadRun = useCallback(async (period: string) => {
    setRunRows(null);
    const r = await apiGet<{ ok: boolean; rows: RunRow[] }>(`/owner/staff/salary-run?period=${encodeURIComponent(period)}`);
    setRunRows(r.rows ?? []);
  }, []);

  useEffect(() => {
    if (runOpen) loadRun(runPeriod).catch(() => setRunRows([]));
  }, [runOpen, runPeriod, loadRun]);

  async function doRun() {
    setBusy(true);
    const r = await apiPostRaw<{ ok: boolean; added: number }>('/owner/staff/salary-run', { period: runPeriod }).catch(
      () => null,
    );
    setBusy(false);
    if (!r?.ok || !r.json?.ok) {
      setError(errCode(r?.json ?? null));
      return;
    }
    setRunOpen(false);
    setRunMsg(t('salaryRunDone').replace('{n}', String(r.json.added)).replace('{month}', monthLabel(runPeriod, locale)));
    await reloadAll();
  }

  // ---------- payslip ----------
  const slipPeriods = useMemo(() => {
    const set = new Set<string>(ledger.filter((l) => l.period).map((l) => l.period as string));
    set.add(karachiToday().slice(0, 7));
    return [...set].sort().reverse();
  }, [ledger]);

  function printSlip() {
    if (!detail || !store) return;
    const rows = ledger.filter((l) => !l.voided_at && l.period === slipPeriod);
    const sum = (k: LedgerKind) => rows.filter((l) => l.kind === k).reduce((a, l) => a + l.amount_paisa, 0);
    const salary = sum('salary_due');
    const bonus = sum('bonus');
    const deduction = sum('deduction');
    const paid = sum('payment');
    void printPayslip(
      {
        storeName: store.name,
        name: detail.name,
        roleLabel: t(ROLE_KEY[detail.role]),
        position: detail.position,
        monthLabel: monthLabel(slipPeriod, 'en'),
        salaryPaisa: salary,
        bonusPaisa: bonus,
        deductionPaisa: deduction,
        paidPaisa: paid,
        balancePaisa: salary + bonus - deduction - paid,
        advancePaisa: Math.max(0, detail.advance_paisa),
        printedAt: new Date().toLocaleString('en-PK', { hour12: true, timeZone: 'Asia/Karachi' }),
      },
      {
        title: t('payslipTitle'),
        salary: t('salaryKindDue'),
        bonus: t('salaryKindBonus'),
        deduction: t('salaryKindDeduction'),
        paid: t('salaryKindPayment'),
        balance: t('salaryBalance'),
        advance: t('salaryAdvanceLeft'),
        signature: t('payslipSignature'),
      },
      { widthMm: store.widthMm, printerName: store.printerName },
    );
  }

  // ST1: Escape closes the open staff modal even before anything inside it has focus.
  // The PIN-once sheet stays (it must be read); ConfirmModal handles its own Escape.
  useEffect(() => {
    if (shownOnce || confirm) return;
    if (!form && !pinFor && !runOpen && !entry) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.defaultPrevented || busy) return;
      e.preventDefault();
      if (entry) setEntry(null);
      else if (pinFor) setPinFor(null);
      else if (runOpen) setRunOpen(false);
      else if (form) setForm(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [form, pinFor, runOpen, entry, shownOnce, confirm, busy]);

  // ---------- shared modals ----------
  const pinOnceModal = shownOnce ? (
    <div className="pos-modal-backdrop">
      <div className="pos-modal staff-pin-once" role="dialog" aria-modal="true" aria-labelledby="staff-pin-title">
        <h3 id="staff-pin-title">{t('staffPinOnceTitle')}</h3>
        <p className="muted">{shownOnce.display_name}</p>
        <p className="ltr-isolate" dir="ltr" style={{ font: 'var(--type-amount)', margin: '8px 0' }}>
          {t('staffPinLabel')} {pinVisible ? shownOnce.pin : '••••'}
        </p>
        {pinCopied ? (
          <p className="muted" role="status">
            {t('staffPinCopied')}
          </p>
        ) : null}
        <div className="pos-modal__actions">
          <button type="button" className="btn btn--teal" onClick={() => setShownOnce(null)}>
            {t('staffPinOnceDismiss')}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setPinVisible((v) => !v)}>
            {pinVisible ? t('staffPinHide') : t('staffPinShow')}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => void copyPin()}>
            {t('staffPinCopy')}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const formModal = form ? (
    <div className="pos-modal-backdrop" onClick={closeForm}>
      <form
        className="pos-modal staff-form-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-form-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void saveForm(e)}
      >
        <h3 id="staff-form-title">{form.mode === 'add' ? t('staffAdd') : t('staffEdit')}</h3>
        <div className="staff-form-grid">
          <div className="field">
            <label htmlFor="staff-name">{t('staffColName')}</label>
            <input
              id="staff-name"
              value={fName}
              onChange={(e) => setFName(e.target.value)}
              maxLength={80}
              autoComplete="off"
              autoFocus
              required
            />
          </div>
          <div className="field">
            <label htmlFor="staff-role">{t('staffColRole')}</label>
            {isOwnerRow ? (
              <input id="staff-role" value={t('owner')} disabled />
            ) : (
              <select id="staff-role" value={fRole} onChange={(e) => setFRole(e.target.value as RoleCode)}>
                <option value="cashier">{t('cashier')}</option>
                <option value="manager">{t('roleManager')}</option>
                <option value="data_entry">{t('roleDataEntry')}</option>
                <option value="helper">{t('roleHelper')}</option>
              </select>
            )}
          </div>
          <div className="field">
            <label htmlFor="staff-position">{t('staffPosition')}</label>
            {(() => {
              const known = POSITIONS.some((x) => x.value === fPosition);
              const sel = fPosOther || (fPosition !== '' && !known) ? '__other' : fPosition;
              return (
                <>
                  <select
                    id="staff-position"
                    value={sel}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '__other') {
                        setFPosOther(true);
                        if (known) setFPosition('');
                      } else {
                        setFPosOther(false);
                        setFPosition(v);
                      }
                    }}
                  >
                    <option value="">—</option>
                    {POSITIONS.map((x) => (
                      <option key={x.value} value={x.value}>
                        {t(x.key)}
                      </option>
                    ))}
                    <option value="__other">{t('posOther')}</option>
                  </select>
                  {sel === '__other' ? (
                    <input
                      id="staff-position-custom"
                      aria-label={t('posCustom')}
                      placeholder={t('posCustom')}
                      value={fPosition}
                      onChange={(e) => setFPosition(e.target.value)}
                      maxLength={60}
                      autoComplete="off"
                      dir="auto"
                      style={{ marginTop: 6 }}
                    />
                  ) : null}
                </>
              );
            })()}
          </div>
          <div className="field">
            <label htmlFor="staff-phone">{t('partyPhone')}</label>
            <input
              id="staff-phone"
              className="ltr-isolate"
              value={fPhone}
              onChange={(e) => setFPhone(e.target.value)}
              inputMode="tel"
              maxLength={32}
              placeholder="03xx…"
              autoComplete="off"
            />
          </div>
          <div className="field staff-form-grid__wide">
            <label htmlFor="staff-address">{t('partyAddress')}</label>
            <input
              id="staff-address"
              value={fAddress}
              onChange={(e) => setFAddress(e.target.value)}
              maxLength={240}
              autoComplete="off"
              dir="auto"
            />
          </div>
          <div className="field">
            <label htmlFor="staff-salary">{t('staffMonthlySalary')}</label>
            <MoneyInput
              id="staff-salary"
              value={fSalary}
              onValueChange={setFSalary}
              placeholder="0"
              aria-invalid={salaryBad || undefined}
            />
          </div>
          {needsPin ? (
            <div className="field">
              <label htmlFor="staff-pin">{t('staffPinLabel')}</label>
              <input
                id="staff-pin"
                className="ltr-isolate"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={fPin}
                onChange={(e) => setFPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoComplete="new-password"
                dir="ltr"
                required
              />
            </div>
          ) : null}
        </div>
        {formError ? (
          <p className="parties-alert" role="alert">
            {translateError(t, formError)}
          </p>
        ) : null}
        <div className="pos-modal__actions">
          <button className="btn btn--teal" type="submit" disabled={busy || !formValid}>
            {busy ? t('loading') : form.mode === 'add' ? t('staffAdd') : t('staffSave')}
          </button>
          <button type="button" className="btn btn--ghost" onClick={closeForm} disabled={busy}>
            {t('cancel')}
          </button>
        </div>
      </form>
    </div>
  ) : null;

  const confirmModal = confirm ? (
    <ConfirmModal
      title={
        confirm.kind === 'void'
          ? t('salaryVoidTitle')
          : confirm.kind === 'disable'
            ? t('staffDeactivateTitle')
            : t('staffEnableTitle')
      }
      message={
        confirm.kind === 'void'
          ? `${t(KIND_KEY[confirm.entry.kind])} · ${formatRs(confirm.entry.amount_paisa)}`
          : (confirm.kind === 'disable' ? t('staffDeactivateConfirm') : t('staffEnableConfirm')).replace(
              '{name}',
              confirm.staff.name,
            )
      }
      confirmLabel={
        confirm.kind === 'void'
          ? t('salaryVoid')
          : confirm.kind === 'disable'
            ? t('staffDeactivateConfirmYes')
            : t('staffEnable')
      }
      tone={confirm.kind === 'enable' ? 'primary' : 'danger'}
      cancelLabel={t('cancel')}
      busy={busy}
      onConfirm={() => void doConfirm()}
      onCancel={() => setConfirm(null)}
    />
  ) : null;

  const pinModal = pinFor ? (
    <div className="pos-modal-backdrop" onClick={() => !busy && setPinFor(null)}>
      <form
        className="pos-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-newpin-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void savePin(e)}
      >
        <h3 id="staff-newpin-title">{ownPin ? t('changeMyPin') : t('staffResetPin')}</h3>
        <p className="muted">{pinFor.name}</p>
        {pinDone ? (
          <p role="status">{t('settingsPinChanged')}</p>
        ) : (
          <>
            {ownPin ? (
        <div className="field">
          <label htmlFor="staff-curpin">{t('settingsCurrentPin')}</label>
          <input
            id="staff-curpin"
            className="ltr-isolate"
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={curPin}
            onChange={(e) => setCurPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            autoComplete="current-password"
            dir="ltr"
            autoFocus
          />
        </div>
            ) : null}
        <div className="field">
          <label htmlFor="staff-newpin">{t('staffNewPin')}</label>
          <input
            id="staff-newpin"
            className="ltr-isolate"
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            autoComplete="new-password"
            dir="ltr"
          />
        </div>
        <div className="field">
          <label htmlFor="staff-newpin2">{t('confirmPin')}</label>
          <input
            id="staff-newpin2"
            className="ltr-isolate"
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={newPin2}
            onChange={(e) => setNewPin2(e.target.value.replace(/\D/g, '').slice(0, 6))}
            autoComplete="new-password"
            dir="ltr"
          />
        </div>
            {pinError ? (
              <p className="muted" role="alert" style={{ color: 'var(--danger)' }}>
                {translateError(t, pinError)}
              </p>
            ) : null}
          </>
        )}
        <div className="pos-modal__actions">
          {pinDone ? (
            <button type="button" className="btn btn--teal" onClick={() => setPinFor(null)}>
              {t('recoveryDone')}
            </button>
          ) : (
            <>
              <button
                className="btn btn--teal"
                type="submit"
                disabled={busy || !PIN_OK.test(newPin) || !PIN_OK.test(newPin2) || (ownPin && !PIN_OK.test(curPin))}
              >
                {ownPin ? t('changeMyPin') : t('staffResetPin')}
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => setPinFor(null)} disabled={busy}>
                {t('cancel')}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  ) : null;

  const runModal = runOpen ? (
    <div className="pos-modal-backdrop" onClick={() => !busy && setRunOpen(false)}>
      <div
        className="pos-modal staff-run-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-run-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="staff-run-title">{t('salaryRun')}</h3>
        <div className="field">
          <label htmlFor="staff-run-month">{t('salaryMonth')}</label>
          <input
            id="staff-run-month"
            className="ltr-isolate"
            type="month"
            value={runPeriod}
            max={karachiToday().slice(0, 7)}
            onChange={(e) => e.target.value && setRunPeriod(e.target.value)}
          />
        </div>
        {runRows == null ? (
          <p className="muted" role="status">
            {t('loading')}
          </p>
        ) : runRows.length === 0 ? (
          <p className="muted">{t('salaryRunNobody')}</p>
        ) : (
          <div className="catalog-table-wrap">
            <table className="catalog-table parties-table">
              <thead>
                <tr>
                  <th scope="col" className="catalog-table__col-product">
                    {t('staffColName')}
                  </th>
                  <th scope="col" className="catalog-table__num">
                    {t('staffColSalary')}
                  </th>
                  <th scope="col" className="catalog-table__num">
                    {t('salaryAdvanceCut')}
                  </th>
                  <th scope="col" className="catalog-table__num">
                    {t('salaryPayable')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {runRows.map((r) => (
                  <tr key={r.staff_id} className={r.already_run ? 'staff-table__row--disabled' : undefined}>
                    <td className="catalog-table__col-product">
                      <span className="catalog-table__name" dir="auto">
                        {r.name}
                      </span>
                      {r.already_run ? <span className="chip staff-run__done">{t('salaryRunAdded')}</span> : null}
                    </td>
                    <td className="catalog-table__num ltr-isolate">{formatRs(r.salary_paisa)}</td>
                    <td className="catalog-table__num ltr-isolate">
                      {r.deduction_paisa > 0 ? `−${formatRs(r.deduction_paisa)}` : '—'}
                    </td>
                    <td className="catalog-table__num ltr-isolate">
                      <strong>{formatRs(r.payable_paisa)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pos-modal__actions">
          <button
            type="button"
            className="btn btn--teal"
            disabled={busy || !runRows || runRows.every((r) => r.already_run)}
            onClick={() => void doRun()}
          >
            {busy ? t('loading') : t('salaryRunConfirm')}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setRunOpen(false)} disabled={busy}>
            {t('cancel')}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  const entryModal =
    entry && detail ? (
      <div className="pos-modal-backdrop" onClick={() => !busy && setEntry(null)}>
        <form
          className="pos-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="staff-entry-title"
          onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => void saveEntry(e)}
        >
          <h3 id="staff-entry-title">
            {entry === 'payment' ? t('salaryPay') : entry === 'advance' ? t('salaryGiveAdvance') : t('salaryAddBonus')}
          </h3>
          <p className="muted">{detail.name}</p>
          <div className="field">
            <label htmlFor="staff-entry-amount">{t('expenseAmountRs')}</label>
            <MoneyInput
              id="staff-entry-amount"
              value={eAmount}
              onValueChange={setEAmount}
              placeholder="0"
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="staff-entry-date">{t('supplierPayDate')}</label>
            <input
              id="staff-entry-date"
              className="ltr-isolate"
              type="date"
              value={eDate}
              max={karachiToday()}
              onChange={(e) => setEDate(e.target.value)}
              required
            />
          </div>
          {entry !== 'bonus' ? (
            <div className="field">
              <span className="field__label">{t('salaryPaidFrom')}</span>
              <div className="parties__filter" role="group" aria-label={t('salaryPaidFrom')}>
                <button
                  type="button"
                  className={`parties__filter-btn${eDrawer ? ' is-active' : ''}`}
                  aria-pressed={eDrawer}
                  onClick={() => setEDrawer(true)}
                >
                  {t('salaryFromDrawer')}
                </button>
                <button
                  type="button"
                  className={`parties__filter-btn${eDrawer ? '' : ' is-active'}`}
                  aria-pressed={!eDrawer}
                  onClick={() => setEDrawer(false)}
                >
                  {t('salaryOutsideDrawer')}
                </button>
              </div>
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="staff-entry-note">{t('supplierNoteOptional')}</label>
            <input
              id="staff-entry-note"
              value={eNote}
              onChange={(e) => setENote(e.target.value)}
              maxLength={160}
              dir="auto"
            />
          </div>
          {entryError ? (
            <p className="parties-alert" role="alert">
              {translateError(t, entryError)}
            </p>
          ) : null}
          <div className="pos-modal__actions">
            <button className="btn btn--teal" type="submit" disabled={busy || !eValid}>
              {busy ? t('loading') : t('save')}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setEntry(null)} disabled={busy}>
              {t('cancel')}
            </button>
          </div>
        </form>
      </div>
    ) : null;

  const modals = (
    <>
      {formModal}
      {pinOnceModal}
      {confirmModal}
      {pinModal}
      {runModal}
      {entryModal}
    </>
  );

  // ---------- detail view ----------
  if (detailId) {
    if (!detail) {
      return (
        <div className="card parties parties--detail">
          <div className="parties-detail__nav">
            <button type="button" className="btn btn--ghost" onClick={() => setDetailId(null)}>
              {t('staffBack')}
            </button>
          </div>
          <p className="muted" role="status">
            {t('loading')}
          </p>
        </div>
      );
    }
    const left = !!detail.disabled_at;
    let running = 0;
    const rows = ledger.map((l) => {
      if (!l.voided_at) {
        if (l.kind === 'salary_due' || l.kind === 'bonus') running += l.amount_paisa;
        if (l.kind === 'payment' || l.kind === 'deduction') running -= l.amount_paisa;
      }
      return { ...l, after: running };
    });
    return (
      <div className="card parties parties--detail staff-detail">
        <div className="parties-detail__nav">
          <button type="button" className="btn btn--ghost" onClick={() => setDetailId(null)}>
            {t('staffBack')}
          </button>
        </div>

        <header className="parties-detail__header">
          <div className="parties-detail__identity">
            <div className="parties-detail__title-row">
              <span className="staff-detail__who">
                <InitialBadge name={detail.name} />
                <h2 className="parties-detail__title">{detail.name}</h2>
              </span>
              <button type="button" className="btn btn--ghost" onClick={() => openEdit(detail)} disabled={busy}>
                {t('staffEdit')}
              </button>
            </div>
            <div className="parties-detail__meta">
              <span className="chip">{t(ROLE_KEY[detail.role])}</span>
              {detail.position ? (
                <span className="chip" dir="auto">
                  {detail.position}
                </span>
              ) : null}
              {left ? <span className="chip staff-chip--off">{t('staffDisabled')}</span> : null}
              {detail.phone ? <span className="chip ltr-isolate">{detail.phone}</span> : null}
              {detail.address ? (
                <span className="parties-detail__address" dir="auto">
                  {detail.address}
                </span>
              ) : null}
            </div>
            <div className="parties-khata-summary" aria-label={t('salaryBalance')}>
              <div className="parties-khata-summary__item">
                <span className="parties-khata-summary__label muted">{t('staffMonthlySalary')}</span>
                <strong className="ltr-isolate parties-khata-summary__value">
                  {detail.monthly_salary_paisa ? formatRs(detail.monthly_salary_paisa) : '—'}
                </strong>
              </div>
              <div className="parties-khata-summary__item">
                <span className="parties-khata-summary__label muted">{t('salaryAdvanceLeft')}</span>
                <strong
                  className={`ltr-isolate parties-khata-summary__value${detail.advance_paisa > 0 ? ' staff-advance' : ''}`}
                >
                  {formatRs(Math.max(0, detail.advance_paisa))}
                </strong>
              </div>
              <div className="parties-khata-summary__item parties-khata-summary__item--due">
                <span className="parties-khata-summary__label muted">{t('salaryBalance')}</span>
                <strong
                  className={`ltr-isolate parties-khata-summary__value parties-khata-summary__due${
                    detail.salary_balance_paisa === 0 ? ' parties-khata-summary__due--zero' : ''
                  }`}
                >
                  {formatRs(detail.salary_balance_paisa)}
                </strong>
              </div>
            </div>
          </div>
        </header>

        <div className="staff-detail__actions">
          <button
            type="button"
            className="btn btn--teal"
            onClick={() => openEntry('payment')}
            disabled={busy || detail.salary_balance_paisa <= 0}
          >
            {t('salaryPay')}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => openEntry('advance')} disabled={busy || left}>
            {t('salaryGiveAdvance')}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => openEntry('bonus')} disabled={busy}>
            {t('salaryAddBonus')}
          </button>
          <span className="staff-detail__spacer" />
          <label className="visually-hidden" htmlFor="staff-slip-month">
            {t('salaryMonth')}
          </label>
          <select
            id="staff-slip-month"
            className="staff-detail__month"
            value={slipPeriod}
            onChange={(e) => setSlipPeriod(e.target.value)}
          >
            {slipPeriods.map((p) => (
              <option key={p} value={p}>
                {monthLabel(p, locale)}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn--ghost" onClick={printSlip} disabled={!store}>
            {t('payslipPrint')}
          </button>
          {detail.has_login ? (
            <button type="button" className="btn btn--ghost" onClick={() => openPin(detail)} disabled={busy}>
              {detail.role === 'owner' ? t('changeMyPin') : t('staffResetPin')}
            </button>
          ) : null}
          {detail.role !== 'owner' ? (
            left ? (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setConfirm({ kind: 'enable', staff: detail })}
                disabled={busy}
              >
                {t('staffEnable')}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--ghost btn--danger"
                onClick={() => setConfirm({ kind: 'disable', staff: detail })}
                disabled={busy}
              >
                {t('staffDeactivate')}
              </button>
            )
          ) : null}
        </div>

        {error ? (
          <p className="parties-alert" role="alert">
            {translateError(t, error)}
          </p>
        ) : null}

        <section className="parties-ledger" aria-label={t('salaryKhata')}>
          <h3 className="parties-section-title">{t('salaryKhata')}</h3>
          {rows.length === 0 ? (
            <p className="muted">{t('salaryKhataEmpty')}</p>
          ) : (
            <div className="catalog-table-wrap parties-ledger-wrap">
              <table className="catalog-table parties-ledger-table staff-ledger-table">
                <caption className="visually-hidden">{t('salaryKhata')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('purchaseDate')}</th>
                    <th scope="col">{t('salaryEntry')}</th>
                    <th scope="col">{t('salaryMonth')}</th>
                    <th scope="col" className="catalog-table__num">
                      {t('expenseAmountRs')}
                    </th>
                    <th scope="col" className="catalog-table__num">
                      {t('salaryBalance')}
                    </th>
                    <th scope="col">{t('purchaseNote')}</th>
                    <th scope="col" className="parties-table__col-actions">
                      <span className="visually-hidden">{t('partiesColActions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].reverse().map((l) => {
                    const minus = l.kind === 'payment' || l.kind === 'deduction';
                    return (
                      <tr key={l.id} className={l.voided_at ? 'staff-table__row--voided' : undefined}>
                        <td className="ltr-isolate">{dayLabel(l.entry_date)}</td>
                        <td>
                          <span className={`staff-kind staff-kind--${l.kind}`}>{t(KIND_KEY[l.kind])}</span>
                          {l.from_drawer === 0 ? (
                            <span className="chip staff-chip--outside">{t('salaryOutsideDrawer')}</span>
                          ) : null}
                          {l.voided_at ? <span className="chip staff-chip--off">{t('salaryVoided')}</span> : null}
                        </td>
                        <td>{l.period ? monthLabel(l.period, locale) : '—'}</td>
                        <td className="catalog-table__num">
                          <span className="ltr-isolate">
                            {l.kind === 'advance' ? '' : minus ? '−' : '+'}
                            {formatRs(l.amount_paisa)}
                          </span>
                        </td>
                        <td className="catalog-table__num">
                          <span className="ltr-isolate">{l.voided_at ? '—' : formatRs(l.after)}</span>
                        </td>
                        <td dir="auto">{l.note ?? ''}</td>
                        <td className="parties-table__col-actions">
                          {l.can_void ? (
                            <button
                              type="button"
                              className="btn btn--ghost btn--danger"
                              onClick={() => setConfirm({ kind: 'void', entry: l })}
                              disabled={busy}
                            >
                              {t('salaryVoid')}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
        {modals}
      </div>
    );
  }

  // ---------- list ----------
  const q = search.trim().toLowerCase();
  const visible = q
    ? users.filter((u) =>
        [u.name, u.position ?? '', u.phone ?? '', t(ROLE_KEY[u.role])].some((v) => v.toLowerCase().includes(q)),
      )
    : users;

  return (
    <div className="card parties staff">
      <PageHeader title={<>{t('staff')}<UrHint k="staff" /></>} subtitle={displayName} />

      <div className="parties__toolbar">
        <div className="catalog-search field">
          <label className="visually-hidden" htmlFor="staff-search">
            {t('searchStaff')}
          </label>
          <input
            id="staff-search"
            className="catalog-search__input"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchStaff')}
            disabled={users.length === 0}
          />
        </div>
        <div className="parties__toolbar-actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setRunMsg(null);
              setRunOpen(true);
            }}
            disabled={busy || users.length === 0}
          >
            {t('salaryRun')}
          </button>
          <button type="button" className="btn btn--teal" onClick={openAdd} disabled={busy}>
            {t('staffAdd')}
          </button>
        </div>
      </div>

      {error && !form ? (
        <p className="parties-alert" role="alert">
          {translateError(t, error)}
        </p>
      ) : null}
      {runMsg ? (
        <p className="parties-success" role="status">
          {runMsg}
        </p>
      ) : null}

      <section className="parties__list" aria-label={t('staffUsers')}>
        {!loaded ? (
          <p className="muted parties-empty-search" role="status">
            {t('loading')}
          </p>
        ) : users.length === 0 ? (
          <EmptyState
            title={t('emptyStateStaffTitle')}
            description={t('emptyStateStaffDesc')}
            action={
              <button type="button" className="btn btn--teal" onClick={openAdd}>
                {t('staffAdd')}
              </button>
            }
          />
        ) : visible.length === 0 ? (
          <p className="muted parties-empty-search">{t('staffNoMatches')}</p>
        ) : (
          <div className="catalog-table-wrap">
            <table className="catalog-table parties-table staff-table">
              <caption className="visually-hidden">{t('staffUsers')}</caption>
              <thead>
                <tr>
                  <th scope="col" className="catalog-table__col-product">
                    {t('staffColName')}
                  </th>
                  <th scope="col">{t('staffColRole')}</th>
                  <th scope="col" className="parties-table__col-phone">
                    {t('partiesColPhone')}
                  </th>
                  <th scope="col" className="catalog-table__num">
                    {t('staffColSalary')}
                  </th>
                  <th scope="col" className="catalog-table__num">
                    {t('salaryBalance')}
                  </th>
                  <th scope="col">{t('staffColStatus')}</th>
                  <th scope="col" className="parties-table__col-actions">
                    {t('partiesColActions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((u) => {
                  const left = !!u.disabled_at;
                  return (
                    <tr key={u.id} className={left ? 'staff-table__row--disabled' : undefined}>
                      <td className="catalog-table__col-product">
                        <button type="button" className="catalog-table__select" onClick={() => setDetailId(u.id)}>
                          <span className="staff-table__who">
                            <InitialBadge name={u.name} />
                            <span className="catalog-table__text">
                              <span className="catalog-table__name" dir="auto">
                                {u.name}
                              </span>
                              {u.position ? (
                                <span className="catalog-table__meta" dir="auto">
                                  {u.position}
                                </span>
                              ) : null}
                            </span>
                          </span>
                        </button>
                      </td>
                      <td>{t(ROLE_KEY[u.role])}</td>
                      <td className="parties-table__col-phone">
                        {u.phone ? (
                          <span className="parties-table__phone ltr-isolate">{u.phone}</span>
                        ) : (
                          <span className="muted ltr-isolate">—</span>
                        )}
                      </td>
                      <td className="catalog-table__num">
                        <span className="ltr-isolate">
                          {u.monthly_salary_paisa ? formatRs(u.monthly_salary_paisa) : '—'}
                        </span>
                      </td>
                      <td
                        className={`catalog-table__num parties-table__amount${
                          u.salary_balance_paisa === 0 ? ' parties-table__amount--zero' : ''
                        }`}
                      >
                        <span className="ltr-isolate">{formatRs(u.salary_balance_paisa)}</span>
                        {u.advance_paisa > 0 ? (
                          <span className="staff-table__advance ltr-isolate">
                            {t('salaryKindAdvance')} {formatRs(u.advance_paisa)}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        {left ? (
                          <span className="chip staff-chip--off">{t('staffDisabled')}</span>
                        ) : (
                          <span className="chip">{t('staffActive')}</span>
                        )}
                      </td>
                      <td className="parties-table__col-actions">
                        <div className="parties-table__actions">
                          <button
                            type="button"
                            className="btn btn--ghost parties-table__khata"
                            onClick={() => setDetailId(u.id)}
                            disabled={busy}
                          >
                            {t('salaryKhataShort')}
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost"
                            onClick={() => openEdit(u)}
                            disabled={busy}
                          >
                            {t('staffEdit')}
                          </button>
                          {u.has_login && !left ? (
                            <button type="button" className="btn btn--ghost" onClick={() => openPin(u)} disabled={busy} title={u.role === 'owner' ? t('changeMyPin') : t('staffResetPin')}>
                              {t('staffPinShort')}
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
        )}
      </section>
      {modals}
    </div>
  );
}
