import { useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import {
  buildReceiptPayload,
  formatReceiptText,
  shareOrCopyReceipt,
  type SaleReceiptFields,
} from './receipt';
import { printThermalReceipt } from './printReceipt';
import './receipt.css';

type Props = {
  fields: SaleReceiptFields;
  onBack: () => void;
  onNewSale?: () => void;
  receiptWidthMm?: 58 | 80;
  printerName?: string | null;
};

function formatRs(paisa: number): string {
  return `Rs ${(paisa / 100).toFixed(2)}`;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-PK', { hour12: true });
  } catch {
    return iso;
  }
}

export function ReceiptView({
  fields,
  onBack,
  onNewSale,
  receiptWidthMm = 80,
  printerName = null,
}: Props) {
  const { t } = useI18n();
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(
    null,
  );
  const [printBusy, setPrintBusy] = useState(false);

  const payload = useMemo(() => buildReceiptPayload(fields), [fields]);

  const text = useMemo(
    () =>
      formatReceiptText(payload, {
        total: t('receiptTotal'),
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
      }),
    [payload, t],
  );

  function showToast(msg: string, kind: 'ok' | 'err' = 'ok') {
    setToast({ msg, kind });
    window.setTimeout(() => setToast(null), 2200);
  }

  async function onShare() {
    const result = await shareOrCopyReceipt(text, payload.store_name);
    if (result === 'shared') {
      showToast(t('receiptShared'), 'ok');
    } else if (result === 'copied') {
      showToast(t('receiptCopied'), 'ok');
    } else {
      showToast(t('receiptShareFailed'), 'err');
    }
  }

  async function onPrint() {
    if (printBusy) return;
    setPrintBusy(true);
    try {
      const result = await printThermalReceipt({
        fields,
        widthMm: receiptWidthMm,
        printerName,
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
      if (result === 'ok') {
        showToast(t('receiptPrinted').replace('{id}', payload.sale_id_short), 'ok');
      } else {
        showToast(t('receiptPrintFailed'), 'err');
      }
    } finally {
      setPrintBusy(false);
    }
  }

  const pb = payload.payment_breakdown;
  const methodLabel =
    pb.method === 'udhaar'
      ? t('receiptUdhaar')
      : pb.method === 'split'
        ? t('receiptSplit')
        : t('receiptCash');

  return (
    <div className="receipt-shell">
      <div className="card no-print" style={{ marginBottom: 12 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <h2 style={{ margin: 0 }}>{t('receipt')}</h2>
          <button type="button" className="btn btn--ghost" onClick={onBack}>
            {t('back')}
          </button>
        </div>
      </div>

      <article
        className="receipt-ticket"
        aria-label={t('receipt')}
        data-receipt="true"
        data-width={receiptWidthMm === 58 ? '58' : '80'}
      >
        <h2 className="receipt-ticket__store">{payload.store_name}</h2>
        <p className="receipt-ticket__meta ltr-isolate">
          {t('receiptSaleId')}: {payload.sale_id_short}
        </p>

        <ul className="receipt-lines">
          {payload.lines.map((line, i) => (
            <li key={`${line.name}-${i}`} className="receipt-line">
              <div className="receipt-line__top">
                <span className="receipt-line__name">{line.name}</span>
                <span className="receipt-line__total ltr-isolate">
                  {formatRs(line.line_total_paisa)}
                </span>
              </div>
              <div className="receipt-line__meta ltr-isolate">
                {line.qty_unit_label} × {formatRs(line.unit_price_paisa)}
              </div>
            </li>
          ))}
        </ul>

        <div className="receipt-totals">
          {payload.extras?.subtotal_paisa != null ? (
            <div className="receipt-totals__row">
              <span>{t('billSubtotal')}</span>
              <span className="ltr-isolate">{formatRs(payload.extras.subtotal_paisa)}</span>
            </div>
          ) : null}
          {payload.extras && payload.extras.discount_paisa > 0 ? (
            <div className="receipt-totals__row" data-receipt-discount>
              <span>{t('billDiscount')}{payload.extras.discount_label ? ` (${payload.extras.discount_label})` : ''}</span>
              <span className="ltr-isolate">−{formatRs(payload.extras.discount_paisa)}</span>
            </div>
          ) : null}
          {payload.extras && payload.extras.rounding_paisa !== 0 ? (
            <div className="receipt-totals__row" data-receipt-rounding>
              <span>{t('billRounding')}</span>
              <span className="ltr-isolate">{formatRs(payload.extras.rounding_paisa)}</span>
            </div>
          ) : null}
          <div className="receipt-totals__row receipt-totals__row--total">
            <span>{t('receiptTotal')}</span>
            <span className="ltr-isolate amount">
              {formatRs(payload.total_paisa)}
            </span>
          </div>
          {payload.sales_tax ? (
            <div
              className="receipt-totals__row receipt-totals__row--tax"
              data-sales-tax
            >
              <span>
                {t('receiptSalesTaxIncl')}{' '}
                <span className="ltr-isolate">{payload.sales_tax.rate_text}%</span>
              </span>
              <span className="ltr-isolate">
                {formatRs(payload.sales_tax.tax_paisa)}
              </span>
            </div>
          ) : null}
          <div className="receipt-totals__row">
            <span>{t('receiptPayment')}</span>
            <span>{methodLabel}</span>
          </div>
          {payload.extras && payload.extras.digital_paisa > 0 ? (
            <div className="receipt-totals__row" data-receipt-digital>
              <span>
                {payload.extras.digital_label}
                {payload.extras.digital_ref ? <span className="muted ltr-isolate"> {payload.extras.digital_ref}</span> : null}
              </span>
              <span className="ltr-isolate">{formatRs(payload.extras.digital_paisa)}</span>
            </div>
          ) : null}
          {payload.extras?.points_balance != null ? (
            <div className="receipt-totals__row" data-receipt-points>
              <span>{t('loyaltyPoints')} +{payload.extras.points_earned ?? 0}</span>
              <span className="ltr-isolate">{payload.extras.points_balance}</span>
            </div>
          ) : null}
          {pb.method === 'cash' || pb.method === 'split' ? (
            <div className="receipt-totals__row">
              <span>{t('receiptCash')}</span>
              <span className="ltr-isolate">
                {formatRs(pb.cash_paisa ?? 0)}
              </span>
            </div>
          ) : null}
          {pb.method === 'udhaar' || pb.method === 'split' ? (
            <div className="receipt-totals__row">
              <span>{t('receiptUdhaar')}</span>
              <span className="ltr-isolate">
                {formatRs(pb.udhaar_paisa ?? 0)}
              </span>
            </div>
          ) : null}
          {pb.method !== 'udhaar' && pb.tendered_paisa != null ? (
            <div className="receipt-totals__row">
              <span>{t('receiptPaid')}</span>
              <span className="ltr-isolate">{formatRs(pb.tendered_paisa)}</span>
            </div>
          ) : null}
          {pb.method !== 'udhaar' && pb.change_paisa != null ? (
            <div className="receipt-totals__row" data-change>
              <span>{t('receiptChange')}</span>
              <span className="ltr-isolate">{formatRs(pb.change_paisa)}</span>
            </div>
          ) : null}
          {pb.party_name ? (
            <div className="receipt-totals__row">
              <span>{t('receiptParty')}</span>
              <span>{pb.party_name}</span>
            </div>
          ) : null}
        </div>

        <div className="receipt-times">
          <p className="muted ltr-isolate" style={{ margin: '4px 0' }}>
            {t('receiptClientTime')}: {formatTime(payload.client_device_at)}
          </p>
          {payload.recorded_at ? (
            <p className="muted ltr-isolate" style={{ margin: '4px 0' }}>
              {t('receiptRecordedTime')}: {formatTime(payload.recorded_at)}
            </p>
          ) : null}
        </div>

        {payload.receipt_footer ? (
          <p className="receipt-footer" data-receipt-footer>
            {payload.receipt_footer}
          </p>
        ) : null}
      </article>

      <div className="receipt-actions no-print">
        <button
          type="button"
          className="btn btn--teal"
          data-receipt-print
          disabled={printBusy}
          onClick={() => void onPrint()}
        >
          {printBusy ? t('loading') : t('receiptPrint')}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          data-receipt-share
          onClick={() => void onShare()}
        >
          {t('receiptShare')}
        </button>
        {onNewSale ? (
          <button type="button" className="btn btn--ghost" onClick={onNewSale}>
            {t('newSale')}
          </button>
        ) : null}
      </div>

      {toast ? (
        <p
          className={`receipt-toast no-print${toast.kind === 'err' ? ' receipt-toast--danger' : ''}`}
          role="status"
          aria-live="polite"
        >
          {toast.msg}
        </p>
      ) : null}
    </div>
  );
}
