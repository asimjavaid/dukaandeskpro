/**
 * Preload — minimal bridge. UI talks to Nest over HTTP.
 * saveTextFile opens the OS save dialog (backup export). Absent in the browser.
 * printReceipt silent-prints HTML to a named thermal printer when possible.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dukaandesk', {
  platform: process.platform,
  shell: 'electron',
  saveTextFile: (defaultName, text) =>
    ipcRenderer.invoke('dd:save-text', { defaultName, text }),
  printReceipt: (payload) => ipcRenderer.invoke('dd:print-receipt', payload),
  pickFolder: (current) => ipcRenderer.invoke('dd:pick-folder', { current }),
  kickDrawer: (printerName) => ipcRenderer.invoke('dd:kick-drawer', { printerName }),
  setScalePort: (portName) => ipcRenderer.invoke('dd:scale-port', { portName }),
  toggleCustomerDisplay: () => ipcRenderer.invoke('dd:customer-display'),
  openWhatsApp: (phone, text) => ipcRenderer.invoke('dd:open-whatsapp', { phone, text }),
});
