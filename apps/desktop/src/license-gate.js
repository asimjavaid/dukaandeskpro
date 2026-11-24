/**
 * Electron-main licence check. Trial over / clock set back no longer stops the app:
 * it opens read-only (enforced by the API guard; the web shows the banner + Activate).
 * showActivationWindow is kept as a stand-alone fallback (e.g. if the API cannot start).
 */
const { BrowserWindow, ipcMain, clipboard } = require('electron');
const path = require('node:path');
const lic = require('@dukaandeskpro/license');

function checkLicence(newKey) {
  try {
    return lic.checkThisMachine({ newKey });
  } catch (e) {
    return { state: 'expired', locked: true, machineCode: 'UNAVAILABLE', daysLeft: 0, activationError: String(e && e.message) };
  }
}

/**
 * Packaged app: verify the signed build manifests of the server (resources/api) and the UI
 * (resources/web) against the embedded public key. Missing or changed -> { ok:false }.
 * @param {{ apiCwd: string, webDir: string }} layout
 */
function checkIntegrity(layout) {
  try {
    const pub = lic.publicKeyPem();
    for (const dir of [layout.apiCwd, layout.webDir]) {
      const r = lic.verifyManifest(dir, pub);
      if (!r.ok) return { ...r, dir };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e && e.message) };
  }
}

/** @param {{ onActivated: () => void }} opts */
function showActivationWindow(opts) {
  const win = new BrowserWindow({
    width: 620,
    height: 640,
    resizable: false,
    backgroundColor: '#faf6f1',
    title: 'DukaanDesk Pro · Activation',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'license-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  ipcMain.removeHandler('dd:lic-status');
  ipcMain.removeHandler('dd:lic-activate');
  ipcMain.removeHandler('dd:lic-copy');
  ipcMain.handle('dd:lic-status', () => checkLicence());
  ipcMain.handle('dd:lic-copy', (_e, text) => { clipboard.writeText(String(text || '')); return true; });
  ipcMain.handle('dd:lic-activate', (_e, key) => {
    const s = checkLicence(typeof key === 'string' ? key.slice(0, 4000) : '');
    if (s.state === 'licensed') setTimeout(() => opts.onActivated(), 1200);
    return s;
  });
  win.loadFile(path.join(__dirname, 'activation.html'));
  return win;
}

module.exports = { checkLicence, checkIntegrity, showActivationWindow };
