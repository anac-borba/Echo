// Testes do chat, arquivos, visualização única, reações, registro de chamada e "desligar".
//   node --no-warnings dev/chat-test.js
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
async function upload(c, to, bytes, type = 'image/png', name = 'x.png', once = false) {
  const r = await c.post('/api/files', { to, name, type, size: bytes.length, once });
  if (r.status !== 201) return { r };
  for (let n = 0; n < r.body.chunks; n++) {
    const part = bytes.subarray(n * r.body.chunk, (n + 1) * r.body.chunk);
    const p = await c.put(`/api/files/${r.body.id}/${n}`, part);
    if (p.status !== 200) return { r, p };
  }
  return { id: r.body.id, r };
}

const ana = await user('ana'), angie = await user('angie'), eve = await user('eve');
await friends(ana, angie);
const evA = await openWs('/events', ana), evB = await openWs('/events', angie), evE = await openWs('/events', eve);

section('mensagens de texto');
let r = await ana.post('/api/messages', { to: angie.id, text: 'oi amor 💕' });
ok('envia', r.status === 201 && r.body.message.text === 'oi amor 💕', r);
const m1 = r.body.message;
ok('chega em tempo real para a outra', !!(await evB.wait((m) => m.t === 'msg' && m.m.id === m1.id)));
ok('e para quem mandou (outros aparelhos)', !!(await evA.wait((m) => m.t === 'msg' && m.m.id === m1.id)));
ok('estranha não recebe', !(evE.msgs.some((m) => m.t === 'msg')));
r = await eve.post('/api/messages', { to: angie.id, text: 'oi' });
ok('quem não é amiga não manda', r.status === 404, r.status);
r = await eve.get(`/api/messages?with=${ana.id}`);
ok('quem não é amiga não lê', r.status === 404, r.status);
r = await ana.post('/api/messages', { to: angie.id, text: '   ' });
ok('vazia recusada', r.status === 400);
r = await ana.post('/api/messages', { to: angie.id, text: 'x'.repeat(4001) });
ok('longa demais recusada', r.status === 413, r.status);
r = await angie.get('/api/convs');
ok('conversa aparece com 1 não lida', r.body.convs[0].unread === 1 && r.body.convs[0].with === ana.id, r.body);
r = await angie.post(`/api/convs/${ana.id}/read`, { at: m1.at });
ok('marca como lida', r.status === 200);
ok('ana recebe "visto"', !!(await evA.wait((m) => m.t === 'read' && m.uid === angie.id)));
r = await angie.get('/api/convs');
ok('não lidas zeram', r.body.convs[0].unread === 0);
r = await angie.post('/api/messages', { to: ana.id, text: 'oiii', reply: m1.id });
ok('responder mostra citação', r.body.message.reply && r.body.message.reply.id === m1.id && r.body.message.reply.text === 'oi amor 💕', r.body);

section('editar, reagir, apagar');
r = await ana.patch(`/api/messages/${m1.id}`, { text: 'oi amor 💖' });
ok('edita a própria', r.status === 200 && r.body.message.text === 'oi amor 💖' && r.body.message.edited);
r = await angie.patch(`/api/messages/${m1.id}`, { text: 'hack' });
ok('não edita a da outra', r.status === 403);
r = await angie.post(`/api/messages/${m1.id}/react`, { emoji: '❤️' });
ok('reage', r.status === 200 && r.body.message.reactions['❤️'].includes(angie.id), r.body);
r = await angie.post(`/api/messages/${m1.id}/react`, { emoji: '❤️' });
ok('reagir de novo tira', r.status === 200 && !r.body.message.reactions['❤️']);
r = await angie.post(`/api/messages/${m1.id}/react`, { emoji: '<script>' });
ok('reação precisa ser emoji', r.status === 400);
r = await angie.del(`/api/messages/${m1.id}`);
ok('não apaga a da outra', r.status === 403);
r = await ana.del(`/api/messages/${m1.id}`);
ok('apaga a própria', r.status === 200);
ok('outra fica sabendo', !!(await evB.wait((m) => m.t === 'msg-del' && m.id === m1.id)));

section('arquivos');
const img = crypto.randomBytes(2.5 * 1024 * 1024);
let up = await upload(ana, angie.id, img, 'image/png', 'foto.png');
ok('upload em pedaços', !!up.id, up.r && up.r.body);
r = await ana.post('/api/messages', { to: angie.id, files: [{ id: up.id, w: 800, h: 600 }], text: 'olha' });
ok('mensagem com arquivo', r.status === 201 && r.body.message.files[0].w === 800 && r.body.message.kind === 'file', r.body);
r = await angie.get(`/api/files/${up.id}`);
ok('baixa inteiro igual', r.status === 200 && Buffer.compare(r.buf, img) === 0 && r.headers.get('content-type') === 'image/png');
ok('sem rastro de sniff/CSP', r.headers.get('x-content-type-options') === 'nosniff' && /sandbox/.test(r.headers.get('content-security-policy') || ''));
r = await angie.get(`/api/files/${up.id}`, { headers: { range: 'bytes=1048570-1048590' } });
ok('Range atravessando pedaços', r.status === 206 && Buffer.compare(r.buf, img.subarray(1048570, 1048591)) === 0 && r.headers.get('content-range') === `bytes 1048570-1048590/${img.length}`);
r = await angie.get(`/api/files/${up.id}`, { headers: { range: 'bytes=-100' } });
ok('Range do fim', r.status === 206 && Buffer.compare(r.buf, img.subarray(img.length - 100)) === 0);
r = await angie.get(`/api/files/${up.id}`, { headers: { range: 'bytes=999999999-' } });
ok('Range fora', r.status === 416);
r = await eve.get(`/api/files/${up.id}`);
ok('estranha não baixa', r.status === 404);
up = await upload(ana, angie.id, Buffer.from('<svg onload=alert(1)>'), 'image/svg+xml', 'x.svg');
await ana.post('/api/messages', { to: angie.id, files: [{ id: up.id }] });
r = await angie.get(`/api/files/${up.id}`);
ok('SVG vira download (nunca abre como página)', r.headers.get('content-type') === 'application/octet-stream' && /attachment/.test(r.headers.get('content-disposition')));
r = await ana.post('/api/files', { to: angie.id, name: 'g', type: 'video/mp4', size: 101 * 1024 * 1024 });
ok('limite por arquivo', r.status === 413);
r = await ana.post('/api/files', { to: angie.id, name: 'g', type: 'video/mp4', size: 30 * 1024 * 1024 });
ok('limite total de armazenamento', r.status === 507, r.status);
r = await ana.post('/api/files', { to: angie.id, name: 'p', type: 'image/png', size: 10 });
const half = r.body.id;
r = await ana.post('/api/messages', { to: angie.id, files: [{ id: half }] });
ok('arquivo incompleto não vira mensagem', r.status === 400 && r.body.error === 'upload_incomplete');
r = await ana.put(`/api/files/${half}/0`, Buffer.alloc(9));
ok('pedaço com tamanho errado recusado', r.status === 400);
r = await angie.put(`/api/files/${half}/0`, Buffer.alloc(10));
ok('só a dona manda pedaços', r.status === 404);
r = await angie.post('/api/messages', { to: ana.id, files: [{ id: half }] });
ok('não usa arquivo de outra pessoa', r.status === 400);

section('visualização única');
up = await upload(ana, angie.id, Buffer.from('segredo-png'), 'image/png', 's.png', true);
r = await ana.post('/api/messages', { to: angie.id, files: [{ id: up.id }], once: true });
const once = r.body.message;
ok('lista não revela conteúdo', once.once && once.files.length === 0 && once.onceKind === 'image', once);
r = await angie.get(`/api/files/${up.id}`);
ok('não baixa antes de abrir', r.status === 404);
r = await ana.post(`/api/messages/${once.id}/open`);
ok('quem mandou não abre', r.status === 403);
r = await angie.post(`/api/messages/${once.id}/open`);
ok('quem recebeu abre uma vez', r.status === 200 && r.body.content.files[0].id === up.id);
r = await angie.get(`/api/files/${up.id}`);
ok('baixa logo depois de abrir, sem cache', r.status === 200 && r.buf.toString() === 'segredo-png' && r.headers.get('cache-control') === 'no-store');
r = await ana.get(`/api/files/${up.id}`);
ok('quem mandou não baixa', r.status === 404);
r = await angie.post(`/api/messages/${once.id}/open`);
ok('segunda vez: já era', r.status === 410);
r = await ana.post('/api/messages', { to: angie.id, text: 'texto secreto', once: true });
r = await angie.post(`/api/messages/${r.body.message.id}/open`);
ok('texto único abre', r.body.content.text === 'texto secreto');
r = await angie.get(`/api/messages?with=${ana.id}`);
ok('texto único some do servidor', !JSON.stringify(r.body).includes('texto secreto'));
const row = srv.db.prepare('SELECT body FROM messages WHERE once=1 AND opened_at IS NOT NULL').all();
ok('banco não guarda mais o texto', row.every((x) => x.body === ''));

section('paginação');
for (let i = 0; i < 60; i++) await (i % 2 ? ana : angie).post('/api/messages', { to: i % 2 ? angie.id : ana.id, text: 'm' + i });
r = await ana.get(`/api/messages?with=${angie.id}&limit=50`);
ok('página 1', r.body.messages.length === 50 && r.body.more && r.body.messages[49].text === 'm59');
const first = r.body.messages[0];
r = await ana.get(`/api/messages?with=${angie.id}&limit=50&before=${first.at}_${first.id}`);
ok('página 2 antes da primeira', r.body.messages.length > 0 && r.body.messages.every((m) => m.at <= first.at && m.id !== first.id));

section('digitando');
evA.ws.send(JSON.stringify({ t: 'typing', to: angie.id }));
ok('"digitando" chega', !!(await evB.wait((m) => m.t === 'typing' && m.from === ana.id)));
evE.ws.send(JSON.stringify({ t: 'typing', to: angie.id }));
await sleep(200);
ok('estranha não manda "digitando"', !evB.msgs.slice(evB.cursor).some((m) => m.t === 'typing' && m.from === eve.id));

section('chamada: desligar acaba para as duas e fica registrado');
const room = 'd:' + [ana.id, angie.id].sort().join(':');
const rA = await openWs('/ws?room=' + encodeURIComponent(room), ana);
await rA.wait((m) => m.t === 'hello');
const rB = await openWs('/ws?room=' + encodeURIComponent(room), angie);
await rB.wait((m) => m.t === 'hello');
await sleep(1100);
rA.ws.send('{"bye":1}');
ok('a outra recebe "desligou"', !!(await rB.wait((m) => m.t === 'bye' && m.uid === ana.id)));
const log = await evB.wait((m) => m.t === 'msg' && m.m.kind === 'call');
ok('registro da chamada com duração e quem desligou', log && log.m.call.by === ana.id && log.m.call.dur >= 1, log && log.m);
rA.ws.close(); rB.ws.close();
await sleep(200);
ok('um registro só', srv.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE kind='call'").get().n === 1);

section('chamada: queda de internet não encerra; volta e continua');
const q1 = await openWs('/ws?room=' + encodeURIComponent(room), ana); await q1.wait((m) => m.t === 'hello');
const q2 = await openWs('/ws?room=' + encodeURIComponent(room), angie); await q2.wait((m) => m.t === 'hello');
await sleep(300);
q1.ws.terminate();
ok('a outra vê "saiu" (não "desligou")', !!(await q2.wait((m) => m.t === 'leave')));
const q3 = await openWs('/ws?room=' + encodeURIComponent(room), ana); await q3.wait((m) => m.t === 'hello');
await sleep(300);
q2.ws.send('{"bye":1}');
const log2 = await evA.wait((m) => m.t === 'msg' && m.m.kind === 'call' && m.m.call.by === angie.id);
ok('registro conta desde o começo (não reinicia na queda)', log2 && log2.m.call.by === angie.id && log2.m.call.dur >= 0, log2 && log2.m);
q3.ws.close(); q2.ws.close();

section('chamada perdida');
const lone = await openWs('/ws?room=' + encodeURIComponent(room), ana); await lone.wait((m) => m.t === 'hello');
await sleep(4300);
lone.ws.close();
const miss = await evB.wait((m) => m.t === 'msg' && m.m.kind === 'call' && m.m.call.missed, 3000);
ok('ligação não atendida vira "perdida"', !!miss, miss);

section('GIFs sem chave');
r = await ana.get('/api/gifs?q=gato');
ok('sem GIPHY_KEY responde 501', r.status === 501 && r.body.error === 'gifs_off');
r = await ana.get('/api/gif-media?u=' + encodeURIComponent('https://evil.example/x.gif'));
ok('proxy só aceita GIPHY (sem SSRF)', r.status === 400);
r = await ana.post('/api/messages', { to: angie.id, gif: { mp4: 'https://evil.example/a.mp4' } });
ok('GIF de outro site recusado', r.status === 400);
r = await ana.post('/api/messages', { to: angie.id, gif: { mp4: 'https://media.giphy.com/media/abc/giphy.mp4', w: 200, h: 150 } });
ok('GIF do GIPHY aceito', r.status === 201 && r.body.message.gif.w === 200);

section('rota interna não fica exposta');
r = await ana.post('/internal/calllog', { room, info: { by: ana.id } });
ok('/internal fora da API', r.status === 404);

console.log(`\n${pass} ok, ${fail} falhas`);
await srv.close();
process.exit(fail ? 1 : 0);
