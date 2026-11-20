'use strict';
// Controle remoto. Quem assiste pede ("Pedir controle"), quem transmite pelo Echo para computador permite,
// e daí os movimentos do mouse e as teclas de quem assiste viram mouse e teclado no computador de quem transmite.
// Só funciona com a tela inteira (não com uma janela) e quem transmite pode parar a qualquer hora (Ctrl+Alt+Esc).
import { el, icon, toast, displayName } from './util.js';
import { D, on, userById } from './state.js';
import { t } from './i18n.js';
import { sendCtl, peerMetaInfo, remoteVideo, callInfo } from './call.js';
import { app as desk, isDesktopApp } from './desktop.js';

const S = { view: 'idle', mouse: false, keyboard: false, host: false };
let btn = null, badge = null;

const STR = {
  pt: { ask: 'Pedir controle', wait: 'Esperando permitir…', cancel: 'Cancelar pedido', stop: 'Soltar controle', on: 'Você está controlando', sent: 'Pedido enviado. Esperando {name} permitir.',
    no: '{name} não permitiu o controle.', noapp: 'Para dar o controle, {name} precisa estar no Echo para computador.', notela: 'O controle só funciona transmitindo a tela inteira.',
    off: '{name} não deixou pedirem controle.', busy: 'Outra pessoa já está no controle.', ended: 'O controle terminou.', hostOn: '{name} está usando seu mouse e teclado' },
  en: { ask: 'Request control', wait: 'Waiting for approval…', cancel: 'Cancel request', stop: 'Release control', on: 'You are in control', sent: 'Request sent. Waiting for {name}.',
    no: '{name} did not allow control.', noapp: '{name} needs the Echo desktop app to share control.', notela: 'Control only works when sharing the whole screen.',
    off: '{name} turned off control requests.', busy: 'Someone else is already in control.', ended: 'Control ended.', hostOn: '{name} is using your mouse and keyboard' },
};
const tx = (k, vars = {}) => { const lang = (document.documentElement.lang || 'pt').startsWith('en') ? 'en' : 'pt'; let s = STR[lang][k] || k; for (const [a, b] of Object.entries(vars)) s = s.replace('{' + a + '}', b); return s; };
const peerName = () => { const i = callInfo(); const u = i.peerId ? userById(i.peerId) : null; return u ? displayName(u) : (i.label || ''); };

/* ───────────── quem assiste ───────────── */
function ensureButton() {
  const card = document.getElementById('vid-card');
  if (!card) return null;
  const box = card.querySelector('.vid-btns');
  if (!btn) {
    btn = el('button', { class: 'rib glass ctl-btn', type: 'button', onClick: onButton }, icon('i-mouse', 'i s17'), el('span', { class: 'ctl-l' }));
    badge = el('div', { class: 'ctl-badge', role: 'status', hidden: true }, el('span', { class: 'rdot' }), el('span', { class: 'ctl-bt' }),
      el('button', { type: 'button', onClick: () => release(true) }, tx('stop')));
  }
  if (box && btn.parentElement !== box) box.prepend(btn);
  if (badge.parentElement !== card) card.append(badge);
  return btn;
}
function paint() {
  const meta = peerMetaInfo() || {};
  const b = ensureButton();
  if (!b) return;
  const show = !!(meta.sharing && meta.ctl && callInfo().watching);
  b.hidden = !show && S.view === 'idle';
  const lab = S.view === 'pending' ? tx('cancel') : S.view === 'active' ? tx('stop') : tx('ask');
  b.querySelector('.ctl-l').textContent = lab; b.title = lab; b.setAttribute('aria-label', lab);
  b.classList.toggle('on', S.view === 'active');
  badge.hidden = S.view !== 'active';
  badge.querySelector('.ctl-bt').textContent = tx('on');
  const card = document.getElementById('vid-card');
  if (card) card.classList.toggle('controlling', S.view === 'active');
  if (!show && S.view !== 'idle') release(false);
}
function onButton() {
  if (S.view === 'idle') {
    if (!sendCtl({ ctl: 'req', name: displayName(D.me), username: D.me.username || '' })) return;
    S.view = 'pending'; paint(); toast(tx('sent', { name: peerName() }));
  } else if (S.view === 'pending') { sendCtl({ ctl: 'cancel' }); S.view = 'idle'; paint(); }
  else release(true);
}
function release(tell) {
  if (S.view === 'active') detach();
  if (tell && S.view !== 'idle') sendCtl({ ctl: 'stop' });
  S.view = 'idle'; paint();
}

// captura do mouse e do teclado em cima do vídeo
let cap = null;
function contentRect(v) {
  const r = v.getBoundingClientRect();
  const vw = v.videoWidth || r.width, vh = v.videoHeight || r.height;
  const s = Math.min(r.width / vw, r.height / vh);
  const w = vw * s, h = vh * s;
  return { x: r.left + (r.width - w) / 2, y: r.top + (r.height - h) / 2, w, h };
}
function attach() {
  const v = remoteVideo(), card = document.getElementById('vid-card');
  if (!v || !card) return;
  detach();
  let pend = null, raf = 0;
  const onUi = (e) => !!(e.target && e.target.closest && e.target.closest('button, .vid-btns, .ctl-badge, .live-chip'));
  const norm = (e) => { if (onUi(e)) return null; const c = contentRect(v); const x = (e.clientX - c.x) / c.w, y = (e.clientY - c.y) / c.h; return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null; };
  const send = (e) => sendCtl({ ctl: 'ev', e });
  const onMove = (e) => {
    if (!S.mouse) return;
    const p = norm(e); if (!p) return;
    pend = p;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (pend) { send({ t: 'move', x: +pend.x.toFixed(5), y: +pend.y.toFixed(5) }); pend = null; } });
  };
  const btnOf = (b) => (b === 2 ? 'r' : b === 1 ? 'm' : 'l');
  const onDown = (e) => { if (!S.mouse || !norm(e)) return; e.preventDefault(); card.focus({ preventScroll: true }); try { card.setPointerCapture(e.pointerId); } catch { /* ok */ } onMove(e); send({ t: 'down', b: btnOf(e.button) }); };
  const onUp = (e) => { if (!S.mouse || onUi(e)) return; e.preventDefault(); send({ t: 'up', b: btnOf(e.button) }); };
  const onWheel = (e) => { if (!S.mouse || !norm(e)) return; e.preventDefault(); const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1; send({ t: 'wheel', dx: Math.round(e.deltaX * k), dy: Math.round(e.deltaY * k) }); };
  const mods = (e) => (e.shiftKey ? 's' : '') + (e.ctrlKey ? 'c' : '') + (e.altKey ? 'a' : '') + (e.metaKey ? 'm' : '');
  const onKey = (e) => {
    if (!S.keyboard) return;
    e.preventDefault(); e.stopPropagation();
    const printable = e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !(e.altKey && !e.shiftKey && /Mac/.test(navigator.platform));
    if (printable) { if (e.type === 'keydown') send({ t: 'text', s: e.key }); return; }
    if (e.code) send({ t: 'key', d: e.type === 'keydown' ? 'down' : 'up', code: e.code, mods: mods(e) });
  };
  const noMenu = (e) => { if (S.mouse) e.preventDefault(); };
  card.tabIndex = 0;
  card.addEventListener('pointermove', onMove); card.addEventListener('pointerdown', onDown); card.addEventListener('pointerup', onUp);
  card.addEventListener('wheel', onWheel, { passive: false }); card.addEventListener('contextmenu', noMenu);
  card.addEventListener('keydown', onKey, true); card.addEventListener('keyup', onKey, true);
  card.focus({ preventScroll: true });
  cap = () => {
    card.removeEventListener('pointermove', onMove); card.removeEventListener('pointerdown', onDown); card.removeEventListener('pointerup', onUp);
    card.removeEventListener('wheel', onWheel); card.removeEventListener('contextmenu', noMenu);
    card.removeEventListener('keydown', onKey, true); card.removeEventListener('keyup', onKey, true);
    if (raf) cancelAnimationFrame(raf);
  };
}
function detach() { if (cap) { cap(); cap = null; } }

/* ───────────── quem transmite (app para computador) ───────────── */
async function onRequest(m) {
  const who = { name: String(m.name || peerName()).slice(0, 60), username: String(m.username || '').slice(0, 40) };
  if (!isDesktopApp) { sendCtl({ ctl: 'no', why: 'app' }); return; }
  let r = null;
  try { r = await desk.askControl(who); } catch { r = { ok: false, why: 'erro' }; }
  if (r && r.ok) { S.host = true; sendCtl({ ctl: 'ok', mouse: !!r.mouse, keyboard: !!r.keyboard }); }
  else sendCtl({ ctl: 'no', why: (r && r.why) || 'recusou' });
}
function endHost(tell) {
  if (!S.host) return;
  S.host = false;
  try { desk && desk.stopControl(); } catch { /* ok */ }
  if (tell) sendCtl({ ctl: 'end' });
}

/* ───────────── mensagens ───────────── */
function onMsg(m) {
  switch (m.ctl) {
    // para quem transmite
    case 'req': onRequest(m); break;
    case 'ev': if (S.host && desk && m.e && typeof m.e === 'object') desk.controlInput(m.e); break;
    case 'stop': endHost(false); break;
    case 'cancel': break;
    // para quem assiste
    case 'ok':
      if (S.view !== 'pending') { sendCtl({ ctl: 'stop' }); break; }
      S.view = 'active'; S.mouse = !!m.mouse; S.keyboard = !!m.keyboard; attach(); paint(); break;
    case 'no': {
      if (S.view === 'idle') break;
      S.view = 'idle'; paint();
      const k = { app: 'noapp', tela: 'notela', desligado: 'off', ocupado: 'busy' }[m.why] || 'no';
      toast(tx(k, { name: peerName() }), { ms: 6000 }); break;
    }
    case 'end': if (S.view !== 'idle') { detach(); S.view = 'idle'; paint(); toast(tx('ended')); } break;
    default: break;
  }
}

export function initRemote() {
  on('ctl-msg', onMsg);
  on('ctl-meta', paint);
  on('call', () => { paint(); if (!callInfo().room) { endHost(false); if (S.view !== 'idle') { detach(); S.view = 'idle'; } } });
  on('ctl-end-local', () => endHost(true));
  if (desk) desk.onControlEnded(() => { if (S.host) { S.host = false; sendCtl({ ctl: 'end' }); } });
}
void t;
