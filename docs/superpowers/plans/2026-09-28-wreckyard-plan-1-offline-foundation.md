# Wreckyard Plan 1 — Offline Foundation (M0–M1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scaffolded, tested TypeScript project containing a deterministic shared car simulation (Rapier) and an offline, drivable 3D arena sandbox in the browser — the foundation the multiplayer plan builds on.

**Architecture:** One npm package. `src/shared` holds the DOM-free, Node-free deterministic simulation (constants, math, arena, vehicle, `Simulation`). `src/server` is only a WebSocket echo in this plan. `src/client` holds the three.js scene, procedural car mesh, chase camera, input and the sandbox loop. The simulation is a fixed-60 Hz Rapier world using the built-in raycast vehicle controller; the sandbox steps it with a fixed-timestep accumulator and renders interpolated poses.

**Tech Stack:** TypeScript 7 (type-check only), Vite 8, Vitest 5, three r186, `@dimforge/rapier3d-deterministic-compat` 0.21.0, `ws` 8.22, `tsx`, `esbuild`, `concurrently`.

**Spec:** `docs/superpowers/specs/2026-09-28-wreckyard-design.md` — read its "Addendum — rehearsal findings"; the numbers used below were measured there. **Next plan:** `2026-09-28-wreckyard-plan-2-multiplayer-baseline.md` (M2), executed after the playtest gate at the end of this plan.

## Global Constraints

- Single npm package: `src/shared` (no DOM, no Node APIs), `src/server` (Node), `src/client` (DOM). Relative imports only — no path aliases, no `baseUrl`, no workspaces.
- Exact pins: `three` 0.186.1, `@types/three` 0.186.0, `@dimforge/rapier3d-deterministic-compat` 0.21.0. Ranges: `ws` ^8.22.0, `vite` ^8.3.1, `vitest` ^5.0.2, `typescript` ^7.0.2 (type-check only, via `noEmit: true`; nothing imports the `typescript` package), `tsx` ^4.23.15, `esbuild` ^0.28.2, `concurrently` ^10.0.5, `@types/node` ^24, `@types/ws` ^8.18.1. Node ≥ 22.12.
- tsconfig: `target: ES2022`, `moduleResolution: bundler`, `strict: true`, explicit `types` per project.
- Axes: forward = +X, up = +Y, right = +Z, wheel axle = +Z. A positive Rapier steering angle turns LEFT; `CarInput.steer = +1` means RIGHT, so `DRIVE.STEER_SIGN = -1`.
- Simulation path (`vehicle.ts`, `sim.ts`, collider construction): fixed dt = 1/60; no `Math.random`, `Date.now` or per-tick trigonometry (trig only in one-time geometry construction, rounded with `round3` / `round6`); cars processed in ascending slot order; inputs pass through `quantizeInput` before use.
- Memory: `Simulation.dispose()` must call `world.removeVehicleController(...)` for every car before `world.free()`.
- three r186: use `THREE.PCFShadowMap` (never `PCFSoftShadowMap`) and `THREE.Timer` (never `THREE.Clock`); addon imports use the `three/addons/...` path.
- Working title "Wreckyard"; no third-party assets; all visuals are generated in code.
- Commits: the approved spec says "`git init` only, no commits unless you ask". Every task ends with a commit step; run it **only if the user has opted in to commits**, otherwise skip it.

## Review Focus

Failure modes the spec implies but its feature tests would not naturally exercise, most likely first. Each has a test in the task that owns the code.

1. **Hidden tab / huge frame time.** Returning to a backgrounded tab delivers a multi-second frame delta. Expected: frame time is capped at 0.1 s so physics never fast-forwards. → `FixedStepper` tests (Task 6).
2. **NaN / ±Infinity / out-of-range input** (glitchy gamepad, corrupt packet). Expected: treated as neutral or clamped, and NaN never reaches the physics world. → `packInput` tests (Task 2), `Simulation.setInput` test (Task 4), gamepad mapping test (Task 6).
3. **Odd rosters.** Duplicate, unsorted, negative, fractional or more than 8 slots. Expected: duplicates collapse and slots sort; invalid slots or > 8 cars throw `RangeError` immediately instead of building a broken world. → `Simulation` tests (Task 4).
4. **Dispose twice / leak on repeated create-destroy.** Expected: `dispose()` is idempotent, `step()` after dispose throws a clear error, and hundreds of create/destroy cycles do not grow memory. → `Simulation` tests (Task 4).
5. **No WebGL 2 / init failure.** Expected: a readable message on the page instead of a blank screen. → `webglAvailable()` guard and error path in `main.ts` (Tasks 5–6, verified in the browser).

## File Structure

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.{base,client,server,test}.json`, `vite.config.ts`, `vitest.config.ts`, `.gitignore`, `README.md` | toolchain |
| `scripts/build-server.mjs`, `scripts/smoke-e2e.mjs` | production bundle; prod + dev smoke check |
| `src/shared/types.ts` | `Vec3`, `Quat`, `CarState`, `WheelPose` |
| `src/shared/math.ts` | scalar / vector / quaternion helpers |
| `src/shared/constants.ts` | every tunable: `PHYSICS`, `CAR`, `SUSPENSION`, `TIRE`, `DRIVE`, `ARENA` |
| `src/shared/input.ts` | `CarInput`, int8 quantization, sequence-number compare |
| `src/shared/physics.ts` | Rapier import + `initPhysics()` |
| `src/shared/arena.ts` | arena geometry specs, `buildArena`, `spawnPose` |
| `src/shared/vehicle.ts` | car rig creation and the drive model |
| `src/shared/sim.ts` | `Simulation` (the one step function both server and client will run) |
| `src/server/app.ts`, `src/server/index.ts` | echo server (replaced in Plan 2) |
| `src/client/index.html`, `src/client/main.ts` | page and boot |
| `src/client/game/{scene,carView,camera,input,stepper,sandbox}.ts` | rendering, car mesh, camera, input, fixed-step loop, sandbox |
| `tests/*.test.ts`, `tests/client/*.test.ts` | Vitest |

---

### Task 1: Scaffold and toolchain smoke test (M0)

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `tsconfig.client.json`, `tsconfig.server.json`, `tsconfig.test.json`, `vite.config.ts`, `vitest.config.ts`, `.gitignore`, `README.md`
- Create: `scripts/build-server.mjs`, `scripts/smoke-e2e.mjs`
- Create: `src/shared/math.ts` (only `clamp` for now), `src/server/app.ts`, `src/server/index.ts`, `src/client/index.html`, `src/client/main.ts`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Produces: npm scripts `dev`, `dev:server`, `dev:client`, `build`, `build:client`, `build:server`, `start`, `test`, `test:watch`, `typecheck`, `smoke`; `clamp(v, lo, hi): number` in `src/shared/math.ts` (Task 2 replaces the file and keeps `clamp`); `createGameServer(): { server: http.Server; wss: WebSocketServer }` in `src/server/app.ts` (Plan 2 replaces it).

- [ ] **Step 1: Initialise git and ignore rules**

The directory currently holds only `firebase-debug.log` (written by a plugin, not ours).

```bash
cd /Users/guilhemduche/Documents/Github/3DTest
git init
```

Expected: `Initialized empty Git repository in .../3DTest/.git/`

Create `.gitignore`:

```
node_modules/
dist/
coverage/
*.log
firebase-debug.log
.DS_Store
.env
.env.*
```

- [ ] **Step 2: Write `package.json`, tsconfigs and tool configs, then install**

`package.json`:

```json
{
  "name": "wreckyard",
  "private": true,
  "version": "0.1.0",
  "description": "Wreckyard — online 3D demolition-derby arena (browser multiplayer)",
  "type": "module",
  "engines": { "node": ">=22.12" },
  "scripts": {
    "dev": "concurrently -k -n server,client -c blue,green \"npm:dev:server\" \"npm:dev:client\"",
    "dev:server": "tsx watch src/server/index.ts",
    "dev:client": "vite",
    "build": "npm run build:client && npm run build:server",
    "build:client": "vite build",
    "build:server": "node scripts/build-server.mjs",
    "start": "node dist/server/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.client.json && tsc -p tsconfig.server.json && tsc -p tsconfig.test.json",
    "smoke": "node scripts/smoke-e2e.mjs"
  },
  "dependencies": {
    "@dimforge/rapier3d-deterministic-compat": "0.21.0",
    "three": "0.186.1",
    "ws": "^8.22.0"
  },
  "devDependencies": {
    "@types/node": "^24",
    "@types/three": "0.186.0",
    "@types/ws": "^8.18.1",
    "concurrently": "^10.0.5",
    "esbuild": "^0.28.2",
    "tsx": "^4.23.15",
    "typescript": "^7.0.2",
    "vite": "^8.3.1",
    "vitest": "^5.0.2"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noImplicitOverride": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`tsconfig.client.json`:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src/client", "src/shared"]
}
```

`tsconfig.server.json`:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023"],
    "types": ["node"]
  },
  "include": ["src/server", "src/shared", "scripts"]
}
```

`tsconfig.test.json`:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["node", "vite/client"]
  },
  "include": ["tests", "src"]
}
```

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/client',
  publicDir: false,
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
});
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
```

Install:

```bash
npm install
```

Expected: `added ~70 packages`. npm 11 prints a warning that esbuild's postinstall script is not covered by `allowScripts` — ignore it; esbuild works through its platform binary (verified in the rehearsal).

- [ ] **Step 3: Write the failing smoke test**

`tests/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { clamp } from '../src/shared/math';
import { createGameServer } from '../src/server/app';

describe('toolchain smoke', () => {
  it('shared code is importable', () => {
    expect(clamp(5, 0, 1)).toBe(1);
  });

  it('server serves /healthz and echoes over /ws', async () => {
    const { server, wss } = createGameServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(await health.text()).toBe('ok');

    const echoed = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      ws.on('open', () => ws.send('hi'));
      ws.on('message', (d) => {
        resolve(String(d));
        ws.close();
      });
      ws.on('error', reject);
    });
    expect(echoed).toBe('hi');

    wss.close();
    server.close();
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run`
Expected: FAIL — `Failed to resolve import "../src/shared/math"` (the sources do not exist yet).

- [ ] **Step 5: Write the shared and server sources, then make the test pass**

`src/shared/math.ts`:

```ts
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
```

`src/server/app.ts`:

```ts
import http from 'node:http';
import { WebSocketServer } from 'ws';

export function createGameServer(): { server: http.Server; wss: WebSocketServer } {
  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws) => {
    ws.on('message', (data, isBinary) => ws.send(data, { binary: isBinary }));
  });
  return { server, wss };
}
```

`src/server/index.ts`:

```ts
import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { createGameServer } from './app';

await RAPIER.init();
console.log(`rapier ${RAPIER.version()} initialised in node`);

const { server } = createGameServer();
const port = Number(process.env.PORT ?? 8080);
server.listen(port, () => console.log(`listening on :${port}`));
```

Run: `npx vitest run`
Expected: PASS — `Tests  2 passed (2)`.

- [ ] **Step 6: Client page, build script and smoke script; verify type-check and builds**

`src/client/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Wreckyard</title>
  </head>
  <body>
    <pre id="out">booting…</pre>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

`src/client/main.ts`:

```ts
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { clamp } from '../shared/math';

const out = document.getElementById('out')!;
const log = (s: string): void => {
  out.textContent += `\n${s}`;
};

async function main(): Promise<void> {
  await RAPIER.init();
  log(`three r${THREE.REVISION}, rapier ${RAPIER.version()}, clamp(5,0,1)=${clamp(5, 0, 1)}`);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => ws.send('hello');
  ws.onmessage = (e) => log(`echo: ${String(e.data)}`);
}

void main();
```

`scripts/build-server.mjs`:

```js
import { build } from 'esbuild';

await build({
  entryPoints: ['src/server/index.ts'],
  outfile: 'dist/server/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'bundle',
  external: ['bufferutil', 'utf-8-validate'],
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  sourcemap: true,
  logLevel: 'info',
});
```

`scripts/smoke-e2e.mjs`:

```js
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
```

Run:

```bash
npm run typecheck
npm run build
npm run smoke
```

Expected: `typecheck` prints nothing and exits 0. `build` prints the Vite summary (client bundle ≈ 4.4 MB — normal, mostly Rapier's embedded WASM) and `dist/server/index.js 4.4mb`. `smoke` prints:

```
OK   prod bundle: healthz=ok echo=prod-echo
OK   dev flow: vite page served, ws via /ws proxy echo=dev-echo
```

Ports 8080, 5173 and 18080 must be free.

- [ ] **Step 7: README and commit**

`README.md`:

```markdown
# Wreckyard

Online 3D demolition-derby arena for the browser (working title). Design: `docs/superpowers/specs/`. Plans: `docs/superpowers/plans/`.

## Commands

| Command | What it does |
|---|---|
| `npm install` | install dependencies |
| `npm run dev` | game server on :8080 + Vite client on :5173 (proxies `/ws`) |
| `npm test` | run the Vitest suite |
| `npm run typecheck` | type-check client, server and tests with `tsc` |
| `npm run build` | build `dist/client` and the bundled `dist/server/index.js` |
| `npm start` | run the bundled server (`PORT` env, default 8080) |
| `npm run smoke` | after `npm run build`: check the production bundle and the dev flow |
```

Commit (only if the user has opted in to commits; otherwise skip):

```bash
git add -A
git commit -m "chore: scaffold Vite + Vitest + ws toolchain with smoke test"
```

---

### Task 2: Shared foundations — types, math, constants, input quantization

**Files:**
- Create: `src/shared/types.ts`, `src/shared/constants.ts`, `src/shared/input.ts`
- Replace: `src/shared/math.ts` (keeps `clamp`)
- Test: `tests/math.test.ts`, `tests/input.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (later tasks rely on these exact names):
  - `types.ts`: `Vec3 {x,y,z}`, `Quat {x,y,z,w}`, `CarState {pos: Vec3; quat: Quat; linvel: Vec3; angvel: Vec3}`, `WheelPose {contact: boolean; suspensionLength: number; rotation: number; steering: number}`.
  - `math.ts`: `clamp`, `lerp`, `round3`, `round6`, `wrapPi`, `vec3`, `vadd`, `vsub`, `vscale`, `vdot`, `vlen`, `vlerp`, `QUAT_IDENTITY`, `quatRotate(q, v)`, `quatConjugate`, `quatNormalize`, `quatNlerp(a, b, t)`, `quatFromYaw(yaw)`, `quatIntegrate(q, w, dt)`.
  - `constants.ts`: `PHYSICS`, `CAR`, `SUSPENSION`, `TIRE`, `DRIVE`, `ARENA`, `CAR_FORWARD`, `CAR_RIGHT`, `CAR_UP`, interfaces `SuspensionTuning`, `TireTuning`, `DriveTuning`.
  - `input.ts`: `CarInput`, `NEUTRAL_INPUT`, `PackedInput`, `FLAG_HANDBRAKE`, `packInput`, `unpackInput`, `quantizeInput`, `isNewerSeq`.

- [ ] **Step 1: Write `src/shared/types.ts`**

```ts
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Full rigid-body state of one car (what gets sent in snapshots and restored during rollback). */
export interface CarState {
  pos: Vec3;
  quat: Quat;
  linvel: Vec3;
  angvel: Vec3;
}

/** Visual/diagnostic state of one wheel. */
export interface WheelPose {
  contact: boolean;
  suspensionLength: number;
  /** Accumulated rolling angle in radians; increases while rolling forward. */
  rotation: number;
  /** Rapier steering angle in radians; positive = left. */
  steering: number;
}
```

- [ ] **Step 2: Write the failing math tests**

`tests/math.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  QUAT_IDENTITY,
  clamp,
  lerp,
  quatConjugate,
  quatFromYaw,
  quatIntegrate,
  quatNlerp,
  quatNormalize,
  quatRotate,
  round3,
  round6,
  vdot,
  vlen,
  vlerp,
  wrapPi,
} from '../src/shared/math';

describe('scalar helpers', () => {
  it('clamp bounds values', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it('lerp interpolates', () => {
    expect(lerp(0, 10, 0.25)).toBe(2.5);
    expect(lerp(4, 8, 0)).toBe(4);
    expect(lerp(4, 8, 1)).toBe(8);
  });

  it('round3 and round6 round to fixed decimals', () => {
    expect(round3(1.23456)).toBe(1.235);
    expect(round6(0.1234567)).toBe(0.123457);
  });

  it('wrapPi wraps into [-pi, pi)', () => {
    expect(wrapPi(0.5)).toBeCloseTo(0.5, 9);
    expect(wrapPi(Math.PI * 2 + 0.5)).toBeCloseTo(0.5, 9);
    expect(wrapPi(-Math.PI * 2 - 0.5)).toBeCloseTo(-0.5, 9);
    for (const a of [-10, -3.5, 0, 3.5, 10]) {
      const w = wrapPi(a);
      expect(w).toBeGreaterThanOrEqual(-Math.PI);
      expect(w).toBeLessThan(Math.PI);
    }
  });
});

describe('vectors', () => {
  it('vlen, vdot and vlerp', () => {
    expect(vlen({ x: 3, y: 4, z: 0 })).toBe(5);
    expect(vdot({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })).toBe(32);
    expect(vlerp({ x: 0, y: 0, z: 0 }, { x: 2, y: 4, z: 6 }, 0.5)).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe('quaternions', () => {
  it('quatFromYaw(90 degrees) rotates forward +X to -Z', () => {
    const f = quatRotate(quatFromYaw(Math.PI / 2), { x: 1, y: 0, z: 0 });
    expect(f.x).toBeCloseTo(0, 5);
    expect(f.y).toBeCloseTo(0, 5);
    expect(f.z).toBeCloseTo(-1, 5);
  });

  it('quatFromYaw is unit length', () => {
    for (const yaw of [0, 0.3, 1.7, -2.2, Math.PI]) {
      const q = quatFromYaw(yaw);
      expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 9);
    }
  });

  it('conjugate undoes a rotation', () => {
    const q = quatFromYaw(0.9);
    const v = { x: 1.5, y: -2, z: 0.25 };
    const back = quatRotate(quatConjugate(q), quatRotate(q, v));
    expect(back.x).toBeCloseTo(v.x, 5);
    expect(back.y).toBeCloseTo(v.y, 5);
    expect(back.z).toBeCloseTo(v.z, 5);
  });

  it('nlerp halfway between identity and 90 degrees is 45 degrees', () => {
    const mid = quatNlerp(QUAT_IDENTITY, quatFromYaw(Math.PI / 2), 0.5);
    const f = quatRotate(mid, { x: 1, y: 0, z: 0 });
    expect(f.x).toBeCloseTo(Math.SQRT1_2, 4);
    expect(f.z).toBeCloseTo(-Math.SQRT1_2, 4);
  });

  it('nlerp takes the shortest path (q and -q are the same rotation)', () => {
    const neg = { x: 0, y: 0, z: 0, w: -1 };
    const mid = quatNlerp(QUAT_IDENTITY, neg, 0.5);
    expect(Math.abs(mid.w)).toBeCloseTo(1, 6);
  });

  it('quatNormalize falls back to identity for a zero quaternion', () => {
    expect(quatNormalize({ x: 0, y: 0, z: 0, w: 0 })).toEqual(QUAT_IDENTITY);
  });

  it('quatIntegrate rotates about the angular-velocity axis', () => {
    let q = QUAT_IDENTITY;
    for (let i = 0; i < 60; i++) q = quatIntegrate(q, { x: 0, y: 1, z: 0 }, 1 / 60); // 1 rad/s for 1 s
    const f = quatRotate(q, { x: 1, y: 0, z: 0 });
    expect(f.x).toBeCloseTo(Math.cos(1), 3);
    expect(f.z).toBeCloseTo(-Math.sin(1), 3);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/math.test.ts`
Expected: FAIL — imports such as `quatFromYaw` are not exported from `src/shared/math`.

- [ ] **Step 4: Implement `src/shared/math.ts`**

```ts
import type { Quat, Vec3 } from './types';

// Note: helpers using Math.sin/cos/atan2 (quatFromYaw) are for one-time geometry and client code,
// never for per-tick simulation code (see Global Constraints).

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const round3 = (v: number): number => Math.round(v * 1e3) / 1e3;
export const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/** Wraps an angle into [-pi, pi). */
export const wrapPi = (a: number): number => {
  const twoPi = Math.PI * 2;
  let r = (a + Math.PI) % twoPi;
  if (r < 0) r += twoPi;
  return r - Math.PI;
};

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const vadd = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vsub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vscale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const vdot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const vlen = (a: Vec3): number => Math.sqrt(vdot(a, a));
export const vlerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

export const QUAT_IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** Rotates a vector by a unit quaternion (arithmetic only, safe on the simulation path). */
export function quatRotate(q: Quat, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

export const quatConjugate = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

export function quatNormalize(q: Quat): Quat {
  const n = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (n === 0) return { ...QUAT_IDENTITY };
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

/** Normalised linear interpolation along the shortest path. */
export function quatNlerp(a: Quat, b: Quat, t: number): Quat {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  const s = dot < 0 ? -1 : 1;
  return quatNormalize({
    x: a.x + (s * b.x - a.x) * t,
    y: a.y + (s * b.y - a.y) * t,
    z: a.z + (s * b.z - a.z) * t,
    w: a.w + (s * b.w - a.w) * t,
  });
}

/** Rotation of `yaw` radians about +Y. Rounded so different JS engines build identical colliders. */
export function quatFromYaw(yaw: number): Quat {
  const h = yaw / 2;
  return quatNormalize({ x: 0, y: round6(Math.sin(h)), z: 0, w: round6(Math.cos(h)) });
}

/** First-order integration of a world-space angular velocity `w` over `dt` seconds. */
export function quatIntegrate(q: Quat, w: Vec3, dt: number): Quat {
  const hx = 0.5 * dt * w.x;
  const hy = 0.5 * dt * w.y;
  const hz = 0.5 * dt * w.z;
  return quatNormalize({
    x: q.x + hx * q.w + hy * q.z - hz * q.y,
    y: q.y + hy * q.w + hz * q.x - hx * q.z,
    z: q.z + hz * q.w + hx * q.y - hy * q.x,
    w: q.w - hx * q.x - hy * q.y - hz * q.z,
  });
}
```

- [ ] **Step 5: Run the math tests to verify they pass**

Run: `npx vitest run tests/math.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 6: Write the failing input tests**

`tests/input.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  FLAG_HANDBRAKE,
  NEUTRAL_INPUT,
  isNewerSeq,
  packInput,
  quantizeInput,
  unpackInput,
} from '../src/shared/input';

describe('packInput / unpackInput', () => {
  it('round-trips within one int8 step', () => {
    const packed = packInput({ throttle: 0.5, steer: -0.25, handbrake: true });
    const back = unpackInput(packed);
    expect(back.throttle).toBeCloseTo(0.5, 2);
    expect(back.steer).toBeCloseTo(-0.25, 2);
    expect(back.handbrake).toBe(true);
    expect(packed.flags & FLAG_HANDBRAKE).toBe(FLAG_HANDBRAKE);
  });

  it('clamps out-of-range values', () => {
    expect(packInput({ throttle: 5, steer: -5, handbrake: false })).toEqual({ throttle: 127, steer: -127, flags: 0 });
  });

  it('treats NaN and infinities as neutral', () => {
    expect(packInput({ throttle: NaN, steer: Infinity, handbrake: false })).toEqual({ throttle: 0, steer: 0, flags: 0 });
    expect(packInput({ throttle: -Infinity, steer: NaN, handbrake: false })).toEqual({ throttle: 0, steer: 0, flags: 0 });
  });

  it('never produces negative zero', () => {
    const p = packInput({ throttle: -0.001, steer: -0, handbrake: false });
    expect(Object.is(p.throttle, 0)).toBe(true);
    expect(Object.is(p.steer, 0)).toBe(true);
  });
});

describe('quantizeInput', () => {
  it('is idempotent', () => {
    const once = quantizeInput({ throttle: 0.3333, steer: -0.777, handbrake: false });
    expect(quantizeInput(once)).toEqual(once);
  });

  it('snaps to multiples of 1/127', () => {
    const q = quantizeInput({ throttle: 0.3333, steer: 0, handbrake: false });
    expect(Math.round(q.throttle * 127)).toBeCloseTo(q.throttle * 127, 9);
  });

  it('leaves the neutral input neutral', () => {
    expect(quantizeInput({ ...NEUTRAL_INPUT })).toEqual(NEUTRAL_INPUT);
  });
});

describe('isNewerSeq (u32, wrap-aware)', () => {
  it('orders ordinary sequence numbers', () => {
    expect(isNewerSeq(5, 3)).toBe(true);
    expect(isNewerSeq(3, 5)).toBe(false);
    expect(isNewerSeq(4, 4)).toBe(false);
  });

  it('handles wraparound at 2^32', () => {
    expect(isNewerSeq(0, 0xffffffff)).toBe(true);
    expect(isNewerSeq(0xffffffff, 0)).toBe(false);
    expect(isNewerSeq(2, 0xfffffffe)).toBe(true);
  });
});
```

- [ ] **Step 7: Run to verify failure, then implement `src/shared/input.ts`**

Run: `npx vitest run tests/input.test.ts` — Expected: FAIL (`src/shared/input` not found).

`src/shared/input.ts`:

```ts
import { clamp } from './math';

export interface CarInput {
  /** -1 (reverse/brake) .. 1 (forward). */
  throttle: number;
  /** -1 (left) .. 1 (right). */
  steer: number;
  handbrake: boolean;
}

export const NEUTRAL_INPUT: Readonly<CarInput> = { throttle: 0, steer: 0, handbrake: false };

export const FLAG_HANDBRAKE = 1;

/** Wire representation: two int8 and a flags byte. */
export interface PackedInput {
  throttle: number;
  steer: number;
  flags: number;
}

const q8 = (v: number): number => (Number.isFinite(v) ? Math.round(clamp(v, -1, 1) * 127) + 0 : 0);

export function packInput(i: CarInput): PackedInput {
  return { throttle: q8(i.throttle), steer: q8(i.steer), flags: i.handbrake ? FLAG_HANDBRAKE : 0 };
}

export function unpackInput(p: PackedInput): CarInput {
  return {
    throttle: p.throttle / 127,
    steer: p.steer / 127,
    handbrake: (p.flags & FLAG_HANDBRAKE) !== 0,
  };
}

/** Both sides quantize before applying an input so client prediction and the server see identical values. */
export const quantizeInput = (i: CarInput): CarInput => unpackInput(packInput(i));

/** True when sequence number `a` is newer than `b` (u32, wrap-aware). */
export const isNewerSeq = (a: number, b: number): boolean => ((a - b) | 0) > 0;
```

Run: `npx vitest run tests/input.test.ts`
Expected: PASS.

- [ ] **Step 8: Write `src/shared/constants.ts` and type-check**

All tunables live here. `DRIVE`, `TIRE` and `SUSPENSION` are deliberately mutable objects so the sandbox tuning panel can adjust them live; `CAR` and `ARENA` are read-only.

```ts
import type { Vec3 } from './types';

export const PHYSICS = {
  TICK_RATE: 60,
  DT: 1 / 60,
  GRAVITY: 9.81,
} as const;

/** Local axes of a car: forward +X, up +Y, right +Z. */
export const CAR_FORWARD: Readonly<Vec3> = { x: 1, y: 0, z: 0 };
export const CAR_UP: Readonly<Vec3> = { x: 0, y: 1, z: 0 };
export const CAR_RIGHT: Readonly<Vec3> = { x: 0, y: 0, z: 1 };

export const CAR = {
  MASS: 1500,
  /** Chassis collider half extents (forward = +X). */
  HALF: { x: 2.3, y: 0.5, z: 1.0 },
  /** Centre of mass sits this far below the chassis centre (stability). */
  COM_Y: -0.35,
  /** Principal inertia: roll about X, yaw about Y, pitch about Z. */
  INERTIA: { x: 625, y: 3145, z: 2770 },
  FRICTION: 0.5,
  RESTITUTION: 0.25,
  LINEAR_DAMPING: 0.02,
  ANGULAR_DAMPING: 0.6,
  /** Spawn height of the chassis centre; the car settles to ~1.07 m. */
  SPAWN_HEIGHT: 1.3,
  WHEEL: { X: 1.45, Z: 0.95, HARD_Y: -0.3, REST_LENGTH: 0.45, RADIUS: 0.4 },
} as const;

export interface SuspensionTuning {
  STIFFNESS: number;
  COMPRESSION: number;
  RELAXATION: number;
  MAX_TRAVEL: number;
  MAX_FORCE: number;
}
export const SUSPENSION: SuspensionTuning = {
  STIFFNESS: 30,
  COMPRESSION: 3.0,
  RELAXATION: 2.6,
  MAX_TRAVEL: 0.4,
  MAX_FORCE: 60000,
};

export interface TireTuning {
  SLIP: number;
  SIDE_STIFFNESS: number;
  /** Rear tyre grip multiplier while the handbrake is held. */
  HANDBRAKE_SLIP_SCALE: number;
}
export const TIRE: TireTuning = {
  SLIP: 2.0,
  SIDE_STIFFNESS: 1.0,
  HANDBRAKE_SLIP_SCALE: 0.5,
};

export interface DriveTuning {
  ENGINE: number;
  REVERSE_SCALE: number;
  BRAKE: number;
  HANDBRAKE: number;
  MAX_SPEED: number;
  MAX_STEER: number;
  MAX_STEER_FAST: number;
  STEER_FADE_SPEED: number;
  /** Rapier turns LEFT for positive angles; input +1 means RIGHT, hence -1. */
  STEER_SIGN: 1 | -1;
}
export const DRIVE: DriveTuning = {
  ENGINE: 8000,
  REVERSE_SCALE: 0.6,
  BRAKE: 55,
  HANDBRAKE: 30,
  MAX_SPEED: 21,
  MAX_STEER: 0.55,
  MAX_STEER_FAST: 0.25,
  STEER_FADE_SPEED: 20,
  STEER_SIGN: -1,
};

export const ARENA = {
  /** Distance from the centre to the inner face of the wall ring (m). */
  RADIUS: 45,
  WALL_SEGMENTS: 32,
  WALL_HALF_HEIGHT: 1.5,
  WALL_HALF_THICKNESS: 1.0,
  GROUND_HALF_EXTENT: 120,
  SPAWN_RADIUS: 32,
  MAX_CARS: 8,
  OBSTACLE_COUNT: 4,
  OBSTACLE_RING_RADIUS: 14,
  OBSTACLE_HALF: { x: 2.5, y: 0.75, z: 1.0 },
} as const;
```

Run: `npm run typecheck && npm test`
Expected: type-check clean; all tests pass (smoke, math, input).

- [ ] **Step 9: Commit (only if the user opted in to commits)**

```bash
git add -A
git commit -m "feat(shared): types, math helpers, tuning constants, input quantization"
```

---

### Task 3: Physics init and arena (walls, obstacles, spawn poses)

**Files:**
- Create: `src/shared/physics.ts`, `src/shared/arena.ts`
- Test: `tests/arena.test.ts`

**Interfaces:**
- Consumes: `ARENA`, `CAR` from `constants.ts`; `quatFromYaw`, `round3`, `round6` from `math.ts`; `Quat`, `Vec3` from `types.ts`.
- Produces:
  - `physics.ts`: `RAPIER` (re-export of the Rapier module, keeps its type namespace: `RAPIER.World`, …), `initPhysics(): Promise<void>` (idempotent; await once per process/page before creating any physics object).
  - `arena.ts`: `SpawnPose {pos: Vec3; quat: Quat; yaw: number}`, `BoxSpec {x,y,z,yaw,hx,hy,hz}`, `ArenaOptions {walls?: boolean; groundHalfExtent?: number}`, `wallSegments(): BoxSpec[]`, `obstacleBoxes(): BoxSpec[]`, `spawnPose(index: number, count: number): SpawnPose`, `buildArena(world: RAPIER.World, options?: ArenaOptions): void`. Wall/obstacle `BoxSpec`s are also what the client uses to draw the arena, so visuals and colliders share one source of truth.

- [ ] **Step 1: Write the failing arena tests**

`tests/arena.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { ARENA, CAR, CAR_FORWARD } from '../src/shared/constants';
import { buildArena, obstacleBoxes, spawnPose, wallSegments } from '../src/shared/arena';
import { quatFromYaw, quatRotate, vdot } from '../src/shared/math';
import { RAPIER, initPhysics } from '../src/shared/physics';

beforeAll(async () => {
  await initPhysics();
});

describe('spawnPose', () => {
  it('places cars on a circle facing the centre', () => {
    for (let i = 0; i < 8; i++) {
      const p = spawnPose(i, 8);
      expect(Math.hypot(p.pos.x, p.pos.z)).toBeCloseTo(ARENA.SPAWN_RADIUS, 2);
      expect(p.pos.y).toBe(CAR.SPAWN_HEIGHT);
      const forward = quatRotate(p.quat, CAR_FORWARD);
      const inward = { x: -p.pos.x / ARENA.SPAWN_RADIUS, y: 0, z: -p.pos.z / ARENA.SPAWN_RADIUS };
      expect(vdot(forward, inward)).toBeCloseTo(1, 2);
    }
  });

  it('spaces cars evenly', () => {
    const chord = 2 * ARENA.SPAWN_RADIUS * Math.sin(Math.PI / 8);
    for (let i = 0; i < 8; i++) {
      const a = spawnPose(i, 8).pos;
      const b = spawnPose((i + 1) % 8, 8).pos;
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(chord, 1);
    }
  });

  it('is deterministic', () => {
    expect(spawnPose(3, 8)).toEqual(spawnPose(3, 8));
  });

  it('keeps every spawn clear of the walls and obstacles', () => {
    for (let i = 0; i < 8; i++) {
      const p = spawnPose(i, 8).pos;
      expect(Math.hypot(p.x, p.z)).toBeLessThan(ARENA.RADIUS - 5);
      for (const o of obstacleBoxes()) expect(Math.hypot(p.x - o.x, p.z - o.z)).toBeGreaterThan(8);
    }
  });
});

describe('arena geometry specs', () => {
  it('builds a closed ring of wall segments at the arena radius', () => {
    const segments = wallSegments();
    expect(segments).toHaveLength(ARENA.WALL_SEGMENTS);
    for (const s of segments) {
      const r = Math.hypot(s.x, s.z);
      expect(r).toBeCloseTo(ARENA.RADIUS + ARENA.WALL_HALF_THICKNESS, 2);
      // the long local axis must be tangent to the ring, i.e. perpendicular to the radial direction
      const axis = quatRotate(quatFromYaw(s.yaw), { x: 1, y: 0, z: 0 });
      const radial = { x: s.x / r, y: 0, z: s.z / r };
      expect(Math.abs(vdot(axis, radial))).toBeLessThan(1e-3);
    }
  });

  it('overlaps adjacent segments so there are no gaps', () => {
    const chord = 2 * (ARENA.RADIUS + ARENA.WALL_HALF_THICKNESS) * Math.sin(Math.PI / ARENA.WALL_SEGMENTS);
    expect(wallSegments()[0]!.hx * 2).toBeGreaterThan(chord);
  });

  it('offsets obstacles from the spawn lines by 22.5 degrees', () => {
    for (const o of obstacleBoxes()) {
      const deg = (Math.atan2(o.z, o.x) * 180) / Math.PI;
      const mod = ((deg % 45) + 45) % 45;
      expect(mod).toBeCloseTo(22.5, 0);
    }
  });
});

describe('buildArena physics', () => {
  function makeWorld(options?: Parameters<typeof buildArena>[1]): RAPIER.World {
    const w = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    w.timestep = 1 / 60;
    buildArena(w, options);
    return w;
  }

  it('creates ground, walls and obstacles', () => {
    const w = makeWorld();
    expect(w.colliders.len()).toBe(1 + ARENA.WALL_SEGMENTS + ARENA.OBSTACLE_COUNT);
    w.free();
  });

  it('creates only the ground when walls are disabled', () => {
    const w = makeWorld({ walls: false });
    expect(w.colliders.len()).toBe(1);
    w.free();
  });

  it('supports a ball resting on the ground', () => {
    const w = makeWorld();
    const b = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 3, 0));
    w.createCollider(RAPIER.ColliderDesc.ball(0.5), b);
    for (let i = 0; i < 240; i++) w.step();
    expect(b.translation().y).toBeGreaterThan(0.45);
    expect(b.translation().y).toBeLessThan(0.55);
    w.free();
  });

  it('keeps fast objects inside the wall ring', () => {
    const w = makeWorld();
    const balls: RAPIER.RigidBody[] = [];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const b = w.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(Math.cos(a) * 1.5, 0.6, Math.sin(a) * 1.5)
          .setLinvel(Math.cos(a) * 40, 0, Math.sin(a) * 40)
          .setCcdEnabled(true),
      );
      w.createCollider(RAPIER.ColliderDesc.ball(0.5).setRestitution(0.3), b);
      balls.push(b);
    }
    for (let i = 0; i < 600; i++) w.step();
    for (const b of balls) {
      const t = b.translation();
      expect(Math.hypot(t.x, t.z)).toBeLessThan(ARENA.RADIUS);
      expect(t.y).toBeLessThan(3);
    }
    w.free();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/arena.test.ts`
Expected: FAIL — cannot resolve `../src/shared/physics` / `../src/shared/arena`.

- [ ] **Step 3: Write `src/shared/physics.ts`**

```ts
import RAPIER from '@dimforge/rapier3d-deterministic-compat';

let ready: Promise<void> | null = null;

/** Await once per process / page before creating any physics object. Safe to call repeatedly. */
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

export { RAPIER };
```

- [ ] **Step 4: Write `src/shared/arena.ts`**

```ts
import { ARENA, CAR } from './constants';
import { quatFromYaw, round3, round6 } from './math';
import { RAPIER } from './physics';
import type { Quat, Vec3 } from './types';

export interface SpawnPose {
  pos: Vec3;
  quat: Quat;
  yaw: number;
}

/** A yaw-rotated box described by its centre and half extents (used for colliders and for visuals). */
export interface BoxSpec {
  x: number;
  y: number;
  z: number;
  yaw: number;
  hx: number;
  hy: number;
  hz: number;
}

export interface ArenaOptions {
  /** false builds only the ground (handy for handling tests). Default true. */
  walls?: boolean;
  groundHalfExtent?: number;
}

/** Regular polygon of wall boxes whose inner faces sit at ARENA.RADIUS. */
export function wallSegments(): BoxSpec[] {
  const n = ARENA.WALL_SEGMENTS;
  const t = ARENA.WALL_HALF_THICKNESS;
  const r = ARENA.RADIUS + t;
  const hx = round3(r * Math.tan(Math.PI / n) + 0.3); // +0.3 overlaps neighbours so there are no gaps
  const out: BoxSpec[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({
      x: round3(Math.cos(a) * r),
      y: ARENA.WALL_HALF_HEIGHT,
      z: round3(Math.sin(a) * r),
      yaw: round6(-a - Math.PI / 2), // local +X (the long axis) becomes tangent to the ring
      hx,
      hy: ARENA.WALL_HALF_HEIGHT,
      hz: t,
    });
  }
  return out;
}

/** Concrete blocks on a ring, offset by 22.5 degrees so they never sit on a spawn line. */
export function obstacleBoxes(): BoxSpec[] {
  const out: BoxSpec[] = [];
  for (let i = 0; i < ARENA.OBSTACLE_COUNT; i++) {
    const a = ((i + 0.25) / ARENA.OBSTACLE_COUNT) * Math.PI * 2;
    out.push({
      x: round3(Math.cos(a) * ARENA.OBSTACLE_RING_RADIUS),
      y: ARENA.OBSTACLE_HALF.y,
      z: round3(Math.sin(a) * ARENA.OBSTACLE_RING_RADIUS),
      yaw: round6(-a - Math.PI / 2),
      hx: ARENA.OBSTACLE_HALF.x,
      hy: ARENA.OBSTACLE_HALF.y,
      hz: ARENA.OBSTACLE_HALF.z,
    });
  }
  return out;
}

/** Evenly spaced spawn on a circle, facing the centre. `index` is the position in the sorted roster. */
export function spawnPose(index: number, count: number): SpawnPose {
  const a = (index / count) * Math.PI * 2;
  const x = round3(Math.cos(a) * ARENA.SPAWN_RADIUS);
  const z = round3(Math.sin(a) * ARENA.SPAWN_RADIUS);
  // forward (+X rotated by yaw about +Y) = (cos yaw, 0, -sin yaw) must equal (-cos a, 0, -sin a)
  const yaw = round6(Math.PI - a);
  return { pos: { x, y: CAR.SPAWN_HEIGHT, z }, quat: quatFromYaw(yaw), yaw };
}

export function buildArena(world: RAPIER.World, options: ArenaOptions = {}): void {
  const walls = options.walls ?? true;
  const half = options.groundHalfExtent ?? ARENA.GROUND_HALF_EXTENT;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(half, 0.5, half).setTranslation(0, -0.5, 0).setFriction(1).setRestitution(0),
    body,
  );
  if (!walls) return;
  for (const b of [...wallSegments(), ...obstacleBoxes()]) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz)
        .setTranslation(b.x, b.y, b.z)
        .setRotation(quatFromYaw(b.yaw))
        .setFriction(0.3)
        .setRestitution(0.3),
      body,
    );
  }
}
```

- [ ] **Step 5: Run the tests and type-check**

Run: `npx vitest run tests/arena.test.ts && npm run typecheck`
Expected: PASS (all arena tests), type-check clean.

- [ ] **Step 6: Commit (only if the user opted in to commits)**

```bash
git add -A
git commit -m "feat(shared): physics init and arena geometry with spawn poses"
```

---

### Task 4: Vehicle model and `Simulation`

This is the highest-risk task (handling feel). The thresholds below were measured in the rehearsal with exactly the constants from Task 2 ("Variant B" in the spec addendum), so they should pass first time. If one misses, use the tuning table in Step 6 — adjust constants, never the tests, unless a comment says so.

**Files:**
- Create: `src/shared/vehicle.ts`, `src/shared/sim.ts`
- Test: `tests/vehicle.test.ts`

**Interfaces:**
- Consumes: `CAR`, `CAR_FORWARD`, `DRIVE`, `PHYSICS`, `SUSPENSION`, `TIRE`, `ARENA` (constants); `CarInput`, `NEUTRAL_INPUT`, `quantizeInput` (input); `clamp`, `lerp`, `quatRotate`, `vdot` (math); `RAPIER` (physics); `buildArena`, `spawnPose`, `ArenaOptions` (arena); `CarState`, `WheelPose`, `Quat`, `Vec3` (types).
- Produces:
  - `vehicle.ts`: `FRONT_WHEELS = [0, 1]`, `REAR_WHEELS = [2, 3]`, `wheelLocalPosition(index: number, suspensionLength: number): Vec3` (throws `RangeError` for index outside 0–3), `CarRig {slot, body, collider, controller, input}`, `createCarRig(world, slot, pose: {pos: Vec3; quat: Quat}): CarRig`, `driveCar(rig: CarRig): void`, `forwardSpeed(body): number`.
  - `sim.ts`: `SimOptions` (= `ArenaOptions`), `class Simulation` — `constructor(slots: readonly number[], options?: SimOptions)`, `slots: readonly number[]`, `tick: number`, `setInput(slot, input)` (quantizes), `getInput(slot): CarInput`, `step(): void`, `getState(slot): CarState`, `setState(slot, state): void`, `getWheels(slot): WheelPose[]`, `dispose(): void` (idempotent). Unknown slot → `RangeError`; `step()` after `dispose()` → `Error` mentioning "disposed".

- [ ] **Step 1: Write the failing tests**

`tests/vehicle.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ARENA, CAR, CAR_FORWARD, CAR_RIGHT, CAR_UP, DRIVE } from '../src/shared/constants';
import { NEUTRAL_INPUT, type CarInput } from '../src/shared/input';
import { quatRotate, vdot, vlen, vsub } from '../src/shared/math';
import { initPhysics } from '../src/shared/physics';
import { Simulation, type SimOptions } from '../src/shared/sim';
import { wheelLocalPosition } from '../src/shared/vehicle';

/** Flat, wall-less, very large ground so straight-line handling tests are not cut short. */
const FLAT: SimOptions = { walls: false, groundHalfExtent: 600 };

const sims: Simulation[] = [];
const make = (slots: number[], options?: SimOptions): Simulation => {
  const s = new Simulation(slots, options);
  sims.push(s);
  return s;
};

beforeAll(async () => {
  await initPhysics();
});
afterEach(() => {
  while (sims.length) sims.pop()!.dispose();
});

function run(sim: Simulation, ticks: number, inputs: Record<number, CarInput> = {}): void {
  for (const [slot, input] of Object.entries(inputs)) sim.setInput(Number(slot), input);
  for (let i = 0; i < ticks; i++) sim.step();
}

const fwd = (sim: Simulation, slot = 0): number => {
  const s = sim.getState(slot);
  return vdot(s.linvel, quatRotate(s.quat, CAR_FORWARD));
};
const lat = (sim: Simulation, slot = 0): number => {
  const s = sim.getState(slot);
  return vdot(s.linvel, quatRotate(s.quat, CAR_RIGHT));
};
const upY = (sim: Simulation, slot = 0): number => quatRotate(sim.getState(slot).quat, CAR_UP).y;
const yaw = (sim: Simulation, slot = 0): number => sim.getState(slot).angvel.y;
const full: CarInput = { throttle: 1, steer: 0, handbrake: false };

describe('wheel layout', () => {
  it('puts front wheels forward (+X) and right-hand wheels on +Z', () => {
    expect(wheelLocalPosition(0, 0.3)).toEqual({ x: CAR.WHEEL.X, y: CAR.WHEEL.HARD_Y - 0.3, z: CAR.WHEEL.Z });
    expect(wheelLocalPosition(1, 0.3).z).toBe(-CAR.WHEEL.Z);
    expect(wheelLocalPosition(2, 0.3).x).toBe(-CAR.WHEEL.X);
    expect(wheelLocalPosition(3, 0.3)).toEqual({ x: -CAR.WHEEL.X, y: CAR.WHEEL.HARD_Y - 0.3, z: -CAR.WHEEL.Z });
  });

  it('rejects wheel indices outside 0..3', () => {
    expect(() => wheelLocalPosition(4, 0)).toThrow(RangeError);
    expect(() => wheelLocalPosition(-1, 0)).toThrow(RangeError);
  });
});

describe('Simulation: driving', () => {
  it('settles on its suspension with all four wheels in contact', () => {
    const sim = make([0], FLAT);
    run(sim, 240);
    const s = sim.getState(0);
    expect(s.pos.y).toBeGreaterThan(0.95);
    expect(s.pos.y).toBeLessThan(1.2);
    expect(sim.getWheels(0).every((w) => w.contact)).toBe(true);
    expect(vlen(s.linvel)).toBeLessThan(0.2);
    expect(upY(sim)).toBeGreaterThan(0.99);
  });

  it('accelerates along its forward axis and is capped near MAX_SPEED', () => {
    const sim = make([0], FLAT);
    run(sim, 60);
    const start = sim.getState(0).pos;
    run(sim, 60 * 3, { 0: full });
    const v3 = fwd(sim);
    expect(v3).toBeGreaterThan(12);
    expect(v3).toBeLessThan(19);
    const s = sim.getState(0);
    const moved = vsub(s.pos, start);
    expect(vdot(moved, quatRotate(s.quat, CAR_FORWARD))).toBeGreaterThan(20);
    expect(Math.abs(vdot(moved, quatRotate(s.quat, CAR_RIGHT)))).toBeLessThan(1);
    run(sim, 60 * 8);
    expect(fwd(sim)).toBeGreaterThan(17);
    expect(fwd(sim)).toBeLessThan(DRIVE.MAX_SPEED + 0.5);
  });

  const cruise = (sim: Simulation): void => {
    run(sim, 60);
    run(sim, 60 * 4, { 0: { throttle: 0.6, steer: 0, handbrake: false } });
  };

  it('steers right for positive steer input', () => {
    const sim = make([0], FLAT);
    cruise(sim);
    run(sim, 60, { 0: { throttle: 0.6, steer: 1, handbrake: false } });
    expect(yaw(sim)).toBeLessThan(-0.5); // clockwise seen from above
    expect(lat(sim)).toBeGreaterThan(0.5); // sliding toward the car's right (+Z)
  });

  it('steers left for negative steer input', () => {
    const sim = make([0], FLAT);
    cruise(sim);
    run(sim, 60, { 0: { throttle: 0.6, steer: -1, handbrake: false } });
    expect(yaw(sim)).toBeGreaterThan(0.5);
    expect(lat(sim)).toBeLessThan(-0.5);
  });

  it('turns only the front wheels, with a negative Rapier angle for a right turn', () => {
    const sim = make([0], FLAT);
    run(sim, 30, { 0: { throttle: 0, steer: 1, handbrake: false } });
    const w = sim.getWheels(0);
    expect(w[0]!.steering).toBeLessThan(0);
    expect(w[1]!.steering).toBeLessThan(0);
    expect(w[2]!.steering).toBeCloseTo(0, 6);
    expect(w[3]!.steering).toBeCloseTo(0, 6);
  });

  it('brakes to a stop quickly without reversing through it', () => {
    const sim = make([0], FLAT);
    run(sim, 60);
    run(sim, 60 * 6, { 0: full });
    expect(fwd(sim)).toBeGreaterThan(17);
    const p0 = sim.getState(0).pos;
    sim.setInput(0, { throttle: -1, steer: 0, handbrake: false });
    let ticks = 0;
    while (fwd(sim) > 1 && ticks < 60 * 5) {
      sim.step();
      ticks++;
    }
    expect(ticks / 60).toBeLessThan(3);
    expect(vlen(vsub(sim.getState(0).pos, p0))).toBeLessThan(30);
    expect(upY(sim)).toBeGreaterThan(0.99);
  });

  it('reverses at a moderate speed', () => {
    const sim = make([0], FLAT);
    run(sim, 60);
    run(sim, 240, { 0: { throttle: -1, steer: 0, handbrake: false } });
    expect(fwd(sim)).toBeLessThan(-6);
    expect(fwd(sim)).toBeGreaterThan(-9.5);
  });

  it('does not roll over in a full-lock circle', () => {
    const sim = make([0], FLAT);
    run(sim, 60);
    sim.setInput(0, { throttle: 1, steer: 1, handbrake: false });
    let minUp = 1;
    for (let i = 0; i < 60 * 12; i++) {
      sim.step();
      if (i % 6 === 0) minUp = Math.min(minUp, upY(sim));
    }
    expect(minUp).toBeGreaterThan(0.95);
    expect(vlen(sim.getState(0).linvel)).toBeGreaterThan(10);
  });

  it('handbrake bleeds speed and swings the tail compared with coasting', () => {
    const build = (handbrake: boolean): Simulation => {
      const sim = make([0], FLAT);
      run(sim, 60);
      run(sim, 60 * 4, { 0: full });
      run(sim, 60, { 0: { throttle: 0, steer: 0.6, handbrake } });
      return sim;
    };
    const coast = build(false);
    const braked = build(true);
    expect(fwd(braked)).toBeLessThan(fwd(coast) - 2);
    expect(Math.abs(yaw(braked))).toBeGreaterThan(Math.abs(yaw(coast)) + 0.5);
  });

  it('reports increasing wheel rotation while rolling forward', () => {
    // If this fails because Rapier reports a NEGATIVE rotation, change the assertion to `< before - 1`
    // and set WHEEL_SPIN_SIGN to 1 in Task 5's carView.ts (see the note there).
    const sim = make([0], FLAT);
    run(sim, 60);
    const before = sim.getWheels(0)[2]!.rotation;
    run(sim, 60, { 0: full });
    expect(sim.getWheels(0)[2]!.rotation).toBeGreaterThan(before + 1);
  });

  it('is contained by the arena walls', () => {
    const sim = make([0]); // default arena with walls
    run(sim, 30);
    sim.setInput(0, { throttle: -1, steer: 0, handbrake: false }); // reverse from radius 32 toward the wall at 45
    let maxR = 0;
    for (let i = 0; i < 60 * 10; i++) {
      sim.step();
      const p = sim.getState(0).pos;
      maxR = Math.max(maxR, Math.hypot(p.x, p.z));
    }
    expect(maxR).toBeGreaterThan(38); // it did reach the wall...
    expect(maxR).toBeLessThan(ARENA.RADIUS); // ...and stayed inside
  });

  it('two cars driven head-on collide instead of passing through each other', () => {
    const sim = make([0, 1], FLAT); // slots 0 and 1 spawn opposite each other, facing the centre
    run(sim, 60);
    run(sim, 0, { 0: full, 1: full });
    let minDist = Infinity;
    for (let i = 0; i < 60 * 8; i++) {
      sim.step();
      minDist = Math.min(minDist, vlen(vsub(sim.getState(0).pos, sim.getState(1).pos)));
    }
    expect(minDist).toBeGreaterThan(4.0); // cars are 4.6 m long
    expect(upY(sim, 0)).toBeGreaterThan(0.9);
    expect(upY(sim, 1)).toBeGreaterThan(0.9);
  });
});

/** Trig-free scripted driving so results do not depend on the JS engine's Math.sin. */
function scripted(sim: Simulation, ticks: number, from = 0): void {
  const steer = [-1, 0, 1, 0, 1, -1];
  for (let i = from; i < from + ticks; i++) {
    for (const slot of sim.slots) {
      sim.setInput(slot, {
        throttle: slot === 2 && i > 600 ? -1 : 1,
        steer: steer[((i >> 5) + slot) % steer.length]!,
        handbrake: (i + slot * 37) % 240 > 200,
      });
    }
    sim.step();
  }
}
const snapshot = (sim: Simulation): string => JSON.stringify(sim.slots.map((s) => sim.getState(s)));

describe('Simulation: determinism and rollback assumptions', () => {
  it('identical scripted runs are bit-identical', () => {
    const a = make([0, 1, 2]);
    const b = make([0, 1, 2]);
    scripted(a, 900);
    scripted(b, 900);
    expect(snapshot(a)).toBe(snapshot(b));
  });

  it('different inputs give different results (the check above is not trivially true)', () => {
    const a = make([0, 1, 2]);
    const b = make([0, 1, 2]);
    scripted(a, 300);
    scripted(b, 299);
    expect(snapshot(a)).not.toBe(snapshot(b));
  });

  it('resetting body state reproduces the trajectory (client rollback assumption)', () => {
    const ref = make([0], FLAT);
    scripted(ref, 150);
    const snap = ref.getState(0);
    scripted(ref, 150, 150);
    // a second world with a completely different history, restored to the tick-150 state
    const other = make([0], FLAT);
    run(other, 150, { 0: { throttle: -1, steer: 1, handbrake: true } });
    other.setState(0, snap);
    scripted(other, 150, 150);
    const a = ref.getState(0);
    const b = other.getState(0);
    expect(vlen(vsub(a.pos, b.pos))).toBeLessThan(1e-2);
    expect(vlen(vsub(a.linvel, b.linvel))).toBeLessThan(1e-2);
  });

  it('steps 8 cars fast enough for a 60 Hz server (mean < 2 ms per tick)', () => {
    const sim = make([0, 1, 2, 3, 4, 5, 6, 7]);
    const t0 = performance.now();
    scripted(sim, 600);
    expect((performance.now() - t0) / 600).toBeLessThan(2);
  });
});

describe('Simulation: rosters, inputs and lifecycle', () => {
  it('sorts and de-duplicates slots', () => {
    expect(make([3, 1, 1, 0]).slots).toEqual([0, 1, 3]);
  });

  it('rejects invalid rosters immediately', () => {
    expect(() => new Simulation([0, 1, 2, 3, 4, 5, 6, 7, 8])).toThrow(RangeError);
    expect(() => new Simulation([8])).toThrow(RangeError);
    expect(() => new Simulation([-1])).toThrow(RangeError);
    expect(() => new Simulation([1.5])).toThrow(RangeError);
  });

  it('quantizes and sanitises inputs at the simulation boundary', () => {
    const sim = make([0]);
    sim.setInput(0, { throttle: 0.5, steer: NaN, handbrake: true });
    expect(sim.getInput(0)).toEqual({ throttle: 64 / 127, steer: 0, handbrake: true });
  });

  it('rejects unknown slots', () => {
    const sim = make([0, 2]);
    expect(() => sim.setInput(1, NEUTRAL_INPUT)).toThrow(RangeError);
    expect(() => sim.getState(5)).toThrow(RangeError);
  });

  it('counts ticks', () => {
    const sim = make([0]);
    sim.step();
    sim.step();
    expect(sim.tick).toBe(2);
  });

  it('dispose is idempotent and step-after-dispose throws', () => {
    const sim = new Simulation([0, 1]);
    sim.step();
    sim.dispose();
    sim.dispose();
    expect(() => sim.step()).toThrow(/disposed/i);
  });

  it('does not leak memory when simulations are created and destroyed repeatedly', () => {
    const cycle = (): void => {
      const s = new Simulation([0, 1, 2, 3, 4, 5, 6, 7]);
      for (let i = 0; i < 10; i++) s.step();
      s.dispose();
    };
    for (let i = 0; i < 100; i++) cycle(); // warm up the allocator
    const before = process.memoryUsage().rss;
    for (let i = 0; i < 300; i++) cycle();
    const growthMb = (process.memoryUsage().rss - before) / 1048576;
    expect(growthMb).toBeLessThan(50); // without removeVehicleController this grows by ~150 MB
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/vehicle.test.ts`
Expected: FAIL — cannot resolve `../src/shared/sim` / `../src/shared/vehicle`.

- [ ] **Step 3: Implement `src/shared/vehicle.ts`**

```ts
import { CAR, CAR_FORWARD, DRIVE, SUSPENSION, TIRE } from './constants';
import { NEUTRAL_INPUT, type CarInput } from './input';
import { clamp, lerp, quatRotate, vdot } from './math';
import { RAPIER } from './physics';
import type { Quat, Vec3 } from './types';

/** Wheel order: 0 = front right (+Z), 1 = front left, 2 = rear right, 3 = rear left. */
export const FRONT_WHEELS = [0, 1] as const;
export const REAR_WHEELS = [2, 3] as const;
const WHEEL_SIGNS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Chassis-local position of a wheel centre for a given suspension length (index 0..3). */
export function wheelLocalPosition(index: number, suspensionLength: number): Vec3 {
  const signs = WHEEL_SIGNS[index];
  if (!signs) throw new RangeError(`wheel index ${index} out of range`);
  return { x: signs[0] * CAR.WHEEL.X, y: CAR.WHEEL.HARD_Y - suspensionLength, z: signs[1] * CAR.WHEEL.Z };
}

export interface CarRig {
  readonly slot: number;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  input: CarInput;
}

export function createCarRig(world: RAPIER.World, slot: number, pose: { pos: Vec3; quat: Quat }): CarRig {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pose.pos.x, pose.pos.y, pose.pos.z)
      .setRotation(pose.quat)
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setLinearDamping(CAR.LINEAR_DAMPING)
      .setAngularDamping(CAR.ANGULAR_DAMPING),
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(CAR.HALF.x, CAR.HALF.y, CAR.HALF.z)
      .setMassProperties(CAR.MASS, { x: 0, y: CAR.COM_Y, z: 0 }, CAR.INERTIA, { x: 0, y: 0, z: 0, w: 1 })
      .setFriction(CAR.FRICTION)
      .setRestitution(CAR.RESTITUTION),
    body,
  );
  const controller = world.createVehicleController(body);
  controller.indexUpAxis = 1;
  controller.setIndexForwardAxis = 0; // Rapier exposes this setter as an accessor literally named `setIndexForwardAxis`
  for (let i = 0; i < 4; i++) {
    controller.addWheel(
      wheelLocalPosition(i, 0), // suspension length 0 = the hard point on the chassis
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 0, z: 1 },
      CAR.WHEEL.REST_LENGTH,
      CAR.WHEEL.RADIUS,
    );
    controller.setWheelSuspensionStiffness(i, SUSPENSION.STIFFNESS);
    controller.setWheelSuspensionCompression(i, SUSPENSION.COMPRESSION);
    controller.setWheelSuspensionRelaxation(i, SUSPENSION.RELAXATION);
    controller.setWheelMaxSuspensionTravel(i, SUSPENSION.MAX_TRAVEL);
    controller.setWheelMaxSuspensionForce(i, SUSPENSION.MAX_FORCE);
    controller.setWheelFrictionSlip(i, TIRE.SLIP);
    controller.setWheelSideFrictionStiffness(i, TIRE.SIDE_STIFFNESS);
  }
  return { slot, body, collider, controller, input: { ...NEUTRAL_INPUT } };
}

/** Signed speed along the car's forward axis (m/s). */
export function forwardSpeed(body: RAPIER.RigidBody): number {
  return vdot(body.linvel(), quatRotate(body.rotation(), CAR_FORWARD));
}

/** Turns the car's current input into wheel forces. Arithmetic only — no trig on the per-tick path. */
export function driveCar(rig: CarRig): void {
  const { controller: c, body, input } = rig;
  const vf = forwardSpeed(body);
  const t = clamp(input.throttle, -1, 1);
  let engine = 0;
  let brake = 0;
  if (t > 0) {
    if (vf < -1) brake = DRIVE.BRAKE * t; // moving backwards: brake first
    else engine = t * DRIVE.ENGINE * clamp(1 - vf / DRIVE.MAX_SPEED, 0, 1);
  } else if (t < 0) {
    if (vf > 1) brake = DRIVE.BRAKE * -t; // moving forwards: brake first, reverse once stopped
    else engine = t * DRIVE.ENGINE * DRIVE.REVERSE_SCALE * clamp(1 + vf / (DRIVE.MAX_SPEED * 0.4), 0, 1);
  }
  const steerMax = lerp(DRIVE.MAX_STEER, DRIVE.MAX_STEER_FAST, clamp(Math.abs(vf) / DRIVE.STEER_FADE_SPEED, 0, 1));
  const steering = DRIVE.STEER_SIGN * clamp(input.steer, -1, 1) * steerMax;
  for (const i of FRONT_WHEELS) {
    c.setWheelSteering(i, steering);
    c.setWheelBrake(i, brake);
    c.setWheelEngineForce(i, 0);
    c.setWheelFrictionSlip(i, TIRE.SLIP);
  }
  for (const i of REAR_WHEELS) {
    c.setWheelEngineForce(i, engine);
    c.setWheelBrake(i, brake + (input.handbrake ? DRIVE.HANDBRAKE : 0));
    c.setWheelFrictionSlip(i, input.handbrake ? TIRE.SLIP * TIRE.HANDBRAKE_SLIP_SCALE : TIRE.SLIP);
  }
}
```

- [ ] **Step 4: Implement `src/shared/sim.ts`**

```ts
import { ARENA, PHYSICS } from './constants';
import { buildArena, spawnPose, type ArenaOptions } from './arena';
import { quantizeInput, type CarInput } from './input';
import { RAPIER } from './physics';
import type { CarState, WheelPose } from './types';
import { createCarRig, driveCar, type CarRig } from './vehicle';

export type SimOptions = ArenaOptions;

/**
 * The one step function both the server and (later) the browser run. Deterministic for identical
 * roster, options and input sequences.
 */
export class Simulation {
  /** Sorted, de-duplicated slot numbers of the cars in this world. */
  readonly slots: readonly number[];
  /** Number of completed steps. */
  tick = 0;
  private readonly world: RAPIER.World;
  private readonly rigs = new Map<number, CarRig>();
  private readonly ordered: CarRig[] = [];
  private disposed = false;

  constructor(slots: readonly number[], options: SimOptions = {}) {
    const unique = [...new Set(slots)].sort((a, b) => a - b);
    if (unique.length > ARENA.MAX_CARS) {
      throw new RangeError(`at most ${ARENA.MAX_CARS} cars per simulation, got ${unique.length}`);
    }
    for (const s of unique) {
      if (!Number.isInteger(s) || s < 0 || s >= ARENA.MAX_CARS) throw new RangeError(`invalid slot ${s}`);
    }
    this.slots = unique;
    this.world = new RAPIER.World({ x: 0, y: -PHYSICS.GRAVITY, z: 0 });
    this.world.timestep = PHYSICS.DT;
    buildArena(this.world, options);
    unique.forEach((slot, index) => {
      const rig = createCarRig(this.world, slot, spawnPose(index, unique.length));
      this.rigs.set(slot, rig);
      this.ordered.push(rig);
    });
  }

  private rig(slot: number): CarRig {
    const rig = this.rigs.get(slot);
    if (!rig) throw new RangeError(`unknown slot ${slot}`);
    return rig;
  }

  /** Stores the input for subsequent steps. Values are quantized and sanitised (NaN -> 0). */
  setInput(slot: number, input: CarInput): void {
    this.rig(slot).input = quantizeInput(input);
  }

  getInput(slot: number): CarInput {
    return { ...this.rig(slot).input };
  }

  step(): void {
    if (this.disposed) throw new Error('Simulation is disposed');
    for (const rig of this.ordered) {
      driveCar(rig);
      rig.controller.updateVehicle(PHYSICS.DT, RAPIER.QueryFilterFlags.ONLY_FIXED);
    }
    this.world.step();
    this.tick++;
  }

  getState(slot: number): CarState {
    const b = this.rig(slot).body;
    const t = b.translation();
    const r = b.rotation();
    const v = b.linvel();
    const w = b.angvel();
    return {
      pos: { x: t.x, y: t.y, z: t.z },
      quat: { x: r.x, y: r.y, z: r.z, w: r.w },
      linvel: { x: v.x, y: v.y, z: v.z },
      angvel: { x: w.x, y: w.y, z: w.z },
    };
  }

  /** Overwrites a car's rigid-body state (used by client rollback). */
  setState(slot: number, s: CarState): void {
    const b = this.rig(slot).body;
    b.setTranslation(s.pos, true);
    b.setRotation(s.quat, true);
    b.setLinvel(s.linvel, true);
    b.setAngvel(s.angvel, true);
  }

  getWheels(slot: number): WheelPose[] {
    const c = this.rig(slot).controller;
    const out: WheelPose[] = [];
    for (let i = 0; i < 4; i++) {
      out.push({
        contact: c.wheelIsInContact(i),
        suspensionLength: c.wheelSuspensionLength(i) ?? 0,
        rotation: c.wheelRotation(i) ?? 0,
        steering: c.wheelSteering(i) ?? 0,
      });
    }
    return out;
  }

  /** Frees all WASM memory. Idempotent. Every vehicle controller must be removed before the world is freed. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const rig of this.ordered) this.world.removeVehicleController(rig.controller);
    this.world.free();
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/vehicle.test.ts`
Expected: PASS — all tests in the file (the suite takes a few seconds).

- [ ] **Step 6: If a handling test misses its range, tune constants (not tests)**

| Symptom | Adjust in `src/shared/constants.ts` |
|---|---|
| Chassis sinks / wheels not in contact after settling | `SUSPENSION.MAX_FORCE` ≥ 60000; `SUSPENSION.STIFFNESS` between 25 and 45 |
| Acceleration outside the 3 s / top-speed ranges | `DRIVE.ENGINE` (± 1000), `DRIVE.MAX_SPEED` |
| Steering yaw/lateral assertions fail with the right magnitude but wrong sign | flip `DRIVE.STEER_SIGN` |
| The car drives backwards with positive throttle or the wheels look sideways | forward axis: the value assigned to `controller.setIndexForwardAxis` in `createCarRig` (0 = X) and the wheel axle vector |
| Rolls over in the circle test | `CAR.COM_Y` more negative; `TIRE.SLIP` lower |
| Brake test too slow | `DRIVE.BRAKE` (± 10) |

Do not edit the arena or the assertions; if a threshold still fails with sane constants, record the measured value in the task notes and ask for a decision.

Run: `npm run typecheck && npm test`
Expected: everything passes.

- [ ] **Step 7: Commit (only if the user opted in to commits)**

```bash
git add -A
git commit -m "feat(shared): raycast-vehicle car model and deterministic Simulation"
```

---

### Task 5: Scene and procedural car mesh (visual shell)

**Files:**
- Create: `src/client/game/capabilities.ts`, `src/client/game/scene.ts`, `src/client/game/carView.ts`
- Replace: `src/client/index.html`, `src/client/main.ts` (temporary arena viewer; Task 6 replaces `main.ts` again)
- Test: `tests/client/capabilities.test.ts`

**Interfaces:**
- Consumes: `ARENA`, `CAR` (constants); `wallSegments`, `obstacleBoxes`, `spawnPose`, `BoxSpec` (arena); `wheelLocalPosition` (vehicle); `Quat`, `Vec3`, `WheelPose` (types).
- Produces:
  - `capabilities.ts`: `webglAvailable(): boolean` (never throws).
  - `scene.ts`: `GameScene {renderer, scene, camera, resize(), render(), dispose()}`, `createGameScene(canvas: HTMLCanvasElement): GameScene`.
  - `carView.ts`: `WHEEL_SPIN_SIGN`, `class CarView` — `group: THREE.Group`, `constructor(color: number)`, `setPose(pos: Vec3, quat: Quat)`, `setWheels(wheels: readonly WheelPose[])` (exact, from a local simulation), `animateWheels(forwardSpeed: number, steerAngle: number, dt: number)` (approximate, for cars without a local simulation), `setColor(color: number)`, `dispose()`.

- [ ] **Step 1: Write the failing capability test**

`tests/client/capabilities.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { webglAvailable } from '../../src/client/game/capabilities';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('webglAvailable', () => {
  it('is true when a webgl2 context can be created', () => {
    vi.stubGlobal('document', {
      createElement: () => ({ getContext: (kind: string) => (kind === 'webgl2' ? {} : null) }),
    });
    expect(webglAvailable()).toBe(true);
  });

  it('is false when no context is available', () => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
    expect(webglAvailable()).toBe(false);
  });

  it('is false (not a crash) when creating the canvas throws', () => {
    vi.stubGlobal('document', {
      createElement: () => {
        throw new Error('boom');
      },
    });
    expect(webglAvailable()).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement `capabilities.ts`**

Run: `npx vitest run tests/client/capabilities.test.ts` — Expected: FAIL (module not found).

`src/client/game/capabilities.ts`:

```ts
/** three r186 needs WebGL 2. Never throws. */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!canvas.getContext('webgl2');
  } catch {
    return false;
  }
}
```

Run again — Expected: PASS.

- [ ] **Step 3: Replace `src/client/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Wreckyard</title>
    <style>
      html,
      body {
        margin: 0;
        height: 100%;
        background: #0b1226;
        overflow: hidden;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        color: #dfe7ff;
      }
      #game {
        position: fixed;
        inset: 0;
        width: 100%;
        height: 100%;
        display: block;
      }
      #hud {
        position: fixed;
        left: 16px;
        top: 12px;
        margin: 0;
        max-width: calc(100vw - 32px);
        font-size: 13px;
        line-height: 1.5;
        text-shadow: 0 1px 2px #000;
        white-space: pre-wrap;
        pointer-events: none;
      }
    </style>
  </head>
  <body>
    <canvas id="game"></canvas>
    <pre id="hud">loading…</pre>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 4: Write `src/client/game/scene.ts`**

```ts
import * as THREE from 'three';
import { obstacleBoxes, wallSegments, type BoxSpec } from '../../shared/arena';
import { ARENA } from '../../shared/constants';

export interface GameScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Matches the drawing buffer to the canvas' CSS size; cheap when nothing changed. */
  resize(): void;
  render(): void;
  dispose(): void;
}

/** Deterministic speckled dirt so the ground looks the same on every load. */
function dirtTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#5a4630';
  g.fillRect(0, 0, size, size);
  let seed = 1337;
  const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 9000; i++) {
    const v = 60 + rnd() * 50;
    g.fillStyle = `rgb(${Math.round(v + 30)},${Math.round(v + 10)},${Math.round(v - 10)})`;
    g.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(24, 24);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function boxMesh(b: BoxSpec, material: THREE.Material, geometries: THREE.BufferGeometry[]): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(b.hx * 2, b.hy * 2, b.hz * 2);
  geometries.push(geometry);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(b.x, b.y, b.z);
  mesh.rotation.y = b.yaw; // same yaw convention as the physics colliders (rotation about +Y)
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createGameScene(canvas: HTMLCanvasElement): GameScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap is deprecated in r186
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const night = new THREE.Color(0x0b1226);
  scene.background = night;
  scene.fog = new THREE.Fog(night, 70, 240);

  scene.add(new THREE.HemisphereLight(0x9db4ff, 0x3b2c1c, 0.75));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
  sun.position.set(35, 70, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const extent = ARENA.RADIUS + 8;
  sun.shadow.camera.left = -extent;
  sun.shadow.camera.right = extent;
  sun.shadow.camera.top = extent;
  sun.shadow.camera.bottom = -extent;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 180;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const dirt = dirtTexture();
  textures.push(dirt);
  const groundMaterial = new THREE.MeshStandardMaterial({ map: dirt, roughness: 1, metalness: 0 });
  materials.push(groundMaterial);
  const groundGeometry = new THREE.CircleGeometry(ARENA.RADIUS + 30, 96);
  geometries.push(groundGeometry);
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const concrete = new THREE.MeshStandardMaterial({ color: 0x8a8d91, roughness: 0.9, metalness: 0.05 });
  materials.push(concrete);
  for (const seg of wallSegments()) scene.add(boxMesh(seg, concrete, geometries));
  const blocks = new THREE.MeshStandardMaterial({ color: 0x9a9da1, roughness: 0.85, metalness: 0.05 });
  materials.push(blocks);
  for (const o of obstacleBoxes()) scene.add(boxMesh(o, blocks, geometries));

  // Dark stands ring behind the walls and a few floodlight masts (purely decorative in this plan).
  const standsGeometry = new THREE.CylinderGeometry(ARENA.RADIUS + 22, ARENA.RADIUS + 30, 10, 64, 1, true);
  geometries.push(standsGeometry);
  const standsMaterial = new THREE.MeshStandardMaterial({ color: 0x1a2236, roughness: 1, side: THREE.DoubleSide });
  materials.push(standsMaterial);
  const stands = new THREE.Mesh(standsGeometry, standsMaterial);
  stands.position.y = 5;
  scene.add(stands);

  const poleGeometry = new THREE.CylinderGeometry(0.3, 0.4, 16, 8);
  const lampGeometry = new THREE.BoxGeometry(3, 0.6, 1.2);
  geometries.push(poleGeometry, lampGeometry);
  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.8 });
  const lampMaterial = new THREE.MeshStandardMaterial({ color: 0xfff3d0, emissive: 0xfff3d0, emissiveIntensity: 3 });
  materials.push(poleMaterial, lampMaterial);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const r = ARENA.RADIUS + 12;
    const pole = new THREE.Mesh(poleGeometry, poleMaterial);
    pole.position.set(Math.cos(a) * r, 8, Math.sin(a) * r);
    const lamp = new THREE.Mesh(lampGeometry, lampMaterial);
    lamp.position.set(Math.cos(a) * r, 16.3, Math.sin(a) * r);
    lamp.lookAt(0, 0, 0);
    scene.add(pole, lamp);
  }

  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 600);

  function resize(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  return {
    renderer,
    scene,
    camera,
    resize,
    render: () => renderer.render(scene, camera),
    dispose: () => {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
      renderer.dispose();
    },
  };
}
```

- [ ] **Step 5: Write `src/client/game/carView.ts`**

```ts
import * as THREE from 'three';
import { CAR } from '../../shared/constants';
import type { Quat, Vec3, WheelPose } from '../../shared/types';
import { wheelLocalPosition } from '../../shared/vehicle';

/**
 * Rapier's wheel rotation increases while rolling forward (asserted in tests/vehicle.test.ts). A wheel rolling
 * toward +X with its axle along +Z spins about -Z, hence -1. If the wheels turn the wrong way in the sandbox
 * (or the Task 4 rotation test had to be flipped), change this constant.
 */
export const WHEEL_SPIN_SIGN = -1;
const REST_SUSPENSION = 0.374; // measured settled suspension length

export class CarView {
  readonly group = new THREE.Group();
  private readonly bodyMaterial: THREE.MeshStandardMaterial;
  private readonly pivots: THREE.Group[] = [];
  private readonly spinners: THREE.Group[] = [];
  private readonly spin = [0, 0, 0, 0];
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(color: number) {
    this.bodyMaterial = this.track(
      new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.25, flatShading: true }),
    );
    const trim = this.track(new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.8, metalness: 0.2 }));
    const glass = this.track(new THREE.MeshStandardMaterial({ color: 0x101a26, roughness: 0.25, metalness: 0.6 }));
    const headlight = this.track(
      new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xfff1c9, emissiveIntensity: 2 }),
    );
    const taillight = this.track(
      new THREE.MeshStandardMaterial({ color: 0x8a0f0f, emissive: 0xff2222, emissiveIntensity: 1.2 }),
    );
    const tyre = this.track(new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.95 }));
    const hub = this.track(new THREE.MeshStandardMaterial({ color: 0xb8bcc6, roughness: 0.4, metalness: 0.8 }));

    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number): void => {
      const mesh = new THREE.Mesh(this.track(new THREE.BoxGeometry(w, h, d)), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    // forward = +X, up = +Y, right = +Z; the physics chassis box is 4.6 x 1.0 x 2.0 centred on the origin
    box(4.5, 0.6, 1.95, this.bodyMaterial, 0, -0.15, 0); // lower body
    box(2.4, 0.62, 1.7, glass, -0.25, 0.46, 0); // cabin glass band
    box(2.3, 0.08, 1.65, this.bodyMaterial, -0.25, 0.81, 0); // roof
    box(0.25, 0.32, 2.0, trim, 2.3, -0.32, 0); // front bumper
    box(0.25, 0.32, 2.0, trim, -2.3, -0.32, 0); // rear bumper
    box(0.06, 0.16, 0.36, headlight, 2.27, -0.02, 0.7);
    box(0.06, 0.16, 0.36, headlight, 2.27, -0.02, -0.7);
    box(0.06, 0.16, 0.36, taillight, -2.27, -0.02, 0.7);
    box(0.06, 0.16, 0.36, taillight, -2.27, -0.02, -0.7);

    const tyreGeometry = this.track(new THREE.CylinderGeometry(CAR.WHEEL.RADIUS, CAR.WHEEL.RADIUS, 0.35, 20));
    tyreGeometry.rotateX(Math.PI / 2); // cylinder axis Y -> Z (the axle)
    const hubGeometry = this.track(new THREE.CylinderGeometry(0.2, 0.2, 0.37, 12));
    hubGeometry.rotateX(Math.PI / 2);
    const spokeGeometry = this.track(new THREE.BoxGeometry(0.7, 0.07, 0.38)); // makes the spin visible
    for (let i = 0; i < 4; i++) {
      const pivot = new THREE.Group();
      const spinner = new THREE.Group();
      const t = new THREE.Mesh(tyreGeometry, tyre);
      t.castShadow = true;
      spinner.add(t, new THREE.Mesh(hubGeometry, hub), new THREE.Mesh(spokeGeometry, hub));
      pivot.add(spinner);
      const p = wheelLocalPosition(i, REST_SUSPENSION);
      pivot.position.set(p.x, p.y, p.z);
      this.group.add(pivot);
      this.pivots.push(pivot);
      this.spinners.push(spinner);
    }
  }

  private track<T extends { dispose(): void }>(o: T): T {
    this.disposables.push(o);
    return o;
  }

  setPose(pos: Vec3, quat: Quat): void {
    this.group.position.set(pos.x, pos.y, pos.z);
    this.group.quaternion.set(quat.x, quat.y, quat.z, quat.w);
  }

  /** Exact wheel pose from a local simulation. */
  setWheels(wheels: readonly WheelPose[]): void {
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      if (!w) continue;
      const p = wheelLocalPosition(i, w.suspensionLength);
      this.pivots[i]!.position.set(p.x, p.y, p.z);
      this.pivots[i]!.rotation.y = i < 2 ? w.steering : 0; // Rapier steering is positive = left = +Y rotation
      this.spinners[i]!.rotation.z = WHEEL_SPIN_SIGN * w.rotation;
    }
  }

  /** Approximate wheel animation for cars that have no local simulation. */
  animateWheels(forwardSpeed: number, steerAngle: number, dt: number): void {
    for (let i = 0; i < 4; i++) {
      this.spin[i] += (forwardSpeed / CAR.WHEEL.RADIUS) * dt;
      this.spinners[i]!.rotation.z = WHEEL_SPIN_SIGN * this.spin[i];
      this.pivots[i]!.rotation.y = i < 2 ? steerAngle : 0;
    }
  }

  setColor(color: number): void {
    this.bodyMaterial.color.setHex(color);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
```

- [ ] **Step 6: Temporary arena viewer in `src/client/main.ts`**

```ts
import { spawnPose } from '../shared/arena';
import { webglAvailable } from './game/capabilities';
import { CarView } from './game/carView';
import { createGameScene } from './game/scene';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;

function boot(): void {
  if (!webglAvailable()) {
    hud.textContent =
      'WebGL 2 is not available in this browser. Try a current Chrome, Edge, Firefox or Safari with hardware acceleration enabled.';
    return;
  }
  try {
    const gs = createGameScene(canvas);
    [0xd84a2b, 0x2b7fd8, 0x2fb457, 0xe0b122].forEach((color, i) => {
      const view = new CarView(color);
      const p = spawnPose(i * 2, 8);
      view.setPose({ x: p.pos.x, y: 1.074, z: p.pos.z }, p.quat);
      gs.scene.add(view.group);
    });
    hud.textContent = 'Wreckyard — arena viewer';
    let t = 0;
    const frame = (): void => {
      t += 0.004;
      gs.camera.position.set(Math.cos(t) * 40, 16, Math.sin(t) * 40);
      gs.camera.lookAt(0, 1, 0);
      gs.resize();
      gs.render();
      requestAnimationFrame(frame);
    };
    frame();
  } catch (err) {
    console.error(err);
    hud.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
  }
}

boot();
```

- [ ] **Step 7: Type-check and visually verify**

Run: `npm run typecheck && npm test`
Expected: clean; all tests pass (including the three capability tests).

Visual check (in-app browser or any browser):

```bash
npm run dev    # leave running; server :8080, client :5173
```

Open `http://localhost:5173/`. Expected: a night scene with a dirt-coloured circular arena, a grey wall ring, four concrete blocks, four coloured cars sitting on the ground (wheels touching it, shadows under them) and a camera slowly orbiting. Check the browser console for errors (there must be none). Stop the dev servers afterwards.

- [ ] **Step 8: Commit (only if the user opted in to commits)**

```bash
git add -A
git commit -m "feat(client): arena scene and procedural car mesh"
```

---

### Task 6: Drivable sandbox — fixed-step loop, chase camera, input, tuning panel

**Files:**
- Create: `src/client/game/stepper.ts`, `src/client/game/camera.ts`, `src/client/game/input.ts`, `src/client/game/sandbox.ts`
- Replace: `src/client/main.ts`
- Test: `tests/client/stepper.test.ts`, `tests/client/camera.test.ts`, `tests/client/controls.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–5 (`Simulation`, `initPhysics`, `quantizeInput`, `CarView`, `createGameScene`, `webglAvailable`, `DRIVE`/`TIRE`/`SUSPENSION` tunables, math helpers).
- Produces:
  - `stepper.ts`: `class FixedStepper` — `constructor(dt: number, maxFrame = 0.1)`, `advance(frameSeconds: number, step: () => void): number` (returns interpolation alpha in [0, 1)), `reset()`.
  - `camera.ts`: `ChaseTarget {pos: Vec3; quat: Quat; speed: number}`, `ChaseView {position: Vec3; lookAt: Vec3; fov: number}`, `computeChaseView(t: ChaseTarget): ChaseView` (pure), `class ChaseCamera` — `update(camera: PerspectiveCamera, target: ChaseTarget, dt: number)`, `reset()`.
  - `input.ts`: `SteerRamp` (`step(target, dt): number`), `GamepadLike`, `GamepadReader`, `mapGamepad(pad: GamepadLike | null): CarInput | null`, `class KeyboardInput` — `constructor(target?: EventTarget, readPad?: GamepadReader)`, `sample(dt): CarInput`, `dispose()`.
  - `sandbox.ts`: `SandboxHandle {getSim(): Simulation; stop(): void}`, `startSandbox(canvas, hud): Promise<SandboxHandle>`; also sets `window.__sandbox` for automation.

- [ ] **Step 1: Write the failing stepper test**

`tests/client/stepper.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FixedStepper } from '../../src/client/game/stepper';

const DT = 1 / 60;

describe('FixedStepper', () => {
  it('runs whole ticks and returns the interpolation alpha', () => {
    const s = new FixedStepper(DT);
    let n = 0;
    const alpha = s.advance(DT * 2.5, () => n++);
    expect(n).toBe(2);
    expect(alpha).toBeCloseTo(0.5, 5);
  });

  it('carries the remainder into the next frame', () => {
    const s = new FixedStepper(DT);
    let n = 0;
    s.advance(DT * 0.6, () => n++);
    expect(n).toBe(0);
    s.advance(DT * 0.6, () => n++);
    expect(n).toBe(1);
  });

  it('caps a huge frame time (hidden tab) at 0.1 s', () => {
    const s = new FixedStepper(DT);
    let n = 0;
    s.advance(5, () => n++);
    expect(n).toBeLessThanOrEqual(6);
    expect(n).toBeGreaterThanOrEqual(5);
  });

  it('ignores NaN, Infinity and negative frame times', () => {
    const s = new FixedStepper(DT);
    let n = 0;
    for (const bad of [NaN, Infinity, -Infinity, -1]) s.advance(bad, () => n++);
    expect(n).toBe(0);
  });

  it('reset clears the accumulator', () => {
    const s = new FixedStepper(DT);
    let n = 0;
    s.advance(DT * 0.9, () => n++);
    s.reset();
    s.advance(DT * 0.2, () => n++);
    expect(n).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement `stepper.ts`**

Run: `npx vitest run tests/client/stepper.test.ts` — Expected: FAIL (module not found).

`src/client/game/stepper.ts`:

```ts
/** Fixed-timestep accumulator. Frame times are clamped so a backgrounded tab cannot fast-forward the physics. */
export class FixedStepper {
  private acc = 0;

  constructor(
    readonly dt: number,
    private readonly maxFrame = 0.1,
  ) {}

  /** Advances by a frame time, calls `step` once per whole tick, and returns the interpolation alpha in [0, 1). */
  advance(frameSeconds: number, step: () => void): number {
    const f = Number.isFinite(frameSeconds) ? Math.min(Math.max(frameSeconds, 0), this.maxFrame) : 0;
    this.acc += f;
    while (this.acc >= this.dt) {
      step();
      this.acc -= this.dt;
    }
    return this.acc / this.dt;
  }

  reset(): void {
    this.acc = 0;
  }
}
```

Run again — Expected: PASS.

- [ ] **Step 3: Write the failing camera test, then implement `camera.ts`**

`tests/client/camera.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeChaseView } from '../../src/client/game/camera';
import { quatFromYaw, vlen, vsub } from '../../src/shared/math';

const at = (yaw: number, speed = 0) => ({ pos: { x: 0, y: 1, z: 0 }, quat: quatFromYaw(yaw), speed });

describe('computeChaseView', () => {
  it('sits behind and above a car that faces +X, looking ahead of it', () => {
    const v = computeChaseView(at(0));
    expect(v.position.x).toBeLessThan(-5);
    expect(v.position.y).toBeGreaterThan(2);
    expect(v.lookAt.x).toBeGreaterThan(2);
  });

  it('follows the car when it faces -X', () => {
    const v = computeChaseView(at(Math.PI));
    expect(v.position.x).toBeGreaterThan(5);
    expect(v.lookAt.x).toBeLessThan(-2);
  });

  it('pulls back and widens the field of view with speed', () => {
    const slow = computeChaseView(at(0, 0));
    const fast = computeChaseView(at(0, 20));
    expect(vlen(vsub(fast.position, at(0).pos))).toBeGreaterThan(vlen(vsub(slow.position, at(0).pos)));
    expect(fast.fov).toBeGreaterThan(slow.fov);
    expect(fast.fov).toBeLessThanOrEqual(78);
  });

  it('stays level even when the car is pitched', () => {
    // pitching the car must not tilt the camera height by more than the fixed offset
    const v = computeChaseView({ pos: { x: 0, y: 1, z: 0 }, quat: { x: 0, y: 0, z: 0.5, w: 0.866 }, speed: 0 });
    expect(v.position.y).toBeCloseTo(1 + 4, 1);
  });
});
```

Run: `npx vitest run tests/client/camera.test.ts` — Expected: FAIL. Then write `src/client/game/camera.ts`:

```ts
import type { PerspectiveCamera } from 'three';
import { CAR_FORWARD } from '../../shared/constants';
import { clamp, lerp, quatRotate, vlerp } from '../../shared/math';
import type { Quat, Vec3 } from '../../shared/types';

export interface ChaseTarget {
  pos: Vec3;
  quat: Quat;
  /** Speed in m/s (>= 0). */
  speed: number;
}

export interface ChaseView {
  position: Vec3;
  lookAt: Vec3;
  fov: number;
}

/** Pure camera placement: behind and above the car along its horizontal heading. */
export function computeChaseView(t: ChaseTarget): ChaseView {
  const f = quatRotate(t.quat, CAR_FORWARD);
  let fx = f.x;
  let fz = f.z;
  const len = Math.hypot(fx, fz);
  if (len < 1e-6) {
    fx = 1;
    fz = 0;
  } else {
    fx /= len;
    fz /= len;
  }
  const speed = Math.max(0, Number.isFinite(t.speed) ? t.speed : 0);
  const back = 9 + speed * 0.12;
  const height = 4 + speed * 0.03;
  return {
    position: { x: t.pos.x - fx * back, y: t.pos.y + height, z: t.pos.z - fz * back },
    lookAt: { x: t.pos.x + fx * 5, y: t.pos.y + 0.8, z: t.pos.z + fz * 5 },
    fov: clamp(62 + speed * 0.7, 62, 78),
  };
}

/** Smoothing wrapper that applies a ChaseView to a three.js camera. */
export class ChaseCamera {
  private position: Vec3 | null = null;
  private lookAt: Vec3 | null = null;
  private fov = 62;

  reset(): void {
    this.position = null;
    this.lookAt = null;
  }

  update(camera: PerspectiveCamera, target: ChaseTarget, dt: number): void {
    const want = computeChaseView(target);
    if (!this.position || !this.lookAt) {
      this.position = want.position;
      this.lookAt = want.lookAt;
      this.fov = want.fov;
    } else {
      const k = 1 - Math.exp(-Math.max(dt, 0) * 6);
      this.position = vlerp(this.position, want.position, k);
      this.lookAt = vlerp(this.lookAt, want.lookAt, Math.min(1, k * 1.5));
      this.fov = lerp(this.fov, want.fov, k);
    }
    camera.position.set(this.position.x, this.position.y, this.position.z);
    camera.lookAt(this.lookAt.x, this.lookAt.y, this.lookAt.z);
    if (Math.abs(camera.fov - this.fov) > 0.01) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
  }
}
```

Run: `npx vitest run tests/client/camera.test.ts` — Expected: PASS.

- [ ] **Step 4: Write the failing controls test, then implement `input.ts`**

`tests/client/controls.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { KeyboardInput, SteerRamp, mapGamepad, type GamepadLike } from '../../src/client/game/input';

describe('SteerRamp', () => {
  it('ramps toward the target at the attack rate', () => {
    const r = new SteerRamp(5, 8);
    expect(r.step(1, 0.1)).toBeCloseTo(0.5, 6);
    expect(r.step(1, 0.1)).toBeCloseTo(1, 6);
  });

  it('returns to centre at the release rate', () => {
    const r = new SteerRamp(5, 8);
    r.value = 1;
    expect(r.step(0, 0.05)).toBeCloseTo(0.6, 6);
  });

  it('counter-steers faster than it steers', () => {
    const r = new SteerRamp(5, 8);
    r.value = 1;
    expect(r.step(-1, 0.1)).toBeCloseTo(0, 6); // 10 units/s for 0.1 s
  });

  it('treats NaN as neutral and ignores bad dt', () => {
    const r = new SteerRamp(5, 8);
    r.value = 0.5;
    expect(r.step(NaN, 0)).toBe(0.5);
    expect(r.step(1, -1)).toBe(0.5);
    expect(r.step(1, NaN)).toBe(0.5);
  });
});

const pad = (axes: number[], buttons: Array<{ value: number; pressed: boolean }>): GamepadLike => ({ axes, buttons });
const btn = (value: number) => ({ value, pressed: value > 0.5 });

describe('mapGamepad', () => {
  it('returns null when the pad is idle or missing', () => {
    expect(mapGamepad(null)).toBeNull();
    expect(mapGamepad(pad([0, 0], []))).toBeNull();
    expect(mapGamepad(pad([0.05, 0], []))).toBeNull(); // inside the dead zone
  });

  it('maps stick, triggers and face buttons', () => {
    const buttons = Array.from({ length: 8 }, () => btn(0));
    buttons[7] = btn(1); // right trigger
    const p = mapGamepad(pad([1, 0], buttons))!;
    expect(p.steer).toBeCloseTo(1, 6);
    expect(p.throttle).toBe(1);
    expect(p.handbrake).toBe(false);
    buttons[7] = btn(0);
    buttons[6] = btn(1); // left trigger = reverse/brake
    buttons[0] = btn(1); // A = handbrake
    const q = mapGamepad(pad([-1, 0], buttons))!;
    expect(q.steer).toBeCloseTo(-1, 6);
    expect(q.throttle).toBe(-1);
    expect(q.handbrake).toBe(true);
  });

  it('treats NaN axes as centred', () => {
    expect(mapGamepad(pad([NaN, NaN], []))).toBeNull();
  });
});

function keyEvent(type: 'keydown' | 'keyup', code: string): Event {
  return Object.assign(new Event(type, { cancelable: true }), { code });
}

describe('KeyboardInput', () => {
  it('maps W/S to throttle and cancels out when both are held', () => {
    const target = new EventTarget();
    const kb = new KeyboardInput(target, () => null);
    target.dispatchEvent(keyEvent('keydown', 'KeyW'));
    expect(kb.sample(1 / 60).throttle).toBe(1);
    target.dispatchEvent(keyEvent('keydown', 'KeyS'));
    expect(kb.sample(1 / 60).throttle).toBe(0);
    target.dispatchEvent(keyEvent('keyup', 'KeyW'));
    expect(kb.sample(1 / 60).throttle).toBe(-1);
    kb.dispose();
  });

  it('ramps steering and returns to centre', () => {
    const target = new EventTarget();
    const kb = new KeyboardInput(target, () => null);
    target.dispatchEvent(keyEvent('keydown', 'KeyD'));
    let s = 0;
    for (let i = 0; i < 20; i++) s = kb.sample(1 / 60).steer;
    expect(s).toBeGreaterThan(0.99);
    target.dispatchEvent(keyEvent('keyup', 'KeyD'));
    for (let i = 0; i < 20; i++) s = kb.sample(1 / 60).steer;
    expect(s).toBeCloseTo(0, 6);
    kb.dispose();
  });

  it('clears held keys on blur so a backgrounded tab cannot leave the throttle stuck', () => {
    const target = new EventTarget();
    const kb = new KeyboardInput(target, () => null);
    target.dispatchEvent(keyEvent('keydown', 'ArrowUp'));
    target.dispatchEvent(keyEvent('keydown', 'Space'));
    expect(kb.sample(1 / 60)).toMatchObject({ throttle: 1, handbrake: true });
    target.dispatchEvent(new Event('blur'));
    expect(kb.sample(1 / 60)).toMatchObject({ throttle: 0, handbrake: false });
    kb.dispose();
  });

  it('prevents page scrolling for arrow keys and space', () => {
    const target = new EventTarget();
    const kb = new KeyboardInput(target, () => null);
    const e = keyEvent('keydown', 'ArrowDown');
    target.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    kb.dispose();
  });

  it('lets an active gamepad override the keyboard', () => {
    const target = new EventTarget();
    const buttons = Array.from({ length: 8 }, () => btn(0));
    buttons[7] = btn(1);
    const kb = new KeyboardInput(target, () => pad([0, 0], buttons));
    expect(kb.sample(1 / 60).throttle).toBe(1);
    kb.dispose();
  });
});
```

Run: `npx vitest run tests/client/controls.test.ts` — Expected: FAIL. Then write `src/client/game/input.ts`:

```ts
import type { CarInput } from '../../shared/input';
import { clamp } from '../../shared/math';

/** Smooths digital steering so keyboard players get an analogue-like ramp. */
export class SteerRamp {
  value = 0;

  constructor(
    private readonly attack = 5,
    private readonly release = 8,
  ) {}

  step(target: number, dt: number): number {
    const t = clamp(Number.isFinite(target) ? target : 0, -1, 1);
    const d = Number.isFinite(dt) ? Math.max(dt, 0) : 0;
    let rate = this.attack;
    if (t === 0) rate = this.release;
    else if (this.value !== 0 && Math.sign(t) !== Math.sign(this.value)) rate = this.attack * 2; // counter-steer faster
    const maxStep = rate * d;
    this.value += clamp(t - this.value, -maxStep, maxStep);
    return this.value;
  }
}

export interface GamepadLike {
  readonly axes: readonly number[];
  readonly buttons: ReadonlyArray<{ readonly value: number; readonly pressed: boolean }>;
}
export type GamepadReader = () => GamepadLike | null;

const DEAD_ZONE = 0.12;
const finite = (v: number | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Standard mapping: left stick X steers, RT drives, LT brakes/reverses, A or B is the handbrake. */
export function mapGamepad(pad: GamepadLike | null): CarInput | null {
  if (!pad) return null;
  const ax = finite(pad.axes[0]);
  const steer = Math.abs(ax) < DEAD_ZONE ? 0 : (ax - Math.sign(ax) * DEAD_ZONE) / (1 - DEAD_ZONE);
  const throttle = clamp(finite(pad.buttons[7]?.value) - finite(pad.buttons[6]?.value), -1, 1);
  const handbrake = (pad.buttons[0]?.pressed ?? false) || (pad.buttons[1]?.pressed ?? false);
  if (steer === 0 && throttle === 0 && !handbrake) return null; // idle: let the keyboard win
  return { throttle, steer: clamp(steer, -1, 1), handbrake };
}

const defaultGamepadReader: GamepadReader = () => {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
  for (const pad of navigator.getGamepads()) if (pad && pad.connected) return pad;
  return null;
};

const PREVENT_DEFAULT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export class KeyboardInput {
  private readonly keys = new Set<string>();
  private readonly ramp = new SteerRamp();
  private readonly onKeyDown = (e: Event): void => {
    const code = (e as KeyboardEvent).code;
    if (PREVENT_DEFAULT.has(code)) e.preventDefault();
    this.keys.add(code);
  };
  private readonly onKeyUp = (e: Event): void => {
    this.keys.delete((e as KeyboardEvent).code);
  };
  private readonly onBlur = (): void => {
    this.keys.clear();
  };

  constructor(
    private readonly target: EventTarget = window,
    private readonly readPad: GamepadReader = defaultGamepadReader,
  ) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  /** Samples the current input; advances the steering ramp by `dt` seconds. */
  sample(dt: number): CarInput {
    const k = this.keys;
    const up = k.has('KeyW') || k.has('ArrowUp');
    const down = k.has('KeyS') || k.has('ArrowDown');
    const left = k.has('KeyA') || k.has('ArrowLeft');
    const right = k.has('KeyD') || k.has('ArrowRight');
    const steer = this.ramp.step((right ? 1 : 0) - (left ? 1 : 0), dt);
    const keyboard: CarInput = { throttle: (up ? 1 : 0) - (down ? 1 : 0), steer, handbrake: k.has('Space') };
    return mapGamepad(this.readPad()) ?? keyboard;
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}
```

Run: `npx vitest run tests/client` — Expected: PASS (stepper, camera, controls, capabilities).

- [ ] **Step 5: Write `src/client/game/sandbox.ts`**

```ts
import * as THREE from 'three';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { DRIVE, PHYSICS, SUSPENSION, TIRE } from '../../shared/constants';
import { quantizeInput } from '../../shared/input';
import { quatNlerp, vlen, vlerp } from '../../shared/math';
import { initPhysics } from '../../shared/physics';
import { Simulation } from '../../shared/sim';
import type { CarState } from '../../shared/types';
import { ChaseCamera } from './camera';
import { CarView } from './carView';
import { KeyboardInput } from './input';
import { createGameScene } from './scene';
import { FixedStepper } from './stepper';

export interface SandboxHandle {
  getSim(): Simulation;
  stop(): void;
}

const SLOTS = [0, 1]; // slot 0 is driven by you, slot 1 is a parked target to ram
const COLORS = [0xd84a2b, 0x2b7fd8];

/** Offline driving sandbox: the shared Simulation stepped at a fixed 60 Hz, rendered with interpolation. */
export async function startSandbox(canvas: HTMLCanvasElement, hud: HTMLElement): Promise<SandboxHandle> {
  await initPhysics();
  const gs = createGameScene(canvas);
  const views = COLORS.map((c) => new CarView(c));
  for (const v of views) gs.scene.add(v.group);
  const chase = new ChaseCamera();
  const keyboard = new KeyboardInput();
  const stepper = new FixedStepper(PHYSICS.DT);
  const timer = new THREE.Timer();
  timer.connect(document);

  let sim = new Simulation(SLOTS);
  let prev: CarState[] = SLOTS.map((s) => sim.getState(s));
  let curr: CarState[] = prev;

  const rebuild = (): void => {
    sim.dispose();
    sim = new Simulation(SLOTS);
    prev = SLOTS.map((s) => sim.getState(s));
    curr = prev;
    stepper.reset();
    chase.reset();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.code === 'KeyR') rebuild();
  };
  window.addEventListener('keydown', onKey);

  // Live tuning. DRIVE / TIRE are read every tick; SUSPENSION needs "Rebuild". Copy the JSON into constants.ts to keep changes.
  const gui = new GUI({ title: 'Wreckyard tuning (sandbox only)' });
  const drive = gui.addFolder('Drive');
  drive.add(DRIVE, 'ENGINE', 2000, 20000, 100);
  drive.add(DRIVE, 'REVERSE_SCALE', 0.2, 1, 0.05);
  drive.add(DRIVE, 'BRAKE', 10, 120, 1);
  drive.add(DRIVE, 'HANDBRAKE', 0, 100, 1);
  drive.add(DRIVE, 'MAX_SPEED', 8, 40, 0.5);
  drive.add(DRIVE, 'MAX_STEER', 0.2, 0.9, 0.01);
  drive.add(DRIVE, 'MAX_STEER_FAST', 0.05, 0.5, 0.01);
  const tyres = gui.addFolder('Tyres');
  tyres.add(TIRE, 'SLIP', 0.5, 4, 0.05);
  tyres.add(TIRE, 'HANDBRAKE_SLIP_SCALE', 0.1, 1, 0.05);
  const suspension = gui.addFolder('Suspension (click Rebuild to apply)');
  suspension.add(SUSPENSION, 'STIFFNESS', 10, 60, 1);
  suspension.add(SUSPENSION, 'COMPRESSION', 1, 8, 0.1);
  suspension.add(SUSPENSION, 'RELAXATION', 1, 8, 0.1);
  suspension.add(SUSPENSION, 'MAX_FORCE', 20000, 120000, 1000);
  gui.add({ rebuild }, 'rebuild').name('Rebuild / reset cars (R)');
  gui
    .add(
      {
        copy: (): void => {
          const json = JSON.stringify({ DRIVE, TIRE, SUSPENSION }, null, 2);
          console.log(json);
          void navigator.clipboard?.writeText(json);
        },
      },
      'copy',
    )
    .name('Copy tuning JSON');

  let raf = 0;
  let stopped = false;
  let frames = 0;
  let fps = 0;
  let fpsAt = performance.now();
  let hudAt = 0;

  const frame = (ts: number): void => {
    if (stopped) return;
    timer.update(ts);
    const dt = timer.getDelta();
    const alpha = stepper.advance(dt, () => {
      sim.setInput(0, quantizeInput(keyboard.sample(PHYSICS.DT)));
      prev = curr;
      sim.step();
      curr = SLOTS.map((s) => sim.getState(s));
    });

    SLOTS.forEach((slot, i) => {
      const a = prev[i]!;
      const b = curr[i]!;
      views[i]!.setPose(vlerp(a.pos, b.pos, alpha), quatNlerp(a.quat, b.quat, alpha));
      views[i]!.setWheels(sim.getWheels(slot));
    });
    const a0 = prev[0]!;
    const b0 = curr[0]!;
    const speed = vlen(b0.linvel);
    chase.update(
      gs.camera,
      { pos: vlerp(a0.pos, b0.pos, alpha), quat: quatNlerp(a0.quat, b0.quat, alpha), speed },
      dt,
    );

    frames++;
    const now = performance.now();
    if (now - fpsAt >= 500) {
      fps = Math.round((frames * 1000) / (now - fpsAt));
      frames = 0;
      fpsAt = now;
    }
    if (now - hudAt > 100) {
      hudAt = now;
      hud.textContent = `WRECKYARD sandbox\nspeed ${Math.round(speed * 3.6)} km/h   fps ${fps}\nW/S throttle · A/D steer · Space handbrake · R reset`;
    }
    gs.resize();
    gs.render();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  const stop = (): void => {
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    keyboard.dispose();
    gui.destroy();
    for (const v of views) v.dispose();
    sim.dispose();
    gs.dispose();
  };

  const handle: SandboxHandle = { getSim: () => sim, stop };
  Object.assign(window, { __sandbox: handle }); // handy for automated checks
  return handle;
}
```

- [ ] **Step 6: Replace `src/client/main.ts` with the sandbox boot**

```ts
import { webglAvailable } from './game/capabilities';
import { startSandbox } from './game/sandbox';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;

async function boot(): Promise<void> {
  if (!webglAvailable()) {
    hud.textContent =
      'WebGL 2 is not available in this browser. Try a current Chrome, Edge, Firefox or Safari with hardware acceleration enabled.';
    return;
  }
  try {
    await startSandbox(canvas, hud);
  } catch (err) {
    console.error(err);
    hud.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
  }
}

void boot();
```

- [ ] **Step 7: Type-check, run everything, verify in the browser**

Run: `npm run typecheck && npm test && npm run build`
Expected: all clean/green; build succeeds.

Browser verification:

```bash
npm run dev    # server :8080, client :5173
```

Open `http://localhost:5173/` (make sure the tab is in the foreground — hidden tabs pause `requestAnimationFrame`). Expected: the arena with a red car (yours) and a blue parked car, a HUD reading `WRECKYARD sandbox / speed 0 km/h fps ~60`, a lil-gui tuning panel top-right, and no console errors.

Drive it programmatically (synthetic key events are handled exactly like real ones):

```js
window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
await new Promise((r) => setTimeout(r, 2500));
const s = window.__sandbox.getSim().getState(0);
console.log('speed m/s', Math.hypot(s.linvel.x, s.linvel.z));   // expect > 8
window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
```

Expected: speed above 8 m/s after 2.5 s and the camera following the car. Press `R` (or dispatch `keydown` with `code: 'KeyR'`) and confirm the car returns to its spawn. Take a screenshot for the record. Stop the dev servers afterwards.

- [ ] **Step 8: Commit (only if the user opted in to commits)**

```bash
git add -A
git commit -m "feat(client): drivable offline sandbox with chase camera, input and tuning panel"
```

---

## Playtest gate (STOP here)

Plan 1 is complete when all of the following hold:

- [ ] `npm run typecheck`, `npm test`, `npm run build` and `npm run smoke` all pass.
- [ ] The sandbox is drivable in a real browser (Task 6 Step 7).
- [ ] **The user has driven the sandbox and accepted the handling** — or supplied new tuning values (use the panel's "Copy tuning JSON" and paste into `src/shared/constants.ts`; re-run `npm test` afterwards because some thresholds depend on the constants).

Do **not** start Plan 2 until the user confirms. Plan 2 is `docs/superpowers/plans/2026-09-28-wreckyard-plan-2-multiplayer-baseline.md`; re-read it against whatever changed here (constants, any renamed exports) before executing.

