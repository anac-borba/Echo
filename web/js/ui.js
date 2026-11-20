'use strict';
// Estrutura do aplicativo: barra de servidores, menus, telas (início, amigos, servidores) e perfil.
import { openProfile, openStatusEditor } from './profile-sheet.js';
import { mascot } from './mascot.js';
import { $, $$, el, icon, toast, avatar, displayName, copyText, imageToDataUrl, store, isCompact } from './util.js';
import { D, CFG, on, emit, remember, userById, isFriend, serverById, channelInfo, dmRoom } from './state.js';
import { api } from './api.js';
import { t, tErr } from './i18n.js';
import { openModal, closeModal, confirmBox } from './modal.js';
import { joinRoom, leaveRoom, inCall, currentRoom, callInfo, toggleMute, toggleDeaf, renderCall } from './call.js';
import { startOutgoing } from './ringer.js';
import { renderGames, initGames, pendingInvites } from './games-hub.js';
import { mountChat, unmountChat, initChat, loadConvs, convsReady, unreadOf, totalUnread, lastOf, preview, isTyping, onChatEvent } from './chat.js';

const els = {};
let events = null;
let friendsTab = 'all';
let openSettingsFn = () => {};
export function setSettingsOpener(fn) { openSettingsFn = fn; }

const EMOJIS = ['🍿', '🎬', '🐞', '🌙', '⭐', '🌸', '🎮', '🎧', '🏠', '🦋', '🍓', '💜'];
const COLORS = ['#e8334a', '#ff8a3d', '#f2b01e', '#34c759', '#30b0c7', '#5b6cf0', '#a550e0', '#ff5c9d'];
const friendLink = () => `${location.origin}/#/amizade/${D.me.username}`;
const inviteLink = (code) => `${location.origin}/#/convite/${code}`;

/* ───────────── carregar dados ───────────── */
export async function refreshMe() { const j = await api('GET', '/me'); D.me = remember(j.user); return D.me; }
export async function refreshFriends() {
  const j = await api('GET', '/friends');
  D.friends = (j.friends || []).map(remember);
  D.incoming = (j.incoming || []).map((r) => ({ ...r, from: remember(r.from) }));
  D.outgoing = (j.outgoing || []).map((r) => ({ ...r, to: remember(r.to) }));
}
export async function refreshServers() {
  const j = await api('GET', '/servers');
  D.servers = (Array.isArray(j) ? j : j.servers || []).map((s) => ({ ...s, members: (s.members || []).map(remember) }));
}

/* ───────────── navegação ───────────── */
let lastView = { name: 'home' };
export function go(name, id) {
  const before = D.view && D.view.name + ':' + (D.view.id || '');
  if (D.view && D.view.name !== 'room' && D.view.name !== name) lastView = { ...D.view };
  D.view = { name, id };
  if (name === 'server' && !serverById(id)) D.view = { name: 'home' };
  if (name === 'profile' && !isCompact()) { D.view = { name: 'home' }; }
  if (name === 'dm' && !isFriend(id)) D.view = { name: 'home' };
  closePopover();
  const after = D.view.name + ':' + (D.view.id || '');
  const changed = before !== after;
  if (!changed) { renderAll(); return; }
  const kind = transitionKind(before.split(':')[0], D.view.name);
  if (els.tabbar) renderTabbar();   // o destaque da aba muda no toque, antes da animação
  if (!withTransition(kind, renderAll)) { renderAll(); enterAnim(kind, before.split(':')[0]); }
}
/** Tipo de animação ao trocar de tela, como no iPhone:
 *  zoom = abrir a ligação (cresce do centro); push/pop = entrar/sair de uma conversa no celular; fade = trocar de aba. */
// no celular não há mais barra de abas: Jogos e Perfil entram empurrando a partir do Início (e voltam)
const LEVEL = { home: 0, games: 1, profile: 1, calls: 1, friends: 2, dm: 1, server: 1, room: 3 };
function transitionKind(from, to) {
  if (to === 'room') return 'zoom';
  if (from === 'room') return 'unzoom';
  if (isCompact() && (LEVEL[to] ?? 0) > (LEVEL[from] ?? 0)) return 'push';
  if (isCompact() && (LEVEL[to] ?? 0) < (LEVEL[from] ?? 0)) return 'pop';
  return 'fade';
}
let curTr = null;
/* Durante uma View Transition o navegador manda os toques para o <html> (as camadas da animação cobrem a tela).
   Um toque nesse momento encerra a animação e é repassado para o que estiver de fato embaixo do dedo. */
document.addEventListener('click', (e) => {
  const tr = curTr;
  if (!tr || e.target !== document.documentElement) return;
  e.stopPropagation();
  const { clientX: x, clientY: y } = e;
  try { tr.skipTransition(); } catch {}
  const replay = () => requestAnimationFrame(() => { const n = document.elementFromPoint(x, y); if (n && n !== document.documentElement) (n.closest('button, a, [role="button"], label, input, select, textarea') || n).click(); });
  (tr.updateCallbackDone || Promise.resolve()).then(replay, replay);
}, true);
/** Roda `update` dentro de uma View Transition (Safari 18+, Chrome). Devolve false se não houver suporte. */
export function withTransition(kind, update) {
  // só no Safari: no Chrome a View Transition fotografa a tela inteira a cada troca, bloqueia os toques
  // durante a animação e às vezes deixa a imagem velha deslocada na tela (o "bug" de tela fora do lugar)
  if (document.documentElement.classList.contains('lite')) return false;
  // no celular as animações são as nossas (motion.css): iguais em todo iPhone, até nos sem View Transition (iOS 17)
  if (isCompact()) return false;
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden) return false;
  const root = document.documentElement;
  if (curTr) { try { curTr.skipTransition(); } catch {} curTr = null; }   // toque novo não espera a animação anterior
  root.dataset.vt = kind;
  try {
    const tr = document.startViewTransition(() => { update(); });
    curTr = tr; tr.finished.finally(() => { if (curTr === tr) curTr = null; });
    tr.finished.finally(() => { if (root.dataset.vt === kind) delete root.dataset.vt; });
    tr.ready.catch(() => {});
    return true;
  } catch { delete root.dataset.vt; return false; }
}
/** Troca de tela sem View Transition (Chrome): a tela nova entra sozinha, só com transform/opacity
 *  (aba = esmaece; conversa no celular = empurra da direita; voltar = desliza da esquerda). Ver motion.css. */
function enterAnim(kind, fromName) {
  const node = viewNode(D.view.name);
  if (!node) return;
  const k = kind === 'push' || kind === 'pop' || kind === 'zoom' || kind === 'unzoom' ? kind : 'fade';
  // como no iPhone: na conversa, a tela de antes continua por baixo (empurrada para o lado); ao voltar, a conversa sai por cima
  for (const v of document.querySelectorAll('.view[data-leave]')) { v.removeAttribute('data-leave'); if (v !== node) v.hidden = true; }
  const prev = (k === 'push' || k === 'pop') && viewNode(fromName);
  const under = prev && prev !== node ? prev : null;
  if (under) { under.hidden = false; under.dataset.leave = k; }
  node.removeAttribute('data-enter'); void node.offsetWidth; node.dataset.enter = k;
  const anims = node.getAnimations ? node.getAnimations() : [];
  const done = () => {
    if (node.dataset.enter !== k) return;      // já começou outra troca
    node.removeAttribute('data-enter');
    if (under) { under.removeAttribute('data-leave'); if (viewNode(D.view.name) !== under) under.hidden = true; }
  };
  if (anims.length) Promise.all(anims.map((a) => a.finished)).then(done, done); else done();
}
const goRoom = () => go('room');

export async function callRoom(room) {
  if (currentRoom() !== room) {
    try { await joinRoom(room); } catch (e) { console.warn(e); toast(t('err.generic')); return; }
  }
  goRoom();
}
// o servidor aceita 1 toque a cada 5 s para a mesma pessoa: "ligar de novo" logo em seguida espera o necessário
const lastRing = new Map();
export async function callFriend(f) {
  const room = dmRoom(D.me.id, f.id);
  await callRoom(room);
  if (!f.inRoom || f.inRoom !== room) {
    const wait = Math.max(0, (lastRing.get(f.id) || 0) + 5300 - Date.now());
    lastRing.set(f.id, Date.now() + wait);
    setTimeout(() => { if (currentRoom() === room) events && events.send({ t: 'ring', to: f.id, room }); }, wait);
    startOutgoing(f.id, room);
  }
}

/* ───────────── fim da ligação / não atendeu ─────────────
   Em vez de voltar seco para a tela anterior: um instante com "Encerrada · 42 min" (some sozinho em 3 s),
   ou, se a pessoa não atendeu/recusou, o que aconteceu e as saídas (ligar de novo, mandar mensagem). */
let endT = 0;
function callOutcome(kind, uid, ms) {
  const u = userById(uid); if (!u) return;
  document.querySelector('.ce') && document.querySelector('.ce').remove();
  clearTimeout(endT);
  const close = () => { clearTimeout(endT); node.classList.add('out'); setTimeout(() => node.remove(), 220); };
  const again = el('button', { class: 'ce-b main', type: 'button', onClick: () => { close(); callFriend(u); } }, t('call.again'));
  const msg = el('button', { class: 'ce-b', type: 'button', onClick: () => { close(); go('dm', u.id); } }, t(kind === 'ended' ? 'call.msg.short' : 'call.msg'));
  const av = el('span', { class: 'ce-av' }, avatar(u, 'xl', { decoration: false }));
  let node;
  if (kind === 'ended') {
    const min = Math.max(1, Math.round(ms / 60000));
    node = el('div', { class: 'ce ended', role: 'status' },
      el('div', { class: 'ce-card' }, el('b', { text: displayName(u) }), el('span', { text: t('call.endedFor', { n: ms < 60000 ? Math.round(ms / 1000) + ' s' : min + ' min' }) })),
      av, el('div', { class: 'ce-acts' }, msg, again));
    endT = setTimeout(close, 3200);
  } else {
    node = el('div', { class: 'ce failed', role: 'alertdialog', 'aria-label': t(kind === 'declined' ? 'call.declined.t' : 'call.noanswer.t', { name: displayName(u) }) },
      el('div', { class: 'ce-mid' }, av, el('h2', { text: t(kind === 'declined' ? 'call.declined.t' : 'call.noanswer.t', { name: displayName(u) }) }), el('p', { text: t('call.failed.d') })),
      el('div', { class: 'ce-col' }, again, msg, el('button', { class: 'ce-b text', type: 'button', onClick: close }, t('close'))));
  }
  node.addEventListener('click', (e) => { if (e.target === node && kind === 'ended') close(); });
  // continua com a cor do fundo da ligação (sem trocar de tela de repente)
  const col = document.getElementById('view-room') && document.getElementById('view-room').style.getPropertyValue('--ft-c');
  if (col) node.style.setProperty('--ft-c', col);
  node.classList.add('in', 'm-now');   // entra na hora: continua a tela escura da ligação, sem piscar a conversa
  document.body.append(node);
  requestAnimationFrame(() => requestAnimationFrame(() => node.classList.remove('m-now')));
}

/* ───────────── pedaços reutilizáveis ───────────── */
const statusText = (u) => (u.online === false ? t('status.offline') : t('status.' + (u.status || 'online')));
function occupants(room) {
  const ids = new Set();
  for (const u of D.users.values()) if (u.inRoom === room && u.id !== D.me.id) ids.add(u.id);
  const list = [...ids].map(userById);
  if (currentRoom() === room) list.unshift(D.me);
  return list;
}

export function profileCard(u, { self = false, banner = true } = {}) {
  const card = el('div', { class: 'profile-card' });
  const ban = el('div', { class: 'pop-banner' });
  if (u.header && /^data:image\//.test(u.header)) ban.style.backgroundImage = `url("${u.header}")`;
  else if (u.headerColor && /^#[0-9a-f]{6}$/i.test(u.headerColor)) ban.style.background = u.headerColor;
  if (banner) card.append(ban);
  card.append(
    el('div', { class: 'pop-head' }, avatar(u, 'xl', { status: true })),
    el('div', { class: 'pop-id' }, el('b', { text: displayName(u) }), el('small', { text: '@' + u.username + (u.statusText ? ' · ' + u.statusText : '') })),
    ...(u.bio ? [el('div', { class: 'pop-bio', text: u.bio })] : []));
  return card;
}

/* ───────────── rail (início, amigos, novo servidor) ───────────── */
function renderRail() {
  const r = els.rail; r.replaceChildren();
  const inc = D.incoming.length;
  const v = D.view.name;
  const navBtn = (view, ic, label, active, badge) => el('div', { class: 'rail-item', 'aria-current': active ? 'true' : null },
    el('button', { class: 'rail-btn nav', type: 'button', title: label, 'aria-label': label, onClick: () => go(view) }, icon(ic)),
    badge ? el('span', { class: 'dot-badge', text: badge }) : null);
  r.append(el('div', { class: 'rail-item' }, el('button', { class: 'rail-btn logo', type: 'button', title: 'Echo', 'aria-label': t('nav.home'), onClick: () => go('home') }, el('img', { src: '/logo.svg', alt: '' }))));
  r.append(el('div', { class: 'rail-sep' }));
  // sem abas repetidas: as conversas (com amigos e ligações) ficam na coluna ao lado; amigos e pedidos pelo "+"
  r.append(navBtn('home', 'i-home', t('nav.home'), v === 'home' || v === 'friends' || v === 'calls', inc));
  r.append(navBtn('games', 't-games', t('nav.games'), v === 'games', pendingInvites()));
}

/* ───────────── coluna lateral ───────────── */
function sideFriend(f) {
  const room = dmRoom(D.me.id, f.id);
  const inCallWith = currentRoom() === room;
  const last = lastOf(f.id);
  const sub = (inCallWith || f.inRoom) ? t('status.incall') : last ? (last.author === D.me.id && last.kind !== 'call' ? t('you') + ': ' : '') + preview(last) : (f.statusText || statusText(f));
  const n = unreadOf(f.id);
  const open = D.view.name === 'dm' && D.view.id === f.id;
  const typing = isTyping(f.id);
  const main = el('button', { class: 'fr-row', type: 'button', 'aria-current': open ? 'true' : null, onClick: () => go('dm', f.id) },
    avatar(f, 'sm', { status: true }), el('span', { class: 't' }, el('b', { text: displayName(f) }), el('small', { class: typing ? 'typing' : null, text: typing ? t('chat.typing') : sub })),
    inCallWith ? icon('i-mic') : n ? el('span', { class: 'unread', text: n > 99 ? '99+' : String(n) }) : null);
  return el('div', { class: 'fr-wrap' + (inCallWith || open ? ' sel' : '') }, main,
    !inCallWith ? el('button', { class: 'icon-btn', type: 'button', title: t('friends.call'), 'aria-label': t('friends.call') + ' ' + displayName(f), onClick: () => callFriend(f) }, icon('i-phone')) : null);
}
function memberRow(u) {
  const sub = u.inRoom ? t('status.incall') : u.online === false ? t('status.offline') : (u.statusText || statusText(u));
  return el('button', { class: 'fr-row', type: 'button', onClick: () => showProfileModal(u) },
    avatar(u, 'sm', { status: true }), el('span', { class: 't' }, el('b', { text: displayName(u) + (u.id === D.me.id ? ' · ' + t('you') : '') }), el('small', { text: sub })));
}
function srvTile(s, cls = '') {
  const box = el('span', { class: 'srv-tile ' + cls });
  box.style.setProperty('--sc', s.color || '#F0244A');
  if (typeof s.icon === 'string' && s.icon.startsWith('data:image/')) box.append(el('img', { src: s.icon, alt: '' }));
  else box.textContent = s.icon || (s.name || '?').charAt(0).toUpperCase();
  return box;
}

function renderSide() {
  const b = els.sideBody; b.replaceChildren();
  const v = D.view;
  const curSrv = v.name === 'server' ? v.id : (v.name === 'room' && channelInfo(currentRoom()) ? channelInfo(currentRoom()).server.id : null);
  // a lista de conversas mora aqui (no computador); "+" adiciona amigo, o número mostra pedidos de amizade
  const inc = D.incoming.length;
  b.append(el('div', { class: 'side-h' }, el('span', { text: t('side.convs') }),
    inc ? el('button', { class: 'side-ib', type: 'button', title: t('home.reqs'), 'aria-label': t('home.reqs'), onClick: () => { friendsTab = 'pending'; go('friends'); } }, el('span', { class: 'count', text: inc })) : null,
    el('button', { class: 'side-ib', type: 'button', title: t('friends.add'), 'aria-label': t('friends.add'), onClick: () => { friendsTab = 'add'; go('friends'); } }, icon('i-plus'))));
  if (!D.friends.length) b.append(el('p', { class: 'side-empty', text: t('side.nofriends') }));
  [...D.friends].sort((a, c) => (isRinging(c.id) - isRinging(a.id)) || (((lastOf(c.id) || {}).at || 0) - ((lastOf(a.id) || {}).at || 0)) || ((c.online ? 1 : 0) - (a.online ? 1 : 0))).forEach((f) => b.append(sideFriend(f)));

}

/* "Em chamada" fora da sala: no celular uma pílula preta no topo (como a Dynamic Island do iPhone), com o
   telefone verde, o tempo e uma ondinha; no computador o mesmo cartão preto em cima da lista de amigos. */
let pillT = 0;
const fmtCall = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0'); };
const callWave = () => el('span', { class: 'cp-wave', 'aria-hidden': 'true' }, ...Array.from({ length: 9 }, () => el('i')));
function renderCallbar() {
  const info = callInfo();
  const show = !!info.room && D.view.name !== 'room';
  els.callbar.hidden = !show; els.callPill.hidden = !show;
  clearInterval(pillT);
  if (!show) return;
  const peer = info.peerId ? userById(info.peerId) : null;
  const timeTxt = () => { const i = callInfo(); return i.t0 ? fmtCall(Date.now() - i.t0) : t('call.on'); };
  const pt = el('b', { class: 'cp-t', text: timeTxt() }), bt = el('small', { text: timeTxt() });
  els.callbar.replaceChildren(
    el('button', { class: 'main', type: 'button', onClick: goRoom },
      peer ? avatar(peer, 'sm', { decoration: false }) : icon('i-phone'),
      el('span', { class: 'cb-t' }, el('b', { text: info.label || t('call.on') }), el('span', { class: 'cb-s' }, icon('t-calls-f'), bt)),
      callWave()),
    el('button', { class: 'cb-end', type: 'button', title: t('dock.leave'), 'aria-label': t('dock.leave'), onClick: () => leaveRoom() }, icon('t-calls-f')));
  els.callPill.setAttribute('aria-label', `${t('call.on')} · ${info.label || ''}`);
  els.callPill.replaceChildren(icon('t-calls-f', 'ico cp-ph'), pt, callWave());
  pillT = setInterval(() => { const x = timeTxt(); pt.textContent = x; bt.textContent = x; }, 1000);
}

/** Pedido para abrir o menu de dispositivos (microfone/saída). A sala escuta 'devices-popover' e marca req.handled; sem ela, abre Configurações > Voz. */
function openDevicesMenu(anchor) {
  const req = { anchor, kind: 'mic', handled: false };
  emit('devices-popover', req);
  if (!req.handled) openSettingsFn('voice');
}
function renderUserPanel() {
  const me = D.me, info = callInfo(), p = els.userpanel;
  const muted = !!(info.room && info.muted);
  const micLabel = muted ? t('mic.unmute') : t('mic.mute');
  p.replaceChildren(
    el('button', { class: 'me', type: 'button', onClick: (e) => toggleSelfPopover(e.currentTarget) },
      avatar(me, 'sm', { status: true }), el('div', { class: 't' }, el('b', { text: displayName(me) }), el('small', { text: me.statusText || t('status.' + (me.status || 'online')) }))),
    el('div', { class: 'up-split' + (muted ? ' muted' : '') },
      el('button', { class: 'm', type: 'button', 'aria-pressed': info.room ? String(muted) : null, title: info.room ? micLabel : t('mic.menu'), 'aria-label': info.room ? micLabel : t('mic.menu'), onClick: () => (info.room ? toggleMute() : openSettingsFn('voice')) }, icon(muted ? 'i-mic-off' : 'i-mic')),
      el('button', { class: 'c', type: 'button', title: t('mic.menu'), 'aria-label': t('mic.menu'), onClick: (e) => openDevicesMenu(e.currentTarget) }, icon('i-chev-up'))),
    el('button', { class: 'icon-btn gear', type: 'button', title: t('set.title'), 'aria-label': t('set.title'), onClick: () => openSettingsFn() }, icon('i-gear')));
}

/* A barra de abas é montada uma vez só (por idioma) e depois só tem o destaque e o contador atualizados.
   Recriar os botões a cada toque fazia o toque "falhar" no iPhone e deixava a troca de aba dura. */
let tabsLang = null;
function renderTabbar() {
  const tb = els.tabbar;
  const lang = t('nav.home');
  if (tabsLang !== lang || !tb.firstChild) {
    tabsLang = lang;
    // ícones próprios, sem nome (o nome fica para leitores de tela); contorno normal, preenchido na aba atual
    const tab = (name, ic, label) => el('button', { type: 'button', dataset: { v: name }, 'aria-label': label, title: label, onClick: () => { if (D.view.name === name) scrollTopView(); else go(name); } },
      el('span', { class: 'tab-ic' }, ic ? icon(ic, 'ico t-o') : null, ic ? icon(ic + '-f', 'ico t-f') : el('span', { class: 'tab-me' })),
      el('span', { class: 'tab-l', text: label }));
    tb.replaceChildren(tab('home', 't-home', t('nav.home')), tab('games', 't-games', t('nav.games')), tab('profile', null, t('nav.profile')));
  }
  // aba Perfil: a sua foto
  const meSlot = tb.querySelector('.tab-me');
  const meKey = D.me ? (D.me.avatar || '') + '|' + D.me.name + '|' + (D.me.accent || '') : '';
  if (meSlot && meSlot.dataset.k !== meKey) { meSlot.dataset.k = meKey; meSlot.replaceChildren(avatar(D.me, 'xs')); }
  const cur = D.view.name === 'server' ? 'calls' : D.view.name === 'dm' ? 'home' : D.view.name === 'friends' ? 'profile' : D.view.name;
  for (const b of tb.children) {
    if (b.dataset.v === cur) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    if (b.dataset.v === 'friends' || b.dataset.v === 'home' || b.dataset.v === 'games') {
      let n = b.querySelector('.badge-n'); const c = b.dataset.v === 'home' ? totalUnread() + D.incoming.length : b.dataset.v === 'games' ? pendingInvites() : D.incoming.length;
      if (c && !n) { n = el('span', { class: 'badge-n' }); b.append(n); }
      if (n) { if (c) n.textContent = String(c); else n.remove(); }
    }
  }
}
/** Tocar de novo na aba atual volta ao topo, como no iOS. */
function scrollTopView() {
  const node = viewNode(D.view.name); const b = node && node.querySelector(':scope > .view-body');
  if (b) b.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ───────────── telas ───────────── */
/** Limpa a tela, põe a barra superior (nome, subtítulo e chips) e devolve o contêiner onde o conteúdo entra. */
let keepScroll = null;
function pageShell(view, title, sub) {
  const up = D.eventsUp;
  const body = el('div', { class: 'page' });
  // Redesenhar a mesma tela (presença, mensagem nova…) não pode jogar a rolagem para o topo.
  const key = D.view.name + ':' + (D.view.id || '');
  const old = view.querySelector(':scope > .view-body');
  keepScroll = old && view.dataset.k === key && old.scrollTop > 0 ? { view, top: old.scrollTop } : null;
  view.dataset.k = key;
  // celular sem barra de abas: as telas que não são o Início têm "voltar" no topo
  const back = isCompact() && D.view.name !== 'home' && BACK_TO[D.view.name]
    ? el('button', { class: 'tb-back', type: 'button', 'aria-label': t('call.back'), onClick: () => go(BACK_TO[D.view.name]()) }, icon('i-chev-l', 'ico'), el('span', { text: t(BACK_LABEL[D.view.name] || 'nav.home') }))
    : null;
  view.replaceChildren(
    el('header', { class: 'topbar' + (back ? ' has-back' : '') }, back,
      el('div', { class: 'tb-t' }, el('h1', { text: title }), sub ? el('p', { text: sub }) : null),
      // só aparece quando algo está errado (sem conexão)
      up ? null : el('div', { class: 'chips' }, el('span', { class: 'chip' }, el('span', { class: 'dot warn' }), t('conn.off.short')))),
    el('div', { class: 'view-body' }, body));
  return body;
}
const BACK_TO = { games: () => 'home', profile: () => 'home', calls: () => 'home', friends: () => (lastView.name === 'profile' ? 'profile' : 'home') };
const BACK_LABEL = { friends: 'nav.profile' };
let homeQuery = '';
let homeBat = null;
let homeMascot = null;
function renderHome() {
  const v = pageShell(els.vHome, t('hi.hello', { name: displayName(D.me).split(' ')[0] }), null);
  // o morceguinho do lado do "Olá" (o mesmo de sempre: não reinicia a cada redesenho)
  if (!homeMascot) homeMascot = mascot('hm-masc');
  const tt = els.vHome.querySelector('.topbar .tb-t');
  if (tt && D.friends.length) { tt.classList.add('hm-tt'); tt.prepend(homeMascot); }
  // ações: buscar, pedidos de amizade, adicionar amigos
  const search = el('input', { class: 'hm-q', type: 'search', placeholder: t('home.search'), 'aria-label': t('home.search'), value: homeQuery });
  const reqN = D.incoming.length;
  const bar = el('div', { class: 'hm-bar' },
    el('label', { class: 'hm-search' }, icon('i-search', 'ico hm-sic'), search),
    reqN ? el('button', { class: 'hm-ib', type: 'button', title: t('home.reqs'), 'aria-label': t('home.reqs'), onClick: () => { friendsTab = 'pending'; go('friends'); } }, icon('i-inbox'), el('span', { class: 'badge-n', text: String(reqN) })) : null,
    el('button', { class: 'hm-ib', type: 'button', title: t('friends.add'), 'aria-label': t('friends.add'), onClick: () => { friendsTab = 'add'; go('friends'); } }, icon('i-plus')));
  if (D.friends.length && !isCompact()) {
    // computador: a lista de conversas já está na coluna ao lado; aqui só as boas-vindas, sem repetir
    const top = els.vHome.querySelector('.topbar'); if (top) top.hidden = true;
    v.append(el('div', { class: 'hm-welcome' }, homeMascot, el('b', { text: t('hi.hello', { name: displayName(D.me).split(' ')[0] }) }), el('span', { class: 'd', text: t('home.pick') }),
      el('div', { class: 'hm-wb' },
        el('button', { class: 'add-pill', type: 'button', onClick: () => { friendsTab = 'add'; go('friends'); } }, el('span', { class: 'add-ic' }, icon('i-plus', 'i')), el('span', { text: t('home.addFriend') })),
        D.incoming.length ? el('button', { class: 'text-b', type: 'button', onClick: () => { friendsTab = 'pending'; go('friends'); } }, t('home.reqs') + ' (' + D.incoming.length + ')') : null)));
    return;
  }
  if (D.friends.length && isCompact()) { renderHomePhone(v); return; }
  if (!D.friends.length) {
    // vazio: o morceguinho, o que é esta tela e a saída
    v.append(el('div', { class: 'hm-empty' }, homeMascot, el('b', { text: t('home.empty.t') }), el('span', { class: 'd', text: t('home.empty.d') }),
      el('button', { class: 'add-pill', type: 'button', onClick: () => { friendsTab = 'add'; go('friends'); } }, el('span', { class: 'add-ic' }, icon('i-plus', 'i')), el('span', { text: t('home.addFriend') })),
      el('button', { class: 'text-b', type: 'button', onClick: () => copyText(friendLink()).then(() => toast(t('copied'))) }, icon('i-link', 'i'), el('span', { text: t('home.copyInvite') }))));
  } else if (!convsReady) {
    v.append(bar);
    // carregando: o desenho da lista em cinza
    v.append(el('div', { class: 'hm-skel', role: 'status', 'aria-label': t('loading') }, ...[40, 30, 46].map(() => el('div', {}, el('span', { class: 'a' }), el('span', { class: 't' }, el('i'), el('i'))))));
  } else {
    v.append(bar);
    const list = el('div', { class: 'hm-list' });
    const draw = () => {
      const q = homeQuery.trim().toLowerCase();
      const fs = [...D.friends].filter((f) => !q || displayName(f).toLowerCase().includes(q) || (f.username || '').includes(q))
        .sort((a, b) => (isRinging(b.id) - isRinging(a.id)) || (((lastOf(b.id) || {}).at || 0) - ((lastOf(a.id) || {}).at || 0)));
      list.replaceChildren(...fs.map(convRow));
      if (!fs.length) list.append(el('p', { class: 'hm-none', text: t('home.nores') }));
    };
    search.addEventListener('input', () => { homeQuery = search.value; draw(); });
    draw();
    v.append(list);
  }
}
/* Início no celular (como o iMessage/Capy): no topo o morcego (abre Perfil e Configurações), "Echo",
   + (adicionar amigo) e o controle (Jogos). Embaixo, até 4 pessoas fixadas em fotos grandes (quem está ligando,
   online, com recado novo ou falou por último), centralizadas; depois a lista do resto, só com nome e recado. */
function renderHomePhone(v) {
  if (isCompact() && els.tabbar) els.tabbar.hidden = true;
  const top = els.vHome.querySelector('.topbar');
  if (!homeBat) homeBat = mascot('hm-bat-m');
  const reqN = D.incoming.length;
  top.className = 'topbar hm-head';
  top.replaceChildren(
    el('button', { class: 'hm-bat', type: 'button', 'aria-label': t('nav.profile'), title: t('nav.profile'), onClick: () => go('profile') }, homeBat, reqN ? el('span', { class: 'hm-dot', 'aria-label': t('home.reqs') }) : null),
    el('h1', { class: 'hm-title', text: 'Echo' }),
    el('div', { class: 'hm-acts' },
      el('button', { class: 'hm-ib', type: 'button', title: t('friends.add'), 'aria-label': t('friends.add'), onClick: () => { friendsTab = 'add'; go('friends'); } }, icon('i-plus')),
      el('button', { class: 'hm-ib', type: 'button', title: t('nav.games'), 'aria-label': t('nav.games'), onClick: () => go('games') }, icon('t-games'), pendingInvites() ? el('span', { class: 'hm-dot' }) : null)));
  if (!convsReady) {
    v.append(el('div', { class: 'hm-skel', role: 'status', 'aria-label': t('loading') }, ...[40, 30, 46].map(() => el('div', {}, el('span', { class: 'a' }), el('span', { class: 't' }, el('i'), el('i'))))));
    return;
  }
  const at = (f) => ((lastOf(f.id) || {}).at || 0);
  const score = (f) => (isRinging(f.id) ? 8 : 0) + (f.inRoom ? 4 : 0) + (f.online ? 2 : 0) + (unreadOf(f.id) ? 1 : 0);
  const pins = [...D.friends].sort((a, b) => (score(b) - score(a)) || (at(b) - at(a))).slice(0, 4);
  const pinIds = new Set(pins.map((f) => f.id));
  v.append(el('div', { class: 'hm-pins' }, ...pins.map(pinTile)));
  const rest = D.friends.filter((f) => !pinIds.has(f.id)).sort((a, b) => (isRinging(b.id) - isRinging(a.id)) || (at(b) - at(a)));
  if (rest.length) v.append(el('div', { class: 'hm-list flat' }, ...rest.map(convRow)));
}
function pinTile(f) {
  const n = unreadOf(f.id), typing = isTyping(f.id), ringing = isRinging(f.id);
  return el('button', { class: 'pin' + (f.online ? ' on' : '') + (ringing ? ' ringing' : ''), type: 'button', 'aria-label': displayName(f) + (n ? ' · ' + n : ''), onClick: () => (ringing ? answerRing(f.id) : go('dm', f.id)) },
    typing ? el('span', { class: 'pin-typing', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')) : null,
    n && !typing ? el('span', { class: 'pin-new', 'aria-hidden': 'true' }) : null,
    el('span', { class: 'pin-av' }, avatar(f, 'lg')),
    el('span', { class: 'pin-n', text: displayName(f).split(' ')[0] }));
}
/** Quem está me chamando agora (definido pelo toque de chamada em main.js). */
export const isRinging = (uid) => !!(D.ringing && D.ringing.from === uid);

function serverRow(s) {
  const occ = (s.channels || []).reduce((n, c) => n + occupants('c:' + c.id).length, 0);
  return el('button', { class: 'conv-row', type: 'button', onClick: () => go('server', s.id) },
    srvTile(s, 'md'),
    el('span', { class: 'grow' }, el('span', { class: 'cr-top' }, el('b', { text: s.name })),
      el('span', { class: 'cr-bot' }, el('small', { text: occ ? t('srv.live', { n: occ }) : t('srv.n', { n: s.members.length }) }))),
    icon('i-chev', 'ico cr-chev'));
}

/** Linha de conversa (como no app de Mensagens): foto, nome, última mensagem, hora e não lidas. */
function convRow(f) {
  const last = lastOf(f.id), n = unreadOf(f.id), typing = isTyping(f.id);
  const when = last ? new Intl.DateTimeFormat(document.documentElement.lang || 'pt-BR', Date.now() - last.at < 86400000 ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit' }).format(last.at) : '';
  // um sinal de status só: a bolinha na foto já diz "online"; o texto embaixo é a conversa (ou "em ligação")
  const prev = typing ? t('chat.typing') : f.inRoom ? t('status.incall') : last ? (last.author === D.me.id && last.kind !== 'call' ? t('you') + ': ' : '') + preview(last) : (f.statusText || '');
  const room = dmRoom(D.me.id, f.id);
  const ringing = isRinging(f.id), waiting = !ringing && f.inRoom === room && currentRoom() !== room, inIt = currentRoom() === room;
  // ação à direita: atender (está te ligando), entrar (já está na ligação esperando), voltar (você está nela) ou ligar
  const act = ringing || waiting
    ? el('button', { class: 'cr-act go', type: 'button', onClick: (e) => { e.stopPropagation(); answerRing(f.id, room); } }, icon('i-phone'), el('span', { text: ringing ? t('call.answer') : t('call.join') }))
    : inIt ? el('button', { class: 'cr-act live', type: 'button', onClick: (e) => { e.stopPropagation(); go('room'); } }, icon('i-mic'), el('span', { text: t('call.back') }))
      : el('button', { class: 'cr-act', type: 'button', title: t('friends.call'), 'aria-label': t('friends.call') + ' ' + displayName(f), onClick: (e) => { e.stopPropagation(); callFriend(f); } }, icon('i-phone'));
  const sub = ringing ? t('call.ringing.you') : waiting ? t('call.waiting.you') : prev;
  return el('div', { class: 'conv-row' + (n ? ' has-unread' : '') + (ringing || waiting ? ' calling' : ''), role: 'button', tabindex: '0', onClick: () => go('dm', f.id), onKeydown: (e) => { if (e.key === 'Enter') go('dm', f.id); } },
    avatar(f, 'md', { status: true }),
    el('span', { class: 'grow' }, el('span', { class: 'cr-top' }, el('b', { text: displayName(f) }), el('time', { text: ringing || waiting ? '' : when })),
      el('span', { class: 'cr-bot' }, el('small', { class: typing ? 'typing' : (ringing || waiting) ? 'calling' : f.inRoom ? 'live' : null, text: sub }), n ? el('span', { class: 'unread', text: n > 99 ? '99+' : String(n) }) : null)),
    act);
}
/** Atender: entra na ligação de quem chamou (para o toque). */
export async function answerRing(uid, room) {
  emit('ring-stop', { from: uid, answered: true });
  await callRoom(room || dmRoom(D.me.id, uid));
}

function renderDm() {
  const id = D.view.id;
  mountChat(els.vDm, id, { onBack: isCompact() ? () => go('home') : null });
}

const emptyTile = () => el('span', { class: 'tile' }, el('img', { src: '/logo.svg', alt: '' }));

function serverCard(s) {
  const occ = (s.channels || []).reduce((n, c) => n + occupants('c:' + c.id).length, 0);
  return el('div', { class: 'card' },
    el('div', { class: 'top' }, srvTile(s, 'md'), el('div', { class: 'name' }, s.name, el('small', { text: t('srv.n', { n: s.members.length }) }))),
    occ ? el('span', { class: 'badge-live', text: t('srv.live', { n: occ }) }) : null,
    el('button', { class: 'btn', type: 'button', onClick: () => go('server', s.id) }, t('open')));
}

function friendRow(f) {
  const more = () => openModal(displayName(f), el('div', { class: 'fr-menu' },
    el('button', { class: 'fr-mi', type: 'button', onClick: () => { closeModal(); openProfile(f.id); } }, icon('i-user'), el('span', { text: t('pf.view') })),
    el('button', { class: 'fr-mi danger', type: 'button', onClick: async () => {
      closeModal();
      if (await confirmBox(t('friends.remove'), t('friends.remove.q', { name: displayName(f) }), t('friends.remove'))) { await api('DELETE', `/friends/${f.id}`).catch(() => {}); await refreshFriends(); renderAll(); }
    } }, icon('i-trash'), el('span', { text: t('friends.remove') }))));
  return el('div', { class: 'fr-row' },
    el('button', { class: 'fr-main', type: 'button', onClick: () => openProfile(f.id) }, avatar(f, 'md', { status: true }),
      el('span', { class: 'fr-t' }, el('b', { text: displayName(f) }), el('small', { text: f.inRoom ? t('status.incall') : f.statusText || (f.online === false ? t('status.offline') : t('status.online')) }))),
    el('button', { class: 'fr-b', type: 'button', title: t('friends.call'), 'aria-label': t('friends.call'), onClick: () => callFriend(f) }, icon('i-phone')),
    el('button', { class: 'fr-b ghost', type: 'button', title: t('more'), 'aria-label': t('more'), onClick: more }, icon('i-more')));
}

function renderFriends() {
  const v = pageShell(els.vFriends, t('nav.friends'), null);
  const pend = D.incoming.length + D.outgoing.length;
  const tabs = el('div', { class: 'seg tabs', role: 'tablist' });
  if (friendsTab === 'online') friendsTab = 'all';
  for (const [id, label, n] of [['all', t('friends.all')], ['pending', t('friends.pending'), D.incoming.length], ['add', t('friends.add')]]) {
    tabs.append(el('button', { type: 'button', role: 'tab', 'aria-selected': String(friendsTab === id), onClick: () => { friendsTab = id; renderFriends(); } }, label, n ? el('span', { class: 'count', text: n }) : null));
  }
  if (isCompact()) v.append(el('button', { class: 'pg-back', type: 'button', onClick: () => go('profile') }, icon('i-back'), el('span', { text: t('nav.profile') })));
  v.append(tabs);
  void pend;

  if (friendsTab === 'all' || friendsTab === 'online') {
    const list = D.friends.filter((f) => friendsTab === 'all' || f.online);
    if (!list.length) v.append(el('div', { class: 'empty' }, el('b', { text: friendsTab === 'all' ? t('friends.none') : t('friends.none.online') }),
      friendsTab === 'all' ? el('button', { class: 'btn primary pill', type: 'button', onClick: () => { friendsTab = 'add'; renderFriends(); } }, t('friends.add')) : null));
    else {
      const sorted = [...list].sort((a, b) => ((b.online !== false) - (a.online !== false)) || displayName(a).localeCompare(displayName(b)));
      v.append(el('div', { class: 'fr-list' }, sorted.map(friendRow)));
    }
  } else if (friendsTab === 'pending') {
    if (!pend) v.append(el('div', { class: 'empty' }, el('b', { text: t('friends.pending.none') })));
    if (D.incoming.length) {
      v.append(el('div', { class: 'section-h', text: t('friends.incoming') }));
      v.append(el('div', { class: 'list' }, D.incoming.map((r) => el('div', { class: 'list-row' }, avatar(r.from, 'md'),
        el('div', { class: 'grow' }, el('b', { text: displayName(r.from) }), el('small', { text: '@' + r.from.username })),
        el('div', { class: 'acts' },
          el('button', { class: 'btn sm primary', type: 'button', onClick: async () => { await api('POST', `/friends/${r.from.id}/accept`).catch((e) => toast(tErr(e.code))); await refreshFriends(); renderAll(); } }, icon('i-check'), t('accept')),
          el('button', { class: 'btn sm', type: 'button', onClick: async () => { await api('DELETE', `/friends/${r.from.id}`).catch(() => {}); await refreshFriends(); renderAll(); } }, t('decline')))))));
    }
    if (D.outgoing.length) {
      v.append(el('div', { class: 'section-h', text: t('friends.outgoing') }));
      v.append(el('div', { class: 'list' }, D.outgoing.map((r) => el('div', { class: 'list-row' }, avatar(r.to, 'md'),
        el('div', { class: 'grow' }, el('b', { text: displayName(r.to) }), el('small', { text: '@' + r.to.username })),
        el('button', { class: 'btn sm', type: 'button', onClick: async () => { await api('DELETE', `/friends/${r.to.id}`).catch(() => {}); await refreshFriends(); renderAll(); } }, t('cancel'))))));
    }
  } else {
    const inp = el('input', { type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', maxlength: '24', placeholder: t('friends.add.ph') });
    const msg = el('p', { class: 'msg', role: 'status' });
    const send = async () => {
      const username = inp.value.trim().replace(/^@/, '');
      if (!username) return;
      msg.className = 'msg'; msg.textContent = '';
      try {
        const j = await api('POST', '/friends', { username });
        msg.className = 'msg ok'; msg.textContent = j.status === 'friends' ? t('friends.now') : t('friends.sent');
        inp.value = ''; await refreshFriends(); renderSide(); renderRail();
      } catch (e) { msg.textContent = tErr(e.code); }
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    v.append(el('div', { class: 'set-card' },
      el('h3', { text: t('friends.add.t') }), el('p', { class: 'muted', text: t('friends.add.d') }),
      el('div', { class: 'row' }, el('div', { class: 'grow' }, inp), el('button', { class: 'btn primary', type: 'button', onClick: send, text: t('friends.send') })), msg));
    v.append(el('div', { class: 'set-card' },
      el('h3', { text: t('friends.link.t') }), el('p', { class: 'muted', text: t('friends.link.d') }),
      el('div', { class: 'row' }, el('input', { type: 'text', readonly: true, value: friendLink(), 'aria-label': t('friends.link.t') }),
        el('button', { class: 'btn', type: 'button', onClick: () => copyText(friendLink()).then(() => toast(t('copied'))) }, icon('i-copy'), t('copy')))));
  }
}

/* Ligações, no jeito do app FaceTime: um cartão por amigo (foto grande, nome e o botão de ligar)
   e o botão verde "Nova ligação" embaixo. */
function renderCalls() {
  const v = pageShell(els.vServers, t('nav.calls'), null);
  // botão + (nova ligação) ao lado do título
  const tb = els.vServers.querySelector('.topbar');
  if (tb) tb.append(el('button', { class: 'hm-ib tb-add', type: 'button', title: t('calls.new'), 'aria-label': t('calls.new'), onClick: newCall }, icon('i-plus')));
  const fs = [...D.friends].sort((a, b) => (!!b.inRoom - !!a.inRoom) || ((b.online !== false) - (a.online !== false)) || displayName(a).localeCompare(displayName(b)));
  if (!fs.length) {
    v.append(el('div', { class: 'empty' }, el('b', { text: t('home.empty.t') }), el('span', { text: t('calls.empty') }),
      el('button', { class: 'btn primary pill', type: 'button', onClick: () => { friendsTab = 'add'; go('friends'); } }, t('friends.add'))));
    return;
  }
  const mine = callInfo().room;
  v.append(el('div', { class: 'cl-list' }, fs.map((f) => {
    const room = dmRoom(D.me.id, f.id), here = mine === room;
    const sub = here ? t('calls.here') : f.inRoom ? t('status.incall') : f.online === false ? t('status.offline') : t('status.online');
    return el('div', { class: 'cl-row' + (here ? ' live' : '') + (f.online === false ? ' off' : '') },
      el('button', { class: 'cl-open', type: 'button', onClick: () => go('dm', f.id) }, avatar(f, 'md', { decoration: false }),
        el('span', { class: 'cl-t' }, el('b', { text: displayName(f) }), el('small', { text: sub }))),
      el('button', { class: 'cl-call', type: 'button', title: t('friends.call'), 'aria-label': t('friends.call') + ' ' + displayName(f), onClick: () => (here ? goRoom() : callFriend(f)) }, icon('i-phone')));
  })));
}
function newCall() {
  const list = [...D.friends].sort((a, b) => ((b.online !== false) - (a.online !== false)) || displayName(a).localeCompare(displayName(b)));
  openModal(t('calls.new'), el('div', { class: 'gm-pick' }, ...list.map((f) => el('button', { class: 'gm-prow', type: 'button', onClick: () => { closeModal(); callFriend(f); } },
    avatar(f, 'md', { status: true }), el('div', { class: 'gm-pwho' }, el('b', { text: displayName(f) }), el('small', { text: '@' + f.username })),
    el('span', { class: 'ftp-mini' }, icon('t-calls-f'))))));
}

function renderServers() {
  const v = pageShell(els.vServers, t('nav.servers'), t('srv.sub'));
  v.append(
    el('div', { class: 'row wrap' },
      el('button', { class: 'btn primary pill', type: 'button', onClick: openCreateServer }, icon('i-plus'), t('srv.create')),
      el('button', { class: 'btn pill', type: 'button', onClick: () => openJoinServer() }, icon('i-link'), t('srv.join'))));
  v.append(el('div', { class: 'section-h' }));
  if (!D.servers.length) v.append(el('div', { class: 'empty' }, emptyTile(), el('b', { text: t('srv.none') })));
  else v.append(el('div', { class: 'cards' }, D.servers.map(serverCard)));
}

function renderServer() {
  const s = serverById(D.view.id);
  if (!s) return;
  const v = pageShell(els.vServer, s.name, t('srv.n', { n: s.members.length }));
  const own = s.ownerId === D.me.id;
  v.append(el('div', { class: 'srv-head' }, srvTile(s, 'lg'),
    el('div', { class: 'grow' }, el('span', { class: 'muted', text: t('srv.channels.n', { n: (s.channels || []).length }) })),
    el('button', { class: 'btn pill', type: 'button', onClick: () => openInvite(s) }, icon('i-link'), t('srv.invite')),
    el('button', { class: 'btn pill', type: 'button', onClick: () => openServerSettings(s) }, icon('i-gear'), t('srv.settings'))));
  v.append(el('div', { class: 'section-h', text: t('srv.rooms') }));
  v.append(el('div', { class: 'stack' }, s.channels.map((c) => {
    const room = 'c:' + c.id, occ = occupants(room);
    return el('div', { class: 'room-card' }, icon('i-speaker'),
      el('div', { class: 'grow' }, el('b', { text: c.name }), occ.length ? el('div', { class: 'occ' }, occ.map((u) => avatar(u, 'xs', { decoration: false }))) : el('small', { class: 'muted', text: t('srv.empty') })),
      el('button', { class: 'btn primary pill', type: 'button', onClick: () => callRoom(room) }, currentRoom() === room ? t('open') : t('srv.enter')));
  })));
  v.append(el('div', { class: 'section-h', text: t('srv.members') }));
  v.append(el('div', { class: 'list' }, s.members.map((m) => el('div', { class: 'list-row' }, avatar(m, 'md', { status: true }),
    el('div', { class: 'grow' }, el('b', { text: displayName(m) + (m.id === s.ownerId ? ' 👑' : '') }), el('small', { text: '@' + m.username + ' · ' + (m.id === D.me.id ? t('you') : statusText(m)) })),
    el('div', { class: 'acts' },
      m.id !== D.me.id && isFriend(m.id) ? el('button', { class: 'btn sm', type: 'button', onClick: () => callFriend(m) }, icon('i-phone'), t('friends.call')) : null,
      m.id !== D.me.id && !isFriend(m.id) ? el('button', { class: 'btn sm', type: 'button', onClick: () => addFriendQuick(m) }, icon('i-plus'), t('friends.add')) : null,
      own && m.id !== D.me.id ? el('button', { class: 'icon-btn', type: 'button', title: t('srv.kick'), 'aria-label': t('srv.kick'), onClick: async () => {
        if (await confirmBox(t('srv.kick'), t('srv.kick.q', { name: displayName(m) }), t('srv.kick'))) { await api('DELETE', `/servers/${s.id}/members/${m.id}`).catch((e) => toast(tErr(e.code))); await refreshServers(); renderAll(); }
      } }, icon('i-x')) : null)))));
}

async function addFriendQuick(u) {
  try { await api('POST', '/friends', { username: u.username }); toast(t('friends.sent')); await refreshFriends(); renderAll(); } catch (e) { toast(tErr(e.code)); }
}

/* ───────────── perfil (cartão e menu) ───────────── */
export function showProfileModal(u) {
  const body = el('div', { class: 'stack' }, profileCard(u));
  const acts = el('div', { class: 'actions' });
  if (u.id !== D.me.id) {
    if (isFriend(u.id)) acts.append(el('button', { class: 'btn primary', type: 'button', onClick: () => { closeModal(); callFriend(u); } }, icon('i-phone'), t('friends.call')));
    else acts.append(el('button', { class: 'btn primary', type: 'button', onClick: () => { addFriendQuick(u); closeModal(); } }, icon('i-plus'), t('friends.add')));
  } else acts.append(el('button', { class: 'btn primary', type: 'button', onClick: () => { closeModal(); openSettingsFn('profile'); } }, icon('i-pen'), t('profile.edit')));
  body.append(acts);
  openModal(t('profile'), body);
}

let popOpen = null;
export function closePopover() { const p = $('#pop'); if (!p) return; p.hidden = true; popOpen = null; }

/** Aba Perfil (celular): o mesmo conteúdo do menu do perfil, mas como tela de verdade. */
function renderProfile() {
  const v = pageShell(els.vProfile, '', null);
  const me = D.me;
  // minimalista: foto, nome, @, recado e uma lista simples
  const li = (label, run, extra, cls) => el('button', { class: 'pfl' + (cls ? ' ' + cls : ''), type: 'button', onClick: run }, el('span', { class: 'grow', text: label }), extra === undefined ? icon('i-chev', 'ico chev') : extra);
  const cnt = (n, badge) => el('span', { class: 'pfl-v' + (badge ? ' on' : ''), text: String(n) });
  v.append(...[
    el('section', { class: 'pfm2' },
      el('button', { class: 'pfm2-av', type: 'button', 'aria-label': t('profile.edit'), onClick: () => openSettingsFn('profile') }, avatar(me, 'xl', { decoration: false })),
      el('h1', { text: displayName(me) }),
      el('p', { class: 'pfm2-u', text: '@' + me.username }),
      el('button', { class: 'pfm2-st' + (me.statusText ? '' : ' empty'), type: 'button', onClick: () => openStatusEditor() }, me.statusText || t('pf.addStatus')),
      me.bio ? el('p', { class: 'pfm2-bio', text: me.bio }) : null,
      el('button', { class: 'pfm2-edit', type: 'button', onClick: () => openSettingsFn('profile') }, t('profile.edit'))),
    el('div', { class: 'pfl-g' },
      li(t('nav.friends'), () => go('friends'), el('span', { class: 'pfl-r' }, D.incoming.length ? cnt(D.incoming.length, true) : cnt(D.friends.length), icon('i-chev', 'ico chev'))),
      li(t('pf.invite'), () => copyText(friendLink()).then(() => toast(t('copied'))), icon('i-link', 'ico chev')),
      li(t('set.title'), () => openSettingsFn())),
    el('div', { class: 'pfl-g' },
      ...(D.accounts || []).map((a) => li('@' + a.username, () => emit('switch-account', a.id), el('span', { class: 'pfl-v', text: t('acc.use') }))),
      li(t('acc.add'), () => emit('add-account'), null),
      li(t('auth.logout'), () => emit('logout'), null, 'danger'))].filter(Boolean));
}

function toggleSelfPopover(anchor, sheet) {
  const p = $('#pop');
  if (!p.hidden && popOpen === anchor) { closePopover(); return; }
  if (isCompact()) { go('profile'); return; }
  popOpen = anchor;
  p.className = 'popover' + (sheet ? ' sheet' : '');
  fillSelfMenu(p);
  p.hidden = false;
  if (!p.classList.contains('sheet')) {
    const r = anchor.getBoundingClientRect();
    p.style.left = Math.max(10, Math.min(r.left, innerWidth - p.offsetWidth - 10)) + 'px';
    p.style.bottom = (innerHeight - r.top + 8) + 'px';
    p.style.top = 'auto';
  }
}

function fillSelfMenu(p) {
  const me = D.me;
  p.replaceChildren(profileCard(me, { self: true }));
  const grid = el('div', { class: 'status-grid', hidden: true });
  for (const s of []) {
    grid.append(el('button', { class: 'status', type: 'button', role: 'radio', dataset: { status: s }, 'aria-checked': String(me.status === s), onClick: async () => {
      try { const j = await api('PATCH', '/me', { status: s }); remember(j.user); closePopover(); renderAll(); } catch (e) { toast(tErr(e.code)); }
    } }, el('i'), t('status.' + s)));
  }
  const item = (ic, label, run, cls) => el('li', {}, el('button', { type: 'button', class: cls, onClick: () => { closePopover(); run(); } }, icon(ic), label));
  void grid;
  p.append(el('ul', { class: 'pop-menu' },
    item('i-user', t('pf.view'), () => openProfile(me.id)),
    item('i-pen', t('profile.edit'), () => openSettingsFn('profile')),
    item('i-link', t('friends.link.copy'), () => copyText(friendLink()).then(() => toast(t('copied')))),
    item('i-gear', t('set.title'), () => openSettingsFn()),
    ...(D.accounts || []).map((a) => el('li', {}, el('button', { type: 'button', class: 'acc-item', onClick: () => { closePopover(); emit('switch-account', a.id); } }, avatar(a, 'xs'), t('acc.to', { name: displayName(a) })))),
    item('i-plus', t('acc.add'), () => emit('add-account')),
    item('i-logout', t('auth.logout'), () => emit('logout'), 'danger')));
}

/* ───────────── servidores: criar, entrar, convidar, ajustar ───────────── */
function iconPicker(state) {
  const wrap = el('div', { class: 'stack' });
  const emojiRow = el('div', { class: 'srv-ic-pick' });
  const draw = () => {
    emojiRow.replaceChildren(...EMOJIS.map((e) => el('button', { class: 'emoji-btn', type: 'button', 'aria-pressed': String(state.icon === e), onClick: () => { state.icon = e; draw(); } }, e)));
    emojiRow.append(el('label', { class: 'btn sm' }, icon('i-camera'), t('srv.photo'),
      el('input', { type: 'file', accept: 'image/*', class: 'sr-only', onChange: async (ev) => {
        const f = ev.target.files[0]; if (!f) return;
        try { state.icon = await imageToDataUrl(f, { w: 128, h: 128, max: 120000 }); draw(); } catch { toast(t('err.image')); }
      } })));
  };
  draw();
  const swatches = el('div', { class: 'swatches' });
  const draw2 = () => swatches.replaceChildren(...COLORS.map((c) => { const b = el('button', { class: 'swatch', type: 'button', 'aria-label': c, 'aria-pressed': String(state.color === c), onClick: () => { state.color = c; draw2(); } }); b.style.setProperty('--c', c); return b; }));
  draw2();
  wrap.append(el('span', { class: 'sub', text: t('srv.icon') }), emojiRow, el('span', { class: 'sub', text: t('srv.color') }), swatches);
  return wrap;
}

function openAddServer() {
  const body = el('div', { class: 'stack' },
    el('button', { class: 'btn primary big', type: 'button', onClick: () => { closeModal(); openCreateServer(); } }, icon('i-plus'), t('srv.create')),
    el('button', { class: 'btn big', type: 'button', onClick: () => { closeModal(); openJoinServer(); } }, icon('i-link'), t('srv.join')));
  openModal(t('srv.add'), body);
}

export function openCreateServer() {
  const state = { icon: '🍿', color: COLORS[0] };
  const name = el('input', { type: 'text', maxlength: '32', placeholder: t('srv.name.ph'), value: t('srv.name.default', { name: displayName(D.me) }) });
  const msg = el('p', { class: 'msg' });
  const body = el('div', { class: 'stack' },
    el('label', { class: 'field' }, el('span', { text: t('srv.name') }), name), iconPicker(state), msg,
    el('div', { class: 'actions' },
      el('button', { class: 'btn', type: 'button', text: t('cancel'), onClick: closeModal }),
      el('button', { class: 'btn primary', type: 'button', text: t('srv.create'), onClick: async () => {
        try {
          const s = await api('POST', '/servers', { name: name.value.trim(), icon: state.icon, color: state.color });
          await refreshServers(); closeModal(); go('server', s.id);
        } catch (e) { msg.textContent = tErr(e.code); }
      } })));
  openModal(t('srv.create'), body);
  setTimeout(() => name.select(), 50);
}

export function openJoinServer(prefill) {
  const code = el('input', { type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: t('srv.code.ph'), value: prefill || '' });
  const msg = el('p', { class: 'msg' });
  const preview = el('div', { class: 'stack' });
  const parse = (s) => { const m = /([A-Za-z0-9]{10})\s*$/.exec(String(s).trim().replace(/\/+$/, '')); return m ? m[1].toUpperCase() : ''; };
  const look = async () => {
    msg.textContent = ''; preview.replaceChildren();
    const c = parse(code.value);
    if (!c) { msg.textContent = tErr('bad_code'); return; }
    try {
      const j = await api('GET', `/invites/${c}`);
      preview.append(el('div', { class: 'card' }, el('div', { class: 'top' }, srvTile(j.server, 'md'), el('div', { class: 'name' }, j.server.name, el('small', { text: t('srv.n', { n: j.memberCount }) }))),
        j.alreadyMember ? el('p', { class: 'muted', text: t('srv.already') }) :
          el('button', { class: 'btn primary', type: 'button', onClick: async () => {
            try { const s = await api('POST', `/invites/${c}/join`); await refreshServers(); closeModal(); go('server', s.id); } catch (e) { msg.textContent = tErr(e.code); }
          } }, t('srv.join.go'))));
    } catch (e) { msg.textContent = tErr(e.code); }
  };
  code.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); look(); } });
  openModal(t('srv.join'), el('div', { class: 'stack' }, el('p', { class: 'muted', text: t('srv.join.d') }), el('div', { class: 'row' }, el('div', { class: 'grow' }, code), el('button', { class: 'btn', type: 'button', onClick: look, text: t('srv.look') })), msg, preview));
  if (prefill) look();
}

async function openInvite(s) {
  const list = el('div', { class: 'list' });
  const draw = async () => {
    list.replaceChildren();
    let invites = [];
    try { const j = await api('GET', `/servers/${s.id}/invites`); invites = Array.isArray(j) ? j : j.invites || []; } catch {}
    if (!invites.length) list.append(el('div', { class: 'list-row' }, el('span', { class: 'muted', text: t('srv.invites.none') })));
    for (const iv of invites) {
      list.append(el('div', { class: 'list-row' },
        el('div', { class: 'grow' }, el('span', { class: 'inv-code', text: iv.code }), el('small', { text: ' ' + t('srv.inv.uses', { n: iv.uses, max: iv.maxUses || '∞' }) + (iv.expiresAt ? ' · ' + t('srv.inv.exp', { d: new Date(iv.expiresAt).toLocaleDateString() }) : '') })),
        el('button', { class: 'btn sm primary', type: 'button', onClick: () => copyText(inviteLink(iv.code)).then(() => toast(t('copied'))) }, icon('i-copy'), t('copy')),
        s.ownerId === D.me.id ? el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('srv.inv.revoke'), onClick: async () => { await api('DELETE', `/servers/${s.id}/invites/${iv.code}`).catch(() => {}); draw(); } }, icon('i-trash')) : null));
    }
  };
  const uses = el('select', {}, el('option', { value: '', text: t('srv.inv.unl') }), el('option', { value: '1', text: t('srv.inv.once') }), el('option', { value: '5', text: t('srv.inv.five') }));
  const ttl = el('select', {}, el('option', { value: '', text: t('srv.inv.never') }), el('option', { value: '24', text: t('srv.inv.day') }), el('option', { value: '168', text: t('srv.inv.week') }));
  const body = el('div', { class: 'stack' }, el('p', { class: 'muted', text: t('srv.inv.d') }),
    el('div', { class: 'row' }, el('div', { class: 'grow' }, uses), el('div', { class: 'grow' }, ttl)),
    el('button', { class: 'btn primary', type: 'button', onClick: async () => {
      try {
        const b = {}; if (uses.value) b.maxUses = Number(uses.value); if (ttl.value) b.ttlHours = Number(ttl.value);
        const iv = await api('POST', `/servers/${s.id}/invites`, b);
        copyText(inviteLink(iv.code)).then(() => toast(t('srv.inv.copied'))); draw();
      } catch (e) { toast(tErr(e.code)); }
    } }, icon('i-link'), t('srv.inv.new')), list);
  openModal(t('srv.invite'), body, { wide: true });
  draw();
}

function openServerSettings(s) {
  const own = s.ownerId === D.me.id;
  const state = { icon: s.icon, color: s.color || COLORS[0] };
  const name = el('input', { type: 'text', maxlength: '32', value: s.name, disabled: !own });
  const msg = el('p', { class: 'msg' });
  const chList = el('div', { class: 'list' });
  const drawCh = () => {
    chList.replaceChildren(...s.channels.map((c) => {
      const inp = el('input', { type: 'text', maxlength: '24', value: c.name, disabled: !own, 'aria-label': t('srv.room') });
      return el('div', { class: 'list-row' }, icon('i-speaker'), el('div', { class: 'grow' }, inp),
        own ? el('button', { class: 'btn sm', type: 'button', text: t('save'), onClick: async () => {
          try { const r = await api('PATCH', `/servers/${s.id}/channels/${c.id}`, { name: inp.value.trim() }); Object.assign(s, r); await refreshServers(); renderAll(); toast(t('saved')); } catch (e) { toast(tErr(e.code)); }
        } }) : null,
        own && s.channels.length > 1 ? el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('srv.room.del'), onClick: async () => {
          try { await api('DELETE', `/servers/${s.id}/channels/${c.id}`); await refreshServers(); const ns = serverById(s.id); if (ns) { s.channels = ns.channels; drawCh(); } renderAll(); } catch (e) { toast(tErr(e.code)); }
        } }, icon('i-trash')) : null);
    }));
  };
  drawCh();
  const body = el('div', { class: 'stack' },
    own && el('label', { class: 'field' }, el('span', { text: t('srv.name') }), name),
    own && iconPicker(state),
    own && el('button', { class: 'btn primary', type: 'button', text: t('save'), onClick: async () => {
      try { await api('PATCH', `/servers/${s.id}`, { name: name.value.trim(), icon: state.icon, color: state.color }); await refreshServers(); renderAll(); toast(t('saved')); } catch (e) { msg.textContent = tErr(e.code); }
    } }),
    msg,
    el('h3', { class: 'sub', text: t('srv.rooms') }), chList,
    own && el('button', { class: 'btn', type: 'button', onClick: async () => {
      try { await api('POST', `/servers/${s.id}/channels`, { name: t('srv.room.new', { n: s.channels.length + 1 }) }); await refreshServers(); const ns = serverById(s.id); s.channels = ns.channels; drawCh(); renderAll(); } catch (e) { toast(tErr(e.code)); }
    } }, icon('i-plus'), t('srv.room.add')),
    el('div', { class: 'actions' },
      own ? el('button', { class: 'btn danger', type: 'button', onClick: async () => {
        if (await confirmBox(t('srv.delete'), t('srv.delete.q', { name: s.name }), t('srv.delete'))) { try { await api('DELETE', `/servers/${s.id}`); if (channelInfo(currentRoom())?.server.id === s.id) await leaveRoom(); await refreshServers(); go('home'); } catch (e) { toast(tErr(e.code)); } }
      } }, icon('i-trash'), t('srv.delete'))
        : el('button', { class: 'btn danger', type: 'button', onClick: async () => {
          if (await confirmBox(t('srv.leave'), t('srv.leave.q', { name: s.name }), t('srv.leave'))) { try { await api('POST', `/servers/${s.id}/leave`); if (channelInfo(currentRoom())?.server.id === s.id) await leaveRoom(); await refreshServers(); go('home'); } catch (e) { toast(tErr(e.code)); } }
        } }, icon('i-logout'), t('srv.leave'))));
  openModal(t('srv.settings'), body, { wide: true });
}

/* ───────────── desenhar tudo ───────────── */
const viewNode = (name) => ({ home: els.vHome, friends: els.vFriends, calls: els.vServers, games: els.vGames, server: els.vServer, room: els.vRoom, profile: els.vProfile, dm: els.vDm })[name];
let softPending = false;
export function renderAll() {
  if (!D.me || !els.app) return;
  softPending = false;
  if (D.view.name === 'profile' && !isCompact()) D.view = { name: 'home' };
  if (D.view.name === 'dm' && !isFriend(D.view.id)) D.view = { name: 'home' };
  const v = D.view.name;
  els.app.classList.toggle('in-room', v === 'room');
  els.app.classList.toggle('in-dm', v === 'dm');
  document.documentElement.classList.toggle('v-games', v === 'games');
  for (const k of ['home', 'friends', 'calls', 'games', 'server', 'room', 'profile', 'dm']) { const node = viewNode(k); if (node) node.hidden = k !== v; }
  if (v !== 'dm') unmountChat(els.vDm);
  renderRail(); renderSide(); renderCallbar(); renderUserPanel(); renderTabbar();
  if (els.tabbar) els.tabbar.hidden = isCompact();
  keepScroll = null;
  if (v === 'home') renderHome(); else if (v === 'friends') renderFriends(); else if (v === 'calls') renderCalls(); else if (v === 'games') renderGames(els.vGames); else if (v === 'server') renderServer(); else if (v === 'room') renderCall(); else if (v === 'profile') renderProfile(); else if (v === 'dm') renderDm();
  if (keepScroll) { const b = keepScroll.view.querySelector(':scope > .view-body'); if (b) b.scrollTop = keepScroll.top; keepScroll = null; }
}
/** Atualização que veio de fora (presença, conexão): se a pessoa está digitando, espera ela sair do campo. */
export function renderSoft() {
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && els.app && els.app.contains(a) && D.view.name !== 'room') {
    if (!softPending) { softPending = true; a.addEventListener('blur', () => { if (softPending) renderAll(); }, { once: true }); }
    return;
  }
  renderAll();
}

export function applyPresence(m) {
  const u = D.users.get(m.id);
  if (u) { u.online = m.online; u.status = m.status; u.inRoom = m.inRoom || null; }
  emit('users');
  renderSoft();
}

export function initShell(ev) {
  events = ev;
  Object.assign(els, {
    app: $('#app'), rail: $('#rail'), sideBody: $('#side-body'), callbar: $('#callbar'), userpanel: $('#userpanel'), tabbar: $('#tabbar'), callPill: $('#call-pill'),
    vHome: $('#view-home'), vFriends: $('#view-friends'), vServers: $('#view-servers'), vGames: $('#view-games'), vServer: $('#view-server'), vRoom: $('#view-room'), vProfile: $('#view-profile'), vDm: $('#view-dm'),
  });
  els.callPill.addEventListener('click', goRoom);
  on('call', () => renderAll());
  on('events', () => renderSoft());
  // Girar o celular ou redimensionar a janela entre celular e computador: a aba Perfil só existe no celular.
  let wasCompact = isCompact();
  addEventListener('resize', () => { const c = isCompact(); if (c !== wasCompact) { wasCompact = c; if (D.view.name === 'profile' || !c) renderAll(); } });
  on('room-back', () => go(lastView.name === 'room' ? 'home' : lastView.name, lastView.id));
  // Desligou: sai da tela da chamada e volta para a conversa (ligação direta) ou para onde estava.
  on('call-left', (d) => {
    if (D.view.name !== 'room') { renderAll(); return; }
    const room = d && d.room;
    const other = room && room.startsWith('d:') ? room.split(':').slice(1).find((x) => x !== D.me.id) : null;
    if (other && isFriend(other)) go('dm', other); else go(lastView.name === 'room' ? 'home' : lastView.name, lastView.id);
  });
  initChat({ events: ev, go, callFriend, room: currentRoom });
  initGames({ events: ev, go, pageShell });
  on('games-redraw', () => { renderRail(); renderTabbar(); if (D.view.name === 'games') renderSoft(); });
  on('call-ended', (x) => { if (x && x.peerId && /^d:/.test(x.room || '')) callOutcome('ended', x.peerId, x.ms); });
  on('call-failed', (x) => { if (x && x.to) callOutcome(x.why === 'declined' ? 'declined' : 'noanswer', x.to); });
  on('chat-unread', () => { renderSide(); renderTabbar(); if (D.view.name === 'home') renderSoft(); });
  on('chat-typing', () => { renderSide(); if (D.view.name === 'home') renderSoft(); });
  document.addEventListener('click', (e) => { const p = $('#pop'); if (!p.hidden && !p.contains(e.target) && !(popOpen && popOpen.contains(e.target)) && !e.target.closest('.tabbar')) closePopover(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopover(); });
}
export { friendLink, inviteLink, store, $$, loadConvs, onChatEvent };
