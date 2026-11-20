'use strict';
// Banco Imobiliário para 2 (sem marcas, tabuleiro próprio). Seat 0 é autoritativa: aplica as regras, sorteia dados/cartas
// e manda o estado completo; seat 1 só envia ações ({k:'act'}) e desenha o que recebe.
import { getLang } from '../i18n.js';
import { el } from '../util.js';

const L = {
  pt: {
    connecting: 'Conectando…', turnOf: 'Vez de {p}', yourTurn: 'Sua vez!', roll: 'Rolar dados', jailTry: 'Tentar dobrada', jailPay: 'Pagar R$ 50', jailCard: 'Usar carta',
    buy: 'Comprar {n}', skip: 'Não comprar', end: 'Encerrar turno', resign: 'Desistir', resignSure: 'Confirmar?', again: 'Jogar de novo', wins: '{p} venceu!', youWin: 'Você venceu!', youLose: 'Você perdeu…',
    cash: 'Saldo', props: 'Propriedades', none: 'Nenhuma ainda', log: 'Histórico', inJail: 'Na prisão', freeCard: 'Carta livre', you: 'você', waitAgain: 'Esperando {p}…',
    build: 'Construir ({n})', price: 'Preço', owner: 'Dona', nobody: 'Livre', rents: 'Aluguel', houseN: '{k} casa(s)', hotel: 'hotel', base: 'Terreno', doubled: 'dobra com o grupo completo',
    houseCost: 'Casa/hotel: {n}', tapHint: 'Toque numa casa do tabuleiro para ver detalhes.', rentSt: '1: R$ 25 · 2: R$ 50 · 3: R$ 100 · 4: R$ 200', rentUt: 'Dados × 4 (uma) ou × 10 (as duas)',
    taxInfo: 'Pague {n}', rolling: 'Rolando…', moving: 'Andando…', waitFor: 'Aguardando {p}…',
    sq_start: 'Largada', sq_jail: 'Prisão (visita)', sq_park: 'Parada Livre', sq_gojail: 'Vá para a Prisão', sq_tax1: 'Imposto de Renda', sq_tax2: 'Taxa de Luxo', sq_card: 'Sorte ou Revés',
    sq_st5: 'Rodoviária', sq_st15: 'Porto', sq_st25: 'Aeroporto', sq_st35: 'Ferrovia', sq_ut12: 'Companhia de Energia', sq_ut28: 'Companhia de Água',
    luck: 'Sorte', bad: 'Revés',
    l_start: 'Partida começou! {p} joga primeiro.', l_roll: '{p} tirou {a} e {b}.', l_dbl: '{p} tirou dobrada e joga de novo.', l_j3: '{p} tirou três dobradas seguidas e foi para a prisão!',
    l_pass: '{p} passou pela Largada: +{n}.', l_land: '{p} parou em {sq}.', l_buy: '{p} comprou {sq} por {n}.', l_skip: '{p} não comprou {sq}.', l_nobuy: '{p} não tem saldo para comprar {sq}.',
    l_rent: '{p} pagou {n} de aluguel a {q}.', l_tax: '{p} pagou {n} de imposto.', l_card: '{p} tirou {k}: {c}', l_gojail: '{p} foi para a prisão.', l_jailpay: '{p} pagou {n} e saiu da prisão.',
    l_jailcard: '{p} usou a carta e saiu da prisão.', l_jailout: '{p} tirou dobrada e saiu da prisão!', l_jailstay: '{p} não tirou dobrada e segue na prisão.', l_build: '{p} construiu em {sq}: {lvl}.',
    l_liq: '{p} vendeu bens para pagar a dívida: +{n}.', l_bk: '{p} faliu!', l_resign: '{p} desistiu.', l_gain: '{p} recebeu {n}.', l_pay: '{p} pagou {n}.', l_xfer: '{p} pagou {n} a {q}.', l_keep: '{p} guardou a carta de saída livre.',
    c0: 'Dividendos de ações: receba R$ 150.', c1: 'Herança de uma tia distante: receba R$ 200.', c2: 'Multa de trânsito: pague R$ 100.', c3: 'Avance até a Largada e receba R$ 200.',
    c4: 'Vá direto para a prisão, sem passar pela Largada.', c5: 'Saída livre da prisão. Guarde esta carta.', c6: 'Avance até a Avenida Paulista.', c7: 'Volte 3 casas.',
    c8: 'Festa de aniversário: pague R$ 50 à outra jogadora.', c9: 'Rifa da turma: receba R$ 50 da outra jogadora.', c10: 'Reforma dos imóveis: pague R$ 40 por casa e R$ 115 por hotel.', c11: 'Restituição do imposto: receba R$ 100.',
    c12: 'Avance até o próximo transporte.', c13: 'Conserto do carro: pague R$ 150.', c14: 'Avance até Gramado. Passou pela Largada? Receba R$ 200.', c15: 'Prêmio no concurso de culinária: receba R$ 120.',
  },
  en: {
    connecting: 'Connecting…', turnOf: "{p}'s turn", yourTurn: 'Your turn!', roll: 'Roll dice', jailTry: 'Try for doubles', jailPay: 'Pay R$ 50', jailCard: 'Use card',
    buy: 'Buy {n}', skip: "Don't buy", end: 'End turn', resign: 'Resign', resignSure: 'Confirm?', again: 'Play again', wins: '{p} wins!', youWin: 'You won!', youLose: 'You lost…',
    cash: 'Cash', props: 'Properties', none: 'None yet', log: 'History', inJail: 'In jail', freeCard: 'Free card', you: 'you', waitAgain: 'Waiting for {p}…',
    build: 'Build ({n})', price: 'Price', owner: 'Owner', nobody: 'Unowned', rents: 'Rent', houseN: '{k} house(s)', hotel: 'hotel', base: 'Land', doubled: 'doubles with the full set',
    houseCost: 'House/hotel: {n}', tapHint: 'Tap a square on the board for details.', rentSt: '1: R$ 25 · 2: R$ 50 · 3: R$ 100 · 4: R$ 200', rentUt: 'Dice × 4 (one) or × 10 (both)',
    taxInfo: 'Pay {n}', rolling: 'Rolling…', moving: 'Moving…', waitFor: 'Waiting for {p}…',
    sq_start: 'Start', sq_jail: 'Jail (visiting)', sq_park: 'Free Parking', sq_gojail: 'Go to Jail', sq_tax1: 'Income Tax', sq_tax2: 'Luxury Tax', sq_card: 'Chance',
    sq_st5: 'Bus Station', sq_st15: 'Harbor', sq_st25: 'Airport', sq_st35: 'Railway', sq_ut12: 'Power Company', sq_ut28: 'Water Company',
    luck: 'Luck', bad: 'Setback',
    l_start: 'Game on! {p} plays first.', l_roll: '{p} rolled {a} and {b}.', l_dbl: '{p} rolled doubles and goes again.', l_j3: '{p} rolled doubles three times and went to jail!',
    l_pass: '{p} passed Start: +{n}.', l_land: '{p} landed on {sq}.', l_buy: '{p} bought {sq} for {n}.', l_skip: "{p} didn't buy {sq}.", l_nobuy: "{p} can't afford {sq}.",
    l_rent: '{p} paid {n} rent to {q}.', l_tax: '{p} paid {n} tax.', l_card: '{p} drew {k}: {c}', l_gojail: '{p} went to jail.', l_jailpay: '{p} paid {n} and left jail.',
    l_jailcard: '{p} used the card and left jail.', l_jailout: '{p} rolled doubles and left jail!', l_jailstay: "{p} didn't roll doubles and stays in jail.", l_build: '{p} built on {sq}: {lvl}.',
    l_liq: '{p} sold assets to cover the debt: +{n}.', l_bk: '{p} went bankrupt!', l_resign: '{p} resigned.', l_gain: '{p} received {n}.', l_pay: '{p} paid {n}.', l_xfer: '{p} paid {n} to {q}.', l_keep: '{p} kept the get-out-of-jail card.',
    c0: 'Stock dividends: collect R$ 150.', c1: 'Inheritance from a distant aunt: collect R$ 200.', c2: 'Speeding ticket: pay R$ 100.', c3: 'Advance to Start and collect R$ 200.',
    c4: 'Go straight to jail, do not pass Start.', c5: 'Get out of jail free. Keep this card.', c6: 'Advance to Avenida Paulista.', c7: 'Go back 3 spaces.',
    c8: 'Birthday party: pay R$ 50 to the other player.', c9: 'Class raffle: collect R$ 50 from the other player.', c10: 'Property repairs: pay R$ 40 per house and R$ 115 per hotel.', c11: 'Tax refund: collect R$ 100.',
    c12: 'Advance to the nearest transport.', c13: 'Car repair: pay R$ 150.', c14: 'Advance to Gramado. Pass Start? Collect R$ 200.', c15: 'Cooking contest prize: collect R$ 120.',
  },
};
const tr = (k, v) => {
  let s = (L[getLang()] || L.pt)[k] ?? L.pt[k] ?? k;
  if (v) for (const [a, b] of Object.entries(v)) s = s.replaceAll('{' + a + '}', b);
  return s;
};
const money = (n) => 'R$ ' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

// ---------- tabuleiro ----------
const GROUPS = [[1, 3], [6, 8, 9], [11, 13, 14], [16, 18, 19], [21, 23, 24], [26, 27, 29], [31, 32, 34], [37, 39]];
const HOUSE_COST = [50, 50, 100, 100, 150, 150, 200, 200];
const PROPS = { // idx: [nome, sigla, preço, aluguéis(0..5)]
  1: ['Ceilândia', 'CEI', 60, [2, 10, 30, 90, 160, 250]], 3: ['Taguatinga', 'TAG', 60, [4, 20, 60, 180, 320, 450]],
  6: ['Olinda', 'OLI', 100, [6, 30, 90, 270, 400, 550]], 8: ['Paraty', 'PAR', 100, [6, 30, 90, 270, 400, 550]], 9: ['Ouro Preto', 'OUR', 120, [8, 40, 100, 300, 450, 600]],
  11: ['Gramado', 'GRA', 140, [10, 50, 150, 450, 625, 750]], 13: ['Canela', 'CAN', 140, [10, 50, 150, 450, 625, 750]], 14: ['Bento Gonçalves', 'BEN', 160, [12, 60, 180, 500, 700, 900]],
  16: ['Natal', 'NAT', 180, [14, 70, 200, 550, 750, 950]], 18: ['Fortaleza', 'FOR', 180, [14, 70, 200, 550, 750, 950]], 19: ['Recife', 'REC', 200, [16, 80, 220, 600, 800, 1000]],
  21: ['Curitiba', 'CUR', 220, [18, 90, 250, 700, 875, 1050]], 23: ['Florianópolis', 'FLO', 220, [18, 90, 250, 700, 875, 1050]], 24: ['Porto Alegre', 'POA', 240, [20, 100, 300, 750, 925, 1100]],
  26: ['Belo Horizonte', 'BHZ', 260, [22, 110, 330, 800, 975, 1150]], 27: ['Brasília', 'BSB', 260, [22, 110, 330, 800, 975, 1150]], 29: ['Campinas', 'CAM', 280, [24, 120, 360, 850, 1025, 1200]],
  31: ['Ipanema', 'IPA', 300, [26, 130, 390, 900, 1100, 1275]], 32: ['Copacabana', 'COP', 300, [26, 130, 390, 900, 1100, 1275]], 34: ['Leblon', 'LEB', 320, [28, 150, 450, 1000, 1200, 1400]],
  37: ['Jardins', 'JAR', 350, [35, 175, 500, 1100, 1300, 1500]], 39: ['Av. Paulista', 'PAU', 400, [50, 200, 600, 1400, 1700, 2000]],
};
const SQ = [];
for (let i = 0; i < 40; i++) {
  let s = { i, t: 'card', s: '?' };
  if (PROPS[i]) {
    const g = GROUPS.findIndex((a) => a.includes(i));
    s = { i, t: 'prop', n: PROPS[i][0], s: PROPS[i][1], p: PROPS[i][2], r: PROPS[i][3], g, h: HOUSE_COST[g] };
  } else if (i % 10 === 5) s = { i, t: 'st', nk: 'sq_st' + i, s: ['RDV', 'POR', 'AER', 'FER'][(i - 5) / 10], p: 200 };
  else if (i === 12 || i === 28) s = { i, t: 'ut', nk: 'sq_ut' + i, s: i === 12 ? 'ENE' : 'AGU', p: 150 };
  else if (i === 0) s = { i, t: 'start', nk: 'sq_start', s: 'LARG' };
  else if (i === 10) s = { i, t: 'jail', nk: 'sq_jail', s: 'PRIS' };
  else if (i === 20) s = { i, t: 'park', nk: 'sq_park', s: 'LIVRE' };
  else if (i === 30) s = { i, t: 'gojail', nk: 'sq_gojail', s: 'VÁ' };
  else if (i === 4) s = { i, t: 'tax', nk: 'sq_tax1', s: 'IR', a: 200 };
  else if (i === 38) s = { i, t: 'tax', nk: 'sq_tax2', s: 'LUXO', a: 100 };
  else s = { i, t: 'card', nk: 'sq_card', s: '?' };
  SQ.push(s);
}
const sqName = (i) => (SQ[i].n || tr(SQ[i].nk));
const STATIONS = [5, 15, 25, 35];
const LUCKY = new Set([0, 1, 3, 5, 6, 9, 11, 12, 14, 15]);
const START_CASH = 2500, SALARY = 200, JAIL_FEE = 50;
const cellPos = (i) => (i <= 10 ? [10 - i, 10] : i <= 20 ? [0, 10 - (i - 10)] : i <= 30 ? [i - 20, 0] : [10, i - 30]);

// ---------- regras (usadas só pela seat 0, exceto os predicados) ----------
const groupFull = (S, who, g) => GROUPS[g].every((i) => S.own[i] === who);
function canBuild(S, who, sq) {
  const s = SQ[sq];
  if (S.win >= 0 || S.turn !== who || (S.phase !== 'roll' && S.phase !== 'end')) return false;
  if (!s || s.t !== 'prop' || S.own[sq] !== who || !groupFull(S, who, s.g) || S.hs[sq] >= 5) return false;
  if (S.pl[who].cash < s.h) return false;
  return GROUPS[s.g].every((i) => S.hs[sq] <= S.hs[i]);
}
function legal(S, who) {
  const out = { roll: false, jailpay: false, jailcard: false, buy: false, skip: false, end: false, build: [] };
  if (!S || S.win >= 0 || S.turn !== who) return out;
  const p = S.pl[who];
  if (S.phase === 'roll') { out.roll = true; if (p.j) { out.jailpay = p.cash >= JAIL_FEE; out.jailcard = p.card > 0; } }
  if (S.phase === 'buy') { out.skip = true; out.buy = S.pend >= 0 && p.cash >= SQ[S.pend].p; }
  if (S.phase === 'end') out.end = true;
  for (const g of GROUPS) for (const i of g) if (canBuild(S, who, i)) out.build.push(i);
  return out;
}
function newGame(prevEv = 0) {
  const deck = [...Array(16).keys()];
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  const turn = Math.random() < 0.5 ? 0 : 1;
  return {
    pl: [0, 1].map(() => ({ cash: START_CASH, pos: 0, j: false, jt: 0, card: 0, bk: false })),
    own: new Array(40).fill(-1), hs: new Array(40).fill(0), turn, phase: 'roll', dice: [1, 1], dc: 0, again: false, pend: -1,
    deck, di: 0, ev: prevEv + 1, anim: null, log: [['start', { p: turn }]], win: -1,
  };
}

function createEngine() {
  let S = null;
  const d6 = () => 1 + Math.floor(Math.random() * 6);
  const log = (k, o) => { S.log.push([k, o]); if (S.log.length > 40) S.log.shift(); };
  const walk = (who, to, collect, dir = 1) => {
    const p = S.pl[who];
    const path = S.anim ? S.anim.path : [];
    while (p.pos !== to) {
      const np = (p.pos + dir + 40) % 40;
      if (dir === 1 && np === 0 && collect) { p.cash += SALARY; log('pass', { p: who, n: SALARY }); }
      p.pos = np; path.push(np);
    }
  };
  const goJail = (who) => {
    const p = S.pl[who];
    p.pos = 10; p.j = true; p.jt = 0; S.again = false; S.dc = 0;
    if (S.anim) S.anim.path.push(10);
    log('gojail', { p: who });
  };
  function liquidate(who, need) {
    const p = S.pl[who]; let got = 0;
    while (p.cash < need) {
      let best = -1;
      for (let i = 0; i < 40; i++) if (S.own[i] === who && S.hs[i] > 0 && (best < 0 || S.hs[i] > S.hs[best])) best = i;
      if (best >= 0) { const v = Math.floor(SQ[best].h / 2); S.hs[best]--; p.cash += v; got += v; continue; }
      for (let i = 0; i < 40; i++) if (S.own[i] === who && (best < 0 || SQ[i].p < SQ[best].p)) best = i;
      if (best < 0) break;
      const v = Math.floor(SQ[best].p / 2); S.own[best] = -1; p.cash += v; got += v;
    }
    if (got) log('liq', { p: who, n: got });
  }
  function charge(who, amt, to) {
    const p = S.pl[who];
    if (S.win >= 0) return false;
    if (p.cash < amt) liquidate(who, amt);
    if (p.cash >= amt) { p.cash -= amt; if (to >= 0) S.pl[to].cash += amt; return true; }
    if (to >= 0) S.pl[to].cash += p.cash;
    p.cash = 0; p.bk = true; S.win = 1 - who; S.phase = 'over'; S.pend = -1; S.again = false;
    log('bk', { p: who });
    return false;
  }
  function rentOf(sq, owner) {
    const s = SQ[sq];
    if (s.t === 'prop') { const h = S.hs[sq]; let r = s.r[h]; if (h === 0 && groupFull(S, owner, s.g)) r *= 2; return r; }
    if (s.t === 'st') return 25 * 2 ** (STATIONS.filter((i) => S.own[i] === owner).length - 1);
    const both = S.own[12] === owner && S.own[28] === owner;
    return (S.dice[0] + S.dice[1]) * (both ? 10 : 4);
  }
  function drawCard(who, depth) {
    if (S.di >= S.deck.length) { S.di = 0; for (let i = S.deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [S.deck[i], S.deck[j]] = [S.deck[j], S.deck[i]]; } }
    const id = S.deck[S.di++];
    const p = S.pl[who];
    log('card', { p: who, k: LUCKY.has(id) ? 'luck' : 'bad', c: id });
    const gain = (n) => { p.cash += n; };
    switch (id) {
      case 0: gain(150); break; case 1: gain(200); break; case 11: gain(100); break; case 15: gain(120); break;
      case 2: charge(who, 100, -1); break; case 13: charge(who, 150, -1); break;
      case 3: walk(who, 0, true); p.cash += 0; break;
      case 4: goJail(who); break;
      case 5: p.card++; break;
      case 6: walk(who, 39, true); land(who, depth + 1); break;
      case 7: walk(who, (p.pos + 37) % 40, false, -1); land(who, depth + 1); break;
      case 8: charge(who, 50, 1 - who); break;
      case 9: charge(1 - who, 50, who); break;
      case 10: { let n = 0; for (let i = 0; i < 40; i++) if (S.own[i] === who) n += S.hs[i] === 5 ? 115 : S.hs[i] * 40; if (n) charge(who, n, -1); break; }
      case 12: { let t = STATIONS.find((i) => i > p.pos); if (t === undefined) t = 5; walk(who, t, true); land(who, depth + 1); break; }
      case 14: walk(who, 11, true); land(who, depth + 1); break;
    }
  }
  function land(who, depth = 0) {
    if (S.win >= 0 || depth > 3) return;
    const p = S.pl[who], s = SQ[p.pos];
    if (s.t === 'prop' || s.t === 'st' || s.t === 'ut') {
      const o = S.own[p.pos];
      if (o === -1) { if (p.cash >= s.p) S.pend = p.pos; else log('nobuy', { p: who, sq: p.pos }); }
      else if (o !== who) { const n = rentOf(p.pos, o); log('rent', { p: who, q: o, n, sq: p.pos }); charge(who, n, o); }
    } else if (s.t === 'tax') { log('tax', { p: who, n: s.a }); charge(who, s.a, -1); }
    else if (s.t === 'card') drawCard(who, depth);
    else if (s.t === 'gojail') goJail(who);
  }
  function settle(who) {
    if (S.win >= 0) { S.phase = 'over'; return; }
    const p = S.pl[who];
    if (S.pend >= 0) { S.phase = 'buy'; return; }
    if (S.again && !p.j) { S.phase = 'roll'; log('dbl', { p: who }); return; }
    S.again = false; S.phase = 'end';
  }
  function roll(who) {
    const a = d6(), b = d6(), p = S.pl[who], dbl = a === b;
    S.dice = [a, b]; S.anim = { id: ++S.ev, who, dice: [a, b], path: [] };
    log('roll', { p: who, a, b });
    const go = () => { walk(who, (p.pos + a + b) % 40, true); log('land', { p: who, sq: p.pos }); land(who); };
    if (p.j) {
      S.again = false;
      if (dbl) { p.j = false; p.jt = 0; log('jailout', { p: who }); go(); }
      else if (++p.jt >= 3) { log('jailpay', { p: who, n: JAIL_FEE }); if (charge(who, JAIL_FEE, -1)) { p.j = false; p.jt = 0; go(); } }
      else log('jailstay', { p: who });
    } else if (dbl && S.dc >= 2) { S.dc = 0; log('j3', { p: who }); goJail(who); }
    else { S.dc = dbl ? S.dc + 1 : 0; S.again = dbl; go(); }
    settle(who);
  }
  function endTurn() { S.turn = 1 - S.turn; S.phase = 'roll'; S.dc = 0; S.again = false; S.pend = -1; }
  function perform(who, m) {
    if (!S || !m) return false;
    if (m.a === 'resign') {
      if (S.win >= 0) return false;
      log('resign', { p: who }); S.win = 1 - who; S.phase = 'over'; S.pend = -1; return true;
    }
    const lg = legal(S, who);
    switch (m.a) {
      case 'roll': if (!lg.roll) return false; roll(who); return true;
      case 'jailpay': if (!lg.jailpay) return false; S.pl[who].cash -= JAIL_FEE; S.pl[who].j = false; S.pl[who].jt = 0; log('jailpay', { p: who, n: JAIL_FEE }); return true;
      case 'jailcard': if (!lg.jailcard) return false; S.pl[who].card--; S.pl[who].j = false; S.pl[who].jt = 0; log('jailcard', { p: who }); return true;
      case 'buy': { if (!lg.buy) return false; const s = SQ[S.pend]; S.pl[who].cash -= s.p; S.own[S.pend] = who; log('buy', { p: who, sq: S.pend, n: s.p }); S.pend = -1; S.phase = S.again ? 'roll' : 'end'; if (S.again) log('dbl', { p: who }); return true; }
      case 'skip': { if (!lg.skip) return false; log('skip', { p: who, sq: S.pend }); S.pend = -1; S.phase = S.again ? 'roll' : 'end'; if (S.again) log('dbl', { p: who }); return true; }
      case 'end': if (!lg.end) return false; endTurn(); return true;
      case 'build': { const sq = m.sq | 0; if (!canBuild(S, who, sq)) return false; S.pl[who].cash -= SQ[sq].h; S.hs[sq]++; log('build', { p: who, sq, lvl: S.hs[sq] }); return true; }
    }
    return false;
  }
  return { get S() { return S; }, set S(v) { S = v; }, perform, newGame: () => { S = newGame(S ? S.ev : 0); return S; } };
}

const DICE_PIPS = [[], [4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];
const GROUP_CLASS = (g) => 'g-mono-grp' + g;

export default {
  start(ctx) {
    const seat = ctx.seat;
    const names = [ctx.names[0] || '?', ctx.names[1] || '?'];
    const timers = [];
    const cleanups = [];
    let destroyed = false, speed = 1;
    const later = (fn, ms) => { const t = setTimeout(() => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); fn(); }, ms); timers.push(t); return t; };
    const clearTimers = () => { timers.forEach(clearTimeout); timers.length = 0; };

    const engine = seat === 0 ? createEngine() : null;
    let S = null;           // último estado (na seat 0 é o próprio estado do motor)
    let selected = 0, busy = false, lastAnim = null, resignArm = 0, wantAgain = false;
    const vis = [0, 0];
    let diceShow = [1, 1], rolling = false;

    // ---------- estrutura ----------
    const cells = [];
    for (let i = 0; i < 40; i++) {
      const s = SQ[i], [c, r] = cellPos(i);
      const c0 = el('div', { class: 'g-mono-cell g-mono-t-' + s.t + (s.t === 'prop' ? ' ' + GROUP_CLASS(s.g) : '') + ([0, 10, 20, 30].includes(i) ? ' g-mono-corner' : ''), role: 'button', tabindex: '0', 'aria-label': sqName(i) });
      c0.style.gridColumn = String(c + 1); c0.style.gridRow = String(r + 1);
      const band = s.t === 'prop' ? el('i', { class: 'g-mono-band' }) : null;
      const lab = el('span', { class: 'g-mono-lab', text: s.s });
      const hs = el('span', { class: 'g-mono-hs' });
      c0.append(...[band, lab, hs].filter(Boolean));
      const pick = () => { selected = i; renderDetail(); renderCells(); };
      c0.addEventListener('click', pick);
      c0.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      c0.__hs = hs;
      cells.push(c0);
    }
    const pegs = [0, 1].map((p) => {
      const peg = el('div', { class: 'g-mono-peg g-mono-peg' + p }, el('i', { text: names[p].trim().charAt(0).toUpperCase() || '?' }));
      return peg;
    });
    const banner = el('div', { class: 'g-mono-banner' });
    const diceBox = el('div', { class: 'g-mono-dice', 'aria-live': 'polite' });
    const evt = el('div', { class: 'g-mono-evt' });
    const actions = el('div', { class: 'g-mono-actions' });
    const center = el('div', { class: 'g-mono-center' }, banner, diceBox, evt, actions);
    const board = el('div', { class: 'g-mono-board' }, ...cells, center, ...pegs);
    const pcards = [0, 1].map(() => el('div', { class: 'g-mono-pl' }));
    const detail = el('div', { class: 'g-mono-detail' });
    const logBox = el('div', { class: 'g-mono-log' });
    const resignBtn = el('button', { class: 'btn sm ghost', type: 'button', text: tr('resign'), onClick: () => {
      if (resignArm) { resignArm = 0; resignBtn.textContent = tr('resign'); sendAct({ a: 'resign' }); }
      else { resignArm = 1; resignBtn.textContent = tr('resignSure'); later(() => { resignArm = 0; resignBtn.textContent = tr('resign'); }, 3000); }
    } });
    const root = el('div', { class: 'g-mono' },
      el('div', { class: 'g-mono-boardwrap' }, board),
      el('div', { class: 'g-mono-side' }, el('div', { class: 'g-mono-players' }, ...pcards), detail,
        el('div', { class: 'g-mono-logwrap' }, el('div', { class: 'g-mono-loghead' }, el('b', { text: tr('log') }), resignBtn), logBox)));
    ctx.root.append(root);

    // ---------- rede ----------
    function broadcast() { ctx.send({ k: 'st', s: engine.S }); onState(engine.S, true); }
    function sendAct(m) {
      if (seat === 0) { if (engine.perform(0, m)) broadcast(); }
      else ctx.send({ k: 'act', ...m });
    }
    const offMsg = ctx.onMsg((m) => {
      if (destroyed || !m) return;
      if (seat === 0) {
        if (m.k === 'hi') { if (engine.S) ctx.send({ k: 'st', s: engine.S }); }
        else if (m.k === 'act') { if (engine.perform(1, m)) broadcast(); }
        else if (m.k === 'again') { if (engine.S.win >= 0) { engine.newGame(); broadcast(); } }
      } else if (m.k === 'st' && m.s && Array.isArray(m.s.pl)) onState(m.s, false);
    });
    cleanups.push(offMsg);
    if (seat === 0) { engine.newGame(); ctx.send({ k: 'st', s: engine.S }); onState(engine.S, true); }
    else { ctx.send({ k: 'hi' }); render(); }

    // ---------- animação ----------
    function onState(ns, local) {
      const first = S === null;
      S = ns;
      if (S.win < 0) wantAgain = false;
      const an = S.anim;
      if (first) { lastAnim = an ? an.id : null; vis[0] = S.pl[0].pos; vis[1] = S.pl[1].pos; diceShow = S.dice.slice(); }
      else if (an && an.id !== lastAnim) { lastAnim = an.id; playAnim(an); }
      else if (!busy) { vis[0] = S.pl[0].pos; vis[1] = S.pl[1].pos; diceShow = S.dice.slice(); }
      render();
    }
    function playAnim(an) {
      clearTimers(); busy = true;
      for (let i = 0; i < 2; i++) if (i !== an.who) vis[i] = S.pl[i].pos;
      const path = an.path.slice();
      const end = () => { busy = false; vis[0] = S.pl[0].pos; vis[1] = S.pl[1].pos; diceShow = S.dice.slice(); rolling = false; render(); };
      const walkPath = (i) => {
        if (destroyed) return;
        if (i >= path.length) { end(); return; }
        vis[an.who] = path[i]; renderPegs();
        if (speed === 0) walkPath(i + 1); else later(() => walkPath(i + 1), 150 * speed);
      };
      const startWalk = () => { rolling = false; diceShow = S.dice.slice(); renderDice(); walkPath(0); };
      if (an.dice && speed > 0) {
        rolling = true; let n = 0;
        const tick = () => {
          if (destroyed) return;
          if (n++ < 6) { diceShow = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]; renderDice(); later(tick, 70 * speed); }
          else startWalk();
        };
        tick();
      } else startWalk();
      render();
    }

    // ---------- desenho ----------
    function fmtLog(e) {
      const [k, o] = e, v = {};
      for (const [a, b] of Object.entries(o || {})) {
        if (a === 'p' || a === 'q') v[a] = names[b];
        else if (a === 'sq') v[a] = sqName(b);
        else if (a === 'n') v[a] = money(b);
        else if (a === 'c') v[a] = tr('c' + b);
        else if (a === 'k') v[a] = tr(b);
        else if (a === 'lvl') v[a] = b >= 5 ? tr('hotel') : tr('houseN', { k: b });
        else v[a] = String(b);
      }
      return tr('l_' + k, v);
    }
    function renderDice() {
      diceBox.replaceChildren();
      for (const n of diceShow) {
        const d = el('div', { class: 'g-mono-die' + (rolling ? ' roll' : '') });
        for (let i = 0; i < 9; i++) d.append(el('i', { class: DICE_PIPS[n].includes(i) ? 'on' : '' }));
        diceBox.append(d);
      }
    }
    function renderPegs() {
      for (let p = 0; p < 2; p++) {
        const [c, r] = cellPos(vis[p]);
        pegs[p].style.left = (c * 100 / 11) + '%'; pegs[p].style.top = (r * 100 / 11) + '%';
      }
    }
    function renderCells() {
      for (let i = 0; i < 40; i++) {
        const c = cells[i], s = SQ[i];
        c.classList.toggle('sel', i === selected);
        if (!S) continue;
        const o = S.own[i];
        c.dataset.own = o >= 0 ? String(o) : '';
        const hs = c.__hs; hs.replaceChildren();
        if (s.t === 'prop' && S.hs[i] > 0) {
          if (S.hs[i] === 5) hs.append(el('i', { class: 'hot' }));
          else for (let k = 0; k < S.hs[i]; k++) hs.append(el('i', { class: 'house' }));
        }
      }
    }
    function playerBox(p) {
      const pl = S.pl[p];
      const mine = [];
      for (let i = 0; i < 40; i++) if (S.own[i] === p) mine.push(i);
      const chips = mine.map((i) => {
        const s = SQ[i];
        const chip = el('button', { class: 'g-mono-chip ' + (s.t === 'prop' ? GROUP_CLASS(s.g) : 'g-mono-chip-' + s.t) + (i === selected ? ' sel' : ''), type: 'button', title: sqName(i), onClick: () => { selected = i; renderDetail(); renderCells(); renderPlayers(); } },
          el('span', { text: s.s }), S.hs[i] ? el('small', { text: S.hs[i] === 5 ? 'H' : String(S.hs[i]) }) : null);
        return chip;
      });
      return [
        el('div', { class: 'g-mono-plhead' }, el('span', { class: 'g-mono-dot g-mono-peg' + p }),
          el('b', { class: 'g-mono-plname', text: names[p] + (p === seat ? ' (' + tr('you') + ')' : '') }),
          el('span', { class: 'g-mono-cash', text: money(pl.cash) })),
        el('div', { class: 'g-mono-badges' }, pl.j ? el('span', { class: 'g-mono-badge bad', text: tr('inJail') }) : null, pl.card ? el('span', { class: 'g-mono-badge', text: tr('freeCard') + (pl.card > 1 ? ' ×' + pl.card : '') }) : null),
        el('div', { class: 'g-mono-chips' }, chips.length ? chips : el('span', { class: 'muted g-mono-none', text: tr('none') })),
      ];
    }
    function renderPlayers() {
      if (!S) return;
      for (let p = 0; p < 2; p++) {
        pcards[p].replaceChildren(...playerBox(p));
        pcards[p].classList.toggle('turn', S.win < 0 && S.turn === p);
        pcards[p].classList.toggle('out', S.pl[p].bk);
      }
    }
    function renderDetail() {
      detail.replaceChildren();
      const s = SQ[selected];
      if (!s) return;
      const head = el('div', { class: 'g-mono-dhead' },
        el('i', { class: 'g-mono-dband ' + (s.t === 'prop' ? GROUP_CLASS(s.g) : 'g-mono-dband-' + s.t) }),
        el('b', { text: sqName(selected) }));
      detail.append(head);
      const lines = [];
      if (s.p) lines.push(tr('price') + ': ' + money(s.p));
      if (s.t === 'tax') lines.push(tr('taxInfo', { n: money(s.a) }));
      if (s.t === 'st') lines.push(tr('rents') + ': ' + tr('rentSt'));
      if (s.t === 'ut') lines.push(tr('rents') + ': ' + tr('rentUt'));
      if (s.t === 'prop') {
        lines.push(tr('base') + ': ' + money(s.r[0]) + ' (' + tr('doubled') + ')');
        lines.push([1, 2, 3, 4].map((k) => k + ' = ' + money(s.r[k])).join(' · ') + ' · ' + tr('hotel') + ' = ' + money(s.r[5]));
        lines.push(tr('houseCost', { n: money(s.h) }));
      }
      if (s.p && S) lines.push(tr('owner') + ': ' + (S.own[selected] >= 0 ? names[S.own[selected]] : tr('nobody')) + (S.hs[selected] ? ' · ' + (S.hs[selected] === 5 ? tr('hotel') : tr('houseN', { k: S.hs[selected] })) : ''));
      if (!lines.length) lines.push(tr('tapHint'));
      detail.append(el('div', { class: 'g-mono-dlines' }, lines.map((t) => el('div', { text: t }))));
      if (S && !busy && s.t === 'prop' && legal(S, seat).build.includes(selected)) {
        detail.append(el('button', { class: 'btn primary sm', type: 'button', text: tr('build', { n: money(s.h) }), onClick: () => sendAct({ a: 'build', sq: selected }) }));
      }
    }
    function renderLog() {
      if (!S) return;
      logBox.replaceChildren(...S.log.slice(-25).reverse().map((e, i) => el('div', { class: 'g-mono-logline' + (i === 0 ? ' new' : ''), text: fmtLog(e) })));
    }
    function renderCenter() {
      actions.replaceChildren();
      if (!S) { banner.textContent = tr('connecting'); evt.textContent = ''; return; }
      const last = S.log[S.log.length - 1];
      evt.textContent = last ? fmtLog(last) : '';
      if (S.win >= 0 && !busy) {
        banner.textContent = S.win === seat ? tr('youWin') : tr('wins', { p: names[S.win] });
        banner.className = 'g-mono-banner ' + (S.win === seat ? 'win' : 'lose');
        if (wantAgain) actions.append(el('div', { class: 'muted', text: tr('waitAgain', { p: names[0] }) }));
        else actions.append(el('button', { class: 'btn primary', type: 'button', text: tr('again'), onClick: () => {
          if (seat === 0) { engine.newGame(); broadcast(); } else { wantAgain = true; ctx.send({ k: 'again' }); renderCenter(); }
        } }));
        return;
      }
      const mineTurn = S.turn === seat;
      banner.className = 'g-mono-banner' + (mineTurn ? ' mine' : '');
      banner.textContent = mineTurn ? tr('yourTurn') : tr('turnOf', { p: names[S.turn] });
      if (busy) { actions.append(el('div', { class: 'muted g-mono-wait', text: rolling ? tr('rolling') : tr('moving') })); return; }
      if (!mineTurn) { actions.append(el('div', { class: 'muted g-mono-wait', text: tr('waitFor', { p: names[S.turn] }) })); return; }
      const lg = legal(S, seat), p = S.pl[seat];
      const B = (txt, cls, a) => actions.append(el('button', { class: 'btn sm ' + cls, type: 'button', text: txt, onClick: () => sendAct({ a }) }));
      if (lg.roll) B(p.j ? tr('jailTry') : tr('roll'), 'primary', 'roll');
      if (p.j && S.phase === 'roll') { if (lg.jailpay) B(tr('jailPay'), '', 'jailpay'); if (lg.jailcard) B(tr('jailCard'), '', 'jailcard'); }
      if (S.phase === 'buy') { if (lg.buy) B(tr('buy', { n: money(SQ[S.pend].p) }), 'primary', 'buy'); B(tr('skip'), '', 'skip'); }
      if (lg.end) B(tr('end'), 'primary', 'end');
    }
    function render() {
      if (destroyed) return;
      renderCells(); renderPegs(); renderDice(); renderCenter(); renderPlayers(); renderDetail(); renderLog();
    }
    renderDice(); renderPegs(); renderCells(); renderDetail();

    // gancho de teste (sem efeito no jogo)
    ctx.root.__mono = {
      get S() { return S; }, get busy() { return busy; }, legal: () => legal(S, seat), act: (m) => sendAct(m), setSpeed(n) { speed = n; },
    };

    return {
      destroy() {
        destroyed = true; clearTimers();
        cleanups.forEach((f) => { try { f(); } catch {} }); cleanups.length = 0;
        delete ctx.root.__mono;
        ctx.root.replaceChildren();
      },
    };
  },
};
