'use strict';
// Janela de escolher o que compartilhar (dentro do app). Sem frameworks; tudo com DOM.
const $ = (id) => document.getElementById(id);
let all = [], kind = 'screen', chosen = null, audioOk = false, perApp = false, apps = null;
const appOn = new Map();

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v); else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const c of kids) if (c) n.append(c);
  return n;
}

function render() {
  const g = $('grid'); g.replaceChildren();
  g.setAttribute('aria-label', kind === 'screen' ? 'Telas' : 'Janelas');
  const list = all.filter((s) => s.kind === kind);
  if (!list.length) { g.append(el('p', { class: 'empty' }, kind === 'screen' ? 'Nenhuma tela encontrada.' : 'Nenhuma janela aberta.')); return; }
  list.forEach((s, i) => {
    const th = el('span', { class: 'th' }); th.style.backgroundImage = `url("${s.thumb}")`;
    const label = s.kind === 'screen' ? (list.length > 1 ? `Tela ${i + 1}` : 'Tela inteira') : s.name;
    const name = el('span', { class: 'n' }, s.icon ? el('img', { src: s.icon, alt: '' }) : null, document.createTextNode(label));
    const b = el('button', { type: 'button', class: 'src', role: 'option', 'aria-selected': String(chosen === s.id), onClick: () => pick(s.id), onDblclick: () => { pick(s.id); share(); } }, th, name);
    g.append(b);
  });
}
function pick(id) { chosen = id; $('share').disabled = !chosen; render(); }
function setKind(k) {
  kind = k;
  $('tab-screen').setAttribute('aria-selected', String(k === 'screen'));
  $('tab-window').setAttribute('aria-selected', String(k === 'window'));
  if (!all.some((s) => s.id === chosen && s.kind === k)) { const first = all.find((s) => s.kind === k); pick(first ? first.id : null); } else render();
}
function audioChoice() {
  const on = audioOk && $('audio').getAttribute('aria-checked') === 'true';
  if (!on) return { mode: 'none' };
  if (!perApp || !apps) return { mode: 'loopback' };
  const sel = apps.filter((a) => appOn.get(a.key) !== false);
  if (sel.length === apps.length) return { mode: 'all' };          // tudo (menos o Echo), inclusive apps que começarem a tocar depois
  return { mode: 'apps', pids: sel.flatMap((a) => a.pids) };
}
function share() { if (chosen) window.echo.choose(chosen, audioChoice()); }
function sw(label, on, onChange) {
  const b = el('button', { type: 'button', role: 'switch', class: 'sw', 'aria-checked': String(on), 'aria-label': label });
  b.append(el('span'));
  b.addEventListener('click', () => { const v = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(v)); onChange && onChange(v); });
  return b;
}
function renderApps() {
  const ul = $('apps'); ul.replaceChildren();
  if (!perApp || !apps) return;
  for (const a of apps) {
    const ic = el('span', { class: 'ai' });
    if (a.icon) ic.style.backgroundImage = `url("${a.icon}")`; else ic.textContent = (a.name || '?').charAt(0).toUpperCase();
    ul.append(el('li', {}, ic, el('span', { class: 'an' }, el('b', {}, document.createTextNode(a.name)), a.active ? el('small', {}, document.createTextNode('tocando agora')) : null),
      sw('Levar o som de ' + a.name, appOn.get(a.key) !== false, (v) => appOn.set(a.key, v))));
  }
  ul.append(el('li', { class: 'echo' }, el('span', { class: 'ai' }, document.createTextNode('E')),
    el('span', { class: 'an' }, el('b', {}, document.createTextNode('Echo')), el('small', {}, document.createTextNode('Fica de fora: nada de eco da ligação')))));
}

$('tab-screen').addEventListener('click', () => setKind('screen'));
$('tab-window').addEventListener('click', () => setKind('window'));
$('audio').addEventListener('click', (e) => { const on = e.currentTarget.getAttribute('aria-checked') !== 'true'; e.currentTarget.setAttribute('aria-checked', String(on)); $('audio').closest('.pk-r').toggleAttribute('data-off', !on); });
$('share').addEventListener('click', share);
$('cancel').addEventListener('click', () => window.echo.cancel());
$('close').addEventListener('click', () => window.echo.cancel());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.echo.cancel(); if (e.key === 'Enter' && chosen) share(); });

(async () => {
  const p = await window.echo.platform();
  audioOk = !!p.audio; perApp = !!p.perApp;
  if (!audioOk) { $('audio').disabled = true; $('audio').setAttribute('aria-checked', 'false'); $('audio-d').hidden = true; $('audio-na').hidden = false; }
  all = await window.echo.sources();
  setKind('screen');
  if (audioOk && perApp) { apps = await window.echo.apps(); if (!apps) { perApp = false; $('audio-d').textContent = 'Leva junto todo o som do computador.'; } renderApps(); }
  else if (audioOk) $('audio-d').textContent = 'Leva junto todo o som do computador.';
})();
