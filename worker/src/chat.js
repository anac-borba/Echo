// Chat do Echo: mensagens diretas entre amigas, arquivos, visualização única, reações,
// "visto", "digitando…", GIFs (via GIPHY, passando pelo próprio servidor) e o registro das chamadas.
// Roda dentro do núcleo (createCore) e usa o mesmo SQLite do Hub.

export const CHAT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conv TEXT NOT NULL, author TEXT NOT NULL, kind TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '', meta TEXT, once INTEGER NOT NULL DEFAULT 0, opened_at INTEGER, reply_to TEXT,
    created_at INTEGER NOT NULL, edited_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS messages_conv ON messages(conv, created_at)`,
  `CREATE TABLE IF NOT EXISTS reads (conv TEXT NOT NULL, uid TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (conv, uid))`,
  `CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, owner TEXT NOT NULL, conv TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
    size INTEGER NOT NULL, chunks INTEGER NOT NULL, msg TEXT, once INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, purge_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS files_purge ON files(purge_at)`,
  `CREATE TABLE IF NOT EXISTS file_chunks (file TEXT NOT NULL, n INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (file, n))`,
  `CREATE TABLE IF NOT EXISTS pins (conv TEXT NOT NULL, msg TEXT NOT NULL, by TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (conv, msg))`,
  `CREATE TABLE IF NOT EXISTS sounds (id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, emoji TEXT NOT NULL, file TEXT NOT NULL, created_at INTEGER NOT NULL)`,
];

export const CHUNK = 1024 * 1024;              // 1 MB por pedaço (o SQLite do Durable Object aceita até 2 MB por linha)
const MAX_FILE = 100 * 1024 * 1024;            // 100 MB por arquivo
const MAX_FILES_PER_MSG = 10;
const MAX_TEXT = 4000;
const ONCE_WINDOW = 10 * 60 * 1000;            // depois de aberta, a mídia de visualização única fica 10 min e some
const ORPHAN_MS = 24 * 3600 * 1000;            // envio que nunca virou mensagem é apagado depois de 1 dia
const ID12 = /^[a-z2-7]{12}$/;
const ROOM_D = /^d:([a-z2-7]{12}):([a-z2-7]{12})$/;
// Tipos que podem abrir dentro do app. Qualquer outro vai como download (nunca é interpretado pelo navegador).
const INLINE = /^(image\/(jpeg|png|gif|webp|avif|heic|heif)|video\/(mp4|webm|quicktime)|audio\/(mp4|mpeg|ogg|webm|aac|wav|x-m4a|mp3))$/;
const GIPHY_MEDIA = /^https:\/\/(media[0-9]?|i)\.giphy\.com\/[A-Za-z0-9/._-]{1,300}$/;
const EMOJI_RE = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[‍️⃣#*0-9]|\p{Emoji_Modifier}){1,12}$/u;

export function installChat({ R, sql, one, push, friendIds, getUser, now, env, Err, bad, hit, newId, notifyPush = () => {} }) {
  for (const q of CHAT_SCHEMA) sql.run(q);

  const convOf = (a, b) => 'd:' + [a, b].sort().join(':');
  const otherOf = (conv, uid) => { const m = ROOM_D.exec(conv); return m ? (m[1] === uid ? m[2] : m[1]) : null; };
  const both = (conv) => { const m = ROOM_D.exec(conv); return m ? new Set([m[1], m[2]]) : new Set(); };
  const maxTotal = () => { const n = parseInt(env.CHAT_STORAGE_MB, 10); return (Number.isFinite(n) && n > 0 ? n : 3000) * 1024 * 1024; };
  const bytes = (x) => (x instanceof Uint8Array ? x : new Uint8Array(x));

  function friendConv(uid, other) {
    if (typeof other !== 'string' || !ID12.test(other) || other === uid || !friendIds(uid).has(other)) throw new Err(404, 'not_found');
    return convOf(uid, other);
  }
  function memberOfConv(uid, conv) { return both(conv).has(uid) && friendIds(uid).has(otherOf(conv, uid)); }

  /* ── limpeza: visualização única vencida e envios abandonados ── */
  let lastPurge = 0;
  function dropFile(id) { sql.run('DELETE FROM file_chunks WHERE file=?', id); sql.run('DELETE FROM files WHERE id=?', id); }
  function purge(force) {
    const t = now();
    if (!force && t - lastPurge < 30000) return;
    lastPurge = t;
    for (const f of sql.all('SELECT id FROM files WHERE (purge_at IS NOT NULL AND purge_at < ?) OR (msg IS NULL AND created_at < ?) LIMIT 50', t, t - ORPHAN_MS)) dropFile(f.id);
  }

  /* ── visão de uma mensagem ── */
  function fileView(f, extra) {
    const e = extra || {};
    return { id: f.id, name: f.name, type: f.type, size: f.size, w: e.w || null, h: e.h || null, dur: e.dur || null };
  }
  function view(row) {
    let meta = {};
    try { meta = row.meta ? JSON.parse(row.meta) : {}; } catch {}
    const files = (meta.files || []).map((x) => { const f = one('SELECT * FROM files WHERE id=?', x.id); return f ? fileView(f, x) : null; }).filter(Boolean);
    const m = {
      id: row.id, conv: row.conv, author: row.author, kind: row.kind, at: row.created_at, edited: row.edited_at || null,
      text: row.body, files, gif: meta.gif || null, call: meta.call || null, reactions: meta.reactions || {}, reply: null,
      once: !!row.once, opened: !!row.opened_at,
    };
    if (row.once) {
      // Conteúdo de visualização única nunca vai na lista: só o tipo, para mostrar "Foto", "Vídeo"...
      m.text = ''; m.gif = null;
      m.onceKind = files.length ? (files[0].type.split('/')[0] || 'file') : (row.body ? 'text' : (meta.gif ? 'image' : 'text'));
      m.files = [];
    }
    if (row.reply_to) {
      const r = one('SELECT id, author, kind, body, once, meta FROM messages WHERE id=?', row.reply_to);
      if (r) {
        let rm = {}; try { rm = r.meta ? JSON.parse(r.meta) : {}; } catch {}
        m.reply = { id: r.id, author: r.author, text: r.once ? '' : r.body.slice(0, 140), kind: r.kind, once: !!r.once, files: (rm.files || []).length, gif: !!rm.gif };
      }
    }
    return m;
  }
  /** Mensagens fixadas da conversa (mais recente primeiro, no máximo 20). */
  function pinsOf(conv) {
    return sql.all('SELECT p.msg, p.by, p.at, m.* FROM pins p JOIN messages m ON m.id = p.msg WHERE p.conv=? ORDER BY p.at DESC LIMIT 20', conv)
      .map((r) => ({ by: r.by, pinnedAt: r.at, m: view(r) }));
  }
  const getMsg = (id) => (typeof id === 'string' && ID12.test(id) ? one('SELECT * FROM messages WHERE id=?', id) : null);
  function ownMsg(c, id) {
    const row = getMsg(id);
    if (!row || !memberOfConv(c.user.id, row.conv)) throw new Err(404, 'not_found');
    return row;
  }

  /* ── conversas ── */
  R('GET', /^\/api\/convs$/, async (c) => {
    purge();
    const me = c.user.id;
    const out = [];
    for (const fid of friendIds(me)) {
      const conv = convOf(me, fid);
      const last = one('SELECT * FROM messages WHERE conv=? ORDER BY created_at DESC, id DESC LIMIT 1', conv);
      const mine = one('SELECT at FROM reads WHERE conv=? AND uid=?', conv, me);
      const theirs = one('SELECT at FROM reads WHERE conv=? AND uid=?', conv, fid);
      const unread = one('SELECT COUNT(*) AS n FROM messages WHERE conv=? AND author<>? AND kind<>? AND created_at > ?', conv, me, 'call', mine ? mine.at : 0).n;
      out.push({ with: fid, conv, last: last ? view(last) : null, unread, readAt: mine ? mine.at : 0, theirReadAt: theirs ? theirs.at : 0 });
    }
    out.sort((a, b) => (b.last ? b.last.at : 0) - (a.last ? a.last.at : 0));
    return [200, { convs: out }];
  });

  R('GET', /^\/api\/messages$/, async (c) => {
    purge();
    const conv = friendConv(c.user.id, c.url.searchParams.get('with'));
    const limit = Math.min(100, Math.max(1, parseInt(c.url.searchParams.get('limit') || '50', 10) || 50));
    const before = c.url.searchParams.get('before');
    let rows;
    if (before) {
      const [at, id] = before.split('_');
      const t = parseInt(at, 10);
      if (!Number.isFinite(t) || (id && !ID12.test(id))) throw bad();
      rows = sql.all('SELECT * FROM messages WHERE conv=? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?', conv, t, t, id || '', limit);
    } else rows = sql.all('SELECT * FROM messages WHERE conv=? ORDER BY created_at DESC, id DESC LIMIT ?', conv, limit);
    const other = otherOf(conv, c.user.id);
    const theirs = one('SELECT at FROM reads WHERE conv=? AND uid=?', conv, other);
    return [200, { messages: rows.reverse().map(view), more: rows.length === limit, theirReadAt: theirs ? theirs.at : 0, pins: before ? undefined : pinsOf(conv) }];
  });

  R('POST', /^\/api\/convs\/([a-z2-7]{12})\/read$/, async (c, m, b) => {
    const conv = friendConv(c.user.id, m[1]);
    const at = Math.min(now(), Math.max(0, Number(b.at) || now()));
    const prev = one('SELECT at FROM reads WHERE conv=? AND uid=?', conv, c.user.id);
    if (!prev || prev.at < at) {
      sql.run('INSERT INTO reads (conv, uid, at) VALUES (?,?,?) ON CONFLICT(conv, uid) DO UPDATE SET at=excluded.at', conv, c.user.id, at);
      push(both(conv), { t: 'read', conv, uid: c.user.id, at });
    }
    return [200, { ok: true }];
  });

  /* ── arquivos: criar, mandar pedaços, baixar (com Range, para vídeo) ── */
  R('POST', /^\/api\/files$/, async (c, _m, b) => {
    purge();
    const conv = friendConv(c.user.id, b.to);
    hit('file|' + c.user.id, 120, 3600 * 1000);
    const size = Number(b.size);
    if (!Number.isInteger(size) || size < 1) throw bad();
    if (size > MAX_FILE) throw new Err(413, 'file_too_big');
    const name = String(b.name || 'arquivo').replace(/[\u0000-\u001f\u007f/\\]/g, '_').slice(0, 120) || 'arquivo';
    let type = String(b.type || '').toLowerCase().slice(0, 100);
    if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type)) type = 'application/octet-stream';
    const used = one('SELECT COALESCE(SUM(size),0) AS s FROM files').s;
    if (used + size > maxTotal()) throw new Err(507, 'storage_full');
    const id = newId();
    sql.run('INSERT INTO files (id, owner, conv, name, type, size, chunks, once, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      id, c.user.id, conv, name, type, size, Math.ceil(size / CHUNK), b.once ? 1 : 0, now());
    return [201, { id, chunk: CHUNK, chunks: Math.ceil(size / CHUNK) }];
  });

  R('PUT', /^\/api\/files\/([a-z2-7]{12})\/(\d{1,4})$/, async (c, m) => {
    const f = one('SELECT * FROM files WHERE id=?', m[1]);
    if (!f || f.owner !== c.user.id || f.msg) throw new Err(404, 'not_found');
    const n = parseInt(m[2], 10);
    if (n >= f.chunks) throw bad();
    const expect = n === f.chunks - 1 ? f.size - CHUNK * (f.chunks - 1) : CHUNK;
    const len = parseInt(c.request.headers.get('content-length') || '0', 10);
    if (len && len !== expect) throw bad();
    const data = bytes(await c.request.arrayBuffer());
    if (data.length !== expect) throw bad();
    sql.run('INSERT OR REPLACE INTO file_chunks (file, n, data) VALUES (?,?,?)', f.id, n, data);
    return [200, { ok: true }];
  }, true, { raw: true });

  function canRead(uid, f) {
    if (!f || !memberOfConv(uid, f.conv)) return false;
    if (!f.msg) return f.owner === uid;
    if (!f.once) return true;
    // visualização única: só quem recebeu, só depois de abrir e só por 10 minutos
    const msg = one('SELECT author, opened_at FROM messages WHERE id=?', f.msg);
    return !!(msg && msg.author !== uid && msg.opened_at && f.purge_at && now() < f.purge_at);
  }

  R('GET', /^\/api\/files\/([a-z2-7]{12})$/, async (c, m) => {
    purge();
    const f = one('SELECT * FROM files WHERE id=?', m[1]);
    if (!canRead(c.user.id, f)) throw new Err(404, 'not_found');
    const inline = INLINE.test(f.type) && c.url.searchParams.get('dl') !== '1';
    const h = new Headers({
      'Content-Type': inline ? f.type : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin', 'Accept-Ranges': 'bytes',
      'Cache-Control': f.once ? 'no-store' : 'private, max-age=31536000, immutable',
    });
    let start = 0, end = f.size - 1, status = 200;
    const range = c.request.headers.get('range');
    if (range) {
      const rm = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!rm || (!rm[1] && !rm[2])) return { response: new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${f.size}` } }) };
      if (rm[1]) { start = parseInt(rm[1], 10); if (rm[2]) end = Math.min(end, parseInt(rm[2], 10)); }
      else { start = Math.max(0, f.size - parseInt(rm[2], 10)); }
      if (start > end || start >= f.size) return { response: new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${f.size}` } }) };
      status = 206; h.set('Content-Range', `bytes ${start}-${end}/${f.size}`);
    }
    h.set('Content-Length', String(end - start + 1));
    if (c.request.method === 'HEAD') return { response: new Response(null, { status, headers: h }) };
    const first = Math.floor(start / CHUNK), last = Math.floor(end / CHUNK);
    let n = first;
    const id = f.id;
    const body = new ReadableStream({
      pull(ctrl) {
        if (n > last) { ctrl.close(); return; }
        const row = one('SELECT data FROM file_chunks WHERE file=? AND n=?', id, n);
        if (!row) { ctrl.error(new Error('faltando')); return; }
        let d = bytes(row.data);
        const from = n === first ? start - n * CHUNK : 0;
        const to = n === last ? end - n * CHUNK + 1 : d.length;
        d = d.subarray(from, to);
        n++;
        ctrl.enqueue(d);
      },
    });
    return { response: new Response(body, { status, headers: h }) };
  });

  /* ── enviar, editar, apagar, reagir, abrir (visualização única) ── */
  function cleanGif(g) {
    if (!g || typeof g !== 'object') return null;
    const mp4 = typeof g.mp4 === 'string' && GIPHY_MEDIA.test(g.mp4) ? g.mp4 : null;
    const still = typeof g.still === 'string' && GIPHY_MEDIA.test(g.still) ? g.still : null;
    if (!mp4 && !still) throw bad();
    const w = Math.min(4000, Math.max(1, Number(g.w) || 200)), h = Math.min(4000, Math.max(1, Number(g.h) || 200));
    return { mp4, still, w, h, title: String(g.title || '').slice(0, 80) };
  }
  const num = (x, max) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Math.min(max, Math.round(Number(x) * 10) / 10) : null);

  R('POST', /^\/api\/messages$/, async (c, _m, b) => {
    const me = c.user.id;
    const conv = friendConv(me, b.to);
    hit('msg|' + me, 60, 60 * 1000);
    const text = typeof b.text === 'string' ? b.text.replace(/\r\n/g, '\n').slice(0, MAX_TEXT + 1) : '';
    if (text.length > MAX_TEXT) throw new Err(413, 'too_long');
    const gif = b.gif ? cleanGif(b.gif) : null;
    const want = Array.isArray(b.files) ? b.files.slice(0, MAX_FILES_PER_MSG + 1) : [];
    if (want.length > MAX_FILES_PER_MSG) throw bad();
    const files = [];
    for (const x of want) {
      const id = x && typeof x.id === 'string' ? x.id : '';
      const f = ID12.test(id) ? one('SELECT * FROM files WHERE id=?', id) : null;
      if (!f || f.owner !== me || f.conv !== conv || f.msg) throw new Err(400, 'bad_file');
      const have = one('SELECT COUNT(*) AS n FROM file_chunks WHERE file=?', id).n;
      if (have !== f.chunks) throw new Err(400, 'upload_incomplete');
      files.push({ id, w: num(x.w, 10000), h: num(x.h, 10000), dur: num(x.dur, 86400) });
    }
    if (!text.trim() && !gif && !files.length) throw bad();
    const once = b.once ? 1 : 0;
    if (once && files.length > 1) throw bad();
    let reply = null;
    if (b.reply) { const r = getMsg(b.reply); if (r && r.conv === conv) reply = r.id; }
    const id = newId();
    const t = now();
    const meta = {};
    if (files.length) meta.files = files;
    if (gif) meta.gif = gif;
    sql.run('INSERT INTO messages (id, conv, author, kind, body, meta, once, reply_to, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      id, conv, me, files.length ? 'file' : gif ? 'gif' : 'text', text, Object.keys(meta).length ? JSON.stringify(meta) : null, once, reply, t);
    for (const f of files) sql.run('UPDATE files SET msg=?, once=? WHERE id=?', id, once, f.id);
    // quem envia já "leu" até aqui
    sql.run('INSERT INTO reads (conv, uid, at) VALUES (?,?,?) ON CONFLICT(conv, uid) DO UPDATE SET at=MAX(at, excluded.at)', conv, me, t);
    const m = view(one('SELECT * FROM messages WHERE id=?', id));
    push(both(conv), { t: 'msg', m });
    // notificação no aparelho de quem recebe (só se o Echo não estiver aberto na frente)
    const author = getUser(me);
    const body = once ? 'once' : text ? text.replace(/\s+/g, ' ').slice(0, 140) : gif ? 'GIF' : files.length ? 'file' : '';
    notifyPush(otherOf(conv, me), { kind: 'msg', from: me, title: (author && (author.name || author.username)) || 'Echo', body, tag: 'dm-' + me });
    return [201, { message: m }];
  });

  R('PATCH', /^\/api\/messages\/([a-z2-7]{12})$/, async (c, m, b) => {
    const row = ownMsg(c, m[1]);
    if (row.author !== c.user.id || row.once || row.kind === 'call') throw new Err(403, 'forbidden');
    const text = typeof b.text === 'string' ? b.text.replace(/\r\n/g, '\n') : '';
    if (text.length > MAX_TEXT) throw new Err(413, 'too_long');
    if (!text.trim() && row.kind === 'text') throw bad();
    sql.run('UPDATE messages SET body=?, edited_at=? WHERE id=?', text, now(), row.id);
    const v = view(one('SELECT * FROM messages WHERE id=?', row.id));
    push(both(row.conv), { t: 'msg-up', m: v });
    return [200, { message: v }];
  });

  R('DELETE', /^\/api\/messages\/([a-z2-7]{12})$/, async (c, m) => {
    const row = ownMsg(c, m[1]);
    if (row.author !== c.user.id && row.kind !== 'call') throw new Err(403, 'forbidden');
    for (const f of sql.all('SELECT id FROM files WHERE msg=?', row.id)) dropFile(f.id);
    sql.run('DELETE FROM messages WHERE id=?', row.id);
    const hadPin = one('SELECT 1 AS x FROM pins WHERE msg=?', row.id);
    sql.run('DELETE FROM pins WHERE msg=?', row.id);
    push(both(row.conv), { t: 'msg-del', id: row.id, conv: row.conv });
    if (hadPin) push(both(row.conv), { t: 'msg-pins', conv: row.conv, pins: pinsOf(row.conv) });
    return [200, { ok: true }];
  });

  /* ── fixar mensagem (vale para as duas pessoas da conversa) ── */
  R('POST', /^\/api\/messages\/([a-z2-7]{12})\/pin$/, async (c, m, b) => {
    const row = ownMsg(c, m[1]);
    if (row.once || row.kind === 'call') throw bad();
    hit('pin|' + c.user.id, 60, 60 * 1000);
    if (b.on === false) sql.run('DELETE FROM pins WHERE conv=? AND msg=?', row.conv, row.id);
    else {
      if (one('SELECT COUNT(*) AS n FROM pins WHERE conv=?', row.conv).n >= 20 && !one('SELECT 1 AS x FROM pins WHERE msg=?', row.id)) throw new Err(400, 'too_many_pins');
      sql.run('INSERT INTO pins (conv, msg, by, at) VALUES (?,?,?,?) ON CONFLICT(conv, msg) DO UPDATE SET by=excluded.by, at=excluded.at', row.conv, row.id, c.user.id, now());
    }
    const pins = pinsOf(row.conv);
    push(both(row.conv), { t: 'msg-pins', conv: row.conv, pins });
    return [200, { pins }];
  });

  R('POST', /^\/api\/messages\/([a-z2-7]{12})\/react$/, async (c, m, b) => {
    const row = ownMsg(c, m[1]);
    const e = typeof b.emoji === 'string' ? b.emoji.trim() : '';
    if (!e || e.length > 24 || !EMOJI_RE.test(e)) throw bad();
    hit('react|' + c.user.id, 120, 60 * 1000);
    let meta = {}; try { meta = row.meta ? JSON.parse(row.meta) : {}; } catch {}
    const rx = meta.reactions || {};
    const list = new Set(rx[e] || []);
    if (list.has(c.user.id)) list.delete(c.user.id); else {
      if (!rx[e] && Object.keys(rx).length >= 20) throw bad();
      list.add(c.user.id);
    }
    if (list.size) rx[e] = [...list]; else delete rx[e];
    meta.reactions = rx;
    sql.run('UPDATE messages SET meta=? WHERE id=?', JSON.stringify(meta), row.id);
    const v = view(one('SELECT * FROM messages WHERE id=?', row.id));
    push(both(row.conv), { t: 'msg-up', m: v });
    return [200, { message: v }];
  });

  R('POST', /^\/api\/messages\/([a-z2-7]{12})\/open$/, async (c, m) => {
    const row = ownMsg(c, m[1]);
    if (!row.once) throw bad();
    if (row.author === c.user.id) throw new Err(403, 'forbidden');
    if (row.opened_at) throw new Err(410, 'gone');
    const t = now();
    let meta = {}; try { meta = row.meta ? JSON.parse(row.meta) : {}; } catch {}
    const files = (meta.files || []).map((x) => { const f = one('SELECT * FROM files WHERE id=?', x.id); return f ? fileView(f, x) : null; }).filter(Boolean);
    const content = { text: row.body, gif: meta.gif || null, files };
    // o texto some do banco na hora; a mídia fica 10 minutos para carregar e depois é apagada
    sql.run('UPDATE messages SET opened_at=?, body=?, meta=? WHERE id=?', t, '', JSON.stringify({ files: meta.files || [], reactions: meta.reactions || {} }), row.id);
    sql.run('UPDATE files SET purge_at=? WHERE msg=?', t + ONCE_WINDOW, row.id);
    const v = view(one('SELECT * FROM messages WHERE id=?', row.id));
    push(both(row.conv), { t: 'msg-up', m: v });
    return [200, { content, message: v }];
  });

  /* ── GIFs (GIPHY), com a busca e as imagens passando pelo próprio Echo ── */
  R('GET', /^\/api\/gifs$/, async (c) => {
    if (!env.GIPHY_KEY) throw new Err(501, 'gifs_off');
    hit('gif|' + c.user.id, 120, 60 * 1000);
    const q = (c.url.searchParams.get('q') || '').slice(0, 80);
    const offset = Math.min(500, Math.max(0, parseInt(c.url.searchParams.get('offset') || '0', 10) || 0));
    const u = new URL(q ? 'https://api.giphy.com/v1/gifs/search' : 'https://api.giphy.com/v1/gifs/trending');
    u.searchParams.set('api_key', env.GIPHY_KEY); u.searchParams.set('limit', '24'); u.searchParams.set('offset', String(offset));
    u.searchParams.set('rating', 'pg-13'); u.searchParams.set('bundle', 'messaging_non_clips');
    if (q) { u.searchParams.set('q', q); u.searchParams.set('lang', 'pt'); }
    let data;
    try { const r = await fetch(u.toString()); if (!r.ok) throw new Error(String(r.status)); data = await r.json(); } catch { throw new Err(502, 'gifs_down'); }
    const out = [];
    for (const g of (data && data.data) || []) {
      const im = g.images || {};
      const mp4 = im.fixed_width && im.fixed_width.mp4 ? im.fixed_width.mp4 : im.original && im.original.mp4;
      const still = im.fixed_width_still && im.fixed_width_still.url;
      const w = Number((im.fixed_width || {}).width) || 200, h = Number((im.fixed_width || {}).height) || 200;
      const clean = (s) => (typeof s === 'string' ? s.split('?')[0] : null);
      const item = { id: String(g.id || ''), title: String(g.title || '').slice(0, 80), mp4: clean(mp4), still: clean(still), w, h };
      if ((item.mp4 && GIPHY_MEDIA.test(item.mp4)) || (item.still && GIPHY_MEDIA.test(item.still))) out.push(item);
    }
    return [200, { gifs: out, next: offset + out.length }];
  });

  R('GET', /^\/api\/gif-media$/, async (c) => {
    const target = c.url.searchParams.get('u') || '';
    if (!GIPHY_MEDIA.test(target)) throw bad();
    hit('gifm|' + c.user.id, 600, 60 * 1000);
    let r;
    try { r = await fetch(target, { redirect: 'error' }); } catch { throw new Err(502, 'gifs_down'); }
    const type = (r.headers.get('content-type') || '').split(';')[0];
    if (!r.ok || !/^(image\/(gif|webp|png|jpeg)|video\/mp4)$/.test(type)) throw new Err(502, 'gifs_down');
    return { response: new Response(r.body, { status: 200, headers: {
      'Content-Type': type, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'same-origin',
    } }) };
  });

  /* ── efeitos sonoros próprios (soundboard) ── */
  R('GET', /^\/api\/sounds$/, async (c) => {
    const ids = [c.user.id, ...friendIds(c.user.id)];
    const rows = sql.all(`SELECT * FROM sounds WHERE owner IN (${ids.map(() => '?').join(',')}) ORDER BY created_at`, ...ids);
    return [200, { sounds: rows.map((s) => ({ id: s.id, owner: s.owner, name: s.name, emoji: s.emoji, file: s.file })) }];
  });
  R('POST', /^\/api\/sounds$/, async (c, _m, b) => {
    const f = typeof b.file === 'string' && ID12.test(b.file) ? one('SELECT * FROM files WHERE id=?', b.file) : null;
    if (!f || f.owner !== c.user.id || f.msg || !/^audio\//.test(f.type) || f.size > 1024 * 1024) throw new Err(400, 'bad_file');
    if (one('SELECT COUNT(*) AS n FROM file_chunks WHERE file=?', f.id).n !== f.chunks) throw new Err(400, 'upload_incomplete');
    if (one('SELECT COUNT(*) AS n FROM sounds WHERE owner=?', c.user.id).n >= 24) throw new Err(403, 'too_many');
    const name = String(b.name || '').trim().slice(0, 24) || 'Som';
    const emoji = typeof b.emoji === 'string' && EMOJI_RE.test(b.emoji) ? b.emoji : '🔊';
    const id = newId();
    sql.run('INSERT INTO sounds (id, owner, name, emoji, file, created_at) VALUES (?,?,?,?,?,?)', id, c.user.id, name, emoji, f.id, now());
    sql.run('UPDATE files SET msg=? WHERE id=?', 'sound:' + id, f.id);
    return [201, { sound: { id, owner: c.user.id, name, emoji, file: f.id } }];
  });
  R('DELETE', /^\/api\/sounds\/([a-z2-7]{12})$/, async (c, m) => {
    const s = one('SELECT * FROM sounds WHERE id=?', m[1]);
    if (!s || s.owner !== c.user.id) throw new Err(404, 'not_found');
    dropFile(s.file); sql.run('DELETE FROM sounds WHERE id=?', s.id);
    return [200, { ok: true }];
  });

  /* ── chamadas: registro discreto na conversa ── */
  function recordCall(room, info) {
    const mm = ROOM_D.exec(room || '');
    if (!mm || !info) return null;
    const [a, b] = [mm[1], mm[2]];
    if (!getUser(a) || !getUser(b)) return null;
    const by = info.by === a || info.by === b ? info.by : null;
    const start = Number(info.start) || 0, end = Number(info.end) || now();
    const call = info.missed
      ? { missed: true, caller: by }
      : { dur: Math.max(0, Math.round((end - start) / 1000)), by, start, end };
    const id = newId();
    sql.run('INSERT INTO messages (id, conv, author, kind, body, meta, created_at) VALUES (?,?,?,?,?,?,?)', id, room, by || a, 'call', '', JSON.stringify({ call }), end);
    const m = view(one('SELECT * FROM messages WHERE id=?', id));
    push(new Set([a, b]), { t: 'msg', m });
    return m;
  }

  /* ── "digitando…" (pelo /events) ── */
  const typingAt = new Map();
  function typing(uid, to) {
    if (typeof to !== 'string' || !ID12.test(to) || !friendIds(uid).has(to)) return;
    const k = uid + '>' + to, t = now();
    if (t - (typingAt.get(k) || 0) < 1500) return;
    typingAt.set(k, t);
    if (typingAt.size > 200) typingAt.clear();
    push(new Set([to]), { t: 'typing', from: uid, conv: convOf(uid, to) });
  }

  return { recordCall, typing, purge };
}
