'use strict';
// Mixer de quem assiste: voz da outra pessoa + som da transmissão, cada um com seu volume.
//
// Por que existe: no iPhone o volume de <video>/<audio> é só leitura (o controle "Filme" não fazia nada).
// Passando os dois pelo Web Audio, os volumes funcionam em qualquer aparelho e dá para equilibrar sozinho:
//  - mede o volume de cada um em tempo real (RMS em dB, janelas curtas);
//  - "equilíbrio automático": quando a pessoa fala, o filme abaixa suavemente até a voz ficar ~10 dB acima
//    (volta devagar quando ela para); se a voz estiver bem mais baixa que o filme, ganha até +6 dB;
//  - recomendação: com o que mediu, sugere os níveis-base de Filme e Voz.
//
// Segurança: o mixer só assume o som depois que o AudioContext está rodando de verdade (no iPhone isso exige
// um toque). Até lá, o som continua saindo direto pelos elementos de mídia, então nunca fica mudo.

const DB = (x) => 20 * Math.log10(Math.max(x, 1e-6));
const GAIN = (db) => Math.pow(10, db / 20);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const M = {
  ac: null, active: false,
  voice: { el: null, stream: null, src: null, gain: null, an: null, buf: null, db: -90, avg: -40, speaking: false },
  film: { el: null, stream: null, src: null, gain: null, an: null, buf: null, db: -90, avg: -40 },
  base: { voice: 1, film: 1 }, auto: true, deaf: false, duck: 1, boost: 1, timer: 0, sink: '',
  onChange: null,
};

// Safari (Mac e iPhone): o áudio da ligação passado pelo Web Audio pode sair mudo, mesmo chegando (o medidor mostra a voz).
// Lá o som fica sempre no caminho direto pelo elemento <audio>, que é o que funciona.
const UA = navigator.userAgent || '';
const WEBKIT = /iPhone|iPad|iPod/.test(UA) || (/AppleWebKit/.test(UA) && /Safari\//.test(UA) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox/.test(UA)) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
export const MIXER_SUPPORTED = !WEBKIT;

function ensureCtx() {
  if (!MIXER_SUPPORTED) return null;
  if (M.ac) return M.ac;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { M.ac = new AC({ latencyHint: 'interactive' }); } catch { M.ac = new AC(); }
  M.ac.addEventListener?.('statechange', () => { if (M.ac.state === 'running') takeOver(); else if (M.active) release(); });
  return M.ac;
}

function wire(ch) {
  const ac = M.ac;
  try { ch.src && ch.src.disconnect(); } catch {}
  ch.src = null;
  if (!ch.stream || !ch.stream.getAudioTracks().length) return;
  try {
    ch.src = ac.createMediaStreamSource(ch.stream);
    if (!ch.gain) { ch.gain = ac.createGain(); ch.gain.connect(ac.destination); }
    if (!ch.an) { ch.an = ac.createAnalyser(); ch.an.fftSize = 1024; ch.buf = new Float32Array(ch.an.fftSize); }
    ch.src.connect(ch.an); ch.src.connect(ch.gain);
  } catch (e) { console.warn('mixer', e); ch.src = null; }
}

/** Começa a usar o Web Audio (elementos ficam tocando, mas em silêncio, para o Chrome continuar entregando o som). */
function takeOver() {
  if (!M.ac || M.ac.state !== 'running') return;
  wire(M.voice); wire(M.film);
  if (!M.voice.src && !M.film.src) return;
  M.active = true;
  if (M.voice.el && M.voice.src) M.voice.el.muted = true;
  if (M.film.el && M.film.src) M.film.el.muted = true;
  if (M.sink && M.ac.setSinkId) M.ac.setSinkId(M.sink).catch(() => {});
  apply();
  if (!M.timer) M.timer = setInterval(tick, 50);
}
/** Volta ao caminho direto (elementos tocando com som). */
function release() {
  M.active = false;
  clearInterval(M.timer); M.timer = 0;
  for (const ch of [M.voice, M.film]) { try { ch.src && ch.src.disconnect(); } catch {} ch.src = null; if (ch.el) ch.el.muted = M.deaf; }
  applyElements();
}

function applyElements() {
  // sem mixer: o que der para fazer pelo próprio elemento (no iPhone o volume é ignorado)
  if (M.voice.el) { try { M.voice.el.volume = clamp(M.base.voice, 0, 1); } catch {} }
  if (M.film.el) { try { M.film.el.volume = clamp(M.base.film, 0, 1); } catch {} }
}

function apply() {
  if (!M.active) { applyElements(); return; }
  const t = M.ac.currentTime;
  const v = M.deaf ? 0 : M.base.voice * (M.auto ? M.boost : 1);
  const f = M.deaf ? 0 : M.base.film * (M.auto ? M.duck : 1);
  if (M.voice.gain) M.voice.gain.gain.setTargetAtTime(v, t, 0.05);
  if (M.film.gain) M.film.gain.gain.setTargetAtTime(f, t, M.duck < M.lastDuck ? 0.04 : 0.25);
  M.lastDuck = M.duck;
}

function level(ch) {
  if (!ch.an || !ch.src) return -90;
  ch.an.getFloatTimeDomainData(ch.buf);
  let e = 0; for (let i = 0; i < ch.buf.length; i++) e += ch.buf[i] * ch.buf[i];
  return DB(Math.sqrt(e / ch.buf.length));
}

let quietFor = 0;
function tick() {
  const v = M.voice, f = M.film;
  v.db = level(v); f.db = level(f);
  // voz "ativa": acima de -45 dBFS e bem acima do próprio ruído; médias só com sinal presente
  v.speaking = v.db > -45;
  if (v.speaking) v.avg += (v.db - v.avg) * 0.04;
  if (f.db > -60) f.avg += (f.db - f.avg) * 0.02;
  if (M.auto) {
    const filmOut = f.avg + DB(M.base.film);          // como o filme está saindo agora (sem o abaixamento)
    const voiceOut = v.avg + DB(M.base.voice);
    // reforço da voz: se ela, falando, fica mais de 4 dB abaixo do filme, sobe até +6 dB
    M.boost = GAIN(clamp(filmOut - voiceOut - 4, 0, 6));
    if (v.speaking) {
      quietFor = 0;
      // abaixa o filme até a voz ficar ~10 dB por cima (no máximo -14 dB de abaixamento)
      const need = clamp((voiceOut + DB(M.boost)) - 10 - filmOut, -14, 0);
      M.duck = Math.min(M.duck, GAIN(need));
    } else {
      quietFor += 50;
      if (quietFor > 350) M.duck = Math.min(1, M.duck * 1.06);   // volta devagar depois que ela para
    }
  } else { M.duck = 1; M.boost = 1; }
  apply();
  if (M.onChange) M.onChange(state());
}

/* ───────────── API ───────────── */
export function mixerAttach({ voiceEl, voiceStream, filmEl, filmStream }) {
  if (voiceEl !== undefined) { M.voice.el = voiceEl; M.voice.stream = voiceStream || null; }
  if (filmEl !== undefined) { M.film.el = filmEl; M.film.stream = filmStream || null; }
  if (!ensureCtx()) { applyElements(); return; }
  if (M.ac.state === 'running') takeOver();
  else { M.ac.resume().then(() => takeOver()).catch(() => {}); applyElements(); }
}
/** Chamar num toque da pessoa (o iPhone só libera o áudio assim). */
export function mixerUnlock() { if (M.ac && M.ac.state !== 'running') M.ac.resume().then(() => takeOver()).catch(() => {}); }
export function mixerSet({ voice, film, auto, deaf, sink } = {}) {
  if (typeof voice === 'number') M.base.voice = clamp(voice, 0, 1.5);
  if (typeof film === 'number') M.base.film = clamp(film, 0, 1.5);
  if (typeof auto === 'boolean') { M.auto = auto; if (!auto) { M.duck = 1; M.boost = 1; } }
  if (typeof deaf === 'boolean') M.deaf = deaf;
  if (typeof sink === 'string') { M.sink = sink; if (M.active && M.ac.setSinkId) M.ac.setSinkId(sink).catch(() => {}); }
  apply();
}
export function mixerDetach() { release(); M.voice.stream = M.film.stream = null; }
export function mixerActive() { return M.active; }
export function onMixer(fn) { M.onChange = fn; }

/** Sugestão de níveis com o que já foi medido: filme ~8 dB abaixo da voz (nos níveis que saem hoje). */
export function mixerRecommend() {
  const v = M.voice.avg, f = M.film.avg;
  if (!(v > -60) || !(f > -60)) return null;
  const voice = 1;
  const film = clamp(GAIN((v + DB(voice)) - 8 - f), 0.15, 1);
  return { voice, film: Math.round(film * 20) / 20 };
}
export function state() {
  return { active: M.active, voiceDb: M.voice.db, filmDb: M.film.db, speaking: M.voice.speaking, duck: M.duck, boost: M.boost, auto: M.auto };
}
