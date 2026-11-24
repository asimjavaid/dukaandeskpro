import { useI18n } from '../../i18n';
import { parseMoneyRs } from '../shared/amount';
import {
  applyDiscount,
  formatStoreDateTime,
  isoToStoreInput,
  parsePercent,
  storeInputToMs,
  windowStatus,
  type DiscountKind,
  type DiscountStatus,
  type ProductDiscountFields,
} from '../shared/discount';
import { MoneyInput } from '../shared/MoneyInput';
import { formatRsShort } from '../../lib/money';

export type DiscountDraft = {
  kind: 'none' | DiscountKind;
  /** Percent (kind = percent) or rupees off one unit (kind = fixed). */
  value: string;
  /** Store wall time "YYYY-MM-DDTHH:mm" or empty. */
  start: string;
  end: string;
};

export const EMPTY_DISCOUNT: DiscountDraft = { kind: 'none', value: '', start: '', end: '' };

export function draftFromProduct(p: ProductDiscountFields): DiscountDraft {
  if (p.discount_kind === 'percent') {
    return {
      kind: 'percent',
      value: String(p.discount_percent ?? 0),
      start: isoToStoreInput(p.discount_start_at),
      end: isoToStoreInput(p.discount_end_at),
    };
  }
  if (p.discount_kind === 'fixed') {
    return {
      kind: 'fixed',
      value: ((p.discount_amount_paisa ?? 0) / 100).toFixed(2),
      start: isoToStoreInput(p.discount_start_at),
      end: isoToStoreInput(p.discount_end_at),
    };
  }
  return EMPTY_DISCOUNT;
}

export type DiscountCheck = {
  /** First problem as an API-style error code, or null when it can be saved. */
  error: string | null;
  valueBad: boolean;
  startBad: boolean;
  endBad: boolean;
  /** Discounted price and window status, when the draft is valid. */
  preview: { salePaisa: number; status: DiscountStatus; startMs: number | null; endMs: number | null } | null;
};

/** Same rules as the API: percent 0–100, amount 0 to price, end after start. */
export function checkDiscountDraft(
  d: DiscountDraft,
  pricePaisa: number | null,
  now = Date.now(),
): DiscountCheck {
  const ok: DiscountCheck = { error: null, valueBad: false, startBad: false, endBad: false, preview: null };
  if (d.kind === 'none') return ok;

  const blank = d.value.trim() === '';
  let percent: number | null = null;
  let amountPaisa: number | null = null;
  let error: string | null = null;
  let valueBad = false;
  if (d.kind === 'percent') {
    percent = blank ? null : parsePercent(d.value);
    if (percent == null) {
      error = 'invalid_discount_percent';
      valueBad = !blank;
    }
  } else {
    const rs = blank ? null : parseMoneyRs(d.value);
    if (rs == null) {
      error = 'invalid_discount_amount';
      valueBad = !blank;
    } else {
      amountPaisa = Math.round(rs * 100);
      if (pricePaisa != null && amountPaisa > pricePaisa) {
        error = 'discount_exceeds_price';
        valueBad = true;
      }
    }
  }

  const startMs = storeInputToMs(d.start);
  const endMs = storeInputToMs(d.end);
  const startBad = startMs != null && Number.isNaN(startMs);
  let endBad = endMs != null && Number.isNaN(endMs);
  if (!error && (startBad || endBad)) error = 'invalid_discount_date';
  if (!startBad && !endBad && startMs != null && endMs != null && endMs <= startMs) {
    endBad = true;
    if (!error) error = 'discount_end_before_start';
  }

  if (error || pricePaisa == null) {
    return { error, valueBad, startBad, endBad, preview: null };
  }
  return {
    error: null,
    valueBad: false,
    startBad: false,
    endBad: false,
    preview: {
      salePaisa: applyDiscount(pricePaisa, d.kind, percent, amountPaisa),
      status: windowStatus(
        d.kind,
        startMs == null ? null : new Date(startMs).toISOString(),
        endMs == null ? null : new Date(endMs).toISOString(),
        now,
      ),
      startMs,
      endMs,
    },
  };
}

/** API body for `discount`. null clears it. Dates go as store wall time (API reads Asia/Karachi). */
export function discountPayload(d: DiscountDraft):
  | null
  | {
      kind: DiscountKind;
      percent?: string;
      amountRs?: string;
      startAt: string | null;
      endAt: string | null;
    } {
  if (d.kind === 'none') return null;
  return {
    kind: d.kind,
    ...(d.kind === 'percent' ? { percent: d.value.trim() } : { amountRs: d.value.trim() }),
    startAt: d.start.trim() || null,
    endAt: d.end.trim() || null,
  };
}

const formatRs = formatRsShort;

type Props = {
  idPrefix: string;
  draft: DiscountDraft;
  onChange: (next: DiscountDraft) => void;
  /** Piece price from the form, in paisa. null while the price field is invalid. */
  pricePaisa: number | null;
  /** The saved product has a discount (Edit). Shows a note after Clear. */
  hadDiscount?: boolean;
  disabled?: boolean;
};

export function DiscountFields({
  idPrefix,
  draft,
  onChange,
  pricePaisa,
  hadDiscount = false,
  disabled = false,
}: Props) {
  const { t, locale } = useI18n();
  const check = checkDiscountDraft(draft, pricePaisa);
  const errId = `${idPrefix}-discount-error`;
  const hintId = `${idPrefix}-discount-hint`;
  const showError =
    check.error != null && (check.valueBad || check.startBad || check.endBad);
  const when = (msVal: number) => formatStoreDateTime(new Date(msVal).toISOString(), locale);

  function set<K extends keyof DiscountDraft>(key: K, value: DiscountDraft[K]) {
    onChange({ ...draft, [key]: value });
  }

  let statusText: string | null = null;
  if (check.preview) {
    const { status, startMs, endMs } = check.preview;
    if (status === 'active') {
      statusText =
        endMs != null
          ? t('discountUntil').replace('{date}', when(endMs))
          : t('discountUntilCleared');
    } else if (status === 'scheduled' && startMs != null) {
      statusText = t('discountStartsOn').replace('{date}', when(startMs));
      if (endMs != null) {
        statusText += ` · ${t('discountUntil').replace('{date}', when(endMs))}`;
      }
    } else if (status === 'ended' && endMs != null) {
      statusText = t('discountEndedOn').replace('{date}', when(endMs));
    }
  }
  const sellingNow =
    check.preview && pricePaisa != null
      ? check.preview.status === 'active'
        ? check.preview.salePaisa
        : pricePaisa
      : null;

  return (
    <fieldset className="catalog-discount" disabled={disabled}>
      <legend className="catalog-discount__legend">{t('discountSection')}</legend>

      <div className="catalog-discount__row">
        <div className="field">
          <label htmlFor={`${idPrefix}-discount-kind`}>{t('discountType')}</label>
          <select
            id={`${idPrefix}-discount-kind`}
            value={draft.kind}
            onChange={(e) => {
              const kind = e.target.value as DiscountDraft['kind'];
              // Switching type clears the number so 10 (%) never becomes Rs 10 by accident.
              onChange(kind === 'none' ? EMPTY_DISCOUNT : { ...draft, kind, value: '' });
            }}
          >
            <option value="none">{t('discountNone')}</option>
            <option value="percent">{t('discountPercent')}</option>
            <option value="fixed">{t('discountFixed')}</option>
          </select>
        </div>
        {draft.kind !== 'none' ? (
          <div className="field">
            <label htmlFor={`${idPrefix}-discount-value`}>
              {draft.kind === 'percent' ? t('discountPercentLabel') : t('discountAmountLabel')}
            </label>
            <MoneyInput
              id={`${idPrefix}-discount-value`}
              autoComplete="off"
              value={draft.value}
              onValueChange={(v) => set('value', v)}
              aria-invalid={check.valueBad}
              aria-describedby={showError ? errId : undefined}
              placeholder={draft.kind === 'percent' ? '10' : '0.00'}
              required
            />
          </div>
        ) : null}
      </div>

      {draft.kind !== 'none' ? (
        <>
          <div className="catalog-discount__row">
            <div className="field">
              <label htmlFor={`${idPrefix}-discount-start`}>{t('discountStarts')}</label>
              <input
                id={`${idPrefix}-discount-start`}
                className="ltr-isolate"
                type="datetime-local"
                value={draft.start}
                onChange={(e) => set('start', e.target.value)}
                aria-invalid={check.startBad}
                aria-describedby={hintId}
              />
            </div>
            <div className="field">
              <label htmlFor={`${idPrefix}-discount-end`}>{t('discountEnds')}</label>
              <input
                id={`${idPrefix}-discount-end`}
                className="ltr-isolate"
                type="datetime-local"
                value={draft.end}
                onChange={(e) => set('end', e.target.value)}
                aria-invalid={check.endBad}
                aria-describedby={showError ? `${hintId} ${errId}` : hintId}
              />
            </div>
          </div>
          <p id={hintId} className="muted catalog-help">
            {t('discountWindowHint')}
          </p>

          {showError ? (
            <p id={errId} className="catalog-alert" role="alert">
              {t(
                check.error === 'invalid_discount_percent'
                  ? 'invalidDiscountPercent'
                  : check.error === 'discount_exceeds_price'
                    ? 'discountExceedsPrice'
                    : check.error === 'invalid_discount_date'
                      ? 'invalidDiscountDate'
                      : check.error === 'discount_end_before_start'
                        ? 'discountEndBeforeStart'
                        : 'invalidDiscountAmount',
              )}
            </p>
          ) : null}

          {check.preview && pricePaisa != null ? (
            <div
              className={`catalog-discount__preview catalog-discount__preview--${check.preview.status}`}
              role="status"
            >
              <p className="catalog-discount__price">
                <span>{t('discountSalePrice')}: </span>
                <strong className="ltr-isolate">{formatRs(check.preview.salePaisa)}</strong>{' '}
                <s className="muted ltr-isolate" aria-label={`${t('discountNormalPrice')}: ${formatRs(pricePaisa)}`}>
                  {formatRs(pricePaisa)}
                </s>
              </p>
              {statusText ? <p className="catalog-discount__status">{statusText}</p> : null}
              {sellingNow != null ? (
                <p className="muted">
                  {t('discountSellingNow')}:{' '}
                  <span className="ltr-isolate">{formatRs(sellingNow)}</span>
                </p>
              ) : null}
            </div>
          ) : null}

          <div>
            <button
              type="button"
              className="btn btn--ghost catalog-discount__clear"
              onClick={() => onChange(EMPTY_DISCOUNT)}
            >
              {t('discountClear')}
            </button>
          </div>
        </>
      ) : hadDiscount ? (
        <p className="muted catalog-help" role="status">
          {t('discountWillClear')}
        </p>
      ) : null}
    </fieldset>
  );
}
