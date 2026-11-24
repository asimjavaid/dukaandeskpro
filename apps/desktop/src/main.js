/**
 * DukaanDesk Pro Electron main process.
 * - Dev (unpackaged, DUKAANDESK_PROD unset): Vite URL + Nest via pnpm or existing dist
 * - Production (DUKAANDESK_PROD=1 or packaged): built apps/web/dist + Nest dist/main.js
 *   against local SQLite. Packaged sidecar uses the Electron binary as Node.
 */
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { setupSerial, toggleCustomerDisplay } = require('./extras');
const path = require('node:path');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const { productionLayout, uiUsesBuiltWeb } = require('./prod-paths');
const { startTillLink } = require('./till-link');
const { serverEnv } = require('./server-config');
const { kickDrawer } = require('./drawer');
const { checkLicence, checkIntegrity } = require('./license-gate');

const API_PORT = Number(process.env.API_PORT ?? 3847);
const WEB_DEV_URL = process.env.WEB_DEV_URL ?? 'http://127.0.0.1:5173';
const WEB_PROD_PORT = Number(process.env.WEB_PROD_PORT ?? 4173);
/**
 * Till-only PC (Lite): no database/API here; the UI talks to the main PC through till-link.
 * Set by the till-only installer (till-only.flag next to the exe) or DD_TILL_ONLY=1.
 */
const tillOnly =
  process.env.DD_TILL_ONLY === '1' || fs.existsSync(path.join(path.dirname(process.execPath), 'till-only.flag'));
const useBuiltWeb = tillOnly || uiUsesBuiltWeb(process.env, app.isPackaged);

let apiChild = null;
let webServer = null;
let mainWindow = null;
/** Packaged only: result of the signed-manifest check of the server + web files. */
let integrity = { ok: true };

function sqlitePath() {
  if (process.env.SQLITE_PATH) return process.env.SQLITE_PATH;
  return path.join(app.getPath('userData'), 'dukaandesk.sqlite');
}

function layout() {
  return productionLayout({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    mainDir: __dirname,
  });
}

function apiHealthUrl() {
  return `http://127.0.0.1:${API_PORT}/health`;
}

function checkHealth(timeoutMs = 800) {
  return new Promise((resolve) => {
    const req = http.get(apiHealthUrl(), (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function resolveApiEntry() {
  const built = layout();
  if (useBuiltWeb || app.isPackaged) {
    if (!fs.existsSync(built.apiEntry)) {
      throw new Error(
        `Built API missing: ${built.apiEntry} (run pnpm build:desktop)`,
      );
    }
    return {
      cmd: app.isPackaged ? process.execPath : 'node',
      args: [built.apiEntry],
      cwd: built.apiCwd,
      kind: 'node-dist',
      electronAsNode: app.isPackaged,
    };
  }
  const repoRoot = path.resolve(__dirname, '../../..');
  return {
    cmd: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    args: ['--filter', '@dukaandeskpro/api', 'start:dev'],
    cwd: repoRoot,
    kind: 'pnpm-dev',
    electronAsNode: false,
  };
}

function getJson(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let s = '';
      res.on('data', (c) => (s += c));
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(null); });
  });
}

async function ensureApi() {
  if (await checkHealth()) {
    console.log('[desktop] Nest already healthy on', API_PORT);
    if (app.isPackaged) {
      // A server we did not start (e.g. an unlicensed copy) must not stand in for ours.
      const st = await getJson(`http://127.0.0.1:${API_PORT}/license/status`);
      if (!st || st.machineCode === 'DEV') {
        dialog.showErrorBox('DukaanDesk Pro', `Another program is using port ${API_PORT}. Close it (or restart the computer) and open DukaanDesk Pro again.`);
        app.exit(1);
      }
    }
    return;
  }

  // Lite main PC install: the API runs as the Windows service DukaanDeskProServer (so tills keep
  // working with this window closed). Wait for it instead of starting a second copy.
  if (app.isPackaged && fs.existsSync(path.join(path.dirname(process.execPath), 'main-pc.flag'))) {
    const until = Date.now() + 60_000;
    while (Date.now() < until) {
      if (await checkHealth()) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    dialog.showErrorBox('DukaanDesk Pro', 'The DukaanDesk Pro server is not running on this PC. Restart the computer. If it still does not start, reinstall DukaanDesk Pro.');
    return;
  }

  const entry = resolveApiEntry();
  const webOrigin = useBuiltWeb
    ? `http://127.0.0.1:${WEB_PROD_PORT}`
    : WEB_DEV_URL;
  const env = {
    ...process.env,
    API_PORT: String(API_PORT),
    SQLITE_PATH: sqlitePath(),
    WEB_ORIGIN: webOrigin,
    // Lite main PC: database, LAN, install mode, backups, licence home (installer's server.json).
    ...serverEnv(),
  };
  if (entry.electronAsNode) env.ELECTRON_RUN_AS_NODE = '1';
  // Licence is enforced only in the packaged app; dev / watch copies stay licensed.
  if (app.isPackaged) {
    env.DD_LICENSE_ENFORCE = '1';
    env.DD_LICENSE_PACKAGED = '1';
    delete env.DD_LICENSE_TEST_DAYS;
    delete env.DD_LICENSE_TEST_USAGE_MIN;
    if (!integrity.ok) env.DD_INTEGRITY_FAIL = '1';
    else delete env.DD_INTEGRITY_FAIL;
  }
  else delete env.DD_LICENSE_ENFORCE;

  console.log(
    '[desktop] Starting Nest sidecar:',
    entry.kind,
    'SQLITE_PATH=',
    env.SQLITE_PATH,
  );
  apiChild = spawn(entry.cmd, entry.args, {
    cwd: entry.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32' && entry.kind === 'pnpm-dev',
  });
  apiChild.stdout?.on('data', (d) => process.stdout.write(`[api] ${d}`));
  apiChild.stderr?.on('data', (d) => process.stderr.write(`[api] ${d}`));
  apiChild.on('exit', (code) => {
    console.log('[desktop] API exited', code);
    apiChild = null;
  });

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await checkHealth(500)) {
      console.log('[desktop] Nest healthy');
      return;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('Nest sidecar failed to become healthy within 60s');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/** Built UI: only its own origin (the local API is proxied through it), no inline scripts. */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

/**
 * Serves apps/web/dist and proxies every other path to the Nest sidecar
 * so the UI keeps relative fetches (`/auth`, `/backup`, …) on one origin.
 */
function startBuiltWebServer(webDir) {
  const root = path.resolve(webDir);
  const server = http.createServer((req, res) => {
    const host = req.headers.host ?? `127.0.0.1:${WEB_PROD_PORT}`;
    let pathname = '/';
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', `http://${host}`).pathname);
    } catch {
      pathname = '/';
    }
    const rel = pathname.replace(/^\/+/, '');
    const filePath = path.resolve(root, rel);
    const inside = filePath === root || filePath.startsWith(root + path.sep);
    if (inside && rel && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      res.setHeader('Content-Type', MIME[path.extname(filePath)] ?? 'application/octet-stream');
      if (path.extname(filePath) === '.html') res.setHeader('Content-Security-Policy', CSP);
      fs.createReadStream(filePath).pipe(res);
      return;
    }
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      const indexHtml = path.join(root, 'index.html');
      res.setHeader('Content-Type', MIME['.html']);
      res.setHeader('Content-Security-Policy', CSP);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      fs.createReadStream(indexHtml).pipe(res);
      return;
    }
    const headers = { ...req.headers, host: `127.0.0.1:${API_PORT}` };
    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port: API_PORT,
        path: req.url,
        method: req.method,
        headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on('error', () => {
      if (!res.headersSent) res.statusCode = 502;
      res.end('api unavailable');
    });
    req.pipe(proxyReq);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(WEB_PROD_PORT, '127.0.0.1', () => resolve(server));
  });
}

const MIN_W = 1200;
const MIN_H = 700;

function boundsFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

/** Last window position/size; null when missing, unreadable or off every screen. */
function loadWindowState() {
  try {
    const st = JSON.parse(fs.readFileSync(boundsFile(), 'utf8'));
    const ok = (n) => Number.isFinite(n);
    if (!st || !ok(st.x) || !ok(st.y) || !ok(st.width) || !ok(st.height)) return null;
    const { screen } = require('electron');
    const onScreen = screen.getAllDisplays().some(({ workArea: a }) =>
      st.x < a.x + a.width - 100 && st.x + st.width > a.x + 100 && st.y >= a.y - 20 && st.y < a.y + a.height - 100,
    );
    if (!onScreen) return null;
    return {
      x: Math.round(st.x),
      y: Math.round(st.y),
      width: Math.max(MIN_W, Math.round(st.width)),
      height: Math.max(MIN_H, Math.round(st.height)),
      maximized: st.maximized !== false,
    };
  } catch {
    return null;
  }
}

function saveWindowState(win) {
  try {
    if (!win || win.isDestroyed()) return;
    const b = win.isMaximized() || win.isFullScreen() ? win.getNormalBounds() : win.getBounds();
    fs.writeFileSync(boundsFile(), JSON.stringify({ ...b, maximized: win.isMaximized() || win.isFullScreen() }));
  } catch (err) {
    console.error('[desktop] window state not saved:', err);
  }
}

function createWindow() {
  const saved = loadWindowState();
  mainWindow = new BrowserWindow({
    width: saved?.width ?? 1366,
    height: saved?.height ?? 768,
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    minWidth: MIN_W,
    minHeight: MIN_H,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#faf6f1',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
    title: 'DukaanDesk Pro',
    icon: path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
  });

  const win = mainWindow;
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => {
    // First run (no saved state) and last-closed-maximised both open maximised.
    if (!saved || saved.maximized) win.maximize();
    win.show();
  });

  // F11 toggles full screen (Esc does not, so it never fights the app's own Esc handling).
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11' && !input.control && !input.alt && !input.meta) {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });

  let saveTimer = null;
  const queueSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(win), 400);
  };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) win.on(ev, queueSave);
  win.on('close', () => {
    clearTimeout(saveTimer);
    saveWindowState(win);
  });

  if (useBuiltWeb) {
    const indexHtml = layout().webIndex;
    console.log('[desktop] production UI', indexHtml);
    win.loadURL(`http://127.0.0.1:${WEB_PROD_PORT}/`);
  } else {
    win.loadURL(WEB_DEV_URL);
  }

  win.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('dd:save-text', async (_event, payload) => {
  const defaultName =
    payload && typeof payload.defaultName === 'string'
      ? payload.defaultName
      : 'dukaandesk-backup.json';
  const text = payload && typeof payload.text === 'string' ? payload.text : '';
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save a copy',
    defaultPath: defaultName,
    filters: [{ name: 'DukaanDesk Pro copy', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { saved: false };
  fs.writeFileSync(filePath, text, 'utf8');
  return { saved: true, filePath };
});

/** Khata reminder: WhatsApp Desktop if installed, else the wa.me page. No server. */
ipcMain.handle('dd:open-whatsapp', async (_event, payload) => {
  const phone = String(payload?.phone ?? '').replace(/\D/g, '').slice(0, 15);
  const text = String(payload?.text ?? '').slice(0, 2000);
  if (phone.length < 10) return { ok: false, reason: 'bad_phone' };
  const q = `phone=${phone}&text=${encodeURIComponent(text)}`;
  try {
    await shell.openExternal(`whatsapp://send?${q}`);
    return { ok: true, via: 'app' };
  } catch {
    await shell.openExternal(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`);
    return { ok: true, via: 'web' };
  }
});

let serial = null;
ipcMain.handle('dd:scale-port', async (_event, payload) => {
  serial?.setWantedPort(payload?.portName ?? null);
  return { ok: true };
});
ipcMain.handle('dd:customer-display', async () => {
  const base = useBuiltWeb ? `http://127.0.0.1:${WEB_PROD_PORT}/` : WEB_DEV_URL;
  const icon = path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  return { ok: true, ...toggleCustomerDisplay(base, icon) };
});

ipcMain.handle('dd:kick-drawer', async (_event, payload) => {
  const name = payload && typeof payload.printerName === 'string' ? payload.printerName : '';
  return kickDrawer(name);
});

ipcMain.handle('dd:pick-folder', async (_event, payload) => {
  const r = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: 'Backup folder',
    defaultPath: payload && payload.current ? String(payload.current) : undefined,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  return { ok: true, path: r.filePaths[0] };
});

ipcMain.handle('dd:print-receipt', async (_event, payload) => {
  const html =
    payload && typeof payload.html === 'string' ? payload.html : '';
  if (!html.trim()) {
    return { ok: false, reason: 'empty_html' };
  }
  const deviceName =
    payload && typeof payload.deviceName === 'string'
      ? payload.deviceName.trim()
      : '';
  const silent = Boolean(payload && payload.silent && deviceName);

  const printWin = new BrowserWindow({
    show: false,
    width: 400,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    await printWin.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    );
    // Let layout settle before print
    await new Promise((r) => setTimeout(r, 120));

    const result = await new Promise((resolve) => {
      const options = {
        silent,
        printBackground: false,
        margins: { marginType: 'none' },
      };
      if (deviceName) options.deviceName = deviceName;
      printWin.webContents.print(options, (success, failureReason) => {
        resolve({
          ok: Boolean(success),
          reason: success ? null : String(failureReason || 'print_failed'),
        });
      });
    });
    return result;
  } catch (err) {
    return {
      ok: false,
      reason: err && err.message ? String(err.message) : 'print_failed',
    };
  } finally {
    if (!printWin.isDestroyed()) printWin.destroy();
  }
});

function shutdownApi() {
  if (apiChild && !apiChild.killed) {
    apiChild.kill('SIGTERM');
    apiChild = null;
  }
  if (webServer) {
    webServer.close();
    webServer = null;
  }
}

// Hardening for every window: no new windows / navigation away from the app, no devtools when packaged.
app.on('web-contents-created', (_e, wc) => {
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (ev, url) => {
    const ok = url.startsWith(`http://127.0.0.1:${WEB_PROD_PORT}/`) || url.startsWith(WEB_DEV_URL) || url.startsWith('data:') || url.startsWith('file:');
    if (!ok) ev.preventDefault();
  });
  wc.on('will-attach-webview', (ev) => ev.preventDefault());
  if (app.isPackaged) wc.on('devtools-opened', () => wc.closeDevTools());
});

app.whenReady().then(async () => {
  // Licence: a finished trial no longer blocks start-up. The app opens READ-ONLY
  // (the API refuses changes; the web shows the banner + Activate). Activation is done
  // in-app through the API, so no restart is needed.
  if (app.isPackaged) {
    // Signed manifest (written at build time) vs the files on disk. Changed -> read-only + message.
    integrity = checkIntegrity(layout());
    if (!integrity.ok) {
      console.error('[desktop] integrity check failed:', integrity.reason, (integrity.bad || []).slice(0, 5));
      dialog.showMessageBoxSync({
        type: 'warning',
        title: 'DukaanDesk Pro',
        message: 'Some DukaanDesk Pro program files were changed or damaged.',
        detail: 'DukaanDesk Pro will open read-only. Your shop data is safe. Reinstall DukaanDesk Pro from the original installer to fix this.',
        buttons: ['OK'],
      });
    }
    const lic = checkLicence();
    if (lic.locked) console.log('[desktop] licence:', lic.state, '-> read-only mode');
  }
  serial = setupSerial();
  if (tillOnly) {
    try {
      webServer = await startTillLink({
        webDir: layout().webDir,
        port: WEB_PROD_PORT,
        configFile: path.join(app.getPath('userData'), 'till.json'),
        csp: CSP,
      });
      console.log('[desktop] till-only PC, UI on', WEB_PROD_PORT);
    } catch (err) {
      console.error('[desktop] till start failed:', err);
    }
    createWindow();
    return;
  }
  try {
    await ensureApi();
    if (useBuiltWeb) {
      const webDir = layout().webDir;
      if (!fs.existsSync(path.join(webDir, 'index.html'))) {
        throw new Error(`Built web missing: ${webDir} (run pnpm build:desktop)`);
      }
      webServer = await startBuiltWebServer(webDir);
      console.log('[desktop] built web on', WEB_PROD_PORT);
    }
  } catch (err) {
    console.error('[desktop] start failed:', err);
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    shutdownApi();
    app.quit();
  }
});

app.on('before-quit', () => {
  shutdownApi();
});
