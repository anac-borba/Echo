'use strict';
// Echo para computador (Electron): uma janela com o Echo de sempre (o site), mais o que o navegador não deixa:
//  - escolher a tela ou a janela numa janela do próprio Echo (não a do navegador);
//  - levar o som do computador junto na transmissão (no Windows funciona; no Mac depende da versão do sistema).
// O site é o mesmo publicado na Cloudflare: o app atualiza sozinho quando você publica uma versão nova.
const { app, BrowserWindow, session, desktopCapturer, ipcMain, shell, Menu, nativeTheme } = require('electron');
const path = require('path');

const ECHO = 'https://telinha.echo-ac-2k4.workers.dev';
const ORIGIN = new URL(ECHO).origin;
const isMac = process.platform === 'darwin';

nativeTheme.themeSource = 'dark';
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1240, height: 820, minWidth: 900, minHeight: 600,
    backgroundColor: '#0E0E10', title: 'Echo', show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: true, backgroundThrottling: false },
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL(ECHO);

  // links de fora (YouTube, sites mandados no chat) abrem no navegador; o Echo fica no app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (safeUrl(url) && new URL(url).origin !== ORIGIN) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (new URL(url).origin !== ORIGIN) { e.preventDefault(); if (safeUrl(url)) shell.openExternal(url); }
  });
  win.on('closed', () => { win = null; });
}

const safeUrl = (u) => { try { return ['https:', 'http:', 'mailto:'].includes(new URL(u).protocol); } catch { return false; } };

/* ── permissões: só o Echo, e só o que ele usa ── */
function setupPermissions() {
  const ok = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'display-capture', 'fullscreen', 'speaker-selection']);
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => {
    const from = details && details.requestingUrl ? safeOrigin(details.requestingUrl) : safeOrigin(wc.getURL());
    cb(from === ORIGIN && ok.has(perm));
  });
  session.defaultSession.setPermissionCheckHandler((wc, perm, origin) => safeOrigin(origin) === ORIGIN && ok.has(perm));
}
const safeOrigin = (u) => { try { return new URL(u).origin; } catch { return ''; } };

/* ── compartilhar tela: a janela de escolher é do Echo ── */
let picking = null;
function setupScreenShare() {
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (safeOrigin(request.securityOrigin || request.frame?.url || '') !== ORIGIN) { callback({}); return; }
    if (picking) { callback({}); return; }
    try {
      const choice = await openPicker();
      if (!choice) { callback({}); return; }
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const src = sources.find((s) => s.id === choice.id);
      if (!src) { callback({}); return; }
      // som do computador: "loopback" (Windows; no Mac só nas versões novas do sistema)
      callback(choice.audio && request.audioRequested !== false ? { video: src, audio: 'loopback' } : { video: src });
    } catch (e) {
      console.error('compartilhar', e);
      callback({});
    }
  }, { useSystemPicker: false });
}

function openPicker() {
  return new Promise((resolve) => {
    const p = new BrowserWindow({
      parent: win || undefined, modal: !!win, width: 880, height: 640, resizable: false, minimizable: false, maximizable: false,
      backgroundColor: '#16161A', title: 'Compartilhar tela', show: false,
      webPreferences: { preload: path.join(__dirname, 'picker-preload.js'), contextIsolation: true, sandbox: true },
    });
    picking = { win: p, done: false };
    const finish = (v) => { if (!picking || picking.done) return; picking.done = true; picking = null; resolve(v); if (!p.isDestroyed()) p.close(); };
    p.on('closed', () => finish(null));
    p.once('ready-to-show', () => p.show());
    p.loadFile(path.join(__dirname, 'picker.html'));
    pickerDone = finish;
  });
}
let pickerDone = null;

ipcMain.handle('picker:sources', async (e) => {
  if (!picking || e.sender !== picking.win.webContents) return [];
  const list = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 400, height: 250 }, fetchWindowIcons: true });
  return list
    .filter((s) => !/^Echo$/.test(s.name) || s.id.startsWith('screen:'))   // não oferece a própria janela do Echo
    .map((s) => ({ id: s.id, name: s.name, kind: s.id.startsWith('screen:') ? 'screen' : 'window', thumb: s.thumbnail.toDataURL(), icon: s.appIcon ? s.appIcon.toDataURL() : null }));
});
ipcMain.on('picker:choose', (e, v) => {
  if (!picking || e.sender !== picking.win.webContents || !pickerDone) return;
  const ok = v && typeof v.id === 'string' && /^(screen|window):[\w:-]+$/.test(v.id);
  pickerDone(ok ? { id: v.id, audio: !!v.audio } : null);
});
ipcMain.on('picker:cancel', (e) => { if (picking && e.sender === picking.win.webContents && pickerDone) pickerDone(null); });
ipcMain.handle('picker:platform', () => ({ os: process.platform, audio: process.platform === 'win32' || (isMac && Number(require('os').release().split('.')[0]) >= 23) }));

/* ── menu mínimo (no Mac o menu do app precisa existir para copiar/colar funcionar) ── */
function setupMenu() {
  const tpl = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    { label: 'Ver', submenu: [{ role: 'reload', label: 'Recarregar' }, { role: 'togglefullscreen', label: 'Tela cheia' }, { type: 'separator' }, { role: 'zoomIn', label: 'Aumentar' }, { role: 'zoomOut', label: 'Diminuir' }, { role: 'resetZoom', label: 'Tamanho normal' }] },
    { role: 'windowMenu', label: 'Janela' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  setupPermissions();
  setupScreenShare();
  setupMenu();
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (!isMac) app.quit(); });
