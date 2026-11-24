import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { InitialBadge } from './InitialBadge';
import { removeImageBackground } from './removeBackground';

export function productImageUrl(file: string): string {
  return `/catalog/images/${encodeURIComponent(file)}`;
}

const PREVIEW = 240;
const GAP = 12;

function HoverPreview({ src, anchor }: { src: string; anchor: DOMRect }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = anchor.right + GAP;
  if (left + PREVIEW > vw - 8) left = anchor.left - GAP - PREVIEW;
  left = Math.max(8, Math.min(left, vw - PREVIEW - 8));
  let top = anchor.top + anchor.height / 2 - PREVIEW / 2;
  top = Math.max(8, Math.min(top, vh - PREVIEW - 8));
  return createPortal(
    <div className="product-thumb-preview" style={{ left, top, width: PREVIEW, height: PREVIEW }} aria-hidden="true">
      <img src={src} alt="" draggable={false} />
    </div>,
    document.body,
  );
}

/** Product picture, or the letter badge when there is none (or it fails to load). */
export function ProductThumb({
  name,
  imageFile,
  className,
  preview = true,
}: {
  name: string;
  imageFile?: string | null;
  className?: string;
  /** Show an enlarged picture on hover. */
  preview?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => setFailed(false), [imageFile]);
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    setAnchor(null);
  }, []);
  useEffect(() => {
    if (!anchor) return;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('keydown', hide, true);
    window.addEventListener('mousedown', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('keydown', hide, true);
      window.removeEventListener('mousedown', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [anchor, hide]);
  useEffect(() => hide, [hide, imageFile]);
  if (!imageFile || failed) return <InitialBadge name={name} className={className} />;
  const src = productImageUrl(imageFile);
  return (
    <>
      <img
        className={`product-thumb${className ? ` ${className}` : ''}`}
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
        onMouseEnter={
          preview
            ? (e) => {
                const el = e.currentTarget;
                window.clearTimeout(timer.current);
                timer.current = window.setTimeout(() => setAnchor(el.getBoundingClientRect()), 250);
              }
            : undefined
        }
        onMouseLeave={preview ? hide : undefined}
      />
      {anchor ? <HoverPreview src={src} anchor={anchor} /> : null}
    </>
  );
}

function loadImage(blob: Blob): Promise<{ img: HTMLImageElement; url: string }> {
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve({ img: el, url });
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('invalid_image'));
    };
    el.src = url;
  });
}

/** Bounding box of non-transparent pixels, or null when fully transparent. */
function opaqueBounds(img: HTMLImageElement) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function render(
  img: HTMLImageElement,
  src: { x: number; y: number; w: number; h: number },
  size: number,
  pad: number,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('invalid_image');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const box = size - pad * 2;
  const scale = Math.min(box / src.w, box / src.h);
  const w = Math.round(src.w * scale);
  const h = Math.round(src.h * scale);
  ctx.drawImage(img, src.x, src.y, src.w, src.h, Math.round((size - w) / 2), Math.round((size - h) / 2), w, h);
  return canvas.toDataURL('image/jpeg', 0.9);
}

/** Plain resize to a 256x256 white-padded JPEG data URL (no background removal). */
export async function resizeOnly(file: Blob, size = 256): Promise<string> {
  const { img, url } = await loadImage(file);
  try {
    const sw = img.naturalWidth;
    const sh = img.naturalHeight;
    const fit = Math.min(size / sw, size / sh, 1);
    const pad = Math.max(0, (size - Math.max(sw, sh) * fit) / 2);
    return render(img, { x: 0, y: 0, w: sw, h: sh }, size, Math.floor(pad));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Remove background (offline), crop to the product, centre on white 256x256 JPEG. Falls back to plain resize. */
export async function resizeImageFile(file: File, size = 256): Promise<string> {
  await loadImage(file).then(({ url }) => URL.revokeObjectURL(url));
  const cut = await removeImageBackground(file);
  if (cut) {
    try {
      const { img, url } = await loadImage(cut);
      try {
        const b = opaqueBounds(img);
        const area = b ? (b.w * b.h) / (img.naturalWidth * img.naturalHeight) : 0;
        if (b && area > 0.02) return render(img, b, size, Math.round(size * 0.06));
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch {
      /* fall through */
    }
  }
  return resizeOnly(file, size);
}
