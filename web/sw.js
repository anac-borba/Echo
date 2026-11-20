'use strict';
/* Echo · service worker.
   - Só guarda arquivos estáticos do próprio app (HTML, CSS, JS, ícones), numa pasta de cache com versão.
   - /api, /ws e /events (e qualquer outro endereço) vão sempre direto para a rede, sem cache.
   - Nunca guarda resposta que dependa de cookie (Set-Cookie, Vary: Cookie) nem pedidos com Range.
   IMPORTANTE: a cada publicação, troque VERSION abaixo. É isso que faz o aplicativo instalado pegar a versão nova. */
const VERSION = 'echo-2026-11-20-10';
const CACHE = VERSION;

const PRECACHE = [
  '/', '/manifest.webmanifest', '/theme.js',
  '/logo.svg', '/icon-m.svg', '/icon-192-m.png', '/icon-512-m.png', '/icon-maskable-512-m.png', '/apple-touch-icon-m.png', '/favicon-32-m.png',
  '/css/base.css', '/css/auth.css', '/css/app.css', '/css/shell.css', '/css/room.css', '/css/chat.css', '/css/games.css', '/css/themes.css', '/css/motion.css',
  '/js/main.js', '/js/state.js', '/js/util.js', '/js/api.js', '/js/i18n.js', '/js/modal.js', '/js/auth.js', '/js/pwa.js', '/js/passkey.js',
  '/js/ui.js', '/js/ft.js', '/js/desktop.js', '/js/remote.js', '/js/novidades.js', '/js/notify.js', '/js/dtln-core.js', '/js/mascot.js', '/js/settings.js', '/js/crop.js', '/js/call.js', '/js/audio.js', '/js/flags.js', '/js/activities.js', '/js/activities-i18n.js', '/js/chat.js', '/js/chat-i18n.js', '/js/emoji.js', '/js/sfx.js', '/js/room-extras.js', '/js/watch.js', '/css/g-watch.css', '/js/mixer.js', '/js/ringer.js', '/js/games-hub.js',
];

// Pastas do próprio app que podem ser guardadas quando aparecerem (jogos, worklets, fontes etc.).
const STATIC_DIR = /^\/(css|js|img|fonts|sfx)\/.+\.(css|js|mjs|json|wasm|svg|png|webp|woff2|mp3|ogg|m4a|bin)$|^\/[\w.-]+\.(svg|png|ico|webmanifest|css|js)$/;
const NEVER = /^\/(api|ws|events)(\/|$)/;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Arquivo que ainda não existe (ex.: css opcional) não pode impedir a instalação.
    await Promise.all(PRECACHE.map(async (u) => {
      try { const r = await fetch(new Request(u, { cache: 'reload', credentials: 'omit' })); if (cacheable(r)) await cache.put(u, await clean(r)); } catch {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Safari recusa abrir uma página se a resposta entregue pelo service worker veio de um redirecionamento.
// Por isso toda resposta guardada ou entregue é recriada "limpa" (mesmo corpo e cabeçalhos, sem a marca de redirect).
async function clean(r) {
  if (!r.redirected) return r;
  const body = await r.blob();
  return new Response(body, { status: r.status, statusText: r.statusText, headers: r.headers });
}

function cacheable(r) {
  if (!r || !r.ok || r.status !== 200 || r.type !== 'basic') return false;
  if (r.headers.has('set-cookie')) return false;
  const vary = r.headers.get('vary') || '';
  if (/cookie|\*/i.test(vary)) return false;
  return true;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER.test(url.pathname) || url.pathname === '/sw.js') return;          // rede direto

  const nav = req.mode === 'navigate';
  if (nav ? !(url.pathname === '/' || url.pathname === '/index.html') : !STATIC_DIR.test(url.pathname)) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Páginas: sempre a mesma página "/" (o app trata os endereços com # internamente).
    // Nunca usar /index.html: a Cloudflare redireciona esse endereço para "/".
    const key = nav ? '/' : new Request(url.pathname);
    const hit = await cache.match(key, { ignoreSearch: true });
    if (hit) return clean(hit);
    try {
      // Página: busca /index.html direto (sem passar por redirecionamento) e sem levar o modo "navigate".
      let r = await fetch(nav ? new Request('/', { credentials: 'same-origin', cache: 'no-cache' }) : req);
      r = await clean(r);
      if (cacheable(r)) cache.put(key, r.clone()).catch(() => {});
      return r;
    } catch (err) {
      if (nav) { const fb = await cache.match('/'); if (fb) return clean(fb); }
      throw err;
    }
  })());
});

/* ───────────── notificações (Web Push) ─────────────
   O conteúdo chega cifrado do servidor; aqui só mostramos. Tocar na notificação abre (ou traz para a frente)
   o Echo já na conversa ou na chamada. */
const PT = { once: 'Mensagem de visualização única', file: 'Enviou um arquivo', ring: 'Está te ligando… Toque para atender', msgs: '{n} mensagens novas' };
const EN = { once: 'View-once message', file: 'Sent a file', ring: 'Is calling you… Tap to answer', msgs: '{n} new messages' };
const L = () => ((self.navigator && /^en/i.test(self.navigator.language || '')) ? EN : PT);

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Echo', body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    // se o Echo estiver aberto e visível, o próprio app avisa (som e faixa); não duplica
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === 'visible' && w.focused)) return;
    const t = L();
    let body = d.body || '';
    if (d.kind === 'ring') body = t.ring;
    else if (body === 'once') body = t.once;
    else if (body === 'file') body = t.file;
    // várias mensagens da mesma pessoa viram uma notificação só, com a contagem
    const tag = d.tag || 'echo';
    if (d.kind === 'msg') {
      const prev = (await self.registration.getNotifications({ tag }))[0];
      const n = prev && prev.data && prev.data.n ? prev.data.n + 1 : 1;
      if (n > 1) body = `${body}\n${t.msgs.replace('{n}', n)}`;
      d.n = n;
    }
    await self.registration.showNotification(d.title || 'Echo', {
      body, tag, renotify: true, icon: '/icon-192-m.png', badge: '/favicon-32-m.png',
      requireInteraction: d.kind === 'ring', vibrate: d.kind === 'ring' ? [300, 150, 300, 150, 300] : [80],
      data: { kind: d.kind, from: d.from, n: d.n || 1 },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  const open = d.kind === 'msg' && d.from ? 'dm:' + d.from : d.kind === 'ring' ? 'ring' : '';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if ('focus' in w) { await w.focus(); w.postMessage({ t: 'open', open }); return; }
    }
    await self.clients.openWindow('/' + (open ? '?open=' + encodeURIComponent(open) : ''));
  })());
});
