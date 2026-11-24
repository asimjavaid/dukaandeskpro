import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { apiGet } from '../../lib/api';
import { formatRsShort as formatRs } from '../../lib/money';
import { fmtDateTime } from '../shared/dates';

type Row = { id: string; old_price_paisa: number; new_price_paisa: number; changed_at: string; changed_by_name: string | null };

export function PriceHistoryModal({ productId, name, onClose }: { productId: string; name: string; onClose: () => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    apiGet<{ items: Row[] }>(`/catalog/products/${encodeURIComponent(productId)}/price-history`)
      .then((r) => setRows(r.items))
      .catch(() => setRows([]));
  }, [productId]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="pos-modal-backdrop" onClick={onClose}>
      <div className="pos-modal" style={{ maxWidth: 560, width: '92vw' }} role="dialog" aria-modal="true" data-price-history onClick={(e) => e.stopPropagation()}>
        <h3>{t('priceHistory')} · {name}</h3>
        {rows && rows.length === 0 ? <p className="muted">{t('priceHistoryEmpty')}</p> : null}
        {rows && rows.length > 0 ? (
          <div className="catalog-table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
            <table className="catalog-table parties-table">
              <thead>
                <tr>
                  <th>{t('tillTime')}</th>
                  <th className="catalog-table__num">{t('priceOld')}</th>
                  <th className="catalog-table__num">{t('priceNew')}</th>
                  <th>{t('activityWho')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="ltr-isolate">
                      {fmtDateTime(new Date(r.changed_at))}
                    </td>
                    <td className="catalog-table__num ltr-isolate">{formatRs(r.old_price_paisa)}</td>
                    <td className={`catalog-table__num ltr-isolate${r.new_price_paisa > r.old_price_paisa ? ' b2-warn' : ''}`}>{formatRs(r.new_price_paisa)}</td>
                    <td>{r.changed_by_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <div className="pos-modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
}
