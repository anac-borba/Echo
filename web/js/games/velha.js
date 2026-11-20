'use strict';
// Jogo da velha. Quem começa (X) alterna a cada partida.
import { el } from '../util.js';
import { hosted, makeTr, seats, turnLine, endBox, waitingPeer, firstSeat, think, rand } from './kit.js';

const tr = makeTr({
  pt: { win: 'Você venceu!', lose: '{name} venceu', draw: 'Deu velha!', cell: 'Casa {n}' },
  en: { win: 'You won!', lose: '{name} won', draw: "It's a draw!", cell: 'Square {n}' },
});
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

export default {
  start(ctx) {
    let lastSeen = -1;
    return hosted(ctx, {
      init(prev) {
        const starter = firstSeat(ctx, prev);
        return { b: Array(9).fill(-1), turn: starter, starter, over: false, win: null, winner: null, score: prev ? prev.score : [0, 0], last: -1 };
      },
      act(S, seat, a, api) {
        if (S.over || a.k !== 'play' || S.turn !== seat) return false;
        const i = a.i | 0; if (i < 0 || i > 8 || S.b[i] >= 0) return false;
        S.b[i] = seat; S.last = i;
        const line = LINES.find((l) => l.every((j) => S.b[j] === seat));
        if (line) { S.over = true; S.win = line; S.winner = seat; S.score[seat]++; api.result(seat); }
        else if (S.b.every((x) => x >= 0)) { S.over = true; S.winner = -1; api.result(-1); }
        else S.turn = 1 - seat;
      },
      view: (S) => ({ ...S }),
      bot(v, _S, lvl) {
        if (v.turn !== 1) return null;
        const free = v.b.map((x, i) => (x < 0 ? i : -1)).filter((i) => i >= 0);
        // fácil erra às vezes; difícil joga perfeito (minimax)
        const miss = lvl && lvl.level === 'easy' ? 0.45 : lvl && lvl.level === 'hard' ? 0 : 0.15;
        if (Math.random() < miss) return { a: { k: 'play', i: free[rand(free.length)] }, ms: think(450, 900) };
        const win = (b, p) => LINES.some((l) => l.every((j) => b[j] === p));
        const mm = (b, p) => {
          if (win(b, 1)) return 10; if (win(b, 0)) return -10;
          const f = b.map((x, i) => (x < 0 ? i : -1)).filter((i) => i >= 0); if (!f.length) return 0;
          let best = p === 1 ? -99 : 99;
          for (const i of f) { b[i] = p; const s = mm(b, 1 - p) * 0.9; b[i] = -1; best = p === 1 ? Math.max(best, s) : Math.min(best, s); }
          return best;
        };
        const b = v.b.slice(); let bi = [], bs = -99;
        for (const i of free) { b[i] = 1; const s = mm(b, 0); b[i] = -1; if (s > bs + 1e-9) { bs = s; bi = [i]; } else if (Math.abs(s - bs) < 1e-9) bi.push(i); }
        return { a: { k: 'play', i: bi[rand(bi.length)] }, ms: think(450, 900) };
      },
      render(v, api) {
        const me = ctx.seat;
        const mark = (p) => (p === v.starter ? 'x' : 'o');   // X é sempre quem começou
        const fresh = v.last !== lastSeen ? v.last : -1; lastSeen = v.last;
        const board = el('div', { class: 'tt-board' + (v.win ? ' done' : '') });
        v.b.forEach((p, i) => {
          const b = el('button', { class: 'tt-cell', type: 'button', 'aria-label': tr('cell', { n: i + 1 }), disabled: v.over || p >= 0 || v.turn !== me, onClick: () => api.send({ k: 'play', i }) });
          if (p >= 0) b.append(el('i', { class: 'tt-m ' + mark(p) + (p === me ? ' me' : ' op') + (i === fresh ? ' new' : '') + (v.win && v.win.includes(i) ? ' win' : '') }));
          else if (!v.over && v.turn === me) b.append(el('i', { class: 'tt-m ghost ' + mark(me) }));
          board.append(b);
        });
        const kids = [seats(ctx, v, { turn: v.over ? null : v.turn, score: v.score, sub: [mark(0).toUpperCase(), mark(1).toUpperCase()] }),
          v._here ? turnLine(ctx, v, v.turn, v.over ? ' ' : '') : waitingPeer(ctx), el('div', { class: 'tt-wrap' }, board)];
        if (v.over) kids.push(endBox(ctx, v, api, { title: v.winner === -1 ? tr('draw') : v.winner === me ? tr('win') : tr('lose', { name: ctx.names[1 - me] }), tone: v.winner === me ? 'win' : '' }));
        ctx.root.replaceChildren(el('div', { class: 'gk tt' }, ...kids));
      },
    });
  },
};
