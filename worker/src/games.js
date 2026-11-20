// Jogos: convites, repasse das jogadas entre amigos (dentro ou fora da ligação) e histórico de vencedores.
// O servidor não roda os jogos: só confere que as duas pessoas são amigas, limita o volume e repassa.
// O histórico é gravado pelo anfitrião da partida (quem convidou); cada partida tem um id próprio.

export const GAMES = ['tetris', 'uno', 'stop', 'velha', 'lig4', 'termo', 'xadrez', 'ludo', 'naval', 'desenho', 'quem'];
export const GAMES_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS bests (uid TEXT NOT NULL, game TEXT NOT NULL, score INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (uid, game))`,
  `CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, sid TEXT NOT NULL, game TEXT NOT NULL, host TEXT NOT NULL, guest TEXT NOT NULL,
    winner TEXT NOT NULL, score TEXT, at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS matches_host ON matches (host, at)`,
  `CREATE INDEX IF NOT EXISTS matches_guest ON matches (guest, at)`,
];
const SID_RE = /^[a-z0-9]{10,24}$/;
const MID_RE = /^[a-z0-9]{1,12}$/;
const KINDS = new Set(['invite', 'accept', 'decline', 'cancel', 'msg', 'leave']);

export function installGames({ R, sql, one, push, friendIds, now, Err, hit, newId }) {
  for (const q of GAMES_SCHEMA) sql.run(q);

  /** Mensagem ao vivo (pelo canal de eventos): repassa para a amiga. Devolve um erro curto ou null. */
  function relay(uid, m, rawLen) {
    const to = typeof m.to === 'string' && /^[a-z2-7]{12}$/.test(m.to) ? m.to : null;
    const k = KINDS.has(m.k) ? m.k : null;
    const sid = typeof m.sid === 'string' && SID_RE.test(m.sid) ? m.sid : null;
    if (!to || !k || !sid) return 'bad_request';
    if (!friendIds(uid).has(to)) return 'forbidden';
    if (k === 'invite' && !GAMES.includes(m.game)) return 'bad_request';
    if (rawLen > 60000) return 'too_large';
    try {
      if (k === 'invite') hit(`ginv|${uid}`, 20, 60000);
      else hit(`gmsg|${uid}`, 1200, 60000);      // tetris manda ~10/s
    } catch { return 'rate_limited'; }
    const out = { t: 'g', from: uid, k, sid };
    if (k === 'invite') {
      out.game = m.game;
      // regras escolhidas por quem convida: só valores simples e curtos
      if (m.opts && typeof m.opts === 'object' && !Array.isArray(m.opts)) {
        const o = {};
        for (const [key, v] of Object.entries(m.opts).slice(0, 10)) {
          if (!/^[a-z]{1,12}$/i.test(key)) continue;
          if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 16)) o[key] = v;
        }
        if (Object.keys(o).length) out.opts = o;
      }
    }
    if (k === 'msg') out.m = m.m;
    push(new Set([to]), out);
    return null;
  }

  /* ── histórico ── */
  R('POST', /^\/api\/games\/result$/, async (c, _m, b) => {
    const me = c.user.id;
    const sid = typeof b.sid === 'string' && SID_RE.test(b.sid) ? b.sid : null;
    const mid = typeof b.mid === 'string' && MID_RE.test(b.mid) ? b.mid : '1';
    const game = GAMES.includes(b.game) ? b.game : null;
    const opp = typeof b.opp === 'string' ? b.opp : null;
    if (!sid || !game || !opp || !friendIds(me).has(opp)) throw new Err(400, 'bad_request');
    hit(`gres|${me}`, 120, 60000);
    const winner = b.winner === 'host' ? me : b.winner === 'guest' ? opp : '';
    const score = Array.isArray(b.score) && b.score.length === 2 && b.score.every((n) => Number.isFinite(n)) ? JSON.stringify(b.score.map((n) => Math.round(n))) : null;
    const id = sid + '.' + mid;
    sql.run(`INSERT INTO matches (id, sid, game, host, guest, winner, score, at) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET winner=excluded.winner, score=excluded.score, at=excluded.at`, id, sid, game, me, opp, winner, score, now());
    const row = one('SELECT * FROM matches WHERE id=?', id);
    push(new Set([me, opp]), { t: 'match', match: view(row, null) });
    return [200, { ok: true }];
  });

  R('GET', /^\/api\/games\/history$/, async (c) => {
    const me = c.user.id;
    const rows = sql.all('SELECT * FROM matches WHERE host=? OR guest=? ORDER BY at DESC LIMIT 60', me, me);
    // placar por amiga e por jogo (todas as partidas, não só as 60 últimas)
    const agg = sql.all(`SELECT game, CASE WHEN host=? THEN guest ELSE host END AS opp,
        SUM(CASE WHEN winner=? THEN 1 ELSE 0 END) AS w, SUM(CASE WHEN winner<>? AND winner<>'' THEN 1 ELSE 0 END) AS l,
        SUM(CASE WHEN winner='' THEN 1 ELSE 0 END) AS d, COUNT(*) AS n, MAX(at) AS last
      FROM matches WHERE host=? OR guest=? GROUP BY game, opp`, me, me, me, me, me);
    return [200, { matches: rows.map((r) => view(r, me)), stats: agg.map((a) => ({ game: a.game, opp: a.opp, w: a.w, l: a.l, d: a.d, n: a.n, last: a.last })) }];
  });

  /* ── vitórias de uma pessoa por jogo (perfil, estilo Plato) ── */
  // Recordes solo (Tetris): guarda só o melhor de cada pessoa; o placar mostra você e seus amigos
  const BEST_GAMES = new Set(['tetris']);
  R('POST', /^\/api\/games\/best$/, async (c, _m, b) => {
    const game = BEST_GAMES.has(b.game) ? b.game : null;
    const score = Number.isInteger(b.score) && b.score > 0 && b.score <= 50_000_000 ? b.score : null;
    if (!game || !score) throw new Err(400, 'bad_request');
    hit('best|' + c.user.id, 60, 3600 * 1000);
    sql.run('INSERT INTO bests (uid, game, score, at) VALUES (?,?,?,?) ON CONFLICT(uid, game) DO UPDATE SET score=MAX(score, excluded.score), at=CASE WHEN excluded.score > score THEN excluded.at ELSE at END',
      c.user.id, game, score, now());
    return [200, { best: one('SELECT score FROM bests WHERE uid=? AND game=?', c.user.id, game).score }];
  });
  R('GET', /^\/api\/games\/best\/([a-z]{2,12})$/, async (c, m) => {
    const game = BEST_GAMES.has(m[1]) ? m[1] : null; if (!game) throw new Err(404, 'not_found');
    const ids = [c.user.id, ...friendIds(c.user.id)];
    const rows = sql.all(`SELECT uid, score FROM bests WHERE game=? AND uid IN (${ids.map(() => '?').join(',')}) ORDER BY score DESC LIMIT 20`, game, ...ids);
    return [200, { rows: rows.map((r) => ({ uid: r.uid, score: r.score })) }];
  });
  R('GET', /^\/api\/games\/stats\/([a-z2-7]{12})$/, async (c, m) => {
    const me = c.user.id, who = m[1];
    if (who !== me && !friendIds(me).has(who)) throw new Err(404, 'not_found');
    const rows = sql.all(`SELECT game, SUM(CASE WHEN winner=? THEN 1 ELSE 0 END) AS w, COUNT(*) AS n,
        SUM(CASE WHEN winner=? AND (host=? OR guest=?) THEN 1 ELSE 0 END) AS wvs, SUM(CASE WHEN winner=? THEN 1 ELSE 0 END) AS lvs,
        SUM(CASE WHEN (host=? OR guest=?) THEN 1 ELSE 0 END) AS nvs
      FROM matches WHERE host=? OR guest=? GROUP BY game`, who, who, me, me, me, me, me, who, who);
    // wvs/nvs: vitórias dela contra você e partidas entre vocês duas
    // atividade: a última partida dela (só jogo e hora) e as últimas entre vocês duas
    const lastRow = one('SELECT game, at FROM matches WHERE host=? OR guest=? ORDER BY at DESC LIMIT 1', who, who);
    const recent = who === me
      ? sql.all('SELECT * FROM matches WHERE host=? OR guest=? ORDER BY at DESC LIMIT 8', me, me)
      : sql.all('SELECT * FROM matches WHERE (host=? AND guest=?) OR (host=? AND guest=?) ORDER BY at DESC LIMIT 8', me, who, who, me);
    return [200, { stats: rows.map((r) => ({ game: r.game, wins: r.w, played: r.n, winsVsMe: who === me ? null : r.wvs, myWins: who === me ? null : r.lvs, vsMe: who === me ? null : r.nvs })),
      last: lastRow ? { game: lastRow.game, at: lastRow.at } : null, recent: recent.map((r) => view(r, me)) }];
  });

  function view(r, _me) {
    let score = null; try { score = r.score ? JSON.parse(r.score) : null; } catch {}
    return { id: r.id, game: r.game, host: r.host, guest: r.guest, winner: r.winner || null, score, at: r.at };
  }

  return { relay };
}
