'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dlg', {
  data: () => ipcRenderer.invoke('dlg:data'),
  answer: (v) => ipcRenderer.send('dlg:answer', v),
  stop: () => ipcRenderer.send('dlg:stop'),
});
