// Núcleo da Telinha: contas, amigos, servidores, presença e salas.
// Não depende de Cloudflare nem de Node: roda igual no Durable Object "Hub"
// (worker/src/index.js) e no servidor de testes local (dev/server.js).
//
// O que ele recebe (adaptador):
//   sql:      { all(q, ...params) -> [objetos], run(q, ...params) }
//   env:      { MAX_ACCOUNTS?, SIGNUP_CODE?, TURN_KEY_ID?, TURN_KEY_API_TOKEN? }
//   now:      () => ms
//   sockets:  () => [{ ws, meta }]   (conexões /events abertas)
//   setMeta:  (ws, meta) => void
// "request" só precisa de: .method, .url, .headers.get(), .text()

import { installChat } from './chat.js';
import { installGames } from './games.js';
import { installPush } from './push.js';

const te = new TextEncoder();

/* ───────────── constantes ───────────── */
const SESSION_MS = 30 * 24 * 3600 * 1000;
const MAX_BODY = 1024 * 1024;
const PBKDF2_ITER = 100000;
const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;
const PW_RE = /^[a-f0-9]{64}$/;
const ID_RE = /^[a-z2-7]{12}$/;
const ROOM_C = /^c:([a-z2-7]{12})$/;
const ROOM_D = /^d:([a-z2-7]{12}):([a-z2-7]{12})$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const DECORATIONS = ['hearts', 'flowers', 'cat', 'witch', 'crown', 'sparkles', 'bow'];
const STATUSES = ['online', 'away', 'busy', 'invisible'];
const AVATAR_MAX = 150000;
const HEADER_MAX = 700000;
const MAX_SERVERS_PER_USER = 10;
const MAX_CHANNELS = 8;
const COOKIE = 'telinha_s';
const COOKIE_ALT = 'telinha_a';   // outras contas abertas neste navegador (para trocar sem sair)
const MAX_ALT = 4;
export const ROOM_ANY_RE = /^(c:[a-z2-7]{12}|d:[a-z2-7]{12}:[a-z2-7]{12})$/;

/* ───────────── utilidades ───────────── */
export class Err extends Error {
  constructor(status, code, headers) { super(code); this.status = status; this.code = code; this.headers = headers || null; }
}
const HEXC = '0123456789abcdef';
const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));
const toHex = (u8) => { let s = ''; for (const b of u8) s += HEXC[b >> 4] + HEXC[b & 15]; return s; };
const fromHex = (h) => { const u = new Uint8Array(h.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(h.substr(i * 2, 2), 16); return u; };
const b64url = (u8) => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const ID_ALPHA = 'abcdefghijklmnopqrstuvwxyz234567'; // 32 letras: sem viés ao usar 5 bits
export function newId() { let s = ''; for (const x of rnd(12)) s += ID_ALPHA[x & 31]; return s; }
const INVITE_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sem I, L, O, 0, 1
function newInviteCode() {
  let s = '';
  while (s.length < 10) for (const x of rnd(16)) { if (x < 248 && s.length < 10) s += INVITE_ALPHA[x % 31]; }
  return s;
}
async function sha256hex(str) { return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(str)))); }
async function pbkdf2hex(pw, saltHex) {
  const key = await crypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: PBKDF2_ITER }, key, 256);
  return toHex(new Uint8Array(bits));
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function safeEqualStr(a, b) { return safeEqual(await sha256hex(String(a)), await sha256hex(String(b))); }
const DUMMY_SALT = toHex(new Uint8Array(16));
const pair = (x, y) => (x < y ? [x, y] : [y, x]);
const cps = (s) => [...s].length;

export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}
function getAltTokens(request) {
  const h = request.headers.get('cookie') || '';
  const m = new RegExp('(?:^|;\\s*)' + COOKIE_ALT + '=([A-Za-z0-9_.-]{20,400})').exec(h);
  return m ? m[1].split('.').filter((x) => /^[A-Za-z0-9_-]{20,64}$/.test(x)).slice(0, MAX_ALT + 1) : [];
}
function getCookie(request, name) {
  const h = request.headers.get('cookie') || '';
  const m = new RegExp('(?:^|;\\s*)' + name + '=([A-Za-z0-9_-]{20,64})').exec(h);
  return m ? m[1] : null;
}
function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'local';
}

/* ───────────── validação ───────────── */
const bad = () => new Err(400, 'invalid_input');
function text(v, max, { min = 0, multiline = false } = {}) {
  if (typeof v !== 'string') throw bad();
  let s = multiline ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '') : v.replace(/[\u0000-\u001F\u007F]/g, '');
  s = s.trim();
  if (cps(s) > max || cps(s) < min) throw bad();
  return s;
}
function dataUrl(v, max) {
  if (v === null) return null;
  if (typeof v !== 'string' || v.length > max || !DATA_URL.test(v)) throw bad();
  // confere os primeiros bytes (assinatura do arquivo) contra o tipo declarado
  let head;
  try { head = atob(v.slice(v.indexOf(',') + 1, v.indexOf(',') + 33)); } catch { throw bad(); }
  const b = (i) => head.charCodeAt(i);
  const type = v.slice(11, v.indexOf(';'));
  const ok = type === 'jpeg' ? b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff
    : type === 'png' ? b(0) === 0x89 && head.slice(1, 4) === 'PNG'
      : head.slice(0, 4) === 'RIFF' && head.slice(8, 12) === 'WEBP';
  if (!ok) throw bad();
  return v;
}
const color = (v) => { if (v === null) return null; if (typeof v !== 'string' || !HEX_COLOR.test(v)) throw bad(); return v.toLowerCase(); };
const normUsername = (v) => { if (typeof v !== 'string') throw bad(); const u = v.trim().toLowerCase(); if (!USERNAME_RE.test(u)) throw bad(); return u; };
const normPw = (v) => { if (typeof v !== 'string') throw bad(); const p = v.toLowerCase(); if (!PW_RE.test(p)) throw bad(); return p; };
function serverIcon(v) {
  if (v === null) return null;
  if (typeof v !== 'string') throw bad();
  if (v.startsWith('data:')) return dataUrl(v, AVATAR_MAX);
  const s = v.trim();
  if (!s || s.length > 8 || /[\u0000-\u001F\u007F<>&"']/.test(s)) throw bad();
  return s;
}
function posInt(v, min, max) {
  if (v === null || v === undefined) return null;
  if (!Number.isInteger(v) || v < min || v > max) throw bad();
  return v;
}

/* ───────────── schema ───────────── */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '', avatar TEXT, header TEXT, header_color TEXT, accent TEXT, decoration TEXT,
    status TEXT NOT NULL DEFAULT 'online', status_text TEXT NOT NULL DEFAULT '', pw_salt TEXT NOT NULL, pw_hash TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, uid TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sessions_uid ON sessions(uid)`,
  `CREATE TABLE IF NOT EXISTS friendships (a TEXT NOT NULL, b TEXT NOT NULL, status TEXT NOT NULL, requester TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (a, b))`,
  `CREATE TABLE IF NOT EXISTS servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, color TEXT, owner_id TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS members (server_id TEXT NOT NULL, user_id TEXT NOT NULL, joined_at INTEGER NOT NULL, PRIMARY KEY (server_id, user_id))`,
  `CREATE INDEX IF NOT EXISTS members_user ON members(user_id)`,
  `CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, server_id TEXT NOT NULL, name TEXT NOT NULL, position INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS channels_server ON channels(server_id)`,
  `CREATE TABLE IF NOT EXISTS invites (code TEXT PRIMARY KEY, server_id TEXT NOT NULL, created_by TEXT NOT NULL, max_uses INTEGER, uses INTEGER NOT NULL DEFAULT 0, expires_at INTEGER, created_at INTEGER NOT NULL)`,
];

const foldName = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/* ───────────── passkeys (WebAuthn): CBOR mínimo, COSE, assinaturas ───────────── */
// Migração v2 (separada da original; CREATE IF NOT EXISTS, então bancos antigos ganham as tabelas ao subir).
const SCHEMA_V2 = [
  `CREATE TABLE IF NOT EXISTS passkeys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, public_key TEXT NOT NULL, alg INTEGER NOT NULL,
    sign_count INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL, transports TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, last_used_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS passkeys_user ON passkeys(user_id)`,
  `CREATE TABLE IF NOT EXISTS passkey_challenges (challenge TEXT PRIMARY KEY, kind TEXT NOT NULL, uid TEXT, username TEXT, origin TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS passkey_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
];
const PASSKEY_TTL_MS = 5 * 60 * 1000;
const MAX_PASSKEYS = 5;
const TRANSPORTS = ['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card'];
const td = new TextDecoder();
const B64U_RE = /^[A-Za-z0-9_-]*$/;
function fromB64u(s, max = 65536) {
  if (typeof s !== 'string' || s.length > max || !B64U_RE.test(s) || s.length % 4 === 1) throw bad();
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
async function sha256bytes(u8) { return new Uint8Array(await crypto.subtle.digest('SHA-256', u8)); }
function bytesEq(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
function concatBytes(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
// CBOR (RFC 8949) só com o que o WebAuthn usa: inteiros, bytes, texto, listas, mapas, bool/null. Devolve [valor, próximo].
function cborDecode(u, off = 0, depth = 0) {
  if (depth > 6 || off >= u.length) throw new Error('cbor');
  const ib = u[off++], mt = ib >> 5, ai = ib & 31;
  let n;
  if (ai < 24) n = ai;
  else if (ai === 24) { if (off + 1 > u.length) throw new Error('cbor'); n = u[off]; off += 1; }
  else if (ai === 25) { if (off + 2 > u.length) throw new Error('cbor'); n = (u[off] << 8) | u[off + 1]; off += 2; }
  else if (ai === 26) { if (off + 4 > u.length) throw new Error('cbor'); n = u[off] * 16777216 + ((u[off + 1] << 16) | (u[off + 2] << 8) | u[off + 3]); off += 4; }
  else if (ai === 27) {
    if (off + 8 > u.length) throw new Error('cbor');
    const hi = u[off] * 16777216 + ((u[off + 1] << 16) | (u[off + 2] << 8) | u[off + 3]);
    const lo = u[off + 4] * 16777216 + ((u[off + 5] << 16) | (u[off + 6] << 8) | u[off + 7]);
    n = hi * 4294967296 + lo; off += 8;
    if (!Number.isSafeInteger(n)) throw new Error('cbor');
  } else if (mt === 7 && ai >= 20 && ai <= 22) {
    return [ai === 20 ? false : ai === 21 ? true : null, off];
  } else throw new Error('cbor'); // indefinido, float, etc.: não usados
  if (mt === 0) return [n, off];
  if (mt === 1) return [-1 - n, off];
  if (mt === 2 || mt === 3) {
    if (off + n > u.length) throw new Error('cbor');
    const b = u.slice(off, off + n);
    return [mt === 2 ? b : td.decode(b), off + n];
  }
  if (mt === 4) {
    if (n > 64) throw new Error('cbor');
    const arr = [];
    for (let i = 0; i < n; i++) { const [v, o] = cborDecode(u, off, depth + 1); arr.push(v); off = o; }
    return [arr, off];
  }
  if (mt === 5) {
    if (n > 64) throw new Error('cbor');
    const m = new Map();
    for (let i = 0; i < n; i++) {
      const [k, o1] = cborDecode(u, off, depth + 1);
      const [v, o2] = cborDecode(u, o1, depth + 1);
      m.set(k, v); off = o2;
    }
    return [m, off];
  }
  throw new Error('cbor');
}
// COSE_Key -> { alg, jwk }. Aceita ES256 (-7, P-256) e RS256 (-257, RSA >= 2048 bits).
async function coseToJwk(m) {
  if (!(m instanceof Map)) throw new Error('cose');
  const alg = m.get(3), kty = m.get(1);
  let jwk;
  if (alg === -7 && kty === 2) {
    const x = m.get(-2), y = m.get(-3);
    if (m.get(-1) !== 1 || !(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) throw new Error('cose');
    jwk = { kty: 'EC', crv: 'P-256', x: b64url(x), y: b64url(y) };
    await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']); // confere que o ponto está na curva
  } else if (alg === -257 && kty === 3) {
    let n = m.get(-1), e = m.get(-2);
    if (!(n instanceof Uint8Array) || !(e instanceof Uint8Array)) throw new Error('cose');
    let i = 0; while (i < n.length - 1 && n[i] === 0) i++;
    n = n.slice(i);
    if (n.length < 256 || n.length > 1024 || e.length < 1 || e.length > 4) throw new Error('cose');
    jwk = { kty: 'RSA', n: b64url(n), e: b64url(e) };
    await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  } else throw new Error('cose');
  return { alg, jwk };
}
function derToRaw(der) { // ECDSA DER -> r||s (64 bytes), como o WebCrypto espera
  let o = 0;
  const len = () => { let l = der[o++]; if (l === 0x81) l = der[o++]; else if (l & 0x80) throw new Error('der'); return l; };
  if (der[o++] !== 0x30) throw new Error('der');
  if (len() !== der.length - o) throw new Error('der');
  const out = new Uint8Array(64);
  for (let k = 0; k < 2; k++) {
    if (der[o++] !== 0x02) throw new Error('der');
    let l = len(); let v = der.slice(o, o + l);
    if (v.length !== l || l === 0) throw new Error('der');
    o += l;
    while (v.length > 1 && v[0] === 0) v = v.slice(1);
    if (v.length > 32) throw new Error('der');
    out.set(v, k * 32 + 32 - v.length);
  }
  if (o !== der.length) throw new Error('der');
  return out;
}
async function verifySignature(pubJson, alg, sig, data) {
  try {
    const jwk = JSON.parse(pubJson);
    if (alg === -7) {
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(sig), data);
    }
    if (alg === -257) {
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data);
    }
  } catch {}
  return false;
}

/* ───────────── núcleo ───────────── */
export function createCore({ sql, env = {}, now = () => Date.now(), sockets, setMeta }) {
  for (const q of SCHEMA) sql.run(q);
  for (const q of SCHEMA_V2) sql.run(q);
  // v3: música do perfil (link do Spotify ou do SoundCloud)
  if (!sql.all('PRAGMA table_info(users)').some((c) => c.name === 'music')) sql.run('ALTER TABLE users ADD COLUMN music TEXT');

  const maxAccounts = () => { const n = parseInt(env.MAX_ACCOUNTS, 10); return Number.isFinite(n) && n >= 0 ? n : 2; };
  const one = (q, ...p) => sql.all(q, ...p)[0] || null;
  const getUser = (id) => one('SELECT * FROM users WHERE id=?', id);

  /* ── limites de tentativas (memória; reinicia se o Hub for descarregado) ── */
  const buckets = new Map();
  function hit(key, limit, windowMs) {
    const t = now();
    if (buckets.size > 5000) for (const [k, b] of buckets) if (t - b.start > b.win) buckets.delete(k);
    let b = buckets.get(key);
    if (!b || t - b.start > windowMs) { b = { start: t, n: 0, win: windowMs }; buckets.set(key, b); }
    b.n++;
    if (b.n > limit) throw new Err(429, 'rate_limited', { 'Retry-After': String(Math.max(1, Math.ceil((b.start + windowMs - t) / 1000))) });
  }
  const fails = new Map();
  function lockLeft(key) { const f = fails.get(key); return f && f.until > now() ? Math.ceil((f.until - now()) / 1000) : 0; }
  function addFail(key, threshold) {
    const t = now();
    let f = fails.get(key);
    if (!f || t - f.last > 15 * 60 * 1000) f = { n: 0, until: 0, last: t };
    f.n++; f.last = t;
    if (f.n >= threshold) f.until = t + Math.min(15 * 60 * 1000, 15000 * 2 ** (f.n - threshold));
    fails.set(key, f);
    if (fails.size > 5000) for (const [k, v] of fails) if (t - v.last > 15 * 60 * 1000) fails.delete(k);
  }

  /* ── presença (as conexões /events são a fonte da verdade) ── */
  function presenceMap(exclude) {
    const pm = new Map();
    for (const { ws, meta } of sockets()) {
      if (!meta || !meta.uid || ws === exclude) continue;
      const p = pm.get(meta.uid) || { room: null };
      if (!p.room && meta.room) p.room = meta.room;
      pm.set(meta.uid, p);
    }
    return pm;
  }
  function pub(row, viewer, pm) {
    const self = row.id === viewer;
    const p = pm.get(row.id);
    const hidden = row.status === 'invisible' && !self;
    return {
      id: row.id, username: row.username, name: row.name, bio: row.bio, avatar: row.avatar, header: row.header,
      headerColor: row.header_color, accent: row.accent, decoration: row.decoration,
      status: hidden ? 'online' : row.status, statusText: row.status_text,
      online: !!p && !hidden, inRoom: p && !hidden ? p.room : null,
      since: row.created_at ? Math.floor(row.created_at / 86400000) * 86400000 : null,
    };
  }
  const send = (ws, obj) => { try { ws.send(JSON.stringify(obj)); } catch {} };
  function push(uids, obj) {
    for (const { ws, meta } of sockets()) if (meta && uids.has(meta.uid)) send(ws, obj);
  }
  function friendIds(uid) {
    return new Set(sql.all(`SELECT CASE WHEN a=? THEN b ELSE a END AS o FROM friendships WHERE status='accepted' AND (a=? OR b=?)`, uid, uid, uid).map((r) => r.o));
  }
  function mateIds(uid) {
    return new Set(sql.all(`SELECT DISTINCT m2.user_id AS o FROM members m1 JOIN members m2 ON m1.server_id=m2.server_id WHERE m1.user_id=? AND m2.user_id<>?`, uid, uid).map((r) => r.o));
  }
  function broadcastPresence(uid, exclude) {
    const row = getUser(uid);
    if (!row) return;
    const rel = new Set([...friendIds(uid), ...mateIds(uid)]);
    const pm = presenceMap(exclude);
    const p = pm.get(uid);
    const hidden = row.status === 'invisible';
    const forOthers = { t: 'presence', id: uid, online: !!p && !hidden, status: hidden ? 'online' : row.status, inRoom: p && !hidden ? p.room : null };
    const forSelf = { t: 'presence', id: uid, online: !!p, status: row.status, inRoom: p ? p.room : null };
    for (const { ws, meta } of sockets()) {
      if (ws === exclude || !meta) continue;
      if (meta.uid === uid) send(ws, forSelf); else if (rel.has(meta.uid)) send(ws, forOthers);
    }
  }

  /* ── sessões ── */
  function setCookie(c, token, request) {
    const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
    c.cookie = `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`;
  }
  function setAltCookie(c, tokens) {
    const secure = new URL(c.request.url).protocol === 'https:' ? '; Secure' : '';
    c.altCookie = tokens.length
      ? `${COOKIE_ALT}=${tokens.join('.')}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`
      : `${COOKIE_ALT}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
  }
  /** Sessões ainda válidas entre os tokens dados: [{token, uid}] (sem repetir conta). */
  async function liveSessions(tokens) {
    const out = [], seen = new Set(), t = now();
    for (const token of tokens) {
      if (!token) continue;
      const row = one('SELECT uid, expires_at FROM sessions WHERE hash=?', await sha256hex(token));
      if (!row || row.expires_at < t || seen.has(row.uid)) continue;
      seen.add(row.uid); out.push({ token, uid: row.uid });
    }
    return out;
  }
  /** Entrou numa conta: a sessão que estava aberta (se for de outra conta) vai para a lista de contas guardadas. */
  async function startSession(c, uid) {
    const prev = await liveSessions([getCookie(c.request, COOKIE), ...getAltTokens(c.request)]);
    const keep = prev.filter((s) => s.uid !== uid).slice(0, MAX_ALT);
    for (const s of prev) if (s.uid === uid) sql.run('DELETE FROM sessions WHERE hash=?', await sha256hex(s.token)); // sessão antiga da mesma conta
    setCookie(c, await newSession(uid), c.request);
    setAltCookie(c, keep.map((s) => s.token));
  }
  async function newSession(uid) {
    const t = now();
    sql.run('DELETE FROM sessions WHERE expires_at < ?', t);
    const token = b64url(rnd(32));
    sql.run('INSERT INTO sessions (hash, uid, created_at, expires_at) VALUES (?,?,?,?)', await sha256hex(token), uid, t, t + SESSION_MS);
    return token;
  }
  async function authenticate(request) {
    const token = getCookie(request, COOKIE);
    if (!token) return null;
    const hash = await sha256hex(token);
    const row = one('SELECT s.expires_at AS s_exp, u.* FROM sessions s JOIN users u ON u.id = s.uid WHERE s.hash=?', hash);
    if (!row) return null;
    const t = now();
    if (row.s_exp < t) { sql.run('DELETE FROM sessions WHERE hash=?', hash); return null; }
    let renew = false;
    if (row.s_exp - t < SESSION_MS - 24 * 3600 * 1000) { // desliza a validade no máximo 1x por dia
      sql.run('UPDATE sessions SET expires_at=? WHERE hash=?', t + SESSION_MS, hash);
      renew = true;
    }
    return { user: row, hash, token, renew };
  }

  /* ── permissões de sala ── */
  function canJoinRoom(uid, room) {
    if (typeof room !== 'string') return false;
    let m = ROOM_C.exec(room);
    if (m) {
      return !!one('SELECT 1 AS x FROM channels c JOIN members mm ON mm.server_id=c.server_id WHERE c.id=? AND mm.user_id=?', m[1], uid);
    }
    m = ROOM_D.exec(room);
    if (m) {
      if (!(m[1] < m[2]) || (uid !== m[1] && uid !== m[2])) return false;
      return !!one(`SELECT 1 AS x FROM friendships WHERE a=? AND b=? AND status='accepted'`, m[1], m[2]);
    }
    return false;
  }

  /* ── visões ── */
  function serverView(row, viewer, pm) {
    return {
      id: row.id, name: row.name, icon: row.icon, color: row.color, ownerId: row.owner_id,
      channels: sql.all('SELECT id, name FROM channels WHERE server_id=? ORDER BY position, id', row.id).map((c) => ({ id: c.id, name: c.name })),
      members: sql.all('SELECT u.* FROM members m JOIN users u ON u.id=m.user_id WHERE m.server_id=? ORDER BY m.joined_at, u.id', row.id).map((u) => pub(u, viewer, pm)),
    };
  }
  const serverById = (id) => (ID_RE.test(id) ? one('SELECT * FROM servers WHERE id=?', id) : null);
  function memberServer(id, uid) { // 404 para quem não é membro (não revela que existe)
    const s = serverById(id);
    if (!s || !one('SELECT 1 AS x FROM members WHERE server_id=? AND user_id=?', id, uid)) throw new Err(404, 'not_found');
    return s;
  }
  function ownerServer(id, uid) {
    const s = memberServer(id, uid);
    if (s.owner_id !== uid) throw new Err(403, 'forbidden');
    return s;
  }
  const memberIdsOf = (sid) => new Set(sql.all('SELECT user_id FROM members WHERE server_id=?', sid).map((r) => r.user_id));
  const viewServer = (sid, uid) => serverView(serverById(sid), uid, presenceMap());

  /* ───────────── rotas HTTP ───────────── */
  const routes = [];
  const R = (method, re, fn, auth = true, opts = {}) => routes.push({ method, re, fn, auth, raw: !!opts.raw });

  R('GET', /^\/api\/status$/, async () => {
    const n = one('SELECT COUNT(*) AS n FROM users').n;
    return [200, { accounts: n, max: maxAccounts(), needsCode: !!env.SIGNUP_CODE }];
  }, false);

  R('POST', /^\/api\/signup$/, async (c, _m, b) => {
    const username = normUsername(b.username);
    const pw = normPw(b.pw);
    hit('signup|' + c.ip, 10, 3600 * 1000);
    if (env.SIGNUP_CODE && !(typeof b.code === 'string' && await safeEqualStr(b.code, env.SIGNUP_CODE))) throw new Err(403, 'bad_code');
    const count = () => one('SELECT COUNT(*) AS n FROM users').n;
    if (count() >= maxAccounts()) throw new Err(403, 'signup_closed');
    if (one('SELECT 1 AS x FROM users WHERE username=?', username)) throw new Err(409, 'username_taken');
    const salt = toHex(rnd(16));
    const hash = await pbkdf2hex(pw, salt);
    // confere de novo depois do await (duas pessoas criando ao mesmo tempo)
    if (count() >= maxAccounts()) throw new Err(403, 'signup_closed');
    if (one('SELECT 1 AS x FROM users WHERE username=?', username)) throw new Err(409, 'username_taken');
    const id = newId();
    sql.run('INSERT INTO users (id, username, name, pw_salt, pw_hash, created_at) VALUES (?,?,?,?,?,?)', id, username, username, salt, hash, now());
    await startSession(c, id);
    return [201, { user: pub(getUser(id), id, presenceMap()) }];
  }, false);

  R('POST', /^\/api\/login$/, async (c, _m, b) => {
    const username = normUsername(b.username);
    const pw = normPw(b.pw);
    const k1 = `l|${username}|${c.ip}`, k2 = `l|ip|${c.ip}`;
    const left = Math.max(lockLeft(k1), lockLeft(k2));
    if (left) throw new Err(429, 'rate_limited', { 'Retry-After': String(left) });
    const row = one('SELECT * FROM users WHERE username=?', username);
    const hash = await pbkdf2hex(pw, row ? row.pw_salt : DUMMY_SALT); // mesmo trabalho para usuário que não existe
    if (!row || !safeEqual(hash, row.pw_hash)) {
      addFail(k1, 5); addFail(k2, 40);
      throw new Err(401, 'invalid_credentials');
    }
    fails.delete(k1);
    await startSession(c, row.id);
    return [200, { user: pub(row, row.id, presenceMap()) }];
  }, false);

  R('POST', /^\/api\/logout$/, async (c, _m, b) => {
    sql.run('DELETE FROM sessions WHERE hash=?', c.auth.hash);
    const others = (await liveSessions(getAltTokens(c.request))).filter((o) => o.uid !== c.user.id);
    if (b.all) for (const o of others) sql.run('DELETE FROM sessions WHERE hash=?', await sha256hex(o.token));
    // saiu desta conta: se houver outra aberta neste navegador, ela passa a ser a atual
    const next = !b.all && others.length ? others[0] : null;
    if (next) { setCookie(c, next.token, c.request); setAltCookie(c, others.slice(1).map((o) => o.token)); }
    else { c.cookie = `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`; setAltCookie(c, []); }
    return [200, { ok: true, switched: next ? pub(getUser(next.uid), next.uid, presenceMap()) : null }];
  });

  /* ── várias contas no mesmo navegador ── */
  R('GET', /^\/api\/accounts$/, async (c) => {
    const others = (await liveSessions(getAltTokens(c.request))).filter((o) => o.uid !== c.user.id);
    return [200, { accounts: others.map((o) => { const u = getUser(o.uid); return u && { id: u.id, username: u.username, name: u.name, avatar: u.avatar || null, accent: u.accent || null }; }).filter(Boolean) }];
  });
  R('POST', /^\/api\/accounts\/switch$/, async (c, _m, b) => {
    const others = (await liveSessions(getAltTokens(c.request))).filter((o) => o.uid !== c.user.id);
    const target = others.find((o) => o.uid === b.id);
    if (!target) throw new Err(404, 'not_found');
    setCookie(c, target.token, c.request);
    setAltCookie(c, [c.auth.token, ...others.filter((o) => o !== target).map((o) => o.token)].slice(0, MAX_ALT));
    return [200, { user: pub(getUser(target.uid), target.uid, presenceMap()) }];
  });

  R('GET', /^\/api\/me$/, async (c) => [200, { user: pub(c.user, c.user.id, presenceMap()) }]);

  R('PATCH', /^\/api\/me$/, async (c, _m, b) => {
    const sets = [], vals = [];
    const set = (col, v) => { sets.push(col + '=?'); vals.push(v); };
    let statusChanged = false;
    if ('username' in b) {
      const u = normUsername(b.username);
      const other = one('SELECT id FROM users WHERE username=?', u);
      if (other && other.id !== c.user.id) throw new Err(409, 'username_taken');
      set('username', u);
    }
    if ('name' in b) { const n = text(b.name, 24); set('name', n || c.user.username); }
    if ('bio' in b) set('bio', text(b.bio, 190, { multiline: true }));
    if ('statusText' in b) set('status_text', text(b.statusText, 60));
    if ('status' in b) { if (!STATUSES.includes(b.status)) throw bad(); set('status', b.status); statusChanged = true; }
    if ('avatar' in b) set('avatar', dataUrl(b.avatar, AVATAR_MAX));
    if ('header' in b) set('header', dataUrl(b.header, HEADER_MAX));
    if ('headerColor' in b) set('header_color', color(b.headerColor));
    if ('accent' in b) set('accent', color(b.accent));
    if ('decoration' in b) { if (b.decoration !== null && !DECORATIONS.includes(b.decoration)) throw bad(); set('decoration', b.decoration); }
    if (sets.length) {
      try { sql.run(`UPDATE users SET ${sets.join(', ')} WHERE id=?`, ...vals, c.user.id); }
      catch (e) { if (/UNIQUE/i.test(String(e && e.message))) throw new Err(409, 'username_taken'); throw e; }
      const uid = c.user.id;
      push(new Set([uid]), { t: 'refresh', what: 'me' });
      push(friendIds(uid), { t: 'refresh', what: 'friends' });
      push(mateIds(uid), { t: 'refresh', what: 'servers' });
      if (statusChanged) broadcastPresence(uid);
    }
    return [200, { user: pub(getUser(c.user.id), c.user.id, presenceMap()) }];
  });

  R('POST', /^\/api\/me\/password$/, async (c, _m, b) => {
    const pw = normPw(b.pw), newPw = normPw(b.newPw);
    const k = `pw|${c.user.id}`;
    const left = lockLeft(k);
    if (left) throw new Err(429, 'rate_limited', { 'Retry-After': String(left) });
    if (!safeEqual(await pbkdf2hex(pw, c.user.pw_salt), c.user.pw_hash)) { addFail(k, 5); throw new Err(401, 'invalid_credentials'); }
    fails.delete(k);
    const salt = toHex(rnd(16));
    const hash = await pbkdf2hex(newPw, salt);
    sql.run('UPDATE users SET pw_salt=?, pw_hash=? WHERE id=?', salt, hash, c.user.id);
    sql.run('DELETE FROM sessions WHERE uid=? AND hash<>?', c.user.id, c.auth.hash);
    return [200, { ok: true }];
  });

  R('GET', /^\/api\/users\/([a-z2-7]{12})$/, async (c, m) => {
    const id = m[1];
    const row = getUser(id);
    const me = c.user.id;
    const allowed = row && (id === me || friendIds(me).has(id) || mateIds(me).has(id));
    if (!allowed) throw new Err(404, 'not_found');
    return [200, { user: pub(row, me, presenceMap()) }];
  });

  /* ── amigos ── */
  R('GET', /^\/api\/friends$/, async (c) => {
    const me = c.user.id, pm = presenceMap();
    const rows = sql.all('SELECT * FROM friendships WHERE a=? OR b=? ORDER BY created_at', me, me);
    const out = { friends: [], incoming: [], outgoing: [] };
    for (const f of rows) {
      const otherId = f.a === me ? f.b : f.a;
      const o = getUser(otherId);
      if (!o) continue;
      const u = pub(o, me, pm);
      if (f.status === 'accepted') out.friends.push(u);
      else if (f.requester === me) out.outgoing.push({ to: u, at: f.created_at });
      else out.incoming.push({ from: u, at: f.created_at });
    }
    return [200, out];
  });

  R('POST', /^\/api\/friends$/, async (c, _m, b) => {
    const me = c.user.id;
    const raw = typeof b.username === 'string' ? b.username.trim().replace(/^@/, '') : '';
    hit('freq|' + me, 30, 3600 * 1000);
    let other = USERNAME_RE.test(raw.toLowerCase()) ? one('SELECT * FROM users WHERE username=?', raw.toLowerCase()) : null;
    // não achou pelo @usuário: tenta pelo nome de exibição, só se uma única pessoa tiver esse nome
    // (sem diferenciar maiúsculas nem acentos: "tse" acha "Tsé"; o lower() do SQLite só entende ASCII)
    if (!other && raw.length >= 2 && raw.length <= 24) {
      const want = foldName(raw);
      const hits = [];
      for (const r of sql.all('SELECT id, name FROM users')) { if (foldName(r.name) === want) { hits.push(r.id); if (hits.length > 1) break; } }
      if (hits.length > 1) throw new Err(409, 'ambiguous_name');
      other = hits.length ? one('SELECT * FROM users WHERE id=?', hits[0]) : null;
    }
    if (!other) throw new Err(404, 'not_found');
    if (other.id === me) throw bad();
    const [a, bb] = pair(me, other.id);
    const f = one('SELECT * FROM friendships WHERE a=? AND b=?', a, bb);
    let status, code = 201;
    if (f && f.status === 'accepted') { status = 'friends'; code = 200; }
    else if (f && f.requester === me) { status = 'pending'; code = 200; }
    else if (f) { // ela já tinha pedido: aceita
      sql.run(`UPDATE friendships SET status='accepted' WHERE a=? AND b=?`, a, bb);
      status = 'friends'; code = 200;
    } else {
      sql.run(`INSERT INTO friendships (a, b, status, requester, created_at) VALUES (?,?,'pending',?,?)`, a, bb, me, now());
      status = 'pending';
    }
    if (status === 'friends' || code === 201) {
      push(new Set([me, other.id]), { t: 'refresh', what: 'friends' });
      if (status === 'friends') { broadcastPresence(me); broadcastPresence(other.id); }
    }
    return [code, { status }];
  });

  R('POST', /^\/api\/friends\/([a-z2-7]{12})\/accept$/, async (c, m) => {
    const me = c.user.id, other = m[1];
    const [a, bb] = pair(me, other);
    const f = one('SELECT * FROM friendships WHERE a=? AND b=?', a, bb);
    if (!f || f.status !== 'pending' || f.requester === me) throw new Err(404, 'not_found');
    sql.run(`UPDATE friendships SET status='accepted' WHERE a=? AND b=?`, a, bb);
    push(new Set([me, other]), { t: 'refresh', what: 'friends' });
    broadcastPresence(me); broadcastPresence(other);
    return [200, { status: 'friends' }];
  });

  R('DELETE', /^\/api\/friends\/([a-z2-7]{12})$/, async (c, m) => {
    const me = c.user.id, other = m[1];
    const [a, bb] = pair(me, other);
    if (!one('SELECT 1 AS x FROM friendships WHERE a=? AND b=?', a, bb)) throw new Err(404, 'not_found');
    sql.run('DELETE FROM friendships WHERE a=? AND b=?', a, bb);
    push(new Set([me, other]), { t: 'refresh', what: 'friends' });
    return [200, { ok: true }];
  });

  /* ── servidores ── */
  R('GET', /^\/api\/servers$/, async (c) => {
    const pm = presenceMap();
    const rows = sql.all('SELECT s.* FROM servers s JOIN members m ON m.server_id=s.id WHERE m.user_id=? ORDER BY m.joined_at, s.id', c.user.id);
    return [200, rows.map((s) => serverView(s, c.user.id, pm))];
  });

  R('POST', /^\/api\/servers$/, async (c, _m, b) => {
    const me = c.user.id;
    const name = text(b.name, 32, { min: 1 });
    const icon = 'icon' in b ? serverIcon(b.icon) : null;
    const col = 'color' in b ? color(b.color) : null;
    if (one('SELECT COUNT(*) AS n FROM members WHERE user_id=?', me).n >= MAX_SERVERS_PER_USER) throw new Err(403, 'limit_reached');
    const id = newId(), t = now();
    sql.run('INSERT INTO servers (id, name, icon, color, owner_id, created_at) VALUES (?,?,?,?,?,?)', id, name, icon, col, me, t);
    sql.run('INSERT INTO members (server_id, user_id, joined_at) VALUES (?,?,?)', id, me, t);
    sql.run('INSERT INTO channels (id, server_id, name, position) VALUES (?,?,?,0)', newId(), id, 'Sala 1');
    push(new Set([me]), { t: 'refresh', what: 'servers' });
    return [201, viewServer(id, me)];
  });

  R('PATCH', /^\/api\/servers\/([a-z2-7]{12})$/, async (c, m, b) => {
    ownerServer(m[1], c.user.id);
    const sets = [], vals = [];
    if ('name' in b) { sets.push('name=?'); vals.push(text(b.name, 32, { min: 1 })); }
    if ('icon' in b) { sets.push('icon=?'); vals.push(serverIcon(b.icon)); }
    if ('color' in b) { sets.push('color=?'); vals.push(color(b.color)); }
    if (sets.length) {
      sql.run(`UPDATE servers SET ${sets.join(', ')} WHERE id=?`, ...vals, m[1]);
      push(memberIdsOf(m[1]), { t: 'refresh', what: 'servers' });
    }
    return [200, viewServer(m[1], c.user.id)];
  });

  R('DELETE', /^\/api\/servers\/([a-z2-7]{12})$/, async (c, m) => {
    ownerServer(m[1], c.user.id);
    const members = memberIdsOf(m[1]);
    for (const t of ['invites', 'channels', 'members']) sql.run(`DELETE FROM ${t} WHERE server_id=?`, m[1]);
    sql.run('DELETE FROM servers WHERE id=?', m[1]);
    push(members, { t: 'refresh', what: 'servers' });
    return [200, { ok: true }];
  });

  R('POST', /^\/api\/servers\/([a-z2-7]{12})\/leave$/, async (c, m) => {
    const s = memberServer(m[1], c.user.id);
    if (s.owner_id === c.user.id) throw new Err(400, 'owner_cannot_leave');
    sql.run('DELETE FROM members WHERE server_id=? AND user_id=?', m[1], c.user.id);
    push(new Set([...memberIdsOf(m[1]), c.user.id]), { t: 'refresh', what: 'servers' });
    return [200, { ok: true }];
  });

  R('DELETE', /^\/api\/servers\/([a-z2-7]{12})\/members\/([a-z2-7]{12})$/, async (c, m) => {
    ownerServer(m[1], c.user.id);
    if (m[2] === c.user.id) throw bad();
    if (!one('SELECT 1 AS x FROM members WHERE server_id=? AND user_id=?', m[1], m[2])) throw new Err(404, 'not_found');
    sql.run('DELETE FROM members WHERE server_id=? AND user_id=?', m[1], m[2]);
    push(new Set([...memberIdsOf(m[1]), m[2]]), { t: 'refresh', what: 'servers' });
    return [200, { ok: true }];
  });

  const chanOf = (sid, cid) => {
    const ch = ID_RE.test(cid) ? one('SELECT * FROM channels WHERE id=? AND server_id=?', cid, sid) : null;
    if (!ch) throw new Err(404, 'not_found');
    return ch;
  };
  R('POST', /^\/api\/servers\/([a-z2-7]{12})\/channels$/, async (c, m, b) => {
    ownerServer(m[1], c.user.id);
    const name = text(b.name, 24, { min: 1 });
    const r = one('SELECT COUNT(*) AS n, COALESCE(MAX(position), -1) AS p FROM channels WHERE server_id=?', m[1]);
    if (r.n >= MAX_CHANNELS) throw new Err(403, 'limit_reached');
    sql.run('INSERT INTO channels (id, server_id, name, position) VALUES (?,?,?,?)', newId(), m[1], name, r.p + 1);
    push(memberIdsOf(m[1]), { t: 'refresh', what: 'servers' });
    return [201, viewServer(m[1], c.user.id)];
  });
  R('PATCH', /^\/api\/servers\/([a-z2-7]{12})\/channels\/([a-z2-7]{12})$/, async (c, m, b) => {
    ownerServer(m[1], c.user.id); chanOf(m[1], m[2]);
    sql.run('UPDATE channels SET name=? WHERE id=?', text(b.name, 24, { min: 1 }), m[2]);
    push(memberIdsOf(m[1]), { t: 'refresh', what: 'servers' });
    return [200, viewServer(m[1], c.user.id)];
  });
  R('DELETE', /^\/api\/servers\/([a-z2-7]{12})\/channels\/([a-z2-7]{12})$/, async (c, m) => {
    ownerServer(m[1], c.user.id); chanOf(m[1], m[2]);
    if (one('SELECT COUNT(*) AS n FROM channels WHERE server_id=?', m[1]).n <= 1) throw new Err(400, 'last_channel');
    sql.run('DELETE FROM channels WHERE id=?', m[2]);
    push(memberIdsOf(m[1]), { t: 'refresh', what: 'servers' });
    return [200, viewServer(m[1], c.user.id)];
  });

  /* ── convites ── */
  const inviteView = (i) => ({ code: i.code, maxUses: i.max_uses, uses: i.uses, expiresAt: i.expires_at });
  R('POST', /^\/api\/servers\/([a-z2-7]{12})\/invites$/, async (c, m, b) => {
    memberServer(m[1], c.user.id);
    const maxUses = posInt(b.maxUses, 1, 1000);
    const ttl = posInt(b.ttlHours, 1, 24 * 365);
    hit('inv|' + c.user.id, 60, 3600 * 1000);
    const code = newInviteCode(), t = now();
    sql.run('INSERT INTO invites (code, server_id, created_by, max_uses, uses, expires_at, created_at) VALUES (?,?,?,?,0,?,?)', code, m[1], c.user.id, maxUses, ttl ? t + ttl * 3600 * 1000 : null, t);
    return [201, inviteView(one('SELECT * FROM invites WHERE code=?', code))];
  });
  R('GET', /^\/api\/servers\/([a-z2-7]{12})\/invites$/, async (c, m) => {
    memberServer(m[1], c.user.id);
    sql.run('DELETE FROM invites WHERE expires_at IS NOT NULL AND expires_at < ?', now());
    return [200, sql.all('SELECT * FROM invites WHERE server_id=? ORDER BY created_at DESC', m[1]).map(inviteView)];
  });
  R('DELETE', /^\/api\/servers\/([a-z2-7]{12})\/invites\/([A-Z0-9]{10})$/, async (c, m) => {
    ownerServer(m[1], c.user.id);
    if (!one('SELECT 1 AS x FROM invites WHERE code=? AND server_id=?', m[2], m[1])) throw new Err(404, 'not_found');
    sql.run('DELETE FROM invites WHERE code=?', m[2]);
    return [200, { ok: true }];
  });
  function usableInvite(code) {
    const i = /^[A-Z0-9]{10}$/.test(code) ? one('SELECT * FROM invites WHERE code=?', code) : null;
    if (!i || !serverById(i.server_id)) throw new Err(404, 'bad_code');
    if ((i.expires_at && i.expires_at < now()) || (i.max_uses && i.uses >= i.max_uses)) throw new Err(410, 'bad_code');
    return i;
  }
  R('GET', /^\/api\/invites\/([A-Za-z0-9]{10})$/, async (c, m) => {
    hit('invget|' + c.user.id, 60, 3600 * 1000);
    const i = usableInvite(m[1]);
    const s = serverById(i.server_id);
    return [200, {
      server: { name: s.name, icon: s.icon, color: s.color },
      memberCount: one('SELECT COUNT(*) AS n FROM members WHERE server_id=?', s.id).n,
      alreadyMember: !!one('SELECT 1 AS x FROM members WHERE server_id=? AND user_id=?', s.id, c.user.id),
    }];
  });
  R('POST', /^\/api\/invites\/([A-Za-z0-9]{10})\/join$/, async (c, m) => {
    hit('invjoin|' + c.user.id, 30, 3600 * 1000);
    const i = usableInvite(m[1]);
    const me = c.user.id;
    if (!one('SELECT 1 AS x FROM members WHERE server_id=? AND user_id=?', i.server_id, me)) {
      if (one('SELECT COUNT(*) AS n FROM members WHERE user_id=?', me).n >= MAX_SERVERS_PER_USER) throw new Err(403, 'limit_reached');
      sql.run('INSERT INTO members (server_id, user_id, joined_at) VALUES (?,?,?)', i.server_id, me, now());
      sql.run('UPDATE invites SET uses=uses+1 WHERE code=?', i.code);
      push(memberIdsOf(i.server_id), { t: 'refresh', what: 'servers' });
      broadcastPresence(me);
    }
    return [200, viewServer(i.server_id, me)];
  });

  /* ── passkeys (WebAuthn: Face ID / Touch ID / Windows Hello) ── */
  // rpId = hostname do pedido; origin exato = https://host (ou http://localhost:porta no dev).
  function pkContext(request) {
    const u = new URL(request.url);
    if (!(u.protocol === 'https:' || (u.protocol === 'http:' && u.hostname === 'localhost'))) throw new Err(400, 'passkey_unsupported_origin');
    return { rpId: u.hostname, origin: u.origin };
  }
  function pkSecret() {
    let r = one(`SELECT v FROM passkey_meta WHERE k='fake_secret'`);
    if (!r) { sql.run(`INSERT INTO passkey_meta (k, v) VALUES ('fake_secret', ?)`, toHex(rnd(32))); r = one(`SELECT v FROM passkey_meta WHERE k='fake_secret'`); }
    return r.v;
  }
  function newChallenge(kind, uid, username, origin) {
    const t = now();
    sql.run('DELETE FROM passkey_challenges WHERE expires_at < ?', t);
    if (one('SELECT COUNT(*) AS n FROM passkey_challenges').n >= 2000) {
      sql.run('DELETE FROM passkey_challenges WHERE challenge IN (SELECT challenge FROM passkey_challenges ORDER BY expires_at LIMIT 500)');
    }
    const ch = b64url(rnd(32));
    sql.run('INSERT INTO passkey_challenges (challenge, kind, uid, username, origin, expires_at) VALUES (?,?,?,?,?,?)', ch, kind, uid, username, origin, t + PASSKEY_TTL_MS);
    return ch;
  }
  // Uso único: o desafio é apagado ao ser consultado, dê certo ou não.
  function takeChallenge(ch, kind) {
    if (typeof ch !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(ch)) throw new Err(400, 'invalid_challenge');
    const row = one('SELECT * FROM passkey_challenges WHERE challenge=?', ch);
    if (row) sql.run('DELETE FROM passkey_challenges WHERE challenge=?', ch);
    if (!row || row.kind !== kind || row.expires_at < now()) throw new Err(400, 'invalid_challenge');
    return row;
  }
  // Confere clientDataJSON; devolve o hash dele. Lança Error simples (quem chama decide o código HTTP).
  async function checkClientData(rawB64, type, row, ctx) {
    const raw = fromB64u(rawB64);
    let cd; try { cd = JSON.parse(td.decode(raw)); } catch { throw new Error('client_data'); }
    if (!cd || cd.type !== type || cd.origin !== ctx.origin || row.origin !== ctx.origin || cd.crossOrigin === true) throw new Error('client_data');
    return sha256bytes(raw);
  }
  async function checkAuthData(ad, ctx) {
    if (ad.length < 37 || !bytesEq(ad.slice(0, 32), await sha256bytes(te.encode(ctx.rpId)))) throw new Error('auth_data');
    const flags = ad[32];
    if (!(flags & 0x01) || !(flags & 0x04)) throw new Error('auth_data'); // UP e UV obrigatórios
    return { flags, signCount: new DataView(ad.buffer, ad.byteOffset + 33, 4).getUint32(0) };
  }
  const pkView = (r) => ({ id: r.id, name: r.name, createdAt: r.created_at, lastUsedAt: r.last_used_at, transports: r.transports ? r.transports.split(',') : [] });
  const pkCount = (uid) => one('SELECT COUNT(*) AS n FROM passkeys WHERE user_id=?', uid).n;

  R('POST', /^\/api\/passkey\/register\/begin$/, async (c) => {
    const ctx = pkContext(c.request), u = c.user;
    hit('pkr|' + u.id, 40, 3600 * 1000);
    if (pkCount(u.id) >= MAX_PASSKEYS) throw new Err(403, 'limit_reached');
    const challenge = newChallenge('reg', u.id, null, ctx.origin);
    return [200, {
      challenge, rp: { id: ctx.rpId, name: 'Echo' },
      user: { id: b64url(te.encode(u.id)), name: u.username, displayName: u.name },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      timeout: PASSKEY_TTL_MS, attestation: 'none',
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
      excludeCredentials: sql.all('SELECT id FROM passkeys WHERE user_id=?', u.id).map((r) => ({ type: 'public-key', id: r.id })),
    }];
  });

  R('POST', /^\/api\/passkey\/register\/finish$/, async (c, _m, b) => {
    const ctx = pkContext(c.request), u = c.user;
    hit('pkr|' + u.id, 40, 3600 * 1000);
    const resp = b.response;
    if (!resp || typeof resp !== 'object' || typeof b.id !== 'string') throw bad();
    const name = b.name === undefined || b.name === null || b.name === '' ? 'Passkey' : text(b.name, 40, { min: 1 });
    let transports = [];
    if (resp.transports !== undefined) {
      if (!Array.isArray(resp.transports) || resp.transports.length > 8) throw bad();
      transports = [...new Set(resp.transports.filter((x) => TRANSPORTS.includes(x)))];
    }
    const cdRaw = fromB64u(resp.clientDataJSON), attRaw = fromB64u(resp.attestationObject);
    let ch; try { ch = JSON.parse(td.decode(cdRaw)).challenge; } catch { throw bad(); }
    const row = takeChallenge(ch, 'reg');
    if (row.uid !== u.id) throw new Err(400, 'invalid_challenge');
    let cred;
    try {
      await checkClientData(resp.clientDataJSON, 'webauthn.create', row, ctx);
      const [att] = cborDecode(attRaw);
      if (!(att instanceof Map)) throw new Error('att');
      const ad = att.get('authData');
      if (!(ad instanceof Uint8Array)) throw new Error('att');
      const { flags, signCount } = await checkAuthData(ad, ctx);
      if (!(flags & 0x40) || ad.length < 55) throw new Error('auth_data'); // AT: tem credencial
      const idLen = (ad[53] << 8) | ad[54];
      if (idLen < 16 || idLen > 1023 || 55 + idLen > ad.length) throw new Error('auth_data');
      const credId = ad.slice(55, 55 + idLen);
      const [cose] = cborDecode(ad, 55 + idLen);
      const { alg, jwk } = await coseToJwk(cose);
      if (b64url(credId) !== b.id) throw new Error('id_mismatch');
      cred = { id: b64url(credId), alg, jwk, signCount };
    } catch (e) {
      if (e instanceof Err) throw e;
      throw new Err(400, 'passkey_invalid');
    }
    if (pkCount(u.id) >= MAX_PASSKEYS) throw new Err(403, 'limit_reached');
    if (one('SELECT 1 AS x FROM passkeys WHERE id=?', cred.id)) throw new Err(409, 'passkey_exists');
    sql.run('INSERT INTO passkeys (id, user_id, public_key, alg, sign_count, name, transports, created_at) VALUES (?,?,?,?,?,?,?,?)',
      cred.id, u.id, JSON.stringify(cred.jwk), cred.alg, cred.signCount, name, transports.join(','), now());
    return [201, { passkey: pkView(one('SELECT * FROM passkeys WHERE id=?', cred.id)) }];
  });

  R('POST', /^\/api\/passkey\/login\/begin$/, async (c, _m, b) => {
    const ctx = pkContext(c.request);
    const username = b.username === undefined || b.username === null ? null : normUsername(b.username);
    const k2 = `pk|ip|${c.ip}`, k1 = username ? `pk|${username}|${c.ip}` : null;
    const left = Math.max(lockLeft(k2), k1 ? lockLeft(k1) : 0);
    if (left) throw new Err(429, 'rate_limited', { 'Retry-After': String(left) });
    hit('pkb|' + c.ip, 60, 10 * 60 * 1000);
    let allow = [];
    if (username) {
      const u = one('SELECT id FROM users WHERE username=?', username);
      allow = u ? sql.all('SELECT id FROM passkeys WHERE user_id=? ORDER BY created_at', u.id).map((r) => r.id) : [];
      // anti-enumeração: usuário inexistente (ou sem passkey) recebe um id falso estável, com a mesma forma
      if (!allow.length) {
        const seed = await sha256bytes(te.encode(`${pkSecret()}|${username}`));
        const n = seed[31] < 178 ? 1 : seed[31] < 230 ? 2 : seed[31] < 250 ? 3 : 4; // contagem variável (e estável), como contas reais
        allow = [];
        for (let i = 0; i < n; i++) allow.push(b64url(i === 0 ? seed : await sha256bytes(concatBytes(seed, Uint8Array.of(i)))));
      }
    }
    const challenge = newChallenge('auth', null, username, ctx.origin);
    return [200, {
      challenge, rpId: ctx.rpId, timeout: PASSKEY_TTL_MS, userVerification: 'required',
      allowCredentials: allow.map((id) => ({ type: 'public-key', id })),
    }];
  }, false);

  R('POST', /^\/api\/passkey\/login\/finish$/, async (c, _m, b) => {
    const ctx = pkContext(c.request);
    const resp = b.response;
    if (!resp || typeof resp !== 'object' || typeof b.id !== 'string' || b.id.length > 1400) throw bad();
    const k2 = `pk|ip|${c.ip}`;
    const l2 = lockLeft(k2);
    if (l2) throw new Err(429, 'rate_limited', { 'Retry-After': String(l2) });
    const cdRaw = fromB64u(resp.clientDataJSON), adRaw = fromB64u(resp.authenticatorData), sig = fromB64u(resp.signature);
    let ch; try { ch = JSON.parse(td.decode(cdRaw)).challenge; } catch { throw bad(); }
    const row = takeChallenge(ch, 'auth');
    const k1 = row.username ? `pk|${row.username}|${c.ip}` : null;
    const l1 = k1 ? lockLeft(k1) : 0;
    if (l1) throw new Err(429, 'rate_limited', { 'Retry-After': String(l1) });
    const failLogin = () => { if (k1) addFail(k1, 5); addFail(k2, 40); return new Err(401, 'invalid_credentials'); };
    const cred = /^[A-Za-z0-9_-]+$/.test(b.id) ? one('SELECT * FROM passkeys WHERE id=?', b.id) : null;
    if (!cred) throw failLogin();
    const user = getUser(cred.user_id);
    if (!user || (row.username && user.username !== row.username)) throw failLogin();
    let signCount;
    try {
      const cdHash = await checkClientData(resp.clientDataJSON, 'webauthn.get', row, ctx);
      const ad = await checkAuthData(adRaw, ctx);
      signCount = ad.signCount;
      if (resp.userHandle !== undefined && resp.userHandle !== null && resp.userHandle !== '') {
        if (!bytesEq(fromB64u(resp.userHandle, 1400), te.encode(user.id))) throw new Error('handle');
      }
      if ((signCount !== 0 || cred.sign_count !== 0) && signCount <= cred.sign_count) throw new Error('sign_count'); // possível clone
      if (!(await verifySignature(cred.public_key, cred.alg, sig, concatBytes(adRaw, cdHash)))) throw new Error('sig');
    } catch { throw failLogin(); }
    sql.run('UPDATE passkeys SET sign_count=?, last_used_at=? WHERE id=?', signCount, now(), cred.id);
    fails.delete(k1);
    await startSession(c, user.id);
    return [200, { user: pub(user, user.id, presenceMap()) }];
  }, false);

  R('GET', /^\/api\/passkeys$/, async (c) => [200, { passkeys: sql.all('SELECT * FROM passkeys WHERE user_id=? ORDER BY created_at, id', c.user.id).map(pkView), max: MAX_PASSKEYS }]);
  const ownPasskey = (id, uid) => {
    const r = /^[A-Za-z0-9_-]{1,1400}$/.test(id) ? one('SELECT * FROM passkeys WHERE id=? AND user_id=?', id, uid) : null;
    if (!r) throw new Err(404, 'not_found');
    return r;
  };
  R('PATCH', /^\/api\/passkeys\/([A-Za-z0-9_-]{1,1400})$/, async (c, m, b) => {
    ownPasskey(m[1], c.user.id);
    sql.run('UPDATE passkeys SET name=? WHERE id=?', text(b.name, 40, { min: 1 }), m[1]);
    return [200, { passkey: pkView(one('SELECT * FROM passkeys WHERE id=?', m[1])) }];
  });
  R('DELETE', /^\/api\/passkeys\/([A-Za-z0-9_-]{1,1400})$/, async (c, m) => {
    ownPasskey(m[1], c.user.id);
    sql.run('DELETE FROM passkeys WHERE id=?', m[1]);
    return [200, { ok: true }];
  });

  /* ── ICE (STUN sempre; TURN da Cloudflare se houver segredos) ── */
  R('GET', /^\/api\/ice$/, async (c) => {
    const room = c.url.searchParams.get('room') || '';
    if (!ROOM_ANY_RE.test(room)) throw bad();
    if (!canJoinRoom(c.user.id, room)) throw new Err(403, 'forbidden');
    hit('ice|' + c.user.id, 60, 3600 * 1000);
    const iceServers = [{ urls: ['stun:stun.cloudflare.com:3478'] }];
    if (env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN) {
      try {
        const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ttl: 6 * 3600 }),
        });
        if (r.ok) {
          const data = await r.json();
          let servers = data.iceServers || [];
          if (!Array.isArray(servers)) servers = [servers];
          for (const s of servers) {
            // a porta 53 é bloqueada pelos navegadores e só atrasa a conexão
            const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u));
            if (urls.length) iceServers.push({ ...s, urls });
          }
        }
      } catch {}
    }
    return [200, { iceServers }];
  });

  /* ── chat, arquivos, efeitos sonoros e registro de chamadas ── */
  const pushRef = { notify: null };
  const notifyPush = (uid, data, opts) => (pushRef.notify ? pushRef.notify(uid, data, opts).catch(() => {}) : null);
  // alguém está com o Echo aberto e na frente da tela em algum aparelho?
  const isVisible = (uid) => { for (const { meta } of sockets()) if (meta && meta.uid === uid && meta.vis !== false) return true; return false; };
  const chat = installChat({ R, sql, one, push, friendIds, getUser, now, env, Err, bad, hit, newId, notifyPush });
  pushRef.notify = installPush({ R, sql, one, now, Err, bad, hit, isVisible, getUser, env }).notify;
  const games = installGames({ R, sql, one, push, friendIds, now, Err, hit, newId });

  /* ── despachante HTTP ── */
  function respond(c, status, data, extra) {
    const h = new Headers({
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    });
    if (c && c.cookie) h.append('Set-Cookie', c.cookie);
    if (c && c.altCookie) h.append('Set-Cookie', c.altCookie);
    if (extra) for (const [k, v] of Object.entries(extra)) h.set(k, v);
    return new Response(JSON.stringify(data), { status, headers: h });
  }
  const errResp = (status, code, extra) => respond(null, status, { error: code }, extra);

  async function readJson(request) {
    const len = parseInt(request.headers.get('content-length') || '0', 10);
    if (len > MAX_BODY) throw new Err(413, 'too_large');
    const raw = await request.text();
    if (raw.length > MAX_BODY) throw new Err(413, 'too_large');
    if (!raw.trim()) return {};
    let v;
    try { v = JSON.parse(raw); } catch { throw bad(); }
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad();
    return v;
  }

  async function handle(request) {
    const url = new URL(request.url);
    const c = { request, url, ip: clientIp(request), cookie: null, user: null, auth: null };
    try {
      if (!url.pathname.startsWith('/api/')) throw new Err(404, 'not_found');
      const method = request.method;
      if (method !== 'GET') {
        if (request.headers.get('x-telinha') !== '1' || !sameOrigin(request)) throw new Err(403, 'csrf');
      }
      let route = null, match = null, pathMatched = false;
      for (const r of routes) {
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        pathMatched = true;
        if (r.method === method) { route = r; match = m; break; }
      }
      if (!route) throw new Err(pathMatched ? 405 : 404, pathMatched ? 'method_not_allowed' : 'not_found');
      if (route.auth) {
        const a = await authenticate(request);
        if (!a) throw new Err(401, 'unauthenticated');
        c.auth = a; c.user = a.user;
        if (a.renew) setCookie(c, a.token, request);
      }
      const body = method === 'GET' || route.raw ? {} : await readJson(request);
      const out = await route.fn(c, match, body);
      if (out && out.response) { if (c.cookie) out.response.headers.append('Set-Cookie', c.cookie); if (c.altCookie) out.response.headers.append('Set-Cookie', c.altCookie); return out.response; }
      const [status, data] = out;
      return respond(c, status, data);
    } catch (e) {
      if (e instanceof Err) return respond(c, e.status, { error: e.code }, e.headers);
      console.error('erro interno:', e && e.message); // nunca loga corpo/cookies
      return errResp(500, 'server_error');
    }
  }

  /* ───────────── sockets: autorização + /events ───────────── */
  async function authorizeSocket(request, { checkOrigin = true, room } = {}) {
    if (checkOrigin && !sameOrigin(request)) return { response: errResp(403, 'csrf') };
    const a = await authenticate(request);
    if (!a) return { response: errResp(401, 'unauthenticated') };
    if (room !== undefined && room !== null) {
      if (!ROOM_ANY_RE.test(room)) return { response: errResp(400, 'invalid_input') };
      if (!canJoinRoom(a.user.id, room)) return { response: errResp(403, 'forbidden') };
    }
    return { uid: a.user.id };
  }

  function onEventsOpen(ws, uid) {
    send(ws, { t: 'ready' });
    broadcastPresence(uid);
  }
  function onEventsMessage(ws, meta, raw) {
    // jogadas de jogos podem ser maiores (até 60 KB); o resto continua limitado a 4 KB
    if (!meta || !meta.uid || typeof raw !== 'string' || raw.length > 65536) return;
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    const uid = meta.uid;
    if (m.t === 'g') { const e = games.relay(uid, m, raw.length); if (e) send(ws, { t: 'error', what: 'g', error: e, sid: typeof m.sid === 'string' ? m.sid.slice(0, 24) : null }); return; }
    if (raw.length > 4096) return;
    if (m.t === 'ping') { send(ws, { t: 'pong' }); return; }
    if (m.t === 'room') {
      if (m.room !== null && !canJoinRoom(uid, m.room)) { send(ws, { t: 'error', what: 'room', error: 'forbidden' }); return; }
      setMeta(ws, { ...meta, room: m.room });
      broadcastPresence(uid);
      return;
    }
    if (m.t === 'typing') { chat.typing(uid, m.to); return; }
    if (m.t === 'vis') { setMeta(ws, { ...meta, vis: !!m.v }); return; }
    if (m.t === 'ring') {
      try { hit(`ring|${uid}|${m.to}`, 1, 5000); } catch { send(ws, { t: 'error', what: 'ring', error: 'rate_limited' }); return; }
      const to = typeof m.to === 'string' && ID_RE.test(m.to) ? m.to : null;
      if (!to || !friendIds(uid).has(to) || !canJoinRoom(uid, m.room) || !canJoinRoom(to, m.room)) {
        send(ws, { t: 'error', what: 'ring', error: 'forbidden' }); return;
      }
      push(new Set([to]), { t: 'ring', from: uid, room: m.room });
      const caller = getUser(uid);
      notifyPush(to, { kind: 'ring', from: uid, title: (caller && (caller.name || caller.username)) || 'Echo', body: 'ring', tag: 'ring-' + uid, urgency: 'high', ttl: 45 });
    }
    // recusar (quem recebeu) ou desistir (quem ligou): só repassa para a amiga, sem guardar nada
    if (m.t === 'ring-off') {
      const to = typeof m.to === 'string' && ID_RE.test(m.to) ? m.to : null;
      const why = m.why === 'declined' ? 'declined' : 'cancel';
      if (!to || !friendIds(uid).has(to)) return;
      try { hit(`ringoff|${uid}`, 20, 60000); } catch { return; }
      push(new Set([to]), { t: 'ring-off', from: uid, why });
    }
  }
  function onEventsClose(ws, meta) {
    if (meta && meta.uid) broadcastPresence(meta.uid, ws);
  }

  const recordCall = (room, info) => chat.recordCall(room, info);
  return { handle, authorizeSocket, onEventsOpen, onEventsMessage, onEventsClose, canJoinRoom, recordCall };
}

/* ───────────── sala de sinalização (2 pessoas) ─────────────
 * list = [{ ws, meta }] das conexões já registradas na sala; meta = { uid, polite, replaced? } */
export function createRoomLogic({ setMeta, now = () => Date.now(), onCallEnd = () => {} }) {
  const MAX_MSG = 64 * 1024, MAX_JOINS_PER_MIN = 20, MAX_MSGS_PER_10S = 300;
  const MISSED_MIN_MS = 4000; // sozinha na sala por pelo menos 4 s sem ninguém atender = ligação perdida
  let joins = [];
  const rate = new WeakMap();
  const sendJ = (ws, o) => { try { ws.send(JSON.stringify(o)); } catch {} };
  const liveOf = (list) => list.filter((e) => !(e.meta && e.meta.replaced));
  const patch = (e, o) => { e.meta = { ...e.meta, ...o }; setMeta(e.ws, e.meta); };

  // Registro da chamada: quem desligou e quanto tempo durou (só salas diretas "d:").
  function finish(room, info) { if (room && room.startsWith('d:')) { try { onCallEnd(room, info); } catch {} } }
  /** Alguém saiu (de propósito ou não). bye = apertou "desligar". */
  function left(list, ws, meta, bye) {
    const others = liveOf(list).filter((e) => e.ws !== ws);
    const t = now();
    if (others.length) {
      const o = others[0];
      if (bye) {
        // desligou de propósito: a chamada acaba para as duas
        sendJ(o.ws, { t: 'bye', uid: meta.uid });
        const start = meta.callStart || o.meta.callStart;
        if (start) finish(meta.room, { start, end: t, by: meta.uid });
        patch(o, { callStart: null, pending: null, ended: true });
      } else {
        sendJ(o.ws, { t: 'leave', uid: meta.uid });
        // caiu (internet, aba fechada): espera voltar; se não voltar, registra quando a outra sair
        if (meta.callStart) patch(o, { pending: { at: t, by: meta.uid, start: meta.callStart } });
      }
      return;
    }
    // era a última pessoa na sala
    if (meta.ended) return;
    if (meta.pending) finish(meta.room, { start: meta.pending.start, end: meta.pending.at, by: meta.pending.by });
    else if (meta.callStart) finish(meta.room, { start: meta.callStart, end: t, by: meta.uid });
    else if (meta.aloneSince && !meta.everPaired && t - meta.aloneSince >= MISSED_MIN_MS) finish(meta.room, { missed: true, by: meta.uid, end: t });
  }

  return {
    // Decide se pode entrar. Se a mesma pessoa entrar de novo (ela tocou em entrar), a conexão antiga é substituída.
    // Reconexão AUTOMÁTICA (resume) não substitui ninguém: se já houver uma conexão viva dessa pessoa
    // (ex.: o app voltou do fundo do iPhone, mas a ligação já continuou no site), ela é recusada.
    admit(list, uid, opts = {}) {
      const t = now();
      joins = joins.filter((x) => t - x < 60000);
      if (joins.length >= MAX_JOINS_PER_MIN) return { error: { status: 429, code: 'rate_limited' } };
      joins.push(t);
      const live = liveOf(list);
      const same = live.filter((e) => e.meta.uid === uid);
      const others = live.filter((e) => e.meta.uid !== uid);
      if (opts.resume && same.length) return { error: { status: 409, code: 'taken' } };
      if (others.length >= 2) return { error: { status: 409, code: 'room_full' } };
      const carry = same.length ? { callStart: same[0].meta.callStart || null, aloneSince: same[0].meta.aloneSince || null, everPaired: !!same[0].meta.everPaired } : null;
      for (const e of same) {
        setMeta(e.ws, { ...e.meta, replaced: true });
        try { e.ws.close(4000, 'substituido'); } catch {}
      }
      const polite = others.length === 1 ? others[0].meta.polite === false : false;
      return { polite, others, replaced: same.length > 0, carry };
    },
    /** Dados iniciais da conexão nova (o adaptador grava junto com uid/polite). */
    initialMeta(adm, room) {
      const t = now();
      const c = adm.carry || {};
      if (adm.others.length) {
        const o = adm.others[0];
        const start = o.meta.callStart || (o.meta.pending && o.meta.pending.start) || c.callStart || t;
        patch(o, { callStart: start, pending: null, everPaired: true });
        return { room, callStart: start, everPaired: true, aloneSince: c.aloneSince || null };
      }
      return { room, callStart: c.callStart || null, everPaired: !!c.everPaired, aloneSince: c.aloneSince || t };
    },
    announce(ws, uid, adm) {
      sendJ(ws, { t: 'hello', polite: adm.polite, peers: adm.others.length, you: uid, others: adm.others.map((e) => e.meta.uid) });
      for (const e of adm.others) {
        if (adm.replaced) sendJ(e.ws, { t: 'leave', uid });
        sendJ(e.ws, { t: 'join', uid });
      }
    },
    message(list, ws, message) {
      if (typeof message !== 'string' || message.length > MAX_MSG) { try { ws.close(1009, 'mensagem invalida'); } catch {} return; }
      const t = now();
      let r = rate.get(ws);
      if (!r || t - r.start > 10000) r = { start: t, n: 0 };
      r.n++; rate.set(ws, r);
      if (r.n > MAX_MSGS_PER_10S) { try { ws.close(1008, 'devagar'); } catch {} return; }
      const me = list.find((e) => e.ws === ws);
      if (message === '{"bye":1}') {
        // "desliguei": avisa a outra pessoa, registra e marca esta conexão como encerrada
        if (me && !me.meta.replaced && !me.meta.ended) { left(list, ws, me.meta, true); patch(me, { ended: true }); }
        return;
      }
      for (const e of list) if (e.ws !== ws && !(e.meta && e.meta.replaced)) sendJ(e.ws, { t: 'r', d: message });
    },
    closed(list, ws, meta) {
      if (!meta || meta.replaced || meta.ended) return;
      left(list, ws, meta, false);
    },
  };
}
