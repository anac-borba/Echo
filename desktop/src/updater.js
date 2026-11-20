'use strict';
// Atualização sozinha a partir das Releases do GitHub (anac-borba/echo).
//  - Windows: electron-updater (baixa o instalador novo em segundo plano e instala ao fechar ou ao tocar em "Reiniciar").
//  - Mac: o app não tem a assinatura paga da Apple, e o atualizador padrão do Mac exige essa assinatura. Então o Echo
//    baixa o .zip do app novo, troca o Echo.app na pasta Aplicativos e abre de novo.
// Procura ao abrir, a cada 4 horas e quando você toca em "Procurar atualização" nas Configurações.
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const REPO = 'anac-borba/echo';
const isMac = process.platform === 'darwin';
let state = { state: 'idle', version: app.getVersion() };
let listeners = [];
const set = (s) => { state = { ...state, ...s }; listeners.forEach((f) => { try { f(state); } catch { /* ok */ } }); };
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

/* ── Windows ── */
let au = null;
function winUpdater() {
  if (au) return au;
  try { ({ autoUpdater: au } = require('electron-updater')); } catch (e) { console.error('electron-updater', e); return null; }
  au.autoDownload = true;
  au.autoInstallOnAppQuit = true;
  au.on('checking-for-update', () => set({ state: 'checking' }));
  au.on('update-not-available', () => set({ state: 'none', checkedAt: Date.now() }));
  au.on('update-available', (i) => set({ state: 'downloading', next: i.version, progress: 0 }));
  au.on('download-progress', (p) => set({ state: 'downloading', progress: Math.round(p.percent || 0) }));
  au.on('update-downloaded', (i) => set({ state: 'ready', next: i.version }));
  au.on('error', (e) => set({ state: 'error', error: String((e && e.message) || e).slice(0, 200) }));
  return au;
}

/* ── Mac ── */
let macBusy = false, macReady = null;
async function macCheck() {
  if (macBusy) return;
  macBusy = true;
  try {
    set({ state: 'checking' });
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Echo' } });
    if (!r.ok) throw new Error(r.status === 404 ? 'Releases não encontradas (o repositório precisa ser público)' : 'GitHub ' + r.status);
    const rel = await r.json();
    const v = String(rel.tag_name || '').replace(/^v/, '');
    if (!newer(v, app.getVersion())) { set({ state: 'none', checkedAt: Date.now() }); return; }
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const asset = (rel.assets || []).find((a) => a.name === `Echo-${v}-mac-${arch}.zip`);
    if (!asset) throw new Error('arquivo do Mac não encontrado na versão ' + v);
    set({ state: 'downloading', next: v, progress: 0 });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-upd-'));
    const zip = path.join(dir, 'Echo.zip');
    const res = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'Echo' } });
    if (!res.ok || !res.body) throw new Error('download ' + res.status);
    const total = Number(res.headers.get('content-length')) || asset.size || 0;
    const out = fs.createWriteStream(zip); let got = 0, lastP = -1;
    for await (const chunk of res.body) {
      out.write(chunk); got += chunk.length;
      const p = total ? Math.round((got / total) * 100) : 0;
      if (p !== lastP) { lastP = p; set({ progress: p }); }
    }
    await new Promise((ok) => out.end(ok));
    await new Promise((ok, no) => execFile('/usr/bin/ditto', ['-x', '-k', zip, dir], (e) => (e ? no(e) : ok())));
    const appNew = path.join(dir, 'Echo.app');
    if (!fs.existsSync(appNew)) throw new Error('o .zip não tinha o Echo.app');
    macReady = appNew;
    set({ state: 'ready', next: v });
  } catch (e) {
    set({ state: 'error', error: String((e && e.message) || e).slice(0, 200) });
  } finally { macBusy = false; }
}
function macInstall() {
  if (!macReady) return false;
  // o Echo.app atual: .../Echo.app/Contents/MacOS/Echo
  const cur = path.resolve(app.getPath('exe'), '..', '..', '..');
  if (!/\.app$/.test(cur)) return false;
  const sh = path.join(path.dirname(macReady), 'trocar.sh');
  fs.writeFileSync(sh, `#!/bin/bash
while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done
rm -rf "${cur}.antigo"
mv "${cur}" "${cur}.antigo" && mv "${macReady}" "${cur}" && rm -rf "${cur}.antigo"
xattr -cr "${cur}" 2>/dev/null
open "${cur}"
`, { mode: 0o755 });
  spawn('/bin/bash', [sh], { detached: true, stdio: 'ignore' }).unref();
  app.quit();
  return true;
}

function check(manual) {
  if (!app.isPackaged) { set({ state: 'none', dev: true }); return state; }
  if (isMac) { macCheck(); return state; }
  const u = winUpdater();
  if (!u) { set({ state: 'error', error: 'atualizador indisponível' }); return state; }
  if (state.state === 'ready') return state;
  u.checkForUpdates().catch((e) => set({ state: 'error', error: String((e && e.message) || e).slice(0, 200) }));
  void manual;
  return state;
}
function install() {
  if (state.state !== 'ready') return false;
  if (isMac) return macInstall();
  const u = winUpdater(); if (!u) return false;
  setImmediate(() => u.quitAndInstall(true, true));
  return true;
}
function start() {
  setTimeout(() => check(false), 8000);
  setInterval(() => check(false), 4 * 3600 * 1000);
}
function onState(fn) { listeners.push(fn); }

module.exports = { start, check, install, onState, get state() { return state; } };
