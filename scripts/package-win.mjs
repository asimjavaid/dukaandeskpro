#!/usr/bin/env node
/**
 * Windows NSIS + portable installer. OWNER'S PC ONLY (needs the private signing key).
 * Must run on Windows after `pnpm install` (Node ≥ 20).
 *   1. refuses the TEST public key (run `node tools\keygen\keygen.mjs init --force` first)
 *   2. stamps the build date into packages/license/src/build-info.js (updates-until rule)
 *   3. builds web + api, stages the api (pnpm deploy)
 *   4. signs manifests of resources/api and resources/web (integrity check at app start)
 *   5. electron-builder (EULA screen, fuses). DD_SIGN=1 + CSC_LINK/CSC_KEY_PASSWORD = signed exe.
 *   6. puts build-info.js back to BUILD_DATE: null
 * Flags: --dry  (Linux/mac allowed) stamp + manifests on the current dist only, no installer.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const dry = process.argv.includes('--dry');
const BUILD_INFO = path.join(root, 'packages/license/src/build-info.js');

if (process.platform !== 'win32' && !dry) {
  console.error(
    [
      `package:win builds a Windows NSIS + portable installer and must run on Windows (Node ≥ 20).`,
      `This machine is ${process.platform}. A Linux box cannot emit a Windows .exe`,
      `(no Wine; better-sqlite3 is compiled for the host).`,
      `On the owner's PC: pnpm install && pnpm package:win   (see tools/keygen/README.md)`,
      `Use --dry here to check the stamping and manifest steps only.`,
    ].join('\n'),
  );
  process.exit(1);
}

const pub = require(path.join(root, 'packages/license/src/public-key.js'));
if (pub.TEST_ONLY && !dry) {
  console.error('Refusing to build: the app still carries the TEST public key.\nOn YOUR PC run:  node tools\\keygen\\keygen.mjs init --force   then back up %USERPROFILE%\\.dukaandeskprokeys');
  process.exit(1);
}

function run(cmd, args, extraEnv = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true, env: { ...process.env, ...extraEnv } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})`);
}

// Build date in Pakistan time (the shop's calendar day).
const buildDate = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
const original = fs.readFileSync(BUILD_INFO, 'utf8');
try {
  fs.writeFileSync(BUILD_INFO, original.replace(/BUILD_DATE:\s*[^}]*?(\s*})/, `BUILD_DATE: ${JSON.stringify(buildDate)}$1`));
  console.log(`Build date ${buildDate} stamped.`);
  if (!dry) {
    run('pnpm', ['build:desktop']);
    fs.rmSync(path.join(root, 'apps/desktop/staged/api'), { recursive: true, force: true });
    run('pnpm', ['--filter', '@dukaandeskpro/api', 'deploy', 'apps/desktop/staged/api']);
    // Lite: PostgreSQL binaries + WinSW for the main PC choice (pinned SHA-256).
    run('node', ['scripts/fetch-win-runtime.mjs']);
  }
  const apiDir = dry ? path.join(root, 'apps/api') : path.join(root, 'apps/desktop/staged/api');
  run('node', ['tools/keygen/keygen.mjs', 'manifest', '--dir', JSON.stringify(apiDir), '--kind', 'api', '--build-date', buildDate]);
  run('node', ['tools/keygen/keygen.mjs', 'manifest', '--dir', JSON.stringify(path.join(root, 'apps/web/dist')), '--kind', 'web', '--build-date', buildDate]);
  if (!dry) {
    const sign = process.env.DD_SIGN === '1';
    if (sign && !process.env.CSC_LINK) throw new Error('DD_SIGN=1 needs CSC_LINK (path to .pfx) and CSC_KEY_PASSWORD');
    run('pnpm', ['--filter', '@dukaandeskpro/desktop', 'exec', 'electron-builder', '--win', '--config', 'electron-builder.yml',
      ...(sign ? ['-c.win.signAndEditExecutable=true'] : [])]);
    console.log('Installer artifacts: dist-desktop/');
  } else {
    console.log('Dry run done (manifests written next to apps/api and apps/web/dist; delete dd-manifest.json files if not needed).');
  }
} finally {
  fs.writeFileSync(BUILD_INFO, original);
}
