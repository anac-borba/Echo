'use strict';
// Ludo a dois (vermelho × amarelo, cantos opostos). Regras:
//  6 tira peça da casa; 6, captura ou chegar ao centro dão outra jogada (três 6 seguidos perdem a vez);
//  casas com estrela e as de saída são seguras; para entrar no centro precisa do número exato.
import { el, avatar } from '../util.js';
import { hosted, makeTr, turnLine, endBox, waitingPeer, rand, firstSeat, think, kt } from './kit.js';

const tr = makeTr({
  pt: { roll: 'Jogar', pick: 'Escolha uma peça', noMove: 'Sem jogada com {n}', six3: 'Três 6 seguidos: passou a vez', cap: 'Captura!', home: 'Chegou!',
    win: 'Você venceu!', lose: '{name} venceu', red: 'Vermelho', yellow: 'Amarelo', rolled: 'Tirou {n}', extra: 'Jogue de novo', inHome: '{n}/{g} no centro', die: 'Dado: {n}', tap: 'Você pode jogar', wins: '{n} vitórias', yourTurn: 'Sua vez', their: 'Vez de {name}' },
  en: { roll: 'Roll', pick: 'Pick a piece', noMove: 'No move with {n}', six3: 'Three 6s in a row: turn lost', cap: 'Capture!', home: 'Home!',
    win: 'You won!', lose: '{name} won', red: 'Red', yellow: 'Yellow', rolled: 'Rolled {n}', extra: 'Roll again', inHome: '{n}/{g} home', die: 'Die: {n}', tap: 'You can roll', wins: '{n} wins', yourTurn: 'Your turn', their: "{name}'s turn" },
});

const TRACK = [[6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6], [0, 7], [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14], [7, 14], [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9], [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7], [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0], [7, 0], [6, 0]];
const START = [0, 26];
const HOME = [[[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]], [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]]];
const BASE = [[[1, 1], [1, 4], [4, 1], [4, 4]], [[10, 10], [10, 13], [13, 10], [13, 13]]];
const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
const END = 56;
const trackIdx = (s, p) => (START[s] + p) % 52;
const isSafe = (o, ti) => ti === START[0] || ti === START[1] || ti === 13 || ti === 39 || (o.safe && SAFE.has(ti));
const canLeave = (G) => G.die === 6 || (G.o.exit === '16' && G.die === 1);
const canMove = (G, seat) => G.pos[seat].map((p, k) => ({ p, k })).filter(({ p }) => (p < 0 ? canLeave(G) : p + G.die <= END) && p !== END).map((x) => x.k);
function cellOf(s, p, k) {
  if (p < 0) return BASE[s][k];
  if (p <= 50) return TRACK[trackIdx(s, p)];
  if (p < END) return HOME[s][p - 51];
  return s === 0 ? [7, 6] : [7, 8];
}

const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, at) => { const n = document.createElementNS(SVGNS, tag); for (const k in at) n.setAttribute(k, at[k]); return n; };
// peão desenhado aqui: sombra, corpo, cabeça e brilho; a cor vem do tema
function pawnSvg() {
  const s = sv('svg', { viewBox: '0 0 40 40', class: 'ld-pawn', 'aria-hidden': 'true' });
  // ficha: disco grosso com aro branco (vista de cima, levemente inclinada)
  const chip = sv('g', { class: 'pc-chip' });
  chip.append(sv('ellipse', { cx: 20, cy: 25, rx: 15, ry: 13, class: 'ld-psh' }), sv('circle', { cx: 20, cy: 21.5, r: 14.5, class: 'ld-pd' }),
    sv('circle', { cx: 20, cy: 19, r: 14.5, class: 'ld-pb' }), sv('circle', { cx: 20, cy: 19, r: 10.5, class: 'ld-ring' }), sv('circle', { cx: 20, cy: 19, r: 7.5, class: 'ld-pb' }),
    sv('ellipse', { cx: 16, cy: 14, rx: 4, ry: 2.4, class: 'ld-pl' }));
  // peão clássico
  const pawn = sv('g', { class: 'pc-pawn' });
  pawn.append(sv('ellipse', { cx: 20, cy: 36, rx: 11, ry: 3.5, class: 'ld-psh' }),
    sv('path', { d: 'M20 15c-4.5 0-7 2.6-7 5.4 0 1.8.9 3.1 2.3 4L10.6 33.6c-.7 1.8.5 3.2 2.3 3.2h14.2c1.8 0 3-1.4 2.3-3.2l-4.6-9.2c1.4-.9 2.3-2.2 2.3-4 0-2.8-2.5-5.4-7.1-5.4z', class: 'ld-pb' }),
    sv('circle', { cx: 20, cy: 10, r: 7, class: 'ld-pb' }), sv('ellipse', { cx: 17.5, cy: 7.5, rx: 2.6, ry: 1.9, class: 'ld-pl' }));
  // gema lapidada
  const gem = sv('g', { class: 'pc-gem' });
  gem.append(sv('ellipse', { cx: 20, cy: 35, rx: 12, ry: 3.5, class: 'ld-psh' }), sv('path', { d: 'M8 15l6-8h12l6 8-12 19z', class: 'ld-pb' }),
    sv('path', { d: 'M8 15h24M14 7l6 8 6-8M20 15v19', class: 'ld-facet' }), sv('path', { d: 'M14 7l6 8H8z', class: 'ld-pl' }));
  // bichinho: bolinha com olhos
  const blob = sv('g', { class: 'pc-blob' });
  blob.append(sv('ellipse', { cx: 20, cy: 35, rx: 12, ry: 3.5, class: 'ld-psh' }), sv('path', { d: 'M20 5c9 0 14 8 14 17 0 8-6 12-14 12S6 30 6 22C6 13 11 5 20 5z', class: 'ld-pb' }),
    sv('circle', { cx: 15.5, cy: 19, r: 3.2, class: 'ld-eye' }), sv('circle', { cx: 24.5, cy: 19, r: 3.2, class: 'ld-eye' }),
    sv('circle', { cx: 16.2, cy: 19.6, r: 1.6, class: 'ld-pupil' }), sv('circle', { cx: 25.2, cy: 19.6, r: 1.6, class: 'ld-pupil' }),
    sv('path', { d: 'M17 26q3 2.4 6 0', class: 'ld-mouth' }), sv('ellipse', { cx: 14, cy: 11, rx: 3.5, ry: 2.2, class: 'ld-pl' }));
  // taça (tema Jantar em Paris): vinho da cor da jogadora
  const glass = sv('g', { class: 'pc-taca' });
  glass.append(sv('ellipse', { cx: 20, cy: 36, rx: 9, ry: 3, class: 'ld-psh' }), sv('ellipse', { cx: 20, cy: 34.5, rx: 7.5, ry: 2.2, class: 'ld-glass' }),
    sv('rect', { x: 19, y: 22, width: 2, height: 12, class: 'ld-glass' }),
    sv('path', { d: 'M10 4h20c0 10-3.5 18-10 18S10 14 10 4z', class: 'ld-glass' }),
    sv('path', { d: 'M11 10h18c-.6 6.5-4 11.5-9 11.5S11.6 16.5 11 10z', class: 'ld-pb' }),
    sv('path', { d: 'M13 6c0 4 .8 7 2.2 9', class: 'ld-shine' }));
  // rosa vista de cima (Jantar em Paris): pétalas em espiral e duas folhas
  const rose = sv('g', { class: 'pc-rosa' });
  rose.append(sv('ellipse', { cx: 20, cy: 33, rx: 13, ry: 4, class: 'ld-psh' }),
    sv('path', { d: 'M4 24c3-6 9-7 12-4-4 3-8 5-12 4z', class: 'ld-leaf' }), sv('path', { d: 'M36 24c-3-6-9-7-12-4 4 3 8 5 12 4z', class: 'ld-leaf' }),
    sv('circle', { cx: 20, cy: 18, r: 14, class: 'ld-pd' }), sv('circle', { cx: 20, cy: 16.5, r: 13.5, class: 'ld-pb' }),
    sv('path', { d: 'M20 5c7 0 11.5 5 11.5 11 0 6.5-5 11-11.5 11S8.5 22.5 8.5 16.5', class: 'ld-petal' }),
    sv('path', { d: 'M20 9.5c4.5 0 7.5 3.2 7.5 7S24.5 23 20.5 23s-6.5-2.8-6.5-6.3c0-3.3 2.6-5.3 5.4-5.3', class: 'ld-petal' }),
    sv('path', { d: 'M20.5 13.5c2 0 3.5 1.4 3.5 3.2s-1.6 3-3.4 3-2.9-1.3-2.9-2.8c0-1.3 1-2 2-2', class: 'ld-petal' }),
    sv('ellipse', { cx: 15, cy: 10, rx: 3.5, ry: 2, class: 'ld-pl' }));
  // gatinho (Casinha): cabeça redonda com orelhas, focinho branco e olhinhos fechados
  const cat = sv('g', { class: 'pc-gato' });
  cat.append(sv('ellipse', { cx: 20, cy: 35, rx: 13, ry: 3.5, class: 'ld-psh' }),
    sv('path', { d: 'M7 14L8.5 3.5 16 9.5zM33 14L31.5 3.5 24 9.5z', class: 'ld-pb' }), sv('path', { d: 'M9.5 11.5l.8-5 3.4 2.8zM30.5 11.5l-.8-5-3.4 2.8z', class: 'ld-ear' }),
    sv('ellipse', { cx: 20, cy: 20, rx: 15, ry: 13.5, class: 'ld-pb' }),
    sv('ellipse', { cx: 20, cy: 25.5, rx: 7.5, ry: 5.5, class: 'ld-muz' }),
    sv('path', { d: 'M11.5 18.5q2.5 2.4 5 0M23.5 18.5q2.5 2.4 5 0', class: 'ld-mouth' }),
    sv('path', { d: 'M18.6 23.2h2.8l-1.4 1.6z', class: 'ld-nose' }), sv('path', { d: 'M17.5 26.5q1.2 1.2 2.5 0 1.3 1.2 2.5 0', class: 'ld-mouth' }),
    sv('ellipse', { cx: 13, cy: 12, rx: 3.5, ry: 2, class: 'ld-pl' }));
  s.append(chip, pawn, gem, blob, glass, rose, cat);
  return s;
}
function starSvg() {
  const s = sv('svg', { viewBox: '0 0 24 24', class: 'ld-star', 'aria-hidden': 'true' });
  s.append(sv('path', { d: 'M12 2.8l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 16.7l-5.6 3.1 1.3-6.2L3 9.3l6.3-.7z' }));
  return s;
}
// rotação do dado para mostrar cada número de frente (faces: frente 1, trás 6, direita 3, esquerda 4, cima 5, baixo 2)
const FACE = { 1: [0, 0], 6: [0, 180], 3: [0, -90], 4: [0, 90], 5: [-90, 0], 2: [90, 0] };
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const FACE_CLASS = { 1: 'f1', 6: 'f6', 3: 'f3', 4: 'f4', 5: 'f5', 2: 'f2' };
function makeDie() {
  const cube = el('span', { class: 'ld-cube' }, el('i', { class: 'ld-core a' }), el('i', { class: 'ld-core b' }), el('i', { class: 'ld-core c' }), ...Object.keys(FACE).map((n) => el('span', { class: 'ld-face ' + FACE_CLASS[n] }, ...Array.from({ length: 9 }, (_, i) => el('i', { class: PIPS[n].includes(i) ? 'on' : '' })))));
  const hop = el('span', { class: 'ld-hop' }, cube);
  const btn = el('button', { class: 'ld-dbtn', type: 'button' }, el('span', { class: 'ld-dshadow' }), hop);
  return { btn, cube, hop };
}
const faceTf = (n) => { const [x, y] = FACE[n] || [0, 0]; return `rotateX(${x - 18}deg) rotateY(${y + 22}deg)`; };

export default {
  start(ctx) {
    let rollAnim = null, moveSeen = null, onRoll = null, dieUntil = 0, dieT = 0;
    const die = makeDie();
    die.btn.addEventListener('click', () => onRoll && onRoll());
    return hosted(ctx, {
      init(prev) {
        const starter = firstSeat(ctx, prev);
        const op = (ctx.opts || {});
        const o = prev ? prev.o : { safe: op.safe !== false, exit: op.exit === '16' ? '16' : '6', goal: [1, 2, 4].includes(+op.goal) ? +op.goal : 4 };
        return { o, pos: [[-1, -1, -1, -1], [-1, -1, -1, -1]], turn: starter, starter, die: 0, ph: 'roll', sixes: 0, msg: '', rolls: 0,
          over: false, winner: null, score: prev ? prev.score : [0, 0], lastMove: null };
      },
      act(S, seat, a, api) {
        if (S.over || S.turn !== seat) return false;
        const movable = () => canMove(S, seat);
        const pass = () => { S.turn = 1 - seat; S.ph = 'roll'; S.sixes = 0; };
        if (a.k === 'roll') {
          // sem esperas com relógio: se não há jogada, a vez passa na hora (o aviso fica na tela)
          if (S.ph !== 'roll') return false;
          S.die = 1 + rand(6); S.rolls++; S.msg = ''; S.msgBy = seat; S.lastMove = null;
          if (S.die === 6) S.sixes++; else S.sixes = 0;
          if (S.sixes >= 3) { S.msg = 'six3'; pass(); return; }
          const m = movable();
          if (!m.length) { S.msg = 'noMove'; if (S.die !== 6) pass(); return; }
          S.ph = 'move';
          if (m.length === 1 || new Set(m.map((k) => S.pos[seat][k])).size === 1) return this.act(S, seat, { k: 'move', n: m[0] }, api);
          return;
        }
        if (a.k === 'move') {
          if (S.ph !== 'move') return false;
          const k = a.n | 0; if (!movable().includes(k)) return false;
          const from = S.pos[seat][k];
          const to = from < 0 ? 0 : from + S.die;
          S.pos[seat][k] = to;
          let extra = S.die === 6, ev = '';
          if (to <= 50) {
            const ti = trackIdx(seat, to);
            if (!isSafe(S.o, ti)) {
              const o = 1 - seat;
              S.pos[o].forEach((p, j) => { if (p >= 0 && p <= 50 && trackIdx(o, p) === ti) { S.pos[o][j] = -1; extra = true; ev = 'cap'; } });
            }
          }
          if (to === END) { extra = true; ev = 'home'; }
          S.lastMove = { s: seat, k, from, to };
          S.msg = ev; S.msgBy = seat;
          if (S.pos[seat].filter((p) => p === END).length >= S.o.goal) { S.over = true; S.winner = seat; S.score[seat]++; api.result(seat); return; }
          if (extra) { S.ph = 'roll'; if (S.die !== 6) S.sixes = 0; } else pass();
          return;
        }
        return false;
      },
      view: (S) => ({ ...S }),
      bot(v) {
        if (v.turn !== 1) return null;
        if (v.ph === 'roll') return { a: { k: 'roll' }, ms: think(1300, 1800) };
        const m = canMove(v, 1); if (!m.length) return null;
        // prioridade: capturar > chegar ao centro > sair da casa > fugir de perigo > avançar a mais adiantada
        const score = (k) => {
          const from = v.pos[1][k], to = from < 0 ? 0 : from + v.die;
          let s = to / 10;
          if (to === END) s += 50;
          if (from < 0) s += 30;
          if (to <= 50) {
            const ti = trackIdx(1, to);
            if (!isSafe(v.o, ti) && v.pos[0].some((p) => p >= 0 && p <= 50 && trackIdx(0, p) === ti)) s += 80;
            if (isSafe(v.o, ti)) s += 6;
            // risco: alguma peça adversária até 6 casas atrás
            if (!isSafe(v.o, ti) && v.pos[0].some((p) => p >= 0 && p <= 50 && ((ti - trackIdx(0, p) + 52) % 52) >= 1 && ((ti - trackIdx(0, p) + 52) % 52) <= 6)) s -= 12;
          } else s += 10;
          if (from >= 0 && from <= 50) {
            const fi = trackIdx(1, from);
            if (!isSafe(v.o, fi) && v.pos[0].some((p) => p >= 0 && p <= 50 && ((fi - trackIdx(0, p) + 52) % 52) >= 1 && ((fi - trackIdx(0, p) + 52) % 52) <= 6)) s += 9;
          }
          return s + Math.random();
        };
        const sc = m.map((k) => [k, score(k)]);
        const k = sc.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
        return { a: { k: 'move', n: k }, ms: think(900, 1300) };
      },
      render(v, api) {
        const me = ctx.seat, other = 1 - me;
        const myTurn = v.turn === me && !v.over;
        const movable = v.ph === 'move' && myTurn ? canMove(v, me) : [];
        const board = el('div', { class: 'ld-board' });
        const put = (n, r, c, rs = 1, cs = 1) => { n.style.gridRow = `${r + 1} / span ${rs}`; n.style.gridColumn = `${c + 1} / span ${cs}`; board.append(n); return n; };
        // as quatro casas (vermelho e amarelo jogam; verde e azul enfeitam)
        [['r', 0, 0], ['g', 0, 9], ['y', 9, 9], ['b', 9, 0]].forEach(([k, r, c]) => put(el('span', { class: 'ld-base ' + k }, el('i', { class: 'ld-art' })), r, c, 6, 6));
        const colorOfStart = { 0: 'r', 13: 'g', 26: 'y', 39: 'b' };
        TRACK.forEach(([r, c], ti) => {
          const n = el('span', { class: 'ld-c' + (colorOfStart[ti] ? ' st ' + colorOfStart[ti] : '') });
          if (SAFE.has(ti) && !colorOfStart[ti] && v.o.safe) n.append(starSvg());
          put(n, r, c);
        });
        const lane = (cells, k) => cells.forEach(([r, c]) => put(el('span', { class: 'ld-c ln ' + k }), r, c));
        lane(HOME[0], 'r'); lane(HOME[1], 'y');
        lane([[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]], 'g'); lane([[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]], 'b');
        put(el('span', { class: 'ld-center' }, el('i', { class: 'ld-art' })), 6, 6, 3, 3);
        board.append(el('i', { class: 'ld-petals' }));
        for (const s of [0, 1]) for (const [r, c] of BASE[s]) put(el('span', { class: 'ld-nest ' + (s ? 'y' : 'r') }), r, c);
        // peças (as que dividem a casa ficam lado a lado)
        const byCell = new Map();
        for (const s of [0, 1]) v.pos[s].forEach((p, k) => {
          const [r, c] = cellOf(s, p, k); const key = r * 15 + c;
          if (!byCell.has(key)) byCell.set(key, []);
          byCell.get(key).push({ s, k, p, r, c });
        });
        let movedTok = null;
        const mvKey = v.lastMove ? `${v.rolls}-${v.lastMove.s}-${v.lastMove.k}-${v.lastMove.to}` : '';
        for (const all of byCell.values()) {
          // da mesma cor na mesma casa: mostra uma só, com o número
          const seen = new Map(); const list = [];
          for (const t of all) { const key = t.s + ':' + t.p; if (t.p < 0 || !seen.has(key)) { seen.set(key, t); t.n = 1; list.push(t); } else seen.get(key).n++; }
          list.forEach((t, j) => {
          const can = t.s === me && movable.includes(t.k);
          const tok = el(can ? 'button' : 'span', { class: 'ld-tok ' + (t.s ? 'y' : 'r') + (can ? ' can' : '') + (t.p === END ? ' done' : ''), type: can ? 'button' : null, 'aria-label': (t.s === 0 ? tr('red') : tr('yellow')) + ' ' + (t.k + 1) }, pawnSvg());
          if (list.length > 1) { tok.style.setProperty('--dx', ((j - (list.length - 1) / 2) * 30) + '%'); tok.classList.add('stack'); }
          if (t.n > 1) tok.append(el('b', { class: 'ld-n', text: String(t.n) }));
          if (can) tok.addEventListener('click', () => api.send({ k: 'move', n: t.k }));
          if (v.lastMove && v.lastMove.s === t.s && v.lastMove.k === t.k) movedTok = tok;
          put(tok, t.r, t.c);
          });
        }
        // dado 3D: gira e cai no número quando alguém joga
        const canRoll = myTurn && v.ph === 'roll';
        onRoll = canRoll ? () => api.send({ k: 'roll' }) : null;
        die.btn.disabled = !canRoll;
        die.btn.className = 'ld-dbtn ' + (v.turn === 0 ? 'r' : 'y') + (canRoll ? ' ready' : '');
        die.btn.setAttribute('aria-label', canRoll ? tr('roll') : tr('die', { n: v.die || '–' }));
        const fresh = rollAnim !== null && v.rolls !== rollAnim && v.die;
        if (fresh && die.cube.animate) {
          const [fx, fy] = FACE[v.die];
          const spinX = 360 * (2 + rand(2)), spinY = 360 * (1 + rand(2));
          die.cube.animate([
            { transform: `rotateX(${fx - 18 + spinX}deg) rotateY(${fy + 22 + spinY}deg) rotateZ(${rand(180)}deg)` },
            { transform: faceTf(v.die) }], { duration: 820, easing: 'cubic-bezier(.15,.6,.25,1)' });
          die.hop.animate([{ transform: 'translateY(-70%) scale(1.15)' }, { transform: 'translateY(0) scale(1)', offset: .55 }, { transform: 'translateY(-14%)', offset: .72 }, { transform: 'translateY(0)' }],
            { duration: 820, easing: 'ease-in' });
        }
        die.cube.style.transform = faceTf(v.die || 1);
        rollAnim = v.rolls;
        let msg = v.msg ? (v.msgBy === me ? '' : ctx.names[v.msgBy] + ': ') + tr(v.msg, { n: v.die }) : myTurn && v.ph === 'move' ? tr('rolled', { n: v.die }) + ' · ' + tr('pick').toLowerCase() : canRoll ? (v.die && v.rolls ? tr('extra') : tr('tap')) : '';
        const home = (s) => tr('inHome', { n: v.pos[s].filter((p) => p === END).length, g: v.o.goal });
        // como no Plato: quem joga contra você em cima, você embaixo com o botão de jogar o dado
        const tag = (s, side) => {
          const u = s === me ? ctx.me : ctx.peer;
          const on = !v.over && v.turn === s;
          return el('div', { class: 'ld-who ' + side + ' ' + (s ? 'y' : 'r') + (on ? ' turn' : '') },
            el('span', { class: 'ld-av' }, avatar(u || { name: ctx.names[s] }, side === 'me' ? 'md' : 'sm'), on ? el('i', { class: 'ld-ring' }) : null),
            el('div', { class: 'ld-pt' }, el('b', { text: s === me ? kt('you') : ctx.names[s] })),
            on && side === 'me' && !v.over ? el('span', { class: 'ld-yt', text: tr('yourTurn') }) : null);
        };
        const top = el('div', { class: 'ld-top' }, tag(other, 'op'));
        const roll = canRoll ? el('button', { class: 'ld-roll', type: 'button', text: tr('roll'), onClick: () => api.send({ k: 'roll' }) }) : el('span', { class: 'ld-roll-sp' });
        const bot = el('div', { class: 'ld-bot' }, el('span'), roll, tag(me, 'me'));
        // o dado aparece no meio do tabuleiro só enquanto rola e cai no número
        if (fresh) dieUntil = Date.now() + 1500;
        const dieLayer = el('div', { class: 'ld-roller' + (Date.now() < dieUntil ? ' show' : '') }, die.btn);
        if (Date.now() < dieUntil) { clearTimeout(dieT); dieT = setTimeout(() => dieLayer.classList.remove('show'), dieUntil - Date.now()); }
        const kids = [v._here ? null : waitingPeer(ctx), top,
          el('div', { class: 'ld-wrap' }, board, dieLayer),
          bot, el('p', { class: 'ld-msg', text: msg || (v.turn === other && !v.over ? tr('their', { name: ctx.names[other] }) : '') })].filter(Boolean);
        if (v.over) kids.push(endBox(ctx, v, api, { title: v.winner === me ? tr('win') : tr('lose', { name: ctx.names[other] }), tone: v.winner === me ? 'win' : '' }));
        ctx.root.replaceChildren(el('div', { class: 'gk ld me' + me }, el('div', { class: 'ld-col' }, ...kids)));
        // peça andando casa por casa (depois que o dado cai)
        if (movedTok && moveSeen !== null && mvKey !== moveSeen && movedTok.animate) {
          const { s, k, from, to } = v.lastMove;
          const [r1, c1] = cellOf(s, to, k);
          const path = [];
          if (from < 0) path.push(cellOf(s, -1, k));
          else for (let p = from; p < to; p++) path.push(cellOf(s, p, k));
          path.push([r1, c1]);
          const cs = board.getBoundingClientRect().width / 15 || 0;
          // a tela gira o tabuleiro; o deslocamento é no sistema do próprio tabuleiro (offsetWidth não gira)
          const unit = board.offsetWidth ? board.offsetWidth / 15 : cs;
          const frames = path.map(([r, c], i) => ({ translate: `${(c - c1) * unit}px ${(r - r1) * unit}px`, offset: path.length > 1 ? i / (path.length - 1) : 1 }));
          movedTok.animate(frames, { duration: Math.min(1400, 150 * path.length), delay: fresh ? 780 : 0, easing: 'linear', fill: 'backwards' });
        }
        moveSeen = mvKey;
      },
    });
  },
};
