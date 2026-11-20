// AudioWorklet 'echo-pcm': toca o som dos apps que o Echo para computador captura (PCM 16 bits estéreo), para ele
// entrar na transmissão de tela. Cada app chega com um número; os apps são somados. Folga de ~40 ms; atraso acima
// de ~300 ms é descartado (para o som não ficar para trás do vídeo).
class EchoPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.q = new Map(); // id → { l, r, n, playing }
    this.port.onmessage = (e) => {
      const m = e.data || {};
      if (m.port) { m.port.onmessage = (ev) => this.take(ev.data); m.port.start && m.port.start(); }
    };
  }
  take(d) {
    if (!d || !d.pcm) return;
    const bytes = d.pcm instanceof Uint8Array ? d.pcm : new Uint8Array(d.pcm);
    const s = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
    const frames = s.length >> 1;
    let st = this.q.get(d.id);
    if (!st) { st = { l: new Float32Array(48000), r: new Float32Array(48000), w: 0, rd: 0, n: 0, playing: false, pos: 0 }; this.q.set(d.id, st); }
    const ratio = (d.rate || sampleRate) / sampleRate;   // troca de taxa simples (linear) se o app vier em 44,1 kHz
    const N = st.l.length;
    if (Math.abs(ratio - 1) < 1e-3) {
      for (let i = 0; i < frames; i++) { st.l[st.w] = s[2 * i] / 32768; st.r[st.w] = s[2 * i + 1] / 32768; st.w = (st.w + 1) % N; }
      st.n += frames;
    } else {
      let p = st.pos;
      while (p < frames - 1) {
        const i = Math.floor(p), f = p - i;
        st.l[st.w] = ((1 - f) * s[2 * i] + f * s[2 * i + 2]) / 32768; st.r[st.w] = ((1 - f) * s[2 * i + 1] + f * s[2 * i + 3]) / 32768;
        st.w = (st.w + 1) % N; st.n++; p += ratio;
      }
      st.pos = p - (frames - 1);
    }
    if (st.n > sampleRate * 0.3) { const drop = st.n - Math.round(sampleRate * 0.04); st.rd = (st.rd + drop) % N; st.n -= drop; }
    if (st.n > N) st.n = N;
  }
  process(_inputs, outputs) {
    const o = outputs[0]; if (!o || !o.length) return true;
    const L = o[0], R = o[1] || o[0];
    L.fill(0); if (R !== L) R.fill(0);
    for (const st of this.q.values()) {
      const N = st.l.length;
      if (!st.playing && st.n >= sampleRate * 0.04) st.playing = true;
      if (!st.playing) continue;
      if (st.n < L.length) { st.playing = false; continue; }
      for (let i = 0; i < L.length; i++) { L[i] += st.l[st.rd]; if (R !== L) R[i] += st.r[st.rd]; st.rd = (st.rd + 1) % N; }
      st.n -= L.length;
    }
    return true;
  }
}
registerProcessor('echo-pcm', EchoPcm);
