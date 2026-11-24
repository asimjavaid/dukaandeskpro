/** Offline background removal. Model + wasm are served from /bg-model/ (no internet). */
let worker: Worker | null = null;
let seq = 0;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./bgRemoval.worker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

function matte(bitmap: ImageBitmap): Promise<{ mask: Uint8ClampedArray; size: number }> {
  const w = getWorker();
  const id = ++seq;
  const base = new URL('bg-model/', document.baseURI).href;
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.id !== id) return;
      w.removeEventListener('message', onMsg);
      if (e.data.error) reject(new Error(e.data.error));
      else resolve({ mask: e.data.mask, size: Math.round(Math.sqrt(e.data.mask.length)) });
    };
    w.addEventListener('message', onMsg);
    w.addEventListener('error', () => reject(new Error('worker_error')), { once: true });
    w.postMessage({ id, base, bitmap }, [bitmap]);
  });
}

/** Returns a PNG with transparent background, or null if removal fails. */
export async function removeImageBackground(file: Blob): Promise<Blob | null> {
  try {
    const src = await createImageBitmap(file);
    const W = src.width, H = src.height;
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(src, 0, 0);
    const { mask, size } = await matte(await createImageBitmap(src));
    src.close();
    const mc = new OffscreenCanvas(size, size);
    const mctx = mc.getContext('2d')!;
    const md = mctx.createImageData(size, size);
    for (let i = 0; i < mask.length; i++) md.data[i * 4 + 3] = mask[i];
    mctx.putImageData(md, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(mc, 0, 0, W, H);
    return await canvas.convertToBlob({ type: 'image/png' });
  } catch {
    return null;
  }
}
