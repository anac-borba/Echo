'use strict';
// Janela "O que vai aparecer?" (só computador): origem (tela, janela ou aba), áudio da transmissão e qualidade.
//
// Honestidade sobre o navegador: ele NÃO lista apps para escolher o som por app. Quem escolhe a tela/janela/aba é o
// seletor do próprio navegador, e o som vem do que foi escolhido ali. O app de desktop do Echo (Electron) poderá
// listar apps com um helper nativo. Ponto de extensão, já ligado aqui:
//   window.echoDesktop = {
//     listAudioApps(): Promise<[{ id, name }]>,        // apps que podem entrar na transmissão
//     setShareAudioApps(ids: string[]): void,          // chamado ao começar (em call.js) com os apps marcados
//   };
// Se existir, a lista aparece com caixas de seleção (como no GoLive) abaixo das opções de áudio.
import { el, icon } from './util.js';
import { CFG, saveCfg } from './state.js';
import { t } from './i18n.js';

const SURFACES = ['monitor', 'window', 'browser'];
const ICON = { monitor: 'r-scr', window: 'r-win', browser: 'r-tab' };
/** Opções de áudio que fazem sentido para cada origem. */
export const audioOptions = (surface) => (surface === 'monitor' ? ['system', 'none'] : surface === 'window' ? ['app', 'system', 'none'] : ['app', 'none']);
export const normalizeAudio = (surface, mode, legacyOn) => {
  const opts = audioOptions(surface);
  if (opts.includes(mode)) return mode;
  if (mode === undefined && legacyOn === false) return 'none';
  return opts[0];
};
export const qualityLine = (P) => t('q.line', { res: P.h >= 2160 ? '4K' : P.h + 'p', fps: P.fps, mbps: Math.round(P.kbps / 1000) });

/** host: { PRESETS, peerName(), isMac, supported, switching, start({surface, preset, audioMode, apps}) } */
export function openShareUi(host) {
  const dlg = document.getElementById('dlg-share');
  const sh = CFG.share;
  const P = host.PRESETS;
  let surface = SURFACES.includes(sh.surface) ? sh.surface : 'monitor';
  let preset = P[sh.preset] ? sh.preset : 'filme';
  let audioMode = normalizeAudio(surface, sh.audioMode, sh.audio);
  const apps = new Set();
  const name = host.peerName();

  const tabsBox = el('div', { class: 'rseg tabs', role: 'tablist' });
  const pickBox = el('div', {});
  const audioBox = el('div', { class: 'rgrid', role: 'radiogroup', 'aria-label': t('sh.audio') });
  const appsBox = el('div', { class: 'apps', hidden: true });
  const qBox = el('div', { class: 'rseg g3', role: 'radiogroup', 'aria-label': t('share.quality') });
  const qLine = el('div', { class: 'rhelp' });

  const tabLabel = (s) => (s === 'monitor' ? t('surf.screen') : s === 'window' ? t('surf.win') : t('shd.tab.browser'));
  function drawTabs() {
    tabsBox.replaceChildren(...SURFACES.map((s) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(s === surface), onClick: () => { surface = s; audioMode = normalizeAudio(surface, audioMode); drawTabs(); drawPick(); drawAudio(); } }, tabLabel(s))));
  }
  function drawPick() {
    const tip = surface === 'browser' ? t('share.tip.tab') : surface === 'window' ? t('share.tip.window') : (host.isMac ? t('share.tip.mac') : t('share.tip.screen'));
    pickBox.replaceChildren(el('div', { class: 'pick' },
      el('div', { class: 'rib lg' }, icon(ICON[surface], 'i')),
      el('div', {}, el('b', { text: tabLabel(surface) }), el('p', { text: t('shd.pick.' + surface) }), el('p', { text: tip }))));
  }
  function audioText(id) {
    if (id === 'app') return surface === 'browser' ? [t('sh.a.app.browser'), t('sh.a.app.d', { name })] : [t('sh.a.app.window'), t('sh.a.app.window.d', { name })];
    if (id === 'system') return [t('sh.a.system'), host.isMac && surface === 'monitor' ? t('share.tip.mac') : t('sh.a.system.d', { name })];
    return [t('sh.a.none'), t('sh.a.none.d')];
  }
  function drawAudio() {
    audioBox.replaceChildren(...audioOptions(surface).map((id) => {
      const [title, desc] = audioText(id);
      const on = id === audioMode;
      return el('button', { class: 'rrow wrap' + (on ? ' sel' : ''), type: 'button', role: 'radio', 'aria-checked': String(on), onClick: () => { audioMode = id; drawAudio(); } },
        el('span', { class: 't' }, el('b', { text: title }), el('small', { text: desc })),
        on ? el('span', { class: 'rchk' }, icon('r-check', 'i')) : null);
    }));
    appsBox.hidden = !appsBox.firstChild || audioMode === 'none';
  }
  function drawQuality() {
    qBox.replaceChildren(...Object.keys(P).map((id) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(id === preset), onClick: () => { preset = id; drawQuality(); } }, t('preset.' + id))));
    qLine.textContent = qualityLine(P[preset]);
  }

  // Ponto de extensão do app de desktop: lista de apps com caixas de seleção.
  const desk = typeof window !== 'undefined' && window.echoDesktop;
  if (desk && typeof desk.listAudioApps === 'function') {
    Promise.resolve(desk.listAudioApps()).then((list) => {
      if (!Array.isArray(list) || !list.length) return;
      appsBox.replaceChildren(el('div', { class: 'rlab', text: t('sh.apps') }), ...list.map((a) => el('label', {},
        el('input', { type: 'checkbox', value: String(a.id), onChange: (e) => { if (e.target.checked) apps.add(String(a.id)); else apps.delete(String(a.id)); } }),
        el('span', { text: String(a.name || a.id) }))));
      appsBox.hidden = audioMode === 'none';
    }).catch(() => {});
  }

  const go = el('button', { class: 'rbtn p', type: 'button', disabled: !host.supported, onClick: () => {
    CFG.share = { ...CFG.share, surface, preset, audioMode, audio: audioMode !== 'none' }; saveCfg();
    dlg.close();
    host.start({ surface, preset, audioMode, apps: [...apps] });
  } }, icon('r-scrup', 'i'), host.switching ? t('shd.switch') : t('shd.go'));

  drawTabs(); drawPick(); drawAudio(); drawQuality();
  dlg.replaceChildren(el('div', { class: 'shd' },
    el('div', { class: 'shd-head' },
      el('h2', { id: 'shd-title', text: t('shd.title', { name }) }),
      el('button', { class: 'rib', type: 'button', 'aria-label': t('shd.close'), onClick: () => dlg.close() }, icon('r-x', 'i s18'))),
    !host.supported && el('p', { class: 'rwarn', text: t('share.unsupported') }),
    host.supported && host.noAudio && el('p', { class: 'rwarn', text: t(/Firefox\//.test(navigator.userAgent) ? 'share.warn.firefox' : 'share.warn.safari') }),
    tabsBox, pickBox,
    el('div', { class: 'shd-cols' },
      el('div', {}, el('div', { class: 'rlab', text: t('sh.audio') }), audioBox, appsBox, el('p', { class: 'rnote', text: t('sh.note') })),
      el('div', {}, el('div', { class: 'rlab', text: t('share.quality') }), qBox, qLine, el('div', { class: 'spacer' }), go))));
  dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
  if (!dlg.open) dlg.showModal();
  go.focus({ preventScroll: true });
}
