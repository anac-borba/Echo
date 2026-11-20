// Worker do DeepFilterNet3: a rede de ruído mais forte (48 kHz, a voz inteira, sem abafar) roda aqui, fora da
// linha de áudio, igual ao DTLN. Usa o mesmo worklet ('echo-dtln') e o mesmo protocolo: recebe blocos de 128
// amostras e devolve 128 por vez. A rede trabalha em quadros de 480 (10 ms): junta, processa e vai devolvendo.
// df.js e df_bg.wasm: compilados do código original (github.com/Rikorose/DeepFilterNet, libDF, MIT/Apache-2.0) com wasm-pack.
import { initSync, df_create, df_get_frame_length, df_process_frame, df_set_atten_lim, df_set_post_filter_beta } from './vendor/dfn3/df.js';

let st = 0, F = 480, port = null, ready = false;
const inq = new Float32Array(4800); let inN = 0;
const outq = new Float32Array(9600); let oR = 0, oW = 0, oN = 0;
let frame = null;
let busy = 0, n = 0, slowSent = false;
const BUDGET = 128 / 48; // ms de áudio em cada bloco

function onBlock(e) {
  const x = e.data;
  if (!(x instanceof Float32Array)) return;
  const y = new Float32Array(x.length);
  const t0 = performance.now();
  if (!ready) y.set(x);
  else {
    inq.set(x, inN); inN += x.length;
    while (inN >= F) {
      frame.set(inq.subarray(0, F));
      inq.copyWithin(0, F, inN); inN -= F;
      let out;
      try { out = df_process_frame(st, frame); } catch (err) { self.postMessage({ err: String(err) }); ready = false; y.set(x); break; }
      for (let i = 0; i < out.length; i++) { outq[oW] = out[i]; oW = (oW + 1) % outq.length; }
      oN = Math.min(outq.length, oN + out.length);
    }
    if (ready && oN >= y.length) { for (let i = 0; i < y.length; i++) { y[i] = outq[oR]; oR = (oR + 1) % outq.length; } oN -= y.length; }
  }
  busy += performance.now() - t0; n++;
  if (n >= 750) { if (!slowSent && busy / n > BUDGET * 0.7) { slowSent = true; self.postMessage({ slow: busy / n }); } busy = 0; n = 0; }
  port.postMessage(y, [y.buffer]);
}

self.onmessage = (e) => {
  const m = e.data || {};
  if (m.port) { port = m.port; port.onmessage = onBlock; }
  if (m.wasm && m.model) {
    try {
      initSync(new WebAssembly.Module(m.wasm));
      st = df_create(new Uint8Array(m.model), typeof m.atten === 'number' ? m.atten : 60);
      if (m.post) { try { df_set_post_filter_beta(st, 0.02); } catch { /* versão sem pós-filtro */ } }
      F = df_get_frame_length(st);
      frame = new Float32Array(F);
      ready = true;
      self.postMessage({ ready: true, frame: F });
    } catch (err) { self.postMessage({ err: String(err) }); }
  }
  if (typeof m.atten === 'number' && ready) { try { df_set_atten_lim(st, m.atten); } catch { /* ok */ } }
};
