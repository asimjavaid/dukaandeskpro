'use strict';
/** Key format + Ed25519 sign/verify (node:crypto only). */
const crypto = require('node:crypto');

/** DukaanDesk Pro keys: DR1/DR2. P1 keys (DD1/DD2) are rejected (different prefix, product and public key). */
const PRODUCT = 'dukaandeskpro';
const PREFIX = 'DR1';
const PREFIX2 = 'DR2';
const KEY_TYPES = ['full', 'ext', 'transfer'];

function b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Canonical payload: fixed key order so signatures are deterministic. */
function canonicalPayload(p) {
  const features = Array.isArray(p.features) ? [...new Set(p.features.map(String))].sort() : [];
  return {
    v: 1,
    machineCode: normalizeMachineCode(p.machineCode),
    edition: String(p.edition || 'standard'),
    features,
    shop: p.shop ? String(p.shop).slice(0, 80) : '',
    issuedAt: String(p.issuedAt || new Date().toISOString()),
  };
}

/** Key format v2 (DD2): adds type, updatesUntil, extension days, one-time id, transfer source. */
function canonicalPayloadV2(p) {
  const type = KEY_TYPES.includes(p.type) ? p.type : 'full';
  const features = Array.isArray(p.features) ? [...new Set(p.features.map(String))].sort() : [];
  const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  const tills = type === 'ext' ? 0 : Math.max(1, Math.min(99, Math.floor(Number(p.tills) || 1)));
  return {
    v: 2,
    product: PRODUCT,
    type,
    tills,
    machineCode: normalizeMachineCode(p.machineCode),
    edition: type === 'ext' ? '' : String(p.edition || 'standard'),
    features: type === 'ext' ? [] : features,
    shop: p.shop ? String(p.shop).slice(0, 80) : '',
    issuedAt: String(p.issuedAt || new Date().toISOString()),
    updatesUntil: type === 'ext' ? '' : day(p.updatesUntil),
    days: type === 'ext' ? Math.max(1, Math.min(60, Math.floor(Number(p.days) || 7))) : 0,
    useBy: type === 'ext' ? day(p.useBy) : '',
    id: String(p.id || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 24),
    from: type === 'transfer' ? normalizeMachineCode(p.from) : '',
  };
}

function normalizeMachineCode(code) {
  return String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function signLicense(payload, privateKeyPem) {
  const canon = canonicalPayload(payload);
  const body = Buffer.from(JSON.stringify(canon), 'utf8');
  const sig = crypto.sign(null, body, crypto.createPrivateKey(privateKeyPem));
  return `${PREFIX}.${b64u(body)}.${b64u(sig)}`;
}

/** Sign a v2 key (full licence, trial extension or PC transfer). Ext/transfer get a one-time id. */
function signKey(payload, privateKeyPem) {
  const p = { ...payload };
  if (!p.id) p.id = crypto.randomBytes(9).toString('base64').replace(/[^0-9A-Za-z]/g, '').slice(0, 12);
  const canon = canonicalPayloadV2(p);
  const body = Buffer.from(JSON.stringify(canon), 'utf8');
  const sig = crypto.sign(null, body, crypto.createPrivateKey(privateKeyPem));
  return `${PREFIX2}.${b64u(body)}.${b64u(sig)}`;
}

/** v1 payloads normalised to the v2 shape (full licence, updates unlimited). */
function normalizePayload(p) {
  if (p && p.v === 2) return p;
  return { ...p, v: 1, product: PRODUCT, tills: 1, type: 'full', updatesUntil: '', days: 0, useBy: '', id: '', from: '' };
}

/**
 * Accepts DR1 (v1) and DR2 (v2) keys.
 * @returns {{ok:true,payload:object}|{ok:false,reason:string}}
 */
function verifyLicense(key, { publicKeyPem, machineCode }) {
  if (!publicKeyPem) return { ok: false, reason: 'no_public_key' };
  const clean = String(key || '').replace(/\s+/g, '');
  const parts = clean.split('.');
  if (parts.length !== 3 || (parts[0] !== PREFIX && parts[0] !== PREFIX2)) return { ok: false, reason: 'bad_format' };
  const canon = parts[0] === PREFIX2 ? canonicalPayloadV2 : canonicalPayload;
  let body, sig, payload;
  try {
    body = unb64u(parts[1]);
    sig = unb64u(parts[2]);
    payload = JSON.parse(body.toString('utf8'));
  } catch {
    return { ok: false, reason: 'bad_format' };
  }
  let good = false;
  try {
    good = sig.length === 64 && crypto.verify(null, body, crypto.createPublicKey(publicKeyPem), sig);
  } catch {
    good = false;
  }
  if (!good) return { ok: false, reason: 'bad_signature' };
  // Re-canonicalise: reject anything not in canonical form (defence in depth).
  if (JSON.stringify(canon(payload)) !== body.toString('utf8')) {
    return { ok: false, reason: 'bad_format' };
  }
  if (normalizeMachineCode(machineCode) !== payload.machineCode) {
    return { ok: false, reason: 'wrong_machine', payload: normalizePayload(payload) };
  }
  return { ok: true, payload: normalizePayload(payload) };
}

function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

function keyId(publicKeyPem) {
  return crypto.createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 12).toUpperCase();
}

module.exports = { PRODUCT, PREFIX, PREFIX2, KEY_TYPES, b64u, unb64u, canonicalPayload, canonicalPayloadV2, normalizeMachineCode, signLicense, signKey, verifyLicense, generateKeyPair, keyId };
