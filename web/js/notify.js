'use strict';
// Notificações do Echo (mensagens e chamadas) via Web Push.
// No iPhone só funciona com o Echo instalado na Tela de Início (iOS 16.4+), e a permissão precisa ser pedida num toque.
import { api } from './api.js';

const unb64u = (s) => { s = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
export const notifySupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

async function reg() { return navigator.serviceWorker.getRegistration().then((r) => r || navigator.serviceWorker.ready); }

/** 'on' | 'off' | 'denied' | 'unsupported' */
export async function notifyState() {
  if (!notifySupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  try { const r = await reg(); const s = r && (await r.pushManager.getSubscription()); return s ? 'on' : 'off'; } catch { return 'off'; }
}
async function save(sub) { const j = sub.toJSON(); await api('POST', '/push/sub', { endpoint: j.endpoint, keys: j.keys }); }

/** Chamar num toque. */
export async function enableNotify() {
  if (!notifySupported()) return 'unsupported';
  const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (p !== 'granted') return p === 'denied' ? 'denied' : 'off';
  const r = await reg();
  let sub = await r.pushManager.getSubscription();
  if (!sub) {
    const { key } = await api('GET', '/push/key');
    sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(key) });
  }
  await save(sub);
  return 'on';
}
export async function disableNotify() {
  try {
    const r = await reg(); const sub = r && (await r.pushManager.getSubscription());
    if (sub) { await api('POST', '/push/unsub', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
  } catch {}
  return 'off';
}
/** Ao entrar (ou trocar de conta): se já estava ligado neste aparelho, liga para a conta atual. */
export async function syncNotify() {
  try {
    if (!notifySupported() || Notification.permission !== 'granted') return;
    const r = await reg(); const sub = r && (await r.pushManager.getSubscription());
    if (sub) await save(sub);
  } catch {}
}
