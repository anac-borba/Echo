'use strict';
// Temas dos jogos: cada tema é um pacote completo (tabuleiro, peças, fundo), escolhido de uma vez.
// O seletor mostra uma miniatura de verdade da partida aberta com cada tema aplicado.
// A escolha fica só neste aparelho e vira atributos no palco (data-<jogo>-<item>); o CSS de cada jogo faz o resto.
import { el, icon } from '../util.js';
import { getLang } from '../i18n.js';

const L = (pt, en) => ({ pt, en });
const PRE = { xadrez: 'cx', ludo: 'ld', naval: 'nv', lig4: 'l4', uno: 'un', velha: 'vl' };

export const THEMES = {
  ludo: [
    ['classico', L('Clássico', 'Classic'), { board: 'classico', piece: 'ficha' }],
    ['rosinha', L('Rosinha', 'Pinky'), { board: 'rosinha', piece: 'bicho' }],
    ['paris', L('Jantar em Paris', 'Dinner in Paris'), { board: 'paris', piece: 'rosa' }],
    ['casinha', L('Casinha', 'Dollhouse'), { board: 'casinha', piece: 'gato' }],
    ['noite', L('Noite estrelada', 'Starry night'), { board: 'noite', piece: 'gema' }],
    ['madeira', L('Madeira', 'Wood'), { board: 'madeira', piece: 'peao' }],
    ['oceano', L('Fundo do mar', 'Under the sea'), { board: 'oceano', piece: 'ficha' }],
    ['doce', L('Confeitaria', 'Candy shop'), { board: 'doce', piece: 'bicho' }],
  ],
  xadrez: [
    ['ardosia', L('Ardósia', 'Slate'), { board: 'ardosia', set: 'classico' }],
    ['madeira', L('Clube de xadrez', 'Chess club'), { board: 'madeira', set: 'classico' }],
    ['floresta', L('Parque', 'Park'), { board: 'floresta', set: 'classico' }],
    ['marmore', L('Palácio', 'Palace'), { board: 'marmore', set: 'ouro' }],
    ['neon', L('Fliperama', 'Arcade'), { board: 'neon', set: 'neon' }],
    ['fichas', L('Fichas', 'Discs'), { board: 'oceano', set: 'fichas' }],
    ['rosa', L('Algodão', 'Cotton'), { board: 'rosa', set: 'coral' }],
  ],
  naval: [
    ['marinha', L('Marinha', 'Navy'), { sea: 'atlantico', ship: 'aco' }],
    ['piratas', L('Piratas do Caribe', 'Caribbean pirates'), { sea: 'tropical', ship: 'pirata' }],
    ['caderno', L('Caderno', 'Notebook'), { sea: 'papel', ship: 'aco' }],
    ['banheira', L('Hora do banho', 'Bath time'), { sea: 'tropical', ship: 'brinquedo' }],
    ['noite', L('Operação noturna', 'Night ops'), { sea: 'noite', ship: 'camuflado' }],
    ['tempestade', L('Tempestade', 'Storm'), { sea: 'tempestade', ship: 'aco' }],
  ],
  uno: [
    ['cassino', L('Cassino', 'Casino'), { back: 'echo', table: 'feltro', deck: 'classico' }],
    ['noite', L('Balada', 'Night out'), { back: 'aurora', table: 'padrao', deck: 'neon' }],
    ['cafe', L('Café', 'Coffee shop'), { back: 'ouro', table: 'madeira', deck: 'terra' }],
    ['doce', L('Piquenique', 'Picnic'), { back: 'menta', table: 'vinho', deck: 'pastel' }],
    ['praia', L('Praia', 'Beach'), { back: 'ondas', table: 'oceano', deck: 'classico' }],
    ['xadrez', L('Toalha xadrez', 'Checkered'), { back: 'xadrez', table: 'vinho', deck: 'classico' }],
  ],
  lig4: [
    ['classico', L('Clássico', 'Classic'), { board: 'azul', disc: 'classico' }],
    ['carinhas', L('Carinhas', 'Faces'), { board: 'verde', disc: 'carinhas' }],
    ['neon', L('Neon', 'Neon'), { board: 'grafite', disc: 'neon' }],
    ['doces', L('Doces', 'Candy'), { board: 'roxo', disc: 'doces' }],
    ['madeira', L('Madeira', 'Wood'), { board: 'madeira', disc: 'mono' }],
  ],
  velha: [
    ['padrao', L('Padrão', 'Default'), { look: 'padrao' }],
    ['giz', L('Lousa', 'Chalkboard'), { look: 'giz' }],
    ['caderno', L('Caderno', 'Notebook'), { look: 'caderno' }],
    ['neon', L('Neon', 'Neon'), { look: 'neon' }],
  ],
};

const KEY = (g) => `tl.theme.${g}`;
const lbl = (o) => o[getLang()] || o.pt;
export const hasSkins = (game) => !!THEMES[game];
function current(game) {
  let v = null; try { v = localStorage.getItem(KEY(game)); } catch { /* sem armazenamento */ }
  const list = THEMES[game];
  return (list.find((x) => x[0] === v) || list[0]);
}
function setAttrs(node, game, th) {
  const pre = PRE[game];
  for (const [k, v] of Object.entries(th[2])) node.setAttribute(`data-${pre}-${k}`, v);
}
/** Aplica o tema salvo no palco. */
export function applySkins(stage, game) {
  if (!stage || !THEMES[game]) return;
  setAttrs(stage, game, current(game));
}

const TXT = { pt: { title: 'Temas', note: 'Só você vê o tema que escolher.' }, en: { title: 'Themes', note: 'Only you see the theme you pick.' } };
const tx = (k) => (TXT[getLang()] || TXT.pt)[k];

/** Folha com os temas do jogo aberto, cada um com uma miniatura da própria partida. */
export function openSkinPicker(stage, game) {
  if (!THEMES[game]) return;
  const old = document.querySelector('.sk-scrim'); if (old) old.remove();
  const scrim = el('div', { class: 'sk-scrim' });
  const close = () => { scrim.classList.add('out'); setTimeout(() => scrim.remove(), 200); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const src = stage.querySelector('.gst-body');
  const grid = el('div', { class: 'sk-grid' });
  const cards = [];
  for (const th of THEMES[game]) {
    // miniatura: cópia do que está na tela, com o tema aplicado
    const mini = el('div', { class: 'gst gst-mini gk-' + game });
    setAttrs(mini, game, th);
    const inner = el('div', { class: 'sk-in' });
    if (src) { const c = src.cloneNode(true); c.querySelectorAll('button').forEach((b) => b.setAttribute('tabindex', '-1')); inner.append(c); }
    mini.append(inner);
    const card = el('button', { class: 'sk-card', type: 'button', onClick: () => {
      try { localStorage.setItem(KEY(game), th[0]); } catch { /* ok */ }
      applySkins(stage, game); paint();
    } }, el('div', { class: 'sk-pv' }, mini), el('span', { class: 'sk-name', text: lbl(th[1]) }));
    cards.push([th[0], card, inner]);
    grid.append(card);
  }
  const paint = () => { const cur = current(game)[0]; for (const [id, c] of cards) c.setAttribute('aria-pressed', String(id === cur)); };
  paint();
  const sheet = el('div', { class: 'sk-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': tx('title') },
    el('header', { class: 'sk-head' }, el('b', { text: tx('title') }), el('button', { class: 'sk-x', type: 'button', 'aria-label': 'OK', onClick: close }, icon('i-x'))),
    grid, el('p', { class: 'sk-note', text: tx('note') }));
  scrim.append(sheet);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  document.addEventListener('keydown', esc, true);
  document.body.append(scrim);
  // ajusta a escala das miniaturas ao tamanho real do jogo
  requestAnimationFrame(() => {
    scrim.classList.add('in');
    const w = src ? src.getBoundingClientRect().width : 400, h = src ? src.getBoundingClientRect().height : 400;
    for (const [, card, inner] of cards) {
      const pv = card.querySelector('.sk-pv');
      const k = Math.min(pv.clientWidth / w, pv.clientHeight / h);
      inner.style.width = w + 'px'; inner.style.height = h + 'px';
      inner.style.transform = `translate(-50%, -50%) scale(${k})`;
    }
  });
}
