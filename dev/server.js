// Servidor LOCAL de teste da Telinha: roda o MESMO núcleo do Worker (worker/src/core.js)
// com node:sqlite e a biblioteca "ws". Não vai para produção.
//
//   node dev/server.js                    -> http://localhost:8787 (banco em memória)
//   DB=./telinha.db MAX_ACCOUNTS=2 PORT=8787 node dev/server.js
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createCore, createRoomLogic, sameOrigin, ROOM_ANY_RE } from '../worker/src/core.js';

const require = createRequire(import.meta.url);
let wsLib;
try { wsLib = require('ws'); } catch { wsLib = require('/opt/npm-tools/node_modules/ws'); }
const { WebSocketServer } = wsLib;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg',
};

function readHeadersFile(webDir) {
  const out = {};
  try {
    for (const l of fs.readFileSync(path.join(webDir, '_headers'), 'utf8').split('\n').slice(1)) {
      const m = /^\s+([\w-]+):\s*(.+)$/.exec(l);
      if (m && m[1].toLowerCase() !== 'strict-transport-security') out[m[1]] = m[2].trim();
    }
  } catch {}
  return out;
}

export function startDevServer({ port = 0, env = {}, dbPath = ':memory:', webDir = path.join(HERE, '..', 'web') } = {}) {
  const db = new DatabaseSync(dbPath);
  const evSockets = new Set();
  const rooms = new Map(); // room -> Set<ws>
  const setMeta = (ws, meta) => { ws.meta = meta; };

  const core = createCore({
    sql: { all: (q, ...p) => db.prepare(q).all(...p), run: (q, ...p) => { db.prepare(q).run(...p); } },
    env,
    sockets: () => [...evSockets].map((ws) => ({ ws, meta: ws.meta })),
    setMeta,
  });
  const roomLogic = createRoomLogic({ setMeta, onCallEnd: (room, info) => core.recordCall(room, info) });
  const roomList = (room) => [...(rooms.get(room) || [])].map((ws) => ({ ws, meta: ws.meta }));
  const staticHeaders = readHeadersFile(webDir);

  // monta o objeto "request" simples que o núcleo espera
  const toRequest = (req, body) => ({
    method: req.method,
    url: `http://${req.headers.host || 'localhost'}${req.url}`,
    headers: new Headers({ ...req.headers, 'x-real-ip': req.socket.remoteAddress || 'local' }),
    text: async () => (Buffer.isBuffer(body) ? body.toString('utf8') : body),
    arrayBuffer: async () => (Buffer.isBuffer(body) ? new Uint8Array(body) : new TextEncoder().encode(body || '')),
  });
  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > 1024 * 1024 + 10) { reject(new Error('grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
  async function sendResponse(res, r) {
    const h = {};
    r.headers.forEach((v, k) => { if (k !== 'set-cookie') h[k] = v; });
    const cookies = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    if (cookies.length) h['set-cookie'] = cookies;
    res.writeHead(r.status, h);
    res.end(Buffer.from(await r.arrayBuffer()));
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) {
        if (Number(req.headers['content-length'] || 0) > 1024 * 1024) {
          res.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' });
          return res.end('{"error":"too_large"}');
        }
        const body = req.method === 'GET' || req.method === 'HEAD' ? '' : await readBody(req);
        return sendResponse(res, await core.handle(toRequest(req, body)));
      }
      let p = decodeURIComponent(url.pathname);
      // Igual à Cloudflare (html_handling padrão): /index.html redireciona para /.
      if (p.endsWith('/index.html')) { res.writeHead(307, { Location: p.slice(0, -10) || '/' }); return res.end(); }
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(webDir, path.normalize(p));
      if (!file.startsWith(webDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('nao encontrado'); }
      res.writeHead(200, { ...staticHeaders, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      try { res.writeHead(500); res.end(); } catch {}
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const reject = (socket, status, code) => {
    socket.write(`HTTP/1.1 ${status} X\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{"error":"${code}"}`);
    socket.destroy();
  };

  server.on('upgrade', async (req, socket, head) => {
    try {
      const url = new URL(req.url, 'http://x');
      const request = toRequest(req, '');
      if (url.pathname === '/events') {
        const a = await core.authorizeSocket(request, { checkOrigin: true });
        if (a.response) return reject(socket, a.response.status, (await a.response.json()).error);
        wss.handleUpgrade(req, socket, head, (ws) => {
          ws.meta = { uid: a.uid, room: null };
          evSockets.add(ws);
          ws.on('message', (m) => core.onEventsMessage(ws, ws.meta, m.toString()));
          ws.on('close', () => { evSockets.delete(ws); core.onEventsClose(ws, ws.meta); });
          ws.on('error', () => {});
          core.onEventsOpen(ws, a.uid);
        });
        return;
      }
      if (url.pathname === '/ws') {
        if (!sameOrigin(request)) return reject(socket, 403, 'csrf');
        const room = url.searchParams.get('room') || '';
        if (!ROOM_ANY_RE.test(room)) return reject(socket, 400, 'invalid_input');
        const a = await core.authorizeSocket(request, { checkOrigin: false, room });
        if (a.response) return reject(socket, a.response.status, (await a.response.json()).error);
        const adm = roomLogic.admit(roomList(room), a.uid, { resume: url.searchParams.get('resume') === '1' });
        if (adm.error && adm.error.code === 'taken') { wss.handleUpgrade(req, socket, head, (ws) => ws.close(4000, 'substituido')); return; }
        if (adm.error) return reject(socket, adm.error.status, adm.error.code);
        wss.handleUpgrade(req, socket, head, (ws) => {
          ws.meta = { uid: a.uid, polite: adm.polite, ...roomLogic.initialMeta(adm, room) };
          let set = rooms.get(room); if (!set) rooms.set(room, (set = new Set()));
          set.add(ws);
          ws.on('message', (m, isBinary) => roomLogic.message(roomList(room), ws, isBinary ? null : m.toString()));
          ws.on('close', () => {
            set.delete(ws);
            if (!set.size) rooms.delete(room);
            roomLogic.closed([...set].map((w) => ({ ws: w, meta: w.meta })), ws, ws.meta);
          });
          ws.on('error', () => {});
          roomLogic.announce(ws, a.uid, adm);
        });
        return;
      }
      reject(socket, 404, 'not_found');
    } catch (e) { socket.destroy(); }
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      const p = server.address().port;
      resolve({
        port: p, url: `http://localhost:${p}`, db, core,
        close: () => new Promise((r) => {
          for (const ws of wss.clients) ws.terminate();
          server.close(() => r()); server.closeAllConnections?.();
        }),
      });
    });
  });
}

// Execução direta: node dev/server.js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const s = await startDevServer({
    port: Number(process.env.PORT || 8787),
    dbPath: process.env.DB || ':memory:',
    env: { MAX_ACCOUNTS: process.env.MAX_ACCOUNTS || '2', SIGNUP_CODE: process.env.SIGNUP_CODE || undefined },
  });
  console.log('Telinha (dev) em', s.url);
}
