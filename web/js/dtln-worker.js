// Worker do DTLN: a conta pesada da rede de ruído roda aqui, numa linha separada, para nunca travar o áudio
// (antes rodava dentro do próprio AudioWorklet: em computador mais fraco o som da ligação craquelava).
// Fala direto com o worklet por um MessagePort: recebe blocos de 128 amostras (48 kHz) e devolve limpos.
// Se ficar lento demais para tempo real, avisa a página, que troca para o filtro leve.
import { Dtln48, halfToFloat } from './dtln-core.js';

let d = null, port = null, gate = false, g = 1;
let busy = 0, n = 0, slowSent = false;
const BUDGET = 128 / 48; // ms de áudio em cada bloco (2,67 ms)

function onBlock(e) {
  const x = e.data;
  if (!(x instanceof Float32Array)) return;
  const y = new Float32Array(x.length);
  const t0 = performance.now();
  if (d) d.process(x, y); else y.set(x);
  if (d && gate) {
    let s = 0; for (let i = 0; i < y.length; i++) s += y[i] * y[i];
    const target = Math.sqrt(s / y.length) > 0.003 ? 1 : 0.05;
    for (let i = 0; i < y.length; i++) { g += (target - g) * (target > g ? 0.05 : 0.002); y[i] *= g; }
  }
  busy += performance.now() - t0; n++;
  // a cada ~2 s: se gastou mais de 70% do tempo do áudio, não dá conta neste aparelho
  if (n >= 750) { if (!slowSent && busy / n > BUDGET * 0.7) { slowSent = true; self.postMessage({ slow: busy / n }); } busy = 0; n = 0; }
  port.postMessage(y, [y.buffer]);
}

self.onmessage = (e) => {
  const m = e.data || {};
  if (m.port) { port = m.port; port.onmessage = onBlock; }
  if (m.weights) { try { d = new Dtln48(m.half ? halfToFloat(new Uint16Array(m.weights)) : new Float32Array(m.weights)); self.postMessage({ ready: true }); } catch (err) { self.postMessage({ err: String(err) }); } }
  if (typeof m.gate === 'boolean') gate = m.gate;
};
