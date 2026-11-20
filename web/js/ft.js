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
const S = { open: false, justDragged: false };
function sbtn(key, ico, label, onTap) {
  const b = el('button', { class: 'fts-b k-' + key, type: 'button', onClick: (e) => { if (S.justDragged) { e.preventDefault(); return; } onTap(); } },
    el('span', { class: 'fts-c' }, icon(ico, 'i')), el('span', { class: 'fts-l', text: label }));
  return b;
}
// linha da lista: ícone redondo colorido, título, explicação e (às vezes) o estado à direita
function row(key, ico, color, title, sub, target, keepOpen) {
  const st = el('span', { class: 'fts-st' });
  const r = el('button', { class: 'fts-r k-' + key, type: 'button', onClick: () => {
    if (S.justDragged) return;
    if (keepOpen) { press(target); return; }
    setSheet(false); setTimeout(() => press(target), 120);
  } },
    (() => { const ic = el('span', { class: 'fts-ic' }, icon(ico, 'i')); ic.style.setProperty('--ic', color); return ic; })(),
    el('span', { class: 'fts-tx' }, el('b', { text: title }), el('small', { text: sub })), st);
  r.st = st;
  return r;
}
const TX = {
  pt: { audio: 'Áudio', mute: 'Mudo', end: 'Desligar', more: 'Mais opções',
    chat: ['Mensagens', 'Conversar sem sair da ligação'], watch: ['Assistir juntos', 'Vídeos ao mesmo tempo'], games: ['Jogar', 'Jogos para vocês dois'],
    sfx: ['Efeitos sonoros', 'Sons rápidos para a ligação'], deaf: ['Silenciar tudo', 'Para de ouvir e de falar'], screen: ['Transmitir a tela', 'Mostrar o que está na sua tela'],
    info: ['Conexão', 'Qualidade e detalhes da ligação'], on: 'Ligado' },
  en: { audio: 'Audio', mute: 'Mute', end: 'End', more: 'More options',
    chat: ['Messages', 'Chat without leaving the call'], watch: ['Watch together', 'Videos at the same time'], games: ['Play', 'Games for two'],
    sfx: ['Sound effects', 'Quick sounds for the call'], deaf: ['Deafen', 'Stop hearing and talking'], screen: ['Share screen', 'Show what is on your screen'],
    info: ['Connection', 'Call quality and details'], on: 'On' },
};
function buildSheet() {
  const L = TX[(document.documentElement.lang || 'pt').startsWith('en') ? 'en' : 'pt'];
  S.L = L;
  S.audio = sbtn('audio', 'r-vol', L.audio, () => press('btn-mic-opts'));
  S.mic = sbtn('mic', 'r-mic', L.mute, () => press('btn-mic'));
  S.leave = sbtn('end', 'r-end', L.end, () => press('btn-leave'));
  S.chat = row('chat', 'c-chat', '#0A84FF', ...L.chat, 'btn-chat');
  S.chat.st.append(el('span', { class: 'dk-dot', hidden: true }));
  S.deaf = row('deaf', 'r-hp', '#636366', ...L.deaf, 'btn-deaf', true);
  S.screen = row('screen', 'r-scr', '#5E5CE6', ...L.screen, 'btn-screen');
  const g1 = el('div', { class: 'fts-grp' }, S.chat, row('watch', 'c-watch', '#FF375F', ...L.watch, 'btn-watch'), row('games', 't-games', '#30D158', ...L.games, 'btn-games'), row('sfx', 'c-sfx', '#FF9F0A', ...L.sfx, 'btn-sfx'));
  const g2 = el('div', { class: 'fts-grp' }, S.deaf, S.screen, row('info', 'i-info', '#8E8E93', ...L.info, 'conn'));
  [...g1.children, ...g2.children].forEach((r, i) => r.style.setProperty('--i', i));
  S.grab = el('button', { class: 'fts-grab', type: 'button', 'aria-label': L.more, 'aria-expanded': 'false', onClick: () => { if (!S.justDragged) setSheet(!S.open); } });
  S.more = el('div', { class: 'fts-more', 'aria-hidden': 'true', inert: '' }, g1, g2);
  S.el = el('div', { class: 'fts', id: 'fts' }, S.grab, el('div', { class: 'fts-main' }, S.audio, S.mic, S.leave), S.more);
  S.scrim = el('div', { class: 'fts-scrim', onClick: () => setSheet(false) });
  F.room.append(S.scrim, S.el);
  const mirror = () => {
    const bm = $id('btn-mic'), bd = $id('btn-deaf'), sm = $id('sp-mic'), sd = $id('sp-deaf');
    const muted = (bm && bm.getAttribute('aria-pressed') === 'true') || (sm && sm.classList.contains('muted'));
    const deaf = (bd && bd.getAttribute('aria-pressed') === 'true') || (sd && sd.classList.contains('muted'));
    S.mic.classList.toggle('on', !!muted); S.mic.setAttribute('aria-pressed', String(!!muted));
    S.mic.querySelector('use').setAttribute('href', muted ? '#r-micoff' : '#r-mic');
    S.deaf.classList.toggle('on', !!deaf); S.deaf.setAttribute('aria-pressed', String(!!deaf)); S.deaf.st.textContent = deaf ? L.on : '';
    S.deaf.querySelector('.fts-ic use').setAttribute('href', deaf ? '#r-hpoff' : '#r-hp');
    S.deaf.querySelector('.fts-ic').style.setProperty('--ic', deaf ? '#FF453A' : '#636366');
    const scr = $id('btn-screen'), dk = $id('dk-screen');
    const live = !!(scr && scr.classList.contains('live'));
    S.screen.hidden = !scr || !dk || dk.hidden || scr.classList.contains('off');
    S.screen.st.textContent = live ? L.on : '';
    const dot = $id('chat-dot'); const unread = !!dot && !dot.hidden;
    S.chat.querySelector('.dk-dot').hidden = !unread;
    S.grab.classList.toggle('dot', unread && !S.open);
  };
  const mo = new MutationObserver(mirror);
  for (const id of ['btn-mic', 'btn-deaf', 'sp-mic', 'sp-deaf', 'btn-screen', 'dk-screen', 'chat-dot']) { const n = $id(id); if (n) mo.observe(n, { attributes: true, attributeFilter: ['class', 'aria-pressed', 'hidden'] }); }
  S.mirror = mirror; mirror();
  dragSheet();
  addEventListener('resize', measure);
  new MutationObserver(measure).observe(S.more, { attributes: true, subtree: true, attributeFilter: ['hidden'] });
}
// altura escondida = tudo que fica abaixo da fileira principal
function moreH() { return S.more ? S.more.offsetHeight : 0; }
function measure() { if (S.el && S.el.classList.contains('live')) S.el.style.setProperty('--fts-mh', moreH() + 'px'); }
// assentar com mola; a duração acompanha a distância e a velocidade (jogada rápida = assenta rápido)
function settle(dist, v) {
  const d = Math.max(.32, Math.min(.62, .38 + Math.abs(dist) / 1400 - Math.min(Math.abs(v || 0), 3) * .05));
  for (const n of [S.el, S.scrim]) { n.style.setProperty('--fts-d', d + 's'); n.classList.add('settle'); }
  clearTimeout(S.st); S.st = setTimeout(() => { S.el.classList.remove('settle'); S.scrim.classList.remove('settle'); }, d * 1000 + 60);
}
function setSheet(open, v) {
  const was = S.open; S.open = !!open;
  const h = moreH();
  const from = S.el.style.getPropertyValue('--fts-y');
  const y0 = from ? parseFloat(from) : (was ? 0 : h);
  settle(Math.abs((S.open ? 0 : h) - y0), v);
  S.el.style.removeProperty('--fts-y'); S.el.style.removeProperty('--fts-p'); S.scrim.style.removeProperty('--fts-p');
  S.el.classList.toggle('open', S.open);
  S.scrim.classList.toggle('on', S.open); S.scrim.style.setProperty('--fts-p', S.open ? '1' : '0');
  S.grab.setAttribute('aria-expanded', String(S.open));
  S.more.setAttribute('aria-hidden', String(!S.open)); S.more.inert = !S.open;
  if (S.open) S.more.scrollTop = 0;
  S.mirror && S.mirror();
}
// arrastar: a folha segue o dedo 1:1; passando das pontas, resiste (borracha); ao soltar, decide pela
// posição projetada (onde ela pararia com o embalo) e assenta com mola
function dragSheet() {
  let y0 = 0, base = 0, drag = false, id = null, samples = [], fromList = false;
  S.el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    // dentro da lista aberta, arrastar rola a lista (a não ser que ela esteja no topo e o dedo desça)
    fromList = S.open && S.more.contains(e.target);
    id = e.pointerId; y0 = e.clientY; drag = false; samples = [[performance.now(), e.clientY]];
    base = S.open ? 0 : moreH();
  });
  // o gesto é acompanhado na janela toda: o dedo (ou o mouse) pode sair de cima da folha sem perder o arrasto
  addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const d = e.clientY - y0;
    if (!drag) {
      if (Math.abs(d) < 6) return;
      if (fromList && (d < 0 || S.more.scrollTop > 0)) { id = null; return; }
      drag = true; S.el.classList.add('drag'); S.el.classList.remove('settle'); S.scrim.classList.remove('settle');
      y0 = e.clientY; // sem pulo: começa de onde o dedo está
    }
    const now = performance.now(); samples.push([now, e.clientY]); while (samples.length > 5) samples.shift();
    const h = moreH();
    let y = base + (e.clientY - y0);
    if (y < 0) y = -Math.pow(-y, .7);            // borracha em cima
    if (y > h) y = h + Math.pow(y - h, .7);       // borracha embaixo
    const p = Math.max(0, Math.min(1, 1 - y / Math.max(1, h)));
    S.el.style.setProperty('--fts-y', y.toFixed(1) + 'px');
    S.el.style.setProperty('--fts-p', p.toFixed(3)); S.scrim.style.setProperty('--fts-p', p.toFixed(3));
    S.scrim.classList.toggle('on', p > .02);
  });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    if (!drag) return;
    drag = false; S.el.classList.remove('drag');
    S.justDragged = true; setTimeout(() => { S.justDragged = false; }, 60);
    const [t1, p1] = samples[0], [t2, p2] = samples[samples.length - 1];
    const v = (p2 - p1) / Math.max(1, t2 - t1); // px/ms, + = para baixo
    const h = moreH(), y = parseFloat(S.el.style.getPropertyValue('--fts-y')) || 0;
    const projected = y + v * 180;
    setSheet(projected < h / 2, v);
  };
  addEventListener('pointerup', end);
  addEventListener('pointercancel', end);
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
