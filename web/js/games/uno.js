'use strict';
// Uno para 2 pessoas.
// Quem convidou (seat 0) é a anfitriã: guarda baralho, mãos e regras, e manda para cada lado só o que ele pode ver.
// Regras (2 jogadores): Inverter = Pular; +2/+4 fazem a outra comprar e perder a vez; sem carta que sirva, compra 1
// (pode jogar a comprada se servir, ou passar). "UNO!": quem fica com 1 carta sem apertar pode ser pega e compra 2.
import { getLang } from '../i18n.js';
import { avatar } from '../util.js';

const L = {
  pt: {
    you: 'Você', yourTurn: 'Sua vez', theirTurn: 'Vez de {name}', draw: 'Comprar', pass: 'Passar', uno: 'UNO!', catch: 'Pegar {name}!',
    pick: 'Escolha a cor', win: 'Você venceu!', lose: '{name} venceu', again: 'Jogar de novo', waitAgain: 'Esperando {name}…',
    waiting: 'Esperando {name} entrar…', cards: '{n} cartas', card1: '1 carta', deck: '{n} no monte',
    lDrew: '{who} comprou', lDrewN: '{who} comprou {n}', lSkip: '{who} perdeu a vez', lUno: '{who} gritou UNO!', lCaught: '{who} foi pega sem gritar UNO: +2',
    lColor: 'Cor: {c}', cancel: 'Cancelar', red: 'vermelho', yellow: 'amarelo', green: 'verde', blue: 'azul', tipNo: 'Nenhuma carta serve: compre uma.',
  },
  en: {
    you: 'You', yourTurn: 'Your turn', theirTurn: "{name}'s turn", draw: 'Draw', pass: 'Pass', uno: 'UNO!', catch: 'Catch {name}!',
    pick: 'Pick a color', win: 'You won!', lose: '{name} won', again: 'Play again', waitAgain: 'Waiting for {name}…',
    waiting: 'Waiting for {name} to join…', cards: '{n} cards', card1: '1 card', deck: '{n} in deck',
    lDrew: '{who} drew', lDrewN: '{who} drew {n}', lSkip: '{who} lost the turn', lUno: '{who} called UNO!', lCaught: '{who} got caught without UNO: +2',
    lColor: 'Color: {c}', cancel: 'Cancel', red: 'red', yellow: 'yellow', green: 'green', blue: 'blue', tipNo: 'Nothing fits: draw a card.',
  },
};
const tr = (k, v = {}) => String((L[getLang()] || L.pt)[k] ?? L.pt[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => (v[x] ?? ''));

/* ───────────── baralho (108 cartas) ───────────── */
const COLORS = ['r', 'y', 'g', 'b'];
const CNAME = { r: 'red', y: 'yellow', g: 'green', b: 'blue' };
const CARDS = [];
for (const c of COLORS) {
  CARDS.push({ c, v: '0' });
  for (const v of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 's', 'r', 'd2']) { CARDS.push({ c, v }); CARDS.push({ c, v }); }
}
for (let i = 0; i < 4; i++) { CARDS.push({ c: 'w', v: 'w' }); CARDS.push({ c: 'w', v: 'w4' }); }
const card = (id) => CARDS[id];
const isWild = (id) => card(id).c === 'w';
const fits = (id, top, color) => isWild(id) || card(id).c === color || card(id).v === card(top).v;

function shuffle(a, rnd) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function rng() { const u = new Uint32Array(1); return () => { crypto.getRandomValues(u); return u[0] / 2 ** 32; }; }

export default {
  start(ctx) {
    const { el } = ctx;
    const seat = ctx.seat, other = 1 - seat;
    const names = ctx.names;
    const peerName = names[other] || '…';
    let destroyed = false;
    const timers = new Set();
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!destroyed) fn(); }, ms); timers.add(t); return t; };

    /* ───────────── anfitriã: estado completo ───────────── */
    let G = null;         // só na anfitriã
    const O = ctx.opts || {};
    let starter = O.first === 'them' ? 1 : O.first === 'rand' ? (crypto.getRandomValues(new Uint8Array(1))[0] & 1) : 0;      // quem começa (alterna a cada partida)
    const HN = [5, 7, 10].includes(+O.cards) ? +O.cards : 7;
    let round = 0;
    const wins = [0, 0];   // vitórias de cada lado nesta sessão
    function newGame() {
      const rnd = rng();
      const deck = shuffle([...CARDS.keys()], rnd);
      const hands = [deck.splice(0, HN), deck.splice(0, HN)];
      let top = deck.shift();
      while (card(top).c === 'w' || !/^\d$/.test(card(top).v)) { deck.push(top); shuffle(deck, rnd); top = deck.shift(); }
      round++;
      G = { deck, discard: [top], hands, turn: starter, color: card(top).c, drew: null, uno: [false, false], vuln: null, vulnAt: 0, winner: null, log: null, round, again: [false, false], rnd, wins };
      starter = 1 - starter;
      broadcast();
    }
    const topId = () => G.discard[G.discard.length - 1];
    function drawN(s, n) {
      const got = [];
      for (let i = 0; i < n; i++) {
        if (!G.deck.length) {
          const keep = G.discard.pop();
          G.deck = shuffle(G.discard, G.rnd); G.discard = [keep];
          if (!G.deck.length) break;
        }
        got.push(G.deck.shift());
      }
      G.hands[s].push(...got);
      if (G.hands[s].length > 1) G.uno[s] = false;
      return got;
    }
    function act(s, a) {
      if (!G || G.winner !== null) return;
      // pegar quem ficou com 1 carta sem gritar (vale até a pessoa agir de novo, ou 6 s)
      if (a.a === 'catch') {
        const v = G.vuln;
        if (v !== null && v !== s && G.hands[v].length === 1 && !G.uno[v] && Date.now() - G.vulnAt < 6000) {
          drawN(v, 2); G.vuln = null; G.log = { k: 'lCaught', who: v };
          broadcast();
        }
        return;
      }
      if (a.a === 'uno') {
        if (G.hands[s].length <= 2 && !G.uno[s]) { G.uno[s] = true; if (G.vuln === s) G.vuln = null; G.log = { k: 'lUno', who: s }; broadcast(); }
        return;
      }
      if (G.turn !== s) return;
      if (G.vuln === s) G.vuln = null;
      if (a.a === 'draw') {
        if (G.drew !== null) return;
        const [got] = drawN(s, 1);
        G.log = { k: 'lDrew', who: s };
        if (got !== undefined && fits(got, topId(), G.color)) G.drew = got;   // pode jogar a que comprou
        else { G.drew = null; G.turn = 1 - s; }
        broadcast(); return;
      }
      if (a.a === 'pass') {
        if (G.drew === null) return;
        G.drew = null; G.turn = 1 - s; broadcast(); return;
      }
      if (a.a === 'play') {
        const id = a.card | 0;
        const hand = G.hands[s];
        const i = hand.indexOf(id);
        if (i < 0 || !fits(id, topId(), G.color)) return;
        if (G.drew !== null && id !== G.drew) return;            // depois de comprar, só a comprada
        const c = card(id);
        if (c.c === 'w' && !COLORS.includes(a.color)) return;
        hand.splice(i, 1);
        G.discard.push(id);
        G.color = c.c === 'w' ? a.color : c.c;
        G.drew = null;
        G.log = c.c === 'w' ? { k: 'lColor', c: G.color } : null;
        if (!hand.length) { G.winner = s; wins[s]++; broadcast(); report(); return; }
        if (hand.length === 1 && !G.uno[s]) { G.vuln = s; G.vulnAt = Date.now(); later(() => { if (G && G.vuln === s) { G.vuln = null; broadcast(); } }, 6000); }
        let next = 1 - s;
        if (c.v === 's' || c.v === 'r') { next = s; G.log = { k: 'lSkip', who: 1 - s }; }
        if (c.v === 'd2') { drawN(1 - s, 2); next = s; G.log = { k: 'lDrewN', who: 1 - s, n: 2 }; }
        if (c.v === 'w4') { drawN(1 - s, 4); next = s; G.log = { k: 'lDrewN', who: 1 - s, n: 4 }; }
        G.turn = next;
        broadcast(); return;
      }
    }
    function viewFor(s) {
      return {
        round: G.round, hand: [...G.hands[s]], oppN: G.hands[1 - s].length, top: topId(), under: G.discard.slice(-3, -1), wins: [G.wins[s], G.wins[1 - s]], color: G.color, deckN: G.deck.length,
        myTurn: G.turn === s, drew: G.turn === s ? G.drew : null, unoMe: G.uno[s], unoOpp: G.uno[1 - s],
        canCatch: G.vuln === 1 - s && G.hands[1 - s].length === 1 && !G.uno[1 - s],
        vulnMe: G.vuln === s, winner: G.winner === null ? null : (G.winner === s ? 'me' : 'opp'), againOpp: G.again[1 - s], againMe: G.again[s],
        log: G.log ? { ...G.log, who: G.log.who === undefined ? undefined : (G.log.who === s ? 'me' : 'opp') } : null,
      };
    }
    function broadcast() { if (!G) return; if (ctx.bot) botStep(); else ctx.send({ t: 'st', s: viewFor(1) }); show(viewFor(0)); }
    /* computador (assento 1): prefere cartas de ação quando a pessoa está perto de acabar, guarda curingas */
    let botT = null;
    function botStep() {
      clearTimeout(botT); botT = null;
      if (!G) return;
      if (G.winner !== null) { if (G.again[0] && !G.again[1]) botT = later(() => { G.again[1] = true; newGame(); }, 600); return; }
      // pega a pessoa que esqueceu de gritar UNO
      if (G.vuln === 0 && G.hands[0].length === 1 && !G.uno[0]) { botT = later(() => act(1, { a: 'catch' }), 1500 + Math.random() * 2500); return; }
      if (G.turn !== 1) return;
      const hand = G.hands[1];
      const lvl = (ctx.bot && ctx.bot.level) || 'normal';
      botT = later(() => {
        if (!G || G.turn !== 1 || G.winner !== null) return;
        if (hand.length <= 2 && !G.uno[1] && Math.random() > (lvl === 'easy' ? 0.5 : 0.05)) act(1, { a: 'uno' });
        const ok = (G.drew !== null ? [G.drew] : hand).filter((id) => fits(id, topId(), G.color));
        if (!ok.length) { act(1, { a: G.drew !== null ? 'pass' : 'draw' }); return; }
        const danger = G.hands[0].length <= 2;
        const rank = (id) => { const c = card(id); let r = 0;
          if (c.c === 'w') r -= danger ? -5 : 10;
          if (['s', 'r', 'd2'].includes(c.v)) r += danger ? 8 : 2;
          if (c.v === 'w4') r += danger ? 12 : -12;
          if (c.c === G.color) r += 3;
          r += hand.filter((x) => card(x).c === c.c).length;
          return r + Math.random() * (lvl === 'easy' ? 8 : 1); };
        const id = ok.sort((a, b) => rank(b) - rank(a))[0];
        const cnt = {}; for (const x of hand) if (card(x).c !== 'w' && x !== id) cnt[card(x).c] = (cnt[card(x).c] || 0) + 1;
        const color = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || COLORS[Math.floor(Math.random() * 4)];
        act(1, { a: 'play', card: id, color });
      }, 900 + Math.random() * 900);
    }
    function report() { if (ctx.result) ctx.result({ winner: G.winner }); }

    /* ───────────── os dois lados: tela ───────────── */
    let V = null;            // última visão recebida
    let choosing = null;     // carta curinga esperando a cor
    let lastTop = null, lastHand = '';
    const seatEl = (u, name, cls) => {
      const box = el('div', { class: 'g-uno-seat ' + cls });
      box.append(el('span', { class: 'g-uno-avw' }, avatar(u || { name }, 'md')), el('span', { class: 'g-uno-sn' }, el('b', { text: name }), el('small')));
      return box;
    };
    const oppSeat = seatEl(ctx.peer, peerName, 'opp');
    const meSeat = seatEl(ctx.me, tr('you'), 'me');
    const oppFan = el('div', { class: 'g-uno-fan', 'aria-hidden': 'true' });
    const score = el('div', { class: 'g-uno-score', 'aria-label': 'placar' });
    const log = el('div', { class: 'g-uno-log', role: 'status' });
    const table = el('div', { class: 'g-uno-table' });
    const status = el('div', { class: 'g-uno-status' });
    const handBox = el('div', { class: 'g-uno-hand' });
    const actions = el('div', { class: 'g-uno-acts' });
    const overlay = el('div', { class: 'g-uno-ov' });
    const wrap = el('div', { class: 'g-uno' },
      el('div', { class: 'g-uno-top' }, oppSeat, oppFan, score),
      el('div', { class: 'g-uno-felt' }, log, table, status),
      el('div', { class: 'g-uno-bottom' }, el('div', { class: 'g-uno-mebar' }, meSeat, actions), handBox),
      overlay);
    ctx.root.append(wrap);

    function cardEl(id, opts = {}) {
      const c = card(id);
      const sym = { s: '⊘', r: '⇄', d2: '+2', w: '', w4: '+4' }[c.v] ?? c.v;
      const n = el(opts.tag || 'div', { class: `g-uno-card c-${c.c} v-${c.v}` + (opts.cls ? ' ' + opts.cls : ''), dataset: { id: String(id) }, 'aria-label': label(id), type: opts.tag === 'button' ? 'button' : null },
        el('span', { class: 'g-uno-ix tl', text: sym || '' }),
        c.c === 'w' ? el('span', { class: 'g-uno-wheel' }, sym ? el('b', { text: sym }) : null) : el('span', { class: 'g-uno-big', text: sym }),
        el('span', { class: 'g-uno-ix br', text: sym || '' }));
      return n;
    }
    function label(id) {
      const c = card(id);
      const v = { s: 'pular', r: 'inverter', d2: '+2', w: 'curinga', w4: 'curinga +4' }[c.v] || c.v;
      return c.c === 'w' ? v : `${v} ${tr(CNAME[c.c])}`;
    }
    const back = (cls = '') => el('div', { class: 'g-uno-card back ' + cls }, el('b', { class: 'g-uno-word', text: 'UNO' }));
    // inclinação "aleatória" mas fixa para cada carta da pilha
    const tilt = (id) => ((id * 37) % 23) - 11;

    function show(v) {
      V = v;
      if (!v) { status.textContent = tr('waiting', { name: peerName }); status.className = 'g-uno-status'; return; }
      wrap.dataset.color = v.color;
      wrap.classList.toggle('my-turn', !!v.myTurn && !v.winner);
      // assentos
      oppSeat.classList.toggle('turn', !v.myTurn && !v.winner);
      meSeat.classList.toggle('turn', !!v.myTurn && !v.winner);
      oppSeat.querySelector('small').textContent = v.oppN === 1 ? tr('card1') : tr('cards', { n: v.oppN });
      meSeat.querySelector('small').textContent = v.hand.length === 1 ? tr('card1') : tr('cards', { n: v.hand.length });
      oppSeat.classList.toggle('uno', v.oppN === 1);
      // leque da adversária (em arco)
      const k = Math.min(v.oppN, 16);
      oppFan.replaceChildren(...Array.from({ length: k }, (_, i) => {
        const b = back('sm'); const off = i - (k - 1) / 2;
        b.style.setProperty('--rot', (off * Math.min(6, 60 / Math.max(k, 1))).toFixed(1) + 'deg');
        b.style.setProperty('--dy', (Math.abs(off) * Math.abs(off) * 0.5).toFixed(1) + 'px');
        return b;
      }));
      score.replaceChildren(el('b', { text: String(v.wins ? v.wins[0] : 0) }), el('span', { text: '×' }), el('b', { text: String(v.wins ? v.wins[1] : 0) }));
      score.hidden = !v.wins || (v.wins[0] + v.wins[1] === 0);
      // mesa: monte + pilha (com as duas anteriores por baixo)
      const fresh = lastTop !== null && lastTop !== v.top;
      lastTop = v.top;
      const under = (v.under || []).map((id) => { const u = cardEl(id, { cls: 'under' }); u.style.setProperty('--t', tilt(id) + 'deg'); return u; });
      const top = cardEl(v.top, { cls: 'top' + (fresh ? ' land' : '') });
      top.style.setProperty('--t', (tilt(v.top) / 2) + 'deg');
      const canDraw = v.myTurn && v.drew === null && !v.winner;
      const deckBtn = el('button', { class: 'g-uno-deck' + (canDraw ? ' live' : ''), type: 'button', 'aria-label': tr('draw'), disabled: !canDraw },
        back('d3'), back('d2'), back('d1'), el('small', { text: tr('deck', { n: v.deckN }) }));
      deckBtn.addEventListener('click', () => send({ a: 'draw' }));
      table.replaceChildren(deckBtn, el('div', { class: 'g-uno-pile' }, ...under, top,
        el('span', { class: 'g-uno-dot c-' + v.color, title: tr('lColor', { c: tr(CNAME[v.color] || '') }) })));
      // status e acontecimento
      const playable = v.myTurn && !v.winner ? v.hand.filter((id) => (v.drew !== null ? id === v.drew : fits(id, v.top, v.color))) : [];
      let st = v.winner ? '' : v.myTurn ? tr('yourTurn') : tr('theirTurn', { name: peerName });
      if (v.myTurn && !playable.length && v.drew === null && !v.winner) st = tr('tipNo');
      status.textContent = st;
      status.className = 'g-uno-status' + (v.myTurn && !v.winner ? ' mine' : '');
      const logTxt = v.log ? tr(v.log.k, { who: v.log.who === 'me' ? tr('you') : peerName, n: v.log.n, c: tr(CNAME[v.log.c] || '') }) : '';
      if (logTxt !== log.textContent) { log.textContent = logTxt; log.classList.remove('pop'); void log.offsetWidth; log.classList.toggle('pop', !!logTxt); }
      // minha mão em arco (ordenada por cor e valor)
      const order = 'rygbw';
      const sorted = [...v.hand].sort((a, b) => order.indexOf(card(a).c) - order.indexOf(card(b).c) || CARDS.indexOf(card(a)) - CARDS.indexOf(card(b)) || a - b);
      const n = sorted.length;
      const spread = Math.min(5, 36 / Math.max(n, 1));
      const bend = Math.min(spread * 0.32, 16 / Math.max(1, ((n - 1) / 2) ** 2));
      const handKey = sorted.join(',');
      const newOnes = new Set(sorted.filter((id) => !lastHand.split(',').includes(String(id))));
      handBox.replaceChildren(...sorted.map((id, i) => {
        const ok = playable.includes(id);
        const b = cardEl(id, { tag: 'button', cls: (ok ? 'ok' : (v.myTurn && !v.winner ? 'no' : '')) + (lastHand && newOnes.has(id) ? ' drawn' : '') });
        const off = i - (n - 1) / 2;
        b.style.setProperty('--rot', (off * spread).toFixed(2) + 'deg');
        b.style.setProperty('--dy', (off * off * bend).toFixed(1) + 'px');
        b.style.zIndex = String(i + 1);
        b.disabled = !ok;
        b.addEventListener('click', () => play(id));
        return b;
      }));
      lastHand = handKey;
      handBox.style.setProperty('--n', String(n));
      fitHand();
      // ações
      const btns = [];
      if (v.myTurn && v.drew !== null && !v.winner) btns.push(el('button', { class: 'g-uno-pass', type: 'button', text: tr('pass'), onClick: () => send({ a: 'pass' }) }));
      if (!v.winner && v.hand.length <= 2 && !v.unoMe) btns.push(el('button', { class: 'g-uno-unobtn' + (v.vulnMe ? ' hot' : ''), type: 'button', text: tr('uno'), onClick: () => send({ a: 'uno' }) }));
      if (v.canCatch && !v.winner) btns.push(el('button', { class: 'g-uno-catch', type: 'button', text: tr('catch', { name: peerName }), onClick: () => send({ a: 'catch' }) }));
      actions.replaceChildren(...btns);
      // fim / cor do curinga
      overlay.replaceChildren();
      overlay.classList.toggle('on', !!v.winner || choosing !== null);
      if (v.winner) {
        overlay.append(el('div', { class: 'g-uno-end ' + v.winner },
          el('span', { class: 'g-uno-avw big' }, avatar(v.winner === 'me' ? ctx.me : (ctx.peer || { name: peerName }), 'lg')),
          el('b', { text: v.winner === 'me' ? tr('win') : tr('lose', { name: peerName }) }),
          v.wins ? el('div', { class: 'g-uno-endsc' }, el('span', { text: tr('you') }), el('b', { text: `${v.wins[0]} × ${v.wins[1]}` }), el('span', { text: peerName })) : null,
          v.againMe ? el('small', { text: tr('waitAgain', { name: peerName }) }) : el('button', { class: 'btn primary', type: 'button', text: tr('again'), onClick: again })));
      } else if (choosing !== null) {
        overlay.append(el('div', { class: 'g-uno-pick' }, el('b', { text: tr('pick') }),
          el('div', { class: 'g-uno-colors' }, ...COLORS.map((c) => el('button', { class: 'g-uno-col c-' + c, type: 'button', 'aria-label': tr(CNAME[c]), onClick: () => { const id = choosing; choosing = null; send({ a: 'play', card: id, color: c }); } }))),
          el('button', { class: 'g-uno-cancel', type: 'button', text: tr('cancel'), onClick: () => { choosing = null; show(V); } })));
      }
    }
    // sobreposição da mão: o mínimo necessário para caber na largura (até 80% da carta)
    function fitHand() {
      const first = handBox.firstElementChild; if (!first) return;
      const cw = first.offsetWidth, n = handBox.children.length, w = handBox.clientWidth - 24;
      if (!cw || !w) return;
      const need = n > 1 ? (n * cw - w) / (n - 1) : 0;
      handBox.style.setProperty('--ov', Math.min(cw * 0.8, Math.max(cw * 0.32, need)).toFixed(1) + 'px');
    }
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fitHand()) : null;
    if (ro) ro.observe(handBox);

    function play(id) {
      if (!V || !V.myTurn) return;
      if (isWild(id)) { choosing = id; show(V); return; }
      send({ a: 'play', card: id });
    }
    function again() {
      if (seat === 0) { G.again[0] = true; if (G.again[1]) newGame(); else broadcast(); }
      else ctx.send({ t: 'again' });
    }
    function send(a) {
      if (seat === 0) act(0, a); else ctx.send({ t: 'act', ...a });
    }

    // teclado (computador): 1–9 jogam a carta jogável n; espaço compra/passa; U grita UNO
    const onKey = (e) => {
      if (!V || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) return;
      if (e.key === ' ' && V.myTurn) { e.preventDefault(); send({ a: V.drew !== null ? 'pass' : 'draw' }); }
      else if (e.key.toLowerCase() === 'u') send({ a: 'uno' });
      else if (/^[1-9]$/.test(e.key)) { const b = handBox.querySelectorAll('.g-uno-card.ok')[Number(e.key) - 1]; if (b) b.click(); }
    };
    addEventListener('keydown', onKey);

    const off = ctx.onMsg((m) => {
      if (destroyed || !m) return;
      if (seat === 0) {
        if (m.t === 'hi') { if (!G) newGame(); else broadcast(); }
        else if (m.t === 'act') act(1, m);
        else if (m.t === 'again' && G && G.winner !== null) { G.again[1] = true; if (G.again[0]) newGame(); else broadcast(); }
      } else if (m.t === 'st' && m.s && Array.isArray(m.s.hand)) {
        if (choosing !== null && !m.s.hand.includes(choosing)) choosing = null;
        show(m.s);
      }
    });
    show(null);
    if (seat === 1) ctx.send({ t: 'hi' });
    else if (ctx.bot) newGame();
    else later(() => { if (!G) status.textContent = tr('waiting', { name: peerName }); }, 0);

    return {
      destroy() {
        destroyed = true; off && off(); clearTimeout(botT);
        removeEventListener('keydown', onKey);
        if (ro) ro.disconnect();
        for (const t of timers) clearTimeout(t);
      },
    };
  },
};
