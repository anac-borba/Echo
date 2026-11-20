const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const URL = process.env.URL || 'http://localhost:8787/';
const fakeDisplay = () => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    const g = c.getContext('2d'); let t = 0;
    setInterval(() => { t++; g.fillStyle = `hsl(${t*4%360} 70% 40%)`; g.fillRect(0,0,1280,720); g.fillStyle='#fff'; g.font='80px sans-serif'; g.fillText('filme '+t, 100, 300); }, 33);
    const s = c.captureStream(30);
    const ac = new AudioContext(); const o = ac.createOscillator(); const d = ac.createMediaStreamDestination(); o.connect(d); o.start();
    d.stream.getAudioTracks().forEach(a => s.addTrack(a));
    return s;
  };
};
const logs = [];
(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const mk = async (name, vp) => {
    const ctx = await browser.newContext({ permissions: ['microphone'], viewport: vp, locale: 'pt-BR' });
    const p = await ctx.newPage();
    p.on('console', m => { if (['error','warning'].includes(m.type())) console.log(`[${name}] ${m.type()}: ${m.text()}`); });
    p.on('pageerror', e => console.log(`[${name}] PAGEERROR`, e.message));
    await p.addInitScript(fakeDisplay);
    await p.goto(URL);
    return p;
  };
  const a = await mk('A', { width: 1360, height: 860 });
  const b = await mk('B', { width: 390, height: 844 });
  await a.screenshot({ path: '/tmp/s1-landing.png' });
  await b.screenshot({ path: '/tmp/s1-landing-m.png' });
  const signup = async (p, user, name) => {
    await p.waitForSelector('#auth:not([hidden])'); await p.click('#au-sw-go');
    await p.fill('#au-user', user); await p.fill('#au-pass', 'uma frase longa e segura'); await p.fill('#au-pass2', 'uma frase longa e segura');
    await p.click('#au-go'); await p.waitForSelector('#app:not([hidden])', { timeout: 20000 });
  };
  await signup(a, 'clara'); await signup(b, 'angie');
  await a.waitForTimeout(800);
  await a.screenshot({ path: '/tmp/s2-home-a.png' });
  // A adiciona B
  await a.click('.rail-item:nth-child(4) .rail-btn');
  await a.click('.tabs button:nth-child(4)');
  await a.fill('#view-friends input[type=text]', 'angie'); await a.click('#view-friends .btn.primary');
  await a.waitForTimeout(600);
  await a.screenshot({ path: '/tmp/s3-add-a.png' });
  // B aceita
  await b.waitForTimeout(800);
  await b.click('#tabbar button:nth-child(2)'); await b.waitForTimeout(300);
  await b.click('.tabs button:nth-child(3)'); await b.waitForTimeout(300);
  await b.screenshot({ path: '/tmp/s4-pending-b.png' });
  await b.click('#view-friends .btn.primary'); await b.waitForTimeout(800);
  // A liga para B
  await a.click('.rail-item:nth-child(3) .rail-btn'); await a.waitForTimeout(500);
  await a.click('#view-home .conv-row .cr-act'); await a.waitForTimeout(1200);
  await b.waitForSelector('.inc.on', { timeout: 8000 }); await b.click('.inc-b.yes');
  await a.waitForTimeout(6000);
  console.log('A conn:', await a.textContent('#conn-text'), '| B conn:', await b.textContent('#conn-text'));
  await a.screenshot({ path: '/tmp/s5-room-a.png' }); await b.screenshot({ path: '/tmp/s5-room-b.png' });
  await a.click('#btn-screen'); await a.waitForSelector('#dlg-share[open]'); await a.screenshot({ path: '/tmp/s6-sharedlg.png' });
  await a.click('#dlg-share .rbtn.p'); await b.waitForTimeout(6000);
  const info = await b.evaluate(async () => { const v = document.getElementById('screen-video'); const t0 = v.currentTime; await new Promise(r => setTimeout(r, 1000)); return { w: v.videoWidth, h: v.videoHeight, adv: +(v.currentTime - t0).toFixed(2) }; });
  console.log('B vê a tela:', JSON.stringify(info));
  const aud = await b.evaluate(async () => {
    const v = document.getElementById('screen-video'), m = document.getElementById('remote-mic');
    const vs = v.srcObject, ms = m.srcObject;
    const level = async (st) => { if (!st || !st.getAudioTracks().length) return 0; const ac = new AudioContext(); const an = ac.createAnalyser(); ac.createMediaStreamSource(new MediaStream(st.getAudioTracks())).connect(an); await new Promise(r => setTimeout(r, 600)); const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d); let x = 0; for (const q of d) x = Math.max(x, Math.abs(q)); ac.close(); return +x.toFixed(3); };
    return { videoAudioTracks: vs ? vs.getAudioTracks().length : -1, videoMuted: v.muted, videoPaused: v.paused, micIsScreen: !!(ms && vs && ms.id === vs.id), micTracks: ms ? ms.getAudioTracks().length : -1, screenLevel: await level(vs), micLevel: await level(ms) };
  });
  console.log('B som da transmissão:', JSON.stringify(aud));
  await a.screenshot({ path: '/tmp/s7-share-a.png' }); await b.screenshot({ path: '/tmp/s7-share-b.png' });
  await browser.close();
})().catch(e => { console.error('FALHOU', e); process.exit(1); });
