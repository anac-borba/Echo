'use strict';
// Instalar o Echo como app (PWA): guarda o convite do navegador e diz como instalar quando não há botão.
import { toast } from './util.js';
import { t } from './i18n.js';
import { platformId } from './auth.js';

let deferred = null;
const subs = new Set();

export function initPwa() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; subs.forEach((f) => f()); });
  window.addEventListener('appinstalled', () => { deferred = null; toast(t('pwa.done')); subs.forEach((f) => f()); });
}
export const onInstallChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };

export function isStandalone() {
  return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
}
export const canPrompt = () => !!deferred;
export async function promptInstall() {
  if (!deferred) return false;
  const d = deferred; deferred = null;
  try { await d.prompt(); const r = await d.userChoice; subs.forEach((f) => f()); return r && r.outcome === 'accepted'; } catch { subs.forEach((f) => f()); return false; }
}

/** Passo a passo quando o navegador não oferece o botão: 'ios' | 'mac' | 'other'. */
export function manualHelp() {
  const p = platformId();
  if (p === 'ios') return 'ios';
  const ua = navigator.userAgent || '';
  const safari = /Safari/.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Android/.test(ua);
  if (p === 'mac' && safari) return 'mac';
  return 'other';
}
