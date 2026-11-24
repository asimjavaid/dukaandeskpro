import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../i18n';
import { apiGet } from '../../lib/api';
import { formatRsShort } from '../../lib/money';
import { encodeBarcode } from '../catalog/barcodeArt';
import { BarcodeSvg, STICKER_SIZES } from '../catalog/StickerPrint';

export type LabelItem = { productId: string; name: string; kg: number; pricePaisa: number; barcode: string | null; count: number };
type SizeId = (typeof STICKER_SIZES)[number]['id'];

/** "250 g", "1 kg", "1.5 kg" */
export function weightText(kg: number): string {
  const g = Math.round(kg * 1000);
  if (g < 1000) return `${g} g`;
  return `${Math.round(kg * 1000) / 1000} kg`;
}

/** One label per packet: name, weight, price, barcode. Opened after a repack and from repack history. */
export function RepackLabels({ title, items, onClose }: { title: string; items: LabelItem[]; onClose: () => void }) {
  const { t } = useI18n();
  const [counts, setCounts] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.productId, String(i.count)])));
  const [sizeId, setSizeId] = useState<SizeId>('50x30');
  const [perRow, setPerRow] = useState(3);

  useEffect(() => {
    apiGet<{ store?: { label_size?: string; label_per_row?: number } }>('/settings/store')
      .then((r) => {
        const sz = r.store?.label_size;
        if (STICKER_SIZES.some((s) => s.id === sz)) setSizeId(sz as SizeId);
        const n = Math.floor(Number(r.store?.label_per_row));
        if (n >= 1 && n <= 5) setPerRow(n);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    document.body.classList.add('sticker-print');
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => {
      document.body.classList.remove('sticker-print');
      window.removeEventListener('keydown', k);
    };
  }, [onClose]);

  const size = STICKER_SIZES.find((s) => s.id === sizeId) ?? STICKER_SIZES[2];
  const rows = useMemo(
    () => items.map((i) => ({ ...i, art: i.barcode ? encodeBarcode(i.barcode) : null, n: Math.min(500, Math.max(0, Math.floor(Number(counts[i.productId]) || 0))) })),
    [items, counts],
  );
  const total = rows.reduce((s, r) => s + (r.art ? r.n : 0), 0);
  const sheet = (
    <div className="sticker-sheet" style={{ gridTemplateColumns: `repeat(${perRow}, ${size.w}mm)` }} data-label-sheet>
      {rows.flatMap((r) =>
        r.art
          ? Array.from({ length: r.n }, (_, k) => (
              <article key={`${r.productId}-${k}`} className="sticker sticker--pack" style={{ width: `${size.w}mm`, height: `${size.h}mm` }}>
                <div className="sticker__name">{r.name}</div>
                <div className="sticker__line">
                  <span className="sticker__weight ltr-isolate">{weightText(r.kg)}</span>
                  <span className="sticker__price ltr-isolate">{formatRsShort(r.pricePaisa)}</span>
                </div>
                <div className="sticker__bars">
                  <BarcodeSvg bits={r.art!.bits} />
                </div>
                <div className="sticker__code ltr-isolate">{r.art!.text}</div>
              </article>
            ))
          : [],
      )}
    </div>
  );

  return (
    <div className="pos-modal-backdrop" onClick={onClose}>
      <div className="pos-modal sticker-modal" role="dialog" aria-modal="true" aria-labelledby="rp-labels-title" data-repack-labels onClick={(e) => e.stopPropagation()}>
        <h3 id="rp-labels-title">{title}</h3>
        <table className="catalog-table po-table rp-labels__table">
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.productId}>
                <td dir="auto">{r.name}</td>
                <td className="ltr-isolate">{weightText(r.kg)}</td>
                <td className="catalog-table__num ltr-isolate">{formatRsShort(r.pricePaisa)}</td>
                <td className="catalog-table__num">
                  {r.art ? (
                    <input
                      id={`rp-lbl-${i}`}
                      className="po-qty ltr-isolate"
                      inputMode="numeric"
                      aria-label={`${r.name} labels`}
                      value={counts[r.productId] ?? ''}
                      onChange={(e) => setCounts((c) => ({ ...c, [r.productId]: e.target.value.replace(/[^\d]/g, '') }))}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                  ) : (
                    <span className="muted">{t('stickerNoBarcode')}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="sticker-controls">
          <div className="field">
            <label htmlFor="rp-lbl-size">{t('stickerSize')}</label>
            <select id="rp-lbl-size" value={sizeId} onChange={(e) => setSizeId(e.target.value as SizeId)}>
              {STICKER_SIZES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.w} × {s.h} mm
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rp-lbl-row">{t('stickerPerRow')}</label>
            <select id="rp-lbl-row" value={perRow} onChange={(e) => setPerRow(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="sticker-preview">{sheet}</div>
        <div className="pos-modal__actions">
          <button type="button" className="btn btn--teal" disabled={total === 0} onClick={() => window.print()} autoFocus data-print-labels>
            {t('stickerPrintAction')} ({total})
          </button>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {t('rpLabelsSkip')}
          </button>
        </div>
      </div>
      {createPortal(<div className="sticker-print-portal">{sheet}</div>, document.body)}
    </div>
  );
}
