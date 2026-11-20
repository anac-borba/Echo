'use strict';
// Ponto de partida: decide entre a tela de entrar e o aplicativo, e cuida dos eventos ao vivo.
import { initRemote } from './remote.js';
import { $, $$, el, toast, store, setIcon } from './util.js';
import { D, CFG, ingest, userById, emit, on, remember } from './state.js';
import { api, prehash, Events } from './api.js';
import { t, tErr, applyI18n, setLang, getLang, onLang } from './i18n.js';
import { applyTheme, openSettings, refreshSettings, onDevicesChanged, closeSettings, afterSiteUpdate } from './settings.js';
import { uiSound } from './sfx.js';
import { onRing, onRingOff, initRinger } from './ringer.js';
import { gameHandlers } from './games-hub.js';
import { syncNotify } from './notify.js';

/* iPhone, app instalado (Tela de Início) com barra de status transparente: o iOS às vezes dá à área "fixa"
   uma altura menor que a tela (sobra uma faixa vazia embaixo da barra de abas, ~ a altura da barra de status).
   Aqui medimos a tela de verdade e esticamos o app até a borda de baixo. */
(function fitStandaloneHeight() {
  const ios = /iPhone|iPod/.test(navigator.userAgent);
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  if (!ios || !standalone) return;
  const fit = () => {
    const portrait = matchMedia('(orientation: portrait)').matches;
    const full = portrait ? Math.max(screen.height, screen.width) : Math.min(screen.height, screen.width);
    const h = Math.max(innerHeight, document.documentElement.clientHeight);
    const gap = full - h;
    document.documentElement.style.setProperty('--app-h', gap > 8 && gap < 120 ? full + 'px' : '100%');
  };
  fit();
  addEventListener('resize', fit); addEventListener('orientationchange', () => setTimeout(fit, 300));
})();
import { initShell, setSettingsOpener, refreshFriends, refreshServers, refreshMe, applyPresence, renderAll, renderSoft, go, callRoom, openJoinServer, closePopover, loadConvs, onChatEvent } from './ui.js';
import { resetChat } from './chat.js';
import { initCall, leaveRoom, currentRoom } from './call.js';
import { initActivities } from './activities.js';
import { initRoomExtras } from './room-extras.js';
import { openModal, closeModal, confirmBox } from './modal.js';
import { initAuth, showAuth, hideAuth, drawAuth, authVisible, saveLast } from './auth.js';
import { initPwa } from './pwa.js';

let events = null;
let shellReady = false;
// Ponte estável para o socket de eventos: sobrevive a sair/entrar de novo na conta.
const ev = { send: (o) => events && events.send(o) };

/* ───────────── páginas ───────────── */
function showLanding() {
  $('#app').hidden = true;
  showAuth();
}

function openFromNotification(open) {
  const m = /^dm:([a-z2-7]{12})$/.exec(open || '');
  if (m) go('dm', m[1]);
}
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.t === 'open' && D.me) openFromNotification(e.data.open); });

async function enterApp(user) {
  D.me = remember(user);
  saveLast(user);
  hideAuth(); $('#app').hidden = false;
  events = new Events({
    ready() { events.send({ t: 'room', room: currentRoom() }); D.eventsUp = true; emit('events'); },
    down() { D.eventsUp = false; emit('events'); },
    presence: (m) => applyPresence(m),
    refresh: async (m) => {
      try {
        if (m.what === 'friends') await refreshFriends();
        else if (m.what === 'servers') await refreshServers();
        else if (m.what === 'me') await refreshMe();
        ingest(); renderSoft();
      } catch {}
    },
    msg: onChatEvent, 'msg-up': onChatEvent, 'msg-del': onChatEvent, 'msg-pins': onChatEvent, read: onChatEvent, typing: onChatEvent,
    ring: (m) => onRing(m),
    'ring-off': (m) => onRingOff(m),
    g: gameHandlers.g, match: gameHandlers.match, error: gameHandlers.error,
  });
  try { await Promise.all([refreshFriends(), refreshServers(), loadConvs()]); } catch (e) { console.warn(e); }
  ingest();
  if (!shellReady) {
    initShell(ev); setSettingsOpener(openSettings); initRinger((o) => events && events.send(o)); initCall(ev); initRemote(); initActivities(); initRoomExtras();
    on('me', () => renderAll()); on('users', () => {});
    on('logout', doLogout); on('devices', onDevicesChanged);
    on('switch-account', switchAccount); on('add-account', addAccount);
    shellReady = true;
  }
  D.view = { name: 'home' };
  renderAll();
  loadAccounts();
  syncNotify();
  // aberto por uma notificação: vai direto para a conversa
  const openParam = new URLSearchParams(location.search).get('open');
  if (openParam) { history.replaceState(null, '', location.pathname + location.hash); openFromNotification(openParam); }
  document.title = 'Echo';
  handleDeepLink();
  afterSiteUpdate();
}

async function loadAccounts() {
  try { D.accounts = (await api('GET', '/accounts')).accounts || []; } catch { D.accounts = []; }
  renderSoft();
}
async function switchAccount(id) {
  if (currentRoom() && !(await confirmBox(t('acc.switch'), t('acc.switch.call'), t('acc.switch'), false))) return;
  try { await leaveRoom(); } catch {}
  try { await api('POST', '/accounts/switch', { id }); } catch (e) { toast(tErr(e.code)); loadAccounts(); return; }
  location.reload();
}
function addAccount() {
  closeSettings(); closePopover();
  $('#app').hidden = true;
  showAuth('login', { onCancel: () => { $('#app').hidden = false; } });
}

async function doLogout() {
  const others = (D.accounts || []).length;
  if (!(await confirmBox(t('auth.logout'), others ? t('acc.logout.q') : t('auth.logout.q'), t('auth.logout'), false))) return;
  try { await leaveRoom(); } catch {}
  let j = null;
  try { j = await api('POST', '/logout'); } catch {}
  if (j && j.switched) { location.reload(); return; }   // havia outra conta aberta: entra nela
  if (events) events.close();
  events = null; resetChat(); D.me = null; D.friends = []; D.incoming = []; D.outgoing = []; D.servers = []; D.users.clear();
  closeSettings(); closePopover();
  showLanding();
}

/* ───────────── links de convite e de amizade ───────────── */
function handleDeepLink() {
  const h = sessionStorage.getItem('tl.pending') || location.hash;
  sessionStorage.removeItem('tl.pending');
  if (!h || !D.me) return;
  history.replaceState(null, '', location.pathname);
  let m;
  if ((m = /^#\/convite\/([A-Za-z0-9]{10})$/.exec(h))) openJoinServer(m[1]);
  else if ((m = /^#\/amizade\/([a-z0-9_.]{3,20})$/i.exec(h))) {
    const username = m[1].toLowerCase();
    if (username === D.me.username) return;
    confirmBox(t('friends.add'), t('friends.add.q', { name: '@' + username }), t('friends.add'), false).then(async (ok) => {
      if (!ok) return;
      try { await api('POST', '/friends', { username }); toast(t('friends.sent')); await refreshFriends(); ingest(); renderAll(); } catch (e) { toast(tErr(e.code)); }
    });
  }
}

/* ───────────── início ───────────── */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // No computador de desenvolvimento o cache atrapalha: lá só liga com ?sw=1.
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (local && !/[?&]sw=1\b/.test(location.search)) {
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
    return;
  }
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}

async function boot() {
  // desfoque de vidro só no Safari (onde é leve). No Chrome (computador, Android, iPhone), no app do Google e
  // nos navegadores dentro de apps ele pesa muito e chega a travar: lá vai com fundos sólidos.
  const ua = navigator.userAgent;
  const safari = /Safari/.test(ua) && /Apple/.test(navigator.vendor || '') && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|Instagram|FBAN|FBAV|Line\//.test(ua);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (!(safari || (standalone && /iPhone|iPad/.test(ua) && !/CriOS|GSA\//.test(ua)))) document.documentElement.classList.add('lite');
  // barra de título: no app instalado e no app para computador, o Echo ocupa o lugar dela (sobra só uma faixa para arrastar)
  const wco = navigator.windowControlsOverlay;
  const macApp = / Electron\//.test(ua) && /Macintosh/.test(ua);
  if (macApp) document.documentElement.classList.add('mac-app');
  const syncWco = () => document.documentElement.classList.toggle('wco', !!(wco && wco.visible) || / Electron\//.test(ua));
  syncWco(); if (wco) wco.addEventListener('geometrychange', syncWco);
  initPwa();
  applyTheme(CFG.theme);
  applyI18n();
  // entrou numa conta: se já havia outra aberta (adicionar conta), recarrega para começar limpo na nova
  initAuth({ onAuthed: async (u) => { if (D.me) { location.reload(); return; } await enterApp(u); } });
  onLang(() => { applyI18n(); if (authVisible()) drawAuth(); if (D.me) { renderAll(); if (!$('#settings').hidden) refreshSettings(); } });
  if (matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (CFG.theme === 'auto') applyTheme('auto'); });
  registerServiceWorker();

  if (location.hash.startsWith('#/')) sessionStorage.setItem('tl.pending', location.hash);
  let me = null;
  try { me = (await api('GET', '/me')).user; } catch {}
  if (me) await enterApp(me);
  else showLanding();
}
document.addEventListener('DOMContentLoaded', boot);
export { emit, store, openModal, closeModal, go, getLang, el };
