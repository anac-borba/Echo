'use strict';
// Conversa com o programa auxiliar nativo (echo-helper): som por app e controle remoto.
// Protocolo: comandos em linhas no stdin; respostas em quadros [tipo][id][tamanho LE][dados] no stdout.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const { app } = require('electron');

const ev = new EventEmitter();
let proc = null, buf = Buffer.alloc(0), ready = null;

function binPath() {
  const name = process.platform === 'win32' ? 'echo-helper.exe' : 'echo-helper';
  const packed = path.join(process.resourcesPath || '', 'helper', name);
  if (app.isPackaged && fs.existsSync(packed)) return packed;
  const dev = path.join(__dirname, '..', 'helper', 'bin', name);
  return fs.existsSync(dev) ? dev : null;
}

function start() {
  if (proc) return ready;
  const bin = binPath();
  if (!bin) return Promise.resolve(false);
  ready = new Promise((resolve) => {
    try { proc = spawn(bin, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }); }
    catch (e) { console.error('helper', e); proc = null; resolve(false); return; }
    const to = setTimeout(() => resolve(false), 4000);
    ev.once('ready', () => { clearTimeout(to); resolve(true); });
    proc.on('exit', () => { proc = null; ready = null; buf = Buffer.alloc(0); ev.emit('exit'); });
    proc.on('error', () => { clearTimeout(to); resolve(false); });
    proc.stdout.on('data', (d) => {
      buf = buf.length ? Buffer.concat([buf, d]) : d;
      while (buf.length >= 6) {
        const len = buf.readUInt32LE(2);
        if (buf.length < 6 + len) break;
        const type = String.fromCharCode(buf[0]), id = buf[1], body = buf.subarray(6, 6 + len);
        buf = buf.subarray(6 + len);
        if (type === 'A') ev.emit('audio', id, Buffer.from(body));
        else if (type === 'T') {
          let m; try { m = JSON.parse(body.toString('utf8')); } catch { continue; }
          ev.emit('msg', m);
          if (m.t) ev.emit(m.t, m);
        }
      }
    });
  });
  return ready;
}

function send(line) {
  if (!proc || !proc.stdin.writable) return false;
  proc.stdin.write(line.replace(/[\r\n]/g, ' ') + '\n');
  return true;
}

/** Apps tocando som agora: [{pid, exe, path, active}] */
async function listApps() {
  if (!(await start())) return null;
  return new Promise((resolve) => {
    const to = setTimeout(() => resolve([]), 3000);
    ev.once('apps', (m) => { clearTimeout(to); resolve(Array.isArray(m.apps) ? m.apps : []); });
    send('list');
  });
}

function stop() { if (proc) { try { send('quit'); } catch { /* ok */ } setTimeout(() => { try { proc && proc.kill(); } catch { /* ok */ } }, 800); } }

module.exports = { start, send, listApps, stop, ev, available: () => !!binPath() };
