// Grava as animações do Echo em vídeo, em câmera lenta (10x), para o ffmpeg separar quadro a quadro.
// Uso: node dev/anim/record.cjs [pasta-de-saída]   (servidor de dev em http://localhost:8813)
// Câmera lenta: o CDP (Animation.setPlaybackRate) desacelera animações e transições CSS e Web Animations;
// a gravação do Playwright sai a 25 qps, então 1 quadro do vídeo = 4 ms da animação real.
const H = require('../helpers.cjs');
const fs = require('fs'), path = require('path');
const U = process.env.ECHO_URL || 'http://localhost:8813/';
const OUT = path.resolve(process.argv[2] || 'anim-out');
const SLOW = 10;
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const errs = [], b = await H.launch();
  // duas contas amigas (A grava, B provoca: liga, digita, desliga)
  const A0 = await H.page(b, U, 'A', 'iphone', errs), B = await H.page(b, U, 'B', 'mac', errs);
  const ua = 'an' + Date.now() % 100000, ub = 'bn' + Date.now() % 100000;
  await H.signup(A0, ua); await H.signup(B, ub); await H.befriend(A0, B, ub);
  const state = await A0.context().storageState(); await A0.context().close();
  const bId = (await H.apiCall(B, 'GET', '/me')).j; const meB = bId.user || bId;
  const log = [];

  async function scene(name, kind, setup, trigger, ms = 6000) {
    if (process.env.ONLY && !process.env.ONLY.split(',').includes(name)) return;
    const dev = kind === 'iphone' ? require('/opt/npm-tools/node_modules/playwright').devices['iPhone 14 Pro'] : { viewport: { width: 1280, height: 800 } };
    const size = dev.viewport;
    const ctx = await b.newContext({ ...dev, storageState: state, permissions: ['microphone'], locale: 'pt-BR', recordVideo: { dir: OUT, size } });
    const p = await ctx.newPage(); const t0 = Date.now();
    p.on('pageerror', (e) => errs.push(`[${name}] ${e.message}`));
    await p.goto(U); await p.waitForSelector('#app:not([hidden])'); await p.waitForTimeout(1500);
    if (setup) await setup(p);
    await p.waitForTimeout(1200);
    const cdp = await ctx.newCDPSession(p); await cdp.send('Animation.enable'); await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 / SLOW });
    const tIn = (Date.now() - t0) / 1000;
    await trigger(p);
    await p.waitForTimeout(ms);
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
    const v = p.video(); await ctx.close();
    const file = path.join(OUT, name + '.webm'); await v.saveAs(file); await v.delete();
    log.push({ name, kind, file, trigger: tIn, slow: SLOW, w: size.width, h: size.height });
    console.log('gravado', name, tIn.toFixed(2) + 's');
    fs.writeFileSync(path.join(OUT, 'cenas.json'), JSON.stringify(log, null, 1));
  }
  const goView = (v) => (p) => p.evaluate((v) => import('/js/ui.js').then((u) => u.go(v)), v);
  const openDm = async (p) => { await p.click('.conv-row'); await p.waitForSelector('.cv-top'); };

  await scene('trocar-aba', 'iphone', null, (p) => p.click('#tabbar button:nth-child(2)'));
  await scene('abrir-conversa', 'iphone', null, (p) => p.click('.conv-row'));
  await scene('voltar', 'iphone', openDm, (p) => p.click('#view-dm .cv-icon.back'));
  await scene('anexar', 'iphone', openDm, (p) => p.click('.cmp-btn.plus'));
  await scene('aviso', 'iphone', null, (p) => p.evaluate(() => import('/js/util.js').then((u) => u.toast('Link copiado'))));
  await scene('janela', 'mac', null, (p) => p.evaluate(() => import('/js/modal.js').then((m) => { const d = document.createElement('p'); d.textContent = 'Exemplo de janela.'; m.openModal('Janela', d); })));
  await scene('digitando-e-mensagem', 'iphone', openDm, async () => {
    await B.click('.side-body .fr-row'); await B.waitForSelector('#view-dm textarea');
    await B.type('#view-dm textarea', 'oi! bora ligar?', { delay: 70 });
    await B.click('#view-dm .cmp-send');
  }, 9000);
  const bHang = async () => { await B.evaluate(() => import('/js/call.js').then((c) => c.leaveRoom())).catch(() => {}); await B.waitForTimeout(1500); };
  const bCall = async () => { if (!(await B.$('#view-dm:not([hidden]) .cv-acts'))) await B.click('.side-body .fr-row'); await B.waitForSelector('#view-dm .cv-acts .cv-icon:last-child'); await B.click('#view-dm .cv-acts .cv-icon:last-child'); };
  const answer = async (p) => { await bHang(); await bCall(); await p.waitForSelector('.inc.on', { timeout: 15000 }); await p.click('.inc-b.yes'); await p.waitForSelector('#ft', { timeout: 10000 }); await p.waitForTimeout(2500); };
  await scene('chamada-chegando', 'iphone', bHang, bCall, 7000);
  await scene('menu-da-ligacao', 'iphone', answer, (p) => p.click('#btn-more'), 5000);
  await scene('fim-da-ligacao', 'iphone', answer, bHang, 7000);
  await bHang();
  console.log(errs.slice(0, 6));
  fs.writeFileSync(path.join(OUT, 'cenas.json'), JSON.stringify(log, null, 1));
  await b.close();
})();
