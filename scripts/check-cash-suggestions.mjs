#!/usr/bin/env node
/**
 * Quick check for apps/web/src/features/pos/cashSuggestions.ts (Sell quick amounts).
 * Run: node scripts/check-cash-suggestions.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'apps/web/package.json'));
const esbuild = require('esbuild');
const src = path.join(root, 'apps/web/src/features/pos/cashSuggestions.ts');
const out = path.join(os.tmpdir(), `cashSuggestions-${process.pid}.mjs`);
esbuild.buildSync({ entryPoints: [src], outfile: out, format: 'esm', platform: 'node', bundle: true, logLevel: 'error' });
const { suggestCashAmounts } = await import(pathToFileURL(out).href);
fs.unlinkSync(out);

const label = (s) => (s.kind === 'exact' ? 'Exact' : `Rs ${(s.paisa / 100).toLocaleString('en-US')}`);
const show = (rs, allowPartial) => suggestCashAmounts(rs * 100, { allowPartial }).map(label);

const cases = [
  // [total Rs, allowPartial, expected]
  [1480, false, ['Exact', 'Rs 1,500', 'Rs 2,000', 'Rs 5,000']],
  [690, false, ['Exact', 'Rs 700', 'Rs 1,000', 'Rs 5,000']],
  [5200, false, ['Exact', 'Rs 5,500', 'Rs 6,000', 'Rs 10,000']],
  [1480, true, ['Rs 0', 'Rs 500', 'Rs 1,000', 'Exact', 'Rs 1,500', 'Rs 2,000', 'Rs 5,000']],
];
for (const [rs, partial, want] of cases) {
  const got = show(rs, partial);
  assert.deepEqual(got, want, `${rs} ${partial ? 'customer' : 'walk-in'}: ${got.join(', ')}`);
  console.log(`ok  ${String(rs).padStart(6)} ${partial ? 'customer' : 'walk-in '} → ${got.join(', ')}`);
}

// Invariants over a range of totals (incl. paisa).
for (let p = 1; p <= 2_000_000; p += 997) {
  for (const allowPartial of [false, true]) {
    const s = suggestCashAmounts(p, { allowPartial });
    assert.ok(s.length <= 7, `≤7 buttons at ${p}`);
    const exactIdx = s.findIndex((x) => x.kind === 'exact');
    assert.equal(s[exactIdx].paisa, p);
    assert.ok(s.slice(exactIdx + 1).every((x) => x.paisa > p), `above > total at ${p}`);
    assert.ok(s.slice(0, exactIdx).every((x) => x.paisa < p), `below < total at ${p}`);
    const vals = s.map((x) => x.paisa);
    assert.deepEqual(vals, [...vals].sort((a, b) => a - b), `ascending at ${p}`);
    assert.equal(new Set(vals).size, vals.length, `deduped at ${p}`);
    if (!allowPartial) assert.equal(exactIdx, 0, `walk-in has no partials at ${p}`);
    else assert.equal(s[0].kind, 'zero', `customer starts with Rs 0 at ${p}`);
  }
}
// More samples for the report.
for (const rs of [35, 120, 450, 960, 1500, 2345, 23450]) {
  console.log(`    ${String(rs).padStart(6)} walk-in  → ${show(rs, false).join(', ')}`);
  console.log(`    ${String(rs).padStart(6)} customer → ${show(rs, true).join(', ')}`);
}
console.log('cash suggestions: all checks passed');
