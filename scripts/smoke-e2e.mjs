// Smoke check: production bundle and dev flow (tsx server + vite dev proxy). Requires `npm run build` first.
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

if (!existsSync('dist/server/index.js') || !existsSync('dist/client/index.html')) {
  console.error('dist/ not found — run `npm run build` first.');
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

/** Opens a private room over the WebSocket and resolves with its code. */
function createRoom(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error('ws timeout ' + url)), 5000);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 1, name: 'smoke', color: 255, mode: 'create' })));
    ws.on('message', (d, isBinary) => {
      if (isBinary) return;
      const m = JSON.parse(String(d));
      if (m.t === 'welcome') {
        clearTimeout(timer);
        resolve(m.room.code);
        ws.close();
      }
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

// Ports default to the dev ones; override them to run the smoke check next to a live `npm run dev`.
const prodPort = process.env.SMOKE_PROD_PORT ?? '18080';
const serverPort = process.env.SMOKE_SERVER_PORT ?? '8080';
const vitePort = process.env.SMOKE_VITE_PORT ?? '5173';

{
  const p = start('node', ['dist/server/index.js'], { PORT: prodPort });
  try {
    await waitFor(() => p.output().includes(`listening on :${prodPort}`), 'prod bundle to listen');
    const health = await (await fetch(`http://127.0.0.1:${prodPort}/healthz`)).json();
    const page = await (await fetch(`http://127.0.0.1:${prodPort}/`)).text();
    if (!page.includes('Wreckyard')) throw new Error('static client not served by the bundle');
    const code = await createRoom(`ws://127.0.0.1:${prodPort}/ws`);
    results.push(`OK   prod bundle: healthz ok=${health.ok}, static page served, private room ${code} created`);
  } catch (err) {
    failed = true;
    results.push(`FAIL prod bundle: ${err.message}\n${p.output()}`);
  } finally {
    kill(p);
  }
}

{
  const server = start('npx', ['tsx', 'src/server/index.ts'], { PORT: serverPort });
  const vite = start('npx', ['vite', '--port', vitePort, '--strictPort'], { WRECKYARD_SERVER_PORT: serverPort });
  try {
    await waitFor(() => server.output().includes(`listening on :${serverPort}`), 'tsx server to listen');
    await waitFor(async () => (await fetch(`http://localhost:${vitePort}/`)).ok, 'vite dev to serve');
    const html = await (await fetch(`http://localhost:${vitePort}/`)).text();
    if (!html.includes('Wreckyard')) throw new Error('vite did not serve the Wreckyard page');
    const code = await createRoom(`ws://localhost:${vitePort}/ws`);
    results.push(`OK   dev flow: vite page served, room ${code} created through the /ws proxy`);
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
