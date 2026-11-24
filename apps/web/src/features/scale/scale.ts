/**
 * Weighing scale over the Web Serial API (built into Electron / Chrome; no native module).
 * Settings are per device (localStorage). Manual weight entry always stays available.
 */
export type ScaleSettings = {
  enabled: boolean;
  baud: number;
  /** Sent before reading, for scales that only answer on request (e.g. "W" or "P"). Empty = listen only. */
  poll: string;
  /** Desktop: COM port name to pick (e.g. COM3). Empty = first port. */
  portName: string;
};

const KEY = 'dd-scale';
export const DEFAULT_SCALE: ScaleSettings = { enabled: false, baud: 9600, poll: '', portName: '' };

export function getScaleSettings(): ScaleSettings {
  try {
    return { ...DEFAULT_SCALE, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ScaleSettings>) };
  } catch {
    return DEFAULT_SCALE;
  }
}

export function saveScaleSettings(s: ScaleSettings) {
  localStorage.setItem(KEY, JSON.stringify(s));
  bridge()?.setScalePort?.(s.portName || null);
}

type SerialPortLike = {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
};
type SerialLike = {
  getPorts(): Promise<SerialPortLike[]>;
  requestPort(o?: object): Promise<SerialPortLike>;
};

function bridge(): { setScalePort?: (p: string | null) => Promise<unknown> } | undefined {
  return (window as unknown as { dukaandesk?: { setScalePort?: (p: string | null) => Promise<unknown> } }).dukaandesk;
}

export function scaleSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

/** Last stable weight in a scale line ("ST,GS,+  1.235kg", "1235 g", "  0.500"). kg, or null. */
export function parseWeight(text: string): number | null {
  const lines = text.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const l = lines[i];
    if (/\bUS\b/i.test(l)) continue; // unstable reading
    const m = l.match(/([-+]?\s*\d+(?:[.,]\d+)?)\s*(kg|g|lb)?\s*$/i) ?? l.match(/([-+]?\s*\d+(?:[.,]\d+)?)\s*(kg|g|lb)/i);
    if (!m) continue;
    let n = Number(m[1].replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(n)) continue;
    const u = (m[2] ?? 'kg').toLowerCase();
    if (u === 'g') n /= 1000;
    if (u === 'lb') n *= 0.45359237;
    if (n <= 0) continue;
    return Math.round(n * 1000) / 1000;
  }
  return null;
}

/** Read one weight (kg). Throws 'scale_unsupported' / 'scale_no_port' / 'scale_no_reading'. */
export async function readScale(s: ScaleSettings = getScaleSettings(), timeoutMs = 2500): Promise<number> {
  if (!scaleSupported()) throw new Error('scale_unsupported');
  const serial = (navigator as unknown as { serial: SerialLike }).serial;
  await bridge()?.setScalePort?.(s.portName || null);
  let port = (await serial.getPorts())[0];
  if (!port) {
    try {
      port = await serial.requestPort();
    } catch {
      throw new Error('scale_no_port');
    }
  }
  await port.open({ baudRate: s.baud || 9600 });
  let text = '';
  const reader = port.readable?.getReader();
  try {
    if (s.poll && port.writable) {
      const w = port.writable.getWriter();
      await w.write(new TextEncoder().encode(s.poll.replace(/\\r/g, '\r').replace(/\\n/g, '\n')));
      w.releaseLock();
    }
    const dec = new TextDecoder();
    const until = Date.now() + timeoutMs;
    while (reader && Date.now() < until) {
      const left = until - Date.now();
      const r = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value?: undefined }>((res) => setTimeout(() => res({ done: true }), left)),
      ]);
      if (r.done) break;
      if (r.value) text += dec.decode(r.value, { stream: true });
      // Two full lines in: good enough to pick a stable one.
      if ((text.match(/[\r\n]/g) ?? []).length >= 2 && parseWeight(text) != null) break;
    }
  } finally {
    try {
      await reader?.cancel();
      reader?.releaseLock();
    } catch {
      /* already closed */
    }
    await port.close().catch(() => undefined);
  }
  const kg = parseWeight(text);
  if (kg == null) throw new Error('scale_no_reading');
  return kg;
}
