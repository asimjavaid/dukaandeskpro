'use strict';
/**
 * Stable hardware fingerprint → short grouped Machine Code (XXXX-XXXX-XXXX-XXXX).
 * Windows: MachineGuid (registry) + CPU ProcessorId + system disk serial + BIOS UUID.
 * Linux/mac (dev only): /etc/machine-id + cpu model + hostname.
 * Changes after a Windows reinstall or motherboard/disk swap → shop needs a new key.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function windowsSources() {
  const reg = run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid']);
  const guidMatch = reg.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/);
  const ps = run('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    "$c=(Get-CimInstance Win32_Processor | Select-Object -First 1).ProcessorId;" +
      "$b=(Get-CimInstance Win32_ComputerSystemProduct).UUID;" +
      "$p=(Get-Partition -DriveLetter $env:SystemDrive[0] -ErrorAction SilentlyContinue | Get-Disk -ErrorAction SilentlyContinue).SerialNumber;" +
      "Write-Output \"$c|$b|$p\"",
  ]);
  const [cpu = '', bios = '', disk = ''] = ps.split('|');
  return {
    machineGuid: guidMatch ? guidMatch[1].toLowerCase() : '',
    cpu: cpu.trim(),
    bios: bios.trim().toLowerCase(),
    disk: disk.trim(),
  };
}

function posixSources() {
  let mid = '';
  for (const p of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try { mid = fs.readFileSync(p, 'utf8').trim(); if (mid) break; } catch { /* next */ }
  }
  const cpu = (os.cpus()[0] && os.cpus()[0].model) || '';
  return { machineGuid: mid, cpu, bios: '', disk: os.hostname() };
}

function collectSources() {
  return process.platform === 'win32' ? windowsSources() : posixSources();
}

/** Pure: sources → code. Exported for tests. */
function machineCodeFromSources(src) {
  const material = ['dd-mc-v1', src.machineGuid, src.cpu, src.bios, src.disk].map((x) => String(x || '')).join('|');
  const h = crypto.createHash('sha256').update(material).digest();
  let bits = 0, val = 0, out = '';
  for (const byte of h) {
    val = (val << 8) | byte; bits += 8;
    while (bits >= 5 && out.length < 16) { out += ALPHABET[(val >>> (bits - 5)) & 31]; bits -= 5; }
    if (out.length >= 16) break;
  }
  return out.match(/.{4}/g).join('-');
}

let cached = null;
function getMachineCode() {
  if (!cached) {
    const src = collectSources();
    if (!src.machineGuid && !src.cpu && !src.disk) throw new Error('machine_fingerprint_unavailable');
    cached = machineCodeFromSources(src);
  }
  return cached;
}

module.exports = { getMachineCode, machineCodeFromSources, collectSources };
