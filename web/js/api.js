'use strict';
// Conversa com o servidor: pedidos HTTP e o canal de eventos (presença, convites, toques).

export class ApiError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

export async function api(method, path, body) {
  const headers = { 'X-Telinha': '1' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let r;
  try {
    r = await fetch('/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' });
  } catch { throw new ApiError('network', 0); }
  let j = null;
  try { j = await r.json(); } catch {}
  if (!r.ok) {
    const e = new ApiError((j && j.error) || 'error', r.status);
    e.retryAfter = Number(r.headers.get('Retry-After')) || 0;
    throw e;
  }
  return j;
}

// A senha nunca viaja em texto puro: o navegador faz um hash pesado (PBKDF2) antes de enviar,
// e o servidor ainda faz outro hash com sal próprio. O sal aqui é fixo (não depende do usuário)
// para que trocar o nome de usuário não mude a senha.
export async function prehash(pw) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(String(pw).normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('telinha/v1'), iterations: 600000 }, base, 256));
  return Array.from(bits, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class Events {
  constructor(h) {
    this.h = h; this.fails = 0; this.closed = false; this.open();
    // o servidor só manda notificação para o celular/computador quando o Echo não está na frente da tela
    this.onVis = () => this.send({ t: 'vis', v: document.visibilityState === 'visible' });
    document.addEventListener('visibilitychange', this.onVis);
  }
  open() {
    if (this.closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/events`);
    this.ws = ws;
    ws.onopen = () => { this.fails = 0; clearInterval(this.ping); this.ping = setInterval(() => this.send({ t: 'ping' }), 30000); this.send({ t: 'vis', v: document.visibilityState === 'visible' }); };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (this.h[m.t]) this.h[m.t](m); };
    ws.onclose = (e) => {
      clearInterval(this.ping);
      if (this.closed || ws !== this.ws) return;
      this.h.down && this.h.down(e.code);
      setTimeout(() => this.open(), Math.min(1000 * 2 ** this.fails++, 10000));
    };
    ws.onerror = () => {};
  }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  close() { this.closed = true; clearInterval(this.ping); document.removeEventListener('visibilitychange', this.onVis); try { this.ws.close(); } catch {} }
}
