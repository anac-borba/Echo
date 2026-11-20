// Sinais sintéticos determinísticos para testar o supressor de ruído.
export const SR = 48000;
export function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function gauss(r) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }

/** Voz sintética: harmônicos (f0 100-220 Hz com glide), 3 formantes variando por sílaba, envelope silábico.
 *  Estrutura: 1.5 s de silêncio, depois blocos de fala (frases de ~2.4 s) separados por pausas de 1.0 s. Devolve {x, active}. */
export function synthVoice(seconds, { f0 = 130, seed = 1 } = {}) {
  const n = Math.round(seconds * SR), x = new Float64Array(n), active = new Uint8Array(n), r = rng(seed);
  let phase = 0, t = 1.5;
  const sylls = [];
  while (t < seconds - 0.3) {
    const nS = 6 + Math.floor(r() * 3);
    for (let i = 0; i < nS && t < seconds - 0.3; i++) {
      const d = 0.14 + r() * 0.08;
      sylls.push({ t0: t, t1: t + d, f0a: f0 * (0.9 + 0.25 * r()), f0b: f0 * (0.9 + 0.25 * r()), F1: 300 + 500 * r(), F2: 900 + 1300 * r(), F3: 2500 + 300 * r() });
      t += d + 0.03 + 0.03 * r();
    }
    t += 1.0; // pausa
  }
  for (const s of sylls) {
    const a = Math.floor(s.t0 * SR), b = Math.min(n, Math.floor(s.t1 * SR));
    for (let i = a; i < b; i++) {
      const u = (i - a) / (b - a), env = Math.pow(Math.sin(Math.PI * u), 0.8);
      const f = s.f0a + (s.f0b - s.f0a) * u + 3 * Math.sin(2 * Math.PI * 5.5 * i / SR);
      phase += 2 * Math.PI * f / SR;
      let v = 0;
      for (let h = 1; h * f < 5500; h++) {
        const fh = h * f;
        const form = Math.exp(-0.5 * ((fh - s.F1) / 130) ** 2) + 0.7 * Math.exp(-0.5 * ((fh - s.F2) / 200) ** 2) + 0.35 * Math.exp(-0.5 * ((fh - s.F3) / 300) ** 2) + 0.03;
        v += form / Math.pow(h, 0.6) * Math.sin(h * phase);
      }
      x[i] += v * env + 0.01 * gauss(r) * env; active[i] = 1;
    }
  }
  // normaliza: RMS nos trechos ativos = -20 dBFS
  let e = 0, c = 0; for (let i = 0; i < n; i++) if (active[i]) { e += x[i] * x[i]; c++; }
  const g = Math.pow(10, -20 / 20) / Math.sqrt(e / c); for (let i = 0; i < n; i++) x[i] *= g;
  return { x, active };
}

/** Ruído de ventilador/ar-condicionado: ruído passa-baixa (2 polos ~600 Hz + sopro) + tons 120/240/360 Hz. RMS = 1 */
export function fanNoise(seconds, { seed = 7, tones = true } = {}) {
  const n = Math.round(seconds * SR), x = new Float64Array(n), r = rng(seed);
  let y1 = 0, y2 = 0, y3 = 0; const a = Math.exp(-2 * Math.PI * 600 / SR), b = Math.exp(-2 * Math.PI * 3000 / SR);
  for (let i = 0; i < n; i++) {
    const w = gauss(r);
    y1 = a * y1 + (1 - a) * w; y2 = a * y2 + (1 - a) * y1; y3 = b * y3 + (1 - b) * w;
    const am = 1 + 0.1 * Math.sin(2 * Math.PI * 0.3 * i / SR);
    x[i] = 6 * y2 * am + 0.8 * y3;
    if (tones) x[i] += 0.5 * Math.sin(2 * Math.PI * 120 * i / SR) + 0.3 * Math.sin(2 * Math.PI * 240 * i / SR + 1) + 0.12 * Math.sin(2 * Math.PI * 360 * i / SR + 2);
  }
  return normRms(x, 1);
}
export function normRms(x, target) { let e = 0; for (const v of x) e += v * v; const g = target / Math.sqrt(e / x.length); for (let i = 0; i < x.length; i++) x[i] *= g; return x; }
/** Cliques de teclado (ruído não estacionário): rajadas de 8 ms em instantes dados */
export function keyClicks(seconds, times, { seed = 3, amp = 0.2 } = {}) {
  const n = Math.round(seconds * SR), x = new Float64Array(n), r = rng(seed);
  for (const t of times) { const a = Math.floor(t * SR), L = Math.floor(0.008 * SR); for (let i = 0; i < L && a + i < n; i++) x[a + i] += amp * gauss(r) * Math.exp(-i / (L / 4)); }
  return x;
}
/** mistura voz + ruído com SNR (dB) medido no RMS dos trechos ativos da voz vs RMS do ruído */
export function mix(voice, noise, snrDb) {
  const v = voice.x, g = Math.pow(10, -snrDb / 20) * Math.pow(10, -20 / 20); // voz ativa = -20 dBFS; ruído RMS=1*g
  const out = new Float64Array(v.length), nz = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) { nz[i] = noise[i] * g; out[i] = v[i] + nz[i]; }
  return { mix: out, noise: nz };
}
export function writeWav(path, x, fs) {
  const n = x.length, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(fs, 24); buf.writeUInt32LE(fs * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  return import('node:fs').then((fs_) => fs_.writeFileSync(path, buf));
}
