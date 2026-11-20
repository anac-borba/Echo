'use strict';
// Tetris versus (2 jogadoras). Cada uma joga o seu tabuleiro; o da outra aparece ao vivo (estado compacto ~10 Hz).
// Seat 0 sorteia a semente do 7-bag. Linhas de lixo: 2 linhas = 1, 3 = 2, 4 = 4. Perde quem topa.
import { getLang } from '../i18n.js';
import { el, avatar, displayName } from '../util.js';
import { api } from '../api.js';
import { D, userById } from '../state.js';

const L = {
  pt: {
    holdT: 'Guardada', nextT: 'Próximas', ctrlT: 'Controles', topT: 'Melhores jogadores', recordL: 'Recorde', pause: 'Pausar (P)', unpause: 'Continuar (P)',
    kMove: 'mover', kDown: 'descer mais rápido', kRot: 'girar', kRotB: 'girar ao contrário', kSpace: 'Espaço', kDrop: 'soltar', kHold: 'guardar peça', kPause: 'pausar', noTop: 'Jogue para entrar no placar.',
    hold: 'Guardar', next: 'Próxima', score: 'Pontos', level: 'Nível', lines: 'Linhas', you: 'Você', waiting: 'Esperando {name}…',
    win: 'Você venceu!', lose: 'Você topou!', draw: 'Empate!', again: 'Jogar de novo', waitAgain: 'Esperando {name} aceitar…',
    left: 'Esquerda', right: 'Direita', down: 'Descer', rot: 'Girar', drop: 'Queda rápida', holdBtn: 'Guardar peça',
    tetris: 'Tetris!', hint: 'Setas/WASD mover · ↑/X girar · Z girar ao contrário · Espaço queda · C guardar', garbage: 'Linhas a caminho',
    board: 'Seu tabuleiro', oppBoard: 'Tabuleiro de {name}',
    solo: 'Fim de jogo', record: 'Novo recorde!', best: 'Recorde: {n}', paused: 'Pausado', resume: 'Continuar', pts: '{n} pontos',
  },
  en: {
    holdT: 'Hold', nextT: 'Next', ctrlT: 'Controls', topT: 'Top players', recordL: 'Best', pause: 'Pause (P)', unpause: 'Resume (P)',
    kMove: 'move', kDown: 'soft drop', kRot: 'rotate', kRotB: 'rotate back', kSpace: 'Space', kDrop: 'hard drop', kHold: 'hold piece', kPause: 'pause', noTop: 'Play to get on the board.',
    hold: 'Hold', next: 'Next', score: 'Score', level: 'Level', lines: 'Lines', you: 'You', waiting: 'Waiting for {name}…',
    win: 'You won!', lose: 'You topped out!', draw: 'Draw!', again: 'Play again', waitAgain: 'Waiting for {name} to accept…',
    left: 'Left', right: 'Right', down: 'Down', rot: 'Rotate', drop: 'Hard drop', holdBtn: 'Hold piece',
    tetris: 'Tetris!', hint: 'Arrows/WASD move · Up/X rotate · Z rotate back · Space drop · C hold', garbage: 'Incoming garbage',
    board: 'Your board', oppBoard: "{name}'s board",
    solo: 'Game over', record: 'New record!', best: 'Best: {n}', paused: 'Paused', resume: 'Resume', pts: '{n} points',
  },
};
const tr = (k, v) => {
  let s = (L[getLang()] || L.pt)[k] ?? L.pt[k] ?? k;
  if (v) for (const [a, b] of Object.entries(v)) s = s.replaceAll('{' + a + '}', b);
  return s;
};

const COLS = 10, ROWS = 22, HID = 2, VIS = 20;
const TYPES = 'IJLOSTZ';
const COLORS = ['', '#5DD3E8', '#3F73E3', '#F39A3B', '#F3D14B', '#74D98B', '#B652D9', '#E5554F', '#6B6F7E']; // 1..7 peças (I J L O S T Z), 8 lixo
const BASE = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
  L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]],
  O: [[1, 1], [1, 1]],
  S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
  T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
  Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
};
const rotCw = (m) => m.map((_, r) => m.map((__, c) => m[m.length - 1 - c][r]));
const SHAPES = {};
for (const t of TYPES) {
  let m = BASE[t]; SHAPES[t] = [];
  for (let r = 0; r < 4; r++) {
    const cells = [];
    m.forEach((row, y) => row.forEach((v, x) => { if (v) cells.push([x, y]); }));
    SHAPES[t].push(cells); m = rotCw(m);
  }
}
// SRS (y para cima na tabela; invertido ao usar)
const K_JLSTZ = {
  '01': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]], '10': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '12': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]], '21': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '23': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]], '32': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '30': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]], '03': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};
const K_I = {
  '01': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]], '10': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '12': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]], '21': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '23': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]], '32': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '30': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]], '03': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const SVGNS = 'http://www.w3.org/2000/svg';
function svgIcon(d) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'g-tetris-ico'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVGNS, 'path');
  p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '2.4'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
  s.append(p); return s;
}
const ICONS = {
  left: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7', down: 'M5 9l7 7 7-7',
  rot: 'M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5', drop: 'M6 5l6 6 6-6M6 13l6 6 6-6', hold: 'M4 7h12M4 7l4-4M4 7l4 4M20 17H8m12 0l-4-4m4 4l-4 4',
};

const SOFT_MIN = 17, LOCK_MS = 500, MAX_RESETS = 15, DAS = 160, ARR = 48, STEP = 1000 / 60;
const gravityMs = (lv) => Math.max(16, Math.pow(0.8 - (lv - 1) * 0.007, lv - 1) * 1000);

export default {
  start(ctx) {
    const seat = ctx.seat;
    const solo = !!ctx.solo;
    const bestKey = 'tl.tetris.best.' + (ctx.me && ctx.me.id || '');
    const getBest = () => { try { return Number(localStorage.getItem(bestKey)) || 0; } catch { return 0; } };
    let newRecord = false, paused = false;
    const myName = ctx.names[seat] || '?';
    const peerName = ctx.names[1 - seat] || '?';
    let destroyed = false;
    const cleanups = [];
    const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); cleanups.push(() => t.removeEventListener(type, fn, o)); };

    // ---------- UI (três colunas: guardada/placar à esquerda, tabuleiro no meio, próximas/controles à direita) ----------
    const myCanvas = el('canvas', { class: 'g-tetris-board tx-board', width: COLS * 36, height: VIS * 36, role: 'img', 'aria-label': tr('board') });
    const opCanvas = el('canvas', { class: 'g-tetris-board g-tetris-opboard', width: COLS * 20, height: VIS * 20, role: 'img', 'aria-label': tr('oppBoard', { name: peerName }) });
    const holdCanvas = el('canvas', { class: 'g-tetris-mini tx-hold', width: 160, height: 90 });
    const nextCanvas = el('canvas', { class: 'g-tetris-mini tx-next', width: 160, height: 270 });
    const myGbar = el('i', { class: 'g-tetris-gbar', title: tr('garbage') });
    const opGbar = el('i', { class: 'g-tetris-gbar', title: tr('garbage') });
    const overlay = el('div', { class: 'g-tetris-overlay' });
    const statScore = el('b', { text: '0' }), statLevel = el('b', { text: '1' }), statLines = el('b', { text: '0' }), statBest = el('b', { class: 'tx-rec', text: '0' });
    const opScore = el('span', { text: '0' }), opLines = el('span', { text: '0' });
    const status = el('div', { class: 'g-tetris-status', 'aria-live': 'polite' });
    const row = (label, b) => el('div', { class: 'tx-row' }, el('span', { text: label }), b);
    const label = (t) => el('h6', { class: 'tx-lab', text: t });
    const pauseBtn = el('button', { class: 'tx-pause', type: 'button', text: tr('pause'), onClick: () => setPause(!paused) });
    const topList = el('div', { class: 'tx-top' }, el('p', { class: 'tx-none', text: '…' }));
    const key = (...k) => el('span', { class: 'tx-keys' }, ...k.map((x) => el('kbd', { text: x })));
    const ctl = (keys, txt) => el('div', { class: 'tx-ctl' }, keys, el('span', { text: txt }));
    const leftCol = el('div', { class: 'tx-col tx-l' },
      el('section', { class: 'tx-card tx-holdc' }, label(tr('holdT')), holdCanvas),
      el('section', { class: 'tx-card tx-stats' }, row(tr('score'), statScore), row(tr('level'), statLevel), row(tr('lines'), statLines), solo ? row(tr('recordL'), statBest) : null),
      solo ? pauseBtn : null,
      solo ? el('section', { class: 'tx-card tx-topc' }, label(tr('topT')), topList) : null);
    const mine = el('div', { class: 'g-tetris-me tx-c' },
      el('div', { class: 'g-tetris-name', text: myName }),
      el('div', { class: 'g-tetris-bw tx-bw' }, myGbar, myCanvas, overlay));
    const opp = el('section', { class: 'tx-card g-tetris-op' },
      label(peerName),
      el('div', { class: 'g-tetris-bw' }, opGbar, opCanvas),
      el('div', { class: 'g-tetris-opstats' }, opScore, el('span', { class: 'muted', text: ' · ' }), opLines, el('span', { class: 'muted', text: ' ' + tr('lines').toLowerCase() })));
    const rightCol = el('div', { class: 'tx-col tx-r' },
      el('section', { class: 'tx-card tx-nextc' }, label(tr('nextT')), nextCanvas),
      solo ? null : opp,
      el('section', { class: 'tx-card tx-ctrlc' }, label(tr('ctrlT')),
        ctl(key('←', '→'), tr('kMove')), ctl(key('↓'), tr('kDown')), ctl(key('↑', 'X'), tr('kRot')), ctl(key('Z'), tr('kRotB')),
        ctl(key(tr('kSpace')), tr('kDrop')), ctl(key('C'), tr('kHold')), solo ? ctl(key('P'), tr('kPause')) : null));
    // placar: você e seus amigos (recorde de cada um)
    const drawTop = (rows) => {
      if (!rows.length) { topList.replaceChildren(el('p', { class: 'tx-none', text: tr('noTop') })); return; }
      topList.replaceChildren(...rows.slice(0, 5).map((r, i) => {
        const u = r.uid === D.me.id ? D.me : (userById(r.uid) || { id: r.uid, name: '…' });
        return el('div', { class: 'tx-tr' + (r.uid === D.me.id ? ' me' : '') + ' p' + (i + 1) },
          el('span', { class: 'tx-rk', text: String(i + 1) }), avatar(u, 'sm'), el('span', { class: 'tx-nm', text: displayName(u) }), el('b', { text: r.score.toLocaleString() }));
      }));
    };
    const loadTop = () => api('GET', '/games/best/tetris').then((j) => {
      const rows = j.rows || [];
      const mineRow = rows.find((r) => r.uid === D.me.id);
      if (mineRow && mineRow.score > getBest()) { try { localStorage.setItem(bestKey, String(mineRow.score)); } catch {} }
      if (getBest() > 0 && (!mineRow || mineRow.score < getBest())) { api('POST', '/games/best', { game: 'tetris', score: getBest() }).then(loadTop).catch(() => {}); }
      statBest.textContent = getBest().toLocaleString();
      drawTop(rows);
    }).catch(() => drawTop([]));
    if (solo) { statBest.textContent = getBest().toLocaleString(); loadTop(); }

    const held = {};
    const btn = (act, icon, label, extra = '') => {
      const b = el('button', { class: 'g-tetris-key ' + extra, type: 'button', 'aria-label': label }, svgIcon(ICONS[icon]));
      const down = (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch {} press(act); };
      const up = () => release(act);
      on(b, 'pointerdown', down); on(b, 'pointerup', up); on(b, 'pointercancel', up); on(b, 'lostpointercapture', up);
      on(b, 'contextmenu', (e) => e.preventDefault());
      on(b, 'mousedown', (e) => e.preventDefault());
      return b;
    };
    const ctrl = el('div', { class: 'g-tetris-ctrl' },
      btn('hold', 'hold', tr('holdBtn')), btn('left', 'left', tr('left')), btn('down', 'down', tr('down')),
      btn('right', 'right', tr('right')), btn('rotcw', 'rot', tr('rot')), btn('hard', 'drop', tr('drop'), 'g-tetris-key-main'));

    ctx.root.append(el('div', { class: 'g-tetris tx' + (solo ? ' g-tetris-solo' : '') },
      el('div', { class: 'tx-cols' }, leftCol, mine, rightCol),
      status, ctrl));

    // ---------- estado ----------
    let phase = 'wait';       // wait | count | play | over
    let result = null;        // win | lose | draw
    let round = -1, seed = 0, rng = Math.random;
    let board, piece, hold, holdUsed, queue, score, lines, level, pendingG;
    let gravT, lockT, resets, lowest, countT, sendT, statusT = 0, wantAgain = false;
    let opState = null, opDirty = true;
    let overlayKey = '';
    const colors = { bg: '#1c1c1e', grid: 'rgba(255,255,255,.05)' };

    const newBoard = () => Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
    board = newBoard(); queue = []; score = 0; lines = 0; level = 1; pendingG = 0;

    function refill() {
      while (queue.length < 7) {
        const bag = TYPES.split('');
        for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
        queue.push(...bag);
      }
    }
    function begin(s, r) {
      seed = s; round = r; rng = mulberry32(seed); queue = []; refill();
      board = newBoard(); piece = null; hold = null; holdUsed = false; score = 0; lines = 0; level = 1; pendingG = 0;
      gravT = 0; lockT = 0; resets = 0; lowest = 0; sendT = 0; countT = 3000; phase = 'count'; result = null; wantAgain = false;
      opState = null; opDirty = true; for (const k of Object.keys(held)) delete held[k];
      setStatus('');
      sendState();
    }
    const cellsOf = (p, dx = 0, dy = 0, r = p.r) => SHAPES[p.t][r].map(([x, y]) => [p.x + x + dx, p.y + y + dy]);
    function collide(p, dx = 0, dy = 0, r = p.r) {
      for (const [x, y] of cellsOf(p, dx, dy, r)) {
        if (x < 0 || x >= COLS || y < 0 || y >= ROWS || board[y][x]) return true;
      }
      return false;
    }
    function place(t) {
      piece = { t, r: 0, x: t === 'O' ? 4 : 3, y: 1 };
      if (collide(piece)) { piece.y = 0; if (collide(piece)) { gameOver('lose'); return; } }
      gravT = 0; lockT = 0; resets = 0; lowest = piece.y;
    }
    function spawnNext() { const t = queue.shift(); refill(); place(t); }
    function afterMove() { if (lockT > 0 && resets < MAX_RESETS) { lockT = 0; resets++; } }

    function move(dx) { if (piece && !collide(piece, dx, 0)) { piece.x += dx; afterMove(); return true; } return false; }
    function rotate(dir) {
      if (!piece || piece.t === 'O') return;
      const to = (piece.r + dir + 4) % 4;
      const tab = (piece.t === 'I' ? K_I : K_JLSTZ)[`${piece.r}${to}`];
      for (const [kx, ky] of tab) {
        if (!collide(piece, kx, -ky, to)) { piece.x += kx; piece.y -= ky; piece.r = to; afterMove(); return; }
      }
    }
    function softStep() {
      if (piece && !collide(piece, 0, 1)) { piece.y++; score++; if (piece.y > lowest) { lowest = piece.y; resets = 0; lockT = 0; } }
    }
    function hardDrop() {
      if (!piece) return;
      while (!collide(piece, 0, 1)) { piece.y++; score += 2; }
      lockPiece();
    }
    function doHold() {
      if (!piece || holdUsed) return;
      const cur = piece.t;
      if (hold) place(hold); else spawnNext();
      hold = cur; holdUsed = true;
    }
    function lockPiece() {
      let out = true;
      for (const [x, y] of cellsOf(piece)) { board[y][x] = TYPES.indexOf(piece.t) + 1; if (y >= HID) out = false; }
      const keep = board.filter((r) => r.some((c) => !c));
      const n = ROWS - keep.length;
      if (n) {
        board = Array.from({ length: n }, () => new Array(COLS).fill(0)).concat(keep);
        const pts = [0, 100, 300, 500, 800][n] * level;
        score += pts;
        lines += n; level = 1 + Math.floor(lines / 10);
        let atk = [0, 0, 1, 2, 4][n];
        const c = Math.min(atk, pendingG); pendingG -= c; atk -= c;
        if (atk > 0) ctx.send({ k: 'g', n: atk });
        setStatus(n === 4 ? tr('tetris') + ' +' + pts : '+' + pts);
      }
      piece = null;
      if (out) { gameOver('lose'); return; }
      if (!n && pendingG > 0) { if (!addGarbage(Math.min(pendingG, 10))) return; pendingG = 0; }
      holdUsed = false;
      spawnNext();
      if (phase === 'play') sendState();
    }
    function addGarbage(k) {
      if (board.slice(0, k).some((r) => r.some((c) => c))) { gameOver('lose'); return false; }
      board.splice(0, k);
      for (let i = 0; i < k; i++) { const row = new Array(COLS).fill(8); row[Math.floor(Math.random() * COLS)] = 0; board.push(row); }
      return true;
    }
    // histórico: quem venceu (só o anfitrião registra, para não contar duas vezes)
    function report(res) { if (solo) return; if (seat === 0 && ctx.result) ctx.result({ winner: res === 'win' ? 0 : res === 'lose' ? 1 : -1, score: [score, peerScore()] }); }
    function peerScore() { return (opState && opState.sc) || 0; }
    function gameOver(res) {
      if (solo) {
        res = 'solo';
        const best = getBest(); newRecord = score > best;
        if (newRecord) { try { localStorage.setItem(bestKey, String(score)); } catch {} statBest.textContent = score.toLocaleString(); }
        if (score > 0) api('POST', '/games/best', { game: 'tetris', score }).then(loadTop).catch(() => {});
      }
      phase = 'over'; result = res; piece = null; report(res);
      for (const k of Object.keys(held)) delete held[k];
      if (res === 'lose') { ctx.send({ k: 'over' }); sendState(true); }
    }
    function setStatus(t) { status.textContent = t; statusT = 1500; }

    // ---------- entrada ----------
    function press(act) {
      if (phase !== 'play' || !piece) return;
      switch (act) {
        case 'left': held.left = DAS; delete held.right; move(-1); break;
        case 'right': held.right = DAS; delete held.left; move(1); break;
        case 'down': if (!held.down) { held.down = 1; softStep(); } break;
        case 'rotcw': rotate(1); break;
        case 'rotccw': rotate(-1); break;
        case 'hard': hardDrop(); break;
        case 'hold': doHold(); break;
      }
    }
    function release(act) { delete held[act]; }
    const KEYS = {
      ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowDown: 'down', s: 'down', S: 'down',
      ArrowUp: 'rotcw', w: 'rotcw', W: 'rotcw', x: 'rotcw', X: 'rotcw', z: 'rotccw', Z: 'rotccw', ' ': 'hard', c: 'hold', C: 'hold', Shift: 'hold',
    };
    on(window, 'keydown', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const act = KEYS[e.key];
      if (!act) return;
      e.preventDefault();
      if (e.repeat) return;
      press(act);
    });
    on(window, 'keyup', (e) => { const act = KEYS[e.key]; if (act) release(act); });
    on(window, 'blur', () => { for (const k of Object.keys(held)) delete held[k]; });

    // ---------- rede ----------
    function sendState(final) {
      const b = [];
      for (let y = HID; y < ROWS; y++) b.push(board[y].join(''));
      const p = piece ? [piece.t, piece.r, piece.x, piece.y] : null;
      if (solo) return;
      ctx.send({ k: 's', b: b.join(''), p, sc: score, ln: lines, lv: level, g: pendingG, f: final ? 1 : 0 });
    }
    function startAsHost() { begin((Math.random() * 2 ** 31) | 0, round + 1); ctx.send({ k: 'go', seed, round }); }
    const offMsg = ctx.onMsg((m) => {
      if (destroyed || !m) return;
      if (m.k === 'hi') {
        if (seat === 0) { if (phase === 'wait') startAsHost(); } else ctx.send({ k: 'hi' });
      } else if (m.k === 'go' && seat === 1) {
        if (m.round > round) begin(m.seed | 0, m.round | 0);
      } else if (m.k === 'again' && seat === 0) {
        startAsHost();
      } else if (m.k === 'g') {
        if (phase === 'play' || phase === 'count') pendingG = Math.min(20, pendingG + (m.n | 0));
      } else if (m.k === 's') {
        if (typeof m.b === 'string' && m.b.length === COLS * VIS) { opState = m; opDirty = true; }
      } else if (m.k === 'over') {
        if (phase === 'over') { if (result === 'lose') { result = 'draw'; report('draw'); } }
        else if (phase === 'play' || phase === 'count') { phase = 'over'; result = 'win'; piece = null; for (const k of Object.keys(held)) delete held[k]; report('win'); }
      }
    });
    cleanups.push(offMsg);
    if (solo) begin((Math.random() * 2 ** 31) | 0, 0); else ctx.send({ k: 'hi' });
    // sozinha: pausa quando sai do app/aba e com P
    const setPause = (v) => { if (!solo || (phase !== 'play' && phase !== 'count')) return; paused = v; pauseBtn.textContent = paused ? tr('unpause') : tr('pause'); for (const k of Object.keys(held)) delete held[k]; overlayKey = ''; };
    on(document, 'visibilitychange', () => { if (document.hidden) setPause(true); });
    on(window, 'keydown', (e) => { if ((e.key === 'p' || e.key === 'P') && solo) setPause(!paused); });

    // ---------- passo fixo ----------
    function step(dt) {
      if (paused) return;
      if (statusT > 0) { statusT -= dt; if (statusT <= 0) status.textContent = ''; }
      if (phase === 'count') { countT -= dt; if (countT <= 0) { phase = 'play'; spawnNext(); } return; }
      if (phase !== 'play' || !piece) return;
      for (const act of ['left', 'right']) {
        if (held[act] === undefined) continue;
        held[act] -= dt;
        while (held[act] <= 0 && piece) { move(act === 'left' ? -1 : 1); held[act] += ARR; }
      }
      if (!piece) return;
      const grav = gravityMs(level);
      const soft = !!held.down;
      const iv = soft ? Math.min(grav, Math.max(SOFT_MIN, grav / 20)) : grav;
      gravT += dt;
      while (gravT >= iv && piece) {
        if (!collide(piece, 0, 1)) {
          piece.y++; gravT -= iv; if (soft) score++;
          if (piece.y > lowest) { lowest = piece.y; resets = 0; lockT = 0; }
        } else { gravT = 0; break; }
      }
      if (!piece) return;
      if (collide(piece, 0, 1)) { lockT += dt; if (lockT >= LOCK_MS) lockPiece(); } else lockT = 0;
      sendT += dt;
      if (phase === 'play' && sendT >= 100) { sendT = 0; sendState(); }
    }

    // ---------- desenho ----------
    function refreshColors() {
      const cs = getComputedStyle(ctx.root);
      colors.bg = cs.getPropertyValue('--surface2').trim() || colors.bg;
      colors.line = cs.getPropertyValue('--line').trim() || colors.grid;
    }
    function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
    function block(g, px, py, s, color) {
      const pad = Math.max(1, s * 0.06), r = Math.max(2, s * 0.16), w = s - pad * 2;
      rr(g, px + pad, py + pad, w, w, r); g.fillStyle = color; g.fill();
      const gr = g.createLinearGradient(0, py + pad, 0, py + pad + w);
      gr.addColorStop(0, 'rgba(255,255,255,.30)'); gr.addColorStop(.45, 'rgba(255,255,255,.06)'); gr.addColorStop(.8, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.22)');
      g.fillStyle = gr; g.fill();
      rr(g, px + pad + w * .12, py + pad + w * .08, w * .76, w * .14, w * .07); g.fillStyle = 'rgba(255,255,255,.22)'; g.fill();
    }
    function ghostCell(g, px, py, s, color) {
      const pad = Math.max(2, s * 0.1), r = Math.max(2, s * 0.16), w = s - pad * 2;
      rr(g, px + pad, py + pad, w, w, r); g.strokeStyle = color; g.globalAlpha = .55; g.lineWidth = Math.max(2, s * .08); g.stroke(); g.globalAlpha = 1;
    }
    function drawCell(g, x, y, cs, color, alpha = 1) { if (alpha < 1) ghostCell(g, x * cs, y * cs, cs, color); else block(g, x * cs, y * cs, cs, color); }
    function drawBoard(canvas, rows, p, ghost) {
      const g = canvas.getContext('2d');
      const cs = canvas.width / COLS;
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = '#1B1E2C'; g.fillRect(0, 0, canvas.width, canvas.height);
      g.strokeStyle = 'rgba(255,255,255,.055)'; g.lineWidth = 1; g.beginPath();
      for (let x = 1; x < COLS; x++) { g.moveTo(x * cs + .5, 0); g.lineTo(x * cs + .5, canvas.height); }
      for (let y = 1; y < VIS; y++) { g.moveTo(0, y * cs + .5); g.lineTo(canvas.width, y * cs + .5); }
      g.stroke();
      for (let y = 0; y < VIS; y++) for (let x = 0; x < COLS; x++) { const v = rows(x, y); if (v) drawCell(g, x, y, cs, COLORS[v]); }
      if (p) {
        const idx = TYPES.indexOf(p.t) + 1;
        if (ghost) for (const [x, y] of cellsOf(ghost)) if (y >= HID) drawCell(g, x, y - HID, cs, COLORS[idx], 0.25);
        for (const [x, y] of cellsOf(p)) if (y >= HID) drawCell(g, x, y - HID, cs, COLORS[idx]);
      }
    }
    function drawMini(canvas, types, slot) {
      const g = canvas.getContext('2d');
      g.clearRect(0, 0, canvas.width, canvas.height);
      const cs = 32;
      types.forEach((t, i) => {
        if (!t) return;
        const cells = SHAPES[t][0];
        const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
        const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
        const ox = (canvas.width - (maxx - minx + 1) * cs) / 2 - minx * cs;
        const oy = i * slot + (slot - (maxy - miny + 1) * cs) / 2 - miny * cs;
        for (const [x, y] of cells) block(g, ox + x * cs, oy + y * cs, cs, COLORS[TYPES.indexOf(t) + 1]);
      });
    }
    let lastHold = '#', lastNext = '#', frameN = 0;
    function render() {
      if (frameN++ % 30 === 0) refreshColors();
      let ghost = null;
      if (piece && phase === 'play') { ghost = { ...piece }; while (!collide(ghost, 0, 1)) ghost.y++; }
      drawBoard(myCanvas, (x, y) => board[y + HID][x], piece, ghost);
      const hk = hold || '-', nk = queue.slice(0, 3).join('');
      if (hk !== lastHold) { lastHold = hk; drawMini(holdCanvas, [hold], 90); }
      if (nk !== lastNext) { lastNext = nk; drawMini(nextCanvas, nk.split(''), 90); }
      statScore.textContent = score.toLocaleString(); statLevel.textContent = level; statLines.textContent = lines;
      myGbar.style.height = Math.min(100, pendingG * 5) + '%';
      if (opDirty && (opState || phase !== 'wait')) {
        opDirty = false;
        if (opState) {
          const s = opState.b;
          const p = Array.isArray(opState.p) && TYPES.includes(opState.p[0]) ? { t: opState.p[0], r: opState.p[1] | 0, x: opState.p[2] | 0, y: opState.p[3] | 0 } : null;
          drawBoard(opCanvas, (x, y) => { const v = s.charCodeAt(y * COLS + x) - 48; return v > 0 && v < 9 ? v : 0; }, p, null);
          opScore.textContent = opState.sc | 0; opLines.textContent = opState.ln | 0;
          opGbar.style.height = Math.min(100, (opState.g | 0) * 5) + '%';
        } else {
          drawBoard(opCanvas, () => 0, null, null); opScore.textContent = '0'; opLines.textContent = '0'; opGbar.style.height = '0%';
        }
      }
      updateOverlay();
    }
    function updateOverlay() {
      let key = phase;
      if (phase === 'count') key = 'c' + Math.ceil(countT / 1000);
      if (phase === 'over') key = 'o' + result + (wantAgain ? 'w' : '');
      if (paused) key = 'paused';
      if (key === overlayKey) return;
      overlayKey = key;
      overlay.replaceChildren();
      overlay.classList.toggle('on', phase !== 'play' || paused);
      if (paused) overlay.append(el('div', { class: 'g-tetris-msg', text: tr('paused') }), el('button', { class: 'btn primary', type: 'button', text: tr('resume'), onClick: () => setPause(false) }));
      else if (phase === 'wait') overlay.append(el('div', { class: 'g-tetris-msg', text: tr('waiting', { name: peerName }) }));
      else if (phase === 'count') overlay.append(el('div', { class: 'g-tetris-count', text: String(Math.max(1, Math.ceil(countT / 1000))) }));
      else if (phase === 'over') {
        overlay.append(el('div', { class: 'g-tetris-msg g-tetris-' + result, text: tr(result) }));
        if (solo) {
          overlay.append(el('div', { class: 'g-tetris-big', text: tr('pts', { n: score.toLocaleString() }) }));
          if (newRecord) overlay.append(el('div', { class: 'g-tetris-rec', text: tr('record') }));
          overlay.append(el('button', { class: 'btn primary', type: 'button', text: tr('again'), onClick: again }));
        } else if (wantAgain) overlay.append(el('div', { class: 'g-tetris-sub', text: tr('waitAgain', { name: peerName }) }));
        else overlay.append(el('button', { class: 'btn primary', type: 'button', text: tr('again'), onClick: again }));
      }
    }
    function again() {
      if (solo) { begin((Math.random() * 2 ** 31) | 0, round + 1); return; }
      if (seat === 0) startAsHost();
      else { wantAgain = true; ctx.send({ k: 'again' }); overlayKey = ''; }
    }

    // ---------- laço rAF ----------
    let raf = 0, last = 0, acc = 0;
    function frame(ts) {
      if (destroyed) return;
      if (!last) last = ts;
      acc += Math.min(250, ts - last); last = ts;
      while (acc >= STEP) { step(STEP); acc -= STEP; }
      render();
      raf = requestAnimationFrame(frame);
    }
    refreshColors();
    raf = requestAnimationFrame(frame);

    // teste/depuração: expõe o estado sem efeito colateral
    ctx.root.__tetris = { get piece() { return piece ? piece.t : null; }, get pending() { return pendingG; }, get phase() { return phase; }, get result() { return result; }, press, release, get board() { return board; }, get score() { return score; } };

    return {
      destroy() {
        destroyed = true;
        cancelAnimationFrame(raf);
        cleanups.forEach((f) => { try { f(); } catch {} });
        cleanups.length = 0;
        delete ctx.root.__tetris;
        ctx.root.replaceChildren();
      },
    };
  },
};
