// Porta de ruído (noise gate): abaixa o volume quando só tem barulho de fundo.
// Roda numa thread de áudio separada (AudioWorklet).
class GateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.thr = Math.pow(10, -55 / 20);
    this.env = 0;
    this.gain = 0;
    this.hold = 0;
    this.port.onmessage = (e) => {
      if (typeof e.data.db === 'number') this.thr = e.data.db <= -99 ? 0 : Math.pow(10, e.data.db / 20);
    };
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return true;
    const n = inp[0].length;
    let sum = 0;
    for (let c = 0; c < inp.length; c++) for (let i = 0; i < n; i++) sum += inp[c][i] * inp[c][i];
    const rms = Math.sqrt(sum / (n * inp.length));
    this.env = Math.max(rms, this.env * 0.992);
    if (this.thr === 0 || this.env > this.thr) this.hold = 0.18 * sampleRate / n;
    else this.hold = Math.max(0, this.hold - 1);
    const target = this.hold > 0 ? 1 : 0;
    const k = target > this.gain ? 0.5 : 0.06; // abre rápido, fecha devagar
    for (let c = 0; c < out.length; c++) {
      const src = inp[Math.min(c, inp.length - 1)];
      let g = this.gain;
      for (let i = 0; i < n; i++) { g += (target - g) * k / 4; out[c][i] = src[i] * g; }
      if (c === out.length - 1) this.gain = g;
    }
    return true;
  }
}
registerProcessor('telinha-gate', GateProcessor);
