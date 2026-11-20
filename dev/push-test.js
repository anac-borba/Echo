// Testes das notificações: inscrição, chave VAPID, cifra e quando o servidor manda (só com o app fora da tela).
//   node --no-warnings dev/push-test.js
import crypto from 'node:crypto';
import WebSocket from '/opt/npm-tools/node_modules/ws/index.js';
import { startDevServer } from './server.js';
import { b64u, unb64u } from '../worker/src/push.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prehash = (s) => crypto.createHash('sha256').update(s).digest('hex');
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt) => {
  if (String(url).startsWith('https://fcm.googleapis.com/')) { sent.push({ url, opt }); return new Response('', { status: String(url).endsWith('gone') ? 410 : 201 }); }
  return realFetch(url, opt);
};
const srv = await startDevServer({ port: 0, env: { MAX_ACCOUNTS: '6' } });
const BASE = srv.url;
async function user(name) {
  const r = await realFetch(BASE + '/api/signup', { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json', 'x-telinha': '1' }, body: JSON.stringify({ username: name, pw: prehash(name) }) });
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const j = await r.json();
  const call = async (method, path, body) => { const x = await realFetch(BASE + path, { method, headers: { origin: BASE, cookie, 'content-type': 'application/json', 'x-telinha': '1' }, body: body ? JSON.stringify(body) : undefined }); return { status: x.status, j: await x.json().catch(() => null) }; };
  return { id: j.user.id, cookie, call };
}
const A = await user('ana'), B = await user('bia');
let r = await A.call('POST', '/api/friends', { username: 'bia' });
await B.call('POST', `/api/friends/${A.id}/accept`);
r = await A.call('GET', '/api/push/key');
ok('chave VAPID (65 bytes)', r.status === 200 && unb64u(r.j.key).length === 65, r.j);
const key1 = r.j.key;
ok('mesma chave na segunda vez', (await A.call('GET', '/api/push/key')).j.key === key1);
// inscrição de B (chaves de um "navegador" de mentira)
const ua = await crypto.webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const p256dh = b64u(await crypto.webcrypto.subtle.exportKey('raw', ua.publicKey)), auth = b64u(crypto.randomBytes(16));
r = await B.call('POST', '/api/push/sub', { endpoint: 'https://evil.example.com/x', keys: { p256dh, auth } });
ok('endereço que não é de push é recusado', r.status === 400);
r = await B.call('POST', '/api/push/sub', { endpoint: 'https://fcm.googleapis.com/fcm/send/bia1', keys: { p256dh, auth } });
ok('inscreve', r.status === 200);
// B sem nenhuma aba aberta: mensagem gera notificação
await A.call('POST', '/api/messages', { to: B.id, text: 'Oi Bia!' });
await sleep(300);
ok('notificação enviada', sent.length === 1, sent.length);
const s0 = sent[0];
ok('cabeçalhos', s0 && s0.opt.headers['Content-Encoding'] === 'aes128gcm' && /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/.test(s0.opt.headers.Authorization), s0 && s0.opt.headers);
// confere a assinatura do JWT com a chave pública
if (s0) {
  const [, tok] = /t=([^,]+)/.exec(s0.opt.headers.Authorization);
  const [h, p, sig] = tok.split('.');
  const pub = await crypto.webcrypto.subtle.importKey('raw', unb64u(key1), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const good = await crypto.webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64u(sig), new TextEncoder().encode(h + '.' + p));
  const claims = JSON.parse(Buffer.from(unb64u(p)).toString());
  ok('JWT assinado e com aud certo', good && claims.aud === 'https://fcm.googleapis.com', claims);
}
// B com o app aberto e visível: não manda
const ws = new WebSocket(BASE.replace('http', 'ws') + '/events', { headers: { cookie: B.cookie, origin: BASE } });
await new Promise((res) => ws.on('open', res));
ws.send(JSON.stringify({ t: 'vis', v: true })); await sleep(100);
await A.call('POST', '/api/messages', { to: B.id, text: 'de novo' }); await sleep(300);
ok('app visível: sem notificação', sent.length === 1, sent.length);
ws.send(JSON.stringify({ t: 'vis', v: false })); await sleep(100);
await A.call('POST', '/api/messages', { to: B.id, text: 'e agora?' }); await sleep(300);
ok('app em segundo plano: notifica', sent.length === 2, sent.length);
// inscrição morta (410) é apagada
await B.call('POST', '/api/push/sub', { endpoint: 'https://fcm.googleapis.com/fcm/send/gone', keys: { p256dh, auth } });
await A.call('POST', '/api/messages', { to: B.id, text: 'x' }); await sleep(300);
const n = sent.length;
await A.call('POST', '/api/messages', { to: B.id, text: 'y' }); await sleep(300);
ok('410 remove a inscrição', sent.length - n === 1, [n, sent.length]);
ok('sair da inscrição', (await B.call('POST', '/api/push/unsub', { endpoint: 'https://fcm.googleapis.com/fcm/send/bia1' })).status === 200);
ws.close(); await srv.close();
console.log(`\n${pass} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
