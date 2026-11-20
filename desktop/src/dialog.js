'use strict';
// Janelas pequenas do controle remoto: "Deixar pedirem controle?", "Fulana quer usar seu computador" e a pílula.
const root = document.getElementById('root');
const h = (tag, attrs, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v); else n.setAttribute(k, v); } for (const c of kids) if (c != null) n.append(c); return n; };
const check = () => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('width', '20'); s.setAttribute('height', '20'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = '<path d="M5 12l5 5 9-10" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'; return s; };
const mouseIcon = () => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('width', '30'); s.setAttribute('height', '30'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = '<rect x="6" y="3" width="12" height="18" rx="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'; return s; };
function toggle(label, on) {
  const b = h('button', { type: 'button', class: 't', role: 'switch', 'aria-checked': String(on), 'aria-label': label }, h('i'));
  b.addEventListener('click', () => b.setAttribute('aria-checked', String(b.getAttribute('aria-checked') !== 'true')));
  return b;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.dlg.answer(null); });

(async () => {
  const d = await window.dlg.data();
  if (!d) return;
  if (d.kind === 'ativar') {
    root.append(h('div', { class: 'd left' },
      h('span', { class: 'ic' }, mouseIcon()),
      h('h1', {}, 'Deixar pedirem controle?'),
      h('p', {}, 'Quem está na ligação poderá pedir para usar o mouse e o teclado da tela que você transmite.'),
      h('ul', { class: 'ok' },
        h('li', {}, check(), h('span', {}, 'Cada pedido abre uma janela. Só começa se você tocar em Permitir.')),
        h('li', {}, check(), h('span', {}, 'Para parar na hora: Ctrl+Alt+Esc ou o botão Parar.')),
        h('li', {}, check(), h('span', {}, 'Dá para desligar quando quiser em Configurações.'))),
      h('div', { class: 'b2' },
        h('button', { type: 'button', class: 'b', onClick: () => window.dlg.answer(false) }, 'Agora não'),
        h('button', { type: 'button', class: 'b main', onClick: () => window.dlg.answer(true) }, 'Ativar'))));
  } else if (d.kind === 'permit') {
    const mouse = toggle('Liberar o mouse', true), kb = toggle('Liberar o teclado', true);
    root.append(h('div', { class: 'd' },
      h('div', { class: 'c' },
        h('span', { class: 'av' }, (d.name || '?').trim().charAt(0).toUpperCase()),
        h('h1', {}, `${d.name || 'Alguém'} quer usar seu computador`),
        h('p', {}, (d.user ? '@' + d.user + ' · ' : '') + 'na sua ligação agora')),
      h('ul', { class: 'sw' }, h('li', {}, h('span', {}, 'Mouse'), mouse), h('li', {}, h('span', {}, 'Teclado'), kb)),
      h('p', { class: 'note' }, 'Para parar: Ctrl+Alt+Esc ou o botão Parar no alto da tela.' + (d.mac ? ' No Mac, na primeira vez, libere o Echo em Ajustes do Sistema → Privacidade e Segurança → Acessibilidade.' : '')),
      h('div', { class: 'b2' },
        h('button', { type: 'button', class: 'b', onClick: () => window.dlg.answer({ allow: false }) }, 'Recusar'),
        h('button', { type: 'button', class: 'b main', onClick: () => window.dlg.answer({ allow: true, mouse: mouse.getAttribute('aria-checked') === 'true', keyboard: kb.getAttribute('aria-checked') === 'true' }) }, 'Permitir'))));
  } else if (d.kind === 'pill') {
    document.body.classList.add('pill');
    root.append(h('div', { class: 'pl', role: 'status' },
      h('span', { class: 'a' }, (d.name || '?').trim().charAt(0).toUpperCase()),
      h('span', { class: 'tx' }, `${d.name || 'Alguém'} está usando seu mouse e teclado`),
      h('span', { class: 'k' }, 'Ctrl+Alt+Esc'),
      h('button', { type: 'button', onClick: () => window.dlg.stop() }, 'Parar')));
  }
})();
