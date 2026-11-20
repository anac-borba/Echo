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
});
addDict('en', {
  'ft.audio': 'Echo Audio', 'ft.calling': 'Calling…', 'ft.more': 'More', 'ft.info': 'Details',
  'ft.devices': 'Audio', 'ft.devices.d': 'Pick devices and remove noise',
  'ft.watch': 'Watch together', 'ft.watch.d': 'YouTube, movies and videos',
  'ft.games': 'Play', 'ft.games.d': 'Uno, Ludo, Wordle and more',
  'ft.sfx': 'Sound effects', 'ft.sfx.d': 'Claps, laughs and your own sounds',
  'ft.chat': 'Messages', 'ft.chat.d': 'Chat without leaving the call',
  'ft.screen': 'Share screen', 'ft.screen.d': 'Show what is on your screen',
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
    if (!on) closeMenu();
    const dot = $id('chat-dot'); F.more.querySelector('.ft-dot').hidden = !on || !dot || dot.hidden;
  }
  if (!on) return;
  F.room.style.setProperty('--ft-b', (F.card.offsetTop + F.card.offsetHeight + 12) + 'px');
  F.name.textContent = label || '';
  F.sub.textContent = present ? (time || '0:00') : t('ft.calling');
}
