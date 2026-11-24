import { useCallback, useEffect, useState } from 'react';
import { translateError, useI18n } from '../../i18n';
import { apiGet, apiPost } from '../../lib/api';
import { EmptyState } from '../shared/EmptyState';
import { formatRsShort } from '../../lib/money';

type QueueItem = {
  id: string;
  sale_id: string | null;
  status: string;
  provider_ref: string | null;
  reason_stub: string | null;
  disposition: string | null;
  sale_short_id: string | null;
  sale_total_paisa: number | null;
  payment_method: string | null;
};

type Props = {
  displayName: string;
  onBack?: () => void;
};

const formatRs = formatRsShort;

function taxStatusLabel(t: (k: 'taxStatusQueued' | 'taxStatusSubmitting' | 'taxRejected' | 'taxAccepted' | 'taxStatusVoided' | 'taxStatusCreditNote' | 'taxStatusFlagged' | 'taxStatusPending') => string, status: string): string {
  switch (status) {
    case 'queued':
      return t('taxStatusQueued');
    case 'submitting':
      return t('taxStatusSubmitting');
    case 'rejected':
      return t('taxRejected');
    case 'accepted':
      return t('taxAccepted');
    case 'voided':
      return t('taxStatusVoided');
    case 'credit_note':
      return t('taxStatusCreditNote');
    case 'flagged':
    case 'keep_flag':
      return t('taxStatusFlagged');
    default:
      return t('taxStatusPending');
  }
}

function payMethodLabel(t: (k: 'receiptCash' | 'receiptUdhaar' | 'receiptSplit') => string, method: string | null): string {
  if (method === 'cash') return t('receiptCash');
  if (method === 'udhaar') return t('receiptUdhaar');
  if (method === 'split') return t('receiptSplit');
  return '';
}

export function TaxQueueShell({ displayName, onBack }: Props) {
  const { t } = useI18n();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const q = await apiGet<{ items: QueueItem[] }>('/tax/queue');
    setItems(q.items);
  }, []);

  useEffect(() => {
    refresh().catch(() => setError('tax_unavailable'));
  }, [refresh]);

  async function processNext(outcome?: 'accepted' | 'rejected') {
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<{
        processed?: boolean;
        drained?: boolean;
        status?: string;
        providerRef?: string;
      }>('/tax/process-next', outcome ? { outcome } : {});
      await refresh();
      if (r.processed || r.drained) {
        const status = r.status ? taxStatusLabel(t, r.status) : '';
        setMsg(
          `${t('taxProcessed')}${status ? `: ${status}` : ''}${
            r.providerRef ? ` · ${r.providerRef}` : ''
          }`,
        );
      } else {
        setMsg(t('taxQueueEmpty'));
      }
    } catch {
      setError('process_failed');
    } finally {
      setBusy(false);
    }
  }

  async function dispose(
    id: string,
    action: 'void' | 'keep-flag' | 'credit-note',
  ) {
    setBusy(true);
    setError(null);
    try {
      const path =
        action === 'void'
          ? `/tax/${id}/void`
          : action === 'keep-flag'
            ? `/tax/${id}/keep-flag`
            : `/tax/${id}/credit-note`;
      const r = await apiPost<
        | { ok: true; message: string; disposition: string }
        | { ok: false; error: string }
      >(path, {});
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setMsg(
        action === 'void'
          ? t('taxVoidedDone')
          : action === 'keep-flag'
            ? t('taxKeptFlagged')
            : t('taxCreditQueued'),
      );
      await refresh();
    } catch {
      setError('dispose_failed');
    } finally {
      setBusy(false);
    }
  }

  const pending = items.filter(
    (i) => i.status === 'queued' || i.status === 'submitting',
  );
  const rejected = items.filter(
    (i) => i.status === 'rejected' && !i.disposition,
  );
  const queueClear = pending.length === 0 && rejected.length === 0;

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>{t('taxQueue')}</h2>
      <p className="muted">
        {displayName} · {t('taxQueueNote')}
      </p>

      {queueClear ? (
        <EmptyState
          title={t('emptyStateTaxTitle')}
          description={t('emptyStateTaxDesc')}
          action={
            onBack ? (
              <button type="button" className="btn btn--ghost" onClick={onBack}>
                {t('emptyStateTaxBack')}
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="nav-row" style={{ marginBlock: 12 }}>
            <button
              type="button"
              className="btn btn--teal"
              disabled={busy}
              onClick={() => processNext()}
            >
              {t('taxProcessNext')}
            </button>
          </div>

          {msg ? <p className="muted ltr-isolate">{msg}</p> : null}
          {error ? (
            <p className="muted" role="alert" style={{ color: 'var(--danger)' }}>
              {translateError(t, error)}
            </p>
          ) : null}

          <section style={{ marginBlock: 16 }}>
            <h3 style={{ font: 'var(--type-subtitle)', marginTop: 0 }}>
              {t('taxPending')} ({pending.length})
            </h3>
            {pending.length === 0 ? (
              <p className="muted">—</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {pending.map((q) => (
                  <li
                    key={q.id}
                    style={{
                      padding: '8px 0',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}
                  >
                    <span className="chip">{taxStatusLabel(t, q.status)}</span>
                    {q.sale_short_id ? (
                      <>
                        {' '}
                        · {t('saleId')}:{' '}
                        <strong className="ltr-isolate">{q.sale_short_id}</strong>
                      </>
                    ) : null}
                    {q.sale_total_paisa != null ? (
                      <span className="muted ltr-isolate">
                        {' '}
                        · {formatRs(q.sale_total_paisa)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 style={{ font: 'var(--type-subtitle)' }}>
              {t('taxRejected')} ({rejected.length})
            </h3>
            <p className="muted">{t('taxDispositionNote')}</p>
            {rejected.length === 0 ? (
              <p className="muted">—</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {rejected.map((q) => (
                  <li
                    key={q.id}
                    style={{
                      padding: '12px 0',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div>
                      <span className="chip">{taxStatusLabel(t, q.status)}</span>
                      {q.sale_short_id ? (
                        <>
                          {' '}
                          · {t('saleId')}:{' '}
                          <strong className="ltr-isolate">{q.sale_short_id}</strong>
                        </>
                      ) : null}
                      {q.payment_method ? (
                        <span className="chip">{payMethodLabel(t, q.payment_method)}</span>
                      ) : null}
                      {q.sale_total_paisa != null ? (
                        <span className="muted ltr-isolate">
                          {' '}
                          {formatRs(q.sale_total_paisa)}
                        </span>
                      ) : null}
                    </div>
                    {q.reason_stub || q.provider_ref ? (
                      <p className="muted ltr-isolate" style={{ margin: '4px 0' }}>
                        {q.reason_stub ? `${t('taxReason')}: ${q.reason_stub}` : ''}
                        {q.provider_ref ? ` · ${t('taxRef')}: ${q.provider_ref}` : ''}
                      </p>
                    ) : null}
                    <div className="nav-row" style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        className="btn btn--teal"
                        disabled={busy}
                        onClick={() => dispose(q.id, 'void')}
                      >
                        {t('taxVoidSale')}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => dispose(q.id, 'keep-flag')}
                      >
                        {t('taxKeepFlag')}
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        disabled={busy}
                        onClick={() => dispose(q.id, 'credit-note')}
                      >
                        {t('taxCreditNote')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {queueClear && msg ? (
        <p className="muted ltr-isolate">{msg}</p>
      ) : null}
      {queueClear && error ? (
        <p className="muted" role="alert" style={{ color: 'var(--danger)' }}>
          {translateError(t, error)}
        </p>
      ) : null}
    </div>
  );
}
