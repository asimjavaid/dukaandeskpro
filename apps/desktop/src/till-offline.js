/**
 * DukaanDesk Pro — till PC offline selling (used by till-link.js).
 *
 * While the main PC answers: keeps a copy of what this till needs (items + prices, cashier /
 * manager PIN checks, a block of offline bill numbers, the last sign-in answers).
 * While it does not: answers the few calls the Sell screen makes, takes CASH sales of cached items
 * into a durable queue (written to disk before the till sees "done"), numbered T2-OFF-000045.
 * When it answers again: sends the queue (idempotent by client UUID) and refreshes the copy.
 *
 * Not offline: customers / khata / split / digital / discount / loyalty / refunds / bill edits /
 * stock receiving / every owner screen. A price change needs a manager PIN (checked against the
 * cached PIN hash). The owner does not sign in offline (owner PIN hash never leaves the main PC).
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SYNC_EVERY_MS = 3000;
const PACK_EVERY_MS = 60_000;
const BATCH = 50;
const KEEP_SYNCED = 300;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CACHED_GETS = ['/auth/status', '/auth/users', '/license/status', '/tills/me'];

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** Durable JSON file: write temp, flush to disk, rename over. */
function writeJsonDurable(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(data));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  try {
    const dfd = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
  } catch { /* Windows: directories cannot be opened; rename is enough there */ }
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function verifyPin(pin, stored) {
  if (typeof pin !== 'string' || !/^[0-9]{4,6}$/.test(pin) || typeof stored !== 'string') return false;
  const [kind, salt, hex] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hex) return false;
  try {
    const want = Buffer.from(hex, 'hex');
    const got = crypto.scryptSync(pin, salt, want.length);
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  } catch {
    return false;
  }
}

/** Same rounding as the API's lineMoney: paisa, half up. */
const lineMoney = (qty, unit) => Math.round(Number(qty) * Number(unit));

class TillOffline {
  /**
   * @param {{ dir: string, server: () => ({ host: string, port: number } | null),
   *           request: (method: string, path: string, opts?: object) => Promise<{status:number,json:any}|null>,
   *           deviceKey: () => string | null, log?: (m: string) => void }} o
   */
  constructor(o) {
    this.o = o;
    this.files = {
      queue: path.join(o.dir, 'queue.json'),
      pack: path.join(o.dir, 'pack.json'),
      cache: path.join(o.dir, 'cache.json'),
    };
    this.q = readJson(this.files.queue, null) || { blocks: [], lastNo: 0, sales: [], synced: [] };
    this.pack = readJson(this.files.pack, null);
    this.cache = readJson(this.files.cache, null) || { gets: {}, sessions: {} };
    this.online = false;
    this.syncing = false;
    this.lastSyncAt = null;
    this.lastError = null;
    this.offSessions = new Map(); // offline token -> { session, pin, serverToken }
    this.approvals = new Map(); // offline approval -> { userId, action, exp }
    this.fails = new Map(); // userId -> { n, until }
    this.timers = [];
  }

  // ---- state ---------------------------------------------------------------------------------
  saveQueue() { writeJsonDurable(this.files.queue, this.q); }
  numbersLeft() {
    let n = 0;
    for (const b of this.q.blocks) n += Math.max(0, b.to - Math.max(b.from - 1, this.q.lastNo));
    return n;
  }
  takeNumber() {
    for (const b of this.q.blocks.sort((a, z) => a.from - z.from)) {
      const next = Math.max(b.from, this.q.lastNo + 1);
      if (next <= b.to) { this.q.lastNo = next; return next; }
    }
    return null;
  }
  state() {
    const queued = this.q.sales.filter((s) => s.status === 'queued').length;
    const rejected = this.q.sales.filter((s) => s.status === 'rejected').length;
    return {
      online: this.online,
      ready: Boolean(this.pack && this.pack.products),
      queued,
      rejected,
      syncing: this.syncing,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
      packAt: this.pack?.at ?? null,
      numbersLeft: this.numbersLeft(),
    };
  }

  // ---- while online: remember -----------------------------------------------------------------
  /** Called by till-link with every forwarded answer. */
  remember(method, urlPath, reqHeaders, status, body) {
    if (status !== 200 && status !== 201) return;
    const p = urlPath.split('?')[0];
    let changed = false;
    if (method === 'GET' && CACHED_GETS.includes(p)) { this.cache.gets[p] = body; changed = true; }
    const token = reqHeaders['x-dd-session'];
    if (method === 'GET' && p === '/auth/me' && token && body && body.session) {
      this.cache.sessions[sha(token)] = { session: body.session, at: Date.now() };
      changed = true;
    }
    if (method === 'POST' && p === '/auth/login' && body && body.ok && body.sessionToken) {
      this.cache.sessions[sha(body.sessionToken)] = { session: body.session, at: Date.now() };
      changed = true;
    }
    if (changed) {
      // Only the newest 50 sign-ins.
      const keys = Object.keys(this.cache.sessions);
      if (keys.length > 50) {
        keys.sort((a, b) => this.cache.sessions[a].at - this.cache.sessions[b].at);
        for (const k of keys.slice(0, keys.length - 50)) delete this.cache.sessions[k];
      }
      try { writeJsonDurable(this.files.cache, this.cache); } catch (e) { this.o.log?.(`cache: ${e.message}`); }
    }
  }

  async refreshPack() {
    if (!this.o.deviceKey()) return;
    const r = await this.o.request('GET', `/tills/offline-pack?have=${this.numbersLeft()}`, { till: this.o.deviceKey() });
    if (!r || r.status !== 200 || !r.json?.ok) return;
    const { block, ...pack } = r.json;
    if (block && block.to >= block.from) {
      this.q.blocks.push({ from: block.from, to: block.to });
      // Drop used-up blocks.
      this.q.blocks = this.q.blocks.filter((b) => b.to > this.q.lastNo);
      this.saveQueue();
    }
    this.pack = pack;
    writeJsonDurable(this.files.pack, pack);
  }

  async syncNow() {
    if (this.syncing || !this.online) return;
    const key = this.o.deviceKey();
    const todo = this.q.sales.filter((s) => s.status === 'queued').slice(0, BATCH);
    if (!key || todo.length === 0) return;
    this.syncing = true;
    try {
      const r = await this.o.request('POST', '/sales/offline-sync', {
        till: key,
        body: {
          sales: todo.map((s) => ({
            clientUuid: s.clientUuid, offlineNo: s.offlineNo, cashierId: s.cashierId, overrideBy: s.overrideBy,
            deviceAt: s.deviceAt, tenderedPaisa: s.tenderedPaisa,
            lines: s.lines.map((l) => ({ productId: l.productId, qty: l.qty, unitPricePaisa: l.unitPricePaisa, overrideFromPaisa: l.overrideFromPaisa ?? null })),
          })),
        },
        timeoutMs: 30_000,
      });
      if (!r || r.status !== 200 || !r.json?.ok) {
        this.lastError = r ? (r.json?.error || r.json?.code || `http_${r.status}`) : 'server_unreachable';
        return;
      }
      const byId = new Map(r.json.results.map((x) => [x.clientUuid, x]));
      const now = new Date().toISOString();
      const keep = [];
      for (const s of this.q.sales) {
        const res = byId.get(s.clientUuid);
        if (!res) { keep.push(s); continue; }
        if (res.status === 'saved' || res.status === 'duplicate') {
          this.q.synced.push({ clientUuid: s.clientUuid, shortId: s.shortId, serverShortId: res.shortId, at: now, status: res.status });
        } else {
          keep.push({ ...s, status: 'rejected', error: res.error || 'rejected' });
        }
      }
      this.q.sales = keep;
      this.q.synced = this.q.synced.slice(-KEEP_SYNCED);
      this.saveQueue();
      this.lastSyncAt = now;
      this.lastError = null;
    } finally {
      this.syncing = false;
    }
  }

  setOnline(up) {
    const was = this.online;
    this.online = up;
    if (up && !was) {
      void this.refreshPack().catch(() => undefined);
      void this.syncNow().catch(() => undefined);
    }
  }

  start() {
    this.timers.push(setInterval(() => { void this.syncNow().catch(() => undefined); }, SYNC_EVERY_MS));
    this.timers.push(setInterval(() => { if (this.online) void this.refreshPack().catch(() => undefined); }, PACK_EVERY_MS));
  }
  stop() { for (const t of this.timers) clearInterval(t); this.timers = []; }

  // ---- offline sessions ------------------------------------------------------------------------
  sessionFor(token) {
    if (!token) return null;
    const off = this.offSessions.get(token);
    if (off) return off.session;
    return this.cache.sessions[sha(token)]?.session ?? null;
  }
  /** Offline sign-in token -> a real one once the main PC is back (PIN kept in memory only). */
  async upgradeToken(token) {
    const off = this.offSessions.get(token);
    if (!off) return null;
    if (off.serverToken) return off.serverToken;
    if (!off.pin || !this.online) return null;
    const r = await this.o.request('POST', '/auth/login', { till: this.o.deviceKey(), body: { userId: off.session.userId, pin: off.pin } });
    if (r && r.json?.ok && r.json.sessionToken) {
      off.serverToken = r.json.sessionToken;
      off.pin = null;
      this.cache.sessions[sha(off.serverToken)] = { session: r.json.session, at: Date.now() };
      return off.serverToken;
    }
    off.pin = null;
    return null;
  }

  // ---- offline answers ---------------------------------------------------------------------------
  /** Answer a call the main PC cannot. Returns { status, json }. */
  async handle(method, urlPath, headers, body) {
    const url = new URL(urlPath, 'http://till.local');
    const p = url.pathname;
    const token = headers['x-dd-session'] || null;
    const session = this.sessionFor(token);
    const out = (status, json) => ({ status, json });
    const users = (this.pack?.users ?? []).map((u) => ({ id: u.id, displayName: u.displayName, role: u.role }));

    if (method === 'GET') {
      if (p === '/health') return out(503, { ok: false, error: 'offline' });
      if (p === '/auth/status') return out(200, { ...(this.cache.gets['/auth/status'] ?? { needsSetup: false, store: this.pack?.store ?? null }), users, offline: true });
      if (p === '/auth/users') return out(200, { users, offline: true });
      if (p === '/license/status') return out(200, this.cache.gets['/license/status'] ?? { state: 'licensed', readOnly: false });
      if (p === '/tills/me') return out(200, { ...(this.cache.gets['/tills/me'] ?? {}), offline: true });
      if (p === '/auth/me') return session ? out(200, { session, offline: true }) : out(401, { ok: false, error: 'unauthorized' });
      if (!session) return out(401, { ok: false, error: 'unauthorized' });
      if (p === '/catalog/products') {
        const q = (url.searchParams.get('q') || '').toLowerCase();
        const items = (this.pack?.products ?? []).filter((x) => !q || String(x.name).toLowerCase().includes(q));
        return out(200, { items, count: items.length, total: items.length, offline: true });
      }
      if (p === '/catalog/lookup') {
        const code = url.searchParams.get('barcode') || '';
        const hit = (this.pack?.products ?? []).find((x) => x.barcode === code || (x.extra_barcodes || []).includes(code));
        return hit ? out(200, { ok: true, product: hit }) : out(404, { ok: false, error: 'not_found' });
      }
      if (p === '/parties') return out(200, { items: [], offline: true });
      return out(503, { ok: false, error: 'offline' });
    }

    if (method === 'POST' && p === '/auth/login') return this.login(body);
    if (method === 'POST' && p === '/auth/logout') {
      if (token) this.offSessions.delete(token);
      return out(200, { ok: true });
    }
    if (method === 'POST' && p === '/auth/approve') {
      if (!session) return out(401, { ok: false, error: 'unauthorized' });
      return this.approve(body);
    }
    if (method === 'POST' && p === '/sales') {
      if (!session) return out(401, { ok: false, error: 'unauthorized' });
      return this.sell(session, body);
    }
    return out(503, { ok: false, error: 'offline' });
  }

  checkPin(userId, pin) {
    const f = this.fails.get(userId);
    if (f && f.until > Date.now()) return { ok: false, error: 'too_many_attempts', retry_after_s: Math.ceil((f.until - Date.now()) / 1000) };
    const u = (this.pack?.users ?? []).find((x) => x.id === userId);
    if (!u || !verifyPin(String(pin ?? ''), u.pinHash)) {
      const n = (f?.n ?? 0) + 1;
      this.fails.set(userId, { n, until: n >= 5 ? Date.now() + 30_000 * Math.min(10, n - 4) : 0 });
      return { ok: false, error: 'invalid_credentials' };
    }
    this.fails.delete(userId);
    return { ok: true, user: u };
  }

  login(body) {
    if (!this.pack) return { status: 503, json: { ok: false, error: 'offline' } };
    const c = this.checkPin(String(body?.userId ?? ''), body?.pin);
    if (!c.ok) return { status: 200, json: c };
    const session = {
      userId: c.user.id, displayName: c.user.displayName, role: c.user.role,
      storeId: this.pack.store?.id ?? null, till: this.pack.till ?? null, offline: true,
    };
    const token = `off_${crypto.randomBytes(24).toString('hex')}`;
    this.offSessions.set(token, { session, pin: String(body.pin), serverToken: null });
    return { status: 200, json: { ok: true, session, sessionToken: token, offline: true } };
  }

  approve(body) {
    if (body?.action !== 'price_override') return { status: 200, json: { ok: false, error: 'offline' } };
    const c = this.checkPin(String(body?.userId ?? ''), body?.pin);
    if (!c.ok) return { status: 200, json: c };
    if (c.user.role !== 'manager') return { status: 200, json: { ok: false, error: 'manager_only' } };
    const approval = `offap_${crypto.randomBytes(18).toString('hex')}`;
    this.approvals.set(approval, { userId: c.user.id, action: 'price_override', exp: Date.now() + 5 * 60_000 });
    return { status: 200, json: { ok: true, approval } };
  }

  sell(session, b) {
    const no = (error) => ({ status: 200, json: { ok: false, error } });
    if (!this.pack?.products) return no('offline');
    if (!['cashier', 'manager', 'owner'].includes(session.role)) return no('forbidden');
    if ((b?.paymentMethod ?? 'cash') !== 'cash' || b.partyId || b.cashAmountPaisa != null || b.udhaarAmountPaisa != null) return no('offline_cash_only');
    if (b.discount || b.digitalPaisa || b.loyaltyRedeemPoints || b.applySurplusToKhata || b.overrideCreditLimit) return no('offline_cash_only');
    const lines = Array.isArray(b.lines) ? b.lines : [];
    if (lines.length === 0) return no('empty_cart');
    const clientUuid = typeof b.clientUuid === 'string' && UUID_RE.test(b.clientUuid) ? b.clientUuid.toLowerCase() : crypto.randomUUID();
    // Same bill sent twice (retry): answer with the queued one.
    const again = this.q.sales.find((s) => s.clientUuid === clientUuid) || this.q.synced.find((s) => s.clientUuid === clientUuid);
    if (again && again.lines) return { status: 201, json: this.answer(again) };
    if (again) return no('duplicate');

    let overrideBy = null;
    const prepared = [];
    for (const l of lines) {
      const prod = this.pack.products.find((x) => x.id === l?.productId);
      if (!prod) return no('offline_item_not_cached');
      const qty = Number(l.qty);
      if (!(qty > 0) || qty > 100000) return no('invalid_qty');
      if ((l.unit ?? 'piece') !== 'piece') return no('invalid_unit');
      const shelf = Math.round(Number(prod.price_paisa));
      const expected = l.expectedUnitPricePaisa != null ? Math.round(Number(l.expectedUnitPricePaisa)) : shelf;
      // The Sell screen priced it from the same copy (a running discount only lowers it).
      if (!(expected >= 0 && expected <= shelf)) return no('price_changed');
      let unit = expected;
      let overrideFromPaisa = null;
      if (l.overridePricePaisa != null) {
        const o = Math.round(Number(l.overridePricePaisa));
        if (!(o >= 0 && o <= 100_000_000_00)) return no('invalid_price');
        if (o !== expected) {
          if (!overrideBy) {
            if (session.role === 'manager') overrideBy = session.userId;
            else {
              const a = this.approvals.get(String(b.approval ?? ''));
              if (!a || a.exp < Date.now() || a.action !== 'price_override') return { status: 403, json: { ok: false, error: 'manager_approval_needed' } };
              overrideBy = a.userId;
            }
          }
          overrideFromPaisa = expected;
          unit = o;
        }
      }
      prepared.push({ productId: prod.id, productName: prod.name, qty, unitPricePaisa: unit, overrideFromPaisa, lineTotalPaisa: lineMoney(qty, unit) });
    }
    const totalPaisa = prepared.reduce((s, l) => s + l.lineTotalPaisa, 0);
    const tenderedPaisa = b.tenderedPaisa != null ? Math.round(Number(b.tenderedPaisa)) : totalPaisa;
    if (tenderedPaisa < totalPaisa) return no('offline_cash_only');
    const offlineNo = this.takeNumber();
    if (offlineNo == null) return no('offline_numbers_used_up');
    if (b.approval && overrideBy) this.approvals.delete(String(b.approval));
    const code = this.pack.till?.code ?? 0;
    const sale = {
      clientUuid, offlineNo, shortId: `T${code}-OFF-${String(offlineNo).padStart(6, '0')}`,
      status: 'queued', cashierId: session.userId, overrideBy, deviceAt: new Date().toISOString(),
      tenderedPaisa, totalPaisa, lines: prepared,
    };
    this.q.sales.push(sale);
    this.saveQueue(); // on disk before the cashier sees "done"
    // Show this till's own sales in the copy's stock (the main PC count wins on the next refresh).
    for (const l of prepared) {
      const prod = this.pack.products.find((x) => x.id === l.productId);
      if (prod && typeof prod.qty_on_hand === 'number') prod.qty_on_hand = Math.round((prod.qty_on_hand - l.qty) * 1000) / 1000;
    }
    try { writeJsonDurable(this.files.pack, this.pack); } catch { /* the queue is what matters */ }
    void this.syncNow().catch(() => undefined);
    return { status: 201, json: this.answer(sale) };
  }

  answer(s) {
    return {
      ok: true,
      offline: true,
      sale: {
        id: s.clientUuid, shortId: s.shortId, tillId: this.pack?.till?.id ?? null, billNo: null,
        totalPaisa: s.totalPaisa, paymentMethod: 'cash', partyId: null,
        cashAmountPaisa: s.totalPaisa, udhaarAmountPaisa: 0, tenderedPaisa: s.tenderedPaisa,
        changePaisa: Math.max(0, s.tenderedPaisa - s.totalPaisa), surplusCreditedPaisa: 0,
        clientDeviceAt: s.deviceAt, recordedAt: s.deviceAt,
        lines: (s.lines || []).map((l) => ({
          productId: l.productId, productName: l.productName, qtyInput: l.qty, unit: 'piece', qtyPieces: l.qty,
          unitPricePaisa: l.unitPricePaisa, lineTotalPaisa: l.lineTotalPaisa,
        })),
        subtotalPaisa: s.totalPaisa, discountPaisa: 0, roundingPaisa: 0, taxEnabled: false, taxPaisa: 0,
      },
    };
  }
}

module.exports = { TillOffline, verifyPin, writeJsonDurable };
