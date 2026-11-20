'use strict';
// Xadrez completo: roque, en passant, promoção, xeque, xeque-mate, afogamento e empate por material.
// Brancas = quem começa (alterna a cada partida). O tabuleiro vira para quem joga de pretas.
import { el, avatar } from '../util.js';
import { hosted, makeTr, endBox, waitingPeer, kt, firstSeat, think, rand } from './kit.js';

const tr = makeTr({
  pt: { white: 'Brancas', black: 'Pretas', check: 'Xeque!', mate: 'Xeque-mate!', stalemate: 'Afogamento: empate', material: 'Empate por falta de peças', agreed: 'Empate combinado',
    resigned: '{name} desistiu', youResigned: 'Você desistiu', win: 'Você venceu!', lose: '{name} venceu', draw: 'Empate', resign: 'Desistir', resignQ: 'Tem certeza? Toque de novo para desistir.',
    offer: 'Propor empate', offered: 'Empate proposto', accept: 'Aceitar empate', promo: 'Promover para', sq: '{f}{r}', wins: 'Vitórias', yourMove: 'Sua vez', thinking: 'Pensando…' },
  en: { white: 'White', black: 'Black', check: 'Check!', mate: 'Checkmate!', stalemate: 'Stalemate: draw', material: 'Draw: insufficient material', agreed: 'Draw agreed',
    resigned: '{name} resigned', youResigned: 'You resigned', win: 'You won!', lose: '{name} won', draw: 'Draw', resign: 'Resign', resignQ: 'Sure? Tap again to resign.',
    offer: 'Offer draw', offered: 'Draw offered', accept: 'Accept draw', promo: 'Promote to', sq: '{f}{r}', wins: 'Wins', yourMove: 'Your move', thinking: 'Thinking…' },
});

/* ───────────── regras ───────────── */
const START = 'rnbqkbnrpppppppp' + '.'.repeat(32) + 'PPPPPPPPRNBQKBNR';
const col = (p) => (p === '.' ? null : p === p.toUpperCase() ? 'w' : 'b');
const rc = (i) => [i >> 3, i & 7];
const at = (r, c) => (r >= 0 && r < 8 && c >= 0 && c < 8 ? r * 8 + c : -1);
const KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KG = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]], ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function attacked(b, sq, by) {
  const [r, c] = rc(sq);
  const isBy = (i, set) => i >= 0 && b[i] !== '.' && col(b[i]) === by && set.includes(b[i].toLowerCase());
  const pd = by === 'w' ? 1 : -1;   // peão branco ataca "para cima" (r-1), então vem de r+1
  if (isBy(at(r + pd, c - 1), 'p') || isBy(at(r + pd, c + 1), 'p')) return true;
  for (const [dr, dc] of KN) if (isBy(at(r + dr, c + dc), 'n')) return true;
  for (const [dr, dc] of KG) if (isBy(at(r + dr, c + dc), 'k')) return true;
  for (const [dirs, set] of [[DIAG, 'bq'], [ORTH, 'rq']]) for (const [dr, dc] of dirs) {
    let rr = r + dr, cc = c + dc;
    while (at(rr, cc) >= 0) { const i = at(rr, cc); if (b[i] !== '.') { if (isBy(i, set)) return true; break; } rr += dr; cc += dc; }
  }
  return false;
}
function pseudo(G, from) {
  const b = G.b, p = b[from], me = col(p); if (!me) return [];
  const [r, c] = rc(from), out = [];
  const add = (to, extra = {}) => out.push({ f: from, t: to, ...extra });
  const kind = p.toLowerCase();
  if (kind === 'p') {
    const d = me === 'w' ? -1 : 1, startR = me === 'w' ? 6 : 1, lastR = me === 'w' ? 0 : 7;
    const one = at(r + d, c);
    if (one >= 0 && b[one] === '.') {
      add(one, r + d === lastR ? { promo: true } : {});
      const two = at(r + 2 * d, c);
      if (r === startR && b[two] === '.') add(two, { dbl: true });
    }
    for (const dc of [-1, 1]) {
      const t = at(r + d, c + dc); if (t < 0) continue;
      if (b[t] !== '.' && col(b[t]) !== me) add(t, r + d === lastR ? { promo: true } : {});
      else if (t === G.ep) add(t, { ep: true });
    }
  } else if (kind === 'n' || kind === 'k') {
    for (const [dr, dc] of kind === 'n' ? KN : KG) { const t = at(r + dr, c + dc); if (t >= 0 && col(b[t]) !== me) add(t); }
    if (kind === 'k') {
      const home = me === 'w' ? 60 : 4, enemy = me === 'w' ? 'b' : 'w';
      if (from === home && !attacked(b, from, enemy)) {
        if (G.cr[me + 'K'] && b[home + 1] === '.' && b[home + 2] === '.' && !attacked(b, home + 1, enemy) && !attacked(b, home + 2, enemy)) add(home + 2, { castle: 'K' });
        if (G.cr[me + 'Q'] && b[home - 1] === '.' && b[home - 2] === '.' && b[home - 3] === '.' && !attacked(b, home - 1, enemy) && !attacked(b, home - 2, enemy)) add(home - 2, { castle: 'Q' });
      }
    }
  } else {
    const dirs = kind === 'b' ? DIAG : kind === 'r' ? ORTH : [...DIAG, ...ORTH];
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (at(rr, cc) >= 0) { const t = at(rr, cc); if (b[t] === '.') add(t); else { if (col(b[t]) !== me) add(t); break; } rr += dr; cc += dc; }
    }
  }
  return out;
}
function apply(G, m, promoTo = 'q') {
  const b = G.b.split(''), p = b[m.f], me = col(p);
  const cap = m.ep ? b[m.t + (me === 'w' ? 8 : -8)] : b[m.t];
  b[m.t] = p; b[m.f] = '.';
  if (m.ep) b[m.t + (me === 'w' ? 8 : -8)] = '.';
  if (m.promo) b[m.t] = me === 'w' ? promoTo.toUpperCase() : promoTo.toLowerCase();
  if (m.castle === 'K') { b[m.t - 1] = b[m.t + 1]; b[m.t + 1] = '.'; }
  if (m.castle === 'Q') { b[m.t + 1] = b[m.t - 2]; b[m.t - 2] = '.'; }
  const cr = { ...G.cr };
  if (p === 'K') cr.wK = cr.wQ = false; if (p === 'k') cr.bK = cr.bQ = false;
  for (const [sq, k] of [[63, 'wK'], [56, 'wQ'], [7, 'bK'], [0, 'bQ']]) if (m.f === sq || m.t === sq) cr[k] = false;
  return { b: b.join(''), turn: me === 'w' ? 'b' : 'w', cr, ep: m.dbl ? (m.f + m.t) / 2 : -1, cap: cap !== '.' ? cap : null };
}
function legal(G, from) {
  const me = col(G.b[from]); if (me !== G.turn) return [];
  return pseudo(G, from).filter((m) => { const n = apply(G, m); return !attacked(n.b, n.b.indexOf(me === 'w' ? 'K' : 'k'), me === 'w' ? 'b' : 'w'); });
}
const allLegal = (G) => { const out = []; for (let i = 0; i < 64; i++) if (col(G.b[i]) === G.turn) out.push(...legal(G, i)); return out; };
const inCheck = (G) => attacked(G.b, G.b.indexOf(G.turn === 'w' ? 'K' : 'k'), G.turn === 'w' ? 'b' : 'w');
function lowMaterial(b) {
  const rest = b.replace(/[.kK]/g, '');
  return rest === '' || /^[nNbB]$/.test(rest);
}
// Peças desenhadas aqui (silhuetas próprias, viewBox 45×45). Cor e contorno vêm do tema (variáveis CSS).
const PIECE = {
  p: 'M22.5 8.5a5.2 5.2 0 0 0-3.3 9.2 7 7 0 0 0-3.4 6c0 2.2.9 4.1 2.5 5.4-3.5 1.4-6 4.8-6.5 9.4h21.4c-.5-4.6-3-8-6.5-9.4a6.9 6.9 0 0 0 2.5-5.4 7 7 0 0 0-3.4-6 5.2 5.2 0 0 0-3.3-9.2z',
  r: 'M11.5 38.5h22v-3.5h-22zM14 35l1.6-14.5h13.8L31 35zM12.5 17V9.5h4.2V12h3.7V9.5h4.2V12h3.7V9.5h4.2V17l-3.3 3.5H15.8z',
  b: 'M22.5 5.5a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2zM22.5 11.5c-5.2 4-8.3 8.8-8.3 13.2 0 3.4 2.3 5.6 4.7 6.6h7.2c2.4-1 4.7-3.2 4.7-6.6 0-4.4-3.1-9.2-8.3-13.2zM14.5 32.8h16v2.8h-16zM11.5 36.6h22v3h-22z',
  n: 'M24.3 8.7c-3.2-.3-5.6 1-7.6 3.2l-4.2 4.8c-1.3 1.5-2.2 3.1-2.2 5 0 1.7 1.6 2.7 3.2 2.2l4.3-1.4c1-.3 2 .3 2 1.3 0 2.1-3 4.4-5 7.4-1.2 1.8-1.6 3.8-1.6 6.3h21.6c.1-8.4 1-14.6-1.9-20.8-1.6-3.3-4.6-7.6-8.6-8z',
  q: 'M9.5 14.5l4.4 16.3h17.2l4.4-16.3-6.4 7.4-3.1-10.4-3.5 10-3.5-10-3.1 10.4zM13.6 32.3h17.8v3h-17.8zM11.5 36.8h22v3h-22z',
  k: 'M21 3.8h3v3.8h3.8v3h-3.8v3.6h-3v-3.6h-3.8v-3h3.8zM13.9 31c-2.6-4.7-3.6-10.4-.4-13.1 3-2.4 6.6-.4 9 3.1 2.4-3.5 6-5.5 9-3.1 3.2 2.7 2.2 8.4-.4 13.1zM13.4 32.3h18.2v3H13.4zM11.5 36.8h22v3h-22z',
};
const DETAIL = { b: 'M22.5 17.5v6M19.5 20.5h6', n: 'M19 15.3a1.3 1.3 0 1 0 0 .1', q: '', k: '', p: '', r: 'M15.5 24h14' };
const SVGNS = 'http://www.w3.org/2000/svg';
const LETTER = { k: 'R', q: 'D', r: 'T', b: 'B', n: 'C', p: 'P' };
function cupSvg() {
  const s = document.createElementNS(SVGNS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'cx-cup'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', 'M7 3h10v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.9V17h3v3H8v-3h3v-2.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V5h3zm0 4H6v1a2 2 0 0 0 1.2 1.8A5 5 0 0 1 7 8zm10 0v1a5 5 0 0 1-.2 1.8A2 2 0 0 0 18 8V7z');
  s.append(p); return s;
}
function piece(p, extra = '') {
  const kind = p.toLowerCase(), c = p === kind ? 'b' : 'w';
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 45 45'); s.setAttribute('class', `cx-pc ${c} k-${kind} ${extra}`); s.setAttribute('aria-hidden', 'true');
  const body = document.createElementNS(SVGNS, 'path'); body.setAttribute('d', PIECE[kind]); body.setAttribute('class', 'cx-body'); s.append(body);
  if (DETAIL[kind]) { const d = document.createElementNS(SVGNS, 'path'); d.setAttribute('d', DETAIL[kind]); d.setAttribute('class', 'cx-det'); s.append(d); }
  // conjunto "fichas": disco com a letra da peça (só aparece nesse tema)
  const disc = document.createElementNS(SVGNS, 'circle'); disc.setAttribute('cx', '22.5'); disc.setAttribute('cy', '22.5'); disc.setAttribute('r', '17'); disc.setAttribute('class', 'cx-disc'); s.append(disc);
  const tx = document.createElementNS(SVGNS, 'text'); tx.setAttribute('x', '22.5'); tx.setAttribute('y', '23'); tx.setAttribute('class', 'cx-let'); tx.textContent = LETTER[kind]; s.append(tx);
  return s;
}
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
/* computador: negamax com poda alfa-beta; material + centro + avanço dos peões */
const CENTER = Array.from({ length: 64 }, (_, i) => { const [r, c] = rc(i); return 3.5 - Math.max(Math.abs(r - 3.5), Math.abs(c - 3.5)); });
function evalFor(b, me) {
  let s = 0;
  for (let i = 0; i < 64; i++) {
    const p = b[i]; if (p === '.') continue;
    const k = p.toLowerCase(), c = col(p);
    let v = VAL[k] * 100;
    if (k === 'n' || k === 'b') v += CENTER[i] * 8;
    else if (k === 'p') { const r = i >> 3; v += (c === 'w' ? 6 - r : r - 1) * 6 + CENTER[i] * 3; }
    else if (k === 'q') v += CENTER[i] * 2;
    s += c === me ? v : -v;
  }
  return s;
}
function botMove(G, depth) {
  const me = G.turn;
  const order = (ms, g) => ms.map((m) => ({ m, o: (g.b[m.t] !== '.' ? VAL[g.b[m.t].toLowerCase()] * 10 - VAL[g.b[m.f].toLowerCase()] : 0) + (m.promo ? 8 : 0) + Math.random() })).sort((a, b) => b.o - a.o).map((x) => x.m);
  const neg = (g, d, al, be) => {
    const ms = allLegal(g);
    if (!ms.length) return inCheck(g) ? -100000 - d : 0;
    if (d === 0) return evalFor(g.b, g.turn);
    let best = -Infinity;
    for (const m of order(ms, g)) {
      const n = apply(g, m); const v = -neg({ ...g, ...n }, d - 1, -be, -al);
      if (v > best) best = v; if (v > al) al = v; if (al >= be) break;
    }
    return best;
  };
  let bm = null, bv = -Infinity;
  for (const m of order(allLegal(G), G)) {
    const n = apply(G, m); const v = -neg({ ...G, ...n }, depth - 1, -Infinity, -bv);
    if (v > bv || !bm) { bv = v; bm = m; }
  }
  void me;
  return bm;
}

export default {
  start(ctx) {
    let sel = -1, promoFor = null, confirmResign = false, lastKey = '', lastMoveKey = '';
    return hosted(ctx, {
      init(prev) {
        const white = firstSeat(ctx, prev, 'white');
        return { b: START, turn: 'w', cr: { wK: true, wQ: true, bK: true, bQ: true }, ep: -1, white, last: null, caps: { w: [], b: [] },
          over: false, winner: null, why: '', score: prev ? prev.score : [0, 0], offer: null, check: false };
      },
      act(S, seat, a, api) {
        if (S.over) return false;
        const myColor = seat === S.white ? 'w' : 'b';
        const end = (winner, why) => { S.over = true; S.winner = winner; S.why = why; if (winner >= 0) S.score[winner]++; api.result(winner); };
        if (a.k === 'resign') { end(1 - seat, 'resign:' + seat); return; }
        if (a.k === 'offer') { if (S.offer === seat) return false; if (S.offer === 1 - seat) { end(-1, 'agreed'); return; } S.offer = seat; return; }
        if (a.k !== 'move' || S.turn !== myColor) return false;
        const m = legal(S, a.f | 0).find((x) => x.t === (a.t | 0)); if (!m) return false;
        const promo = 'qrbn'.includes(a.p) ? a.p : 'q';
        const n = apply(S, m, promo);
        if (n.cap) S.caps[myColor].push(n.cap.toLowerCase());
        Object.assign(S, { b: n.b, turn: n.turn, cr: n.cr, ep: n.ep, last: { f: m.f, t: m.t }, offer: null });
        S.check = inCheck(S);
        if (!allLegal(S).length) { if (S.check) end(seat, 'mate'); else end(-1, 'stalemate'); }
        else if (lowMaterial(S.b)) end(-1, 'material');
      },
      view: (S) => ({ ...S }),
      bot(v, S, lvl) {
        const myC = 1 === S.white ? 'w' : 'b';
        if (v.offer === 0 && S.turn === myC && evalFor(S.b, myC) < 150) return { a: { k: 'offer' }, ms: 900 };   // aceita empate se não estiver ganhando
        if (S.turn !== myC) return null;
        const depth = lvl && lvl.level === 'easy' ? 1 : lvl && lvl.level === 'hard' ? 3 : 2;
        const G = { b: S.b, turn: S.turn, cr: S.cr, ep: S.ep };
        let m = botMove(G, depth);
        if (lvl && lvl.level === 'easy' && Math.random() < 0.3) { const all = allLegal(G); m = all[rand(all.length)]; }
        return m ? { a: { k: 'move', f: m.f, t: m.t, p: 'q' }, ms: think(500, 1100) } : null;
      },
      render(v, api) {
        const me = ctx.seat, other = 1 - me;
        const myColor = me === v.white ? 'w' : 'b';
        const key = v.b + v.turn;
        if (key !== lastKey) { sel = -1; promoFor = null; lastKey = key; }
        const G = { b: v.b, turn: v.turn, cr: v.cr, ep: v.ep };
        const myTurn = !v.over && v.turn === myColor;
        const targets = sel >= 0 && myTurn ? legal(G, sel) : [];
        const kingSq = v.check ? v.b.indexOf(v.turn === 'w' ? 'K' : 'k') : -1;
        const flip = myColor === 'b';
        const self = this;
        const render = () => self.render(v, api);
        const files = 'abcdefgh';
        const animate = v.last && lastMoveKey !== `${v.last.f}-${v.last.t}-${v.b}` ? v.last : null;
        lastMoveKey = v.last ? `${v.last.f}-${v.last.t}-${v.b}` : '';
        const grid = el('div', { class: 'cx-board' });
        for (let k = 0; k < 64; k++) {
          const i = flip ? 63 - k : k;
          const [r, c] = rc(i);
          const p = v.b[i];
          const tgt = targets.find((m) => m.t === i);
          let cls = 'cx-sq ' + ((r + c) % 2 ? 'dk' : 'lt');
          if (v.last && (v.last.f === i || v.last.t === i)) cls += ' last';
          if (i === sel) cls += ' sel';
          if (i === kingSq) cls += ' chk';
          if (tgt) cls += p !== '.' || tgt.ep ? ' cap' : ' to';
          const b = el('button', { class: cls, type: 'button', 'aria-label': tr('sq', { f: files[c], r: 8 - r }) + (p !== '.' ? ' ' + p : '') });
          if (p !== '.') {
            const pc = piece(p);
            if (animate && animate.t === i) {
              const [fr, fc] = rc(animate.f);
              const dx = (fc - c) * (flip ? -1 : 1), dy = (fr - r) * (flip ? -1 : 1);
              pc.style.setProperty('--dx', dx * 100 + '%'); pc.style.setProperty('--dy', dy * 100 + '%');
              pc.classList.add('slide');
            }
            b.append(pc);
          }
          b.addEventListener('click', () => {
            if (!myTurn) return;
            if (tgt) {
              if (tgt.promo) { promoFor = tgt; render(); return; }
              api.send({ k: 'move', f: tgt.f, t: tgt.t }); sel = -1; return;
            }
            sel = p !== '.' && col(p) === myColor && i !== sel ? i : -1;
            render();
          });
          grid.append(b);
        }
        // coordenadas na moldura (fora das casas)
        const fileRow = el('div', { class: 'cx-files' }, ...[...Array(8)].map((_, k) => el('span', { text: files[flip ? 7 - k : k] })));
        const rankCol = el('div', { class: 'cx-ranks' }, ...[...Array(8)].map((_, k) => el('span', { text: String(flip ? k + 1 : 8 - k) })));
        const capsOf = (c) => {
          const list = v.caps[c];
          const adv = list.reduce((a, x) => a + VAL[x], 0) - v.caps[c === 'w' ? 'b' : 'w'].reduce((a, x) => a + VAL[x], 0);
          return el('div', { class: 'cx-caps' }, ...list.slice().sort((a, b) => VAL[b] - VAL[a]).map((x) => piece(c === 'w' ? x : x.toUpperCase(), 'mini')), adv > 0 ? el('small', { text: '+' + adv }) : null);
        };
        const turnSeat = v.turn === 'w' ? v.white : 1 - v.white;
        const bar = (s) => {
          const c = s === v.white ? 'w' : 'b';
          const u = s === me ? ctx.me : ctx.peer;
          const on = !v.over && turnSeat === s;
          // faixa da jogadora: foto, nome com vitórias, peças capturadas; à direita a cor dela (vira destaque na vez)
          return el('div', { class: 'cx-player ' + (s === me ? 'me' : 'op') + (on ? ' turn' : '') },
            el('span', { class: 'cx-pav' }, avatar(u || { name: ctx.names[s] }, 'md')),
            el('div', { class: 'cx-pn' },
              el('div', { class: 'cx-nm' }, el('b', { text: s === me ? kt('you') : ctx.names[s] }),
                el('span', { class: 'cx-wins', title: tr('wins') }, cupSvg(), el('span', { text: String(v.score[s]) }))),
              capsOf(c)),
            el('span', { class: 'cx-side ' + c }, piece(c === 'w' ? 'K' : 'k', 'tiny'), el('span', { text: on ? (s === me ? tr('yourMove') : tr('thinking')) : (c === 'w' ? tr('white') : tr('black')) })));
        };
        let status = '';
        if (v.check && !v.over) status = tr('check');
        const tools = el('div', { class: 'cx-tools' },
          el('button', { class: 'cx-tb' + (confirmResign ? ' danger' : ''), type: 'button', disabled: v.over, text: confirmResign ? tr('resignQ') : tr('resign'),
            onClick: () => { if (confirmResign) { confirmResign = false; api.send({ k: 'resign' }); } else { confirmResign = true; render(); setTimeout(() => { confirmResign = false; }, 4000); } } }),
          el('button', { class: 'cx-tb', type: 'button', disabled: v.over || v.offer === me, text: v.offer === other ? tr('accept') : v.offer === me ? tr('offered') : tr('offer'), onClick: () => api.send({ k: 'offer' }) }));
        const kids = [
          v._here ? null : waitingPeer(ctx),
          bar(other),
          el('div', { class: 'cx-frame' }, rankCol, el('div', { class: 'cx-boardwrap' }, grid, status ? el('div', { class: 'cx-flash', text: status }) : null), el('span'), fileRow),
          bar(me),
          tools,
        ];
        if (promoFor) {
          kids.push(el('div', { class: 'gk-ov' }, el('div', { class: 'gk-end cx-promo' }, el('b', { text: tr('promo') }),
            el('div', { class: 'gk-row' }, ...['q', 'r', 'b', 'n'].map((x) => el('button', { class: 'cx-pbtn', type: 'button', onClick: () => { const m = promoFor; promoFor = null; api.send({ k: 'move', f: m.f, t: m.t, p: x }); } },
              piece(myColor === 'w' ? x.toUpperCase() : x)))))));
        }
        if (v.over) {
          const why = v.why.startsWith('resign:') ? (Number(v.why.slice(7)) === me ? tr('youResigned') : tr('resigned', { name: ctx.names[other] })) : tr(v.why);
          kids.push(endBox(ctx, v, api, { title: v.winner === -1 ? tr('draw') : v.winner === me ? tr('win') : tr('lose', { name: ctx.names[other] }), detail: why, tone: v.winner === me ? 'win' : '' }));
        }
        ctx.root.replaceChildren(el('div', { class: 'gk cx' + (myTurn ? ' myturn' : '') }, ...kids.filter(Boolean)));
      },
    });
  },
};
