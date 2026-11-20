'use strict';
// Gartic Phone para duas: cada cadeia passa pelas duas mãos (frase -> desenho -> legenda -> desenho) e vira um álbum.
import { getLang } from '../i18n.js';
import { el, icon } from '../util.js';

const L = {
  pt: {
    stepOf: 'Etapa {n} de 4', s0: 'Escreva uma frase', s1: 'Desenhe a frase', s2: 'Escreva o que você vê', s3: 'Desenhe a legenda',
    v0: 'escrevendo', v1: 'desenhando', v2: 'legendando', v3: 'desenhando', peerDone: '{name} já terminou', peerDoing: '{name} está {v}…',
    w0: 'Pense em algo divertido para a outra desenhar.', ph0: 'ex.: um gato astronauta comendo pizza', suggest: 'Sugerir',
    timer: 'Limitar o desenho a 90 s', timerHost: 'Quem abriu a atividade decide o tempo.', draw: 'Desenhe isto', caption: 'O que está acontecendo neste desenho?',
    ph2: 'Escreva o que você vê…', ready: 'Pronto', waitT: 'Pronto!', waitD: 'Esperando {name} terminar…',
    brush: 'Pincel', eraser: 'Borracha', undo: 'Desfazer', clear: 'Limpar', clearSure: 'Limpar mesmo?', size: 'Espessura {n}', color: 'Cor {c}',
    chainOf: 'Cadeia de {name}', wrote: '{name} escreveu', drew: '{name} desenhou', captioned: '{name} legendou', album: 'Álbum', albumHint: 'Revelem passo a passo.',
    next: 'Revelar próximo', all: 'Revelar tudo', again: 'Jogar de novo', quit: 'Encerrar', drawingAlt: 'Desenho', hidden: 'Ainda escondido', empty: '(sem texto)',
    of: '{a} de {b}',
  },
  en: {
    stepOf: 'Step {n} of 4', s0: 'Write a phrase', s1: 'Draw the phrase', s2: 'Write what you see', s3: 'Draw the caption',
    v0: 'writing', v1: 'drawing', v2: 'captioning', v3: 'drawing', peerDone: '{name} is done', peerDoing: '{name} is {v}…',
    w0: 'Think of something fun for the other to draw.', ph0: 'e.g. an astronaut cat eating pizza', suggest: 'Suggest',
    timer: 'Limit drawing to 90 s', timerHost: 'Whoever opened the activity sets the timer.', draw: 'Draw this', caption: 'What is happening in this drawing?',
    ph2: 'Write what you see…', ready: 'Done', waitT: 'Done!', waitD: 'Waiting for {name} to finish…',
    brush: 'Brush', eraser: 'Eraser', undo: 'Undo', clear: 'Clear', clearSure: 'Really clear?', size: 'Size {n}', color: 'Color {c}',
    chainOf: "{name}'s chain", wrote: '{name} wrote', drew: '{name} drew', captioned: '{name} captioned', album: 'Album', albumHint: 'Reveal it step by step.',
    next: 'Reveal next', all: 'Reveal all', again: 'Play again', quit: 'End', drawingAlt: 'Drawing', hidden: 'Still hidden', empty: '(no text)',
    of: '{a} of {b}',
  },
};
const tr = (k, v) => {
  let s = (L[getLang()] || L.pt)[k] ?? L.pt[k] ?? k;
  if (v) for (const [a, b] of Object.entries(v)) s = s.replaceAll('{' + a + '}', b);
  return s;
};

const SUGGEST = {
  pt: ['Um gato astronauta comendo pizza', 'Um dragão tomando chá', 'A lua dançando com um peixe', 'Um robô apaixonado por uma torradeira',
    'Um gato pilotando um avião', 'Um polvo tocando violão', 'Um castelo feito de queijo', 'Uma tartaruga atrasada para o trabalho',
    'Um fantasma com medo de gente', 'Um bolo de aniversário gigante invadindo a cidade', 'Um pinguim na praia de biquíni', 'Uma nuvem chorando de rir'],
  en: ['An astronaut cat eating pizza', 'A dragon having tea', 'The moon dancing with a fish', 'A robot in love with a toaster',
    'A ladybug flying an airplane', 'An octopus playing guitar', 'A castle made of cheese', 'A turtle late for work',
    'A ghost afraid of people', 'A giant birthday cake invading the city', 'A penguin at the beach in a bikini', 'A cloud crying from laughter'],
};

const STEPS = 4, KIND = ['text', 'img', 'text', 'img'];
const PHRASE_MAX = 100, DRAW_SECS = 90;
const CW = 600, CH = 400, IMG_LIMIT = 58000, BG = '#ffffff';
const COLORS = ['#111111', '#5b5b66', '#a8a8b3', '#ffffff', '#e5484d', '#ff7a3d', '#f5c542', '#30c46b',
  '#0f9d78', '#2bb8d8', '#3b82f6', '#6d4aff', '#b455e8', '#ff6fa8', '#8a5a3b', '#f2c9a0'];
const WIDTHS = [2, 5, 10, 20];
const IMG_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

/** Gera data URL JPEG pequena (< ~58 KB): reduz a qualidade e, se preciso, a resolução. */
function encodeCanvas(cv) {
  let q = 0.85;
  let out = cv.toDataURL('image/jpeg', q);
  while (out.length > IMG_LIMIT && q > 0.35) { q -= 0.1; out = cv.toDataURL('image/jpeg', q); }
  if (out.length <= IMG_LIMIT) return out;
  const s = document.createElement('canvas');
  s.width = 480; s.height = 320;
  s.getContext('2d').drawImage(cv, 0, 0, 480, 320);
  out = s.toDataURL('image/jpeg', 0.5);
  if (out.length > IMG_LIMIT) out = s.toDataURL('image/jpeg', 0.3);
  return out;
}

/** Quadro de desenho local (independente) com ferramentas. */
function buildPad() {
  let strokes = [], cur = null, curPointer = null;
  let tool = 'brush', color = COLORS[0], wIdx = 1, clearTimer = null;
  const canvas = el('canvas', { class: 'g-gartic-canvas', width: CW, height: CH });
  const g = canvas.getContext('2d');
  g.fillStyle = BG; g.fillRect(0, 0, CW, CH);

  const toolBtns = {
    brush: el('button', { class: 'g-gartic-tool', type: 'button', 'aria-pressed': 'true', onClick: () => { tool = 'brush'; sync(); } }, icon('i-pen'), el('span', { text: tr('brush') })),
    eraser: el('button', { class: 'g-gartic-tool', type: 'button', 'aria-pressed': 'false', onClick: () => { tool = 'eraser'; sync(); } }, el('span', { class: 'g-gartic-erasericon' }), el('span', { text: tr('eraser') })),
  };
  const widthBtns = WIDTHS.map((w, i) => {
    const dot = el('i', { class: 'g-gartic-dot' });
    dot.style.width = dot.style.height = (4 + i * 5) + 'px';
    return el('button', { class: 'g-gartic-wbtn', type: 'button', 'aria-label': tr('size', { n: i + 1 }), 'aria-pressed': String(i === wIdx), onClick: () => { wIdx = i; sync(); } }, dot);
  });
  const swatches = COLORS.map((c) => {
    const b = el('button', { class: 'g-gartic-sw', type: 'button', 'aria-label': tr('color', { c }), 'aria-pressed': 'false', onClick: () => { color = c; tool = 'brush'; sync(); } });
    b.style.background = c;
    return b;
  });
  const undoBtn = el('button', { class: 'btn sm', type: 'button', onClick: undo }, icon('i-back'), el('span', { text: tr('undo') }));
  const clearLbl = el('span', { text: tr('clear') });
  const clearBtn = el('button', { class: 'btn sm', type: 'button', onClick: askClear }, icon('i-trash'), clearLbl);
  const bar = el('div', { class: 'g-gartic-bar' },
    el('div', { class: 'g-gartic-group' }, toolBtns.brush, toolBtns.eraser),
    el('div', { class: 'g-gartic-group' }, widthBtns),
    el('div', { class: 'g-gartic-group g-gartic-colors' }, swatches),
    el('div', { class: 'g-gartic-group g-gartic-acts' }, undoBtn, clearBtn));
  const node = el('div', { class: 'g-gartic-pad' }, el('div', { class: 'g-gartic-stage' }, canvas), bar);

  function sync() {
    for (const k of Object.keys(toolBtns)) toolBtns[k].setAttribute('aria-pressed', String(tool === k));
    widthBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(i === wIdx)));
    swatches.forEach((b, i) => b.setAttribute('aria-pressed', String(tool === 'brush' && COLORS[i] === color)));
    undoBtn.disabled = clearBtn.disabled = strokes.length === 0;
  }
  sync();

  function paint(s) {
    const n = s.p.length / 2;
    if (n <= s.drawn) return;
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = g.fillStyle = s.e ? BG : s.c; g.lineWidth = s.w;
    if (s.drawn === 0) { g.beginPath(); g.arc(s.p[0], s.p[1], s.w / 2, 0, Math.PI * 2); g.fill(); }
    if (n > 1) {
      const st = Math.max(s.drawn - 1, 0);
      g.beginPath(); g.moveTo(s.p[st * 2], s.p[st * 2 + 1]);
      for (let i = st + 1; i < n; i++) g.lineTo(s.p[i * 2], s.p[i * 2 + 1]);
      g.stroke();
    }
    s.drawn = n;
  }
  function redraw() {
    g.fillStyle = BG; g.fillRect(0, 0, CW, CH);
    for (const s of strokes) { s.drawn = 0; paint(s); }
  }
  function pos(e) {
    const r = canvas.getBoundingClientRect();
    const x = Math.min(CW, Math.max(0, (e.clientX - r.left) / r.width * CW));
    const y = Math.min(CH, Math.max(0, (e.clientY - r.top) / r.height * CH));
    return [x, y];
  }
  function pushPoint(e) {
    const [x, y] = pos(e), n = cur.p.length;
    if (n && Math.hypot(cur.p[n - 2] - x, cur.p[n - 1] - y) < 0.8) return;
    cur.p.push(x, y);
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (cur || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault(); cancelClear();
    cur = { c: color, w: WIDTHS[wIdx], e: tool === 'eraser', p: [], drawn: 0 };
    curPointer = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    cur.p.push(...pos(e));
    strokes.push(cur); paint(cur); sync();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!cur || e.pointerId !== curPointer) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of (evs.length ? evs : [e])) pushPoint(ev);
    paint(cur);
  });
  const up = (e) => {
    if (!cur || e.pointerId !== curPointer) return;
    if (e.type === 'pointerup') { pushPoint(e); paint(cur); }
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
    cur = null; curPointer = null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function undo() { if (cur || !strokes.length) return; strokes.pop(); redraw(); sync(); }
  function cancelClear() { clearTimeout(clearTimer); clearTimer = null; clearLbl.textContent = tr('clear'); clearBtn.classList.remove('danger'); }
  function askClear() {
    if (!clearTimer) { clearLbl.textContent = tr('clearSure'); clearBtn.classList.add('danger'); clearTimer = setTimeout(cancelClear, 3000); return; }
    cancelClear(); cur = null; strokes = []; redraw(); sync();
  }
  return { node, encode: () => { cur = null; return encodeCanvas(canvas); }, destroy: () => clearTimeout(clearTimer) };
}

export default {
  start(ctx) {
    const seat = ctx.seat, peer = 1 - seat;
    const names = ctx.names;
    const peerName = names[peer] || '?';
    const cleanups = [];
    const myChain = (st) => (seat + st) % 2;

    let round = 1, step = 0, sent = false, timerOn = false, revealed = 1;
    let chains, peerDone;
    let pad = null, tick = null, deadline = 0, timerEl = null, timerChk = null;
    let slots = [], albumCtl = null, pendingRev = 0;

    const head = el('div', { class: 'g-gartic-head' });
    const body = el('div', { class: 'g-gartic-body' });
    ctx.root.replaceChildren(el('div', { class: 'g-gartic' }, head, body));

    // ---------- fluxo ----------
    function reset() {
      stopTimer();
      if (pad) { pad.destroy(); pad = null; }
      chains = [[null, null, null, null], [null, null, null, null]];
      peerDone = [false, false, false, false];
      step = 0; sent = false; revealed = 1; pendingRev = 0;
      renderAll();
    }
    const isDrawStep = () => step < STEPS && KIND[step] === 'img';

    function submit(kind, data) {
      if (sent || step >= STEPS) return;
      const chain = myChain(step);
      chains[chain][step] = { by: seat, kind, data };
      sent = true; stopTimer();
      if (step === 0 && seat === 0) ctx.send({ g: 'gartic', t: 'opt', r: round, timer: timerOn });
      ctx.send({ g: 'gartic', t: 'sub', r: round, step, chain, kind, data });
      afterChange();
    }
    function afterChange() {
      let moved = false;
      while (step < STEPS && sent && peerDone[step]) { step++; sent = false; moved = true; }
      if (moved || sent) renderAll(); else renderHead();
    }

    const off = ctx.onMsg((m) => {
      if (!m || m.g !== 'gartic') return;
      if (m.t === 'again') {
        if (Number.isInteger(m.r) && m.r > round) { round = m.r; reset(); }
        return;
      }
      if (m.r !== round) return;
      if (m.t === 'opt') {
        timerOn = !!m.timer;
        if (timerChk) timerChk.checked = timerOn;
      } else if (m.t === 'sub') {
        const st = m.step;
        if (!Number.isInteger(st) || st < 0 || st >= STEPS || peerDone[st]) return;
        if (m.chain !== (peer + st) % 2 || m.kind !== KIND[st]) return;
        let data;
        if (m.kind === 'text') {
          if (typeof m.data !== 'string') return;
          data = m.data.trim().slice(0, PHRASE_MAX);
        } else {
          if (typeof m.data !== 'string' || m.data.length > 90000 || !IMG_RE.test(m.data)) return;
          data = m.data;
        }
        chains[m.chain][st] = { by: peer, kind: m.kind, data };
        peerDone[st] = true;
        afterChange();
      } else if (m.t === 'rev') {
        reveal(m.n, true);
      }
    });
    cleanups.push(off);

    // ---------- tempo ----------
    function fmt(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
    function tickFn() {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      if (timerEl) { timerEl.textContent = fmt(left); timerEl.classList.toggle('g-gartic-low', left <= 10); }
      if (left <= 0) { stopTimer(); if (pad && !sent) submit('img', pad.encode()); }
    }
    function startTimer() { stopTimer(); deadline = Date.now() + DRAW_SECS * 1000; tickFn(); tick = setInterval(tickFn, 250); }
    function stopTimer() { clearInterval(tick); tick = null; }

    // ---------- render ----------
    function renderAll() { renderHead(); renderBody(); }

    function renderHead() {
      head.replaceChildren();
      timerEl = null;
      if (step >= STEPS) {
        head.append(el('div', { class: 'g-gartic-title' }, el('h2', { text: tr('album') }), el('span', { class: 'muted', text: tr('albumHint') })));
        return;
      }
      const dots = el('div', { class: 'g-gartic-dots', 'aria-hidden': 'true' });
      for (let i = 0; i < STEPS; i++) dots.append(el('i', { class: 'g-gartic-pip' + (i < step ? ' done' : i === step ? ' now' : '') }));
      head.append(
        el('div', { class: 'g-gartic-title' }, el('span', { class: 'g-gartic-step muted', text: tr('stepOf', { n: step + 1 }) }), el('h2', { text: tr('s' + step) })),
        dots,
        el('div', { class: 'g-gartic-chips' },
          el('span', { class: 'g-gartic-chip' + (peerDone[step] ? ' ok' : ''), text: peerDone[step] ? tr('peerDone', { name: peerName }) : tr('peerDoing', { name: peerName, v: tr('v' + step) }) })));
      if (timerOn && isDrawStep() && !sent) {
        timerEl = el('span', { class: 'g-gartic-chip g-gartic-timer', text: fmt(DRAW_SECS) });
        head.lastChild.prepend(timerEl);
      }
    }

    function renderBody() {
      if (pad) { pad.destroy(); pad = null; }
      timerChk = null;
      body.replaceChildren();
      if (step >= STEPS) return renderAlbum();
      if (sent) return renderWait();
      if (step === 0) return renderWrite();
      if (step === 2) return renderCaption();
      renderDraw();
    }

    function textInput(ph, onSubmit, initial = '') {
      const inp = el('input', { type: 'text', maxlength: PHRASE_MAX, placeholder: ph, autocomplete: 'off', 'aria-label': ph });
      inp.value = initial;
      const go = el('button', { class: 'btn primary', type: 'button', text: tr('ready'), onClick: () => onSubmit(inp.value) });
      const upd = () => { go.disabled = !inp.value.trim(); };
      inp.addEventListener('input', upd);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && inp.value.trim()) { e.preventDefault(); onSubmit(inp.value); } });
      upd();
      return { inp, go };
    }

    function renderWrite() {
      const { inp, go } = textInput(tr('ph0'), (v) => submit('text', v.trim().slice(0, PHRASE_MAX)));
      const sug = el('button', {
        class: 'btn ghost', type: 'button', text: tr('suggest'),
        onClick: () => {
          const arr = SUGGEST[getLang()] || SUGGEST.pt;
          inp.value = arr[Math.floor(Math.random() * arr.length)];
          inp.dispatchEvent(new Event('input'));
          inp.focus();
        },
      });
      timerChk = el('input', { type: 'checkbox' });
      timerChk.checked = timerOn;
      if (seat !== 0) timerChk.disabled = true;
      else timerChk.addEventListener('change', () => { timerOn = timerChk.checked; ctx.send({ g: 'gartic', t: 'opt', r: round, timer: timerOn }); });
      const sw = el('label', { class: 'switch g-gartic-sw-row' }, timerChk, el('span', { class: 'track' }),
        el('span', { class: 'sw-label' }, tr('timer'), seat !== 0 ? el('small', { text: tr('timerHost') }) : null));
      body.append(el('div', { class: 'g-gartic-card' },
        el('p', { class: 'muted g-gartic-lead', text: tr('w0') }),
        el('div', { class: 'g-gartic-inputrow' }, inp, sug),
        sw,
        el('div', { class: 'g-gartic-actions' }, go)));
      setTimeout(() => inp.focus(), 0);
    }

    function renderDraw() {
      const src = chains[myChain(step)][step - 1];
      pad = buildPad();
      const ready = el('button', { class: 'btn primary', type: 'button', text: tr('ready'), onClick: () => pad && submit('img', pad.encode()) });
      body.append(el('div', { class: 'g-gartic-card g-gartic-drawcard' },
        el('div', { class: 'g-gartic-prompt' }, el('span', { class: 'muted', text: tr('draw') }), el('p', { class: 'g-gartic-quote', text: src ? src.data : tr('empty') })),
        pad.node,
        el('div', { class: 'g-gartic-actions' }, ready)));
      if (timerOn) startTimer();
    }

    function renderCaption() {
      const src = chains[myChain(step)][step - 1];
      const { inp, go } = textInput(tr('ph2'), (v) => submit('text', v.trim().slice(0, PHRASE_MAX)));
      body.append(el('div', { class: 'g-gartic-card' },
        el('p', { class: 'muted g-gartic-lead', text: tr('caption') }),
        imgFrame(src && src.data),
        el('div', { class: 'g-gartic-inputrow' }, inp),
        el('div', { class: 'g-gartic-actions' }, go)));
      setTimeout(() => inp.focus(), 0);
    }

    function renderWait() {
      body.append(el('div', { class: 'g-gartic-card g-gartic-wait' },
        el('div', { class: 'g-gartic-spin', 'aria-hidden': 'true' }),
        el('h3', { text: tr('waitT') }),
        el('p', { class: 'muted', text: tr('waitD', { name: peerName }) })));
    }

    function imgFrame(url) {
      const fr = el('div', { class: 'g-gartic-frame' });
      if (url && IMG_RE.test(url)) fr.append(el('img', { class: 'g-gartic-img', src: url, alt: tr('drawingAlt'), draggable: 'false' }));
      return fr;
    }

    // ---------- álbum ----------
    function slotTitle(c, k) {
      const it = chains[c][k];
      const name = names[it ? it.by : (c + k) % 2] || '?';
      return k === 0 ? tr('wrote', { name }) : k === 2 ? tr('captioned', { name }) : tr('drew', { name });
    }
    function fillSlot(c, k) {
      const s = slots[c][k], it = chains[c][k];
      s.replaceChildren(
        el('div', { class: 'g-gartic-slotlabel', text: slotTitle(c, k) }),
        it && it.kind === 'img' ? imgFrame(it.data) : el('p', { class: 'g-gartic-quote', text: it ? it.data : tr('empty') }));
      s.classList.remove('hid');
    }
    function renderAlbum() {
      slots = [[], []];
      const cols = [0, 1].map((c) => {
        const col = el('section', { class: 'g-gartic-col' }, el('h3', { class: 'g-gartic-colhead', text: tr('chainOf', { name: names[c] || '?' }) }));
        for (let k = 0; k < STEPS; k++) {
          const s = el('div', { class: 'g-gartic-slot hid', 'data-kind': KIND[k] });
          s.append(el('div', { class: 'g-gartic-slotlabel', text: '?' }), el('div', { class: 'g-gartic-hidden', text: tr('hidden') }));
          slots[c].push(s); col.append(s);
        }
        return col;
      });
      const prog = el('span', { class: 'muted g-gartic-prog' });
      const nextB = el('button', { class: 'btn primary', type: 'button', text: tr('next'), onClick: () => reveal(revealed + 1) });
      const allB = el('button', { class: 'btn ghost', type: 'button', text: tr('all'), onClick: () => reveal(STEPS) });
      const againB = el('button', { class: 'btn primary', type: 'button', text: tr('again'), onClick: playAgain });
      const quitB = el('button', { class: 'btn ghost', type: 'button', text: tr('quit'), onClick: () => ctx.end() });
      albumCtl = { prog, nextB, allB, againB, quitB };
      body.append(
        el('div', { class: 'g-gartic-ctl' }, prog, el('div', { class: 'g-gartic-ctlbtns' }, nextB, allB, againB, quitB)),
        el('div', { class: 'g-gartic-cols' }, cols));
      for (let k = 0; k < revealed; k++) for (let c = 0; c < 2; c++) fillSlot(c, k);
      if (pendingRev > revealed) { const n = pendingRev; pendingRev = 0; reveal(n, true); } else updateAlbumCtl();
    }
    function updateAlbumCtl() {
      if (!albumCtl) return;
      const done = revealed >= STEPS;
      albumCtl.prog.textContent = tr('of', { a: revealed, b: STEPS });
      albumCtl.nextB.hidden = albumCtl.allB.hidden = done;
      albumCtl.againB.hidden = albumCtl.quitB.hidden = !done;
    }
    function reveal(n, fromPeer) {
      if (step < STEPS || !Number.isInteger(n)) { if (fromPeer && Number.isInteger(n)) pendingRev = Math.max(pendingRev, Math.min(STEPS, n)); return; }
      n = Math.min(STEPS, n);
      if (n <= revealed) return;
      const from = revealed;
      revealed = n;
      for (let k = from; k < n; k++) for (let c = 0; c < 2; c++) { fillSlot(c, k); slots[c][k].classList.add('pop'); }
      updateAlbumCtl();
      if (!fromPeer) ctx.send({ g: 'gartic', t: 'rev', r: round, n });
      const last = slots[0][n - 1];
      if (last && last.scrollIntoView) last.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    function playAgain() {
      round++;
      ctx.send({ g: 'gartic', t: 'again', r: round });
      reset();
    }

    reset();

    return {
      destroy() {
        stopTimer();
        if (pad) { pad.destroy(); pad = null; }
        cleanups.forEach((f) => { try { f && f(); } catch {} });
        ctx.root.replaceChildren();
      },
    };
  },
};
