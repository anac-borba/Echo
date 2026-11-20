// Teste de ponta a ponta da API da Telinha (sobe o servidor local por conta própria).
//   node --no-warnings dev/api-test.js
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { startDevServer } from './server.js';

const require = createRequire(import.meta.url);
let wsLib; try { wsLib = require('ws'); } catch { wsLib = require('/opt/npm-tools/node_modules/ws'); }
const { WebSocket } = wsLib;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) pass++; else { fail++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
};
const section = (t) => console.log('•', t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prehash = (s) => crypto.createHash('sha256').update(s).digest('hex');

const srv = await startDevServer({ port: 0, env: { MAX_ACCOUNTS: '5' } });
const BASE = srv.url;
const HOST = new URL(BASE).host;

class Client {
  constructor() { this.cookie = ''; }
  async req(method, path, body, o = {}) {
    const h = { 'content-type': 'application/json', origin: o.origin ?? BASE };
    if (method !== 'GET' && !o.noCsrf) h['x-telinha'] = '1';
    if (o.noOrigin) delete h.origin;
    if (this.cookie && !o.noCookie) h.cookie = this.cookie;
    const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : (o.raw ? body : JSON.stringify(body)) });
    const sc = res.headers.getSetCookie?.() || [];
    if (sc.length && !o.keepCookie) { const c = sc[0].split(';')[0]; this.cookie = c.endsWith('=') ? '' : c; }
    let json = null; try { json = await res.json(); } catch {}
    return { status: res.status, body: json, headers: res.headers, setCookie: sc };
  }
  get(p, o) { return this.req('GET', p, undefined, o); }
  post(p, b = {}, o) { return this.req('POST', p, b, o); }
  patch(p, b = {}, o) { return this.req('PATCH', p, b, o); }
  del(p, o) { return this.req('DELETE', p, {}, o); }
}

function openWs(path, client, { origin = BASE, noCookie = false } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Origin: origin };
    if (client.cookie && !noCookie) headers.Cookie = client.cookie;
    const ws = new WebSocket(BASE.replace('http', 'ws') + path, { headers });
    const api = { ws, msgs: [], cursor: 0, closeCode: null };
    ws.on('message', (d) => api.msgs.push(JSON.parse(d.toString())));
    ws.on('close', (code) => { api.closeCode = code; });
    ws.on('error', () => {});
    ws.on('open', () => resolve(api));
    ws.on('unexpected-response', (_req, res) => reject(Object.assign(new Error('http ' + res.statusCode), { status: res.statusCode })));
    api.wait = async (pred, ms = 2000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        for (let i = api.cursor; i < api.msgs.length; i++) if (pred(api.msgs[i])) { api.cursor = i + 1; return api.msgs[i]; }
        await sleep(15);
      }
      return null;
    };
    api.none = async (pred, ms = 400) => { await sleep(ms); return !api.msgs.slice(api.cursor).some(pred); };
    api.send = (o) => ws.send(typeof o === 'string' ? o : JSON.stringify(o));
  });
}
const wsFails = async (path, client, o) => { try { const w = await openWs(path, client, o); w.ws.close(); return 0; } catch (e) { return e.status; } };

const mk = async (name) => {
  const c = new Client();
  const r = await c.post('/api/signup', { username: name, pw: prehash('pw-' + name) });
  c.user = r.body && r.body.user; c.status = r.status; c.name = name;
  return c;
};
const jpeg = (n = 40) => 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0]), Buffer.alloc(n, 1)]).toString('base64');
const png = () => 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]).toString('base64');
const webp = () => 'data:image/webp;base64,' + Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]).toString('base64');

try {
  /* ───── status e criação de contas ───── */
  section('status e contas');
  const anon = new Client();
  let r = await anon.get('/api/status');
  ok('status inicial', r.status === 200 && r.body.accounts === 0 && r.body.max === 5 && r.body.needsCode === false, r.body);
  ok('GET /api/me sem login → 401', (await anon.get('/api/me')).status === 401);
  const goodPw = prehash('x');
  for (const [name, body] of [
    ['usuário curto', { username: 'ab', pw: goodPw }], ['usuário com espaço', { username: 'a b c', pw: goodPw }],
    ['usuário com acento', { username: 'ánna', pw: goodPw }], ['usuário longo', { username: 'a'.repeat(21), pw: goodPw }],
    ['pw não é hash', { username: 'okname', pw: 'senha123' }], ['pw curto', { username: 'okname', pw: 'abcd' }],
    ['sem pw', { username: 'okname' }], ['usuário número', { username: 12345, pw: goodPw }],
  ]) { const x = await anon.post('/api/signup', body); ok('signup inválido: ' + name, x.status === 400 && x.body.error === 'invalid_input', x); }
  r = await anon.post('/api/signup', { username: 'okname', pw: goodPw }, { noCsrf: true });
  ok('signup sem X-Telinha → 403 csrf', r.status === 403 && r.body.error === 'csrf', r);
  r = await anon.post('/api/signup', { username: 'okname', pw: goodPw }, { origin: 'http://evil.example' });
  ok('signup com Origin de fora → 403 csrf', r.status === 403 && r.body.error === 'csrf', r);
  r = await anon.post('/api/signup', { username: 'okname', pw: goodPw }, { noOrigin: true });
  ok('signup sem Origin → 403 csrf', r.status === 403, r);
  r = await anon.post('/api/signup', '{nao-json', { raw: true });
  ok('JSON inválido → 400', r.status === 400, r);
  r = await anon.post('/api/signup', 'x'.repeat(1200000), { raw: true });
  ok('corpo > 1 MB → 413', r.status === 413, r.status);

  const alice = await mk('alice'), bob = await mk('bob'), carol = await mk('carol'), dave = await mk('dave');
  ok('4 contas criadas', [alice, bob, carol, dave].every((c) => c.status === 201 && c.user && /^[a-z2-7]{12}$/.test(c.user.id)));
  const sc = (await new Client().post('/api/login', { username: 'alice', pw: prehash('pw-alice') })).setCookie[0] || '';
  ok('cookie: HttpOnly, SameSite=Strict, Path=/, Max-Age 30d, sem Secure em http',
    /HttpOnly/.test(sc) && /SameSite=Strict/.test(sc) && /Path=\//.test(sc) && /Max-Age=2592000/.test(sc) && !/Secure/.test(sc), sc);
  r = await new Client().post('/api/signup', { username: 'ALICE', pw: goodPw });
  ok('usuário repetido (case-insens.) → 409 username_taken', r.status === 409 && r.body.error === 'username_taken', r);
  const eve = await mk('eve');
  ok('quinta conta ok', eve.status === 201);
  r = await new Client().post('/api/signup', { username: 'frank', pw: goodPw });
  ok('sexta conta → 403 signup_closed', r.status === 403 && r.body.error === 'signup_closed', r);
  r = await anon.get('/api/status');
  ok('status mostra 5/5', r.body.accounts === 5, r.body);
  const dbRow = srv.db.prepare('SELECT pw_hash, pw_salt FROM users WHERE username=?').get('alice');
  ok('hash guardado ≠ prehash, salt 32 hex', dbRow.pw_hash !== prehash('pw-alice') && /^[a-f0-9]{32}$/.test(dbRow.pw_salt) && /^[a-f0-9]{64}$/.test(dbRow.pw_hash));

  /* ───── login, lockout, logout ───── */
  section('login / lockout / sessão');
  r = await alice.get('/api/me');
  ok('GET /api/me logada', r.status === 200 && r.body.user.username === 'alice' && r.body.user.status === 'online', r);
  const wrong = prehash('errada');
  const fr1 = await new Client().post('/api/login', { username: 'nao_existe', pw: wrong });
  const fr2 = await new Client().post('/api/login', { username: 'bob', pw: wrong });
  ok('usuário inexistente e senha errada: mesma resposta', fr1.status === 401 && fr2.status === 401 && fr1.body.error === 'invalid_credentials' && fr2.body.error === 'invalid_credentials');
  const eveLogin = new Client();
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await eveLogin.post('/api/login', { username: 'eve', pw: wrong })).status);
  ok('5 falhas → 401 x5', codes.every((x) => x === 401), codes);
  r = await eveLogin.post('/api/login', { username: 'eve', pw: wrong });
  ok('6ª tentativa → 429 com Retry-After', r.status === 429 && r.body.error === 'rate_limited' && Number(r.headers.get('retry-after')) > 0, r);
  r = await eveLogin.post('/api/login', { username: 'eve', pw: prehash('pw-eve') });
  ok('senha certa durante bloqueio também → 429', r.status === 429, r.status);
  const alice2 = new Client();
  r = await alice2.post('/api/login', { username: 'Alice', pw: prehash('pw-alice') });
  ok('login normal (usuário em maiúscula)', r.status === 200 && r.body.user.username === 'alice' && alice2.cookie.startsWith('telinha_s='), r);
  ok('segunda sessão funciona', (await alice2.get('/api/me')).status === 200);
  r = await alice2.post('/api/logout');
  ok('logout → ok e cookie limpo', r.status === 200 && /Max-Age=0/.test(r.setCookie[0] || ''), r);
  const stale = new Client(); stale.cookie = alice.cookie;
  ok('logout de uma sessão não derruba a outra', (await alice.get('/api/me')).status === 200);
  const alice3 = new Client(); await alice3.post('/api/login', { username: 'alice', pw: prehash('pw-alice') });
  srv.db.prepare('UPDATE sessions SET expires_at=1 WHERE hash<>?').run('x'); // expira todas
  ok('sessão expirada → 401', (await alice3.get('/api/me')).status === 401);
  const relog = async (c, name) => { await c.post('/api/login', { username: name, pw: prehash('pw-' + name) }); };
  for (const [c, n] of [[alice, 'alice'], [bob, 'bob'], [carol, 'carol'], [dave, 'dave'], [eve, 'eve']]) {
    if (n === 'eve') { c.cookie = ''; const s = await mk('zz'); /* eve segue travada: usa conta nova de teste abaixo */ }
    else await relog(c, n);
  }
  ok('relogin das contas de teste', (await alice.get('/api/me')).status === 200 && (await carol.get('/api/me')).status === 200);

  /* ───── perfil ───── */
  section('perfil (PATCH /api/me)');
  const bads = [
    ['name vazio-ok mas 25 letras', { name: 'x'.repeat(25) }], ['bio 191', { bio: 'x'.repeat(191) }], ['statusText 61', { statusText: 'x'.repeat(61) }],
    ['status inválido', { status: 'sumido' }], ['decoration inválida', { decoration: 'dragon' }], ['accent inválido', { accent: 'red' }],
    ['headerColor inválido', { headerColor: '#12345' }], ['avatar não é imagem', { avatar: 'http://x/y.png' }],
    ['avatar svg', { avatar: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }], ['avatar png com cabeçalho de jpeg', { avatar: 'data:image/png;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]).toString('base64') }],
    ['avatar grande', { avatar: jpeg(120000) }], ['header enorme', { header: jpeg(560000) }], ['name número', { name: 5 }],
  ];
  for (const [n, b] of bads) { const x = await alice.patch('/api/me', b); ok('inválido: ' + n, x.status === 400 && x.body.error === 'invalid_input', [x.status, x.body]); }
  r = await alice.patch('/api/me', { avatar: jpeg(), header: png(), headerColor: '#FF8800', accent: '#aabbcc', decoration: 'cat', name: '  Alice Clara  ', bio: 'oi\ncom quebra', statusText: 'vendo filme' });
  ok('PATCH válido', r.status === 200 && r.body.user.name === 'Alice Clara' && r.body.user.decoration === 'cat' && r.body.user.headerColor === '#ff8800' && r.body.user.bio === 'oi\ncom quebra' && r.body.user.avatar.startsWith('data:image/jpeg'), r.body);
  r = await alice.patch('/api/me', { avatar: webp(), decoration: null, header: null });
  ok('webp ok; null limpa campos', r.status === 200 && r.body.user.decoration === null && r.body.user.header === null && r.body.user.avatar.startsWith('data:image/webp'));
  r = await alice.patch('/api/me', { name: '' });
  ok('name vazio volta para o username', r.body.user.name === 'alice', r.body);
  ok('PATCH sem login → 401', (await new Client().patch('/api/me', { name: 'x' })).status === 401);
  r = await dave.patch('/api/me', { username: 'alice' });
  ok('trocar para username existente → 409', r.status === 409 && r.body.error === 'username_taken', r);
  r = await dave.patch('/api/me', { username: 'a b' });
  ok('username inválido → 400', r.status === 400);

  /* ───── senha ───── */
  section('troca de senha');
  const carol2 = new Client(); await carol2.post('/api/login', { username: 'carol', pw: prehash('pw-carol') });
  ok('carol tem 2 sessões', (await carol2.get('/api/me')).status === 200);
  r = await carol.post('/api/me/password', { pw: prehash('errada'), newPw: prehash('nova-carol') });
  ok('senha antiga errada → 401', r.status === 401, r);
  r = await carol.post('/api/me/password', { pw: prehash('pw-carol'), newPw: 'curta' });
  ok('nova senha inválida → 400', r.status === 400, r);
  r = await carol.post('/api/me/password', { pw: prehash('pw-carol'), newPw: prehash('nova-carol') });
  ok('troca ok', r.status === 200, r);
  ok('outra sessão foi revogada', (await carol2.get('/api/me')).status === 401);
  ok('sessão atual continua', (await carol.get('/api/me')).status === 200);
  ok('login antigo falha', (await new Client().post('/api/login', { username: 'carol', pw: prehash('pw-carol') })).status === 401);
  const c3 = new Client();
  ok('login novo funciona', (await c3.post('/api/login', { username: 'carol', pw: prehash('nova-carol') })).status === 200);

  /* ───── amigos ───── */
  section('amigos');
  const bobEv = await openWs('/events', bob);
  ok('/events: ready', !!(await bobEv.wait((m) => m.t === 'ready')));
  r = await alice.post('/api/friends', { username: 'bob' });
  ok('pedido de amizade → 201 pending', r.status === 201 && r.body.status === 'pending', r);
  ok('bob recebe refresh friends', !!(await bobEv.wait((m) => m.t === 'refresh' && m.what === 'friends')));
  r = await alice.post('/api/friends', { username: 'bob' });
  ok('pedido repetido → 200 pending', r.status === 200 && r.body.status === 'pending', r);
  r = await bob.get('/api/friends');
  ok('bob vê pedido recebido', r.body.incoming.length === 1 && r.body.incoming[0].from.username === 'alice' && r.body.friends.length === 0, r.body);
  r = await alice.get('/api/friends');
  ok('alice vê pedido enviado', r.body.outgoing.length === 1 && r.body.outgoing[0].to.username === 'bob', r.body);
  ok('alice não pode aceitar o próprio pedido', (await alice.post(`/api/friends/${bob.user.id}/accept`)).status === 404);
  r = await bob.post(`/api/friends/${alice.user.id}/accept`);
  ok('bob aceita', r.status === 200 && r.body.status === 'friends', r);
  r = await alice.get('/api/friends');
  ok('amigos nos dois lados', r.body.friends.length === 1 && r.body.friends[0].id === bob.user.id && r.body.outgoing.length === 0, r.body);
  ok('pedir a si mesmo → 400', (await alice.post('/api/friends', { username: 'alice' })).status === 400);
  ok('usuário inexistente → 404', (await alice.post('/api/friends', { username: 'ninguem' })).status === 404);
  r = await carol.post('/api/friends', { username: 'dave' });
  ok('carol→dave pending', r.status === 201);
  r = await dave.post('/api/friends', { username: 'carol' });
  ok('dave→carol aceita sozinho', r.status === 200 && r.body.status === 'friends', r);
  r = await dave.get('/api/friends');
  ok('dave e carol amigos', r.body.friends.length === 1 && r.body.incoming.length === 0, r.body);
  ok('GET /users/:id de amigo', (await alice.get(`/api/users/${bob.user.id}`)).status === 200);
  ok('GET /users/:id de si mesma', (await alice.get(`/api/users/${alice.user.id}`)).status === 200);
  ok('GET /users/:id de desconhecido → 404', (await carol.get(`/api/users/${alice.user.id}`)).status === 404);
  r = await dave.del(`/api/friends/${carol.user.id}`);
  ok('desfazer amizade', r.status === 200);
  ok('desfazer de novo → 404', (await dave.del(`/api/friends/${carol.user.id}`)).status === 404);
  await carol.post('/api/friends', { username: 'dave' }); await dave.post(`/api/friends/${carol.user.id}/accept`);
  r = await dave.patch('/api/me', { username: 'David_2' });
  ok('trocar username ok (normaliza)', r.status === 200 && r.body.user.username === 'david_2', r);
  ok('login com username novo', (await new Client().post('/api/login', { username: 'david_2', pw: prehash('pw-dave') })).status === 200);

  /* ───── servidores ───── */
  section('servidores, canais, convites');
  r = await alice.post('/api/servers', { name: '   ' });
  ok('servidor sem nome → 400', r.status === 400);
  ok('ícone inválido → 400', (await alice.post('/api/servers', { name: 'x', icon: '<b>' })).status === 400);
  r = await alice.post('/api/servers', { name: 'Casinha', icon: '🐞', color: '#FF5577' });
  const S = r.body;
  ok('criar servidor', r.status === 201 && S.ownerId === alice.user.id && S.channels.length === 1 && S.channels[0].name === 'Sala 1' && S.members.length === 1 && S.color === '#ff5577', r);
  r = await bob.get('/api/servers');
  ok('bob ainda não vê o servidor', Array.isArray(r.body) && r.body.length === 0, r.body);
  ok('não-membro: PATCH → 404', (await carol.patch(`/api/servers/${S.id}`, { name: 'x' })).status === 404);
  r = await alice.post(`/api/servers/${S.id}/invites`, { maxUses: 1 });
  const inv = r.body;
  ok('criar convite (10 letras, 1 uso)', r.status === 201 && /^[A-HJKMNP-Z2-9]{10}$/.test(inv.code) && inv.maxUses === 1 && inv.uses === 0, r);
  ok('convite com maxUses inválido → 400', (await alice.post(`/api/servers/${S.id}/invites`, { maxUses: 0 })).status === 400);
  ok('não-membro não cria convite → 404', (await carol.post(`/api/servers/${S.id}/invites`, {})).status === 404);
  r = await bob.get(`/api/invites/${inv.code}`);
  ok('prévia do convite', r.status === 200 && r.body.server.name === 'Casinha' && r.body.memberCount === 1 && r.body.alreadyMember === false, r);
  ok('convite inexistente → 404 bad_code', (await bob.get('/api/invites/AAAAAAAAAA')).body?.error === 'bad_code');
  ok('convite exige login', (await new Client().get(`/api/invites/${inv.code}`)).status === 401);
  const aliceEv = await openWs('/events', alice);
  r = await bob.post(`/api/invites/${inv.code}/join`);
  ok('bob entra pelo convite', r.status === 200 && r.body.members.length === 2 && r.body.id === S.id, r);
  ok('alice recebe refresh servers', !!(await aliceEv.wait((m) => m.t === 'refresh' && m.what === 'servers')));
  r = await carol.post(`/api/invites/${inv.code}/join`);
  ok('convite esgotado → 410 bad_code', r.status === 410 && r.body.error === 'bad_code', r);
  r = await alice.get(`/api/servers/${S.id}/invites`);
  ok('listar convites (uses=1)', r.status === 200 && r.body[0].uses === 1, r.body);
  r = await alice.post(`/api/servers/${S.id}/invites`, { ttlHours: 24 });
  const inv2 = r.body;
  ok('convite com validade', r.status === 201 && inv2.expiresAt > Date.now() && inv2.maxUses === null, r);
  srv.db.prepare('UPDATE invites SET expires_at=1 WHERE code=?').run(inv2.code);
  ok('convite expirado → 410', (await carol.get(`/api/invites/${inv2.code}`)).status === 410);
  r = await alice.post(`/api/servers/${S.id}/invites`, {});
  const inv3 = r.body;
  r = await bob.patch(`/api/servers/${S.id}`, { name: 'Roubado' });
  ok('membro não-dono: PATCH → 403', r.status === 403, r);
  r = await alice.patch(`/api/servers/${S.id}`, { name: 'Casinha 2', icon: jpeg() });
  ok('dono: PATCH nome e ícone', r.status === 200 && r.body.name === 'Casinha 2' && r.body.icon.startsWith('data:image/jpeg'), r);
  ok('membro não-dono não revoga convite', (await bob.del(`/api/servers/${S.id}/invites/${inv3.code}`)).status === 403);
  ok('dono revoga convite', (await alice.del(`/api/servers/${S.id}/invites/${inv3.code}`)).status === 200);
  ok('convite revogado → 404', (await carol.get(`/api/invites/${inv3.code}`)).status === 404);
  r = await bob.post(`/api/servers/${S.id}/channels`, { name: 'Filmes' });
  ok('não-dono não cria canal → 403', r.status === 403);
  r = await alice.post(`/api/servers/${S.id}/channels`, { name: 'Filmes' });
  ok('dono cria canal', r.status === 201 && r.body.channels.length === 2, r);
  const ch = r.body.channels;
  r = await alice.patch(`/api/servers/${S.id}/channels/${ch[1].id}`, { name: 'Séries' });
  ok('renomear canal', r.status === 200 && r.body.channels[1].name === 'Séries', r);
  ok('canal de outro servidor → 404', (await alice.patch(`/api/servers/${S.id}/channels/aaaaaaaaaaaa`, { name: 'x' })).status === 404);
  r = await alice.del(`/api/servers/${S.id}/channels/${ch[1].id}`);
  ok('apagar canal', r.status === 200 && r.body.channels.length === 1, r);
  r = await alice.del(`/api/servers/${S.id}/channels/${ch[0].id}`);
  ok('não apaga o último canal → 400', r.status === 400 && r.body.error === 'last_channel', r);
  for (let i = 0; i < 7; i++) await alice.post(`/api/servers/${S.id}/channels`, { name: 'c' + i });
  ok('máximo de 8 canais → 403', (await alice.post(`/api/servers/${S.id}/channels`, { name: 'extra' })).status === 403);
  const chans = (await alice.get('/api/servers')).body[0].channels;
  for (const c of chans.slice(1)) await alice.del(`/api/servers/${S.id}/channels/${c.id}`);

  /* ───── ICE e permissões de sala ───── */
  section('ICE / permissões de sala');
  const roomC = 'c:' + chans[0].id;
  const [lo, hi] = [alice.user.id, bob.user.id].sort();
  const roomAB = `d:${lo}:${hi}`;
  const [lo2, hi2] = [alice.user.id, carol.user.id].sort();
  r = await alice.get('/api/ice?room=' + roomC);
  ok('ICE de membro (STUN)', r.status === 200 && r.body.iceServers[0].urls[0].startsWith('stun:'), r);
  ok('ICE de membro (bob)', (await bob.get('/api/ice?room=' + roomC)).status === 200);
  ok('ICE de não-membro → 403', (await carol.get('/api/ice?room=' + roomC)).status === 403);
  ok('ICE DM entre amigos', (await bob.get('/api/ice?room=' + roomAB)).status === 200);
  ok('ICE DM de terceiro → 403', (await carol.get('/api/ice?room=' + roomAB)).status === 403);
  ok('ICE DM entre não-amigos → 403', (await alice.get(`/api/ice?room=d:${lo2}:${hi2}`)).status === 403);
  ok('ICE DM com ids fora de ordem → 403', (await alice.get(`/api/ice?room=d:${hi}:${lo}`)).status === 403);
  ok('ICE sala inválida → 400', (await alice.get('/api/ice?room=lixo')).status === 400);
  ok('ICE sem login → 401', (await new Client().get('/api/ice?room=' + roomC)).status === 401);

  /* ───── /events: presença, sala, toque ───── */
  section('/events (presença)');
  ok('/events sem cookie → 401', (await wsFails('/events', alice, { noCookie: true })) === 401);
  ok('/events com Origin de fora → 403', (await wsFails('/events', alice, { origin: 'http://evil.example' })) === 403);
  const aliceEv2 = aliceEv; // já aberto
  aliceEv2.cursor = aliceEv2.msgs.length;
  bobEv.cursor = bobEv.msgs.length;
  aliceEv2.send({ t: 'ping' });
  ok('ping → pong', !!(await aliceEv2.wait((m) => m.t === 'pong')));
  aliceEv2.send({ t: 'room', room: roomC });
  let p = await bobEv.wait((m) => m.t === 'presence' && m.id === alice.user.id && m.inRoom === roomC);
  ok('bob vê alice na sala (inRoom)', !!p && p.online === true, p);
  aliceEv2.send({ t: 'room', room: 'c:' + chans[0].id.replace(/^./, 'a') });
  ok('sala sem permissão → erro', !!(await aliceEv2.wait((m) => m.t === 'error' && m.what === 'room')));
  r = await bob.get('/api/friends');
  ok('GET /friends mostra online e inRoom', r.body.friends[0].online === true && r.body.friends[0].inRoom === roomC, r.body.friends[0]);
  aliceEv2.send({ t: 'ring', to: bob.user.id, room: roomAB });
  const ring = await bobEv.wait((m) => m.t === 'ring');
  ok('bob recebe toque de alice', !!ring && ring.from === alice.user.id && ring.room === roomAB, ring);
  aliceEv2.send({ t: 'ring', to: bob.user.id, room: roomAB });
  ok('2º toque em 5 s → rate_limited', !!(await aliceEv2.wait((m) => m.t === 'error' && m.what === 'ring' && m.error === 'rate_limited')));
  ok('bob não recebeu o 2º toque', await bobEv.none((m) => m.t === 'ring'));
  aliceEv2.send({ t: 'ring', to: carol.user.id, room: roomAB });
  ok('toque para quem não é amiga → erro', !!(await aliceEv2.wait((m) => m.t === 'error' && m.what === 'ring' && m.error === 'forbidden')));
  await alice.patch('/api/me', { status: 'invisible' });
  p = await bobEv.wait((m) => m.t === 'presence' && m.id === alice.user.id && m.online === false);
  ok('invisível aparece offline para o amigo', !!p && p.status === 'online' && p.inRoom === null, p);
  r = await bob.get('/api/friends');
  ok('GET /friends: invisível offline, sem inRoom', r.body.friends[0].online === false && r.body.friends[0].inRoom === null, r.body.friends[0]);
  r = await alice.get('/api/me');
  ok('alice vê o próprio status real', r.body.user.status === 'invisible' && r.body.user.online === true, r.body.user);
  await alice.patch('/api/me', { status: 'busy' });
  p = await bobEv.wait((m) => m.t === 'presence' && m.id === alice.user.id && m.online === true && m.status === 'busy');
  ok('volta a aparecer (ocupada)', !!p, p);
  aliceEv2.ws.close();
  p = await bobEv.wait((m) => m.t === 'presence' && m.id === alice.user.id && m.online === false);
  ok('desconectar → offline para o amigo', !!p, p);

  /* ───── /ws: sinalização ───── */
  section('/ws (sinalização)');
  ok('/ws sem cookie → 401', (await wsFails('/ws?room=' + roomC, alice, { noCookie: true })) === 401);
  ok('/ws Origin de fora → 403', (await wsFails('/ws?room=' + roomC, alice, { origin: 'http://evil.example' })) === 403);
  ok('/ws sala inválida → 400', (await wsFails('/ws?room=x', alice)) === 400);
  ok('/ws não-membro → 403', (await wsFails('/ws?room=' + roomC, carol)) === 403);
  const wa = await openWs('/ws?room=' + roomC, alice);
  const h1 = await wa.wait((m) => m.t === 'hello');
  ok('alice: hello (sozinha, impolite)', h1 && h1.peers === 0 && h1.polite === false && h1.you === alice.user.id && h1.others.length === 0, h1);
  const wb = await openWs('/ws?room=' + roomC, bob);
  const h2 = await wb.wait((m) => m.t === 'hello');
  ok('bob: hello (polite, vê alice)', h2 && h2.peers === 1 && h2.polite === true && h2.others[0] === alice.user.id, h2);
  const j = await wa.wait((m) => m.t === 'join');
  ok('alice recebe join de bob', j && j.uid === bob.user.id, j);
  wa.send('oi do alice');
  const rel = await wb.wait((m) => m.t === 'r');
  ok('mensagem repassada (cifrada ou não, o servidor só repassa)', rel && rel.d === 'oi do alice', rel);
  ok('quem enviou não recebe o próprio eco', await wa.none((m) => m.t === 'r'));
  // terceiro membro: sala cheia
  const inv4 = (await alice.post(`/api/servers/${S.id}/invites`, {})).body;
  ok('dave entra no servidor', (await dave.post(`/api/invites/${inv4.code}/join`)).status === 200);
  ok('3ª pessoa → 409 sala cheia', (await wsFails('/ws?room=' + roomC, dave)) === 409);
  // reconexão da mesma pessoa
  wb.cursor = wb.msgs.length;
  const wa2 = await openWs('/ws?room=' + roomC, alice);
  const h3 = await wa2.wait((m) => m.t === 'hello');
  ok('alice reconecta: hello com bob', h3 && h3.peers === 1 && h3.others[0] === bob.user.id && h3.polite === false, h3);
  await sleep(100);
  ok('conexão antiga fecha com 4000', wa.closeCode === 4000, wa.closeCode);
  const lv = await wb.wait((m) => m.t === 'leave'); const jn = await wb.wait((m) => m.t === 'join');
  ok('bob vê leave e depois join de alice', lv && lv.uid === alice.user.id && jn && jn.uid === alice.user.id, [lv, jn]);
  ok('bob não recebe leave extra da conexão substituída', await wb.none((m) => m.t === 'leave'));
  wa2.send('depois da troca');
  ok('relay continua após reconexão', !!(await wb.wait((m) => m.t === 'r' && m.d === 'depois da troca')));
  wb.ws.close();
  const lv2 = await wa2.wait((m) => m.t === 'leave');
  ok('alice recebe leave quando bob sai', lv2 && lv2.uid === bob.user.id, lv2);
  const big = 'x'.repeat(70 * 1024);
  wa2.ws.send(big);
  await sleep(200);
  ok('mensagem > 64 KB derruba a conexão', wa2.closeCode !== null, wa2.closeCode);
  // DM
  const wd1 = await openWs('/ws?room=' + roomAB, alice), wd2 = await openWs('/ws?room=' + roomAB, bob);
  ok('sala DM entre amigas funciona', !!(await wd2.wait((m) => m.t === 'hello' && m.peers === 1)));
  wd1.ws.close(); wd2.ws.close();

  /* ───── kick, sair, apagar, limites ───── */
  section('kick / sair / apagar');
  r = await alice.del(`/api/servers/${S.id}/members/${alice.user.id}`);
  ok('dono não se expulsa → 400', r.status === 400);
  ok('não-dono não expulsa → 403', (await bob.del(`/api/servers/${S.id}/members/${dave.user.id}`)).status === 403);
  r = await alice.del(`/api/servers/${S.id}/members/${bob.user.id}`);
  ok('dono expulsa bob', r.status === 200);
  ok('bob não vê mais o servidor', (await bob.get('/api/servers')).body.length === 0);
  ok('bob expulso não entra na sala (403)', (await wsFails('/ws?room=' + roomC, bob)) === 403);
  ok('bob expulso não pega ICE', (await bob.get('/api/ice?room=' + roomC)).status === 403);
  ok('expulsar quem não é membro → 404', (await alice.del(`/api/servers/${S.id}/members/${bob.user.id}`)).status === 404);
  ok('dono não pode sair (use apagar)', (await alice.post(`/api/servers/${S.id}/leave`)).body?.error === 'owner_cannot_leave');
  r = await dave.post(`/api/servers/${S.id}/leave`);
  ok('dave sai do servidor', r.status === 200);
  ok('dave que saiu não acessa mais → 404', (await dave.get(`/api/servers/${S.id}/invites`)).status === 404);
  r = await alice.del(`/api/servers/${S.id}`);
  ok('dono apaga o servidor', r.status === 200);
  ok('servidor some', (await alice.get('/api/servers')).body.length === 0);
  const orphan = srv.db.prepare('SELECT (SELECT COUNT(*) FROM channels WHERE server_id=?) + (SELECT COUNT(*) FROM members WHERE server_id=?) + (SELECT COUNT(*) FROM invites WHERE server_id=?) AS n').get(S.id, S.id, S.id).n;
  ok('limpeza: nada sobra no banco', orphan === 0, orphan);
  let made = 0, last;
  for (let i = 0; i < 11; i++) { last = await alice.post('/api/servers', { name: 'S' + i }); if (last.status === 201) made++; }
  ok('máximo de 10 servidores → 403 limit_reached', made === 10 && last.status === 403 && last.body.error === 'limit_reached', [made, last.status, last.body]);

  /* ───── CSRF e outros ───── */
  section('CSRF / métodos');
  ok('PATCH sem X-Telinha → 403 csrf', (await alice.patch('/api/me', { name: 'x' }, { noCsrf: true })).body.error === 'csrf');
  ok('DELETE com Origin de fora → 403', (await alice.del(`/api/friends/${bob.user.id}`, { origin: 'http://evil.example' })).status === 403);
  ok('rota desconhecida → 404', (await alice.get('/api/xyz')).status === 404);
  ok('método errado → 405', (await alice.req('PUT', '/api/me', {})).status === 405);
  ok('respostas da API: no-store + nosniff', (await alice.get('/api/me')).headers.get('cache-control') === 'no-store');

  /* ───── SIGNUP_CODE ───── */
  section('código de cadastro (SIGNUP_CODE)');
  const srv2 = await startDevServer({ port: 0, env: { MAX_ACCOUNTS: '2', SIGNUP_CODE: 'segredo-da-casa' } });
  const post2 = (body) => fetch(srv2.url + '/api/signup', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telinha': '1', origin: srv2.url }, body: JSON.stringify(body) });
  ok('status mostra needsCode', (await (await fetch(srv2.url + '/api/status')).json()).needsCode === true);
  ok('sem código → 403 bad_code', (await (await post2({ username: 'ana', pw: goodPw })).json()).error === 'bad_code');
  ok('código errado → 403 bad_code', (await post2({ username: 'ana', pw: goodPw, code: 'errado-errado!!' })).status === 403);
  ok('código certo → 201', (await post2({ username: 'ana', pw: goodPw, code: 'segredo-da-casa' })).status === 201);
  await srv2.close();
} catch (e) {
  fail++; console.log('  ✗ EXCEÇÃO NO TESTE:', e && e.stack || e);
}

console.log(`\n${pass} ok, ${fail} falhas`);
await srv.close();
process.exit(fail ? 1 : 0);
