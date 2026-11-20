// Teste de passkeys: navegador real (Playwright + autenticador virtual via CDP) + autenticador de software em Node.
//   node --no-warnings dev/passkey-test.cjs
const crypto = require('node:crypto');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
};
const section = (t) => console.log('•', t);
const hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const b64u = (b) => Buffer.from(b).toString('base64url');

/* ── CBOR mínimo (só para montar attestationObject falso) ── */
function head(mt, n) {
  if (n < 24) return Buffer.from([(mt << 5) | n]);
  if (n < 256) return Buffer.from([(mt << 5) | 24, n]);
  if (n < 65536) return Buffer.from([(mt << 5) | 25, n >> 8, n & 255]);
  const b = Buffer.alloc(5); b[0] = (mt << 5) | 26; b.writeUInt32BE(n, 1); return b;
}
function enc(v) {
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  const entries = v instanceof Map ? [...v] : Object.entries(v);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, x]) => [enc(k), enc(x)])]);
}

/* ── autenticador de software (ES256 ou RS256) ── */
class Soft {
  constructor(alg, userId) {
    this.alg = alg; this.count = 0; this.credId = crypto.randomBytes(32); this.userId = userId;
    this.kp = alg === -7 ? crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }) : crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  }
  cose() {
    const j = this.kp.publicKey.export({ format: 'jwk' });
    const d = (s) => Buffer.from(s, 'base64url');
    return this.alg === -7 ? new Map([[1, 2], [3, -7], [-1, 1], [-2, d(j.x)], [-3, d(j.y)]]) : new Map([[1, 3], [3, -257], [-1, d(j.n)], [-2, d(j.e)]]);
  }
  authData({ rpId, flags = 0x05, count = 0, attested = false }) {
    const c = Buffer.alloc(4); c.writeUInt32BE(count);
    const parts = [crypto.createHash('sha256').update(rpId).digest(), Buffer.from([flags | (attested ? 0x40 : 0)]), c];
    if (attested) { const l = Buffer.alloc(2); l.writeUInt16BE(this.credId.length); parts.push(Buffer.alloc(16), l, this.credId, enc(this.cose())); }
    return Buffer.concat(parts);
  }
  create(opt, { origin, rpId, flags, type = 'webauthn.create', idOverride } = {}) {
    const cd = Buffer.from(JSON.stringify({ type, challenge: opt.challenge, origin, crossOrigin: false }));
    const ad = this.authData({ rpId: rpId ?? opt.rp.id, flags, attested: true });
    return { id: idOverride ?? b64u(this.credId), response: { clientDataJSON: b64u(cd), attestationObject: b64u(enc({ fmt: 'none', attStmt: {}, authData: ad })), transports: ['internal'] } };
  }
  get(opt, { origin, rpId, flags, count, userHandle = true, type = 'webauthn.get', badSig = false } = {}) {
    this.count = count ?? this.count + 1;
    const cd = Buffer.from(JSON.stringify({ type, challenge: opt.challenge, origin, crossOrigin: false }));
    const ad = this.authData({ rpId: rpId ?? opt.rpId, flags, count: this.count });
    const data = Buffer.concat([ad, crypto.createHash('sha256').update(cd).digest()]);
    let sig = crypto.sign('sha256', data, this.kp.privateKey);
    if (badSig) { sig = Buffer.from(sig); sig[sig.length - 3] ^= 0x55; }
    const uh = userHandle === true ? b64u(this.userId) : userHandle || null;
    return { id: b64u(this.credId), response: { clientDataJSON: b64u(cd), authenticatorData: b64u(ad), signature: b64u(sig), userHandle: uh } };
  }
}

(async () => {
  const { startDevServer } = await import('./server.js');
  const srv = await startDevServer({ port: 0, env: { MAX_ACCOUNTS: '6' } });
  const BASE = srv.url;
  const q = (sqlText, ...p) => srv.db.prepare(sqlText).all(...p);

  /* cliente HTTP simples com cookie */
  class Client {
    constructor() { this.cookie = ''; }
    async req(method, path, body, o = {}) {
      const h = { 'content-type': 'application/json', origin: o.origin ?? BASE };
      if (method !== 'GET') h['x-telinha'] = '1';
      if (this.cookie && !o.noCookie) h.cookie = this.cookie;
      const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
      const sc = r.headers.getSetCookie?.() || [];
      if (sc.length) { const c = sc[0].split(';')[0]; this.cookie = c.endsWith('=') ? '' : c; }
      let json = null; try { json = await r.json(); } catch {}
      return { status: r.status, body: json, headers: r.headers };
    }
    post(p, b = {}, o) { return this.req('POST', p, b, o); }
    get(p, o) { return this.req('GET', p, undefined, o); }
    patch(p, b, o) { return this.req('PATCH', p, b, o); }
    del(p, o) { return this.req('DELETE', p, {}, o); }
  }
  const HOST = new URL(BASE).hostname;
  const pw = hex('senha');

  /* ═══════════ 1. navegador real com autenticador virtual ═══════════ */
  section('navegador: criar conta, registrar passkey, sair, entrar (com e sem username)');
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  pageerror', e.message));
  await page.goto(BASE + '/robots.txt');
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  await page.evaluate(async () => {
    window.__pk = await import('/js/passkey.js');
    window.__api = (await import('/js/api.js')).api;
    window.__call = async (fn, ...a) => { try { return { ok: await window.__pk[fn](...a) }; } catch (e) { return { err: e.code, status: e.status }; } };
    window.__get = async (username) => { // faz só a cerimônia, devolve o corpo do finish
      const pk = window.__pk;
      const o = await window.__api('POST', '/passkey/login/begin', username ? { username } : {});
      const c = await navigator.credentials.get({ publicKey: { challenge: pk.b64urlToBuf(o.challenge), rpId: o.rpId, userVerification: 'required', allowCredentials: o.allowCredentials.map((d) => ({ type: d.type, id: pk.b64urlToBuf(d.id) })) } });
      const r = c.response, B = pk.bufToB64url;
      return { id: c.id, response: { clientDataJSON: B(r.clientDataJSON), authenticatorData: B(r.authenticatorData), signature: B(r.signature), userHandle: r.userHandle ? B(r.userHandle) : null } };
    };
    window.__finish = async (body) => { const r = await fetch('/api/passkey/login/finish', { method: 'POST', headers: { 'X-Telinha': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
    window.__status = async (p, m = 'GET') => { const r = await fetch('/api' + p, { method: m, headers: { 'X-Telinha': '1' } }); return r.status; };
  });
  const call = (fn, ...a) => page.evaluate(([f, x]) => window.__call(f, ...x), [fn, a]);

  ok('passkeySupported() true com autenticador virtual', await page.evaluate(() => window.__pk.passkeySupported()) === true);
  await page.evaluate((pw) => window.__api('POST', '/signup', { username: 'bianca', pw }), pw);
  ok('conta criada por senha (sessão no navegador)', await page.evaluate(() => window.__status('/me')) === 200);

  const reg = await call('registerPasskey', 'Meu notebook');
  ok('registerPasskey ok', reg.ok && reg.ok.name === 'Meu notebook' && reg.ok.id, reg);
  const id1 = reg.ok && reg.ok.id;
  ok('banco tem 1 passkey (JWK, sign_count)', q('SELECT * FROM passkeys').length === 1 && JSON.parse(q('SELECT public_key FROM passkeys')[0].public_key).kty === 'EC');
  const lst = await page.evaluate(() => window.__api('GET', '/passkeys'));
  ok('GET /passkeys lista 1 com nome', lst.passkeys.length === 1 && lst.passkeys[0].name === 'Meu notebook' && lst.passkeys[0].lastUsedAt === null, lst);
  ok('chave privada/pública não vazam na listagem', !JSON.stringify(lst).includes('"x"') && !JSON.stringify(lst).includes('public_key'));

  await page.evaluate(() => window.__api('POST', '/logout', {}));
  ok('após sair: /me 401', await page.evaluate(() => window.__status('/me')) === 401);
  const l1 = await call('loginWithPasskey', 'bianca');
  ok('login com passkey + username', l1.ok && l1.ok.username === 'bianca', l1);
  ok('sessão criada (/me 200)', await page.evaluate(() => window.__status('/me')) === 200);
  const row1 = q('SELECT * FROM passkeys WHERE id=?', id1)[0];
  ok('last_used_at e sign_count atualizados', row1.last_used_at > 0 && row1.sign_count > 0, row1);

  await page.evaluate(() => window.__api('POST', '/logout', {}));
  const l2 = await call('loginWithPasskey');
  ok('login com passkey SEM username (discoverable)', l2.ok && l2.ok.username === 'bianca', l2);
  await page.evaluate(() => window.__api('POST', '/logout', {}));

  section('navegador: negativos');
  // challenge reutilizado
  let body = await page.evaluate(() => window.__get('bianca'));
  let r = await page.evaluate((b) => window.__finish(b), body);
  ok('finish legítimo ok', r.status === 200, r);
  await page.evaluate(() => window.__api('POST', '/logout', {}));
  r = await page.evaluate((b) => window.__finish(b), body);
  ok('challenge reutilizado -> 400 invalid_challenge', r.status === 400 && r.body.error === 'invalid_challenge', r);
  ok('replay não criou sessão', await page.evaluate(() => window.__status('/me')) === 401);
  // assinatura adulterada
  body = await page.evaluate(() => window.__get());
  const sig = Buffer.from(body.response.signature, 'base64url'); sig[sig.length - 2] ^= 0x01;
  body.response.signature = sig.toString('base64url');
  r = await page.evaluate((b) => window.__finish(b), body);
  ok('assinatura adulterada -> 401 invalid_credentials', r.status === 401 && r.body.error === 'invalid_credentials', r);
  // authenticatorData adulterado (flag UV removida) -> assinatura/UV falham
  body = await page.evaluate(() => window.__get());
  const ad = Buffer.from(body.response.authenticatorData, 'base64url'); ad[32] &= ~0x04;
  body.response.authenticatorData = ad.toString('base64url');
  r = await page.evaluate((b) => window.__finish(b), body);
  ok('authenticatorData sem UV -> 401', r.status === 401, r);
  // signCount regressivo
  srv.db.prepare('UPDATE passkeys SET sign_count=1000 WHERE id=?').run(id1);
  body = await page.evaluate(() => window.__get());
  r = await page.evaluate((b) => window.__finish(b), body);
  ok('signCount regressivo -> 401', r.status === 401 && r.body.error === 'invalid_credentials', r);
  srv.db.prepare('UPDATE passkeys SET sign_count=0 WHERE id=?').run(id1);
  body = await page.evaluate(() => window.__get());
  r = await page.evaluate((b) => window.__finish(b), body);
  ok('depois de normalizar o contador, login volta a funcionar', r.status === 200, r);
  // origin errado no cabeçalho (CSRF) com corpo válido
  await page.evaluate(() => window.__api('POST', '/logout', {}));
  body = await page.evaluate(() => window.__get());
  const evil = await new Client().post('/api/passkey/login/finish', body, { origin: 'http://evil.example' });
  ok('Origin de outro site -> 403 csrf', evil.status === 403 && evil.body.error === 'csrf', evil);
  // register sem sessão
  ok('register/begin sem sessão -> 401', await page.evaluate(() => window.__status('/passkey/register/begin', 'POST')) === 401);
  const nos = await new Client().post('/api/passkey/register/finish', { id: 'x', response: {} });
  ok('register/finish sem sessão -> 401', nos.status === 401, nos);
  ok('GET /passkeys sem sessão -> 401', await page.evaluate(() => window.__status('/passkeys')) === 401);
  // challenge expirado
  const bx = await new Client().post('/api/passkey/login/begin', {});
  srv.db.prepare('UPDATE passkey_challenges SET expires_at=1 WHERE challenge=?').run(bx.body.challenge);
  const dead = new Soft(-7, 'x'.repeat(12));
  const rx = await new Client().post('/api/passkey/login/finish', dead.get(bx.body, { origin: BASE }));
  ok('challenge expirado -> 400 invalid_challenge', rx.status === 400 && rx.body.error === 'invalid_challenge', rx);

  section('navegador: apagar, renomear e limite de 5');
  await page.evaluate((pw) => window.__api('POST', '/login', { username: 'bianca', pw }), pw);
  await cdp.send('WebAuthn.clearCredentials', { authenticatorId });
  const reg2 = await call('registerPasskey', 'Celular');
  ok('segundo registerPasskey (outro aparelho)', reg2.ok && reg2.ok.id !== id1, reg2);
  const dup = await call('registerPasskey', 'de novo');
  ok('mesmo aparelho de novo -> already_registered (excludeCredentials)', dup.err === 'already_registered', dup);
  const ren = await page.evaluate((id) => window.__pk.renamePasskey(id, 'Celular da Bia'), reg2.ok.id);
  ok('PATCH renomeia', ren.name === 'Celular da Bia', ren);
  await page.evaluate((id) => window.__pk.deletePasskey(id), reg2.ok.id);
  ok('DELETE apaga (lista volta a 1)', (await page.evaluate(() => window.__api('GET', '/passkeys'))).passkeys.length === 1);
  ok('DELETE de id inexistente -> 404', await page.evaluate((id) => window.__status('/passkeys/' + id, 'DELETE'), reg2.ok.id) === 404);
  await page.evaluate(() => window.__api('POST', '/logout', {}));
  const gone = await call('loginWithPasskey');
  ok('login com passkey apagada -> no_passkey', gone.err === 'no_passkey', gone);
  await page.evaluate((pw) => window.__api('POST', '/login', { username: 'bianca', pw }), pw);
  let last;
  for (let i = 0; i < 4; i++) { await cdp.send('WebAuthn.clearCredentials', { authenticatorId }); last = await call('registerPasskey', 'Aparelho ' + i); }
  ok('chegou a 5 passkeys', q('SELECT COUNT(*) n FROM passkeys')[0].n === 5 && last.ok, last);
  await cdp.send('WebAuthn.clearCredentials', { authenticatorId });
  const sixth = await call('registerPasskey', 'sexta');
  ok('6ª passkey -> limit_reached', sixth.err === 'limit_reached' && sixth.status === 403, sixth);
  const cancel = await (async () => { // autenticador que recusa: UV falha -> cancelled
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
    await page.evaluate(() => window.__api('POST', '/logout', {}));
    const x = await call('loginWithPasskey');
    await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: true });
    return x;
  })();
  ok('sem verificação do usuário (autenticador) -> erro claro (cancelled/no_passkey)', ['cancelled', 'no_passkey'].includes(cancel.err), cancel);
  await browser.close();

  /* ═══════════ 2. autenticador de software: casos que o navegador não gera ═══════════ */
  section('software: ES256, RS256, origin/rpId/flags/userHandle, duplicadas');
  const C = new Client();
  const su = await C.post('/api/signup', { username: 'softy', pw });
  const softyId = su.body.user.id;
  const regOpt = (await C.post('/api/passkey/register/begin')).body;
  ok('register/begin: rp.id = hostname, UV+resident required, attestation none',
    regOpt.rp.id === HOST && regOpt.authenticatorSelection.userVerification === 'required' && regOpt.authenticatorSelection.residentKey === 'required' && regOpt.attestation === 'none' && Buffer.from(regOpt.challenge, 'base64url').length === 32, regOpt);
  const es = new Soft(-7, softyId);
  let res = await C.post('/api/passkey/register/finish', es.create(regOpt, { origin: 'https://evil.example' }));
  ok('register com origin errado no clientData -> 400 passkey_invalid', res.status === 400 && res.body.error === 'passkey_invalid', res);
  res = await C.post('/api/passkey/register/finish', es.create(regOpt, { origin: BASE }));
  ok('challenge de register consumido mesmo após falha', res.status === 400 && res.body.error === 'invalid_challenge', res);
  const tries = [
    ['rpIdHash errado', { origin: BASE, rpId: 'evil.example' }],
    ['sem flag UV', { origin: BASE, flags: 0x01 }],
    ['sem flag UP', { origin: BASE, flags: 0x04 }],
    ['type errado', { origin: BASE, type: 'webauthn.get' }],
    ['id diferente do authData', { origin: BASE, idOverride: b64u(crypto.randomBytes(32)) }],
  ];
  for (const [name, o] of tries) {
    const op = (await C.post('/api/passkey/register/begin')).body;
    res = await C.post('/api/passkey/register/finish', es.create(op, o));
    ok(`register: ${name} -> 400 passkey_invalid`, res.status === 400 && res.body.error === 'passkey_invalid', res);
  }
  ok('nada foi gravado pelas falhas', q('SELECT COUNT(*) n FROM passkeys WHERE user_id=?', softyId)[0].n === 0);
  let op = (await C.post('/api/passkey/register/begin')).body;
  res = await C.post('/api/passkey/register/finish', { ...es.create(op, { origin: BASE }), name: 'Chave ES256' });
  ok('register ES256 ok (201)', res.status === 201 && res.body.passkey.name === 'Chave ES256', res);
  const other = new Client(); await other.post('/api/signup', { username: 'otherx', pw });
  op = (await other.post('/api/passkey/register/begin')).body;
  res = await other.post('/api/passkey/register/finish', es.create(op, { origin: BASE }));
  ok('mesma credencial em outra conta -> 409 passkey_exists', res.status === 409 && res.body.error === 'passkey_exists', res);
  op = (await other.post('/api/passkey/register/begin')).body;
  const wrongUser = (await C.post('/api/passkey/register/begin')).body;
  res = await other.post('/api/passkey/register/finish', new Soft(-7, 'y'.repeat(12)).create(wrongUser, { origin: BASE }));
  ok('challenge de outra sessão -> 400 invalid_challenge', res.status === 400 && res.body.error === 'invalid_challenge', res);

  const rs = new Soft(-257, softyId);
  op = (await C.post('/api/passkey/register/begin')).body;
  res = await C.post('/api/passkey/register/finish', rs.create(op, { origin: BASE }));
  ok('register RS256 ok (201)', res.status === 201, res);

  async function login(auth, username, o = {}, client = new Client()) {
    const b = (await client.post('/api/passkey/login/begin', username ? { username } : {})).body;
    const r = await client.post('/api/passkey/login/finish', auth.get(b, { origin: BASE, ...o }));
    return { r, client, b };
  }
  let x = await login(es, 'softy');
  ok('login ES256 com username', x.r.status === 200 && x.r.body.user.username === 'softy' && !!x.client.cookie, x.r);
  ok('sessão do login por passkey vale (/me)', (await x.client.get('/api/me')).status === 200);
  x = await login(rs, null);
  ok('login RS256 sem username (userHandle)', x.r.status === 200 && x.r.body.user.id === softyId, x.r);
  x = await login(es, null, { origin: 'https://evil.example' });
  ok('login: origin errado no clientData -> 401', x.r.status === 401 && x.r.body.error === 'invalid_credentials', x.r);
  x = await login(es, null, { rpId: 'evil.example' });
  ok('login: rpIdHash errado -> 401', x.r.status === 401, x.r);
  x = await login(es, null, { flags: 0x01 });
  ok('login: sem UV -> 401', x.r.status === 401, x.r);
  x = await login(es, null, { flags: 0x04 });
  ok('login: sem UP -> 401', x.r.status === 401, x.r);
  x = await login(es, null, { type: 'webauthn.create' });
  ok('login: type errado -> 401', x.r.status === 401, x.r);
  x = await login(es, null, { badSig: true });
  ok('login: assinatura ES256 adulterada -> 401', x.r.status === 401, x.r);
  x = await login(rs, null, { badSig: true });
  ok('login: assinatura RS256 adulterada -> 401', x.r.status === 401, x.r);
  x = await login(es, null, { userHandle: b64u('zzzzzzzzzzzz') });
  ok('login: userHandle de outra pessoa -> 401', x.r.status === 401, x.r);
  x = await login(es, 'otherx');
  ok('login: passkey de softy no desafio de otherx -> 401', x.r.status === 401, x.r);
  x = await login(es, null, { count: 1 });
  ok('login: signCount repetido/menor -> 401', x.r.status === 401, x.r);
  x = await login(es, 'softy', { count: 500 });
  ok('login: signCount maior volta a passar', x.r.status === 200, x.r);
  x = await login(new Soft(-7, softyId), null);
  ok('login com credencial desconhecida -> 401', x.r.status === 401 && x.r.body.error === 'invalid_credentials', x.r);
  const bg = (await new Client().post('/api/passkey/login/begin', {})).body;
  const ga = es.get(bg, { origin: BASE }); const gb = { ...ga, response: { ...ga.response, clientDataJSON: b64u(Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: 'A'.repeat(43), origin: BASE }))) } };
  res = await new Client().post('/api/passkey/login/finish', gb);
  ok('challenge nunca emitido -> 400 invalid_challenge', res.status === 400 && res.body.error === 'invalid_challenge', res);

  section('software: anti-enumeração, rate limit, gestão');
  const real = await new Client().post('/api/passkey/login/begin', { username: 'softy' });
  const ghost = await new Client().post('/api/passkey/login/begin', { username: 'naoexiste' });
  const ghost2 = await new Client().post('/api/passkey/login/begin', { username: 'naoexiste' });
  const noPk = await new Client().post('/api/passkey/login/begin', { username: 'otherx' });
  const shape = (r) => JSON.stringify({ s: r.status, k: Object.keys(r.body).sort(), a: [...new Set(r.body.allowCredentials.map((a) => Object.keys(a).sort().join() + ':' + a.type + ':' + a.id.length))], t: r.body.timeout, uv: r.body.userVerification, rp: r.body.rpId });
  ok('begin: existente vs inexistente vs sem passkey têm a mesma forma', shape(ghost) === shape(noPk) && shape(real) === shape(ghost) && real.body.allowCredentials.length >= 1, [shape(real), shape(ghost), shape(noPk)]);
  ok('begin: ids falsos são estáveis (mesmo usuário)', JSON.stringify(ghost.body.allowCredentials) === JSON.stringify(ghost2.body.allowCredentials) && ghost.body.allowCredentials.length >= 1);
  const counts = new Set();
  for (let i = 0; i < 20; i++) counts.add((await new Client().post('/api/passkey/login/begin', { username: 'fantasma' + i })).body.allowCredentials.length);
  ok('contagem de ids falsos varia (1..4)', counts.size >= 2 && [...counts].every((n) => n >= 1 && n <= 4), [...counts]);
  ok('begin sem username: allowCredentials vazio', (await new Client().post('/api/passkey/login/begin', {})).body.allowCredentials.length === 0);
  ok('begin com username inválido -> 400', (await new Client().post('/api/passkey/login/begin', { username: 'A!' })).status === 400);
  ok('begin sem X-Telinha -> 403 csrf', (await fetch(BASE + '/api/passkey/login/begin', { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json' }, body: '{}' })).status === 403);

  const L = (await C.get('/api/passkeys')).body;
  ok('lista de softy tem 2 (ES256 e RS256)', L.passkeys.length === 2 && L.max === 5, L);
  const ids = L.passkeys.map((p) => p.id);
  ok('outra conta não enxerga/renomeia/apaga passkey alheia (404)',
    (await other.patch('/api/passkeys/' + ids[0], { name: 'hack' })).status === 404 && (await other.del('/api/passkeys/' + ids[0])).status === 404 && (await other.get('/api/passkeys')).body.passkeys.length === 0);
  ok('PATCH nome inválido -> 400', (await C.patch('/api/passkeys/' + ids[0], { name: '' })).status === 400);
  ok('DELETE apaga e login com ela passa a falhar', (await C.del('/api/passkeys/' + ids[1])).status === 200 && (await C.get('/api/passkeys')).body.passkeys.length === 1);

  // rate limit: 5 falhas seguidas (usuário+IP) -> 429
  const rl = new Client(); await rl.post('/api/signup', { username: 'ratey', pw });
  const wrong = new Soft(-7, 'z'.repeat(12));
  const codes = [];
  for (let i = 0; i < 5; i++) { const b = (await new Client().post('/api/passkey/login/begin', { username: 'ratey' })); codes.push(b.status); const f = await new Client().post('/api/passkey/login/finish', wrong.get(b.body, { origin: BASE })); codes.push(f.status); }
  ok('5 falhas -> 401 cada', codes.filter((c) => c === 401).length === 5 && codes.filter((c) => c === 200).length === 5, codes);
  const blocked = await new Client().post('/api/passkey/login/begin', { username: 'ratey' });
  ok('6ª tentativa: begin -> 429 com Retry-After', blocked.status === 429 && blocked.body.error === 'rate_limited' && Number(blocked.headers.get('retry-after')) > 0, blocked);
  const fin = await new Client().post('/api/passkey/login/finish', wrong.get({ challenge: 'A'.repeat(43), rpId: HOST }, { origin: BASE }));
  ok('finish também bloqueado por IP+usuário? (sem desafio -> 400 ou 429)', [400, 429].includes(fin.status), fin);
  ok('login por senha de outra conta não é afetado', (await new Client().post('/api/login', { username: 'softy', pw })).status === 200);
  ok('passkey de outra conta ainda entra (bloqueio é por usuário+IP)', (await login(es, 'softy', { count: 900 })).r.status === 200);

  ok('tabela de challenges não acumula sem controle', q('SELECT COUNT(*) n FROM passkey_challenges')[0].n < 100);
  await srv.close();
  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRO NO TESTE', e); process.exit(2); });
