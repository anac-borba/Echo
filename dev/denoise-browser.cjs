// Teste real no Chromium headless: node dev/denoise-browser.cjs
// Sobe dev/server.js (porta livre, MAX_ACCOUNTS=4, com a CSP real de web/_headers), gera WAVs sintéticos e os usa como
// microfone falso (--use-file-for-fake-audio-capture). Abre o microfone pelo openMic() REAL de web/js/audio.js e mede
// o RMS (AnalyserNode) do microfone cru e da saída da cadeia, no mesmo instante. Nada aqui é simulado: se o worklet
// não carregar (CSP, import './denoise-core.js'), o teste acusa e a cadeia cai no fallback.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');

const HERE = __dirname;
const SECONDS = 24, T0 = 6, T1 = 30; // janela de medição = 24 s = exatamente 1 volta do WAV (o microfone falso repete o arquivo), após 6 s de aprendizado

(async () => {
  const sig = await import(pathToFileURL(path.join(HERE, 'denoise-signals.mjs')).href);
  const srv = await import(pathToFileURL(path.join(HERE, 'server.js')).href);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'denoise-'));
  const { SR } = sig;
  const voice = sig.synthVoice(SECONDS, { f0: 130, seed: 11 });
  const fan = sig.fanNoise(SECONDS);
  const m5 = sig.mix(voice, fan, 5);
  const wavs = {
    'ruido': m5.noise,                 // só ventilador (mesmo nível do ruído da mistura SNR 5 dB: -25 dBFS RMS)
    'voz+ruido(5dB)': m5.mix,
    'voz limpa': voice.x,
  };
  const refRms = {}; for (const [k, x] of Object.entries(wavs)) { let e = 0; for (const v of x) e += v * v; refRms[k] = Math.sqrt(e / x.length); }
  const files = {};
  for (const [k, x] of Object.entries(wavs)) { files[k] = path.join(tmp, k.replace(/\W+/g, '_') + '.wav'); await sig.writeWav(files[k], x, SR); }

  const server = await srv.startDevServer({ port: 0, env: { MAX_ACCOUNTS: '4' } });
  console.log('servidor dev em', server.url);

  // roda no navegador: abre o mic com o modo dado e mede cru vs processado
  async function measure(wavKey, mode, dn, rawFlags) {
    const browser = await chromium.launch({ args: [
      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      '--use-file-for-fake-audio-capture=' + files[wavKey], '--autoplay-policy=no-user-gesture-required'] });
    try {
      const ctx = await browser.newContext({ permissions: ['microphone'] });
      const page = await ctx.newPage();
      const logs = [];
      // erros do app (login 401, favicon etc.) não interessam; só importa se algo do denoise falhou
      page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && /denoise|worklet|AudioWorklet/i.test(m.text())) logs.push(m.type() + ': ' + m.text()); });
      page.on('response', (r) => { if (r.status() >= 400 && /denoise/.test(r.url())) logs.push(r.status() + ' ' + r.url()); });
      await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)); });
      if (rawFlags) await page.addInitScript(() => { // experimento: tira NS/AGC/voiceIsolation nativos para medir só a nossa cadeia
        const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = (c) => g({ ...c, audio: { ...c.audio, noiseSuppression: false, autoGainControl: false, echoCancellation: false, voiceIsolation: false } });
      });
      await page.goto(server.url + '/');
      const r = await page.evaluate(async ({ mode, dn, T0, T1 }) => {
        const audio = await import('/js/audio.js'); const st = await import('/js/state.js');
        st.CFG.audioMode = mode; if (dn != null) st.CFG.dn = dn;
        if (mode === 'custom') { st.CFG.hpf = false; st.CFG.gate = -100; st.CFG.micGain = 1; st.CFG.ns = false; st.CFG.ec = false; st.CFG.agc = false; } // só o nosso worklet
        const ac = new AudioContext({ sampleRate: 48000 }); await ac.resume();
        const mic = await audio.openMic(ac);
        const chain = mic.stream !== mic.raw; // true = passou pela cadeia WebAudio (worklet carregou)
        const mk = (s) => { const src = ac.createMediaStreamSource(s); const an = ac.createAnalyser(); an.fftSize = 1024; an.smoothingTimeConstant = 0; src.connect(an); return an; };
        const aOut = mk(mic.stream);
        const bufA = new Float32Array(1024), bufB = new Float32Array(1024);
        let eA = 0, eB = 0, n = 0; const t0 = performance.now(); const series = [];
        await new Promise((res) => {
          const id = setInterval(() => {
            const t = (performance.now() - t0) / 1000;
            aOut.getFloatTimeDomainData(bufB);
            let b = 0; for (let i = 0; i < 1024; i++) b += bufB[i] * bufB[i];
            if (t >= T0 && t <= T1) { eB += b; n += 1024; }
            if (t > T1) { clearInterval(id); res(); }
          }, 21);
        });
        const csp = window.__csp.slice();
        mic.stop(); await ac.close();
        return { chain, ac_lat_ms: +(1000 * (ac.baseLatency || 0)).toFixed(1), rmsOut: Math.sqrt(eB / n), csp };
      }, { mode, dn, T0, T1 });
      return { ...r, logs };
    } finally { await browser.close(); }
  }

  const db = (x) => 20 * Math.log10(x + 1e-12);
  // referência de entrada = RMS do WAV inteiro (calculado em Node). "cru" medido no navegador mostra o efeito da
  // supressão/AGC nativa do Chrome quando o modo a liga (isolamento).
  const cases = [
    ['ruido', 'custom', 1], ['ruido', 'custom', 0.5], ['ruido', 'isolation'], ['ruido', 'studio'],
    ['voz+ruido(5dB)', 'custom', 1], ['voz+ruido(5dB)', 'isolation'], ['voz limpa', 'custom', 1], ['voz limpa', 'isolation'], ['voz limpa', 'studio'],
  ];
  if (process.argv.includes('--experimento')) cases.push(['ruido', 'isolation', null, true], ['voz limpa', 'isolation', null, true], ['voz+ruido(5dB)', 'isolation', null, true], ['voz+ruido(5dB)', 'isolation']);
  const rows = []; let ok = true;
  for (let i = 0; i < cases.length; i += 4) {
    const res = await Promise.all(cases.slice(i, i + 4).map(([wk, mode, dn, rf]) => measure(wk, mode, dn, rf)));
    res.forEach((r, j) => {
      const [wk, mode, dn, rf] = cases[i + j];
      if (!r.chain && mode !== 'studio') ok = false;
      if (r.csp.length || r.logs.length) ok = false;
      rows.push({ entrada: wk, modo: mode + (dn != null ? ' dn=' + dn : '') + (rf ? ' (sem NS/AGC nativos)' : ''), cadeia_webaudio: r.chain, 'entrada WAV (dBFS)': +db(refRms[wk]).toFixed(1),
        'saida (dBFS)': +db(r.rmsOut).toFixed(1), 'delta vs WAV (dB)': +(db(r.rmsOut) - db(refRms[wk])).toFixed(1), violacoes_CSP: r.csp.length, falhas_worklet: r.logs.length });
      if (r.logs.length) console.log('  [' + wk + '/' + mode + ']', r.logs.slice(0, 3).join(' | '));
    });
  }
  console.table(rows);
  console.log('Obs.: delta = RMS da saida (medido por AnalyserNode, ' + (T1 - T0) + ' s = 1 volta do WAV, apos ' + T0 + ' s de aprendizado) menos RMS do WAV. custom = so o worklet (ns/ec/agc do navegador off); isolation = HPF 110 (NS/AGC nativos desligados pelo audio.js) + denoise + gate + compressor (o compressor do WebAudio tem make-up automático).');
  console.log(ok ? 'OK: worklet carregou sob a CSP real e a cadeia ficou ativa.' : 'FALHA: cadeia nao ativou ou houve violacao de CSP (ver tabela).');
  await server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
