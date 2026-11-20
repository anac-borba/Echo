'use strict';
// Perfil de alguém (aberto pela foto ou pelo nome no chat, ou "Ver perfil" no seu menu).
// Capa, foto sobreposta com o balão de status, nome e insígnias; abas Principal, Atividade e Jogos.
import { el, icon, avatar, displayName, toast } from './util.js';
import { D, userById, remember, emit } from './state.js';
import { api } from './api.js';
import { t, getLang } from './i18n.js';
import { gameArt, gameName, gameCss, openCreateMatch } from './games-hub.js';

const hooks = { go: null, callFriend: null };
export function setProfileHooks(h) { Object.assign(hooks, h); }

function noteBox(uid) {
  const key = 'tl.note.' + uid;
  let v = ''; try { v = localStorage.getItem(key) || ''; } catch {}
  const ta = el('textarea', { class: 'pfs-note-in', rows: '2', maxlength: '300', placeholder: t('pf.notePh') });
  ta.value = v;
  ta.addEventListener('input', () => { try { localStorage.setItem(key, ta.value); } catch {} });
  return el('section', { class: 'pfs-sec' }, el('h3', { text: t('pf.note') }), ta);
}
const loc = () => (getLang() === 'en' ? 'en-US' : 'pt-BR');
function ago(ts) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  const rtf = new Intl.RelativeTimeFormat(loc(), { numeric: 'auto' });
  if (s < 60) return rtf.format(-s, 'second');
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  return rtf.format(-Math.round(s / 86400), 'day');
}

// insígnias: vitórias somadas e jogo favorito (desenhadas aqui, cores próprias)
function badgesFor(stats, u) {
  const total = stats.reduce((a, s) => a + s.wins, 0);
  const out = [];
  if (total >= 100) out.push(['b-gold', 'i-sparkle', t('pf.b.gold')]);
  else if (total >= 25) out.push(['b-silver', 'i-sparkle', t('pf.b.silver')]);
  else if (total >= 5) out.push(['b-bronze', 'i-sparkle', t('pf.b.bronze')]);
  const fav = stats.slice().sort((a, b) => b.played - a.played)[0];
  if (fav && fav.played >= 10) out.push(['b-fav', 't-games', t('pf.b.fav', { game: gameName(fav.game) })]);
  if (u.since && Date.now() - u.since > 365 * 86400000) out.push(['b-old', 'i-shield', t('pf.b.old')]);
  return out;
}

/** Editar o status (recado curto + presença), como o "Adicionar status" do Discord. */
export function openStatusEditor() {
  const me = D.me;
  const old = document.querySelector('.st-scrim'); if (old) old.remove();
  const scrim = el('div', { class: 'sk-scrim st-scrim' });
  const close = () => { scrim.classList.add('out'); setTimeout(() => scrim.remove(), 200); };
  const input = el('input', { class: 'st-in', type: 'text', maxlength: '60', placeholder: t('pf.stPh'), value: me.statusText || '' });
  let pres = me.status || 'online';
  const seg = el('div', { class: 'pf-seg' });
  const paint = () => seg.replaceChildren(...['online', 'away', 'busy', 'invisible'].map((s) => el('button', { type: 'button', role: 'radio', dataset: { status: s }, 'aria-checked': String(pres === s), onClick: () => { pres = s; paint(); } }, el('i'), el('span', { text: t('status.' + s) }))));
  paint();
  const save = async (text) => {
    try { const j = await api('PATCH', '/me', { statusText: text, status: pres }); remember(j.user); emit('users'); import('./ui.js').then((m) => m.renderAll()); close(); }
    catch { toast(t('act.fail')); }
  };
  const sheet = el('div', { class: 'sk-sheet st-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('pf.stTitle') },
    el('header', { class: 'sk-head' }, el('b', { text: t('pf.stTitle') }), el('button', { class: 'sk-x', type: 'button', 'aria-label': t('close'), onClick: close }, icon('i-x'))),
    el('div', { class: 'st-row' }, avatar(me, 'md', { status: true }), input),
    el('div', { class: 'st-acts' },
      el('button', { class: 'btn', type: 'button', text: t('pf.clear'), onClick: () => save('') }),
      el('button', { class: 'btn primary', type: 'button', text: t('pf.save'), onClick: () => save(input.value.trim()) })));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(input.value.trim()); });
  scrim.append(sheet);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  document.body.append(scrim);
  requestAnimationFrame(() => { scrim.classList.add('in'); setTimeout(() => input.focus(), 250); });
}

let open = null;
export function openProfile(uid) {
  if (open) open.close(true);
  const self = uid === D.me.id;
  const u = self ? D.me : (userById(uid) || { id: uid, name: '…' });
  const scrim = el('div', { class: 'pfs-scrim' });
  const ban = el('div', { class: 'pfs-ban' });
  if (u.header && /^data:image\//.test(u.header)) ban.style.backgroundImage = `url("${u.header}")`;
  else if (u.headerColor && /^#[0-9a-f]{6}$/i.test(u.headerColor)) ban.style.setProperty('--hc', u.headerColor);
  else ban.classList.add('plain');

  const close = (now) => {
    document.removeEventListener('keydown', key);
    if (now) { scrim.remove(); open = null; return; }
    scrim.classList.remove('in'); scrim.classList.add('out');
    setTimeout(() => scrim.remove(), 220); open = null;
  };
  const key = (e) => { if (e.key === 'Escape') close(); };
  const act = (ic, label, run, cls = '') => el('button', { class: 'pfs-act ' + cls, type: 'button', onClick: () => { close(); run(); } }, icon(ic), el('span', { text: label }));

  // balão de status: recado escrito > em ligação > último jogo (preenchido quando chega)
  const bubble = el(self ? 'button' : 'div', { class: 'pfs-bub', hidden: true, type: self ? 'button' : null });
  if (self) { bubble.addEventListener('click', () => { close(true); openStatusEditor(); }); if (!u.statusText && !u.inRoom) { bubble.hidden = false; bubble.classList.add('empty'); bubble.replaceChildren(icon('i-plus'), el('span', { text: t('pf.addStatus') })); } }
  const setBubble = (txt, ic) => { if (!txt) return; bubble.hidden = false; bubble.replaceChildren(...[ic ? icon(ic) : null, el('span', { text: txt })].filter(Boolean)); };
  if (u.statusText) setBubble(u.statusText);
  else if (u.inRoom) setBubble(t('pf.inCall'), 'i-phone');

  const badges = el('div', { class: 'pfs-badges' });
  const panes = { main: el('div', { class: 'pfs-pane' }), act: el('div', { class: 'pfs-pane' }), games: el('div', { class: 'pfs-pane' }) };
  const tabs = el('div', { class: 'pfs-tabs', role: 'tablist' });
  let cur = 'main';
  const showTab = (k) => {
    cur = k;
    for (const [id, p] of Object.entries(panes)) p.hidden = id !== k;
    [...tabs.children].forEach((b) => b.setAttribute('aria-selected', String(b.dataset.k === k)));
  };
  tabs.append(...[['main', 'pf.tab.main'], ['act', 'pf.tab.act'], ['games', 'pf.games']].map(([k, l]) =>
    el('button', { class: 'pfs-tab', type: 'button', role: 'tab', dataset: { k }, text: t(l), onClick: () => showTab(k) })));

  // Principal
  const since = u.since ? new Date(u.since).toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' }) : null;
  panes.main.append(...[
    u.bio ? el('section', { class: 'pfs-sec' }, el('h3', { text: t('pf.about') }), el('p', { class: 'pfs-bio', text: u.bio })) : null,
    since ? el('section', { class: 'pfs-sec' }, el('h3', { text: t('pf.since') }), el('p', { class: 'pfs-since' }, el('span', { class: 'pfs-logo' }), el('span', { text: since }))) : null,
    self ? el('button', { class: 'pfs-frow', type: 'button', onClick: () => { close(); hooks.go && hooks.go('friends'); } }, el('b', { text: t('pf.friends') }),
      el('span', { class: 'pfm-stack' }, ...D.friends.slice(0, 5).map((f) => avatar(f, 'sm'))), icon('i-chev', 'ico chev')) : null,
    !self ? noteBox(uid) : null].filter(Boolean));
  panes.act.append(el('span', { class: 'spin' }));
  panes.games.append(el('span', { class: 'spin' }));

  const sheet = el('div', { class: 'pfs', role: 'dialog', 'aria-modal': 'true', 'aria-label': displayName(u) },
    el('div', { class: 'pfs-grab' }),
    ban,
    el('button', { class: 'pfs-x', type: 'button', 'aria-label': t('close'), onClick: () => close() }, icon('i-x')),
    el('div', { class: 'pfs-head' }, el('span', { class: 'pfs-av' }, avatar(u, 'xl', { status: true })), bubble),
    el('div', { class: 'pfs-card' },
      el('div', { class: 'pfs-id' }, el('h2', { text: displayName(u) }), el('small', { text: '@' + (u.username || '') }), badges),
      self
        ? el('div', { class: 'pfs-acts one' }, act('i-pen', t('profile.edit'), () => import('./settings.js').then((m) => m.openSettings('profile')), 'wide'))
        : el('div', { class: 'pfs-acts' },
          act('c-chat', t('pf.msg'), () => hooks.go && hooks.go('dm', uid)),
          act('i-phone', t('pf.call'), () => hooks.callFriend && hooks.callFriend(u)),
          act('t-games', t('pf.play'), () => openCreateMatch(uid)))),
    tabs, panes.main, panes.act, panes.games);
  showTab('main');
  scrim.append(sheet);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  document.body.append(scrim);
  document.addEventListener('keydown', key);
  requestAnimationFrame(() => scrim.classList.add('in'));
  open = { close };
  // arrastar a folha para baixo fecha (celular)
  let y0 = null, dy = 0;
  sheet.addEventListener('touchstart', (e) => { if (sheet.scrollTop > 0) return; y0 = e.touches[0].clientY; dy = 0; }, { passive: true });
  sheet.addEventListener('touchmove', (e) => { if (y0 === null) return; dy = Math.max(0, e.touches[0].clientY - y0); sheet.style.transform = dy ? `translateY(${dy}px)` : ''; }, { passive: true });
  sheet.addEventListener('touchend', () => { if (y0 === null) return; y0 = null; sheet.style.transform = ''; if (dy > 110) close(); });

  gameCss('uno'); gameCss('stop'); gameCss('tetris');
  api('GET', `/games/stats/${uid}`).then((j) => {
    const stats = j.stats || [];
    const list = stats.filter((s) => s.played > 0).sort((a, b) => b.wins - a.wins || b.played - a.played);
    badges.replaceChildren(...badgesFor(list, u).map(([cls, ic, tip]) => el('span', { class: 'pfs-badge ' + cls, title: tip, 'aria-label': tip }, icon(ic))));
    if (!u.statusText && !u.inRoom && j.last) setBubble(t('pf.played1', { game: gameName(j.last.game), when: ago(j.last.at) }), 't-games');
    // Atividade
    const recent = j.recent || [];
    panes.act.replaceChildren(...[
      j.last ? el('div', { class: 'pfs-now gk-' + j.last.game }, gameArt(j.last.game), el('div', null, el('small', { text: t('pf.lastGame') }), el('b', { text: gameName(j.last.game) }), el('span', { text: ago(j.last.at) }))) : null,
      recent.length ? el('section', { class: 'pfs-sec' }, el('h3', { text: self ? t('pf.recentMe') : t('pf.recentUs') }),
        el('div', { class: 'pfs-rec' }, ...recent.map((m) => {
          const opp = m.host === D.me.id ? m.guest : m.host;
          const res = !m.winner ? 'draw' : m.winner === D.me.id ? 'won' : 'lost';
          return el('div', { class: 'pfs-r r-' + res }, el('span', { class: 'pfs-rdot gk-' + m.game }),
            el('div', null, el('b', { text: gameName(m.game) }), el('small', { text: self ? t('gm.vs', { name: displayName(userById(opp) || { name: '…' }) }) : ago(m.at) })),
            el('span', { class: 'pfs-res', text: t('pf.res.' + res) }));
        }))) : null,
      !j.last && !recent.length ? el('p', { class: 'muted pfs-none', text: t('pf.noact') }) : null].filter(Boolean));
    // Jogos
    if (!list.length) { panes.games.replaceChildren(el('p', { class: 'muted pfs-none', text: t('pf.nogames') })); return; }
    const total = list.reduce((a, s) => a + s.wins, 0);
    panes.games.replaceChildren(
      el('div', { class: 'pfs-total' }, el('b', { text: String(total) }), el('span', { text: t('pf.total') })),
      el('div', { class: 'pfs-glist' }, ...list.map((s) => el('div', { class: 'pfs-g gk-' + s.game },
        gameArt(s.game),
        el('div', { class: 'pfs-gt' }, el('b', { text: gameName(s.game) }),
          el('small', { text: (s.wins === 1 ? t('pf.win1') : t('pf.wins', { n: s.wins })) + ' · ' + t('pf.played', { n: s.played }) }),
          !self && s.vsMe ? el('small', { class: 'pfs-vs', text: t('pf.vs', { w: s.winsVsMe, l: s.myWins }) }) : null),
        el('span', { class: 'pfs-w', text: String(s.wins) })))));
  }).catch(() => { panes.games.replaceChildren(el('p', { class: 'muted pfs-none', text: t('pf.nogames') })); panes.act.replaceChildren(el('p', { class: 'muted pfs-none', text: t('pf.noact') })); });
  void cur;
}
