'use strict';
// Batalha naval 10×10. Frota: 5, 4, 3, 3, 2. Acertou, atira de novo.
// Cada lado só recebe os próprios navios; os da outra aparecem quando afundam (ou no fim).
import { el } from '../util.js';
import { hosted, makeTr, seats, turnLine, endBox, waitingPeer, rand, firstSeat, think } from './kit.js';

const tr = makeTr({
  pt: {
    place: 'Posicione seus navios.', placeHint: 'Clique no tabuleiro para posicionar; R ou o botão direito giram. Clicar num navio o tira do lugar. Podem encostar, mas não ficar um sobre o outro.',
    shuffle: 'Aleatório', ready: 'Começar', waitReady: 'Esperando {name} posicionar…', fleetT: 'Sua frota', enemyT: 'Frota inimiga', count: '{n} de {t} navios',
    mode: 'Modo', mPc: 'Computador', mAtk: 'Só ataque', mOn: 'Online', dPc: 'Você monta sua frota e troca tiros com o computador.', dAtk: 'Só você atira: afunde a frota do computador com o menor número de tiros.',
    dOn: 'Você e {name} montam as frotas e trocam tiros.', diff: 'Dificuldade', easy: 'Fácil', normal: 'Normal', hard: 'Difícil', yours: 'Seus navios',
    rot: 'Girar (V)', clear: 'Limpar', shots: '{n} tiros', touchHint: 'Toque no tabuleiro para posicionar; toque num navio para tirar.',
    yourSea: 'Seu mar', theirSea: 'Mar de {name}', hit: 'Fogo!', miss: 'Água', sunk: 'Afundou: {ship}!', againShot: 'Acertou: atire de novo',
    win: 'Você afundou tudo!', lose: '{name} afundou sua frota', cant: 'Não cabe aí', left: '{n} navios restantes',
    s5: 'Porta-aviões', s4: 'Encouraçado', s3a: 'Cruzador', s3b: 'Submarino', s2: 'Destróier', cell: '{c}{r}',
  },
  en: {
    place: 'Place your ships.', placeHint: 'Click the board to place; R or right click rotates. Clicking a ship picks it up. Ships may touch but not overlap.',
    shuffle: 'Random', ready: 'Start', waitReady: 'Waiting for {name} to place…', fleetT: 'Your fleet', enemyT: 'Enemy fleet', count: '{n} of {t} ships',
    mode: 'Mode', mPc: 'Computer', mAtk: 'Attack only', mOn: 'Online', dPc: 'You build your fleet and trade shots with the computer.', dAtk: 'Only you shoot: sink the computer fleet in as few shots as you can.',
    dOn: 'You and {name} build your fleets and trade shots.', diff: 'Difficulty', easy: 'Easy', normal: 'Normal', hard: 'Hard', yours: 'Your ships',
    rot: 'Rotate (V)', clear: 'Clear', shots: '{n} shots', touchHint: 'Tap the board to place; tap a ship to pick it up.',
    yourSea: 'Your sea', theirSea: "{name}'s sea", hit: 'Hit!', miss: 'Miss', sunk: 'Sunk: {ship}!', againShot: 'Hit: shoot again',
    win: 'You sank them all!', lose: '{name} sank your fleet', cant: "Doesn't fit there", left: '{n} ships left',
    s5: 'Carrier', s4: 'Battleship', s3a: 'Cruiser', s3b: 'Submarine', s2: 'Destroyer', cell: '{c}{r}',
  },
});
const N = 10;
const FLEETS = { classica: [['s5', 5], ['s4', 4], ['s3a', 3], ['s3b', 3], ['s2', 2]], rapida: [['s4', 4], ['s3a', 3], ['s2', 2]] };
let FLEET = FLEETS.classica;
const cellsOf = (r, c, len, v) => Array.from({ length: len }, (_, k) => (v ? (r + k) * N + c : r * N + c + k));
function fits(r, c, len, v, taken) {
  if (v ? r + len > N : c + len > N) return false;
  if (r < 0 || c < 0) return false;
  // podem encostar, mas não ficar um sobre o outro
  for (const i of cellsOf(r, c, len, v)) if (taken.has(i)) return false;
  return true;
}
function randomFleet(fleet = FLEET) {
  for (let tries = 0; tries < 200; tries++) {
    const taken = new Set(), ships = [];
    let ok = true;
    for (const [id, len] of fleet) {
      let placed = false;
      for (let k = 0; k < 300 && !placed; k++) {
        const v = rand(2) === 1, r = rand(N), c = rand(N);
        if (fits(r, c, len, v, taken)) { const cells = cellsOf(r, c, len, v); cells.forEach((x) => taken.add(x)); ships.push({ id, len, r, c, v, cells }); placed = true; }
      }
      if (!placed) { ok = false; break; }
    }
    if (ok) return ships;
  }
  return [];
}
const LET = 'ABCDEFGHIJ';
/* Navios desenhados aqui, vistos de cima: casco com proa pontuda, convés e detalhes por tipo. */
const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, at) => { const n = document.createElementNS(SVGNS, tag); for (const k in at) n.setAttribute(k, at[k]); return n; };
/* posicionar: arrastar move o navio (encaixa na grade); tocar sem arrastar gira */
function dragShip(box, sh, n, grid, api) {
  let st = null;
  box.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const gr = grid.getBoundingClientRect(), cs = gr.width / N;
    const br = box.getBoundingClientRect();
    // em qual pedaço do navio a pessoa pegou
    const k = sh.v ? Math.floor((e.clientY - br.top) / cs) : Math.floor((e.clientX - br.left) / cs);
    st = { x: e.clientX, y: e.clientY, cs, gr, k: Math.max(0, Math.min(sh.len - 1, k)), moved: false, r: sh.cells[0] / N | 0, c: sh.cells[0] % N };
    box.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  box.addEventListener('pointermove', (e) => {
    if (!st) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (!st.moved && Math.hypot(dx, dy) < 6) return;
    st.moved = true; box.classList.add('dragging');
    box.style.transform = `translate(${dx}px, ${dy}px)`;
    const col = Math.floor((e.clientX - st.gr.left) / st.cs), row = Math.floor((e.clientY - st.gr.top) / st.cs);
    st.tr = sh.v ? row - st.k : row; st.tc = sh.v ? col : col - st.k;
  });
  const end = () => {
    if (!st) return;
    const s = st; st = null;
    box.classList.remove('dragging'); box.style.transform = '';
    if (!s.moved) { api.send({ k: 'rot', n }); return; }
    if (s.tr !== undefined && (s.tr !== s.r || s.tc !== s.c)) api.send({ k: 'move', n, r: s.tr, c: s.tc });
  };
  box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
}
/* acerto: marca queimada, chama em camadas e fumaça */
function fire() {
  const s = sv('svg', { viewBox: '0 0 40 40', class: 'nv-fire', 'aria-hidden': 'true' });
  s.append(sv('circle', { cx: 20, cy: 26, r: 11, class: 'nv-scorch' }),
    sv('path', { d: 'M20 6c3 6 10 9 10 18a10 10 0 0 1-20 0c0-5 3-7 4-11 1 3 3 4 3 4-1-5 1-8 3-11z', class: 'nv-f1' }),
    sv('path', { d: 'M20 15c2 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4 2.5-6.5.8 1.7 1.8 2.4 1.8 2.4-.4-3 .5-5 1.7-6.9z', class: 'nv-f2' }),
    sv('path', { d: 'M20 23c1 2 3 3 3 5a3 3 0 0 1-6 0c0-1.6 1-2.3 1.4-3.6.4.8.9 1.2.9 1.2-.2-1.4.2-2 .7-2.6z', class: 'nv-f3' }));
  return s;
}
function shipSvg(len, vert, id) {
  const L = len * 20;
  const s = sv('svg', { viewBox: vert ? `0 0 20 ${L}` : `0 0 ${L} 20`, class: 'nv-svg k-' + id, 'aria-hidden': 'true', preserveAspectRatio: 'none' });
  // desenhado sempre deitado (proa à direita); em pé é só girar o grupo
  const g = sv('g', vert ? { transform: 'translate(20 0) rotate(90)' } : {});
  s.append(g);
  const add = (tag, at) => { const n = sv(tag, at); g.append(n); return n; };
  if (id === 's3b') {
    // submarino: casco charuto escuro, torre e lemes
    add('path', { d: `M3 10C3 6.8 6 5.2 10 5.2H${L - 9}C${L - 4} 5.2 ${L - 1.5} 7.6 ${L - 1.5} 10S${L - 4} 14.8 ${L - 9} 14.8H10C6 14.8 3 13.2 3 10Z`, class: 'nv-sub' });
    add('path', { d: `M2 7.5L5 10 2 12.5Z`, class: 'nv-sub' });
    add('rect', { x: L * 0.42, y: 7.6, width: 11, height: 4.8, rx: 2.4, class: 'nv-tower' });
    add('line', { x1: L * 0.42 + 3, y1: 10, x2: L * 0.42 + 8, y2: 10, class: 'nv-line' });
    add('path', { d: `M8 10H${L - 12}`, class: 'nv-seam' });
    return s;
  }
  // casco: popa arredondada, proa em ponta
  add('path', { d: `M2.5 10C2.5 6 4 4 8 3.6L${L - 13} 3.4C${L - 7} 3.6 ${L - 3} 6.6 ${L - 1} 10C${L - 3} 13.4 ${L - 7} 16.4 ${L - 13} 16.6L8 16.4C4 16 2.5 14 2.5 10Z`, class: 'nv-hull' });
  add('path', { d: `M5 10C5 7.4 6 6 8.6 5.8L${L - 13} 5.7C${L - 8.5} 5.9 ${L - 5.5} 7.8 ${L - 4} 10C${L - 5.5} 12.2 ${L - 8.5} 14.1 ${L - 13} 14.3L8.6 14.2C6 14 5 12.6 5 10Z`, class: 'nv-deck' });
  // velas (só aparecem no tema pirata)
  for (let k = 0; k < Math.max(1, len - 2); k++) add('rect', { x: 10 + k * ((L - 26) / Math.max(1, len - 3)), y: 1.5, width: 4.5, height: 17, rx: 2, class: 'nv-sail' });
  const turret = (x, dir = 1) => { add('rect', { x: dir > 0 ? x : x - 7, y: 9.2, width: 7, height: 1.6, rx: .8, class: 'nv-barrel' }); add('circle', { cx: x, cy: 10, r: 2.8, class: 'nv-gun' }); };
  const bridge = (x, w) => { add('rect', { x, y: 6.8, width: w, height: 6.4, rx: 1.6, class: 'nv-tower' }); add('rect', { x: x + 1.4, y: 8.2, width: w - 2.8, height: 1.4, rx: .7, class: 'nv-win' }); add('circle', { cx: x + w / 2, cy: 11.3, r: 1, class: 'nv-mast' }); };
  if (id === 's5') {
    // porta-aviões: pista com faixa tracejada, pista inclinada, ilha e dois aviões
    add('path', { d: `M8 10H${L - 10}`, class: 'nv-strip' });
    add('path', { d: `M10 14L${L * 0.45} 7`, class: 'nv-angle' });
    add('rect', { x: L * 0.6, y: 3.2, width: 10, height: 3.4, rx: 1.2, class: 'nv-tower' });
    for (const x of [L * 0.26, L * 0.78]) add('path', { d: `M${x} 10l3-1.2v-1.6l1 2.2 3 .6-3 .6-1 2.2v-1.6z`, class: 'nv-plane' });
  } else if (id === 's4') { turret(L - 22); turret(L - 31); bridge(L * 0.38, 12); turret(14, -1); }
  else if (id === 's3a') { turret(L - 20); bridge(L * 0.36, 11); turret(13, -1); }
  else { bridge(L * 0.3, 9); turret(L - 16); }
  return s;
}

export default {
  start(ctx) {
    let seenLast = '', sel = null, vert = false, hover = -1, preview = () => {};
    const onKey = (e) => { if (/^(INPUT|TEXTAREA)$/.test(e.target && e.target.tagName)) return; if (e.key === 'r' || e.key === 'R' || e.key === 'v' || e.key === 'V') { vert = !vert; preview(); } };
    addEventListener('keydown', onKey);
    const h = hosted(ctx, {
      init(prev) {
        const starter = firstSeat(ctx, prev);
        const op = ctx.opts || {};
        const o = prev ? prev.o : { again: op.again !== false, fleet: FLEETS[op.fleet] ? op.fleet : 'classica', attack: false };
        return { o, ph: 'place', ships: [[], ctx.bot ? randomFleet(FLEETS[o.fleet]) : []], ready: [false, false], shots: [[], []], turn: starter, starter, over: false, winner: null, score: prev ? prev.score : [0, 0], last: null };
      },
      act(S, seat, a, api) {
        if (S.over) return false;
        if (S.ph === 'place') {
          if (S.ready[seat] && a.k !== 'unready') return false;
          if (a.k === 'shuffle') { S.ships[seat] = randomFleet(FLEETS[S.o.fleet]); return; }
          if (a.k === 'rot') {
            const sh = S.ships[seat][a.n | 0]; if (!sh) return false;
            const taken = new Set(S.ships[seat].filter((x) => x !== sh).flatMap((x) => x.cells));
            // tenta girar no lugar; se não couber, procura a posição mais perto
            const cand = [[sh.r, sh.c]];
            for (let d = 1; d < N; d++) cand.push([sh.r - d, sh.c], [sh.r, sh.c - d], [sh.r + d, sh.c], [sh.r, sh.c + d]);
            for (const [r, c] of cand) if (fits(r, c, sh.len, !sh.v, taken)) { Object.assign(sh, { r, c, v: !sh.v, cells: cellsOf(r, c, sh.len, !sh.v) }); return; }
            return false;
          }
          if (a.k === 'move') {
            const sh = S.ships[seat][a.n | 0]; if (!sh) return false;
            const r = a.r | 0, c = a.c | 0;
            const taken = new Set(S.ships[seat].filter((x) => x !== sh).flatMap((x) => x.cells));
            if (!fits(r, c, sh.len, sh.v, taken)) return false;
            Object.assign(sh, { r, c, cells: cellsOf(r, c, sh.len, sh.v) });
            return;
          }
          const fl = FLEETS[S.o.fleet];
          if (a.k === 'put') {
            const def = fl.find(([id]) => id === a.id); if (!def || S.ships[seat].some((x) => x.id === a.id)) return false;
            const r = a.r | 0, c = a.c | 0, v = !!a.v, len = def[1];
            if (!fits(r, c, len, v, new Set(S.ships[seat].flatMap((x) => x.cells)))) return false;
            S.ships[seat].push({ id: a.id, len, r, c, v, cells: cellsOf(r, c, len, v) });
            return;
          }
          if (a.k === 'take') { const n = a.n | 0; if (!S.ships[seat][n]) return false; S.ships[seat].splice(n, 1); return; }
          if (a.k === 'clear') { S.ships[seat] = []; return; }
          if (a.k === 'mode') { if (seat !== 0 || !ctx.bot) return false; S.o.attack = a.m === 'attack'; return; }
          if (a.k === 'ready') {
            const atk = S.o.attack && seat === 0;
            if (!atk && S.ships[seat].length !== fl.length) return false;
            S.ready[seat] = true;
            if (atk) { S.ready[1] = true; S.turn = 0; S.shotsN = 0; }
            if (ctx.bot && seat === 0) S.ready[1] = true;   // o computador já está pronto
            if (S.ready[0] && S.ready[1]) S.ph = 'battle';
            return;
          }
          return false;
        }
        if (a.k !== 'shot' || S.turn !== seat) return false;
        const i = a.i | 0; if (i < 0 || i >= N * N) return false;
        if (S.shots[seat].some((x) => x.i === i)) return false;
        const enemy = S.ships[1 - seat];
        const ship = enemy.find((sh) => sh.cells.includes(i));
        const shot = { i, hit: !!ship };
        S.shots[seat].push(shot);
        let sunk = null;
        if (ship && ship.cells.every((x) => S.shots[seat].some((y) => y.i === x))) { ship.sunk = true; sunk = ship.id; }
        S.last = { by: seat, i, hit: !!ship, sunk };
        if (enemy.every((sh) => sh.sunk)) { S.over = true; S.winner = seat; S.score[seat]++; api.result(seat); return; }
        if (S.o.attack) { S.shotsN = (S.shotsN || 0) + 1; return; }
        if (!ship || !S.o.again) S.turn = 1 - seat;
      },
      view(S, s) {
        const o = 1 - s;
        return {
          o: S.o, shotsN: S.shotsN || S.shots[0].length, ph: S.ph, ready: S.ready, turn: S.turn, over: S.over, winner: S.winner, score: S.score, last: S.last,
          mine: S.ships[s], theirShots: S.shots[o], myShots: S.shots[s],
          theirShips: S.ships[o].filter((sh) => sh.sunk || S.over).map((sh) => ({ id: sh.id, cells: sh.cells, v: sh.v, len: sh.len, sunk: !!sh.sunk })),
          theirLeft: S.ships[o].filter((sh) => !sh.sunk).length, myLeft: S.ships[s].filter((sh) => !sh.sunk).length,
        };
      },
      bot(v, _S, lvl) {
        if (v.ph === 'place') return null;   // a frota do computador já vem posicionada; ele espera você começar
        if (v.turn !== 1 || v.o.attack) return null;
        const level = (lvl && lvl.level) || 'normal';
        if (level === 'easy' && Math.random() < 0.6) { const free = []; const st = new Set(v.myShots.map((x) => x.i)); for (let i = 0; i < N * N; i++) if (!st.has(i)) free.push(i); return { a: { k: 'shot', i: free[rand(free.length)] }, ms: think(700, 1200) }; }
        // caça e alvo: segue acertos ainda não afundados; senão, procura em xadrez (paridade 2)
        const shot = new Set(v.myShots.map((x) => x.i));
        const sunkCells = new Set(v.theirShips.filter((x) => x.sunk).flatMap((x) => x.cells));
        const open = v.myShots.filter((x) => x.hit && !sunkCells.has(x.i)).map((x) => x.i);
        const ok = (i) => i >= 0 && i < N * N && !shot.has(i);
        const nb = (i) => [i % N ? i - 1 : -1, i % N < N - 1 ? i + 1 : -1, i - N, i + N].filter(ok);
        let pick = [];
        if (open.length >= 2) {
          const sameRow = open.every((i) => Math.floor(i / N) === Math.floor(open[0] / N));
          const sorted = open.slice().sort((a, b) => a - b), st = sameRow ? 1 : N;
          const ends = [sorted[0] - st, sorted[sorted.length - 1] + st].filter((i) => ok(i) && (!sameRow || Math.floor(i / N) === Math.floor(sorted[0] / N)));
          pick = ends;
        }
        if (!pick.length && open.length) pick = open.flatMap(nb);
        if (!pick.length) {
          const free = []; for (let i = 0; i < N * N; i++) if (ok(i) && (Math.floor(i / N) + i) % 2 === 0) free.push(i);
          pick = free.length ? free : Array.from({ length: N * N }, (_, i) => i).filter(ok);
        }
        return { a: { k: 'shot', i: pick[rand(pick.length)] }, ms: think(700, 1200) };
      },
      render(v, api) {
        FLEET = FLEETS[v.o.fleet] || FLEETS.classica;
        const me = ctx.seat, other = 1 - me;
        const label = (i) => tr('cell', { c: LET[i % N], r: Math.floor(i / N) + 1 });
        const lastKey = v.last ? `${v.last.by}-${v.last.i}` : '';
        const fresh = lastKey && lastKey !== seenLast;
        seenLast = lastKey;
        const fl = FLEETS[v.o.fleet] || FLEETS.classica;
        const placing = v.ph === 'place' && !v.ready[me];
        if (placing) {
          const placed = new Set(v.mine.map((x) => x.id));
          if (!sel || placed.has(sel)) sel = (fl.find(([id]) => !placed.has(id)) || [null])[0];
        }
        // tabuleiro com letras e números, casas em xadrez escuro
        function board(kind, size) {
          const g = el('div', { class: 'nv-grid ' + kind, role: 'grid' });
          const ships = kind === 'enemy' ? v.theirShips : v.mine;
          const shots = new Map((kind === 'enemy' ? v.myShots : v.theirShots).map((x) => [x.i, x]));
          const edit = kind === 'mine' && placing;
          ships.forEach((sh, n) => {
            const r0 = Math.floor(sh.cells[0] / N), c0 = sh.cells[0] % N;
            const box = el(edit ? 'button' : 'span', { class: 'nv-ship' + (sh.sunk ? ' sunk' : '') + (sh.v ? ' v' : ''), type: edit ? 'button' : null, 'aria-label': tr(sh.id) });
            box.style.gridRow = `${r0 + 1} / span ${sh.v ? sh.len : 1}`;
            box.style.gridColumn = `${c0 + 1} / span ${sh.v ? 1 : sh.len}`;
            box.append(shipSvg(sh.len, sh.v, sh.id));
            // clicar num navio o tira do lugar (e ele fica escolhido para pôr de novo)
            if (edit) box.addEventListener('click', () => { sel = sh.id; vert = sh.v; api.send({ k: 'take', n }); });
            g.append(box);
          });
          const cellEls = [];
          for (let i = 0; i < N * N; i++) {
            const sh = shots.get(i);
            const canShoot = kind === 'enemy' && v.ph === 'battle' && !v.over && v.turn === me && !sh;
            const rr = Math.floor(i / N), cc = i % N;
            let cls = 'nv-c ' + ((rr + cc) % 2 ? 'dk' : 'lt');
            if (sh) cls += sh.hit ? ' hit' : ' miss';
            const isLast = v.last && v.last.i === i && ((kind === 'enemy') === (v.last.by === me));
            if (isLast) cls += ' last' + (fresh ? ' fresh' : '');
            const b = el(canShoot || edit ? 'button' : 'span', { class: cls, type: canShoot || edit ? 'button' : null, 'aria-label': label(i) + (sh ? ' ' + (sh.hit ? tr('hit') : tr('miss')) : '') });
            b.style.gridRow = String(rr + 1); b.style.gridColumn = String(cc + 1);
            if (sh && sh.hit) b.append(fire());
            if (sh && !sh.hit) b.append(el('i', { class: 'nv-x' }));
            if (canShoot) b.addEventListener('click', () => api.send({ k: 'shot', i }));
            if (edit) {
              b.addEventListener('pointerenter', () => { hover = i; preview(); });
              b.addEventListener('click', () => { if (!sel) return; const len = fl.find(([id]) => id === sel)[1]; api.send({ k: 'put', id: sel, r: rr, c: cc, v: vert && len > 0 }); });
            }
            cellEls.push(b);
            g.append(b);
          }
          if (edit) {
            // prévia de onde o navio escolhido vai ficar
            const taken = new Set(v.mine.flatMap((x) => x.cells));
            preview = () => {
              cellEls.forEach((c) => c.classList.remove('pv', 'bad'));
              if (hover < 0 || !sel) return;
              const len = fl.find(([id]) => id === sel)[1];
              const r = Math.floor(hover / N), c = hover % N;
              const ok = fits(r, c, len, vert, taken);
              for (let k = 0; k < len; k++) { const rr = vert ? r + k : r, cc = vert ? c : c + k; if (rr < N && cc < N) cellEls[rr * N + cc].classList.add(ok ? 'pv' : 'bad'); }
            };
            g.addEventListener('pointerleave', () => { hover = -1; preview(); });
            g.addEventListener('contextmenu', (e) => { e.preventDefault(); vert = !vert; preview(); });
            preview();
          }
          return el('div', { class: 'nv-frame ' + size },
            el('span'),
            el('div', { class: 'nv-cols' }, ...[...LET].map((x) => el('span', { text: x }))),
            el('div', { class: 'nv-rows' }, ...Array.from({ length: N }, (_, k) => el('span', { text: String(k + 1) }))),
            g);
        }
        const card = (title, right, inner, cls = '') => el('section', { class: 'nv-card ' + cls }, el('header', { class: 'nv-ch' }, el('b', { text: title }), el('span', { text: right })), inner);
        const seg = (items, cur, onPick) => el('div', { class: 'nv-seg' }, ...items.map(([k, label, dis]) => el('button', { type: 'button', class: k === cur ? 'on' : '', disabled: !!dis, text: label, onClick: () => onPick(k) })));
        const lab = (t) => el('h5', { class: 'nv-lab', text: t });
        let body;
        if (v.ph === 'place') {
          const n = v.mine.length;
          const isBot = !!ctx.bot;
          const mode = isBot ? (v.o.attack ? 'attack' : 'pc') : 'online';
          const placedIds = new Set(v.mine.map((x) => x.id));
          const shipRow = ([id, len]) => {
            const done = placedIds.has(id);
            const ic = el('span', { class: 'nv-li-ic' }, shipSvg(len, false, id)); ic.style.width = len * 13 + 'px';
            return el('button', { class: 'nv-li' + (sel === id && placing ? ' on' : '') + (done ? ' done' : ''), type: 'button', disabled: !placing,
              onClick: () => { if (done) { const k = v.mine.findIndex((x) => x.id === id); sel = id; api.send({ k: 'take', n: k }); } else { sel = id; this.render(v, api); } } },
              ic, el('span', { class: 'nv-li-n' }, el('span', { text: tr(id) }), done ? el('i', { class: 'nv-ok', text: '✓' }) : null),
              el('span', { class: 'nv-li-sq' }, ...Array.from({ length: len }, () => el('i'))));
          };
          const self = this;
          const panel = el('aside', { class: 'nv-panel' },
            lab(tr('mode')),
            seg([['pc', tr('mPc'), !isBot], ['attack', tr('mAtk'), !isBot || !placing], ['online', tr('mOn'), isBot]], mode, (k) => { if (isBot && placing) api.send({ k: 'mode', m: k }); }),
            el('p', { class: 'nv-desc', text: mode === 'pc' ? tr('dPc') : mode === 'attack' ? tr('dAtk') : tr('dOn', { name: ctx.names[other] }) }),
            isBot ? lab(tr('diff')) : null,
            isBot ? seg([['easy', tr('easy')], ['normal', tr('normal')], ['hard', tr('hard')]], ctx.bot.level || 'normal', (k) => { ctx.bot.level = k; self.render(v, api); }) : null,
            mode !== 'attack' ? lab(tr('yours')) : null,
            mode !== 'attack' ? el('div', { class: 'nv-list' }, ...fl.map(shipRow)) : null,
            mode !== 'attack' && placing ? el('div', { class: 'nv-btns' },
              el('button', { class: 'nv-b', type: 'button', text: tr('rot'), onClick: () => { vert = !vert; preview(); } }),
              el('button', { class: 'nv-b', type: 'button', text: tr('shuffle'), onClick: () => api.send({ k: 'shuffle' }) }),
              el('button', { class: 'nv-b', type: 'button', text: tr('clear'), onClick: () => api.send({ k: 'clear' }) })) : null,
            v.ready[me]
              ? el('div', { class: 'gk-wait' }, el('span', { class: 'gk-dots' }, el('i'), el('i'), el('i')), el('span', { text: tr('waitReady', { name: ctx.names[other] }) }))
              : el('button', { class: 'nv-go', type: 'button', disabled: mode !== 'attack' && n !== fl.length, text: tr('ready'), onClick: () => api.send({ k: 'ready' }) }),
            mode !== 'attack' ? el('p', { class: 'nv-help', text: matchMedia('(pointer: coarse)').matches ? tr('touchHint') : tr('placeHint') }) : null);
          body = el('div', { class: 'nv-setup' },
            el('div', { class: 'nv-left' }, el('p', { class: 'nv-top', text: tr('place') }),
              mode === 'attack' ? card(tr('enemyT'), tr('count', { n: fl.length, t: fl.length }), board('enemy', 'big')) : card(tr('fleetT'), tr('count', { n, t: fl.length }), board('mine', 'big'))),
            panel);
        } else {
          let msg = '';
          if (v.last && fresh && v.last.sunk) msg = tr('sunk', { ship: tr(v.last.sunk) });
          const mySunk = v.mine.filter((sh) => sh.sunk).map((sh) => sh.id);
          const fleetRow = (sunkIds) => {
            const left = [...sunkIds];
            return el('div', { class: 'nv-fleet' }, ...fl.map(([id, len]) => {
              const k = left.indexOf(id); const dead = k >= 0; if (dead) left.splice(k, 1);
              const sp = el('span', { class: 'nv-fl' + (dead ? ' dead' : ''), title: tr(id) }, shipSvg(len, false, id));
              sp.style.width = len * 12 + 'px';
              return sp;
            }));
          };
          body = el('div', { class: 'nv-battle' + (v.o.attack ? ' solo' : '') },
            card(v.o.attack ? tr('enemyT') : tr('theirSea', { name: ctx.names[other] }), v.o.attack ? tr('shots', { n: v.shotsN || 0 }) : tr('left', { n: v.theirLeft }),
              el('div', { class: 'nv-sea enemy' + (v.turn === me && !v.over ? ' aim' : '') }, board('enemy', 'big'), fleetRow(v.theirShips.filter((x) => x.sunk).map((x) => x.id)))),
            v.o.attack ? null : card(tr('fleetT'), tr('left', { n: v.myLeft }), el('div', { class: 'nv-sea mine' }, board('mine', 'small'), fleetRow(mySunk)), 'small'),
            msg ? el('div', { class: 'nv-msg' + (v.last.by === me ? ' good' : ''), text: msg }) : null);
        }
        const head = v.ph === 'battle' && !v.o.attack ? seats(ctx, v, { turn: !v.over ? v.turn : null, score: v.score }) : null;
        const kids = [head, v._here ? (v.ph === 'battle' && !v.over && !v.o.attack ? turnLine(ctx, v, v.turn) : null) : waitingPeer(ctx), body].filter(Boolean);
        if (v.over) kids.push(endBox(ctx, v, api, { title: v.winner === me ? tr('win') : tr('lose', { name: ctx.names[other] }), detail: v.o.attack ? tr('shots', { n: v.shotsN || 0 }) : '', tone: v.winner === me ? 'win' : '' }));
        ctx.root.replaceChildren(el('div', { class: 'gk nv' }, ...kids));
      },
    });
    return { destroy() { removeEventListener('keydown', onKey); h.destroy(); } };
  },
};
