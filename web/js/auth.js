'use strict';
// Tela cheia de entrar / criar conta: senha (com prehash), biometria (passkey) e a variante "Olá, <nome>".
import { $, $$, el, store, setIcon, avatar, isTouch } from './util.js';
import { api, prehash } from './api.js';
import { t, tErr, setLang, getLang } from './i18n.js';

let onAuthed = async () => {};
let status = { accounts: 0, max: 2, needsCode: false };
let mode = 'login';            // login | signup | bio
let bioOk = false;             // o aparelho tem biometria e o módulo de passkey carregou
let pk = null;                 // módulo js/passkey.js (opcional: o app funciona sem ele)

/* ───────────── biometria: qual rótulo e ícone usar ───────────── */
export function platformId() {
  const ua = navigator.userAgent || '';
  const plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  if (/iPhone|iPad|iPod/.test(ua) || (/Mac/.test(plat) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Mac/i.test(plat) || /Macintosh/.test(ua)) return 'mac';
  if (/Win/i.test(plat) || /Windows/.test(ua)) return 'win';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}
/** { key, label, icon }: Face ID (iPhone/iPad), Touch ID (Mac), Windows Hello (Windows) ou "biometria". */
export function bioMethod() {
  const p = platformId();
  if (p === 'ios') return { key: 'faceid', label: t('bio.faceid'), icon: 'i-faceid' };
  if (p === 'mac') return { key: 'touchid', label: t('bio.touchid'), icon: 'i-touch' };
  if (p === 'win') return { key: 'hello', label: t('bio.hello'), icon: 'i-faceid' };
  return { key: 'generic', label: t('bio.generic'), icon: 'i-touch' };
}
export async function loadPasskey() {
  if (pk) return pk;
  try { pk = await import('./passkey.js'); } catch { pk = null; }
  return pk;
}
async function detectBio() {
  const m = await loadPasskey();
  try { return !!(m && (await m.passkeySupported())); } catch { return false; }
}

/* ───────────── último usuário deste aparelho ───────────── */
export const lastUser = () => { const l = store.get('last', null); return l && typeof l.username === 'string' ? l : null; };
export function saveLast(user, patch = {}) {
  const prev = lastUser();
  const keepBio = prev && prev.username === user.username ? prev.bio : undefined;
  const avatarOk = typeof user.avatar === 'string' && user.avatar.length < 150000 ? user.avatar : null;
  store.set('last', { username: user.username, name: user.name || null, avatar: avatarOk, id: user.id, bio: keepBio, ...patch });
}

/* ───────────── desenhar ───────────── */
function setMsg(text) { $('#au-msg').textContent = text || ''; $('#au-bio-msg').textContent = text || ''; }
const spanOf = (btn) => btn.querySelector('span');

export function drawAuth() {
  const signup = mode === 'signup', bio = mode === 'bio';
  const last = lastUser();
  const m = bioMethod();
  $('#au-view-bio').hidden = !bio;
  $('#au-view-form').hidden = bio;
  $$('.langs [data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === getLang())));

  if (bio && last) {
    const who = { id: last.id, username: last.username, name: last.name, avatar: last.avatar };
    $('#au-avatar').replaceChildren(avatar(who, 'xl'));
    $('#au-hello').textContent = t('auth.hello', { name: last.name || last.username });
    $('#au-hello-sub').textContent = t('auth.bio.hint', { m: m.label });
    spanOf($('#au-bio-main')).textContent = t('auth.bio.continue', { m: m.label });
    setIcon($('#au-bio-main'), m.icon);
    return;
  }

  $('#auth-title').textContent = signup ? t('auth.signup.t') : t('auth.login.t');
  $('#auth-sub').textContent = signup ? t('auth.signup.d') : t('auth.login.d');
  if (cancelBtn && !signup) { $('#auth-title').textContent = t('acc.add'); $('#auth-sub').textContent = t('acc.add.d'); }
  $('#row-pass2').hidden = !signup;
  $('#row-code').hidden = !(signup && status.needsCode);
  $('#au-pass').autocomplete = signup ? 'new-password' : 'current-password';
  $('#au-hint').textContent = signup ? t('auth.hint') : '';
  const closed = signup && status.max && status.accounts >= status.max;
  $('#au-msg').textContent = closed ? t('err.signup_closed') : '';
  $('#au-go').textContent = signup ? t('auth.signup.go') : t('auth.login.go');
  $('#au-go').disabled = !!closed;
  const showBio = bioOk && !signup;
  $('#au-or').hidden = !showBio; $('#au-bio-alt').hidden = !showBio;
  spanOf($('#au-bio-alt')).textContent = t('auth.bio.go', { m: m.label });
  setIcon($('#au-bio-alt'), m.icon);
  $('#au-sw-q').textContent = signup ? t('auth.hasacc') : t('auth.noacc');
  $('#au-sw-go').textContent = signup ? t('auth.tab.login') : t('auth.signup.go');
  const shown = $('#au-pass').type === 'text';
  $('#au-show').textContent = shown ? t('auth.hide') : t('auth.show');
}

function setMode(next, { focus = true } = {}) {
  mode = next; setMsg('');
  drawAuth();
  if (focus && !isTouch() && mode !== 'bio') {
    const u = $('#au-user');
    (u.value ? $('#au-pass') : u).focus();
  }
}

/* ───────────── ações ───────────── */
async function submitPassword(e) {
  e.preventDefault();
  const msg = $('#au-msg'), btn = $('#au-go');
  msg.textContent = '';
  const username = $('#au-user').value.trim().toLowerCase().replace(/^@/, '');
  const pass = $('#au-pass').value;
  const signup = mode === 'signup';
  if (!/^[a-z0-9_.]{3,20}$/.test(username)) { msg.textContent = t('err.username'); return; }
  if (signup) {
    if (pass.length < 10) { msg.textContent = tErr('weak_password'); return; }
    if (pass !== $('#au-pass2').value) { msg.textContent = tErr('mismatch'); return; }
  } else if (!pass) { msg.textContent = t('err.pass'); return; }
  if (!window.isSecureContext || !crypto?.subtle) { msg.textContent = t('err.https'); return; }
  btn.disabled = true; const label = btn.textContent; btn.textContent = t('auth.wait');
  try {
    const pw = await prehash(pass);
    const body = { username, pw };
    if (signup && status.needsCode) body.code = $('#au-code').value.trim();
    const j = await api('POST', signup ? '/signup' : '/login', body);
    $('#au-pass').value = ''; $('#au-pass2').value = '';
    await onAuthed(j.user);
  } catch (err) {
    msg.textContent = err.code === 'rate_limited' && err.retryAfter ? t('err.rate_limited_s', { s: err.retryAfter }) : tErr(err.code);
  } finally { btn.disabled = false; btn.textContent = label; }
}

async function submitBio() {
  const last = lastUser();
  const fromBioView = mode === 'bio' && last;
  const btns = [$('#au-bio-main'), $('#au-bio-alt')];
  setMsg(''); btns.forEach((b) => { b.disabled = true; });
  try {
    const m = await loadPasskey();
    if (!m) throw Object.assign(new Error('not_supported'), { code: 'not_supported' });
    const typed = $('#au-user').value.trim().toLowerCase().replace(/^@/, '');
    const user = await m.loginWithPasskey(fromBioView ? last.username : (typed || undefined));
    $('#au-pass').value = '';
    saveLast(user, { bio: true });
    await onAuthed(user);
  } catch (err) {
    const code = err && err.code;
    if (code === 'no_passkey' && fromBioView) {
      saveLast({ ...last }, { bio: false });   // este aparelho não tem biometria para esse usuário: oferece a senha
      mode = 'login'; drawAuth(); $('#au-user').value = last.username;
      setMsg(tErr('no_passkey'));
    } else if (code === 'rate_limited' && err.retryAfter) setMsg(t('err.rate_limited_s', { s: err.retryAfter }));
    else setMsg(tErr(code));
  } finally { btns.forEach((b) => { b.disabled = false; }); }
}

/* ───────────── início ───────────── */
export function initAuth({ onAuthed: cb }) {
  onAuthed = cb;
  $('#auth-form').addEventListener('submit', submitPassword);
  $('#au-bio-main').addEventListener('click', submitBio);
  $('#au-bio-alt').addEventListener('click', submitBio);
  $('#au-use-pass').addEventListener('click', () => { const l = lastUser(); setMode('login'); if (l) $('#au-user').value = l.username; $('#au-pass').focus?.(); });
  $('#au-switch').addEventListener('click', () => { store.del('last'); $('#au-user').value = ''; setMode('login'); });
  $('#au-sw-go').addEventListener('click', () => setMode(mode === 'signup' ? 'login' : 'signup'));
  $('#au-show').addEventListener('click', () => {
    const p = $('#au-pass'), show = p.type === 'password';
    p.type = show ? 'text' : 'password'; $('#au-pass2').type = p.type;
    setIcon($('#au-eye'), show ? 'i-eye-off' : 'i-eye');
    $('#au-show').textContent = show ? t('auth.hide') : t('auth.show');
  });
  $$('.langs [data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
}

/** Mostra a tela de entrar. `want`: 'login' | 'signup' (opcional). `onCancel`: quando é para ADICIONAR conta (dá para voltar). */
let cancelBtn = null;
export async function showAuth(want, { onCancel } = {}) {
  $('#auth').hidden = false;
  if (cancelBtn) { cancelBtn.remove(); cancelBtn = null; }
  if (onCancel) {
    cancelBtn = el('button', { class: 'au-cancel', type: 'button', text: t('cancel'), onClick: () => { cancelBtn.remove(); cancelBtn = null; hideAuth(); onCancel(); } });
    $('#auth').append(cancelBtn);
    $('#au-user').value = '';
    status = await api('GET', '/status').catch(() => status);
    bioOk = await detectBio();
    setMode(want || 'login');
    return;
  }
  document.title = 'Echo';
  try { status = await api('GET', '/status'); } catch {}
  bioOk = await detectBio();
  const last = lastUser();
  if (last && !$('#au-user').value) $('#au-user').value = last.username;
  const wantBioView = !want && last && bioOk && last.bio !== false;
  setMode(want || (wantBioView ? 'bio' : 'login'));
}
export function hideAuth() {
  $('#auth').hidden = true;
  if (cancelBtn) { cancelBtn.remove(); cancelBtn = null; }
  $('#au-pass').value = ''; $('#au-pass2').value = ''; setMsg('');
}
export const authVisible = () => !$('#auth').hidden;
