'use strict';
// Login por passkey (WebAuthn): Face ID, Touch ID, Windows Hello. Sem UI: só funções.
import { api, ApiError } from './api.js';

// code: 'cancelled' | 'not_supported' | 'no_passkey' | 'network' | 'already_registered' | código do servidor
// (rate_limited, limit_reached, invalid_challenge, passkey_invalid, passkey_exists, unauthenticated...)
export class PasskeyError extends Error {
  constructor(code, status = 0, cause) { super(code); this.code = code; this.status = status; this.cause = cause; this.retryAfter = 0; }
}

export function b64urlToBuf(s) {
  const b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
  const u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u.buffer;
}
export function bufToB64url(buf) {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// App para Mac: o Touch ID vem do próprio app (chave no Keychain), porque o Electron não tem o do navegador.
const deskPk = () => (typeof window !== 'undefined' && window.echoDesktop && window.echoDesktop.passkey) || null;
let deskOk = null;
async function useDesk() {
  if (deskOk === null) { try { deskOk = !!(deskPk() && (await deskPk().available())); } catch { deskOk = false; } }
  return deskOk;
}
async function deskCall(kind, o) {
  let r;
  try { r = await deskPk()[kind](o); } catch (e) { throw new PasskeyError('error', 0, e); }
  if (!r || !r.ok) throw new PasskeyError((r && r.code) || 'error');
  return r.r;
}
export const forgetLocal = (id) => { try { if (deskPk()) deskPk().forget(id); } catch { /* ok */ } };

export async function passkeySupported() {
  if (await useDesk()) return true;
  try {
    if (typeof window === 'undefined' || !window.PublicKeyCredential || !navigator.credentials) return false;
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') return false;
    return !!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch { return false; }
}

function fromApi(e) {
  if (e instanceof PasskeyError) return e;
  if (e instanceof ApiError) { const p = new PasskeyError(e.code, e.status, e); p.retryAfter = e.retryAfter || 0; return p; }
  return new PasskeyError('network', 0, e);
}
function fromBrowser(e, fallback) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'AbortError') return new PasskeyError('cancelled', 0, e);
  if (n === 'InvalidStateError') return new PasskeyError(fallback === 'create' ? 'already_registered' : 'no_passkey', 0, e);
  if (n === 'NotSupportedError' || n === 'SecurityError') return new PasskeyError('not_supported', 0, e);
  return new PasskeyError('error', 0, e);
}
function ensureApi() {
  if (typeof window === 'undefined' || !window.PublicKeyCredential || !navigator.credentials) throw new PasskeyError('not_supported');
}
const desc = (list) => (list || []).map((d) => ({ type: d.type, id: b64urlToBuf(d.id), ...(d.transports ? { transports: d.transports } : {}) }));

export async function registerPasskey(deviceName) {
  const desk = await useDesk();
  if (!desk) ensureApi();
  let o;
  try { o = await api('POST', '/passkey/register/begin', {}); } catch (e) { throw fromApi(e); }
  if (desk) {
    const c = await deskCall('create', o);
    const body = { id: c.id, response: { clientDataJSON: c.clientDataJSON, attestationObject: c.attestationObject, transports: c.transports || ['internal'] } };
    if (deviceName) body.name = String(deviceName).slice(0, 40);
    try { return (await api('POST', '/passkey/register/finish', body)).passkey; } catch (e) { forgetLocal(c.id); throw fromApi(e); }
  }
  let cred;
  try {
    cred = await navigator.credentials.create({
      publicKey: {
        challenge: b64urlToBuf(o.challenge), rp: o.rp,
        user: { id: b64urlToBuf(o.user.id), name: o.user.name, displayName: o.user.displayName },
        pubKeyCredParams: o.pubKeyCredParams, timeout: o.timeout, attestation: o.attestation,
        authenticatorSelection: o.authenticatorSelection, excludeCredentials: desc(o.excludeCredentials),
      },
    });
  } catch (e) { throw fromBrowser(e, 'create'); }
  if (!cred) throw new PasskeyError('cancelled');
  const r = cred.response;
  const body = {
    id: cred.id,
    response: {
      clientDataJSON: bufToB64url(r.clientDataJSON), attestationObject: bufToB64url(r.attestationObject),
      transports: typeof r.getTransports === 'function' ? r.getTransports() : [],
    },
  };
  if (deviceName) body.name = String(deviceName).slice(0, 40);
  try { return (await api('POST', '/passkey/register/finish', body)).passkey; } catch (e) { throw fromApi(e); }
}

// username opcional: sem ele, o aparelho mostra as passkeys dessa página (credencial descobrível).
export async function loginWithPasskey(username) {
  const desk = await useDesk();
  if (!desk) ensureApi();
  let o;
  try { o = await api('POST', '/passkey/login/begin', username ? { username: String(username).trim().toLowerCase() } : {}); } catch (e) { throw fromApi(e); }
  if (desk) {
    const g = await deskCall('get', o);
    try {
      return (await api('POST', '/passkey/login/finish', { id: g.id, response: { clientDataJSON: g.clientDataJSON, authenticatorData: g.authenticatorData, signature: g.signature, userHandle: g.userHandle } })).user;
    } catch (e) { const p = fromApi(e); if (p.code === 'invalid_credentials') { p.serverCode = p.code; p.code = 'no_passkey'; } throw p; }
  }
  let cred;
  try {
    cred = await navigator.credentials.get({
      publicKey: { challenge: b64urlToBuf(o.challenge), rpId: o.rpId, timeout: o.timeout, userVerification: o.userVerification, allowCredentials: desc(o.allowCredentials) },
    });
  } catch (e) { throw fromBrowser(e, 'get'); }
  if (!cred) throw new PasskeyError('no_passkey');
  const r = cred.response;
  try {
    return (await api('POST', '/passkey/login/finish', {
      id: cred.id,
      response: {
        clientDataJSON: bufToB64url(r.clientDataJSON), authenticatorData: bufToB64url(r.authenticatorData),
        signature: bufToB64url(r.signature), userHandle: r.userHandle ? bufToB64url(r.userHandle) : null,
      },
    })).user;
  } catch (e) {
    const p = fromApi(e);
    if (p.code === 'invalid_credentials') { p.serverCode = p.code; p.code = 'no_passkey'; } // passkey que o servidor não conhece (apagada?) ou inválida
    throw p;
  }
}

export const listPasskeys = async () => { try { return (await api('GET', '/passkeys')).passkeys; } catch (e) { throw fromApi(e); } };
export const renamePasskey = async (id, name) => { try { return (await api('PATCH', '/passkeys/' + encodeURIComponent(id), { name })).passkey; } catch (e) { throw fromApi(e); } };
export const deletePasskey = async (id) => { try { await api('DELETE', '/passkeys/' + encodeURIComponent(id)); forgetLocal(id); } catch (e) { throw fromApi(e); } };
