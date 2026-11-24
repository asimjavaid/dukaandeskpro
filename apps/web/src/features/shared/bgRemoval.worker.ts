/// <reference lib="webworker" />
/** Offline background matte: IS-Net (DIS, Apache-2.0) uint8 ONNX on onnxruntime-web (MIT) wasm. */
/// <reference path="../../../node_modules/onnxruntime-web/types.d.ts" />
import * as ort from 'onnxruntime-web/wasm';
type InferenceSession = ort.InferenceSession;

const S = 1024;
let session: Promise<InferenceSession> | null = null;

function getSession(base: string) {
  if (!session) {
    ort.env.wasm.wasmPaths = base;
    ort.env.wasm.numThreads = 1;
    const p = ort.InferenceSession.create(`${base}isnet-q8.onnx`, { executionProviders: ['wasm'] });
    p.catch(() => (session = null));
    session = p;
    return p;
  }
  return session;
}

self.onmessage = async (e: MessageEvent<{ id: number; base: string; bitmap: ImageBitmap }>) => {
  const { id, base, bitmap } = e.data;
  try {
    const sess = await getSession(base);
    const c = new OffscreenCanvas(S, S);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, S, S);
    const px = ctx.getImageData(0, 0, S, S).data;
    const input = new Float32Array(3 * S * S);
    for (let i = 0; i < S * S; i++) {
      input[i] = px[i * 4] / 255 - 0.5;
      input[S * S + i] = px[i * 4 + 1] / 255 - 0.5;
      input[2 * S * S + i] = px[i * 4 + 2] / 255 - 0.5;
    }
    const out = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, S, S]) });
    const m = out[sess.outputNames[0]].data as Float32Array;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < m.length; i++) { if (m[i] < lo) lo = m[i]; if (m[i] > hi) hi = m[i]; }
    const range = hi - lo || 1;
    const mask = new Uint8ClampedArray(S * S);
    for (let i = 0; i < m.length; i++) mask[i] = ((m[i] - lo) / range) * 255;
    (self as unknown as Worker).postMessage({ id, mask, w: bitmap.width, h: bitmap.height }, [mask.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  } finally {
    bitmap.close();
  }
};
