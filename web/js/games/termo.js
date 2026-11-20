'use strict';
// Termo a dois (corrida): a mesma palavra secreta para as duas, cada uma na sua grade.
// Você vê as cores das tentativas da outra, nunca as letras. Quem acertar primeiro vence.
import { el } from '../util.js';
import { hosted, makeTr, seats, endBox, waitingPeer, rand, think } from './kit.js';
import { WORDS } from './wordle-words.js';

const tr = makeTr({
  pt: { short: 'Faltam letras', win: 'Você acertou primeiro!', lose: '{name} acertou primeiro', draw: 'Ninguém acertou', was: 'A palavra era {w}', enter: 'Enviar', del: 'Apagar',
    you: 'Você', tries: '{n}/6', out: 'Suas tentativas acabaram. Esperando {name}…', hint: 'Mesma palavra para as duas. Letras sem acento.' },
  en: { short: 'Not enough letters', win: 'You got it first!', lose: '{name} got it first', draw: 'Nobody got it', was: 'The word was {w}', enter: 'Enter', del: 'Delete',
    you: 'You', tries: '{n}/6', out: 'Out of guesses. Waiting for {name}…', hint: 'Same word for both. Letters without accents.' },
});
const LEN = 5, TRIES = 6;
const ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
const up = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
function evalGuess(g, a) {
  const res = Array(LEN).fill('x'), cnt = {};
  for (let i = 0; i < LEN; i++) { if (g[i] === a[i]) res[i] = 'c'; else cnt[a[i]] = (cnt[a[i]] || 0) + 1; }
  for (let i = 0; i < LEN; i++) if (res[i] !== 'c' && cnt[g[i]] > 0) { res[i] = 'p'; cnt[g[i]]--; }
  return res.join('');
}

export default {
  start(ctx) {
    let pool = null;
    let cur = Array(5).fill(''), pos = 0, shake = false, lastV = null, apiRef = null, msg = '';
    const used = [];
    const onKey = (e) => {
      if (!lastV || lastV.over || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^(INPUT|TEXTAREA)$/.test(e.target && e.target.tagName)) return;
      if (e.key === 'Enter') { e.preventDefault(); press('ENTER'); }
      else if (e.key === 'Backspace') { e.preventDefault(); press('DEL'); }
      else if (e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); press('RIGHT'); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); press('LEFT'); }
      else if (/^[a-zA-Z]$/.test(e.key)) press(e.key.toUpperCase());
    };
    addEventListener('keydown', onKey);
    function press(k) {
      const v = lastV; if (!v || v.over || v.mine.length >= TRIES || v.solved[ctx.seat]) return;
      if (k === 'DEL') { if (cur[pos]) cur[pos] = ''; else if (pos > 0) { pos--; cur[pos] = ''; } }
      else if (k === 'LEFT') pos = Math.max(0, pos - 1);
      else if (k === 'RIGHT') pos = Math.min(LEN - 1, pos + 1);
      else if (k === 'ENTER') { if (cur.some((c) => !c)) { shake = true; msg = tr('short'); } else { apiRef.send({ k: 'guess', w: cur.join('') }); cur = Array(LEN).fill(''); pos = 0; } }
      else {
        cur[pos] = k;
        // vai para a próxima casa vazia (à direita; se não houver, a primeira vazia)
        let nx = -1; for (let i = pos + 1; i < LEN; i++) if (!cur[i]) { nx = i; break; }
        if (nx < 0) for (let i = 0; i < LEN; i++) if (!cur[i]) { nx = i; break; }
        pos = nx < 0 ? Math.min(LEN - 1, pos + 1) : nx;
      }
      draw();
    }
    let drawFn = null;
    const draw = () => drawFn && drawFn();
    const h = hosted(ctx, {
      init(prev) {
        let w = '';
        for (let i = 0; i < 50; i++) { w = up(WORDS[rand(WORDS.length)]); if (/^[A-Z]{5}$/.test(w) && !used.includes(w)) break; }
        used.push(w);
        return { word: w, g: [[], []], solved: [false, false], over: false, winner: null, score: prev ? prev.score : [0, 0], round: prev ? prev.round + 1 : 1 };
      },
      act(S, seat, a, api) {
        if (S.over || a.k !== 'guess') return false;
        const w = up(a.w).replace(/[^A-Z]/g, '');
        if (w.length !== LEN || S.g[seat].length >= TRIES || S.solved[seat]) return false;
        const r = evalGuess(w, S.word);
        S.g[seat].push({ w, r });
        if (r === 'ccccc') { S.solved[seat] = true; S.over = true; S.winner = seat; S.score[seat]++; api.result(seat); return; }
        if (S.g[0].length >= TRIES && S.g[1].length >= TRIES) { S.over = true; S.winner = -1; api.result(-1); }
      },
      bot(v, S, lvl) {
        if (v.over || v.mine.length >= TRIES || v.solved[1]) return null;
        if (!pool) pool = [...new Set(WORDS.map(up).filter((w) => /^[A-Z]{5}$/.test(w)))];
        const cand = pool.filter((w) => v.mine.every((g) => evalGuess(g.w, w) === g.r));
        let w = cand.length ? cand[rand(cand.length)] : pool[rand(pool.length)];
        if (!v.mine.length) w = ['SERIA', 'TERNO', 'CAIBO', 'PORTA', 'LIMBO', 'SALTO'].filter((x) => pool.includes(x))[rand(4)] || w;
        const slow = lvl && lvl.level === 'easy' ? [9000, 14000] : lvl && lvl.level === 'hard' ? [3500, 6000] : [6000, 10000];
        void S;
        return { a: { k: 'guess', w }, ms: think(slow[0], slow[1]) };
      },
      view(S, s) {
        return { mine: S.g[s], theirs: S.g[1 - s].map((x) => x.r), solved: S.solved, over: S.over, winner: S.winner, score: S.score, round: S.round, word: S.over ? S.word : null };
      },
      render(v, api) {
        apiRef = api;
        if (lastV && v.round !== lastV.round) { cur = Array(LEN).fill(''); pos = 0; }
        lastV = v;
        drawFn = () => paint(v, api);
        paint(v, api);
      },
    });
    function paint(v, api) {
      const me = ctx.seat, other = 1 - me;
      const grid = el('div', { class: 'tm-grid' + (shake ? ' shake' : '') });
      for (let i = 0; i < TRIES; i++) {
        const g = v.mine[i];
        const row = el('div', { class: 'tm-row' });
        for (let j = 0; j < LEN; j++) {
          const live = !g && i === v.mine.length && !v.over && !v.solved[ctx.seat];
          const ch = g ? g.w[j] : (live ? cur[j] || '' : '');
          const cell = el(live ? 'button' : 'span', { class: 'tm-t' + (g ? ' ' + g.r[j] : '') + (!g && ch ? ' typed' : '') + (live && j === pos ? ' sel' : '') + (g && i === v.mine.length - 1 ? ' flip' : ''), text: ch, type: live ? 'button' : null });
          if (live) cell.addEventListener('click', () => { pos = j; draw(); });
          row.append(cell);
          if (g && i === v.mine.length - 1) row.lastChild.style.setProperty('--d', j * 90 + 'ms');
        }
        grid.append(row);
      }
      shake = false;
      const mini = el('div', { class: 'tm-mini', 'aria-label': ctx.names[other] });
      for (let i = 0; i < TRIES; i++) {
        const r = v.theirs[i];
        const row = el('div', { class: 'tm-mrow' });
        for (let j = 0; j < LEN; j++) row.append(el('i', { class: r ? r[j] : '' }));
        mini.append(row);
      }
      // teclado com as cores das minhas tentativas
      const best = {};
      const rank = { x: 1, p: 2, c: 3 };
      for (const g of v.mine) for (let j = 0; j < LEN; j++) { const ch = g.w[j], st = g.r[j]; if (!best[ch] || rank[st] > rank[best[ch]]) best[ch] = st; }
      const kb = el('div', { class: 'tm-kb' }, ...ROWS.map((row, ri) => el('div', { class: 'tm-kr' },
        ri === 2 ? el('button', { class: 'tm-k wide', type: 'button', text: tr('enter'), onClick: () => press('ENTER') }) : null,
        ...[...row].map((ch) => el('button', { class: 'tm-k ' + (best[ch] || ''), type: 'button', text: ch, onClick: () => press(ch) })),
        ri === 2 ? el('button', { class: 'tm-k wide', type: 'button', 'aria-label': tr('del'), text: '⌫', onClick: () => press('DEL') }) : null)));
      const out = !v.over && (v.mine.length >= TRIES);
      const kids = [
        seats(ctx, v, { score: v.score, sub: me === 0 ? [tr('tries', { n: v.mine.length }), tr('tries', { n: v.theirs.length })] : [tr('tries', { n: v.theirs.length }), tr('tries', { n: v.mine.length })] }),
        v._here ? (msg || out ? el('div', { class: 'gk-turn', text: msg || tr('out', { name: ctx.names[other] }) }) : null) : waitingPeer(ctx),
        el('div', { class: 'tm-play' }, grid, el('div', { class: 'tm-side' }, el('small', { text: ctx.names[other] }), mini)),
        kb,
      ];
      msg = '';
      if (v.over) kids.push(endBox(ctx, v, api, { title: v.winner === -1 ? tr('draw') : v.winner === me ? tr('win') : tr('lose', { name: ctx.names[other] }), detail: tr('was', { w: v.word }), tone: v.winner === me ? 'win' : '' }));
      ctx.root.replaceChildren(el('div', { class: 'gk tm' }, ...kids));
    }
    return { destroy() { removeEventListener('keydown', onKey); h.destroy(); } };
  },
};
