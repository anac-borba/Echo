// Teste de unidade do DSP (Node): node dev/denoise-test.mjs
import { Denoiser, LATENCY_SAMPLES } from '../web/js/denoise-core.js';
import { SR, synthVoice, fanNoise, mix, keyClicks, rng } from './denoise-signals.mjs';

const db = (x) => 10 * Math.log10(x + 1e-20);
function run(x, params = {}) {
  const d = new Denoiser(SR); d.setParams({ mode: 'isolation', ...params });
  const y = new Float64Array(x.length), bi = new Float32Array(128), bo = new Float32Array(128);
  for (let i = 0; i + 128 <= x.length; i += 128) { for (let j = 0; j < 128; j++) bi[j] = x[i + j]; d.process(bi, bo, 128); for (let j = 0; j < 128; j++) y[i + j] = bo[j]; }
  return y;
}
const D = LATENCY_SAMPLES;
const pw = (x, m, a = 0, b = x.length) => { let e = 0, c = 0; for (let i = a; i < b; i++) if (m(i)) { e += x[i] * x[i]; c++; } return e / Math.max(c, 1); };
// máscaras: voz ativa dilatada 0.2 s (voz) ; "só ruído" = longe >0.3 s de qualquer voz e após 3 s (aprendizado)
function masks(active) {
  const n = active.length, w = Math.round(0.3 * SR), near = new Uint8Array(n); let last = -1e9;
  for (let i = 0; i < n; i++) { if (active[i]) last = i; if (i - last < w) near[i] = 1; }
  last = 1e9; for (let i = n - 1; i >= 0; i--) { if (active[i]) last = i; if (last - i < w) near[i] = 1; }
  return { onlyNoise: (i) => !near[i] && i > 3 * SR };
}
// ganho LS e SNR/SDR alinhando atraso D
function ls(y, s, a, b) { let sy = 0, ss = 0; for (let i = a; i < b; i++) { sy += y[i + D] * s[i]; ss += s[i] * s[i]; } return sy / ss; }
function snrOut(y, s, act) { // y atrasado D; compara com s escalado por ganho LS (nos trechos ativos)
  const n = s.length - D; const g = ls(y, s, 0, n); let es = 0, ee = 0;
  for (let i = 0; i < n; i++) if (act[i]) { es += (g * s[i]) ** 2; const e = y[i + D] - g * s[i]; ee += e * e; }
  return { g, snr: db(es / ee) };
}
const rows = [];
const voices = [{ f0: 110, seed: 1 }, { f0: 200, seed: 2 }];
const noise = fanNoise(25);
for (const vp of voices) {
  const v = synthVoice(25, vp), M = masks(v.active);
  for (const snr of [0, 5, 10, Infinity]) {
    const m = snr === Infinity ? { mix: v.x, noise: new Float64Array(v.x.length) } : mix(v, noise, snr);
    for (const [label, params] of [['forte', { mode: 'isolation' }], ['medio', { mode: 'custom', intensity: 0.5 }]]) {
      const y = run(m.mix, params), n = y.length - D, yv = y.subarray(D);
      const noiseIn = pw(m.noise, M.onlyNoise, 0, n), noiseOut = pw(yv, M.onlyNoise, 0, n);
      const actM = (i) => v.active[i] === 1;
      const { g, snr: so } = snrOut(y, v.x, v.active);
      const inSnr = snr === Infinity ? Infinity : db(pw(v.x, actM, 0, n) / pw(m.noise, actM, 0, n));
      rows.push({ voz: 'f0=' + vp.f0, SNRin: snr === Infinity ? 'limpa' : snr, modo: label,
        'ruido_so(dB)': snr === Infinity ? '-' : +(db(noiseOut) - db(noiseIn)).toFixed(1),
        'nivel_voz(dB)': +(20 * Math.log10(Math.abs(g))).toFixed(2),
        'SNRout': snr === Infinity ? '-' : +so.toFixed(1), 'SDR_voz_limpa': snr === Infinity ? +so.toFixed(1) : '-' });
    }
  }
}
console.log('Modo forte = isolamento (intensidade 1 + gate); medio = personalizado 0.5. Atenuação negativa = ruído reduzido.');
console.table(rows);
{ // verificação das metas (modo forte): >= 20 dB de redução do ruído em trechos só-ruído; voz com perda < 2 dB
  const f = rows.filter((r) => r.modo === 'forte' && r.SNRin !== 'limpa');
  const nrWorst = Math.max(...f.map((r) => r['ruido_so(dB)'])), vlWorst = Math.min(...f.map((r) => r['nivel_voz(dB)']));
  console.log(`META forte: pior reducao de ruido ${nrWorst} dB (meta <= -20): ${nrWorst <= -20 ? 'OK' : 'ABAIXO'} | pior nivel de voz ${vlWorst} dB (meta >= -2): ${vlWorst >= -2 ? 'OK' : 'ABAIXO'}`);
  for (const r of f) if (r['nivel_voz(dB)'] < -2) console.log(`  perda de voz acima da meta: ${r.voz} SNRin=${r.SNRin} -> ${r['nivel_voz(dB)']} dB`);
}
// ruído sozinho
{
  const nz = fanNoise(20), z = new Float64Array(nz.length); for (let i = 0; i < nz.length; i++) nz[i] *= 0.05;
  for (const [label, p] of [['forte', { mode: 'isolation' }], ['medio', { mode: 'custom', intensity: 0.5 }]]) {
    const y = run(nz, p), a = 5 * SR; console.log(`ruido sozinho ${label}: entrada->saida apos 5s: ${(db(pw(y, () => 1, a)) - db(pw(nz, () => 1, a))).toFixed(1)} dB`);
  }
}
// ruído sozinho, só o espectral (sem gate extra), como no modo personalizado com intensidade 1, nível -25 dBFS
{
  const nz = fanNoise(24); for (let i = 0; i < nz.length; i++) nz[i] *= 0.056;
  const y = run(nz, { mode: 'custom', intensity: 1, gate: false }), a = 6 * SR;
  console.log(`ruido sozinho (-25 dBFS), so espectral sem gate: ${(db(pw(y, () => 1, a)) - db(pw(nz, () => 1, a))).toFixed(1)} dB (6-24 s)`);
}
// ruído não estacionário: cliques de teclado sobre ventilador (SNR voz 10 dB), medido nos cliques em pausa
{
  const v = synthVoice(25, { f0: 130, seed: 5 }), M = masks(v.active), times = [];
  for (let t = 4; t < 24; t += 0.37) { const i = Math.round(t * SR); if (M.onlyNoise(i)) times.push(t); }
  const clk = keyClicks(25, times), nzm = mix(v, noise, 10), inp = new Float64Array(clk.length);
  for (let i = 0; i < inp.length; i++) inp[i] = nzm.mix[i] + clk[i];
  const y = run(inp, { mode: 'isolation' });
  let eIn = 0, eOut = 0; for (const t of times) { const a = Math.round(t * SR), b = a + Math.round(0.012 * SR); for (let i = a; i < b; i++) { eIn += clk[i] ** 2; } }
  // energia do clique na saída: (saída - saída sem clique) nos mesmos instantes
  const y0 = run(nzm.mix, { mode: 'isolation' });
  for (const t of times) { const a = Math.round(t * SR), b = a + Math.round(0.012 * SR); for (let i = a; i < b; i++) { const d = y[i + D] - y0[i + D]; eOut += d * d; } }
  console.log(`cliques de teclado (em pausas, sobre ventilador): reducao media ${(db(eOut) - db(eIn)).toFixed(1)} dB (atencao: so parcial, nao estacionario)`);
}
// latência algorítmica
console.log(`latencia algoritmica: ${D} amostras = ${(1000 * D / SR).toFixed(1)} ms (+ bloco do WebAudio 128 = ${(128000 / SR).toFixed(1)} ms ja no caminho alinhado nao soma)`);
// palmas: rajadas largas (~40 ms, decaimento rápido), em pausas e por cima da fala
{
  const R = rng(99);
  const claps = (sec, times, amp = 0.5) => { const x = new Float64Array(Math.round(sec * SR)); for (const t of times) { const a = Math.round(t * SR); for (let i = 0; i < 0.06 * SR && a + i < x.length; i++) x[a + i] += amp * (R() * 2 - 1) * Math.exp(-i / (0.012 * SR)); } return x; };
  const v = synthVoice(25, { f0: 160, seed: 9 }), M = masks(v.active), pause = [], over = [];
  for (let t = 4; t < 24; t += 0.53) { const i = Math.round(t * SR); (M.onlyNoise(i) ? pause : over).push(t); }
  for (const [label, times] of [['em pausas', pause], ['sobre a fala', over]]) {
    const c = claps(25, times), base = mix(v, noise, 15).mix, inp = new Float64Array(c.length);
    for (let i = 0; i < inp.length; i++) inp[i] = base[i] + c[i];
    const y = run(inp, { mode: 'isolation' }), y0 = run(base, { mode: 'isolation' });
    let eIn = 0, eOut = 0;
    for (const t of times) { const a = Math.round(t * SR), b = a + Math.round(0.06 * SR); for (let i = a; i < b; i++) { eIn += c[i] ** 2; const d = y[i + D] - y0[i + D]; eOut += d * d; } }
    console.log(`palmas ${label}: reducao ${(db(eOut) - db(eIn)).toFixed(1)} dB (${times.length})`);
  }
}
