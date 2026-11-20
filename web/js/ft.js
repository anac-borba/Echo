'use strict';
// Ligação no jeito do FaceTime: um cartão preto no topo com a foto, o nome e "Echo Áudio · 00:12",
// e embaixo os botões redondos (som, tela, microfone, mais, desligar). "Mais" abre uma folha de vidro
// com o resto (assistir, jogar, efeitos, chat, aparelhos, detalhes). Os botões são os mesmos da barra
// de sempre: o cartão só pega a barra emprestada enquanto a sala está no modo ligação.
import { el, icon } from './util.js';
import { addDict, t } from './i18n.js';

addDict('pt', {
  'ft.audio': 'Echo Áudio', 'ft.calling': 'Chamando…', 'ft.more': 'Mais', 'ft.info': 'Detalhes',
  'ft.devices': 'Áudio', 'ft.devices.d': 'Escolher aparelhos e tirar ruído',
  'ft.watch': 'Assistir juntos', 'ft.watch.d': 'YouTube, filmes e vídeos',
  'ft.games': 'Jogar', 'ft.games.d': 'Uno, Ludo, Termo e mais',
  'ft.sfx': 'Efeitos sonoros', 'ft.sfx.d': 'Palmas, risadas e os seus sons',
  'ft.chat': 'Mensagens', 'ft.chat.d': 'Conversar sem sair da ligação',
  'ft.screen': 'Transmitir tela', 'ft.screen.d': 'Mostrar o que está na sua tela',
  'fts.mute': 'Mudo', 'fts.unmute': 'Mudo', 'fts.audio': 'Áudio', 'fts.leave': 'Desligar', 'fts.deaf': 'Silenciar', 'fts.more': 'Mais opções',
  'fts.screen': 'Tela', 'fts.watch': 'Assistir', 'fts.games': 'Jogar', 'fts.sfx': 'Efeitos', 'fts.chat': 'Mensagens', 'fts.info': 'Conexão',
});
addDict('en', {
  'ft.audio': 'Echo Audio', 'ft.calling': 'Calling…', 'ft.more': 'More', 'ft.info': 'Details',
  'ft.devices': 'Audio', 'ft.devices.d': 'Pick devices and remove noise',
  'ft.watch': 'Watch together', 'ft.watch.d': 'YouTube, movies and videos',
  'ft.games': 'Play', 'ft.games.d': 'Uno, Ludo, Wordle and more',
  'ft.sfx': 'Sound effects', 'ft.sfx.d': 'Claps, laughs and your own sounds',
  'ft.chat': 'Messages', 'ft.chat.d': 'Chat without leaving the call',
  'ft.screen': 'Share screen', 'ft.screen.d': 'Show what is on your screen',
  'fts.mute': 'Mute', 'fts.unmute': 'Mute', 'fts.audio': 'Audio', 'fts.leave': 'End', 'fts.deaf': 'Deafen', 'fts.more': 'More options',
  'fts.screen': 'Screen', 'fts.watch': 'Watch', 'fts.games': 'Play', 'fts.sfx': 'Sounds', 'fts.chat': 'Messages', 'fts.info': 'Connection',
});

const F = { on: false };
const $id = (id) => document.getElementById(id);

export function initFt() {
  const room = $id('view-room'), dock = $id('dock');
  if (!room || !dock || F.card) return;
  F.room = room; F.dock = dock;
  F.home = dock.nextElementSibling; // a barra volta para antes deste nó
  // minimalista: só o nome e o tempo (sem foto, sem "i": os detalhes ficam no "mais")
  F.name = el('b', { class: 'ft-name' });
  F.sub = el('span', { class: 'ft-sub' });
  F.card = el('div', { class: 'ft', id: 'ft' }, el('div', { class: 'ft-who' }, F.name, F.sub));
  room.querySelector('.room-top').after(F.card);
  // botão "mais" (só aparece dentro do cartão)
  F.more = el('button', { id: 'btn-more', class: 'rrb', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': t('ft.more'), onClick: toggleMenu }, icon('i-more', 'i'), el('span', { class: 'dk-dot ft-dot', hidden: true }));
  const leave = $id('btn-leave').closest('.dk');
  leave.before(el('div', { class: 'dk', id: 'dk-more' }, F.more));
  F.menu = el('div', { class: 'ft-menu', role: 'menu', hidden: true });
  room.append(F.menu);
  // o pontinho de mensagem nova do chat também acende no "mais"
  const dot = $id('chat-dot');
  if (dot) new MutationObserver(() => { F.more.querySelector('.ft-dot').hidden = dot.hidden || !F.on; }).observe(dot, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('pointerdown', (e) => { if (!F.menu.hidden && !F.menu.contains(e.target) && !F.more.contains(e.target)) closeMenu(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !F.menu.hidden) { e.stopPropagation(); closeMenu(); } }, true);
  buildSheet();
}

/* ───────────── celular: barra de baixo que arrasta para cima (como no Discord) ─────────────
   Fechada: só Mudo, Áudio e Desligar, grandes. Arrastando para cima (ou tocando no puxador) aparecem as outras opções.
   Os botões daqui só "apertam" os botões de sempre da barra (que ficam escondidos no celular). */
const press = (id) => { const b = $id(id); if (b) b.click(); };
function sbtn(cls, ico, key, onTap) {
  const b = el('button', { class: 'fts-b k-' + cls, type: 'button', onClick: (e) => { if (S.justDragged) { e.preventDefault(); return; } onTap(); } },
    el('span', { class: 'fts-c' }, icon(ico, 'i')), el('span', { class: 'fts-l', text: t(key) }));
  b.dataset.key = key;
  return b;
}
function tile(cls, ico, key, target) {
  const b = el('button', { class: 'fts-t k-' + cls, type: 'button', onClick: () => { if (S.justDragged) return; setSheet(false); setTimeout(() => press(target), 60); } },
    el('span', { class: 'fts-c' }, icon(ico, 'i')), el('span', { class: 'fts-l', text: t(key) }));
  return b;
}
const S = { open: false, justDragged: false };
function buildSheet() {
  S.mic = sbtn('mic', 'r-mic', 'fts.mute', () => press('btn-mic'));
  S.audio = sbtn('audio', 'r-vol', 'fts.audio', () => press('btn-mic-opts'));
  S.leave = sbtn('end', 'r-end', 'fts.leave', () => press('btn-leave'));
  S.deaf = tile('deaf', 'r-hp', 'fts.deaf', 'btn-deaf');
  S.deaf.onclick = null; // silenciar não fecha a folha: dá para ver o estado mudar
  S.deaf.addEventListener('click', () => { if (!S.justDragged) press('btn-deaf'); });
  S.screen = tile('screen', 'r-scr', 'fts.screen', 'btn-screen');
  S.chat = tile('chat', 'c-chat', 'fts.chat', 'btn-chat');
  S.chat.querySelector('.fts-c').append(el('span', { class: 'dk-dot fts-dot', hidden: true }));
  S.grab = el('button', { class: 'fts-grab', type: 'button', 'aria-label': t('fts.more'), 'aria-expanded': 'false', onClick: () => { if (!S.justDragged) setSheet(!S.open); } });
  S.more = el('div', { class: 'fts-more', 'aria-hidden': 'true' },
    S.deaf, S.screen, tile('watch', 'c-watch', 'fts.watch', 'btn-watch'), tile('games', 't-games', 'fts.games', 'btn-games'),
    tile('sfx', 'c-sfx', 'fts.sfx', 'btn-sfx'), S.chat, tile('info', 'i-info', 'fts.info', 'conn'));
  S.el = el('div', { class: 'fts', id: 'fts' }, S.grab, el('div', { class: 'fts-main' }, S.mic, S.audio, S.leave), S.more);
  S.scrim = el('div', { class: 'fts-scrim', onClick: () => setSheet(false) });
  F.room.append(S.scrim, S.el);
  // espelha o estado dos botões de sempre
  const mirror = () => {
    const bm = $id('btn-mic'), bd = $id('btn-deaf'), sm = $id('sp-mic'), sd = $id('sp-deaf');
    const muted = (bm && bm.getAttribute('aria-pressed') === 'true') || (sm && sm.classList.contains('muted'));
    const deaf = (bd && bd.getAttribute('aria-pressed') === 'true') || (sd && sd.classList.contains('muted'));
    S.mic.classList.toggle('on', !!muted); S.mic.setAttribute('aria-pressed', String(!!muted));
    S.mic.querySelector('use').setAttribute('href', muted ? '#r-micoff' : '#r-mic');
    S.deaf.classList.toggle('on', !!deaf); S.deaf.setAttribute('aria-pressed', String(!!deaf));
    S.deaf.querySelector('use').setAttribute('href', deaf ? '#r-hpoff' : '#r-hp');
    const scr = $id('btn-screen'), dk = $id('dk-screen');
    S.screen.hidden = !scr || !dk || dk.hidden || scr.classList.contains('off');
    S.screen.classList.toggle('on', !!(scr && scr.classList.contains('live')));
    const dot = $id('chat-dot'); S.chat.querySelector('.fts-dot').hidden = !dot || dot.hidden;
    S.grab.classList.toggle('dot', !!dot && !dot.hidden && !S.open);
  };
  const mo = new MutationObserver(mirror);
  for (const id of ['btn-mic', 'btn-deaf', 'sp-mic', 'sp-deaf', 'btn-screen', 'dk-screen', 'chat-dot']) { const n = $id(id); if (n) mo.observe(n, { attributes: true, attributeFilter: ['class', 'aria-pressed', 'hidden'] }); }
  S.mirror = mirror; mirror();
  dragSheet();
  addEventListener('resize', measure);
  new MutationObserver(measure).observe(S.more, { attributes: true, subtree: true, attributeFilter: ['hidden'] });
}
function moreH() { return (S.more.offsetHeight || 0) + 10; }
function measure() { if (S.el && S.el.classList.contains('live')) S.el.style.setProperty('--fts-mh', moreH() + 'px'); }
function setSheet(open) {
  S.open = !!open;
  S.el.classList.toggle('open', S.open); S.scrim.classList.toggle('on', S.open);
  S.el.style.removeProperty('--fts-y');
  S.grab.setAttribute('aria-expanded', String(S.open)); S.more.setAttribute('aria-hidden', String(!S.open));
  S.mirror && S.mirror();
}
// arrastar: segue o dedo e, ao soltar, abre ou fecha conforme a posição e a velocidade
function dragSheet() {
  let y0 = 0, t0 = 0, base = 0, dy = 0, drag = false, id = null, lastY = 0, lastT = 0, v = 0;
  S.el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    id = e.pointerId; y0 = lastY = e.clientY; t0 = lastT = performance.now(); drag = false; dy = 0; v = 0;
    base = S.open ? 0 : moreH();
  });
  S.el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const d = e.clientY - y0;
    if (!drag && Math.abs(d) > 7) { drag = true; S.el.classList.add('drag'); try { S.el.setPointerCapture(id); } catch { /* ok */ } }
    if (!drag) return;
    const now = performance.now(); v = (e.clientY - lastY) / Math.max(1, now - lastT); lastY = e.clientY; lastT = now;
    const h = moreH();
    let y = base + d;
    if (y < 0) y = y / 3; // passa um pouco do topo e volta (borracha)
    if (y > h) y = h + (y - h) / 3;
    dy = d; S.el.style.setProperty('--fts-y', y + 'px');
    S.scrim.style.setProperty('--fts-p', String(Math.max(0, Math.min(1, 1 - y / Math.max(1, h)))));
    S.scrim.classList.add('drag');
  });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    S.scrim.classList.remove('drag'); S.scrim.style.removeProperty('--fts-p');
    if (!drag) return;
    S.el.classList.remove('drag');
    S.justDragged = true; setTimeout(() => { S.justDragged = false; }, 50);
    const h = moreH(), y = base + dy;
    const open = v < -0.35 ? true : v > 0.35 ? false : y < h / 2;
    setSheet(open);
    void t0;
  };
  S.el.addEventListener('pointerup', end);
  S.el.addEventListener('pointercancel', end);
}

function item(cls, ico, title, target) {
  return el('button', { class: 'ft-mi fm-' + cls, type: 'button', role: 'menuitem', onClick: () => { closeMenu(); setTimeout(() => { const b = $id(target); if (b) b.click(); }, 30); } },
    icon(ico, 'i'), el('span', { text: title }));
}
function buildMenu() {
  const scr = $id('btn-screen'), dk = $id('dk-screen');
  const canScreen = scr && dk && !dk.hidden && !scr.classList.contains('off');
  F.menu.replaceChildren(
    item('watch', 'c-watch', t('ft.watch'), 'btn-watch'),
    item('games', 't-games', t('ft.games'), 'btn-games'),
    item('sfx', 'c-sfx', t('ft.sfx'), 'btn-sfx'),
    item('chat', 'c-chat', t('ft.chat'), 'btn-chat'),
    ...(canScreen ? [item('screen', 'r-scr', t('ft.screen'), 'btn-screen')] : []),
    el('hr'),
    item('dev', 'r-mic', t('ft.devices'), 'btn-mic-opts'),
    item('info', 'i-info', t('ft.info'), 'conn'));
}
function toggleMenu() { if (F.menu.hidden) openMenu(); else closeMenu(); }
function openMenu() {
  buildMenu();
  F.menu.hidden = false; F.more.setAttribute('aria-expanded', 'true'); F.card.classList.add('m-behind');
  const r = F.room.getBoundingClientRect(), c = F.card.getBoundingClientRect();
  F.menu.style.setProperty('--ft-top', Math.round(c.top - r.top) + 'px');
  F.menu.style.setProperty('--ft-left', Math.round(c.left - r.left) + 'px');
  F.menu.style.setProperty('--ft-w', Math.round(c.width) + 'px');
  // no computador a barra fica embaixo: o menu abre para cima dela, centrado
  if (matchMedia('(min-width: 821px)').matches) {
    const h = F.menu.offsetHeight, w = F.menu.offsetWidth;
    F.menu.style.setProperty('--ft-top', Math.round(c.top - r.top - h - 12) + 'px');
    F.menu.style.setProperty('--ft-left', Math.round(c.left - r.left + c.width / 2 - w / 2) + 'px');
    F.menu.style.setProperty('--ft-w', w + 'px');
  }
}
export function closeMenu() { if (!F.menu || F.menu.hidden) return; F.menu.hidden = true; F.more.setAttribute('aria-expanded', 'false'); F.card.classList.remove('m-behind'); }

/** Chamado a cada mudança da sala: liga/desliga o cartão e atualiza nome, foto e tempo. */
export function syncFt({ mode, immersive, peer, label, present, time }) {
  if (!F.card) return;
  const on = mode === 'call' && !immersive;
  if (on !== F.on) {
    F.on = on;
    F.room.classList.toggle('ft-on', on);
    if (on) F.card.append(F.dock);
    else if (F.dock.parentElement === F.card) F.home.before(F.dock);
    if (!on) { closeMenu(); if (S.el) setSheet(false); }
    if (S.el) { S.el.classList.toggle('live', on); measure(); }
    const dot = $id('chat-dot'); F.more.querySelector('.ft-dot').hidden = !on || !dot || dot.hidden;
  }
  if (!on) return;
  F.room.style.setProperty('--ft-b', (F.card.offsetTop + F.card.offsetHeight + 12) + 'px');
  F.name.textContent = label || '';
  F.sub.textContent = present ? (time || '0:00') : t('ft.calling');
}
