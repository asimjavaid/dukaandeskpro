'use strict';
/**
 * Trial + licence evaluator. Pure apart from the stores passed in.
 * States: 'licensed' | 'trial' | 'expired' | 'clock_rollback' | 'integrity'
 * locked === readOnly === state is not licensed/trial. Locked never means "app closed":
 * the shop keeps reading, exporting, backing up and restoring; only changes are refused.
 *
 * Trial ends after TRIAL_DAYS (+ extension days) OR USAGE_CAP_HOURS of active use
 * (scaled by extensions), whichever comes first.
 */
const crypto = require('node:crypto');
const { verifyLicense } = require('./codec');

const DAY = 24 * 60 * 60 * 1000;
const TRIAL_DAYS = 14;
const USAGE_CAP_HOURS = 200;
const HOURS_HINT_BELOW = 24; // show "N hours left" only when this close to the cap
const ROLLBACK_TOLERANCE_MS = 2 * 60 * 60 * 1000; // 2h for small clock corrections
/**
 * A build newer than the licence's updatesUntil: 'warn' = stays licensed (read-write) and the
 * Licence screen asks for a renewal key. Set to 'readonly' to make it read-only instead.
 */
const UPDATE_POLICY = 'warn';

function macKey(machineCode) {
  return crypto.createHash('sha256').update(`dd-rt-v1|${machineCode}|kiryana`).digest();
}
function encodeRecord(rec, machineCode) {
  const o = { f: rec.firstRun, l: rec.lastSeen, k: rec.key || '', m: machineCode };
  if (rec.usage) o.u = Math.floor(rec.usage);
  if (rec.ext && rec.ext.length) o.x = rec.ext;
  const body = JSON.stringify(o);
  const mac = crypto.createHmac('sha256', macKey(machineCode)).update(body).digest('hex').slice(0, 32);
  return Buffer.from(JSON.stringify({ b: body, h: mac })).toString('base64');
}
/** @returns {{valid:true,rec:object}|{valid:false}} */
function decodeRecord(text, machineCode) {
  try {
    const o = JSON.parse(Buffer.from(String(text), 'base64').toString('utf8'));
    const mac = crypto.createHmac('sha256', macKey(machineCode)).update(o.b).digest('hex').slice(0, 32);
    if (typeof o.h !== 'string' || o.h.length !== 32 || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(o.h))) return { valid: false };
    const b = JSON.parse(o.b);
    if (b.m !== machineCode || !Number.isFinite(b.f) || !Number.isFinite(b.l)) return { valid: false };
    const ext = Array.isArray(b.x) ? b.x.filter((e) => typeof e === 'string' && /^[0-9A-Za-z]+:\d+$/.test(e)) : [];
    return { valid: true, rec: { firstRun: b.f, lastSeen: b.l, key: b.k || '', usage: Number.isFinite(b.u) ? b.u : 0, ext } };
  } catch { return { valid: false }; }
}

const extDaysOf = (ext) => ext.reduce((n, e) => n + Number(e.split(':')[1] || 0), 0);
const untilMs = (d) => (d ? Date.parse(`${d}T23:59:59Z`) : Infinity);

/**
 * @param {{stores:Array, machineCode:string, publicKeyPem:string|null, now?:number, trialDays?:number,
 *   newKey?:string, addUsageMinutes?:number, dataNewest?:number|null, buildDate?:string|null,
 *   integrityOk?:boolean, usageCapHours?:number}} o
 */
function evaluate(o) {
  const now = o.now ?? Date.now();
  const trialDays = o.trialDays ?? TRIAL_DAYS;
  const capHours = o.usageCapHours ?? USAGE_CAP_HOURS;
  const verify = (k) => verifyLicense(k, { publicKeyPem: o.publicKeyPem, machineCode: o.machineCode });

  const valid = [];
  let tampered = 0;
  for (const s of o.stores) {
    const t = s.read();
    if (t == null) continue;
    const d = decodeRecord(t, o.machineCode);
    if (d.valid) valid.push(d.rec); else tampered++;
  }

  let firstRun, lastSeen, usage = 0;
  let ext = [];
  let fresh = false;
  if (valid.length) {
    firstRun = Math.min(...valid.map((r) => r.firstRun));
    lastSeen = Math.max(...valid.map((r) => r.lastSeen));
    usage = Math.max(...valid.map((r) => r.usage || 0));
    ext = [...new Set(valid.flatMap((r) => r.ext || []))];
  } else if (tampered) {
    firstRun = now - trialDays * DAY - DAY; // edited records: trial is over
    lastSeen = now;
  } else {
    firstRun = now; lastSeen = now; fresh = true;
  }

  // Later updates-until wins; same updates-until: the key issued last (e.g. Lite till upgrade 2 -> 4).
  const newer = (a, b) => {
    const ua = untilMs(a.updatesUntil);
    const ub = untilMs(b.updatesUntil);
    if (ua !== ub) return ua > ub;
    return String(a.issuedAt || '') > String(b.issuedAt || '');
  };
  // Licence: best of the stored keys (latest updatesUntil wins) and a newly entered key.
  let key = '';
  let licence = null;
  let activationError = null;
  let activated = null;
  for (const r of valid) {
    if (!r.key) continue;
    const v = verify(r.key);
    if (v.ok && v.payload.type !== 'ext' && (!licence || newer(v.payload, licence))) { key = r.key; licence = v.payload; }
  }
  if (o.newKey) {
    const r = verify(o.newKey);
    if (!r.ok) activationError = r.reason;
    else if (r.payload.type === 'ext') {
      const id = r.payload.id || 'x';
      if (licence) activationError = 'already_licensed';
      else if (ext.some((e) => e.split(':')[0] === id)) activationError = 'ext_used';
      else if (r.payload.useBy && now > untilMs(r.payload.useBy)) activationError = 'ext_too_old';
      else { ext.push(`${id}:${r.payload.days}`); activated = 'ext'; }
    } else if (!licence || untilMs(r.payload.updatesUntil) >= untilMs(licence.updatesUntil)) {
      key = String(o.newKey).replace(/\s+/g, ''); licence = r.payload; activated = r.payload.type;
    } else {
      activationError = 'older_key';
    }
  }

  const extDays = extDaysOf(ext);
  const totalDays = trialDays + extDays;
  const capMinutes = Math.round(capHours * 60 * (totalDays / trialDays));
  if (!licence && o.addUsageMinutes > 0) usage += Math.floor(o.addUsageMinutes);

  const dataAhead = Number.isFinite(o.dataNewest) && now + ROLLBACK_TOLERANCE_MS < o.dataNewest;
  const rolledBack = !licence && ((!fresh && (now + ROLLBACK_TOLERANCE_MS < lastSeen || now + ROLLBACK_TOLERANCE_MS < firstRun)) || dataAhead);
  const endsAt = firstRun + totalDays * DAY;
  const buildDate = o.buildDate || null;
  const updateCovered = !licence || !licence.updatesUntil || !buildDate || buildDate <= licence.updatesUntil;
  let state;
  let reason = null;
  if (o.integrityOk === false) { state = 'integrity'; reason = 'files_changed'; }
  else if (licence && (updateCovered || UPDATE_POLICY === 'warn')) state = 'licensed';
  else if (licence) { state = 'expired'; reason = 'update_not_covered'; }
  else if (rolledBack) { state = 'clock_rollback'; reason = dataAhead ? 'data_newer' : 'clock_back'; }
  else if (now >= endsAt) { state = 'expired'; reason = 'days'; }
  else if (usage >= capMinutes) { state = 'expired'; reason = 'usage'; }
  else state = 'trial';

  // Heal / persist into every store (never move lastSeen backwards).
  const rec = { firstRun, lastSeen: rolledBack ? lastSeen : Math.max(lastSeen, now), key, usage, ext };
  const enc = encodeRecord(rec, o.machineCode);
  for (const s of o.stores) s.write(enc);

  const locked = state !== 'licensed' && state !== 'trial';
  const minutesLeft = Math.max(0, capMinutes - usage);
  return {
    state,
    reason,
    locked,
    readOnly: locked,
    machineCode: o.machineCode,
    trialDays: totalDays,
    trialStartedAt: new Date(firstRun).toISOString(),
    trialEndsAt: new Date(endsAt).toISOString(),
    daysLeft: state === 'trial' ? Math.max(1, Math.ceil((endsAt - now) / DAY)) : 0,
    usageMinutes: usage,
    usageCapMinutes: capMinutes,
    hoursLeft: state === 'trial' ? Math.ceil(minutesLeft / 60) : 0,
    showHoursLeft: state === 'trial' && minutesLeft <= HOURS_HINT_BELOW * 60,
    extDays,
    tampered: tampered > 0,
    buildDate,
    updateCovered,
    licence: licence
      ? { type: licence.type || 'full', tills: Math.max(1, Number(licence.tills) || 1), edition: licence.edition, features: licence.features, shop: licence.shop, issuedAt: licence.issuedAt, updatesUntil: licence.updatesUntil || '' }
      : null,
    activated,
    activationError,
  };
}

module.exports = { evaluate, encodeRecord, decodeRecord, TRIAL_DAYS, USAGE_CAP_HOURS, HOURS_HINT_BELOW, UPDATE_POLICY, DAY, ROLLBACK_TOLERANCE_MS };
