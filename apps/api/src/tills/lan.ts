import dgram from 'node:dgram';
import type { NextFunction, Request, Response } from 'express';
import { tillAls } from './till-context';

/** LAN mode: the main PC listens on every network card (DD_LAN=1). Default: this PC only. */
export const lanEnabled = () => process.env.DD_LAN === '1' || process.env.DD_LAN === 'true';
export const listenHost = () => (lanEnabled() ? '0.0.0.0' : '127.0.0.1');
export const DISCOVERY_PORT = Number(process.env.DD_DISCOVERY_PORT ?? 3849);
export const DISCOVERY_ASK = 'DDPRO_DISCOVER 1';

/** Paths a till on the LAN may call before it is paired. */
const OPEN: Array<[string, RegExp]> = [
  ['GET', /^\/health\/?$/],
  ['GET', /^\/tills\/me\/?$/],
  ['POST', /^\/tills\/pair\/?$/],
];

/**
 * Requests from another PC must carry a paired till's device key. Without one only health,
 * "who am I" and pairing answer. Runs after the till middleware (needs the till context).
 */
export function lanGate(req: Request, res: Response, next: NextFunction) {
  const ctx = tillAls.getStore();
  if (!ctx || ctx.local || ctx.till || req.method === 'OPTIONS') return next();
  const path = (req.path || req.url || '/').split('?')[0];
  if (OPEN.some(([m, re]) => m === req.method && re.test(path))) return next();
  res.status(401).json({ ok: false, error: ctx.keyRejected ? 'till_key_rejected' : 'till_not_paired' });
}

/** Answers "where is the main PC?" broadcasts from tills (UDP). Returns a stop function. */
export function startDiscovery(info: () => { name: string; port: number; mode: string }): () => void {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('message', (msg, rinfo) => {
    if (msg.toString('utf8').trim() !== DISCOVERY_ASK) return;
    let body: Record<string, unknown>;
    try {
      body = { product: 'dukaandeskpro', v: 1, ...info() };
    } catch {
      return;
    }
    sock.send(Buffer.from(JSON.stringify(body)), rinfo.port, rinfo.address);
  });
  sock.on('error', (e) => {
    // eslint-disable-next-line no-console
    console.error('[lan] discovery off:', e.message);
    try { sock.close(); } catch { /* */ }
  });
  sock.bind(DISCOVERY_PORT, '0.0.0.0');
  return () => { try { sock.close(); } catch { /* */ } };
}
