'use strict';
// Desenhe e adivinhe: as duas se revezam. Quem desenha escolhe 1 de 3 palavras e tem 80 s.
// Quem adivinha digita palpites; dicas de letras aparecem com o tempo. Acertou rápido, mais pontos para as duas.
import { el } from '../util.js';
import { hosted, makeTr, seats, endBox, waitingPeer, rand, shuffle, norm, kt } from './kit.js';

const tr = makeTr({
  pt: { choose: 'Escolha o que desenhar', chooseWait: '{name} está escolhendo a palavra…', draw: 'Desenhe: {w}', guess: 'Adivinhe o desenho de {name}', ph: 'Seu palpite…', send: 'Chutar',
    right: '{name} acertou!', youRight: 'Você acertou!', close: 'Quase!', was: 'Era: {w}', timeUp: 'Tempo esgotado', round: 'Rodada {n} de {t}', clear: 'Limpar', undo: 'Desfazer', eraser: 'Borracha',
    win: 'Você venceu!', lose: '{name} venceu', draw0: 'Empate!', pts: '{n} pts', letters: '{n} letras' },
  en: { choose: 'Pick something to draw', chooseWait: '{name} is picking a word…', draw: 'Draw: {w}', guess: "Guess {name}'s drawing", ph: 'Your guess…', send: 'Guess',
    right: '{name} got it!', youRight: 'You got it!', close: 'So close!', was: 'It was: {w}', timeUp: "Time's up", round: 'Round {n} of {t}', clear: 'Clear', undo: 'Undo', eraser: 'Eraser',
    win: 'You won!', lose: '{name} won', draw0: 'Draw!', pts: '{n} pts', letters: '{n} letters' },
});
const WORDS_PT = ('abacaxi avião bicicleta borboleta cachorro gato castelo chapéu cobra coração dinossauro elefante escada estrela foguete fogueira girafa guarda-chuva helicóptero igreja ' +
  'jacaré lâmpada laranja leão lua maçã macaco martelo melancia montanha navio óculos ovo palhaço pão pato peixe pinguim pipa pizza praia relógio robô sapato sereia sol sorvete ' +
  'tartaruga telefone tesoura trem tubarão unicórnio vaca violão vulcão zebra abelha árvore banana barco bolo cadeira câmera caneta carro casa cenoura chave chuva computador ' +
  'coroa dente dragão escova fantasma flor formiga fantasma garrafa geladeira guitarra hambúrguer ilha janela lápis livro mão microfone mochila moto nuvem orelha panela ' +
  'pássaro piano pirata polvo porta presente raio rato sanduíche sino skate sofá tênis tomate travesseiro trator urso vela xícara bruxa cama caracol coelho cogumelo cometa ' +
  'escorregador ferradura fone gelo gravata lagosta lanterna mapa medalha mesa moinho morango ninho olho paraquedas pente pé pipoca planeta ponte queijo rede rosa saturno tambor tenda').split(' ').filter(Boolean);
const WORDS_EN = ('pineapple airplane bicycle butterfly dog cat castle hat snake heart dinosaur elephant ladder star rocket campfire giraffe umbrella helicopter church alligator lamp orange lion moon ' +
  'apple monkey hammer watermelon mountain ship glasses egg clown bread duck fish penguin kite pizza beach clock robot shoe mermaid sun icecream turtle phone scissors train shark unicorn ' +
  'cow guitar volcano zebra bee tree banana boat cake chair camera pen car house carrot key rain computer crown tooth dragon ghost flower ant bottle fridge burger island window pencil book').split(' ');
const ROUNDS = 6, CHOOSE_MS = 15000, DRAW_MS = 80000, REVEAL_MS = 4000;
const COLORS = ['#1B1824', '#F0423A', '#F2B01E', '#22B566', '#2F7BF6', '#8B5CF6', '#FF7AB6', '#8B5A2B', '#FFFFFF'];
const SIZES = [4, 9, 18];
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export default {
  start(ctx) {
    const me = ctx.seat, other = 1 - me;
    const words = () => (document.documentElement.lang || '').startsWith('en') ? WORDS_EN : WORDS_PT;
    /* ── tela fixa (o quadro não é recriado) ── */
    const W = 800, H = 600;
    const canvas = el('canvas', { class: 'dw-canvas', width: String(W), height: String(H) });
    const g = canvas.getContext('2d');
    const head = el('div', { class: 'dw-head' });
    const prompt = el('div', { class: 'dw-prompt' });
    const timer = el('div', { class: 'dw-time' }, el('i'));
    const tools = el('div', { class: 'dw-tools' });
    const log = el('div', { class: 'dw-log', 'aria-live': 'polite' });
    const input = el('input', { class: 'dw-in', type: 'text', maxlength: '40', placeholder: tr('ph'), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'send' });
    const form = el('form', { class: 'dw-form' }, input, el('button', { class: 'btn primary', type: 'submit', text: tr('send') }));
    const pick = el('div', { class: 'dw-pick' });
    const overlay = el('div', { class: 'dw-ovw' });
    const stage = el('div', { class: 'dw-stage' }, canvas, pick);
    const root = el('div', { class: 'gk dw' }, head, prompt, timer, stage, tools, log, form, overlay);
    ctx.root.replaceChildren(root);

    let sentStart = false, strokes = [], curStroke = null, color = COLORS[0], size = 1, round = 0, amDrawing = false, endsAt = 0, total = 1, V = null, apiRef = null;
    function clearCanvas() { g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); }
    function paintStroke(s, from = 0) {
      g.strokeStyle = s.c; g.fillStyle = s.c; g.lineWidth = s.w; g.lineCap = 'round'; g.lineJoin = 'round';
      const p = s.p;
      if (p.length === 2 && from === 0) { g.beginPath(); g.arc(p[0] * W, p[1] * H, s.w / 2, 0, Math.PI * 2); g.fill(); return; }
      g.beginPath(); const st = Math.max(0, from - 2); g.moveTo(p[st] * W, p[st + 1] * H);
      for (let i = st + 2; i < p.length; i += 2) g.lineTo(p[i] * W, p[i + 1] * H);
      g.stroke();
    }
    function redraw() { clearCanvas(); for (const s of strokes) paintStroke(s); }
    clearCanvas();

    // desenhar (só quem desenha)
    let pending = [];
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))].map((x) => Math.round(x * 1000) / 1000); };
    canvas.addEventListener('pointerdown', (e) => {
      if (!amDrawing) return; e.preventDefault(); canvas.setPointerCapture(e.pointerId);
      const [x, y] = pos(e);
      curStroke = { id: Math.random().toString(36).slice(2, 9), c: color, w: SIZES[size] * (color === '#FFFFFF' ? 2 : 1), p: [x, y] };
      strokes.push(curStroke); paintStroke(curStroke);
      apiRef.raw({ k: 'b', id: curStroke.id, c: curStroke.c, w: curStroke.w, p: [x, y] });
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!curStroke) return;
      const [x, y] = pos(e); const n = curStroke.p.length;
      if (Math.abs(curStroke.p[n - 2] - x) < 0.002 && Math.abs(curStroke.p[n - 1] - y) < 0.002) return;
      curStroke.p.push(x, y); pending.push(x, y); paintStroke(curStroke, n);
    });
    const endStroke = () => { flush(); curStroke = null; };
    canvas.addEventListener('pointerup', endStroke); canvas.addEventListener('pointercancel', endStroke);
    function flush() { if (curStroke && pending.length) { apiRef.raw({ k: 'p', id: curStroke.id, p: pending }); pending = []; } }
    const flushT = setInterval(flush, 60);

    form.addEventListener('submit', (e) => { e.preventDefault(); const t = input.value.trim(); if (!t) return; apiRef.send({ k: 'guess', t }); input.value = ''; });
    const clock = setInterval(() => {
      const left = Math.max(0, endsAt - Date.now());
      timer.firstChild.style.setProperty('--p', String(Math.min(1, left / total)));
      timer.dataset.s = String(Math.ceil(left / 1000));
      timer.classList.toggle('hurry', left < 10000 && V && V.ph === 'draw');
    }, 200);

    function buildTools() {
      tools.replaceChildren(
        el('div', { class: 'dw-cols' }, ...COLORS.map((c) => { const b = el('button', { class: 'dw-sw' + (c === color ? ' on' : '') + (c === '#FFFFFF' ? ' er' : ''), type: 'button', 'aria-label': c === '#FFFFFF' ? tr('eraser') : c, onClick: () => { color = c; buildTools(); } }); b.style.setProperty('--c', c); return b; })),
        el('div', { class: 'dw-sizes' }, ...SIZES.map((s, i) => { const b = el('button', { class: 'dw-sz' + (i === size ? ' on' : ''), type: 'button', 'aria-label': String(s), onClick: () => { size = i; buildTools(); } }, el('i')); b.firstChild.style.setProperty('--s', (6 + i * 6) + 'px'); return b; })),
        el('button', { class: 'btn sm', type: 'button', text: tr('undo'), onClick: () => { const s = strokes.pop(); if (s) { redraw(); apiRef.raw({ k: 'u', id: s.id }); } } }),
        el('button', { class: 'btn sm', type: 'button', text: tr('clear'), onClick: () => { strokes = []; redraw(); apiRef.raw({ k: 'c' }); } }));
    }

    const h = hosted(ctx, {
      init(prev) {
        const S = { r: 0, drawer: prev ? 1 - prev.firstDrawer : 0, firstDrawer: prev ? 1 - prev.firstDrawer : 0, ph: 'choose', choices: [], word: '', hint: [], left: 0, log: [], pts: [0, 0],
          over: false, winner: null, score: prev ? prev.score : [0, 0], got: false, t0: 0 };
        S.drawer = 1 - S.firstDrawer;   // nextRound troca antes de começar
        return S;
      },
      act(S, seat, a, api) {
        if (S.over) return false;
        if (!S.started) { S.started = true; nextRound(S); return; }
        else if (a.k === 'start') return false;
        const moved = check(S, api);
        if (a.k === 'tick') return moved ? undefined : false;
        if (a.k === 'pick' && S.ph === 'choose' && seat === S.drawer) { const w = S.choices[a.i | 0]; if (!w) return false; beginDraw(S, w); return; }
        if (a.k === 'guess' && S.ph === 'draw' && seat !== S.drawer) {
          const t = String(a.t || '').slice(0, 40); const n = norm(t), w = norm(S.word);
          if (!n) return false;
          if (n === w) {
            const left = Math.max(0, S.ends - Date.now());
            const gain = 50 + Math.ceil(left / 1000), dg = 25 + Math.ceil(left / 2000);
            S.pts[seat] += gain; S.pts[S.drawer] += dg; S.got = true;
            S.log.push({ by: seat, ok: true, g: gain, dg });
            reveal(S); return;
          }
          S.log.push({ by: seat, t, close: lev(n, w) === 1 });
          if (S.log.length > 40) S.log.shift();
          return;
        }
        return false;
      },
      view(S, s) {
        const drawer = s === S.drawer;
        return { r: S.r, drawer: S.drawer, ph: S.ph, choices: drawer && S.ph === 'choose' ? S.choices : [], word: drawer || S.ph === 'reveal' || S.over ? S.word : '',
          mask: S.word ? [...S.word].map((ch, i) => (ch === ' ' || ch === '-' ? ch : S.hint.includes(i) ? ch : '_')) : [], left: Math.max(0, (S.ends || 0) - Date.now()), total: S.total || 1,
          log: S.log, pts: S.pts, over: S.over, winner: S.winner, score: S.score, got: S.got, started: !!S.started };
      },
      render(v, api) { apiRef = api; V = v; paint(v, api); },
      raw(m) {
        if (amDrawing) return;
        if (m.k === 'b') { const s = { id: m.id, c: String(m.c).slice(0, 9), w: Math.min(60, +m.w || 4), p: (m.p || []).slice(0, 2) }; strokes.push(s); paintStroke(s); }
        else if (m.k === 'p') { const s = strokes.find((x) => x.id === m.id); if (!s || !Array.isArray(m.p)) return; const n = s.p.length; s.p.push(...m.p.slice(0, 4000)); paintStroke(s, n); }
        else if (m.k === 'u') { strokes = strokes.filter((x) => x.id !== m.id); redraw(); }
        else if (m.k === 'c') { strokes = []; redraw(); }
      },
    });
    // anfitriã: liga o relógio das rodadas quando a outra entrar
    // Os prazos são conferidos sempre que chega qualquer mensagem (inclusive o "tique" que as duas mandam a cada
    // segundo), não só pelo relógio da anfitriã: com o app em segundo plano, o navegador quase para os relógios.
    function nextRound(S) {
      S.r++; S.drawer = 1 - S.drawer; S.ph = 'choose'; S.word = ''; S.hint = []; S.log = []; S.got = false;
      S.choices = shuffle(words().slice()).slice(0, 3);
      S.total = CHOOSE_MS; S.ends = Date.now() + CHOOSE_MS;
    }
    function beginDraw(S, w) {
      S.word = w; S.ph = 'draw'; S.total = DRAW_MS; S.ends = Date.now() + DRAW_MS; S.hint = []; S.h1 = false; S.h2 = false;
    }
    function reveal(S) { S.ph = 'reveal'; S.total = REVEAL_MS; S.ends = Date.now() + REVEAL_MS; }
    function check(S, api) {
      if (!S.started || S.over) return false;
      const now = Date.now(); let changed = false;
      if (S.ph === 'choose' && now >= S.ends) { beginDraw(S, S.choices[rand(3)]); changed = true; }
      if (S.ph === 'draw') {
        const letters = [...S.word].map((ch, i) => (/[^ -]/.test(ch) ? i : -1)).filter((i) => i >= 0);
        const left = S.ends - now;
        if (!S.h1 && left <= DRAW_MS * 0.5) { S.h1 = true; S.hint.push(letters[rand(letters.length)]); changed = true; }
        if (!S.h2 && left <= DRAW_MS * 0.25) { S.h2 = true; const rest = letters.filter((i) => !S.hint.includes(i)); if (rest.length > 2) S.hint.push(rest[rand(rest.length)]); changed = true; }
        if (left <= 0) { reveal(S); changed = true; }
      }
      if (S.ph === 'reveal' && now >= S.ends) {
        if (S.r >= ROUNDS) { S.over = true; S.winner = S.pts[0] > S.pts[1] ? 0 : S.pts[1] > S.pts[0] ? 1 : -1; if (S.winner >= 0) S.score[S.winner]++; api.result(S.winner, [...S.pts]); }
        else nextRound(S);
        changed = true;
      }
      return changed;
    }
    const tick = setInterval(() => { if (apiRef && V && V.started && !V.over) apiRef.send({ k: 'tick' }); }, 1000);

    function paint(v, api) {
      if (v.r !== round) { round = v.r; strokes = []; redraw(); }
      amDrawing = v.ph === 'draw' && v.drawer === me && !v.over;
      endsAt = Date.now() + v.left; total = v.total;
      root.classList.toggle('drawing', amDrawing);
      head.replaceChildren(seats(ctx, v, { turn: v.over ? null : v.drawer, score: v.score, sub: me === 0 ? [tr('pts', { n: v.pts[0] }), tr('pts', { n: v.pts[1] })] : [tr('pts', { n: v.pts[0] }), tr('pts', { n: v.pts[1] })] }));
      // fala / dica
      const drawerName = ctx.names[v.drawer];
      if (!v._here && api.host) { prompt.replaceChildren(waitingPeer(ctx)); }
      else if (v.ph === 'choose') prompt.replaceChildren(el('small', { text: tr('round', { n: v.r, t: ROUNDS }) }), el('b', { text: v.drawer === me ? tr('choose') : tr('chooseWait', { name: drawerName }) }));
      else if (v.ph === 'draw') prompt.replaceChildren(el('small', { text: tr('round', { n: v.r, t: ROUNDS }) }), v.drawer === me ? el('b', { text: tr('draw', { w: v.word }) })
        : el('b', { class: 'dw-mask', text: v.mask.join(' ') }), v.drawer === me ? null : el('small', { text: tr('letters', { n: v.mask.filter((c) => c !== ' ' && c !== '-').length }) }));
      else if (v.ph === 'reveal') prompt.replaceChildren(el('small', { text: v.got ? '' : tr('timeUp') }), el('b', { text: tr('was', { w: v.word }) }));
      // escolha de palavra
      pick.replaceChildren(...(v.ph === 'choose' && v.drawer === me ? v.choices.map((w, i) => el('button', { class: 'dw-word', type: 'button', text: w, onClick: () => api.send({ k: 'pick', i }) })) : []));
      pick.hidden = !(v.ph === 'choose' && v.drawer === me);
      if (amDrawing && !tools.childNodes.length) buildTools();
      tools.hidden = !amDrawing;
      if (!amDrawing) tools.replaceChildren();
      // palpites
      log.replaceChildren(...v.log.slice(-8).map((x) => el('div', { class: 'dw-l' + (x.ok ? ' ok' : '') + (x.close ? ' close' : '') },
        el('b', { text: x.by === me ? kt('you') : ctx.names[x.by] }),
        el('span', { text: x.ok ? (x.by === me ? tr('youRight') : tr('right', { name: ctx.names[x.by] })) + ` +${x.g}` : x.t + (x.close ? ' · ' + tr('close') : '') }))));
      const canGuess = v.ph === 'draw' && v.drawer !== me && !v.over;
      form.hidden = !canGuess; input.disabled = !canGuess;
      overlay.replaceChildren(v.over ? endBox(ctx, v, api, { title: v.winner === -1 ? tr('draw0') : v.winner === me ? tr('win') : tr('lose', { name: ctx.names[other] }), detail: `${v.pts[me]} × ${v.pts[other]}`, tone: v.winner === me ? 'win' : '' }) : '');
      // a anfitriã começa a 1ª rodada quando a outra chega
      if (!v.started && v._here) { if (api.host) api.later(() => api.send({ k: 'start' }), 0); else if (!sentStart) { sentStart = true; api.send({ k: 'start' }); } }
    }
    return { destroy() { clearInterval(flushT); clearInterval(clock); clearInterval(tick); h.destroy(); } };
  },
};
