'use strict';
// Menu de áudio da sala: no computador é um popover em cima do dock; no celular, um "bottom sheet".
// Lista microfones e saídas (com troca ao vivo, sem derrubar a chamada) e o modo de supressão de ruído.
import { el, icon } from './util.js';
import { CFG, saveCfg } from './state.js';
import { t } from './i18n.js';
import * as AU from './audio.js';

export const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const supportsSink = () => typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
const SHEET = '(max-width: 820px), (orientation: landscape) and (max-height: 520px)';

/* ───────────── lista de dispositivos (compartilhada com a sala) ───────────── */
const DEV = { inputs: [], outputs: [] };
const subs = new Set();
export const getDevices = () => DEV;
export const onDevices = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const cleanLabel = (s) => String(s || '').replace(/^(default|padrão|predefinido|por defecto)\s*[-–—:]\s*/i, '').trim();

/** Atualiza as listas. Antes da permissão do microfone os nomes vêm vazios: com askPermission pede e lê de novo. */
export async function refreshDevices(askPermission = false) {
  let list = [];
  try { list = await navigator.mediaDevices.enumerateDevices(); } catch { /* sem permissão ou sem API */ }
  if (askPermission && list.some((d) => d.kind === 'audioinput' && !d.label)) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((x) => x.stop());
      list = await navigator.mediaDevices.enumerateDevices();
    } catch { /* negado */ }
  }
  const real = (k) => list.filter((d) => d.kind === k && d.deviceId && d.deviceId !== 'communications');
  DEV.inputs = real('audioinput'); DEV.outputs = real('audiooutput');
  subs.forEach((f) => { try { f(); } catch (e) { console.warn(e); } });
  return DEV;
}
const unlabeled = () => DEV.inputs.some((d) => !d.label);

/** Nome do microfone em uso e da saída escolhida (para o cartão da ligação). */
export function currentInputName(track) {
  const l = cleanLabel(track && track.label);
  if (l) return l;
  const d = DEV.inputs.find((x) => x.deviceId === CFG.micId) || DEV.inputs.find((x) => x.deviceId === 'default') || DEV.inputs[0];
  return d && cleanLabel(d.label) ? cleanLabel(d.label) : t('dev.sys');
}
export function currentOutputName() {
  if (!supportsSink()) return t('dev.sysout');
  const d = CFG.spkId && DEV.outputs.find((x) => x.deviceId === CFG.spkId);
  return d && d.label ? cleanLabel(d.label) : t('dev.sys');
}

const isBt = (l) => /bluetooth|airpods|buds|hands-?free|hfp|beats|\bwh-|\bwf-/i.test(l || '');
const isBuiltin = (l) => /built-?in|internal|embutid|macbook|iphone|ipad|laptop|notebook|alto-falantes do|speakers \(/i.test(l || '');

function debounced(fn, ms) { let id; return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); }; }

/**
 * host: { room, pop, scrim, swapMic(), applyOutputPrefs(), peerName(), streams() -> {raw,out,ac}|null, changed() }
 * Devolve { open(anchor), close(), isOpen(), refresh() }.
 */
export function createAudioPopover(host) {
  const { room, pop, scrim } = host;
  let anchors = [];
  let open_ = false;
  let viz = null;
  let micBox, outBox, modeBox, perm;
  const reswap = debounced(() => { Promise.resolve(host.swapMic()).finally(() => host.changed && host.changed()); }, 350);

  /* ── linhas ── */
  const row = (ic, title, sub, selected, onClick) => el('button', { class: 'rrow' + (selected ? ' sel' : ''), type: 'button', role: 'radio', 'aria-checked': String(!!selected), onClick },
    el('span', { class: 'rib sm' }, icon(ic, 'i s17')),
    el('span', { class: 't' }, el('b', { text: title }), sub ? el('small', { text: sub }) : null),
    selected ? el('span', { class: 'rchk' }, icon('r-check', 'i')) : null);

  const ordered = (list) => [...list.filter((d) => d.deviceId === 'default'), ...list.filter((d) => d.deviceId !== 'default')];
  const named = (d, i, kind) => {
    if (d.deviceId === 'default') {
      const under = cleanLabel(d.label);
      return { title: t('dev.sys'), sub: under && under.toLowerCase() !== 'default' ? under : '' };
    }
    const l = cleanLabel(d.label);
    return { title: l || t('dev.unnamed', { n: i + 1 }), sub: kind === 'in' && isBt(l) ? t('dev.bt') : isBuiltin(l) ? t('dev.builtin') : '' };
  };

  function renderMic() {
    const list = ordered(DEV.inputs);
    const hasCur = !CFG.micId || list.some((d) => d.deviceId === CFG.micId);
    const cur = hasCur ? CFG.micId : '';
    micBox.replaceChildren();
    if (!list.length) { micBox.append(el('p', { class: 'rnote', text: t('pop.nomic') })); }
    list.forEach((d, i) => {
      const n = named(d, i, 'in');
      const id = d.deviceId === 'default' ? '' : d.deviceId;
      const bt = isBt(d.label);
      micBox.append(row(bt ? 'r-hp' : 'r-mic', n.title, n.sub, id === cur, () => {
        CFG.micId = id; saveCfg(); renderMic(); host.swapMic().finally(() => host.changed && host.changed());
      }));
    });
    perm.hidden = !unlabeled();
  }

  function renderOut() {
    outBox.replaceChildren();
    if (!supportsSink()) { outBox.append(el('p', { class: 'rnote', text: IOS ? t('pop.out.ios') : t('pop.out.nosink') })); return; }
    const list = ordered(DEV.outputs);
    const cur = !CFG.spkId || list.some((d) => d.deviceId === CFG.spkId) ? CFG.spkId : '';
    if (!list.length) outBox.append(el('p', { class: 'rnote', text: t('pop.noout') }));
    list.forEach((d, i) => {
      const n = named(d, i, 'out');
      const id = d.deviceId === 'default' ? '' : d.deviceId;
      outBox.append(row(isBt(d.label) || /head|fone|pods|buds/i.test(d.label || '') ? 'r-hp' : 'r-vol', n.title, n.sub, id === cur, () => {
        CFG.spkId = id; saveCfg(); renderOut(); host.applyOutputPrefs(); host.changed && host.changed();
      }));
    });
  }

  function renderMode() {
    const modes = [['auto', 'ns.auto'], ['strong', 'ns.strong'], ['light', 'ns.light'], ['off', 'ns.off']];
    const cur = CFG.nsMode || 'auto';
    modeBox.replaceChildren(el('div', { class: 'rseg', role: 'radiogroup', 'aria-label': t('ns.title') }, modes.map(([id, key]) =>
      el('button', { type: 'button', role: 'radio', 'aria-checked': String(cur === id), onClick: () => { if ((CFG.nsMode || 'auto') === id) return; CFG.nsMode = id; saveCfg(); renderMode(); reswap(); } }, t(key)))));
  }

  /* ── onda ao vivo: o que entra no microfone × o que sai para a outra pessoa ── */
  const BARS = 14;
  const mkBars = (cls) => el('div', { class: 'rbars ' + cls, 'aria-hidden': 'true' }, Array.from({ length: BARS }, () => el('i')));
  let barsIn, barsOut, heardLbl;
  const tap = (ac, stream) => {
    if (!ac || !stream || !stream.getAudioTracks().length) return null;
    try { const src = ac.createMediaStreamSource(stream); const an = ac.createAnalyser(); an.fftSize = 512; src.connect(an); return { src, an, buf: new Uint8Array(an.fftSize) }; } catch { return null; }
  };
  const lvl = (tp) => { if (!tp) return 0; tp.an.getByteTimeDomainData(tp.buf); let s = 0; for (let i = 0; i < tp.buf.length; i++) { const x = (tp.buf[i] - 128) / 128; s += x * x; } return Math.sqrt(s / tp.buf.length); };
  const drop = (tp) => { if (tp) { try { tp.src.disconnect(); } catch { /* já solto */ } } };
  function startViz() {
    stopViz();
    const hIn = new Array(BARS).fill(3), hOut = new Array(BARS).fill(3);
    viz = { id: 0, raw: null, out: null, tIn: null, tOut: null };
    const paint = (box, arr) => { [...box.children].forEach((b, i) => { b.style.setProperty('--v', (arr[i] / 28).toFixed(3)); }); };
    const height = (r) => 3 + Math.min(25, Math.sqrt(r) * 70);
    viz.id = setInterval(() => {
      const s = host.streams();
      if (!s) return;
      if (s.raw !== viz.raw || s.out !== viz.out) {
        drop(viz.tIn); if (viz.tOut !== viz.tIn) drop(viz.tOut);
        viz.raw = s.raw; viz.out = s.out;
        viz.tIn = tap(s.ac, s.raw);
        viz.tOut = s.out === s.raw ? viz.tIn : tap(s.ac, s.out);
      }
      hIn.shift(); hIn.push(height(lvl(viz.tIn)));
      hOut.shift(); hOut.push(height(lvl(viz.tOut)));
      paint(barsIn, hIn); paint(barsOut, hOut);
    }, 90);
  }
  function stopViz() {
    if (!viz) return;
    clearInterval(viz.id); drop(viz.tIn); if (viz.tOut !== viz.tIn) drop(viz.tOut);
    viz = null;
  }

  /* ── volumes: o seu microfone e a voz de quem está na ligação ── */
  function volRows() {
    const one = (label, key, max, onSet) => {
      const out = el('output', { text: Math.round((CFG[key] ?? 1) * 100) + '%' });
      const inp = el('input', { type: 'range', min: '0', max: String(max), step: '0.05', value: String(CFG[key] ?? 1), 'aria-label': label });
      const paint = () => inp.style.setProperty('--p', Math.round((Number(inp.value) / max) * 100) + '%');
      inp.addEventListener('input', () => { CFG[key] = Number(inp.value); out.textContent = Math.round(CFG[key] * 100) + '%'; paint(); onSet(CFG[key]); });
      inp.addEventListener('change', () => saveCfg());
      paint();
      return el('label', { class: 'rvol' }, el('span', { text: label }), inp, out);
    };
    return el('div', { class: 'rvols' },
      one(t('voice.vol.mic'), 'micVol', 1.5, (v) => AU.setMicVolume({ own: v })),
      one(t('pop.vol.peer', { name: host.peerName() }), 'volVoice', 1, () => host.applyOutputPrefs()));
  }

  /* ── montagem ── */
  function build() {
    micBox = el('div', { class: 'rgrid', role: 'radiogroup', 'aria-label': t('voice.mic') });
    outBox = el('div', { class: 'rgrid', role: 'radiogroup', 'aria-label': t('pop.out') });
    modeBox = el('div', {});
    perm = el('button', { class: 'rbtn', type: 'button', text: t('pop.perm'), onClick: async () => { await refreshDevices(true); } });
    barsIn = mkBars('in'); barsOut = mkBars('out');
    heardLbl = el('small', { text: t('pop.heard', { name: host.peerName() }) });
    pop.replaceChildren(
      el('div', { class: 'rpop-head' }, el('button', { class: 'grab', type: 'button', 'aria-label': t('close'), onClick: close }), el('h2', { text: t('pop.audio') })),
      el('div', { class: 'rlab', text: t('voice.mic') }), perm, micBox,
      el('div', { class: 'rlab', text: t('pop.out') }), outBox,
      el('div', { class: 'rlab', text: t('voice.vol') }), volRows(),
      el('div', { class: 'rlab', text: t('ns.title') }), modeBox,
      el('div', { class: 'rviz' }, el('div', {}, el('small', { text: t('pop.in') }), barsIn), icon('r-back', 'i s17'), el('div', {}, heardLbl, barsOut)));
    renderMic(); renderOut(); renderMode();
  }

  function position(anchor) {
    if (matchMedia(SHEET).matches) { pop.style.removeProperty('left'); pop.style.removeProperty('bottom'); return; }
    const r = room.getBoundingClientRect(), a = anchor.getBoundingClientRect(), d = host.dock.getBoundingClientRect();
    const w = pop.offsetWidth;
    const left = Math.max(12, Math.min(a.left + a.width / 2 - r.left - w / 2, r.width - w - 12));
    pop.style.setProperty('left', Math.round(left) + 'px');
    pop.style.setProperty('bottom', Math.round(r.bottom - d.top + 12) + 'px');
  }

  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const onResize = () => { if (open_ && anchors[0]) position(anchors[0]); };
  const unsub = onDevices(() => { if (open_) { renderMic(); renderOut(); } });
  void unsub;

  function open(anchor, all) {
    if (open_) { close(); return; }
    anchors = all && all.length ? all : [anchor];
    build();
    scrim.hidden = false; pop.hidden = false; open_ = true;
    anchors.forEach((a) => a.setAttribute('aria-expanded', 'true'));
    position(anchor);
    refreshDevices(false);
    startViz();
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    pop.focus({ preventScroll: true });
  }
  function close() {
    if (!open_) return;
    open_ = false;
    stopViz();
    pop.hidden = true; scrim.hidden = true;
    anchors.forEach((a) => a.setAttribute('aria-expanded', 'false'));
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    if (anchors[0]) anchors[0].focus({ preventScroll: true });
  }
  scrim.addEventListener('click', close);
  return { open, close, isOpen: () => open_, refresh: () => { if (open_) { build(); } } };
}
