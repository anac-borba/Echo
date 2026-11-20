'use strict';
// Janelinha genérica (dialog) usada por vários lugares.
import { $, el, icon } from './util.js';
import { t } from './i18n.js';

export function openModal(title, body, { wide = false, onClose } = {}) {
  const dlg = $('#dlg-modal');
  const box = $('#modal-box');
  box.className = 'dlg-body' + (wide ? ' wide' : '');
  box.replaceChildren(
    el('div', { class: 'dlg-head' },
      el('h2', { text: title }),
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('close'), onClick: () => dlg.close() }, icon('i-x'))),
    body
  );
  dlg.onclose = () => { dlg.onclose = null; onClose && onClose(); };
  if (!dlg.open) dlg.showModal();
  return dlg;
}
export function closeModal() { const d = $('#dlg-modal'); if (d.open) d.close(); }

/** Pergunta de confirmação simples. Devolve Promise<boolean>. */
export function confirmBox(title, text, okLabel, danger = true) {
  return new Promise((res) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; res(v); closeModal(); } };
    const body = el('div', { class: 'stack' },
      el('p', { class: 'muted', text }),
      el('div', { class: 'actions' },
        el('button', { class: 'btn', type: 'button', text: t('cancel'), onClick: () => fin(false) }),
        el('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button', text: okLabel, onClick: () => fin(true) })));
    openModal(title, body, { onClose: () => { if (!done) { done = true; res(false); } } });
  });
}
