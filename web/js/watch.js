// Assistir junto. Regra de ouro: só QUEM CONTROLA manda comandos, e nunca por eco de eventos do player.
// Assim não existe o "pausa/continua toda hora" do GoLive. Padrão: uma pessoa controla e pode passar o controle.
import { el, icon, setIcon, toast } from './util.js';
import { getLang } from './i18n.js';

const YT = 'https://www.youtube-nocookie.com';
const L = {
  pt: { ph: 'Cole um link do YouTube ou de um vídeo (.mp4, .webm)', go: 'Assistir', file: 'Arquivo do computador', bad: 'Não consegui abrir esse link. Use YouTube ou um link direto de vídeo (.mp4/.webm) em https.',
    ctl: (n) => `Controle: ${n}`, you: 'você', pass: 'Passar controle', ask: 'Pedir controle', askSent: 'Pedido enviado.', cc: 'Legendas', swap: 'Trocar vídeo', all: 'Todos controlam', asked: 'pediu o controle', give: 'Passar',
    needfile: (n) => `Escolha o mesmo arquivo para assistir junto: ${n}`, pick: 'Escolher arquivo', tap: 'Toque para sincronizar', empty: 'Cole um link acima para começar', vol: 'Volume só para você',
    onlyctl: 'Só quem controla pode mexer. Peça o controle!', loaded: (n) => `${n} colocou um vídeo` },
  en: { ph: 'Paste a YouTube link or a video link (.mp4, .webm)', go: 'Watch', file: 'File from computer', bad: 'Could not open this link. Use YouTube or a direct https video link (.mp4/.webm).',
    ctl: (n) => `Controls: ${n}`, you: 'you', pass: 'Hand over control', ask: 'Ask for control', askSent: 'Request sent.', cc: 'Captions', swap: 'Change video', all: 'Everyone controls', asked: 'asked for control', give: 'Hand over',
    needfile: (n) => `Pick the same file to watch together: ${n}`, pick: 'Pick file', tap: 'Tap to sync', empty: 'Paste a link above to start', vol: 'Volume (only you)',
    onlyctl: 'Only the controller can use this. Ask for control!', loaded: (n) => `${n} loaded a video` },
};

const CH = /^[a-z0-9_]{2,25}$/;
const RESERVED = new Set(['videos', 'directory', 'search', 'settings', 'subscriptions', 'inventory', 'wallet', 'downloads', 'jobs', 'p', 'categories', 'following', 'browse']);
const LIVE_ORIGIN = { twitch: 'https://player.twitch.tv', kick: 'https://player.kick.com' };
export function parseSource(raw) {
  const s = String(raw || '').trim(); if (!s) return null;
  let u; try { u = new URL(/^[a-z]+:\/\//i.test(s) ? s : 'https://' + s); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const h = u.hostname.replace(/^www\.|^m\./, '');
  let id = null;
  if (h === 'youtu.be') id = u.pathname.slice(1, 12);
  else if (h === 'youtube.com' || h === 'music.youtube.com' || h === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else { const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/); if (m) id = m[1]; }
  }
  if (id !== null) { if (!/^[\w-]{11}$/.test(id)) return null; const st = parseInt(u.searchParams.get('t') || u.searchParams.get('start') || '0', 10) || 0; return { type: 'yt', id, start: st }; }
  // lives: Twitch e Kick (canal ao vivo; cada uma vê a live direto, sem precisar sincronizar)
  const ch = (u.pathname.split('/')[1] || '').toLowerCase();
  if ((h === 'twitch.tv' || h === 'player.twitch.tv') && CH.test(ch) && !RESERVED.has(ch)) return { type: 'twitch', ch };
  if (h === 'player.twitch.tv' && CH.test(u.searchParams.get('channel') || '')) return { type: 'twitch', ch: u.searchParams.get('channel').toLowerCase() };
  if ((h === 'kick.com' || h === 'player.kick.com') && CH.test(ch) && !RESERVED.has(ch)) return { type: 'kick', ch };
  if (u.href.length > 1500) return null;
  return { type: 'url', url: u.href };
}

export default {
  start(ctx) {
    const tr = (k, ...a) => { const v = (L[getLang()] || L.pt)[k]; return typeof v === 'function' ? v(...a) : v; };
    const S = { src: null, ctl: ctx.iStarted ? ctx.seat : 1 - ctx.seat, all: true, seq: 0, playing: false, ad: null, last: 0, need: null };
    const mine = () => ctx.seat;
    const can = () => S.ctl === mine() || S.all;
    const nameOf = (seat) => (seat === mine() ? tr('you') : ctx.names[seat]);

    const url = el('input', { class: 'g-watch-url', type: 'url', placeholder: tr('ph'), autocomplete: 'off', spellcheck: 'false' });
    const goBtn = el('button', { class: 'btn primary', type: 'button', text: tr('go') });
    const fileIn = el('input', { type: 'file', accept: 'video/*,audio/*', class: 'sr-only', tabindex: '-1' });
    const fileBtn = el('button', { class: 'btn', type: 'button', text: tr('file') });
    const bar = el('div', { class: 'g-watch-bar' }, url, goBtn, fileBtn, fileIn);
    // com um vídeo já escolhido, o campo do link vira um botão discreto "Trocar vídeo"
    const swapBtn = el('button', { class: 'g-watch-swap', type: 'button', text: tr('swap'), hidden: true, onClick: () => { bar.classList.remove('g-collapsed'); swapBtn.hidden = true; url.focus(); } });
    const screen = el('div', { class: 'g-watch-screen' });
    const empty = el('div', { class: 'g-watch-empty', text: tr('empty') });
    const shield = el('div', { class: 'g-watch-shield' });
    const tap = el('button', { class: 'btn primary g-watch-tap', type: 'button', text: tr('tap'), hidden: true });
    const msg = el('div', { class: 'g-watch-msg', hidden: true });
    screen.append(empty, shield, tap, msg);
    const play = el('button', { class: 'icon-btn g-watch-play', type: 'button', 'aria-label': 'play' }, icon('i-play'));
    const seek = el('input', { class: 'g-watch-seek', type: 'range', min: '0', max: '1000', value: '0', step: '1' });
    const time = el('span', { class: 'g-watch-time muted', text: '0:00' });
    const vol = el('input', { class: 'g-watch-vol', type: 'range', min: '0', max: '100', value: '100', title: tr('vol'), 'aria-label': tr('vol') });
    const full = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'fullscreen' }, icon('i-full'));
    const ccBtn = el('button', { class: 'icon-btn g-watch-cc', type: 'button', 'aria-label': tr('cc'), title: tr('cc'), 'aria-pressed': 'false', hidden: true }, el('b', { text: 'CC' }));
    const ctlRow = el('div', { class: 'g-watch-ctl' }, play, seek, time, vol, ccBtn, full);
    const who = el('span', { class: 'g-watch-who' });
    const passBtn = el('button', { class: 'btn sm', type: 'button' });
    const allLbl = el('label', { class: 'g-watch-all' }, el('input', { type: 'checkbox' }), el('span', { text: tr('all') }));
    const info = el('div', { class: 'g-watch-info' }, who, passBtn, allLbl);
    const askNote = el('div', { class: 'g-watch-ask', hidden: true });
    const needBox = el('div', { class: 'g-watch-need', hidden: true });
    ctx.root.append(bar, swapBtn, needBox, screen, ctlRow, info, askNote);
    const allChk = allLbl.firstChild;

    // ---------- adaptadores ----------
    function ytAdapter(id, start) {
      const f = el('iframe', { class: 'g-watch-frame', allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', referrerpolicy: 'strict-origin-when-cross-origin', title: 'YouTube' });
      f.src = `${YT}/embed/${id}?enablejsapi=1&controls=0&disablekb=1&rel=0&playsinline=1&modestbranding=1&iv_load_policy=3&fs=0&cc_load_policy=0&hl=${getLang() === 'en' ? 'en' : 'pt-BR'}&start=${start || 0}&origin=${encodeURIComponent(location.origin)}`;
      const st = { t: start || 0, d: 0, playing: false, ready: false, at: performance.now() };
      const cmd = (func, args = []) => { try { f.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), YT); } catch {} };
      const listen = () => { try { f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), YT); } catch {} };
      const onM = (e) => {
        if (e.origin !== YT || e.source !== f.contentWindow) return;
        let d; try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
        if (!d || !d.info) return;
        const i = d.info;
        if (typeof i.currentTime === 'number') { st.t = i.currentTime; st.at = performance.now(); }
        if (typeof i.duration === 'number' && i.duration > 0) st.d = i.duration;
        if (typeof i.playerState === 'number') st.playing = i.playerState === 1 || i.playerState === 3;
        if (!st.ready) { st.ready = true; clearInterval(iv); captions(false); cb.ready && cb.ready(); }
      };
      window.addEventListener('message', onM);
      const iv = setInterval(listen, 500);
      f.addEventListener('load', listen);
      const cb = {};
      // legenda começa desligada (o YouTube às vezes liga sozinho pela preferência da conta)
      let ccOn = false;
      const captions = (on) => {
        ccOn = on;
        if (on) { cmd('loadModule', ['captions']); cmd('setOption', ['captions', 'track', { languageCode: getLang() === 'en' ? 'en' : 'pt' }]); }
        else { cmd('unloadModule', ['captions']); cmd('unloadModule', ['cc']); }
      };
      setTimeout(() => { if (!ccOn) captions(false); }, 2500);
      return {
        cc: { get: () => ccOn, set: captions },
        node: f, onReady: (fn) => { cb.ready = fn; if (st.ready) fn(); },
        play: () => cmd('playVideo'), pause: () => cmd('pauseVideo'),
        seek: (t) => { st.t = t; st.at = performance.now(); cmd('seekTo', [t, true]); },
        time: () => st.t + (st.playing ? (performance.now() - st.at) / 1000 : 0), dur: () => st.d, isPlaying: () => st.playing,
        volume: (v) => cmd('setVolume', [Math.round(v * 100)]),
        destroy: () => { clearInterval(iv); window.removeEventListener('message', onM); f.remove(); },
      };
    }
    function liveAdapter(src) {
      const f = el('iframe', { class: 'g-watch-frame', allow: 'autoplay; fullscreen; picture-in-picture', referrerpolicy: 'strict-origin-when-cross-origin', title: src.type === 'twitch' ? 'Twitch' : 'Kick', allowfullscreen: true });
      f.src = src.type === 'twitch'
        ? `${LIVE_ORIGIN.twitch}/?channel=${encodeURIComponent(src.ch)}&parent=${encodeURIComponent(location.hostname)}&autoplay=true&muted=false`
        : `${LIVE_ORIGIN.kick}/${encodeURIComponent(src.ch)}?autoplay=true&muted=false`;
      const cb = {};
      f.addEventListener('load', () => cb.ready && cb.ready());
      return { live: true, node: f, onReady: (fn) => { cb.ready = fn; }, play() {}, pause() {}, seek() {}, time: () => 0, dur: () => 0, isPlaying: () => true, volume() {}, destroy: () => f.remove() };
    }
    function mediaAdapter(srcUrl, onErr) {
      const v = el('video', { class: 'g-watch-frame', playsinline: true, preload: 'auto', 'webkit-playsinline': 'true' });
      v.src = srcUrl;
      const cb = {};
      v.addEventListener('loadedmetadata', () => cb.ready && cb.ready());
      v.addEventListener('error', () => onErr && onErr());
      return {
        node: v, onReady: (fn) => { cb.ready = fn; if (v.readyState >= 1) fn(); },
        play: () => { const p = v.play(); if (p && p.catch) p.catch(() => { tap.hidden = false; }); }, pause: () => v.pause(),
        seek: (t) => { try { v.currentTime = t; } catch {} },
        time: () => v.currentTime || 0, dur: () => (isFinite(v.duration) ? v.duration : 0), isPlaying: () => !v.paused && !v.ended,
        volume: (x) => { v.volume = x; }, destroy: () => { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); },
      };
    }

    // ---------- núcleo ----------
    let blobUrl = null, fileObj = null;
    function load(src, fromRemote) {
      if (S.ad) { S.ad.destroy(); S.ad = null; }
      S.src = src; S.playing = false; tap.hidden = true; msg.hidden = true; needBox.hidden = true;
      empty.hidden = true;
      if (!src) { empty.hidden = false; updateUi(); return; }
      if (src.type === 'file') {
        if (!fileObj || fileObj.name !== src.name) { showNeed(src); updateUi(); return; }
        S.ad = mediaAdapter(blobUrl, badLink);
      } else if (src.type === 'yt') S.ad = ytAdapter(src.id, src.start);
      else if (src.type === 'twitch' || src.type === 'kick') S.ad = liveAdapter(src);
      else S.ad = mediaAdapter(src.url, badLink);
      screen.insertBefore(S.ad.node, shield);
      S.ad.volume(vol.value / 100);
      if (fromRemote && S.pend) { const p = S.pend; S.pend = null; S.ad.onReady(() => applyState(p)); }
      updateUi();
    }
    function badLink() { msg.textContent = tr('bad'); msg.hidden = false; }
    function showNeed(src) {
      S.need = src; needBox.hidden = false;
      const b = el('button', { class: 'btn primary', type: 'button', text: tr('pick'), onClick: () => fileIn.click() });
      needBox.replaceChildren(el('span', { text: tr('needfile', src.name) }), b);
    }
    function applyState(m) {
      const ad = S.ad; if (!ad) { S.pend = m; return; }
      S.playing = !!m.playing; S.rate = m.rate;
      const target = m.time + (m.playing ? Math.max(0, Math.min(2, (Date.now() - m.ts) / 1000)) : 0);
      if (Math.abs(ad.time() - target) > (m.hb ? 1.6 : 0.4)) ad.seek(target);
      if (m.playing) { ad.play(); setTimeout(() => { if (S.playing && S.ad && !S.ad.isPlaying() && S.src && S.src.type !== 'yt') tap.hidden = false; }, 1500); }
      else ad.pause();
      updateUi();
    }
    const nextSeq = () => { S.seq += 1; return S.seq * 2 + mine(); }; // desempate estável entre as duas
    const stamp = () => ({ m: 'st', playing: S.playing, time: S.ad ? S.ad.time() : 0, ts: Date.now(), seq: nextSeq() });
    function command(fn) {
      if (!can()) { ctx.toast(tr('onlyctl')); return; }
      const now = Date.now(); if (now - S.last < 350) return; S.last = now; // anti-spam
      fn(); ctx.send(stamp()); updateUi();
    }
    let lastSeq = 0;

    // ---------- UI ----------
    function fmt(s) { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); }
    function updateUi() {
      const c = can();
      who.textContent = tr('ctl', nameOf(S.ctl));
      setIcon(play, S.playing ? 'i-pause' : 'i-play');
      play.disabled = !c || !S.ad; seek.disabled = !c || !S.ad;
      goBtn.disabled = !c; fileBtn.disabled = !c; url.disabled = !c;
      passBtn.textContent = S.ctl === mine() ? tr('pass') : tr('ask');
      passBtn.hidden = S.all; allChk.checked = S.all; allChk.disabled = S.ctl !== mine() && !S.all ? true : false;
      ctlRow.classList.toggle('g-watch-locked', !c);
      ctlRow.hidden = !!(S.ad && S.ad.live);   // live: os controles são os do próprio player
      ccBtn.hidden = !(S.ad && S.ad.cc);
      if (S.src && !bar.classList.contains('g-collapsed') && document.activeElement !== url) { bar.classList.add('g-collapsed'); swapBtn.hidden = false; }
      info.hidden = !!S.all && S.ctl === mine();   // todos controlam: nada a mostrar
    }
    const tick = setInterval(() => {
      if (!S.ad) return;
      const d = S.ad.dur(), t = S.ad.time();
      time.textContent = d ? `${fmt(t)} / ${fmt(d)}` : fmt(t);
      if (!seeking && d) seek.value = String(Math.round((t / d) * 1000));
    }, 250);
    let seeking = false;
    seek.addEventListener('pointerdown', () => { seeking = true; });
    seek.addEventListener('change', () => {
      seeking = false;
      command(() => { const d = S.ad.dur(); if (d) S.ad.seek((seek.value / 1000) * d); });
    });
    play.addEventListener('click', () => command(() => { S.playing = !S.playing; S.playing ? S.ad.play() : S.ad.pause(); }));
    shield.addEventListener('click', () => { if (can() && S.ad) play.click(); else if (!can()) ctx.toast(tr('onlyctl')); });
    shield.addEventListener('dblclick', () => full.click());
    vol.addEventListener('input', () => { if (S.ad) S.ad.volume(vol.value / 100); });
    // tela cheia: de verdade onde o navegador deixa; no iPhone (que não deixa para players de outros sites)
    // o vídeo ocupa a tela inteira do app — girando o celular fica como tela cheia.
    const pseudoFs = (on) => { screen.classList.toggle('g-pseudo-fs', on); document.documentElement.classList.toggle('watch-fs', on); setIcon(full, on ? 'r-unfull' : 'i-full'); };
    full.addEventListener('click', () => {
      if (screen.classList.contains('g-pseudo-fs')) { pseudoFs(false); return; }
      if (document.fullscreenElement || document.webkitFullscreenElement) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
      const req = screen.requestFullscreen || screen.webkitRequestFullscreen;
      if (req && document.fullscreenEnabled !== false && !/iPhone|iPod/.test(navigator.userAgent)) { Promise.resolve(req.call(screen)).catch(() => pseudoFs(true)); return; }
      pseudoFs(true);
      try { screen.ownerDocument.defaultView.screen.orientation.lock('landscape').catch(() => {}); } catch {}
    });
    ccBtn.addEventListener('click', () => { if (!S.ad || !S.ad.cc) return; const on = !S.ad.cc.get(); S.ad.cc.set(on); ccBtn.setAttribute('aria-pressed', String(on)); });
    tap.addEventListener('click', () => { tap.hidden = true; if (S.ad && S.playing) S.ad.play(); });

    function openSource(src) {
      if (!can()) { ctx.toast(tr('onlyctl')); return; }
      load(src, false); ctx.send({ m: 'src', src, ctl: S.ctl, all: S.all, seq: nextSeq() });
    }
    const submit = () => {
      const s = parseSource(url.value);
      if (!s) { msg.textContent = tr('bad'); msg.hidden = false; return; }
      url.value = ''; openSource(s);
    };
    goBtn.addEventListener('click', submit);
    url.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    fileBtn.addEventListener('click', () => fileIn.click());
    fileIn.addEventListener('change', () => {
      const f = fileIn.files && fileIn.files[0]; fileIn.value = ''; if (!f) return;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = URL.createObjectURL(f); fileObj = f;
      if (S.need && S.need.name === f.name) { const s = S.need; S.need = null; const p = S.pend; load(s, true); if (p) S.pend = p; ctx.send({ m: 'want' }); return; }
      if (!can()) return;
      openSource({ type: 'file', name: f.name, size: f.size });
    });
    passBtn.addEventListener('click', () => {
      if (S.ctl === mine()) { S.ctl = 1 - mine(); ctx.send({ m: 'ctl', seat: S.ctl, seq: nextSeq() }); updateUi(); }
      else { ctx.send({ m: 'ask' }); toast(tr('askSent')); }
    });
    allChk.addEventListener('change', () => {
      if (S.ctl !== mine() && !S.all) { allChk.checked = false; return; }
      S.all = allChk.checked; ctx.send({ m: 'all', v: S.all }); updateUi();
    });

    // ---------- rede ----------
    const off = ctx.onMsg((m) => {
      if (!m || typeof m !== 'object') return;
      if (m.m === 'src') {
        if (m.src && (m.src.type === 'twitch' || m.src.type === 'kick') && !CH.test(m.src.ch || '')) return;
        if (m.src && ['yt', 'url', 'file', 'twitch', 'kick'].includes(m.src.type)) {
          if (m.src.type === 'yt' && !/^[\w-]{11}$/.test(m.src.id)) return;
          if (m.src.type === 'url' && !parseSource(m.src.url)) return;
          S.all = !!m.all; lastSeq = Math.max(lastSeq, m.seq || 0); S.pend = { m: 'st', playing: false, time: m.src.start || 0, ts: Date.now() }; load(m.src, true);
        }
      } else if (m.m === 'st') {
        if (!S.all && S.ctl === mine()) return;                 // só o controlador manda; ignora ecos
        if (m.seq && m.seq <= lastSeq && !m.hb) return;        // ordem total: descarta mensagens velhas
        lastSeq = Math.max(lastSeq, m.seq || 0); applyState(m);
      } else if (m.m === 'ctl') { S.ctl = m.seat === 0 || m.seat === 1 ? m.seat : S.ctl; askNote.hidden = true; updateUi(); }
      else if (m.m === 'all') { S.all = !!m.v; updateUi(); }
      else if (m.m === 'ask') {
        // aviso por cima de tudo (antes ficava numa área que podia estar fora da tela)
        toast(`${ctx.names[1 - mine()]} ${tr('asked')}`, { ms: 15000, action: { label: tr('give'), run: () => { S.ctl = 1 - mine(); ctx.send({ m: 'ctl', seat: S.ctl, seq: nextSeq() }); updateUi(); } } });
      } else if (m.m === 'want' && S.ctl === mine() && S.ad) ctx.send(stamp());
      else if (m.m === 'sync' && S.src) { ctx.send({ m: 'src', src: S.src, ctl: S.ctl, all: S.all, seq: nextSeq() }); setTimeout(() => ctx.send(stamp()), 800); }
    });
    // heartbeat do controlador: corrige deriva sem nunca alternar play/pause
    const hb = setInterval(() => { if (S.ctl === mine() && S.ad && S.playing) ctx.send({ ...stamp(), hb: true }); }, 3000);
    ctx.send({ m: 'sync' });
    updateUi();
    // aberto pelo "Assistir juntos" com um link já escolhido
    if (ctx.init && ctx.iStarted) setTimeout(() => openSource(ctx.init), 0);
    return { destroy() { document.documentElement.classList.remove('watch-fs'); clearInterval(tick); clearInterval(hb); off(); if (S.ad) S.ad.destroy(); if (blobUrl) URL.revokeObjectURL(blobUrl); } };
  },
};
