// Notificações (Web Push) sem serviço de terceiros: o próprio Worker assina (VAPID) e cifra (RFC 8291, aes128gcm)
// usando só WebCrypto. As chaves VAPID são criadas na primeira vez e guardadas no banco.
// A notificação só sai quando a pessoa não está com o Echo aberto e visível em nenhum aparelho.

export const PUSH_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, uid TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS push_subs_uid ON push_subs(uid)`,
  `CREATE TABLE IF NOT EXISTS push_keys (id INTEGER PRIMARY KEY, pub TEXT NOT NULL, priv TEXT NOT NULL)`,
];
const te = new TextEncoder();
export const b64u = (buf) => { const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
export const unb64u = (s) => { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
const cat = (...parts) => { const n = parts.reduce((a, p) => a + p.length, 0); const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
// Serviços de push dos navegadores (Apple, Google, Mozilla, Microsoft). Outros endereços são recusados.
const PUSH_HOST = /^https:\/\/([a-z0-9-]+\.)*(push\.apple\.com|fcm\.googleapis\.com|googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|wns2-[a-z0-9-]+\.notify\.windows\.com)(\/|$)/i;

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** Cifra o conteúdo para uma inscrição (RFC 8291 / RFC 8188, um registro só). */
export async function encrypt(payload, p256dhB64, authB64) {
  const uaPub = unb64u(p256dhB64), auth = unb64u(authB64);
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(auth, secret, cat(te.encode('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plain = cat(te.encode(payload), new Uint8Array([2]));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain));
  const rs = new Uint8Array([0, 0, 16, 0]);   // 4096
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

export function installPush({ R, sql, one, now, Err, bad, hit, isVisible, getUser, env }) {
  for (const q of PUSH_SCHEMA) sql.run(q);
  let vapid = null;
  async function keys() {
    if (vapid) return vapid;
    let row = one('SELECT pub, priv FROM push_keys WHERE id=1');
    if (!row) {
      const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
      const priv = JSON.stringify(await crypto.subtle.exportKey('jwk', kp.privateKey));
      sql.run('INSERT OR IGNORE INTO push_keys (id, pub, priv) VALUES (1, ?, ?)', pub, priv);
      row = one('SELECT pub, priv FROM push_keys WHERE id=1');
    }
    const priv = await crypto.subtle.importKey('jwk', JSON.parse(row.priv), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    vapid = { pub: row.pub, priv };
    return vapid;
  }
  async function jwt(aud) {
    const k = await keys();
    const head = b64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
    const sub = env.PUSH_CONTACT && /^(mailto:|https:)/.test(env.PUSH_CONTACT) ? env.PUSH_CONTACT : 'mailto:echo@example.invalid';
    const body = b64u(te.encode(JSON.stringify({ aud, exp: Math.floor(now() / 1000) + 12 * 3600, sub })));
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k.priv, te.encode(head + '.' + body));
    return `${head}.${body}.${b64u(sig)}`;
  }

  R('GET', /^\/api\/push\/key$/, async () => [200, { key: (await keys()).pub }]);
  R('POST', /^\/api\/push\/sub$/, async (c, _m, b) => {
    const ep = typeof b.endpoint === 'string' && b.endpoint.length < 1000 && PUSH_HOST.test(b.endpoint) ? b.endpoint : null;
    const k = b.keys || {};
    const p256 = typeof k.p256dh === 'string' && /^[A-Za-z0-9_-]{80,100}$/.test(k.p256dh) ? k.p256dh : null;
    const auth = typeof k.auth === 'string' && /^[A-Za-z0-9_-]{16,32}$/.test(k.auth) ? k.auth : null;
    if (!ep || !p256 || !auth) throw bad();
    hit('pushsub|' + c.user.id, 20, 3600 * 1000);
    sql.run('INSERT INTO push_subs (endpoint, uid, p256dh, auth, created_at) VALUES (?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET uid=excluded.uid, p256dh=excluded.p256dh, auth=excluded.auth',
      ep, c.user.id, p256, auth, now());
    // no máximo 8 aparelhos por pessoa (os mais antigos saem)
    const extra = sql.all('SELECT endpoint FROM push_subs WHERE uid=? ORDER BY created_at DESC LIMIT -1 OFFSET 8', c.user.id);
    for (const x of extra) sql.run('DELETE FROM push_subs WHERE endpoint=?', x.endpoint);
    return [200, { ok: true }];
  });
  R('POST', /^\/api\/push\/unsub$/, async (c, _m, b) => {
    if (typeof b.endpoint === 'string') sql.run('DELETE FROM push_subs WHERE endpoint=? AND uid=?', b.endpoint, c.user.id);
    return [200, { ok: true }];
  });

  /** Manda para todos os aparelhos inscritos de uid (se a pessoa não estiver com o app aberto). */
  async function notify(uid, data, { force = false } = {}) {
    if (!force && isVisible(uid)) return;
    const subs = sql.all('SELECT * FROM push_subs WHERE uid=?', uid);
    if (!subs.length) return;
    const body = JSON.stringify(data).slice(0, 3000);
    await Promise.all(subs.map(async (s) => {
      try {
        const aud = new URL(s.endpoint).origin;
        const enc = await encrypt(body, s.p256dh, s.auth);
        const r = await fetch(s.endpoint, { method: 'POST', body: enc, headers: {
          'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(data.ttl || 3600), Urgency: data.urgency || 'normal',
          ...(data.topic ? { Topic: data.topic } : {}),
          Authorization: `vapid t=${await jwt(aud)}, k=${(await keys()).pub}` } });
        if (r.status === 404 || r.status === 410) sql.run('DELETE FROM push_subs WHERE endpoint=?', s.endpoint);
      } catch (e) { /* aparelho fora do ar: tenta de novo na próxima */ }
    }));
  }
  void getUser;
  return { notify };
}
