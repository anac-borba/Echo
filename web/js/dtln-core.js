'use strict';
// DTLN (Dual-Signal Transformation LSTM Network, Nils Westhausen, MIT): rede neural de supressão de ruído,
// melhor que a RNNoise para barulho que muda (teclado, palmas, rua, TV). Roda aqui, em JavaScript puro,
// com os pesos do modelo pré-treinado (/js/vendor/dtln.bin, extraídos dos .onnx do repositório breizhn/DTLN).
// Trabalha a 16 kHz, em blocos de 512 amostras com passo de 128 (8 ms). Sem DOM: roda no worklet e no Node.

// posição de cada matriz no arquivo de pesos (float32): [início, linhas, colunas]
export const LAYOUT = {
  l1W: [0, 512, 257], l1R: [131584, 512, 128], l1B: [197120, 512],
  l2W: [197632, 512, 128], l2R: [263168, 512, 128], l2B: [328704, 512],
  d1K: [329216, 257, 128], d1b: [362112, 257],
  c2: [362369, 256, 512], lnG: [493441, 256], lnB: [493697, 256],
  l6W: [493953, 512, 256], l6R: [625025, 512, 128], l6B: [690561, 512],
  l7W: [691073, 512, 128], l7R: [756609, 512, 128], l7B: [822145, 512],
  d3K: [822657, 256, 128], d3b: [855425, 256],
  c3: [855681, 512, 256],
};
export const TOTAL = 986753;
const N = 512, HOP = 128, K = 257, H = 128;

// y = M x (+ add), M linhas×colunas em ordem de linha
function mv(M, off, rows, cols, x, y, acc) {
  for (let r = 0, p = off; r < rows; r++) {
    let s = 0;
    for (let c = 0; c < cols; c++) s += M[p + c] * x[c];
    p += cols;
    y[r] = acc ? y[r] + s : s;
  }
}
const sig = (v) => 1 / (1 + Math.exp(-v));

// FFT complexa de 512 pontos (raiz 2, no lugar)
const REV = new Uint16Array(N), COS = new Float64Array(N / 2), SIN = new Float64Array(N / 2);
for (let i = 0; i < N; i++) { let r = 0; for (let b = 0; b < 9; b++) if (i & (1 << b)) r |= 1 << (8 - b); REV[i] = r; }
for (let i = 0; i < N / 2; i++) { COS[i] = Math.cos(2 * Math.PI * i / N); SIN[i] = -Math.sin(2 * Math.PI * i / N); }
function fft(re, im, inv) {
  for (let i = 0; i < N; i++) { const j = REV[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let s = 0; s < N; s += size) {
      for (let k = 0, t = 0; k < half; k++, t += step) {
        const wr = COS[t], wi = inv ? -SIN[t] : SIN[t], a = s + k, b = a + half;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
    }
  }
}

export class Dtln {
  constructor(weights) {
    this.w = weights instanceof Float32Array ? weights : new Float32Array(weights);
    if (this.w.length !== TOTAL) throw new Error('pesos do DTLN com tamanho errado');
    this.inb = new Float32Array(N); this.outb = new Float32Array(N);
    this.h = Array.from({ length: 8 }, () => new Float32Array(H));
    this.re = new Float64Array(N); this.im = new Float64Array(N);
    this.mag = new Float32Array(K); this.g = new Float32Array(512); this.mask = new Float32Array(K);
    this.est = new Float32Array(N); this.enc = new Float32Array(256); this.nrm = new Float32Array(256); this.m2 = new Float32Array(256);
    this.dec = new Float32Array(N);
  }
  // LSTM do modelo 1 (formato ONNX: portões i, o, f, c; viés já somado)
  lstmA(W, R, B, inSize, x, h, c) {
    const L = LAYOUT, w = this.w, g = this.g;
    mv(w, L[W][0], 512, inSize, x, g, false);
    mv(w, L[R][0], 512, H, h, g, true);
    const b = L[B][0];
    for (let j = 0; j < H; j++) {
      const i = sig(g[j] + w[b + j]), o = sig(g[H + j] + w[b + H + j]), f = sig(g[2 * H + j] + w[b + 2 * H + j]), cc = Math.tanh(g[3 * H + j] + w[b + 3 * H + j]);
      c[j] = f * c[j] + i * cc; h[j] = o * Math.tanh(c[j]);
    }
  }
  // LSTM do modelo 2 (formato Keras: portões i, f, c, o)
  lstmB(W, R, B, inSize, x, h, c) {
    const L = LAYOUT, w = this.w, g = this.g;
    mv(w, L[W][0], 512, inSize, x, g, false);
    mv(w, L[R][0], 512, H, h, g, true);
    const b = L[B][0];
    for (let j = 0; j < H; j++) {
      const i = sig(g[j] + w[b + j]), f = sig(g[H + j] + w[b + H + j]), cc = Math.tanh(g[2 * H + j] + w[b + 2 * H + j]), o = sig(g[3 * H + j] + w[b + 3 * H + j]);
      c[j] = f * c[j] + i * cc; h[j] = o * Math.tanh(c[j]);
    }
  }
  /** Recebe 128 amostras (16 kHz) e devolve 128 amostras limpas (com atraso de 384). */
  process(x, y) {
    const L = LAYOUT, w = this.w, inb = this.inb, re = this.re, im = this.im, mag = this.mag, h = this.h;
    inb.copyWithin(0, HOP); inb.set(x, N - HOP);
    for (let i = 0; i < N; i++) { re[i] = inb[i]; im[i] = 0; }
    fft(re, im, false);
    for (let k = 0; k < K; k++) mag[k] = Math.hypot(re[k], im[k]);
    this.lstmA('l1W', 'l1R', 'l1B', K, mag, h[0], h[1]);
    this.lstmA('l2W', 'l2R', 'l2B', H, h[0], h[2], h[3]);
    const mask = this.mask; mv(w, L.d1K[0], K, H, h[2], mask, false);
    for (let k = 0; k < K; k++) { const m = sig(mask[k] + w[L.d1b[0] + k]); re[k] *= m; im[k] *= m; }
    // volta ao tempo (espectro hermitiano)
    for (let k = 1; k < N / 2; k++) { re[N - k] = re[k]; im[N - k] = -im[k]; }
    im[0] = 0; im[N / 2] = 0;
    fft(re, im, true);
    const est = this.est; for (let i = 0; i < N; i++) est[i] = re[i] / N;
    const enc = this.enc; mv(w, L.c2[0], 256, N, est, enc, false);
    let mean = 0; for (let i = 0; i < 256; i++) mean += enc[i]; mean /= 256;
    let v = 0; for (let i = 0; i < 256; i++) { const d = enc[i] - mean; v += d * d; } v /= 256;
    const sd = Math.sqrt(v + 1e-7), nrm = this.nrm;
    for (let i = 0; i < 256; i++) nrm[i] = (enc[i] - mean) / sd * w[L.lnG[0] + i] + w[L.lnB[0] + i];
    this.lstmB('l6W', 'l6R', 'l6B', 256, nrm, h[4], h[5]);
    this.lstmB('l7W', 'l7R', 'l7B', H, h[4], h[6], h[7]);
    const m2 = this.m2; mv(w, L.d3K[0], 256, H, h[6], m2, false);
    for (let i = 0; i < 256; i++) m2[i] = enc[i] * sig(m2[i] + w[L.d3b[0] + i]);
    const dec = this.dec; mv(w, L.c3[0], N, 256, m2, dec, false);
    const ob = this.outb; ob.copyWithin(0, HOP); ob.fill(0, N - HOP);
    for (let i = 0; i < N; i++) ob[i] += dec[i];
    y.set(ob.subarray(0, HOP));
  }
}

/* ── troca de taxa 48 kHz ⇄ 16 kHz (fator 3) com um passa-baixa FIR ── */
const TAPS = 96;
const FIR = (() => {
  const f = new Float32Array(TAPS), fc = 7200 / 48000; let s = 0;
  for (let i = 0; i < TAPS; i++) {
    const n = i - (TAPS - 1) / 2, x = 2 * Math.PI * fc * n;
    const sinc = n === 0 ? 2 * fc : Math.sin(x) / (Math.PI * n);
    const win = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (TAPS - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (TAPS - 1));
    f[i] = sinc * win; s += f[i];
  }
  for (let i = 0; i < TAPS; i++) f[i] /= s;
  return f;
})();

/** Liga tudo: entra 48 kHz em blocos de qualquer tamanho, sai 48 kHz (atraso ≈ 40 ms). */
export class Dtln48 {
  constructor(weights) {
    this.net = new Dtln(weights);
    this.hist = new Float32Array(TAPS); this.hi = 0; this.phase = 0; // decimação
    this.q16 = new Float32Array(HOP); this.q16n = 0;                // fila 16 kHz para a rede
    this.o16 = new Float32Array(HOP); this.blk = new Float32Array(HOP);
    this.uh = new Float32Array(TAPS); this.ui = 0;                     // interpolação
    this.out = new Float32Array(8192); this.or = 0; this.ow = 0; this.on = 0;
    this.mix = 1;                                                      // 1 = só o limpo
  }
  pushOut(v) { this.out[this.ow] = v; this.ow = (this.ow + 1) & 8191; this.on++; }
  process(inp, outp) {
    const n = inp.length, F = FIR, hist = this.hist;
    for (let i = 0; i < n; i++) {
      hist[this.hi] = inp[i]; this.hi = (this.hi + 1) % TAPS;
      if (++this.phase === 3) {
        this.phase = 0;
        let s = 0; for (let k = 0, j = this.hi; k < TAPS; k++, j = (j + 1) % TAPS) s += F[k] * hist[j];
        this.q16[this.q16n++] = s;
        if (this.q16n === HOP) {
          this.net.process(this.q16, this.o16); this.q16n = 0;
          // interpola cada amostra de 16 kHz em 3 (zeros no meio + o mesmo filtro ×3)
          const uh = this.uh;
          for (let m = 0; m < HOP; m++) {
            for (let p = 0; p < 3; p++) {
              uh[this.ui] = p === 0 ? this.o16[m] * 3 : 0; this.ui = (this.ui + 1) % TAPS;
              let s2 = 0; for (let k = 0, j = this.ui; k < TAPS; k++, j = (j + 1) % TAPS) s2 += F[k] * uh[j];
              this.pushOut(s2);
            }
          }
        }
      }
    }
    if (this.on >= n) {
      for (let i = 0; i < n; i++) { outp[i] = this.out[this.or]; this.or = (this.or + 1) & 8191; }
      this.on -= n;
    } else outp.fill(0);
  }
}

/** Os pesos vêm em float16 (metade do download); aqui viram float32. */
export function halfToFloat(u16) {
  const out = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) {
    const h = u16[i], s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
    out[i] = e === 0 ? s * m * 5.960464477539063e-8 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * Math.pow(2, e - 15);
  }
  return out;
}
