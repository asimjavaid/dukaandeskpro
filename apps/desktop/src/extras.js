/**
 * Batch 3 desktop extras: weighing scale over Web Serial (no native module)
 * and the customer-facing display window.
 */
const { BrowserWindow, screen, session } = require('electron');
const path = require('path');

/** Let the UI use navigator.serial; picks the saved port, else the first one. */
function setupSerial() {
  const ses = session.defaultSession;
  let wanted = null;
  ses.on('select-serial-port', (event, portList, _wc, callback) => {
    event.preventDefault();
    const hit = (wanted && portList.find((p) => p.portName === wanted || p.portId === wanted)) || portList[0];
    callback(hit ? hit.portId : '');
  });
  // Electron's default (no handler) allows checks; keep that and say yes to serial.
  ses.setPermissionCheckHandler(() => true);
  ses.setDevicePermissionHandler((details) => details.deviceType === 'serial');
  return {
    setWantedPort(name) {
      wanted = name ? String(name) : null;
    },
  };
}

let displayWin = null;

/** Open (or close) the customer display: second screen if there is one. */
function toggleCustomerDisplay(baseUrl, icon) {
  if (displayWin && !displayWin.isDestroyed()) {
    displayWin.close();
    displayWin = null;
    return { open: false };
  }
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const other = displays.find((d) => d.id !== primary.id);
  const area = (other ?? primary).workArea;
  displayWin = new BrowserWindow({
    x: area.x + (other ? 0 : 40),
    y: area.y + (other ? 0 : 40),
    width: other ? area.width : 800,
    height: other ? area.height : 520,
    fullscreen: Boolean(other),
    autoHideMenuBar: true,
    backgroundColor: '#17120e',
    title: 'DukaanDesk Pro — Customer',
    icon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !require('electron').app.isPackaged,
    },
  });
  const u = new URL(baseUrl);
  u.searchParams.set('display', '1');
  displayWin.loadURL(u.toString());
  displayWin.on('closed', () => {
    displayWin = null;
  });
  return { open: true, secondScreen: Boolean(other) };
}

module.exports = { setupSerial, toggleCustomerDisplay };
