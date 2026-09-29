// Smoke check: the packaged production bundle (run from a folder with no node_modules, like the container image) and the dev flow
// (tsx server + vite dev proxy). Requires `npm run build` first.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { copyBundle, createRoom, sleep } from './lib/e2e';

if (!existsSync('dist/server/index.js') || !existsSync('dist/client/index.html')) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

interface Started {
  child: ChildProcess;
  output: () => string;
}

function start(cmd: string, args: string[], env: Record<string, string> = {}, cwd?: string): Started {
  const child = spawn(cmd, args, { env: { ...process.env, ...env }, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout?.on('data', (d) => (out += d));
  child.stderr?.on('data', (d) => (out += d));
  return { child, output: () => out };
}

async function waitFor(fn: () => boolean | Promise<boolean>, label: string, ms = 20_000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if (await fn()) return;
    } catch {
      /* not ready yet */
    }
    await sleep(150);
  }
  throw new Error(`timeout waiting for ${label}`);
}

const results: string[] = [];
let failed = false;
const kill = (p: Started): void => void p.child.kill('SIGTERM');

// Ports default to the dev ones; override them to run the smoke check next to a live `npm run dev`.
const prodPort = process.env.SMOKE_PROD_PORT ?? '18080';
const serverPort = process.env.SMOKE_SERVER_PORT ?? '8080';
const vitePort = process.env.SMOKE_VITE_PORT ?? '5173';

{
  // the bundle alone, in an empty folder: if it needed anything from node_modules, it would fail to start here
  const home = mkdtempSync(path.join(tmpdir(), 'wreckyard-packaged-'));
  copyBundle('dist', home);
  const p = start(process.execPath, ['dist/server/index.js'], { PORT: prodPort }, home);
  try {
    await waitFor(() => p.output().includes(`listening on :${prodPort}`), 'the packaged bundle to listen');
    const health = (await (await fetch(`http://127.0.0.1:${prodPort}/healthz`)).json()) as { ok: boolean };
    const page = await (await fetch(`http://127.0.0.1:${prodPort}/`)).text();
    if (!page.includes('Wreckyard')) throw new Error('static client not served by the bundle');
    const code = await createRoom(`ws://127.0.0.1:${prodPort}/ws`);
    results.push(`OK   packaged bundle (no node_modules): healthz ok=${health.ok}, static page served, private room ${code} created`);
  } catch (err) {
    failed = true;
    results.push(`FAIL packaged bundle: ${err instanceof Error ? err.message : String(err)}\n${p.output()}`);
  } finally {
    kill(p);
    await sleep(200);
    rmSync(home, { recursive: true, force: true });
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
    results.push(`FAIL dev flow: ${err instanceof Error ? err.message : String(err)}\nserver:\n${server.output()}\nvite:\n${vite.output()}`);
  } finally {
    kill(server);
    kill(vite);
  }
}

console.log(results.join('\n'));
await sleep(300);
process.exit(failed ? 1 : 0);
