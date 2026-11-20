'use strict';
// Estado compartilhado + configurações salvas neste aparelho.
import { store } from './util.js';

export const D = {
  me: null,
  friends: [], incoming: [], outgoing: [], servers: [],
  users: new Map(),          // id → usuário (cache de quem já apareceu)
  view: { name: 'home' },    // home | friends | servers | server | room
  eventsUp: false,
};

export const DEF = {
  micId: '', spkId: '',
  inputMode: 'voice',          // voice | ptt | ptm
  key: 'KeyV', release: 250,
  audioMode: 'isolation',      // (antigo) isolation | studio | custom
  nsMode: 'auto',              // auto | strong | light | off  (tirar ruído)
  ec: true, ns: true, agc: true, hpf: true, gate: -55, micGain: 1,
  volVoice: 1, volScreen: 1, autoMix: true, micVol: 1,
  codec: 'h264', stats: false,
  theme: 'noite',
  share: { surface: 'monitor', preset: 'filme', audio: true, audioKbps: 256 },
};
const saved = store.get('cfg', {});
export const CFG = { ...DEF, ...saved, share: { ...DEF.share, ...(saved.share || {}) } };
// quem usava "estúdio" (sem filtro) continua sem filtro
if (!saved.nsMode && saved.audioMode === 'studio') CFG.nsMode = 'off';
export function saveCfg() { store.set('cfg', CFG); }

/* mini barramento de eventos */
const L = new Map();
export function on(evt, fn) { if (!L.has(evt)) L.set(evt, new Set()); L.get(evt).add(fn); return () => L.get(evt).delete(fn); }
export function emit(evt, data) { (L.get(evt) || []).forEach((f) => { try { f(data); } catch (e) { console.error(e); } }); }

// Cada pessoa tem UM objeto só (atualizado no lugar), assim listas e telas nunca ficam com cópia velha.
export function remember(u) {
  if (!u || !u.id) return u;
  const cur = D.users.get(u.id);
  if (cur) { Object.assign(cur, u); return cur; }
  D.users.set(u.id, u);
  return u;
}
export function ingest() {
  if (D.me) remember(D.me);
  D.friends.forEach(remember);
  D.incoming.forEach((r) => remember(r.from));
  D.outgoing.forEach((r) => remember(r.to));
  D.servers.forEach((s) => (s.members || []).forEach(remember));
}
export const userById = (id) => D.users.get(id) || null;
export const isFriend = (id) => D.friends.some((f) => f.id === id);
export function serverById(id) { return D.servers.find((s) => s.id === id) || null; }
export function channelInfo(room) {
  if (!room || !room.startsWith('c:')) return null;
  const cid = room.slice(2);
  for (const s of D.servers) { const c = (s.channels || []).find((x) => x.id === cid); if (c) return { server: s, channel: c }; }
  return null;
}
export const dmRoom = (a, b) => 'd:' + [a, b].sort().join(':');
