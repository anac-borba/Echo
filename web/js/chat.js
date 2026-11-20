// Chat do Echo: conversas diretas com texto, emojis, GIFs, fotos, vídeos, áudios, arquivos,
// visualização única, responder, reagir, editar e apagar, "visto", "digitando…" e o registro das chamadas.
import { localNotify, setBadge } from './notify.js';
import { $, el, icon, toast, avatar, displayName, store, copyText } from './util.js';
import { D, CFG, userById, emit, on } from './state.js';
import { api } from './api.js';
import { t, tErr, getLang } from './i18n.js';
import { confirmBox } from './modal.js';
import { uiSound, unlockAudio } from './sfx.js';
import { EMOJI_CATS, searchEmoji, QUICK } from './emoji.js';
import './chat-i18n.js';
import { openProfile, setProfileHooks } from './profile-sheet.js';
import { openCreateMatch } from './games-hub.js';

const S = {
  convs: new Map(),   // uid -> { unread, readAt, theirReadAt, last }
  msgs: new Map(),    // uid -> { list: [], more, loading, loaded }
  typing: new Map(),  // uid -> timeout
  views: new Set(),   // conversas abertas na tela agora
  events: null, go: null, callFriend: null,
};
const MAX_FILE = 100 * 1024 * 1024;
const GROUP_MS = 5 * 60 * 1000;
const fileUrl = (id, dl) => `/api/files/${id}${dl ? '?dl=1' : ''}`;
const gifUrl = (u) => `/api/gif-media?u=${encodeURIComponent(u)}`;
const isMobile = () => matchMedia('(max-width: 820px), (orientation: landscape) and (max-height: 520px)').matches;
const fmtTime = (ts) => new Intl.DateTimeFormat(getLang(), { hour: '2-digit', minute: '2-digit' }).format(ts);
function fmtDay(ts) {
  const d = new Date(ts), n = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(n) - day(d)) / 86400000);
  if (diff === 0) return t('chat.today');
  if (diff === 1) return t('chat.yesterday');
  return new Intl.DateTimeFormat(getLang(), diff < 7 ? { weekday: 'long' } : { day: 'numeric', month: 'long', year: d.getFullYear() === n.getFullYear() ? undefined : 'numeric' }).format(d);
}
function fmtDur(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min`;
  return `${x} s`;
}
const fmtClock = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtSize = (b) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0)} MB`);
const nameOf = (uid) => (uid === D.me.id ? t('you') : displayName(userById(uid)));

/* mensagens que esperam a internet voltar */
const WAIT = [];
window.addEventListener('online', () => { const q = WAIT.splice(0); q.forEach((f) => { try { f(); } catch { /* ok */ } }); });

/* ───────────── dados ───────────── */
export let convsReady = false;
export async function loadConvs() {
  try {
    const j = await api('GET', '/convs');
    convsReady = true;
    S.convs.clear();
    for (const c of j.convs || []) S.convs.set(c.with, c);
    emit('chat-unread');
  } catch { if (!convsReady) { convsReady = true; emit('chat-unread'); } }
}
export const unreadOf = (uid) => (S.convs.get(uid) || {}).unread || 0;
export const totalUnread = () => [...S.convs.values()].reduce((n, c) => n + (c.unread || 0), 0);
on('chat-unread', () => setBadge(totalUnread()));
export const lastOf = (uid) => (S.convs.get(uid) || {}).last || null;
const bucket = (uid) => { let b = S.msgs.get(uid); if (!b) S.msgs.set(uid, (b = { list: [], more: true, loading: false, loaded: false })); return b; };
const otherOfConv = (conv) => conv.split(':').slice(1).find((x) => x !== D.me.id);

async function loadMore(uid, first) {
  const b = bucket(uid);
  if (b.loading || (!first && !b.more)) return false;
  b.loading = true;
  try {
    const old = b.list.find((m) => !m.pending);
    const q = first || !old ? '' : `&before=${old.at}_${old.id}`;
    const j = await api('GET', `/messages?with=${uid}&limit=50${q}`);
    const have = new Set(b.list.map((m) => m.id));
    const add = (j.messages || []).filter((m) => !have.has(m.id));
    b.list = first ? [...add, ...b.list.filter((m) => m.pending)] : [...add, ...b.list];
    b.more = !!j.more; b.loaded = true;
    if (first && Array.isArray(j.pins)) b.pins = j.pins;
    const c = S.convs.get(uid); if (c) c.theirReadAt = Math.max(c.theirReadAt || 0, j.theirReadAt || 0);
    return add.length > 0;
  } catch (e) { toast(tErr(e.code)); return false; } finally { b.loading = false; }
}

function upsert(m) {
  const uid = otherOfConv(m.conv);
  const b = bucket(uid);
  const i = b.list.findIndex((x) => x.id === m.id);
  if (i >= 0) b.list[i] = m;
  else if (b.loaded || b.list.length) {
    b.list.push(m);
    b.list.sort((a, c) => (a.pending ? 1 : 0) - (c.pending ? 1 : 0) || a.at - c.at || (a.id < c.id ? -1 : 1));
  }
  const c = S.convs.get(uid) || { with: uid, unread: 0, readAt: 0, theirReadAt: 0, last: null };
  if (!c.last || m.at >= c.last.at || c.last.id === m.id) c.last = m;
  S.convs.set(uid, c);
  return uid;
}

/* ───────────── eventos ao vivo ───────────── */
/** Atualiza os filhos de `box` para a lista `want` mexendo só no que mudou.
 *  (replaceChildren tirava e recolocava as 100+ mensagens a cada envio: o navegador recalculava tudo.) */
function patchChildren(box, want) {
  let cur = box.firstChild;
  for (const n of want) {
    if (n === cur) { cur = cur.nextSibling; continue; }
    box.insertBefore(n, cur);
  }
  while (cur) { const nx = cur.nextSibling; cur.remove(); cur = nx; }
}

export function onChatEvent(m) {
  if (m.t === 'msg') {
    const uid = upsert(m.m);
    const mine = m.m.author === D.me.id;
    if (!mine && m.m.kind !== 'call') {
      const c = S.convs.get(uid);
      const viewing = [...S.views].some((v) => v.uid === uid && v.isActive());
      if (!viewing) {
        c.unread = (c.unread || 0) + 1;
        // em ligação com essa pessoa: sem aviso nem som, só o número no botão do chat
        const r = S.room && S.room(); const inCallWith = typeof r === 'string' && r.startsWith('d:') && r.split(':').includes(uid);
        if (!inCallWith) {
          if (CFG.msgSound !== false) uiSound('msg');
          const who = displayName(userById(uid));
          toast(`${who}: ${preview(m.m)}`, { ms: 5000, action: { label: t('chat.open'), run: () => S.go && S.go('dm', uid) } });
          localNotify({ title: who, body: preview(m.m), tag: 'dm:' + uid, onClick: () => S.go && S.go('dm', uid) });
        }
      }
      S.typing.delete(uid);
    }
    redraw(uid, true);
    emit('chat-unread');
  } else if (m.t === 'msg-up') {
    redraw(upsert(m.m));
  } else if (m.t === 'msg-del') {
    const uid = otherOfConv(m.conv);
    const b = bucket(uid);
    b.list = b.list.filter((x) => x.id !== m.id);
    const c = S.convs.get(uid);
    if (c && c.last && c.last.id === m.id) c.last = b.list.filter((x) => !x.pending).slice(-1)[0] || null;
    redraw(uid); emit('chat-unread');
  } else if (m.t === 'read') {
    const uid = otherOfConv(m.conv);
    const c = S.convs.get(uid);
    if (!c) return;
    if (m.uid === D.me.id) { c.readAt = Math.max(c.readAt || 0, m.at); c.unread = 0; emit('chat-unread'); }
    else c.theirReadAt = Math.max(c.theirReadAt || 0, m.at);
    redraw(uid);
  } else if (m.t === 'msg-pins') {
    const uid = otherOfConv(m.conv);
    bucket(uid).pins = m.pins || [];
    for (const v of S.views) if (v.uid === uid) { v.pinIdx = 0; v.drawPins(); v.draw(); }
  } else if (m.t === 'typing') {
    clearTimeout(S.typing.get(m.from));
    S.typing.set(m.from, setTimeout(() => { S.typing.delete(m.from); typingChanged(m.from); }, 4500));
    typingChanged(m.from);
  }
}
function typingChanged(uid) { for (const v of S.views) if (v.uid === uid) v.drawTyping(); emit('chat-typing', uid); }
export const isTyping = (uid) => S.typing.has(uid);
function redraw(uid, incoming) { for (const v of S.views) if (v.uid === uid) v.draw(incoming); }

export function preview(m) {
  if (!m) return '';
  if (m.kind === 'call') return m.call && m.call.missed ? t('chat.call.missed.short') : t('chat.call.short', { dur: fmtDur((m.call && m.call.dur) || 0) });
  if (m.once) return '◌ ' + t('chat.once.' + (m.onceKind || 'text'));
  if (m.text) return m.text.replace(/\s+/g, ' ').slice(0, 80);
  if (m.gif) return 'GIF';
  const f = m.files && m.files[0];
  if (!f) return '';
  const k = f.type.split('/')[0];
  return k === 'image' ? t('chat.photo') : k === 'video' ? t('chat.video') : k === 'audio' ? t('chat.audio') : f.name;
}

/* ───────────── envio de arquivos (em pedaços, com progresso) ───────────── */
async function putChunk(id, n, blob) {
  for (let tries = 0; tries < 3; tries++) {
    try {
      const r = await fetch(`/api/files/${id}/${n}`, { method: 'PUT', credentials: 'same-origin', headers: { 'X-Telinha': '1', 'Content-Type': 'application/octet-stream' }, body: blob });
      if (r.ok) return;
      if (r.status < 500) throw Object.assign(new Error('up'), { code: (await r.json().catch(() => ({}))).error || 'generic' });
    } catch (e) { if (e.code) throw e; }
    await new Promise((r) => setTimeout(r, 600 * (tries + 1)));
  }
  throw Object.assign(new Error('up'), { code: 'network' });
}
async function uploadFile(to, file, once, onProgress) {
  const j = await api('POST', '/files', { to, name: file.name || 'arquivo', type: file.type || 'application/octet-stream', size: file.size, once: !!once });
  for (let n = 0; n < j.chunks; n++) {
    await putChunk(j.id, n, file.slice(n * j.chunk, Math.min(file.size, (n + 1) * j.chunk)));
    onProgress && onProgress((n + 1) / j.chunks);
  }
  return j.id;
}
/** Mede foto/vídeo/áudio antes de enviar (para o balão já nascer do tamanho certo). */
function measure(file) {
  const k = (file.type || '').split('/')[0];
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const done = (o) => { URL.revokeObjectURL(url); resolve(o); };
    setTimeout(() => done({}), 4000);
    if (k === 'image') { const i = new Image(); i.onload = () => done({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => done({}); i.src = url; }
    else if (k === 'video' || k === 'audio') {
      const m = document.createElement(k); m.preload = 'metadata'; m.muted = true;
      m.onloadedmetadata = () => done({ w: m.videoWidth || null, h: m.videoHeight || null, dur: Number.isFinite(m.duration) ? m.duration : null });
      m.onerror = () => done({}); m.src = url;
    } else done({});
  });
}

/* ───────────── visualizador (fotos, vídeos e visualização única) ───────────── */
function openViewer(kind, src, { once = false, text = '', name = '' } = {}) {
  const box = el('div', { class: 'viewer' + (once ? ' once' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': name || t('chat.view') });
  const close = () => { box.classList.add('out'); setTimeout(() => box.remove(), 180); document.removeEventListener('keydown', key); if (once) emit('chat-once-closed'); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  let media = null;
  if (kind === 'image') media = el('img', { src, alt: name, draggable: 'false' });
  else if (kind === 'video') { media = el('video', { src, controls: true, playsinline: true, autoplay: true, controlslist: once ? 'nodownload' : null }); }
  else if (kind === 'text') media = el('p', { class: 'viewer-text', text });
  box.append(
    el('div', { class: 'viewer-top' },
      once ? el('span', { class: 'viewer-badge' }, icon('c-once'), t('chat.once.viewing')) : el('span', {}),
      el('div', { class: 'row' },
        !once && kind !== 'text' ? el('a', { class: 'viewer-btn', href: src + (src.includes('?') ? '&' : '?') + 'dl=1', download: name || '', 'aria-label': t('chat.download') }, icon('c-down')) : null,
        el('button', { class: 'viewer-btn', type: 'button', 'aria-label': t('close'), onClick: close }, icon('i-x')))),
    el('div', { class: 'viewer-stage', onClick: (e) => { if (e.target === e.currentTarget) close(); } }, media));
  if (once) box.addEventListener('contextmenu', (e) => e.preventDefault());
  document.body.append(box);
  document.addEventListener('keydown', key);
  requestAnimationFrame(() => box.classList.add('in'));
}

/* ───────────── a conversa (pode estar na tela principal ou no painel da chamada) ───────────── */
class ChatView {
  constructor(root, uid, { compact = false, onBack = null } = {}) {
    this.root = root; this.uid = uid; this.compact = compact; this.onBack = onBack;
    this.cache = new Map(); this.openedAt = Date.now() - 2000; this.reply = null; this.editing = null; this.once = false; this.pending = [];
    this.build();
    S.views.add(this);
    const b = bucket(uid);
    if (!b.loaded) loadMore(uid, true).then(() => { this.draw(); this.toBottom(true); this.markRead(); });
    this.draw(); this.toBottom(true); this.markRead();
  }
  destroy() { S.views.delete(this); this.closePanels(); this.stopRec(true); }
  isActive() { return document.visibilityState === 'visible' && this.root.isConnected && !this.root.closest('[hidden]'); }

  build() {
    const u = userById(this.uid) || { id: this.uid };
    const call = el('button', { class: 'cv-icon', type: 'button', title: t('friends.call'), 'aria-label': t('friends.call'), onClick: () => S.callFriend && S.callFriend(u) }, icon('i-phone'));
    const play = el('button', { class: 'cv-icon', type: 'button', title: t('chat.att.game'), 'aria-label': t('chat.att.game'), onClick: () => openCreateMatch(u.id) }, icon('t-games'));
    this.sub = el('small', { class: 'cv-sub' });
    this.head = this.compact ? null : el('header', { class: 'cv-top' },
      this.onBack ? el('button', { class: 'cv-icon back', type: 'button', 'aria-label': t('back'), onClick: this.onBack }, icon('i-back')) : null,
      el('button', { class: 'cv-person', type: 'button', 'aria-label': t('chat.profile', { name: displayName(u) }), onClick: () => openProfile(this.uid) },
        avatar(u, 'sm', { status: true }),
        el('div', { class: 'cv-who' }, el('b', { text: displayName(u) }), this.sub)),
      el('div', { class: 'cv-acts' }, play, call));
    this.pinBar = el('button', { class: 'cv-pin', type: 'button', hidden: true, onClick: () => this.nextPin() });
    this.pinIdx = 0;
    this.list = el('div', { class: 'cv-list' });
    this.older = el('div', { class: 'cv-older' });
    this.scroll = el('div', { class: 'cv-scroll', role: 'log', 'aria-live': 'polite', 'aria-label': t('chat.messages') }, this.older, this.list);
    this.scroll.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.jump = el('button', { class: 'cv-jump', type: 'button', hidden: true, 'aria-label': t('chat.tobottom'), onClick: () => this.toBottom() }, icon('i-chev-down'));
    this.typingEl = el('div', { class: 'cv-typing', 'aria-live': 'polite' });
    this.buildComposer();
    // sem internet: um aviso só; as mensagens ficam guardadas e saem sozinhas quando a conexão voltar
    this.offline = el('div', { class: 'cv-off', role: 'status', hidden: navigator.onLine !== false }, icon('i-wifi-off'), el('span', { text: t('chat.offline') }));
    const syncOff = () => { if (this.offline) this.offline.hidden = navigator.onLine !== false; };
    window.addEventListener('online', syncOff); window.addEventListener('offline', syncOff);
    this.root.replaceChildren(...[this.head, this.offline, this.pinBar, el('div', { class: 'cv-body' }, this.scroll, this.jump), this.typingEl, this.composer].filter(Boolean));
    this.root.classList.add('cv');
    this.root.classList.toggle('compact', this.compact);
    // arrastar arquivos para a conversa
    this.root.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); this.root.classList.add('drop'); } });
    this.root.addEventListener('dragleave', (e) => { if (e.target === this.root || !this.root.contains(e.relatedTarget)) this.root.classList.remove('drop'); });
    this.root.addEventListener('drop', (e) => { e.preventDefault(); this.root.classList.remove('drop'); if (e.dataTransfer.files.length) this.addFiles([...e.dataTransfer.files]); });
    this.drawHeader();
    this.drawPins();
  }
  /* ── fixadas: a barra mostra uma; tocar leva até ela e passa para a próxima (como no Telegram) ── */
  drawPins() {
    const pins = bucket(this.uid).pins || [];
    this.pinBar.hidden = !pins.length;
    if (!pins.length) return;
    if (this.pinIdx >= pins.length) this.pinIdx = 0;
    const p = pins[this.pinIdx];
    this.pinBar.replaceChildren(
      el('span', { class: 'pin-rail' }, ...pins.slice(0, 5).map((_, i) => el('i', { class: i === Math.min(this.pinIdx, 4) ? 'on' : '' }))),
      el('span', { class: 'pin-t' }, el('b', { text: pins.length > 1 ? t('chat.pinned.n', { i: this.pinIdx + 1, n: pins.length }) : t('chat.pinned') }), el('span', { text: preview(p.m) })),
      icon('c-pin', 'ico pin-ic'));
  }
  async nextPin() {
    const pins = bucket(this.uid).pins || []; if (!pins.length) return;
    const p = pins[this.pinIdx];
    await this.goTo(p.m.id);
    this.pinIdx = (this.pinIdx + 1) % pins.length; this.drawPins();
  }
  /** Rola até a mensagem (carrega as mais antigas se precisar). */
  async goTo(id) {
    for (let i = 0; i < 20 && !this.cache.get(id); i++) { const got = await loadMore(this.uid, false); this.draw(); if (!got) break; }
    this.flash(id);
  }
  isPinned(m) { return (bucket(this.uid).pins || []).some((p) => p.m.id === m.id); }
  async pin(m) {
    const on = !this.isPinned(m);
    try { const j = await api('POST', `/messages/${m.id}/pin`, { on }); bucket(this.uid).pins = j.pins; this.pinIdx = 0; this.drawPins(); this.draw(); toast(on ? t('chat.pin.done') : t('chat.unpin.done')); }
    catch (e) { toast(tErr(e.code)); }
  }
  drawHeader() {
    if (!this.sub) return;
    const u = userById(this.uid) || {};
    this.sub.textContent = isTyping(this.uid) ? t('chat.typing') : u.inRoom ? t('status.incall') : u.online === false ? t('status.offline') : (u.statusText || t('status.' + (u.status || 'online')));
    this.sub.classList.toggle('typing', isTyping(this.uid));
  }
  drawTyping() {
    const on = isTyping(this.uid);
    // ao parar, o texto fica até o esmaecer terminar (motion.css)
    if (on && !this.typingEl.classList.contains('on')) this.typingEl.replaceChildren(...(on ? [el('span', { class: 'dots' }, el('i'), el('i'), el('i')), el('span', { text: t('chat.typing.who', { name: displayName(userById(this.uid)) }) })] : []));
    this.typingEl.classList.toggle('on', on);
    this.drawHeader();
  }

  /* ── composição ── */
  buildComposer() {
    this.ta = el('textarea', { class: 'cmp-input', rows: '1', placeholder: isMobile() ? t('chat.ph.s') : t('chat.ph', { name: displayName(userById(this.uid)) }), 'aria-label': t('chat.write'), enterkeyhint: isMobile() ? 'enter' : 'send' });
    this.ta.addEventListener('input', () => { this.autosize(); this.syncSend(); this.sendTyping(); });
    this.ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !isMobile()) { e.preventDefault(); this.submit(); }
      else if (e.key === 'Escape') { if (this.editing || this.reply) { this.cancelBar(); e.preventDefault(); } }
      else if (e.key === 'ArrowUp' && !this.ta.value) { const mine = bucket(this.uid).list.filter((m) => m.author === D.me.id && m.kind === 'text' && !m.once && !m.pending).pop(); if (mine) { e.preventDefault(); this.startEdit(mine); } }
    });
    this.ta.addEventListener('paste', (e) => { const fs = [...(e.clipboardData ? e.clipboardData.files : [])]; if (fs.length) { e.preventDefault(); this.addFiles(fs); } });
    this.fileIn = el('input', { type: 'file', multiple: true, class: 'sr-only', tabindex: '-1', onChange: (e) => { this.addFiles([...e.target.files]); e.target.value = ''; } });
    this.bar = el('div', { class: 'cmp-bar', hidden: true });
    this.tray = el('div', { class: 'cmp-tray', hidden: true });
    this.btnSend = el('button', { class: 'cmp-send', type: 'button', 'aria-label': t('chat.send'), onClick: () => this.submit() }, icon('c-send'));
    this.btnMic = el('button', { class: 'cmp-btn mic', type: 'button', 'aria-label': t('chat.rec'), title: t('chat.rec'), onClick: () => this.startRec() }, icon('i-mic'));
    this.btnPlus = el('button', { class: 'cmp-btn plus', type: 'button', 'aria-label': t('chat.attach'), title: t('chat.attach'), 'aria-haspopup': 'menu', onClick: () => this.openAttach() }, icon('i-plus'));
    this.btnEmoji = el('button', { class: 'cmp-btn', type: 'button', 'aria-label': t('chat.emoji'), title: t('chat.emoji'), onClick: (e) => this.togglePanel('emoji', e.currentTarget) }, icon('c-smile'));
    this.btnGif = el('button', { class: 'cmp-btn', type: 'button', 'aria-label': 'GIF', title: 'GIF', onClick: (e) => this.togglePanel('gif', e.currentTarget) }, icon('c-gif'));
    this.onceChip = el('button', { class: 'cmp-once', type: 'button', hidden: true, title: t('chat.once.off'), onClick: () => this.setOnce(false) }, icon('c-once'), el('span', { text: t('chat.once.on') }), icon('i-x'));
    this.rec = el('div', { class: 'cmp-rec', hidden: true });
    this.row = el('div', { class: 'cmp-row' }, this.btnPlus,
      el('div', { class: 'cmp-field' }, this.onceChip, this.ta, this.btnEmoji, this.btnGif),
      this.btnMic, this.btnSend);
    this.panel = el('div', { class: 'cmp-panel', hidden: true });
    this.composer = el('div', { class: 'cmp' }, this.panel, this.bar, this.tray, this.row, this.rec, this.fileIn);
    this.syncSend();
  }
  autosize() { this.ta.style.height = 'auto'; this.ta.style.height = Math.min(160, this.ta.scrollHeight) + 'px'; }
  syncSend() {
    const has = !!this.ta.value.trim() || this.pending.length > 0 || !!this.editing;
    this.btnSend.hidden = !has; this.btnMic.hidden = has;
    this.composer.classList.toggle('has', has);
  }
  sendTyping() {
    const n = Date.now();
    if (this.ta.value && (!this.lastTyping || n - this.lastTyping > 2500)) { this.lastTyping = n; S.events && S.events.send({ t: 'typing', to: this.uid }); }
  }
  setOnce(v) { this.once = v; this.onceChip.hidden = !v; this.composer.classList.toggle('once', v); }
  showBar(kind, m) {
    const label = kind === 'edit' ? t('chat.editing') : t('chat.replying', { name: nameOf(m.author) });
    this.bar.replaceChildren(icon(kind === 'edit' ? 'i-pen' : 'c-reply'),
      el('div', { class: 'grow' }, el('b', { text: label }), el('span', { text: preview(m) })),
      el('button', { class: 'cv-icon', type: 'button', 'aria-label': t('cancel'), onClick: () => this.cancelBar() }, icon('i-x')));
    this.bar.hidden = false;
  }
  cancelBar() { if (this.editing) { this.ta.value = ''; this.autosize(); } this.reply = null; this.editing = null; this.bar.hidden = true; this.syncSend(); }
  startReply(m) { this.editing = null; this.reply = m; this.showBar('reply', m); this.ta.focus(); }
  startEdit(m) { this.reply = null; this.editing = m; this.ta.value = m.text; this.autosize(); this.showBar('edit', m); this.ta.focus(); this.syncSend(); }

  addFiles(files) {
    for (const f of files) {
      if (f.size > MAX_FILE) { toast(t('chat.toobig', { name: f.name })); continue; }
      if (this.pending.length >= 10) break;
      const url = /^(image|video)\//.test(f.type) ? URL.createObjectURL(f) : null;
      this.pending.push({ file: f, url });
    }
    this.drawTray(); this.syncSend(); this.ta.focus();
  }
  drawTray() {
    this.tray.hidden = !this.pending.length;
    this.tray.replaceChildren(...this.pending.map((p, i) => {
      const k = p.file.type.split('/')[0];
      const thumb = k === 'image' && p.url ? el('img', { src: p.url, alt: '' }) : k === 'video' && p.url ? el('video', { src: p.url, muted: true, playsinline: true }) : el('span', { class: 'tray-ic' }, icon(k === 'audio' ? 'i-mic' : 'c-file'));
      return el('div', { class: 'tray-item' }, thumb, el('span', { class: 'tray-name', text: p.file.name }),
        el('button', { class: 'tray-x', type: 'button', 'aria-label': t('chat.remove'), onClick: () => { if (p.url) URL.revokeObjectURL(p.url); this.pending.splice(i, 1); this.drawTray(); this.syncSend(); } }, icon('i-x')));
    }));
  }

  async submit() {
    unlockAudio();
    const text = this.ta.value.replace(/\s+$/, '');
    if (this.editing) {
      const m = this.editing;
      if (!text.trim()) return;
      this.cancelBar(); this.ta.value = ''; this.autosize();
      try { const j = await api('PATCH', `/messages/${m.id}`, { text }); upsert(j.message); this.draw(); } catch (e) { toast(tErr(e.code)); }
      return;
    }
    if (!text.trim() && !this.pending.length) return;
    const files = this.pending.splice(0); const reply = this.reply; const once = this.once;
    this.ta.value = ''; this.autosize(); this.drawTray(); this.cancelBar(); this.setOnce(false); this.syncSend();
    if (once && files.length > 1) { toast(t('chat.once.one')); }
    // cada arquivo vira uma mensagem (com a legenda na última), como no celular
    const groups = files.length ? files.map((f, i) => ({ files: [f], text: i === files.length - 1 ? text : '' })) : [{ files: [], text }];
    for (const g of groups) await this.sendOne(g, reply, once && groups.length === 1);
  }
  async sendOne({ files, text }, reply, once) {
    const tmp = { id: 'tmp' + Math.random().toString(36).slice(2), pending: true, author: D.me.id, conv: '', at: Date.now(), kind: files.length ? 'file' : 'text', text, once,
      files: files.map((f) => ({ id: null, local: f.url, name: f.file.name, type: f.file.type || 'application/octet-stream', size: f.file.size })), reactions: {}, progress: 0 };
    const b = bucket(this.uid); b.list.push(tmp); this.draw(); this.toBottom();
    try {
      const meta = [];
      for (const f of files) {
        const dims = await measure(f.file);
        const id = await uploadFile(this.uid, f.file, once, (p) => { tmp.progress = p; this.drawProgress(tmp); });
        meta.push({ id, ...dims });
      }
      const j = await api('POST', '/messages', { to: this.uid, text, files: meta, once, reply: reply ? reply.id : undefined });
      b.list = b.list.filter((m) => m !== tmp);
      upsert(j.message);
      for (const f of files) if (f.url) setTimeout(() => URL.revokeObjectURL(f.url), 30000);
    } catch (e) {
      const again = () => { b.list = b.list.filter((m) => m !== tmp); this.sendOne({ files, text }, reply, once); };
      if (e.code === 'network' || navigator.onLine === false) { tmp.waiting = true; WAIT.push(again); }
      else { tmp.failed = true; tmp.retry = again; toast(tErr(e.code)); }
    }
    this.draw(); this.toBottom();
  }
  async sendGif(g) {
    this.closePanels();
    try { const j = await api('POST', '/messages', { to: this.uid, gif: g, reply: this.reply ? this.reply.id : undefined, once: this.once }); this.cancelBar(); this.setOnce(false); upsert(j.message); this.draw(); this.toBottom(); }
    catch (e) { toast(tErr(e.code)); }
  }

  /* ── gravar áudio ── */
  async startRec() {
    unlockAudio();
    if (!navigator.mediaDevices || !window.MediaRecorder) { toast(t('chat.rec.none')); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch { toast(t('chat.rec.denied')); return; }
    const types = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
    const mime = types.find((x) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(x)) || '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const t0 = Date.now();
    const time = el('span', { class: 'rec-time', text: '0:00' });
    const lvl = el('div', { class: 'rec-wave' }, ...Array.from({ length: 28 }, () => el('i')));
    this.recState = { rec, stream, chunks, t0, mime: rec.mimeType || mime || 'audio/webm' };
    this.rec.replaceChildren(
      el('button', { class: 'cmp-btn', type: 'button', 'aria-label': t('chat.rec.cancel'), title: t('chat.rec.cancel'), onClick: () => this.stopRec(true) }, icon('i-trash')),
      el('span', { class: 'rec-dot' }), time, lvl,
      el('button', { class: 'cmp-send', type: 'button', 'aria-label': t('chat.send'), onClick: () => this.stopRec(false) }, icon('c-send')));
    this.rec.hidden = false; this.row.hidden = true;
    // medidor simples (barrinhas)
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const an = ac.createAnalyser(); an.fftSize = 512; ac.createMediaStreamSource(stream).connect(an);
      const d = new Uint8Array(an.fftSize); const bars = [...lvl.children]; let k = 0;
      this.recState.ac = ac;
      const loop = () => {
        if (!this.recState || this.recState.rec !== rec) return;
        an.getByteTimeDomainData(d); let p = 0; for (const x of d) p = Math.max(p, Math.abs(x - 128));
        bars[k % bars.length].style.transform = `scaleY(${Math.max(0.12, Math.min(1, p / 70))})`; k++;
        time.textContent = fmtClock((Date.now() - t0) / 1000);
        if (Date.now() - t0 > 5 * 60 * 1000) { this.stopRec(false); return; }
        this.recState.raf = setTimeout(loop, 90);
      };
      loop();
    } catch {}
    rec.start(250);
  }
  stopRec(cancel) {
    const st = this.recState; if (!st) return;
    this.recState = null;
    clearTimeout(st.raf);
    try { st.ac && st.ac.close(); } catch {}
    const finish = () => {
      st.stream.getTracks().forEach((x) => x.stop());
      this.rec.hidden = true; this.row.hidden = false;
      if (cancel) return;
      const dur = (Date.now() - st.t0) / 1000;
      if (dur < 0.8) { toast(t('chat.rec.short')); return; }
      const ext = /mp4/.test(st.mime) ? 'm4a' : 'webm';
      const file = new File(st.chunks, `audio-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`, { type: st.mime.split(';')[0] });
      this.sendOne({ files: [{ file, url: null }], text: '' }, this.reply, false);
      this.cancelBar();
    };
    if (st.rec.state !== 'inactive') { st.rec.onstop = finish; try { st.rec.stop(); } catch { finish(); } } else finish();
  }

  /* ── painéis: anexar, emojis, GIFs ── */
  togglePanel(kind, anchor) {
    if (this.panelKind === kind) { this.closePanels(); return; }
    this.panelKind = kind;
    this.panel.hidden = false; this.panel.className = 'cmp-panel ' + kind;
    [this.btnPlus, this.btnEmoji, this.btnGif].forEach((b) => b.setAttribute('aria-expanded', String(b === anchor)));
    if (kind === 'attach') { this.openAttach(); return; }
    else if (kind === 'emoji') this.drawEmoji();
    else this.drawGifs('');
    this.outside = (e) => { if (!this.composer.contains(e.target)) this.closePanels(); };
    setTimeout(() => document.addEventListener('pointerdown', this.outside), 0);
  }
  closePanels() {
    this.panelKind = null; if (this.panel) { this.panel.hidden = true; this.panel.replaceChildren(); }
    [this.btnPlus, this.btnEmoji, this.btnGif].forEach((b) => b && b.setAttribute('aria-expanded', 'false'));
    if (this.outside) document.removeEventListener('pointerdown', this.outside);
  }
  /** Folha de anexos (como a do app do Claude): câmera, fotos, arquivos e criar partida. */
  openAttach() {
    this.closePanels();
    const old = document.querySelector('.att-scrim'); if (old) old.remove();
    const scrim = el('div', { class: 'sk-scrim att-scrim' });
    const close = () => { scrim.classList.add('out'); setTimeout(() => scrim.remove(), 200); };
    const pick = (accept, capture) => {
      this.fileIn.accept = accept;
      if (capture) this.fileIn.setAttribute('capture', 'environment'); else this.fileIn.removeAttribute('capture');
      // o iPhone abre o menu dele ancorado no campo de arquivo: deixa o campo no pé da tela, centralizado
      this.fileIn.classList.add('file-anchor');
      setTimeout(() => this.fileIn.classList.remove('file-anchor'), 1500);
      close(); this.fileIn.click();
    };
    const row = (ic, label, run, sub) => el('button', { class: 'att-r', type: 'button', onClick: run }, icon(ic), el('span', { class: 'grow', text: label }), sub ? el('small', { text: sub }) : null);
    const media = () => pick('image/*,video/*');
    // cartão da galeria (preto, com o ícone de fotos e o selinho azul), como no app do Claude
    const gal = el('button', { class: 'att-gal', type: 'button', onClick: media },
      el('span', { class: 'att-gi', 'aria-hidden': 'true' },
        el('span', { class: 'att-gtile' }, el('i'), el('i'), el('i'), el('i'), el('i'), el('i')),
        el('span', { class: 'att-gbadge' }, icon('i-photos'))),
      el('b', { text: t('chat.att.gal.t') }),
      el('span', { class: 'att-glink', text: t('chat.att.gal.go') }));
    const sheet = el('div', { class: 'sk-sheet att-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('chat.attach') },
      el('span', { class: 'att-grab', 'aria-hidden': 'true' }),
      el('header', { class: 'att-h' }, el('button', { class: 'att-x', type: 'button', 'aria-label': t('close'), onClick: close }, icon('i-x')), el('b', { text: t('chat.attach') }),
        el('button', { class: 'att-ph', type: 'button', onClick: media, text: t('chat.att.photos') })),
      gal,
      el('div', { class: 'att-g' },
        row('i-camera', t('chat.att.cam'), () => pick('image/*,video/*', true)),
        row('c-upload', t('chat.att.files'), () => pick(''))));
    scrim.append(sheet);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
    document.body.append(scrim);
    requestAnimationFrame(() => scrim.classList.add('in'));
  }
  drawEmoji() {
    const recent = store.get('emoji.recent', []);
    const grid = el('div', { class: 'emo-grid', role: 'listbox', 'aria-label': t('chat.emoji') });
    const put = (list, title) => {
      grid.replaceChildren(el('div', { class: 'emo-h', text: title }), ...list.map((e) => el('button', { class: 'emo', type: 'button', role: 'option', text: e, onClick: () => this.insertEmoji(e) })));
      grid.scrollTop = 0;
    };
    const tabs = el('div', { class: 'emo-tabs', role: 'tablist' });
    const cats = [...(recent.length ? [{ id: 'recent', icon: '🕘', pt: 'Recentes', en: 'Recent', list: recent.join(' ') }] : []), ...EMOJI_CATS];
    const lang = getLang().startsWith('en') ? 'en' : 'pt';
    const sel = (c) => { put(c.list.split(' '), c[lang]); [...tabs.children].forEach((b) => b.setAttribute('aria-selected', String(b.dataset.id === c.id))); };
    for (const c of cats) tabs.append(el('button', { type: 'button', role: 'tab', dataset: { id: c.id }, title: c[lang], text: c.icon, onClick: () => sel(c) }));
    const q = el('input', { type: 'search', class: 'emo-q', placeholder: t('chat.emoji.search'), 'aria-label': t('chat.emoji.search') });
    q.addEventListener('input', () => { if (q.value.trim()) put(searchEmoji(q.value), t('chat.emoji.results')); else sel(cats[0]); });
    this.panel.replaceChildren(el('div', { class: 'emo' + 'pick' }, q, grid, tabs));
    sel(cats[0]);
    if (!isMobile()) setTimeout(() => q.focus(), 30);
  }
  insertEmoji(e) {
    const ta = this.ta, s = ta.selectionStart ?? ta.value.length, en = ta.selectionEnd ?? ta.value.length;
    ta.value = ta.value.slice(0, s) + e + ta.value.slice(en);
    ta.selectionStart = ta.selectionEnd = s + e.length;
    this.autosize(); this.syncSend();
    const r = store.get('emoji.recent', []).filter((x) => x !== e); r.unshift(e); store.set('emoji.recent', r.slice(0, 32));
    if (!isMobile()) ta.focus();
  }
  async drawGifs(qs) {
    const q = el('input', { type: 'search', class: 'emo-q', placeholder: t('chat.gif.search'), 'aria-label': t('chat.gif.search'), value: qs });
    const grid = el('div', { class: 'gif-grid' });
    const own = el('button', { class: 'btn sm', type: 'button', onClick: () => { this.fileIn.accept = 'image/gif,video/mp4'; this.closePanels(); this.fileIn.click(); } }, icon('c-upload'), t('chat.gif.own'));
    this.panel.replaceChildren(el('div', { class: 'gifpick' }, el('div', { class: 'gif-head' }, q), grid, el('div', { class: 'gif-foot' }, el('span', { class: 'muted', text: 'GIPHY' }), own)));
    let timer;
    const load = async () => {
      grid.replaceChildren(el('p', { class: 'gif-msg', text: t('chat.gif.loading') }));
      try {
        const j = await api('GET', `/gifs?q=${encodeURIComponent(q.value.trim())}`);
        if (!j.gifs.length) { grid.replaceChildren(el('p', { class: 'gif-msg', text: t('chat.gif.none') })); return; }
        grid.replaceChildren(...j.gifs.map((g) => el('button', { class: 'gif', type: 'button', title: g.title, onClick: () => this.sendGif(g) },
          g.mp4 ? el('video', { src: gifUrl(g.mp4), autoplay: true, loop: true, muted: true, playsinline: true, preload: 'auto' }) : el('img', { src: gifUrl(g.still), alt: g.title }))));
        grid.querySelectorAll('video').forEach((v) => { v.muted = true; v.play().catch(() => {}); });
      } catch (e) {
        grid.replaceChildren(el('p', { class: 'gif-msg', text: e.code === 'gifs_off' ? t('chat.gif.off') : t('chat.gif.err') }));
      }
    };
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 350); });
    load();
    if (!isMobile()) setTimeout(() => q.focus(), 30);
  }

  /* ── lista de mensagens ── */
  onScroll() {
    const s = this.scroll;
    const atBottom = s.scrollHeight - s.scrollTop - s.clientHeight < 80;
    this.jump.hidden = atBottom;
    if (atBottom) this.markRead();
    if (s.scrollTop < 200 && bucket(this.uid).more && !this.loadingOlder) {
      this.loadingOlder = true;
      const h = s.scrollHeight;
      loadMore(this.uid, false).then((got) => { if (got) { this.draw(); s.scrollTop += s.scrollHeight - h; } }).finally(() => { this.loadingOlder = false; });
    }
  }
  toBottom(instant) { const s = this.scroll; requestAnimationFrame(() => { s.scrollTo({ top: s.scrollHeight, behavior: instant ? 'auto' : 'smooth' }); }); }
  markRead() {
    if (!this.isActive()) return;
    const c = S.convs.get(this.uid);
    const last = bucket(this.uid).list.filter((m) => !m.pending && m.author !== D.me.id).pop();
    if (!last || (c && c.readAt >= last.at && !c.unread)) return;
    if (c) { c.readAt = last.at; c.unread = 0; emit('chat-unread'); }
    clearTimeout(this.readT);
    this.readT = setTimeout(() => api('POST', `/convs/${this.uid}/read`, { at: last.at }).catch(() => {}), 300);
  }
  draw(incoming) {
    const s = this.scroll;
    const near = s.scrollHeight - s.scrollTop - s.clientHeight < 140;
    const b = bucket(this.uid);
    const c = S.convs.get(this.uid) || {};
    const list = b.list;
    const out = [];
    this.older.replaceChildren(b.more && b.loaded ? el('span', { class: 'spin' }) : b.loaded ? el('div', { class: 'cv-start' }, avatar(userById(this.uid) || {}, 'lg'), el('b', { text: displayName(userById(this.uid)) }), el('span', { text: t('chat.start') })) : el('span', { class: 'spin' }));
    let prevDay = null, prev = null;
    const lastMine = [...list].reverse().find((m) => m.author === D.me.id && !m.pending && m.kind !== 'call');
    list.forEach((m, i) => {
      const day = new Date(m.at).toDateString();
      if (day !== prevDay) {
        const dk = 'd' + day, freshDay = !this.cache.has(dk) && m.at > this.openedAt;
        const dn = this.node(dk, `day|${fmtDay(m.at)}`, () => el('div', { class: 'cv-day' }, el('span', { text: fmtDay(m.at) })));
        if (freshDay) { dn.classList.add('m-in'); dn.addEventListener('animationend', () => dn.classList.remove('m-in'), { once: true }); }
        out.push(dn); prevDay = day; prev = null;
      }
      if (m.kind === 'call') { out.push(this.node(m.id, 'call|' + JSON.stringify(m.call) + getLang(), () => this.callRow(m))); prev = null; return; }
      const next = list[i + 1];
      const first = !prev || prev.author !== m.author || m.at - prev.at > GROUP_MS || prev.kind === 'call';
      const last = !next || next.author !== m.author || next.at - m.at > GROUP_MS || next.kind === 'call' || new Date(next.at).toDateString() !== day;
      const seen = m.author === D.me.id && (c.theirReadAt || 0) >= m.at;
      const pinned = this.isPinned(m);
      const sig = JSON.stringify([m.text, m.edited, m.reactions, m.opened, m.once, m.pending, m.failed, m.waiting, first, last, seen, pinned, (m.files || []).map((f) => f.id), getLang()]);
      const fresh = !this.cache.has(m.id) && m.at > this.openedAt && (m.author !== D.me.id || m.pending);
      const n = this.node(m.id, sig, () => this.msgRow(m, { first, last, seen, lastMine: m === lastMine }));
      if (fresh) { n.classList.add('m-in'); n.addEventListener('animationend', () => n.classList.remove('m-in'), { once: true }); }
      out.push(n);
      prev = m;
    });
    // nós que saíram da lista são esquecidos
    const keep = new Set(out.map((n) => n.dataset.key));
    for (const k of this.cache.keys()) if (!keep.has(k)) this.cache.delete(k);
    patchChildren(this.list, out);
    if (incoming || near) this.toBottom(!incoming);
    this.drawTyping();
    this.markRead();
  }
  node(key, sig, make) {
    const hit = this.cache.get(key);
    if (hit && hit.sig === sig) return hit.node;
    const n = make(); n.dataset.key = key;
    this.cache.set(key, { sig, node: n });
    return n;
  }
  drawProgress(m) {
    const n = this.cache.get(m.id); if (!n) return;
    const bar = n.node.querySelector('.up-bar i'); if (bar) bar.style.setProperty('--v', m.progress.toFixed(3));
  }
  callRow(m) {
    const cl = m.call || {};
    const missed = cl.missed;
    const txt = missed ? t('chat.call.missed', { name: nameOf(cl.caller || m.author) })
      : t('chat.call.ended', { dur: fmtDur(cl.dur || 0) }) + (cl.by ? ' · ' + t('chat.call.by', { name: nameOf(cl.by) }) : '');
    return el('div', { class: 'cv-call' + (missed ? ' missed' : '') },
      el('span', { class: 'cc-ic' }, icon('i-phone')), el('span', { text: txt }), el('time', { text: fmtTime(m.at) }),
      el('button', { class: 'cc-x', type: 'button', 'aria-label': t('chat.delete'), title: t('chat.delete'), onClick: () => this.del(m, true) }, icon('i-x')));
  }
  msgRow(m, { first, last, seen, lastMine }) {
    const mine = m.author === D.me.id;
    const row = el('div', { class: 'msg' + (mine ? ' me' : ' them') + (first ? ' first' : '') + (last ? ' last' : '') + (m.pending ? ' pending' : '') + (m.failed ? ' failed' : '') + (m.waiting ? ' waiting' : '') });
    const bubble = el('div', { class: 'bub' });
    if (m.reply) {
      bubble.append(el('button', { class: 'bub-reply', type: 'button', onClick: () => this.flash(m.reply.id) },
        el('b', { text: nameOf(m.reply.author) }), el('span', { text: m.reply.once ? t('chat.once.text') : m.reply.text || (m.reply.gif ? 'GIF' : m.reply.files ? t('chat.attachment') : '') })));
    }
    let mediaOnly = false;
    if (m.once) {
      bubble.classList.add('once');
      const kind = m.onceKind || 'text';
      const label = t('chat.once.' + kind);
      if (mine || m.opened || m.pending) {
        bubble.append(el('div', { class: 'once-pill done' }, icon('c-once'), el('span', { text: m.pending ? label : m.opened ? t('chat.once.opened') : label })));
      } else {
        bubble.append(el('button', { class: 'once-pill', type: 'button', onClick: () => this.openOnce(m) }, icon('c-once'), el('span', { text: label }), el('small', { text: t('chat.once.tap') })));
      }
    } else {
      if (m.gif) { mediaOnly = !m.text; bubble.append(this.gifEl(m.gif)); }
      for (const f of m.files || []) { const x = this.fileEl(f, m); if (/^(image|video)\//.test(f.type)) mediaOnly = !m.text; bubble.append(x); }
      if (m.text) bubble.append(this.textEl(m.text));
    }
    if (mediaOnly && !m.reply) bubble.classList.add('media');
    if (m.pending && m.files && m.files.length) bubble.append(el('div', { class: 'up-bar' }, el('i')));
    // hora (e os tiques de enviado/lido) dentro do balão, no canto, como no Telegram
    const metaBits = [];
    if (this.isPinned(m)) metaBits.push(icon('c-pin', 'ico bm-pin'));
    if (m.edited) metaBits.push(el('span', { text: t('chat.edited') }));
    metaBits.push(el('time', { text: fmtTime(m.at), title: new Date(m.at).toLocaleString(getLang()) }));
    if (mine) metaBits.push(m.failed ? el('span', { class: 'tick err', text: '!' }) : m.pending ? icon('c-clock', 'ico tick wait') : icon(seen ? 'c-seen' : 'c-sent', 'ico tick' + (seen ? ' read' : ''), seen ? t('chat.seen') : t('chat.sent')));
    const meta = el('span', { class: 'bub-meta' + (mediaOnly && !m.reply ? ' over' : '') }, ...metaBits);
    bubble.append(meta);
    const col = el('div', { class: 'msg-col' }, bubble);
    const rx = Object.entries(m.reactions || {});
    if (rx.length) col.append(el('div', { class: 'rx' }, ...rx.map(([e, us]) => el('button', { class: 'rx-chip' + (us.includes(D.me.id) ? ' mine' : ''), type: 'button', title: us.map(nameOf).join(', '), onClick: () => this.react(m, e) }, el('span', { text: e }), us.length > 1 ? el('b', { text: String(us.length) }) : null))));
    void lastMine;
    if (m.failed) col.append(el('button', { class: 'retry', type: 'button', onClick: () => m.retry && m.retry() }, t('chat.retry')));
    if (m.waiting && last) col.append(el('span', { class: 'wait-note' }, icon('c-clock'), t('chat.waiting')));
    if (!mine) row.append(last ? el('button', { class: 'av-btn', type: 'button', 'aria-label': t('chat.profile', { name: nameOf(m.author) }), onClick: () => openProfile(m.author) }, avatar(userById(m.author) || {}, 'xs', { decoration: false })) : el('span', { class: 'av-gap' }));
    if (first && !mine) row.classList.add('tail-top');
    row.append(col);
    if (!m.pending) {
      row.append(this.actionsFor(m, mine));
      this.bindTouch(row, m, mine);
    }
    return row;
  }
  textEl(text) {
    const p = el('div', { class: 'bub-text' });
    // links clicáveis (só http/https), o resto é texto puro
    const re = /\bhttps?:\/\/[^\s<>"']+/gi; let i = 0, x;
    const onlyEmoji = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️|\s){1,8}$/u.test(text) && text.trim().length <= 16;
    if (onlyEmoji) p.classList.add('big');
    while ((x = re.exec(text))) {
      if (x.index > i) p.append(document.createTextNode(text.slice(i, x.index)));
      let u = x[0].replace(/[.,;:!?)]+$/, '');
      p.append(el('a', { href: u, target: '_blank', rel: 'noopener noreferrer nofollow', text: u }));
      i = x.index + u.length; re.lastIndex = i;
    }
    if (i < text.length) p.append(document.createTextNode(text.slice(i)));
    return p;
  }
  gifEl(g) {
    const box = el('div', { class: 'gifbox' });
    box.style.aspectRatio = `${g.w} / ${g.h}`;
    if (g.mp4) { const v = el('video', { src: gifUrl(g.mp4), autoplay: true, loop: true, muted: true, playsinline: true, preload: 'auto', 'aria-label': g.title || 'GIF' }); v.muted = true; box.append(v); }
    else box.append(el('img', { src: gifUrl(g.still), alt: g.title || 'GIF', loading: 'lazy' }));
    return box;
  }
  fileEl(f, m) {
    const k = (f.type || '').split('/')[0];
    const src = f.local || (f.id ? fileUrl(f.id) : '');
    const ratio = f.w && f.h ? `${f.w} / ${f.h}` : null;
    if (k === 'image' && src && !/heic|heif/.test(f.type)) {
      const img = el('img', { src, alt: f.name, loading: 'lazy', decoding: 'async', draggable: 'false' });
      if (f.w && f.h) { img.width = f.w; img.height = f.h; }
      const b = el('button', { class: 'media-box', type: 'button', 'aria-label': f.name, onClick: () => f.id && openViewer('image', fileUrl(f.id), { name: f.name }) }, img);
      if (ratio) b.style.aspectRatio = ratio;
      return b;
    }
    if (k === 'video' && src) {
      const v = el('video', { src: src + (f.local ? '' : '#t=0.1'), preload: 'metadata', playsinline: true, muted: true });
      const b = el('button', { class: 'media-box video', type: 'button', 'aria-label': f.name, onClick: () => f.id && openViewer('video', fileUrl(f.id), { name: f.name }) }, v,
        el('span', { class: 'play' }, icon('i-play')), f.dur ? el('span', { class: 'dur', text: fmtClock(f.dur) }) : null);
      if (ratio) b.style.aspectRatio = ratio;
      return b;
    }
    if (k === 'audio' && f.id) return this.voiceEl(f, m);
    return el('a', { class: 'file-card', href: f.id ? fileUrl(f.id, true) : '#', download: f.name, rel: 'noopener' },
      el('span', { class: 'fc-ic' }, icon('c-file')), el('span', { class: 'fc-t' }, el('b', { text: f.name }), el('small', { text: fmtSize(f.size) })), icon('c-down'));
  }
  voiceEl(f) {
    const a = new Audio(); a.preload = 'none'; a.src = fileUrl(f.id);
    const btn = el('button', { class: 'vc-play', type: 'button', 'aria-label': t('chat.play') }, icon('i-play'));
    const bars = el('div', { class: 'vc-bars' });
    // forma de onda decorativa estável (a partir do id)
    let seed = 0; for (const ch of f.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    for (let i = 0; i < 32; i++) { seed = (seed * 1103515245 + 12345) >>> 0; const h = 0.25 + ((seed >>> 16) % 100) / 133; const bar = el('i'); bar.style.setProperty('--h', h.toFixed(2)); bars.append(bar); }
    const time = el('span', { class: 'vc-time', text: fmtClock(f.dur) });
    const set = () => {
      const p = a.duration ? a.currentTime / a.duration : 0;
      const k = Math.round(p * bars.children.length); [...bars.children].forEach((b, i) => b.classList.toggle('on', i < k));
      time.textContent = fmtClock(a.paused && !a.currentTime ? (f.dur || a.duration) : a.currentTime);
    };
    a.addEventListener('timeupdate', set); a.addEventListener('loadedmetadata', set);
    a.addEventListener('play', () => { btn.replaceChildren(icon('i-pause')); });
    a.addEventListener('pause', () => { btn.replaceChildren(icon('i-play')); });
    a.addEventListener('ended', () => { a.currentTime = 0; set(); });
    btn.addEventListener('click', () => { if (a.paused) { document.querySelectorAll('audio.vc-live').forEach((x) => x !== a && x.pause()); a.classList.add('vc-live'); a.play().catch(() => toast(t('chat.play.err'))); } else a.pause(); });
    bars.addEventListener('click', (e) => { if (!a.duration) return; const r = bars.getBoundingClientRect(); a.currentTime = a.duration * Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); });
    return el('div', { class: 'vmsg' }, btn, bars, time);
  }
  actionsFor(m, mine) {
    const b = (ic, label, run) => el('button', { class: 'ma-btn', type: 'button', title: label, 'aria-label': label, onClick: run }, icon(ic));
    const quick = el('div', { class: 'ma-quick' }, ...QUICK.map((e) => el('button', { type: 'button', text: e, 'aria-label': e, onClick: () => this.react(m, e) })));
    return el('div', { class: 'msg-acts' }, quick,
      b('c-reply', t('chat.reply'), () => this.startReply(m)),
      mine && m.kind === 'text' && !m.once ? b('i-pen', t('chat.edit'), () => this.startEdit(m)) : null,
      m.text && !m.once ? b('i-copy', t('chat.copy'), () => copyText(m.text).then(() => toast(t('copied')))) : null,
      !m.once ? b('c-pin', this.isPinned(m) ? t('chat.unpin') : t('chat.pin'), () => this.pin(m)) : null,
      mine ? b('i-trash', t('chat.delete'), () => this.del(m)) : null);
  }
  bindTouch(row, m, mine) {
    // segurar = opções; arrastar da esquerda para a direita = opções também (o ícone aparece e acompanha o dedo)
    let timer = null, sx = 0, sy = 0, lastTap = 0, dx = 0, mode = '';
    const col = () => row.querySelector('.msg-col');
    const hint = el('span', { class: 'swipe-hint', 'aria-hidden': 'true' }, icon('c-more'));
    row.prepend(hint);
    const reset = (anim = true) => { const c = col(); if (c) { c.style.transition = anim ? 'transform .22s cubic-bezier(.2,.8,.2,1)' : ''; c.style.transform = ''; } hint.style.opacity = '0'; hint.style.transform = ''; row.classList.remove('swiping'); };
    row.addEventListener('touchstart', (e) => {
      const p = e.touches[0]; sx = p.clientX; sy = p.clientY; dx = 0; mode = '';
      timer = setTimeout(() => { timer = null; if (mode !== 'swipe') { navigator.vibrate && navigator.vibrate(8); this.sheet(m, mine); } }, 450);
    }, { passive: true });
    row.addEventListener('touchmove', (e) => {
      const p = e.touches[0], mx = p.clientX - sx, my = p.clientY - sy;
      if (timer && Math.hypot(mx, my) > 10) { clearTimeout(timer); timer = null; }
      if (!mode) { if (Math.abs(mx) > 12 && Math.abs(mx) > Math.abs(my) * 1.4 && mx > 0) mode = 'swipe'; else if (Math.abs(my) > 10) mode = 'scroll'; }
      if (mode !== 'swipe') return;
      dx = Math.max(0, Math.min(110, mx));
      const c = col(); if (c) { c.style.transition = ''; c.style.transform = `translateX(${dx * 0.75}px)`; }
      const k = Math.min(1, dx / 70);
      hint.style.opacity = String(k); hint.style.transform = `scale(${0.6 + 0.4 * k})`;
      row.classList.add('swiping'); row.classList.toggle('armed', dx >= 70);
    }, { passive: true });
    const end = (e) => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (mode === 'swipe') { const go = dx >= 70; reset(); row.classList.remove('armed'); if (go) { navigator.vibrate && navigator.vibrate(6); this.sheet(m, mine); } mode = ''; return; }
      if (e.type === 'touchcancel') return;
      const n = Date.now();
      if (n - lastTap < 280 && !e.target.closest('a,button,video')) { this.react(m, '❤️'); lastTap = 0; } else lastTap = n;
    };
    row.addEventListener('touchend', end);
    row.addEventListener('touchcancel', end);
    row.addEventListener('contextmenu', (e) => { if (matchMedia('(pointer: coarse)').matches) e.preventDefault(); });
  }
  sheet(m, mine) {
    const scrim = el('div', { class: 'sheet-scrim' });
    const close = () => { scrim.classList.add('out'); setTimeout(() => scrim.remove(), 200); };
    scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
    const act = (ic, label, run, cls) => el('button', { class: 'sh-item ' + (cls || ''), type: 'button', onClick: () => { close(); run(); } }, icon(ic), label);
    scrim.append(el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' },
      el('div', { class: 'sh-grab' }),
      el('div', { class: 'sh-quick' }, ...QUICK.map((e) => el('button', { type: 'button', text: e, onClick: () => { close(); this.react(m, e); } }))),
      el('div', { class: 'sh-list' },
        act('c-reply', t('chat.reply'), () => this.startReply(m)),
        mine && m.kind === 'text' && !m.once ? act('i-pen', t('chat.edit'), () => this.startEdit(m)) : null,
        m.text && !m.once ? act('i-copy', t('chat.copy'), () => copyText(m.text).then(() => toast(t('copied')))) : null,
        !m.once ? act('c-pin', this.isPinned(m) ? t('chat.unpin') : t('chat.pin'), () => this.pin(m)) : null,
        mine ? act('i-trash', t('chat.delete'), () => this.del(m), 'danger') : null)));
    document.body.append(scrim);
    requestAnimationFrame(() => scrim.classList.add('in'));
  }
  flash(id) {
    const n = this.cache.get(id);
    if (!n) return;
    n.node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    n.node.classList.remove('flash'); void n.node.offsetWidth; n.node.classList.add('flash');
  }
  async react(m, e) {
    try { const j = await api('POST', `/messages/${m.id}/react`, { emoji: e }); upsert(j.message); this.draw(); } catch (x) { toast(tErr(x.code)); }
  }
  async del(m, call) {
    if (!(await confirmBox(t('chat.delete'), call ? t('chat.delete.call') : t('chat.delete.q'), t('chat.delete')))) return;
    try { await api('DELETE', `/messages/${m.id}`); onChatEvent({ t: 'msg-del', id: m.id, conv: m.conv }); } catch (x) { toast(tErr(x.code)); }
  }
  async openOnce(m) {
    unlockAudio();
    try {
      const j = await api('POST', `/messages/${m.id}/open`);
      upsert(j.message); this.draw();
      const c = j.content;
      if (c.files && c.files[0]) {
        const f = c.files[0], k = f.type.split('/')[0];
        if (k === 'image' || k === 'video') openViewer(k, fileUrl(f.id), { once: true, name: f.name });
        else if (k === 'audio') openViewer('video', fileUrl(f.id), { once: true, name: f.name });
        else { const a = el('a', { href: fileUrl(f.id, true), download: f.name }); document.body.append(a); a.click(); a.remove(); }
      } else if (c.gif) openViewer('image', gifUrl(c.gif.still || c.gif.mp4), { once: true });
      else openViewer('text', '', { once: true, text: c.text });
    } catch (e) { toast(e.code === 'gone' ? t('chat.once.gone') : tErr(e.code)); }
  }
}

/* ───────────── montagem ───────────── */
const mounted = new WeakMap();
/** Desenha a conversa com uid dentro de container (reaproveita se já for a mesma). */
export function mountChat(container, uid, opts = {}) {
  const cur = mounted.get(container);
  if (cur && cur.uid === uid && container.contains(cur.list)) { cur.drawHeader(); cur.markRead(); return cur; }
  if (cur) cur.destroy();
  const v = new ChatView(container, uid, opts);
  mounted.set(container, v);
  return v;
}
export function unmountChat(container) { const cur = mounted.get(container); if (cur) { cur.destroy(); mounted.delete(container); } }
export function initChat({ events, go, callFriend, room }) {
  S.events = events; S.go = go; S.callFriend = callFriend; S.room = room || (() => null);
  setProfileHooks({ go, callFriend });
  document.addEventListener('visibilitychange', () => { for (const v of S.views) v.markRead(); });
  on('users', () => { for (const v of S.views) v.drawHeader(); });
}
export function resetChat() { S.convs.clear(); S.msgs.clear(); for (const v of [...S.views]) v.destroy(); }
