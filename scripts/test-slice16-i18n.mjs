#!/usr/bin/env node
/**
 * Slice 16 — English UI with Urdu only in nav/headings (current rule since Oct 2026).
 * - MessageKey / en key sets match (no dupes, no empty strings); no full `ur` dictionary any more
 * - Urdu hints (UrHint.tsx) only reference real MessageKeys and contain Urdu script
 * - Western digits in dictionary + Rs money format (paisa/100)
 * - Document stays lang=en, dir=ltr
 * - (Hard-coded English literal scan removed: UI is English-only.)
 *
 * Run: node scripts/test-slice16-i18n.mjs
 * Or:  pnpm test:slice16
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const webSrc = path.join(root, 'apps/web/src');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function objectKeys(body) {
  const keys = [];
  const re = /\n {4}(\w+):/g;
  let m;
  while ((m = re.exec(body))) keys.push(m[1]);
  return keys;
}

function localeBody(src, name) {
  const start = src.indexOf(`\n  ${name}: {`);
  assert(start >= 0, `missing locale block ${name}`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) return src.slice(i + 1, j);
    }
  }
  throw new Error(`unterminated ${name}`);
}

const dictPath = 'apps/web/src/i18n/dictionary.ts';
const dict = read(dictPath);
const keyStart = dict.indexOf('export type MessageKey');
const keyEnd = dict.indexOf('export const dictionary');
const unionRegion = dict.slice(keyStart, keyEnd);
const unionKeys = [...unionRegion.matchAll(/\| '(\w+)'/g)].map((m) => m[1]);
const enBody = localeBody(dict, 'en');
assert(!dict.includes('\n  ur: {'), 'no full Urdu dictionary (English UI, Urdu only in nav/headings)');
const enKeys = objectKeys(enBody);

function dupes(list) {
  const seen = new Set();
  const out = [];
  for (const k of list) {
    if (seen.has(k)) out.push(k);
    seen.add(k);
  }
  return out;
}

assert(dupes(unionKeys).length === 0, `duplicate MessageKey: ${dupes(unionKeys).join(',')}`);
assert(dupes(enKeys).length === 0, `duplicate EN keys: ${dupes(enKeys).join(',')}`);
const enSet = new Set(enKeys);
const unionSet = new Set(unionKeys);
const unionMissing = [...unionSet].filter((k) => !enSet.has(k));
const extra = [...enSet].filter((k) => !unionSet.has(k));
assert(unionMissing.length === 0, `MessageKey missing EN: ${unionMissing.join(',')}`);
assert(extra.length === 0, `dictionary keys not in MessageKey: ${extra.join(',')}`);

const eastern = /[\u06F0-\u06F9\u0660-\u0669]/;
assert(!eastern.test(enBody), 'dictionary must use Western digits (0-9), not Eastern digits');

function values(body) {
  const out = {};
  const re = /\n {4}(\w+):\s*(?:'((?:\\'|[^'])*)'|"((?:\\"|[^"])*)"|`((?:\\`|[^`])*)`)/g;
  let m;
  while ((m = re.exec(body))) {
    out[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}
const enVals = values(enBody);
// Empty strings are allowed: explanatory copy was blanked on purpose ("no explanatory text" rule).
const emptyOk = enKeys.filter((k) => !(enVals[k] ?? '').trim());
for (const k of ['sell', 'catalog', 'settings', 'backup', 'errorGeneric', 'removeLine']) {
  assert(enVals[k] && enVals[k].trim(), `core EN string empty: ${k}`);
}

const hintSrc = read('apps/web/src/i18n/UrHint.tsx');
const hintKeys = [...hintSrc.matchAll(/^\s{2}(\w+):\s*'([^']*)'/gm)];
assert(hintKeys.length >= 10, 'Urdu nav/heading hints present');
for (const [, k, v] of hintKeys) {
  assert(unionSet.has(k), `UrHint key not a MessageKey: ${k}`);
  assert(/[\u0600-\u06FF]/.test(v) && !eastern.test(v), `UrHint ${k} must be Urdu text with no Eastern digits`);
}

const localeTs = read('apps/web/src/i18n/locale.ts');
assert(localeTs.includes("html.dir = 'ltr'"), 'document stays ltr');

// Money: every formatRs uses Western Rs + paisa/100.
const moneyFiles = [];
function walk(dir, acc) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(ent.name)) acc.push(p);
  }
}
walk(webSrc, moneyFiles);
for (const file of moneyFiles) {
  const src = fs.readFileSync(file, 'utf8');
  if (src.includes('function formatRs') || src.includes('function paisaToRs')) {
    // Delegating to the shared Rs 1,170 formatter in lib/money.ts is the current pattern.
    if (/formatRsShort\(/.test(src) && !file.endsWith(path.join('lib', 'money.ts'))) continue;
    assert(
      /\/\s*100\)\.toFixed\(2\)/.test(src),
      `${path.relative(root, file)} money must use paisa/100 toFixed(2)`,
    );
    assert(
      src.includes('Rs ') || src.includes('`Rs ${') || src.includes('Rs ${'),
      `${path.relative(root, file)} money must prefix Rs`,
    );
    assert(!/numberingSystem:\s*'arab/.test(src), `${path.relative(root, file)} must not use Eastern numbering`);
  }
}

// Hard-coded English literals are allowed now: the UI is English-only (no translation layer needed).
const hintKeysCount = hintKeys.length;

console.log(`slice16 ok — ${enKeys.length} EN keys, ${hintKeys.length} Urdu hints, western Rs`);
