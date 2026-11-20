'use strict';
// Ponte com o Echo para computador (Electron). No navegador, tudo aqui fica desligado.
export const app = typeof window !== 'undefined' && window.echoDesktop ? window.echoDesktop : null;
export const isDesktopApp = !!app;

let ac = null, loaded = false, node = null;
/** Som dos apps escolhidos na janela de compartilhar → uma faixa de áudio para entrar na transmissão. */
export async function shareAudioTrack() {
  if (!app) return null;
  let info = null; try { info = await app.shareInfo(); } catch { /* sem app */ }
  if (!info || !info.appsAudio) return null;
  try {
    ac = ac || new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    await ac.resume();
    if (!loaded) { await ac.audioWorklet.addModule('/js/pcm-worklet.js'); loaded = true; }
    const port = await new Promise((resolve) => {
      const f = (e) => { if (e.source === window && e.data && e.data.echoDesktop === 'pcm' && e.ports && e.ports[0]) { window.removeEventListener('message', f); resolve(e.ports[0]); } };
      window.addEventListener('message', f);
      app.shareAudio();
      setTimeout(() => { window.removeEventListener('message', f); resolve(null); }, 3000);
    });
    if (!port) return null;
    if (node) { try { node.disconnect(); } catch { /* ok */ } }
    node = new AudioWorkletNode(ac, 'echo-pcm', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    node.port.postMessage({ port }, [port]);
    const dest = ac.createMediaStreamDestination();
    node.connect(dest);
    return dest.stream.getAudioTracks()[0] || null;
  } catch (e) { console.warn('som dos apps', e); return null; }
}
export async function shareKind() { if (!app) return null; try { const i = await app.shareInfo(); return i ? i.kind : null; } catch { return null; } }
export function stopShareAudio() { if (!app) return; try { app.stopShare(); } catch { /* ok */ } if (node) { try { node.disconnect(); } catch { /* ok */ } node = null; } }
