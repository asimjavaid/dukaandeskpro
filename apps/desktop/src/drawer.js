/**
 * Cash drawer kick: send the ESC/POS pulse (ESC p 0 25 250) as raw bytes to the
 * receipt printer the drawer is plugged into. Windows only (winspool RAW job).
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PS_SCRIPT = String.raw`
param([string]$Printer)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class DdRaw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool OpenPrinter(string name, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool StartDocPrinter(IntPtr h, int level, DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);
  public static bool Send(string printer, byte[] bytes) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return false;
    var di = new DOCINFO { pDocName = "DukaanDesk drawer", pDataType = "RAW" };
    bool ok = false;
    if (StartDocPrinter(h, 1, di)) {
      if (StartPagePrinter(h)) { int w; ok = WritePrinter(h, bytes, bytes.Length, out w); EndPagePrinter(h); }
      EndDocPrinter(h);
    }
    ClosePrinter(h);
    return ok;
  }
}
"@
if (-not $Printer) {
  $Printer = (Get-CimInstance -ClassName Win32_Printer | Where-Object { $_.Default }).Name
}
if (-not $Printer) { Write-Output 'no_printer'; exit 2 }
$bytes = [byte[]](0x1B, 0x70, 0x00, 0x19, 0xFA)
if ([DdRaw]::Send($Printer, $bytes)) { Write-Output 'ok'; exit 0 } else { Write-Output 'send_failed'; exit 1 }
`;

let scriptPath = null;

function ensureScript() {
  if (scriptPath && fs.existsSync(scriptPath)) return scriptPath;
  scriptPath = path.join(os.tmpdir(), 'dukaandesk-drawer.ps1');
  fs.writeFileSync(scriptPath, PS_SCRIPT, 'utf8');
  return scriptPath;
}

function kickDrawer(printerName) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ ok: false, reason: 'not_windows' });
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ensureScript()];
    const name = typeof printerName === 'string' ? printerName.trim() : '';
    if (name) args.push('-Printer', name);
    const child = spawn('powershell.exe', args, { windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += String(d)));
    const timer = setTimeout(() => child.kill(), 15000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, reason: code === 0 ? null : out.trim() || 'kick_failed' });
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ ok: false, reason: 'powershell_missing' });
    });
  });
}

module.exports = { kickDrawer, PS_SCRIPT };
