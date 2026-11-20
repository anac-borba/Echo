'use strict';
// Toque de chamada.
//  - Quem recebe: tela de chamada (foto, nome, Recusar / Atender) e o toque repetindo até atender, recusar,
//    a outra pessoa desistir ou passar 45 s.
//  - Quem liga: um "chamando…" baixinho até a outra pessoa entrar; se ninguém atender em 45 s, a ligação encerra.
import { localNotify } from './notify.js';
import { el, icon, avatar, displayName, toast } from './util.js';
import { D, userById, on, emit, dmRoom } from './state.js';
import { t } from './i18n.js';
import { uiSound, unlockAudio } from './sfx.js';
import { currentRoom, callInfo, leaveRoom } from './call.js';

const RING_MS = 45000;
let send = () => {};
let inc = null;   // { from, room, timer, loop, node }
let out = null;   // { to, room, timer, loop }

export function initRinger(sendFn) {
  send = sendFn;
  on('ring-stop', (m) => { if (inc && (!m || !m.from || m.from === inc.from)) stopIncoming(m && m.answered ? 'answered' : 'stop'); });
  on('users', checkPresence);
  on('call', checkOutgoing);
  on('call-left', () => stopOutgoing());
  // iPhone só toca som depois de um toque na página: destrava no primeiro toque
  const unlock = () => { unlockAudio(); removeEventListener('pointerdown', unlock, true); };
  addEventListener('pointerdown', unlock, true);
}

const redraw = () => import('./ui.js').then((ui) => ui.renderSoft()).catch(() => {});

/* ───────────── recebendo ───────────── */
export function onRing(m) {
  if (!m || !m.from || !m.room) return;
  if (currentRoom() === m.room) return;                 // já estou nessa ligação
  if (inc && inc.from === m.from) return;               // já está tocando
  if (inc) stopIncoming('stop');
  const u = userById(m.from) || { id: m.from, username: '…' };
  D.ringing = { from: m.from, room: m.room, at: Date.now() };
  const node = el('div', { class: 'inc', role: 'alertdialog', 'aria-modal': 'false', 'aria-label': t('ring', { name: displayName(u) }) },
    el('div', { class: 'inc-card' },
      el('div', { class: 'inc-av' }, el('span', { class: 'inc-pulse' }), el('span', { class: 'inc-pulse d2' }), avatar(u, 'xl')),
      el('div', { class: 'inc-txt' }, el('b', { text: displayName(u) }), el('small', { text: t('call.incoming') })),
      el('div', { class: 'inc-btns' },
        el('button', { class: 'inc-b no', type: 'button', onClick: () => decline() }, el('span', { class: 'inc-ic' }, icon('r-end')), el('span', { text: t('call.decline') })),
        el('button', { class: 'inc-b yes', type: 'button', onClick: () => answer() }, el('span', { class: 'inc-ic' }, icon('i-phone')), el('span', { text: t('call.answer') })))));
  document.body.append(node);
  // mede o estado inicial antes de ligar 'on' (senão o navegador pula direto para o fim, sem transição)
  void node.offsetWidth; requestAnimationFrame(() => node.classList.add('on'));
  const play = () => { uiSound('ringtone'); try { navigator.vibrate && navigator.vibrate([400, 200, 400]); } catch {} };
  play();
  const sys = localNotify({ title: displayName(u), body: t('call.incoming'), tag: 'ring', call: true });
  inc = { from: m.from, room: m.room, node, sys, loop: setInterval(play, 3000), timer: setTimeout(() => missed(), RING_MS) };
  redraw();
}
function answer() {
  if (!inc) return;
  const { from, room } = inc;
  stopIncoming('answered');
  import('./ui.js').then((ui) => ui.callRoom(room)).catch(() => {});
  void from;
}
function decline() {
  if (!inc) return;
  send({ t: 'ring-off', to: inc.from, room: inc.room, why: 'declined' });
  stopIncoming('declined');
}
function missed() {
  if (!inc) return;
  const u = userById(inc.from);
  stopIncoming('missed');
  toast(t('call.missed', { name: displayName(u || {}) }), { ms: 6000 });
}
function stopIncoming() {
  if (!inc) return;
  clearInterval(inc.loop); clearTimeout(inc.timer);
  try { inc.sys && inc.sys.close(); } catch {}
  const n = inc.node; n.classList.remove('on'); setTimeout(() => n.remove(), 260);
  try { navigator.vibrate && navigator.vibrate(0); } catch {}
  inc = null; D.ringing = null;
  redraw();
}
/** A pessoa que ligou saiu da sala (desistiu) → para de tocar. */
function checkPresence() {
  if (!inc) return;
  const u = userById(inc.from);
  if (!u || u.inRoom === inc.room) return;
  const age = Date.now() - D.ringing.at;
  // logo no começo a presença ainda pode não ter chegado: olha de novo depois, em vez de ignorar para sempre
  if (age > 2500) missed(); else setTimeout(checkPresence, 2600 - age);
}

/* ───────────── ligando ───────────── */
export function startOutgoing(to, room) {
  stopOutgoing();
  const u = userById(to);
  if (u && u.inRoom === room) return;                    // já está lá esperando
  const play = () => { if (!callInfo().peerPresent && currentRoom() === room) uiSound('ringback'); };
  out = { to, room, loop: setInterval(play, 3000), timer: setTimeout(() => { if (out && !callInfo().peerPresent) { emit('call-failed', { to, why: 'noanswer' }); stopOutgoing(); leaveRoom(); } }, RING_MS) };
  setTimeout(play, 600);
}
function stopOutgoing() { if (!out) return; clearInterval(out.loop); clearTimeout(out.timer); out = null; }
function checkOutgoing() {
  if (!out) return;
  if (callInfo().peerPresent) return stopOutgoing();
  // quem ligou desistiu (saiu da sala antes de atenderem): avisa a outra pessoa para parar de tocar
  if (currentRoom() !== out.room) { send({ t: 'ring-off', to: out.to, room: out.room, why: 'cancel' }); stopOutgoing(); }
}
/** A outra pessoa recusou. */
export function onRingOff(m) {
  if (m && m.why === 'declined' && out && m.from === out.to) {
    const u = userById(out.to);
    stopOutgoing();
    emit('call-failed', { to: u ? u.id : m.from, why: 'declined' });
    leaveRoom();
  } else if (m && m.why === 'cancel' && inc && m.from === inc.from) missed();
}
export { dmRoom };
