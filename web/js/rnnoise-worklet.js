// AudioWorklet 'echo-rnnoise': RNNoise (Xiph; build WebAssembly do Jitsi, Apache-2.0 / BSD).
// Uma rede neural pequena treinada em fala: tira ventilador, teclado, rua, TV e boa parte das palmas.
// Trabalha em quadros de 480 amostras (10 ms a 48 kHz); o bloco do Web Audio é 128, então há um buffer de entrada
// e uma fila de saída (latência ~13 ms). Enquanto o wasm carrega, o som passa direto.
// opções: wasm (ArrayBuffer), strength 0..1 (quanto o "não é voz" é abaixado além do que a rede já tira).
const F = 480, SCALE = 32768;
class EchoRnnoise extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    const po = (opts && opts.processorOptions) || {};
    this.strength = typeof po.strength === 'number' ? po.strength : 0;
    this.ready = false; this.inBuf = new Float32Array(F); this.inN = 0;
    this.q = new Float32Array(F * 4); this.qR = 0; this.qW = 0; this.qN = 0;
    this.g = 1; this.vad = 0;
    const self = this;
    const imports = { a: {
      a(req) { try { const m = self.mem; const need = (req >>> 0) - m.buffer.byteLength; if (need > 0) m.grow(Math.ceil(need / 65536)); return 1; } catch { return 0; } },
      b(d, s, n) { new Uint8Array(self.mem.buffer).copyWithin(d, s, s + n); },
    } };
    this.port.onmessage = (e) => { if (e.data && typeof e.data.strength === 'number') this.strength = e.data.strength; };
    if (!po.wasm) { this.port.postMessage({ err: 'sem wasm' }); return; }
    WebAssembly.instantiate(po.wasm, imports).then(({ instance }) => {
      const x = instance.exports; this.x = x; this.mem = x.c;
      if (x.d) x.d();
      this.st = x.f(0); this.pIn = x.g(F * 4); this.pOut = x.g(F * 4);
      this.ready = true; this.port.postMessage({ ready: true });
    }).catch((e) => this.port.postMessage({ err: String(e) }));
  }
  frame() {
    const x = this.x, h = new Float32Array(this.mem.buffer), i0 = this.pIn >> 2, o0 = this.pOut >> 2;
    for (let i = 0; i < F; i++) h[i0 + i] = this.inBuf[i] * SCALE;
    const vad = x.j(this.st, this.pOut, this.pIn);
    this.vad = vad;
    // além do que a rede tira: quando quase certeza de que não é voz, abaixa (suave, sem cortar o começo das palavras)
    const target = this.strength > 0 ? (vad > 0.5 ? 1 : vad > 0.2 ? 1 - this.strength * 0.5 : 1 - this.strength * 0.94) : 1;
    const h2 = new Float32Array(this.mem.buffer);
    for (let i = 0; i < F; i++) {
      this.g += (target - this.g) * (target > this.g ? 0.02 : 0.004);
      let v = (h2[o0 + i] / SCALE) * this.g;
      this.q[this.qW] = v; this.qW = (this.qW + 1) % this.q.length;
    }
    this.qN = Math.min(this.q.length, this.qN + F);
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0];
    if (!out || !out.length) return true;
    const o = out[0], n = o.length;
    const src = inp && inp.length ? inp[0] : null;
    if (!this.ready) { if (src) o.set(src); else o.fill(0); for (let c = 1; c < out.length; c++) out[c].set(o); return true; }
    for (let i = 0; i < n; i++) {
      this.inBuf[this.inN++] = src ? src[i] : 0;
      if (this.inN === F) { this.frame(); this.inN = 0; }
    }
    if (this.qN >= n) {
      for (let i = 0; i < n; i++) { o[i] = this.q[this.qR]; this.qR = (this.qR + 1) % this.q.length; }
      this.qN -= n;
    } else o.fill(0);
    for (let c = 1; c < out.length; c++) out[c].set(o);
    return true;
  }
}
registerProcessor('echo-rnnoise', EchoRnnoise);
