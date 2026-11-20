'use strict';
// Mascote do Echo: o morceguinho (morcegos se guiam pelo eco). Feito com o Open Bot Avatar (MIT):
// a silhueta é um caminho SVG com os olhos; a biblioteca dá volume, pisca e acompanha o dedo/mouse.
import { mountAvatar } from './vendor/oba/dom/index.js';

export const BAT = {
  version: 1, id: 'morcego', name: 'Morcego',
  body: { path: 'M34 30L30 16C29.5 14 31 13 32.5 14L44 24C48 23.5 52 23.5 56 24L67.5 14C69 13 70.5 14 70 16L66 30C72 35 75 42 75 50C75 66 64 78 50 78C36 78 25 66 25 50C25 42 28 35 34 30ZM24 46C18 44 12 46 8 52C8 54 9 55 11 54C14 53 16 55 16 58C19 56 22 57 24 60ZM76 46C82 44 88 46 92 52C92 54 91 55 89 54C86 53 84 55 84 58C81 56 78 57 76 60Z' },
  eyes: { x: 50, y: 48, spacing: 17, scale: 1.15 },
};
export const BAT_COLOR = '#7C6CF5';

/** Morceguinho vivo, sem pesar: flutua e balança com CSS (só transform, a GPU faz sozinha);
 *  de tempos em tempos pisca e olha em volta; ao aparecer acena, e ao ser tocado fica feliz e segue o dedo. */
export function mascot(cls = '') {
  const box = document.createElement('span');
  box.className = 'mascot-box mascot-live ' + cls;
  box.setAttribute('aria-hidden', 'true');
  let av = null, t = 0, idle = 0;
  const nap = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      // só quando está na tela e o app aberto; fora disso o timer só espera (custa nada)
      if (box.isConnected && !document.hidden && box.getClientRects().length) wake(1400);
      nap();
    }, 5000 + Math.random() * 4000);
  };
  const wake = (ms) => {
    try {
      if (!av) av = mountAvatar(box, { definition: BAT, color: BAT_COLOR, followPointer: false, still: true, mood: 'idle', label: '' });
      av.update({ still: false, mood: 'happy', followPointer: true });
      clearTimeout(t); t = setTimeout(() => { try { av.update({ still: true, mood: 'idle', followPointer: false }); } catch { /* ok */ } }, ms);
    } catch (e) { console.warn('mascote', e); }
  };
  requestAnimationFrame(() => { wake(2200); box.classList.add('wave'); nap(); });
  box.addEventListener('animationend', (e) => { if (e.animationName === 'm-wave') box.classList.remove('wave'); });
  box.addEventListener('click', () => { wake(2500); box.classList.remove('wave'); void box.offsetWidth; box.classList.add('wave'); });
  return box;
}
