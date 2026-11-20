// Sons do Echo: os do app são sintetizados aqui; os efeitos da chamada são gravações reais em /sfx (com reserva sintetizada):
//  - sons do app: entrar/sair da chamada, desligar, mensagem, chamando;
//  - efeitos sonoros da chamada (soundboard): aplausos, buzina, ba-dum-tss, trombone triste etc.
// Os efeitos tocam nas duas pontas: quem aperta toca aqui e manda o nome pelo canal de dados.
import { CFG } from './state.js';

let ac = null;
function ctx() {
  if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  return ac;
}
/** Destrava o áudio no primeiro toque (iPhone exige). */
export function unlockAudio() { try { ctx(); } catch {} }

const env = (g, t, a, peak, d, end = 0.0001) => {
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(end, t + a + d);
};
function noiseBuf(c, sec = 1) {
  const b = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * sec)), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
let _noise = null;
const noise = (c) => (_noise && _noise.sampleRate === c.sampleRate ? _noise : (_noise = noiseBuf(c, 2)));
function osc(c, out, type, f, t, a, peak, d, opts = {}) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + (opts.glide || a + d));
  if (opts.detune) o.detune.value = opts.detune;
  o.connect(g); g.connect(out); env(g, t, a, peak, d);
  o.start(t); o.stop(t + a + d + 0.05);
  return o;
}
function burst(c, out, t, dur, peak, { type = 'bandpass', f = 2000, q = 1, to } = {}) {
  const s = c.createBufferSource(); s.buffer = noise(c); s.loop = true;
  const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
  if (to) fl.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = c.createGain();
  s.connect(fl); fl.connect(g); g.connect(out);
  env(g, t, Math.min(0.01, dur / 4), peak, dur);
  s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
function master(vol) {
  const c = ctx();
  const g = c.createGain(); g.gain.value = vol;
  const comp = c.createDynamicsCompressor(); comp.threshold.value = -10; comp.ratio.value = 6;
  g.connect(comp); comp.connect(c.destination);
  return { c, out: g, t: c.currentTime + 0.02 };
}

/* ───────────── sons do app ───────────── */
const UI = {
  join({ c, out, t }) { osc(c, out, 'sine', 587, t, 0.01, 0.22, 0.18); osc(c, out, 'sine', 880, t + 0.09, 0.01, 0.22, 0.28); },
  leave({ c, out, t }) { osc(c, out, 'sine', 880, t, 0.01, 0.2, 0.16); osc(c, out, 'sine', 523, t + 0.09, 0.01, 0.2, 0.3); },
  end({ c, out, t }) { osc(c, out, 'sine', 660, t, 0.01, 0.18, 0.14); osc(c, out, 'sine', 494, t + 0.12, 0.01, 0.18, 0.14); osc(c, out, 'sine', 392, t + 0.24, 0.01, 0.18, 0.32); },
  msg({ c, out, t }) { osc(c, out, 'sine', 1318, t, 0.005, 0.12, 0.12); osc(c, out, 'triangle', 1760, t + 0.06, 0.005, 0.08, 0.2); },
  ring({ c, out, t }) { [0, 0.22, 0.44].forEach((d, i) => osc(c, out, 'sine', [660, 880, 660][i], t + d, 0.02, 0.18, 0.2)); },
  // toque de chamada recebida: arpejo suave de sino (fundamental + parcial alto), duas vezes
  ringtone({ c, out, t }) {
    const notes = [659.25, 830.61, 987.77, 1318.5];
    for (let r = 0; r < 2; r++) notes.forEach((f, i) => {
      const at = t + r * 0.78 + i * 0.13;
      osc(c, out, 'sine', f, at, 0.006, 0.2, 0.55);
      osc(c, out, 'sine', f * 2.76, at, 0.003, 0.035, 0.18);
    });
  },
  // quem liga ouve isto enquanto a outra pessoa não atende: dois pulsos baixinhos
  ringback({ c, out, t }) { osc(c, out, 'sine', 523.25, t, 0.03, 0.07, 0.32); osc(c, out, 'sine', 659.25, t + 0.42, 0.03, 0.07, 0.36); },
  mute({ c, out, t }) { osc(c, out, 'sine', 520, t, 0.005, 0.12, 0.09); },
  unmute({ c, out, t }) { osc(c, out, 'sine', 780, t, 0.005, 0.12, 0.09); },
};
export function uiSound(name) {
  if (CFG.uiSounds === false) return;
  try { const m = master(0.6); (UI[name] || UI.msg)(m); } catch {}
}

/* ───────────── efeitos sonoros (soundboard) ───────────── */
export const EFFECTS = [
  { id: 'applause', emoji: '👏', pt: 'Aplausos', en: 'Applause' },
  { id: 'airhorn', emoji: '📯', pt: 'Buzina', en: 'Air horn' },
  { id: 'rimshot', emoji: '🥁', pt: 'Ba dum tss', en: 'Rimshot' },
  { id: 'sadtrombone', emoji: '🎺', pt: 'Trombone triste', en: 'Sad trombone' },
  { id: 'crickets', emoji: '🦗', pt: 'Grilos', en: 'Crickets' },
  { id: 'tada', emoji: '🎉', pt: 'Tcharam', en: 'Ta-da' },
  { id: 'levelup', emoji: '⭐', pt: 'Subiu de nível', en: 'Level up' },
  { id: 'wrong', emoji: '❌', pt: 'Errou', en: 'Wrong' },
  { id: 'ding', emoji: '🔔', pt: 'Plim', en: 'Ding' },
  { id: 'suspense', emoji: '😱', pt: 'Suspense', en: 'Suspense' },
  { id: 'boom', emoji: '💥', pt: 'Bum', en: 'Boom' },
  { id: 'kiss', emoji: '💋', pt: 'Beijo', en: 'Kiss' },
  { id: 'heart', emoji: '💗', pt: 'Coração', en: 'Heart' },
  { id: 'drumroll', emoji: '🪘', pt: 'Rufar', en: 'Drum roll' },
  { id: 'boing', emoji: '🤪', pt: 'Boing', en: 'Boing' },
  { id: 'magic', emoji: '✨', pt: 'Mágica', en: 'Magic' },
  { id: 'laugh', emoji: '😂', pt: 'Risadas', en: 'Laughs' },
  { id: 'wow', emoji: '😮', pt: 'Uau', en: 'Wow' },
];
const SYN = {
  applause({ c, out, t }) {
    // centenas de palminhas (ruído curto filtrado) em tempos aleatórios, crescendo e sumindo
    const dur = 2.6;
    for (let i = 0; i < 260; i++) {
      const x = Math.random();
      const at = t + x * dur;
      const shape = Math.sin(Math.PI * Math.min(1, x * 1.4)) * (x > 0.7 ? (1 - x) / 0.3 : 1);
      burst(c, out, at, 0.03 + Math.random() * 0.03, 0.05 + 0.18 * shape * Math.random(), { f: 1200 + Math.random() * 2600, q: 0.8 + Math.random() });
    }
  },
  airhorn({ c, out, t }) {
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 3); }
    shaper.curve = curve;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    shaper.connect(lp); lp.connect(out);
    const blast = (at, len) => { for (const det of [-14, 0, 9, 1200]) osc(c, shaper, 'sawtooth', 466, at, 0.015, det === 1200 ? 0.05 : 0.16, len, { detune: det, to: 455, glide: len }); };
    blast(t, 0.16); blast(t + 0.22, 0.16); blast(t + 0.44, 0.9);
  },
  rimshot({ c, out, t }) {
    const tom = (at, f) => { osc(c, out, 'sine', f, at, 0.003, 0.5, 0.18, { to: f * 0.55, glide: 0.18 }); burst(c, out, at, 0.04, 0.12, { f: 3000, q: 0.7 }); };
    tom(t, 220); tom(t + 0.18, 160);
    burst(c, out, t + 0.42, 1.1, 0.22, { type: 'highpass', f: 6500, q: 0.4 });
    osc(c, out, 'square', 540, t + 0.42, 0.002, 0.06, 0.05);
  },
  sadtrombone({ c, out, t }) {
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.Q.value = 2; lp.connect(out);
    const notes = [[311, 0.42], [294, 0.42], [277, 0.42], [262, 1.4]];
    let at = t;
    notes.forEach(([f, len], i) => {
      const o = osc(c, lp, 'sawtooth', f, at, 0.04, 0.3, len);
      if (i === 3) { const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 5.5; lg.gain.value = 9; lfo.connect(lg); lg.connect(o.frequency); lfo.start(at + 0.25); lfo.stop(at + len); }
      at += len * 0.95;
    });
  },
  crickets({ c, out, t }) {
    for (let k = 0; k < 6; k++) {
      const at = t + k * 0.42 + Math.random() * 0.05;
      for (let i = 0; i < 4; i++) osc(c, out, 'sine', 4300 + Math.random() * 120, at + i * 0.045, 0.004, 0.07, 0.03);
    }
  },
  tada({ c, out, t }) {
    const ch = [523, 659, 784, 1046];
    osc(c, out, 'sawtooth', 392, t, 0.01, 0.12, 0.12);
    ch.forEach((f) => { osc(c, out, 'sawtooth', f, t + 0.16, 0.02, 0.09, 1.0); osc(c, out, 'triangle', f * 2, t + 0.16, 0.02, 0.05, 0.9); });
    burst(c, out, t + 0.16, 0.9, 0.06, { type: 'highpass', f: 7000 });
  },
  levelup({ c, out, t }) { [523, 659, 784, 1046, 1318].forEach((f, i) => osc(c, out, 'square', f, t + i * 0.075, 0.004, 0.09, i === 4 ? 0.4 : 0.07)); },
  wrong({ c, out, t }) { osc(c, out, 'square', 150, t, 0.01, 0.2, 0.32); osc(c, out, 'square', 110, t + 0.36, 0.01, 0.2, 0.55); },
  ding({ c, out, t }) {
    // sino FM
    const car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), g = c.createGain();
    car.frequency.value = 1320; mod.frequency.value = 1320 * 2.76; mg.gain.setValueAtTime(900, t); mg.gain.exponentialRampToValueAtTime(1, t + 1.2);
    mod.connect(mg); mg.connect(car.frequency); car.connect(g); g.connect(out); env(g, t, 0.003, 0.35, 1.3);
    car.start(t); mod.start(t); car.stop(t + 1.4); mod.stop(t + 1.4);
  },
  suspense({ c, out, t }) {
    const hit = (at, f, len) => { for (const m of [1, 2, 3]) osc(c, out, 'sawtooth', f * m, at, 0.02, 0.22 / m, len, { to: f * m * 0.97, glide: len }); };
    hit(t, 98, 0.32); hit(t + 0.4, 104, 0.32); hit(t + 0.8, 87, 1.4);
  },
  boom({ c, out, t }) { burst(c, out, t, 1.4, 0.9, { type: 'lowpass', f: 900, to: 60, q: 0.7 }); osc(c, out, 'sine', 90, t, 0.005, 0.8, 0.9, { to: 35, glide: 0.9 }); },
  kiss({ c, out, t }) { burst(c, out, t, 0.06, 0.35, { f: 2200, to: 900, q: 3 }); osc(c, out, 'sine', 1400, t + 0.02, 0.004, 0.2, 0.08, { to: 600, glide: 0.08 }); },
  heart({ c, out, t }) { [659, 784, 988].forEach((f, i) => osc(c, out, 'sine', f, t + i * 0.1, 0.01, 0.2, 0.5)); osc(c, out, 'triangle', 1318, t + 0.3, 0.01, 0.08, 0.7); },
  drumroll({ c, out, t }) {
    for (let i = 0; i < 34; i++) burst(c, out, t + i * 0.045, 0.05, 0.08 + i * 0.004, { f: 1800, q: 0.6 });
    burst(c, out, t + 1.55, 1.2, 0.3, { type: 'highpass', f: 5000, q: 0.3 }); osc(c, out, 'sine', 120, t + 1.55, 0.005, 0.6, 0.3, { to: 60 });
  },
  boing({ c, out, t }) {
    const o = osc(c, out, 'sine', 220, t, 0.005, 0.4, 0.7, { to: 520, glide: 0.25 });
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 18; lg.gain.value = 60; lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); lfo.stop(t + 0.75);
  },
  magic({ c, out, t }) { for (let i = 0; i < 14; i++) osc(c, out, 'sine', 1200 + i * 160 + Math.random() * 80, t + i * 0.05, 0.004, 0.08, 0.35); },
};

// Gravações reais (Freesound, CC0/CC BY — créditos em /sfx/CREDITOS.txt). Os outros continuam sintetizados.
const REAL = new Set(['applause', 'airhorn', 'rimshot', 'sadtrombone', 'crickets', 'tada', 'wrong', 'ding', 'suspense', 'boom', 'drumroll', 'boing', 'laugh', 'wow']);
const real = new Map(); // id -> AudioBuffer | Promise
function loadReal(id) {
  if (real.has(id)) return real.get(id);
  const p = fetch('/sfx/' + id + '.mp3').then((r) => { if (!r.ok) throw new Error('sfx'); return r.arrayBuffer(); })
    .then((b) => new Promise((res, rej) => ctx().decodeAudioData(b, res, rej)))
    .then((buf) => { real.set(id, buf); return buf; })
    .catch(() => { real.delete(id); return null; });
  real.set(id, p);
  return p;
}
/** Baixa os efeitos de verdade antes (ao abrir o painel ou entrar numa ligação). */
export function preloadEffects() { for (const id of REAL) loadReal(id); }

const custom = new Map(); // id -> AudioBuffer
export async function loadCustom(id, url) {
  if (custom.has(id)) return custom.get(id);
  const r = await fetch(url, { credentials: 'same-origin' });
  if (!r.ok) throw new Error('som');
  const buf = await ctx().decodeAudioData(await r.arrayBuffer());
  custom.set(id, buf);
  return buf;
}
/** Toca um efeito. id: um dos EFFECTS ou 'u:<id>' (som enviado por alguém). */
export function playEffect(id) {
  if (CFG.sfxOn === false) return false;
  const vol = Math.max(0, Math.min(1, CFG.volSfx ?? 0.7));
  if (!vol) return false;
  try {
    const m = master(vol);
    if (id.startsWith('u:')) {
      const buf = custom.get(id.slice(2));
      if (!buf) return false;
      const s = m.c.createBufferSource(); s.buffer = buf; s.connect(m.out); s.start(m.t, 0, Math.min(buf.duration, 12));
      return true;
    }
    if (REAL.has(id)) {
      const b = real.get(id);
      const play = (buf) => { const s = m.c.createBufferSource(); s.buffer = buf; s.connect(m.out); s.start(Math.max(m.t, m.c.currentTime)); };
      if (b && !(b instanceof Promise)) { play(b); return true; }
      const t0 = performance.now();
      loadReal(id).then((buf) => { if (buf && performance.now() - t0 < 2500) play(buf); else if (!buf && SYN[id]) SYN[id](master(vol)); });
      return true;
    }
    const f = SYN[id];
    if (!f) return false;
    f(m);
    return true;
  } catch { return false; }
}
export const isEffect = (id) => typeof id === 'string' && (Object.prototype.hasOwnProperty.call(SYN, id) || REAL.has(id) || /^u:[a-z2-7]{12}$/.test(id));
