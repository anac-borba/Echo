'use strict';
// Janela de escolher o que compartilhar (dentro do app). Sem frameworks; tudo com DOM.
const $ = (id) => document.getElementById(id);
let all = [], kind = 'screen', chosen = null, audioOk = false;

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
function share() { if (chosen) window.echo.choose(chosen, audioOk && $('audio').getAttribute('aria-checked') === 'true'); }

$('tab-screen').addEventListener('click', () => setKind('screen'));
$('tab-window').addEventListener('click', () => setKind('window'));
$('audio').addEventListener('click', (e) => { const on = e.currentTarget.getAttribute('aria-checked') !== 'true'; e.currentTarget.setAttribute('aria-checked', String(on)); });
$('share').addEventListener('click', share);
$('cancel').addEventListener('click', () => window.echo.cancel());
$('close').addEventListener('click', () => window.echo.cancel());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.echo.cancel(); if (e.key === 'Enter' && chosen) share(); });

(async () => {
  const p = await window.echo.platform();
  audioOk = !!p.audio;
  if (!audioOk) { $('audio').disabled = true; $('audio').setAttribute('aria-checked', 'false'); $('audio-d').hidden = true; $('audio-na').hidden = false; }
  all = await window.echo.sources();
  setKind('screen');
})();
