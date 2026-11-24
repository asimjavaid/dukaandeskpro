import { useCallback, useEffect, useState } from 'react';
import { UrHint, translateError, useI18n } from '../../i18n';
import { apiGet, apiPostRaw } from '../../lib/api';
import { formatRsShort as formatRs } from '../../lib/money';
import { ConfirmModal } from '../shared/ConfirmModal';
import { EmptyState } from '../shared/EmptyState';
import { PageHeader } from '../shared/PageHeader';
import { formatQty, productUnitKey } from '../shared/productUnits';
import type { RestockPrefill } from '../purchases/PurchasesShell';
import { RepackPanel, type RepackIntent } from './RepackPanel';

type ReorderItem = {
  id: string;
  name: string;
  unit_label: string;
  reorder_level: number;
  qty_on_hand: number;
  suggested_qty: number;
  last_unit_cost_paisa: number | null;
  last_supplier: string | null;
  repack: { bulk_id: string; bulk_name: string; bulk_unit: string; bulk_on_hand: number; can_make: number } | null;
};
type ExpiryItem = {
  batch_line_id: string;
  product_id: string;
  product_name: string;
  unit_label: string;
  expiry_date: string;
  batch_no: string | null;
  qty_left: number;
  days_left: number;
  expired: boolean;
  supplier_name: string | null;
};
type WriteOffRow = {
  id: string;
  product_name: string;
  unit_label: string;
  qty: number;
  reason: string;
  note: string | null;
  value_paisa: number;
  created_at: string;
  by_name: string | null;
};
type ProductLite = { id: string; name: string; unit_label: string; qty_on_hand: number };

type Tab = 'reorder' | 'repack' | 'expiry' | 'writeoffs';

type Props = {
  displayName: string;
  isOwner: boolean;
  onMakePurchase: (items: RestockPrefill[]) => void;
};

type WriteOffDraft = { productId: string; name: string; unit: string; qty: string; reason: 'damaged' | 'expired'; note: string; batchLineId?: string };

/** Stock care: reorder list, near-expiry batches, damaged / expired write-offs. */
export function StockCareShell({ displayName, isOwner, onMakePurchase }: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('reorder');
  const [reorder, setReorder] = useState<ReorderItem[] | null>(null);
  const [expiry, setExpiry] = useState<{ window_days: number; items: ExpiryItem[] } | null>(null);
  const [writeOffs, setWriteOffs] = useState<{ items: WriteOffRow[]; total_value_paisa: number } | null>(null);
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [draft, setDraft] = useState<WriteOffDraft | null>(null);
  const [pickQuery, setPickQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissId, setDismissId] = useState<string | null>(null);
  const [repackIntent, setRepackIntent] = useState<RepackIntent>(null);

  const load = useCallback(async () => {
    const [r, e] = await Promise.all([
      apiGet<{ items: ReorderItem[] }>('/stock/reorder'),
      apiGet<{ window_days: number; items: ExpiryItem[] }>('/stock/expiring'),
    ]);
    setReorder(r.items);
    setExpiry(e);
    if (isOwner) {
      const w = await apiGet<{ items: WriteOffRow[]; total_value_paisa: number }>('/stock/write-offs');
      setWriteOffs(w);
    }
  }, [isOwner]);

  useEffect(() => {
    load().catch(() => setError('load_failed'));
    apiGet<{ items?: ProductLite[]; products?: ProductLite[] }>('/catalog/products')
      .then((r) => setProducts(r.items ?? r.products ?? []))
      .catch(() => undefined);
  }, [load]);

  async function saveWriteOff() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    const res = await apiPostRaw<{ ok: boolean; error?: string; message?: { error?: string } }>('/stock/write-off', {
      productId: draft.productId,
      qty: draft.qty,
      reason: draft.reason,
      note: draft.note,
      batchLineId: draft.batchLineId,
    });
    setBusy(false);
    if (!res.json?.ok) {
      setError(res.json?.message && typeof res.json.message === 'object' ? res.json.message.error ?? 'save_failed' : res.json?.error ?? 'save_failed');
      return;
    }
    setDraft(null);
    await load();
  }

  async function dismiss(id: string) {
    setBusy(true);
    await apiPostRaw(`/stock/expiring/${encodeURIComponent(id)}/dismiss`, {});
    setBusy(false);
    setDismissId(null);
    await load();
  }

  const unit = (u: string) => t(productUnitKey(u));
  const picks = pickQuery.trim()
    ? products.filter((p) => p.name.toLowerCase().includes(pickQuery.trim().toLowerCase())).slice(0, 8)
    : [];

  return (
    <div className="card">
      <PageHeader
        title={<>{t('stockCare')}<UrHint k="stockCare" /></>}
        subtitle={displayName}
        actions={
          <button
            type="button"
            className="btn btn--teal"
            data-new-writeoff
            onClick={() => {
              setPickQuery('');
              setDraft({ productId: '', name: '', unit: 'piece', qty: '', reason: 'damaged', note: '' });
            }}
          >
            {t('writeOffNew')}
          </button>
        }
      />
      <div className="analytics-tabs" role="tablist">
        {(
          [
            ['reorder', 'reorderTitle', reorder?.length ?? 0],
            ['repack', 'repackTitle', (reorder ?? []).filter((r) => r.repack).length],
            ['expiry', 'expiryTitle', expiry?.items.length ?? 0],
            ...(isOwner ? [['writeoffs', 'writeOffsTitle', writeOffs?.items.length ?? 0]] : []),
          ] as Array<[Tab, 'reorderTitle' | 'repackTitle' | 'expiryTitle' | 'writeOffsTitle', number]>
        ).map(([id, label, n]) => (
          <button
            key={id}
            type="button"
            role="tab"
            className={`analytics-tab${tab === id ? ' is-active' : ''}`}
            aria-selected={tab === id}
            data-tab={id}
            onClick={() => setTab(id)}
          >
            {t(label)} <span className="chip chip--neutral ltr-isolate">{n}</span>
          </button>
        ))}
      </div>
      {error ? <p className="pos-alert" role="alert">{translateError(t, error)}</p> : null}

      {tab === 'reorder' ? (
        reorder && reorder.length === 0 ? (
          <EmptyState title={t('reorderEmpty')} description="" />
        ) : (
          <>
            <div className="b2-toolbar">
              <button
                type="button"
                className="btn btn--teal"
                disabled={!reorder?.length}
                data-make-purchase
                onClick={() =>
                  onMakePurchase(
                    (reorder ?? []).filter((r) => !r.repack).map((r) => ({
                      id: r.id,
                      name: r.name,
                      unit_label: r.unit_label,
                      last_unit_cost_paisa: r.last_unit_cost_paisa,
                      qty: r.suggested_qty,
                    })),
                  )
                }
              >
                {t('reorderMakePurchase')}
              </button>
            </div>
            <div className="catalog-table-wrap">
              <table className="catalog-table parties-table" data-reorder-table>
                <thead>
                  <tr>
                    <th className="catalog-table__col-product">{t('colItem')}</th>
                    <th className="catalog-table__num">{t('onHand')}</th>
                    <th className="catalog-table__num">{t('reorderLevel')}</th>
                    <th className="catalog-table__num">{t('reorderSuggest')}</th>
                    <th>{t('suppliersTitle')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(reorder ?? []).map((r) => (
                    <tr key={r.id}>
                      <td className="catalog-table__col-product">{r.name}</td>
                      <td className="catalog-table__num ltr-isolate b2-warn">{formatQty(r.qty_on_hand)} {unit(r.unit_label)}</td>
                      <td className="catalog-table__num ltr-isolate">{formatQty(r.reorder_level)}</td>
                      <td className="catalog-table__num ltr-isolate"><strong>{formatQty(r.suggested_qty)}</strong></td>
                      <td className="muted">
                        {r.repack ? (
                          <button
                            type="button"
                            className="btn btn--teal btn--sm"
                            title={`${r.repack.bulk_name} ${formatQty(r.repack.bulk_on_hand)}`}
                            onClick={() => {
                              setRepackIntent({ bulkId: r.repack!.bulk_id, productId: r.id, packets: Math.min(r.repack!.can_make, Math.ceil(r.suggested_qty)) });
                              setTab('repack');
                            }}
                          >
                            Repack
                          </button>
                        ) : (
                          r.last_supplier ?? '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : null}

      {tab === 'repack' ? <RepackPanel isOwner={isOwner} intent={repackIntent} onDone={() => void load()} /> : null}

      {tab === 'expiry' ? (
        expiry && expiry.items.length === 0 ? (
          <EmptyState title={t('expiryEmpty').replace('{days}', String(expiry.window_days))} description="" />
        ) : (
          <div className="catalog-table-wrap">
            <table className="catalog-table parties-table" data-expiry-table>
              <thead>
                <tr>
                  <th className="catalog-table__col-product">{t('colItem')}</th>
                  <th>{t('expiryDate')}</th>
                  <th>{t('batchNo')}</th>
                  <th className="catalog-table__num">{t('expiryLeft')}</th>
                  <th className="parties-table__col-actions">{t('partiesColActions')}</th>
                </tr>
              </thead>
              <tbody>
                {(expiry?.items ?? []).map((x) => (
                  <tr key={x.batch_line_id}>
                    <td className="catalog-table__col-product">
                      {x.product_name}
                      {x.supplier_name ? <div className="muted">{x.supplier_name}</div> : null}
                    </td>
                    <td className="ltr-isolate">
                      {x.expiry_date}{' '}
                      <span className={`chip ${x.expired ? 'chip--danger' : 'chip--warn'}`}>
                        {x.expired ? t('expiredChip') : t('expiryDaysLeft').replace('{n}', String(x.days_left))}
                      </span>
                    </td>
                    <td className="ltr-isolate">{x.batch_no ?? '—'}</td>
                    <td className="catalog-table__num ltr-isolate">{formatQty(x.qty_left)} {unit(x.unit_label)}</td>
                    <td className="parties-table__col-actions">
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() =>
                          setDraft({
                            productId: x.product_id,
                            name: x.product_name,
                            unit: x.unit_label,
                            qty: String(x.qty_left),
                            reason: x.expired ? 'expired' : 'damaged',
                            note: x.batch_no ? `Batch ${x.batch_no}` : '',
                            batchLineId: x.batch_line_id,
                          })
                        }
                      >
                        {t('writeOffAction')}
                      </button>
                      <button type="button" className="btn btn--ghost" onClick={() => setDismissId(x.batch_line_id)}>
                        {t('expiryDismiss')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === 'writeoffs' && writeOffs ? (
        writeOffs.items.length === 0 ? (
          <EmptyState title={t('writeOffsEmpty')} description="" />
        ) : (
          <>
            <p className="muted">
              {t('writeOffsValue')}: <strong className="ltr-isolate">{formatRs(writeOffs.total_value_paisa)}</strong>
            </p>
            <div className="catalog-table-wrap">
              <table className="catalog-table parties-table">
                <thead>
                  <tr>
                    <th>{t('tillTime')}</th>
                    <th className="catalog-table__col-product">{t('colItem')}</th>
                    <th className="catalog-table__num">{t('qty')}</th>
                    <th>{t('tillReason')}</th>
                    <th className="catalog-table__num">{t('writeOffsValue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {writeOffs.items.map((w) => (
                    <tr key={w.id}>
                      <td className="ltr-isolate">{w.created_at.slice(0, 16).replace('T', ' ')}</td>
                      <td className="catalog-table__col-product">
                        {w.product_name}
                        {w.note ? <div className="muted">{w.note}</div> : null}
                      </td>
                      <td className="catalog-table__num ltr-isolate">{formatQty(w.qty)} {unit(w.unit_label)}</td>
                      <td>
                        <span className={`chip ${w.reason === 'expired' ? 'chip--danger' : 'chip--warn'}`}>
                          {w.reason === 'expired' ? t('writeOffExpired') : t('writeOffDamaged')}
                        </span>
                        {w.by_name ? <span className="muted"> {w.by_name}</span> : null}
                      </td>
                      <td className="catalog-table__num ltr-isolate">{formatRs(w.value_paisa)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : null}

      {draft ? (
        <ConfirmModal
          title={t('writeOffNew')}
          message={draft.name || t('writeOffPick')}
          confirmLabel={t('writeOffAction')}
          cancelLabel={t('cancel')}
          busy={busy}
          confirmDisabled={!draft.productId || !(Number(draft.qty) > 0)}
          onConfirm={() => void saveWriteOff()}
          onCancel={() => setDraft(null)}
        >
          <div className="b2-grid2" data-writeoff-form>
            {!draft.batchLineId ? (
              <div className="field">
                <label htmlFor="wo-item">{t('colItem')}</label>
                <input
                  id="wo-item"
                  className="input"
                  autoFocus
                  value={draft.productId ? draft.name : pickQuery}
                  onChange={(e) => {
                    setPickQuery(e.target.value);
                    setDraft({ ...draft, productId: '', name: '' });
                  }}
                />
                {picks.length > 0 && !draft.productId ? (
                  <ul className="b2-picks">
                    {picks.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          className="btn btn--ghost"
                          onClick={() => setDraft({ ...draft, productId: p.id, name: p.name, unit: p.unit_label })}
                        >
                          {p.name} <span className="muted ltr-isolate">({formatQty(p.qty_on_hand)})</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="wo-qty">{t('qty')} ({unit(draft.unit)})</label>
              <input
                id="wo-qty"
                className="input ltr-isolate"
                inputMode="decimal"
                value={draft.qty}
                onChange={(e) => setDraft({ ...draft, qty: e.target.value.replace(/[^\d.]/g, '') })}
              />
            </div>
            <div className="field">
              <label>{t('tillReason')}</label>
              <span className="pos-billdisc__kind">
                {(['damaged', 'expired'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={`chip${draft.reason === r ? ' is-active' : ''}`}
                    onClick={() => setDraft({ ...draft, reason: r })}
                  >
                    {r === 'damaged' ? t('writeOffDamaged') : t('writeOffExpired')}
                  </button>
                ))}
              </span>
            </div>
            <div className="field">
              <label htmlFor="wo-note">{t('note')}</label>
              <input id="wo-note" className="input" maxLength={200} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
            </div>
          </div>
        </ConfirmModal>
      ) : null}

      {dismissId ? (
        <ConfirmModal
          title={t('expiryDismiss')}
          message={t('expiryDismissMsg')}
          confirmLabel={t('expiryDismiss')}
          cancelLabel={t('cancel')}
          tone="primary"
          busy={busy}
          onConfirm={() => void dismiss(dismissId)}
          onCancel={() => setDismissId(null)}
        />
      ) : null}
    </div>
  );
}
