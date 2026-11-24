/**
 * DukaanDesk Pro — till-only PC.
 * Serves the bundled web UI on this PC and forwards every API call to the main PC
 * (typed IP or found by UDP discovery). No database and no API run here.
 * Plain Node (no Electron) so tests can run it as a simulated till.
 *
 *   /__till/status    GET   { tillMode, server, reachable }
 *   /__till/discover  POST  { found: [{ host, port, name, mode }] }
 *   /__till/server    POST  { server: "192.168.1.10:3847" } -> checks /health, saves
 *   /__till/forget    POST  clears the saved main PC
 */
const http = require('node:http');
const dgram = require('node:dgram');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TillOffline } = require('./till-offline');

const DISCOVERY_ASK = 'DDPRO_DISCOVER 1';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.webp': 'image/webp',
};

function readCfg(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { return {}; }
}
function writeCfg(file, cfg) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
}

/** "192.168.1.10", "192.168.1.10:3847" or "http://…" -> { host, port } | null */
function parseServer(s, defPort = 3847) {
  const t = String(s ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const m = /^([a-zA-Z0-9.-]+|\[[0-9a-fA-F:]+\])(?::(\d{1,5}))?$/.exec(t);
  if (!m) return null;
  const port = m[2] ? Number(m[2]) : defPort;
  if (!(port > 0 && port < 65536)) return null;
  return { host: m[1].replace(/^\[|\]$/g, ''), port };
}

function getJson(host, port, p, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: p, timeout: timeoutMs }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(raw) }); } catch { resolve({ status: res.statusCode, json: null }); }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

function broadcastTargets(extra) {
  const out = new Set(['255.255.255.255']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal || !a.netmask) continue;
      const ip = a.address.split('.').map(Number);
      const mask = a.netmask.split('.').map(Number);
      out.add(ip.map((b, i) => (b & mask[i]) | (~mask[i] & 255)).join('.'));
    }
  }
  for (const t of extra) out.add(t);
  return [...out];
}

/** Ask the LAN where the main PC is. Resolves with every answer within `waitMs`. */
function discover({ port = 3849, waitMs = 1500, extraTargets = [] } = {}) {
  return new Promise((resolve) => {
    const found = new Map();
    const sock = dgram.createSocket('udp4');
    sock.on('message', (msg, rinfo) => {
      try {
        const j = JSON.parse(msg.toString('utf8'));
        if (j.product !== 'dukaandeskpro') return;
        found.set(`${rinfo.address}:${j.port}`, { host: rinfo.address, port: j.port, name: j.name, mode: j.mode });
      } catch { /* not ours */ }
    });
    sock.on('error', () => { try { sock.close(); } catch { /* */ } resolve([...found.values()]); });
    sock.bind(0, () => {
      try { sock.setBroadcast(true); } catch { /* */ }
      const ask = Buffer.from(DISCOVERY_ASK);
      for (const t of broadcastTargets(extraTargets)) sock.send(ask, port, t, () => undefined);
    });
    setTimeout(() => { try { sock.close(); } catch { /* */ } resolve([...found.values()]); }, waitMs);
  });
}

function readBody(req, max = 64 * 1024) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > max) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/**
 * @param {{ webDir: string, port: number, configFile: string, host?: string, csp?: string,
 *           discoveryPort?: number, discoveryTargets?: string[] }} o
 */
/** Calls the main PC; resolves { status, json } or null when it cannot be reached. */
function serverRequest(s, method, p, { till, body, timeoutMs = 4000, headers = {} } = {}) {
  return new Promise((resolve) => {
    if (!s) return resolve(null);
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const h = { ...headers };
    if (payload) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(payload); }
    if (till) h['x-dd-till'] = till;
    const q = http.request({ host: s.host, port: s.port, path: p, method, headers: h, timeout: timeoutMs }, (r) => {
      let raw = '';
      r.on('data', (c) => (raw += c));
      r.on('end', () => {
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch { /* */ }
        resolve({ status: r.statusCode, json });
      });
    });
    q.on('timeout', () => q.destroy(new Error('timeout')));
    q.on('error', () => resolve(null));
    if (payload) q.write(payload);
    q.end();
  });
}

function readRaw(req, max = 100 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => { n += c.length; if (n > max) { req.destroy(); reject(new Error('too_big')); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Answers the till-link keeps (sign-in lists, licence, who-am-I, sign-ins, pairing). */
const REMEMBER = [
  ['GET', /^\/auth\/(status|users|me)$/],
  ['GET', /^\/license\/status$/],
  ['GET', /^\/tills\/me$/],
  ['POST', /^\/auth\/login$/],
  ['POST', /^\/tills\/pair$/],
];

/**
 * @param {{ webDir: string, port: number, configFile: string, host?: string, csp?: string,
 *           discoveryPort?: number, discoveryTargets?: string[], pingMs?: number }} o
 */
function startTillLink(o) {
  const root = path.resolve(o.webDir);
  const discoveryPort = o.discoveryPort ?? Number(process.env.DD_DISCOVERY_PORT ?? 3849);
  const extraTargets = o.discoveryTargets ?? (process.env.DD_DISCOVERY_TARGETS || '').split(',').filter(Boolean);
  const cfgNow = () => readCfg(o.configFile);
  const serverNow = () => parseServer(cfgNow().server);
  const saveKey = (key) => {
    const cfg = cfgNow();
    if (key && cfg.deviceKey !== key) {
      writeCfg(o.configFile, { ...cfg, deviceKey: key });
      // New key (just paired): take the offline copy now.
      setImmediate(() => void offline.refreshPack().catch(() => undefined));
    }
  };
  const offline = new TillOffline({
    dir: path.join(path.dirname(o.configFile), 'offline'),
    server: serverNow,
    request: (m, p, opts) => serverRequest(serverNow(), m, p, opts),
    deviceKey: () => cfgNow().deviceKey || null,
    log: (m) => console.error('[till]', m),
  });
  offline.start();
  const ping = async () => {
    const s = serverNow();
    const h = s ? await serverRequest(s, 'GET', '/health', { timeoutMs: 2000 }) : null;
    offline.setOnline(Boolean(h && h.status === 200));
  };
  void ping();
  const pingTimer = setInterval(() => void ping(), o.pingMs ?? 3000);

  const answerLocal = async (req, res, raw) => {
    let body = {};
    try { body = raw.length ? JSON.parse(raw.toString('utf8')) : {}; } catch { body = {}; }
    const r = await offline.handle(req.method, req.url ?? '/', req.headers, body);
    send(res, r.status, r.json);
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://till.local');
    const p = url.pathname;
    const cfg = cfgNow();

    if (p === '/__till/status' && req.method === 'GET') {
      const s = parseServer(cfg.server);
      const h = s ? await getJson(s.host, s.port, '/health', 1500) : null;
      return send(res, 200, { tillMode: true, server: cfg.server ?? null, reachable: Boolean(h && h.status === 200), offline: offline.state() });
    }
    if (p === '/__till/offline/state' && req.method === 'GET') {
      return send(res, 200, { tillMode: true, server: cfg.server ?? null, ...offline.state() });
    }
    if (p === '/__till/offline/sync' && req.method === 'POST') {
      if (offline.online) await offline.refreshPack().catch(() => undefined);
      await offline.syncNow().catch(() => undefined);
      return send(res, 200, offline.state());
    }
    if (p === '/__till/discover' && req.method === 'POST') {
      return send(res, 200, { found: await discover({ port: discoveryPort, extraTargets }) });
    }
    if (p === '/__till/server' && req.method === 'POST') {
      const body = await readBody(req);
      const s = parseServer(body.server);
      if (!s) return send(res, 400, { ok: false, error: 'bad_address' });
      const h = await getJson(s.host, s.port, '/health');
      if (!h || h.status !== 200) return send(res, 502, { ok: false, error: 'server_unreachable' });
      if (!h.json || h.json.product !== 'DukaanDesk Pro') return send(res, 400, { ok: false, error: 'not_dukaandesk' });
      const server = `${s.host}:${s.port}`;
      writeCfg(o.configFile, { ...cfg, server });
      void ping();
      return send(res, 200, { ok: true, server });
    }
    if (p === '/__till/forget' && req.method === 'POST') {
      writeCfg(o.configFile, { ...cfg, server: null });
      return send(res, 200, { ok: true });
    }

    // bundled UI
    const rel = decodeURIComponent(p).replace(/^\/+/, '');
    const file = path.resolve(root, rel || 'index.html');
    const inside = file === root || file.startsWith(root + path.sep);
    if (req.method === 'GET' && inside && fs.existsSync(file) && fs.statSync(file).isFile()) {
      const ext = path.extname(file);
      res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
      if (ext === '.html' && o.csp) res.setHeader('Content-Security-Policy', o.csp);
      fs.createReadStream(file).pipe(res);
      return;
    }

    // everything else -> main PC (or the offline copy while it is down)
    const s = parseServer(cfg.server);
    if (!s) return send(res, 503, { ok: false, error: 'no_server' });
    let raw;
    try { raw = await readRaw(req); } catch { return send(res, 413, { ok: false, error: 'too_big' }); }
    const tillHdr = req.headers['x-dd-till'];
    if (typeof tillHdr === 'string' && tillHdr) saveKey(tillHdr);
    const ready = offline.state().ready;
    if (!offline.online && ready) return answerLocal(req, res, raw);

    const headers = { ...req.headers, host: `${s.host}:${s.port}` };
    delete headers.origin;
    delete headers.referer;
    // A sign-in made offline becomes a real one once the main PC answers.
    const tok = headers['x-dd-session'];
    if (typeof tok === 'string' && tok.startsWith('off_')) {
      const real = await offline.upgradeToken(tok);
      if (real) {
        headers['x-dd-session'] = real;
        headers.authorization = `Bearer ${real}`;
        delete headers.cookie;
      }
    }
    headers['content-length'] = String(raw.length);
    delete headers['transfer-encoding'];
    const keep = REMEMBER.some(([m, re]) => m === req.method && re.test(p));
    let answered = false;
    const fwd = http.request({ host: s.host, port: s.port, path: req.url, method: req.method, headers, timeout: 15000 }, (r) => {
      answered = true;
      if (!keep) {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
        return;
      }
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        const buf = Buffer.concat(chunks);
        try {
          const json = JSON.parse(buf.toString('utf8'));
          offline.remember(req.method, p, headers, r.statusCode, json);
          if (p === '/tills/pair' && json?.ok && json.deviceKey) saveKey(json.deviceKey);
        } catch { /* not JSON */ }
        res.writeHead(r.statusCode ?? 502, r.headers);
        res.end(buf);
      });
    });
    fwd.on('timeout', () => fwd.destroy(new Error('timeout')));
    fwd.on('error', () => {
      if (res.headersSent) return res.end();
      offline.setOnline(false);
      // Nothing reached the main PC, or a sale's answer was lost: the offline copy takes it
      // (a sale keeps its client UUID, so if it did reach the main PC the sync drops the copy).
      const safe = !answered && (req.method === 'GET' || req.method === 'HEAD' || p === '/sales' || p === '/auth/login');
      if (safe && offline.state().ready) return void answerLocal(req, res, raw);
      send(res, 502, { ok: false, error: 'server_unreachable' });
    });
    fwd.end(raw);
  });
  server.on('close', () => { clearInterval(pingTimer); offline.stop(); });
  server.tillOffline = offline;

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.port, o.host ?? '127.0.0.1', () => resolve(server));
  });
}

module.exports = { startTillLink, discover, parseServer, DISCOVERY_ASK };

// `node till-link.js` = simulated till (tests / dev): DD_TILL_WEB, DD_TILL_PORT, DD_TILL_CONFIG.
if (require.main === module) {
  const webDir = process.env.DD_TILL_WEB ?? path.join(__dirname, '..', '..', 'web', 'dist');
  const port = Number(process.env.DD_TILL_PORT ?? 4174);
  const configFile = process.env.DD_TILL_CONFIG ?? path.join(os.tmpdir(), 'dd-till', 'till.json');
  startTillLink({ webDir, port, configFile }).then(() => console.log(`[till] UI on 127.0.0.1:${port}`));
}
