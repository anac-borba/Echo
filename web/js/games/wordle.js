'use strict';
// Termo a dois (cooperativo): mesma grade, turnos alternados de palpite. Seat 0 sorteia a palavra.
import { getLang } from '../i18n.js';
import { el } from '../util.js';
import { WORDS } from './wordle-words.js';

const L = {
  pt: {
    round: 'Palavra {n}', yourTurn: 'Sua vez', turnOf: 'Vez de {name}', won: 'Acertaram!', lost: 'Não foi dessa vez',
    wasWord: 'A palavra era', next: 'Próxima palavra', waiting: 'Preparando a palavra…', short: 'Faltam letras', enter: 'Enviar', del: 'Apagar',
    solved: 'Acertadas', missed: 'Perdidas', streak: 'Sequência', tries: 'Tentativa {a} de {b}', grid: 'Grade de palpites', typing: '{name} está digitando…',
    hint: 'Vocês jogam juntas na mesma grade, uma tentativa por vez. Letras sem acento.', wait2: 'Aguardando a próxima palavra…',
  },
  en: {
    round: 'Word {n}', yourTurn: 'Your turn', turnOf: "{name}'s turn", won: 'You got it!', lost: 'Not this time',
    wasWord: 'The word was', next: 'Next word', waiting: 'Picking a word…', short: 'Not enough letters', enter: 'Enter', del: 'Delete',
    solved: 'Solved', missed: 'Missed', streak: 'Streak', tries: 'Guess {a} of {b}', grid: 'Guess grid', typing: '{name} is typing…',
    hint: 'You play together on one grid, one guess at a time. Letters without accents.', wait2: 'Waiting for the next word…',
  },
};
const tr = (k, v) => {
  let s = (L[getLang()] || L.pt)[k] ?? L.pt[k] ?? k;
  if (v) for (const [a, b] of Object.entries(v)) s = s.replaceAll('{' + a + '}', b);
  return s;
};

const LEN = 5, TRIES = 6;
const ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const RANK = { x: 1, p: 2, c: 3 };

function evalGuess(g, a) {
  const res = Array(LEN).fill('x'), cnt = {};
  for (let i = 0; i < LEN; i++) { if (g[i] === a[i]) res[i] = 'c'; else cnt[a[i]] = (cnt[a[i]] || 0) + 1; }
  for (let i = 0; i < LEN; i++) if (res[i] !== 'c' && cnt[g[i]] > 0) { res[i] = 'p'; cnt[g[i]]--; }
  return res;
}

export default {
  start(ctx) {
    const seat = ctx.seat, peer = 1 - seat;
    const cleanups = [];
    const timers = new Set();
    let destroyed = false;
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!destroyed) fn(); }, ms); timers.add(t); return t; };

    // ---------- estado ----------
    let S = null;            // { n, word, turn, guesses:[{w,by}], status:'play'|'won'|'lost' }
    let score = { won: 0, lost: 0, streak: 0 };
    let cur = '';            // meu texto atual
    let peerTyping = '';
    let shake = false, msgTxt = '';
    const used = new Set();

    // ---------- UI ----------
    const scoreEl = el('div', { class: 'g-wordle-score' });
    const turnEl = el('div', { class: 'g-wordle-turn', 'aria-live': 'polite' });
    const gridEl = el('div', { class: 'g-wordle-grid', role: 'img', 'aria-label': tr('grid') });
    const msgEl = el('div', { class: 'g-wordle-msg', 'aria-live': 'polite' });
    const resultEl = el('div', { class: 'g-wordle-result', hidden: true });
    const kbEl = el('div', { class: 'g-wordle-kb' });
    const hintEl = el('p', { class: 'g-wordle-hint muted', text: tr('hint') });
    const wrap = el('div', { class: 'g-wordle' }, scoreEl, turnEl, gridEl, msgEl, resultEl, kbEl, hintEl);
    ctx.root.append(wrap);

    const keyEls = {};
    const mkKey = (label, val, cls) => {
      const b = el('button', { class: 'g-wordle-key ' + (cls || ''), type: 'button', 'data-k': val, text: label, 'aria-label': val === 'ENTER' ? tr('enter') : val === 'BACK' ? tr('del') : val });
      b.addEventListener('click', () => press(val));
      keyEls[val] = b; return b;
    };
    ROWS.forEach((r, i) => {
      const row = el('div', { class: 'g-wordle-krow' });
      if (i === 2) row.append(mkKey('↵', 'ENTER', 'wide'));
      for (const ch of r) row.append(mkKey(ch, ch));
      if (i === 2) row.append(mkKey('⌫', 'BACK', 'wide'));
      kbEl.append(row);
    });
    kbEl.addEventListener('mousedown', (e) => e.preventDefault()); // não rouba o foco

    const nextBtn = el('button', { class: 'btn primary lg', type: 'button', text: tr('next'), onClick: requestNext });
    const answerEl = el('div', { class: 'g-wordle-answer' });
    const resTitle = el('h3', { class: 'g-wordle-restitle' });
    resultEl.append(resTitle, el('div', { class: 'muted', text: tr('wasWord') }), answerEl, nextBtn);

    const cells = [];
    for (let r = 0; r < TRIES; r++) {
      const row = el('div', { class: 'g-wordle-row' });
      const dot = el('i', { class: 'g-wordle-by' });
      row.append(dot);
      const rc = [];
      for (let c = 0; c < LEN; c++) { const d = el('div', { class: 'g-wordle-cell' }); row.append(d); rc.push(d); }
      row.append(el('i', { class: 'g-wordle-by g-wordle-by-pad' }));
      gridEl.append(row); cells.push({ row, dot, rc });
    }

    const seatColor = (s) => (s === 0 ? 'var(--accent)' : '#7c5cff');

    function myTurn() { return !!S && S.status === 'play' && S.turn === seat; }

    function render() {
      if (destroyed) return;
      if (!S) { turnEl.textContent = tr('waiting'); return; }
      scoreEl.replaceChildren(
        el('span', { class: 'g-wordle-pill' }, el('b', { text: String(score.won) }), ' ' + tr('solved')),
        el('span', { class: 'g-wordle-pill' }, el('b', { text: String(score.lost) }), ' ' + tr('missed')),
        el('span', { class: 'g-wordle-pill' }, el('b', { text: String(score.streak) }), ' ' + tr('streak')));
      const playing = S.status === 'play';
      turnEl.className = 'g-wordle-turn' + (playing && myTurn() ? ' mine' : '');
      turnEl.style.setProperty('--tc', seatColor(playing ? S.turn : seat));
      turnEl.textContent = playing
        ? (myTurn() ? tr('yourTurn') : tr('turnOf', { name: ctx.names[S.turn] })) + ' · ' + tr('tries', { a: S.guesses.length + 1, b: TRIES })
        : tr('round', { n: S.n });
      // grade
      const ans = norm(S.word);
      for (let r = 0; r < TRIES; r++) {
        const g = S.guesses[r];
        const { row, dot, rc } = cells[r];
        row.classList.toggle('shake', shake && r === S.guesses.length && playing);
        let text = '', res = null, ghost = false;
        if (g) { text = g.w; res = evalGuess(g.w, ans); dot.style.background = seatColor(g.by); dot.style.visibility = 'visible'; }
        else {
          dot.style.visibility = 'hidden';
          if (playing && r === S.guesses.length) { text = myTurn() ? cur : peerTyping; ghost = !myTurn(); }
        }
        for (let c = 0; c < LEN; c++) {
          const d = rc[c];
          d.textContent = text[c] || '';
          d.className = 'g-wordle-cell' + (res ? ' ' + res[c] : '') + (text[c] && !res ? ' filled' : '') + (ghost && text[c] ? ' ghost' : '') +
            (!g && playing && r === S.guesses.length ? ' active' : '');
        }
      }
      // teclado
      const best = {};
      S.guesses.forEach((g) => { const res = evalGuess(g.w, ans); [...g.w].forEach((ch, i) => { if (!best[ch] || RANK[res[i]] > RANK[best[ch]]) best[ch] = res[i]; }); });
      for (const k of Object.keys(keyEls)) {
        if (k.length !== 1) continue;
        keyEls[k].className = 'g-wordle-key' + (best[k] ? ' ' + best[k] : '');
      }
      msgEl.textContent = msgTxt || (playing && !myTurn() && peerTyping ? tr('typing', { name: ctx.names[peer] }) : '');
      resultEl.hidden = playing;
      kbEl.classList.toggle('off', !myTurn());
      kbEl.hidden = !playing; if (!playing) msgEl.textContent = '';
      if (!playing) {
        resultEl.classList.toggle('won', S.status === 'won');
        resTitle.textContent = S.status === 'won' ? tr('won') : tr('lost');
        answerEl.textContent = S.word.toUpperCase();
      }
    }

    function flash(txt) {
      msgTxt = txt; shake = true; render();
      later(() => { shake = false; msgTxt = ''; render(); }, 900);
    }

    // ---------- entrada ----------
    function press(k) {
      if (!myTurn()) return;
      if (k === 'ENTER') {
        if (cur.length < LEN) { flash(tr('short')); return; }
        const w = cur; cur = '';
        ctx.send({ t: 'guess', n: S.n, w });
        applyGuess(w, seat);
      } else if (k === 'BACK') {
        if (!cur) return;
        cur = cur.slice(0, -1); ctx.send({ t: 'typing', n: S.n, s: cur }); render();
      } else if (/^[A-Z]$/.test(k) && cur.length < LEN) {
        cur += k; ctx.send({ t: 'typing', n: S.n, s: cur }); render();
      }
    }
    const onKey = (e) => {
      const tg = e.target;
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || !myTurn()) return;
      if (e.key === 'Enter') { e.preventDefault(); press('ENTER'); }
      else if (e.key === 'Backspace') { e.preventDefault(); press('BACK'); }
      else if (e.key.length === 1) {
        const ch = norm(e.key);
        if (/^[A-Z]$/.test(ch)) { e.preventDefault(); press(ch); }
      }
    };
    document.addEventListener('keydown', onKey);
    cleanups.push(() => document.removeEventListener('keydown', onKey));

    // ---------- lógica ----------
    function applyGuess(w, by) {
      if (!S || S.status !== 'play') return;
      S.guesses.push({ w, by });
      peerTyping = '';
      const ans = norm(S.word);
      if (w === ans) { S.status = 'won'; score.won++; score.streak++; }
      else if (S.guesses.length >= TRIES) { S.status = 'lost'; score.lost++; score.streak = 0; }
      else S.turn = 1 - by;
      render();
    }

    function pickWord() {
      if (used.size >= WORDS.length - 5) used.clear();
      let w; do { w = WORDS[Math.floor(Math.random() * WORDS.length)]; } while (used.has(w));
      used.add(w); return w;
    }
    function snapshot() { return { t: 'snap', n: S.n, word: S.word, turn: S.turn, guesses: S.guesses, status: S.status, score }; }
    function newRound() { // só seat 0
      const n = (S ? S.n : 0) + 1;
      S = { n, word: pickWord(), turn: n % 2 === 1 ? 0 : 1, guesses: [], status: 'play' };
      cur = ''; peerTyping = ''; msgTxt = '';
      ctx.send(snapshot()); render();
    }
    function requestNext() {
      if (!S || S.status === 'play') return;
      if (seat === 0) newRound(); else ctx.send({ t: 'next', n: S.n });
      nextBtn.disabled = true; later(() => { nextBtn.disabled = false; }, 800);
    }

    const off = ctx.onMsg((m) => {
      if (destroyed || !m) return;
      if (m.t === 'hello') { if (seat === 0) { if (S) ctx.send(snapshot()); else newRound(); } return; }
      if (m.t === 'snap') {
        if (seat === 0) return;
        const newer = !S || m.n > S.n || (m.n === S.n && (m.guesses.length > S.guesses.length || m.status !== S.status));
        if (!newer) return;
        if (!S || m.n !== S.n) { cur = ''; peerTyping = ''; msgTxt = ''; }
        S = { n: m.n, word: String(m.word), turn: m.turn, guesses: m.guesses.slice(0, TRIES), status: m.status };
        if (m.score) score = { won: m.score.won | 0, lost: m.score.lost | 0, streak: m.score.streak | 0 };
        render(); return;
      }
      if (!S || m.n !== S.n) return;
      if (m.t === 'guess' && S.status === 'play' && S.turn === peer && typeof m.w === 'string' && /^[A-Z]{5}$/.test(m.w)) applyGuess(m.w, peer);
      else if (m.t === 'typing' && S.turn === peer && typeof m.s === 'string') { peerTyping = m.s.replace(/[^A-Z]/g, '').slice(0, LEN); render(); }
      else if (m.t === 'next' && seat === 0 && S.status !== 'play') newRound();
    });
    cleanups.push(off);

    render();
    // aperto de mãos: a seat 1 pede o estado; a seat 0 anuncia e cria a primeira palavra
    if (seat === 1) ctx.send({ t: 'hello' });
    else newRound();

    return {
      destroy() {
        destroyed = true;
        cleanups.forEach((f) => { try { f(); } catch {} });
        timers.forEach(clearTimeout); timers.clear();
        ctx.root.replaceChildren();
      },
    };
  },
};
