'use strict';
// Desenhar juntas: tela compartilhada. Sincroniza por traços (pontos normalizados 0-1) em lotes de ~30 fps.
import { getLang } from '../i18n.js';
import { el, icon } from '../util.js';

const L = {
  pt: {
    brush: 'Pincel', eraser: 'Borracha', undo: 'Desfazer', clear: 'Limpar tudo', clearSure: 'Limpar mesmo?', save: 'Baixar PNG',
    size: 'Espessura {n}', color: 'Cor {c}', drawing: '{name} está desenhando…', cleared: '{name} limpou a tela.',
    hint: 'As duas desenham ao mesmo tempo. Desfazer só apaga os seus traços.', canvas: 'Tela de desenho compartilhada', saved: 'Desenho salvo!',
  },
  en: {
    brush: 'Brush', eraser: 'Eraser', undo: 'Undo', clear: 'Clear all', clearSure: 'Really clear?', save: 'Download PNG',
    size: 'Size {n}', color: 'Color {c}', drawing: '{name} is drawing…', cleared: '{name} cleared the canvas.',
    hint: 'You both draw at the same time. Undo only removes your own strokes.', canvas: 'Shared drawing canvas', saved: 'Drawing saved!',
  },
};
const tr = (k, v) => {
  let s = (L[getLang()] || L.pt)[k] ?? L.pt[k] ?? k;
  if (v) for (const [a, b] of Object.entries(v)) s = s.replaceAll('{' + a + '}', b);
  return s;
};

const W = 1200, H = 800, BG = '#ffffff';
const COLORS = ['#111111', '#5b5b66', '#a8a8b3', '#ffffff', '#e5484d', '#ff7a3d', '#f5c542', '#30c46b',
  '#0f9d78', '#2bb8d8', '#3b82f6', '#6d4aff', '#b455e8', '#ff6fa8', '#8a5a3b', '#f2c9a0'];
const WIDTHS = [3, 8, 16, 32];
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const r4 = (v) => Math.round(v * 10000) / 10000;

export default {
  start(ctx) {
    const seat = ctx.seat;
    const peerName = ctx.names[1 - seat] || '?';
    const cleanups = [];
    let destroyed = false;

    // ---------- estado ----------
    let list = [];                 // traços em ordem de desenho
    const byId = new Map();
    let own = [];                  // ids dos meus traços (para desfazer)
    let lamport = 0, counter = 0;
    let tool = 'brush', color = COLORS[0], wIdx = 1;
    let cur = null, curPending = [], curPointer = null, flushT = null;
    let clearTimer = null, drawingT = null;

    // ---------- UI ----------
    const canvas = el('canvas', { class: 'g-draw-canvas', width: W, height: H, role: 'img', 'aria-label': tr('canvas') });
    const g = canvas.getContext('2d');
    g.fillStyle = BG; g.fillRect(0, 0, W, H);

    const toolBtns = {
      brush: el('button', { class: 'g-draw-tool', type: 'button', 'aria-pressed': 'true', onClick: () => setTool('brush') }, icon('i-pen'), el('span', { text: tr('brush') })),
      eraser: el('button', { class: 'g-draw-tool', type: 'button', 'aria-pressed': 'false', onClick: () => setTool('eraser') }, el('span', { class: 'g-draw-erasericon' }), el('span', { text: tr('eraser') })),
    };
    const widthBtns = WIDTHS.map((w, i) => {
      const dot = el('i', { class: 'g-draw-dot' });
      dot.style.width = dot.style.height = (4 + i * 5) + 'px';
      return el('button', { class: 'g-draw-wbtn', type: 'button', 'aria-label': tr('size', { n: i + 1 }), 'aria-pressed': String(i === wIdx), onClick: () => { wIdx = i; sync(); } }, dot);
    });
    const swatches = COLORS.map((c) => {
      const b = el('button', { class: 'g-draw-sw', type: 'button', 'aria-label': tr('color', { c }), 'aria-pressed': 'false', onClick: () => { color = c; tool = 'brush'; sync(); } });
      b.style.background = c;
      return b;
    });
    const undoBtn = el('button', { class: 'btn sm', type: 'button', onClick: undo }, icon('i-back'), el('span', { text: tr('undo') }));
    const clearLbl = el('span', { text: tr('clear') });
    const clearBtn = el('button', { class: 'btn sm', type: 'button', onClick: askClear }, icon('i-trash'), clearLbl);
    const saveBtn = el('button', { class: 'btn sm primary', type: 'button', text: tr('save'), onClick: save });
    const status = el('p', { class: 'g-draw-status muted', 'aria-live': 'polite', text: tr('hint') });

    const bar = el('div', { class: 'g-draw-bar' },
      el('div', { class: 'g-draw-group' }, toolBtns.brush, toolBtns.eraser),
      el('div', { class: 'g-draw-group' }, widthBtns),
      el('div', { class: 'g-draw-group g-draw-colors' }, swatches),
      el('div', { class: 'g-draw-group g-draw-actions' }, undoBtn, clearBtn, saveBtn));
    const wrap = el('div', { class: 'g-draw' }, bar, el('div', { class: 'g-draw-stage' }, canvas), status);
    ctx.root.replaceChildren(wrap);

    function setTool(t) { tool = t; sync(); }
    function sync() {
      for (const k of Object.keys(toolBtns)) toolBtns[k].setAttribute('aria-pressed', String(tool === k));
      widthBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(i === wIdx)));
      swatches.forEach((b, i) => b.setAttribute('aria-pressed', String(tool === 'brush' && COLORS[i] === color)));
      undoBtn.disabled = own.length === 0;
    }
    sync();

    // ---------- desenho ----------
    function paint(s) {
      const n = s.p.length / 2;
      if (n <= s.drawn) return;
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.strokeStyle = g.fillStyle = s.e ? BG : s.c;
      g.lineWidth = s.w;
      if (s.drawn === 0) {
        g.beginPath(); g.arc(s.p[0] * W, s.p[1] * H, s.w / 2, 0, Math.PI * 2); g.fill();
      }
      if (n > 1) {
        const st = Math.max(s.drawn - 1, 0);
        g.beginPath(); g.moveTo(s.p[st * 2] * W, s.p[st * 2 + 1] * H);
        for (let i = st + 1; i < n; i++) g.lineTo(s.p[i * 2] * W, s.p[i * 2 + 1] * H);
        g.stroke();
      }
      s.drawn = n;
    }
    function redraw() {
      g.fillStyle = BG; g.fillRect(0, 0, W, H);
      list.sort((a, b) => a.ts - b.ts || a.seat - b.seat);
      for (const s of list) { s.drawn = 0; paint(s); }
    }
    function addStroke(s) { list.push(s); byId.set(s.id, s); }

    // ---------- entrada local ----------
    function pos(e) {
      const r = canvas.getBoundingClientRect();
      return [r4(clamp01((e.clientX - r.left) / r.width)), r4(clamp01((e.clientY - r.top) / r.height))];
    }
    function pushPoint(e) {
      const [x, y] = pos(e);
      const n = cur.p.length;
      if (n && Math.abs(cur.p[n - 2] - x) * W < 0.6 && Math.abs(cur.p[n - 1] - y) * H < 0.6) return;
      cur.p.push(x, y); curPending.push(x, y);
    }
    function flush() {
      if (!cur || !curPending.length) return;
      const pts = curPending; curPending = [];
      for (let i = 0; i < pts.length; i += 3000) ctx.send({ g: 'draw', a: 'p', id: cur.id, p: pts.slice(i, i + 3000) });
    }
    function onDown(e) {
      if (cur || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault();
      cancelClear();
      lamport++;
      cur = { id: seat + '-' + (++counter), seat, ts: lamport, c: color, w: WIDTHS[wIdx], e: tool === 'eraser', p: [], drawn: 0 };
      curPointer = e.pointerId;
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      const [x, y] = pos(e);
      cur.p.push(x, y);
      addStroke(cur); own.push(cur.id); paint(cur); sync();
      ctx.send({ g: 'draw', a: 's', id: cur.id, ts: cur.ts, c: cur.c, w: cur.w, e: cur.e, p: [x, y] });
      flushT = setInterval(flush, 33);
    }
    function onMove(e) {
      if (!cur || e.pointerId !== curPointer) return;
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const ev of (evs.length ? evs : [e])) pushPoint(ev);
      paint(cur);
    }
    function onUp(e) {
      if (!cur || e.pointerId !== curPointer) return;
      if (e.type === 'pointerup') { pushPoint(e); paint(cur); }
      flush(); clearInterval(flushT); flushT = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
      cur = null; curPointer = null;
    }
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // ---------- ações ----------
    function undo() {
      if (cur) return;
      const id = own.pop();
      if (!id) return;
      const s = byId.get(id);
      if (s) { list = list.filter((x) => x !== s); byId.delete(id); redraw(); }
      ctx.send({ g: 'draw', a: 'u', id });
      sync();
    }
    function cancelClear() {
      clearTimeout(clearTimer); clearTimer = null;
      clearLbl.textContent = tr('clear'); clearBtn.classList.remove('danger');
    }
    function askClear() {
      if (!clearTimer) {
        clearLbl.textContent = tr('clearSure'); clearBtn.classList.add('danger');
        clearTimer = setTimeout(cancelClear, 3000);
        return;
      }
      cancelClear();
      if (cur) { clearInterval(flushT); flushT = null; cur = null; curPointer = null; }
      wipe();
      ctx.send({ g: 'draw', a: 'c' });
    }
    function wipe() {
      list = []; byId.clear(); own = [];
      redraw(); sync();
    }
    function save() {
      canvas.toBlob((blob) => {
        if (!blob || destroyed) return;
        const url = URL.createObjectURL(blob);
        const d = new Date(), p = (n) => String(n).padStart(2, '0');
        const a = el('a', { href: url, download: `desenho-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.png` });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        ctx.toast(tr('saved'));
      }, 'image/png');
    }
    function onKey(e) {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    }
    document.addEventListener('keydown', onKey);
    cleanups.push(() => document.removeEventListener('keydown', onKey));

    // ---------- mensagens do outro lado ----------
    function showPeerDrawing() {
      status.textContent = tr('drawing', { name: peerName });
      clearTimeout(drawingT);
      drawingT = setTimeout(() => { status.textContent = tr('hint'); }, 1500);
    }
    const off = ctx.onMsg((m) => {
      if (!m || m.g !== 'draw') return;
      if (m.a === 's') {
        if (typeof m.id !== 'string' || m.id.length > 24 || !Array.isArray(m.p) || byId.has(m.id)) return;
        const s = {
          id: m.id, seat: 1 - seat, ts: Number.isFinite(m.ts) ? m.ts : 0,
          c: COLOR_RE.test(m.c) ? m.c : '#111111', w: Math.min(64, Math.max(1, +m.w || 8)), e: !!m.e, p: [], drawn: 0,
        };
        lamport = Math.max(lamport, s.ts);
        for (let i = 0; i + 1 < m.p.length; i += 2) s.p.push(clamp01(+m.p[i] || 0), clamp01(+m.p[i + 1] || 0));
        if (!s.p.length) return;
        addStroke(s); paint(s); showPeerDrawing();
      } else if (m.a === 'p') {
        const s = byId.get(m.id);
        if (!s || !Array.isArray(m.p)) return;
        for (let i = 0; i + 1 < m.p.length && s.p.length < 200000; i += 2) s.p.push(clamp01(+m.p[i] || 0), clamp01(+m.p[i + 1] || 0));
        paint(s); showPeerDrawing();
      } else if (m.a === 'u') {
        const s = byId.get(m.id);
        if (s) { list = list.filter((x) => x !== s); byId.delete(m.id); redraw(); }
      } else if (m.a === 'c') {
        if (cur) { clearInterval(flushT); flushT = null; cur = null; curPointer = null; }
        wipe(); ctx.toast(tr('cleared', { name: peerName }));
      }
    });
    cleanups.push(off);

    return {
      destroy() {
        destroyed = true;
        clearInterval(flushT); clearTimeout(clearTimer); clearTimeout(drawingT);
        cleanups.forEach((f) => { try { f && f(); } catch {} });
        ctx.root.replaceChildren();
      },
    };
  },
};
