import { useEffect, useMemo, useState } from 'react';
import { translateError, useI18n } from '../../i18n';
import { apiGet, apiPostRaw } from '../../lib/api';
import { formatRsShort as formatRs } from '../../lib/money';
import { formatQty } from '../shared/productUnits';

type P = { id: string; name: string; unit_label: string; qty_on_hand: number; last_unit_cost_paisa?: number | null };
type L = { productId: string; name: string; qty: string; cost: string; onHand: number };

/** Owner: send goods back to a supplier (stock down, owed down). */
export function SupplierReturnModal({ supplierId, supplierName, onClose, onSaved }: { supplierId: string; supplierName: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const [products, setProducts] = useState<P[]>([]);
  const [q, setQ] = useState('');
  const [lines, setLines] = useState<L[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  useEffect(() => {
    apiGet<{ items?: P[] }>('/catalog/products')
      .then((r) => setProducts(r.items ?? []))
      .catch(() => undefined);
  }, []);

  const hits = q.trim() ? products.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : [];
  const total = useMemo(
    () => lines.reduce((s, l) => s + Math.round((Number(l.qty) || 0) * (Number(l.cost) || 0) * 100), 0),
    [lines],
  );

  async function save() {
    setBusy(true);
    setErr(null);
    const res = await apiPostRaw<{ ok: boolean; error?: string }>(`/suppliers/${encodeURIComponent(supplierId)}/returns`, {
      lines: lines.map((l) => ({ productId: l.productId, qty: l.qty, unitCostRs: l.cost })),
      note,
    }).catch(() => null);
    setBusy(false);
    if (!res?.json?.ok) {
      setErr(res?.json?.error ?? 'save_failed');
      return;
    }
    onSaved();
  }

  return (
    <div className="pos-modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="pos-modal" style={{ maxWidth: 680, width: '92vw' }} role="dialog" aria-modal="true" data-supplier-return onClick={(e) => e.stopPropagation()}>
        <h3>{t('supplierSendBack')} · {supplierName}</h3>
        <div className="field">
          <input className="input" placeholder={t('searchCatalog')} value={q} autoFocus onChange={(e) => setQ(e.target.value)} />
          {hits.length ? (
            <ul className="b2-picks">
              {hits.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => {
                      setLines((prev) =>
                        prev.some((l) => l.productId === p.id)
                          ? prev
                          : [...prev, { productId: p.id, name: p.name, qty: '1', cost: p.last_unit_cost_paisa != null ? String(p.last_unit_cost_paisa / 100) : '', onHand: p.qty_on_hand }],
                      );
                      setQ('');
                    }}
                  >
                    {p.name} <span className="muted ltr-isolate">({formatQty(p.qty_on_hand)})</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {lines.length ? (
          <table className="catalog-table parties-table">
            <thead>
              <tr>
                <th className="catalog-table__col-product">{t('colItem')}</th>
                <th className="catalog-table__num">{t('qty')}</th>
                <th className="catalog-table__num">{t('purchaseUnitCost')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.productId}>
                  <td className="catalog-table__col-product">
                    {l.name} <span className="muted ltr-isolate">/ {formatQty(l.onHand)}</span>
                  </td>
                  <td className="catalog-table__num">
                    <input className="input ltr-isolate" style={{ width: 80 }} inputMode="decimal" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value.replace(/[^\d.]/g, '') } : x)))} />
                  </td>
                  <td className="catalog-table__num">
                    <input className="input ltr-isolate" style={{ width: 96 }} inputMode="decimal" value={l.cost} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, cost: e.target.value.replace(/[^\d.]/g, '') } : x)))} />
                  </td>
                  <td>
                    <button type="button" className="btn btn--ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                      {t('removeLine')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <div className="field">
          <label htmlFor="sr-note">{t('note')}</label>
          <input id="sr-note" className="input" maxLength={240} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <p>
          {t('cartTotal')}: <strong className="ltr-isolate">{formatRs(total)}</strong>
        </p>
        {err ? <p className="pos-alert" role="alert">{translateError(t, err)}</p> : null}
        <div className="pos-modal__actions">
          <button type="button" className="btn btn--teal" disabled={busy || lines.length === 0 || total <= 0} onClick={() => void save()} data-supplier-return-save>
            {t('supplierSendBack')}
          </button>
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={onClose}>
            {t('cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
