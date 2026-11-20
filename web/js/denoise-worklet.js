// AudioWorklet 'echo-denoise': supressão de ruído estacionário (ventilador, ar-condicionado, zumbido).
// A lógica fica em denoise-core.js (mesma origem; import estático permitido pela CSP 'self').
import { Denoiser } from './denoise-core.js';

class EchoDenoise extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    this.d = new Denoiser(sampleRate);
    const po = (opts && opts.processorOptions) || {};
    this.d.setParams(po);
    this.port.onmessage = (e) => { if (e.data && typeof e.data === 'object') this.d.setParams(e.data); };
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    if (!out || !out.length) return true;
    if (!inp || !inp.length) { for (let c = 0; c < out.length; c++) out[c].fill(0); return true; }
    this.d.process(inp[0], out[0], out[0].length);
    for (let c = 1; c < out.length; c++) out[c].set(out[0]);
    return true;
  }
}
registerProcessor('echo-denoise', EchoDenoise);
