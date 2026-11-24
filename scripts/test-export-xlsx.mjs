#!/usr/bin/env node
/**
 * Excel export test: POST /export/xlsx returns a real .xlsx (zip "PK", spreadsheet content type,
 * readable back with the app's own reader); needs a session; rejects bad input.
 * Also checks no web code still downloads a .csv file.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { migrate } = require(path.join(root, 'packages/db/src/migrate.js'));
const { readXlsx } = require(path.join(root, 'apps/api/dist/common/xlsx.js'));
const PORT = Number(process.env.API_PORT ?? 3872);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-xlsx-'));
const dbPath = path.join(tmp, 'db.sqlite');
migrate(dbPath);
let fails = 0;
const check = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) fails++; };
let TOKEN = null;
function req(method, p, body) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {};
    if (TOKEN) { headers.Authorization = `Bearer ${TOKEN}`; headers['x-dd-session'] = TOKEN; }
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers }, (x) => {
      const chunks = []; x.on('data', (c) => chunks.push(c)); x.on('end', () => { const buf = Buffer.concat(chunks); let j = null; try { j = JSON.parse(buf.toString()); } catch {} res({ status: x.statusCode, buf, json: j, headers: x.headers }); });
    });
    r.on('error', rej); if (data) r.write(data); r.end();
  });
}
const child = spawn(process.execPath, [path.join(root, 'apps/api/dist/main.js')], { cwd: path.join(root, 'apps/api'), env: { ...process.env, API_PORT: String(PORT), SQLITE_PATH: dbPath, DD_LICENSE_HOME: path.join(tmp, 'lic') }, stdio: ['ignore', 'ignore', 'inherit'] });
for (let i = 0; i < 120; i++) { try { if ((await req('GET', '/health')).status === 200) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
try {
  const sheets = [{ name: 'Sales by day', rows: [['Date', 'Sales (Rs)', 'Bills'], ['2026-11-01', 1170, 3], ['2026-11-02', 2450.5, 7]] }, { name: 'Notes', rows: [['Shop', 'Kiryana']] }];
  check((await req('POST', '/export/xlsx', { fileName: 'x.xlsx', sheets })).status === 401, 'no session -> 401');
  const st = await req('POST', '/auth/setup', { displayName: 'Owner', pin: '2468', storeName: 'Test' });
  TOKEN = st.json?.sessionToken;
  const r = await req('POST', '/export/xlsx', { fileName: 'Sales report 2 Nov.xlsx', sheets });
  check(r.status === 200, `200 (${r.status})`);
  check(/application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/.test(r.headers['content-type'] || ''), 'spreadsheet content type');
  check(/filename="Sales.report.2.Nov\.xlsx"/.test(r.headers['content-disposition'] || ''), `file name ends .xlsx (${r.headers['content-disposition']})`);
  check(r.buf.subarray(0, 2).toString() === 'PK', 'real xlsx (zip magic PK)');
  const back = readXlsx(r.buf);
  check(back[0]?.[0] === 'Date' && String(back[1]?.[1]) === '1170' && String(back[2]?.[1]) === '2450.5', `reads back, numbers stay numbers (${JSON.stringify(back.slice(0, 3))})`);
  const evil = await req('POST', '/export/xlsx', { fileName: '../../evil.csv', sheets });
  check(/filename="[^"/\\]*\.xlsx"/.test(evil.headers['content-disposition'] || ''), `unsafe file name cleaned, forced .xlsx (${evil.headers['content-disposition']})`);
  check((await req('POST', '/export/xlsx', { fileName: 'a.xlsx', sheets: 'nope' })).status === 400, 'bad sheets -> 400');
  check((await req('POST', '/export/xlsx', { fileName: 'a.xlsx', sheets: [] })).status === 400, 'no sheets -> 400');
  // web code: no CSV downloads left
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.(tsx?|js)$/.test(e.name) ? [path.join(d, e.name)] : []));
  const hits = walk(path.join(root, 'apps/web/src')).flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').map((l, i) => [f, i + 1, l]))
    .filter(([, , l]) => /text\/csv|downloadTextFile|\.csv['"`]|['"`]CSV['"`]/.test(l) && !/accept=|import|parse|upload/i.test(l))
    .map(([f, i, l]) => `${path.relative(root, f)}:${i}: ${l.trim()}`).join('\n');
  check(hits === '', `no CSV export left in the web app${hits ? `:\n${hits}` : ''}`);
} finally {
  child.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(fails ? `\n${fails} FAILED` : '\nAll Excel export checks passed');
process.exit(fails ? 1 : 0);
