'use strict';
// Jogos: aba própria, convites, partida em tela cheia (dentro ou fora da ligação) e histórico.
// As jogadas vão pelo canal de eventos (o servidor só repassa entre amigas), então dá para jogar sem estar em ligação.
// Quem convida é a anfitriã (seat 0): é ela quem decide as regras e grava o resultado.
import { hasSkins, applySkins, openSkinPicker } from './games/skins.js';
import { $, el, icon, toast, avatar, displayName } from './util.js';
import { D, on, emit, userById, isFriend } from './state.js';
import { api } from './api.js';
import { t, addDict, getLang, onLang } from './i18n.js';
import { openModal, closeModal, confirmBox } from './modal.js';
import { inCall, callInfo, toggleMute, isDirectRoom } from './call.js';
import { uiSound } from './sfx.js';

addDict('pt', {
  'nav.games': 'Jogos', 'gm.sub': 'Treine contra o computador',
  'gm.tip': 'Para jogar com alguém, abra a conversa e toque em + › Criar partida.', 'gm.bot': 'Computador', 'gm.vsBotT': 'Contra o computador', 'gm.playNow': 'Jogar',
  'gm.vsBot.easy': 'contra o computador · fácil', 'gm.vsBot.normal': 'contra o computador · normal', 'gm.vsBot.hard': 'contra o computador · difícil',
  'gm.tag.bot': 'Contra o computador', 'gm.tag.solo': 'Solo', 'gm.tag.friends': 'Só com amigos',
  'gm.create': 'Criar partida', 'gm.createWith': 'Escolha um jogo para jogar com {name}', 'gm.cat.all': 'Todos', 'gm.noopts': 'Esse jogo não tem regras para ajustar.', 'gm.sendInvite': 'Enviar convite',
  'gm.o.level': 'Nível', 'gm.back': 'Voltar', 'gm.lv.easy': 'Fácil', 'gm.lv.normal': 'Normal', 'gm.lv.hard': 'Difícil',
  'gm.o.first': 'Quem começa', 'gm.o.me': 'Eu', 'gm.o.rand': 'Sorteio', 'gm.o.on': 'Sim', 'gm.o.off': 'Não',
  'gm.o.goal': 'Peças para vencer', 'gm.o.goal4': 'Todas (4)', 'gm.o.goal2': '2 peças', 'gm.o.goal1': '1 peça', 'gm.o.safe': 'Casas com estrela protegem', 'gm.o.exit': 'Sair da casa com', 'gm.o.exit6': 'Só 6', 'gm.o.exit16': '1 ou 6',
  'gm.o.fleet': 'Frota', 'gm.o.fleetC': 'Clássica (5 navios)', 'gm.o.fleetR': 'Rápida (3 navios)', 'gm.o.again': 'Acertou, atira de novo',
  'gm.o.cards': 'Cartas na mão', 'gm.o.c7': '7', 'gm.o.c5': '5', 'gm.o.c10': '10',
  'gm.n.velha': 'Jogo da velha', 'gm.n.lig4': 'Lig 4', 'gm.n.termo': 'Termo', 'gm.n.xadrez': 'Xadrez', 'gm.n.ludo': 'Ludo', 'gm.n.naval': 'Batalha naval', 'gm.n.desenho': 'Desenhe e adivinhe', 'gm.n.quem': 'Quem sou eu?',
  'gm.d.velha': 'Três em linha. Quem começa alterna a cada partida.', 'gm.d.lig4': 'Solte as fichas e alinhe quatro antes da outra pessoa.',
  'gm.d.termo': 'A mesma palavra para as duas. Quem acertar primeiro vence.', 'gm.d.xadrez': 'Xadrez completo, com roque, en passant e promoção.',
  'gm.d.ludo': 'Dado, capturas e corrida até o centro. Tire 6 para sair.', 'gm.d.naval': 'Esconda sua frota e afunde a dela. Acertou, atira de novo.',
  'gm.d.desenho': 'Uma desenha, a outra adivinha. Vale mais quem acerta rápido.', 'gm.d.quem': 'Cada uma escolhe o personagem da outra. Pergunte e descubra quem você é.',
  'gm.cat.quick': 'Rápidos', 'gm.cat.board': 'Tabuleiro', 'gm.cat.party': 'Cartas, palavras e desenho', 'gm.cat.arcade': 'Arcade', 'gm.wins': '{n} vitórias', 'gm.win1': '1 vitória',
  'gm.n.tetris': 'Tetris', 'gm.n.uno': 'Uno', 'gm.n.stop': 'Stop',
  'gm.d.tetris': 'Sozinha para bater o recorde, ou contra alguém: linhas limpas viram lixo para a outra pessoa.',
  'gm.d.uno': 'Livre-se das cartas primeiro. Não esqueça de gritar UNO.',
  'gm.d.stop': 'Uma letra, as categorias que vocês escolherem. Quem preencher tudo primeiro aperta STOP.',
  'gm.play': 'Jogar', 'gm.vsBtn': 'Desafiar', 'gm.solo': 'Solo', 'gm.solo.sub': 'Partida solo', 'gm.best': 'recorde {n}', 'gm.with': 'Jogar {game} com…', 'gm.offline': 'Offline', 'gm.nofriends': 'Adicione amigos para jogar com eles.',
  'gm.invites': 'Convites', 'gm.inv.from': '{name} chamou você para {game}', 'gm.inv.sub': 'Chamou você para jogar {game}', 'gm.accept': 'Jogar', 'gm.decline': 'Agora não',
  'gm.waiting': 'Esperando {name} aceitar…', 'gm.cancel': 'Cancelar', 'gm.declined': '{name} não pode jogar agora',
  'gm.left': '{name} saiu da partida', 'gm.close': 'Sair da partida', 'gm.close.q': 'Sair da partida de {game}?', 'gm.leave': 'Sair', 'gm.skins': 'Temas',
  'gm.board': 'Placar', 'gm.recent': 'Partidas recentes', 'gm.none': 'Nenhuma partida ainda. Escolha um jogo e chame alguém.',
  'gm.won': 'Você venceu', 'gm.lost': '{name} venceu', 'gm.draw': 'Empate', 'gm.matches': '{n} partidas', 'gm.match1': '1 partida',
  'gm.incall': 'Na ligação', 'gm.ended': 'Partida encerrada', 'gm.busy': 'Termine a partida atual primeiro.', 'gm.err': 'Não deu para enviar o convite.',
  'dock.games': 'Jogar junto', 'dock.cap.games': 'Jogar', 'gm.vs': 'contra {name}', 'gm.today': 'hoje', 'gm.yesterday': 'ontem', 'gm.inv.gone': 'O convite expirou',
});
addDict('en', {
  'nav.games': 'Games', 'gm.sub': 'Practice against the computer',
  'gm.tip': 'To play with someone, open your chat and tap + › New match.', 'gm.bot': 'Computer', 'gm.vsBotT': 'Against the computer', 'gm.playNow': 'Play',
  'gm.vsBot.easy': 'vs computer · easy', 'gm.vsBot.normal': 'vs computer · normal', 'gm.vsBot.hard': 'vs computer · hard',
  'gm.tag.bot': 'Vs computer', 'gm.tag.solo': 'Solo', 'gm.tag.friends': 'Friends only',
  'gm.create': 'New match', 'gm.createWith': 'Pick a game to play with {name}', 'gm.cat.all': 'All', 'gm.noopts': 'This game has no rules to tweak.', 'gm.sendInvite': 'Send invite',
  'gm.o.level': 'Level', 'gm.back': 'Back', 'gm.lv.easy': 'Easy', 'gm.lv.normal': 'Normal', 'gm.lv.hard': 'Hard',
  'gm.o.first': 'Who starts', 'gm.o.me': 'Me', 'gm.o.rand': 'Random', 'gm.o.on': 'Yes', 'gm.o.off': 'No',
  'gm.o.goal': 'Pieces to win', 'gm.o.goal4': 'All (4)', 'gm.o.goal2': '2 pieces', 'gm.o.goal1': '1 piece', 'gm.o.safe': 'Star squares are safe', 'gm.o.exit': 'Leave base with', 'gm.o.exit6': 'Only 6', 'gm.o.exit16': '1 or 6',
  'gm.o.fleet': 'Fleet', 'gm.o.fleetC': 'Classic (5 ships)', 'gm.o.fleetR': 'Quick (3 ships)', 'gm.o.again': 'Hit, shoot again',
  'gm.o.cards': 'Cards in hand', 'gm.o.c7': '7', 'gm.o.c5': '5', 'gm.o.c10': '10',
  'gm.n.velha': 'Tic-tac-toe', 'gm.n.lig4': 'Connect 4', 'gm.n.termo': 'Wordle duel', 'gm.n.xadrez': 'Chess', 'gm.n.ludo': 'Ludo', 'gm.n.naval': 'Battleship', 'gm.n.desenho': 'Draw & guess', 'gm.n.quem': 'Who am I?',
  'gm.d.velha': 'Three in a row. Who starts alternates every game.', 'gm.d.lig4': 'Drop discs and line up four before the other player.',
  'gm.d.termo': 'Same word for both. First to guess wins.', 'gm.d.xadrez': 'Full chess, with castling, en passant and promotion.',
  'gm.d.ludo': 'Dice, captures and a race to the middle. Roll a 6 to leave.', 'gm.d.naval': 'Hide your fleet and sink theirs. Hit, shoot again.',
  'gm.d.desenho': 'One draws, the other guesses. Faster guesses score more.', 'gm.d.quem': 'Each picks the other’s character. Ask questions to find out who you are.',
  'gm.cat.quick': 'Quick', 'gm.cat.board': 'Board games', 'gm.cat.party': 'Cards, words and drawing', 'gm.cat.arcade': 'Arcade', 'gm.wins': '{n} wins', 'gm.win1': '1 win',
  'gm.n.tetris': 'Tetris', 'gm.n.uno': 'Uno', 'gm.n.stop': 'Stop',
  'gm.d.tetris': 'Solo to beat your best, or versus: cleared lines turn into garbage for the other player.',
  'gm.d.uno': 'Get rid of your cards first. Don’t forget to call UNO.',
  'gm.d.stop': 'One letter, the categories you pick. Whoever fills everything first hits STOP.',
  'gm.play': 'Play', 'gm.vsBtn': 'Challenge', 'gm.solo': 'Solo', 'gm.solo.sub': 'Solo game', 'gm.best': 'best {n}', 'gm.with': 'Play {game} with…', 'gm.offline': 'Offline', 'gm.nofriends': 'Add friends to play with them.',
  'gm.invites': 'Invites', 'gm.inv.from': '{name} invited you to {game}', 'gm.inv.sub': 'Invited you to play {game}', 'gm.accept': 'Play', 'gm.decline': 'Not now',
  'gm.waiting': 'Waiting for {name} to accept…', 'gm.cancel': 'Cancel', 'gm.declined': '{name} can’t play right now',
  'gm.left': '{name} left the match', 'gm.close': 'Leave match', 'gm.close.q': 'Leave this {game} match?', 'gm.leave': 'Leave', 'gm.skins': 'Themes',
  'gm.board': 'Scoreboard', 'gm.recent': 'Recent matches', 'gm.none': 'No matches yet. Pick a game and invite someone.',
  'gm.won': 'You won', 'gm.lost': '{name} won', 'gm.draw': 'Draw', 'gm.matches': '{n} matches', 'gm.match1': '1 match',
  'gm.incall': 'In call', 'gm.ended': 'Match ended', 'gm.busy': 'Finish your current match first.', 'gm.err': 'Couldn’t send the invite.',
  'dock.games': 'Play together', 'dock.cap.games': 'Play', 'gm.vs': 'vs {name}', 'gm.today': 'today', 'gm.yesterday': 'yesterday', 'gm.inv.gone': 'The invite expired',
});

export const GAMES = [
  { id: 'velha', module: './games/velha.js', cat: 'quick' },
  { id: 'lig4', module: './games/lig4.js', cat: 'quick' },
  { id: 'termo', module: './games/termo.js', cat: 'quick' },
  { id: 'xadrez', module: './games/xadrez.js', cat: 'board' },
  { id: 'ludo', module: './games/ludo.js', cat: 'board' },
  { id: 'naval', module: './games/naval.js', cat: 'board' },
  { id: 'uno', module: './games/uno.js', cat: 'party' },
  { id: 'stop', module: './games/stop.js', cat: 'party' },
  { id: 'desenho', module: './games/desenho.js', cat: 'party' },
  { id: 'quem', module: './games/quem.js', cat: 'party' },
  { id: 'tetris', module: './games/tetris.js', cat: 'arcade' },
];
const CATS = ['quick', 'board', 'party', 'arcade'];
// jogos que têm computador para jogar contra
const BOTS = new Set(['velha', 'lig4', 'termo', 'xadrez', 'ludo', 'naval', 'uno']);
// jogos que ocupam a tela toda com a cena do tema (só ficam o X e o botão de temas)
const IMMERSIVE = new Set(['ludo']);
const TURNS = new Set(['velha', 'lig4', 'xadrez', 'ludo', 'naval', 'uno']);
/** Opções de cada jogo (aparecem ao criar partida). [chave, [[valor, rótulo-i18n], ...]] — o primeiro valor é o padrão. */
const OPTS = {
  ludo: [['goal', [['4', 'gm.o.goal4'], ['2', 'gm.o.goal2'], ['1', 'gm.o.goal1']]], ['safe', [['on', 'gm.o.on'], ['off', 'gm.o.off']]], ['exit', [['6', 'gm.o.exit6'], ['16', 'gm.o.exit16']]]],
  naval: [['fleet', [['classica', 'gm.o.fleetC'], ['rapida', 'gm.o.fleetR']]], ['again', [['on', 'gm.o.on'], ['off', 'gm.o.off']]]],
  uno: [['cards', [['7', 'gm.o.c7'], ['5', 'gm.o.c5'], ['10', 'gm.o.c10']]]],
};
const OPT_LABEL = { first: 'gm.o.first', goal: 'gm.o.goal', safe: 'gm.o.safe', exit: 'gm.o.exit', fleet: 'gm.o.fleet', again: 'gm.o.again', cards: 'gm.o.cards', level: 'gm.o.level' };
/** valores escolhidos → objeto que vai para o jogo (on/off viram booleano) */
const toOpts = (vals) => { const o = {}; for (const [k, v] of Object.entries(vals)) o[k] = v === 'on' ? true : v === 'off' ? false : v; return o; };
const PACKED = new Set(['velha', 'lig4', 'termo', 'xadrez', 'ludo', 'naval', 'desenho', 'quem']);   // CSS em g-pack.css
const INVITE_TTL = 60000;

const H = {
  events: null, go: null, pageShell: null,
  invites: new Map(),   // sid -> { from, game, at, timer }   (recebidos)
  out: null,            // { sid, to, game }                  (enviado, esperando)
  cur: null,            // partida aberta: { sid, game, opp, host, inst, handlers:Set, queue:[], mid, lastRes }
  hist: null, histAt: 0, loading: false,
};
const newSid = () => { const a = new Uint8Array(12); crypto.getRandomValues(a); return Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join(''); };
const gname = (id) => t('gm.n.' + id);
const nameOf = (uid) => displayName(userById(uid) || { name: '…' });
const send = (o) => H.events && H.events.send({ t: 'g', ...o });

function cssOnce(id) {
  if (PACKED.has(id)) id = 'pack';
  if (document.getElementById('css-' + id)) return;
  document.head.appendChild(el('link', { id: 'css-' + id, rel: 'stylesheet', href: `css/g-${id}.css` }));
}

/* ───────────── arte dos cartões (desenhada em CSS, sem emoji) ───────────── */
function art(id) { const a = art0(id); a.replaceChildren(el('div', { class: 'gart-in' }, ...a.childNodes)); return a; }
function art0(id) {
  if (id === 'tetris') {
    // poço com peças encaixadas
    const cells = ['....', '..t.', '.ttt', 'oo.i', 'ooli', 'llli'];
    const map = { t: 'a', o: 'b', l: 'c', i: 'd' };
    return el('div', { class: 'gart gart-tetris', 'aria-hidden': 'true' },
      el('div', { class: 'gt-well' }, ...cells.flatMap((row) => [...row].map((ch) => el('i', { class: ch === '.' ? '' : 'k-' + map[ch] })))),
      el('div', { class: 'gt-fall' }, el('i'), el('i'), el('i'), el('i')));
  }
  if (id === 'uno') {
    return el('div', { class: 'gart gart-uno', 'aria-hidden': 'true' },
      el('span', { class: 'gu-c c-b' }, el('b', { text: '7' })), el('span', { class: 'gu-c c-g' }, el('b', { text: '+2' })),
      el('span', { class: 'gu-c c-r' }, el('b', { text: '⇄' })), el('span', { class: 'gu-c c-w' }, el('b')));
  }
  const box = (cls, ...kids) => el('div', { class: 'gart gart-' + id + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' }, ...kids);
  if (id === 'velha') return box('', el('div', { class: 'ga-ttt' }, ...'xo.ox.x.o'.split('').map((c) => el('i', { class: c === '.' ? '' : c }))));
  if (id === 'lig4') return box('', el('div', { class: 'ga-l4' }, ...'.....r...yr..yry.ryyr'.split('').map((c) => el('i', { class: c === '.' ? '' : c }))));
  if (id === 'termo') return box('', el('div', { class: 'ga-tm' }, ...[['T', 'x'], ['E', 'p'], ['R', 'c'], ['M', 'x'], ['O', 'c']].map(([l, k]) => el('i', { class: k, text: l }))));
  if (id === 'xadrez') return box('', el('div', { class: 'ga-cx' }, ...Array.from({ length: 16 }, (_, i) => el('i', { class: ((i >> 2) + i) % 2 ? 'd' : '' }))), el('b', { class: 'ga-kn', text: '♞\uFE0E' }));
  if (id === 'ludo') return box('', el('div', { class: 'ga-ld' }, el('i', { class: 'r' }), el('i', { class: 'g' }), el('i', { class: 'b' }), el('i', { class: 'y' })), el('span', { class: 'ga-die' }, el('i'), el('i'), el('i')));
  if (id === 'naval') return box('', el('div', { class: 'ga-nv' }, ...Array.from({ length: 25 }, (_, i) => el('i', { class: [6, 7, 8].includes(i) ? 'ship' : i === 8 ? 'hit' : [16, 21].includes(i) ? 'ship v' : i === 13 ? 'miss' : '' }))), el('span', { class: 'ga-boom' }));
  if (id === 'desenho') return box('', el('div', { class: 'ga-dw' }, el('i', { class: 'sun' }), el('i', { class: 'hill' }), el('i', { class: 'pen' })));
  if (id === 'quem') return box('', el('span', { class: 'ga-q a', text: '?' }), el('span', { class: 'ga-q b', text: '?' }));
  return el('div', { class: 'gart gart-stop', 'aria-hidden': 'true' },
    el('div', { class: 'gs-letter', text: 'M' }),
    el('div', { class: 'gs-lines' }, el('i'), el('i'), el('i')),
    el('div', { class: 'gs-timer' }));
}

/* ───────────── aba Jogos ───────────── */
export function renderGames(view) {
  const v = H.pageShell(view, t('nav.games'), t('gm.sub'));
  if (!H.hist || Date.now() - H.histAt > 20000) loadHistory();
  // convites recebidos
  if (H.invites.size) {
    v.append(el('div', { class: 'section-h', text: t('gm.invites') }),
      el('div', { class: 'gm-invs' }, ...[...H.invites.entries()].map(([sid, iv]) => inviteRow(sid, iv))));
  }
  v.append(el('div', { class: 'gm-tip' }, icon('c-chat'), el('span', { text: t('gm.tip') })));
  // jogos, por categoria
  for (const cat of CATS) {
    const list = GAMES.filter((g) => g.cat === cat);
    v.append(el('div', { class: 'section-h', text: t('gm.cat.' + cat) }), el('div', { class: 'gm-cards' }, ...list.map((g) => gameCard(g))));
  }
}

function gameCard(g) {
  const soloOk = g.id === 'tetris', botOk = BOTS.has(g.id);
  const best = soloOk ? soloBest() : 0;
  const wins = H.hist ? H.hist.stats.filter((s) => s.game === g.id).reduce((a, s) => a + s.w, 0) : 0;
  const meta = [wins ? (wins === 1 ? t('gm.win1') : t('gm.wins', { n: wins })) : '', best ? t('gm.best', { n: best.toLocaleString() }) : ''].filter(Boolean).join(' · ');
  // aqui se joga contra o computador (ou sozinha, no Tetris); jogos de festa só com gente, pelo chat
  const run = () => (botOk ? openBotSetup(g.id) : soloOk ? playSolo(g.id) : pickFriend(g.id));
  const tag = botOk ? t('gm.tag.bot') : soloOk ? t('gm.tag.solo') : t('gm.tag.friends');
  return el('div', { class: 'gm-card gk-' + g.id, role: 'button', tabindex: '0', 'aria-label': gname(g.id) + ' — ' + tag, onClick: run, onKeydown: (e) => { if (e.key === 'Enter') run(); } },
    art(g.id),
    el('div', { class: 'gm-card-t' },
      el('b', { text: gname(g.id) }),
      el('p', { text: t('gm.d.' + g.id) }),
      el('span', { class: 'gm-card-f' }, el('span', { class: 'gm-tag' + (botOk ? ' bot' : soloOk ? ' solo' : ' fr'), text: tag }), meta ? el('small', { text: meta }) : null)));
}

/* ───────────── folhas: criar partida (chat) e contra o computador ───────────── */
function sheet(title, build) {
  const old = document.querySelector('.gm-sheet-scrim'); if (old) old.remove();
  const scrim = el('div', { class: 'sk-scrim gm-sheet-scrim' });
  const close = () => { scrim.classList.add('out'); setTimeout(() => scrim.remove(), 200); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  const box = el('div', { class: 'sk-sheet gm-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const head = (txt, back) => el('header', { class: 'sk-head' },
    back ? el('button', { class: 'sk-x', type: 'button', 'aria-label': t('gm.back'), onClick: back }, icon('i-back')) : null,
    el('b', { text: txt }), el('button', { class: 'sk-x', type: 'button', 'aria-label': t('close'), onClick: close }, icon('i-x')));
  scrim.append(box);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  document.addEventListener('keydown', esc);
  document.body.append(scrim);
  requestAnimationFrame(() => scrim.classList.add('in'));
  build({ box, head, close });
}
/** Linhas de opções (chips). vals é alterado no lugar. */
function optRows(game, vals, { firstLabels, level } = {}) {
  const rows = [];
  const row = (key, choices) => {
    if (!(key in vals)) vals[key] = choices[0][0];
    const wrap = el('div', { class: 'gm-chips', role: 'radiogroup', 'aria-label': t(OPT_LABEL[key]) });
    const paint = () => wrap.replaceChildren(...choices.map(([v, lab]) => el('button', { class: 'gm-chip' + (vals[key] === v ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': String(vals[key] === v),
      onClick: () => { vals[key] = v; paint(); } }, el('span', { text: lab.startsWith('gm.') ? t(lab) : lab }))));
    paint();
    rows.push(el('div', { class: 'gm-orow' }, el('small', { text: t(OPT_LABEL[key]) }), wrap));
  };
  if (level) row('level', [['normal', 'gm.lv.normal'], ['easy', 'gm.lv.easy'], ['hard', 'gm.lv.hard']]);
  if (TURNS.has(game)) row('first', [['me', 'gm.o.me'], ['them', firstLabels], ['rand', 'gm.o.rand']]);
  for (const [k, ch] of OPTS[game] || []) row(k, ch);
  return rows;
}
const gameHero = (id) => el('div', { class: 'gm-hero gk-' + id }, art(id), el('div', null, el('b', { text: gname(id) }), el('small', { text: t('gm.d.' + id) })));

/** Contra o computador: nível e opções, depois joga. */
function openBotSetup(game) {
  if (H.cur) { toast(t('gm.busy')); return; }
  cssOnce(game);
  const vals = {};
  sheet(gname(game), ({ box, head, close }) => {
    box.replaceChildren(head(t('gm.vsBotT')), gameHero(game), ...optRows(game, vals, { firstLabels: t('gm.bot'), level: true }),
      el('button', { class: 'btn primary gm-go', type: 'button', text: t('gm.playNow'), onClick: () => { close(); playBot(game, vals); } }));
  });
}
function playBot(game, vals) {
  if (H.cur) { toast(t('gm.busy')); return; }
  const { level = 'normal', ...rest } = vals;
  openStage(game, 'bot', { sid: newSid(), host: true, bot: { level }, opts: toOpts(rest) });
}

/** Criar partida com alguém (aberto pelo chat): escolhe o jogo e as regras, e manda o convite. */
export function openCreateMatch(uid) {
  if (H.cur || H.out) { toast(t('gm.busy')); return; }
  const u = userById(uid) || { id: uid, name: '…' };
  let cat = 'all';
  sheet(t('gm.create'), ({ box, head, close }) => {
    const pickGame = () => {
      const chips = el('div', { class: 'gm-chips cats' }, ...['all', ...CATS].map((c) => el('button', { class: 'gm-chip' + (c === cat ? ' on' : ''), type: 'button', text: t(c === 'all' ? 'gm.cat.all' : 'gm.cat.' + c), onClick: () => { cat = c; pickGame(); } })));
      const grid = el('div', { class: 'gm-pickg' }, ...GAMES.filter((g) => cat === 'all' || g.cat === cat).map((g) => el('button', { class: 'gm-pg gk-' + g.id, type: 'button', onClick: () => setup(g.id) }, art(g.id), el('b', { text: gname(g.id) }))));
      box.replaceChildren(head(t('gm.create')), el('p', { class: 'gm-with' }, avatar(u, 'sm'), el('span', { text: t('gm.createWith', { name: displayName(u) }) })), chips, grid);
    };
    const setup = (game) => {
      cssOnce(game);
      const vals = {};
      const rows = optRows(game, vals, { firstLabels: displayName(u) });
      box.replaceChildren(head(gname(game), pickGame), gameHero(game),
        ...(rows.length ? rows : [el('p', { class: 'muted gm-noopt', text: t('gm.noopts') })]),
        el('button', { class: 'btn primary gm-go', type: 'button', text: t('gm.sendInvite'), onClick: () => { close(); invite(game, uid, Object.keys(vals).length ? toOpts(vals) : undefined); } }));
    };
    pickGame();
  });
}

function matchRow(m) {
  const opp = m.host === D.me.id ? m.guest : m.host;
  const name = nameOf(opp);
  const res = !m.winner ? 'draw' : m.winner === D.me.id ? 'won' : 'lost';
  let score = '';
  if (Array.isArray(m.score)) {
    const mine = m.host === D.me.id ? m.score[0] : m.score[1], theirs = m.host === D.me.id ? m.score[1] : m.score[0];
    score = `${mine} × ${theirs}`;
  }
  return el('div', { class: 'gm-mrow r-' + res },
    el('span', { class: 'gm-mdot gk-' + m.game }),
    el('div', { class: 'gm-mt' },
      el('b', { text: res === 'won' ? t('gm.won') : res === 'lost' ? t('gm.lost', { name }) : t('gm.draw') }),
      el('small', { text: `${gname(m.game)} · ${t('gm.vs', { name })}${score ? ' · ' + score : ''}` })),
    el('time', { text: when(m.at) }));
}
function when(ts) {
  const d = new Date(ts), now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = (day(now) - day(d)) / 86400000;
  const hm = d.toLocaleTimeString(getLang() === 'en' ? 'en-US' : 'pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (diff === 0) return hm;
  if (diff === 1) return t('gm.yesterday');
  return d.toLocaleDateString(getLang() === 'en' ? 'en-US' : 'pt-BR', { day: 'numeric', month: 'short' });
}

async function loadHistory() {
  if (H.loading) return;
  H.loading = true;
  try { const j = await api('GET', '/games/history'); H.hist = { matches: j.matches || [], stats: j.stats || [] }; H.histAt = Date.now(); }
  catch { if (!H.hist) H.hist = { matches: [], stats: [] }; }
  H.loading = false;
  if (D.view && D.view.name === 'games') emit('games-redraw');
}

/* ───────────── convidar ───────────── */
/** Escolher com quem jogar. Se estiver em ligação direta com alguém, essa pessoa vem primeiro. */
export function pickFriend(game, prefer) {
  if (H.cur) { toast(t('gm.busy')); return; }
  const callPeer = inCall() && isDirectRoom() ? callInfo().peerId : null;
  const first = prefer || callPeer;
  const list = [...D.friends].sort((a, b) => (b.id === first) - (a.id === first) || (b.online !== false) - (a.online !== false) || displayName(a).localeCompare(displayName(b)));
  const body = !list.length ? el('p', { class: 'muted', text: t('gm.nofriends') })
    : el('div', { class: 'gm-pick' }, ...list.map((f) => {
      const off = f.online === false;
      return el('button', { class: 'gm-prow', type: 'button', disabled: off, onClick: () => { closeModal(); invite(game, f.id); } },
        avatar(f, 'md', { status: true }),
        el('div', { class: 'gm-pwho' }, el('b', { text: displayName(f) }), el('small', { text: off ? t('gm.offline') : f.id === callPeer ? t('gm.incall') : '@' + f.username })),
        off ? null : el('span', { class: 'gm-play sm', text: t('gm.play') }));
    }));
  openModal(t('gm.with', { game: gname(game) }), body);
}

function invite(game, to, opts) {
  if (H.cur || H.out) { toast(t('gm.busy')); return; }
  const sid = newSid();
  H.out = { sid, to, game, opts, timer: setTimeout(() => { if (H.out && H.out.sid === sid) { send({ to, sid, k: 'cancel' }); H.out = null; closeStage(); toast(t('gm.inv.gone')); } }, INVITE_TTL) };
  send({ to, sid, k: 'invite', game, ...(opts ? { opts } : {}) });
  openStage(game, to, { waiting: true, sid });
}
function cancelOut() {
  if (!H.out) return;
  clearTimeout(H.out.timer);
  send({ to: H.out.to, sid: H.out.sid, k: 'cancel' });
  H.out = null;
}

/* ───────────── convite recebido (faixa no topo) ───────────── */
let banner = null;
function inviteRow(sid, iv, compact) {
  const u = userById(iv.from) || { id: iv.from };
  return el('div', { class: 'gm-inv' + (compact ? ' banner' : '') },
    avatar(u, compact ? 'sm' : 'md'),
    el('div', { class: 'gm-inv-t' }, el('b', { text: displayName(u) }), el('small', { text: t('gm.inv.sub', { game: gname(iv.game) }) })),
    el('div', { class: 'gm-inv-b' },
      el('button', { class: 'btn sm', type: 'button', text: t('gm.decline'), onClick: () => decline(sid) }),
      el('button', { class: 'btn sm primary', type: 'button', text: t('gm.accept'), onClick: () => accept(sid) })));
}
function drawBanner() {
  const last = [...H.invites.entries()].pop();
  if (!last || H.cur) { if (banner) { banner.remove(); banner = null; } return; }
  const node = el('div', { class: 'gm-banner', role: 'alert' }, inviteRow(last[0], last[1], true));
  if (banner) banner.replaceWith(node); else document.body.append(node);
  banner = node;
}
function dropInvite(sid) {
  const iv = H.invites.get(sid); if (!iv) return;
  clearTimeout(iv.timer); H.invites.delete(sid);
  drawBanner(); redraw();
}
function decline(sid) {
  const iv = H.invites.get(sid); if (!iv) return;
  send({ to: iv.from, sid, k: 'decline' });
  dropInvite(sid);
}
async function accept(sid) {
  const iv = H.invites.get(sid); if (!iv) return;
  if (H.cur) { if (!(await leaveAsk())) return; }
  if (H.out) { cancelOut(); closeStage(); }
  dropInvite(sid);
  send({ to: iv.from, sid, k: 'accept' });
  openStage(iv.game, iv.from, { sid, host: false });
}

/* ───────────── mensagens do servidor ───────────── */
function onG(m) {
  if (!m || typeof m.sid !== 'string') return;
  const from = m.from;
  if (m.k === 'invite') {
    if (!isFriend(from) || !GAMES.some((g) => g.id === m.game)) return;
    if (H.invites.has(m.sid)) return;
    const timer = setTimeout(() => dropInvite(m.sid), INVITE_TTL);
    H.invites.set(m.sid, { from, game: m.game, opts: m.opts && typeof m.opts === 'object' ? m.opts : null, at: Date.now(), timer });
    uiSound('ring');
    drawBanner(); redraw();
  } else if (m.k === 'cancel') {
    dropInvite(m.sid);
  } else if (m.k === 'accept') {
    if (!H.out || H.out.sid !== m.sid || H.out.to !== from) return;
    clearTimeout(H.out.timer);
    const { game, to, sid, opts } = H.out; H.out = null;
    openStage(game, to, { sid, host: true, opts });
  } else if (m.k === 'decline') {
    if (!H.out || H.out.sid !== m.sid) return;
    clearTimeout(H.out.timer); H.out = null;
    closeStage(); toast(t('gm.declined', { name: nameOf(from) }));
  } else if (m.k === 'msg') {
    const c = H.cur;
    if (!c || c.sid !== m.sid || c.opp !== from) return;
    if (!c.handlers.size) { if (c.queue.length < 200) c.queue.push(m.m); return; }
    c.handlers.forEach((f) => { try { f(m.m); } catch (e) { console.error(e); } });
  } else if (m.k === 'leave') {
    const c = H.cur;
    if (c && c.sid === m.sid) peerLeft();
    else if (H.out && H.out.sid === m.sid) { clearTimeout(H.out.timer); H.out = null; closeStage(); }
  }
}
function onMatch(m) {
  if (!m || !m.match) return;
  const x = m.match;
  if (!H.hist) H.hist = { matches: [], stats: [] };
  H.hist.matches = [x, ...H.hist.matches.filter((y) => y.id !== x.id)];
  H.histAt = 0;   // placar é recalculado no servidor na próxima vez que a aba abrir
  if (D.view && D.view.name === 'games') loadHistory();
}
function onError(m) {
  if (m.what !== 'g') return;
  if (H.out && H.out.sid === m.sid) { clearTimeout(H.out.timer); H.out = null; closeStage(); toast(t('gm.err')); }
}

/* ───────────── palco (partida em tela cheia) ───────────── */
let stage = null;
const soloBest = () => { try { return Number(localStorage.getItem('tl.tetris.best.' + (D.me && D.me.id))) || 0; } catch { return 0; } };
function playSolo(game) {
  if (H.cur || H.out) { toast(t('gm.busy')); return; }
  openStage(game, null, { solo: true });
}
function openStage(game, opp, { waiting = false, sid, host = true, solo = false, bot = null, opts = null } = {}) {
  closeStage(true);
  const u = solo ? D.me : bot ? botUser() : (userById(opp) || { id: opp });
  cssOnce(game);
  const body = el('div', { class: 'gst-body' });
  const callChip = el('div', { class: 'gst-call' });
  const head = el('header', { class: 'gst-head' },
    el('button', { class: 'gst-x', type: 'button', 'aria-label': t('gm.close'), title: t('gm.close'), onClick: () => (H.cur ? leaveAsk() : (cancelOut(), closeStage())) }, icon('r-x')),
    el('div', { class: 'gst-t' }, el('b', { text: gname(game) }), el('small', { text: solo ? t('gm.solo.sub') : bot ? t('gm.vsBot.' + bot.level) : t('gm.vs', { name: displayName(u) }) })),
    hasSkins(game) ? el('button', { class: 'gst-skin', type: 'button', 'aria-label': t('gm.skins'), title: t('gm.skins'), onClick: () => openSkinPicker(stage, game) }, icon('i-palette'), el('span', { text: t('gm.skins') })) : null,
    callChip);
  stage = el('div', { class: 'gst gk-' + game + (IMMERSIVE.has(game) ? ' gst-imm' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': gname(game) }, head, body);
  applySkins(stage, game);
  document.body.append(stage);
  document.documentElement.classList.add('gst-open');
  paintCall();
  drawBanner();
  if (waiting) {
    body.append(el('div', { class: 'gst-wait' }, avatar(u, 'xl'), el('b', { text: t('gm.waiting', { name: displayName(u) }) }),
      el('button', { class: 'btn', type: 'button', text: t('gm.cancel'), onClick: () => { cancelOut(); closeStage(); } })));
    return;
  }
  mount(game, opp, sid, host, body, solo, bot, opts);
}
const botUser = () => ({ id: 'bot', name: t('gm.bot'), username: 'echo', accent: '#7c5cff' });

async function mount(game, opp, sid, host, body, solo = false, bot = null, opts = null) {
  const def = GAMES.find((g) => g.id === game);
  const c = { sid, game, opp, host, solo: solo || !!bot, bot, inst: null, handlers: new Set(), queue: [], mid: 0, lastRes: 0 };
  H.cur = c;
  body.replaceChildren(el('div', { class: 'gst-load' }, el('span', { class: 'spin' })));
  let mod;
  try { mod = await import(def.module); } catch (e) { console.error(e); body.replaceChildren(el('p', { class: 'muted', text: t('act.fail') })); return; }
  if (H.cur !== c) return;
  const root = el('div', { class: 'act-game act-' + game });
  body.replaceChildren(root);
  const me = D.me, them = solo ? null : bot ? botUser() : (userById(opp) || { id: opp });
  const seat = host ? 0 : 1;
  const names = solo ? [displayName(me), ''] : host ? [displayName(me), displayName(them)] : [displayName(them), displayName(me)];
  const ctx = {
    id: game, root, seat, solo, bot, opts: opts || null, starter: host ? me.id : opp, iStarted: host, t,
    me, peer: them, names, colors: seat === 0 ? ['var(--accent)', '#7c5cff'] : ['#7c5cff', 'var(--accent)'],
    send: (m) => { if (!solo && !bot) send({ to: opp, sid, k: 'msg', m }); },
    onMsg: (fn) => {
      c.handlers.add(fn);
      // o que chegou antes de o jogo montar
      if (c.queue.length) { const q = c.queue.splice(0); queueMicrotask(() => q.forEach((x) => { try { fn(x); } catch (e) { console.error(e); } })); }
      return () => c.handlers.delete(fn);
    },
    end: () => leave(),
    result: (r) => report(c, r),
    toast, el, icon,
  };
  try { c.inst = mod.default.start(ctx) || {}; }
  catch (e) { console.error('jogo', e); body.replaceChildren(el('p', { class: 'muted', text: t('act.fail') })); }
}

/** Só a anfitriã grava. Chamadas seguidas (menos de 3 s) são a mesma partida: atualiza em vez de criar outra. */
function report(c, r) {
  if (!c.host || !r || c.solo) return;
  const now = Date.now();
  if (now - c.lastRes > 3000) c.mid++;
  c.lastRes = now;
  const w = r.winner === 0 || r.winner === 'host' ? 'host' : r.winner === 1 || r.winner === 'guest' ? 'guest' : 'draw';
  const score = Array.isArray(r.score) && r.score.length === 2 && r.score.every(Number.isFinite) ? r.score : undefined;
  api('POST', '/games/result', { sid: c.sid, mid: String(c.mid), game: c.game, opp: c.opp, winner: w, score }).catch(() => {});
}

function paintCall() {
  if (!stage) return;
  const chip = stage.querySelector('.gst-call');
  const info = callInfo();
  if (!info.room) { chip.replaceChildren(); chip.hidden = true; return; }
  chip.hidden = false;
  chip.replaceChildren(
    el('span', { class: 'gst-live' }, el('i'), el('span', { text: t('gm.incall') })),
    el('button', { class: 'gst-mic' + (info.muted ? ' off' : ''), type: 'button', 'aria-pressed': String(!!info.muted), 'aria-label': info.muted ? t('mic.unmute') : t('mic.mute'), onClick: () => toggleMute() },
      icon(info.muted ? 'r-micoff' : 'r-mic')));
}

function destroyCur() {
  const c = H.cur; H.cur = null;
  if (c && c.inst && c.inst.destroy) { try { c.inst.destroy(); } catch (e) { console.error(e); } }
}
function closeStage(keepCur) {
  if (!keepCur) destroyCur();
  else destroyCur();
  if (stage) { stage.remove(); stage = null; }
  document.documentElement.classList.remove('gst-open');
  drawBanner();
  redraw();
}
function leave() {
  const c = H.cur;
  if (c && !c.solo) send({ to: c.opp, sid: c.sid, k: 'leave' });
  closeStage();
}
async function leaveAsk() {
  const c = H.cur; if (!c || c.solo) { closeStage(); return true; }
  const ok = await confirmBox(t('gm.close'), t('gm.close.q', { game: gname(c.game) }), t('gm.leave'));
  if (ok) leave();
  return ok;
}
function peerLeft() {
  const c = H.cur; if (!c || !stage) return;
  const name = nameOf(c.opp);
  destroyCur();
  const body = stage.querySelector('.gst-body');
  body.replaceChildren(el('div', { class: 'gst-wait' }, avatar(userById(c.opp) || { id: c.opp }, 'xl'), el('b', { text: t('gm.left', { name }) }),
    el('button', { class: 'btn primary', type: 'button', text: t('close'), onClick: () => closeStage() })));
  loadHistory();
}

function redraw() { if (D.view && D.view.name === 'games') emit('games-redraw'); }

/* ───────────── início ───────────── */
export function initGames({ events, go, pageShell }) {
  Object.assign(H, { events, go, pageShell });
  on('call', paintCall);
  onLang(() => { drawBanner(); });
  // Esc fecha a partida (pergunta antes) no computador
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && stage && !document.querySelector('dialog[open]') && !document.querySelector('.sk-scrim')) { e.preventDefault(); H.cur ? leaveAsk() : (cancelOut(), closeStage()); } });
  // botão Jogos na barra da ligação
  const b = $('#btn-games');
  if (b) b.addEventListener('click', () => {
    const info = callInfo();
    if (info.room && isDirectRoom() && info.peerId) openGameMenu(info.peerId); else go('games');
  });
}
/** Dentro da ligação: escolher o jogo já sabendo com quem. */
function openGameMenu(peerId) { openCreateMatch(peerId); }
export const gameArt = (id) => art(id);
export const gameName = (id) => gname(id);
export { cssOnce as gameCss };
export const gameHandlers = { g: onG, match: onMatch, error: onError };
export const gamesBusy = () => !!H.cur;
export const pendingInvites = () => H.invites.size;
