'use strict';
// Utilidades pequenas usadas por todo o app. Nada aqui usa innerHTML com texto de usuário.

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SVGNS = 'http://www.w3.org/2000/svg';

/** Cria um elemento: el('div', {class:'x', text:'oi', onClick: fn}, filhos…) */
export function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, String(v));
  }
  const add = (c) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return n;
}

export function icon(id, cls = 'ico') {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('class', cls);
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(SVGNS, 'use');
  u.setAttribute('href', '#' + id);
  s.append(u);
  return s;
}
export function setIcon(btn, id) { const u = $('use', btn); if (u) u.setAttribute('href', '#' + id); }

export const store = {
  get(k, d) { try { const v = localStorage.getItem('tl.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tl.' + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem('tl.' + k); } catch {} },
};

export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* ───────────── avisos ───────────── */
export function toast(text, opts = {}) {
  const box = $('#toasts');
  if (!box) return;
  const t = el('div', { class: 'toast', role: 'status' }, el('span', { text }));
  if (opts.action) {
    t.append(el('button', { class: 'toast-act', type: 'button', text: opts.action.label, onClick: () => { opts.action.run(); t.remove(); } }));
  }
  box.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 180); }, opts.ms || 4200);
}

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = el('textarea', { class: 'sr-only' });
  ta.value = text; document.body.append(ta); ta.select();
  try { document.execCommand('copy'); } catch {}
  ta.remove();
  return Promise.resolve();
}

/* ───────────── avatares ───────────── */
export function colorFor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 55% 52%)`;
}
export const displayName = (u) => (u && (u.name || u.username)) || '?';

const DECO = {
  hearts: '<path fill="#ff5c8a" d="M80 8c-3-5-11-3-11 3 0 5 7 9 11 13 4-4 11-8 11-13 0-6-8-8-11-3z"/><path fill="#ff9ab8" d="M92 34c-2-3-7-2-7 2 0 3 4 5 7 8 3-3 7-5 7-8 0-4-5-5-7-2z" transform="scale(.7) translate(36 -2)"/><path fill="#ff5c8a" d="M10 86c-2-3-7-2-7 2 0 3 4 5 7 8 3-3 7-5 7-8 0-4-5-5-7-2z"/>',
  flowers: '<g transform="translate(14 14)"><circle r="3.2" fill="#ffd54a"/><g fill="#ff8fb8"><circle cx="0" cy="-6" r="4"/><circle cx="6" cy="-2" r="4"/><circle cx="4" cy="5" r="4"/><circle cx="-4" cy="5" r="4"/><circle cx="-6" cy="-2" r="4"/></g><circle r="3" fill="#ffd54a"/></g><g transform="translate(88 86) scale(.8)"><g fill="#fff"><circle cx="0" cy="-6" r="4"/><circle cx="6" cy="-2" r="4"/><circle cx="4" cy="5" r="4"/><circle cx="-4" cy="5" r="4"/><circle cx="-6" cy="-2" r="4"/></g><circle r="3.2" fill="#ffb300"/></g>',
  cat: '<path fill="#2b2635" d="M16 30L18 2l22 14z"/><path fill="#ff9ab8" d="M21 22l1-12 10 6z"/><path fill="#2b2635" d="M84 30L82 2 60 16z"/><path fill="#ff9ab8" d="M79 22l-1-12-10 6z"/>',
  witch: '<g transform="rotate(-14 50 14)"><path fill="#3b2a5a" d="M20 24c10-4 20-6 30-6s20 2 30 6c0 4-14 7-30 7s-30-3-30-7z"/><path fill="#4b3573" d="M34 22L52-6l8 26z" transform="translate(0 4)"/><path fill="#ff7a3d" d="M36 18h24v5H36z"/></g>',
  crown: '<path fill="#ffc83d" stroke="#e09b00" stroke-width="2" stroke-linejoin="round" d="M26 20l-4-16 14 9 14-12 14 12 14-9-4 16z"/><circle cx="50" cy="8" r="2.6" fill="#ff5c8a"/>',
  sparkles: '<path fill="#ffd54a" d="M86 6l3 9 9 3-9 3-3 9-3-9-9-3 9-3z"/><path fill="#fff" stroke="#ffd54a" stroke-width="1" d="M12 70l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/><path fill="#9ad7ff" d="M90 76l1.6 4.4 4.4 1.6-4.4 1.6L90 88l-1.6-4.4-4.4-1.6 4.4-1.6z"/>',
  bow: '<g transform="translate(18 10) rotate(-18)"><path fill="#ff6fa0" d="M0 0L-14-8v16zM0 0l14-8v16z"/><circle r="4" fill="#ff3d7f"/></g>',
};
export const DECORATIONS = Object.keys(DECO);

function decoSvg(name) {
  if (!DECO[name]) return null;
  const t = document.createElement('template');
  t.innerHTML = `<svg class="deco" viewBox="0 0 100 100" aria-hidden="true" focusable="false">${DECO[name]}</svg>`;
  return t.content.firstChild;
}

const okImg = (a) => typeof a === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(a);
export { okImg };

/** Avatar quadrado arredondado. size: xs sm md lg xl. */
export function avatar(user, size = 'md', opts = {}) {
  const u = user || {};
  const root = el('div', { class: `av av-${size}` });
  const img = el('div', { class: 'av-img' });
  if (okImg(u.avatar)) img.append(el('img', { src: u.avatar, alt: '', draggable: 'false' }));
  else {
    img.textContent = displayName(u).trim().charAt(0).toUpperCase() || '?';
    img.style.setProperty('--av', colorFor(u.id || u.username || displayName(u)));
  }
  root.append(img);
  if (opts.decoration !== false && u.decoration) { const d = decoSvg(u.decoration); if (d) root.append(d); }
  if (opts.status) {
    const st = u.online === false ? 'offline' : (u.status || 'online');
    root.append(el('i', { class: `st st-${st}`, title: st }));
  }
  return root;
}

export function fmtErr(e) { return (e && e.code) || 'error'; }

/** Redimensiona e comprime uma imagem para data URL (jpeg). */
export async function imageToDataUrl(file, { w, h, max, q = 0.82 }) {
  let bmp;
  if (window.createImageBitmap) bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  else {
    const url = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
    bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const sw = bmp.width, sh = bmp.height;
  const k = Math.max(w / sw, h / sh);
  const cw = w / k, ch = h / k;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  g.drawImage(bmp, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, w, h);
  let url = c.toDataURL('image/jpeg', q);
  while (url.length > max && q > 0.3) { q -= 0.08; url = c.toDataURL('image/jpeg', q); }
  if (url.length > max) throw new Error('imagem grande demais');
  return url;
}

export const isTouch = () => matchMedia('(pointer: coarse)').matches || /iPhone|iPad|Android/i.test(navigator.userAgent);

/** Celular em pé (≤820px) ou deitado (pouca altura): mesma regra do CSS. */
export const isCompact = () => matchMedia('(max-width: 820px), (orientation: landscape) and (max-height: 520px)').matches;
