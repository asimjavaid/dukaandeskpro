'use strict';
/**
 * Signed build manifest: SHA-256 of the server files + licence module, signed at build time with
 * the owner's Ed25519 key (tools/keygen/keygen.mjs manifest). The packaged app checks it at start;
 * a changed or missing file -> read-only 'integrity' state with a clear "reinstall" message.
 * This raises the bar for casual patching; it cannot stop someone who also patches the checker.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { b64u, unb64u } = require('./codec');

const MANIFEST_NAME = 'dd-manifest.json';

function sha256File(p) {
  const b = fs.readFileSync(p);
  return crypto.createHash('sha256').update(b).digest('hex');
}

/**
 * Files that matter. kind 'api': compiled server JS + the licence module + package.json.
 * kind 'web': every file of the built web app.
 */
function listFiles(baseDir, kind = 'api') {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(baseDir, rel);
    let ents;
    try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (e.isFile() && /\.(js|cjs|mjs|json)$/.test(e.name) && !r.endsWith('.map')) out.push(r);
    }
  };
  if (kind === 'web') {
    const all = [];
    const walkAll = (rel) => {
      let ents;
      try { ents = fs.readdirSync(path.join(baseDir, rel), { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walkAll(r); else if (e.isFile()) all.push(r);
      }
    };
    walkAll('');
    return all.filter((r) => r !== MANIFEST_NAME).sort();
  }
  walk('dist');
  for (const d of ['node_modules/@dukaandeskpro/license/src']) walk(d);
  if (fs.existsSync(path.join(baseDir, 'package.json'))) out.push('package.json');
  return out.filter((r) => r !== MANIFEST_NAME).sort();
}

function canonical(m) {
  const files = {};
  for (const k of Object.keys(m.files).sort()) files[k] = m.files[k];
  return JSON.stringify({ v: 1, kind: m.kind === 'web' ? 'web' : 'api', buildDate: String(m.buildDate || ''), files });
}

function createManifest(baseDir, buildDate, kind = 'api') {
  const files = {};
  for (const r of listFiles(baseDir, kind)) files[r] = sha256File(path.join(baseDir, r));
  return { v: 1, kind: kind === 'web' ? 'web' : 'api', buildDate: String(buildDate || ''), files };
}

function signManifest(m, privateKeyPem) {
  const sig = crypto.sign(null, Buffer.from(canonical(m), 'utf8'), crypto.createPrivateKey(privateKeyPem));
  return { ...m, sig: b64u(sig) };
}

/**
 * @returns {{ok:boolean, reason?:string, bad?:string[], buildDate?:string}}
 */
function verifyManifest(baseDir, publicKeyPem, manifestPath = path.join(baseDir, MANIFEST_NAME)) {
  let m;
  try { m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { return { ok: false, reason: 'manifest_missing' }; }
  if (!m || typeof m.files !== 'object' || typeof m.sig !== 'string') return { ok: false, reason: 'manifest_bad' };
  let good = false;
  try { good = crypto.verify(null, Buffer.from(canonical(m), 'utf8'), crypto.createPublicKey(publicKeyPem), unb64u(m.sig)); } catch { good = false; }
  if (!good) return { ok: false, reason: 'manifest_signature' };
  const bad = [];
  for (const [rel, hash] of Object.entries(m.files)) {
    const abs = path.join(baseDir, rel);
    try { if (sha256File(abs) !== hash) bad.push(rel); } catch { bad.push(rel); }
  }
  // Extra JS dropped into dist (e.g. a patched module loaded instead) also counts.
  const kind = m.kind === 'web' ? 'web' : 'api';
  for (const rel of listFiles(baseDir, kind)) if (!(rel in m.files) && (kind === 'web' || rel.startsWith('dist/'))) bad.push(rel);
  return bad.length ? { ok: false, reason: 'files_changed', bad, buildDate: m.buildDate } : { ok: true, buildDate: m.buildDate };
}

module.exports = { MANIFEST_NAME, createManifest, signManifest, verifyManifest, listFiles };
