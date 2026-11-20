// AudioWorklet 'echo-dtln': só junta e devolve áudio. A rede DTLN roda num Worker (dtln-worker.js), fora da
// linha de áudio, para que um computador mais lento nunca faça o som craquelar.
// Fluxo: a cada 128 amostras manda um bloco para o worker; o que volta entra numa fila e sai com ~16 ms de folga.
// Se a fila secar (o worker atrasou), repete a folga em vez de soltar estalos; se secar muito, avisa a página.
const PRE = 128 * 6;
class EchoDtln extends AudioWorkletProcessor {
  constructor() {
    super();
    this.q = new Float32Array(48000); this.r = 0; this.w = 0; this.n = 0;
    this.playing = false; this.port2 = null; this.dry = 0; this.under = 0; this.sent = 0;
    this.port.onmessage = (e) => {
      const m = e.data || {};
      if (m.port) { this.port2 = m.port; this.port2.onmessage = (ev) => this.take(ev.data); }
    };
  }
  take(y) {
    if (!(y instanceof Float32Array)) return;
    for (let i = 0; i < y.length; i++) { this.q[this.w] = y[i]; this.w = (this.w + 1) % this.q.length; }
    this.n = Math.min(this.q.length, this.n + y.length);
    if (this.n > this.q.length / 2) { this.r = (this.w - PRE + this.q.length) % this.q.length; this.n = PRE; } // atraso acumulado: volta para a folga
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    if (!out || !out.length) return true;
    const o = out[0], src = inp && inp.length ? inp[0] : null;
    if (!this.port2) { if (src) o.set(src); else o.fill(0); }
    else {
      const blk = new Float32Array(o.length); if (src) blk.set(src);
      this.port2.postMessage(blk, [blk.buffer]);
      if (!this.playing && this.n >= PRE) this.playing = true;
      if (this.playing && this.n >= o.length) {
        for (let i = 0; i < o.length; i++) { o[i] = this.q[this.r]; this.r = (this.r + 1) % this.q.length; }
        this.n -= o.length;
      } else {
        o.fill(0);
        if (this.playing) { this.playing = false; this.under++; if (this.under === 25) this.port.postMessage({ slow: true }); }
      }
    }
    for (let c = 1; c < out.length; c++) out[c].set(o);
    return true;
  }
}
registerProcessor('echo-dtln', EchoDtln);
