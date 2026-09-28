// Smoke check: production bundle and dev flow (tsx server + vite dev proxy). Requires `npm run build` first.
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

if (!existsSync('dist/server/index.js')) {
  console.error('dist/server/index.js not found — run `npm run build` first.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function start(cmd, args, env = {}) {
  const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  return { child, output: () => out };
}

async function waitFor(fn, label, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* not ready yet */
    }
    await sleep(150);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function echo(url, msg) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error('ws timeout ' + url)), 5000);
    ws.on('open', () => ws.send(msg));
    ws.on('message', (d) => {
      clearTimeout(timer);
      resolve(String(d));
      ws.close();
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

const results = [];
let failed = false;
const kill = (p) => p.child.kill('SIGTERM');

{
  const p = start('node', ['dist/server/index.js'], { PORT: '18080' });
  try {
    await waitFor(() => p.output().includes('listening on :18080'), 'prod bundle to listen');
    const health = await (await fetch('http://127.0.0.1:18080/healthz')).text();
    const e = await echo('ws://127.0.0.1:18080/ws', 'prod-echo');
    results.push(`OK   prod bundle: healthz=${health} echo=${e}`);
  } catch (err) {
    failed = true;
    results.push(`FAIL prod bundle: ${err.message}\n${p.output()}`);
  } finally {
    kill(p);
  }
}

{
  const server = start('npx', ['tsx', 'src/server/index.ts'], { PORT: '8080' });
  const vite = start('npx', ['vite', '--port', '5173', '--strictPort']);
  try {
    await waitFor(() => server.output().includes('listening on :8080'), 'tsx server to listen');
    await waitFor(async () => (await fetch('http://127.0.0.1:5173/')).ok, 'vite dev to serve');
    const html = await (await fetch('http://127.0.0.1:5173/')).text();
    const viaProxy = await echo('ws://127.0.0.1:5173/ws', 'dev-echo');
    if (!html.includes('Wreckyard')) throw new Error('vite did not serve the Wreckyard page');
    results.push(`OK   dev flow: vite page served, ws via /ws proxy echo=${viaProxy}`);
  } catch (err) {
    failed = true;
    results.push(`FAIL dev flow: ${err.message}\nserver:\n${server.output()}\nvite:\n${vite.output()}`);
  } finally {
    kill(server);
    kill(vite);
  }
}

console.log(results.join('\n'));
await sleep(300);
process.exit(failed ? 1 : 0);
