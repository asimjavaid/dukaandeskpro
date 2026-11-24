#!/usr/bin/env node
/**
 * Slice 17 — install / packaging smoke (headless).
 * - pnpm build:desktop produces apps/web/dist + apps/api/dist
 * - Electron production layout points at those artifacts (not the Vite dev URL)
 * - electron-builder.yml has a Windows NSIS + portable target
 * - pnpm package:win exists; on non-Windows it refuses (no .exe from Linux)
 * - RUN-WINDOWS.md documents package:win and does not claim builder is unconfigured
 *
 * Run: node scripts/test-slice17-packaging.mjs
 * Or:  pnpm test:slice17
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

console.log('slice17: building web + api (pnpm build:desktop)…');
const build = spawnSync('pnpm', ['build:desktop'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: process.env,
});
assert(build.status === 0, `pnpm build:desktop failed (${build.status})`);

const webIndex = path.join(root, 'apps/web/dist/index.html');
const apiEntry = path.join(root, 'apps/api/dist/main.js');
assert(fs.existsSync(webIndex), `missing ${webIndex}`);
assert(fs.existsSync(apiEntry), `missing ${apiEntry}`);

const { productionLayout, uiUsesBuiltWeb } = require(
  path.join(root, 'apps/desktop/src/prod-paths.js'),
);
const mainDir = path.join(root, 'apps/desktop/src');
const layout = productionLayout({ isPackaged: false, mainDir });
assert(layout.webIndex === webIndex, `webIndex mismatch: ${layout.webIndex}`);
assert(layout.apiEntry === apiEntry, `apiEntry mismatch: ${layout.apiEntry}`);
assert(fs.existsSync(layout.webIndex), 'layout web index missing');
assert(fs.existsSync(layout.apiEntry), 'layout api entry missing');
assert(uiUsesBuiltWeb({ DUKAANDESK_PROD: '1' }, false) === true, 'PROD flag');
assert(uiUsesBuiltWeb({ DUKAANDESK_DEV: '1' }, true) === false, 'DEV overrides package');
assert(uiUsesBuiltWeb({}, true) === true, 'packaged uses built web');
assert(uiUsesBuiltWeb({}, false) === false, 'unpackaged dev stays on Vite');

const packaged = productionLayout({
  isPackaged: true,
  resourcesPath: path.join(root, 'resources-example'),
  mainDir,
});
assert(
  packaged.webIndex.endsWith(`${path.sep}web${path.sep}index.html`),
  packaged.webIndex,
);
assert(
  packaged.apiEntry.endsWith(`${path.sep}api${path.sep}dist${path.sep}main.js`),
  packaged.apiEntry,
);

const mainJs = read('apps/desktop/src/main.js');
assert(mainJs.includes('productionLayout'), 'main.js must use productionLayout');
assert(mainJs.includes('uiUsesBuiltWeb'), 'main.js must use uiUsesBuiltWeb');
assert(mainJs.includes('startBuiltWebServer'), 'production must serve built web');
assert(
  mainJs.includes('dist/main.js') || mainJs.includes('apiEntry'),
  'main.js must spawn built Nest entry',
);
assert(mainJs.includes('showSaveDialog'), 'backup save dialog in main');
assert(!/electron-builder is not configured/.test(mainJs), 'stale builder note');

const yml = read('apps/desktop/electron-builder.yml');
assert(/^\s*target:/m.test(yml) || yml.includes('nsis'), 'win target missing');
assert(yml.includes('nsis'), 'NSIS target missing');
assert(yml.includes('portable'), 'portable target missing');
assert(/signAndEditExecutable:\s*false/.test(yml), 'must not require code signing');
assert(!/publish:/.test(yml) && !/auto.?update/i.test(yml), 'no auto-update channel');

const rootPkg = JSON.parse(read('package.json'));
assert(rootPkg.scripts['build:desktop'], 'missing build:desktop');
assert(rootPkg.scripts['package:win'], 'missing package:win');
assert(rootPkg.scripts['start:prod'], 'missing start:prod');
assert(rootPkg.scripts['test:slice17'], 'missing test:slice17');
const deskPkg = JSON.parse(read('apps/desktop/package.json'));
assert(deskPkg.devDependencies['electron-builder'], 'electron-builder not a desktop devDependency');
assert(deskPkg.scripts['start:prod'], 'desktop start:prod missing');
assert(deskPkg.scripts['package:win']?.includes('electron-builder'), 'desktop package:win');

const runWin = read('RUN-WINDOWS.md');
assert(runWin.includes('package:win'), 'RUN-WINDOWS.md must mention package:win');
assert(runWin.includes('pnpm build:desktop') || runWin.includes('build:desktop'), 'docs must mention production build');
assert(
  !/electron-builder is not configured/i.test(runWin),
  'RUN-WINDOWS.md still says electron-builder is not configured',
);
assert(/Node/i.test(runWin) && /20/.test(runWin), 'Node 20 note');
assert(!/auto-update channel/i.test(runWin) || /no auto-update/i.test(runWin), 'auto-update must stay out');

const backup = read('apps/web/src/features/backup/BackupShell.tsx');
assert(backup.includes('saveTextFile'), 'BackupShell should offer Electron save dialog');
assert(backup.includes('createObjectURL'), 'browser download fallback must remain');
assert(backup.includes('/backup/restore'), 'restore must stay');

if (process.platform !== 'win32') {
  const refused = spawnSync('node', ['scripts/package-win.mjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert(refused.status === 1, `package:win on ${process.platform} should exit 1`);
  const msg = `${refused.stdout ?? ''}\n${refused.stderr ?? ''}`;
  assert(/Windows/i.test(msg), `expected Windows refusal, got: ${msg}`);
  assert(/cannot emit|no Wine|host-native/i.test(msg), msg);
}

console.log('slice17 ok — production web+api artifacts, builder win target, RUN-WINDOWS aligned');
