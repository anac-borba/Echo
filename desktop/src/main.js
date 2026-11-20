'use strict';
// Echo para computador (Electron): uma janela com o Echo de sempre (o site), mais o que o navegador não deixa:
//  - escolher a tela ou a janela numa janela do próprio Echo, com o som de cada app (programa auxiliar nativo);
//  - controle remoto: quem assiste pede, quem transmite permite, e o Echo move o mouse e digita;
//  - atualizar sozinho (Releases do GitHub) e um botão de procurar atualização nas Configurações.
// O site é o publicado na Cloudflare: a interface se atualiza sozinha quando o site é publicado.
const { app, BrowserWindow, session, desktopCapturer, ipcMain, shell, Menu, nativeTheme, screen, globalShortcut, MessageChannelMain } = require('electron');
const path = require('path');
const fs = require('fs');
const helper = require('./helper');
const updater = require('./updater');
const passkey = require('./passkey');

const ECHO = 'https://telinha.echo-ac-2k4.workers.dev';
const ORIGIN = new URL(ECHO).origin;
const isMac = process.platform === 'darwin';

nativeTheme.themeSource = 'dark';
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let quitting = false;   // no Mac, fechar a janela só esconde: o Echo segue ligado para avisar de mensagens e chamadas
const fromEcho = (e) => { try { return new URL(e.senderFrame.url).origin === ORIGIN; } catch { return false; } };
const safeUrl = (u) => { try { return ['https:', 'http:', 'mailto:'].includes(new URL(u).protocol); } catch { return false; } };
const safeOrigin = (u) => { try { return new URL(u).origin; } catch { return ''; } };
const toPage = (ch, v) => { if (win && !win.isDestroyed()) win.webContents.send(ch, v); };

/* ── preferências (arquivo no perfil do app) ── */
const setFile = () => path.join(app.getPath('userData'), 'echo-settings.json');
let S = { controlAllowed: false };
function loadSettings() { try { S = { ...S, ...JSON.parse(fs.readFileSync(setFile(), 'utf8')) }; } catch { /* primeira vez */ } }
function saveSettings() { try { fs.writeFileSync(setFile(), JSON.stringify(S)); } catch (e) { console.error('preferências', e); } }

function createWindow() {
  win = new BrowserWindow({
    width: 1240, height: 820, minWidth: 900, minHeight: 600,
    backgroundColor: '#0E0E10', title: 'Echo', show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    // sem barra de título do sistema: o Echo desenha uma faixa escura para arrastar; os botões da janela continuam
    autoHideMenuBar: true,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 16, y: 14 } } : { titleBarOverlay: { color: '#0E0E10', symbolColor: '#FFFFFF', height: 32 } }),
    webPreferences: { preload: path.join(__dirname, 'main-preload.js'), contextIsolation: true, sandbox: true, spellcheck: true, backgroundThrottling: false },
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
  win.on('close', (e) => { if (isMac && !quitting) { e.preventDefault(); win.hide(); } });
  win.on('closed', () => { win = null; endControl(); stopShareAudio(); });
}

/* ── permissões: só o Echo, e só o que ele usa ── */
function setupPermissions() {
  const ok = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'display-capture', 'fullscreen', 'speaker-selection']);
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => {
    const from = details && details.requestingUrl ? safeOrigin(details.requestingUrl) : safeOrigin(wc.getURL());
    cb(from === ORIGIN && ok.has(perm));
  });
  session.defaultSession.setPermissionCheckHandler((wc, perm, origin) => safeOrigin(origin) === ORIGIN && ok.has(perm));
}

/* ═════════════ compartilhar tela + som de cada app ═════════════ */
let share = null;       // { id, kind, displayId, audio: { mode, pids } }
let pcmPort = null;     // porta para a página receber o som dos apps
const rates = new Map();
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
      stopShareAudio();
      const a = choice.audio || { mode: 'none' };
      share = { id: src.id, kind: src.id.startsWith('screen:') ? 'screen' : 'window', displayId: src.display_id || '', audio: a };
      if (a.mode === 'loopback' && request.audioRequested !== false) { callback({ video: src, audio: 'loopback' }); return; }
      callback({ video: src });
      if (a.mode === 'all' || a.mode === 'apps') startShareAudio(a);
    } catch (e) {
      console.error('compartilhar', e);
      callback({});
    }
  }, { useSystemPicker: false });
}
async function startShareAudio(a) {
  if (!(await helper.start())) return;
  rates.clear();
  if (a.mode === 'all') {
    // tudo menos o próprio Echo (todos os processos dele): assim a voz da ligação não volta para a outra pessoa
    const own = [process.pid, ...app.getAppMetrics().map((m) => m.pid)].filter((v, i, arr) => arr.indexOf(v) === i);
    helper.send('exclude ' + (isMac ? own.join(' ') : String(process.pid)));
  } else helper.send('include ' + a.pids.filter((p) => Number.isInteger(p) && p > 0).join(' '));
}
function stopShareAudio() {
  helper.send('stop');
  if (pcmPort) { try { pcmPort.close(); } catch { /* ok */ } pcmPort = null; }
}
helper.ev.on('started', (m) => { rates.set(m.id, m.rate || 48000); });
helper.ev.on('audio', (id, data) => {
  if (!pcmPort) return;
  pcmPort.postMessage({ id, rate: rates.get(id) || 48000, pcm: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) });
});
helper.ev.on('err', (m) => { console.error('auxiliar', m.msg); toPage('share:audio-error', String(m.msg || '')); });

ipcMain.on('share:port', (e) => {
  if (!fromEcho(e)) return;
  if (pcmPort) { try { pcmPort.close(); } catch { /* ok */ } }
  const { port1, port2 } = new MessageChannelMain();
  pcmPort = port1; port1.start();
  e.sender.postMessage('share:port', null, [port2]);
});
ipcMain.on('share:stop', (e) => { if (fromEcho(e)) { stopShareAudio(); share = null; endControl(); } });
ipcMain.handle('share:info', (e) => (fromEcho(e) && share ? { kind: share.kind, audio: share.audio.mode, appsAudio: share.audio.mode === 'all' || share.audio.mode === 'apps' } : null));

/* ── a janela de escolher ── */
let picking = null, pickerDone = null;
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
const fromPicker = (e) => picking && e.sender === picking.win.webContents;
ipcMain.handle('picker:sources', async (e) => {
  if (!fromPicker(e)) return [];
  const list = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 400, height: 250 }, fetchWindowIcons: true });
  return list
    .filter((s) => s.id.startsWith('screen:') || !/^Echo$/.test(s.name))   // não oferece a própria janela do Echo
    .map((s) => ({ id: s.id, name: s.name, kind: s.id.startsWith('screen:') ? 'screen' : 'window', thumb: s.thumbnail.toDataURL(), icon: s.appIcon ? s.appIcon.toDataURL() : null }));
});
// apps com som, agrupados (um app pode ter vários processos), sem o próprio Echo e sem processos do sistema
ipcMain.handle('picker:apps', async (e) => {
  if (!fromPicker(e)) return null;
  const raw = await helper.listApps();
  if (raw === null) return null;
  const own = new Set([process.pid, ...app.getAppMetrics().map((m) => m.pid)]);
  const groups = new Map();
  for (const a of raw) {
    if (own.has(a.pid)) continue;
    if (isMac && (!/\.app$/.test(a.path || '') || /^\/System\//.test(a.path))) continue;
    if (!isMac && /^(audiodg|explorer|svchost|ShellExperienceHost|SystemSettings)\.exe$/i.test(a.exe)) continue;
    const key = isMac ? a.path : a.exe.toLowerCase();
    const g = groups.get(key) || { key, name: isMac ? a.exe : a.exe.replace(/\.exe$/i, ''), path: a.path, pids: [], active: false };
    g.pids.push(a.pid); g.active = g.active || !!a.active;
    groups.set(key, g);
  }
  const out = [];
  for (const g of groups.values()) {
    let icon = null;
    try { if (g.path) icon = (await app.getFileIcon(g.path, { size: 'normal' })).toDataURL(); } catch { /* sem ícone */ }
    out.push({ ...g, icon });
  }
  return out.sort((x, y) => (y.active - x.active) || x.name.localeCompare(y.name));
});
ipcMain.on('picker:choose', (e, v) => {
  if (!fromPicker(e) || !pickerDone) return;
  const ok = v && typeof v.id === 'string' && /^(screen|window):[\w:-]+$/.test(v.id);
  if (!ok) { pickerDone(null); return; }
  const au = v.audio || {};
  const mode = ['all', 'apps', 'none', 'loopback'].includes(au.mode) ? au.mode : 'none';
  const pids = Array.isArray(au.pids) ? au.pids.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 64) : [];
  pickerDone({ id: v.id, audio: { mode: mode === 'apps' && !pids.length ? 'none' : mode, pids } });
});
ipcMain.on('picker:cancel', (e) => { if (fromPicker(e) && pickerDone) pickerDone(null); });
// som do computador: Windows sempre; Mac a partir do macOS 14.2 (Darwin 23.2)
const macAudio = () => { const [maj, min] = require('os').release().split('.').map(Number); return maj > 23 || (maj === 23 && min >= 2); };
ipcMain.handle('picker:platform', (e) => (fromPicker(e) ? { os: process.platform, audio: process.platform === 'win32' || (isMac && macAudio()), perApp: helper.available() } : null));

/* ═════════════ controle remoto ═════════════ */
let grant = null;          // { who, mouse, keyboard, bounds }
let pill = null;
const SHORTCUT = 'Control+Alt+Escape';

function dialog(kind, data, size) {
  return new Promise((resolve) => {
    const d = new BrowserWindow({
      width: size.w, height: size.h, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      alwaysOnTop: true, backgroundColor: '#16161A', title: 'Echo', show: false, frame: kind !== 'pill', transparent: false,
      ...(kind === 'pill' ? { skipTaskbar: true, focusable: true, hasShadow: true, roundedCorners: true } : {}),
      webPreferences: { preload: path.join(__dirname, 'dialog-preload.js'), contextIsolation: true, sandbox: true },
    });
    let answered = false;
    const done = (v) => { if (answered) return; answered = true; resolve(v); if (kind !== 'pill' && !d.isDestroyed()) d.close(); };
    const wcId = d.webContents.id;
    d.on('closed', () => { dialogs.delete(wcId); done(null); });
    d.once('ready-to-show', () => { d.show(); if (kind !== 'pill') d.focus(); });
    dialogs.set(wcId, { kind, data, done, win: d });
    d.loadFile(path.join(__dirname, 'dialog.html'), { query: { k: kind } });
    if (kind === 'pill') resolve(d);
  });
}
const dialogs = new Map();
ipcMain.handle('dlg:data', (e) => { const x = dialogs.get(e.sender.id); return x ? { kind: x.kind, ...x.data } : null; });
ipcMain.on('dlg:answer', (e, v) => { const x = dialogs.get(e.sender.id); if (x) x.done(v); });

function displayBounds() {
  const all = screen.getAllDisplays();
  const d = all.find((x) => String(x.id) === String(share && share.displayId)) || screen.getPrimaryDisplay();
  return d.bounds;
}
ipcMain.handle('ctl:ask', async (e, who) => {
  if (!fromEcho(e)) return { ok: false, why: 'origem' };
  if (!share || share.kind !== 'screen') return { ok: false, why: 'tela' };
  if (grant) return { ok: false, why: 'ocupado' };
  const name = String((who && who.name) || '').slice(0, 60), user = String((who && who.username) || '').slice(0, 40);
  if (!S.controlAllowed) {
    const on = await dialog('ativar', {}, { w: 460, h: 600 });
    if (!on) return { ok: false, why: 'desligado' };
    S.controlAllowed = true; saveSettings();
  }
  const r = await dialog('permit', { name, user, mac: isMac }, { w: 460, h: 600 });
  if (!r || !r.allow) return { ok: false, why: 'recusou' };
  if (isMac && (await helper.start())) helper.send('axcheck');   // o Mac pede "Acessibilidade" na primeira vez
  else await helper.start();
  grant = { who: name, mouse: !!r.mouse, keyboard: !!r.keyboard, bounds: displayBounds() };
  try { globalShortcut.register(SHORTCUT, () => endControl(true)); } catch { /* atalho ocupado */ }
  const b = grant.bounds;
  pill = await dialog('pill', { name }, { w: 520, h: 56 });
  try { pill.setPosition(Math.round(b.x + b.width / 2 - 260), Math.round(b.y + 14)); pill.setAlwaysOnTop(true, 'screen-saver'); pill.setVisibleOnAllWorkspaces(true); } catch { /* ok */ }
  return { ok: true, mouse: grant.mouse, keyboard: grant.keyboard };
});
function endControl(notify) {
  if (!grant && !pill) return;
  grant = null;
  try { globalShortcut.unregister(SHORTCUT); } catch { /* ok */ }
  if (pill && !pill.isDestroyed()) pill.close();
  pill = null;
  if (notify !== false) toPage('ctl:ended');
}
ipcMain.on('ctl:stop', (e) => { if (fromEcho(e)) endControl(false); });
ipcMain.on('dlg:stop', () => endControl(true));
const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));
let lastMove = 0;
ipcMain.on('ctl:in', (e, m) => {
  if (!fromEcho(e) || !grant || !m || typeof m !== 'object') return;
  const b = grant.bounds;
  if (grant.mouse && m.t === 'move') {
    const now = Date.now(); if (now - lastMove < 8) return; lastMove = now;
    let p = { x: b.x + clamp01(m.x) * (b.width - 1), y: b.y + clamp01(m.y) * (b.height - 1) };
    if (!isMac) p = screen.dipToScreenPoint(p);
    helper.send(`move ${Math.round(p.x)} ${Math.round(p.y)}`);
  } else if (grant.mouse && (m.t === 'down' || m.t === 'up') && ['l', 'r', 'm'].includes(m.b)) helper.send(`${m.t} ${m.b}`);
  else if (grant.mouse && m.t === 'wheel') helper.send(`wheel ${Math.max(-2000, Math.min(2000, Math.round(m.dx || 0)))} ${Math.max(-2000, Math.min(2000, Math.round(m.dy || 0)))}`);
  else if (grant.keyboard && m.t === 'key' && /^[A-Za-z0-9]{1,20}$/.test(m.code || '') && (m.d === 'down' || m.d === 'up')) helper.send(`key ${m.d} ${m.code} ${/^[scam]{0,4}$/.test(m.mods || '') ? m.mods || '' : ''}`);
  else if (grant.keyboard && m.t === 'text' && typeof m.s === 'string' && m.s.length && m.s.length <= 64) {
    helper.send('text ' + [...m.s].map((ch) => { let h = ''; for (let i = 0; i < ch.length; i++) h += ch.charCodeAt(i).toString(16).padStart(4, '0'); return h; }).join(''));
  }
});

/* ═════════════ preferências, versão e atualização ═════════════ */
ipcMain.handle('app:info', (e) => (fromEcho(e) ? { version: app.getVersion(), os: process.platform, perApp: helper.available(), control: true, touchId: passkey.available(), notify: true } : null));
ipcMain.handle('set:get', (e) => (fromEcho(e) ? { controlAllowed: !!S.controlAllowed, openAtLogin: app.getLoginItemSettings().openAtLogin } : null));
ipcMain.handle('set:set', (e, k, v) => {
  if (!fromEcho(e)) return false;
  if (k === 'controlAllowed') { S.controlAllowed = !!v; saveSettings(); if (!v) endControl(true); }
  else if (k === 'openAtLogin') app.setLoginItemSettings({ openAtLogin: !!v });
  return true;
});
ipcMain.handle('upd:check', (e) => (fromEcho(e) ? updater.check(true) : null));
ipcMain.handle('upd:install', (e) => (fromEcho(e) ? updater.install() : null));
updater.onState((s) => toPage('upd:state', s));

/* ── Touch ID (passkey guardada no Keychain deste Mac) ── */
const pkWrap = (fn) => async (e, o) => {
  if (!fromEcho(e)) return { ok: false, code: 'not_supported' };
  try { return { ok: true, r: await fn(o, ORIGIN) }; } catch (err) { return { ok: false, code: (err && err.code) || 'error' }; }
};
ipcMain.handle('pk:avail', (e) => fromEcho(e) && passkey.available());
ipcMain.handle('pk:create', pkWrap((o, origin) => passkey.create(o, origin)));
ipcMain.handle('pk:get', pkWrap((o, origin) => passkey.get(o, origin)));
ipcMain.on('pk:forget', (e, id) => { if (fromEcho(e) && typeof id === 'string') passkey.forget(id); });

/* ── janela: a notificação traz o Echo para a frente; contador de não lidas no ícone ── */
function showWin() { if (!win) { createWindow(); return; } if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
ipcMain.on('win:show', (e) => { if (fromEcho(e)) showWin(); });
ipcMain.on('win:badge', (e, n) => {
  if (!fromEcho(e)) return;
  const k = Math.max(0, Math.min(999, Number(n) || 0));
  try { if (isMac) app.dock.setBadge(k ? String(k) : ''); else app.setBadgeCount(k); } catch { /* ok */ }
});
ipcMain.on('win:attention', (e) => { if (fromEcho(e) && win && !win.isFocused()) { try { if (isMac) app.dock.bounce('critical'); else win.flashFrame(true); } catch { /* ok */ } } });

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

app.on('second-instance', () => showWin());
app.on('before-quit', () => { quitting = true; });
app.whenReady().then(() => {
  loadSettings();
  setupPermissions();
  setupScreenShare();
  setupMenu();
  createWindow();
  updater.start();
  app.on('activate', () => showWin());
});
app.on('window-all-closed', () => { if (!isMac) app.quit(); });
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch { /* ok */ } helper.stop(); });
