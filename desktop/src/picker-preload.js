'use strict';
// Ponte mínima entre a janela de escolher e o app: listar telas/janelas, escolher, cancelar.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('echo', {
  sources: () => ipcRenderer.invoke('picker:sources'),
  platform: () => ipcRenderer.invoke('picker:platform'),
  apps: () => ipcRenderer.invoke('picker:apps'),
  choose: (id, audio, preset) => ipcRenderer.send('picker:choose', { id, audio, preset }),
  cancel: () => ipcRenderer.send('picker:cancel'),
});
