'use strict';
// Microfone: abre o dispositivo e, no computador, passa o som por filtros (isolamento de voz).
import { CFG } from './state.js';
import { isTouch } from './util.js';

/* Tirar ruído (CFG.nsMode):
   auto   – DTLN (rede neural, roda aqui no aparelho) no lugar do filtro do navegador. Sem 48 kHz: RNNoise.
   strong – DTLN + um portão que zera o que sobra bem baixinho entre as falas.
   light  – só o filtro de ruído do próprio navegador/iPhone (leve, gasta quase nada).
   off    – som cru (só o cancelamento de eco continua, para não voltar a sua própria voz). */
/* Volume do que sai do microfone: o seu ajuste (CFG.micVol) × o que a outra pessoa pediu quando o aparelho
   dela não deixa baixar a voz sozinho (iPhone). Muda na hora, sem reabrir o microfone. */
const vol = { own: 1, peer: 1, node: null, base: 1 };
const clampV = (v) => Math.min(1.5, Math.max(0, Number(v)));
function paintVol() { if (vol.node) { try { vol.node.gain.setTargetAtTime(vol.base * vol.own * vol.peer, vol.node.context.currentTime, 0.04); } catch { vol.node.gain.value = vol.base * vol.own * vol.peer; } } }
export function setMicVolume({ own, peer } = {}) {
  if (own !== undefined) vol.own = clampV(own);
  if (peer !== undefined) vol.peer = clampV(peer);
  paintVol();
}
const NS = () => (['auto', 'strong', 'light', 'off'].includes(CFG.nsMode) ? CFG.nsMode : 'auto');
export function modeFlags() {
  const m = NS();
  if (m === 'off') return { ec: true, ns: false, agc: false };
  if (m === 'light') return { ec: true, ns: true, agc: true };
  return { ec: true, ns: true, agc: true };
}

// iPhone/iPad: o próprio sistema já faz o cancelamento de eco e a limpeza da voz (o "Voice Processing" do iOS).
// Passar o microfone pelo Web Audio ali era o que deixava a pessoa muda quando estava SEM fone: no alto-falante o
// iOS troca o modo do áudio no meio do caminho, o Web Audio fica "interrompido" e o que sai da cadeia é silêncio.
const IOS_DEV = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export function micConstraints() {
  const f = modeFlags();
  const a = { channelCount: 1, sampleRate: 48000, echoCancellation: f.ec, noiseSuppression: f.ns, autoGainControl: f.agc };
  if (IOS_DEV) { delete a.sampleRate; a.echoCancellation = true; }   // o iOS escolhe a taxa conforme a saída (alto-falante, fone, Bluetooth)
  if (NS() === 'light') a.voiceIsolation = true; // Safari/Chrome novos: isolamento de voz nativo
  if (CFG.micId) a.deviceId = { ideal: CFG.micId };
  return a;
}

// Se a cadeia de filtros sair muda neste aparelho, desliga de vez (nesta sessão) e manda o microfone direto.
let chainBroken = false, onBroken = null;
export function onChainBroken(fn) { onBroken = fn; }
function chainWanted() {
  if (chainBroken || dtlnSlow) return false;
  const m = NS();
  return m === 'auto' || m === 'strong';
}

/** Intensidade (0..1) do supressor de estalos (o nosso, depois da RNNoise). */
export function denoiseLevel() {
  const m = NS();
  if (m === 'strong') return 0.9;
  if (m === 'auto') return isTouch() ? 0 : 0.45;
  return 0;
}

const loaded = new WeakSet();
async function ensureGate(ac) {
  if (loaded.has(ac)) return true;
  try { await ac.audioWorklet.addModule('/js/gate-worklet.js'); loaded.add(ac); return true; } catch (e) { console.warn('gate', e); return false; }
}

const dnLoaded = new WeakSet();
async function ensureDenoise(ac) {
  if (dnLoaded.has(ac)) return true;
  try { await ac.audioWorklet.addModule('/js/denoise-worklet.js'); dnLoaded.add(ac); return true; } catch (e) { console.warn('denoise', e); return false; }
}

// RNNoise: o .wasm é baixado uma vez (e fica no cache do app); cada AudioContext registra o worklet.
// DTLN: a rede principal (melhor que a RNNoise nos nossos testes: +6 dB de clareza na voz e −34 dB no ruído).
// Pesos em float16 (~2 MB), baixados uma vez e guardados pelo app. Só roda a 48 kHz; fora disso usa a RNNoise.
// A conta roda num Worker (dtln-worker.js), nunca na linha de áudio. Se o aparelho não der conta em tempo real,
// desliga a rede nesta sessão e o microfone volta com o filtro do próprio navegador.
let dtlnW = null, dtlnP = null, dtlnSlow = false;
let onSlow = null;
export function onDtlnSlow(fn) { onSlow = fn; }
const dtlnLoaded = new WeakSet();
async function ensureDtln(ac) {
  if (!ac || ac.sampleRate !== 48000 || dtlnSlow || typeof Worker === 'undefined') return false;
  try {
    if (!dtlnW) {
      dtlnP = dtlnP || fetch('/js/vendor/dtln.bin').then((r) => { if (!r.ok) throw new Error('dtln ' + r.status); return r.arrayBuffer(); })
        .then((b) => (dtlnW = b));
      await dtlnP;
    }
    if (!dtlnLoaded.has(ac)) { await ac.audioWorklet.addModule('/js/dtln-worklet.js'); dtlnLoaded.add(ac); }
    return true;
  } catch (e) { console.warn('dtln', e); dtlnP = null; return false; }
}

// DeepFilterNet3: a rede mais forte (48 kHz, voz inteira, tira ventilador, teclado, rua e eco de sala).
// Só no computador (no celular pesa demais): wasm + modelo (~9 MB) baixados uma vez e guardados pelo app.
// Roda num Worker (dfn3-worker.js) pelo mesmo worklet do DTLN. Se não carregar ou ficar lento, cai para o DTLN.
let dfnBin = null, dfnP = null, dfnSlow = false;
async function ensureDfn3(ac) {
  if (!ac || ac.sampleRate !== 48000 || dfnSlow || isTouch() || typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') return false;
  try {
    if (!dfnBin) {
      const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.arrayBuffer(); });
      dfnP = dfnP || Promise.all([get('/js/vendor/dfn3/df_bg.wasm'), get('/js/vendor/dfn3/model.bin')]).then(([wasm, model]) => (dfnBin = { wasm, model }));
      await dfnP;
    }
    if (!dtlnLoaded.has(ac)) { await ac.audioWorklet.addModule('/js/dtln-worklet.js'); dtlnLoaded.add(ac); }
    return true;
  } catch (e) { console.warn('dfn3', e); dfnP = null; return false; }
}

let rnnBytes = null;
const rnnLoaded = new WeakSet();
async function ensureRnnoise(ac) {
  try {
    if (!rnnBytes) { const r = await fetch('/js/vendor/rnnoise.wasm'); if (!r.ok) throw new Error('rnnoise ' + r.status); rnnBytes = await r.arrayBuffer(); }
    if (!rnnLoaded.has(ac)) { await ac.audioWorklet.addModule('/js/rnnoise-worklet.js'); rnnLoaded.add(ac); }
    return true;
  } catch (e) { console.warn('rnnoise', e); return false; }
}

/** Abre o microfone. Devolve {track, stream, raw, stop()}. */
export async function openMic(ac) {
  // Se o nosso supressor vai rodar, o NS/AGC nativo do navegador vem ANTES dele e atrapalha (o AGC levanta e "bombeia" o ruído de fundo,
  // deixando-o não estacionário: medido, a redução cai de ~37 dB para ~17 dB). Então desligamos o NS/AGC nativo e deixamos o nosso
  // trabalhar; se o worklet não carregar, mantém as restrições originais (supressão do navegador).
  // Os filtros passam pelo Web Audio: se ele estiver parado (o navegador não deixou ligar sem um toque), o que sai é silêncio.
  // Então confere antes; parado, manda o microfone direto COM a supressão do próprio navegador ligada.
  if (ac && ac.state !== 'running') { try { await Promise.race([ac.resume(), new Promise((r) => setTimeout(r, 400))]); } catch {} }
  let useChain = !IOS_DEV && !!ac && ac.state === 'running' && chainWanted();
  const audioC = micConstraints();
  // RNNoise no lugar do filtro do navegador; se não carregar, fica o do navegador (como no modo leve)
  const dfn = useChain && (await ensureDfn3(ac));
  const dtln = useChain && !dfn && (await ensureDtln(ac));
  // a RNNoise piorava a voz nos testes: sem DTLN, fica o filtro do próprio navegador
  const rnn = false;
  if (useChain && !dfn && !dtln && !rnn) { useChain = false; audioC.voiceIsolation = true; }
  const ownDn = useChain && !dfn && !dtln && denoiseLevel() > 0 && (await ensureDenoise(ac));
  // com a nossa rede: o filtro do navegador fica LIGADO (tira o ruído constante, tipo ventilador, antes dela), mas o
  // ganho automático fica desligado (era ele que "bombeava" o ruído e atrapalhava a rede)
  if (dfn || dtln || rnn) { audioC.noiseSuppression = true; audioC.autoGainControl = false; delete audioC.voiceIsolation; }
  const raw = await navigator.mediaDevices.getUserMedia({ audio: audioC });
  const stopRaw = () => raw.getTracks().forEach((t) => t.stop());
  if (!useChain) {
    // sem filtros: mesmo assim passa por um controle de volume (se o Web Audio estiver rodando)
    if (!IOS_DEV && ac && ac.state === 'running' && !chainBroken) {
      const nodes = [];
      try {
        const src = ac.createMediaStreamSource(raw); nodes.push(src);
        const g = ac.createGain(); src.connect(g); nodes.push(g);
        const dest = ac.createMediaStreamDestination(); g.connect(dest); nodes.push(dest);
        vol.node = g; vol.base = 1; vol.own = clampV(CFG.micVol ?? 1); paintVol();
        watchChain(ac, src, g, nodes);
        return { raw, stream: dest.stream, track: dest.stream.getAudioTracks()[0], stop() { if (vol.node === g) vol.node = null; nodes.forEach((n) => { try { n.disconnect(); } catch {} }); stopRaw(); } };
      } catch (e) { console.warn('volume do microfone', e); nodes.forEach((n) => { try { n.disconnect(); } catch {} }); }
    }
    return { raw, stream: raw, track: raw.getAudioTracks()[0], stop: stopRaw };
  }
  const nodes = [];
  try {
    const src = ac.createMediaStreamSource(raw); nodes.push(src);
    let last = src;
    const link = (n) => { last.connect(n); nodes.push(n); last = n; };
    const strong = NS() === 'strong';
    const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 90; f.Q.value = 0.7; link(f);
    if (dfn) {
      try {
        const d = new AudioWorkletNode(ac, 'echo-dtln', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        const wk = new Worker('/js/dfn3-worker.js', { type: 'module' });
        const mc = new MessageChannel();
        const wasm = dfnBin.wasm.slice(0), model = dfnBin.model.slice(0);
        wk.postMessage({ port: mc.port1, wasm, model, atten: strong ? 100 : 45, post: strong }, [mc.port1, wasm, model]);
        d.port.postMessage({ port: mc.port2 }, [mc.port2]);
        const slow = () => {
          if (dfnSlow) return;
          dfnSlow = true; console.warn('DeepFilterNet3 lento neste aparelho: usando o DTLN');
          onBroken && onBroken();   // reabre o microfone; desta vez sem a DFN3
        };
        wk.onmessage = (e) => { if (e.data && e.data.slow) slow(); if (e.data && e.data.err) { console.warn('dfn3', e.data.err); slow(); } };
        wk.onerror = (e) => { console.warn('dfn3 worker', e.message || e); slow(); };
        d.port.onmessage = (e) => { if (e.data && e.data.slow) slow(); };
        link(d);
        nodes.push({ disconnect: () => wk.terminate() });
      } catch (e) { console.warn('dfn3 node', e); }
    }
    if (dtln) {
      try {
        const d = new AudioWorkletNode(ac, 'echo-dtln', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        const wk = new Worker('/js/dtln-worker.js', { type: 'module' });
        const mc = new MessageChannel();
        const w = dtlnW.slice(0);
        wk.postMessage({ port: mc.port1, weights: w, half: true, gate: strong }, [mc.port1, w]);
        d.port.postMessage({ port: mc.port2 }, [mc.port2]);
        const slow = () => {
          if (dtlnSlow) return;
          dtlnSlow = true; console.warn('DTLN lento neste aparelho: usando o filtro do navegador');
          onSlow && onSlow(); onBroken && onBroken();
        };
        wk.onmessage = (e) => { if (e.data && e.data.slow) slow(); if (e.data && e.data.err) console.warn('dtln', e.data.err); };
        d.port.onmessage = (e) => { if (e.data && e.data.slow) slow(); };
        link(d);
        nodes.push({ disconnect: () => wk.terminate() });
      } catch (e) { console.warn('dtln node', e); }
    }
    if (rnn) {
      try {
        const r = new AudioWorkletNode(ac, 'echo-rnnoise', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
          processorOptions: { wasm: rnnBytes.slice(0), strength: strong ? 0.85 : 0.35 } });
        r.port.onmessage = (e) => { if (e.data && e.data.err) console.warn('rnnoise', e.data.err); };
        link(r);
      } catch (e) { console.warn('rnnoise node', e); }
    }
    const dn = denoiseLevel();
    if (dn > 0 && ownDn) {
      try {
        const d = new AudioWorkletNode(ac, 'echo-denoise', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
          processorOptions: { intensity: dn, mode: 'isolation', enabled: true, gate: true } });
        link(d);
      } catch (e) { console.warn('denoise node', e); }
    }
    if (strong && (await ensureGate(ac))) {
      const g = new AudioWorkletNode(ac, 'telinha-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      g.port.postMessage({ db: -58 }); link(g);
    }
    // sem o ganho automático do navegador: um compressor suave deixa a voz num volume constante
    const c = ac.createDynamicsCompressor();
    c.threshold.value = -28; c.knee.value = 18; c.ratio.value = 3; c.attack.value = 0.006; c.release.value = 0.2; link(c);
    const mk = ac.createGain(); link(mk);
    vol.node = mk; vol.base = 1.6; vol.own = clampV(CFG.micVol ?? 1); paintVol();
    const dest = ac.createMediaStreamDestination();
    last.connect(dest); nodes.push(dest);
    watchChain(ac, src, last, nodes);
    return {
      raw, stream: dest.stream, track: dest.stream.getAudioTracks()[0],
      stop() { if (vol.node === mk) vol.node = null; nodes.forEach((n) => { try { n.disconnect(); } catch {} }); stopRaw(); },
    };
  } catch (e) {
    console.warn('cadeia de áudio', e);
    nodes.forEach((n) => { try { n.disconnect(); } catch {} });
    return { raw, stream: raw, track: raw.getAudioTracks()[0], stop: stopRaw };
  }
}

/** Conferência: se o microfone tem som e a saída da cadeia não (ou ficou muda por volume 0 de propósito, não), a cadeia está quebrada. */
function watchChain(ac, src, last, nodes) {
  try {
    const aIn = ac.createAnalyser(), aOut = ac.createAnalyser(); aIn.fftSize = aOut.fftSize = 1024;
    src.connect(aIn); last.connect(aOut); nodes.push(aIn, aOut);
    const bi = new Float32Array(1024), bo = new Float32Array(1024); let live = 0, dead = 0;
    const rms = (b) => { let x = 0; for (const v of b) x += v * v; return Math.sqrt(x / b.length); };
    // confere a ligação inteira (não só o começo): quando há voz no microfone (não só ruído) e a saída fica muda
    const iv = setInterval(() => {
      if (chainBroken) { clearInterval(iv); return; }
      aIn.getFloatTimeDomainData(bi); aOut.getFloatTimeDomainData(bo);
      const ri = rms(bi), ro = rms(bo);
      if (ri > 0.012 && vol.own * vol.peer > 0.05) { live++; if (ro < ri * 0.003 * vol.own * vol.peer) dead++; }
      if (live >= 20) {
        if (dead / live > 0.9) { clearInterval(iv); chainBroken = true; console.warn('filtros do microfone mudos: usando o microfone direto'); onBroken && onBroken(); }
        live = 0; dead = 0;
      }
    }, 100);
    nodes.push({ disconnect: () => clearInterval(iv) });
  } catch {}
}

/** Mede o volume de um stream. cb(nível 0..1). Devolve função para parar. */
export function startMeter(ac, stream, cb) {
  if (!ac || !stream || !stream.getAudioTracks().length) return () => {};
  const src = ac.createMediaStreamSource(stream);
  const an = ac.createAnalyser(); an.fftSize = 512; src.connect(an);
  const buf = new Uint8Array(an.fftSize);
  const id = setInterval(() => {
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
    cb(Math.sqrt(sum / buf.length));
  }, 80);
  return () => { clearInterval(id); try { src.disconnect(); } catch {} };
}
