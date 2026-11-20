'use strict';
// Lig 4: 7 colunas × 6 linhas. Quem começa alterna a cada partida.
import { el } from '../util.js';
import { hosted, makeTr, seats, turnLine, endBox, waitingPeer, firstSeat, think, rand } from './kit.js';

const tr = makeTr({
  pt: { win: 'Você venceu!', lose: '{name} venceu', draw: 'Empate: tabuleiro cheio', col: 'Coluna {n}', four: 'Quatro em linha!' },
  en: { win: 'You won!', lose: '{name} won', draw: 'Draw: board full', col: 'Column {n}', four: 'Four in a row!' },
});
const W = 7, H = 6;

function winLine(b, r, c) {
  const p = b[r * W + c]; if (p < 0) return null;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const line = [[r, c]];
    for (const s of [1, -1]) {
      let rr = r + dr * s, cc = c + dc * s;
      while (rr >= 0 && rr < H && cc >= 0 && cc < W && b[rr * W + cc] === p) { line.push([rr, cc]); rr += dr * s; cc += dc * s; }
    }
    if (line.length >= 4) return line.map(([a, d]) => a * W + d);
  }
  return null;
}

/* computador: minimax com poda, avaliando janelas de 4 */
const rowFor = (b, c) => { let r = H - 1; while (r >= 0 && b[r * W + c] >= 0) r--; return r; };
function score4(b) {
  let s = 0;
  const win = (cells) => { let me = 0, op = 0; for (const i of cells) { if (b[i] === 1) me++; else if (b[i] === 0) op++; } if (me && op) return 0; if (me === 4) return 1e5; if (op === 4) return -1e5; return me === 3 ? 6 : me === 2 ? 2 : op === 3 ? -8 : op === 2 ? -2 : 0; };
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const r3 = r + dr * 3, c3 = c + dc * 3; if (r3 < 0 || r3 >= H || c3 < 0 || c3 >= W) continue;
      s += win([0, 1, 2, 3].map((k) => (r + dr * k) * W + c + dc * k));
    }
    if (c === 3 && b[r * W + c] === 1) s += 3;
  }
  return s;
}
function bestCol(b0, depth) {
  const b = b0.slice();
  const order = [3, 2, 4, 1, 5, 0, 6];
  const mm = (d, p, al, be) => {
    const sc = score4(b);
    if (Math.abs(sc) >= 5e4 || d === 0 || b.every((x) => x >= 0)) return sc * (1 + d * 0.01);
    let best = p === 1 ? -Infinity : Infinity;
    for (const c of order) {
      const r = rowFor(b, c); if (r < 0) continue;
      b[r * W + c] = p; const v = mm(d - 1, 1 - p, al, be); b[r * W + c] = -1;
      if (p === 1) { best = Math.max(best, v); al = Math.max(al, v); } else { best = Math.min(best, v); be = Math.min(be, v); }
      if (be <= al) break;
    }
    return best;
  };
  let bc = [], bv = -Infinity;
  for (const c of order) {
    const r = rowFor(b, c); if (r < 0) continue;
    b[r * W + c] = 1; const v = mm(depth - 1, 0, -Infinity, Infinity); b[r * W + c] = -1;
    if (v > bv + 1e-6) { bv = v; bc = [c]; } else if (Math.abs(v - bv) <= 1e-6) bc.push(c);
  }
  return bc.length ? bc[rand(bc.length)] : order.find((c) => rowFor(b, c) >= 0);
}

export default {
  start(ctx) {
    let lastMove = -1;
    return hosted(ctx, {
      init(prev) {
        const starter = firstSeat(ctx, prev);
        return { b: Array(W * H).fill(-1), turn: starter, starter, win: null, over: false, score: prev ? prev.score : [0, 0], last: -1, winner: null };
      },
      act(S, seat, a, api) {
        if (S.over || a.k !== 'drop' || S.turn !== seat) return false;
        const c = a.c | 0; if (c < 0 || c >= W) return false;
        let r = H - 1; while (r >= 0 && S.b[r * W + c] >= 0) r--;
        if (r < 0) return false;
        S.b[r * W + c] = seat; S.last = r * W + c;
        const line = winLine(S.b, r, c);
        if (line) { S.win = line; S.over = true; S.winner = seat; S.score[seat]++; api.result(seat); }
        else if (S.b.every((x) => x >= 0)) { S.over = true; S.winner = -1; api.result(-1); }
        else S.turn = 1 - seat;
      },
      view: (S) => ({ ...S }),
      bot(v, _S, lvl) {
        if (v.turn !== 1) return null;
        const depth = lvl && lvl.level === 'easy' ? 1 : lvl && lvl.level === 'hard' ? 6 : 4;
        return { a: { k: 'drop', c: bestCol(v.b, depth) }, ms: think(500, 1000) };
      },
      render(v, api) {
        const me = ctx.seat;
        const grid = el('div', { class: 'l4-grid', role: 'grid' });
        const fresh = v.last !== lastMove ? v.last : -1; lastMove = v.last;
        for (let c = 0; c < W; c++) {
          const col = el('button', { class: 'l4-col', type: 'button', 'aria-label': tr('col', { n: c + 1 }), disabled: v.over || v.turn !== me || v.b[c] >= 0, onClick: () => api.send({ k: 'drop', c }) });
          for (let r = 0; r < H; r++) {
            const i = r * W + c, p = v.b[i];
            const cell = el('span', { class: 'l4-cell' });
            if (p >= 0) {
              const disc = el('i', { class: 'l4-disc ' + (p === me ? 'me' : 'op') + (v.win && v.win.includes(i) ? ' win' : '') + (i === fresh ? ' drop' : '') });
              if (i === fresh) disc.style.setProperty('--from', String(r + 1));
              cell.append(disc);
            }
            col.append(cell);
          }
          col.append(el('i', { class: 'l4-ghost ' + (v.turn === me ? 'me' : 'op') }));
          grid.append(col);
        }
        const kids = [seats(ctx, v, { turn: v.over ? null : v.turn, score: v.score, colors: me === 0 ? ['var(--l4-me)', 'var(--l4-op)'] : ['var(--l4-op)', 'var(--l4-me)'] }),
          v._here ? turnLine(ctx, v, v.turn, v.over ? (v.win ? tr('four') : ' ') : '') : waitingPeer(ctx),
          el('div', { class: 'l4-board' }, grid)];
        if (v.over) kids.push(endBox(ctx, v, api, { title: v.winner === -1 ? tr('draw') : v.winner === me ? tr('win') : tr('lose', { name: ctx.names[1 - me] }), tone: v.winner === me ? 'win' : '' }));
        ctx.root.replaceChildren(el('div', { class: 'gk l4' }, ...kids));
      },
    });
  },
};
