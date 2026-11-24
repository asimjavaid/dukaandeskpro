/**
 * Launch Electron in production mode (built web + built Nest).
 * Does not package a Windows installer — see `pnpm package:win` (Windows only).
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

process.env.DUKAANDESK_PROD = '1';
const electron = require('electron');
const appDir = path.resolve(__dirname, '..');
const child = spawn(electron, [appDir, '--no-sandbox'], {
  cwd: appDir,
  env: process.env,
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 0));
