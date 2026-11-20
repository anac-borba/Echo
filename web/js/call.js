'use strict';
// Motor de chamada: WebRTC (voz + transmissão de tela), PiP, estatísticas e a interface da sala.
// A voz e a tela vão direto de um aparelho ao outro; o servidor só apresenta os dois.
import { $, el, icon, setIcon, toast, avatar, displayName, sleep } from './util.js';
import { mixerAttach, mixerSet, mixerUnlock, mixerDetach, mixerActive, mixerRecommend, onMixer, MIXER_SUPPORTED } from './mixer.js';
import { D, CFG, saveCfg, userById, remember, emit, on, channelInfo } from './state.js';
import { api } from './api.js';
import { t, onLang } from './i18n.js';
import './call-i18n.js';
import { openMic, startMeter, onChainBroken, onDtlnSlow, setMicVolume } from './audio.js';
import { openModal, closeModal } from './modal.js';
import { ACTIVITIES_ENABLED, WATCH_ENABLED } from './flags.js';
import { createAudioPopover, refreshDevices, onDevices, currentInputName, currentOutputName, IOS } from './call-pop.js';
import { openShareUi, qualityLine } from './call-share.js';
import { uiSound, playEffect, isEffect, unlockAudio, preloadEffects } from './sfx.js';
import { initFt, syncFt } from './ft.js';

export const PRESETS = {
  leve:    { w: 1280, h: 720,  fps: 30, kbps: 4000,  hint: 'motion', degr: 'maintain-framerate' },
  filme:   { w: 1920, h: 1080, fps: 30, kbps: 12000, hint: 'motion', degr: 'maintain-resolution' },
  jogo:    { w: 1920, h: 1080, fps: 60, kbps: 20000, hint: 'motion', degr: 'maintain-framerate' },
  qhd:     { w: 2560, h: 1440, fps: 60, kbps: 32000, hint: 'motion', degr: 'maintain-framerate' },
  uhd:     { w: 3840, h: 2160, fps: 60, kbps: 50000, hint: 'motion', degr: 'maintain-resolution' },
  nitidez: { w: 2560, h: 1440, fps: 15, kbps: 10000, hint: 'detail', degr: 'maintain-resolution' },
};
export const SURFACES = ['monitor', 'window', 'browser'];
const META_SURFACES = ['monitor', 'window', 'browser', 'file'];

const C = {
  room: null, label: '', sub: '',
  signal: null, joined: false, polite: false, pc: null, dc: null, makingOffer: false, ignoreOffer: false,
  ice: [{ urls: ['stun:stun.cloudflare.com:3478'] }],
  ac: null, mic: null, micSender: null, muted: false, deaf: false, held: false, pttTimer: null,
  peerId: null, peerPresent: false, peerFlags: { muted: false, deaf: false },
  peerMeta: { screenId: null, sharing: false, surface: null }, remoteScreen: null, screen: null,
  speak: { me: false, her: false }, meters: {}, wake: null, statsTimer: null, prevStats: new Map(),
  path: '', pathKind: '', rtt: null, statsText: '', events: null, t0: null, tick: null, stat: {},
};
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__echoCall = C;   // só para testes locais
onChainBroken(() => { if (C.room) swapMic(); });
onDtlnSlow(() => toast(t('ns.slow'), { ms: 6000 }));
const els = {};
let pop = null;

export const inCall = () => !!C.room;
/** Envia uma mensagem para a outra pessoa pelo canal de atividades (cifrado, direto). */
export function sendAct(obj) { if (C.act && C.act.readyState === 'open') { C.act.send(JSON.stringify(obj)); return true; } return false; }
export const actReady = () => !!(C.act && C.act.readyState === 'open');
export function peerInfo() { return { id: C.peerId, user: peerUser(), present: C.peerPresent, sharing: !!C.screen, watching: !!C.peerMeta.sharing }; }
let activityOn = false;
export function setActivityMode(on) { activityOn = !!on; renderMode(); }
/** Manda um efeito sonoro para a outra pessoa (pelo canal de dados direto). */
export function sendSfx(id) { if (C.dc && C.dc.readyState === 'open') { C.dc.send(JSON.stringify({ v: 1, sfx: id })); return true; } return false; }
export const peerPresent = () => !!C.peerPresent;
export const isDirectRoom = () => !!(C.room && C.room.startsWith('d:'));
export const currentRoom = () => C.room;
export const callInfo = () => ({ room: C.room, label: C.label, sub: C.sub, peerPresent: C.peerPresent, peerId: C.peerId, sharing: !!C.screen, watching: !!C.remoteScreen, muted: C.muted, deaf: C.deaf, t0: C.t0 });

/* ───────────── SDP ───────────── */
function tuneSdp(sdp) {
  const lines = sdp.split('\r\n');
  const setFmtp = (pt, want) => {
    const head = `a=fmtp:${pt} `;
    const i = lines.findIndex((l) => l.startsWith(head));
    if (i >= 0) {
      const cur = Object.fromEntries(lines[i].slice(head.length).split(';').filter(Boolean).map((kv) => { const [k, ...v] = kv.split('='); return [k, v.length ? v.join('=') : undefined]; }));
      Object.assign(cur, want);
      lines[i] = head + Object.entries(cur).map(([k, v]) => (v === undefined ? k : `${k}=${v}`)).join(';');
    } else {
      const r = lines.findIndex((l) => l.startsWith(`a=rtpmap:${pt} `));
      if (r >= 0) lines.splice(r + 1, 0, head + Object.entries(want).map(([k, v]) => `${k}=${v}`).join(';'));
    }
  };
  for (const l of lines.slice()) {
    let m = /^a=rtpmap:(\d+) opus\/48000\/2/.exec(l);
    if (m) { setFmtp(m[1], { minptime: '10', useinbandfec: '1', usedtx: '0', stereo: '1', 'sprop-stereo': '1', maxaveragebitrate: '510000', maxplaybackrate: '48000' }); continue; }
    m = /^a=rtpmap:(\d+) (H264|VP8|VP9|AV1)\/90000/i.exec(l);
    // Dá partida alta e teto alto para o vídeo subir logo (a internet boa não precisa esperar a rampa).
    if (m) setFmtp(m[1], { 'x-google-start-bitrate': '15000', 'x-google-max-bitrate': '60000' });
  }
  return lines.join('\r\n');
}

/* ───────────── sinalização ───────────── */
class Signal {
  constructor(room, h) { this.room = room; this.h = h; this.closed = false; this.fails = 0; this.gotHello = false; this.q = Promise.resolve(); this.connect(); }
  connect() {
    if (this.closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // reconexão automática avisa "resume": se a ligação já continuou em outra janela/aparelho, o servidor recusa em vez de tomar a vez dela
    const ws = new WebSocket(`${proto}://${location.host}/ws?room=${encodeURIComponent(this.room)}${this.everOpen ? '&resume=1' : ''}`);
    this.ws = ws; this.gotHello = false;
    ws.addEventListener('open', () => { this.everOpen = true; });
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } this.q = this.q.then(() => this.handle(m)).catch((x) => console.warn(x)); };
    ws.onclose = (e) => {
      if (this.closed || ws !== this.ws) return;
      if (e.code === 4000) { this.closed = true; this.h.taken(); return; }
      this.h.down(this.gotHello);
      this.fails = this.gotHello ? 0 : this.fails + 1;
      if (this.fails >= 4) { this.closed = true; this.h.refused(); return; }
      setTimeout(() => this.connect(), Math.min(1000 * 2 ** this.fails, 8000));
    };
    ws.onerror = () => {};
  }
  async handle(m) {
    if (m.t === 'hello') { this.gotHello = true; await this.h.hello(m); }
    else if (m.t === 'join') await this.h.join(m);
    else if (m.t === 'leave') await this.h.leave(m);
    else if (m.t === 'bye') await this.h.bye(m);
    else if (m.t === 'r' && typeof m.d === 'string') { let o; try { o = JSON.parse(m.d); } catch { return; } if (o && typeof o === 'object') await this.h.msg(o); }
  }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  /** "Desliguei": avisa a sala (que encerra para as duas e registra a chamada) e fecha. */
  bye() { try { if (this.ws && this.ws.readyState === 1) this.ws.send('{"bye":1}'); } catch {} this.close(); }
  close() { this.closed = true; try { this.ws.close(); } catch {} }
}

/* ───────────── entrar / sair ───────────── */
export async function joinRoom(room) {
  if (C.room === room) return;
  if (C.room) await leaveRoom(true);
  C.room = room;
  const ci = channelInfo(room);
  if (ci) { C.label = ci.channel.name; C.sub = ci.server.name; C.subKey = null; }
  else if (room.startsWith('d:')) {
    const other = room.split(':').slice(1).find((x) => x !== D.me.id);
    C.peerHint = other; C.label = displayName(userById(other)); C.sub = t('room.private'); C.subKey = 'room.private';
  }
  try {
    // 48 kHz fixos: a rede de ruído (DTLN) trabalha nessa taxa; o navegador converte para o fone/caixa
    if (!C.ac) { const AC = window.AudioContext || window.webkitAudioContext; try { C.ac = new AC({ sampleRate: 48000, latencyHint: 'interactive' }); } catch { C.ac = new AC(); } }
    C.ac.resume && C.ac.resume();
    els.remoteMic.muted = false;
    els.remoteMic.play && els.remoteMic.play().catch(() => {});
  } catch {}
  try { navigator.audioSession && (navigator.audioSession.type = 'play-and-record'); } catch {}
  C.muted = false; C.deaf = false; C.held = false; C.t0 = null; C.stat = {};
  startTick();
  renderHeader(); renderPeople(); renderMode(); renderDock();
  setConn('wait', t('conn.connecting'));
  await startMic();
  refreshDevices(false);
  C.events && C.events.send({ t: 'room', room });
  connectSignal();
  emit('call', callInfo());
}

export async function leaveRoom(silent, { bye = true } = {}) {
  if (!C.room) return;
  const was = C.room;
  // fim de uma ligação que chegou a conectar: a tela mostra "Encerrada · 42 min" por um instante
  if (C.t0 && C.peerId && !silent) emit('call-ended', { peerId: C.peerId, room: was, ms: Date.now() - C.t0 });
  stopShare(false);
  pop && pop.close();
  mixerDetach(); closeMixPop();
  if (C.signal) { if (bye) C.signal.bye(); else C.signal.close(); } C.signal = null;
  destroyPeer();
  stopMic(); C.micReleased = false; clearTimeout(C.releaseT);
  C.events && C.events.send({ t: 'room', room: null });
  setMicVolume({ peer: 1 });
  C.room = null; C.joined = false; C.peerId = null; C.peerPresent = false; C.peerFlags = { muted: false, deaf: false };
  C.peerMeta = { screenId: null, sharing: false, surface: null }; C.remoteScreen = null; C.peerHint = null; C.t0 = null;
  stopTick();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  emit('call-left', { room: was });
  keepAwake(false);
  renderMode();
  if (!silent) emit('call', callInfo());
}

function connectSignal() {
  C.signal = new Signal(C.room, {
    async hello(m) {
      C.joined = true; C.polite = !!m.polite;
      await fetchIce();
      const others = Array.isArray(m.others) ? m.others : [];
      if (others.length) { setPeer(others[0]); startPeer(); } else { C.peerPresent = false; renderPeople(); setConn('wait', t('conn.waiting')); }
    },
    async join(m) { uiSound('join'); setPeer(m.uid); setConn('wait', t('conn.connecting')); startPeer(); if (!userById(m.uid)) toast(t('call.arrived')); },
    async leave() { uiSound('leave'); toast(t('call.dropped', { name: peerName() })); resetPeer(); setConn('wait', t('conn.peerdrop')); },
    // A outra pessoa apertou "desligar": a ligação acaba aqui também (como telefone).
    async bye() { const n = peerName(); uiSound('end'); toast(t('call.hungup', { name: n })); await leaveRoom(false, { bye: false }); },
    msg: onSignalMsg,
    down(had) { resetPeer(); setConn('bad', had ? t('conn.reconnecting') : t('conn.noserver')); },
    refused() { toast(t('call.refused'), { ms: 6000 }); leaveRoom(false, { bye: false }); },
    taken() { toast(t('call.taken'), { ms: 6000 }); leaveRoom(false, { bye: false }); },
  });
}

async function fetchIce() {
  try {
    const j = await api('GET', `/ice?room=${encodeURIComponent(C.room)}`);
    if (j && Array.isArray(j.iceServers) && j.iceServers.length) C.ice = j.iceServers;
  } catch {}
}

function setPeer(uid) {
  C.peerId = uid; C.peerPresent = true;
  if (uid && !userById(uid)) api('GET', `/users/${encodeURIComponent(uid)}`).then((j) => { remember(j.user || j); renderPeople(); renderHeader(); }).catch(() => {});
  renderPeople(); renderHeader();
}
function resetPeer() {
  destroyPeer();
  C.peerPresent = false; C.peerFlags = { muted: false, deaf: false }; C.peerMeta = { screenId: null, sharing: false, surface: null };
  C.speak.her = false; C.stat = {}; C.t0 = null;
  renderPeople(); renderMode(); emit('call', callInfo());
}
const peerUser = () => userById(C.peerId) || userById(C.peerHint) || null;
const peerName = () => { const u = peerUser(); return u ? displayName(u) : t('call.other'); };

/* ───────────── WebRTC ───────────── */
function startPeer() {
  destroyPeer();
  const pc = new RTCPeerConnection({ iceServers: C.ice, bundlePolicy: 'max-bundle' });
  C.pc = pc; C.makingOffer = false; C.ignoreOffer = false;
  const dc = pc.createDataChannel('meta', { negotiated: true, id: 0 });
  C.dc = dc;
  const act = pc.createDataChannel('act', { negotiated: true, id: 1 });
  C.act = act;
  act.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (m && typeof m === 'object') emit('act-msg', m); };
  act.onopen = () => emit('act-open');
  dc.onopen = () => { sendFlags(); sendWantVol(); };
  dc.onmessage = (e) => onFlags(e.data);
  pc.onicecandidate = ({ candidate }) => { if (candidate) C.signal && C.signal.send({ k: 'c', c: candidate.toJSON() }); };
  pc.onnegotiationneeded = negotiate;
  pc.ontrack = onTrack;
  pc.onconnectionstatechange = onConnState;
  pc.oniceconnectionstatechange = () => { if (pc.iceConnectionState === 'failed') { try { pc.restartIce(); } catch {} } };
  sendMeta();
  if (C.mic) {
    C.micSender = pc.addTrack(C.mic.track, C.mic.stream);
    setSenderParams(C.micSender, { enc: { maxBitrate: CFG.nsMode === 'off' ? 128000 : 96000, priority: 'high', networkPriority: 'high' } });
  }
  if (C.screen) addScreenToPc();
  clearInterval(C.statsTimer);
  C.statsTimer = setInterval(pollStats, 2000);
}

function destroyPeer() {
  clearInterval(C.statsTimer); C.statsTimer = null;
  if (C.dc) { try { C.dc.close(); } catch {} }
  if (C.act) { try { C.act.close(); } catch {} C.act = null; }
  if (C.pc) {
    C.pc.onconnectionstatechange = null; C.pc.ontrack = null; C.pc.onnegotiationneeded = null; C.pc.onicecandidate = null;
    try { C.pc.close(); } catch {}
  }
  C.pc = null; C.dc = null; C.micSender = null; C.remoteScreen = null;
  if (C.screen) { C.screen.vSender = null; C.screen.aSender = null; }
  if (C.meters.her) { C.meters.her(); C.meters.her = null; }
  if (els.remoteMic) els.remoteMic.srcObject = null;
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
  if (els.video) els.video.srcObject = null;
  C.prevStats.clear();
}

async function negotiate() {
  const pc = C.pc;
  if (!pc) return;
  try {
    C.makingOffer = true;
    const offer = await pc.createOffer();
    if (pc.signalingState !== 'stable') return;
    offer.sdp = tuneSdp(offer.sdp);
    await pc.setLocalDescription(offer);
    C.signal && C.signal.send({ k: 'd', d: { type: offer.type, sdp: offer.sdp } });
  } catch (e) { if (e && e.name !== 'InvalidStateError') console.warn('negociação', e); } finally { C.makingOffer = false; }
}

async function onSignalMsg(o) {
  if (o.k === 'm') {
    C.peerMeta = { screenId: o.screenId || null, sharing: !!o.sharing, surface: META_SURFACES.includes(o.surface) ? o.surface : null };
    if (!C.peerMeta.sharing) {
      C.remoteScreen = null; els.video.srcObject = null;
      if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    } else if (C.peerMeta.screenId && els.remoteMic.srcObject && els.remoteMic.srcObject.id === C.peerMeta.screenId) {
      // O som da tela chegou antes deste aviso e foi parar no lugar da voz: devolve cada um ao seu lugar.
      const sc = els.remoteMic.srcObject; els.remoteMic.srcObject = C.lastMic || null;
      if (C.lastMic) els.remoteMic.play().catch(() => {});
      showScreen(sc);
    }
    renderMode(); emit('call', callInfo());
    return;
  }
  const pc = C.pc;
  if (!pc) return;
  try {
    if (o.k === 'd' && o.d && (o.d.type === 'offer' || o.d.type === 'answer') && typeof o.d.sdp === 'string') {
      const collision = o.d.type === 'offer' && (C.makingOffer || pc.signalingState !== 'stable');
      C.ignoreOffer = !C.polite && collision;
      if (C.ignoreOffer) return;
      await pc.setRemoteDescription({ type: o.d.type, sdp: o.d.sdp });
      if (o.d.type === 'offer') {
        const ans = await pc.createAnswer();
        ans.sdp = tuneSdp(ans.sdp);
        await pc.setLocalDescription(ans);
        C.signal && C.signal.send({ k: 'd', d: { type: 'answer', sdp: ans.sdp } });
      }
    } else if (o.k === 'c' && o.c) {
      try { await pc.addIceCandidate(o.c); } catch (e) { if (!C.ignoreOffer) console.warn('ice', e); }
    }
  } catch (e) { console.warn('sinal', e); }
}

function sendMeta() { C.signal && C.signal.send({ k: 'm', screenId: C.screen ? C.screen.stream.id : null, sharing: !!C.screen, surface: C.screen ? C.screen.surface : null }); }

function onTrack(e) {
  const stream = e.streams[0] || new MediaStream([e.track]);
  const isScreen = e.track.kind === 'video' || stream.getVideoTracks().length > 0 || (C.peerMeta.screenId && stream.id === C.peerMeta.screenId)
    || (C.remoteScreen && stream.id === C.remoteScreen.id);
  if (isScreen) showScreen(stream); else attachMic(stream);
}
function attachMic(stream) {
  if (!C.peerMeta.screenId || stream.id !== C.peerMeta.screenId) C.lastMic = stream;
  els.remoteMic.srcObject = stream;
  els.remoteMic.volume = CFG.volVoice;
  els.remoteMic.muted = C.deaf;
  els.remoteMic.play().catch(() => toast(t('call.tap')));
  mixerAttach({ voiceEl: els.remoteMic, voiceStream: stream });
  if (C.meters.her) C.meters.her();
  C.meters.her = startMeter(C.ac, stream, (lv) => setSpeaking('her', lv > 0.035));
}
function showScreen(stream) {
  C.remoteScreen = stream;
  if (els.video.srcObject !== stream) els.video.srcObject = stream;
  els.video.volume = CFG.volScreen; els.video.muted = C.deaf;
  els.video.autoPictureInPicture = true;
  els.video.play().then(() => { els.btnUnmuteVideo.hidden = true; mixerAttach({ filmEl: els.video, filmStream: stream }); }).catch(() => {
    els.video.muted = true; els.video.play().catch(() => {}); els.btnUnmuteVideo.hidden = mixerActive();
    mixerAttach({ filmEl: els.video, filmStream: stream });
  });
  renderMode(); emit('call', callInfo());
  try { if (!localStorage.getItem('echo.mixhint')) { localStorage.setItem('echo.mixhint', '1'); setTimeout(() => toast(t('mix.hint'), { ms: 5000 }), 1500); } } catch {}
}
function onConnState() {
  const pc = C.pc;
  if (!pc) return;
  const st = pc.connectionState;
  if (st === 'connected') { if (!C.t0) { C.t0 = Date.now(); preloadEffects(); } setConn('ok', t('conn.ok')); renderHeader(); pollStats(); }
  else if (st === 'connecting' || st === 'new') setConn('wait', t('conn.connecting'));
  else if (st === 'disconnected') setConn('bad', t('conn.unstable'));
  else if (st === 'failed') { setConn('bad', t('conn.failed')); try { pc.restartIce(); } catch {} }
}
async function setSenderParams(sender, patch, tries = 8) {
  for (let i = 0; i < tries; i++) {
    try {
      const p = sender.getParameters();
      if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      Object.assign(p.encodings[0], patch.enc || {});
      if (patch.degr) p.degradationPreference = patch.degr;
      await sender.setParameters(p);
      return true;
    } catch { await sleep(450); }
  }
  return false;
}

/* ───────────── sinais do canal de dados (mudo, surdo) ───────────── */
/** No iPhone o volume do elemento é só leitura e o mixer não roda: o volume da "Voz" vira um pedido para quem fala. */
function sendWantVol() {
  if (mixerActive() || volSettable) return;
  if (C.dc && C.dc.readyState === 'open') C.dc.send(JSON.stringify({ v: 1, vol: Math.min(1.5, Math.max(0, Number(CFG.volVoice) || 0)) }));
}
function sendFlags() { if (C.dc && C.dc.readyState === 'open') C.dc.send(JSON.stringify({ v: 1, muted: C.muted || !micOpen(), deaf: C.deaf })); }
const sfxIn = [];
function onFlags(str) {
  let m; try { m = JSON.parse(str); } catch { return; }
  if (!m || typeof m !== 'object') return;
  if (typeof m.sfx === 'string') {
    // efeito sonoro da outra pessoa (com freio: no máximo 6 a cada 5 s)
    const n = Date.now(); while (sfxIn.length && n - sfxIn[0] > 5000) sfxIn.shift();
    if (sfxIn.length < 6 && isEffect(m.sfx)) { sfxIn.push(n); emit('sfx-remote', m.sfx); }
    return;
  }
  // a outra pessoa não consegue baixar a sua voz no aparelho dela (iPhone): pede, e o seu microfone sai mais baixo só para ela
  if (typeof m.vol === 'number' && Number.isFinite(m.vol)) { setMicVolume({ peer: m.vol }); if (m.muted === undefined) return; }
  C.peerFlags = { muted: !!m.muted, deaf: !!m.deaf };
  renderPeople();
}

/* ───────────── microfone ───────────── */
const rawTrack = (mic) => (mic && ((mic.raw && mic.raw.getAudioTracks()[0]) || mic.track)) || null;
/** Se o aparelho em uso some (fone desplugado), cai para o padrão sem derrubar a chamada. */
function watchEnded(mic) {
  const tr = rawTrack(mic);
  if (!tr) return;
  tr.addEventListener('ended', () => { if (C.mic === mic && C.room) swapMic(); });
  // iPhone: ao sair do app o sistema pausa o microfone (a faixa fica "muted"); na volta ela às vezes não retoma sozinha
  tr.addEventListener('unmute', () => { if (C.mic === mic) renderDevCard(); });
}
/** Ao voltar para o app: se o microfone foi pausado ou encerrado pelo sistema, abre de novo (sem a pessoa perceber). */
let reviving = false;
async function reviveMic() {
  const tr = rawTrack(C.mic);
  if (reviving || !C.room) return;
  if (!C.mic) { reviving = true; try { await swapMic(); } finally { reviving = false; } return; }
  if (tr && tr.readyState === 'live' && !tr.muted) return;
  reviving = true;
  try { await swapMic(); } finally { reviving = false; }
}
async function startMic() {
  try {
    C.mic = await openMic(C.ac);
    C.mic.track.contentHint = 'speech';
    if (C.meters.me) C.meters.me();
    C.meters.me = startMeter(C.ac, C.mic.stream, (lv) => setSpeaking('me', lv > 0.035 && C.mic && C.mic.track.enabled));
    watchEnded(C.mic);
    watchBusy(C.mic);
    applyMic();
    populateDevicesSoon();
  } catch (e) {
    console.warn(e); C.mic = null;
    toast(t('mic.denied'), { ms: 6500 });
  }
}
/** Solta o microfone sem sair da ligação (a faixa enviada fica vazia até voltar). */
function releaseMic() {
  if (!C.mic) return;
  try { C.micSender && C.micSender.replaceTrack(null); } catch {}
  stopMic();
  C.micReleased = true;
}
/** Microfone aberto mas calado pelo sistema (outro app/navegador está com ele): avisa e tenta de novo. */
function watchBusy(mic) {
  clearInterval(C.busyT);
  let n = 0, warned = false;
  C.busyT = setInterval(() => {
    if (C.mic !== mic || !C.room) { clearInterval(C.busyT); return; }
    if (document.visibilityState !== 'visible') return;
    const tr = rawTrack(mic);
    const busy = !tr || tr.readyState !== 'live' || tr.muted;
    if (!busy) { n = 0; if (warned) { warned = false; toast(t('mic.back')); } return; }
    n++;
    if (n === 2 && !warned) { warned = true; toast(t('mic.busy'), { ms: 9000 }); }
    if (n % 3 === 0) swapMic();
  }, 1500);
}
function stopMic() {
  clearInterval(C.busyT);
  if (C.meters.me) { C.meters.me(); C.meters.me = null; }
  if (C.mic) C.mic.stop();
  C.mic = null;
}
export async function swapMic() {
  if (!C.room) return;
  try {
    const mic = await openMic(C.ac);
    mic.track.contentHint = 'speech';
    if (C.micSender) await C.micSender.replaceTrack(mic.track);
    const old = C.mic;
    C.mic = mic;
    if (old) old.stop();
    if (C.meters.me) C.meters.me();
    C.meters.me = startMeter(C.ac, mic.stream, (lv) => setSpeaking('me', lv > 0.035 && C.mic && C.mic.track.enabled));
    if (!C.micSender && C.pc) { C.micSender = C.pc.addTrack(mic.track, mic.stream); sendMeta(); }
    watchEnded(mic);
    watchBusy(mic);
    applyMic();
    renderDevCard();
  } catch (e) { toast(t('mic.swapfail')); console.warn(e); }
}
function populateDevicesSoon() { emit('devices'); }

/** O microfone está "aberto" agora? Considera mudo, ensurdecer e apertar-para-falar. */
function micOpen() {
  if (C.muted || C.deaf) return false;
  if (CFG.inputMode === 'ptt') return C.held;
  if (CFG.inputMode === 'ptm') return !C.held;
  return true;
}
function applyMic() {
  const open = micOpen();
  if (C.mic) C.mic.track.enabled = open;
  if (!open) setSpeaking('me', false);
  renderDock(); renderPeople(); sendFlags();
}
export function toggleMute() { C.muted = !C.muted; applyMic(); emit('call', callInfo()); }
export function toggleDeaf() {
  C.deaf = !C.deaf;
  els.remoteMic.muted = C.deaf; els.video.muted = C.deaf;
  mixerSet({ deaf: C.deaf });
  if (mixerActive()) { els.remoteMic.muted = true; els.video.muted = true; }
  applyMic(); emit('call', callInfo());
}
export function applyInputMode() { C.held = false; applyMic(); }
export function applyOutputPrefs() {
  // volumes passam pelo mixer (funciona no iPhone e permite o equilíbrio automático); sem ele, direto no elemento
  mixerSet({ voice: CFG.volVoice, film: CFG.volScreen, auto: CFG.autoMix !== false, sink: CFG.spkId || '' });
  if (!mixerActive()) { try { els.remoteMic.volume = Math.min(1, CFG.volVoice); els.video.volume = Math.min(1, CFG.volScreen); } catch {} }
  sendWantVol();
  els.statsBox.hidden = !CFG.stats;
  const sink = CFG.spkId || '';
  if (els.remoteMic.setSinkId) els.remoteMic.setSinkId(sink).catch(() => {});
  if (els.video.setSinkId) els.video.setSinkId(sink).catch(() => {});
  paintVolumes();
}

function setHeld(v) {
  clearTimeout(C.pttTimer);
  if (v) { C.held = true; applyMic(); }
  else if (CFG.inputMode === 'ptt' && CFG.release > 0) C.pttTimer = setTimeout(() => { C.held = false; applyMic(); }, CFG.release);
  else { C.held = false; applyMic(); }
}

/* ───────────── transmissão de tela ───────────── */
const isMac = /Mac/i.test(navigator.platform || '') && !IOS;
// Safari e Firefox não entregam som na transmissão de tela (getDisplayMedia sem áudio). Chrome e Edge entregam.
const UA = navigator.userAgent;
const shareNoAudio = /Firefox\//.test(UA) || (/Safari\//.test(UA) && !/Chrome|Chromium|CriOS|Edg\/|OPR\//.test(UA));
const IOS_APP = IOS && (navigator.standalone === true || matchMedia('(display-mode: standalone)').matches);
const canShare = () => !!navigator.mediaDevices?.getDisplayMedia && !IOS;

export function openShareDialog() {
  if (C.screen) { stopShare(true); return; }
  if (!canShare()) { toast(IOS ? t('dock.noshare.ios') : t('dock.noshare')); return; }
  openShareUi({ PRESETS, peerName, isMac, noAudio: shareNoAudio, supported: canShare(), switching: false, start: (o) => beginShare(o) });
}
function switchSource() {
  if (!C.screen) return;
  openShareUi({ PRESETS, peerName, isMac, noAudio: shareNoAudio, supported: canShare(), switching: true, start: (o) => beginShare({ ...o, switching: true }) });
}

async function beginShare({ surface, preset: presetId, audioMode, apps = [], switching = false }) {
  const P = PRESETS[presetId];
  const wantAudio = audioMode !== 'none';
  const opts = {
    video: { frameRate: { ideal: P.fps, max: P.fps }, width: { ideal: P.w }, height: { ideal: P.h }, cursor: 'always', displaySurface: surface },
    audio: wantAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, sampleRate: 48000, suppressLocalAudioPlayback: true, restrictOwnAudio: true } : false,
    systemAudio: audioMode === 'system' ? 'include' : 'exclude',
    windowAudio: audioMode === 'app' ? 'window' : audioMode === 'system' ? 'system' : 'exclude',
    selfBrowserSurface: 'exclude', surfaceSwitching: 'include', monitorTypeSurfaces: 'include',
  };
  let stream;
  try { stream = await navigator.mediaDevices.getDisplayMedia(opts); }
  catch (e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'AbortError')) return;
    try { stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: wantAudio }); }
    catch { toast(t('share.fail')); return; }
  }
  // Ponto de extensão do app de desktop: avisa quais apps entram no áudio (no navegador isso não existe).
  try { window.echoDesktop && typeof window.echoDesktop.setShareAudioApps === 'function' && window.echoDesktop.setShareAudioApps(apps); } catch {}
  if (switching && C.screen) { await swapScreenSource(stream, presetId, audioMode, surface); return; }
  const v = stream.getVideoTracks()[0], a = stream.getAudioTracks()[0] || null;
  v.contentHint = P.hint; if (a) a.contentHint = 'music';
  const got = (v.getSettings && v.getSettings().displaySurface) || surface;
  C.screen = { stream, v, a, preset: presetId, audioMode, wantAudio, surface: got, vSender: null, aSender: null };
  v.addEventListener('ended', () => { if (C.screen && C.screen.v === v) stopShare(true); });
  sendMeta(); addScreenToPc(); renderMode();
  emit('call', callInfo());
  if (wantAudio && !a) toast(noAudioMsg(), { ms: 12000 });
  else if (!C.peerPresent) toast(t('share.ready'));
}

/** Troca a tela/janela/aba sem derrubar a transmissão: o vídeo da outra pessoa continua no mesmo fluxo. */
async function swapScreenSource(ns, presetId, audioMode, surface) {
  const sc = C.screen;
  if (!sc) { ns.getTracks().forEach((x) => x.stop()); return; }
  const nv = ns.getVideoTracks()[0], na = ns.getAudioTracks()[0] || null;
  const ov = sc.v, oa = sc.a;
  nv.contentHint = PRESETS[presetId].hint; if (na) na.contentHint = 'music';
  try {
    if (sc.vSender) await sc.vSender.replaceTrack(nv);
    sc.stream.addTrack(nv); sc.stream.removeTrack(ov); sc.v = nv;
    if (oa) sc.stream.removeTrack(oa);
    if (na) sc.stream.addTrack(na);
    if (na && sc.aSender) await sc.aSender.replaceTrack(na);
    else if (na && !sc.aSender && C.pc) { sc.aSender = C.pc.addTrack(na, sc.stream); setSenderParams(sc.aSender, { enc: { maxBitrate: (CFG.share.audioKbps || 256) * 1000, priority: 'high', networkPriority: 'high' } }); }
    else if (!na && sc.aSender) await sc.aSender.replaceTrack(null);
    sc.a = na;
  } catch (e) { console.warn('trocar origem', e); toast(t('share.fail')); ns.getTracks().forEach((x) => x.stop()); return; }
  try { ov.stop(); if (oa) oa.stop(); } catch {}
  sc.audioMode = audioMode; sc.wantAudio = audioMode !== 'none';
  sc.surface = (nv.getSettings && nv.getSettings().displaySurface) || surface;
  nv.addEventListener('ended', () => { if (C.screen && C.screen.v === nv) stopShare(true); });
  sendMeta(); await changeQuality(presetId); renderMode();
}

function addScreenToPc() {
  const pc = C.pc, sc = C.screen;
  if (!pc || !sc) return;
  const P = PRESETS[sc.preset];
  sc.vSender = pc.addTrack(sc.v, sc.stream);
  applyCodecPrefs(pc, sc.vSender);
  setSenderParams(sc.vSender, { enc: { maxBitrate: P.kbps * 1000, maxFramerate: P.fps, scaleResolutionDownBy: 1, priority: 'high', networkPriority: 'high' }, degr: P.degr });
  if (sc.a) {
    sc.aSender = pc.addTrack(sc.a, sc.stream);
    setSenderParams(sc.aSender, { enc: { maxBitrate: (CFG.share.audioKbps || 256) * 1000, priority: 'high', networkPriority: 'high' } });
  }
}

function applyCodecPrefs(pc, sender) {
  if (CFG.codec === 'auto') return;
  try {
    const tr = pc.getTransceivers().find((x) => x.sender === sender);
    const caps = window.RTCRtpSender && RTCRtpSender.getCapabilities && RTCRtpSender.getCapabilities('video');
    if (!tr || !tr.setCodecPreferences || !caps) return;
    const mime = { h264: 'video/h264', vp9: 'video/vp9', vp8: 'video/vp8', av1: 'video/av1' }[CFG.codec];
    const first = caps.codecs.filter((c) => c.mimeType.toLowerCase() === mime);
    if (!first.length) return;
    tr.setCodecPreferences([...first, ...caps.codecs.filter((c) => !first.includes(c))]);
  } catch (e) { console.warn('codec', e); }
}

function stopShare(notify) {
  const sc = C.screen;
  if (!sc) return;
  C.screen = null;
  try { sc.v.stop(); if (sc.a) sc.a.stop(); } catch {}
  if (sc.stopMedia) sc.stopMedia();
  for (const s of [sc.vSender, sc.aSender]) { try { if (s && C.pc && C.pc.signalingState !== 'closed') C.pc.removeTrack(s); } catch {} }
  if (els.sharePrev) els.sharePrev.srcObject = null;
  if (notify) sendMeta();
  renderMode(); emit('call', callInfo());
}

async function changeQuality(id) {
  const sc = C.screen, P = PRESETS[id];
  if (!sc || !P) return;
  sc.preset = id; sc.v.contentHint = P.hint;
  try { await sc.v.applyConstraints({ frameRate: { ideal: P.fps, max: P.fps }, width: { ideal: P.w }, height: { ideal: P.h } }); } catch {}
  if (sc.vSender) setSenderParams(sc.vSender, { enc: { maxBitrate: P.kbps * 1000, maxFramerate: P.fps }, degr: P.degr });
  CFG.share.preset = id; saveCfg();
  renderShareInfo();
}

/* ───────────── PiP, tela cheia, tela acesa ───────────── */
/** Por que a transmissão saiu sem som, em palavras que ajudam a resolver. */
function noAudioMsg() {
  if (shareNoAudio) return t(/Firefox\//.test(UA) ? 'share.warn.firefox' : 'share.warn.safari');
  return t(isMac ? 'share.warn.mac' : 'share.warn.noaudio');
}

function togglePip() {
  const v = els.video;
  // No app da Tela de Início do iPhone a Apple não libera a janela flutuante (bug 280627 do WebKit, ainda aberto).
  if (IOS_APP) { toast(t('pip.ios.app'), { ms: 9000 }); return; }
  try {
    if (document.pictureInPictureElement) { document.exitPictureInPicture().catch(() => {}); return; }
    if (v.webkitPresentationMode === 'picture-in-picture') { v.webkitSetPresentationMode('inline'); return; }
    if (v.paused) v.play().catch(() => {});
    // Chamado direto no toque (sem await antes): Safari só abre a janelinha dentro do gesto.
    if (IOS && v.webkitSupportsPresentationMode && v.webkitSupportsPresentationMode('picture-in-picture')) { v.webkitSetPresentationMode('picture-in-picture'); return; }
    if (v.requestPictureInPicture && document.pictureInPictureEnabled !== false) {
      v.requestPictureInPicture().catch((e) => { console.warn(e); toast(IOS ? t('pip.ios.app') : t('pip.fail')); });
      return;
    }
    if (v.webkitSetPresentationMode) { v.webkitSetPresentationMode('picture-in-picture'); return; }
    toast(t('pip.none'));
  } catch (e) { toast(t('pip.fail')); console.warn(e); }
}
function toggleFull() {
  if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
  // Tela cheia da sala inteira: assim os controles em vidro continuam disponíveis sobre o vídeo.
  if (els.room.requestFullscreen) els.room.requestFullscreen().catch(() => {});
  else if (els.video.webkitEnterFullscreen) els.video.webkitEnterFullscreen();
}
async function keepAwake(on) {
  try {
    if (on && !C.wake && navigator.wakeLock && document.visibilityState === 'visible') {
      C.wake = await navigator.wakeLock.request('screen'); C.wake.addEventListener('release', () => { C.wake = null; });
    } else if (!on && C.wake) { await C.wake.release(); C.wake = null; }
  } catch {}
}

/* ───────────── estatísticas e código de segurança ───────────── */
async function pollStats() {
  const pc = C.pc;
  if (!pc || pc.connectionState !== 'connected') return;
  let rep; try { rep = await pc.getStats(); } catch { return; }
  const by = new Map(); rep.forEach((r) => by.set(r.id, r));
  let pair = null;
  rep.forEach((r) => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = by.get(r.selectedCandidatePairId); });
  if (!pair) rep.forEach((r) => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
  let path = '', rtt = null, kind = '';
  if (pair) {
    const l = by.get(pair.localCandidateId), r = by.get(pair.remoteCandidateId);
    kind = (l && l.candidateType === 'relay') || (r && r.candidateType === 'relay') ? 'relay' : 'direct';
    path = kind === 'relay' ? t('conn.relay') : t('conn.direct');
    if (typeof pair.currentRoundTripTime === 'number') rtt = Math.round(pair.currentRoundTripTime * 1000);
  }
  const rate = (r) => {
    const prev = C.prevStats.get(r.id);
    const cur = r.bytesSent ?? r.bytesReceived ?? 0;
    C.prevStats.set(r.id, { b: cur, t: r.timestamp });
    if (!prev) return null;
    return Math.max(0, Math.round(((cur - prev.b) * 8) / (r.timestamp - prev.t)));
  };
  const lossOf = (r) => {
    const key = r.id + ':loss', prev = C.prevStats.get(key);
    const lost = r.packetsLost ?? 0, got = r.packetsReceived ?? 0;
    C.prevStats.set(key, { lost, got });
    if (!prev) return null;
    const dl = Math.max(0, lost - prev.lost), dg = Math.max(0, got - prev.got);
    return dl + dg > 0 ? (dl / (dl + dg)) * 100 : 0;
  };
  const lines = [];
  const st = { outMbps: null, inMbps: null, lossOut: null, lossIn: null, inH: 0, inFps: 0 };
  rep.forEach((r) => {
    const k = r.kind || r.mediaType;
    if (r.type === 'outbound-rtp' && k === 'video' && r.bytesSent > 0) {
      const kb = rate(r); st.outMbps = kb !== null ? kb / 1000 : null;
      lines.push(`↑ ${t('stat.video')} ${kb !== null ? (kb / 1000).toFixed(1) : '–'} Mbps · ${r.frameWidth || '?'}x${r.frameHeight || '?'} · ${Math.round(r.framesPerSecond || 0)} fps${r.qualityLimitationReason && r.qualityLimitationReason !== 'none' ? ' · ' + t('stat.limit') + ': ' + r.qualityLimitationReason : ''}`);
    } else if (r.type === 'remote-inbound-rtp' && k === 'video') {
      if (typeof r.fractionLost === 'number') st.lossOut = r.fractionLost * 100;
    } else if (r.type === 'inbound-rtp' && k === 'video') {
      const kb = rate(r); st.inMbps = kb !== null ? kb / 1000 : null;
      st.lossIn = lossOf(r); st.inH = r.frameHeight || 0; st.inFps = Math.round(r.framesPerSecond || 0);
      lines.push(`↓ ${t('stat.video')} ${kb !== null ? (kb / 1000).toFixed(1) : '–'} Mbps · ${r.frameWidth || '?'}x${r.frameHeight || '?'} · ${Math.round(r.framesPerSecond || 0)} fps · ${t('stat.lost')} ${r.packetsLost ?? 0}`);
    } else if (r.type === 'inbound-rtp' && k === 'audio') {
      lines.push(`↓ ${t('stat.audio')} jitter ${Math.round((r.jitter || 0) * 1000)} ms · ${t('stat.lost')} ${r.packetsLost ?? 0}`);
    }
  });
  C.path = path; C.pathKind = kind; C.rtt = rtt; C.stat = st;
  C.statsText = [`${path}${rtt !== null ? ' · ' + rtt + ' ms' : ''}`, ...lines].join('\n');
  els.statsBox.textContent = C.statsText;
  setConn('ok', path ? `${path}${rtt !== null ? ' · ' + rtt + ' ms' : ''}` : t('conn.ok'));
  renderWatchInfo(); renderShareInfo();
}

async function securityCode() {
  const pc = C.pc;
  if (!pc || !pc.localDescription || !pc.remoteDescription) return null;
  const fp = (s) => (/a=fingerprint:\S+ (\S+)/.exec(s) || [])[1];
  const a = fp(pc.localDescription.sdp), b = fp(pc.remoteDescription.sdp);
  if (!a || !b) return null;
  const data = new TextEncoder().encode([a, b].sort().join('|'));
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  const hex = Array.from(h.slice(0, 10), (x) => x.toString(16).padStart(2, '0')).join('');
  return hex.match(/.{4}/g).join(' ').toUpperCase();
}

async function showConnInfo() {
  const code = await securityCode();
  const body = el('div', { class: 'stack' },
    el('p', { class: 'muted', text: C.pc ? `${C.path || '…'}${C.rtt !== null ? ' · ' + C.rtt + ' ms' : ''}` : t('conn.none') }),
    code && el('div', { class: 'seccode' }, el('small', { text: t('sec.code') }), el('code', { text: code }), el('p', { class: 'muted', text: t('sec.explain') })),
    C.statsText && el('pre', { class: 'statsbox', text: C.statsText }),
    el('div', { class: 'actions' }, el('button', { class: 'btn primary', type: 'button', text: t('done'), onClick: closeModal })));
  openModal(t('conn.title'), body);
}

/* ───────────── interface da sala ───────────── */
const LAND = matchMedia('(orientation: landscape) and (max-height: 520px)');
const fmtTime = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(x)}` : `${p(m)}:${p(x)}`;
};
const timerText = () => (C.t0 ? fmtTime(Date.now() - C.t0) : '');
function startTick() { stopTick(); C.tick = setInterval(() => { if (C.room) renderHeader(); }, 1000); }
function stopTick() { clearInterval(C.tick); C.tick = null; }

function setConn(state, text) { els.conn.dataset.state = state; els.connText.textContent = text; }

function setSpeaking(which, v) {
  if (C.speak[which] === v) return;
  C.speak[which] = v;
  (which === 'me' ? els.seatMe : els.seatHer).classList.toggle('speaking', v);
  (which === 'me' ? els.pcMeAv : els.pcHerAv).classList.toggle('speaking', v);
  (which === 'me' ? els.pcMeWave : els.pcHerWave).classList.toggle('on', v);
  if (which === 'her') els.whoAv.classList.toggle('speaking', v);
  renderChip();
}

function fillSeat(node, user, ghost, which, flags) {
  node.classList.toggle('ghost', ghost);
  node.classList.toggle('speaking', !!C.speak[which]);
  const kids = [avatar(user || { name: '?' }, 'fill')];
  if (!ghost && flags && (flags.muted || flags.deaf)) kids.push(el('span', { class: 'badge' }, icon(flags.deaf ? 'r-hpoff' : 'r-micoff', 'i')));
  node.replaceChildren(...kids);
}

export function renderPeople() {
  if (!els.seatMe) return;
  const me = D.me, peer = peerUser();
  fillSeat(els.seatMe, me, false, 'me', { muted: C.muted || (C.room && !micOpen()), deaf: C.deaf });
  fillSeat(els.seatHer, peer, !C.peerPresent, 'her', C.peerFlags);
  els.heroName.textContent = peer ? displayName(peer) : (C.label || '');
  paintBackdrop(peer);
  renderChip(); renderDevCard(); renderWatchInfo(); renderShareInfo();
}
/** Desfoca a foto uma vez só: reduz para 24 px (já fica borrada ao esticar), escurece e guarda. */
const BLUR = new Map();
function blurOnce(src) {
  if (BLUR.has(src)) return Promise.resolve(BLUR.get(src));
  return new Promise((ok) => {
    const im = new Image();
    im.onload = () => {
      try {
        const cv = document.createElement('canvas'); cv.width = cv.height = 24;
        const x = cv.getContext('2d'); x.filter = 'blur(2px) saturate(1.1)';
        x.drawImage(im, -4, -4, 32, 32); x.filter = 'none';
        x.fillStyle = 'rgba(0,0,0,.42)'; x.fillRect(0, 0, 24, 24);
        const u = cv.toDataURL('image/png'); BLUR.set(src, u); ok(u);
      } catch { ok(null); }
    };
    im.onerror = () => ok(null); im.src = src;
  });
}
/** Fundo no estilo FaceTime: a foto (ou a cor) da outra pessoa, bem desfocada e escurecida. Parado. */
function paintBackdrop(peer) {
  const room = els.seatHer && els.seatHer.closest('.room');
  if (!room) return;
  let bg = room.querySelector(':scope > .ft-bg');
  if (!bg) { bg = el('div', { class: 'ft-bg', 'aria-hidden': 'true' }); room.prepend(bg); }
  const img = peer && peer.avatar && /^data:image\/(png|jpeg|webp|gif);base64,/.test(peer.avatar) ? peer.avatar : null;
  // sem foto: a cor do avatar padrão (ou a cor de perfil escolhida); lida a cada desenho
  const av = els.seatHer.querySelector('.av-img');
  const c0 = av ? getComputedStyle(av).backgroundColor : '';
  const col = (peer && /^#[0-9a-f]{6}$/i.test(peer.accent || '') && peer.accent) || (c0 && !/rgba\(0, 0, 0, 0\)|transparent/.test(c0) ? c0 : '#3a3a40');
  const key = (img ? img.length + img.slice(-24) : '') + '|' + col;
  if (bg.dataset.k === key) return;
  bg.dataset.k = key;
  bg.classList.toggle('photo', !!img);
  bg.style.backgroundImage = '';
  if (img) blurOnce(img).then((u) => { if (bg.dataset.k === key && u) bg.style.backgroundImage = `url("${u}")`; });
  bg.style.setProperty('--ft-c', col);
  room.style.setProperty('--ft-c', col);
}

function renderHeader() {
  if (!els.roomName) return;
  els.roomName.textContent = C.label || '';
  els.roomSub.textContent = [C.subKey ? t(C.subKey) : C.sub, timerText(), C.screen ? t('room.sharing') : null].filter(Boolean).join(' · ');
  els.heroTime.textContent = C.peerPresent ? (timerText() || '0:00') : t('ft.calling');
  ftNow();
}
function ftNow() {
  if (!els.room) return;
  const peer = peerUser();
  syncFt({ mode: els.room.dataset.mode, immersive: els.room.classList.contains('immersive'), peer, label: peer ? displayName(peer) : (C.label || ''), present: !!C.peerPresent, time: timerText() });
}

function renderChip() {
  if (!els.callChip) return;
  let text, wave = false, idle = false;
  if (!C.peerPresent) { text = t('cap.waiting'); idle = true; }
  else if (C.speak.her) { text = t('call.speaking', { name: peerName() }); wave = true; }
  else if (C.speak.me) { text = t('call.you.speaking'); wave = true; }
  else { text = t('call.connected'); idle = true; }
  els.callChipText.textContent = text;
  els.callChipWave.classList.toggle('on', wave);
  els.callChip.classList.toggle('idle', idle);
}

function renderDevCard() {
  if (!els.devMic) return;
  els.devMic.textContent = currentInputName(rawTrack(C.mic));
  els.devOut.textContent = currentOutputName();
  els.devMode.textContent = t('voice.am.' + CFG.audioMode);
}

const surfaceName = (s) => ({ browser: t('surf.tab'), window: t('surf.win'), monitor: t('surf.screen'), file: t('surf.file') }[s] || t('surf.generic'));
let whoFor = null;

function renderWatchInfo() {
  if (!els.whoName) return;
  const peer = peerUser();
  if (whoFor !== (peer && peer.id) || !els.whoAv.firstChild) { els.whoAv.replaceChildren(avatar(peer, 'fill')); whoFor = peer && peer.id; }
  els.whoName.textContent = peerName();
  const v = els.video, w = v.videoWidth, h = v.videoHeight, s = C.stat || {};
  els.whoInfo.textContent = w ? `${surfaceName(C.peerMeta.surface)} · ${w}×${h}` : surfaceName(C.peerMeta.surface);
  const hh = s.inH || h, fps = s.inFps;
  els.liveText.textContent = [t('watch.live'), hh ? hh + 'p' : null, fps || null].filter(Boolean).join(' · ');
  const hasRate = typeof s.inMbps === 'number';
  els.qChip.hidden = !hasRate;
  if (hasRate) {
    const smooth = (s.lossIn ?? 0) < 3;
    els.qChip.textContent = `${smooth ? t('watch.smooth') : t('watch.choppy')} · ${t('watch.mbps', { n: s.inMbps.toFixed(s.inMbps < 10 ? 1 : 0) })}`;
  }
}

function setAspect(host, video) {
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) return;
  host.style.setProperty('--ar', `${w} / ${h}`);
  host.style.setProperty('--arn', (w / h).toFixed(4));
}

function renderShareQuality() {
  const sc = C.screen;
  if (!sc) return;
  els.shQ.replaceChildren(...Object.keys(PRESETS).map((id) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(id === sc.preset), onClick: () => changeQuality(id) }, t('preset.' + id))));
  els.shQLine.textContent = qualityLine(PRESETS[sc.preset]);
}

function renderShareInfo() {
  const sc = C.screen;
  if (!sc || !els.shWhat) return;
  const st = sc.v.getSettings ? sc.v.getSettings() : {};
  const surf = st.displaySurface || sc.surface;
  els.shSees.textContent = t('sh.sees', { name: peerName() });
  els.shWhat.textContent = surfaceName(surf);
  const lab = String(sc.v.label || '');
  els.shWhat2.textContent = sc.mediaName ? sc.mediaName : lab && !/^(screen|window|web-contents-media-stream):/i.test(lab) ? lab : `${st.width || '?'}×${st.height || '?'}`;
  els.shWhatIco.setAttribute('href', '#' + ({ browser: 'r-tab', window: 'r-win' }[surf] || 'r-scr'));
  renderShareQuality();
  // áudio
  let title, desc;
  if (!sc.a) { title = t('sh.a.none'); desc = t('sh.a.none.d'); }
  else if (sc.audioMode === 'media') { title = t('sh.a.media'); desc = t('sh.a.media.d', { name: peerName() }); }
  else if (sc.audioMode === 'system') { title = t('sh.a.system'); desc = t('sh.a.system.d', { name: peerName() }); }
  else if (surf === 'browser') { title = t('sh.a.app.browser'); desc = t('sh.a.app.d', { name: peerName() }); }
  else { title = t('sh.a.app.window'); desc = t('sh.a.app.window.d', { name: peerName() }); }
  els.shAT.textContent = title; els.shAD.textContent = desc;
  els.btnShareAudio.disabled = !sc.a;
  els.btnShareAudio.textContent = !sc.a ? t('sh.a.nosound') : sc.a.enabled ? t('sh.a.on') : t('sh.a.off');
  let warn = '';
  if (sc.a) {
    const as = sc.a.getSettings ? sc.a.getSettings() : {};
    if (surf === 'monitor' && !as.restrictOwnAudio) warn = t('share.warn.echo');
  } else if (sc.wantAudio) warn = noAudioMsg();
  els.sharingWarn.hidden = !warn; els.sharingWarn.textContent = warn;
  // chips com números reais
  const s = C.stat || {};
  els.shCPath.textContent = C.pathKind === 'relay' ? t('sh.relay') : t('sh.direct');
  els.shCLoss.textContent = typeof s.lossOut === 'number' ? t('sh.loss', { n: s.lossOut < 10 ? s.lossOut.toFixed(s.lossOut < 1 ? 0 : 1) : Math.round(s.lossOut) }) : '–';
  els.shCRate.textContent = typeof s.outMbps === 'number' ? t('watch.mbps', { n: s.outMbps.toFixed(s.outMbps < 10 ? 1 : 0) }) : '–';
  // cartões das duas pessoas
  els.pcMeAv.replaceChildren(avatar(D.me, 'fill'));
  els.pcMeSub.textContent = currentInputName(rawTrack(C.mic));
  els.pcHerAv.replaceChildren(avatar(peerUser(), 'fill'));
  els.pcHerName.textContent = peerName();
  els.pcHerSub.textContent = [C.peerPresent ? t('sh.watching') : t('sh.incall'), C.rtt !== null ? C.rtt + ' ms' : null].filter(Boolean).join(' · ');
}

function attachPreview() {
  if (!C.screen) return;
  const card = els.sharePrev.parentElement;
  const media = C.screen.media;
  if (media) {
    // vídeo do computador/link: quem transmite vê o próprio player, com controles (pausar, avançar, volume)
    els.sharePrev.hidden = true;
    if (media.parentElement !== card) { media.classList.add('media-src'); media.controls = true; card.insertBefore(media, els.sharePrev); }
    return;
  }
  els.sharePrev.hidden = false;
  card.querySelectorAll('.media-src').forEach((x) => x.remove());
  if (els.sharePrev.srcObject !== C.screen.stream) els.sharePrev.srcObject = C.screen.stream;
  els.sharePrev.play().catch(() => {});
}

/** Transmite um vídeo (arquivo do computador ou link direto) com o som do próprio vídeo.
 *  Usa captureStream do <video> (Chrome/Edge/Firefox) ou, no Safari, um canvas + Web Audio. */
export async function shareMedia(src, name) {
  if (!C.room) return false;
  const v = document.createElement('video');
  v.playsInline = true; v.preload = 'auto';
  const isUrl = typeof src === 'string';
  if (isUrl) v.crossOrigin = 'anonymous';
  const url = isUrl ? src : URL.createObjectURL(src);
  v.src = url;
  try {
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('media')); setTimeout(() => rej(new Error('timeout')), 20000); });
    v.volume = 1;
    await v.play();
  } catch (e) { if (!isUrl) URL.revokeObjectURL(url); toast(t(isUrl ? 'wt.badlink' : 'wt.badfile')); return false; }
  let stream = null, cleanup = () => {};
  const cap = v.captureStream || v.mozCaptureStream;
  if (cap) {
    try { stream = cap.call(v); } catch { stream = null; }
    for (let i = 0; stream && i < 60 && !stream.getVideoTracks().length; i++) await sleep(50);
    if (stream && !stream.getVideoTracks().length) stream = null;
  }
  if (!stream) {
    // Safari: desenha o vídeo num canvas e pega o som pelo Web Audio
    try {
      const W = Math.min(1920, v.videoWidth || 1280), H = Math.round(W * ((v.videoHeight || 720) / (v.videoWidth || 1280)));
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const g = cv.getContext('2d');
      let on = true;
      const draw = () => { if (!on) return; try { g.drawImage(v, 0, 0, W, H); } catch {} if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(draw); else setTimeout(draw, 33); };
      draw();
      const vs = cv.captureStream(30);
      const ac = C.ac || new (window.AudioContext || window.webkitAudioContext)();
      const srcN = ac.createMediaElementSource(v); const dest = ac.createMediaStreamDestination();
      srcN.connect(dest); srcN.connect(ac.destination);
      stream = new MediaStream([...vs.getVideoTracks(), ...dest.stream.getAudioTracks()]);
      cleanup = () => { on = false; try { srcN.disconnect(); } catch {} };
    } catch (e) { console.warn('canvas', e); toast(t('wt.nostream')); v.pause(); if (!isUrl) URL.revokeObjectURL(url); return false; }
  }
  if (C.screen) stopShare(false);
  const vt = stream.getVideoTracks()[0], at = stream.getAudioTracks()[0] || null;
  vt.contentHint = 'motion'; if (at) at.contentHint = 'music';
  C.screen = { stream, v: vt, a: at, preset: 'filme', audioMode: 'media', wantAudio: true, surface: 'file', media: v, mediaName: name || (isUrl ? src : src.name),
    stopMedia: () => { cleanup(); try { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); } catch {} if (!isUrl) URL.revokeObjectURL(url); } };
  v.addEventListener('ended', () => { /* fica parado no fim; quem transmite decide parar */ });
  sendMeta(); addScreenToPc(); renderMode();
  emit('call', callInfo());
  return true;
}

/* modo imersivo: celular deitado assistindo, ou tela cheia. O vídeo ocupa tudo e os controles ficam em vidro por cima. */
let hideT = 0;
function pokeUi() {
  els.room.classList.remove('ui-hide');
  clearTimeout(hideT);
  if (els.room.classList.contains('immersive') && !(pop && pop.isOpen())) hideT = setTimeout(() => els.room.classList.add('ui-hide'), 3500);
}
function placeVols(imm) {
  if (imm && els.vols.parentElement !== els.dock) els.dock.prepend(els.vols);
  else if (!imm && els.vols.parentElement === els.dock) els.who.after(els.vols);
}
function updateImmersive() {
  if (!els.room) return;
  const watching = els.room.dataset.mode === 'watch';
  const full = document.fullscreenElement === els.room;
  const imm = watching && (LAND.matches || full);
  els.room.classList.toggle('immersive', imm);
  placeVols(imm);
  setIcon(els.btnFull, full ? 'r-unfull' : 'r-full');
  const lab = full ? t('watch.exitfull') : t('watch.full');
  els.btnFull.setAttribute('aria-label', lab); els.btnFull.title = lab;
  if (imm) pokeUi(); else { clearTimeout(hideT); els.room.classList.remove('ui-hide'); }
  ftNow();
}

function renderMode() {
  if (!els.stage) return;
  const act = (ACTIVITIES_ENABLED || WATCH_ENABLED) && activityOn;
  const watching = !act && C.peerMeta.sharing && !!C.remoteScreen;
  const sharing = !act && !watching && !!C.screen;
  const mode = act ? 'activity' : watching ? 'watch' : sharing ? 'share' : 'call';
  els.room.dataset.mode = mode; els.stage.dataset.mode = mode;
  els.callScene.hidden = mode !== 'call';
  els.cinema.hidden = !watching;
  els.sharing.hidden = !sharing;
  els.btnScreen.classList.toggle('live', !!C.screen);
  setIcon(els.btnScreen, C.screen ? 'r-scrup' : 'r-scr');
  els.btnScreen.lastElementChild.textContent = C.screen ? t('dock.sharing') : t('dock.share');
  const off = !C.screen && !canShare();
  const dkS = document.getElementById('dk-screen'); if (dkS) dkS.hidden = off && IOS;
  els.btnScreen.classList.toggle('off', off);
  els.btnScreen.setAttribute('aria-disabled', String(off));
  els.btnScreen.title = C.screen ? t('sh.stop') : off ? (IOS ? t('dock.noshare.ios') : t('dock.noshare')) : '';
  els.btnPip.hidden = !watching; els.btnPipV.disabled = !watching;
  els.btnAct.hidden = !ACTIVITIES_ENABLED;
  renderHeader(); renderChip(); renderWatchInfo();
  if (sharing) { attachPreview(); renderShareInfo(); }
  updateImmersive();
  keepAwake(watching || !!C.screen);
}

function renderDock() {
  if (!els.btnMic) return;
  const micOff = C.muted || C.deaf;
  els.spMic.classList.toggle('muted', micOff);
  els.btnMic.setAttribute('aria-pressed', String(micOff));
  setIcon(els.btnMic, micOff ? 'r-micoff' : 'r-mic');
  const ml = C.muted ? t('dock.unmute') : t('dock.mute');
  els.btnMic.setAttribute('aria-label', ml); els.btnMic.title = ml;
  els.spDeaf.classList.toggle('muted', C.deaf);
  els.btnDeaf.setAttribute('aria-pressed', String(C.deaf));
  setIcon(els.btnDeaf, C.deaf ? 'r-hpoff' : 'r-hp');
  const dl = C.deaf ? t('dock.undeafen') : t('dock.deafen');
  els.btnDeaf.setAttribute('aria-label', dl); els.btnDeaf.title = dl;
  const ptt = CFG.inputMode !== 'voice';
  els.btnPtt.hidden = !ptt; const dk = document.getElementById('dk-ptt'); if (dk) dk.hidden = !ptt;
  els.room.toggleAttribute('data-ptt', ptt);
  els.btnPtt.classList.toggle('held', C.held);
  els.btnPtt.lastElementChild.textContent = CFG.inputMode === 'ptm' ? t('dock.ptm') : t('dock.ptt');
}

/* ───────────── som de quem assiste: painel pequeno (segurar o vídeo ou o botão de som no vídeo) ───────────── */
let mixPop = null;
function closeMixPop() { if (mixPop) { mixPop.remove(); mixPop = null; onMixer(null); } }
function openMixPop() {
  if (mixPop) { closeMixPop(); return; }
  mixerUnlock();
  const row = (ic, label, key) => {
    const out = el('output', { text: String(Math.round(CFG[key] * 100)) });
    const meter = el('i', { class: 'mx-lv' });
    const inp = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(CFG[key]), 'aria-label': label });
    const paint = () => inp.style.setProperty('--p', Math.round(Number(inp.value) * 100) + '%');
    inp.addEventListener('input', () => { CFG[key] = Number(inp.value); out.textContent = String(Math.round(CFG[key] * 100)); paint(); saveCfg(); applyOutputPrefs(); });
    paint();
    return { node: el('div', { class: 'mx-row' }, icon(ic, 'i'), el('span', { class: 'mx-n', text: label }), el('span', { class: 'mx-sl' }, inp, meter), out), inp, out, meter, paint };
  };
  const v = row('r-mic', t('watch.voice'), 'volVoice');
  const f = row('r-vol', t('watch.film'), 'volScreen');
  const auto = el('input', { type: 'checkbox', role: 'switch', class: 'mx-tg', checked: CFG.autoMix !== false, onChange: (e) => { CFG.autoMix = e.target.checked; saveCfg(); applyOutputPrefs(); } });
  const rec = el('button', { class: 'mx-rec', type: 'button', hidden: true });
  rec.addEventListener('click', () => {
    const r = mixerRecommend(); if (!r) return;
    CFG.volVoice = r.voice; CFG.volScreen = r.film; saveCfg(); applyOutputPrefs();
    for (const x of [[v, 'volVoice'], [f, 'volScreen']]) { x[0].inp.value = String(CFG[x[1]]); x[0].out.textContent = String(Math.round(CFG[x[1]] * 100)); x[0].paint(); }
    rec.hidden = true;
  });
  const note = el('small', { class: 'mx-note', text: mixerActive() ? t('mix.auto.d') : t('mix.tap') });
  mixPop = el('div', { class: 'mixpop', role: 'dialog', 'aria-label': t('mix.title') },
    el('div', { class: 'mx-head' }, el('b', { text: t('mix.title') }), el('button', { class: 'mx-x', type: 'button', 'aria-label': t('close'), onClick: closeMixPop }, icon('r-x', 'i'))),
    v.node, f.node,
    MIXER_SUPPORTED ? el('label', { class: 'mx-auto' }, el('span', {}, el('span', { class: 'mx-n', text: t('mix.auto') }), note), auto)
      : el('small', { class: 'mx-note', text: t('mix.webkit') }),
    rec);
  els.vidCard.append(mixPop);
  requestAnimationFrame(() => mixPop && mixPop.classList.add('on'));
  let n = 0;
  onMixer((st) => {
    if (!mixPop) return;
    v.meter.style.setProperty('--lv', Math.max(0, Math.min(1, (st.voiceDb + 60) / 54)).toFixed(2));
    f.meter.style.setProperty('--lv', Math.max(0, Math.min(1, (st.filmDb + 60) / 54)).toFixed(2));
    mixPop.classList.toggle('ducking', st.auto && st.duck < 0.9);
    note.textContent = st.active ? t('mix.auto.d') : t('mix.tap');
    if (++n % 20 === 0) {
      const r = mixerRecommend();
      const differs = r && (Math.abs(r.film - CFG.volScreen) > 0.08 || Math.abs(r.voice - CFG.volVoice) > 0.08);
      rec.hidden = !differs;
      if (differs) rec.textContent = t('mix.rec', { film: Math.round(r.film * 100), voice: Math.round(r.voice * 100) });
    }
  });
}
function bindMixPop() {
  const card = els.vidCard; if (!card) return;
  // segurar o vídeo (celular) ou clicar com o botão direito (computador) abre o painel de som
  let timer = 0, x0 = 0, y0 = 0;
  card.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.mixpop, button')) return;
    x0 = e.clientX; y0 = e.clientY; clearTimeout(timer);
    timer = setTimeout(() => { timer = 0; try { navigator.vibrate && navigator.vibrate(10); } catch {} openMixPop(); }, 450);
  });
  const cancel = (e) => { if (timer && (!e || e.type !== 'pointermove' || Math.hypot(e.clientX - x0, e.clientY - y0) > 10)) { clearTimeout(timer); timer = 0; } };
  card.addEventListener('pointermove', cancel); card.addEventListener('pointerup', cancel); card.addEventListener('pointercancel', cancel);
  card.addEventListener('contextmenu', (e) => { if (e.target.closest('.mixpop')) return; e.preventDefault(); openMixPop(); });
  const btn = el('button', { class: 'rib glass', type: 'button', 'aria-label': t('mix.title'), title: t('mix.title'), onClick: (e) => { e.stopPropagation(); openMixPop(); } }, icon('r-vol', 'i s17'));
  const btns = card.querySelector('.vid-btns'); if (btns) btns.prepend(btn);
  document.addEventListener('pointerdown', (e) => { if (mixPop && !e.target.closest('.mixpop') && !e.target.closest('.vid-btns')) closeMixPop(); }, true);
}

/* volumes locais: "Filme" (vídeo da transmissão) e "Voz" (áudio da outra pessoa) */
const volSettable = (() => { try { const a = document.createElement('video'); a.volume = 0.5; return a.volume === 0.5; } catch { return true; } })();
function paintVolumes() {
  if (!els.volFilm) return;
  for (const [input, out, key] of [[els.volFilm, els.outFilm, 'volScreen'], [els.volVoice, els.outVoice, 'volVoice']]) {
    const v = Math.min(1, Math.max(0, Number(CFG[key])));
    if (Number(input.value) !== v) input.value = String(v);
    input.style.setProperty('--p', Math.round(v * 100) + '%');
    out.textContent = String(Math.round(v * 100));
  }
}
function bindVolumes() {
  for (const [input, key] of [[els.volFilm, 'volScreen'], [els.volVoice, 'volVoice']]) {
    input.addEventListener('input', () => { CFG[key] = Number(input.value); saveCfg(); applyOutputPrefs(); });
  }
  els.volFilm.closest('.rsl').hidden = !volSettable;
  labelVolumes();
  paintVolumes();
}
function labelVolumes() { els.volNote.hidden = volSettable; els.volNote.textContent = t('watch.novol'); }

export function renderCall() { renderPeople(); renderHeader(); renderMode(); renderDock(); paintVolumes(); }
export function setUserVisible(visible) { if (visible) { renderPeople(); } }

/* ───────────── ligação com a interface ───────────── */
export function initCall(events) {
  C.events = events;
  const ids = {
    room: 'view-room', remoteMic: 'remote-mic', conn: 'conn', connText: 'conn-text', roomName: 'room-name', roomSub: 'room-sub', stage: 'stage', btnSec: 'btn-sec',
    callScene: 'call-scene', heroName: 'hero-name', heroTime: 'hero-time', seatMe: 'seat-me', seatHer: 'seat-her', callChip: 'call-chip', callChipText: 'call-chip-text',
    devMic: 'dev-mic', devOut: 'dev-out', devMode: 'dev-mode',
    cinema: 'cinema', video: 'screen-video', vidCard: 'vid-card', liveText: 'live-text', btnPipV: 'btn-pip-v', btnFull: 'btn-full', btnUnmuteVideo: 'btn-unmute-video',
    whoAv: 'who-av', whoName: 'who-name', whoInfo: 'who-info', vols: 'vols', volFilm: 'vol-film', volVoice: 'vol-voice', outFilm: 'out-film', outVoice: 'out-voice', volNote: 'vol-note', qChip: 'q-chip',
    sharing: 'sharing', sharePrev: 'share-preview', shSees: 'sh-sees', shWhat: 'sh-what', shWhat2: 'sh-what2', shWhatIco: 'sh-what-ico', btnShareSwitch: 'btn-share-switch', shQ: 'sh-q', shQLine: 'sh-qline',
    shAT: 'sh-a-t', shAD: 'sh-a-d', btnShareAudio: 'btn-share-audio', sharingWarn: 'sharing-warn', shCPath: 'sh-c-path', shCLoss: 'sh-c-loss', shCRate: 'sh-c-rate', btnShareStop: 'btn-share-stop',
    pcMeAv: 'pc-me-av', pcMeSub: 'pc-me-sub', pcMeWave: 'pc-me-wave', pcHerAv: 'pc-her-av', pcHerName: 'pc-her-name', pcHerSub: 'pc-her-sub', pcHerWave: 'pc-her-wave',
    statsBox: 'stats', dock: 'dock', spMic: 'sp-mic', spDeaf: 'sp-deaf', btnMic: 'btn-mic', btnMicOpts: 'btn-mic-opts', btnDeaf: 'btn-deaf', btnDeafOpts: 'btn-deaf-opts',
    btnPtt: 'btn-ptt', btnAct: 'btn-act', btnScreen: 'btn-screen', btnPip: 'btn-pip', btnGear: 'btn-gear', btnLeave: 'btn-leave', btnBack: 'room-back', pop: 'call-pop', scrim: 'pop-scrim',
  };
  for (const [k, id] of Object.entries(ids)) els[k] = document.getElementById(id);
  els.callChipWave = els.callChip.firstElementChild;
  els.who = $('.who', els.room);
  initFt();

  pop = createAudioPopover({
    room: els.room, pop: els.pop, scrim: els.scrim, dock: els.dock,
    swapMic, applyOutputPrefs, peerName,
    streams: () => (C.mic ? { raw: C.mic.raw || C.mic.stream, out: C.mic.stream, ac: C.ac } : null),
    changed: renderDevCard,
  });
  onDevices(renderDevCard);

  els.btnMic.addEventListener('click', toggleMute);
  els.btnDeaf.addEventListener('click', toggleDeaf);
  const both = [els.btnMicOpts, els.btnDeafOpts];
  els.btnMicOpts.addEventListener('click', () => pop.open(els.btnMicOpts, both));
  els.btnDeafOpts.addEventListener('click', () => pop.open(els.btnDeafOpts, both));
  els.btnScreen.addEventListener('click', openShareDialog);
  els.btnAct.addEventListener('click', () => emit('open-activities'));
  els.btnPip.addEventListener('click', togglePip);
  els.btnPipV.addEventListener('click', togglePip);
  els.btnFull.addEventListener('click', toggleFull);
  els.btnGear.addEventListener('click', () => { import('./settings.js').then((m) => m.openSettings('voice')).catch(() => {}); });
  els.btnLeave.addEventListener('click', () => leaveRoom());
  els.btnBack.addEventListener('click', () => emit('room-back'));
  els.conn.addEventListener('click', showConnInfo);
  els.btnSec.addEventListener('click', showConnInfo);
  els.btnUnmuteVideo.addEventListener('click', () => { mixerUnlock(); els.video.muted = mixerActive() || C.deaf; els.video.play().catch(() => {}); els.btnUnmuteVideo.hidden = true; });
  bindMixPop();
  els.video.addEventListener('dblclick', toggleFull);
  els.btnShareStop.addEventListener('click', () => stopShare(true));
  els.btnShareSwitch.addEventListener('click', switchSource);
  els.btnShareAudio.addEventListener('click', () => { const sc = C.screen; if (sc && sc.a) { sc.a.enabled = !sc.a.enabled; renderShareInfo(); } });
  bindVolumes();

  // o formato do vídeo manda no tamanho do cartão; trocar de resolução não reinicia nada
  els.video.addEventListener('loadedmetadata', () => { setAspect(els.cinema, els.video); renderWatchInfo(); });
  els.video.addEventListener('resize', () => { setAspect(els.cinema, els.video); renderWatchInfo(); });
  els.sharePrev.addEventListener('loadedmetadata', () => setAspect(els.sharing, els.sharePrev));
  els.sharePrev.addEventListener('resize', () => setAspect(els.sharing, els.sharePrev));

  // controles em vidro (modo imersivo) somem sozinhos e voltam ao toque
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'touchstart']) els.room.addEventListener(ev, pokeUi, { passive: true });
  LAND.addEventListener('change', updateImmersive);
  document.addEventListener('fullscreenchange', updateImmersive);

  // apertar para falar / mutar (botão na tela, para o celular)
  const down = (e) => { e.preventDefault(); setHeld(true); };
  const up = () => setHeld(false);
  els.btnPtt.addEventListener('pointerdown', down);
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((n) => els.btnPtt.addEventListener(n, up));

  // atalho de teclado (só funciona com a aba em foco: limite dos navegadores)
  const editing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
  window.addEventListener('keydown', (e) => {
    if (!C.room || CFG.inputMode === 'voice' || e.code !== CFG.key || e.repeat || editing(e) || e.ctrlKey && e.code !== 'ControlLeft' && e.code !== 'ControlRight') return;
    setHeld(true);
  });
  window.addEventListener('keyup', (e) => { if (C.room && CFG.inputMode !== 'voice' && e.code === CFG.key) setHeld(false); });
  window.addEventListener('blur', () => { if (C.held) { clearTimeout(C.pttTimer); C.held = false; applyMic(); } });

  if ('mediaSession' in navigator) {
    try { navigator.mediaSession.setActionHandler('enterpictureinpicture', () => { if (C.remoteScreen) togglePip(); }); } catch {}
    try { navigator.mediaSession.setActionHandler('togglemicrophone', toggleMute); } catch {}
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      clearTimeout(C.releaseT);
      C.ac && C.ac.state === 'suspended' && C.ac.resume().catch(() => {});
      if (C.room) { renderMode(); if (C.micReleased) { C.micReleased = false; swapMic(); } else reviveMic(); }
    } else if (IOS && C.room && C.mic) {
      // No iPhone o sistema já cala o microfone de uma página escondida. Se ficarmos com ele aberto, outro navegador
      // (ou esta mesma ligação aberta em outro app) recebe um microfone mudo. Então soltamos e reabrimos na volta.
      clearTimeout(C.releaseT);
      C.releaseT = setTimeout(() => { if (document.visibilityState === 'hidden' && C.room && C.mic) releaseMic(); }, 700);
    }
  });
  window.addEventListener('pageshow', () => { if (C.room) reviveMic(); });
  document.addEventListener('pointerdown', () => {
    mixerUnlock();
    if (els.remoteMic.srcObject && els.remoteMic.paused) els.remoteMic.play().catch(() => {});
    if (C.ac && C.ac.state === 'suspended') C.ac.resume().catch(() => {});
  });
  // Só encerra se a página for descartada de verdade. Sair do app no iPhone (ou trocar de aba) também dispara
  // "pagehide", mas com persisted = true: a ligação precisa continuar e o microfone volta quando o app volta.
  window.addEventListener('pagehide', (e) => { if (e.persisted) return; try { C.signal && C.signal.close(); } catch {} });
  window.addEventListener('pageshow', (e) => { if (e.persisted && C.room && C.signal && C.signal.closed) { C.signal.closed = false; C.signal.fails = 0; C.signal.connect(); } });
  navigator.mediaDevices?.addEventListener?.('devicechange', () => { refreshDevices(false); emit('devices'); });

  // quando o perfil de alguém muda, ou o idioma, redesenha
  on('users', () => { renderPeople(); renderHeader(); });
  onLang(() => { labelVolumes(); renderCall(); pop && pop.refresh(); });
  applyOutputPrefs(); renderCall();
}
