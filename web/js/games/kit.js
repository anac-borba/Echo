'use strict';
// Peças comuns dos jogos a dois.
//  - hosted(): quem convidou (seat 0) guarda o estado e aplica as jogadas das duas; cada lado recebe só a sua "visão"
//    (assim dá para esconder navios, palavras, personagens…).
//  - seats(): faixa com as duas jogadoras, de quem é a vez e o placar da série.
//  - endBox(): cartão de fim de rodada com "Jogar de novo" (as duas precisam aceitar).
import { getLang } from '../i18n.js';
import { el, avatar } from '../util.js';

export function makeTr(L) {
  return (k, v) => {
    let s = (L[getLang()] || L.pt)[k] ?? L.pt[k] ?? k;
    if (v) for (const [a, b] of Object.entries(v)) s = s.split('{' + a + '}').join(String(b));
    return s;
  };
}
const K = makeTr({
  pt: { you: 'Você', again: 'Jogar de novo', waitAgain: 'Esperando {name}…', wantsAgain: '{name} quer jogar de novo', waiting: 'Esperando {name} entrar…', yourTurn: 'Sua vez', theirTurn: 'Vez de {name}' },
  en: { you: 'You', again: 'Play again', waitAgain: 'Waiting for {name}…', wantsAgain: '{name} wants a rematch', waiting: 'Waiting for {name} to join…', yourTurn: 'Your turn', theirTurn: "{name}'s turn" },
});
export const kt = K;

export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function shuffle(a) { const u = new Uint32Array(1); for (let i = a.length - 1; i > 0; i--) { crypto.getRandomValues(u); const j = u[0] % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
export function rand(n) { const u = new Uint32Array(1); crypto.getRandomValues(u); return u[0] % n; }

/**
 * Jogo com anfitriã.
 * spec: {
 *   init() -> estado novo (só na anfitriã),
 *   act(S, seat, a, api) -> false para ignorar; qualquer outra coisa = mudou,
 *   view(S, seat) -> o que aquele lado pode ver,
 *   render(v, api) -> desenha (os dois lados),
 *   raw?(m, api) -> mensagens diretas (ex.: traços do desenho), sem passar pela anfitriã
 * }
 * api: { seat, host, send(a), raw(m), update(fn), later(fn, ms), result(winnerSeat|-1, score?), state() }
 */
export function hosted(ctx, spec) {
  const host = ctx.seat === 0;
  // contra o computador: o "outro lado" é spec.bot, que joga como assento 1 aqui mesmo
  const bot = host && ctx.bot && spec.bot ? spec.bot : null;
  let S = null, destroyed = false, peerHere = !!bot, botT = null;
  const timers = new Set();
  const cleanups = [];
  const api = {
    seat: ctx.seat, host, names: ctx.names, ctx,
    send: (a) => { if (host) apply(0, a); else ctx.send({ t: 'a', a }); },
    raw: (m) => ctx.send({ t: 'r', m }),
    update: (fn) => { if (!host || !S) return; fn(S); bcast(); },
    later: (fn, ms) => { const t = setTimeout(() => { timers.delete(t); if (!destroyed) fn(); }, ms); timers.add(t); return t; },
    clear: (t) => { clearTimeout(t); timers.delete(t); },
    result: (w, score) => { if (host && ctx.result) ctx.result({ winner: w, score }); },
    state: () => S,
    applyAs: (seat, a) => { if (host) apply(seat, a); },
    peerHere: () => peerHere,
    onCleanup: (fn) => cleanups.push(fn),
  };
  function apply(seat, a) {
    if (!S || !a || typeof a !== 'object') return;
    // revanche é comum a todos os jogos
    if (a.k === 'again') {
      if (!S.over) return;
      S.again = S.again || [false, false]; S.again[seat] = true;
      if (S.again[0] && S.again[1]) { const prev = S; S = spec.init(prev); }
      bcast(); return;
    }
    let r;
    try { r = spec.act(S, seat, a, api); } catch (e) { console.error('jogo', e); return; }
    if (r === false) return;
    bcast();
  }
  function bcast() {
    if (!S) return;
    const v1 = spec.view(S, 1); v1._again = S.again || null; v1._over = !!S.over; v1._here = true;
    if (peerHere) ctx.send({ t: 'v', v: v1 });
    const v0 = spec.view(S, 0); v0._again = S.again || null; v0._over = !!S.over; v0._here = peerHere;
    draw(v0);
    if (bot) schedBot(v1);
  }
  function schedBot(v1) {
    clearTimeout(botT); botT = null;
    if (destroyed) return;
    if (S.over) {
      // aceita a revanche quando a pessoa pede
      if (S.again && S.again[0] && !S.again[1]) botT = setTimeout(() => apply(1, { k: 'again' }), 500);
      return;
    }
    let plan;
    try { plan = bot(v1, S, ctx.bot); } catch (e) { console.error('bot', e); return; }
    if (!plan) return;
    const { a, ms = 700 } = plan.a ? plan : { a: plan };
    botT = setTimeout(() => { botT = null; if (!destroyed) apply(1, a); }, ms);
  }
  function draw(v) { if (destroyed) return; try { spec.render(v, api); } catch (e) { console.error('jogo/render', e); } }
  const off = ctx.onMsg((m) => {
    if (destroyed || !m) return;
    if (m.t === 'r') { spec.raw && spec.raw(m.m, api); return; }
    if (host) {
      if (m.t === 'hi') { peerHere = true; bcast(); }
      else if (m.t === 'a') apply(1, m.a);
    } else if (m.t === 'v' && m.v) draw(m.v);
  });
  if (host) { S = spec.init(null); bcast(); }
  else ctx.send({ t: 'hi' });
  return {
    destroy() {
      destroyed = true; off && off(); clearTimeout(botT);
      for (const t of timers) clearTimeout(t);
      for (const f of cleanups) { try { f(); } catch {} }
    },
  };
}

/** Quem começa a primeira partida (opção "quem começa" do convite); revanches alternam. */
export function firstSeat(ctx, prev, key = 'starter') {
  if (prev) return 1 - prev[key];
  const f = ctx.opts && ctx.opts.first;
  return f === 'them' ? 1 : f === 'rand' ? rand(2) : 0;
}
/** Tempo de "pensar" do computador (ms), com variação. */
export const think = (a, b) => a + rand(Math.max(1, b - a));

/** Faixa das jogadoras: [você] placar [ela]. Marca de quem é a vez. */
export function seats(ctx, v, { turn = null, score = null, sub = null, colors = null } = {}) {
  const me = ctx.seat, other = 1 - me;
  const users = [ctx.me, ctx.peer];
  const chip = (s, i) => {
    const u = s === me ? ctx.me : ctx.peer;
    const n = el('div', { class: 'gk-seat' + (turn === s ? ' turn' : '') + (i ? ' right' : '') },
      el('span', { class: 'gk-av' }, avatar(u || { name: ctx.names[s] }, 'sm'), colors ? el('i', { class: 'gk-tok', style: null }) : null),
      el('span', { class: 'gk-sn' }, el('b', { text: s === me ? K('you') : ctx.names[s] }), sub && sub[s] ? el('small', { text: sub[s] }) : null));
    if (colors) n.querySelector('.gk-tok').style.background = colors[s];
    return n;
  };
  void users;
  return el('div', { class: 'gk-seats' }, chip(me, 0),
    score ? el('div', { class: 'gk-score' }, el('b', { text: String(score[me]) }), el('span', { text: '×' }), el('b', { text: String(score[other]) })) : el('span'),
    chip(other, 1));
}

/** Linha de status ("Sua vez", "Vez de X" ou um texto próprio). */
export function turnLine(ctx, v, turn, text) {
  const mine = turn === ctx.seat;
  return el('div', { class: 'gk-turn' + (mine ? ' mine' : '') }, text || (mine ? K('yourTurn') : K('theirTurn', { name: ctx.names[1 - ctx.seat] })));
}

/** Cartão de fim: título, detalhe e revanche. */
export function endBox(ctx, v, api, { title, detail, tone = '' } = {}) {
  const me = ctx.seat, other = 1 - me;
  const ag = v._again || [false, false];
  let foot;
  if (ag[me]) foot = el('small', { class: 'gk-wait', text: K('waitAgain', { name: ctx.names[other] }) });
  else foot = el('div', { class: 'gk-endb' },
    ag[other] ? el('small', { class: 'gk-wants', text: K('wantsAgain', { name: ctx.names[other] }) }) : null,
    el('button', { class: 'btn primary', type: 'button', text: K('again'), onClick: () => api.send({ k: 'again' }) }));
  return el('div', { class: 'gk-ov' }, el('div', { class: 'gk-end ' + tone }, el('b', { text: title }), detail ? el('p', { text: detail }) : null, foot));
}

export function waitingPeer(ctx) {
  return el('div', { class: 'gk-waitp' }, el('span', { class: 'gk-dots' }, el('i'), el('i'), el('i')), el('span', { text: K('waiting', { name: ctx.names[1 - ctx.seat] }) }));
}
