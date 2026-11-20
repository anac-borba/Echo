// Atividades: assistir junto + jogos para dois. Tudo vai por um DataChannel P2P ('act').
import { $, el, icon, toast, displayName } from './util.js';
import { D, on } from './state.js';
import { t, addDict, onLang } from './i18n.js';
import { sendAct, actReady, peerInfo, setActivityMode, inCall } from './call.js';
import { openModal, closeModal } from './modal.js';
import { DICT_PT, DICT_EN } from './activities-i18n.js';
import { ACTIVITIES_ENABLED, WATCH_ENABLED } from './flags.js';

export { ACTIVITIES_ENABLED };

addDict('pt', DICT_PT); addDict('en', DICT_EN);

/** Catálogo. Cada jogo: js/games/<id>.js exporta `default { start(ctx) -> { destroy() } }` e css/g-<id>.css */
export const CATALOG = [
  { id: 'watch',    emoji: '🍿', module: './watch.js' },
  { id: 'draw',     emoji: '🎨', module: './games/draw.js' },
  { id: 'gartic',   emoji: '📞', module: './games/gartic.js' },
  { id: 'wordle',   emoji: '🔤', module: './games/wordle.js' },
  { id: 'stop',     emoji: '✋', module: './games/stop.js' },
  { id: 'tetris',   emoji: '🧱', module: './games/tetris.js' },
  { id: 'monopoly', emoji: '🏙️', module: './games/monopoly.js' },
  { id: 'chef',     emoji: '🍳', module: './games/chef.js' },
];

const S = { cur: null, inst: null, handlers: new Set(), pending: null };
let ui = null;
const E = {};

function cssOnce(id) {
  if (document.getElementById('css-' + id)) return;
  document.head.appendChild(el('link', { id: 'css-' + id, rel: 'stylesheet', href: `css/g-${id}.css` }));
}

/** Contexto entregue aos módulos. seat 0/1 é estável: o menor id é 0. */
function makeCtx(id, root, starter) {
  const p = peerInfo(); const me = D.me;
  const seat = [me.id, p.id].sort()[0] === me.id ? 0 : 1;
  const users = [me, p.user].map((u) => u || {});
  const names = seat === 0 ? [displayName(me), displayName(p.user)] : [displayName(p.user), displayName(me)];
  const hs = new Set();
  return {
    id, root, seat, starter, iStarted: starter === me.id, t,
    me, peer: p.user, names, colors: seat === 0 ? ['var(--accent)', '#7c5cff'] : ['#7c5cff', 'var(--accent)'],
    send: (d) => sendAct({ k: 'g', a: id, d }),
    onMsg: (fn) => { hs.add(fn); S.handlers.add(fn); return () => { hs.delete(fn); S.handlers.delete(fn); }; },
    end: () => stopActivity(true),
    toast, el, icon, _hs: hs,
  };
}

async function mount(id, starter, init) {
  unmount();
  const def = CATALOG.find((c) => c.id === id); if (!def) return;
  S.cur = { id, starter };
  cssOnce(id);
  ui.body.replaceChildren(el('div', { class: 'act-loading' }, t('act.loading')));
  ui.emoji.textContent = def.emoji; ui.title.textContent = t('act.n.' + id);
  // assistir: sem pipoca nem título, o vídeo fala por si
  ui.emoji.hidden = ui.title.hidden = id === 'watch';
  ui.stage.hidden = false; setActivityMode(true);
  try {
    const mod = await import(def.module);
    if (!S.cur || S.cur.id !== id) return;
    const root = el('div', { class: 'act-game act-' + id });
    ui.body.replaceChildren(root);
    const ctx = makeCtx(id, root, starter);
    ctx.init = init || null;
    S.ctx = ctx; S.inst = mod.default.start(ctx) || {};
  } catch (e) {
    console.error('atividade', e);
    ui.body.replaceChildren(el('div', { class: 'act-loading' }, t('act.fail')));
  }
}

function unmount() {
  if (S.inst && S.inst.destroy) { try { S.inst.destroy(); } catch (e) { console.error(e); } }
  if (S.ctx) S.ctx._hs.forEach((f) => S.handlers.delete(f));
  S.inst = null; S.ctx = null; S.cur = null;
  if (ui) { ui.body.replaceChildren(); }
}

export function startActivity(id, init) {
  if (!inCall() || !actReady()) { toast(t('act.needpeer')); return false; }
  sendAct({ k: 'start', a: id, by: D.me.id });
  mount(id, D.me.id, init);
  closeModal();
  return true;
}

export function stopActivity(notify) {
  if (notify) sendAct({ k: 'stop' });
  unmount();
  if (ui) ui.stage.hidden = true;
  setActivityMode(false);
}

function onMsg(m) {
  if (m.k === 'start' && typeof m.a === 'string') {
    if (S.cur && S.cur.id === m.a && S.cur.starter === m.by) return;
    mount(m.a, m.by);
    const who = displayName(peerInfo().user);
    toast(t('act.started', { who, name: t('act.n.' + m.a) }));
  } else if (m.k === 'stop') {
    if (S.cur) { stopActivity(false); toast(t('act.ended')); }
  } else if (m.k === 'g' && S.cur && m.a === S.cur.id) {
    S.handlers.forEach((f) => { try { f(m.d); } catch (e) { console.error(e); } });
  } else if (m.k === 'hello') {
    // reconexão: se eu tenho uma atividade aberta, aviso para o outro lado reabrir
    if (S.cur) sendAct({ k: 'start', a: S.cur.id, by: S.cur.starter });
  }
}

export function openLauncher() {
  if (!inCall()) return;
  const grid = el('div', { class: 'act-grid' }, ...CATALOG.map((c) =>
    el('button', { class: 'act-card', type: 'button', onClick: () => startActivity(c.id) },
      el('span', { class: 'act-card-emoji' }, c.emoji),
      el('b', null, t('act.n.' + c.id)),
      el('small', null, t('act.d.' + c.id)))));
  const note = actReady() ? null : el('p', { class: 'muted act-note' }, t('act.needpeer'));
  openModal(t('act.title'), el('div', { class: 'act-launcher' }, note, grid), { wide: true });
}

export function initActivities() {
  if (!ACTIVITIES_ENABLED && !WATCH_ENABLED) { const a = $('#activity'); if (a) a.hidden = true; return; } // recurso desligado em js/flags.js
  ui = {
    stage: $('#activity'), body: $('#act-body'), emoji: $('#act-emoji'), title: $('#act-title'),
    who: $('#act-who'), stop: $('#act-stop'),
  };
  ui.stop.addEventListener('click', () => stopActivity(true));
  on('act-msg', onMsg);
  on('act-open', () => sendAct({ k: 'hello' }));
  on('open-activities', openLauncher);
  on('call-left', () => { if (S.cur) stopActivity(false); });
  onLang(() => { if (S.cur) ui.title.textContent = t('act.n.' + S.cur.id); });
}
export const activeId = () => (S.cur ? S.cur.id : null);
