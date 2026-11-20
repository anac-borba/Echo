'use strict';
// Configurações: conta, perfil, voz e vídeo, transmissão, aparência e idioma.
import { $, $$, el, icon, toast, avatar, displayName, copyText, imageToDataUrl, store, debounce, DECORATIONS, isCompact } from './util.js';
import { D, CFG, saveCfg, remember, emit } from './state.js';
import { api, prehash } from './api.js';
import { t, tErr, setLang, getLang, addDict } from './i18n.js';
import { PRESETS, SURFACES, swapMic, applyInputMode, applyOutputPrefs, renderCall, inCall } from './call.js';
import { openMic, startMeter, setMicVolume } from './audio.js';
import { cropImage } from './crop.js';
import { profileCard, friendLink } from './ui.js';
import { confirmBox } from './modal.js';
import { bioMethod, platformId, loadPasskey, lastUser, saveLast } from './auth.js';
import { isStandalone, canPrompt, promptInstall, manualHelp, onInstallChange } from './pwa.js';
import { notifySupported, notifyState, enableNotify, disableNotify, isIOS } from './notify.js';
import { app as desk } from './desktop.js';
import { NOVIDADES } from './novidades.js';

const root = () => $('#settings');
let current = null;
let testStop = null;

/* ───────────── temas ───────────── */
export const THEME_LIST = [
  ['auto', null, null, 'base'], ['noite', ['#0E0E10', '#F4F4F6', '#8B7BFF'], null, 'dark'], ['claro', ['#F2F2F7', '#1D1D1F', '#6D5DF2'], null, 'light'],
  ['rosa', ['#FFF0F6', '#4A1D36', '#E0246F'], null, 'light'], ['amarelo', ['#FFF8D6', '#3B3000', '#F2A100'], null, 'light'],
  ['carvao', ["#000000", "#F5F5F7", "#9D8CFF"], null, 'dark'],
  ['meianoite', ["#0B1020", "#EEF1FA", "#5B8CFF"], null, 'dark'],
  ['floresta', ["#0C1411", "#ECF5F0", "#3DD68C"], null, 'dark'],
  ['vinho', ["#160B10", "#F8EEF2", "#FF5C8A"], null, 'dark'],
  ['cafe', ["#15100C", "#F6EFE8", "#E0A060"], null, 'dark'],
  ['menta', ["#EEF8F3", "#10291D", "#15A36B"], null, 'light'],
  ['lavanda', ["#F3F0FF", "#241A4A", "#7458F0"], null, 'light'],
  ['areia', ["#F6F0E6", "#2E2416", "#B4692B"], null, 'light'],
  ['ceu', ["#EEF5FF", "#0F2140", "#2F7BF6"], null, 'light'],
  ['aurora', ["#08141A", "#EAF7F7", "#3EE0C0"], "radial-gradient(80% 60% at 0% 0%, rgba(40,200,170,.35), transparent 65%), radial-gradient(70% 60% at 100% 100%, rgba(120,80,255,.35), transparent 65%)", 'grad'],
  ['crepusculo', ["#160D18", "#FBEFF4", "#FF7A59"], "radial-gradient(80% 60% at 0% 0%, rgba(255,110,80,.32), transparent 65%), radial-gradient(70% 60% at 100% 100%, rgba(220,60,160,.32), transparent 65%)", 'grad'],
  ['oceano', ["#06121F", "#E8F3FF", "#33B5FF"], "radial-gradient(90% 60% at 50% 0%, rgba(30,140,255,.35), transparent 65%), radial-gradient(70% 50% at 100% 100%, rgba(0,220,220,.25), transparent 65%)", 'grad'],
  ['nebulosa', ["#0E0A1C", "#F3EFFF", "#C77DFF"], "radial-gradient(70% 60% at 10% 10%, rgba(200,80,255,.33), transparent 65%), radial-gradient(60% 50% at 90% 30%, rgba(255,90,170,.25), transparent 65%), radial-gradient(70% 60% at 50% 110%, rgba(70,90,255,.3), transparent 65%)", 'grad'],
  ['neon', ["#07070D", "#F2F2FF", "#FF2E9A"], "radial-gradient(60% 50% at 0% 100%, rgba(255,46,154,.28), transparent 65%), radial-gradient(60% 50% at 100% 0%, rgba(0,229,255,.25), transparent 65%)", 'grad'],
  ['pessego', ["#FFF2EC", "#3A1C14", "#F0643C"], "radial-gradient(80% 60% at 0% 0%, rgba(255,170,130,.55), transparent 65%), radial-gradient(70% 60% at 100% 100%, rgba(255,140,190,.45), transparent 65%)", 'grad'],
  ['algodao', ["#F6F2FF", "#2B1E46", "#E0559C"], "radial-gradient(80% 60% at 0% 0%, rgba(255,170,215,.55), transparent 65%), radial-gradient(70% 60% at 100% 100%, rgba(160,200,255,.55), transparent 65%)", 'grad'],
];
const LEGACY_THEME = { escuro: 'noite', joaninha: 'noite' };   // nomes de versões antigas
export function applyTheme(pref) {
  pref = LEGACY_THEME[pref] || pref;
  if (!THEME_LIST.some(([id]) => id === pref)) pref = 'noite';
  CFG.theme = pref; saveCfg(); store.set('theme', pref);
  let r = pref;
  if (pref === 'auto') r = matchMedia('(prefers-color-scheme: dark)').matches ? 'noite' : 'claro';
  document.documentElement.setAttribute('data-theme', r);
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const meta = $('meta[name="theme-color"]'); if (meta && bg) meta.setAttribute('content', bg);
}

/* ───────────── blocos de construção ─────────────
   Listas agrupadas (como os Ajustes da Apple): título pequeno, caixa com linhas separadas por um fio,
   nome à esquerda e o controle à direita. Escolhas viram linhas com marca de seleção, sem cartões. */
const group = (title, foot, ...rows) => el('section', { class: 'sg' }, title ? el('h3', { class: 'sg-h', text: title }) : null,
  el('div', { class: 'sg-box' }, ...rows), foot ? (typeof foot === 'string' ? el('p', { class: 'sg-foot', text: foot }) : el('div', { class: 'sg-foot' }, foot)) : null);
const row = (label, desc, control, opts = {}) => el(opts.tag || 'div', { class: 'sr' + (opts.cls ? ' ' + opts.cls : '') },
  opts.icon ? el('span', { class: 'sr-ic' }, icon(opts.icon)) : null,
  el('span', { class: 'sr-l' }, el('span', { class: 'sr-t', text: label }), desc ? el('small', { text: desc }) : null),
  control ? el('span', { class: 'sr-c' }, control) : null);
const toggle = (checked, onChange, label) => el('input', { type: 'checkbox', role: 'switch', class: 'tg', checked: !!checked, 'aria-label': label, onChange: (e) => onChange(e.target.checked) });
const switchRow = (label, desc, checked, onChange) => row(label, desc, toggle(checked, onChange, label), { tag: 'label' });
const rangeRow = (label, min, max, step, value, fmt, onInput) => {
  const out = el('output', { text: fmt(value) });
  const inp = el('input', { type: 'range', class: 'sl', min, max, step, value, 'aria-label': label, onInput: (e) => { const v = Number(e.target.value); out.textContent = fmt(v); paint(); onInput(v); } });
  const paint = () => inp.style.setProperty('--p', ((Number(inp.value) - Number(min)) / (Number(max) - Number(min)) * 100).toFixed(1) + '%');
  paint();
  return el('div', { class: 'sr sr-range' }, el('span', { class: 'sr-t', text: label }), inp, out);
};
const selectEl = (options, cur, onChange, label) => el('select', { class: 'sel', 'aria-label': label, onChange: (e) => onChange(e.target.value) },
  options.map(([v, l]) => el('option', { value: v, selected: String(v) === String(cur), text: l })));
const selectRow = (label, options, cur, onChange) => row(label, null, selectEl(options, cur, onChange, label));
/** Lista de escolha única: linhas com ✓ na escolhida. */
function pickList(options, cur, onChange) {
  const rows = options.map(([v, title, desc]) => {
    const b = el('button', { class: 'sr sr-pick', type: 'button', role: 'radio', 'aria-checked': String(String(v) === String(cur)) },
      el('span', { class: 'sr-l' }, el('span', { class: 'sr-t', text: title }), desc ? el('small', { text: desc }) : null),
      el('span', { class: 'sr-c' }, icon('i-check', 'ico chk')));
    b.addEventListener('click', () => { for (const r of rows) r.setAttribute('aria-checked', String(r === b)); onChange(v); });
    return b;
  });
  return el('div', { class: 'sr-group', role: 'radiogroup' }, ...rows);
}
/** Escolha visual em blocos (ícone, título, frase), para as escolhas mais importantes. */
function tiles(options, cur, onChange, cols) {
  const box = el('div', { class: 'stiles', role: 'radiogroup' });
  if (cols) box.style.setProperty('--cols', cols);
  const items = options.map(([v, ic, title, desc]) => {
    const b = el('button', { class: 'stile', type: 'button', role: 'radio', 'aria-checked': String(String(v) === String(cur)) },
      el('span', { class: 'stile-ic' }, typeof ic === 'string' && ic.startsWith('txt:') ? el('b', { text: ic.slice(4) }) : icon(ic)),
      el('span', { class: 'stile-t', text: title }), desc ? el('span', { class: 'stile-d', text: desc }) : null,
      el('span', { class: 'stile-ok' }, icon('i-check')));
    b.addEventListener('click', () => { for (const x of items) x.setAttribute('aria-checked', String(x === b)); onChange(v); });
    return b;
  });
  box.append(...items);
  return box;
}
const inputRow = (label, input) => { input.classList.add('sr-in'); return row(label, null, input, { tag: 'label', cls: 'sr-field' }); };
const btn = (text, onClick, cls = '') => el('button', { class: 'sbtn ' + cls, type: 'button', onClick }, text);

/* ───────────── biometria (passkeys) e instalação ───────────── */
function deviceLabel() {
  return { ios: /iPad/.test(navigator.userAgent) ? 'iPad' : 'iPhone', mac: 'Mac', win: 'Windows', android: 'Android' }[platformId()] || t('bio.set.device');
}
const fmtDate = (v) => { const d = new Date(v); return isNaN(d) ? '' : d.toLocaleDateString(getLang() === 'en' ? 'en' : 'pt-BR', { day: 'numeric', month: 'short', year: 'numeric' }); };

function bioGroup() {
  const m = bioMethod();
  const list = el('div', { class: 'sr-group' });
  const msg = el('p', { class: 'msg', role: 'status' });
  const add = el('button', { class: 'sr sr-act', type: 'button', hidden: true }, el('span', { class: 'sr-ic acc' }, icon('i-plus')), el('span', { class: 'sr-l' }, el('span', { class: 'sr-t', text: t('bio.set.add') })));
  const box = group(t('bio.set.t'), el('div', {}, el('p', { class: 'sg-foot-t', text: t('bio.set.d', { m: m.label }) }), msg), list, add);
  let pk = null, max = 5;
  const draw = async () => {
    let items = [];
    try { const j = await pk.listPasskeys(); items = j || []; } catch {}
    list.replaceChildren(...(items.length ? items.map((p) => row(p.name, p.lastUsedAt ? t('bio.set.last', { d: fmtDate(p.lastUsedAt) }) : t('bio.set.new', { d: fmtDate(p.createdAt) }),
      btn(t('bio.set.remove'), async () => {
        if (!(await confirmBox(t('bio.set.remove'), t('bio.set.remove.q', { name: p.name }), t('bio.set.remove')))) return;
        try { await pk.deletePasskey(p.id); msg.className = 'msg ok'; msg.textContent = t('bio.set.removed'); const l = lastUser(); if (l && items.length <= 1) saveLast({ ...l }, { bio: false }); draw(); } catch (e) { msg.className = 'msg'; msg.textContent = tErr(e.code); }
      }, 'quiet danger'), { icon: m.icon })) : [row(t('bio.set.none'), null, null, { cls: 'sr-empty' })]));
    add.disabled = items.length >= max;
  };
  (async () => {
    pk = await loadPasskey();
    let ok = false;
    try { ok = !!(pk && (await pk.passkeySupported())); } catch {}
    if (!ok) { list.replaceChildren(row(t('bio.set.unsupported'), null, null, { cls: 'sr-empty' })); return; }
    add.hidden = false;
    add.addEventListener('click', async () => {
      msg.className = 'msg'; msg.textContent = ''; add.disabled = true;
      try {
        await pk.registerPasskey(deviceLabel());
        msg.className = 'msg ok'; msg.textContent = t('bio.set.added'); saveLast(D.me, { bio: true });
      } catch (e) { msg.textContent = e.code === 'limit_reached' ? t('bio.set.limit') : tErr(e.code); }
      draw();
    });
    draw();
  })();
  return box;
}

function installGroup() {
  if (isStandalone()) return null;
  const body = el('div', { class: 'sr-group' });
  const box = group(t('pwa.t'), t('pwa.d'), body);
  const draw = () => {
    if (isStandalone()) { box.hidden = true; return; }
    if (canPrompt()) {
      body.replaceChildren(el('button', { class: 'sr sr-act', type: 'button', onClick: () => promptInstall() }, el('span', { class: 'sr-ic acc' }, icon('i-install')), el('span', { class: 'sr-l' }, el('span', { class: 'sr-t', text: t('pwa.go') }))));
      return;
    }
    const h = manualHelp();
    body.replaceChildren(row(t(h === 'ios' ? 'pwa.ios' : h === 'mac' ? 'pwa.mac' : 'pwa.other'), null, null, { cls: 'sr-note' }));
  };
  draw();
  const off = onInstallChange(() => { if (!box.isConnected) { off(); return; } draw(); });
  return box;
}

/* ───────────── página: conta ───────────── */
function pageAccount() {
  const me = D.me;
  const uMsg = el('p', { class: 'msg' });
  const uInp = el('input', { type: 'text', maxlength: '20', value: me.username, autocapitalize: 'none', spellcheck: 'false', autocomplete: 'username' });
  const uSave = btn(t('save'), async () => {
    uMsg.className = 'msg';
    try { const j = await api('PATCH', '/me', { username: uInp.value.trim().toLowerCase() }); remember(j.user); uMsg.className = 'msg ok'; uMsg.textContent = t('saved'); uSave.hidden = true; emit('me'); } catch (e) { uMsg.textContent = tErr(e.code); }
  }, 'primary');
  uSave.hidden = true;
  uInp.addEventListener('input', () => { uSave.hidden = uInp.value.trim().toLowerCase() === D.me.username; uMsg.textContent = ''; });
  const pMsg = el('p', { class: 'msg' });
  const cur = el('input', { type: 'password', autocomplete: 'current-password', placeholder: '••••••••' }), n1 = el('input', { type: 'password', autocomplete: 'new-password', placeholder: t('acc.pass.min') === 'acc.pass.min' ? '10+' : t('acc.pass.min') }), n2 = el('input', { type: 'password', autocomplete: 'new-password' });
  const pGo = btn(t('acc.pass.go'), async () => {
    pMsg.className = 'msg';
    if (n1.value.length < 10) { pMsg.textContent = tErr('weak_password'); return; }
    if (n1.value !== n2.value) { pMsg.textContent = tErr('mismatch'); return; }
    try {
      await api('POST', '/me/password', { pw: await prehash(cur.value), newPw: await prehash(n1.value) });
      cur.value = n1.value = n2.value = ''; pMsg.className = 'msg ok'; pMsg.textContent = t('saved');
    } catch (e) { pMsg.textContent = tErr(e.code); }
  });
  return [
    group(t('acc.user'), el('div', {}, el('p', { class: 'sg-foot-t', text: t('acc.user.d') }), uMsg), el('div', { class: 'sr sr-field' }, el('span', { class: 'sr-l' }, el('span', { class: 'sr-t', text: t('auth.user') })), el('span', { class: 'sr-c' }, (uInp.classList.add('sr-in'), uInp), uSave))),
    group(t('acc.pass'), el('div', { class: 'sg-foot-row' }, pMsg, pGo),
      inputRow(t('acc.pass.cur'), cur), inputRow(t('acc.pass.new'), n1), inputRow(t('auth.pass2'), n2)),
    bioGroup(),
    installGroup(),
    group(t('acc.sec'), null, el('ul', { class: 'sec-list' }, ['acc.sec.1', 'acc.sec.2', 'acc.sec.3', 'acc.sec.4'].map((k) => el('li', { text: t(k) })))),
    group(null, null, el('button', { class: 'sr sr-act danger', type: 'button', onClick: () => { closeSettings(); emit('logout'); } }, el('span', { class: 'sr-ic bad' }, icon('i-logout')), el('span', { class: 'sr-l' }, el('span', { class: 'sr-t', text: t('auth.logout') })))),
  ];
}

/* ───────────── página: perfil ───────────── */
const HEADER_COLORS = ['#FF8DB8', '#B79CFF', '#e8334a', '#ff8a3d', '#f2b01e', '#34c759', '#30b0c7', '#5b6cf0', '#1d1d1f'];
function pageProfile() {
  const me = D.me;
  const d = { name: me.name, bio: me.bio || '', statusText: me.statusText || '', avatar: me.avatar || null, accent: me.accent || null };
  const msg = el('p', { class: 'msg' });
  const save = btn(t('save'), async () => {
    msg.className = 'msg';
    try {
      const j = await api('PATCH', '/me', { name: d.name.trim() || me.username, bio: d.bio, statusText: d.statusText, avatar: d.avatar, accent: d.accent });
      remember(j.user); msg.className = 'msg ok'; msg.textContent = t('saved'); save.disabled = true; emit('me'); emit('users');
    } catch (e) { msg.textContent = tErr(e.code); }
  }, 'primary');
  save.disabled = true;
  const changed = () => { save.disabled = false; msg.textContent = ''; };
  const file = (accept, run) => el('input', { type: 'file', accept, class: 'sr-only', onChange: async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { if ((await run(f)) !== false) changed(); } catch { toast(t('err.image')); } } });
  const avBox = el('span', { class: 'pe-av' });
  const drawAv = () => avBox.replaceChildren(avatar({ ...me, ...d }, 'xl'));
  drawAv();
  const field = (label, input) => { input.classList.add('pe-in'); return el('label', { class: 'pe-row' }, el('span', { class: 'pe-l', text: label }), input); };
  const nameInp = el('input', { type: 'text', maxlength: '24', value: d.name, onInput: (e) => { d.name = e.target.value; changed(); } });
  const stInp = el('input', { type: 'text', maxlength: '60', value: d.statusText, placeholder: t('profile.statusText.ph'), onInput: (e) => { d.statusText = e.target.value; changed(); } });
  const bioInp = el('textarea', { maxlength: '190', rows: '2', placeholder: t('profile.bio'), onInput: (e) => { d.bio = e.target.value; changed(); } }); bioInp.value = d.bio;
  const dots = el('div', { class: 'pe-dots' });
  const drawDots = () => dots.replaceChildren(...HEADER_COLORS.map((c) => {
    const b = el('button', { class: 'pe-dot', type: 'button', 'aria-label': c, 'aria-pressed': String((d.accent || null) === c), onClick: () => { d.accent = d.accent === c ? null : c; drawDots(); drawAv(); changed(); } });
    b.style.setProperty('--c', c); return b;
  }));
  drawDots();
  return [el('div', { class: 'pe' },
    el('div', { class: 'pe-top' }, avBox,
      el('span', { class: 'pe-acts' },
        el('label', { class: 'pe-link' }, t('profile.photo.change'), file('image/*', async (f) => { const u = await cropImage(f, { w: 256, h: 256, round: true, max: 140000 }); if (!u) return false; d.avatar = u; drawAv(); })),
        d.avatar ? el('button', { class: 'pe-link mut', type: 'button', onClick: (e) => { d.avatar = null; drawAv(); changed(); e.currentTarget.remove(); } }, t('profile.remove')) : null)),
    el('div', { class: 'pe-list' }, field(t('profile.name'), nameInp), field(t('profile.statusText'), stInp), field(t('profile.bio'), bioInp)),
    el('div', { class: 'pe-color' }, el('span', { class: 'pe-l', text: t('profile.color') }), dots),
    el('div', { class: 'set-save' }, msg, save))];
}

/* ───────────── página: voz e vídeo ───────────── */
async function listDevices() {
  let devs = []; try { devs = await navigator.mediaDevices.enumerateDevices(); } catch {}
  return devs;
}
function deviceSelect(label, kind, key, after) {
  const sel = el('select', { class: 'sel', 'aria-label': label, onChange: (e) => { CFG[key] = e.target.value; saveCfg(); after && after(); } });
  const field = row(label, null, sel, { icon: kind === 'audioinput' ? 'i-mic' : 'i-speaker' });
  const fill = async () => {
    const devs = (await listDevices()).filter((x) => x.kind === kind && x.deviceId && x.deviceId !== 'default' && x.deviceId !== 'communications');
    sel.replaceChildren(el('option', { value: '', text: t('dev.default') }), ...devs.map((x, i) => el('option', { value: x.deviceId, text: x.label || `${label} ${i + 1}` })));
    sel.value = [...sel.options].some((o) => o.value === CFG[key]) ? CFG[key] : '';
    if (kind === 'audiooutput' && !('setSinkId' in HTMLMediaElement.prototype)) { field.hidden = true; }
  };
  fill(); on_devices(fill);
  return field;
}
let devCb = null; const on_devices = (fn) => { devCb = fn; };
export function onDevicesChanged() { devCb && devCb(); }

const refreshMic = debounce(() => { if (inCall()) swapMic(); }, 300);


/* ───────────── permissão do microfone ─────────────
   O navegador é quem guarda a permissão; o site não consegue "aceitar para sempre" sozinho.
   Aqui mostramos o estado atual e o caminho exato para deixar como "Permitir" em cada aparelho. */
addDict('pt', {
  'perm.h': 'Permissão do microfone', 'perm.st': 'Situação', 'perm.granted': 'Permitido', 'perm.prompt': 'Pergunta toda vez', 'perm.denied': 'Bloqueado', 'perm.unknown': 'O navegador não informa',
  'perm.ask': 'Permitir agora',
  'perm.how.safari-mac': 'No Safari: menu Safari › Ajustes › Sites › Microfone. Ache este site e escolha “Permitir”.',
  'perm.how.ios-app': 'No app instalado o iPhone pode perguntar a cada vez que o Echo é aberto: é uma regra do iOS para apps da Tela de Início. Pelo Safari dá para deixar fixo: Ajustes › Apps › Safari › Microfone › Permitir.',
  'perm.how.ios-safari': 'No iPhone: Ajustes › Apps › Safari › Microfone › Permitir. Ou, nesta página, toque em “aA” na barra de endereço › Ajustes do Site › Microfone › Permitir.',
  'perm.how.chrome': 'Clique no ícone ao lado do endereço (cadeado ou ajustes) › Microfone › Permitir. O Chrome lembra para sempre.',
  'perm.how.firefox': 'Clique no ícone do microfone na barra de endereço e marque “Lembrar esta decisão” ao permitir.',
  'perm.how.other': 'Nas configurações do navegador, procure Permissões do site › Microfone e escolha Permitir para este site.',
});
addDict('en', {
  'perm.h': 'Microphone permission', 'perm.st': 'Status', 'perm.granted': 'Allowed', 'perm.prompt': 'Asks every time', 'perm.denied': 'Blocked', 'perm.unknown': 'Browser doesn’t say',
  'perm.ask': 'Allow now',
  'perm.how.safari-mac': 'In Safari: Safari menu › Settings › Websites › Microphone. Find this site and choose “Allow”.',
  'perm.how.ios-app': 'In the installed app, iOS may ask each time Echo opens: that’s an iOS rule for Home Screen apps. In Safari you can make it stick: Settings › Apps › Safari › Microphone › Allow.',
  'perm.how.ios-safari': 'On iPhone: Settings › Apps › Safari › Microphone › Allow. Or tap “aA” in the address bar › Website Settings › Microphone › Allow.',
  'perm.how.chrome': 'Click the icon next to the address (lock or tune) › Microphone › Allow. Chrome remembers it.',
  'perm.how.firefox': 'Click the microphone icon in the address bar and tick “Remember this decision” when allowing.',
  'perm.how.other': 'In your browser settings, open Site permissions › Microphone and choose Allow for this site.',
});
function micHowKey() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) return isStandalone() ? 'ios-app' : 'ios-safari';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Chrome\/|Chromium\/|Edg\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari-mac';
  return 'other';
}
function micPermGroup() {
  const st = el('span', { class: 'perm-st', text: '…' });
  const ask = el('button', { class: 'sbtn', type: 'button', text: t('perm.ask'), hidden: true });
  const paint = (state) => {
    st.textContent = t('perm.' + (state || 'unknown'));
    st.dataset.s = state || 'unknown';
    ask.hidden = state === 'granted' || state === 'denied';
  };
  ask.addEventListener('click', async () => {
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((x) => x.stop()); paint('granted'); onDevicesChanged(); }
    catch { paint('denied'); }
  });
  paint(null);
  try {
    navigator.permissions.query({ name: 'microphone' }).then((p) => { paint(p.state); p.onchange = () => paint(p.state); }).catch(() => paint(null));
  } catch { paint(null); }
  const g = group(t('perm.h'), t('perm.how.' + micHowKey()), row(t('perm.st'), null, el('span', { class: 'perm-c' }, st, ask)));
  // minimalista: só aparece quando falta permissão
  const hide = (state) => { g.hidden = state === 'granted'; };
  g.hidden = true;
  try { navigator.permissions.query({ name: 'microphone' }).then((p) => { hide(p.state); p.addEventListener('change', () => hide(p.state)); }).catch(() => { g.hidden = false; }); } catch { g.hidden = false; }
  return g;
}

function pageVoice() {
  const meter = el('div', { class: 'meter' }, el('i'));
  const bar = meter.firstChild;
  const testBtn = btn(t('voice.test'), async () => {
    if (testStop) { testStop(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; let ac; try { ac = new AC({ sampleRate: 48000 }); } catch { ac = new AC(); }
      await ac.resume();
      const mic = await openMic(ac);
      const stopM = startMeter(ac, mic.stream, (lv) => { bar.style.setProperty('--v', Math.min(1, lv * 3.2).toFixed(3)); });
      testBtn.textContent = t('voice.test.stop');
      testStop = () => { stopM(); mic.stop(); ac.close().catch(() => {}); bar.style.setProperty('--v', '0'); testBtn.textContent = t('voice.test'); testStop = null; };
      onDevicesChanged();
    } catch { toast(t('mic.denied')); }
  });


  const keyBtn = el('button', { class: 'sbtn keybtn', type: 'button' });
  const showKey = () => { keyBtn.textContent = CFG.key.replace(/^Key/, '').replace(/^Digit/, ''); };
  showKey();
  keyBtn.addEventListener('click', () => {
    keyBtn.textContent = t('voice.key.press');
    const h = (e) => { e.preventDefault(); e.stopPropagation(); if (e.code !== 'Escape') { CFG.key = e.code; saveCfg(); } showKey(); window.removeEventListener('keydown', h, true); };
    window.addEventListener('keydown', h, true);
  });
  const keyRows = el('div', { class: 'sr-group' });
  const drawKey = () => {
    keyRows.hidden = CFG.inputMode === 'voice';
    keyRows.replaceChildren(
      row(t('voice.key'), t('voice.key.note'), keyBtn),
      ...(CFG.inputMode === 'ptt' ? [selectRow(t('voice.release'), [[0, t('off')], [250, '0,25 s'], [500, '0,5 s'], [1000, '1 s']], CFG.release, (v) => { CFG.release = Number(v); saveCfg(); })] : []));
  };
  drawKey();

  return [
    micPermGroup(),
    group(null, null,
      deviceSelect(t('voice.mic'), 'audioinput', 'micId', () => { if (inCall()) swapMic(); }),
      deviceSelect(t('voice.spk'), 'audiooutput', 'spkId', applyOutputPrefs)),
    group(t('ns.title'), null, pickList([['auto', t('ns.auto')], ['strong', t('ns.strong')], ['light', t('ns.light')], ['off', t('ns.off')]], CFG.nsMode || 'auto',
      (v) => { CFG.nsMode = v; saveCfg(); refreshMic(); })),
    group(t('voice.test'), null, el('div', { class: 'sr' }, el('span', { class: 'sr-l' }, meter), el('span', { class: 'sr-c' }, testBtn))),
    group(t('voice.vol'), null,
      rangeRow(t('voice.vol.mic'), 0, 1.5, 0.05, CFG.micVol ?? 1, (v) => Math.round(v * 100) + '%', (v) => { CFG.micVol = v; saveCfg(); setMicVolume({ own: v }); }),
      rangeRow(t('voice.vol.voice'), 0, 1, 0.05, CFG.volVoice, (v) => Math.round(v * 100) + '%', (v) => { CFG.volVoice = v; saveCfg(); applyOutputPrefs(); }),
      rangeRow(t('voice.vol.screen'), 0, 1, 0.05, CFG.volScreen, (v) => Math.round(v * 100) + '%', (v) => { CFG.volScreen = v; saveCfg(); applyOutputPrefs(); })),
    group(t('voice.input'), null, pickList([['voice', t('voice.im.voice')], ['ptt', t('voice.im.ptt')], ['ptm', t('voice.im.ptm')]], CFG.inputMode,
      (v) => { CFG.inputMode = v; saveCfg(); applyInputMode(); drawKey(); }), keyRows),
  ];
}

/* ───────────── página: transmissão ───────────── */
function pageStream() {
  const s = CFG.share;
  return [
    group(t('share.quality'), t('stream.tip'), pickList(Object.keys(PRESETS).map((id) => [id, t('preset.' + id), t('preset.' + id + '.d')]), s.preset, (v) => { s.preset = v; saveCfg(); })),
    el('section', { class: 'sg' }, el('h3', { class: 'sg-h', text: t('share.what') }),
      tiles(SURFACES.map((id) => [id, { monitor: 'i-screen', window: 'r-win', browser: 'r-tab' }[id] || 'i-screen', t('surf.' + id), t('surf.' + id + '.d')]), s.surface, (v) => { s.surface = v; saveCfg(); })),
    group(t('stream.audio'), null,
      switchRow(t('share.audio'), t('stream.audio.d'), s.audio, (v) => { s.audio = v; saveCfg(); }),
      selectRow(t('stream.kbps'), [[128, '128 kbps'], [192, '192 kbps'], [256, '256 kbps'], [320, '320 kbps']], s.audioKbps, (v) => { s.audioKbps = Number(v); saveCfg(); })),
    group(t('voice.video'), null,
      selectRow(t('voice.codec'), [['h264', t('codec.h264')], ['vp9', t('codec.vp9')], ['av1', 'AV1'], ['vp8', 'VP8'], ['auto', t('codec.auto')]], CFG.codec, (v) => { CFG.codec = v; saveCfg(); toast(t('codec.next')); }),
      switchRow(t('voice.stats'), t('voice.stats.d'), CFG.stats, (v) => { CFG.stats = v; saveCfg(); applyOutputPrefs(); })),
  ];
}

/* ───────────── página: aparência e idioma ───────────── */
/** Celular: como no Discord — prévia grande no meio, faixa de temas embaixo; tocar troca na hora. */
function appearanceMobile() {
  const list = THEME_LIST;
  const name = el('b', { class: 'thp-name' });
  const note = el('small', { class: 'thp-note', text: t('theme.note') });
  const people = [...D.friends].slice(0, 5);
  while (people.length < 5) people.push({ id: 'x' + people.length, name: ['Lia', 'Theo', 'Nina', 'Caio', 'Bia'][people.length] });
  const lines = [t('theme.pv.1'), t('theme.pv.2'), t('theme.pv.3'), t('theme.pv.4'), t('theme.pv.5')];
  const preview = el('div', { class: 'thp-card' },
    el('div', { class: 'thp-h' }, el('b', { text: t('nav.home') }), el('span', { class: 'thp-pill' }, icon('i-plus'))),
    el('div', { class: 'thp-online' }, ...people.slice(0, 4).map((u) => el('span', { class: 'thp-on' }, avatar(u, 'md', { status: true }), el('small', { text: displayName(u) })))),
    ...people.map((u, i) => el('div', { class: 'thp-row' + (i < 2 ? ' nw' : '') }, avatar(u, 'md'),
      el('div', null, el('b', { text: displayName(u) }), el('small', { text: lines[i] })), el('time', { text: ['2 min', '24 min', '1 h', '3 h', t('gm.yesterday') || 'ontem'][i] }))),
    el('div', { class: 'thp-bub' }, el('span', { class: 'them', text: t('theme.pv.b1') }), el('span', { class: 'me', text: t('theme.pv.b2') })));
  const strip = el('div', { class: 'thp-strip', role: 'radiogroup', 'aria-label': t('set.appearance') });
  const paint = () => {
    const cur = list.find((x) => x[0] === CFG.theme) || list[0];
    name.textContent = t('theme.' + cur[0]);
    [...strip.children].forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === CFG.theme)));
  };
  for (const [id, c, fx] of list) {
    const cc = c || ['#F2F2F7', '#1D1D1F', '#6D5DF2'];
    const sw = el('button', { class: 'thp-sw', type: 'button', role: 'radio', dataset: { id }, 'aria-label': t('theme.' + id), onClick: () => { applyTheme(id); paint(); sw.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); } });
    sw.style.background = id === 'auto' ? 'linear-gradient(90deg, #F2F2F7 50%, #0E0E10 50%)' : fx ? `${fx}, ${cc[0]}` : cc[0];
    sw.style.setProperty('--dot', cc[2]);
    strip.append(sw);
  }
  paint();
  requestAnimationFrame(() => { const on = strip.querySelector('[aria-checked="true"]'); if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' }); });
  return [el('div', { class: 'thp' }, preview, el('div', { class: 'thp-pick' }, strip, el('div', { class: 'thp-lbl' }, name, note)))];
}
function pageAppearance() {
  if (isCompact()) return appearanceMobile();
  // grupos: automático, escuros, claros e degradês — cada cartão mostra fundo, um balão e o destaque
  const card = ([id, c, fx]) => {
    const cc = c || ['#F2F2F7', '#1D1D1F', '#6D5DF2'];
    const prev = el('div', { class: 'theme-prev' }, el('i', { class: 'tp-b1' }), el('i', { class: 'tp-b2' }), el('i', { class: 'tp-dot' }));
    prev.style.setProperty('--c1', cc[0]); prev.style.setProperty('--c2', cc[1]); prev.style.setProperty('--c3', cc[2]);
    prev.style.background = id === 'auto' ? 'linear-gradient(90deg, #F2F2F7 50%, #0E0E10 50%)' : fx ? `${fx}, ${cc[0]}` : cc[0];
    return el('button', { class: 'theme-card', type: 'button', 'aria-pressed': String(CFG.theme === id), title: t('theme.' + id), onClick: () => { applyTheme(id); draw(); } }, prev, el('span', { text: t('theme.' + id) }));
  };
  const box = el('div', { class: 'theme-groups' });
  const draw = () => box.replaceChildren(...[['base', 'theme.g.base'], ['dark', 'theme.g.dark'], ['light', 'theme.g.light'], ['grad', 'theme.g.grad']].map(([k, label]) => {
    const list = THEME_LIST.filter((x) => (k === 'base' ? x[0] === 'auto' : x[3] === k));
    return el('div', { class: 'theme-grp' }, el('h4', { text: t(label) }), el('div', { class: 'themes' }, ...list.map(card)));
  }));
  draw();
  return [group(t('set.appearance'), t('theme.d'), el('div', { class: 'sr sr-stack' }, box))];
}
function pageLanguage() {
  return [el('section', { class: 'sg' }, el('h3', { class: 'sg-h', text: t('set.language') }), tiles([['pt', 'txt:Pt', 'Português', 'Brasil'], ['en', 'txt:En', 'English', 'United States']], getLang(), (v) => setLang(v), 2))];
}

/* ───────────── notificações ───────────── */
addDict('pt', {
  'set.notify': 'Notificações', 'set.d.notify': 'Avisos de mensagens e chamadas quando o Echo não está aberto.',
  'ntf.on': 'Receber notificações', 'ntf.on.d': 'Mensagens novas e quando alguém te ligar. Só chega quando o Echo não está na frente da tela.',
  'ntf.sounds': 'Sons dentro do app', 'ntf.msgsound': 'Som de mensagem nova', 'ntf.msgsound.d': 'Toca quando chega mensagem de outra conversa.',
  'ntf.test': 'Enviar teste', 'ntf.denied': 'As notificações estão bloqueadas para este site. Libere nos ajustes do navegador e volte aqui.',
  'ntf.ios': 'No iPhone, as notificações só funcionam com o Echo instalado na Tela de Início: no Safari, toque em Compartilhar › Adicionar à Tela de Início, abra o Echo por lá e ligue aqui.',
  'ntf.unsupported': 'Este navegador não suporta notificações.', 'ntf.ring': 'Chamadas: o celular mostra a notificação com vibração. O toque de chamada com som só toca com o Echo aberto.',
  'ntf.err': 'Não deu para ligar as notificações agora.',
  'ntf.desk': 'Mensagens e ligações aparecem como aviso do sistema quando o Echo não está na frente. No Mac, fechar a janela só esconde o Echo (os avisos continuam); para sair de vez, use Cmd+Q.',
});
addDict('en', {
  'set.notify': 'Notifications', 'set.d.notify': 'Message and call alerts when Echo is not open.',
  'ntf.on': 'Get notifications', 'ntf.on.d': 'New messages and incoming calls. Only sent when Echo is not on screen.',
  'ntf.sounds': 'In-app sounds', 'ntf.msgsound': 'New message sound', 'ntf.msgsound.d': 'Plays when a message arrives in another conversation.',
  'ntf.test': 'Send test', 'ntf.denied': 'Notifications are blocked for this site. Allow them in your browser settings and come back.',
  'ntf.ios': 'On iPhone, notifications only work with Echo installed on the Home Screen: in Safari tap Share › Add to Home Screen, open Echo from there and turn this on.',
  'ntf.unsupported': 'This browser does not support notifications.', 'ntf.ring': 'Calls: your phone shows the notification with vibration. The ringtone with sound only plays while Echo is open.',
  'ntf.err': "Couldn't turn on notifications right now.",
  'ntf.desk': 'Messages and calls show up as system alerts when Echo is in the background. On Mac, closing the window only hides Echo (alerts keep coming); press Cmd+Q to quit.',
});
function pageNotify() {
  const box = el('div', { class: 'sg-stack' });
  const draw = async () => {
    const st = await notifyState();
    const iosNeedsApp = isIOS() && !isStandalone();
    const tg = toggle(st === 'on', async (on) => {
      tg.disabled = true;
      try { const r = on ? await enableNotify() : await disableNotify(); if (on && r !== 'on') toast(r === 'denied' ? t('ntf.denied') : t('ntf.err')); }
      catch { toast(t('ntf.err')); }
      draw();
    }, t('ntf.on'));
    tg.disabled = st === 'unsupported' || st === 'denied' || iosNeedsApp;
    const foot = desk ? t('ntf.desk') : iosNeedsApp ? t('ntf.ios') : st === 'unsupported' ? t('ntf.unsupported') : st === 'denied' ? t('ntf.denied') : t('ntf.ring');
    box.replaceChildren(
      group(null, foot, row(t('ntf.on'), t('ntf.on.d'), tg, { tag: 'label' })),
      group(t('ntf.sounds'), null, switchRow(t('ntf.msgsound'), t('ntf.msgsound.d'), CFG.msgSound !== false, (v) => { CFG.msgSound = v; saveCfg(); })));
  };
  draw();
  return [box];
}

/* ───────────── atualizações e Echo para computador ───────────── */
addDict('pt', {
  'set.update': 'Atualizações', 'upd.site': 'Echo', 'upd.site.d': 'Confere se tem versão nova do Echo e instala na hora.',
  'upd.force': 'Procurar atualização', 'upd.forcing': 'Atualizando…', 'upd.app': 'Echo para computador', 'upd.ver': 'Versão {v}',
  'upd.check': 'Procurar atualização', 'upd.checking': 'Procurando…', 'upd.none': 'Você está na versão mais nova.', 'upd.dl': 'Baixando a versão {v}… {p}%',
  'upd.news': 'Novidades', 'upd.done': 'Echo atualizado.', 'upd.ready': 'A versão {v} está pronta.', 'upd.restart': 'Reiniciar e atualizar', 'upd.err': 'Não deu para atualizar: {e}',
  'desk.title': 'No computador', 'desk.ctl': 'Deixar pedirem controle', 'desk.ctl.d': 'Quem assiste a sua tela pode pedir para usar o mouse e o teclado. Cada pedido abre uma janela para você permitir.',
  'desk.login': 'Abrir ao ligar o computador', 'desk.key': 'Atalho para parar o controle', 'desk.get': 'Baixar o Echo para computador', 'desk.get.d': 'Som de cada app na transmissão e controle remoto.',
});
addDict('en', {
  'set.update': 'Updates', 'upd.site': 'Echo', 'upd.site.d': 'Checks for a newer Echo and installs it right away.',
  'upd.force': 'Check for updates', 'upd.forcing': 'Updating…', 'upd.app': 'Echo for desktop', 'upd.ver': 'Version {v}',
  'upd.check': 'Check for updates', 'upd.checking': 'Checking…', 'upd.none': 'You have the newest version.', 'upd.dl': 'Downloading version {v}… {p}%',
  'upd.news': "What's new", 'upd.done': 'Echo updated.', 'upd.ready': 'Version {v} is ready.', 'upd.restart': 'Restart and update', 'upd.err': "Couldn't update: {e}",
  'desk.title': 'On this computer', 'desk.ctl': 'Allow control requests', 'desk.ctl.d': 'People watching your screen can ask to use your mouse and keyboard. Each request opens a window for you to allow.',
  'desk.login': 'Open at login', 'desk.key': 'Shortcut to stop control', 'desk.get': 'Get Echo for desktop', 'desk.get.d': 'Per-app sound when sharing and remote control.',
});
/** Procura a versão nova do site. Sem novidade: só avisa (sem recarregar). Com novidade: instala, recarrega e
 *  volta para esta mesma tela com o aviso "Echo atualizado". Devolve 'none' | 'updating'. */
export async function forceSiteUpdate() {
  let reg = null;
  try { reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration()); } catch { /* sem service worker */ }
  if (reg) {
    try { await reg.update(); } catch { /* sem internet: trata como "nada novo" */ }
    const nw = reg.installing || reg.waiting;
    // sem controlador = primeira visita (o service worker está só se instalando): não é versão nova
    if (!nw || !navigator.serviceWorker.controller) return 'none';
    await new Promise((ok) => {
      if (nw.state === 'activated') { ok(); return; }
      const to = setTimeout(ok, 15000);
      nw.addEventListener('statechange', () => { if (nw.state === 'activated' || nw.state === 'redundant') { clearTimeout(to); ok(); } });
      try { nw.postMessage({ type: 'skip-waiting' }); } catch { /* ok */ }
    });
  }
  try { sessionStorage.setItem('echo.updated', 'update'); } catch { /* ok */ }
  location.reload();
  return 'updating';
}
/** Depois de recarregar por causa de uma atualização: avisa e reabre Atualizações. */
export function afterSiteUpdate() {
  let page = null;
  try { page = sessionStorage.getItem('echo.updated'); sessionStorage.removeItem('echo.updated'); } catch { /* ok */ }
  if (!page) return;
  toast(t('upd.done'));
  openSettings(page, true);
}
/* Novidades: cada item com um clipe numa moldura de celular. O vídeo só toca quando aparece na tela. */
function newsBox() {
  const fmt = (d) => new Date(d + 'T12:00:00').toLocaleDateString(getLang() === 'en' ? 'en' : 'pt-BR', { day: 'numeric', month: 'long' });
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => {
    const v = e.target; if (e.isIntersecting) { v.play().catch(() => {}); } else v.pause();
  }), { threshold: 0.4 }) : null;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const box = el('div', { class: 'news' });
  for (const rel of NOVIDADES) {
    box.append(el('h3', { class: 'news-d', text: fmt(rel.date) }));
    for (const it of rel.items) {
      let media = null;
      if (it.clip) {
        const v = el('video', { class: 'news-v', src: it.clip, muted: true, loop: true, playsinline: true, preload: 'metadata', 'aria-hidden': 'true', disablepictureinpicture: true });
        v.muted = true; v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
        if (!still && io) io.observe(v);
        media = el('div', { class: 'news-phone' }, v);
      }
      box.append(el('article', { class: 'news-it' + (media ? ' has-clip' : '') }, media, el('div', { class: 'news-tx' }, el('b', { text: it.t }), el('p', { text: it.d }))));
    }
  }
  return group(t('upd.news'), null, box);
}
let updUnsub = false;
function pageUpdate() {
  const out = [];
  const siteBtn = el('button', { class: 'btn sm', type: 'button', onClick: async () => {
    siteBtn.disabled = true; siteBtn.textContent = t('upd.checking');
    const r = await forceSiteUpdate();
    if (r === 'updating') { siteBtn.textContent = t('upd.forcing'); return; }
    siteBtn.disabled = false; siteBtn.textContent = t('upd.force'); toast(t('upd.none'));
  } }, t('upd.force'));
  out.push(group(t('set.update'), null, row(t('upd.site'), t('upd.site.d'), siteBtn)));
  out.push(newsBox());
  if (desk) {
    const status = el('small', { text: '' });
    const act = el('button', { class: 'btn sm', type: 'button' }, t('upd.check'));
    const title = el('span', { class: 'sr-t', text: t('upd.app') });
    const show = (s) => {
      if (!s) return;
      if (s.version) title.textContent = t('upd.app') + ' · ' + t('upd.ver', { v: s.version });
      const st = s.state;
      status.textContent = st === 'checking' ? t('upd.checking') : st === 'none' ? t('upd.none') : st === 'downloading' ? t('upd.dl', { v: s.next || '', p: s.progress || 0 }) : st === 'ready' ? t('upd.ready', { v: s.next || '' }) : st === 'error' ? t('upd.err', { e: s.error || '' }) : '';
      act.textContent = st === 'ready' ? t('upd.restart') : t('upd.check');
      act.disabled = st === 'checking' || st === 'downloading';
      act.onclick = () => (st === 'ready' ? desk.installUpdate() : desk.checkUpdate().then(show));
    };
    if (!updUnsub) { updUnsub = true; desk.onUpdate((s) => { if (current === 'update') show(s); }); }
    desk.info().then((i) => i && show({ version: i.version, state: 'idle' }));
    desk.checkUpdate().then(show);
    out.push(group(null, null, el('div', { class: 'sr' }, el('span', { class: 'sr-l' }, title, status), el('span', { class: 'sr-c' }, act))));
    const box = el('div', {});
    desk.getSettings().then((s) => {
      if (!s) return;
      box.replaceChildren(group(t('desk.title'), null,
        switchRow(t('desk.ctl'), t('desk.ctl.d'), s.controlAllowed, (v) => desk.setSetting('controlAllowed', v)),
        switchRow(t('desk.login'), null, s.openAtLogin, (v) => desk.setSetting('openAtLogin', v)),
        row(t('desk.key'), null, el('span', { class: 'sr-val', text: 'Ctrl+Alt+Esc' }))));
    });
    out.push(box);
  } else if (!isCompact()) {
    out.push(group(null, null, row(t('desk.get'), t('desk.get.d'), el('a', { class: 'btn sm', href: 'https://github.com/anac-borba/echo/releases/latest', target: '_blank', rel: 'noopener' }, t('desk.get')))));
  }
  return out;
}

/* ───────────── abrir / fechar ───────────── */
const PAGES = [
  ['account', 'i-user', 'set.account', pageAccount], ['profile', 'i-pen', 'set.profile', pageProfile],
  ['voice', 'i-mic', 'set.voice', pageVoice], ['stream', 'i-screen', 'set.stream', pageStream], ['notify', 'i-bell', 'set.notify', pageNotify],
  ['appearance', 'i-palette', 'set.appearance', pageAppearance], ['language', 'i-globe', 'set.language', pageLanguage],
  ['update', 'i-download', 'set.update', pageUpdate],
];

/** Redesenha a página atual (ex.: depois de trocar o idioma), sem animação. */
export function refreshSettings() { if (!root().hidden) openSettings(current, true); }

/* Movimento próprio (sem View Transition, que o iPhone até o iOS 17 e o Chrome não fazem direito):
   abrir = a folha sobe; fechar = desce; trocar de página no celular = a nova empurra da direita e a de antes
   fica por baixo andando para a esquerda (voltar: o contrário). Só transform e opacity. */
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function play(node, name, done) {
  node.dataset.anim = name; void node.offsetWidth;
  const list = node.getAnimations ? node.getAnimations() : [];
  const end = () => { if (node.dataset.anim === name) delete node.dataset.anim; done && done(); };
  if (!list.length) { end(); return; }
  Promise.all(list.map((a) => a.finished)).then(end, end);
}
function ghostOf(r) {
  // a página de antes vira uma "foto" viva (os mesmos nós) numa camada igual à das Configurações
  const g = el('div', { class: r.className + ' set-ghost', 'aria-hidden': 'true' });
  if (r.dataset.page) g.dataset.page = r.dataset.page;
  g.append(...r.childNodes);
  document.body.append(g);
  return g;
}
let closing = false;
export function closeSettings() {
  if (testStop) testStop();
  const r = root();
  const done = () => { closing = false; r.hidden = true; delete r.dataset.anim; r.replaceChildren(); current = null; devCb = null; };
  document.removeEventListener('keydown', onKey);
  if (r.hidden) { done(); return; }
  if (reduce()) { done(); return; }
  closing = true;
  play(r, 'out', done);
}
function onKey(e) { if (e.key === 'Escape' && !$('#dlg-modal').open) closeSettings(); }

export function openSettings(page, noAnim) {
  const r = root();
  // abrir: cresce do centro; trocar de página no celular: desliza
  let enter = null, ghost = null;
  if (!noAnim && !reduce()) {
    if (r.hidden || closing) enter = 'in';
    else if (isCompact() && (page || null) !== current) { enter = page ? 'push' : 'pop'; ghost = ghostOf(r); }
  }
  closing = false;
  const mobile = isCompact();
  if (!page && !mobile) page = 'account';
  current = page || null;
  if (testStop) testStop();
  devCb = null;
  r.hidden = false;
  if (page) r.dataset.page = page; else delete r.dataset.page;
  // navegação minimalista: só o nome de cada página (e o valor escolhido, quando ajuda), sem ícones; "Sair" no fim
  const val = (id) => (id === 'appearance' ? t('theme.' + (CFG.theme || 'noite')) : id === 'language' ? (getLang() === 'en' ? 'English' : 'Português') : '');
  const nav = el('div', { class: 'set-nav' }, el('div', { class: 'set-nav-in' }, el('h2', { text: t('set.title') }),
    el('div', { class: 'set-list' }, PAGES.map(([id, , label]) => el('button', { class: 'set-item', type: 'button', dataset: { p: id }, 'aria-current': current === id ? 'true' : null, onClick: () => openSettings(id) },
      el('span', { class: 'lbl', text: t(label) }), val(id) ? el('span', { class: 'val', text: val(id) }) : null, icon('i-chev', 'ico chev')))),
    el('button', { class: 'set-out', type: 'button', onClick: () => { closeSettings(); emit('logout'); } }, t('auth.logout'))));
  const def = current && PAGES.find((p) => p[0] === current);
  // Barra de cima: no computador só o X (canto); no celular fica fixa com Voltar · título · X e o conteúdo rola embaixo.
  const bar = el('div', { class: 'set-bar' },
    current ? el('button', { class: 'btn sm back-set', type: 'button', onClick: () => openSettings(null) }, icon('i-back'), t('back')) : null,
    el('span', { class: 'set-title', text: def ? t(def[2]) : t('set.title') }),
    el('button', { class: 'icon-btn set-close', type: 'button', 'aria-label': t('close'), onClick: closeSettings }, icon('i-x')));
  const main = el('div', { class: 'set-main' });
  if (def) main.append(el('div', { class: 'set-page', dataset: { p: def[0] } },
    el('header', { class: 'set-hero' }, el('h1', { text: t(def[2]) })),
    ...def[3]()));
  r.replaceChildren(bar, nav, main);
  document.removeEventListener('keydown', onKey); document.addEventListener('keydown', onKey);
  if (enter === 'in') play(r, 'in');
  else if (ghost) {
    play(ghost, enter === 'push' ? 'under' : 'leave', () => ghost.remove());
    play(r, enter);
  }
}
export { copyText, friendLink, displayName, $$, renderCall };
