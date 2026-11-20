// Testes de várias contas no mesmo navegador: adicionar, trocar, sair (vai para a outra) e sair de todas.
//   node --no-warnings dev/accounts-test.js
import crypto from 'node:crypto';
import { startDevServer } from './server.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } };
const prehash = (s) => crypto.createHash('sha256').update(s).digest('hex');
const srv = await startDevServer({ port: 0, env: { MAX_ACCOUNTS: '6' } });
const BASE = srv.url;

/** Navegador de mentira: guarda todos os cookies como o navegador faria. */
class Browser {
  constructor() { this.jar = new Map(); }
  async req(method, path, body) {
    const h = { origin: BASE, 'content-type': 'application/json' };
    if (method !== 'GET') h['x-telinha'] = '1';
    if (this.jar.size) h.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie?.() || []) {
      const [kv, ...attrs] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1);
      if (!v || attrs.some((a) => /max-age=0/i.test(a))) this.jar.delete(k); else this.jar.set(k, v);
      ok('cookie HttpOnly e SameSite', /HttpOnly/.test(c) && /SameSite=Strict/.test(c));
    }
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, j };
  }
}
const b = new Browser();
await b.req('POST', '/api/signup', { username: 'ana', pw: prehash('a') });
let me = await b.req('GET', '/api/me'); ok('ana entrou', me.j.user.username === 'ana');
await b.req('POST', '/api/signup', { username: 'bia', pw: prehash('b') });
me = await b.req('GET', '/api/me'); ok('bia é a atual', me.j.user.username === 'bia');
let acc = await b.req('GET', '/api/accounts'); ok('ana fica guardada', acc.j.accounts.length === 1 && acc.j.accounts[0].username === 'ana', acc.j);
const anaId = acc.j.accounts[0].id;
let r = await b.req('POST', '/api/accounts/switch', { id: anaId }); ok('troca para ana', r.status === 200 && r.j.user.username === 'ana');
me = await b.req('GET', '/api/me'); ok('ana é a atual', me.j.user.username === 'ana');
acc = await b.req('GET', '/api/accounts'); ok('bia agora guardada', acc.j.accounts.length === 1 && acc.j.accounts[0].username === 'bia');
r = await b.req('POST', '/api/accounts/switch', { id: 'aaaaaaaaaaaa' }); ok('não troca para conta que não está aberta', r.status === 404);
// entrar de novo na mesma conta não duplica
await b.req('POST', '/api/login', { username: 'ana', pw: prehash('a') });
acc = await b.req('GET', '/api/accounts'); ok('sem duplicar', acc.j.accounts.length === 1 && acc.j.accounts[0].username === 'bia', acc.j);
// outro navegador não vê nada
const other = new Browser();
r = await other.req('GET', '/api/accounts'); ok('outro navegador: 401', r.status === 401);
// sair: entra na outra
r = await b.req('POST', '/api/logout', {}); ok('sair leva para bia', r.j.switched && r.j.switched.username === 'bia', r.j);
me = await b.req('GET', '/api/me'); ok('bia atual depois de sair', me.j.user.username === 'bia');
acc = await b.req('GET', '/api/accounts'); ok('lista vazia', acc.j.accounts.length === 0);
// sair de todas
await b.req('POST', '/api/login', { username: 'ana', pw: prehash('a') });
r = await b.req('POST', '/api/logout', { all: true }); ok('sair de todas', r.j.ok && !r.j.switched);
me = await b.req('GET', '/api/me'); ok('ninguém logado', me.status === 401);
await srv.close();
console.log(`\n${pass} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
