// Extras da chamada: chat ao lado (ou em folha no celular), efeitos sonoros e "Assistir juntos".
import { $, el, icon, toast, displayName, store } from './util.js';
import { D, CFG, saveCfg, on, emit, userById } from './state.js';
import { api } from './api.js';
import { t, tErr, getLang } from './i18n.js';
import { openModal, closeModal } from './modal.js';
import { inCall, currentRoom, sendSfx, peerPresent, isDirectRoom, shareMedia, openShareDialog, peerInfo } from './call.js';
import { EFFECTS, playEffect, loadCustom, unlockAudio, preloadEffects } from './sfx.js';
import { mountChat, unmountChat, unreadOf } from './chat.js';
import { startActivity } from './activities.js';
import { parseSource } from './watch.js';
import './chat-i18n.js';
import { addDict } from './i18n.js';

addDict('pt', {
  'sfx.title': 'Efeitos sonoros', 'sfx.vol': 'Volume dos efeitos', 'sfx.mine': 'Seus sons', 'sfx.add': 'Adicionar', 'sfx.add.t': 'Adicionar um som (até 1 MB)',
  'sfx.name': 'Nome do som', 'sfx.toolong': 'O som precisa ter até 1 MB.', 'sfx.added': 'Som adicionado.', 'sfx.off': 'Ouvir efeitos', 'sfx.alone': 'Você ouve sozinha até alguém entrar.',
  'wt.title': 'Assistir juntos', 'wt.yt': 'YouTube, Twitch ou Kick', 'wt.yt.d': 'Cole o link do vídeo ou da live. Vídeos ficam no mesmo segundo para todos.', 'wt.file': 'Vídeo do computador', 'wt.file.d': 'Escolha um arquivo. Vai com o som do próprio vídeo; quem assiste não precisa ter o arquivo.',
  'wt.link': 'Link de vídeo', 'wt.link.d': 'Um link direto (.mp4, .webm) ou o link de stream do Stremio.', 'wt.screen': 'Transmitir a tela', 'wt.screen.d': 'Jogos, Spotify, Stremio ou qualquer app aberto.',
  'wt.go': 'Assistir', 'wt.yt.ph': 'https://youtube.com/watch?v=…', 'wt.link.ph': 'https://… ou http://127.0.0.1:11470/…', 'wt.badyt': 'Esse não parece um link do YouTube, da Twitch ou da Kick.',
  'wt.needpeer': 'Espere a outra pessoa entrar na chamada.', 'wt.stremio': 'No Stremio: abra o filme, escolha a fonte e use “Copiar link de stream”. Funciona melhor no Chrome.',
  'wt.loading': 'Abrindo o vídeo…', 'chat.inroom': 'Chat',
});
addDict('en', {
  'sfx.title': 'Sound effects', 'sfx.vol': 'Effects volume', 'sfx.mine': 'Your sounds', 'sfx.add': 'Add', 'sfx.add.t': 'Add a sound (up to 1 MB)',
  'sfx.name': 'Sound name', 'sfx.toolong': 'The sound must be up to 1 MB.', 'sfx.added': 'Sound added.', 'sfx.off': 'Hear effects', 'sfx.alone': 'Only you hear it until someone joins.',
  'wt.title': 'Watch together', 'wt.yt': 'YouTube, Twitch or Kick', 'wt.yt.d': 'Paste the video or live link. Videos stay on the same second for everyone.', 'wt.file': 'Video from computer', 'wt.file.d': 'Pick a file. It goes with the video\'s own sound; they don\'t need the file.',
  'wt.link': 'Video link', 'wt.link.d': 'A direct link (.mp4, .webm) or Stremio\'s stream link.', 'wt.screen': 'Share screen', 'wt.screen.d': 'Games, Spotify, Stremio or any open app.',
  'wt.go': 'Watch', 'wt.yt.ph': 'https://youtube.com/watch?v=…', 'wt.link.ph': 'https://… or http://127.0.0.1:11470/…', 'wt.badyt': 'That does not look like a YouTube, Twitch or Kick link.',
  'wt.needpeer': 'Wait for the other person to join the call.', 'wt.stremio': 'In Stremio: open the movie, pick the source and use “Copy stream link”. Works best in Chrome.',
  'wt.loading': 'Opening the video…', 'chat.inroom': 'Chat',
});

const els = {};
let chatOpen = false;
let custom = [];

/* ───────────── chat na chamada ───────────── */
const peerId = () => { const r = currentRoom(); return r && r.startsWith('d:') ? r.split(':').slice(1).find((x) => x !== D.me.id) : null; };
function setChat(open) {
  const uid = peerId();
  chatOpen = !!open && !!uid;
  els.btnChat.setAttribute('aria-pressed', String(chatOpen));
  els.room.classList.toggle('with-chat', chatOpen);
  els.aside.hidden = !chatOpen;
  if (chatOpen) {
    if (!els.aside.firstChild) {
      els.body = el('div', { class: 'rc-body' });
      els.aside.append(el('div', { class: 'rc-head' }, el('b', { text: t('chat.inroom') }),
        el('button', { class: 'cv-icon', type: 'button', 'aria-label': t('close'), onClick: () => setChat(false) }, icon('i-x'))), els.body);
    }
    els.aside.querySelector('.rc-head b').textContent = `${t('chat.inroom')} · ${displayName(userById(uid))}`;
    mountChat(els.body, uid, { compact: true });
    store.set('roomChat', true);
  } else {
    if (els.body) unmountChat(els.body);
    els.aside.replaceChildren(); els.body = null;
    if (open === false) store.set('roomChat', false);
  }
  paintChatDot();
}
function paintChatDot() {
  const uid = peerId();
  const n = uid ? unreadOf(uid) : 0;
  els.chatDot.hidden = !n || chatOpen;
  els.chatDot.textContent = n > 9 ? '9+' : String(n || '');
  els.dkChat.hidden = !isDirectRoom();
}

/* ───────────── efeitos sonoros ───────────── */
const lastFire = { t: 0 };
function fire(id, btn) {
  unlockAudio();
  const n = Date.now(); if (n - lastFire.t < 600) return; lastFire.t = n;
  playEffect(id);
  sendSfx(id);
  if (btn) { btn.classList.remove('fire'); void btn.offsetWidth; btn.classList.add('fire'); }
}
async function loadSounds() {
  try { const j = await api('GET', '/sounds'); custom = j.sounds || []; } catch { custom = []; }
  for (const s of custom) loadCustom(s.file, `/api/files/${s.file}`).catch(() => {});
}
function closeSfx() { els.sfx.hidden = true; els.btnSfx.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside, true); }
function outside(e) { if (!els.sfx.contains(e.target) && !els.btnSfx.contains(e.target)) closeSfx(); }
function openSfx() {
  preloadEffects();
  if (!els.sfx.hidden) { closeSfx(); return; }
  const lang = getLang().startsWith('en') ? 'en' : 'pt';
  const grid = el('div', { class: 'sfx-grid' }, ...EFFECTS.map((e) => {
    const b = el('button', { class: 'sfx', type: 'button', title: e[lang] }, el('span', { class: 'em', text: e.emoji }), el('span', { text: e[lang] }));
    b.addEventListener('click', () => fire(e.id, b));
    return b;
  }));
  const mine = el('div', { class: 'sfx-grid' }, ...custom.map((s) => {
    const b = el('button', { class: 'sfx', type: 'button', title: s.name }, el('span', { class: 'em', text: s.emoji }), el('span', { text: s.name }),
      s.owner === D.me.id ? el('span', { class: 'del', role: 'button', 'aria-label': t('chat.delete'), onClick: async (ev) => { ev.stopPropagation(); try { await api('DELETE', `/sounds/${s.id}`); custom = custom.filter((x) => x !== s); openSfx(); openSfx(); } catch (x) { toast(tErr(x.code)); } } }, icon('i-x')) : null);
    b.addEventListener('click', () => fire('u:' + s.file, b));
    return b;
  }), el('label', { class: 'sfx add', title: t('sfx.add.t') }, el('span', { class: 'em' }, icon('i-plus')), el('span', { text: t('sfx.add') }),
    el('input', { type: 'file', accept: 'audio/*', class: 'sr-only', onChange: (ev) => addSound(ev.target.files[0]) })));
  const vol = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(CFG.volSfx ?? 0.7), 'aria-label': t('sfx.vol') });
  const out = el('output', { text: String(Math.round((CFG.volSfx ?? 0.7) * 100)) });
  vol.addEventListener('input', () => { CFG.volSfx = Number(vol.value); out.textContent = String(Math.round(CFG.volSfx * 100)); saveCfg(); });
  els.sfx.replaceChildren(
    el('div', { class: 'rpop-head' }, el('button', { class: 'grab', type: 'button', 'aria-label': t('close'), onClick: closeSfx }), el('h2', { text: t('sfx.title') })),
    el('div', { class: 'sfx-head' }, el('b', { text: t('sfx.title') })),
    grid, el('div', { class: 'sfx-sub', text: t('sfx.mine') }), mine,
    el('div', { class: 'sfx-foot' }, icon('c-vol', 'i s19'), vol, out),
    ...(!peerPresent() ? [el('p', { class: 'rnote', text: t('sfx.alone') })] : []));
  els.sfx.hidden = false;
  els.btnSfx.setAttribute('aria-expanded', 'true');
  // posição: acima do botão (computador); no celular o CSS transforma em folha
  const r = els.btnSfx.getBoundingClientRect(), rr = els.room.getBoundingClientRect();
  els.sfx.style.left = Math.max(12, Math.min(r.left - rr.left - 160, rr.width - els.sfx.offsetWidth - 12)) + 'px';
  els.sfx.style.bottom = (rr.bottom - r.top + 12) + 'px'; els.sfx.style.top = 'auto';
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
}
async function addSound(file) {
  if (!file) return;
  if (file.size > 1024 * 1024) { toast(t('sfx.toolong')); return; }
  const other = peerId() || (D.friends[0] && D.friends[0].id);
  if (!other) return;
  try {
    const j = await api('POST', '/files', { to: other, name: file.name, type: file.type || 'audio/mpeg', size: file.size });
    await fetch(`/api/files/${j.id}/0`, { method: 'PUT', credentials: 'same-origin', headers: { 'X-Telinha': '1', 'Content-Type': 'application/octet-stream' }, body: file });
    const name = file.name.replace(/\.[^.]+$/, '').slice(0, 24);
    const r = await api('POST', '/sounds', { file: j.id, name, emoji: '🔊' });
    custom.push(r.sound); loadCustom(r.sound.file, `/api/files/${r.sound.file}`).catch(() => {});
    toast(t('sfx.added')); closeSfx(); openSfx();
  } catch (e) { toast(tErr(e.code)); }
}

/* ───────────── assistir juntos ───────────── */
function openWatch() {
  if (!inCall()) return;
  const canScreen = !!navigator.mediaDevices?.getDisplayMedia && !/iPhone|iPad|iPod/.test(navigator.userAgent);
  const ytIn = el('input', { type: 'url', placeholder: t('wt.yt.ph'), autocomplete: 'off', spellcheck: 'false', 'aria-label': t('wt.yt') });
  const linkIn = el('input', { type: 'url', placeholder: t('wt.link.ph'), autocomplete: 'off', spellcheck: 'false', 'aria-label': t('wt.link') });
  const fileIn = el('input', { type: 'file', accept: 'video/*,audio/*', class: 'sr-only' });
  const need = () => { if (!peerPresent()) { toast(t('wt.needpeer')); return false; } return true; };
  const goYt = () => {
    const s = parseSource(ytIn.value);
    if (!s || !['yt', 'twitch', 'kick'].includes(s.type)) { toast(t('wt.badyt')); return; }
    if (!need()) return;
    if (startActivity('watch', s)) closeModal();
  };
  const goLink = async () => {
    const raw = linkIn.value.trim(); if (!raw) return;
    let u; try { u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : 'https://' + raw); } catch { toast(t('wt.badlink')); return; }
    const local = /^(127\.0\.0\.1|localhost)$/.test(u.hostname);
    if (!(u.protocol === 'https:' || (u.protocol === 'http:' && local))) { toast(t('wt.badlink')); return; }
    closeModal(); toast(t('wt.loading'));
    await shareMedia(u.href, decodeURIComponent(u.pathname.split('/').pop() || u.hostname));
  };
  fileIn.addEventListener('change', async () => { const f = fileIn.files[0]; if (!f) return; closeModal(); toast(t('wt.loading')); await shareMedia(f, f.name); });
  ytIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') goYt(); });
  linkIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') goLink(); });
  const opt = (cls, ic, title, desc, extra, onClick) => {
    const b = el('div', { class: 'wch-opt ' + cls, role: onClick ? 'button' : null, tabindex: onClick ? '0' : null },
      el('span', { class: 'wi' }, icon(ic)), el('div', { class: 'grow' }, el('b', { text: title }), el('small', { text: desc }), extra || null));
    if (onClick) { b.addEventListener('click', onClick); b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }); }
    return b;
  };
  const body = el('div', { class: 'wch' },
    opt('yt', 'c-yt', t('wt.yt'), t('wt.yt.d'), el('div', { class: 'wch-in' }, ytIn, el('button', { class: 'btn primary', type: 'button', onClick: goYt }, t('wt.go')))),
    opt('file', 'c-upload', t('wt.file'), t('wt.file.d'), null, () => fileIn.click()),
    opt('link', 'c-link', t('wt.link'), t('wt.link.d'), el('div', { class: 'wch-in' }, linkIn, el('button', { class: 'btn', type: 'button', onClick: goLink }, t('wt.go')))),
    canScreen ? opt('screen', 'i-screen', t('wt.screen'), t('wt.screen.d'), null, () => { closeModal(); openShareDialog(); }) : null,
    el('p', { class: 'wch-note', text: t('wt.stremio') }), fileIn);
  openModal(t('wt.title'), body);
  setTimeout(() => ytIn.focus(), 60);
}

export function initRoomExtras() {
  Object.assign(els, {
    room: $('#view-room'), aside: $('#room-chat'), btnChat: $('#btn-chat'), chatDot: $('#chat-dot'), dkChat: $('#dk-chat'),
    btnSfx: $('#btn-sfx'), sfx: $('#sfx-pop'), btnWatch: $('#btn-watch'),
  });
  els.btnChat.addEventListener('click', () => setChat(!chatOpen));
  els.btnSfx.addEventListener('click', openSfx);
  els.btnWatch.addEventListener('click', openWatch);
  on('sfx-remote', (id) => playEffect(id));
  on('chat-unread', paintChatDot);
  on('call', () => {
    paintChatDot();
    if (inCall() && isDirectRoom() && !chatOpen && store.get('roomChat', false) && !matchMedia('(max-width: 1100px)').matches) setChat(true);
    if (!inCall() && chatOpen) setChat(null);
  });
  on('call-left', () => { if (chatOpen) setChat(null); closeSfx(); });
  loadSounds();
  void peerInfo; void emit;
}
