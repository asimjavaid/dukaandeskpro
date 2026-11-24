import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { apiGetBlob, apiGetRaw, apiPostRaw, saveBlob } from '../../lib/api';
import { formatRsShort } from '../../lib/money';
import { ConfirmModal } from '../shared/ConfirmModal';
import { type OsBatch, type OsBatchFull, blockKey, fmtNum, fmtPkt, fmtQty } from './openingModel';

type Props = {
  batches: OsBatch[];
  selectedId: string;
  draftCount: number;
  onSelect: (id: string) => void;
  onAddMore: () => void;
  onUndone: (number: number) => void | Promise<void>;
  onError: (code: string) => void;
};

/** Posted opening stock: read-only batch, Excel / PDF, undo for the last batch. */
export function OpeningSummary({ batches, selectedId, draftCount, onSelect, onAddMore, onUndone, onError }: Props) {
  const { t } = useI18n();
  const [batch, setBatch] = useState<OsBatchFull | null>(null);
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void apiGetRaw<{ ok: boolean; batch: OsBatchFull }>(`/opening-stock/batches/${encodeURIComponent(selectedId)}`).then((r) => {
      if (live && r.json?.ok) setBatch(r.json.batch);
    });
    return () => {
      live = false;
    };
  }, [selectedId, batches]);

  useEffect(() => {
    const off = () => document.body.classList.remove('os-printing');
    window.addEventListener('afterprint', off);
    return () => window.removeEventListener('afterprint', off);
  }, []);

  async function exportXlsx() {
    if (!batch) return;
    try {
      const { blob, filename } = await apiGetBlob(`/opening-stock/batches/${encodeURIComponent(batch.id)}/export.xlsx`);
      saveBlob(blob, filename ?? `opening-stock-${batch.number}.xlsx`);
    } catch {
      onError('errorGeneric');
    }
  }

  function printPdf() {
    document.body.classList.add('os-printing');
    window.print();
  }

  async function undo() {
    if (!batch) return;
    setBusy(true);
    try {
      const r = await apiPostRaw<{ ok: boolean; error?: string; message?: { error?: string } }>(`/opening-stock/batches/${encodeURIComponent(batch.id)}/undo`, {});
      setConfirmUndo(false);
      if (!r.ok || !r.json?.ok) {
        onError(r.json?.error ?? r.json?.message?.error ?? 'errorGeneric');
        return;
      }
      await onUndone(batch.number);
    } finally {
      setBusy(false);
    }
  }

  const b = batch && batch.id === selectedId ? batch : null;
  const isLatestLive = b && !b.undone_at && b.undo_block !== 'not_last';
  const block = b ? blockKey(b.undo_block) : null;
  return (
    <>
      <div className="os-batches os-no-print" role="tablist">
        {batches.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={x.id === selectedId}
            className={`chip${x.id === selectedId ? ' is-active' : ''}${x.undone_at ? ' os-batch--undone' : ''}`}
            onClick={() => onSelect(x.id)}
          >
            #{x.number} · <span className="ltr-isolate">{formatRsShort(x.total_value_paisa)}</span>
            {x.undone_at ? ` · ${t('osUndone')}` : ''}
          </button>
        ))}
      </div>
      {b ? (
        <section className="purchases-card pl-card os-print" data-os-summary>
          <div className="os-sum-head">
            <div>
              <h3 className="os-sum-title">
                {t('osBatchTitle').replace('{n}', String(b.number))}
                {b.undone_at ? <span className="chip chip--neutral os-sum-chip">{t('osUndone')}</span> : null}
              </h3>
              <p className="muted os-sum-meta ltr-isolate">
                {fmtPkt(b.posted_at)}
                {b.posted_by_name ? ` · ${t('osBy').replace('{name}', b.posted_by_name)}` : ''} · {t('osItems').replace('{n}', fmtNum(b.item_count))} ·{' '}
                <strong className="dd-money">{formatRsShort(b.total_value_paisa)}</strong>
              </p>
            </div>
            <div className="pl-tools os-no-print">
              <button type="button" className="btn btn--ghost" onClick={() => void exportXlsx()}>
                {t('osExcel')}
              </button>
              <button type="button" className="btn btn--ghost" onClick={printPdf}>
                {t('osPdf')}
              </button>
              {isLatestLive ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--danger"
                  disabled={!b.can_undo || busy}
                  title={block ? t(block) : undefined}
                  onClick={() => setConfirmUndo(true)}
                >
                  {t('osUndo')}
                </button>
              ) : null}
              <button type="button" className="btn btn--teal" onClick={onAddMore}>
                {draftCount ? t('osContinue').replace('{n}', String(draftCount)) : t('osAddMore')}
              </button>
            </div>
          </div>
          {isLatestLive && !b.can_undo && block ? <p className="muted os-sum-block os-no-print">{t(block)}</p> : null}
          <table className="catalog-table pl-table os-sum-table">
            <thead>
              <tr>
                <th scope="col" className="pl-c-name">{t('osColProduct')}</th>
                <th scope="col" className="catalog-table__num">{t('osColEnteredAs')}</th>
                <th scope="col" className="catalog-table__num">{t('osColQty')}</th>
                <th scope="col" className="catalog-table__num">{t('osColCost')}</th>
                <th scope="col" className="catalog-table__num">{t('osColValue')}</th>
                <th scope="col" className="catalog-table__num">{t('osColBefore')}</th>
                <th scope="col" className="catalog-table__num">{t('osAfter')}</th>
              </tr>
            </thead>
            <tbody>
              {b.lines.map((l) => {
                const frac = l.unit_label === 'kg';
                return (
                  <tr key={l.product_id}>
                    <td className="pl-c-name" dir="auto">
                      <span className="pl-name">{l.name}</span>
                      {l.added ? <span className="chip chip--info os-sum-chip">{t('osAdded')}</span> : null}
                      {l.barcode ? <span className="pl-sub muted ltr-isolate">{l.barcode}</span> : null}
                    </td>
                    <td className="catalog-table__num ltr-isolate muted">
                      {l.mode === 'pack' && l.packs != null && l.pack_units != null ? `${fmtNum(l.packs)} ${l.pack_name ?? ''} × ${fmtNum(l.pack_units)}` : '—'}
                    </td>
                    <td className="catalog-table__num ltr-isolate">{fmtQty(l.qty, l.unit_label, frac)}</td>
                    <td className="catalog-table__num ltr-isolate">{l.cost_paisa != null ? formatRsShort(l.cost_paisa) : '—'}</td>
                    <td className="catalog-table__num ltr-isolate dd-money">{formatRsShort(l.value_paisa)}</td>
                    <td className="catalog-table__num ltr-isolate muted">{fmtQty(l.qty_before, l.unit_label, frac)}</td>
                    <td className="catalog-table__num ltr-isolate">{fmtQty(l.qty_after, l.unit_label, frac)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="pl-c-name">{t('osTotal')}</th>
                <td />
                <td />
                <td />
                <td className="catalog-table__num ltr-isolate dd-money"><strong>{formatRsShort(b.total_value_paisa)}</strong></td>
                <td />
                <td />
              </tr>
            </tfoot>
          </table>
        </section>
      ) : null}
      {confirmUndo && b ? (
        <ConfirmModal
          title={t('osUndoTitle').replace('{n}', String(b.number))}
          message={t('osUndoMsg')}
          confirmLabel={t('osUndo')}
          cancelLabel={t('osCancel')}
          busy={busy}
          onConfirm={() => void undo()}
          onCancel={() => setConfirmUndo(false)}
        />
      ) : null}
    </>
  );
}
