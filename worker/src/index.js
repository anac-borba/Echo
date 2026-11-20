// Entrada do Worker da Telinha (Cloudflare).
//
//   /api/*   -> Durable Object "Hub" (contas, amigos, servidores)
//   /events  -> Hub (presença e avisos em tempo real)
//   /ws      -> confere permissão no Hub e entrega para o Durable Object "Room" (sinalização)
//   resto    -> arquivos estáticos da pasta web (servidos pela Cloudflare)
//
// Voz e vídeo NÃO passam por aqui: vão direto de um aparelho ao outro (WebRTC).

import { createCore, createRoomLogic, sameOrigin, ROOM_ANY_RE } from "./core.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });

const hub = (env) => env.HUB.get(env.HUB.idFromName("hub"));
function strip(request) {
  if (!request.headers.has("x-echo-internal")) return request;
  const h = new Headers(request.headers); h.delete("x-echo-internal");
  return new Request(request, { headers: h });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Cabeçalho interno nunca pode vir de fora (só o próprio Worker conversa com o Hub por /internal).
    if (url.pathname.startsWith("/api/")) return hub(env).fetch(strip(request));

    if (url.pathname === "/events") {
      if (request.headers.get("Upgrade") !== "websocket") return json({ error: "upgrade_required" }, 426);
      if (!sameOrigin(request)) return json({ error: "csrf" }, 403);
      return hub(env).fetch(strip(request));
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") return json({ error: "upgrade_required" }, 426);
      if (!sameOrigin(request)) return json({ error: "csrf" }, 403);
      const room = url.searchParams.get("room") || "";
      if (!ROOM_ANY_RE.test(room)) return json({ error: "invalid_input" }, 400);
      // pergunta ao Hub se esta pessoa pode entrar nesta sala
      const authz = await hub(env).fetch(
        new Request("https://hub/internal/authz?room=" + encodeURIComponent(room), {
          headers: { cookie: request.headers.get("cookie") || "", "x-echo-internal": "1" },
        })
      );
      if (!authz.ok) return new Response(authz.body, { status: authz.status, headers: authz.headers });
      const { uid } = await authz.json();
      const headers = new Headers(request.headers);
      headers.set("x-telinha-uid", uid); // só o Worker define isto; o Room confia
      headers.set("x-telinha-room", room);
      const stub = env.ROOM.get(env.ROOM.idFromName(room));
      return stub.fetch(new Request(request, { headers }));
    }

    return json({ error: "not_found" }, 404);
  },
};

/* ───────────── Hub: um único Durable Object com tudo que é "conta" ───────────── */
export class Hub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    const store = ctx.storage.sql;
    this.core = createCore({
      sql: {
        all: (q, ...p) => store.exec(q, ...p).toArray(),
        run: (q, ...p) => { store.exec(q, ...p); },
      },
      env,
      sockets: () => ctx.getWebSockets().map((ws) => ({ ws, meta: ws.deserializeAttachment() })),
      setMeta: (ws, meta) => ws.serializeAttachment(meta),
    });
  }

  async fetch(request) {
    const url = new URL(request.url);

    const internal = request.headers.get("x-echo-internal") === "1";
    if (url.pathname.startsWith("/internal/") && !internal) return json({ error: "not_found" }, 404);
    if (url.pathname === "/internal/calllog") {
      const b = await request.json().catch(() => null);
      if (b) this.core.recordCall(b.room, b.info);
      return json({ ok: true });
    }
    if (url.pathname === "/internal/authz") {
      const a = await this.core.authorizeSocket(request, { checkOrigin: false, room: url.searchParams.get("room") });
      return a.response || json({ uid: a.uid });
    }

    if (url.pathname === "/events") {
      if (request.headers.get("Upgrade") !== "websocket") return json({ error: "upgrade_required" }, 426);
      const a = await this.core.authorizeSocket(request, { checkOrigin: true });
      if (a.response) return a.response;
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server); // com hibernação: o Hub dorme quando ninguém está falando
      server.serializeAttachment({ uid: a.uid, room: null });
      this.core.onEventsOpen(server, a.uid);
      return new Response(null, { status: 101, webSocket: client });
    }

    return this.core.handle(request);
  }

  async webSocketMessage(ws, message) {
    this.core.onEventsMessage(ws, ws.deserializeAttachment(), message);
  }
  async webSocketClose(ws) {
    const meta = ws.deserializeAttachment();
    try { ws.close(1000, "tchau"); } catch {}
    this.core.onEventsClose(ws, meta);
  }
  async webSocketError(ws) {
    this.core.onEventsClose(ws, ws.deserializeAttachment());
  }
}

/* ───────────── Room: sinalização de uma sala (máx. 2 pessoas) ───────────── */
export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.logic = createRoomLogic({
      setMeta: (ws, meta) => ws.serializeAttachment(meta),
      // fim de chamada: o Hub grava a mensagem discreta na conversa
      onCallEnd: (room, info) => {
        this.ctx.waitUntil(hub(env).fetch(new Request("https://hub/internal/calllog", {
          method: "POST", headers: { "x-echo-internal": "1", "Content-Type": "application/json" }, body: JSON.stringify({ room, info }),
        })).catch(() => {}));
      },
    });
  }
  list() {
    return this.ctx.getWebSockets().map((ws) => ({ ws, meta: ws.deserializeAttachment() || {} }));
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Esperava WebSocket", { status: 426 });
    const uid = request.headers.get("x-telinha-uid") || "";
    const room = request.headers.get("x-telinha-room") || "";
    if (!/^[a-z2-7]{12}$/.test(uid) || !ROOM_ANY_RE.test(room)) return json({ error: "forbidden" }, 403);

    const resume = new URL(request.url).searchParams.get('resume') === '1';
    const adm = this.logic.admit(this.list(), uid, { resume });
    if (adm.error && adm.error.code === 'taken') {
      // aceita e fecha na hora com 4000: o app entende "a ligação continuou em outro lugar" e não tenta de novo
      const [c2, s2] = Object.values(new WebSocketPair());
      s2.accept(); s2.close(4000, 'substituido');
      return new Response(null, { status: 101, webSocket: c2 });
    }
    if (adm.error) return json({ error: adm.error.code }, adm.error.status);

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ uid, polite: adm.polite, ...this.logic.initialMeta(adm, room) });
    this.logic.announce(server, uid, adm);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    this.logic.message(this.list(), ws, message);
  }
  async webSocketClose(ws) {
    const meta = ws.deserializeAttachment();
    try { ws.close(1000, "tchau"); } catch {}
    this.logic.closed(this.list(), ws, meta);
  }
  async webSocketError(ws) {
    this.logic.closed(this.list(), ws, ws.deserializeAttachment());
  }
}
