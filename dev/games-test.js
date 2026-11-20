// Testes dos jogos: convites e jogadas repassadas só entre amigas, limites, histórico e placar.
//   node --no-warnings dev/games-test.js
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { startDevServer } from './server.js';

const require = createRequire(import.meta.url);
let wsLib; try { wsLib = require('ws'); } catch { wsLib = require('/opt/npm-tools/node_modules/ws'); }
const { WebSocket } = wsLib;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } };
const section = (t) => console.log('•', t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prehash = (s) => crypto.createHash('sha256').update(s).digest('hex');

const srv = await startDevServer({ port: 0, env: { MAX_ACCOUNTS: '6', CHAT_STORAGE_MB: '20' } });
const BASE = srv.url;

class Client {
  constructor() { this.cookie = ''; }
  async req(method, path, body, o = {}) {
    const h = { origin: BASE };
    if (!o.raw) h['content-type'] = 'application/json';
    if (method !== 'GET') h['x-telinha'] = '1';
    if (this.cookie) h.cookie = this.cookie;
    if (o.headers) Object.assign(h, o.headers);
    const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : (o.raw ? body : JSON.stringify(body)) });
    const sc = res.headers.getSetCookie?.() || [];
    if (sc.length) { const c = sc[0].split(';')[0]; this.cookie = c.endsWith('=') ? '' : c; }
    const buf = Buffer.from(await res.arrayBuffer());
    let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch {}
    return { status: res.status, body: json, buf, headers: res.headers };
  }
  get(p, o) { return this.req('GET', p, undefined, o); }
  post(p, b = {}, o) { return this.req('POST', p, b, o); }
  patch(p, b = {}) { return this.req('PATCH', p, b); }
  del(p) { return this.req('DELETE', p, {}); }
  put(p, buf) { return this.req('PUT', p, buf, { raw: true, headers: { 'content-type': 'application/octet-stream' } }); }
}
function openWs(path, client) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE.replace('http', 'ws') + path, { headers: { Origin: BASE, Cookie: client.cookie } });
    const api = { ws, msgs: [], cursor: 0 };
    ws.on('message', (d) => api.msgs.push(JSON.parse(d.toString())));
    ws.on('error', () => {});
    ws.on('open', () => resolve(api));
    ws.on('unexpected-response', (_q, res) => reject(new Error('http ' + res.statusCode)));
    api.wait = async (pred, ms = 2500) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        for (let i = api.cursor; i < api.msgs.length; i++) if (pred(api.msgs[i])) { api.cursor = i + 1; return api.msgs[i]; }
        await sleep(15);
      }
      return null;
    };
  });
}
async function user(name) {
  const c = new Client();
  const r = await c.post('/api/signup', { username: name, pw: prehash('senha ' + name) });
  c.id = r.body.user.id; c.name = name;
  return c;
}
async function friends(a, b) { await a.post('/api/friends', { username: b.name }); await b.post(`/api/friends/${a.id}/accept`); }

const A = await user('ana'), B = await user('bia'), C = await user('cris');
await friends(A, B);
const wa = await openWs('/events', A), wb = await openWs('/events', B), wc = await openWs('/events', C);
await sleep(150);
const sid = 'abc123def456';

section('convite e jogadas');
wa.ws.send(JSON.stringify({ t: 'g', to: B.id, sid, k: 'invite', game: 'uno' }));
let m = await wb.wait((x) => x.t === 'g' && x.k === 'invite');
ok('B recebe convite', m && m.from === A.id && m.game === 'uno' && m.sid === sid, m);
wb.ws.send(JSON.stringify({ t: 'g', to: A.id, sid, k: 'accept' }));
m = await wa.wait((x) => x.t === 'g' && x.k === 'accept');
ok('A recebe aceite', !!m);
wa.ws.send(JSON.stringify({ t: 'g', to: B.id, sid: 'opt123opt456', k: 'invite', game: 'ludo', opts: { goal: '2', safe: false, first: 'rand', nested: { x: 1 }, 'bad key': 1, long: 'x'.repeat(40) } }));
m = await wb.wait((x) => x.t === 'g' && x.k === 'invite' && x.sid === 'opt123opt456');
ok('convite leva só regras simples', m && m.opts && m.opts.goal === '2' && m.opts.safe === false && m.opts.first === 'rand' && !('nested' in m.opts) && !('bad key' in m.opts) && !('long' in m.opts), m);
wa.ws.send(JSON.stringify({ t: 'g', to: B.id, sid, k: 'msg', m: { t: 'st', s: { hand: [1, 2, 3] } } }));
m = await wb.wait((x) => x.t === 'g' && x.k === 'msg');
ok('jogada repassada intacta', m && m.m && m.m.s && m.m.s.hand.length === 3, m);
wa.ws.send(JSON.stringify({ t: 'g', to: B.id, sid, k: 'invite', game: 'poker' }));
m = await wa.wait((x) => x.t === 'error' && x.what === 'g');
ok('jogo desconhecido recusado', m && m.error === 'bad_request', m);
wc.ws.send(JSON.stringify({ t: 'g', to: A.id, sid: 'zzzzzzzzzzzz', k: 'invite', game: 'uno' }));
m = await wc.wait((x) => x.t === 'error' && x.what === 'g');
ok('quem não é amiga não convida', m && m.error === 'forbidden', m);
ok('A não recebeu nada de C', !(await wa.wait((x) => x.t === 'g' && x.from === C.id, 300)));
wa.ws.send(JSON.stringify({ t: 'g', to: B.id, sid, k: 'msg', m: { big: 'x'.repeat(61000) } }));
m = await wa.wait((x) => x.t === 'error' && x.what === 'g');
ok('mensagem grande demais recusada', m && m.error === 'too_large', m);
wa.ws.send(JSON.stringify({ t: 'g', to: B.id, sid: 'CURTO', k: 'msg', m: 1 }));
m = await wa.wait((x) => x.t === 'error' && x.what === 'g');
ok('sid inválido recusado', m && m.error === 'bad_request', m);

section('histórico');
let r = await A.post('/api/games/result', { sid, mid: '1', game: 'uno', opp: B.id, winner: 'host' });
ok('grava resultado', r.status === 200, r.body);
m = await wb.wait((x) => x.t === 'match');
ok('B é avisada do resultado', m && m.match && m.match.winner === A.id, m);
r = await A.post('/api/games/result', { sid, mid: '1', game: 'uno', opp: B.id, winner: 'guest' });
ok('mesma partida atualiza (não duplica)', r.status === 200);
await A.post('/api/games/result', { sid, mid: '2', game: 'uno', opp: B.id, winner: 'draw' });
await A.post('/api/games/result', { sid: 'tetrisxyz123', mid: '1', game: 'tetris', opp: B.id, winner: 'host', score: [1200, 300.6] });
r = await B.get('/api/games/history');
ok('histórico tem 3 partidas', r.body.matches.length === 3, r.body);
const uno = r.body.stats.find((s) => s.game === 'uno'), tet = r.body.stats.find((s) => s.game === 'tetris');
ok('placar do Uno para B: 1 vitória, 1 empate', uno && uno.w === 1 && uno.l === 0 && uno.d === 1 && uno.opp === A.id, uno);
ok('placar do Tetris para B: 1 derrota', tet && tet.w === 0 && tet.l === 1, tet);
ok('placar arredondado', JSON.stringify(r.body.matches.find((x) => x.game === 'tetris').score) === '[1200,301]');
r = await C.post('/api/games/result', { sid: 'cccccccccccc', game: 'uno', opp: A.id, winner: 'host' });
ok('não grava contra quem não é amiga', r.status === 400, r.body);
r = await A.post('/api/games/result', { sid: 'aaaaaaaaaaaa', game: 'poker', opp: B.id, winner: 'host' });
ok('jogo desconhecido não grava', r.status === 400);
r = await C.get('/api/games/history');
ok('C não vê partidas das outras', r.body.matches.length === 0);
r = await new Client().get('/api/games/history');
ok('sem login: 401', r.status === 401);

for (const w of [wa, wb, wc]) w.ws.close();
await srv.close();
console.log(`\n${pass} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
