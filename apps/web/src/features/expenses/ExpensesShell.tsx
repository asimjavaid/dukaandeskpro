import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '../shared/PageHeader';
import { UrHint, translateError, useI18n } from '../../i18n';
import { apiDelete, apiGet, apiPost } from '../../lib/api';
import { ConfirmModal } from '../shared/ConfirmModal';
import { EmptyState } from '../shared/EmptyState';
import { parseMoneyRs } from '../shared/amount';
import { Pager } from '../shared/Pager';
import { MoneyInput } from '../shared/MoneyInput';
import { formatRsShort } from '../../lib/money';
import { fmtDate } from '../shared/dates';

const PAGE_SIZE = 20;

type ExpenseKind = 'bill' | 'salary' | 'commission';
type ExpensePeriod = 'day' | 'month' | 'year' | 'all';

type ExpenseItem = {
  id: string;
  kind: ExpenseKind;
  amount_paisa: number;
  expense_date: string;
  note: string | null;
  /** Salary entries from Staff: undone there, not here. */
  staff_id?: string | null;
};

type ExpenseList = {
  ok: boolean;
  today: string;
  today_total_paisa: number;
  items: ExpenseItem[];
  total?: number;
  period?: ExpensePeriod;
  from?: string;
  to?: string;
  period_total_paisa?: number;
};

type Props = {
  displayName: string;
};

const formatRs = formatRsShort;

export function ExpensesShell({ displayName }: Props) {
  const { t } = useI18n();
  const [expenses, setExpenses] = useState<ExpenseList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<ExpenseKind>('bill');
  const [amountRs, setAmountRs] = useState('0');
  const [expenseDate, setExpenseDate] = useState('');
  const [note, setNote] = useState('');
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [expenseSaving, setExpenseSaving] = useState(false);
  const [expensePeriod, setExpensePeriod] = useState<ExpensePeriod>('day');
  const [page, setPage] = useState(1);
  const [pendingDelete, setPendingDelete] = useState<ExpenseItem | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const list = await apiGet<ExpenseList>(
        `/expenses?period=${expensePeriod}&page=${page}&pageSize=${PAGE_SIZE}`,
      );
      const total = list.total ?? list.items.length;
      if (list.items.length === 0 && page > 1 && total > 0) {
        setPage(page - 1);
        return;
      }
      setExpenses(list);
      setExpenseDate((prev) => prev || list.today);
    } catch {
      setExpenses(null);
      setError('expense_failed');
    } finally {
      setBusy(false);
    }
  }, [expensePeriod, page]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function openExpenseModal() {
    setFormError(null);
    if (!expenseDate && expenses?.today) setExpenseDate(expenses.today);
    setExpenseModalOpen(true);
  }

  function closeExpenseModal() {
    if (expenseSaving) return;
    setExpenseModalOpen(false);
    setFormError(null);
  }

  function resetExpenseForm(today: string) {
    setKind('bill');
    setAmountRs('0');
    setNote('');
    setExpenseDate(today);
  }

  useEffect(() => {
    if (!expenseModalOpen) return;
    amountRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || expenseSaving) return;
      setExpenseModalOpen(false);
      setFormError(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expenseModalOpen, expenseSaving]);

  async function addExpense(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const amount = parseMoneyRs(amountRs);
    if (amount == null || amount <= 0) {
      setFormError('invalid_amount');
      return;
    }
    setExpenseSaving(true);
    setBusy(true);
    try {
      const res = await apiPost<{ ok: true } | { ok: false; error: string }>(
        '/expenses',
        {
          kind,
          amountRs: amount,
          expenseDate: expenseDate || undefined,
          note: note.trim() || undefined,
        },
      );
      if (!res.ok) {
        setFormError(res.error);
        return;
      }
      const today = expenses?.today ?? expenseDate;
      resetExpenseForm(today);
      setExpenseModalOpen(false);
      if (page !== 1) setPage(1);
      else await refresh();
    } catch {
      setFormError('expense_failed');
    } finally {
      setExpenseSaving(false);
      setBusy(false);
    }
  }

  async function deleteExpense(id: string) {
    setFormError(null);
    setBusy(true);
    try {
      const res = await apiDelete<{ ok: boolean; error?: string }>(
        `/expenses/${encodeURIComponent(id)}`,
      );
      if (!res.ok) {
        setFormError(res.error ?? 'expense_failed');
        return;
      }
      await refresh();
    } catch {
      setFormError('expense_failed');
    } finally {
      setBusy(false);
    }
  }

  function kindLabel(k: ExpenseKind): string {
    if (k === 'salary') return t('expenseSalary');
    if (k === 'commission') return t('expenseCommission');
    return t('expenseBill');
  }

  const totalRows = expenses?.total ?? expenses?.items.length ?? 0;
  const periodLabel =
    expensePeriod === 'month'
      ? t('expenseThisMonth')
      : expensePeriod === 'year'
        ? t('expenseThisYear')
        : expensePeriod === 'all'
          ? t('expenseAllTotal')
          : t('expenseToday');

  return (
    <div className="card analytics">
      <PageHeader
        title={<>{t('expensesTitle')}<UrHint k="expensesTitle" /></>}
        subtitle={displayName}
        actions={error ? (
        <button
          type="button"
          className="btn btn--ghost analytics__refresh"
          onClick={() => void refresh()}
          disabled={busy}
        >
          {t('retry')}
        </button>
      ) : null}
      />

      {error ? (
        <p className="catalog-alert" role="alert">
          {translateError(t, error)}
        </p>
      ) : null}

      <section className="analytics-period" aria-label={t('expensesTitle')}>
        <div className="analytics-tabs" role="group" aria-label={t('expensesTitle')}>
          {(
            [
              ['day', 'expenseDaily'],
              ['month', 'expenseMonthly'],
              ['year', 'expenseYearly'],
              ['all', 'expenseAll'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`analytics-tab${expensePeriod === id ? ' is-active' : ''}`}
              aria-pressed={expensePeriod === id}
              onClick={() => {
                setExpensePeriod(id);
                setPage(1);
              }}
            >
              {t(label)}
            </button>
          ))}
        </div>
        <div className="analytics-kpi-grid">
          <div className="analytics-kpi analytics-kpi--alerts">
            <div className="analytics-kpi__label muted">{periodLabel}</div>
            <strong className="analytics-kpi__value ltr-isolate">
              {formatRs(expenses?.period_total_paisa ?? 0)}
            </strong>
            {expenses?.from ? (
              <div className="muted ltr-isolate">
                {expenses.from === expenses.to
                  ? fmtDate(expenses.from)
                  : `${fmtDate(expenses.from)} – ${fmtDate(expenses.to)}`}
              </div>
            ) : null}
          </div>
        </div>
        <div className="catalog__toolbar expenses-toolbar">
          <div className="catalog__toolbar-actions">
            <button
              type="button"
              className="btn btn--teal"
              onClick={openExpenseModal}
              disabled={busy}
            >
              {t('expenseAdd')}
            </button>
          </div>
        </div>
        {!expenseModalOpen && formError ? (
          <p className="catalog-alert" role="alert">
            {translateError(t, formError)}
          </p>
        ) : null}
        {!expenses || expenses.items.length === 0 ? (
          <EmptyState
            className="expenses-empty"
            title={t('expenseEmptyPeriod')}
          />
        ) : (
          <>
            <p className="catalog-table-count muted">
              {t('catalogShowing')
                .replace(
                  '{from}',
                  String((page - 1) * PAGE_SIZE + 1),
                )
                .replace(
                  '{to}',
                  String((page - 1) * PAGE_SIZE + expenses.items.length),
                )
                .replace('{total}', String(totalRows))}
            </p>
            <div className="catalog-table-wrap">
              <table className="catalog-table parties-table expenses-table">
                <caption className="visually-hidden">{t('expensesTitle')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('expenseDate')}</th>
                    <th scope="col" className="catalog-table__col-product">
                      {t('expenseCategory')}
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
                  {expenses.items.map((item) => {
                    const noteText = item.note?.trim() || '';
                    return (
                      <tr key={item.id}>
                        <td>
                          <span className="ltr-isolate">{fmtDate(item.expense_date)}</span>
                        </td>
                        <td className="catalog-table__col-product">
                          <span className="catalog-table__name" dir="auto">
                            {kindLabel(item.kind)}
                          </span>
                          {noteText ? (
                            <span className="catalog-table__meta">
                              <span
                                className="catalog-table__name-ur"
                                dir="auto"
                                title={noteText}
                              >
                                {noteText}
                              </span>
                            </span>
                          ) : null}
                        </td>
                        <td className="catalog-table__num parties-table__amount">
                          <span className="ltr-isolate">
                            {formatRs(item.amount_paisa)}
                          </span>
                        </td>
                        <td className="parties-table__col-actions">
                          {item.staff_id ? null : (
                            <button
                              type="button"
                              className="btn btn--ghost parties-table__khata"
                              onClick={() => setPendingDelete(item)}
                              disabled={busy}
                            >
                              {t('expenseDelete')}
                            </button>
                          )}
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
              total={totalRows}
              disabled={busy}
              onPage={setPage}
            />
          </>
        )}
      </section>

      {expenseModalOpen ? (
        <div className="pos-modal-backdrop" onClick={closeExpenseModal}>
          <form
            className="pos-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="expense-modal-title"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => void addExpense(e)}
          >
            <h3 id="expense-modal-title">{t('expenseAdd')}</h3>
            <div className="field">
              <label htmlFor="exp-kind">{t('expenseCategory')}</label>
              <select
                id="exp-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as ExpenseKind)}
              >
                <option value="bill">{t('expenseBill')}</option>
                <option value="salary">{t('expenseSalary')}</option>
                <option value="commission">{t('expenseCommission')}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="exp-amount">{t('expenseAmountRs')}</label>
              <MoneyInput
                id="exp-amount"
                ref={amountRef}
                value={amountRs}
                onValueChange={(v) => setAmountRs(v)}
                required
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="exp-date">{t('expenseDate')}</label>
              <input
                id="exp-date"
                className="ltr-isolate"
                type="date"
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="exp-note">{t('expenseNoteOptional')}</label>
              <input
                id="exp-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={160}
                autoComplete="off"
              />
            </div>
            {formError ? (
              <p className="catalog-alert" role="alert">
                {translateError(t, formError)}
              </p>
            ) : null}
            <div className="pos-modal__actions">
              <button className="btn btn--teal" type="submit" disabled={expenseSaving || busy}>
                {expenseSaving ? t('loading') : t('expenseAdd')}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={expenseSaving}
                onClick={closeExpenseModal}
              >
                {t('cancel')}
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {pendingDelete ? (
        <ConfirmModal
          title={t('deleteConfirmTitle')}
          message={t('deleteConfirmBody').replace(
            '{name}',
            `${kindLabel(pendingDelete.kind)} · ${formatRs(pendingDelete.amount_paisa)} · ${pendingDelete.expense_date}`,
          )}
          confirmLabel={t('confirm')}
          cancelLabel={t('cancel')}
          busy={busy}
          onConfirm={() => {
            const id = pendingDelete.id;
            setPendingDelete(null);
            void deleteExpense(id);
          }}
          onCancel={() => {
            if (!busy) setPendingDelete(null);
          }}
        />
      ) : null}
    </div>
  );
}
