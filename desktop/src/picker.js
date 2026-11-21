'use strict';
// Janela de escolher o que transmitir (dentro do app): fonte, qualidade e som numa folha só. Sem frameworks.
const $ = (id) => document.getElementById(id);
let all = [], kind = 'screen', chosen = null, audioOk = false, perApp = false, apps = null, preset = 'filme';
const appOn = new Map();
const PRESETS = [
  ['leve', 'Leve', '720p · 30 quadros · para redes mais fracas'],
  ['filme', 'Filme', '1080p · 30 quadros · ótimo para filmes e séries'],
  ['jogo', 'Jogo', '1080p · 60 quadros · bom para jogos'],
  ['qhd', 'Alta', '1440p · 60 quadros · precisa de internet boa'],
  ['uhd', 'Máxima', '4K · 60 quadros · só com internet muito boa'],
  ['nitidez', 'Texto nítido', '1440p · 15 quadros · para código e documentos'],
];

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v); else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const c of kids) if (c) n.append(c);
  return n;
}
const check = () => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('width', '10'); s.setAttribute('height', '10'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'm5 12 5 5 9-10'); p.setAttribute('fill', 'none'); p.setAttribute('stroke', '#fff'); p.setAttribute('stroke-width', '3.4'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
  s.append(p); return s;
};

function render() {
  const g = $('grid'); g.replaceChildren();
  g.setAttribute('aria-label', kind === 'screen' ? 'Telas' : 'Janelas');
  const list = all.filter((s) => s.kind === kind);
  if (!list.length) { g.append(el('p', { class: 'empty' }, kind === 'screen' ? 'Nenhuma tela encontrada.' : 'Nenhuma janela aberta.')); return; }
  list.forEach((s, i) => {
    const th = el('span', { class: 'th' }); th.style.backgroundImage = `url("${s.thumb}")`;
    const label = s.kind === 'screen' ? (list.length > 1 ? `Tela ${i + 1}` : 'Tela inteira') : s.name;
    const name = el('span', { class: 'n' }, s.icon ? el('img', { src: s.icon, alt: '' }) : null, el('span', {}, document.createTextNode(label)), el('i', { class: 'ok' }, check()));
    g.append(el('button', { type: 'button', class: 'src', role: 'option', 'aria-selected': String(chosen === s.id), onClick: () => pick(s.id), onDblclick: () => { pick(s.id); share(); } }, th, name));
  });
}
function pick(id) { chosen = id; $('share').disabled = !chosen; render(); }
function setKind(k) {
  kind = k;
  $('tab-screen').setAttribute('aria-selected', String(k === 'screen'));
  $('tab-window').setAttribute('aria-selected', String(k === 'window'));
  if (!all.some((s) => s.id === chosen && s.kind === k)) { const first = all.find((s) => s.kind === k); pick(first ? first.id : null); } else render();
}
function renderQ() {
  $('q').replaceChildren(...PRESETS.map(([id, label]) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(id === preset), onClick: () => { preset = id; renderQ(); } }, label)));
  const p = PRESETS.find((x) => x[0] === preset);
  $('q-line').textContent = p ? p[2] : '';
}
const audioOn = () => audioOk && $('audio').getAttribute('aria-checked') === 'true';
function audioChoice() {
  if (!audioOn()) return { mode: 'none' };
  if (!perApp || !apps) return { mode: 'loopback' };
  const sel = apps.filter((a) => appOn.get(a.key) !== false);
  if (sel.length === apps.length) return { mode: 'all' };          // tudo (menos o Echo), inclusive apps que começarem a tocar depois
  return { mode: 'apps', pids: sel.flatMap((a) => a.pids) };
}
function share() { if (chosen) window.echo.choose(chosen, audioChoice(), preset); }
function sw(label, on, onChange) {
  const b = el('button', { type: 'button', role: 'switch', class: 'sw sm', 'aria-checked': String(on), 'aria-label': label });
  b.append(el('span'));
  b.addEventListener('click', () => { const v = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(v)); onChange && onChange(v); });
  return b;
}
function appsSummary() {
  if (!apps) return;
  const off = apps.filter((a) => appOn.get(a.key) === false).length;
  $('apps-v').textContent = !off ? 'Todos, menos o Echo' : off === apps.length ? 'Nenhum app' : `${apps.length - off} de ${apps.length} apps`;
}
function renderApps() {
  const ul = $('apps'); ul.replaceChildren();
  if (!perApp || !apps) return;
  $('apps-t').hidden = false;
  for (const a of apps) {
    const ic = el('span', { class: 'ai' });
    if (a.icon) ic.style.backgroundImage = `url("${a.icon}")`; else ic.textContent = (a.name || '?').charAt(0).toUpperCase();
    ul.append(el('li', {}, ic, el('span', { class: 'an' }, el('b', {}, document.createTextNode(a.name)), a.active ? el('small', {}, document.createTextNode('tocando agora')) : null),
      sw('Levar o som de ' + a.name, appOn.get(a.key) !== false, (v) => { appOn.set(a.key, v); appsSummary(); })));
  }
  ul.append(el('li', { class: 'echo' }, el('span', { class: 'ai' }, document.createTextNode('E')),
    el('span', { class: 'an' }, el('b', {}, document.createTextNode('Echo')), el('small', {}, document.createTextNode('Fica de fora: nada de eco da ligação')))));
  appsSummary();
}

$('tab-screen').addEventListener('click', () => setKind('screen'));
$('tab-window').addEventListener('click', () => setKind('window'));
$('audio').addEventListener('click', (e) => { const on = e.currentTarget.getAttribute('aria-checked') !== 'true'; e.currentTarget.setAttribute('aria-checked', String(on)); e.currentTarget.closest('.card').toggleAttribute('data-off', !on); });
$('apps-t').addEventListener('click', (e) => { const open = e.currentTarget.getAttribute('aria-expanded') !== 'true'; e.currentTarget.setAttribute('aria-expanded', String(open)); $('apps').hidden = !open; });
$('share').addEventListener('click', share);
$('cancel').addEventListener('click', () => window.echo.cancel());
$('close').addEventListener('click', () => window.echo.cancel());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.echo.cancel(); if (e.key === 'Enter' && chosen && !(e.target && e.target.closest && e.target.closest('.card'))) share(); });

(async () => {
  const p = (await window.echo.platform()) || {};
  audioOk = !!p.audio; perApp = !!p.perApp;
  if (p.prefs && PRESETS.some((x) => x[0] === p.prefs.preset)) preset = p.prefs.preset;
  renderQ();
  if (!audioOk) { $('audio').disabled = true; $('audio').setAttribute('aria-checked', 'false'); $('audio-d').hidden = true; $('audio-na').hidden = false; }
  else if (p.prefs && p.prefs.audio === false) { $('audio').setAttribute('aria-checked', 'false'); $('audio').closest('.card').toggleAttribute('data-off', true); }
  all = await window.echo.sources();
  setKind('screen');
  if (audioOk && perApp) { apps = await window.echo.apps(); if (!apps) { perApp = false; $('audio-d').textContent = 'Leva junto todo o som do computador, menos a ligação.'; } renderApps(); }
  else if (audioOk) $('audio-d').textContent = 'Leva junto todo o som do computador.';
})();
