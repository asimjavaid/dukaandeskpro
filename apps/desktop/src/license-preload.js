const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ddLicence', {
  status: () => ipcRenderer.invoke('dd:lic-status'),
  activate: (key) => ipcRenderer.invoke('dd:lic-activate', key),
  copy: (text) => ipcRenderer.invoke('dd:lic-copy', text),
});
