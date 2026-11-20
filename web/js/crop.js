'use strict';
// Recortar foto antes de usar (como no Twitter): arrastar para escolher a área, pinçar/rolar ou a barra para aproximar.
import { el, icon } from './util.js';
import { t, addDict } from './i18n.js';

addDict('pt', { 'crop.title': 'Ajustar foto', 'crop.use': 'Usar', 'crop.cancel': 'Cancelar', 'crop.zoom': 'Zoom', 'crop.hint': 'Arraste para escolher a parte da foto.' });
addDict('en', { 'crop.title': 'Adjust photo', 'crop.use': 'Use', 'crop.cancel': 'Cancel', 'crop.zoom': 'Zoom', 'crop.hint': 'Drag to choose the part of the photo.' });

async function loadBitmap(file) {
  if (window.createImageBitmap) { try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {} }
  const url = URL.createObjectURL(file);
  try { return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

/** Abre o recorte. Devolve a imagem recortada (data URL JPEG) ou null se cancelar. */
export async function cropImage(file, { w, h, round = false, max = 140000, q = 0.86 }) {
  const bmp = await loadBitmap(file);
  const iw = bmp.width, ih = bmp.height;
  return new Promise((resolve) => {
    // área de recorte na tela
    const VW = Math.min(320, innerWidth - 48);
    const VH = Math.round(VW * h / w);
    const base = Math.max(VW / iw, VH / ih);      // escala mínima: cobre a área toda
    let zoom = 1, x = 0, y = 0;                     // deslocamento do centro (px na tela)
    const canvas = el('canvas', { class: 'crop-cv' });
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = VW * dpr; canvas.height = VH * dpr;
    canvas.style.width = VW + 'px'; canvas.style.height = VH + 'px';
    const g = canvas.getContext('2d');
    const clamp = () => {
      const s = base * zoom, dw = iw * s, dh = ih * s;
      const mx = Math.max(0, (dw - VW) / 2), my = Math.max(0, (dh - VH) / 2);
      x = Math.min(mx, Math.max(-mx, x)); y = Math.min(my, Math.max(-my, y));
    };
    const draw = () => {
      clamp();
      const s = base * zoom;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#000'; g.fillRect(0, 0, VW, VH);
      g.drawImage(bmp, VW / 2 + x - iw * s / 2, VH / 2 + y - ih * s / 2, iw * s, ih * s);
    };
    const range = el('input', { type: 'range', min: '1', max: '4', step: '0.01', value: '1', 'aria-label': t('crop.zoom') });
    range.addEventListener('input', () => { zoom = +range.value; draw(); });
    const frame = el('div', { class: 'crop-frame' + (round ? ' round' : '') }, canvas, el('div', { class: 'crop-mask' }));
    frame.style.width = VW + 'px'; frame.style.height = VH + 'px';
    // arrastar / pinçar
    const pts = new Map(); let last = null, pinch = null;
    frame.addEventListener('pointerdown', (e) => { frame.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = { x: e.clientX, y: e.clientY }; if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom }; } });
    frame.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && pinch) { const [a, b] = [...pts.values()]; zoom = Math.min(4, Math.max(1, pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d)); range.value = String(zoom); draw(); return; }
      if (last) { x += e.clientX - last.x; y += e.clientY - last.y; last = { x: e.clientX, y: e.clientY }; draw(); }
    });
    const up = (e) => { pts.delete(e.pointerId); pinch = null; last = pts.size ? [...pts.values()][0] : null; };
    frame.addEventListener('pointerup', up); frame.addEventListener('pointercancel', up);
    frame.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.min(4, Math.max(1, zoom * (e.deltaY < 0 ? 1.08 : 0.93))); range.value = String(zoom); draw(); }, { passive: false });

    const scrim = el('div', { class: 'crop-scrim' });
    const done = (val) => { scrim.remove(); resolve(val); };
    const use = () => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const k = w / VW, s = base * zoom * k;
      const cg = c.getContext('2d');
      cg.fillStyle = '#000'; cg.fillRect(0, 0, w, h);
      cg.drawImage(bmp, w / 2 + x * k - iw * s / 2, h / 2 + y * k - ih * s / 2, iw * s, ih * s);
      let qq = q, url = c.toDataURL('image/jpeg', qq);
      while (url.length > max && qq > 0.3) { qq -= 0.08; url = c.toDataURL('image/jpeg', qq); }
      done(url.length > max ? null : url);
    };
    scrim.append(el('div', { class: 'crop-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('crop.title') },
      el('header', { class: 'crop-h' },
        el('button', { class: 'crop-x', type: 'button', text: t('crop.cancel'), onClick: () => done(null) }),
        el('b', { text: t('crop.title') }),
        el('button', { class: 'crop-ok', type: 'button', text: t('crop.use'), onClick: use })),
      frame,
      el('div', { class: 'crop-z' }, icon('i-search'), range),
      el('p', { class: 'crop-hint', text: t('crop.hint') })));
    document.body.append(scrim);
    draw();
  });
}
