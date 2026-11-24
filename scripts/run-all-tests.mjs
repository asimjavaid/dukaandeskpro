#!/usr/bin/env node
/**
 * Runs every scripts/test-*.mjs one by one and writes a pass/fail table.
 *   node scripts/run-all-tests.mjs pg      -> against PostgreSQL (DD_DB=pg + test hook)
 *   node scripts/run-all-tests.mjs sqlite  -> legacy SQLite (P1 behaviour), for a baseline
 * Optional: ONLY=slice1,slice3 to filter. Output: test-results-<mode>.json + .md in repo root.
 */
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] === 'sqlite' ? 'sqlite' : 'pg';
const only = (process.env.ONLY || '').split(',').filter(Boolean);
const files = fs.readdirSync(path.join(root, 'scripts')).filter((f) => /^test-.*\.mjs$/.test(f)).filter((f) => !only.length || only.some((o) => f.includes(o))).sort();
const env = { ...process.env };
delete env.DD_DB; delete env.DATABASE_URL;
if (mode === 'pg') { env.DD_DB = 'pg'; env.NODE_OPTIONS = `--require ${path.join(root, 'scripts/lib/pg-test-hook.cjs')}`; }
console.log('building API once…');
spawnSync('pnpm', ['--filter', '@dukaandeskpro/api', 'build'], { cwd: root, stdio: 'inherit', shell: true, env });
env.SKIP_BUILD = '1';
// pg_dump / pg_restore for full database copies (dev box: Debian client 17 extracted to /workspace/pgclient)
if (!env.DD_PG_BIN && fs.existsSync('/workspace/pgclient/root/usr/lib/postgresql/17/bin')) { env.DD_PG_BIN = '/workspace/pgclient/root/usr/lib/postgresql/17/bin'; env.DD_PG_LIB = '/workspace/pgclient/root/usr/lib/x86_64-linux-gnu'; }
if (!env.DD_KEYS_DIR && fs.existsSync('/workspace/dukaandeskpro-testkeys')) env.DD_KEYS_DIR = '/workspace/dukaandeskpro-testkeys';
const results = [];
const outDir = path.join(root, `.test-logs-${mode}`);
fs.mkdirSync(outDir, { recursive: true });
function killStrayApis() {
  // API processes started by a test that crashed before stopping them (only this repo's, by cwd)
  for (const pid of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try {
      const cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (cwd.startsWith(root) && /dist\/main\.js/.test(cmd)) process.kill(Number(pid), 'SIGKILL');
    } catch { /* gone */ }
  }
}
let n = 0;
for (const f of files) {
  const t0 = Date.now();
  env.API_PORT = String(Number(process.env.API_PORT || 4900) + (n++ % 50) * 2);
  killStrayApis();
  const r = await new Promise((resolve) => {
    const ch = spawn('node', [path.join('scripts', f)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    ch.stdout.on('data', (d) => (out += d));
    ch.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => { out += '\nTIMEOUT'; ch.kill('SIGKILL'); }, 240000);
    ch.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
  fs.writeFileSync(path.join(outDir, f.replace(/\.mjs$/, '.log')), r.out);
  const lines = r.out.split('\n').filter((l) => !l.startsWith('[api]') && l.trim());
  const fail = r.code !== 0 || /\bFAIL\b|TIMEOUT/.test(lines.slice(-5).join('\n'));
  const why = fail ? (lines.find((l) => /FAIL|Error:|TIMEOUT/.test(l)) || lines[lines.length - 1] || '').slice(0, 220) : '';
  results.push({ test: f, pass: !fail, secs: Math.round((Date.now() - t0) / 1000), why });
  console.log(`${fail ? 'FAIL' : 'pass'}  ${f}  ${why}`);
}
fs.writeFileSync(path.join(root, `test-results-${mode}.json`), JSON.stringify(results, null, 1));
const md = [`# Test results (${mode}) — ${new Date().toISOString()}`, '', `${results.filter((r) => r.pass).length}/${results.length} pass`, '', '| test | result | note |', '|---|---|---|', ...results.map((r) => `| ${r.test} | ${r.pass ? 'pass' : 'FAIL'} | ${r.why.replace(/\|/g, '/')} |`)].join('\n');
fs.writeFileSync(path.join(root, `test-results-${mode}.md`), md + '\n');
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} pass (${mode})`);
