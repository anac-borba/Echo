'use strict';
// Núcleo DSP do supressor de ruído (sem dependência de DOM/AudioWorklet: roda em Node e no worklet).
// STFT FFT 512, hop 128, janela sqrt-Hann (análise e síntese, soma por sobreposição com ganho 1/2),
// 48 kHz. Latência algorítmica = N - hop = 384 amostras = 8 ms (+ 0 no caminho alinhado ao bloco de 128).
// Etapas por quadro: piso de ruído por rastreio de mínimos -> detecção de fala -> ganho Wiener com
// "decision-directed" e sobre-subtração -> suavização temporal/frequencial -> piso de ganho -> gate suave.

const MS_M = 6, MS_U = 100, WARM = 12;
export const N = 512, HOP = 128, K = N / 2 + 1;

function makeFFT(n) {
  const lg = Math.log2(n) | 0;
  const rev = new Uint16Array(n), cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < lg; b++) if (i & (1 << b)) r |= 1 << (lg - 1 - b); rev[i] = r; }
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = -Math.sin(2 * Math.PI * i / n); }
  // inverse=false: e^{-j}; inverse: conjuga (sem 1/n; o chamador normaliza)
  return function fft(re, im, inverse) {
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let s = 0; s < n; s += size) {
        for (let k = 0, t = 0; k < half; k++, t += step) {
          const wr = cos[t], wi = inverse ? -sin[t] : sin[t];
          const a = s + k, b = a + half;
          const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        }
      }
    }
  };
}
const fft = makeFFT(N);
const WIN = new Float64Array(N);
for (let i = 0; i < N; i++) WIN[i] = Math.sqrt(0.5 * (1 - Math.cos(2 * Math.PI * (i + 0.5) / N))); // sqrt-Hann periódica
const OLA = 1 / 2; // sum(w^2) com hop N/4 = 2

export class Denoiser {
  constructor(sampleRate = 48000) {
    this.sr = sampleRate;
    this.binHz = sampleRate / N;
    this.kLo = Math.max(1, Math.round(80 / this.binHz));
    this.kHi = Math.min(K - 1, Math.round(4000 / this.binHz));
    this.inBuf = new Float64Array(N); this.inPos = 0;     // últimas N amostras (circular)
    this.ola = new Float64Array(N);                       // acumulador de saída (circular)
    this.olaPos = 0;
    this.fill = 0; this.q = new Float64Array(HOP); this.qPos = HOP; // fila p/ caminho não alinhado
    this.re = new Float64Array(N); this.im = new Float64Array(N);
    this.P = new Float64Array(K); this.S = new Float64Array(K); this.Sf = new Float64Array(K);
    this.Nz = new Float64Array(K); this.A2 = new Float64Array(K);
    this.G = new Float64Array(K); this.Gs = new Float64Array(K); this.Gt = new Float64Array(K);
    this.mCur = new Float64Array(K); this.mRing = new Float64Array(K * MS_M); this.mCnt = 0; this.mIdx = 0;
    this.frames = 0; this.speech = false; this.hang = 0; this.Rs = 0; this.gateG = 1; this.flux = 0; this.prevBand = 0;
    this.enabled = true; this.mode = 'isolation'; this.intensity = 1; this.gate = true;
    this.speechProb = 0;
    // supressor de transientes (palmas, batidas, teclado): estado
    this.Ref = new Float64Array(K); this.Tk = new Float64Array(K).fill(1); this.tHold = 0; this.tAllow = 1; this.tQuiet = false;
    this.tLo = Math.max(1, Math.round(250 / this.binHz)); this.tHi = Math.min(K - 1, Math.round(6000 / this.binHz));
    this.tune = {}; this.setParams({});
  }
  setParams(p) {
    if (typeof p.enabled === 'boolean') this.enabled = p.enabled;
    if (typeof p.mode === 'string') this.mode = p.mode;
    if (typeof p.intensity === 'number') this.intensity = Math.min(1, Math.max(0, p.intensity));
    if (typeof p.gate === 'boolean') this.gate = p.gate;
    let I = this.intensity, gate = this.gate;
    if (this.mode === 'isolation') { I = 1; gate = true; }
    else if (this.mode === 'studio') { I = Math.min(I, 0.25); gate = false; }
    const T = p.tune || this.tune || {}; this.tune = T;
    this.mu = 1 + (T.muK ?? 0.4) * I;                              // sobre-subtração
    this.gmin = Math.pow(10, -(8 + 22 * I) / 20);       // piso de ganho: -8 dB (fraco) .. -30 dB (forte)
    this.gminSpeech = Math.pow(10, -(T.fs ?? 0.5) / 20);  // piso (dB) dentro da fala, só nos bins de voz acima do ruído: quase transparente
    this.alpha = T.alpha ?? 0.97;
    this.gateFloor = gate ? Math.pow(10, -(4 + 8 * I) / 20) : 1; // gate suave extra fora da fala (até -12 dB)
    this.active = I > 0.001;
    this.transient = typeof p.transient === 'boolean' ? p.transient : (this.transient ?? (I >= 0.5));
    this.tFloor = Math.pow(10, -(12 + 18 * I) / 20);    // até -30 dB durante o estalo
    this.tFloorQuiet = Math.pow(10, -(14 + 34 * I) / 20); // até -48 dB quando ninguém está falando
  }
  /** Processa len amostras (mono). out pode ser o mesmo array que inp. */
  process(inp, out, len) {
    if (!this.enabled || !this.active) { if (out !== inp) for (let i = 0; i < len; i++) out[i] = inp[i]; return; }
    if (len === HOP && this.fill === 0) { // caminho alinhado: sem latência extra
      this._push(inp, 0, HOP);
      this._frame(out, 0);
      return;
    }
    for (let i = 0; i < len; i++) {
      this.inBuf[this.inPos] = inp[i]; this.inPos = (this.inPos + 1) & (N - 1);
      if (++this.fill === HOP) { this.fill = 0; this._frame(this.q, 0); this.qPos = 0; }
      out[i] = this.qPos < HOP ? this.q[this.qPos++] : 0;
    }
  }
  _push(inp, o, n) { for (let i = 0; i < n; i++) { this.inBuf[this.inPos] = inp[o + i]; this.inPos = (this.inPos + 1) & (N - 1); } }
  _frame(dst, off) {
    const re = this.re, im = this.im, P = this.P, S = this.S, Sf = this.Sf, Nz = this.Nz, G = this.G, Gs = this.Gs, A2 = this.A2;
    const mask = N - 1;
    for (let i = 0; i < N; i++) { re[i] = this.inBuf[(this.inPos + i) & mask] * WIN[i]; im[i] = 0; }
    fft(re, im, false);
    for (let k = 0; k < K; k++) P[k] = re[k] * re[k] + im[k] * im[k] + 1e-12;
    const kLo = this.kLo, kHi = this.kHi;
    // --- potência suavizada (tempo e frequência)
    for (let k = 0; k < K; k++) S[k] = this.frames === 0 ? P[k] : 0.65 * S[k] + 0.35 * P[k];
    for (let k = 0; k < K; k++) { const a = S[k > 0 ? k - 1 : 0], c = S[k < K - 1 ? k + 1 : K - 1]; Sf[k] = 0.25 * a + 0.5 * S[k] + 0.25 * c; }
    // --- piso de ruído: estatística de mínimos (janela deslizante de M sub-janelas de U quadros, ~1,6 s)
    {
      const cur = this.mCur, ring = this.mRing;
      // os primeiros quadros veem a janela só parcialmente preenchida (energia artificialmente baixa): não entram no mínimo
      if (this.frames < WARM) { for (let k = 0; k < K; k++) { cur[k] = 1e30; for (let m = 0; m < MS_M; m++) ring[m * K + k] = 1e30; } }
      if (this.frames <= WARM) { for (let k = 0; k < K; k++) cur[k] = Sf[k]; } // sub-janelas ainda vazias (1e30) não entram no mínimo
      else for (let k = 0; k < K; k++) if (Sf[k] < cur[k]) cur[k] = Sf[k];
      if (++this.mCnt >= MS_U) {
        this.mCnt = 0;
        const base = this.mIdx * K; for (let k = 0; k < K; k++) { ring[base + k] = cur[k]; cur[k] = Sf[k]; }
        this.mIdx = (this.mIdx + 1) % MS_M;
      }
      for (let k = 0; k < K; k++) {
        let m = cur[k];
        for (let q = 0; q < MS_M; q++) { const v = ring[q * K + k]; if (v < m) m = v; }
        Nz[k] = m;
      }
    }
    // --- detecção de fala (energia na faixa de voz vs ruído + fluxo espectral)
    let eb = 0, nb = 0;
    for (let k = kLo; k <= kHi; k++) { eb += Sf[k]; nb += Nz[k]; }
    // razão média por bin, limitada (clip): robusta a poucos bins graves de ruído que flutuam muito
    const cl = this.tune.rclip ?? 6; let R = 0;
    for (let k = kLo; k <= kHi; k++) { const r = Sf[k] / (Nz[k] * this.NB + 1e-12); R += r < cl ? r : cl; }
    R /= (kHi - kLo + 1);
    const prevRs = this.Rs, prevSp = this.speech, prevHang = this.hang;
    const rk = this.tune.rk ?? 0.8; this.Rs = rk * this.Rs + (1 - rk) * R;
    const lb = Math.log(eb + 1e-9);
    const fl = Math.max(0, lb - this.prevBand); this.prevBand = lb;
    this.flux = 0.7 * this.flux + 0.3 * fl;
    const T = this.tune, thrOn = T.thr ?? 1.8, thrOff = T.thr2 ?? 1.35;
    const on = this.Rs > thrOn || (this.speech && this.Rs > thrOff) || (this.Rs > 1.45 && this.flux > (T.fl ?? 0.2));
    if (on) { this.hang = 60; } else if (this.hang > 0) this.hang--;       // 60 quadros = 160 ms
    this.speech = this.hang > 0;
    // --- transientes (palmas, batidas, teclado): quase todas as frequências sobem de uma vez, muito acima do
    // espectro recente. Voz sobe só nos harmônicos. No estalo, cada faixa é puxada de volta ao nível de antes,
    // então a voz que estiver por baixo continua passando.
    {
      const Ref = this.Ref, Tk = this.Tk;
      let up = 0, n = 0, sl = 0, sa = 0;
      if (this.frames > 2) for (let k = this.tLo; k <= this.tHi; k++) { n++; if (P[k] > 6 * Ref[k]) up++; sl += Math.log(P[k]); sa += P[k]; }
      const frac = n ? up / n : 0;
      const flat = n ? Math.exp(sl / n) / (sa / n + 1e-20) : 0;   // voz: ~0,01–0,1 (inclinada, com harmônicos); estalo: ~0,3+
      this.flat = flat;
      if (this.transient && frac > (this.tune.tfrac ?? 0.45) && flat > (this.tune.tflat ?? 0.2)) {
        // começou fora da fala? então é só a palma: some de vez e segura mais (cauda do eco da sala)
        if (this.tHold === 0) this.tQuiet = !prevSp;
        this.tHold = this.tQuiet ? 30 : 14;
      } else if (this.tQuiet && this.tHold > 0 && flat > 0.3) this.tHold = Math.max(this.tHold, 8);
      // voz (harmônicos, espectro inclinado) chegando logo depois: solta na hora para não comer o começo da fala
      else if (this.tQuiet && this.tHold > 0 && this.tHold < 27 && flat < 0.06) { this.tHold = 0; this.tQuiet = false; }
      // a palma não pode se passar por fala (senão abre o portão e o piso fica alto)
      if (this.tQuiet && this.tHold > 0) { this.Rs = prevRs; this.speech = prevSp; this.hang = prevHang; }
      if (this.tHold > 0) {
        this.tHold--;
        const fl0 = this.tQuiet ? this.tFloorQuiet : this.tFloor;   // fora da fala: palma some de vez
        for (let k = 0; k < K; k++) { const lim = this.tAllow * Ref[k] / P[k]; const g = lim < 1 ? Math.max(this.tQuiet ? lim : Math.sqrt(lim), fl0) : 1; Tk[k] = Math.min(Tk[k], g); }
      }
      // referência: segue o espectro devagar e ignora o que veio de um estalo
      for (let k = 0; k < K; k++) {
        const v = this.tHold > 0 ? Math.min(P[k], Ref[k] * 1.5) : P[k];
        Ref[k] = this.frames === 0 ? P[k] : (v > Ref[k] ? 0.75 * Ref[k] + 0.25 * v : 0.5 * Ref[k] + 0.5 * v);
      }
    }
    // --- ganho
    const mu = this.mu, alpha = this.alpha;
    const xiMin = 0.003;
    const floorV = this.gmin, floorS = this.gminSpeech;
    for (let k = 0; k < K; k++) {
      const nn = Nz[k] * this.NB * mu;
      const gam = P[k] / nn;
      let xi = alpha * (A2[k] / nn) + (1 - alpha) * Math.max(gam - 1, 0);
      if (xi < xiMin) xi = xiMin;
      let g = xi / (1 + xi);
      // piso alto só nos bins da faixa de voz com energia acima do ruído (protege harmônicos/formantes)
      const fl2 = (this.speech && k >= kLo && k <= kHi && Sf[k] / nn > (this.tune.pth ?? 1.7)) ? floorS : floorV;
      if (g < fl2) g = fl2;
      G[k] = g;
    }
    // suavização em frequência (3 pontos) e no tempo (sobe rápido, desce devagar)
    for (let k = 0; k < K; k++) {
      const a = G[k > 0 ? k - 1 : 0], c = G[k < K - 1 ? k + 1 : K - 1];
      const gf = 0.2 * a + 0.6 * G[k] + 0.2 * c;
      Gs[k] += (gf - Gs[k]) * (gf > Gs[k] ? 0.75 : 0.35);
    }
    // gate suave: atenuação extra, quadro todo, fora da fala
    const gt = this.speech ? 1 : this.gateFloor;
    this.gateG += (gt - this.gateG) * (gt > this.gateG ? 0.4 : 0.02);
    const gg = this.gateG; const Tk = this.Tk;
    for (let k = 0; k < K; k++) {
      const g = Gs[k] * gg * Tk[k];
      Tk[k] += (1 - Tk[k]) * 0.35;   // solta rápido depois do estalo
      re[k] *= g; im[k] *= g;
      A2[k] = P[k] * g * g;
      if (k > 0 && k < K - 1) { re[N - k] = re[k]; im[N - k] = -im[k]; }
    }
    im[0] = 0; im[K - 1] = 0;
    fft(re, im, true);
    // overlap-add
    const ola = this.ola;
    for (let i = 0; i < N; i++) ola[(this.olaPos + i) & mask] += re[i] * WIN[i] * OLA / N;
    for (let i = 0; i < HOP; i++) { const p = (this.olaPos + i) & mask; dst[off + i] = ola[p]; ola[p] = 0; }
    this.olaPos = (this.olaPos + HOP) & mask;
    this.frames++;
  }
}
Denoiser.prototype.NB = 4.5; // compensação de viés do rastreio de mínimo (calibrado em ruído puro)
export const LATENCY_SAMPLES = N - HOP;
