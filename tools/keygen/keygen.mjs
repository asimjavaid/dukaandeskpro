#!/usr/bin/env node
/**
 * DukaanDesk Pro key-maker — OWNER ONLY. Never shipped in the installer
 * (electron-builder packs apps/desktop/src only; tools/ is not included).
 *
 *   node tools/keygen/keygen.mjs init [--force]           create YOUR keypair once (on your own PC)
 *   node tools/keygen/keygen.mjs sign --machine XXXX-XXXX-XXXX-XXXX --shop "Shop name"
 *                                     [--tills 3 (default 2)] [--edition standard] [--features a,b] [--updates-until 2027-11-30 | --updates-months 12]
 *   node tools/keygen/keygen.mjs renew --machine XXXX-... --shop "Shop" [--updates-months 12]   (Care renewal = new later date)
 *   node tools/keygen/keygen.mjs extend --machine XXXX-... [--days 7] [--use-within 14]        one-time trial extension
 *   node tools/keygen/keygen.mjs transfer --from OLD-MACHINE-CODE --machine NEW-MACHINE-CODE --shop "Shop" [--updates-until ...]
 *   node tools/keygen/keygen.mjs verify --machine XXXX-... --key DR1.../DR2...
 *   node tools/keygen/keygen.mjs list [--machine XXXX-...]                   issued keys (log)
 *   node tools/keygen/keygen.mjs manifest --dir <folder> --kind api|web [--build-date 2026-11-02]   sign build manifest
 *
 * Private key location (outside the repo):
 *   %USERPROFILE%\.dukaandeskprokeys\private.pem   (Windows)
 *   ~/.dukaandeskprokeys/private.pem               (Linux/mac)
 * Override with DD_KEYS_DIR. BACK THIS FOLDER UP (2 USB sticks + encrypted cloud). Losing it means
 * you can't issue keys for installers already sold; leaking it means anyone can.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lic = require(path.join(root, 'packages/license/src/codec.js'));
const man = require(path.join(root, 'packages/license/src/manifest.js'));
const PUBKEY_FILE = path.join(root, 'packages/license/src/public-key.js');
const KEYS_DIR = process.env.DD_KEYS_DIR || path.join(os.homedir(), '.dukaandeskprokeys');
const PRIV = path.join(KEYS_DIR, 'private.pem');
const PUB = path.join(KEYS_DIR, 'public.pem');
const LOG = path.join(KEYS_DIR, 'issued.csv');
const LOG_HEAD = 'issuedAt,type,tills,machineCode,fromMachine,shop,edition,features,updatesUntil,days,id,key\n';

function args() {
  const a = process.argv.slice(3); const o = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) { const k = a[i].slice(2); const v = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; o[k] = v; }
  }
  return o;
}
function die(m) { console.error(m); process.exit(1); }
function writePublicKeyModule(pem, testOnly) {
  const id = lic.keyId(pem);
  fs.writeFileSync(PUBKEY_FILE, `/**\n * Embedded Ed25519 PUBLIC key used to verify activation keys.\n * Written by tools/keygen/keygen.mjs init. The private key NEVER lives in this repo.\n */\nmodule.exports = {\n${testOnly ? '  // TEST KEY ONLY. Installer builds refuse to run while TEST_ONLY is true.\n' : ''}  TEST_ONLY: ${testOnly ? 'true' : 'false'},\n  KEY_ID: ${JSON.stringify(id)},\n  PUBLIC_KEY_PEM: ${JSON.stringify(pem)},\n};\n`);
  return id;
}
function needPriv() {
  if (!fs.existsSync(PRIV)) die(`No private key at ${PRIV}. Run: node tools/keygen/keygen.mjs init`);
  return fs.readFileSync(PRIV, 'utf8');
}
function machine(v, label = '--machine') {
  if (!v || v === true) die(`Need ${label} XXXX-XXXX-XXXX-XXXX (shown on the shop's Licence screen)`);
  const mc = lic.normalizeMachineCode(v);
  if (mc.length !== 16) die(`Machine code should have 16 letters/digits, got ${mc.length}: ${v}`);
  return mc.match(/.{4}/g).join('-');
}
const ymd = (d) => d.toISOString().slice(0, 10);
function updatesUntil(o, fallbackMonths = 12) {
  if (typeof o['updates-until'] === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(o['updates-until'])) die('--updates-until must be YYYY-MM-DD');
    return o['updates-until'];
  }
  if (o['updates-until'] === true || o['no-updates-limit']) return '';
  const months = o['updates-months'] !== undefined ? Number(o['updates-months']) : fallbackMonths;
  if (!Number.isFinite(months) || months < 0) die('--updates-months must be a number');
  if (months === 0) return '';
  const d = new Date(); d.setUTCMonth(d.getUTCMonth() + months);
  return ymd(d);
}
function issue(payload, label) {
  const key = lic.signKey({ issuedAt: new Date().toISOString(), ...payload }, needPriv());
  const check = lic.verifyLicense(key, { publicKeyPem: fs.readFileSync(PUB, 'utf8'), machineCode: payload.machineCode });
  if (!check.ok) die('Self-check failed: ' + check.reason);
  const p = check.payload;
  if (!fs.existsSync(LOG)) fs.writeFileSync(LOG, LOG_HEAD);
  const pretty = (c) => (c ? c.match(/.{4}/g).join('-') : '');
  fs.appendFileSync(LOG, [p.issuedAt, p.type, p.tills, pretty(p.machineCode), pretty(p.from), JSON.stringify(p.shop), p.edition, p.features.join(' '), p.updatesUntil, p.days, p.id, key].join(',') + '\n');
  console.log(`\n${label}\n\n${key}\n\nSend this whole line to the shop (WhatsApp/SMS). Logged in ${LOG}`);
  return key;
}

const cmd = process.argv[2];
const o = args();
if (cmd === 'init') {
  const testOnly = !!o.test;
  if (fs.existsSync(PRIV) && !o.force) {
    const pem = fs.readFileSync(PUB, 'utf8');
    const id = writePublicKeyModule(pem, testOnly);
    console.log(`Keypair already exists at ${KEYS_DIR} (id ${id}). Public key re-embedded into the app${testOnly ? ' (marked TEST ONLY)' : ''}.`);
    process.exit(0);
  }
  if (fs.existsSync(PRIV) && o.force) {
    fs.copyFileSync(PRIV, `${PRIV}.old-${Date.now()}`);
    console.log('WARNING: replacing keypair. Keys issued with the old one stop working in NEW builds.');
  }
  fs.mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  const kp = lic.generateKeyPair();
  fs.writeFileSync(PRIV, kp.privateKeyPem, { mode: 0o600 });
  fs.writeFileSync(PUB, kp.publicKeyPem);
  const id = writePublicKeyModule(kp.publicKeyPem, testOnly);
  console.log(`New keypair (id ${id})${testOnly ? ' TEST ONLY' : ''}\n  private: ${PRIV}  <- keep secret, back up (2 USB sticks + encrypted cloud)\n  public embedded in: ${path.relative(root, PUBKEY_FILE)}\nRebuild the installer now so it carries this public key.`);
} else if (cmd === 'sign' || cmd === 'renew') {
  const mc = machine(o.machine);
  const features = typeof o.features === 'string' ? o.features.split(',').map((s) => s.trim()).filter(Boolean) : [];
  issue({ type: 'full', machineCode: mc, tills: o.tills !== undefined ? Number(o.tills) : 2, edition: typeof o.edition === 'string' ? o.edition : 'standard', features, shop: typeof o.shop === 'string' ? o.shop : '', updatesUntil: updatesUntil(o) },
    `${cmd === 'renew' ? 'Renewal' : 'Activation'} key for ${mc}${o.shop ? ` (${o.shop})` : ''}, updates until ${updatesUntil(o) || 'no limit'}:`);
} else if (cmd === 'extend') {
  const mc = machine(o.machine);
  const days = o.days !== undefined ? Number(o.days) : 7;
  if (!Number.isInteger(days) || days < 1 || days > 60) die('--days must be 1..60');
  const within = o['use-within'] !== undefined ? Number(o['use-within']) : 14;
  const useBy = new Date(Date.now() + within * 86400e3);
  issue({ type: 'ext', machineCode: mc, days, useBy: ymd(useBy), shop: typeof o.shop === 'string' ? o.shop : '' },
    `One-time trial extension (+${days} days) for ${mc}, use by ${ymd(useBy)}:`);
} else if (cmd === 'transfer') {
  const from = machine(o.from, '--from');
  const mc = machine(o.machine);
  if (from === mc) die('--from and --machine are the same code');
  const prior = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter((l) => l.includes(from)) : [];
  if (!prior.length) console.warn(`Note: no earlier key for ${from} in ${LOG}. Check the old code before sending.`);
  const transfers = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split('\n').filter((l) => l.split(',')[1] === 'transfer' && l.includes(JSON.stringify(typeof o.shop === 'string' ? o.shop : '~'))).length : 0;
  if (transfers) console.warn(`Note: this shop already has ${transfers} transfer(s) logged.`);
  const features = typeof o.features === 'string' ? o.features.split(',').map((s) => s.trim()).filter(Boolean) : [];
  issue({ type: 'transfer', machineCode: mc, from, tills: o.tills !== undefined ? Number(o.tills) : 2, edition: typeof o.edition === 'string' ? o.edition : 'standard', features, shop: typeof o.shop === 'string' ? o.shop : '', updatesUntil: updatesUntil(o) },
    `Transfer key: ${from} -> ${mc}${o.shop ? ` (${o.shop})` : ''}. The old PC's key keeps working offline; ask the shop to stop using it.`);
} else if (cmd === 'verify') {
  if (!o.key || !o.machine) die('Need --machine and --key');
  const r = lic.verifyLicense(o.key, { publicKeyPem: fs.readFileSync(PUB, 'utf8'), machineCode: o.machine });
  console.log(r.ok ? `VALID: ${JSON.stringify(r.payload)}` : `INVALID: ${r.reason}`);
  process.exit(r.ok ? 0 : 2);
} else if (cmd === 'list' || cmd === 'log') {
  if (!fs.existsSync(LOG)) { console.log('No keys issued yet.'); process.exit(0); }
  const lines = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean);
  const want = typeof o.machine === 'string' ? lic.normalizeMachineCode(o.machine) : '';
  console.log(lines.filter((l, i) => i === 0 || !want || lic.normalizeMachineCode(l).includes(want)).join('\n'));
} else if (cmd === 'manifest') {
  if (typeof o.dir !== 'string') die('Need --dir <folder>');
  const kind = o.kind === 'web' ? 'web' : 'api';
  const buildDate = typeof o['build-date'] === 'string' ? o['build-date'] : ymd(new Date());
  const m = man.signManifest(man.createManifest(path.resolve(o.dir), buildDate, kind), needPriv());
  fs.writeFileSync(path.join(path.resolve(o.dir), man.MANIFEST_NAME), JSON.stringify(m));
  const v = man.verifyManifest(path.resolve(o.dir), fs.readFileSync(PUB, 'utf8'));
  if (!v.ok) die('Manifest self-check failed: ' + v.reason);
  console.log(`Signed ${kind} manifest: ${Object.keys(m.files).length} files, build date ${buildDate} -> ${path.join(o.dir, man.MANIFEST_NAME)}`);
} else {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 22).join('\n'));
}
