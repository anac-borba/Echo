// Testa o Touch ID do app para Mac (desktop/src/passkey.js) contra o servidor de verdade, com o Electron simulado.
//   node --no-warnings dev/desk-passkey-test.cjs
const crypto = require('node:crypto'); const os = require('os'); const fs = require('fs'); const path = require('path'); const Module = require('module');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dpk-'));
let touches = 0, cancel = false;
const fake = { app: { getPath: () => dir }, systemPreferences: { canPromptTouchID: () => true, promptTouchID: async () => { touches++; if (cancel) throw new Error('x'); } },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s).reverse(), decryptString: (b) => Buffer.from(b).reverse().toString() } };
const load0 = Module._load; Module._load = function (r, ...a) { return r === 'electron' ? fake : load0.call(this, r, ...a); };
Object.defineProperty(process, 'platform', { value: 'darwin' });
const pk = require('../desktop/src/passkey.js');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  ok  ', n); } else { fail++; console.log('  FAIL', n, x ? JSON.stringify(x).slice(0, 300) : ''); } };
(async () => {
  const { startDevServer } = await import('./server.js');
  const srv = await startDevServer({ port: 0, env: { MAX_ACCOUNTS: '6' } });
  const BASE = srv.url.replace('127.0.0.1', 'localhost');
  let cookie = '';
  const req = async (m, p, b) => { const h = { 'content-type': 'application/json', origin: BASE, 'x-telinha': '1' }; if (cookie) h.cookie = cookie;
    const r = await fetch(BASE + '/api' + p, { method: m, headers: h, body: b === undefined ? undefined : JSON.stringify(b) });
    const sc = r.headers.getSetCookie?.() || []; if (sc.length) { const c = sc[0].split(';')[0]; cookie = c.endsWith('=') ? '' : c; }
    let j = null; try { j = await r.json(); } catch {} return { s: r.status, b: j }; };
  const pw = crypto.createHash('sha256').update('senha').digest('hex');
  let r = await req('POST', '/signup', { username: 'clara', pw }); ok('signup', r.s < 300, r);
  const o = (await req('POST', '/passkey/register/begin', {})).b;
  const c = await pk.create(o, BASE);
  r = await req('POST', '/passkey/register/finish', { id: c.id, name: 'Mac', response: { clientDataJSON: c.clientDataJSON, attestationObject: c.attestationObject, transports: c.transports } });
  ok('registra passkey do Mac', r.s === 201, r); ok('pediu Touch ID ao criar', touches === 1);
  await req('POST', '/logout', {}); cookie = '';
  for (const user of ['clara', null]) {
    const lo = (await req('POST', '/passkey/login/begin', user ? { username: user } : {})).b;
    const g = await pk.get(lo, BASE);
    r = await req('POST', '/passkey/login/finish', { id: g.id, response: { clientDataJSON: g.clientDataJSON, authenticatorData: g.authenticatorData, signature: g.signature, userHandle: g.userHandle } });
    ok('entra com Touch ID ' + (user ? '(com usuário)' : '(sem usuário)'), r.s === 200 && r.b.user && r.b.user.username === 'clara', r);
    cookie = '';
  }
  cancel = true;
  try { await pk.get((await req('POST', '/passkey/login/begin', { username: 'clara' })).b, BASE); ok('cancelar', false); } catch (e) { ok('cancelar dá "cancelled"', e.code === 'cancelled'); }
  cancel = false;
  try { await pk.get((await req('POST', '/passkey/login/begin', { username: 'outra' })).b, BASE); ok('outra conta', false); } catch (e) { ok('conta sem chave dá "no_passkey"', e.code === 'no_passkey'); }
  try { await pk.get({ challenge: 'x', rpId: 'evil.com' }, BASE); ok('rpId', false); } catch (e) { ok('recusa outro site', e.code === 'error'); }
  console.log(`\n${pass} ok, ${fail} falhas`); await srv.close?.(); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
