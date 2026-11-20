'use strict';
// Touch ID no Echo para Mac.
// O Electron não tem o Touch ID do WebAuthn (precisa da assinatura paga da Apple). Então o próprio app faz o papel
// do "autenticador": cria uma chave P-256 para a conta, guarda cifrada no Keychain (safeStorage) e só assina o login
// depois do Touch ID (systemPreferences.promptTouchID). O que sai daqui é uma passkey WebAuthn comum: o servidor
// confere do mesmo jeito que confere o Face ID do iPhone. A chave nunca sai deste Mac.
const { app, systemPreferences, safeStorage } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const file = () => path.join(app.getPath('userData'), 'echo-keys.json');
const b64u = (b) => Buffer.from(b).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');
const sha = (b) => crypto.createHash('sha256').update(b).digest();

function load() { try { const j = JSON.parse(fs.readFileSync(file(), 'utf8')); return Array.isArray(j.keys) ? j.keys : []; } catch { return []; } }
function save(keys) { fs.writeFileSync(file(), JSON.stringify({ keys }), { mode: 0o600 }); }

function available() {
  try { return process.platform === 'darwin' && systemPreferences.canPromptTouchID() && safeStorage.isEncryptionAvailable(); } catch { return false; }
}

/* CBOR mínimo para o que a passkey precisa */
function head(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
  const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
}
function cbor(v) {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') { const b = Buffer.from(v, 'utf8'); return Buffer.concat([head(3, b.length), b]); }
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (v instanceof Map) { const p = [head(5, v.size)]; for (const [k, x] of v) p.push(cbor(k), cbor(x)); return Buffer.concat(p); }
  throw new Error('cbor');
}

class Fail extends Error { constructor(code) { super(code); this.code = code; } }

async function touch(reason) {
  try { await systemPreferences.promptTouchID(reason); } catch { throw new Fail('cancelled'); }
}
const count = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; };

/** Cria a passkey deste Mac. o = opções do servidor (register/begin); origin = da página. */
async function create(o, origin) {
  if (!available()) throw new Fail('not_supported');
  const rpId = new URL(origin).hostname;
  if (!o || typeof o.challenge !== 'string' || !o.user || (o.rp && o.rp.id && o.rp.id !== rpId)) throw new Fail('error');
  const keys = load();
  const exclude = new Set((o.excludeCredentials || []).map((d) => d.id));
  if (keys.some((k) => k.rpId === rpId && exclude.has(k.id))) throw new Fail('already_registered');
  await touch('ativar o Touch ID para entrar no Echo');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const id = crypto.randomBytes(32);
  const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, unb64u(jwk.x)], [-3, unb64u(jwk.y)]]));
  const authData = Buffer.concat([sha(rpId), Buffer.from([0x45]), count(0), Buffer.alloc(16), Buffer.from([id.length >> 8, id.length & 255]), id, cose]);
  const att = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
  const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: o.challenge, origin, crossOrigin: false }));
  const pem = privateKey.export({ format: 'pem', type: 'pkcs8' });
  keys.push({ id: b64u(id), rpId, user: String(o.user.id || ''), username: String(o.user.name || ''), key: safeStorage.encryptString(pem).toString('base64'), n: 0, at: Date.now() });
  save(keys);
  return { id: b64u(id), clientDataJSON: b64u(clientData), attestationObject: b64u(att), transports: ['internal'] };
}

/** Entra com a passkey deste Mac. o = opções do servidor (login/begin). */
async function get(o, origin) {
  if (!available()) throw new Fail('not_supported');
  const rpId = new URL(origin).hostname;
  if (!o || typeof o.challenge !== 'string' || (o.rpId && o.rpId !== rpId)) throw new Fail('error');
  const keys = load();
  const allow = new Set((o.allowCredentials || []).map((d) => d.id));
  const mine = keys.filter((k) => k.rpId === rpId && (!allow.size || allow.has(k.id))).sort((a, b) => (b.used || b.at) - (a.used || a.at));
  if (!mine.length) throw new Fail('no_passkey');
  const k = mine[0];
  await touch(k.username ? `entrar no Echo como @${k.username}` : 'entrar no Echo');
  k.n = (k.n || 0) + 1; k.used = Date.now();
  const authData = Buffer.concat([sha(rpId), Buffer.from([0x05]), count(k.n)]);
  const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: o.challenge, origin, crossOrigin: false }));
  const pem = safeStorage.decryptString(Buffer.from(k.key, 'base64'));
  const signature = crypto.sign('sha256', Buffer.concat([authData, sha(clientData)]), pem); // DER, como o WebAuthn
  save(keys);
  return { id: k.id, clientDataJSON: b64u(clientData), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: k.user || null };
}

/** Esquece a chave deste Mac (quando a passkey é removida nas Configurações). */
function forget(id) { save(load().filter((k) => k.id !== id)); }

module.exports = { available, create, get, forget };
