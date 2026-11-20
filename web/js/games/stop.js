'use strict';
// Stop (Adedonha) a dois, no estilo das salas de Stop online:
//  sala → quem criou escolhe categorias (liga/desliga, cria e apaga), rodadas e tempo;
//  roleta de letra → preencher com cronômetro (STOP! dá 3 s para a outra terminar) →
//  correção categoria por categoria (cada uma confere a resposta da outra) → pontos da rodada → placar final.
// Quem criou a partida (seat 0) manda no estado. As respostas de quem foi convidada só saem do aparelho dela
// quando o tempo da rodada acaba (ninguém espia antes).
import { getLang } from '../i18n.js';
import { el, avatar } from '../util.js';

const L = {
  pt: {
    lobby: 'Sala', cats: 'Categorias', catsHint: 'Toque para ligar ou desligar. Mínimo {min}, máximo {max}.', newCat: 'Nova categoria', add: 'Adicionar',
    rounds: 'Rodadas', time: 'Tempo por rodada', start: 'Começar partida', waitPeer: 'Esperando {name} entrar…', waitHost: '{name} está montando a partida',
    youHost: 'Você criou a partida', ready: 'Pronta!', readyQ: 'Estou pronta', round: 'Rodada {n} de {t}', letter: 'Letra', drawing: 'Sorteando a letra…',
    stop: 'STOP!', stopHint: 'Preencha tudo para apertar STOP', stopped: '{name} apertou STOP!', stoppedMe: 'Você apertou STOP!', timeUp: 'Tempo esgotado!',
    ph: 'Começa com {l}…', review: 'Correção', reviewOf: 'Categoria {i} de {n}', valid: 'Vale', invalid: 'Não vale', empty: 'Em branco', wrongL: 'Não começa com {l}',
    same: 'Iguais', next: 'Próxima', waitNext: 'Esperando {name}…', results: 'Pontos da rodada', total: 'Total', nextRound: 'Próxima rodada', final: 'Ver resultado',
    winner: '{name} venceu!', youWin: 'Você venceu!', tie: 'Empate!', again: 'Jogar de novo', you: 'Você', pts: '{n} pts', sec: '{n} s', min: '{n} min',
    collecting: 'Juntando as respostas…', voteHint: 'Confira a resposta de {name}', removeCat: 'Remover {c}', tooMany: 'Máximo de {max} categorias', exists: 'Essa categoria já existe',
    unique: 'Única', equal: 'Igual', zero: 'Inválida', creator: 'Criou a partida', waitAgain: 'Esperando {name} começar outra', inRoom: 'Na sala', joining: 'Entrando…',
  },
  en: {
    lobby: 'Lobby', cats: 'Categories', catsHint: 'Tap to turn on or off. Minimum {min}, maximum {max}.', newCat: 'New category', add: 'Add',
    rounds: 'Rounds', time: 'Time per round', start: 'Start match', waitPeer: 'Waiting for {name} to join…', waitHost: '{name} is setting up the match',
    youHost: 'You created this match', ready: 'Ready!', readyQ: "I'm ready", round: 'Round {n} of {t}', letter: 'Letter', drawing: 'Drawing the letter…',
    stop: 'STOP!', stopHint: 'Fill everything to press STOP', stopped: '{name} pressed STOP!', stoppedMe: 'You pressed STOP!', timeUp: "Time's up!",
    ph: 'Starts with {l}…', review: 'Review', reviewOf: 'Category {i} of {n}', valid: 'Valid', invalid: 'Invalid', empty: 'Blank', wrongL: "Doesn't start with {l}",
    same: 'Same', next: 'Next', waitNext: 'Waiting for {name}…', results: 'Round points', total: 'Total', nextRound: 'Next round', final: 'See result',
    winner: '{name} won!', youWin: 'You won!', tie: 'Draw!', again: 'Play again', you: 'You', pts: '{n} pts', sec: '{n} s', min: '{n} min',
    collecting: 'Collecting answers…', voteHint: "Check {name}'s answer", removeCat: 'Remove {c}', tooMany: 'Up to {max} categories', exists: 'That category already exists',
    unique: 'Unique', equal: 'Same', zero: 'Invalid', creator: 'Created the match', waitAgain: 'Waiting for {name} to start another', inRoom: 'In the lobby', joining: 'Joining…',
  },
};
const tr = (k, v) => { let s = (L[getLang()] || L.pt)[k] ?? L.pt[k] ?? k; if (v) for (const [a, b] of Object.entries(v)) s = s.replaceAll('{' + a + '}', String(b)); return s; };

const PRESETS = {
  pt: ['Nome', 'Animal', 'Cor', 'Fruta', 'CEP (cidade, estado ou país)', 'Objeto', 'Profissão', 'Comida', 'Marca', 'Filme ou série', 'Parte do corpo',
    'Esporte', 'Personagem', 'Música', 'Celebridade', 'Minha sogra é…', 'Verbo', 'Adjetivo', 'Time de futebol', 'Bebida', 'Doença', 'Lugar para viajar'],
  en: ['Name', 'Animal', 'Color', 'Fruit', 'City or country', 'Object', 'Job', 'Food', 'Brand', 'Movie or show', 'Body part',
    'Sport', 'Character', 'Song', 'Celebrity', 'Something you hate', 'Verb', 'Adjective', 'Sports team', 'Drink', 'Illness', 'Travel spot'],
};
const DEF_ON = 8;
const MIN_CATS = 3, MAX_CATS = 12, CAT_MAX = 28;
const ROUND_OPTS = [3, 5, 7, 10], TIME_OPTS = [60, 90, 120, 180];
const LETTERS = 'ABCDEFGHIJLMNOPRSTUV';
const SPIN_MS = 2800, GRACE_MS = 3000, COLLECT_MS = 4000, REVIEW_MS = 40000;
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const cleanCat = (s) => String(s || '').replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, CAT_MAX);

export default {
  start(ctx) {
    const seat = ctx.seat, other = 1 - seat;
    const names = ctx.names;
    const users = seat === 0 ? [ctx.me, ctx.peer] : [ctx.peer, ctx.me];
    const peerName = names[other] || '…';
    let destroyed = false;
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!destroyed) fn(); }, ms); timers.add(t); return t; };
    const host = seat === 0;
    const cfgKey = 'tl.stop.cfg';

    /* ═════════════ anfitriã: estado ═════════════ */
    let H = null;
    function defaultCfg() {
      let saved = null; try { saved = JSON.parse(localStorage.getItem(cfgKey) || 'null'); } catch {}
      const lang = getLang() === 'en' ? 'en' : 'pt';
      const pool = (saved && Array.isArray(saved.pool) ? saved.pool : PRESETS[lang].map((c, i) => ({ c, on: i < DEF_ON })))
        .map((x) => ({ c: cleanCat(x.c), on: !!x.on })).filter((x) => x.c).slice(0, 40);
      return { pool, rounds: ROUND_OPTS.includes(saved && saved.rounds) ? saved.rounds : 5, time: TIME_OPTS.includes(saved && saved.time) ? saved.time : 90 };
    }
    function hostInit() {
      H = { ph: 'lobby', cfg: defaultCfg(), here: false, n: 0, letter: '', used: [], cats: [], ends: 0, stopBy: null,
        ans: [{}, {}], got: [false, false], inv: [{}, {}], auto: [{}, {}], cat: 0, ready: [false, false], pts: [{}, {}], tot: [0, 0], rounds: [] };
    }
    const saveCfg = () => { try { localStorage.setItem(cfgKey, JSON.stringify({ pool: H.cfg.pool, rounds: H.cfg.rounds, time: H.cfg.time })); } catch {} };
    const activeCats = () => H.cfg.pool.filter((x) => x.on).map((x) => x.c);

    function pub() {
      const showAns = ['review', 'round', 'final'].includes(H.ph);
      return {
        ph: H.ph, cfg: H.cfg, here: H.here, n: H.n, letter: H.letter, cats: H.cats, left: H.ends ? Math.max(0, H.ends - Date.now()) : 0,
        stopBy: H.stopBy, cat: H.cat, ready: H.ready, tot: H.tot, pts: H.pts, rounds: H.rounds,
        ans: showAns ? H.ans : null, inv: showAns ? H.inv : null, auto: showAns ? H.auto : null,
      };
    }
    function bcast() { if (!H) return; const p = pub(); ctx.send({ t: 'S', s: p }); show(p); }

    function startRound() {
      H.n++; H.cats = activeCats();
      const pool = LETTERS.split('').filter((l) => !H.used.includes(l));
      H.letter = (pool.length ? pool : LETTERS.split(''))[Math.floor(Math.random() * (pool.length || LETTERS.length))];
      H.used.push(H.letter);
      H.ans = [{}, {}]; H.got = [false, false]; H.inv = [{}, {}]; H.auto = [{}, {}]; H.pts = [{}, {}]; H.stopBy = null; H.cat = 0; H.ready = [false, false];
      H.ph = 'spin'; H.ends = Date.now() + SPIN_MS; bcast();
      later(() => { if (H.ph !== 'spin') return; H.ph = 'fill'; H.ends = Date.now() + H.cfg.time * 1000; bcast(); armFill(); }, SPIN_MS);
    }
    let fillT = null;
    function armFill() { clearTimeout(fillT); fillT = later(() => endFill(), Math.max(0, H.ends - Date.now())); }
    function pressStop(s) {
      if (H.ph !== 'fill' || H.stopBy !== null) return;
      H.stopBy = s; H.ends = Math.min(H.ends, Date.now() + GRACE_MS); bcast(); armFill();
    }
    function endFill() {
      if (H.ph !== 'fill') return;
      H.ph = 'collect'; H.ends = 0;
      H.ans[0] = { ...mine }; H.got[0] = true;
      bcast();
      later(() => { if (H.ph === 'collect') beginReview(); }, COLLECT_MS);
    }
    function gotAnswers(a) {
      if (H.ph !== 'collect' || H.got[1]) return;
      const clean = {};
      for (const c of H.cats) if (a && typeof a[c] === 'string') clean[c] = a[c].slice(0, 40);
      H.ans[1] = clean; H.got[1] = true;
      beginReview();
    }
    function beginReview() {
      if (H.ph !== 'collect') return;
      const L0 = norm(H.letter);
      for (const s of [0, 1]) for (const c of H.cats) {
        const v = norm(H.ans[s][c]);
        H.auto[s][c] = !v ? 'empty' : !v.startsWith(L0) ? 'letter' : '';
      }
      H.ph = 'review'; H.cat = 0; H.ready = [false, false]; H.ends = Date.now() + REVIEW_MS; bcast(); armReview();
    }
    let revT = null;
    function armReview() { clearTimeout(revT); revT = later(() => nextCat(), Math.max(0, H.ends - Date.now())); }
    function vote(s, cat, ok) {
      if (H.ph !== 'review' || !H.cats.includes(cat)) return;
      const target = 1 - s;               // cada uma corrige a resposta da outra
      if (H.auto[target][cat]) return;    // em branco / letra errada não tem como valer
      H.inv[target][cat] = !ok; bcast();
    }
    function setReady(s) {
      if (H.ph === 'review') { H.ready[s] = true; if (H.ready[0] && H.ready[1]) nextCat(); else bcast(); }
      else if (H.ph === 'round') { H.ready[s] = true; if (H.ready[0] && H.ready[1]) afterRound(); else bcast(); }
    }
    function nextCat() {
      if (H.ph !== 'review') return;
      if (H.cat < H.cats.length - 1) { H.cat++; H.ready = [false, false]; H.ends = Date.now() + REVIEW_MS; bcast(); armReview(); return; }
      clearTimeout(revT); score();
    }
    function score() {
      const ok = (s, c) => !H.auto[s][c] && !H.inv[s][c];
      const r = [0, 0];
      for (const c of H.cats) {
        const a = ok(0, c), b = ok(1, c);
        const same = a && b && norm(H.ans[0][c]) === norm(H.ans[1][c]);
        H.pts[0][c] = a ? (same ? 5 : 10) : 0;
        H.pts[1][c] = b ? (same ? 5 : 10) : 0;
        r[0] += H.pts[0][c]; r[1] += H.pts[1][c];
      }
      H.tot = [H.tot[0] + r[0], H.tot[1] + r[1]];
      H.rounds.push({ l: H.letter, p: r });
      H.ph = 'round'; H.ready = [false, false]; H.ends = 0; bcast();
    }
    function afterRound() {
      if (H.n < H.cfg.rounds) { startRound(); return; }
      H.ph = 'final'; H.ready = [false, false]; bcast();
      const w = H.tot[0] > H.tot[1] ? 0 : H.tot[1] > H.tot[0] ? 1 : -1;
      if (ctx.result) ctx.result({ winner: w, score: [...H.tot] });
    }
    function backToLobby() {
      const cfg = H.cfg, here = H.here;
      hostInit(); H.cfg = cfg; H.here = here; bcast();
    }
    function hostCfg(fn) { if (H.ph !== 'lobby') return; fn(H.cfg); saveCfg(); bcast(); }

    function onGuest(m) {
      if (m.t === 'hi') { H.here = true; bcast(); }
      else if (m.t === 'stop') pressStop(1);
      else if (m.t === 'ans') gotAnswers(m.a);
      else if (m.t === 'vote') vote(1, String(m.cat), !!m.ok);
      else if (m.t === 'ready') setReady(1);
    }

    /* ═════════════ os dois lados: tela ═════════════ */
    let P = null, recvAt = 0;
    let mine = {};          // minhas respostas (só saem do aparelho no fim da rodada)
    let lastRound = 0, lastPh = '', lastCat = -1;
    const wrap = el('div', { class: 'g-stop' });
    ctx.root.append(wrap);
    const sendMine = () => ctx.send({ t: 'ans', a: { ...mine } });
    const act = (m) => { if (host) hostAct(m); else ctx.send(m); };
    function hostAct(m) {
      if (m.t === 'stop') pressStop(0);
      else if (m.t === 'vote') vote(0, m.cat, m.ok);
      else if (m.t === 'ready') setReady(0);
    }

    const leftNow = () => (P ? Math.max(0, P.left - (Date.now() - recvAt)) : 0);
    const who = (s) => (s === seat ? tr('you') : names[s]);
    const av = (s, size = 'sm') => avatar(users[s] || { name: names[s] }, size);

    // relógio da tela (cronômetro do preencher, barra da correção)
    let tickT = setInterval(() => {
      if (destroyed || !P) return;
      const ms = leftNow();
      for (const n of wrap.querySelectorAll('[data-clock]')) n.textContent = Math.ceil(ms / 1000) + '';
      for (const n of wrap.querySelectorAll('[data-bar]')) {
        const total = Number(n.dataset.bar) || 1;
        n.style.setProperty('--p', Math.max(0, Math.min(1, ms / total)).toFixed(3));
      }
      const ring = wrap.querySelector('.g-stop-clock');
      if (ring) ring.classList.toggle('hurry', P.ph === 'fill' && ms < 10000);
    }, 200);

    function show(p) {
      const prevPh = lastPh;
      P = p; recvAt = Date.now();
      // nova rodada: zera minhas respostas
      if (p.n !== lastRound && (p.ph === 'spin' || p.ph === 'fill')) { mine = {}; lastRound = p.n; }
      // fim do tempo: quem foi convidada manda as respostas agora
      if (!host && p.ph === 'collect' && prevPh !== 'collect') sendMine();
      // preencher: não recria os campos a cada atualização (perderia o foco e o que está digitando)
      if (p.ph === 'fill' && prevPh === 'fill') { paintFillBits(); return; }
      if (p.ph === 'review' && prevPh === 'review' && p.cat === lastCat) { paintReview(true); return; }
      lastPh = p.ph; lastCat = p.cat;
      wrap.dataset.ph = p.ph;
      if (p.ph !== 'fill' && p.ph !== 'collect') { wrap.classList.remove('shook'); fillEls = null; }
      ({ lobby: drawLobby, spin: drawSpin, fill: drawFill, collect: drawCollect, review: () => paintReview(false), round: drawRound, final: drawFinal })[p.ph]?.();
    }

    /* ── sala ── */
    function drawLobby() {
      const p = P, can = host;
      const players = el('div', { class: 'g-stop-players' }, ...[0, 1].map((s) => el('div', { class: 'g-stop-pl' + (s === 1 && !p.here ? ' off' : '') },
        av(s, 'md'), el('b', { text: who(s) }), el('small', { text: s === 0 ? tr('creator') : (p.here ? tr('inRoom') : tr('joining')) }))));
      const on = p.cfg.pool.filter((x) => x.on).length;
      const chips = el('div', { class: 'g-stop-chips' }, ...p.cfg.pool.map((x, i) => (!can && !x.on) ? null : el('span', { class: 'g-stop-chip' + (x.on ? ' on' : '') },
        el('button', { class: 'g-stop-chipb', type: 'button', disabled: !can, 'aria-pressed': String(x.on), text: x.c,
          onClick: () => hostCfg((c) => { const t = c.pool[i]; if (!t) return; if (!t.on && on >= MAX_CATS) { ctx.toast && ctx.toast(tr('tooMany', { max: MAX_CATS })); return; } if (t.on && on <= MIN_CATS) return; t.on = !t.on; }) }),
        can ? el('button', { class: 'g-stop-chipx', type: 'button', 'aria-label': tr('removeCat', { c: x.c }), text: '×',
          onClick: () => hostCfg((c) => { if (c.pool[i].on && on <= MIN_CATS) return; c.pool.splice(i, 1); }) }) : null)));
      let addRow = null;
      if (can) {
        const inp = el('input', { class: 'g-stop-addi', type: 'text', maxlength: String(CAT_MAX), placeholder: tr('newCat'), 'aria-label': tr('newCat'), enterkeyhint: 'done' });
        const add = () => {
          const v = cleanCat(inp.value); if (!v) return;
          if (p.cfg.pool.some((x) => norm(x.c) === norm(v))) { ctx.toast && ctx.toast(tr('exists')); return; }
          hostCfg((c) => { const n = c.pool.filter((x) => x.on).length; c.pool.unshift({ c: v, on: n < MAX_CATS }); });
          requestAnimationFrame(() => { const i2 = wrap.querySelector('.g-stop-addi'); if (i2) i2.focus(); });
        };
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
        addRow = el('div', { class: 'g-stop-add' }, inp, el('button', { class: 'g-stop-addb', type: 'button', text: tr('add'), onClick: add }));
      }
      const seg = (opts, val, fmt, set) => el('div', { class: 'g-stop-seg', role: 'radiogroup' }, ...opts.map((o) =>
        el('button', { type: 'button', role: 'radio', 'aria-checked': String(o === val), disabled: !can, text: fmt(o), onClick: () => hostCfg((c) => set(c, o)) })));
      const fmtTime = (s) => (s % 60 ? tr('sec', { n: s }) : tr('min', { n: s / 60 }));
      const foot = can
        ? el('button', { class: 'g-stop-go', type: 'button', disabled: !p.here || on < MIN_CATS, text: p.here ? tr('start') : tr('waitPeer', { name: peerName }), onClick: () => { if (H.here) { H.tot = [0, 0]; H.rounds = []; H.n = 0; H.used = []; startRound(); } } })
        : el('div', { class: 'g-stop-wait' }, el('span', { class: 'g-stop-dots' }, el('i'), el('i'), el('i')), el('span', { text: tr('waitHost', { name: names[0] }) }));
      wrap.replaceChildren(el('div', { class: 'g-stop-lobby' },
        el('header', { class: 'g-stop-lh' }, el('div', { class: 'g-stop-logo', 'aria-hidden': 'true' }, 'S', el('i')), el('div', null, el('h2', { text: 'Stop' }), el('p', { text: tr('lobby') }))),
        players,
        el('section', { class: 'g-stop-sec' }, el('div', { class: 'g-stop-sh' }, el('h3', { text: tr('cats') }), el('span', { class: 'g-stop-count', text: `${on}/${MAX_CATS}` })),
          can ? el('p', { class: 'g-stop-hint', text: tr('catsHint', { min: MIN_CATS, max: MAX_CATS }) }) : null, addRow, chips),
        el('section', { class: 'g-stop-sec two' },
          el('div', null, el('h3', { text: tr('rounds') }), seg(ROUND_OPTS, p.cfg.rounds, String, (c, o) => { c.rounds = o; })),
          el('div', null, el('h3', { text: tr('time') }), seg(TIME_OPTS, p.cfg.time, fmtTime, (c, o) => { c.time = o; }))),
        el('div', { class: 'g-stop-foot' }, foot)));
    }

    /* ── roleta da letra ── */
    function drawSpin() {
      const p = P;
      // faixa de letras que rola e para na sorteada (a mesma animação nos dois aparelhos)
      const seq = [];
      for (let i = 0; i < 26; i++) seq.push(LETTERS[(i * 7 + p.n * 3) % LETTERS.length]);
      seq.push(p.letter);
      const reel = el('div', { class: 'g-stop-reel' }, ...seq.map((l) => el('span', { text: l })));
      reel.style.setProperty('--steps', String(seq.length - 1));
      wrap.replaceChildren(el('div', { class: 'g-stop-spin' },
        el('p', { class: 'g-stop-rnd', text: tr('round', { n: p.n, t: p.cfg.rounds }) }),
        el('div', { class: 'g-stop-slot' }, el('div', { class: 'g-stop-win' }, reel)),
        el('p', { class: 'g-stop-drawing', text: tr('drawing') }),
        el('div', { class: 'g-stop-catsprev' }, ...p.cats.map((c) => el('span', { text: c })))));
      requestAnimationFrame(() => requestAnimationFrame(() => reel.classList.add('go')));
      later(() => { const w = wrap.querySelector('.g-stop-slot'); if (w) w.classList.add('landed'); }, SPIN_MS - 500);
    }

    /* ── preencher ── */
    let fillEls = null;
    function drawFill() {
      const p = P;
      const L0 = norm(p.letter);
      const fields = p.cats.map((c) => {
        const inp = el('input', { class: 'g-stop-in', type: 'text', maxlength: '40', autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'next',
          placeholder: tr('ph', { l: p.letter }), 'aria-label': c, value: mine[c] || '' });
        const row = el('label', { class: 'g-stop-field' }, el('span', { class: 'g-stop-fl', text: c }), inp, el('i', { class: 'g-stop-ok', 'aria-hidden': 'true' }));
        const check = () => {
          const v = norm(inp.value);
          row.classList.toggle('good', !!v && v.startsWith(L0));
          row.classList.toggle('bad', !!v && !v.startsWith(L0));
        };
        inp.addEventListener('input', () => { mine[c] = inp.value; check(); paintStopBtn(); });
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const all = [...wrap.querySelectorAll('.g-stop-in')]; const i = all.indexOf(inp); if (all[i + 1]) all[i + 1].focus(); else inp.blur(); } });
        check();
        return row;
      });
      const stopBtn = el('button', { class: 'g-stop-btn', type: 'button', text: tr('stop'), onClick: () => { if (allFilled()) act({ t: 'stop' }); } });
      const banner = el('div', { class: 'g-stop-banner', role: 'status' });
      const total = p.cfg.time * 1000;
      fillEls = { stopBtn, banner };
      wrap.replaceChildren(el('div', { class: 'g-stop-fill' },
        el('header', { class: 'g-stop-fh' },
          el('div', { class: 'g-stop-ltr' }, el('small', { text: tr('letter') }), el('b', { text: p.letter })),
          el('div', { class: 'g-stop-fmeta' }, el('b', { text: tr('round', { n: p.n, t: p.cfg.rounds }) }),
            el('div', { class: 'g-stop-score' }, ...[0, 1].map((s) => el('span', null, av(s, 'xs'), el('b', { text: String(p.tot[s]) }))))),
          el('div', { class: 'g-stop-clock' }, el('span', { class: 'g-stop-ring', dataset: { bar: String(total) } }), el('b', { dataset: { clock: '1' }, text: String(Math.ceil(leftNow() / 1000)) }))),
        banner,
        el('div', { class: 'g-stop-grid' }, ...fields),
        el('div', { class: 'g-stop-stopbar' }, stopBtn)));
      paintFillBits();
      if (!matchMedia('(pointer: coarse)').matches) { const f = wrap.querySelector('.g-stop-in'); if (f) f.focus(); }
    }
    const allFilled = () => P && P.cats.every((c) => norm(mine[c]));
    function paintStopBtn() {
      if (!fillEls) return;
      const ok = allFilled() && P.stopBy === null;
      fillEls.stopBtn.disabled = !ok;
      fillEls.stopBtn.title = ok ? '' : tr('stopHint');
    }
    function paintFillBits() {
      if (!fillEls) return;
      paintStopBtn();
      const b = fillEls.banner;
      if (P.stopBy !== null) {
        b.textContent = P.stopBy === seat ? tr('stoppedMe') : tr('stopped', { name: names[P.stopBy] });
        b.className = 'g-stop-banner on';
        const ring = wrap.querySelector('.g-stop-ring'); if (ring) ring.dataset.bar = String(GRACE_MS);
        if (P.stopBy !== seat && !wrap.classList.contains('shook')) { wrap.classList.add('shake', 'shook'); later(() => wrap.classList.remove('shake'), 700); }
      } else b.className = 'g-stop-banner';
    }

    function drawCollect() {
      for (const i of wrap.querySelectorAll('.g-stop-in')) i.disabled = true;
      if (fillEls) { fillEls.stopBtn.disabled = true; fillEls.banner.textContent = P.stopBy === null ? tr('timeUp') : fillEls.banner.textContent; fillEls.banner.className = 'g-stop-banner on'; }
      const g = wrap.querySelector('.g-stop-fill');
      if (g) g.append(el('div', { class: 'g-stop-collect' }, el('span', { class: 'g-stop-dots' }, el('i'), el('i'), el('i')), el('span', { text: tr('collecting') })));
      else wrap.replaceChildren(el('div', { class: 'g-stop-wait' }, el('span', { text: tr('collecting') })));
    }

    /* ── correção ── */
    function paintReview(soft) {
      const p = P, c = p.cats[p.cat];
      const status = (s) => {
        const auto = p.auto[s][c];
        if (auto === 'empty') return { cls: 'empty', txt: tr('empty') };
        if (auto === 'letter') return { cls: 'bad', txt: tr('wrongL', { l: p.letter }) };
        return p.inv[s][c] ? { cls: 'bad', txt: tr('invalid') } : { cls: 'good', txt: tr('valid') };
      };
      const same = !p.auto[0][c] && !p.auto[1][c] && !p.inv[0][c] && !p.inv[1][c] && norm(p.ans[0][c]) === norm(p.ans[1][c]);
      const rows = [seat, other].map((s) => {
        const st = status(s);
        const canVote = s === other && !p.auto[s][c];
        return el('div', { class: 'g-stop-ans ' + st.cls + (s === seat ? ' me' : '') },
          av(s, 'md'),
          el('div', { class: 'g-stop-at' }, el('small', { text: who(s) }), el('b', { text: (p.ans[s][c] || '').trim() || '—' })),
          canVote
            ? el('div', { class: 'g-stop-vote', role: 'group', 'aria-label': tr('voteHint', { name: names[s] }) },
              el('button', { class: 'up', type: 'button', 'aria-pressed': String(!p.inv[s][c]), 'aria-label': tr('valid'), onClick: () => act({ t: 'vote', cat: c, ok: true }) }, thumb(true)),
              el('button', { class: 'down', type: 'button', 'aria-pressed': String(!!p.inv[s][c]), 'aria-label': tr('invalid'), onClick: () => act({ t: 'vote', cat: c, ok: false }) }, thumb(false)))
            : el('span', { class: 'g-stop-tag ' + st.cls, text: st.txt }));
      });
      const meReady = p.ready[seat];
      const body = el('div', { class: 'g-stop-review' + (soft ? '' : ' enter') },
        el('header', { class: 'g-stop-rh' },
          el('div', { class: 'g-stop-ltr sm' }, el('b', { text: p.letter })),
          el('div', null, el('small', { text: tr('reviewOf', { i: p.cat + 1, n: p.cats.length }) }), el('h3', { text: c })),
          el('div', { class: 'g-stop-steps' }, ...p.cats.map((_, i) => el('i', { class: i < p.cat ? 'done' : i === p.cat ? 'cur' : '' })))),
        el('div', { class: 'g-stop-bar', dataset: { bar: String(REVIEW_MS) } }),
        same ? el('div', { class: 'g-stop-same', text: tr('same') + ' · 5 + 5' }) : null,
        el('div', { class: 'g-stop-answers' }, ...rows),
        el('div', { class: 'g-stop-foot' },
          meReady ? el('div', { class: 'g-stop-wait' }, el('span', { class: 'g-stop-dots' }, el('i'), el('i'), el('i')), el('span', { text: tr('waitNext', { name: peerName }) }))
            : el('button', { class: 'g-stop-go', type: 'button', text: tr('next'), onClick: () => act({ t: 'ready' }) })));
      wrap.replaceChildren(body);
    }
    function thumb(up) {
      const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M7 11v9H4v-9zM7 11l4-7c1.4 0 2.3 1 2 2.4L12.4 10H18a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 20H7');
      path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.9'); path.setAttribute('stroke-linejoin', 'round'); path.setAttribute('stroke-linecap', 'round');
      if (!up) s.style.transform = 'rotate(180deg)';
      s.append(path); return s;
    }

    /* ── pontos da rodada ── */
    function drawRound() {
      const p = P;
      const last = p.rounds[p.rounds.length - 1] || { p: [0, 0] };
      const lastRound = p.n >= p.cfg.rounds;
      const pill = (n) => el('span', { class: 'g-stop-pt p' + n, text: n ? '+' + n : '0' });
      const table = el('div', { class: 'g-stop-table' },
        el('div', { class: 'g-stop-tr head' }, el('span'), ...[seat, other].map((s) => el('span', { class: 'g-stop-th' }, av(s, 'xs'), el('b', { text: who(s) })))),
        ...p.cats.map((c) => el('div', { class: 'g-stop-tr' }, el('span', { class: 'g-stop-tc', text: c }),
          ...[seat, other].map((s) => el('span', { class: 'g-stop-tv' }, el('em', { text: (p.ans[s][c] || '').trim() || '—' }), pill(p.pts[s][c] || 0))))),
        el('div', { class: 'g-stop-tr sum' }, el('span', { text: tr('results') }), ...[seat, other].map((s) => el('b', { text: '+' + last.p[s] }))),
        el('div', { class: 'g-stop-tr sum tot' }, el('span', { text: tr('total') }), ...[seat, other].map((s) => el('b', { text: String(p.tot[s]) }))));
      wrap.replaceChildren(el('div', { class: 'g-stop-round' },
        el('header', { class: 'g-stop-rh' }, el('div', { class: 'g-stop-ltr sm' }, el('b', { text: p.letter })),
          el('div', null, el('small', { text: tr('round', { n: p.n, t: p.cfg.rounds }) }), el('h3', { text: tr('results') }))),
        table,
        el('div', { class: 'g-stop-foot' }, p.ready[seat]
          ? el('div', { class: 'g-stop-wait' }, el('span', { class: 'g-stop-dots' }, el('i'), el('i'), el('i')), el('span', { text: tr('waitNext', { name: peerName }) }))
          : el('button', { class: 'g-stop-go', type: 'button', text: lastRound ? tr('final') : tr('nextRound'), onClick: () => act({ t: 'ready' }) }))));
    }

    /* ── resultado final ── */
    function drawFinal() {
      const p = P;
      const w = p.tot[0] > p.tot[1] ? 0 : p.tot[1] > p.tot[0] ? 1 : -1;
      const title = w < 0 ? tr('tie') : w === seat ? tr('youWin') : tr('winner', { name: names[w] });
      const order = w === other ? [other, seat] : [seat, other];
      const max = Math.max(1, ...p.tot);
      wrap.replaceChildren(el('div', { class: 'g-stop-final' + (w === seat ? ' won' : '') },
        el('h2', { text: title }),
        el('div', { class: 'g-stop-podium' }, ...order.map((s, i) => {
          const col = el('div', { class: 'g-stop-pod' + (i === 0 && w >= 0 ? ' first' : '') }, av(s, 'lg'), el('b', { text: who(s) }),
            el('div', { class: 'g-stop-pbar' }, el('span', { text: tr('pts', { n: p.tot[s] }) })));
          col.style.setProperty('--h', (0.35 + 0.65 * (p.tot[s] / max)).toFixed(2));
          return col;
        })),
        el('div', { class: 'g-stop-hist' }, ...p.rounds.map((r) => el('span', { class: 'g-stop-hr' }, el('b', { text: r.l }), el('small', { text: `${r.p[seat]} × ${r.p[other]}` })))),
        host ? el('button', { class: 'g-stop-go', type: 'button', text: tr('again'), onClick: backToLobby })
          : el('div', { class: 'g-stop-wait' }, el('span', { class: 'g-stop-dots' }, el('i'), el('i'), el('i')), el('span', { text: tr('waitAgain', { name: names[0] }) }))));
    }

    /* ── mensagens ── */
    const off = ctx.onMsg((m) => {
      if (destroyed || !m) return;
      if (host) onGuest(m);
      else if (m.t === 'S' && m.s && typeof m.s.ph === 'string') show(m.s);
    });
    if (host) { hostInit(); bcast(); } else { show({ ph: 'lobby', cfg: { pool: [], rounds: 5, time: 90 }, here: true, n: 0, tot: [0, 0], rounds: [], ready: [false, false], cats: [] }); ctx.send({ t: 'hi' }); }

    return {
      destroy() {
        destroyed = true; off && off();
        clearInterval(tickT);
        for (const t of timers) clearTimeout(t);
      },
    };
  },
};
