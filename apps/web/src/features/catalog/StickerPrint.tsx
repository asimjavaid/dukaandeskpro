import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../i18n';
import { encodeBarcode } from './barcodeArt';

export const STICKER_SIZES = [
  { id: '38x25', w: 38, h: 25 },
  { id: '50x25', w: 50, h: 25 },
  { id: '50x30', w: 50, h: 30 },
  { id: '40x30', w: 40, h: 30 },
] as const;

const MAX_QTY = 200;
const ROW_GAP_MM = 2;
const A4_CONTENT_MM = 200;

type SizeId = (typeof STICKER_SIZES)[number]['id'];

type ProductSticker = {
  name: string;
  priceLabel: string;
  barcode: string;
};

function clampQty(raw: string): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_QTY, Math.max(1, n));
}

export function BarcodeSvg({ bits }: { bits: string }) {
  const bars: { x: number; w: number }[] = [];
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === '1') {
      let w = 1;
      while (bits[i + w] === '1') w += 1;
      bars.push({ x: i, w });
      i += w;
    } else {
      i += 1;
    }
  }
  return (
    <svg
      className="sticker__svg"
      viewBox={`0 0 ${bits.length} 100`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <rect width={bits.length} height="100" fill="#fff" />
      {bars.map((bar) => (
        <rect key={bar.x} x={bar.x} y="0" width={bar.w} height="100" fill="#000" />
      ))}
    </svg>
  );
}

function StickerSheet({
  name,
  priceLabel,
  bits,
  text,
  widthMm,
  heightMm,
  perRow,
  qty,
}: {
  name: string;
  priceLabel: string;
  bits: string;
  text: string;
  widthMm: number;
  heightMm: number;
  perRow: number;
  qty: number;
}) {
  const showPrice = heightMm >= 30 || widthMm >= 50;
  return (
    <div
      className="sticker-sheet"
      style={{ gridTemplateColumns: `repeat(${perRow}, ${widthMm}mm)` }}
    >
      {Array.from({ length: qty }, (_, i) => (
        <article
          key={i}
          className="sticker"
          style={{ width: `${widthMm}mm`, height: `${heightMm}mm` }}
        >
          <div className="sticker__name">{name}</div>
          <div className="sticker__bars">
            <BarcodeSvg bits={bits} />
          </div>
          <div className="sticker__code ltr-isolate">{text}</div>
          {showPrice ? (
            <div className="sticker__price ltr-isolate">{priceLabel}</div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export function StickerPrint({
  product,
  onClose,
  initialSize = '50x25',
  initialPerRow = 3,
}: {
  product: ProductSticker;
  onClose: () => void;
  initialSize?: SizeId;
  initialPerRow?: number;
}) {
  const { t } = useI18n();
  const [sizeId, setSizeId] = useState<SizeId>(initialSize);
  const [qtyText, setQtyText] = useState('1');
  const [perRow, setPerRow] = useState(
    initialPerRow >= 1 && initialPerRow <= 5 ? initialPerRow : 3,
  );
  const size = STICKER_SIZES.find((s) => s.id === sizeId) ?? STICKER_SIZES[1];
  const qty = clampQty(qtyText);
  const art = useMemo(() => encodeBarcode(product.barcode), [product.barcode]);
  const rowMm = size.w * perRow + ROW_GAP_MM * Math.max(0, perRow - 1);
  const wide = rowMm > A4_CONTENT_MM;

  useEffect(() => {
    document.body.classList.add('sticker-print');
    return () => document.body.classList.remove('sticker-print');
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sheet = art ? (
    <StickerSheet
      name={product.name}
      priceLabel={product.priceLabel}
      bits={art.bits}
      text={art.text}
      widthMm={size.w}
      heightMm={size.h}
      perRow={perRow}
      qty={qty}
    />
  ) : null;

  return (
    <div className="pos-modal-backdrop" onClick={onClose}>
      <div
        className="pos-modal sticker-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sticker-print-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="sticker-print-title">{t('stickerTitle')}</h3>
        <p className="muted catalog-help">{product.name}</p>
        {!product.barcode ? (
          <p className="catalog-alert" role="alert">
            {t('stickerNoBarcode')}
          </p>
        ) : !art ? (
          <p className="catalog-alert" role="alert">
            {t('stickerUnsupported')}
          </p>
        ) : (
          <>
            <div className="sticker-controls">
              <div className="field">
                <label htmlFor="sticker-size">{t('stickerSize')}</label>
                <select
                  id="sticker-size"
                  value={sizeId}
                  onChange={(e) => setSizeId(e.target.value as SizeId)}
                >
                  {STICKER_SIZES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {t(
                        s.id === '38x25'
                          ? 'stickerSize38x25'
                          : s.id === '50x25'
                            ? 'stickerSize50x25'
                            : s.id === '50x30'
                              ? 'stickerSize50x30'
                              : 'stickerSize40x30',
                      )}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="sticker-qty">{t('stickerQty')}</label>
                <input
                  id="sticker-qty"
                  className="ltr-isolate"
                  inputMode="numeric"
                  min={1}
                  max={MAX_QTY}
                  value={qtyText}
                  onChange={(e) => setQtyText(e.target.value.replace(/[^\d]/g, ''))}
                  onBlur={() => setQtyText(String(clampQty(qtyText)))}
                />
              </div>
              <div className="field">
                <label htmlFor="sticker-row">{t('stickerPerRow')}</label>
                <select
                  id="sticker-row"
                  value={perRow}
                  onChange={(e) => setPerRow(Number(e.target.value))}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {wide ? <p className="muted catalog-help">{t('stickerWide')}</p> : null}
            <p className="muted catalog-help">{t('stickerPreview')}</p>
            <div className="sticker-preview">{sheet}</div>
          </>
        )}
        <div className="pos-modal__actions">
          <button
            type="button"
            className="btn btn--teal"
            disabled={!art}
            onClick={() => window.print()}
          >
            {t('stickerPrintAction')}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {t('cancel')}
          </button>
        </div>
      </div>
      {sheet
        ? createPortal(
            <div className="sticker-print-portal">{sheet}</div>,
            document.body,
          )
        : null}
    </div>
  );
}
