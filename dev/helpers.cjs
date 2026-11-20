// Auxiliares para testes de navegador do Echo (Playwright + Chromium com mídia falsa).
const { chromium, devices } = require('/opt/npm-tools/node_modules/playwright');

const PASS = 'uma frase longa e segura';
const fakeDisplay = () => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    const g = c.getContext('2d'); let t = 0;
    setInterval(() => { t++; g.fillStyle = `hsl(${t * 4 % 360} 70% 40%)`; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#fff'; g.font = '80px sans-serif'; g.fillText('filme ' + t, 100, 300); }, 33);
    const s = c.captureStream(30);
    const ac = new AudioContext(); const o = ac.createOscillator(); const d = ac.createMediaStreamDestination(); o.connect(d); o.start();
    d.stream.getAudioTracks().forEach((a) => s.addTrack(a));
    return s;
  };
};

async function launch() {
  return chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
}

/** kind: 'mac' | 'win' | 'iphone' | 'iphone-land' */
async function page(browser, url, name, kind = 'mac', errs = []) {
  const base = { permissions: ['microphone'], locale: 'pt-BR' };
  const opts = kind === 'iphone' ? { ...devices['iPhone 14 Pro'], ...base }
    : kind === 'iphone-land' ? { ...devices['iPhone 14 Pro landscape'], ...base }
      : { ...base, viewport: kind === 'win' ? { width: 1366, height: 768 } : { width: 1440, height: 900 } };
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(`[${name}] ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/401|Failed to load resource/.test(m.text())) errs.push(`[${name}] ${m.text()}`); });
  await p.addInitScript(fakeDisplay);
  await p.goto(url);
  p.name = name;
  return p;
}

async function signup(p, user) {
  await p.waitForSelector('#auth:not([hidden])');
  await p.click('#au-sw-go');
  await p.fill('#au-user', user); await p.fill('#au-pass', PASS); await p.fill('#au-pass2', PASS);
  await p.click('#au-go');
  await p.waitForSelector('#app:not([hidden])', { timeout: 20000 });
}

const apiCall = (p, method, path, body) => p.evaluate(async ({ method, path, body }) => {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Telinha': '1' }, credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}, { method, path, body });

/** a pede amizade para b (pelo username) e b aceita. */
async function befriend(a, b, userB) {
  await apiCall(a, 'POST', '/friends', { username: userB });
  const me = await apiCall(a, 'GET', '/me');
  await apiCall(b, 'POST', `/friends/${me.j.user ? me.j.user.id : me.j.id}/accept`);
  await a.waitForTimeout(400);
}

module.exports = { launch, page, signup, apiCall, befriend, PASS };
