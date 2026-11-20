'use strict';
// Cozinha a dois (estilo Overcooked). Seat 0 simula tudo e manda snapshots (~15 Hz); seat 1 manda só entradas.
import { getLang } from '../i18n.js';
import { el } from '../util.js';

const L = {
  pt: {
    time: 'Tempo', score: 'Pontos', delivered: 'Entregues', lost: 'Perdidos', best: 'Melhor da sessão',
    burger: 'Hambúrguer', sand: 'Sanduíche', salad: 'Salada',
    ing_p_raw: 'Pão', ing_m_done: 'Carne frita', ing_q_raw: 'Queijo', ing_a_cut: 'Alface cortada', ing_t_cut: 'Tomate cortado',
    n_p: 'Pão', n_m: 'Carne', n_q: 'Queijo', n_a: 'Alface', n_t: 'Tomate',
    st_board: 'Tábua', st_grill: 'Chapa', st_asm: 'Montar', st_deliver: 'Entrega', st_bin: 'Lixo',
    waiting: 'Aguardando {name}…', ready: 'Prepare-se!', over: 'Fim do expediente!', again: 'Jogar de novo', waitAgain: 'Aguardando…',
    controls: 'Mover: WASD ou setas · Pegar/soltar: E ou Espaço · Cortar (segure): F ou Shift',
    take: 'Pegar / soltar', use: 'Cortar', stick: 'Direcional', canvas: 'Cozinha', orders: 'Pedidos',
    r_handsFull: 'Mãos cheias', r_nothing: 'Nada aqui', r_occupied: 'Ocupado', r_onlyCut: 'Só alface e tomate', r_onlyMeat: 'Só carne crua',
    r_needReady: 'Ainda não está pronto', r_dupe: 'Já tem esse', r_noOrder: 'Ninguém pediu isso', r_notDish: 'Entregue um prato montado',
    r_burn: 'Queimou!', r_trash: 'Lixo', r_exp: 'Pedido perdido!', r_full: 'Cheio',
    sum: '{n} pedidos entregues', hint: 'Montem os pedidos juntas: corte, frite, monte e entregue.',
  },
  en: {
    time: 'Time', score: 'Score', delivered: 'Delivered', lost: 'Missed', best: 'Session best',
    burger: 'Burger', sand: 'Sandwich', salad: 'Salad',
    ing_p_raw: 'Bun', ing_m_done: 'Fried patty', ing_q_raw: 'Cheese', ing_a_cut: 'Chopped lettuce', ing_t_cut: 'Chopped tomato',
    n_p: 'Bun', n_m: 'Patty', n_q: 'Cheese', n_a: 'Lettuce', n_t: 'Tomato',
    st_board: 'Board', st_grill: 'Grill', st_asm: 'Build', st_deliver: 'Serve', st_bin: 'Bin',
    waiting: 'Waiting for {name}…', ready: 'Get ready!', over: "Time's up!", again: 'Play again', waitAgain: 'Waiting…',
    controls: 'Move: WASD or arrows · Pick up/drop: E or Space · Chop (hold): F or Shift',
    take: 'Pick / drop', use: 'Chop', stick: 'Joystick', canvas: 'Kitchen', orders: 'Orders',
    r_handsFull: 'Hands full', r_nothing: 'Nothing here', r_occupied: 'Occupied', r_onlyCut: 'Lettuce and tomato only', r_onlyMeat: 'Raw patty only',
    r_needReady: 'Not ready yet', r_dupe: 'Already there', r_noOrder: 'Nobody ordered that', r_notDish: 'Serve a built dish',
    r_burn: 'Burnt!', r_trash: 'Trash', r_exp: 'Order lost!', r_full: 'Full',
    sum: '{n} orders delivered', hint: 'Cook together: chop, fry, build and serve.',
  },
};
const tr = (k, v) => {
  let s = (L[getLang()] || L.pt)[k] ?? L.pt[k] ?? k;
  if (v) for (const [a, b] of Object.entries(v)) s = s.replaceAll('{' + a + '}', String(b));
  return s;
};

// ---------- mapa e regras ----------
const COLS = 13, ROWS = 9, TS = 48, SC = 2;
const MAP = [
  '#PMQAT#CC#GG#',
  '#...........#',
  '#...........#',
  'X...........D',
  'X....XBX....D',
  'X...........L',
  '#...........#',
  '#...........#',
  '##X#######X##',
];
const CRATE = { P: 'p', M: 'm', Q: 'q', A: 'a', T: 't' };
const SLOTS = new Set(['X', 'C', 'G', 'B']);
const RECIPES = {
  burger: { need: ['p:raw', 'm:done', 'a:cut'], pts: 40, time: 80 },
  sand: { need: ['p:raw', 'q:raw', 't:cut'], pts: 30, time: 65 },
  salad: { need: ['a:cut', 't:cut'], pts: 20, time: 55 },
};
const RKEYS = Object.keys(RECIPES);
const ICON_NAME = (s) => 'ing_' + s.replace(':', '_');
const SPEED = 4.2, RAD = 0.3, CUT_T = 1.0, COOK_T = 5, BURN_T = 6, ROUND_T = 180, MAXORD = 4;
const tileAt = (x, y) => (x < 0 || y < 0 || x >= COLS || y >= ROWS ? '#' : MAP[y][x]);
const isStation = (ch) => ch !== '.' && ch !== '#';
const itemKey = (it) => it.k + ':' + it.s;
const rKey = (items) => items.map(itemKey).sort().join(',');
const RMATCH = {};
for (const [id, r] of Object.entries(RECIPES)) RMATCH[[...r.need].sort().join(',')] = id;
const VALID_ASM = new Set(Object.values(RECIPES).flatMap((r) => r.need));
const r3 = (v) => Math.round(v * 1000) / 1000;

export default {
  start(ctx) {
    const seat = ctx.seat, peer = 1 - seat, host = seat === 0;
    const cleanups = [];
    let destroyed = false, raf = 0, flushT = null;
    const names = ctx.names;
    const seatColor = ['#e8334a', '#7c5cff'];
    let best = 0;

    // ---------- estado de jogo (sim na seat 0; espelho na seat 1) ----------
    const mkStations = () => { const m = new Map(); for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (SLOTS.has(MAP[y][x])) m.set(y * COLS + x, { items: [], p: 0, tm: 0 }); return m; };
    const S = { ph: 'wait', cd: 3, tl: ROUND_T, sc: 0, dl: 0, lo: 0, orders: [], st: mkStations(), ev: [], seq: 0,
      chefs: [mkChef(4.5, 2.5), mkChef(8.5, 2.5)] };
    function mkChef(x, y) { return { x, y, dx: x, dy: y, fx: 0, fy: 1, h: null, cutting: false }; }
    const H = { inp: [{ dx: 0, dy: 0, b: false }, { dx: 0, dy: 0, b: false }], pendA: [0, 0], lastA: [0, 0], nextOrder: 8, oid: 0, snapAcc: 0, peerReady: false };
    const floaters = [];
    let gotSnap = false;

    function resetGame() {
      S.ph = 'count'; S.cd = 3; S.tl = ROUND_T; S.sc = 0; S.dl = 0; S.lo = 0; S.orders = []; S.st = mkStations(); S.ev = [];
      S.chefs = [mkChef(4.5, 2.5), mkChef(8.5, 2.5)];
      H.pendA = [0, 0]; H.nextOrder = 8; H.snapAcc = 0;
      sendSnap();
    }

    // ---------- lógica (só seat 0) ----------
    const emit = (e) => { S.ev.push(e); handleEvent(e); };
    function newOrder() {
      const r = RKEYS[Math.floor(Math.random() * RKEYS.length)];
      const tm = RECIPES[r].time;
      S.orders.push({ id: ++H.oid, r, t: tm, m: tm });
    }
    function freeAt(px, py, i) {
      for (const [ox, oy] of [[-RAD, -RAD], [RAD, -RAD], [-RAD, RAD], [RAD, RAD]]) if (tileAt(Math.floor(px + ox), Math.floor(py + oy)) !== '.') return false;
      const o = S.chefs[1 - i], c = S.chefs[i];
      const dn = Math.hypot(px - o.x, py - o.y);
      if (dn < 0.62 && dn < Math.hypot(c.x - o.x, c.y - o.y)) return false;
      return true;
    }
    function targetOf(c) {
      const tx = Math.floor(c.x), ty = Math.floor(c.y);
      const px = c.x + c.fx * 0.55, py = c.y + c.fy * 0.55;
      let best = null, bd = 1e9;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const gx = tx + ox, gy = ty + oy, ch = tileAt(gx, gy);
        if (!isStation(ch)) continue;
        const ddx = Math.max(gx - c.x, 0, c.x - (gx + 1)), ddy = Math.max(gy - c.y, 0, c.y - (gy + 1));
        if (Math.hypot(ddx, ddy) > 0.62) continue;
        const sc = Math.hypot(px - (gx + 0.5), py - (gy + 0.5));
        if (sc < bd) { bd = sc; best = { x: gx, y: gy, ch, idx: gy * COLS + gx }; }
      }
      return best;
    }
    const cuttable = (it) => it && it.s === 'raw' && (it.k === 'a' || it.k === 't');

    function act(i) {
      const c = S.chefs[i], t = targetOf(c);
      const bad = (k) => emit({ e: 'bad', k, x: c.x, y: c.y - 0.4 });
      if (!t) return;
      const ch = t.ch, stn = S.st.get(t.idx);
      if (CRATE[ch]) { if (c.h) return bad('handsFull'); c.h = { k: CRATE[ch], s: 'raw' }; return; }
      if (ch === 'L') { if (c.h) { c.h = null; emit({ e: 'trash', x: c.x, y: c.y - 0.4 }); } return; }
      if (ch === 'D') {
        if (!c.h) return bad('nothing');
        if (c.h.k !== 'd') return bad('notDish');
        let bi = -1;
        S.orders.forEach((o, j) => { if (o.r === c.h.r && (bi < 0 || o.t < S.orders[bi].t)) bi = j; });
        if (bi < 0) return bad('noOrder');
        const o = S.orders[bi], r = RECIPES[o.r];
        const pts = r.pts + Math.round(10 * o.t / o.m);
        S.orders.splice(bi, 1); S.sc += pts; S.dl++; c.h = null;
        emit({ e: 'ok', pts, x: c.x, y: c.y - 0.4 });
        return;
      }
      if (!stn) return;
      if (ch === 'B') {
        if (c.h) {
          if (c.h.k === 'd') return bad('occupied');
          if (!VALID_ASM.has(itemKey(c.h))) return bad('needReady');
          if (stn.items.some((x) => x.k === c.h.k)) return bad('dupe');
          if (stn.items.length >= 3 || RMATCH[rKey(stn.items)]) return bad('full');
          stn.items.push(c.h); c.h = null;
        } else if (stn.items.length) {
          const rid = RMATCH[rKey(stn.items)];
          if (rid) { c.h = { k: 'd', s: 'dish', r: rid }; stn.items = []; } else c.h = stn.items.pop();
        } else bad('nothing');
        return;
      }
      // X, C, G: um item
      if (c.h) {
        if (stn.items.length) return bad('occupied');
        if (ch === 'C' && !cuttable(c.h)) return bad('onlyCut');
        if (ch === 'G' && !(c.h.k === 'm' && c.h.s === 'raw')) return bad('onlyMeat');
        stn.items = [c.h]; c.h = null; stn.p = 0; stn.tm = 0;
      } else if (stn.items.length) { c.h = stn.items[0]; stn.items = []; stn.p = 0; stn.tm = 0; }
      else bad('nothing');
    }

    function step(dt) {
      if (S.ph === 'count') { S.cd -= dt; if (S.cd <= 0) { S.ph = 'play'; newOrder(); newOrder(); H.nextOrder = 14; sendSnap(); } return; }
      if (S.ph !== 'play') return;
      S.tl -= dt;
      if (S.tl <= 0) { S.tl = 0; S.ph = 'over'; best = Math.max(best, S.sc); sendSnap(); return; }
      for (let i = 0; i < 2; i++) {
        const c = S.chefs[i], inp = H.inp[i];
        const t = targetOf(c);
        const stn = t && t.ch === 'C' ? S.st.get(t.idx) : null;
        c.cutting = !!(inp.b && stn && cuttable(stn.items[0]));
        if (c.cutting) {
          stn.p += dt / CUT_T;
          if (stn.p >= 1) { stn.items[0] = { k: stn.items[0].k, s: 'cut' }; stn.p = 0; }
        } else {
          const m = Math.min(1, Math.hypot(inp.dx, inp.dy));
          if (m > 0.12) {
            const ux = inp.dx / Math.hypot(inp.dx, inp.dy), uy = inp.dy / Math.hypot(inp.dx, inp.dy);
            c.fx = r3(ux); c.fy = r3(uy);
            const nx = c.x + ux * m * SPEED * dt, ny = c.y + uy * m * SPEED * dt;
            if (freeAt(nx, c.y, i)) c.x = nx;
            if (freeAt(c.x, ny, i)) c.y = ny;
            c.x = r3(c.x); c.y = r3(c.y);
          }
        }
        let guard = 3;
        while (H.pendA[i] > 0 && guard-- > 0) { H.pendA[i]--; act(i); }
        H.pendA[i] = 0;
      }
      for (const [idx, stn] of S.st) {
        if (MAP[Math.floor(idx / COLS)][idx % COLS] !== 'G' || !stn.items.length) continue;
        const it = stn.items[0]; stn.tm += dt;
        if (it.s === 'raw' && stn.tm >= COOK_T) stn.items[0] = { k: 'm', s: 'done' };
        else if (it.s === 'done' && stn.tm >= COOK_T + BURN_T) { stn.items[0] = { k: 'm', s: 'burnt' }; emit({ e: 'burn', x: (idx % COLS) + 0.5, y: Math.floor(idx / COLS) + 1 }); }
      }
      for (let j = S.orders.length - 1; j >= 0; j--) {
        const o = S.orders[j]; o.t -= dt;
        if (o.t <= 0) { S.orders.splice(j, 1); S.lo++; emit({ e: 'exp' }); }
      }
      H.nextOrder -= dt;
      if (H.nextOrder <= 0 && S.orders.length < MAXORD) { newOrder(); H.nextOrder = 12 + Math.random() * 8; }
      else if (H.nextOrder <= 0) H.nextOrder = 2;
    }

    // ---------- rede ----------
    function sendSnap() {
      if (!host) return;
      const st = [];
      for (const [idx, s] of S.st) if (s.items.length || s.p > 0) st.push([idx, s.items, r3(s.p), r3(s.tm)]);
      ctx.send({ t: 'snap', q: ++S.seq, ph: S.ph, cd: r3(S.cd), tl: r3(S.tl), sc: S.sc, dl: S.dl, lo: S.lo,
        c: S.chefs.map((c) => [c.x, c.y, c.fx, c.fy, c.h, c.cutting ? 1 : 0]), st,
        o: S.orders.map((o) => [o.id, o.r, r3(o.t), o.m]), ev: S.ev });
      S.ev = [];
    }
    function applySnap(m) {
      if (!Array.isArray(m.c) || m.c.length !== 2) return;
      const wasOver = S.ph === 'over';
      S.ph = m.ph; S.cd = m.cd; S.tl = m.tl; S.sc = m.sc; S.dl = m.dl; S.lo = m.lo;
      m.c.forEach((a, i) => { const c = S.chefs[i]; c.x = a[0]; c.y = a[1]; c.fx = a[2]; c.fy = a[3]; c.h = a[4]; c.cutting = !!a[5]; });
      S.st = mkStations();
      for (const [idx, items, p, tm] of m.st) { const s = S.st.get(idx); if (s) { s.items = items; s.p = p; s.tm = tm; } }
      S.orders = m.o.map(([id, r, t, mm]) => ({ id, r, t, m: mm }));
      if (!gotSnap) { gotSnap = true; S.chefs.forEach((c) => { c.dx = c.x; c.dy = c.y; }); }
      if (S.ph === 'over' && !wasOver) best = Math.max(best, S.sc);
      (m.ev || []).forEach(handleEvent);
    }
    function handleEvent(e) {
      const col = e.e === 'ok' ? '#30c46b' : '#fff';
      if (e.e === 'ok') floaters.push({ x: e.x, y: e.y, txt: '+' + e.pts, col, age: 0 });
      else if (e.e === 'bad') floaters.push({ x: e.x, y: e.y, txt: tr('r_' + e.k), col: '#ffd0d0', age: 0 });
      else if (e.e === 'burn') floaters.push({ x: e.x, y: e.y, txt: tr('r_burn'), col: '#ff6b6b', age: 0 });
      else if (e.e === 'trash') floaters.push({ x: e.x, y: e.y, txt: tr('r_trash'), col: '#ddd', age: 0 });
      else if (e.e === 'exp') floaters.push({ x: COLS / 2, y: 0.6, txt: tr('r_exp'), col: '#ff6b6b', age: 0 });
    }
    const off = ctx.onMsg((m) => {
      if (destroyed || !m) return;
      if (m.t === 'hello') {
        if (host) { H.peerReady = true; if (S.ph === 'wait') resetGame(); else sendSnap(); }
      } else if (m.t === 'hello0') {
        if (!host) ctx.send({ t: 'hello' });
      } else if (m.t === 'in') {
        if (!host) return;
        const i = H.inp[1];
        i.dx = Math.max(-1, Math.min(1, +m.dx || 0)); i.dy = Math.max(-1, Math.min(1, +m.dy || 0)); i.b = !!m.b;
        const a = m.a | 0;
        if (a > H.lastA[1]) { H.pendA[1] += Math.min(3, a - H.lastA[1]); H.lastA[1] = a; }
      } else if (m.t === 'again') {
        if (host && S.ph === 'over') resetGame();
      } else if (m.t === 'snap') {
        if (!host) applySnap(m);
      }
    });
    cleanups.push(off);

    // ---------- entrada local ----------
    const keys = new Set();
    const joy = { x: 0, y: 0 };
    let bBtn = false, aCount = 0, lastSent = '';
    const inputNow = () => {
      let dx = (keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0), dy = (keys.has('d') ? 1 : 0) - (keys.has('u') ? 1 : 0);
      if (dx && dy) { dx *= Math.SQRT1_2; dy *= Math.SQRT1_2; }
      if (Math.hypot(joy.x, joy.y) > 0.01) { dx = joy.x; dy = joy.y; }
      return { dx: r3(dx), dy: r3(dy), b: keys.has('b') || bBtn };
    };
    function pushInput() {
      const v = inputNow();
      if (host) { H.inp[0] = v; return; }
      const s = JSON.stringify([v.dx, v.dy, v.b, aCount]);
      if (s !== lastSent) { lastSent = s; ctx.send({ t: 'in', dx: v.dx, dy: v.dy, b: v.b, a: aCount }); }
    }
    function pressA() {
      if (S.ph !== 'play') return;
      if (host) H.pendA[0]++; else { aCount++; pushInput(); }
    }
    const KMAP = { KeyW: 'u', ArrowUp: 'u', KeyS: 'd', ArrowDown: 'd', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r', KeyF: 'b', ShiftLeft: 'b', ShiftRight: 'b', KeyQ: 'b' };
    const typing = (e) => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); };
    const onKeyDown = (e) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = KMAP[e.code];
      if (k) { e.preventDefault(); if (!keys.has(k)) { keys.add(k); pushInput(); } }
      else if (e.code === 'KeyE' || e.code === 'Space') { e.preventDefault(); if (!e.repeat) pressA(); }
    };
    const onKeyUp = (e) => { const k = KMAP[e.code]; if (k) { keys.delete(k); pushInput(); } };
    const onBlur = () => { keys.clear(); joy.x = joy.y = 0; bBtn = false; pushInput(); };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    cleanups.push(() => { document.removeEventListener('keydown', onKeyDown); document.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur); });
    if (!host) { flushT = setInterval(pushInput, 100); } // reenvia (idempotente) para nunca ficar preso

    // ---------- UI ----------
    const canvas = el('canvas', { class: 'g-chef-canvas', width: COLS * TS * SC, height: ROWS * TS * SC, role: 'img', 'aria-label': tr('canvas') });
    const g = canvas.getContext('2d');
    const timeEl = el('b', { text: '3:00' }), scoreEl = el('b', { text: '0' });
    const hud = el('div', { class: 'g-chef-hud' },
      el('div', { class: 'g-chef-stat' }, el('small', { text: tr('time') }), timeEl),
      el('div', { class: 'g-chef-stat' }, el('small', { text: tr('score') }), scoreEl),
      el('div', { class: 'g-chef-orders', 'aria-label': tr('orders') }));
    const ordersEl = hud.querySelector('.g-chef-orders');
    const ovTitle = el('h3', { class: 'g-chef-ovt' }), ovText = el('div', { class: 'g-chef-ovx' });
    const ovBtn = el('button', { class: 'btn primary lg', type: 'button', text: tr('again'), onClick: () => { ovBtn.blur(); if (host) { if (S.ph === 'over') resetGame(); } else { ctx.send({ t: 'again' }); ovBtn.disabled = true; } } });
    const overlay = el('div', { class: 'g-chef-ov' }, ovTitle, ovText, ovBtn);
    const stage = el('div', { class: 'g-chef-stage' }, canvas, overlay);

    // controles de toque
    const knob = el('i', { class: 'g-chef-knob' });
    const joyEl = el('div', { class: 'g-chef-joy', 'aria-label': tr('stick') }, knob);
    const R_JOY = 44;
    let joyId = null;
    const joyMove = (e) => {
      const r = joyEl.getBoundingClientRect();
      let vx = e.clientX - (r.left + r.width / 2), vy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(vx, vy);
      const k = d > R_JOY ? R_JOY / d : 1;
      vx *= k; vy *= k;
      knob.style.transform = `translate(${vx}px, ${vy}px)`;
      const m = Math.hypot(vx, vy) / R_JOY;
      if (m < 0.22) { joy.x = joy.y = 0; } else { joy.x = vx / R_JOY; joy.y = vy / R_JOY; }
      pushInput();
    };
    const joyEnd = (e) => {
      if (e.pointerId !== joyId) return;
      joyId = null; joy.x = joy.y = 0; knob.style.transform = ''; pushInput();
    };
    joyEl.addEventListener('pointerdown', (e) => { e.preventDefault(); joyId = e.pointerId; try { joyEl.setPointerCapture(e.pointerId); } catch {} joyMove(e); });
    joyEl.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) joyMove(e); });
    joyEl.addEventListener('pointerup', joyEnd); joyEl.addEventListener('pointercancel', joyEnd);
    const btnA = el('button', { class: 'g-chef-act a', type: 'button', text: tr('take') });
    const btnB = el('button', { class: 'g-chef-act b', type: 'button', text: tr('use') });
    btnA.addEventListener('pointerdown', (e) => { e.preventDefault(); pressA(); });
    btnB.addEventListener('pointerdown', (e) => { e.preventDefault(); bBtn = true; btnB.classList.add('on'); pushInput(); });
    const bUp = () => { if (bBtn) { bBtn = false; btnB.classList.remove('on'); pushInput(); } };
    btnB.addEventListener('pointerup', bUp); btnB.addEventListener('pointercancel', bUp); btnB.addEventListener('pointerleave', bUp);
    [btnA, btnB, joyEl].forEach((n) => n.addEventListener('contextmenu', (e) => e.preventDefault()));
    const pad = el('div', { class: 'g-chef-pad' }, joyEl, el('div', { class: 'g-chef-btns' }, btnB, btnA));

    ctx.root.append(el('div', { class: 'g-chef' }, hud, stage, pad, el('p', { class: 'g-chef-hint muted', text: tr('controls') })));

    // tickets de pedido
    const tickets = new Map();
    function syncOrders() {
      const ids = new Set(S.orders.map((o) => o.id));
      for (const [id, n] of tickets) if (!ids.has(id)) { n.root.remove(); tickets.delete(id); }
      for (const o of S.orders) {
        let n = tickets.get(o.id);
        if (!n) {
          const bar = el('i', { class: 'g-chef-tbar' });
          const root = el('div', { class: 'g-chef-ticket' }, el('b', { text: tr(o.r) }),
            el('span', { text: RECIPES[o.r].need.map((s) => tr(ICON_NAME(s))).join(' · ') }), el('div', { class: 'g-chef-tbg' }, bar));
          n = { root, bar }; tickets.set(o.id, n); ordersEl.append(root);
        }
        const f = Math.max(0, Math.min(1, o.t / o.m));
        n.bar.style.width = (f * 100).toFixed(1) + '%';
        n.root.classList.toggle('late', f < 0.25);
      }
      for (const o of S.orders) { const n = tickets.get(o.id); ordersEl.append(n.root); } // mantém a ordem
    }

    // ---------- desenho ----------
    const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    function drawItem(it, cx, cy, sz) {
      const r = sz / 2;
      g.save(); g.translate(cx, cy);
      if (it.k === 'p') {
        g.fillStyle = '#c98a3c'; rr(-r, r * 0.05, r * 2, r * 0.4, r * 0.18); g.fill();
        g.fillStyle = '#e8b062'; g.beginPath(); g.ellipse(0, r * 0.1, r, r * 0.7, 0, Math.PI, 0); g.fill();
        g.fillStyle = '#fff3d6'; for (const [sx, sy] of [[-0.4, -0.25], [0, -0.45], [0.4, -0.25]]) { g.beginPath(); g.ellipse(sx * r, sy * r, r * 0.09, r * 0.05, 0.5, 0, 7); g.fill(); }
      } else if (it.k === 'm') {
        g.fillStyle = it.s === 'raw' ? '#e0707a' : it.s === 'done' ? '#7a4326' : '#25201f';
        g.beginPath(); g.ellipse(0, 0, r, r * 0.6, 0, 0, 7); g.fill();
        if (it.s !== 'raw') { g.strokeStyle = it.s === 'done' ? '#52291a' : '#555'; g.lineWidth = 2; g.beginPath(); g.moveTo(-r * 0.5, -r * 0.25); g.lineTo(r * 0.3, r * 0.3); g.moveTo(-r * 0.1, -r * 0.35); g.lineTo(r * 0.6, r * 0.1); g.stroke(); }
        else { g.fillStyle = '#f2a5aa'; g.beginPath(); g.ellipse(-r * 0.2, -r * 0.15, r * 0.35, r * 0.15, 0, 0, 7); g.fill(); }
      } else if (it.k === 'q') {
        g.fillStyle = '#f7c531'; g.beginPath(); g.moveTo(-r, r * 0.55); g.lineTo(r, r * 0.55); g.lineTo(r * 0.9, -r * 0.45); g.lineTo(-r * 0.9, -r * 0.1); g.closePath(); g.fill();
        g.fillStyle = '#d8a210'; for (const [hx, hy] of [[-0.4, 0.2], [0.3, 0.05], [0.5, 0.35]]) { g.beginPath(); g.arc(hx * r, hy * r, r * 0.12, 0, 7); g.fill(); }
      } else if (it.k === 'a') {
        if (it.s === 'cut') { g.fillStyle = '#6fcf4d'; for (const [lx, ly] of [[-0.45, 0.1], [0.1, -0.35], [0.4, 0.25], [-0.1, 0.4]]) { g.beginPath(); g.ellipse(lx * r, ly * r, r * 0.32, r * 0.2, lx * 3, 0, 7); g.fill(); } }
        else { g.fillStyle = '#4eb83a'; g.beginPath(); g.arc(0, 0, r * 0.85, 0, 7); g.fill(); g.fillStyle = '#8be06a'; g.beginPath(); g.arc(-r * 0.2, -r * 0.2, r * 0.5, 0, 7); g.fill(); g.strokeStyle = '#3a8f2b'; g.lineWidth = 2; g.beginPath(); g.arc(r * 0.15, r * 0.1, r * 0.4, 0.5, 4); g.stroke(); }
      } else if (it.k === 't') {
        if (it.s === 'cut') { for (const [tx, ty] of [[-0.35, 0.1], [0.35, -0.1]]) { g.fillStyle = '#e5484d'; g.beginPath(); g.arc(tx * r, ty * r, r * 0.55, 0, 7); g.fill(); g.fillStyle = '#ff8f8f'; g.beginPath(); g.arc(tx * r, ty * r, r * 0.33, 0, 7); g.fill(); } }
        else { g.fillStyle = '#e5484d'; g.beginPath(); g.arc(0, r * 0.1, r * 0.8, 0, 7); g.fill(); g.fillStyle = '#2e9b3a'; g.beginPath(); g.moveTo(0, -r * 0.7); g.lineTo(r * 0.3, -r * 0.4); g.lineTo(-r * 0.3, -r * 0.4); g.fill(); g.fillStyle = 'rgba(255,255,255,.4)'; g.beginPath(); g.ellipse(-r * 0.3, 0, r * 0.15, r * 0.25, 0.4, 0, 7); g.fill(); }
      } else if (it.k === 'd') {
        g.fillStyle = '#fff'; g.strokeStyle = '#c9c9d2'; g.lineWidth = 2; g.beginPath(); g.ellipse(0, r * 0.1, r * 1.05, r * 0.8, 0, 0, 7); g.fill(); g.stroke();
        const need = RECIPES[it.r].need.map((s) => ({ k: s[0], s: s.slice(2) }));
        const n = need.length;
        need.forEach((x, j) => { g.restore(); g.save(); g.translate(cx, cy); drawItem(x, (j - (n - 1) / 2) * r * 0.62, r * 0.1, r * 0.78); });
      }
      g.restore();
    }

    function stationBg(ch, x, y, stn) {
      const px = x * TS, py = y * TS;
      const wood = '#c79b6d', woodD = '#a97c4f';
      if (ch === '#') { g.fillStyle = '#4a4458'; g.fillRect(px, py, TS, TS); g.fillStyle = '#5b5469'; g.fillRect(px, py, TS, 6); return; }
      if (ch === '.') { g.fillStyle = (x + y) % 2 ? '#f0e6d6' : '#e8dcc8'; g.fillRect(px, py, TS, TS); return; }
      g.fillStyle = woodD; g.fillRect(px, py, TS, TS);
      g.fillStyle = wood; rr(px + 2, py + 2, TS - 4, TS - 6, 6); g.fill();
      if (CRATE[ch]) { g.fillStyle = '#8a5a34'; rr(px + 4, py + 4, TS - 8, TS - 10, 5); g.fill(); g.fillStyle = '#6e4626'; g.fillRect(px + 8, py + TS - 14, TS - 16, 3); drawItem({ k: CRATE[ch], s: 'raw' }, px + TS / 2, py + TS / 2 - 2, TS * 0.62); }
      else if (ch === 'C') { g.fillStyle = '#f3e3c3'; rr(px + 5, py + 5, TS - 10, TS - 12, 6); g.fill(); g.strokeStyle = '#cdb68c'; g.lineWidth = 2; g.stroke(); }
      else if (ch === 'G') { g.fillStyle = '#3a3a42'; rr(px + 3, py + 3, TS - 6, TS - 8, 6); g.fill(); g.strokeStyle = '#6a6a75'; g.lineWidth = 2; for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(px + 6, py + 3 + k * 9); g.lineTo(px + TS - 6, py + 3 + k * 9); g.stroke(); } }
      else if (ch === 'B') { g.fillStyle = '#cfe7f5'; rr(px + 3, py + 3, TS - 6, TS - 8, 6); g.fill(); g.strokeStyle = '#7fb2d3'; g.lineWidth = 2; g.stroke(); g.beginPath(); g.arc(px + TS / 2, py + TS / 2 - 1, TS * 0.3, 0, 7); g.stroke(); }
      else if (ch === 'D') { g.fillStyle = '#9be0b0'; rr(px + 3, py + 3, TS - 6, TS - 8, 6); g.fill(); g.strokeStyle = '#4fae6c'; g.lineWidth = 2; g.stroke(); g.fillStyle = '#2e8a4d'; g.beginPath(); g.moveTo(px + 14, py + 30); g.lineTo(px + 34, py + 30); g.lineTo(px + 30, py + 20); g.lineTo(px + 18, py + 20); g.closePath(); g.fill(); g.fillRect(px + 22, py + 16, 4, 4); }
      else if (ch === 'L') { g.fillStyle = '#6f7480'; rr(px + 8, py + 6, TS - 16, TS - 12, 5); g.fill(); g.fillStyle = '#565a64'; g.fillRect(px + 6, py + 6, TS - 12, 5); g.fillStyle = '#8c919d'; g.fillRect(px + 16, py + 18, 3, 18); g.fillRect(px + 29, py + 18, 3, 18); }
      // rótulos
      const lab = ch === 'C' ? 'st_board' : ch === 'G' ? 'st_grill' : ch === 'B' ? 'st_asm' : ch === 'D' ? 'st_deliver' : ch === 'L' ? 'st_bin' : '';
      if (lab) { g.font = '700 9px system-ui, sans-serif'; g.textAlign = 'center'; g.fillStyle = ch === 'G' ? '#d5d5dc' : 'rgba(40,30,20,.62)'; g.fillText(tr(lab), px + TS / 2, py + TS - 5); }
      // conteúdo
      if (stn && stn.items.length) {
        const cx = px + TS / 2, cy = py + TS / 2 - 3;
        if (ch === 'B') {
          const rid = RMATCH[rKey(stn.items)];
          const n = stn.items.length;
          stn.items.forEach((it, j) => drawItem(it, cx + (j - (n - 1) / 2) * 13, cy, 24));
          if (rid) { g.strokeStyle = '#30c46b'; g.lineWidth = 3; rr(px + 3, py + 3, TS - 6, TS - 8, 6); g.stroke(); }
        } else drawItem(stn.items[0], cx, cy, TS * 0.62);
        if (ch === 'C' && stn.p > 0 && stn.items[0].s === 'raw') bar(px, py, stn.p, '#4fc3f7');
        if (ch === 'G') {
          const it = stn.items[0];
          if (it.s === 'raw') bar(px, py, stn.tm / COOK_T, '#ffa94d');
          else if (it.s === 'done') { const f = (stn.tm - COOK_T) / BURN_T; bar(px, py, f, f > 0.6 ? '#ff4d4d' : '#6fd36f'); if (f > 0.6 && Math.floor(performance.now() / 220) % 2) { g.fillStyle = '#ff4d4d'; g.font = '800 14px system-ui'; g.fillText('!', px + TS - 8, py + 14); } }
          else { g.fillStyle = 'rgba(180,180,190,.7)'; g.beginPath(); g.arc(cx - 4, py + 6 - (performance.now() / 60) % 6, 4, 0, 7); g.arc(cx + 5, py + 3 - (performance.now() / 70) % 6, 3, 0, 7); g.fill(); }
        }
      }
    }
    function bar(px, py, f, col) {
      f = Math.max(0, Math.min(1, f));
      g.fillStyle = 'rgba(0,0,0,.45)'; rr(px + 6, py + TS - 13, TS - 12, 6, 3); g.fill();
      g.fillStyle = col; if (f > 0.02) { rr(px + 6, py + TS - 13, (TS - 12) * f, 6, 3); g.fill(); }
    }

    function drawChef(i, now) {
      const c = S.chefs[i];
      const px = c.dx * TS, py = c.dy * TS;
      const bob = c.cutting ? Math.sin(now / 45) * 2 : 0;
      g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.ellipse(px, py + 14, 15, 7, 0, 0, 7); g.fill();
      g.fillStyle = seatColor[i]; g.beginPath(); g.arc(px, py + bob, 16, 0, 7); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 2; g.stroke();
      g.fillStyle = '#fff'; rr(px - 11, py - 25 + bob, 22, 11, 5); g.fill(); rr(px - 8, py - 21 + bob, 16, 10, 3); g.fill();
      // olhos na direção
      const ex = c.fx * 5, ey = c.fy * 4;
      g.fillStyle = '#fff'; g.beginPath(); g.arc(px - 5 + ex * 0.5, py - 2 + ey * 0.5 + bob, 4.5, 0, 7); g.arc(px + 5 + ex * 0.5, py - 2 + ey * 0.5 + bob, 4.5, 0, 7); g.fill();
      g.fillStyle = '#222'; g.beginPath(); g.arc(px - 5 + ex, py - 2 + ey + bob, 2, 0, 7); g.arc(px + 5 + ex, py - 2 + ey + bob, 2, 0, 7); g.fill();
      if (c.h) { drawItem(c.h, px + c.fx * 18, py + c.fy * 16 + 4, 26); }
      g.font = '700 10px system-ui, sans-serif'; g.textAlign = 'center';
      const nm = (names[i] || '').slice(0, 10);
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.55)'; g.strokeText(nm, px, py + 30); g.fillStyle = '#fff'; g.fillText(nm, px, py + 30);
    }

    function draw(now) {
      g.setTransform(SC, 0, 0, SC, 0, 0);
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) stationBg(MAP[y][x], x, y, S.st.get(y * COLS + x));
      // alvo de cada chef
      if (S.ph === 'play') for (let i = 0; i < 2; i++) {
        const t = targetOf(S.chefs[i]);
        if (t) { g.strokeStyle = seatColor[i]; g.lineWidth = 3; g.setLineDash(i ? [6, 4] : []); rr(t.x * TS + 1.5, t.y * TS + 1.5, TS - 3, TS - 3, 8); g.stroke(); g.setLineDash([]); }
      }
      const order = [0, 1].sort((a, b) => S.chefs[a].dy - S.chefs[b].dy);
      order.forEach((i) => drawChef(i, now));
      for (let j = floaters.length - 1; j >= 0; j--) {
        const f = floaters[j];
        if (f.age > 1.3) { floaters.splice(j, 1); continue; }
        g.globalAlpha = Math.min(1, (1.3 - f.age) * 2);
        g.font = '800 13px system-ui, sans-serif'; g.textAlign = 'center';
        g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.6)';
        const fy = f.y * TS - f.age * 22 - 24;
        g.strokeText(f.txt, f.x * TS, fy); g.fillStyle = f.col; g.fillText(f.txt, f.x * TS, fy);
        g.globalAlpha = 1;
      }
    }

    let lastOv = '';
    function syncUi() {
      const t = Math.max(0, Math.ceil(S.tl));
      timeEl.textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
      timeEl.classList.toggle('low', S.ph === 'play' && S.tl < 20);
      scoreEl.textContent = String(S.sc);
      syncOrders();
      let key = S.ph + (S.ph === 'count' ? Math.ceil(S.cd) : '') + (S.ph === 'over' ? S.sc + ':' + S.dl + ':' + S.lo + ':' + best : '') + (!host && !gotSnap ? 'x' : '');
      if (key === lastOv) return;
      lastOv = key;
      overlay.hidden = S.ph === 'play';
      if (S.ph === 'play') return;
      ovBtn.hidden = S.ph !== 'over'; ovBtn.disabled = false;
      ovText.replaceChildren();
      if (S.ph === 'over') {
        ovTitle.textContent = tr('over');
        ovText.append(el('div', { class: 'g-chef-big', text: String(S.sc) }),
          el('div', { text: tr('sum', { n: S.dl }) + ' · ' + tr('lost') + ': ' + S.lo }),
          el('div', { class: 'muted', text: tr('best') + ': ' + best }));
      } else if (S.ph === 'count') { ovTitle.textContent = tr('ready'); ovText.append(el('div', { class: 'g-chef-big', text: String(Math.max(1, Math.ceil(S.cd))) }), el('div', { class: 'muted', text: tr('hint') })); }
      else { ovTitle.textContent = tr('waiting', { name: names[peer] }); }
    }

    // ---------- loop ----------
    let last = performance.now(), acc = 0, snapT = 0;
    function frame(now) {
      if (destroyed) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (host) {
        acc += dt;
        let n = 0;
        while (acc >= 1 / 60 && n++ < 6) { step(1 / 60); acc -= 1 / 60; }
        if (n >= 6) acc = 0;
        snapT += dt;
        if (snapT >= 1 / 15) { snapT = 0; if (S.ph !== 'wait' && H.peerReady) sendSnap(); }
        S.chefs.forEach((c) => { c.dx = c.x; c.dy = c.y; });
      } else {
        const k = 1 - Math.exp(-dt * 22);
        S.chefs.forEach((c) => { c.dx += (c.x - c.dx) * k; c.dy += (c.y - c.dy) * k; });
      }
      floaters.forEach((f) => { f.age += dt; });
      draw(now); syncUi();
    }
    raf = requestAnimationFrame(frame);

    // aperto de mãos
    if (host) ctx.send({ t: 'hello0' }); else ctx.send({ t: 'hello' });

    return {
      destroy() {
        destroyed = true;
        cancelAnimationFrame(raf); clearInterval(flushT);
        cleanups.forEach((f) => { try { f(); } catch {} });
        ctx.root.replaceChildren();
      },
    };
  },
};
