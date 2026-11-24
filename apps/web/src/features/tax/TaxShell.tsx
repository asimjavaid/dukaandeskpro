import { useCallback, useEffect, useState } from 'react';
import { UrHint, translateError, useI18n } from '../../i18n';
import { apiGet } from '../../lib/api';
import { PageHeader } from '../shared/PageHeader';
import { formatRsShort } from '../../lib/money';

const RATE_PREF_KEY = 'dukaandesk_tax_last_rate_bp';

type Summary = {
  ok: true;
  from: string;
  to: string;
  sales_base_paisa: number;
  sale_count: number;
  tax_paisa?: number;
  rate_bp?: number;
};

/** D31.3 — Pakistan FY row for previous-period table. */
type FyRow = {
  label: string;
  from: string;
  to: string;
  sales_base_paisa: number;
  sale_count: number;
  tax_paisa?: number;
};

type Props = {
  displayName: string;
};

const formatRs = formatRsShort;

function pktYmd(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Pakistan FY containing a PKT Y-M-D: 1 Jul → 30 Jun. */
function fiscalYearForPktYmd(ymd: string): {
  label: string;
  from: string;
  to: string;
} {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const startYear = m >= 7 ? y : y - 1;
  const endYear = startYear + 1;
  const yy = String(endYear).slice(-2);
  return {
    label: `FY ${startYear}-${yy}`,
    from: `${String(startYear).padStart(4, '0')}-07-01`,
    to: `${String(endYear).padStart(4, '0')}-06-30`,
  };
}

function parseRatePercent(raw: string): number | null {
  const text = raw.trim().replace(/%$/, '').trim();
  if (!text) return null;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) return null;
  const bp = Math.round(Number(text) * 100);
  return bp >= 0 && bp <= 10000 ? bp : null;
}

function rateText(rateBp: number): string {
  return String(Number((rateBp / 100).toFixed(2)));
}

function readLastRateBp(): number | null {
  try {
    const raw = localStorage.getItem(RATE_PREF_KEY);
    if (!raw) return null;
    const n = Math.round(Number(raw));
    return Number.isFinite(n) && n > 0 && n <= 10000 ? n : null;
  } catch {
    return null;
  }
}

function writeLastRateBp(rateBp: number): void {
  try {
    localStorage.setItem(RATE_PREF_KEY, String(rateBp));
  } catch {
    /* ignore */
  }
}

export function TaxShell({ displayName }: Props) {
  const { t } = useI18n();
  const today = pktYmd();
  const currentFy = fiscalYearForPktYmd(today);
  const defaultFrom = currentFy.from;

  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(today);
  const [rate, setRate] = useState(() => {
    const bp = readLastRateBp();
    return bp ? rateText(bp) : '';
  });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [fiscalYears, setFiscalYears] = useState<FyRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState(false);

  const rateBp = parseRatePercent(rate);
  const rateOk = rateBp != null && rateBp > 0;

  const refreshSummary = useCallback(async () => {
    setBusy(true);
    setError(null);
    setRangeError(false);
    try {
      if (to < from) {
        setRangeError(true);
        setSummary(null);
        return;
      }
      const params = new URLSearchParams({ from, to });
      if (rateOk && rateBp != null) {
        params.set('rate_bp', String(rateBp));
      }
      const r = await apiGet<Summary>(`/tax/summary?${params.toString()}`);
      setSummary(r);
      if (rateOk && rateBp != null) writeLastRateBp(rateBp);
    } catch {
      setSummary(null);
      setError('tax_unavailable');
    } finally {
      setBusy(false);
    }
  }, [from, to, rateOk, rateBp]);

  const refreshPrevious = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (rateOk && rateBp != null) {
        params.set('rate_bp', String(rateBp));
      }
      const qs = params.toString();
      const r = await apiGet<{
        ok: true;
        fiscal_years: FyRow[];
        current: { label: string; from: string; to: string };
      }>(`/tax/fiscal-years${qs ? `?${qs}` : ''}`);
      setFiscalYears(r.fiscal_years ?? []);
    } catch {
      setFiscalYears([]);
    }
  }, [rateOk, rateBp]);

  useEffect(() => {
    void refreshSummary();
  }, [refreshSummary]);

  useEffect(() => {
    void refreshPrevious();
  }, [refreshPrevious]);

  function onRateBlur() {
    void refreshSummary();
    void refreshPrevious();
  }

  function onRateKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void refreshSummary();
      void refreshPrevious();
    }
  }

  function openFy(row: FyRow) {
    setFrom(row.from);
    setTo(row.to);
  }

  const displayBase = summary?.sales_base_paisa ?? 0;
  const displayTax = rateOk ? summary?.tax_paisa ?? 0 : null;

  return (
    <div className="card tax-shell">
      <PageHeader
        title={<>{t('taxTitle')}<UrHint k="taxTitle" /></>}
        subtitle={displayName}
        actions={
          error ? (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              void refreshSummary();
              void refreshPrevious();
            }}
            disabled={busy}
          >
            {t('retry')}
          </button>
          ) : undefined
        }
      />

      {error ? (
        <p className="catalog-alert" role="alert">
          {translateError(t, error)}
        </p>
      ) : null}

      <section className="analytics-period" aria-label={t('taxPeriod')}>
        <div className="tax-controls settings-fields">
          <div className="field">
            <label htmlFor="tax-from">{t('taxFrom')}</label>
            <input
              id="tax-from"
              type="date"
              className="ltr-isolate"
              value={from}
              max={to || today}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="tax-to">{t('taxTo')}</label>
            <input
              id="tax-to"
              type="date"
              className="ltr-isolate"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="tax-rate">{t('taxRatePercent')}</label>
            <input
              id="tax-rate"
              className="ltr-isolate"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              onBlur={onRateBlur}
              onKeyDown={onRateKey}
              inputMode="decimal"
              maxLength={6}
              placeholder="17"
            />
          </div>
        </div>

        {rangeError ? (
          <p className="catalog-alert" role="alert">
            {t('taxInvalidRange')}
          </p>
        ) : null}

        <div className="analytics-kpi-grid tax-results">
          <div className="analytics-kpi analytics-kpi--sales">
            <div className="analytics-kpi__label muted">{t('taxSales')}</div>
            <strong className="analytics-kpi__value ltr-isolate">
              {formatRs(displayBase)}
            </strong>
          </div>
          <div className="analytics-kpi analytics-kpi--count">
            <div className="analytics-kpi__label muted">{t('taxAmount')}</div>
            <strong className="analytics-kpi__value ltr-isolate">
              {displayTax == null ? '—' : formatRs(displayTax)}
            </strong>
          </div>
        </div>
      </section>

      <section className="tax-previous" aria-label={t('taxPrevious')}>
        <div className="catalog-table-wrap">
          <table className="catalog-table">
            <thead>
              <tr>
                <th>{t('taxPeriod')}</th>
                <th className="num">{t('taxSales')}</th>
                <th className="num">{t('taxAmount')}</th>
              </tr>
            </thead>
            <tbody>
              {fiscalYears.map((row) => (
                <tr key={row.label}>
                  <td>
                    <button
                      type="button"
                      className="btn btn--ghost ltr-isolate"
                      onClick={() => openFy(row)}
                    >
                      {row.label}
                    </button>
                  </td>
                  <td className="num ltr-isolate">
                    {formatRs(row.sales_base_paisa)}
                  </td>
                  <td className="num ltr-isolate">
                    {rateOk ? formatRs(row.tax_paisa ?? 0) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
