'use strict';
// Ponte entre o Echo (o site) e o app para computador. A página vê window.echoDesktop.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('echoDesktop', {
  info: () => ipcRenderer.invoke('app:info'),
  // atualização
  checkUpdate: () => ipcRenderer.invoke('upd:check'),
  installUpdate: () => ipcRenderer.invoke('upd:install'),
  onUpdate: (cb) => { ipcRenderer.on('upd:state', (_e, s) => cb(s)); },
  // preferências do app
  getSettings: () => ipcRenderer.invoke('set:get'),
  setSetting: (k, v) => ipcRenderer.invoke('set:set', k, v),
  // compartilhar: o som dos apps chega por uma porta (window.postMessage com {echoDesktop: 'pcm'})
  shareInfo: () => ipcRenderer.invoke('share:info'),
  shareAudio: () => ipcRenderer.send('share:port'),
  stopShare: () => ipcRenderer.send('share:stop'),
  onShareAudioError: (cb) => { ipcRenderer.on('share:audio-error', (_e, m) => cb(m)); },
  // controle remoto (quem transmite)
  askControl: (who) => ipcRenderer.invoke('ctl:ask', who),
  controlInput: (ev) => ipcRenderer.send('ctl:in', ev),
  stopControl: () => ipcRenderer.send('ctl:stop'),
  onControlEnded: (cb) => { ipcRenderer.on('ctl:ended', () => cb()); },
});
ipcRenderer.on('share:port', (e) => { window.postMessage({ echoDesktop: 'pcm' }, '*', e.ports); });
