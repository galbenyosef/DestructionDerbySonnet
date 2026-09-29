# Wreckyard Plan 7 — Polish and Packaging (M6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the game safe to put on the internet and comfortable to run on any machine: limits per address so one client cannot hog or probe a server, hardened static serving and room codes nobody can predict, graphics presets with a settings panel and an automatic step down on a slow machine, a tidier match screen, a load test that says whether a server holds ten full rooms, and a container image that runs from the built bundle alone, with the docs to go with it.

**Architecture:** Nothing here changes the shared simulation or the rules of a round. The server gains a `ConnectionGuard` (per public address: sockets open, failed room-code guesses, rooms created; private and loopback addresses are exempt) that `app.ts` consults when a socket arrives and when it says hello, plus a few small hardenings. The client gains a pure settings model (`settings.ts`: presets, saved settings, an automatic step down that only ever goes down) that the menu, the `G` key and the game apply through `GameScene.applyQuality`, `FxDirector.setDensity`, `DebrisSystem.setLimit` and `AudioEngine.setVolume`. The effects and the match screen get the cheap fixes their reviews deferred. Scripts gain a shared end-to-end helper, a load test and a smoke check that runs the bundle from an empty folder; the repo gains a `Dockerfile`, `.dockerignore`, `CLAUDE.md` and README sections.

**Tech Stack:** as Plans 1-6. No new dependencies. The image is `node:24-slim`; the server is one esbuild bundle with its dependencies inside it.

**Spec:** `docs/superpowers/specs/2026-09-28-wreckyard-design.md` — the M6 row ("menu/settings, presets, limits/origin check, README, CLAUDE.md, Dockerfile (esbuild bundle, no `node_modules` in the image), load test") and "Verification" items 5 and 6. **Prerequisite:** Plan 6 complete and reviewed (branch `plan-6-destruction-and-juice`, HEAD `6af3473`, 589 tests). This plan starts on a new branch cut from it.

**Scope notes:**
- All of M6 is here except the deploy (M7), which needs the user's go-ahead and hosting account and is not part of any plan.
- Deviations from the spec text, each with its reason: (1) **the load target.** The spec asks for "p99 tick ≤ 4 ms" with 10 rooms of 8 players. The game logic meets it with room to spare (ten rooms of eight driving players cost 0.41 ms per tick on average and 1.2 ms at p99, measured in one process without sockets), but on the development laptop, with real sockets, the server's own p99 reads 6-43 ms while its process is 77 % idle and trivial functions show tens of milliseconds in a profile: that is the machine being busy (load average 5-6 on 10 cores), not the server working. The load test keeps the spec's numbers as its defaults and prints what it measured; the limits are options. (2) **Graphics presets "auto-downgrade on low FPS"** only ever step down, once, after two slow three-second windows; going back up is the player's choice (`G`), so it cannot flap. (3) **The image could not be built or run here** (the Docker daemon is not running in the development environment, and I did not start Docker Desktop): the Dockerfile is held to what the game needs by `tests/packaging.test.ts`, and the packaged smoke check runs the same bundle from an empty folder, but `docker build` and `docker run` are the first thing to do on a machine that has Docker. (4) The preset numbers (pixel ratio, samples, shadow size, particle share, debris count, the 40 fps threshold) are first guesses, like Plan 6's sound levels; they live in `QUALITY` and `AutoQuality` and the playtest settles them.
- Findings of the earlier reviews that this plan closes: Plan 2 (room codes enumerable and rooms exhaustible by one client, input floods never closed, static handler nits), Plan 4 (a player who leaves during the countdown left a dead car, join-and-leave burnt a restart, an empty room kept stepping, two test gaps found by mutation, a flaky test budget, `hit.hp` not validated, vestigial code), Plan 5 (the HUD polish list) and Plan 6 (one collision played twice for observers, a rammed wreck jolting the spectator camera, nits). What stays open is in the run's final report.
- Nothing here changes the wire: `NET.PROTOCOL_VERSION` stays 3, `npm run hash` still prints `10c3a72a`, and no setting reaches the server.

## What the rehearsal found (measured before this plan was written)

I rehearsed everything below in a scratch copy of the Plan 6 code (with its review fixes), then executed this plan text against a fresh copy to check that it reproduces the rehearsal file for file.

- **Four defects in my own first draft, found by reading it again and now pinned by tests that failed first:** (1) the guard counted a socket when the upgrade arrived but gave the slot back only when a *finished* WebSocket closed, so a handful of malformed upgrade requests locked an address out (the slot is now released when the raw socket closes, whatever became of it); (2) a successful join cleared an address's failed-guess count, so a guesser could interleave quick-play joins and guess forever (nothing clears it now; mistakes expire with the window); (3) behind a proxy, `X-Forwarded-For` was read from the left, which the client writes (any client could pretend to be any address, dodging the limits or framing someone else): `TRUST_PROXY` is now the number of proxies and the address is read that many entries from the right; (4) the harness test asserted a tick time, which fails when the machine is busy.
- **`npm run smoke` had been broken since Plan 6:** it sent protocol version 2 as a literal. It is now TypeScript and uses `NET.PROTOCOL_VERSION`.
- **The bundle stands alone:** the smoke check copies `dist/server` and `dist/client` into an empty folder and runs `node dist/server/index.js` there; it serves the page, `/healthz` and creates a room. (Rapier's WASM is inside the bundle.)
- **Presets, in a real browser** (private port, eight bots, one page): High reports 4 antialiasing samples and about 440 draw calls, Medium 2 samples, Low draws straight to the screen (the screen's own multisampling) with about 260 draw calls, no shadows and no crowd; `G` cycles them with a notice; the menu's panel changes the arena behind it and survives a reload; under a 20x CPU throttle the game stepped itself down from High to Medium to Low.
- **The HUD after the polish** (1280x720, eight bots): the scoreboard rebuilt 5 times in 3 s (only when a score or an alive flag changed) and nothing else in the HUD was written per frame except the clock, once a second; with eight rows and five feed lines the feed sits 8 px under the board even at a larger font and line height; no empty board before the first roster.
- **Load, on the development laptop** (10 rooms x 8 players, real sockets, `MAX_CONNECTIONS_PER_IP=0`, 30 s rounds so rooms keep cycling): five minutes, and the numbers that matter for a server that holds ten full rooms are good: all 80 players were seated and kept (nobody refused, closed on or answered with an error), every player received 29.9 snapshots a second (the minimum was 29.9), and about eighty rounds (eight per room) rebuilt their worlds without the process growing (resident memory 81.5 MB after the one-minute warm-up, 80.8 MB at the end). The server's tick p99 read between 3 and 30 ms (typically 7-12 ms) against the spec's 4 ms, and that is where the scope notes come in: a profile of a 25-second run showed the process idle 77 % of the time, with the slow bursts made of trivial functions (`unpackInput`, the WebSocket validators) taking tens of milliseconds, which is scheduling on a machine at load average 4-6, while the same ten rooms run in one process without sockets cost 0.41 ms a tick and 1.2 ms at p99. So the target is unmet on this laptop and unproven anywhere else.
- **Plan 6's review carried into presets:** the composer's buffer is multisampled at 4 samples on High (the renderer's own antialiasing never reached it); Medium uses 2 and Low skips the composer.

## Global Constraints

- Everything in Plans 1-6's Global Constraints still applies (single package, relative imports, exact pins, axes, deterministic simulation path, quantised inputs, `freezeTuning`, commits only because the user opted in).
- **Server-only changes stay out of `src/shared` except the error code** (`too_many_rooms`) and the tightened `hit.hp` check; nothing in the simulation or the rules changes; `npm run hash` prints `10c3a72a`.
- **Limits protect the public, not the LAN:** loopback, link-local and private-network addresses are never limited (behind a reverse proxy on the same machine every player looks like one), and a limit of 0 switches it off.
- **Settings are the player's, and local:** kept in `localStorage` under `wreckyard.settings`, repaired field by field when damaged, never required (a browser that refuses storage still plays), and never sent to the server.
- **An automatic step down never steps up.**
- **No new dependency**; the image holds `dist/` only; nothing in this plan deploys, pushes or creates an account.
- The user's own `npm run dev` may be running on ports 8080/5173: never stop it. Use `PORT` with another port for anything that needs a server (18000 and up), and do not start a second Vite next to it except through `npm run smoke`, which takes its own ports from `SMOKE_*_PORT`.

## Review Focus

1. **A public server under abuse:** many sockets from one address, a string of wrong room codes (with joins that work in between), a flood of input frames, a stream of malformed upgrade requests, a client that writes its own `X-Forwarded-For`. → Task 46 (`guard.test.ts`, `guardIntegration.test.ts`, `config.test.ts`).
2. **A server behind a reverse proxy, and a LAN game:** every player arrives from one private address and must not be limited; with `TRUST_PROXY` the real address is the one the proxy wrote. → Task 46.
3. **A browser that refuses storage or holds damaged settings:** the game starts with defaults, repairs one field at a time, and never fails on a write. → Task 49 (`settings.test.ts`).
4. **A slow machine, and a preset changed in the middle of a match:** the crowd, shadows, glow, antialiasing, particle share and debris limit change at once without a reload, Low draws without the composer, the step down happens once and never back up, `?bloom=0` still wins. → Tasks 49, 50 (`settings.test.ts`, `fx.test.ts`, `debris.test.ts`, `audio.test.ts`, `dressing.test.ts`, `composer.test.ts` and the browser check).
5. **Leaving and joining during a countdown, and an empty room:** a leaver's car does not stay behind, a visitor who leaves again costs no restart, the restart budget still protects a room from a join-and-leave loop, and a room with nobody in it stops. → Task 48 (`room.test.ts`).

## File Structure

| File | Responsibility |
|---|---|
| `src/server/guard.ts` (new), `app.ts`, `config.ts`, `src/shared/protocol.ts` (modify) | limits per public address; `TRUST_PROXY`, `MAX_CONNECTIONS_PER_IP`; the `too_many_rooms` error |
| `src/server/static.ts`, `lobby.ts`, `app.ts` (modify) | no dotfiles or symlinks out of the root, caching decided from the resolved path; room codes from the operating system's random source; process memory in `/healthz` |
| `src/server/room.ts`, `combat.ts`, `lobby.ts`, `src/shared/protocol.ts` (modify) | countdown leavers, empty rooms, `hit.hp >= 0`, vestigial code removed |
| `src/client/settings.ts` (new) | presets, saved settings, the step down |
| `src/client/game/{scene,composer,dressing,debris,audio,fx,gameClient}.ts`, `main.ts`, `ui/menu.ts`, `index.html` (modify) | the presets applied: pixel ratio, antialiasing, shadows, glow, crowd, particles, debris, volume; the settings panel; the `G` key |
| `src/client/game/{fx,carView,matchState,input,spectator,gameClient,nameTag}.ts`, `ui/{format,hud,menu}.ts`, `index.html`, `src/shared/constants.ts` (modify) | the Plan 5 and Plan 6 polish |
| `scripts/lib/e2e.ts`, `scripts/lib/loadtest.ts`, `scripts/loadtest.ts`, `scripts/smoke-e2e.ts` (new), `package.json` | the end-to-end helper, the load test, the packaged smoke check |
| `Dockerfile`, `.dockerignore`, `CLAUDE.md`, `README.md`, `tests/packaging.test.ts` | the image, its guard-rail test, and the docs |
| `tests/…` | one file per new module and additions to the existing suites |

---

### Task 46: The connection guard: limits per address

**Files:**
- Create: `src/server/guard.ts`, `tests/server/guard.test.ts`, `tests/server/guardIntegration.test.ts`
- Modify: `src/server/app.ts`, `src/server/config.ts`, `src/shared/protocol.ts`, `tests/server/config.test.ts`

**Interfaces:**
- Consumes: `Lobby`, `TokenBucket`, `parseClientMessage`, the upgrade handler and the hello flow of `app.ts` (Plans 2-4), `readConfig` (Plan 4).
- Produces: `ConnectionGuard` (`admit(ip)`, `release(ip)`, `failedJoin(ip)`, `mayCreateRoom(ip)`, `sweep()`), `clientIp(req, trustedProxies)`, `isPrivateAddress(ip)`, `DEFAULT_GUARD`, `GuardOptions`; the `guard` and `trustProxy` (a number of proxies) options of `createGameServer`; environment variables `MAX_CONNECTIONS_PER_IP` (16; 0 = off) and `TRUST_PROXY` (number of reverse proxies in front, default 0); error code `too_many_rooms`.

- [ ] **Step 1: Write the tests**

The guard is a pure class with an injectable clock, tested alone; the integration tests run the real server behind a pretend proxy (`trustProxy: 1`, so a test client chooses its address with `X-Forwarded-For`) and pin what an abuser gets: a `429` for the socket over the limit, a lockout after a string of wrong room codes **that a join that works in between does not clear**, a limit on private rooms per minute that answers with `too_many_rooms` and does not hang up, a slot given back when a handshake fails after the address was let in, an address the proxy wrote rather than one the client made up in front of it, and a flood of input frames that ends in a hang-up while a client at its normal rate is never touched.

Create `tests/server/guard.test.ts`:

<!-- op {"kind": "create", "path": "tests/server/guard.test.ts"} -->
```ts
import { describe, expect, it } from 'vitest';
import { ConnectionGuard, DEFAULT_GUARD, clientIp, isPrivateAddress } from '../../src/server/guard';

const PUBLIC = '203.0.113.7';
const OTHER = '198.51.100.20';
const clock = (start = 1_000_000) => {
  const c = { t: start };
  return { c, now: () => c.t };
};

describe('isPrivateAddress and clientIp', () => {
  it('knows loopback, private, link-local and unknown addresses from public ones', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '172.31.255.1', '192.168.1.20', '169.254.3.3', '::1', 'fd12::1', 'fe80::1', 'unknown']) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of [PUBLIC, OTHER, '172.32.0.1', '172.15.0.1', '11.0.0.1', '2001:db8::1']) expect(isPrivateAddress(ip)).toBe(false);
  });

  it('takes the socket peer, without the IPv6 prefix of an IPv4 address', () => {
    expect(clientIp({ headers: {}, socket: { remoteAddress: '::ffff:203.0.113.7' } } as never, 0)).toBe(PUBLIC);
    expect(clientIp({ headers: {}, socket: { remoteAddress: undefined } } as never, 0)).toBe('unknown');
  });

  it('believes X-Forwarded-For only behind proxies it was told to trust, and only the entries they wrote', () => {
    const SPOOFED = '192.0.2.99';
    const req = (header: string | string[] | undefined) => ({ headers: header === undefined ? {} : { 'x-forwarded-for': header }, socket: { remoteAddress: '10.0.0.1' } }) as never;
    expect(clientIp(req(`${OTHER}, 10.0.0.1`), 0)).toBe('10.0.0.1'); // no proxy trusted: the header is ignored
    // one proxy that appends what it saw: the last entry is its own, everything before it came from the client and may be a lie
    expect(clientIp(req(`${SPOOFED}, ${OTHER}`), 1)).toBe(OTHER);
    expect(clientIp(req(OTHER), 1)).toBe(OTHER);
    expect(clientIp(req(`${SPOOFED}, ${OTHER}, 10.0.0.7`), 2)).toBe(OTHER); // two proxies: the second from the right
    expect(clientIp(req(['::ffff:198.51.100.20']), 1)).toBe(OTHER);
    // fewer entries than proxies, or none: the request skipped a proxy, so the peer is the client
    expect(clientIp(req(OTHER), 2)).toBe('10.0.0.1');
    expect(clientIp(req(undefined), 1)).toBe('10.0.0.1');
  });
});

describe('ConnectionGuard sockets', () => {
  it('lets an address keep a few sockets open, refuses the next, and lets it back in when one closes', () => {
    const g = new ConnectionGuard({ maxConnectionsPerIp: 3 });
    expect([g.admit(PUBLIC), g.admit(PUBLIC), g.admit(PUBLIC)]).toEqual(['ok', 'ok', 'ok']);
    expect(g.admit(PUBLIC)).toBe('too_many');
    expect(g.admit(OTHER)).toBe('ok'); // another address is not affected
    g.release(PUBLIC);
    expect(g.admit(PUBLIC)).toBe('ok');
  });

  it('never limits private addresses (a proxy or a LAN game would share one) and can be switched off', () => {
    const g = new ConnectionGuard({ maxConnectionsPerIp: 1 });
    for (let i = 0; i < 50; i++) expect(g.admit('127.0.0.1')).toBe('ok');
    const off = new ConnectionGuard({ maxConnectionsPerIp: 0 });
    for (let i = 0; i < 50; i++) expect(off.admit(PUBLIC)).toBe('ok');
  });

  it('forgets an address when its last socket closes, so memory does not grow with the crowd', () => {
    const g = new ConnectionGuard({ maxConnectionsPerIp: 4 });
    for (let i = 0; i < 100; i++) {
      const ip = `203.0.113.${i}`;
      g.admit(ip);
      g.release(ip);
    }
    expect(g.tracked).toBe(0);
  });
});

describe('ConnectionGuard failed joins', () => {
  it('locks an address out for a while after too many failed joins in a minute, and then lets it back', () => {
    const { c, now } = clock();
    const g = new ConnectionGuard({ failedJoinLimit: 3, failedJoinWindowMs: 60_000, lockoutMs: 30_000, now });
    expect(g.admit(PUBLIC)).toBe('ok');
    expect([g.failedJoin(PUBLIC), g.failedJoin(PUBLIC)]).toEqual([false, false]);
    expect(g.failedJoin(PUBLIC)).toBe(true);
    expect(g.admit(PUBLIC)).toBe('locked');
    expect(g.admit(OTHER)).toBe('ok');
    c.t += 29_000;
    expect(g.admit(PUBLIC)).toBe('locked');
    c.t += 2_000;
    expect(g.admit(PUBLIC)).toBe('ok');
  });

  it('forgets failures that are older than the window', () => {
    const { c, now } = clock();
    const g = new ConnectionGuard({ failedJoinLimit: 3, failedJoinWindowMs: 60_000, now });
    g.failedJoin(PUBLIC);
    g.failedJoin(PUBLIC);
    c.t += 61_000;
    expect(g.failedJoin(PUBLIC)).toBe(false); // the first two are old
    expect(g.failedJoin(PUBLIC)).toBe(false);
    expect(g.failedJoin(PUBLIC)).toBe(true); // three inside one window
  });

  it('does not count failures of private addresses', () => {
    const g = new ConnectionGuard({ failedJoinLimit: 1 });
    expect(g.failedJoin('127.0.0.1')).toBe(false);
    expect(g.admit('127.0.0.1')).toBe('ok');
  });
});

describe('ConnectionGuard room creation', () => {
  it('allows a few new private rooms a minute per address and then says no until the minute is up', () => {
    const { c, now } = clock();
    const g = new ConnectionGuard({ roomsPerMinute: 3, now });
    expect([g.mayCreateRoom(PUBLIC), g.mayCreateRoom(PUBLIC), g.mayCreateRoom(PUBLIC)]).toEqual([true, true, true]);
    expect(g.mayCreateRoom(PUBLIC)).toBe(false);
    expect(g.mayCreateRoom(OTHER)).toBe(true);
    c.t += 61_000;
    expect(g.mayCreateRoom(PUBLIC)).toBe(true);
  });
});

describe('ConnectionGuard.sweep', () => {
  it('forgets addresses whose failures and rooms have aged out, and keeps those still locked out or connected', () => {
    const { c, now } = clock();
    const g = new ConnectionGuard({ failedJoinLimit: 2, lockoutMs: 30_000, now });
    g.failedJoin('203.0.113.1'); // one failure, no socket
    g.mayCreateRoom('203.0.113.2');
    g.failedJoin('203.0.113.3');
    g.failedJoin('203.0.113.3'); // locked out
    g.admit('203.0.113.4'); // connected
    expect(g.tracked).toBe(4);
    c.t += 20_000;
    g.sweep();
    expect(g.tracked).toBe(4);
    c.t += 45_000; // failures and rooms are older than a minute, the lockout is over
    g.sweep();
    expect(g.tracked).toBe(1); // only the connected one
    expect(DEFAULT_GUARD.maxConnectionsPerIp).toBeGreaterThan(8); // a full room of one household fits
  });
});
```

Create `tests/server/guardIntegration.test.ts`:

<!-- op {"kind": "create", "path": "tests/server/guardIntegration.test.ts"} -->
```ts
import http from 'node:http';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { initPhysics } from '../../src/shared/physics';
import { createGameServer, type GameServer, type GameServerOptions } from '../../src/server/app';
import { TestClient } from '../helpers/testClient';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const FROM = (ip: string) => ({ 'x-forwarded-for': ip });
const A = '203.0.113.9';
const B = '198.51.100.4';

let app: GameServer;
let port: number;
const clients: TestClient[] = [];

beforeAll(async () => {
  await initPhysics();
});
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await app?.close();
});

async function start(options: GameServerOptions = {}): Promise<void> {
  app = createGameServer({ maxRooms: 6, botFill: 0, trustProxy: 1, rules: { countdownTicks: 30, liveTicks: 6000, resultsTicks: 60 }, ...options });
  port = await app.listen(0, '127.0.0.1');
}
const connect = async (ip: string): Promise<TestClient> => {
  const c = await TestClient.connect(port, FROM(ip));
  clients.push(c);
  return c;
};
/** The HTTP status a socket is refused with, or 101 when it is let in. */
const upgradeStatus = (ip: string): Promise<number> =>
  new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: FROM(ip) });
    ws.on('open', () => {
      resolve(101);
      ws.close();
    });
    ws.on('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0);
      res.resume();
    });
    ws.on('error', () => undefined);
  });

/** The status the server answers an upgrade request that is not a valid WebSocket handshake (no key) with. */
const badUpgradeStatus = (ip: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/ws', headers: { connection: 'Upgrade', upgrade: 'websocket', ...FROM(ip) } });
    req.on('response', (res) => {
      resolve(res.statusCode ?? 0);
      res.resume();
    });
    req.on('error', reject);
    req.end();
  });

describe('limits per address (behind a proxy that says who the player is)', () => {
  it('gives the slot back when the handshake fails after the address was let in, so bad requests cannot use up the limit', async () => {
    await start({ guard: { maxConnectionsPerIp: 2 } });
    for (let i = 0; i < 4; i++) expect(await badUpgradeStatus(A)).toBe(400);
    await sleep(100);
    expect(await upgradeStatus(A)).toBe(101);
  });

  it('refuses the socket after the last one an address may keep open, and lets it in again when one closes', async () => {
    await start({ guard: { maxConnectionsPerIp: 3 } });
    const open = [await connect(A), await connect(A), await connect(A)];
    expect(await upgradeStatus(A)).toBe(429);
    expect(await upgradeStatus(B)).toBe(101); // another address is not affected
    open[0]!.close();
    await sleep(100);
    expect(await upgradeStatus(A)).toBe(101);
  });

  it('locks an address out after a string of failed room-code guesses, for that address only', async () => {
    await start({ guard: { failedJoinLimit: 3, lockoutMs: 60_000 } });
    const guesser = await connect(A);
    for (const code of ['AAAA', 'BBBB', 'CCCC']) guesser.hello({ mode: 'join', code });
    await guesser.waitFor(() => guesser.closed, 3000, 'the guesser to be disconnected');
    expect(guesser.closed?.code).toBe(1008);
    expect(guesser.errors().map((e) => e.code)).toEqual(['room_not_found', 'room_not_found', 'room_not_found']); // each guess is answered, the last one hangs up
    expect(await upgradeStatus(A)).toBe(429);
    expect(await upgradeStatus(B)).toBe(101);
  });

  it('lets an honest mistake or two pass, and a join that worked in between does not clear them', async () => {
    await start({ guard: { failedJoinLimit: 3, lockoutMs: 60_000 } });
    const wrong = async (code: string): Promise<void> => {
      const c = await connect(A); // a socket that has failed cannot say hello again, so every guess uses a new one
      c.hello({ mode: 'join', code });
      await c.waitFor(() => c.errors()[0], 3000, `an error for ${code}`);
    };
    await wrong('AAAA');
    await wrong('BBBB');
    expect(await upgradeStatus(A)).toBe(101); // two mistakes: still welcome
    const honest = await connect(A);
    honest.hello({ mode: 'quick' });
    await honest.waitFor(() => honest.welcome(), 3000, 'welcome for the quick join');
    await wrong('CCCC'); // the third mistake inside the window: a guesser cannot wipe the count with joins that work
    expect(await upgradeStatus(A)).toBe(429);
  });

  it('allows a few private rooms a minute per address, then says so without hanging up', async () => {
    await start({ guard: { roomsPerMinute: 2 } });
    const made: TestClient[] = [];
    for (let i = 0; i < 2; i++) {
      const c = await connect(A);
      c.hello({ mode: 'create' });
      await c.waitFor(() => c.welcome(), 3000, 'welcome');
      made.push(c);
    }
    const third = await connect(A);
    third.hello({ mode: 'create' });
    const error = await third.waitFor(() => third.errors()[0], 3000, 'an error for the third room');
    expect(error.code).toBe('too_many_rooms');
    expect(third.closed).toBeNull();
    third.hello({ mode: 'quick' }); // it can still play in a public room
    await third.waitFor(() => third.welcome(), 3000, 'welcome for the public room');
    const other = await connect(B);
    other.hello({ mode: 'create' });
    await other.waitFor(() => other.welcome(), 3000, 'welcome for another address');
  });

  it('ignores X-Forwarded-For unless told to trust it, and never limits the loopback addresses', async () => {
    await start({ trustProxy: 0, guard: { maxConnectionsPerIp: 1 } });
    for (let i = 0; i < 4; i++) expect(await connect(A)).toBeDefined(); // all 127.0.0.1 in reality
    expect(await upgradeStatus(A)).toBe(101);
  });

  it('charges the address the proxy wrote, not one the client made up in front of it', async () => {
    await start({ guard: { maxConnectionsPerIp: 1 } });
    const lying = { 'x-forwarded-for': `${B}, ${A}` }; // the client claims to be B; the proxy appended who it really is
    clients.push(await TestClient.connect(port, lying));
    expect(await upgradeStatus(B)).toBe(101); // B is not framed
    await expect(TestClient.connect(port, lying)).rejects.toBeDefined(); // A is at its limit
  });
});

describe('a client that floods input frames', () => {
  it('is disconnected after a long run of dropped frames, and a client at its normal rate never is', async () => {
    await start();
    const flooder = await connect(A);
    flooder.hello({ mode: 'create' });
    await flooder.waitFor(() => flooder.welcome(), 3000, 'welcome');
    for (let i = 0; i < 2000; i++) flooder.sendInput({ throttle: 1, steer: 0, handbrake: false });
    await flooder.waitFor(() => flooder.closed, 3000, 'the flooder to be disconnected');
    expect(flooder.closed?.code).toBe(1008);
    const honest = await connect(B);
    honest.hello({ mode: 'create' });
    await honest.waitFor(() => honest.welcome(), 3000, 'welcome');
    await honest.drive({ throttle: 1, steer: 0, handbrake: false }, 700);
    expect(honest.closed).toBeNull();
  });
});
```

In `tests/server/config.test.ts`, the defaults gain the guard and the proxy count, and the settings test reads them:

<!-- op {"kind": "edit", "path": "tests/server/config.test.ts"} -->
```ts
      maxConnections: 200,
      botFill: ROUND.BOT_FILL,
```

with:

```ts
      maxConnections: 200,
      guard: { maxConnectionsPerIp: 16 },
      trustProxy: 0,
      botFill: ROUND.BOT_FILL,
```

In `tests/server/config.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/config.test.ts"} -->
```ts
    expect(c.options.botFill).toBe(2);
    expect(c.options.rules).toEqual({ countdownTicks: 180, liveTicks: 2700, resultsTicks: 150 });
```

with:

```ts
    expect(c.options.botFill).toBe(2);
    const proxied = readConfig({ MAX_CONNECTIONS_PER_IP: '4', TRUST_PROXY: 'true' }, '/app');
    expect(proxied.options.guard).toEqual({ maxConnectionsPerIp: 4 });
    expect(proxied.options.trustProxy).toBe(1);
    expect(readConfig({ TRUST_PROXY: '2' }, '/app').options.trustProxy).toBe(2); // a chain of two proxies
    for (const off of ['', '0', 'no', 'false', 'lots', '-1', '2.5x']) expect(readConfig({ TRUST_PROXY: off }, '/app').options.trustProxy, off).toBe(0);
    expect(readConfig({ MAX_CONNECTIONS_PER_IP: '0' }, '/app').options.guard?.maxConnectionsPerIp).toBe(0); // 0 turns the limit off
    expect(c.options.rules).toEqual({ countdownTicks: 180, liveTicks: 2700, resultsTicks: 150 });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/server/guard.test.ts tests/server/guardIntegration.test.ts tests/server/config.test.ts`
Expected: FAIL — `guard.ts` does not exist yet and the configuration has no guard or proxy count

<!-- check {"cmd": "npx vitest run tests/server/guard.test.ts tests/server/guardIntegration.test.ts tests/server/config.test.ts", "outcome": "fail", "match": "Cannot find module|FAIL|not a function|Failed"} -->

- [ ] **Step 3: Add the guard and wire it in**

`src/server/guard.ts`:

Create `src/server/guard.ts`:

<!-- op {"kind": "create", "path": "src/server/guard.ts"} -->
```ts
import type http from 'node:http';

/** Limits on what one address can do. All counts are per address; 0 turns a limit off. */
export interface GuardOptions {
  /** Sockets open at once. */
  maxConnectionsPerIp: number;
  /** Joins that fail (no such room, room full) in `failedJoinWindowMs` before the address is locked out for `lockoutMs`. */
  failedJoinLimit: number;
  failedJoinWindowMs: number;
  lockoutMs: number;
  /** Private rooms created per minute. */
  roomsPerMinute: number;
  /** Clock in milliseconds; injectable for tests. */
  now?: () => number;
}

export const DEFAULT_GUARD: Readonly<GuardOptions> = {
  maxConnectionsPerIp: 16,
  failedJoinLimit: 8,
  failedJoinWindowMs: 60_000,
  lockoutMs: 30_000,
  roomsPerMinute: 6,
};

export type Admission = 'ok' | 'too_many' | 'locked';

/**
 * The address a request really comes from. Behind `trustedProxies` reverse proxies, each of which appends the address it saw to
 * X-Forwarded-For, the entry to believe is the one that many places from the right: everything to its left was written by the
 * client and can say anything. With no proxy (0), or fewer entries than proxies (the request skipped one), it is the socket's peer.
 */
export function clientIp(req: Pick<http.IncomingMessage, 'headers' | 'socket'>, trustedProxies: number): string {
  if (trustedProxies > 0) {
    const header = req.headers['x-forwarded-for'];
    const entries = (Array.isArray(header) ? header.join(',') : (header ?? '')).split(',').map((s) => s.trim()).filter(Boolean);
    const entry = entries.length >= trustedProxies ? entries[entries.length - trustedProxies] : undefined;
    if (entry) return entry.replace(/^::ffff:/, '');
  }
  return (req.socket.remoteAddress ?? 'unknown').replace(/^::ffff:/, '');
}

/**
 * Loopback, link-local and private-network addresses. Behind a reverse proxy on the same host or network every player looks
 * like one of these, so limits are not applied to them (a whole game room would share one address); set TRUST_PROXY to
 * limit the real addresses the proxy reports. LAN players are private addresses too and stay unlimited.
 */
export function isPrivateAddress(ip: string): boolean {
  if (ip === 'unknown' || ip === '::1' || ip === 'localhost') return true;
  if (/^(fc|fd|fe80)/i.test(ip)) return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(ip);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

interface AddressRecord {
  open: number;
  failures: number[];
  lockedUntil: number;
  rooms: number[];
}

/**
 * Remembers what each public address has done and says whether it may do more: open another socket, try another room code,
 * create another room. Memory stays bounded: an address is forgotten once it has no socket, no lockout and nothing recent.
 */
export class ConnectionGuard {
  private readonly records = new Map<string, AddressRecord>();
  private readonly options: GuardOptions;
  private readonly now: () => number;

  constructor(options: Partial<GuardOptions> = {}) {
    this.options = { ...DEFAULT_GUARD, ...options };
    this.now = options.now ?? (() => Date.now());
  }

  /** Addresses being tracked (for tests and stats). */
  get tracked(): number {
    return this.records.size;
  }

  /** A new socket from `ip`. Call `release(ip)` when it closes, but only after an `'ok'`. */
  admit(ip: string): Admission {
    if (isPrivateAddress(ip)) return 'ok';
    const r = this.record(ip);
    if (r.lockedUntil > this.now()) return 'locked';
    if (this.options.maxConnectionsPerIp > 0 && r.open >= this.options.maxConnectionsPerIp) return 'too_many';
    r.open++;
    return 'ok';
  }

  release(ip: string): void {
    if (isPrivateAddress(ip)) return;
    const r = this.records.get(ip);
    if (!r) return;
    r.open = Math.max(0, r.open - 1);
    this.forget(ip, r);
  }

  /** A join that failed. Returns true when the address is now locked out. A join that works does not clear the count: a guesser could interleave those; mistakes expire with the window. */
  failedJoin(ip: string): boolean {
    if (isPrivateAddress(ip) || this.options.failedJoinLimit <= 0) return false;
    const r = this.record(ip);
    const t = this.now();
    r.failures = r.failures.filter((at) => t - at < this.options.failedJoinWindowMs);
    r.failures.push(t);
    if (r.failures.length >= this.options.failedJoinLimit) {
      r.lockedUntil = t + this.options.lockoutMs;
      r.failures = [];
      return true;
    }
    return false;
  }

  /** May `ip` create another private room? Counts the creation when it says yes. */
  mayCreateRoom(ip: string): boolean {
    if (isPrivateAddress(ip) || this.options.roomsPerMinute <= 0) return true;
    const r = this.record(ip);
    const t = this.now();
    r.rooms = r.rooms.filter((at) => t - at < 60_000);
    if (r.rooms.length >= this.options.roomsPerMinute) return false;
    r.rooms.push(t);
    return true;
  }

  private record(ip: string): AddressRecord {
    let r = this.records.get(ip);
    if (!r) {
      r = { open: 0, failures: [], lockedUntil: 0, rooms: [] };
      this.records.set(ip, r);
    }
    return r;
  }

  /** Forgets the addresses that have no socket, no lockout and nothing recent. Call now and then (the server does it once a minute). */
  sweep(): void {
    for (const [ip, r] of this.records) this.forget(ip, r);
  }

  private forget(ip: string, r: AddressRecord): void {
    const t = this.now();
    const recent = r.failures.some((at) => t - at < this.options.failedJoinWindowMs) || r.rooms.some((at) => t - at < 60_000);
    if (r.open === 0 && r.lockedUntil <= t && !recent) this.records.delete(ip);
  }
}
```

In `src/shared/protocol.ts`, the new error code:

<!-- op {"kind": "edit", "path": "src/shared/protocol.ts"} -->
```ts
  | 'rate_limited'
  | 'inactive';
```

with:

```ts
  | 'rate_limited'
  | 'too_many_rooms'
  | 'inactive';
```

In `src/server/config.ts`, the two settings (`TRUST_PROXY` is a number of proxies: "1", "true" and "yes" are one, a whole number is that many, anything else none):

<!-- op {"kind": "edit", "path": "src/server/config.ts"} -->
```ts

/** Seconds (fractions allowed) turned into simulation ticks; anything unusable gives the default. */
```

with:

```ts

/** How many reverse proxies to trust: "1", "true" or "yes" is one, a whole number is that many, anything else is none. */
const proxies = (value: string | undefined): number => {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'true' || v === 'yes') return 1;
  return /^\d{1,2}$/.test(v) ? Number(v) : 0;
};

/** Seconds (fractions allowed) turned into simulation ticks; anything unusable gives the default. */
```

In `src/server/config.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/config.ts"} -->
```ts
      maxConnections: positive(env.MAX_CONNECTIONS, 200),
      botFill: Math.min(nonNegative(env.BOT_FILL, ROUND.BOT_FILL), 8),
```

with:

```ts
      maxConnections: positive(env.MAX_CONNECTIONS, 200),
      guard: { maxConnectionsPerIp: nonNegative(env.MAX_CONNECTIONS_PER_IP, 16) },
      trustProxy: proxies(env.TRUST_PROXY),
      botFill: Math.min(nonNegative(env.BOT_FILL, ROUND.BOT_FILL), 8),
```

In `src/server/app.ts`, the guard: the options, the error text, one guard per server, admission when a socket arrives (its slot comes back when the raw socket closes, whatever became of it), the create-room and failed-join checks in the hello flow, the flood check for input frames, and a sweep once a minute:

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts
import { decodeInput, normalizeRoomCode, parseClientMessage, sanitizeName, type ErrorCode } from '../shared/protocol';
import { TokenBucket } from './limits';
```

with:

```ts
import { decodeInput, normalizeRoomCode, parseClientMessage, sanitizeName, type ErrorCode } from '../shared/protocol';
import { ConnectionGuard, clientIp, type GuardOptions } from './guard';
import { TokenBucket } from './limits';
```

In `src/server/app.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts
  seed?: number;
}
```

with:

```ts
  seed?: number;
  /** Limits per public address: sockets open, failed joins, rooms created (see GuardOptions for the defaults). */
  guard?: Partial<GuardOptions>;
  /** How many reverse proxies stand in front of the server; the player's address is then read from X-Forwarded-For, that many entries from the right (default 0: the socket's peer). */
  trustProxy?: number;
}
```

In `src/server/app.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts
  rate_limited: 'Too many messages.',
  inactive: 'Disconnected for inactivity.',
```

with:

```ts
  rate_limited: 'Too many messages.',
  too_many_rooms: 'You are creating rooms too fast — wait a minute.',
  inactive: 'Disconnected for inactivity.',
```

In `src/server/app.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts
  const staticHandler = options.staticDir ? createStaticHandler(options.staticDir) : null;
  const maxConnections = options.maxConnections ?? 200;
```

with:

```ts
  const staticHandler = options.staticDir ? createStaticHandler(options.staticDir) : null;
  const guard = new ConnectionGuard(options.guard);
  const trustProxy = options.trustProxy ?? 0;
  let sweeper: ReturnType<typeof setInterval> | null = null;
  const maxConnections = options.maxConnections ?? 200;
```

In `src/server/app.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts
    if (connections >= maxConnections) return refuse('503 Service Unavailable');
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
```

with:

```ts
    if (connections >= maxConnections) return refuse('503 Service Unavailable');
    const ip = clientIp(req, trustProxy);
    if (guard.admit(ip) !== 'ok') return refuse('429 Too Many Requests');
    socket.once('close', () => guard.release(ip)); // whatever becomes of this socket, even a handshake that fails, its slot comes back
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
```

In `src/server/app.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts

  function onBinary(player: Player, data: RawData, bucket: TokenBucket): void {
    if (!player.joined || !player.room) return; // inputs before a seat exists are ignored
```

with:

```ts

  /** A player who is over the input limit this many frames in a row is flooding, not lagging: the socket is closed. */
  const MAX_DROPPED_INPUTS = 300;

  function onBinary(player: Player, ws: WebSocket, data: RawData, bucket: TokenBucket, flood: { dropped: number }): void {
    if (!player.joined || !player.room) return; // inputs before a seat exists are ignored
```

In `src/server/app.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts
    if (!player.joined || !player.room) return; // inputs before a seat exists are ignored
    if (!bucket.take()) return; // silently drop input floods
    const pkt = decodeInput(toBytes(data));
```

with:

```ts
    if (!player.joined || !player.room) return; // inputs before a seat exists are ignored
    if (!bucket.take()) {
      if (++flood.dropped > MAX_DROPPED_INPUTS) ws.close(1008, 'rate limited');
      return; // over the limit: drop the frame
    }
    flood.dropped = 0;
    const pkt = decodeInput(toBytes(data));
```

In `src/server/app.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts

  function onText(player: Player, ws: WebSocket, text: string, bucket: TokenBucket): void {
    if (!bucket.take()) {
```

with:

```ts

  function onText(player: Player, ws: WebSocket, text: string, bucket: TokenBucket, ip: string): void {
    if (!bucket.take()) {
```

In `src/server/app.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts
    if (msg.mode === 'quick') result = lobby.quickPlay(player);
    else if (msg.mode === 'create') result = lobby.createPrivate(player);
    else {
      const code = normalizeRoomCode(msg.code ?? '');
```

with:

```ts
    if (msg.mode === 'quick') result = lobby.quickPlay(player);
    else if (msg.mode === 'create') {
      if (!guard.mayCreateRoom(ip)) {
        player.sendError('too_many_rooms', ERROR_TEXT.too_many_rooms);
        return;
      }
      result = lobby.createPrivate(player);
    } else {
      const code = normalizeRoomCode(msg.code ?? '');
```

In `src/server/app.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts
      player.sendError(result.code, ERROR_TEXT[result.code]);
      return;
```

with:

```ts
      player.sendError(result.code, ERROR_TEXT[result.code]);
      // guessing room codes: a few honest mistakes are fine, a string of them locks the address out for a while
      if ((result.code === 'room_not_found' || result.code === 'room_full') && guard.failedJoin(ip)) ws.close(1008, 'too many failed joins');
      return;
```

In `src/server/app.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts

  wss.on('connection', (ws: WebSocket) => {
    connections++;
```

with:

```ts

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    connections++;
```

In `src/server/app.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts
    connections++;
    const player = new Player(nextPlayerId++, ws);
```

with:

```ts
    connections++;
    const ip = clientIp(req, trustProxy);
    const player = new Player(nextPlayerId++, ws);
```

In `src/server/app.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts
    const inputBucket = new TokenBucket(120, 90);
    let alive = true;
```

with:

```ts
    const inputBucket = new TokenBucket(120, 90);
    const flood = { dropped: 0 };
    let alive = true;
```

In `src/server/app.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts
      try {
        if (isBinary) onBinary(player, data, inputBucket);
        else onText(player, ws, new TextDecoder().decode(toBytes(data)), textBucket);
      } catch (err) {
```

with:

```ts
      try {
        if (isBinary) onBinary(player, ws, data, inputBucket, flood);
        else onText(player, ws, new TextDecoder().decode(toBytes(data)), textBucket, ip);
      } catch (err) {
```

In `src/server/app.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts
          startLoop();
          resolve((server.address() as AddressInfo).port);
```

with:

```ts
          startLoop();
          sweeper = setInterval(() => guard.sweep(), 60_000);
          sweeper.unref();
          resolve((server.address() as AddressInfo).port);
```

In `src/server/app.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts
      loop = null;
      for (const client of wss.clients) client.terminate();
```

with:

```ts
      loop = null;
      if (sweeper) clearInterval(sweeper);
      sweeper = null;
      for (const client of wss.clients) client.terminate();
```

- [ ] **Step 4: Run the tests, then the whole suite**

Run: `npx vitest run tests/server/guard.test.ts tests/server/guardIntegration.test.ts tests/server/config.test.ts`
Expected: the three files pass

<!-- check {"cmd": "npx vitest run tests/server/guard.test.ts tests/server/guardIntegration.test.ts tests/server/config.test.ts", "outcome": "pass"} -->

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 608} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): limits per address \u2014 sockets, failed room-code guesses and rooms created, a proxy count for X-Forwarded-For, and a hang-up for input floods"
```

<!-- commit "feat(server): limits per address \u2014 sockets, failed room-code guesses and rooms created, a proxy count for X-Forwarded-For, and a hang-up for input floods" -->

---

### Task 47: Static serving without dotfiles or symlinks out of the root, room codes nobody can predict, memory in /healthz

**Files:**
- Modify: `src/server/static.ts`, `src/server/lobby.ts`, `src/server/app.ts`, `tests/server/static.test.ts`, `tests/server/lobby.test.ts`, `tests/server/integration.test.ts`

**Interfaces:**
- Consumes: `createStaticHandler` (Plan 2), `Lobby` (Plan 2), `ServerStats` and `/healthz` (Plans 2-3).
- Produces: A static handler that never serves a dotfile, never follows a symlink out of the root and decides caching from the resolved path; room codes drawn from `crypto.randomInt`; `rssMb` and `heapMb` in `/healthz`.

- [ ] **Step 1: Write the tests**

Three static-handler tests (dotfiles, symlinks to a file and to a directory, caching from the resolved path rather than from how the request spells it), two lobby tests (a stuck `Math.random` still gives every room its own code; codes cover the alphabet) and a health check for the process memory:

In `tests/server/static.test.ts`:

<!-- op {"kind": "edit", "path": "tests/server/static.test.ts"} -->
```ts
  fs.writeFileSync(path.join(tmp, 'secret.txt'), 'top secret');
  const handler = createStaticHandler(root);
```

with:

```ts
  fs.writeFileSync(path.join(tmp, 'secret.txt'), 'top secret');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET_KEY=1');
  fs.writeFileSync(path.join(root, 'assets', '.hidden.js'), 'hidden');
  fs.mkdirSync(path.join(tmp, 'outside'));
  fs.writeFileSync(path.join(tmp, 'outside', 'leak.txt'), 'leaked');
  fs.symlinkSync(path.join(tmp, 'secret.txt'), path.join(root, 'link.txt'));
  fs.symlinkSync(path.join(tmp, 'outside'), path.join(root, 'outdir'));
  const handler = createStaticHandler(root);
```

In `tests/server/static.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/static.test.ts"} -->
```ts

  it('rejects malformed percent-encoding', async () => {
```

with:

```ts

  it('never serves dotfiles', async () => {
    for (const p of ['/.env', '/assets/.hidden.js', '/.git/config']) {
      const res = await fetch(base + p);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('fallthrough');
    }
  });

  it('does not follow a symlink out of the root, to a file or to a directory', async () => {
    for (const p of ['/link.txt', '/outdir/leak.txt']) {
      const res = await fetch(base + p);
      const body = await res.text();
      expect(res.status).toBe(404);
      expect(body).not.toContain('secret');
      expect(body).not.toContain('leaked');
    }
  });

  it('decides the caching from the file the request resolves to, not from how the path is spelled', async () => {
    const res = await fetch(`${base}/assets/..%2findex.html`); // resolves to /index.html
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<h1>hello</h1>');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('rejects malformed percent-encoding', async () => {
```

In `tests/server/lobby.test.ts`:

<!-- op {"kind": "edit", "path": "tests/server/lobby.test.ts"} -->
```ts
  return result;
}

describe('Lobby quick play', () => {
```

with:

```ts
  return result;
}

describe('Lobby room codes', () => {
  it('are not drawn from Math.random: a stuck Math.random still gives every room its own code', () => {
    const stuck = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const lobby = makeLobby(30);
      const codes = new Set<string>();
      for (let i = 0; i < 20; i++) codes.add(ok(lobby.createPrivate(newPlayer())).room.code);
      expect(codes.size).toBe(20);
      for (const code of codes) expect(code).toMatch(new RegExp(`^[${NET.ROOM_CODE_ALPHABET}]{${NET.ROOM_CODE_LENGTH}}$`));
    } finally {
      stuck.mockRestore();
    }
  });

  it('spread over the whole alphabet', () => {
    const lobby = makeLobby(300);
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) for (const ch of ok(lobby.createPrivate(newPlayer())).room.code) seen.add(ch);
    expect(seen.size).toBeGreaterThan(NET.ROOM_CODE_ALPHABET.length - 3);
  });
});

describe('Lobby quick play', () => {
```

In `tests/server/integration.test.ts`:

<!-- op {"kind": "edit", "path": "tests/server/integration.test.ts"} -->
```ts
    expect(typeof health.tickMsP99).toBe('number');
    const missing = await fetch(`http://127.0.0.1:${port}/nope`);
```

with:

```ts
    expect(typeof health.tickMsP99).toBe('number');
    expect(health.rssMb as number).toBeGreaterThan(20); // the process's memory, for the load test and for monitoring
    expect(health.heapMb as number).toBeGreaterThan(1);
    expect(health.heapMb as number).toBeLessThan(health.rssMb as number);
    const missing = await fetch(`http://127.0.0.1:${port}/nope`);
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/server/static.test.ts tests/server/lobby.test.ts tests/server/integration.test.ts`
Expected: FAIL — dotfiles and symlinks are served, codes come from `Math.random`, `/healthz` has no memory

<!-- check {"cmd": "npx vitest run tests/server/static.test.ts tests/server/lobby.test.ts tests/server/integration.test.ts", "outcome": "fail", "match": "FAIL|\u00d7|failed"} -->

- [ ] **Step 3: Harden the handler, draw the codes from the operating system, report memory**

In `src/server/static.ts` (what a request names is decided after the path was resolved, relative to the root):

<!-- op {"kind": "edit", "path": "src/server/static.ts"} -->
```ts
    }
    let stat: fs.Stats;
```

with:

```ts
    }
    // what the request really names, relative to the root: decided after the path was resolved, not from the raw text
    const inside = path.relative(root, file).split(path.sep);
    if (inside.some((segment) => segment.startsWith('.'))) return false; // dotfiles (.env, .git) are never served
    let stat: fs.Stats;
```

In `src/server/static.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/static.ts"} -->
```ts
    try {
      stat = fs.statSync(file);
    } catch {
```

with:

```ts
    try {
      const real = fs.realpathSync(file);
      const realRoot = fs.realpathSync(root);
      if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return false; // a symlink that leads out of the root
      stat = fs.statSync(real);
    } catch {
```

In `src/server/static.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/static.ts"} -->
```ts
      'x-content-type-options': 'nosniff',
      'cache-control': rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
```

with:

```ts
      'x-content-type-options': 'nosniff',
      'cache-control': inside[0] === 'assets' ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
```

In `src/server/lobby.ts`:

<!-- op {"kind": "edit", "path": "src/server/lobby.ts"} -->
```ts
import { NET } from '../shared/constants';
```

with:

```ts
import { randomInt } from 'node:crypto';
import { NET } from '../shared/constants';
```

In `src/server/lobby.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/lobby.ts"} -->
```ts
  maxRooms: number;
  /** Injectable for tests; defaults to Math.random (server-only, never used by the simulation). */
  random?: () => number;
```

with:

```ts
  maxRooms: number;
  /** A number in [0, 1) that picks the letters of a room code. Injectable for tests; the default is cryptographically random, so codes cannot be predicted. */
  random?: () => number;
```

In `src/server/lobby.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/lobby.ts"} -->
```ts
  constructor(private readonly options: LobbyOptions) {
    this.random = options.random ?? Math.random;
  }
```

with:

```ts
  constructor(private readonly options: LobbyOptions) {
    this.random = options.random ?? (() => randomInt(0x1_0000_0000) / 0x1_0000_0000);
  }
```

In `src/server/app.ts`, the health report carries the process memory:

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts
  tickMsP99: number;
  uptimeSec: number;
}
```

with:

```ts
  tickMsP99: number;
  uptimeSec: number;
  /** Memory of the server process, in megabytes: resident set and JavaScript heap. */
  rssMb: number;
  heapMb: number;
}
```

and:

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    };
```

with:

```ts
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      rssMb: Math.round(process.memoryUsage().rss / 104857.6) / 10,
      heapMb: Math.round(process.memoryUsage().heapUsed / 104857.6) / 10,
    };
```

- [ ] **Step 4: Run the tests, then the whole suite**

Run: `npx vitest run tests/server/static.test.ts tests/server/lobby.test.ts tests/server/integration.test.ts`
Expected: the three files pass

<!-- check {"cmd": "npx vitest run tests/server/static.test.ts tests/server/lobby.test.ts tests/server/integration.test.ts", "outcome": "pass"} -->

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 613} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): static files never leave the root or show dotfiles, room codes come from the OS random source, /healthz reports memory"
```

<!-- commit "feat(server): static files never leave the root or show dotfiles, room codes come from the OS random source, /healthz reports memory" -->

---

### Task 48: Room polish: countdown leavers, empty rooms, hit validation, dead code

**Files:**
- Modify: `src/server/room.ts`, `src/server/combat.ts`, `src/server/lobby.ts`, `src/shared/protocol.ts`, `tests/server/room.test.ts`, `tests/server/roomCombat.test.ts`, `tests/server/lobby.test.ts`, `tests/server/integration.test.ts`, `tests/combat.test.ts`, `tests/protocol.test.ts`

**Interfaces:**
- Consumes: `Room` (Plan 4: `addPlayer`, `removePlayer`, `step`, `greeting`, the restart budget `ROUND.MAX_COUNTDOWN_RESTARTS`), `HitTracker`, `AttackLog`, `JoinResult`.
- Produces: A player who leaves during a countdown starts it over instead of leaving a dead car (until the restart budget is spent, then they become a wreck as before); a visitor who joins and leaves again costs no restart; a room with nobody in it stops stepping; `parseServerMessage` rejects a negative `hit.hp`; `HitTracker.reset`, `AttackLog.reset`, `Participant.key` and `JoinResult.slot` are gone.

- [ ] **Step 1: Write the tests**

The old test that pinned "a countdown leaver becomes a wreck for the whole round" is replaced by the new behaviour (restart without them, wreck only once the budget is spent), and five more pin the edges: a visitor who joins and leaves before the restart costs nothing, a seated leaver in the same tick as such a visitor still restarts, an empty room stops stepping, greeting scores during the results are the totals the results announced (not the round counted twice), and the events of a tick precede that tick's snapshot. Tests of the removed `reset` methods go with them. The integration test waits for the round to go live before it closes a player, so it tests the elimination it means to, and its waits are generous.

In `tests/server/room.test.ts`:

<!-- op {"kind": "edit", "path": "tests/server/room.test.ts"} -->
```ts

  it('turns a player who leaves during the countdown into a wreck for the whole round', () => {
    const { room } = makeRoom({ rules: { countdownTicks: 200 } });
```

with:

```ts

  it('starts the countdown over without a player who leaves during it, instead of leaving their car behind', () => {
    const { room } = makeRoom({ rules: { countdownTicks: 200 } });
```

In `tests/server/room.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/room.test.ts"} -->
```ts
    const b = join(room, 'Bob');
    join(room, 'Cy');
    steps(room, 5);
```

with:

```ts
    const b = join(room, 'Bob');
    const c = join(room, 'Cy');
    steps(room, 5);
```

In `tests/server/room.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/room.test.ts"} -->
```ts
    room.removePlayer(b.player);
    expect(messages(a.socket, 'ko')).toMatchObject([{ victim: 1, reason: 'disconnected' }]);
    steps(room, 400);
```

with:

```ts
    room.removePlayer(b.player);
    expect(messages(a.socket, 'ko')).toHaveLength(0); // nobody has driven yet: nobody is eliminated
    steps(room, 1);
    expect(room.epoch).toBe(2);
    expect(room.round).toBe(1); // the same round, started over
    expect(messages(a.socket, 'roster').at(-1)).toMatchObject({ epoch: 2, you: 0 });
    expect(messages(c.socket, 'roster').at(-1)).toMatchObject({ epoch: 2, you: 1 });
    expect(room.playerInfos().map((p) => p.name)).toEqual(['Ann', 'Cy']);
    steps(room, 400);
```

In `tests/server/room.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/room.test.ts"} -->
```ts
    expect(room.phase).toBe('live'); // Ann and Cy carry on
    expect(snapshots(a.socket).at(-1)!.cars.map((c) => c.slot)).toEqual([0, 1, 2]);
  });
```

with:

```ts
    expect(room.phase).toBe('live'); // Ann and Cy carry on
    expect(snapshots(a.socket).at(-1)!.cars.map((car) => car.slot)).toEqual([0, 1]);
  });

  it('turns a player who leaves once the countdown has restarted too often into a wreck, so nobody can hold a room back by joining and leaving', () => {
    const { room } = makeRoom({ rules: { countdownTicks: 200 } });
    const a = join(room, 'Ann');
    join(room, 'Bob');
    steps(room, 2);
    for (let i = 0; i < ROUND.MAX_COUNTDOWN_RESTARTS; i++) {
      const visitor = join(room, 'Vic');
      steps(room, 2);
      room.removePlayer(visitor.player);
    }
    expect(room.epoch).toBe(1 + ROUND.MAX_COUNTDOWN_RESTARTS);
    expect(messages(a.socket, 'ko').at(-1)).toMatchObject({ victim: 2, reason: 'disconnected' }); // the last visitor's car stays
    steps(room, 3);
    expect(room.epoch).toBe(1 + ROUND.MAX_COUNTDOWN_RESTARTS); // and the countdown keeps running
  });

  it('does not restart the countdown for somebody who joins and leaves again before it could', () => {
    const { room } = makeRoom({ rules: { countdownTicks: 100 } });
    const a = join(room, 'Ann');
    steps(room, 10);
    const visitor = join(room, 'Vic');
    room.removePlayer(visitor.player);
    steps(room, 5);
    expect(room.epoch).toBe(1);
    expect(messages(a.socket, 'roster')).toHaveLength(1);
  });

  it('still restarts the countdown when a player with a car leaves in the same tick as a newcomer who comes and goes', () => {
    const { room } = makeRoom({ rules: { countdownTicks: 100 } });
    join(room, 'Ann');
    const b = join(room, 'Bob');
    steps(room, 10);
    room.removePlayer(b.player);
    const visitor = join(room, 'Vic');
    room.removePlayer(visitor.player);
    steps(room, 1);
    expect(room.epoch).toBe(2);
    expect(room.playerInfos().map((p) => p.name)).toEqual(['Ann']);
  });

  it('stops stepping once its last human has left, instead of playing rounds against its bots until somebody disposes of it', () => {
    const { room, emptied } = makeRoom({ botFill: 4 });
    const a = join(room, 'Ann');
    steps(room, 5);
    const tick = room.simTick;
    room.removePlayer(a.player);
    expect(emptied).toEqual([room]);
    steps(room, 30);
    expect(room.simTick).toBe(tick);
  });
```

In `tests/server/roomCombat.test.ts`:

<!-- op {"kind": "edit", "path": "tests/server/roomCombat.test.ts"} -->
```ts
import { initPhysics } from '../../src/shared/physics';
import type { CarState } from '../../src/shared/types';
```

with:

```ts
import { initPhysics } from '../../src/shared/physics';
import type { KoMessage } from '../../src/shared/protocol';
import type { CarState } from '../../src/shared/types';
```

In `tests/server/roomCombat.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/roomCombat.test.ts"} -->
```ts
    expect(snapshots(a.socket).at(-1)!.cars.find((c) => c.slot === 0)!.hp).toBe(0);
  });
```

with:

```ts
    expect(snapshots(a.socket).at(-1)!.cars.find((c) => c.slot === 0)!.hp).toBe(0);
  });

  it('sends the events of a tick before that tick\'s snapshot, so no snapshot shows what the client has not been told yet', () => {
    const { room, a } = duel();
    while (room.simTick % NET.SNAPSHOT_EVERY !== NET.SNAPSHOT_EVERY - 1) room.step();
    const before = a.socket.sent.length;
    roundState(room).status.get(1)!.hp = 0; // a stall elimination on the next step, which is a snapshot tick
    room.step();
    const added = a.socket.sent.slice(before);
    const ko = added.findIndex((d) => typeof d === 'string' && (JSON.parse(d) as { t: string }).t === 'ko');
    const snapshot = added.findIndex((d) => typeof d !== 'string');
    expect(ko).toBeGreaterThanOrEqual(0);
    expect(snapshot).toBeGreaterThanOrEqual(0);
    expect(ko).toBeLessThan(snapshot);
    expect(snapshots(a.socket).at(-1)!.tick).toBe((messages(a.socket, 'ko').at(-1) as unknown as KoMessage).tick);
  });
```

In `tests/server/roomCombat.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/roomCombat.test.ts"} -->
```ts

  it('greets a newcomer with the hits of the round so far, oldest first', () => {
```

with:

```ts

  it('greets a player who joins during the results with the totals the results announced, not with the round counted twice', () => {
    const { room, a } = duel({ rules: { resultsTicks: 600 } });
    headOn(room);
    steps(room, 90);
    roundState(room).status.get(1)!.hp = 0;
    steps(room, 2);
    expect(room.phase).toBe('results');
    const rows = (messages(a.socket, 'results').at(-1)!.rows as Array<{ slot: number; score: number }>).map((r) => [r.slot, r.score]);
    const late = join(room, 'Cy');
    const greeted = room.greeting(late.player).scores.map((s) => [s.slot, s.score]);
    expect(greeted).toEqual(rows);
    expect(rows[0]![1]).toBeGreaterThan(100); // the damage dealt plus the win, once
  });

  it('greets a newcomer with the hits of the round so far, oldest first', () => {
```

In `tests/server/lobby.test.ts`:

<!-- op {"kind": "edit", "path": "tests/server/lobby.test.ts"} -->
```ts
    expect(joined.slot).toBe(-1); // a car comes with the next roster

```

with:

```ts
    expect(joined.room.greeting(joined.room.seated()[1]!).you).toBe(-1); // a car comes with the next roster

```

In `tests/combat.test.ts`:

<!-- op {"kind": "edit", "path": "tests/combat.test.ts"} -->
```ts

  it('reports every hit in a fixed order and forgets open windows on reset', () => {
    const tracker = new HitTracker();
```

with:

```ts

  it('reports every hit in a fixed order', () => {
    const tracker = new HitTracker();
```

In `tests/combat.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/combat.test.ts"} -->
```ts
    expect(hits.map((h) => [h.victim, h.attacker])).toEqual([[0, 1], [1, 0], [2, 5], [5, 2]]);
    tracker.update(6, [carCar(9_000)]);
    tracker.reset();
    expect(tracker.update(20, [])).toEqual([]);
  });
```

with:

```ts
    expect(hits.map((h) => [h.victim, h.attacker])).toEqual([[0, 1], [1, 0], [2, 5], [5, 2]]);
  });
```

In `tests/combat.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/combat.test.ts"} -->
```ts

  it('keeps the most recent hit per attacker and can be reset', () => {
    const log = new AttackLog();
```

with:

```ts

  it('keeps the most recent hit per attacker', () => {
    const log = new AttackLog();
```

In `tests/combat.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/combat.test.ts"} -->
```ts
    expect(log.credit(1, 210)).toEqual({ killer: 2, assists: [3] });
    log.reset();
    expect(log.credit(1, 210).killer).toBe(-1);
  });
```

with:

```ts
    expect(log.credit(1, 210)).toEqual({ killer: 2, assists: [3] });
  });
```

In `tests/protocol.test.ts`, a negative `hp` in a `hit` message is malformed:

<!-- op {"kind": "edit", "path": "tests/protocol.test.ts"} -->
```ts
      JSON.stringify({ ...welcome, scores: [{ slot: 9, score: 1, kills: 0 }] }),
      JSON.stringify({ ...welcome, players: [{ slot: 1, name: 'x', color: 1, bot: 'yes' }] }),
```

with:

```ts
      JSON.stringify({ ...welcome, scores: [{ slot: 9, score: 1, kills: 0 }] }),
      JSON.stringify({ ...hit, hp: -3 }),
      JSON.stringify({ ...welcome, players: [{ slot: 1, name: 'x', color: 1, bot: 'yes' }] }),
```

In `tests/server/integration.test.ts`:

<!-- op {"kind": "edit", "path": "tests/server/integration.test.ts"} -->
```ts
    await b.waitFor(() => rosterWith(b, 2), 4000, 'both seated');
    a.close();
```

with:

```ts
    await b.waitFor(() => rosterWith(b, 2), 4000, 'both seated');
    await b.waitFor(() => goesLive(b), 4000, 'the round to go live'); // a player who leaves during the countdown is not eliminated: the countdown starts over
    a.close();
```

and:

<!-- op {"kind": "edit", "path": "tests/server/integration.test.ts"} -->
```ts
      const roster = await c.waitFor(() => c.messages.find((m): m is RosterMessage => m.t === 'roster'), 4000, 'roster');
      expect(roster.you).toBe(0);
      expect(roster.players.map((q) => Boolean(q.bot))).toEqual([false, true, true, true]);
      await c.waitFor(() => c.messages.find((m) => m.t === 'results'), 6000, 'results');
```

with:

```ts
      // generous budgets: the whole suite runs beside other CPU-heavy suites, and the round itself takes about three seconds
      const roster = await c.waitFor(() => c.messages.find((m): m is RosterMessage => m.t === 'roster'), 10_000, 'roster');
      expect(roster.you).toBe(0);
      expect(roster.players.map((q) => Boolean(q.bot))).toEqual([false, true, true, true]);
      await c.waitFor(() => c.messages.find((m) => m.t === 'results'), 20_000, 'results');
```

and:

<!-- op {"kind": "edit", "path": "tests/server/integration.test.ts"} -->
```ts
      await c.waitFor(() => c.messages.filter((m) => m.t === 'roster').length >= 2, 4000, 'a second round');
```

with:

```ts
      await c.waitFor(() => c.messages.filter((m) => m.t === 'roster').length >= 2, 10_000, 'a second round');
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/server tests/combat.test.ts tests/protocol.test.ts`
Expected: FAIL — the countdown leaver still leaves a car, the empty room still steps, a negative `hp` still parses

<!-- check {"cmd": "npx vitest run tests/server tests/combat.test.ts tests/protocol.test.ts", "outcome": "fail", "match": "FAIL|\u00d7|failed"} -->

- [ ] **Step 3: Change the room**

In `src/server/room.ts` (a `seatedLeft` flag remembers that somebody with a car left during the countdown; a newcomer who leaves again before the world is rebuilt cancels the restart only when nobody else made it necessary; `participants` lose their `key`; an empty room stops):

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
interface Participant {
  key: string;
  player: Player | null;
```

with:

```ts
interface Participant {
  player: Player | null;
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
  private restartPending = false;
  private restarts = 0;
```

with:

```ts
  private restartPending = false;
  /** Set when a player who had a car left during the countdown: the countdown starts over without them. */
  private seatedLeft = false;
  private restarts = 0;
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
    if (this.disposed || this.isFull) return false;
    this.participants.push({ key: `p${player.id}`, player, bot: false, name: player.name, color: player.color, slot: -1, score: 0, kills: 0 });
    player.slot = -1;
```

with:

```ts
    if (this.disposed || this.isFull) return false;
    this.participants.push({ player, bot: false, name: player.name, color: player.color, slot: -1, score: 0, kills: 0 });
    player.slot = -1;
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
    const leaving = this.participants[index]!;
    if (this.state && leaving.slot >= 0 && this.phase !== 'results') {
      const ko = this.state.eliminate(leaving.slot, 'disconnected', this.simTick);
      if (ko) {
        this.broadcast(ko, player);
        this.scoresDirty = true;
      }
```

with:

```ts
    const leaving = this.participants[index]!;
    const hadCar = leaving.slot >= 0;
    if (this.state && hadCar && this.phase !== 'results') {
      if (this.phase === 'countdown' && this.restarts < ROUND.MAX_COUNTDOWN_RESTARTS) {
        // nobody has driven yet: start the countdown over without them, instead of leaving a dead car at a spawn point for the whole round
        this.restartPending = true;
        this.seatedLeft = true;
      } else {
        const ko = this.state.eliminate(leaving.slot, 'disconnected', this.simTick);
        if (ko) {
          this.broadcast(ko, player);
          this.scoresDirty = true;
        }
      }
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
    this.participants.splice(index, 1);
    player.slot = -1;
```

with:

```ts
    this.participants.splice(index, 1);
    // a newcomer who leaves again before the world was rebuilt has not cost anyone a restart
    if (!hadCar && this.restartPending && !this.seatedLeft && !this.humans().some((p) => p.slot < 0)) this.restartPending = false;
    player.slot = -1;
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
    for (const p of humans) if (p.player!.ticksSinceInput > NET.INACTIVE_KICK_TICKS) p.player!.close(4001, 'inactive');
    if (!this.sim) {
```

with:

```ts
    for (const p of humans) if (p.player!.ticksSinceInput > NET.INACTIVE_KICK_TICKS) p.player!.close(4001, 'inactive');
    if (this.sim && humans.length === 0) return; // an empty room stops (whoever owns it will dispose of it); it never plays rounds against itself
    if (!this.sim) {
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
    this.restartPending = false;
    this.restarts = restart ? this.restarts + 1 : 0;
```

with:

```ts
    this.restartPending = false;
    this.seatedLeft = false;
    this.restarts = restart ? this.restarts + 1 : 0;
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
    return {
      key: `b${n}`,
      player: null,
```

with:

```ts
    return {
      player: null,
```

In `src/server/combat.ts`, two methods nobody calls go:

<!-- op {"kind": "edit", "path": "src/server/combat.ts"} -->
```ts

  /** Forgets every open window (the world was rebuilt). */
  reset(): void {
    this.windows.clear();
  }

  private add(tick: number, victim: number, attacker: number, impulse: number, point: Vec3, hits: Hit[], isRunning: (slot: number) => boolean): void {
```

with:

```ts

  private add(tick: number, victim: number, attacker: number, impulse: number, point: Vec3, hits: Hit[], isRunning: (slot: number) => boolean): void {
```

In `src/server/combat.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/combat.ts"} -->
```ts
  }

  reset(): void {
    this.lastHit.clear();
  }
}
```

with:

```ts
  }
}
```

In `src/server/lobby.ts`, `JoinResult` no longer carries a slot (it was always -1; `greeting` says it):

<!-- op {"kind": "edit", "path": "src/server/lobby.ts"} -->
```ts
export type JoinResult = { ok: true; room: Room; slot: number } | { ok: false; code: ErrorCode };
```

with:

```ts
export type JoinResult = { ok: true; room: Room } | { ok: false; code: ErrorCode };
```

In `src/server/lobby.ts`, `JoinResult` no longer carries a slot (it was always -1; `greeting` says it):

<!-- op {"kind": "edit", "path": "src/server/lobby.ts"} -->
```ts
    return room.addPlayer(player) ? { ok: true, room, slot: player.slot } : { ok: false, code: 'room_full' };
```

with:

```ts
    return room.addPlayer(player) ? { ok: true, room } : { ok: false, code: 'room_full' };
```

In `src/shared/protocol.ts`:

<!-- op {"kind": "edit", "path": "src/shared/protocol.ts"} -->
```ts
isSlotOrNone(v.attacker) && isNum(v.dmg) && v.dmg >= 0 && isNum(v.hp) &&

```

with:

```ts
isSlotOrNone(v.attacker) && isNum(v.dmg) && v.dmg >= 0 && isNum(v.hp) && v.hp >= 0 &&

```

- [ ] **Step 4: Run the tests, then the whole suite**

Run: `npx vitest run tests/server tests/combat.test.ts tests/protocol.test.ts`
Expected: all pass

<!-- check {"cmd": "npx vitest run tests/server tests/combat.test.ts tests/protocol.test.ts", "outcome": "pass"} -->

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 619} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix(server): a countdown leaver no longer leaves a dead car, an empty room stops, a negative hit hp is malformed, vestigial code removed"
```

<!-- commit "fix(server): a countdown leaver no longer leaves a dead car, an empty room stops, a negative hit hp is malformed, vestigial code removed" -->

---

### Task 49: The settings model: presets, saved settings, the automatic step down

**Files:**
- Create: `src/client/settings.ts`, `tests/client/settings.test.ts`

**Interfaces:**
- Consumes: `clamp` (Plan 1).
- Produces: `Quality` (`'low' | 'medium' | 'high'`), `QUALITIES`, `QUALITY` (a `QualityProfile` per preset: `pixelRatio`, `msaa`, `shadows`, `shadowMapSize`, `bloom`, `crowd`, `particles`, `debris`), `Settings` (`quality`, `volume`, `muted`), `DEFAULT_SETTINGS`, `loadSettings(storage)`, `saveSettings(storage, settings)`, `lowerQuality(q)`, `nextQuality(q)`, `AutoQuality` (`frame(dt)` says true once when the game should step down; `reset()`).

- [ ] **Step 1: Write the tests**

The model is pure (storage and the clock are parameters), so everything is tested in Node: the presets get cheaper step by step, saved settings are repaired one field at a time (and storage that is missing, corrupt or throws is survived), and `AutoQuality` asks for a step down only after the warm-up and two slow windows in a row, forgives a slow patch that does not last and a hidden tab, and starts over after a change.

Create `tests/client/settings.test.ts`:

<!-- op {"kind": "create", "path": "tests/client/settings.test.ts"} -->
```ts
import { describe, expect, it } from 'vitest';
import { AutoQuality, DEFAULT_SETTINGS, QUALITIES, QUALITY, loadSettings, lowerQuality, nextQuality, saveSettings, type Settings } from '../../src/client/settings';

const memory = (initial?: string) => {
  const data = new Map<string, string>(initial === undefined ? [] : [['wreckyard.settings', initial]]);
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};

describe('QUALITY presets', () => {
  it('get cheaper step by step: every number of a lower preset is no bigger, and every switch is no more on', () => {
    for (let i = 1; i < QUALITIES.length; i++) {
      const lower = QUALITY[QUALITIES[i - 1]!];
      const higher = QUALITY[QUALITIES[i]!];
      expect(lower.pixelRatio).toBeLessThanOrEqual(higher.pixelRatio);
      expect(lower.msaa).toBeLessThanOrEqual(higher.msaa);
      expect(lower.shadowMapSize).toBeLessThanOrEqual(higher.shadowMapSize);
      expect(lower.particles).toBeLessThanOrEqual(higher.particles);
      expect(lower.debris).toBeLessThanOrEqual(higher.debris);
      for (const key of ['shadows', 'bloom', 'crowd'] as const) expect(Number(lower[key])).toBeLessThanOrEqual(Number(higher[key]));
    }
    expect(QUALITY.low.pixelRatio).toBeGreaterThanOrEqual(1);
    expect(QUALITY.low.particles).toBeGreaterThan(0); // low still shows something
  });
});

describe('QUALITY antialiasing', () => {
  it('multisamples the scene at four samples on High, two on Medium, and on Low draws it straight to the screen with none', () => {
    expect(QUALITY.high.msaa).toBe(4);
    expect(QUALITY.medium.msaa).toBe(2);
    expect(QUALITY.low.msaa).toBe(0);
  });
});

describe('loadSettings and saveSettings', () => {
  it('give the defaults when nothing is saved, and when there is no storage at all', () => {
    expect(loadSettings(memory())).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('remember what was saved', () => {
    const store = memory();
    const chosen: Settings = { quality: 'low', volume: 0.25, muted: true };
    saveSettings(store, chosen);
    expect(loadSettings(store)).toEqual(chosen);
  });

  it('repair a damaged or hostile entry one field at a time instead of failing', () => {
    expect(loadSettings(memory('{not json'))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(memory('null'))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(memory(JSON.stringify({ quality: 'ultra', volume: 7, muted: 'yes' })))).toEqual({ quality: 'high', volume: 1, muted: false });
    expect(loadSettings(memory(JSON.stringify({ quality: 'medium', volume: -3 })))).toEqual({ quality: 'medium', volume: 0, muted: false });
    expect(loadSettings(memory(JSON.stringify({ volume: Number.NaN, quality: 'low' }))).quality).toBe('low');
  });

  it('survive storage that throws (private browsing, quota)', () => {
    const angry = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
    expect(loadSettings(angry)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(angry, DEFAULT_SETTINGS)).not.toThrow();
  });
});

describe('lowerQuality and nextQuality', () => {
  it('step down to the bottom and stop, and cycle round for the G key', () => {
    expect(lowerQuality('high')).toBe('medium');
    expect(lowerQuality('medium')).toBe('low');
    expect(lowerQuality('low')).toBeNull();
    expect([nextQuality('low'), nextQuality('medium'), nextQuality('high')]).toEqual(['medium', 'high', 'low']);
  });
});

describe('AutoQuality', () => {
  const run = (auto: AutoQuality, fps: number, seconds: number): number => {
    let downgrades = 0;
    const dt = 1 / fps;
    for (let t = 0; t < seconds; t += dt) if (auto.frame(dt)) downgrades++;
    return downgrades;
  };

  it('never asks for anything while the game runs at a steady 60 frames a second', () => {
    expect(run(new AutoQuality(), 60, 60)).toBe(0);
  });

  it('asks once for a step down after two slow windows, when the frame rate stays at 25', () => {
    expect(run(new AutoQuality(), 25, 30)).toBeGreaterThanOrEqual(1);
    const auto = new AutoQuality({ warmupSeconds: 0 });
    let first = -1;
    let elapsed = 0;
    for (let i = 0; i < 25 * 30 && first < 0; i++) {
      elapsed += 1 / 25;
      if (auto.frame(1 / 25)) first = elapsed;
    }
    expect(first).toBeGreaterThan(5.9); // two windows of three seconds
    expect(first).toBeLessThan(6.2);
  });

  it('does not count the warm-up: slow frames while things load are not held against the game', () => {
    const auto = new AutoQuality({ warmupSeconds: 5 });
    expect(run(auto, 10, 5)).toBe(0); // the warm-up itself, very slow
    expect(run(auto, 60, 30)).toBe(0); // then fine
  });

  it('gives a slow patch that does not last a chance to recover, and forgives a hidden tab', () => {
    const auto = new AutoQuality({ warmupSeconds: 0 });
    expect(run(auto, 20, 3.5)).toBe(0); // one slow window
    expect(run(auto, 60, 6)).toBe(0); // a good one wipes it
    expect(run(auto, 20, 3.5)).toBe(0);
    expect(auto.frame(30)).toBe(false); // the tab was hidden for half a minute: one huge frame
    expect(run(auto, 20, 3.5)).toBe(0); // the count started over
  });

  it('starts over with its own short warm-up after a change (reset)', () => {
    const auto = new AutoQuality({ warmupSeconds: 0 });
    expect(run(auto, 20, 7)).toBeGreaterThanOrEqual(1);
    auto.reset();
    expect(run(auto, 20, 2)).toBe(0); // the warm-up after a change
    expect(run(auto, 20, 8)).toBeGreaterThanOrEqual(1); // still slow: asks again
  });

  it('ignores broken frame times', () => {
    const auto = new AutoQuality({ warmupSeconds: 0 });
    for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(auto.frame(dt)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/client/settings.test.ts`
Expected: FAIL — `src/client/settings` does not exist

<!-- check {"cmd": "npx vitest run tests/client/settings.test.ts", "outcome": "fail", "match": "Cannot find module|FAIL|not a function|Failed"} -->

- [ ] **Step 3: Write the model**

Create `src/client/settings.ts`:

<!-- op {"kind": "create", "path": "src/client/settings.ts"} -->
```ts
import { clamp } from '../shared/math';

export type Quality = 'low' | 'medium' | 'high';
export const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];

/** What a graphics preset changes. */
export interface QualityProfile {
  /** Highest device pixel ratio the game draws at (a 2x screen at 1.5 draws 44 % fewer pixels). */
  pixelRatio: number;
  /** Samples per pixel of the buffer the scene is drawn into; 0 (with no glow) draws straight to the screen, whose own antialiasing applies. */
  msaa: number;
  /** Whether the floodlight casts shadows, and how sharp they are. */
  shadows: boolean;
  shadowMapSize: number;
  /** The glow around lamps, headlights and sparks. */
  bloom: boolean;
  /** The crowd in the stands. */
  crowd: boolean;
  /** Multiplies how many particles the effects emit (0 to 1). */
  particles: number;
  /** Pieces of debris alive at once. */
  debris: number;
}

export const QUALITY: Readonly<Record<Quality, QualityProfile>> = {
  high: { pixelRatio: 2, msaa: 4, shadows: true, shadowMapSize: 2048, bloom: true, crowd: true, particles: 1, debris: 40 },
  medium: { pixelRatio: 1.5, msaa: 2, shadows: true, shadowMapSize: 1024, bloom: true, crowd: true, particles: 0.6, debris: 24 },
  low: { pixelRatio: 1, msaa: 0, shadows: false, shadowMapSize: 512, bloom: false, crowd: false, particles: 0.3, debris: 12 },
};

/** What the player chose: kept in the browser's storage between visits. */
export interface Settings {
  quality: Quality;
  /** Sound level, 0 to 1. */
  volume: number;
  muted: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = { quality: 'high', volume: 1, muted: false };

const KEY = 'wreckyard.settings';

/** The saved settings; anything missing, damaged or out of range falls back to the defaults, and storage may be absent or throw. */
export function loadSettings(storage: Pick<Storage, 'getItem'> | null | undefined): Settings {
  try {
    const raw = storage?.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Settings> | null;
      return {
        quality: QUALITIES.includes(p?.quality as Quality) ? (p!.quality as Quality) : DEFAULT_SETTINGS.quality,
        volume: typeof p?.volume === 'number' && Number.isFinite(p.volume) ? clamp(p.volume, 0, 1) : DEFAULT_SETTINGS.volume,
        muted: typeof p?.muted === 'boolean' ? p.muted : DEFAULT_SETTINGS.muted,
      };
    }
  } catch {
    /* storage unavailable or corrupt: the defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(storage: Pick<Storage, 'setItem'> | null | undefined, settings: Settings): void {
  try {
    storage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode or full: not fatal */
  }
}

/** The next preset down, or null at the bottom. */
export function lowerQuality(q: Quality): Quality | null {
  const i = QUALITIES.indexOf(q);
  return i > 0 ? QUALITIES[i - 1]! : null;
}

/** The next preset in the cycle low, medium, high, low: what the G key does. */
export function nextQuality(q: Quality): Quality {
  return QUALITIES[(QUALITIES.indexOf(q) + 1) % QUALITIES.length]!;
}

export interface AutoQualityOptions {
  /** Seconds at the start (and after a change) that are not counted: loading and shader compilation make the first frames slow. */
  warmupSeconds: number;
  /** Length of one measuring window in seconds. */
  windowSeconds: number;
  /** A window that averages fewer frames a second than this is a slow one. */
  minFps: number;
  /** Slow windows in a row before the quality is lowered. */
  windows: number;
}

/**
 * Watches frame times and says when to drop one quality level: after `windows` slow measuring windows in a row, once the warm-up is
 * over. A frame longer than half a second (a hidden tab, a stall) is not held against the game and restarts the window.
 * It only ever asks for a step down; going back up is the player's choice, so it cannot flap.
 */
export class AutoQuality {
  private readonly options: AutoQualityOptions;
  private warmup: number;
  private time = 0;
  private frames = 0;
  private slow = 0;

  constructor(options: Partial<AutoQualityOptions> = {}) {
    this.options = { warmupSeconds: 5, windowSeconds: 3, minFps: 40, windows: 2, ...options };
    this.warmup = this.options.warmupSeconds;
  }

  /** Feed the duration of every frame (seconds). True means: lower the quality one step now. */
  frame(dt: number): boolean {
    if (!Number.isFinite(dt) || dt <= 0) return false;
    if (dt > 0.5) {
      this.time = 0;
      this.frames = 0;
      this.slow = 0;
      return false;
    }
    if (this.warmup > 0) {
      this.warmup -= dt;
      return false;
    }
    this.time += dt;
    this.frames++;
    if (this.time < this.options.windowSeconds) return false;
    const fps = this.frames / this.time;
    this.time = 0;
    this.frames = 0;
    this.slow = fps < this.options.minFps ? this.slow + 1 : 0;
    if (this.slow < this.options.windows) return false;
    this.reset();
    return true;
  }

  /** Starts over (after the quality changed): the new setting gets its own warm-up and its own windows. */
  reset(): void {
    this.warmup = Math.min(this.options.warmupSeconds, 2);
    this.time = 0;
    this.frames = 0;
    this.slow = 0;
  }
}
```

- [ ] **Step 4: Run the test, then the whole suite**

Run: `npx vitest run tests/client/settings.test.ts`
Expected: passes

<!-- check {"cmd": "npx vitest run tests/client/settings.test.ts", "outcome": "pass"} -->

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 632} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(client): the settings model \u2014 graphics presets, saved settings and an automatic step down that never steps up"
```

<!-- commit "feat(client): the settings model \u2014 graphics presets, saved settings and an automatic step down that never steps up" -->

---

### Task 50: The presets applied: settings panel, G key, antialiasing per preset, automatic step down

**Files:**
- Modify: `src/client/game/scene.ts`, `composer.ts`, `dressing.ts`, `debris.ts`, `audio.ts`, `fx.ts`, `gameClient.ts`, `src/client/main.ts`, `src/client/ui/menu.ts`, `src/client/index.html`, `tests/client/fx.test.ts`, `tests/client/debris.test.ts`, `tests/client/audio.test.ts`, `tests/client/dressing.test.ts`, `tests/client/composer.test.ts`

**Interfaces:**
- Consumes: `QUALITY`, `Settings`, `loadSettings`, `saveSettings`, `lowerQuality`, `nextQuality`, `AutoQuality` (Task 49); `GameScene.setBloom`, `createComposerTarget` (Plan 6).
- Produces: `GameScene.applyQuality(profile)`; `needsComposer(glow, samples)`; `Dressing.setCrowd(visible)`; `DebrisSystem.setLimit(n)`; `AudioEngine.setVolume(v)`; `FxDirector.setDensity(particles, debris)`; `GameClientOptions.settings` and `onSettings`; `MenuOptions.settings` and `onSettings`; the `G` key and the automatic step down in the game.

- [ ] **Step 1: Write the tests**

What can be tested in Node is: the particle density (thinned to the density on average, smoke and dust too, the debris limit passed on, a broken density tolerated), the debris limit (the oldest pieces go when it drops, zero and non-finite values are handled), the volume (scales the master level before and after unlock, mute stays in charge), the crowd switch (hides the crowd and nothing else) and `needsComposer` (the scene goes through the composer for the glow or for multisampling and straight to the screen for neither). The WebGL and DOM wiring is checked in a browser in the last step.

In `tests/client/fx.test.ts`:

<!-- op {"kind": "edit", "path": "tests/client/fx.test.ts"} -->
```ts

describe('FxDirector smoke, fire and wrecks', () => {
```

with:

```ts

describe('FxDirector density (the graphics preset)', () => {
  const sparksFor = (density: number): number => {
    const t = setup();
    t.fx.setDensity(density, 40);
    for (let i = 0; i < 20; i++) t.fx.onLocalImpacts([impact(12)], t.frameArgs());
    return t.sparks();
  };

  it('thins the particles to the density, on average, and can switch them off', () => {
    const all = sparksFor(1);
    const some = sparksFor(0.3);
    expect(all).toBeGreaterThan(200);
    expect(some).toBeGreaterThan(all * 0.15);
    expect(some).toBeLessThan(all * 0.45);
    expect(sparksFor(0)).toBe(0);
  });

  it('thins smoke and dust too, and passes the debris limit on', () => {
    const t = setup();
    t.fx.setDensity(0.2, 2);
    t.setPoses([pose(0), pose(1, { hp: 20 }), pose(2, { linvel: { x: 14, y: 0, z: 0 } })]);
    t.frames(1.5);
    const thin = t.fx.particles.alive('smoke') + t.fx.particles.alive('dust');
    const full = setup();
    full.setPoses([pose(0), pose(1, { hp: 20 }), pose(2, { linvel: { x: 14, y: 0, z: 0 } })]);
    full.frames(1.5);
    expect(thin).toBeLessThan((full.fx.particles.alive('smoke') + full.fx.particles.alive('dust')) * 0.5);
    for (let i = 0; i < 6; i++) t.fx.onHit(hit({ dmg: 30, tick: i, victim: i % 2 ? 1 : 2, zone: (['front', 'rear', 'left', 'right'] as const)[i % 4]! }), t.frameArgs());
    expect(t.fx.debris.active).toBeLessThanOrEqual(2);
  });

  it('copes with a broken density', () => {
    const t = setup();
    t.fx.setDensity(Number.NaN, Number.NaN);
    t.fx.onLocalImpacts([impact(12)], t.frameArgs());
    expect(t.sparks()).toBeGreaterThan(10);
  });
});

describe('FxDirector smoke, fire and wrecks', () => {
```

In `tests/client/debris.test.ts`:

<!-- op {"kind": "edit", "path": "tests/client/debris.test.ts"} -->
```ts

  it('survives absurd frame times and clears everything on request', () => {
```

with:

```ts

  it('keeps at most the number of pieces it is allowed, taking the oldest away when the limit drops', () => {
    const system = new DebrisSystem(mulberry32(5));
    for (let i = 0; i < 10; i++) {
      system.spawn(part({ position: { x: i, y: 5, z: 0 } }), { x: 0, y: 0, z: 0 });
      system.update(0.05);
    }
    expect(system.active).toBe(10);
    system.setLimit(4);
    expect(system.active).toBe(4);
    const xs = system.object.children.filter((c) => c.visible).map((c) => c.position.x);
    expect(xs.every((x) => x > 4)).toBe(true); // the four newest are left: the ones thrown last
    for (let i = 0; i < 6; i++) system.spawn(part({ position: { x: 100 + i, y: 5, z: 0 } }), { x: 0, y: 0, z: 0 });
    expect(system.active).toBe(4); // new parts replace the oldest instead of adding
    system.setLimit(0);
    system.spawn(part(), { x: 0, y: 0, z: 0 });
    expect(system.active).toBe(0);
    system.setLimit(Number.NaN);
    system.setLimit(1000);
    for (let i = 0; i < DEBRIS.MAX + 5; i++) system.spawn(part(), { x: 0, y: 0, z: 0 });
    expect(system.active).toBe(DEBRIS.MAX); // never more than the pool
    system.dispose();
  });

  it('survives absurd frame times and clears everything on request', () => {
```

In `tests/client/audio.test.ts`:

<!-- op {"kind": "edit", "path": "tests/client/audio.test.ts"} -->
```ts

  it('mutes and unmutes', () => {
```

with:

```ts

  it('scales the master level with the volume setting, before and after it is unlocked, and keeps mute in charge', () => {
    const ctx = new FakeContext();
    const audio = engineWith(ctx);
    audio.setVolume(0.5); // set before there is a context: applied when it is made
    audio.unlock();
    const master = ctx.nodes[0]!;
    const full = master.gain.value * 2;
    expect(full).toBeGreaterThan(0.3);
    audio.setVolume(0.25);
    expect(master.gain.value).toBeCloseTo(full * 0.25, 9);
    audio.setMuted(true);
    expect(master.gain.value).toBe(0);
    audio.setVolume(1);
    expect(master.gain.value).toBe(0); // still muted
    audio.setMuted(false);
    expect(master.gain.value).toBeCloseTo(full, 9);
    audio.setVolume(Number.NaN);
    audio.setVolume(7);
    expect(master.gain.value).toBeCloseTo(full, 9); // clamped to 1
    audio.setVolume(-1);
    expect(master.gain.value).toBe(0);
  });

  it('mutes and unmutes', () => {
```

In `tests/client/dressing.test.ts`:

<!-- op {"kind": "edit", "path": "tests/client/dressing.test.ts"} -->
```ts

describe('createDressing', () => {
```

with:

```ts

describe('the crowd switch', () => {
  it('hides and shows the crowd and nothing else', () => {
    const dressing = createDressing();
    const instanced = dressing.group.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh);
    const crowdMesh = instanced.find((m) => m.count === crowd().length)!;
    const tyres = instanced.find((m) => m !== crowdMesh)!;
    dressing.setCrowd(false);
    expect([crowdMesh.visible, tyres.visible]).toEqual([false, true]);
    dressing.setCrowd(true);
    expect(crowdMesh.visible).toBe(true);
    dressing.dispose();
  });
});

describe('createDressing', () => {
```

In `tests/client/composer.test.ts`:

<!-- op {"kind": "edit", "path": "tests/client/composer.test.ts"} -->
```ts
import { describe, expect, it } from 'vitest';
import { COMPOSER_SAMPLES, createComposerTarget } from '../../src/client/game/composer';

```

with:

```ts
import { describe, expect, it } from 'vitest';
import { COMPOSER_SAMPLES, createComposerTarget, needsComposer } from '../../src/client/game/composer';

```

In `tests/client/composer.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/composer.test.ts"} -->
```ts
  });
});

```

with:

```ts
  });
});

describe('needsComposer', () => {
  it('sends the scene through the composer for the glow or for multisampling, and straight to the screen for neither', () => {
    expect(needsComposer(true, 4)).toBe(true);
    expect(needsComposer(true, 0)).toBe(true); // the glow alone still needs the buffer
    expect(needsComposer(false, 2)).toBe(true); // so does antialiasing with the glow off (?bloom=0 on High)
    expect(needsComposer(false, 0)).toBe(false); // Low: the screen's own antialiasing applies
  });
});

```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/client/fx.test.ts tests/client/debris.test.ts tests/client/audio.test.ts tests/client/dressing.test.ts tests/client/composer.test.ts`
Expected: FAIL — none of the new methods exist

<!-- check {"cmd": "npx vitest run tests/client/fx.test.ts tests/client/debris.test.ts tests/client/audio.test.ts tests/client/dressing.test.ts tests/client/composer.test.ts", "outcome": "fail", "match": "FAIL|\u00d7|not a function"} -->

- [ ] **Step 3: Apply the presets**

In `src/client/game/debris.ts` (`setLimit`; `oldest()` looks only at pieces that are flying):

<!-- op {"kind": "edit", "path": "src/client/game/debris.ts"} -->
```ts
  private readonly pieces: Piece[] = [];
  private cursor = 0;

```

with:

```ts
  private readonly pieces: Piece[] = [];
  private limit: number = DEBRIS.MAX;

```

In `src/client/game/debris.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/debris.ts"} -->
```ts

  /** Sends a part flying: it keeps the speed of the car it came off and is thrown away from it and upwards. */
```

with:

```ts

  /** The most pieces alive at once (at most DEBRIS.MAX): lowering it takes the oldest pieces away at once. */
  setLimit(limit: number): void {
    this.limit = Math.max(0, Math.min(DEBRIS.MAX, Math.floor(Number.isFinite(limit) ? limit : DEBRIS.MAX)));
    while (this.active > this.limit) {
      const old = this.oldest();
      old.active = false;
      old.mesh.visible = false;
    }
  }

  /** Sends a part flying: it keeps the speed of the car it came off and is thrown away from it and upwards. */
```

In `src/client/game/debris.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/debris.ts"} -->
```ts
  spawn(part: DetachedPart, carVelocity: Vec3): void {
    const piece = this.pieces.find((p) => !p.active) ?? this.oldest();
    const r = this.random;
```

with:

```ts
  spawn(part: DetachedPart, carVelocity: Vec3): void {
    if (this.limit === 0) return;
    const piece = (this.active < this.limit ? this.pieces.find((p) => !p.active) : undefined) ?? this.oldest();
    const r = this.random;
```

In `src/client/game/debris.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/debris.ts"} -->
```ts

  private oldest(): Piece {
```

with:

```ts

  /** The active piece that has been flying longest. */
  private oldest(): Piece {
```

In `src/client/game/debris.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/debris.ts"} -->
```ts
  private oldest(): Piece {
    return this.pieces.reduce((a, b) => (b.body.age > a.body.age ? b : a));
  }
```

with:

```ts
  private oldest(): Piece {
    return this.pieces.filter((p) => p.active).reduce((a, b) => (b.body.age > a.body.age ? b : a));
  }
```

In `src/client/game/audio.ts` (`setVolume`):

<!-- op {"kind": "edit", "path": "src/client/game/audio.ts"} -->
```ts
  private silenced = false;

```

with:

```ts
  private silenced = false;
  private level = 1;

```

In `src/client/game/audio.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/audio.ts"} -->
```ts
      this.master = created.createGain();
      this.master.gain.value = this.silenced ? 0 : MASTER_LEVEL;
      this.master.connect(created.destination);
```

with:

```ts
      this.master = created.createGain();
      this.master.gain.value = this.silenced ? 0 : MASTER_LEVEL * this.level;
      this.master.connect(created.destination);
```

In `src/client/game/audio.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/audio.ts"} -->
```ts
    this.silenced = muted;
    if (this.master && this.context) this.master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL, this.context.currentTime, 0.02);
  }
```

with:

```ts
    this.silenced = muted;
    this.applyLevel();
  }

  /** Sound level, 0 to 1 (the player's setting): scales the master level. */
  setVolume(volume: number): void {
    this.level = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;
    this.applyLevel();
  }

  private applyLevel(): void {
    if (this.master && this.context) this.master.gain.setTargetAtTime(this.silenced ? 0 : MASTER_LEVEL * this.level, this.context.currentTime, 0.02);
  }
```

In `src/client/game/dressing.ts` (`setCrowd`):

<!-- op {"kind": "edit", "path": "src/client/game/dressing.ts"} -->
```ts
  readonly group: THREE.Group;
  dispose(): void;
```

with:

```ts
  readonly group: THREE.Group;
  /** Shows or hides the crowd (the low graphics preset draws the stands empty). */
  setCrowd(visible: boolean): void;
  dispose(): void;
```

In `src/client/game/dressing.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/dressing.ts"} -->
```ts
    group,
    dispose() {
```

with:

```ts
    group,
    setCrowd(visible) {
      crowdMesh.visible = visible;
    },
    dispose() {
```

In `src/client/game/fx.ts` (`setDensity`; every emission goes through `thin`, and the continuous ones through the density):

<!-- op {"kind": "edit", "path": "src/client/game/fx.ts"} -->
```ts
  private now = 0;

```

with:

```ts
  private now = 0;
  /** Multiplies how many particles are emitted (the graphics preset). */
  private density = 1;

```

In `src/client/game/fx.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/fx.ts"} -->
```ts

  // ---- what happens -----------------------------------------------------------------------------
```

with:

```ts

  /** Sets how many particles the effects emit (1 = all, 0.3 = under a third) and how many pieces of debris may lie around. */
  setDensity(particles: number, debris: number): void {
    this.density = Number.isFinite(particles) ? clamp(particles, 0, 1) : 1;
    this.debris.setLimit(debris);
  }

  /** `count` particles thinned by the density, rounded up or down at random so that the average is right. */
  private thin(count: number): number {
    const k = count * this.density;
    const whole = Math.floor(k);
    return whole + (this.random() < k - whole ? 1 : 0);
  }

  // ---- what happens -----------------------------------------------------------------------------
```

In `src/client/game/fx.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/fx.ts"} -->
```ts
    const at = worldPoint(pose, { x: 0.6, y: 0.5, z: 0 });
    for (let i = 0; i < 14; i++) this.puff('fire', at, 2.5, 1.2 + this.random() * 0.8, 0.5 + this.random() * 0.5);
    for (let i = 0; i < 10; i++) this.puff('smoke', at, 1.8, 2 + this.random() * 1.5, 0.9 + this.random() * 0.6);
    this.options.audio.crash(25, at, frame.listener);
```

with:

```ts
    const at = worldPoint(pose, { x: 0.6, y: 0.5, z: 0 });
    for (let i = this.thin(14); i > 0; i--) this.puff('fire', at, 2.5, 1.2 + this.random() * 0.8, 0.5 + this.random() * 0.5);
    for (let i = this.thin(10); i > 0; i--) this.puff('smoke', at, 1.8, 2 + this.random() * 1.5, 0.9 + this.random() * 0.6);
    this.options.audio.crash(25, at, frame.listener);
```

In `src/client/game/fx.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/fx.ts"} -->
```ts
    if (sparks) this.sparks(at, carVelocity, clamp(Math.round(kns * 3), 4, 40));
    for (let i = 0; i < 4; i++) this.puff('dust', at, 2, 0.8 + this.random() * 0.6, 0.6 + this.random() * 0.5);
    this.shake.add(traumaForImpact(kns, distance));
```

with:

```ts
    if (sparks) this.sparks(at, carVelocity, clamp(Math.round(kns * 3), 4, 40));
    for (let i = this.thin(4); i > 0; i--) this.puff('dust', at, 2, 0.8 + this.random() * 0.6, 0.6 + this.random() * 0.5);
    this.shake.add(traumaForImpact(kns, distance));
```

In `src/client/game/fx.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/fx.ts"} -->
```ts
  private sparks(at: Vec3, carVelocity: Vec3, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = this.random() * Math.PI * 2;
```

with:

```ts
  private sparks(at: Vec3, carVelocity: Vec3, count: number): void {
    for (let i = this.thin(count); i > 0; i--) {
      const a = this.random() * Math.PI * 2;
```

In `src/client/game/fx.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/fx.ts"} -->
```ts
    const r = this.rate(slot);
    r[key] += perSecond * dt;
    const n = Math.floor(r[key]);
```

with:

```ts
    const r = this.rate(slot);
    r[key] += perSecond * this.density * dt;
    const n = Math.floor(r[key]);
```

In `src/client/game/composer.ts`:

<!-- op {"kind": "edit", "path": "src/client/game/composer.ts"} -->
```ts
}

```

with:

```ts
}

/**
 * Whether the scene goes through the effect composer (a high-range buffer, multisampled, with the glow added on top) or straight to
 * the screen. Straight is the cheap way: with neither the glow nor multisampling asked for, the screen's own antialiasing applies.
 */
export const needsComposer = (glow: boolean, samples: number): boolean => glow || samples > 0;

```

In `src/client/game/scene.ts` (`applyQuality`: pixel ratio, shadows and their map size, glow, the composer's sample count, crowd; `setBloom` becomes "forced off" so a preset can never turn on a glow that `?bloom=0` switched off; Low draws straight to the screen):

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
import { ARENA } from '../../shared/constants';
import { createComposerTarget } from './composer';
import { createDressing } from './dressing';
```

with:

```ts
import { ARENA } from '../../shared/constants';
import type { QualityProfile } from '../settings';
import { COMPOSER_SAMPLES, createComposerTarget, needsComposer } from './composer';
import { createDressing } from './dressing';
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
  resize(): void;
  /** Draws the scene through the bloom pass (things brighter than the sky glow: lamps, headlights, sparks, fire). */
  render(): void;
```

with:

```ts
  resize(): void;
  /** Draws the scene through the bloom pass (things brighter than the sky glow: lamps, headlights, sparks, fire), or straight to the screen on Low. */
  render(): void;
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
  render(): void;
  /** Turns the glow on or off (it is the most expensive part of a frame on a weak GPU). */
  setBloom(enabled: boolean): void;
```

with:

```ts
  render(): void;
  /**
   * Switches the glow off for good (`?bloom=0`; it is the most expensive part of a frame on a weak GPU) or lets the graphics presets
   * decide again. A preset can never turn on a glow that was switched off here.
   */
  setBloom(enabled: boolean): void;
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
  setBloom(enabled: boolean): void;
  /** Samples per pixel of the buffer the scene is drawn into (0 = not multisampled); `window.__derby.debug()` reports it. */
  antialiasSamples(): number;
```

with:

```ts
  setBloom(enabled: boolean): void;
  /** Samples per pixel the scene is antialiased with (the composer's buffer, or the screen's own on Low); `window.__derby.debug()` reports it. */
  antialiasSamples(): number;
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
  antialiasSamples(): number;
  dispose(): void;
```

with:

```ts
  antialiasSamples(): number;
  /** Applies a graphics preset: pixel ratio, shadows, glow and crowd. */
  applyQuality(profile: QualityProfile): void;
  dispose(): void;
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
```

with:

```ts
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  let pixelCap = 2; // the highest device pixel ratio the game draws at (a graphics preset lowers it)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelCap));
  renderer.shadowMap.enabled = true;
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
  // name tags, which are plain white, stay crisp.
  const composer = new EffectComposer(renderer, createComposerTarget());
```

with:

```ts
  // name tags, which are plain white, stay crisp.
  let bloomWanted = true; // what the graphics preset asks for
  let bloomForcedOff = false; // what ?bloom=0 asks for
  const composer = new EffectComposer(renderer, createComposerTarget());
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
  const composer = new EffectComposer(renderer, createComposerTarget());
  composer.addPass(new RenderPass(scene, camera));
```

with:

```ts
  const composer = new EffectComposer(renderer, createComposerTarget());
  let msaa = COMPOSER_SAMPLES; // samples of the composer's buffers (a graphics preset sets it)
  const setSamples = (samples: number): void => {
    msaa = samples;
    for (const target of [composer.renderTarget1, composer.renderTarget2]) {
      if (target.samples !== samples) {
        target.samples = samples;
        target.dispose(); // the buffer is built again with the new sample count on the next frame
      }
    }
  };
  composer.addPass(new RenderPass(scene, camera));
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
    if (w === 0 || h === 0) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    if (needsResize(canvas.width, canvas.height, w, h, dpr)) {
```

with:

```ts
    if (w === 0 || h === 0) return;
    const dpr = Math.min(window.devicePixelRatio, pixelCap);
    if (needsResize(canvas.width, canvas.height, w, h, dpr)) {
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
      renderer.info.reset();
      composer.render();
    },
```

with:

```ts
      renderer.info.reset();
      if (needsComposer(bloom.enabled, msaa)) composer.render();
      else renderer.render(scene, camera); // Low: no glow, no multisampled buffer, so the screen's own antialiasing applies
    },
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
    setBloom: (enabled) => {
      bloom.enabled = enabled;
    },
```

with:

```ts
    setBloom: (enabled) => {
      bloomForcedOff = !enabled;
      bloom.enabled = enabled && bloomWanted;
    },
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
    },
    antialiasSamples: () => composer.renderTarget1.samples,
    dispose: () => {
```

with:

```ts
    },
    applyQuality: (profile) => {
      pixelCap = profile.pixelRatio;
      sun.castShadow = profile.shadows;
      if (sun.shadow.mapSize.x !== profile.shadowMapSize) {
        sun.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
        sun.shadow.map?.dispose(); // the shadow map is rebuilt at the new size on the next frame
        sun.shadow.map = null;
      }
      setSamples(profile.msaa);
      bloomWanted = profile.bloom;
      bloom.enabled = bloomWanted && !bloomForcedOff;
      dressing.setCrowd(profile.crowd);
    },
    antialiasSamples: () => {
      if (needsComposer(bloom.enabled, msaa)) return composer.renderTarget1.samples;
      const gl = renderer.getContext();
      return gl.getParameter(gl.SAMPLES) as number;
    },
    dispose: () => {
```

In `src/client/game/gameClient.ts` (the settings come in with the options; `M` and the new `G` key save them; the game watches its own frame times and steps down once):

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
import { ClientSession, type DrawPose, type NetMode } from '../net/session';
import type { Hud } from '../ui/hud';
```

with:

```ts
import { ClientSession, type DrawPose, type NetMode } from '../net/session';
import { AutoQuality, QUALITY, lowerQuality, nextQuality, type Quality, type Settings } from '../settings';
import type { Hud } from '../ui/hud';
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
  lag?: LagOptions | null;
}
```

with:

```ts
  lag?: LagOptions | null;
  /** The player's settings, and what to do when the game changes them (the G key, an automatic step down, M). */
  settings: Settings;
  onSettings(settings: Settings): void;
}
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
  private readonly drawingSize = new THREE.Vector2();
  private readonly stepper = new FixedStepper(PHYSICS.DT);
```

with:

```ts
  private readonly drawingSize = new THREE.Vector2();
  private readonly auto = new AutoQuality();
  private settings: Settings;
  private readonly stepper = new FixedStepper(PHYSICS.DT);
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
  constructor(private readonly opts: GameClientOptions) {
    this.session = new ClientSession(opts.net ?? 'predict', {
```

with:

```ts
  constructor(private readonly opts: GameClientOptions) {
    this.settings = { ...opts.settings };
    this.session = new ClientSession(opts.net ?? 'predict', {
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
    });
    const lag = opts.lag ?? null;
```

with:

```ts
    });
    this.audio.setVolume(this.settings.volume);
    this.audio.setMuted(this.settings.muted);
    this.applyQuality(this.settings.quality);
    const lag = opts.lag ?? null;
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts

  /** Where sound is heard from: the car you drive or watch, or the camera when there is none. */
```

with:

```ts

  /** Puts a graphics preset in force (scene, effects) and remembers it. */
  private applyQuality(quality: Quality): void {
    const profile = QUALITY[quality];
    this.settings = { ...this.settings, quality };
    this.opts.gs.applyQuality(profile);
    this.fx.setDensity(profile.particles, profile.debris);
    this.opts.onSettings(this.settings);
    this.auto.reset(); // the new setting gets its own warm-up before it is judged
  }

  /** Where sound is heard from: the car you drive or watch, or the camera when there is none. */
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts

  /** F3 shows the network line, H sounds the horn, M mutes; while you are out, the cycle keys pick the next car to watch. */
  private onKey(code: string): void {
```

with:

```ts

  /** F3 shows the network line, H sounds the horn, M mutes, G changes the graphics; while you are out, the cycle keys pick the next car to watch. */
  private onKey(code: string): void {
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
      this.audio.setMuted(!this.audio.muted);
      this.opts.hud.showNotice(this.audio.muted ? 'Sound off (M)' : 'Sound on (M)');
```

with:

```ts
      this.audio.setMuted(!this.audio.muted);
      this.settings = { ...this.settings, muted: this.audio.muted };
      this.opts.onSettings(this.settings);
      this.opts.hud.showNotice(this.audio.muted ? 'Sound off (M)' : 'Sound on (M)');
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
    }
    if (code === 'F3') {
```

with:

```ts
    }
    if (code === 'KeyG') {
      this.applyQuality(nextQuality(this.settings.quality));
      this.opts.hud.showNotice(`Graphics: ${this.settings.quality} (G)`);
      return;
    }
    if (code === 'F3') {
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
    });
    this.opts.gs.resize();
```

with:

```ts
    });
    if (this.auto.frame(dt)) {
      // the frame rate has stayed low: step down one preset (going back up is the player's choice, with G)
      const lower = lowerQuality(this.settings.quality);
      if (lower) {
        this.applyQuality(lower);
        this.opts.hud.showNotice(`Graphics lowered to ${lower} to keep the frame rate up (G changes it)`);
      }
    }
    this.opts.gs.resize();
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
        : `snapshots ${this.session.snapshotsReceived} · buffer ${this.session.interpolator.size}`;
      this.opts.hud.setStats(`${this.session.mode} · ping ${Math.round(this.conn.rttMs)} ms · ${this.fps} fps · ${this.frameMs.toFixed(1)} ms/frame · ${net}`);
    }
```

with:

```ts
        : `snapshots ${this.session.snapshotsReceived} · buffer ${this.session.interpolator.size}`;
      this.opts.hud.setStats(`${this.session.mode} · ping ${Math.round(this.conn.rttMs)} ms · ${this.fps} fps · ${this.frameMs.toFixed(1)} ms/frame · graphics ${this.settings.quality} · ${net}`);
    }
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
      frameMs: this.frameMs,
      render: (() => {
```

with:

```ts
      frameMs: this.frameMs,
      quality: this.settings.quality,
      render: (() => {
```

In `src/client/main.ts` (settings are loaded, applied to the arena behind the menu, saved when the menu or the game changes them, and handed on):

<!-- op {"kind": "edit", "path": "src/client/main.ts"} -->
```ts
import { parseLagParams } from './net/latency';
import { createHud } from './ui/hud';
```

with:

```ts
import { parseLagParams } from './net/latency';
import { QUALITY, loadSettings, saveSettings, type Settings } from './settings';
import { createHud } from './ui/hud';
```

In `src/client/main.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/main.ts"} -->
```ts

async function play(gs: GameScene, choice: JoinChoice, params: URLSearchParams): Promise<string | undefined> {
  let net: 'predict' | 'interp' = params.get('net') === 'interp' ? 'interp' : 'predict';
```

with:

```ts

/** localStorage where there is one (some browsers refuse it in private mode). */
function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

async function play(gs: GameScene, choice: JoinChoice, params: URLSearchParams, settings: Settings, remember: (s: Settings) => void): Promise<string | undefined> {
  let net: 'predict' | 'interp' = params.get('net') === 'interp' ? 'interp' : 'predict';
```

In `src/client/main.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/main.ts"} -->
```ts
  return new Promise((resolve) => {
    new GameClient({ gs, hud: createHud(ui), choice, url, onExit: resolve, net, lag }).start();
  });
```

with:

```ts
  return new Promise((resolve) => {
    new GameClient({ gs, hud: createHud(ui), choice, url, onExit: resolve, net, lag, settings, onSettings: remember }).start();
  });
```

In `src/client/main.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/main.ts"} -->
```ts
    const gs = createGameScene(canvas);
    gs.setBloom(params.get('bloom') !== '0'); // ?bloom=0 turns the glow off, to see what it costs on this machine
    const initialCode = params.get('room') ?? undefined;
```

with:

```ts
    const gs = createGameScene(canvas);
    const store = browserStorage();
    let settings = loadSettings(store);
    const remember = (s: Settings): void => {
      settings = s;
      saveSettings(store, s);
    };
    gs.applyQuality(QUALITY[settings.quality]);
    if (params.get('bloom') === '0') gs.setBloom(false); // ?bloom=0 turns the glow off, to see what it costs on this machine
    const initialCode = params.get('room') ?? undefined;
```

In `src/client/main.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/main.ts"} -->
```ts
      const stopBackdrop = startBackdrop(gs);
      const choice = auto ?? (await showMenu(ui, { initialCode, error }));
      auto = null;
```

with:

```ts
      const stopBackdrop = startBackdrop(gs);
      const choice =
        auto ??
        (await showMenu(ui, {
          initialCode,
          error,
          settings,
          onSettings: (s) => {
            remember(s);
            gs.applyQuality(QUALITY[s.quality]); // the arena behind the menu shows the difference
          },
        }));
      auto = null;
```

In `src/client/main.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/main.ts"} -->
```ts
      ui.replaceChildren();
      error = await play(gs, choice, params); // resolves when the game ends; loop back to the menu with the reason
    }
```

with:

```ts
      ui.replaceChildren();
      error = await play(gs, choice, params, settings, remember); // resolves when the game ends; loop back to the menu with the reason
    }
```

In `src/client/ui/menu.ts` (the settings panel):

<!-- op {"kind": "edit", "path": "src/client/ui/menu.ts"} -->
```ts
import { normalizeRoomCode, type JoinMode } from '../../shared/protocol';

```

with:

```ts
import { normalizeRoomCode, type JoinMode } from '../../shared/protocol';
import { QUALITIES, type Quality, type Settings } from '../settings';

```

In `src/client/ui/menu.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/menu.ts"} -->
```ts
  error?: string;
}
```

with:

```ts
  error?: string;
  /** The saved settings, shown in the menu, and what to do with a change (the menu applies nothing itself). */
  settings?: Settings;
  onSettings?(settings: Settings): void;
}
```

In `src/client/ui/menu.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/menu.ts"} -->
```ts
    <p class="error" id="m-error" role="alert"></p>
    <p class="hint">W/S throttle · A/D steer · Space handbrake · H horn · M sound · Tab scoreboard · F3 network</p>`;
```

with:

```ts
    <p class="error" id="m-error" role="alert"></p>
    <div class="settings" role="group" aria-label="Settings">
      <label>Graphics<select id="m-quality"></select></label>
      <label>Volume<input id="m-volume" type="range" min="0" max="100" step="5" /></label>
      <label class="check"><input id="m-sound" type="checkbox" />Sound</label>
    </div>
    <p class="hint">W/S throttle · A/D steer · Space handbrake · H horn · M sound · Tab scoreboard · F3 network</p>`;
```

In `src/client/ui/menu.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/menu.ts"} -->
```ts

  let color = profile.color;
```

with:

```ts

  const settingsBox = q<HTMLElement>('.settings');
  settingsBox.hidden = !options.settings;
  if (options.settings) {
    let settings = options.settings;
    const quality = q<HTMLSelectElement>('#m-quality');
    for (const name of QUALITIES) {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = name[0]!.toUpperCase() + name.slice(1);
      quality.append(o);
    }
    const volume = q<HTMLInputElement>('#m-volume');
    const sound = q<HTMLInputElement>('#m-sound');
    quality.value = settings.quality;
    volume.value = String(Math.round(settings.volume * 100));
    sound.checked = !settings.muted;
    const changed = (): void => {
      settings = { quality: quality.value as Quality, volume: Number(volume.value) / 100, muted: !sound.checked };
      options.onSettings?.(settings);
    };
    quality.addEventListener('change', changed);
    volume.addEventListener('input', changed);
    sound.addEventListener('change', changed);
  }

  let color = profile.color;
```

In `src/client/index.html` (the panel's styles):

<!-- op {"kind": "edit", "path": "src/client/index.html"} -->
```html
        filter: brightness(1.15);
      }
```

with:

```html
        filter: brightness(1.15);
      }
      .menu .settings {
        display: grid;
        grid-template-columns: 1fr 1fr auto;
        gap: 12px;
        align-items: end;
        margin-top: 14px;
        padding-top: 12px;
        border-top: 1px solid var(--line);
      }
      .menu .settings[hidden] {
        display: none;
      }
      .menu .settings select {
        width: 100%;
        box-sizing: border-box;
        margin-top: 6px;
        padding: 8px 10px;
        font: inherit;
        color: var(--ink);
        background: rgba(0, 0, 0, 0.35);
        border: 1px solid var(--line);
        border-radius: 8px;
      }
      .menu .settings input[type='range'] {
        padding: 0;
        height: 34px;
      }
      .menu .settings .check {
        display: flex;
        align-items: center;
        gap: 6px;
        padding-bottom: 10px;
        text-transform: none;
        letter-spacing: 0;
      }
      .menu .settings .check input {
        width: auto;
        margin: 0;
      }
```

- [ ] **Step 4: Run the client tests, then the whole suite**

Run: `npx vitest run tests/client`
Expected: all client tests pass

<!-- check {"cmd": "npx vitest run tests/client", "outcome": "pass"} -->

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 639} -->

- [ ] **Step 5: Check it in a real browser**

WebGL and the DOM only run in a browser, so look at it in a real one (the Playwright browser, not the hidden in-app pane, which pauses animation). `npm run build`, then start a server on a private port: `PORT=18096 STATIC_DIR=dist/client BOT_FILL=8 COUNTDOWN_SECONDS=3 node dist/server/index.js`. Clear `localStorage`, open `http://localhost:18096/`, and check:

1. The menu has **Graphics**, **Volume** and **Sound**; choosing **Low** hides the crowd and the glow in the arena behind it at once; after a reload the choice is still Low (`localStorage["wreckyard.settings"]`).
2. `?auto=quick&name=T`: `__derby.debug().render.samples` is 4 on High (about 440 draw calls). Press **G**: the notice says `Graphics: low (G)`, the draw calls fall to about 260, `samples` is the screen's own (4 in Chromium) and the picture is drawn without the composer (tone and colour as before); **G** again: `medium`, `samples` 2; **G** again: `high`, 4.
3. With a 20x CPU throttle (Chrome DevTools protocol `Emulation.setCPUThrottlingRate`) the game lowers itself from High to Medium and then to Low, each with the notice `Graphics lowered to … (G changes it)`, and never goes back up by itself.
4. `?bloom=0` on High: no glow, `samples` still 4. No console errors.

Stop the server. Note the numbers in the ledger.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(client): graphics presets, volume and a settings panel, the G key, antialiasing per preset and an automatic step down"
```

<!-- commit "feat(client): graphics presets, volume and a settings panel, the G key, antialiasing per preset and an automatic step down" -->

---

### Task 51: Effects and match-screen polish (the Plan 5 and Plan 6 minors)

**Files:**
- Modify: `src/client/game/matchState.ts`, `input.ts`, `spectator.ts`, `nameTag.ts`, `carView.ts`, `fx.ts`, `gameClient.ts`, `src/client/ui/format.ts`, `hud.ts`, `menu.ts`, `src/client/index.html`, `src/shared/constants.ts`, `tests/client/matchState.test.ts`, `format.test.ts`, `controls.test.ts`, `spectator.test.ts`, `fx.test.ts`

**Interfaces:**
- Consumes: `MatchState`, `HUD` (`createHud`), `KeyboardInput`, `SpectatorCamera`, `FxDirector.onHit`, `onLocalImpacts` (Plans 5-6).
- Produces: `once(write)` and `boardSignature(rows, detailed)` in `ui/format.ts`; `cycleDirection(code)` in `spectator.ts`; `KeyboardInput.padCycle()`; `REST_SUSPENSION` exported from `carView.ts`; no "GO!" for a player who joins a round in progress, hit points never shown above 100, one clock computation; a scoreboard that is rebuilt only when what it draws changes, board and feed in one column, no empty board before the first roster, no HUD write per frame that does not change anything; one crash, not two, for observers of a collision, no jolt from your own wreck being rammed.

- [ ] **Step 1: Write the tests**

`MatchState`: no "GO!" for a welcome into a live round (the next round's GO! still comes), health never above 100, the panel clock pinned after the countdown ran out. `once` and `boardSignature` are pure: the compact board ignores health and kills, the detailed one shows whole hit points. `cycleDirection` answers 0 for names an object would inherit (`constructor`), and `padCycle` reports each bumper press once. `FxDirector`: a collision the server tells once for each car in it plays once (both cars are still dented), the told collisions are forgotten with the round (ticks start again from zero), and a rammed wreck of your own does not jolt the camera.

In `tests/client/matchState.test.ts`:

<!-- op {"kind": "edit", "path": "tests/client/matchState.test.ts"} -->
```ts
    expect(m.view().banner!.title).toBe('1'); // never 0 or negative while the phase message is the newest news
  });
```

with:

```ts
    expect(m.view().banner!.title).toBe('1'); // never 0 or negative while the phase message is the newest news
    expect(m.view().clock).toBe('1'); // and the round panel says the same
  });
```

In `tests/client/matchState.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/matchState.test.ts"} -->
```ts

  it('shows your hit points and speed from the latest snapshot, and every car\'s state on the board', () => {
```

with:

```ts

  it('never shows more than 100 HP, whatever a snapshot claims', () => {
    const { m } = match();
    m.onRoster(roster());
    m.onPhase(phase('live', 60_000));
    m.onCars([{ slot: 0, hp: 250, alive: true, speed: 0 }, { slot: 1, hp: 101, alive: true, speed: 0 }]);
    const v = m.view();
    expect(v.me!.hp).toBe(100);
    expect(v.board.map((r) => r.hp)).toEqual([100, 100, 100]);
  });

  it('shows your hit points and speed from the latest snapshot, and every car\'s state on the board', () => {
```

In `tests/client/matchState.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/matchState.test.ts"} -->
```ts

  it('tells a player who joined mid-round that they are watching', () => {
```

with:

```ts

  it('does not shout GO! at a player who joins a round that has been running for minutes', () => {
    const { m } = match();
    m.onWelcome(welcome({ you: -1, phase: phase('live', 100_000) }));
    expect(m.view().banner).toMatchObject({ kind: 'watching' });
    m.onPhase(phase('results', 8000)); // the round ends and the next one starts: that GO! is theirs to see
    m.onRoster(roster({ epoch: 3, round: 2, you: 0 }));
    m.onPhase(phase('countdown', 5000, 2));
    m.onPhase(phase('live', 240_000, 2));
    expect(m.view().banner).toMatchObject({ kind: 'go' });
  });

  it('tells a player who joined mid-round that they are watching', () => {
```

In `tests/client/format.test.ts`:

<!-- op {"kind": "edit", "path": "tests/client/format.test.ts"} -->
```ts
import { describe, expect, it } from 'vitest';
import { hexColor, hpColor, zoneColor } from '../../src/client/ui/format';

```

with:

```ts
import { describe, expect, it } from 'vitest';
import type { BoardRow } from '../../src/client/game/matchState';
import { boardSignature, hexColor, hpColor, once, zoneColor } from '../../src/client/ui/format';

```

In `tests/client/format.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/format.test.ts"} -->
```ts
    expect(zoneColor(Number.NaN)).toBe(zoneColor(0));
  });
});

```

with:

```ts
    expect(zoneColor(Number.NaN)).toBe(zoneColor(0));
  });
});

describe('once', () => {
  it('writes the first value, then only values that differ from the last one written', () => {
    const written: string[] = [];
    const write = once((v: string) => written.push(v));
    write('a');
    write('a');
    write('b');
    write('a');
    write('a');
    expect(written).toEqual(['a', 'b', 'a']);
  });

  it('writes even a first value that looks like "nothing yet", and treats NaN as unchanged', () => {
    const written: Array<number | undefined> = [];
    const write = once((v: number | undefined) => written.push(v));
    write(undefined);
    write(undefined);
    expect(written).toEqual([undefined]);
    const nan: number[] = [];
    const writeNumber = once((v: number) => nan.push(v));
    writeNumber(Number.NaN);
    writeNumber(Number.NaN);
    expect(nan).toHaveLength(1);
  });
});

describe('boardSignature', () => {
  const row = (over: Partial<BoardRow> = {}): BoardRow => ({ slot: 0, name: 'Ann', color: 0xd84a2b, bot: false, score: 10, kills: 1, alive: true, hp: 80, you: true, ...over });

  it('does not change with health or kills on the compact board, so a car being hurt does not rebuild it', () => {
    const a = boardSignature([row(), row({ slot: 1, name: 'Bob', you: false })], false);
    expect(boardSignature([row({ hp: 41.5, kills: 3 }), row({ slot: 1, name: 'Bob', you: false, hp: 3 })], false)).toBe(a);
  });

  it('changes with anything the compact board draws', () => {
    const base = boardSignature([row()], false);
    for (const over of [{ score: 11 }, { name: 'Anne' }, { alive: false }, { you: false }, { bot: true }, { color: 1 }, { slot: 2 }]) {
      expect(boardSignature([row(over)], false)).not.toBe(base);
    }
    expect(boardSignature([row(), row({ slot: 1 })], false)).not.toBe(base);
  });

  it('adds kills and whole hit points on the detailed board, and tells the two boards apart', () => {
    const base = boardSignature([row()], true);
    expect(boardSignature([row({ kills: 2 })], true)).not.toBe(base);
    expect(boardSignature([row({ hp: 70 })], true)).not.toBe(base);
    expect(boardSignature([row({ hp: 79.2 })], true)).toBe(base); // 80 HP shown either way
    expect(base).not.toBe(boardSignature([row()], false));
  });
});

```

In `tests/client/controls.test.ts`:

<!-- op {"kind": "edit", "path": "tests/client/controls.test.ts"} -->
```ts

describe('isEditableTarget', () => {
```

with:

```ts

describe('KeyboardInput gamepad bumpers', () => {
  const held = (...pressed: number[]): GamepadLike => pad([0, 0], Array.from({ length: 8 }, (_, i) => btn(pressed.includes(i) ? 1 : 0)));

  it('reports each bumper press once: the right bumper is the next car, the left one the previous', () => {
    let current: GamepadLike | null = held();
    const kb = new KeyboardInput(new EventTarget(), () => current);
    expect(kb.padCycle()).toBe(0);
    current = held(5);
    expect(kb.padCycle()).toBe(1);
    expect(kb.padCycle()).toBe(0); // still held
    current = held();
    expect(kb.padCycle()).toBe(0);
    current = held(4);
    expect(kb.padCycle()).toBe(-1);
    current = held(4, 5); // both at once: the right one wins, and neither repeats
    expect(kb.padCycle()).toBe(1);
    expect(kb.padCycle()).toBe(0);
    current = null; // unplugged
    expect(kb.padCycle()).toBe(0);
    current = held(5);
    expect(kb.padCycle()).toBe(1); // a press after being unplugged counts again
    kb.dispose();
  });

  it('does not steer or accelerate when only a bumper is pressed', () => {
    const kb = new KeyboardInput(new EventTarget(), () => held(4, 5));
    expect(kb.sample(1 / 60)).toEqual({ throttle: 0, steer: 0, handbrake: false });
    kb.dispose();
  });
});

describe('isEditableTarget', () => {
```

In `tests/client/spectator.test.ts`:

<!-- op {"kind": "edit", "path": "tests/client/spectator.test.ts"} -->
```ts
import { describe, expect, it } from 'vitest';
import { MAX_CAMERA_RADIUS, SpectatorCamera, computeOrbitView, nextTarget, type Followable } from '../../src/client/game/spectator';
import { vlen, vsub } from '../../src/shared/math';
```

with:

```ts
import { describe, expect, it } from 'vitest';
import { MAX_CAMERA_RADIUS, SpectatorCamera, computeOrbitView, cycleDirection, nextTarget, type Followable } from '../../src/client/game/spectator';
import { vlen, vsub } from '../../src/shared/math';
```

In `tests/client/spectator.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/spectator.test.ts"} -->
```ts
    expect(nextTarget([car(4)], 4, -1)).toBe(4);
  });
```

with:

```ts
    expect(nextTarget([car(4)], 4, -1)).toBe(4);
  });
});

describe('cycleDirection', () => {
  it('maps the keys that switch the watched car to a direction: left and previous are -1, right and next +1', () => {
    for (const code of ['ArrowLeft', 'KeyA', 'KeyQ']) expect(cycleDirection(code)).toBe(-1);
    for (const code of ['ArrowRight', 'KeyD', 'KeyE']) expect(cycleDirection(code)).toBe(1);
  });

  it('says 0 for every other key, including names an object would inherit', () => {
    for (const code of ['KeyW', 'Space', '', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(cycleDirection(code)).toBe(0);
  });
```

In `tests/client/fx.test.ts`:

<!-- op {"kind": "edit", "path": "tests/client/fx.test.ts"} -->
```ts

  it('takes a part off when a side has taken enough, and sends it flying', () => {
```

with:

```ts

  it('plays one crash and one set of sparks for a collision the server tells once for each car in it, and dents both cars all the same', () => {
    const t = setup();
    const before = [t.shape(1), t.shape(2)];
    t.fx.onHit(hit({ victim: 1, attacker: 2, tick: 200 }), t.frameArgs());
    const sparks = t.sparks();
    const nodes = t.ctxNodes();
    const shake = t.fx.shake.level;
    t.fx.onHit(hit({ victim: 2, attacker: 1, tick: 200 }), t.frameArgs()); // the same collision, told for the other car
    expect(t.sparks()).toBe(sparks);
    expect(t.ctxNodes()).toBe(nodes);
    expect(t.fx.shake.level).toBe(shake);
    expect(t.shape(1)).not.toEqual(before[0]);
    expect(t.shape(2)).not.toEqual(before[1]);
    t.fx.onHit(hit({ victim: 1, attacker: 2, tick: 320 }), t.frameArgs()); // a later collision of the same two cars is a new one
    expect(t.sparks()).toBeGreaterThan(sparks);
  });

  it('forgets the collisions it was told about when a new round starts, because the ticks start again from zero', () => {
    const t = setup();
    t.fx.onHit(hit({ victim: 1, attacker: 2, tick: 200 }), t.frameArgs());
    expect(t.sparks()).toBeGreaterThan(0);
    t.fx.onRoster(); // the sparks are cleared with the rest of the round
    expect(t.sparks()).toBe(0);
    t.fx.onHit(hit({ victim: 1, attacker: 2, tick: 200 }), t.frameArgs()); // the next round's collision that happens to carry the same tick
    expect(t.sparks()).toBeGreaterThan(0);
  });

  it('takes a part off when a side has taken enough, and sends it flying', () => {
```

In `tests/client/fx.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/fx.test.ts"} -->
```ts
    expect(t.fx.shake.level).toBeGreaterThan(0.3);
  });
```

with:

```ts
    expect(t.fx.shake.level).toBeGreaterThan(0.3);
  });

  it('ignores what happens to your own wreck: the camera that orbits somebody else is not the one being hit', () => {
    const t = setup();
    t.setPoses([pose(0, { alive: false, hp: 0 }), pose(1), pose(2)]);
    const nodes = t.ctxNodes();
    t.fx.onLocalImpacts([impact(12, 1)], t.frameArgs());
    expect(t.fx.shake.level).toBe(0);
    expect(t.sparks()).toBe(0);
    expect(t.ctxNodes()).toBe(nodes);
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/client/matchState.test.ts tests/client/format.test.ts tests/client/controls.test.ts tests/client/spectator.test.ts tests/client/fx.test.ts`
Expected: FAIL — `once`, `boardSignature`, `cycleDirection` and `padCycle` do not exist and the three behaviours are missing

<!-- check {"cmd": "npx vitest run tests/client/matchState.test.ts tests/client/format.test.ts tests/client/controls.test.ts tests/client/spectator.test.ts tests/client/fx.test.ts", "outcome": "fail", "match": "FAIL|\u00d7|not a function"} -->

- [ ] **Step 3: Polish the match state, the input and the effects**

In `src/client/game/matchState.ts` (a welcome only *enters* its phase; the GO! moment is set only on a live transition from another phase; health is clamped to `COMBAT.MAX_HP`; the seconds are worked out once):

<!-- op {"kind": "edit", "path": "src/client/game/matchState.ts"} -->
```ts
} from '../../shared/protocol';
import type { Zone } from '../../shared/types';
```

with:

```ts
} from '../../shared/protocol';
import { COMBAT } from '../../shared/constants';
import type { Zone } from '../../shared/types';
```

In `src/client/game/matchState.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/matchState.ts"} -->
```ts
    this.resetRoundDamage();
    if (w.phase) this.onPhase(w.phase);
  }
```

with:

```ts
    this.resetRoundDamage();
    if (w.phase) this.enter(w.phase); // already under way when you arrive: no GO! for a round that started minutes ago
  }
```

In `src/client/game/matchState.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/matchState.ts"} -->
```ts
  onPhase(p: PhaseMessage): void {
    this.phase = p.phase;
```

with:

```ts
  onPhase(p: PhaseMessage): void {
    const wasLive = this.phase === 'live';
    this.enter(p);
    if (p.phase === 'live' && !wasLive) this.liveSince = this.now();
  }

  private enter(p: PhaseMessage): void {
    this.phase = p.phase;
```

In `src/client/game/matchState.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/matchState.ts"} -->
```ts
    this.deadline = this.now() + p.remainingMs;
    if (p.phase === 'live') this.liveSince = this.now();
  }
```

with:

```ts
    this.deadline = this.now() + p.remainingMs;
  }
```

In `src/client/game/matchState.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/matchState.ts"} -->
```ts
    this.facts.clear();
    const sane = (v: number): number => (Number.isFinite(v) ? Math.max(0, v) : 0);
    for (const c of cars) this.facts.set(c.slot, { slot: c.slot, alive: c.alive, hp: sane(c.hp), speed: sane(c.speed) });
  }
```

with:

```ts
    this.facts.clear();
    const sane = (v: number, max = Number.POSITIVE_INFINITY): number => (Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : 0);
    for (const c of cars) this.facts.set(c.slot, { slot: c.slot, alive: c.alive, hp: sane(c.hp, COMBAT.MAX_HP), speed: sane(c.speed) });
  }
```

In `src/client/game/matchState.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/matchState.ts"} -->
```ts
    const remaining = Math.max(0, this.deadline - t);
    const myFact = this.mySlot >= 0 ? this.facts.get(this.mySlot) : undefined;
```

with:

```ts
    const remaining = Math.max(0, this.deadline - t);
    const seconds = Math.max(1, Math.ceil(remaining / 1000)); // never 0 or negative while the phase message is the newest news
    const myFact = this.mySlot >= 0 ? this.facts.get(this.mySlot) : undefined;
```

In `src/client/game/matchState.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/matchState.ts"} -->
```ts
      clockLabel = 'Starts in';
      clock = String(Math.max(1, Math.ceil(remaining / 1000)));
    } else if (this.phase === 'live') {
```

with:

```ts
      clockLabel = 'Starts in';
      clock = String(seconds);
    } else if (this.phase === 'live') {
```

In `src/client/game/matchState.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/matchState.ts"} -->
```ts
      clockLabel = 'Next round in';
      clock = String(Math.max(1, Math.ceil(remaining / 1000)));
    }
```

with:

```ts
      clockLabel = 'Next round in';
      clock = String(seconds);
    }
```

In `src/client/game/matchState.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/matchState.ts"} -->
```ts
      board: rows,
      banner: this.banner(t, remaining, meAlive),
      flash: Math.max(0, 1 - (t - this.flashAt) / FLASH_MS) * this.flashPower,
```

with:

```ts
      board: rows,
      banner: this.banner(t, seconds, meAlive),
      flash: Math.max(0, 1 - (t - this.flashAt) / FLASH_MS) * this.flashPower,
```

In `src/client/game/matchState.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/matchState.ts"} -->
```ts

  private banner(t: number, remaining: number, meAlive: boolean): Banner | null {
    const name = (slot: number): string => this.players.get(slot)?.name ?? `Car ${slot + 1}`;
```

with:

```ts

  private banner(t: number, seconds: number, meAlive: boolean): Banner | null {
    const name = (slot: number): string => this.players.get(slot)?.name ?? `Car ${slot + 1}`;
```

In `src/client/game/matchState.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/matchState.ts"} -->
```ts
    if (this.phase === 'countdown') {
      const seconds = Math.max(1, Math.ceil(remaining / 1000));
      return {
```

with:

```ts
    if (this.phase === 'countdown') {
      return {
```

In `src/client/game/matchState.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/matchState.ts"} -->
```ts
      const r = this.results;
      const seconds = Math.max(1, Math.ceil(remaining / 1000));
      const title = !r ? 'Round over' : r.winner < 0 ? 'Draw' : `${r.rows.find((row) => row.slot === r.winner)?.name ?? name(r.winner)} wins`;
```

with:

```ts
      const r = this.results;
      const title = !r ? 'Round over' : r.winner < 0 ? 'Draw' : `${r.rows.find((row) => row.slot === r.winner)?.name ?? name(r.winner)} wins`;
```

In `src/client/game/input.ts`:

<!-- op {"kind": "edit", "path": "src/client/game/input.ts"} -->
```ts
  private readonly ramp = new SteerRamp();
  private readonly onKeyDown = (e: Event): void => {
```

with:

```ts
  private readonly ramp = new SteerRamp();
  private bumpers = { left: false, right: false };
  private readonly onKeyDown = (e: Event): void => {
```

In `src/client/game/input.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/input.ts"} -->
```ts

  /** Samples the current input; advances the steering ramp by `dt` seconds. */
```

with:

```ts

  /**
   * The gamepad's way of switching the car you watch: -1 for a press of the left bumper, 1 for the right one, 0 otherwise.
   * Reports each press once; call it every frame so a bumper held from earlier does not count as a new press.
   */
  padCycle(): 1 | -1 | 0 {
    const pad = this.readPad();
    const left = pad?.buttons[4]?.pressed ?? false;
    const right = pad?.buttons[5]?.pressed ?? false;
    const direction = right && !this.bumpers.right ? 1 : left && !this.bumpers.left ? -1 : 0;
    this.bumpers = { left, right };
    return direction;
  }

  /** Samples the current input; advances the steering ramp by `dt` seconds. */
```

In `src/client/game/spectator.ts`:

<!-- op {"kind": "edit", "path": "src/client/game/spectator.ts"} -->
```ts
  return (running.findLast((c) => c.slot < current) ?? running[running.length - 1]!).slot;
}

const ORBIT_RADIUS = 13;
```

with:

```ts
  return (running.findLast((c) => c.slot < current) ?? running[running.length - 1]!).slot;
}

/** Keys that switch the car the spectator camera follows (they steer when you drive, so they are free once you are out). */
const CYCLE_KEYS: ReadonlyMap<string, 1 | -1> = new Map([
  ['ArrowLeft', -1],
  ['KeyA', -1],
  ['KeyQ', -1],
  ['ArrowRight', 1],
  ['KeyD', 1],
  ['KeyE', 1],
]);

/** Which way a key (a `KeyboardEvent.code`) switches the watched car: -1 previous, 1 next, 0 not a switching key. */
export const cycleDirection = (code: string): 1 | -1 | 0 => CYCLE_KEYS.get(code) ?? 0;

const ORBIT_RADIUS = 13;
```

In `src/client/game/nameTag.ts`, an export nobody calls (`NameTag.dispose` is the one in use) goes:

<!-- op {"kind": "edit", "path": "src/client/game/nameTag.ts"} -->
```ts
  return sprite;
}

export function disposeNameTag(sprite: THREE.Sprite): void {
  sprite.material.map?.dispose();
  sprite.material.dispose();
  sprite.removeFromParent();
}
```

with:

```ts
  return sprite;
}
```

In `src/client/game/carView.ts`:

<!-- op {"kind": "edit", "path": "src/client/game/carView.ts"} -->
```ts
export const WHEEL_SPIN_SIGN = -1;
const REST_SUSPENSION = 0.374; // measured settled suspension length
/** Body colour of a car that is out of the round. */
```

with:

```ts
export const WHEEL_SPIN_SIGN = -1;
export const REST_SUSPENSION = 0.374; // measured settled suspension length
/** Body colour of a car that is out of the round. */
```

In `src/client/game/fx.ts`:

<!-- op {"kind": "edit", "path": "src/client/game/fx.ts"} -->
```ts
import { COMBAT } from '../../shared/constants';
```

with:

```ts
import { ARENA, COMBAT } from '../../shared/constants';
```

and:

<!-- op {"kind": "edit", "path": "src/client/game/fx.ts"} -->
```ts
import type { CarView } from './carView';
```

with:

```ts
import { REST_SUSPENSION, type CarView } from './carView';
```

and:

<!-- op {"kind": "edit", "path": "src/client/game/fx.ts"} -->
```ts
      const pose = frame.poses.find((p) => p.slot === i.slot);
      if (!pose) continue;
      const at = worldPoint(pose, i.point);
```

with:

```ts
      const pose = frame.poses.find((p) => p.slot === i.slot);
      if (!pose?.alive) continue; // your own wreck being rammed is not a jolt for the camera that orbits somebody else
      const at = worldPoint(pose, i.point);
```

and:

<!-- op {"kind": "edit", "path": "src/client/game/fx.ts"} -->
```ts
  private readonly localImpactAt = new Map<number, number>();
```

with:

```ts
  private readonly localImpactAt = new Map<number, number>();
  /** Collisions the server has told about (by the two cars and the tick): it tells each once per car in it, and they are played once. */
  private readonly told = new Map<string, number>();
```

and:

<!-- op {"kind": "edit", "path": "src/client/game/fx.ts"} -->
```ts
    this.localImpactAt.clear();
    for (const view of this.allViews()) view.restore();
```

with:

```ts
    this.localImpactAt.clear();
    this.told.clear();
    for (const view of this.allViews()) view.restore();
```

and:

<!-- op {"kind": "edit", "path": "src/client/game/fx.ts"} -->
```ts
    if (covered) return;
    const pose = frame.poses.find((p) => p.slot === h.victim);
```

with:

```ts
    if (covered) return;
    const key = `${Math.min(h.victim, h.attacker)}:${Math.max(h.victim, h.attacker)}:${h.tick}`;
    if (this.told.has(key)) return; // the same collision, told for the other car in it
    this.told.set(key, this.now);
    for (const [k, at] of this.told) if (this.now - at > 2) this.told.delete(k);
    const pose = frame.poses.find((p) => p.slot === h.victim);
```

and:

<!-- op {"kind": "edit", "path": "src/client/game/fx.ts"} -->
```ts
    for (let slot = 0; slot < 8; slot++) {
```

with:

```ts
    for (let slot = 0; slot < ARENA.MAX_CARS; slot++) {
```

and:

<!-- op {"kind": "edit", "path": "src/client/game/fx.ts"} -->
```ts
wheelLocalPosition(i, 0.374));
```

with:

```ts
wheelLocalPosition(i, REST_SUSPENSION));
```

and:

<!-- op {"kind": "edit", "path": "src/client/game/fx.ts"} -->
```ts
wheelLocalPosition(2 + Math.floor(this.random() * 2), 0.374)); // either rear wheel
```

with:

```ts
wheelLocalPosition(2 + Math.floor(this.random() * 2), REST_SUSPENSION)); // either rear wheel
```

In `src/shared/constants.ts`, the comment on the version says what version 3 is:

<!-- op {"kind": "edit", "path": "src/shared/constants.ts"} -->
```ts
export const NET = {
  /** 2: rounds, hit/ko/scores/results messages, `you` in the roster. */
  PROTOCOL_VERSION: 3,
```

with:

```ts
export const NET = {
  /** 3: the welcome carries the round's latest hits (`dents`). 2: rounds, hit/ko/scores/results messages, `you` in the roster. */
  PROTOCOL_VERSION: 3,
```

- [ ] **Step 4: Polish the HUD**

In `src/client/ui/format.ts`:

<!-- op {"kind": "edit", "path": "src/client/ui/format.ts"} -->
```ts
import { clamp } from '../../shared/math';

```

with:

```ts
import { clamp } from '../../shared/math';
import type { BoardRow } from '../game/matchState';

```

In `src/client/ui/format.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/format.ts"} -->
```ts
  return `hsla(${Math.round((1 - t) * 55)}, 90%, 55%, ${(0.16 + 0.84 * t).toFixed(2)})`;
}

```

with:

```ts
  return `hsla(${Math.round((1 - t) * 55)}, 90%, 55%, ${(0.16 + 0.84 * t).toFixed(2)})`;
}

/** Wraps `write` so it runs only when the value differs from the last one written: the HUD is refreshed every frame and most frames change nothing. */
export function once<T>(write: (value: T) => void): (value: T) => void {
  let last: T | undefined;
  let written = false;
  return (value) => {
    if (written && Object.is(value, last)) return;
    written = true;
    last = value;
    write(value);
  };
}

/**
 * Everything the scoreboard draws, as a string: the board is rebuilt only when this changes. The compact board shows
 * neither health nor kills, so a car being hurt does not rebuild it; the detailed one shows whole hit points.
 */
export function boardSignature(rows: readonly BoardRow[], detailed: boolean): string {
  return JSON.stringify([
    detailed,
    rows.map((r) => {
      const drawn = [r.slot, r.name, r.color, r.bot, r.score, r.alive, r.you];
      return detailed ? [...drawn, r.kills, Math.ceil(r.hp)] : drawn;
    }),
  ]);
}

```

In `src/client/ui/hud.ts` (every write goes through `once`; the board and the feed share one column; no empty board):

<!-- op {"kind": "edit", "path": "src/client/ui/hud.ts"} -->
```ts
import type { FeedItem, MatchView } from '../game/matchState';
import { hexColor, hpColor, zoneColor } from './format';

```

with:

```ts
import type { FeedItem, MatchView } from '../game/matchState';
import { boardSignature, hexColor, hpColor, once, zoneColor } from './format';

```

In `src/client/ui/hud.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/hud.ts"} -->
```ts

  const board = el('div', 'hud-board', wrap);
  const feed = el('ul', 'hud-feed', wrap);

```

with:

```ts

  const side = el('div', 'hud-side', wrap); // the board and the kill feed under it share one column, so a tall board can never run into the feed
  const board = el('div', 'hud-board', side);
  const feed = el('ul', 'hud-feed', side);

```

In `src/client/ui/hud.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/hud.ts"} -->
```ts

  let boardKey = '';
```

with:

```ts

  // the HUD is refreshed every frame: each of these writes to the page only when its value changes
  const showRound = once((visible: boolean) => {
    round.hidden = !visible;
  });
  const showBoard = once((visible: boolean) => {
    board.hidden = !visible;
  });
  const showMe = once((visible: boolean) => {
    me.hidden = !visible;
  });
  const showBanner = once((visible: boolean) => {
    banner.hidden = !visible;
  });
  const setBannerKind = once((kind: string) => {
    banner.dataset.kind = kind;
  });
  const setHpWidth = once((width: string) => {
    hpFill.style.width = width;
  });
  const setHpColor = once((color: string) => {
    hpFill.style.background = color;
  });
  const setZone = new Map(
    ZONES.map((z) => [
      z,
      once((color: string) => {
        zoneCells.get(z)!.style.background = color;
      }),
    ]),
  );
  const setFlash = once((opacity: string) => {
    flash.style.opacity = opacity;
  });

  let boardKey = '';
```

In `src/client/ui/hud.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/hud.ts"} -->
```ts
  let boardKey = '';
  const feedNodes = new Map<number, HTMLElement>();

```

with:

```ts
  let boardKey = '';
  const feedNodes = new Map<number, { node: HTMLElement; setOpacity: (opacity: string) => void }>();

```

In `src/client/ui/hud.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/hud.ts"} -->
```ts
  const drawBoard = (view: MatchView, detailed: boolean): void => {
    const key = JSON.stringify([detailed, view.board]);
    if (key === boardKey) return;
```

with:

```ts
  const drawBoard = (view: MatchView, detailed: boolean): void => {
    const key = boardSignature(view.board, detailed);
    if (key === boardKey) return;
```

In `src/client/ui/hud.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/hud.ts"} -->
```ts
    const live = new Set(items.map((f) => f.id));
    for (const [id, node] of feedNodes) {
      if (!live.has(id)) {
```

with:

```ts
    const live = new Set(items.map((f) => f.id));
    for (const [id, entry] of feedNodes) {
      if (!live.has(id)) {
```

In `src/client/ui/hud.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/hud.ts"} -->
```ts
      if (!live.has(id)) {
        node.remove();
        feedNodes.delete(id);
```

with:

```ts
      if (!live.has(id)) {
        entry.node.remove();
        feedNodes.delete(id);
```

In `src/client/ui/hud.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/hud.ts"} -->
```ts
    for (const f of items) {
      let node = feedNodes.get(f.id);
      if (!node) {
        node = el('li', `feed-${f.tone}`, feed);
        node.textContent = f.text;
```

with:

```ts
    for (const f of items) {
      let entry = feedNodes.get(f.id);
      if (!entry) {
        const node = el('li', `feed-${f.tone}`, feed);
        node.textContent = f.text;
```

In `src/client/ui/hud.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/hud.ts"} -->
```ts
        node.textContent = f.text;
        feedNodes.set(f.id, node);
      }
```

with:

```ts
        node.textContent = f.text;
        entry = {
          node,
          setOpacity: once((opacity: string) => {
            node.style.opacity = opacity;
          }),
        };
        feedNodes.set(f.id, entry);
      }
```

In `src/client/ui/hud.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/hud.ts"} -->
```ts
      }
      node.style.opacity = String(Math.min(1, f.life * 3).toFixed(2));
    }
```

with:

```ts
      }
      entry.setOpacity(Math.min(1, f.life * 3).toFixed(2));
    }
```

In `src/client/ui/hud.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/hud.ts"} -->
```ts
    setMatch(view, detailed) {
      round.hidden = view.phase === null;
      setText(roundTitle, `Round ${view.round}`);
```

with:

```ts
    setMatch(view, detailed) {
      showRound(view.phase !== null);
      setText(roundTitle, `Round ${view.round}`);
```

In `src/client/ui/hud.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/hud.ts"} -->
```ts
      setText(roundAlive, `Alive ${view.aliveCount}/${view.carCount}`);
      drawBoard(view, detailed);
```

with:

```ts
      setText(roundAlive, `Alive ${view.aliveCount}/${view.carCount}`);
      showBoard(view.board.length > 0); // no empty pill before the first roster arrives
      drawBoard(view, detailed);
```

In `src/client/ui/hud.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/hud.ts"} -->
```ts
      drawFeed(view.feed);
      me.hidden = view.me === null;
      if (view.me) {
```

with:

```ts
      drawFeed(view.feed);
      showMe(view.me !== null);
      if (view.me) {
```

In `src/client/ui/hud.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/hud.ts"} -->
```ts
        const hp = Math.max(0, view.me.hp);
        hpFill.style.width = `${hp}%`;
        hpFill.style.background = hpColor(hp);
        setText(hpNum, view.me.alive ? String(Math.ceil(hp)) : 'OUT');
```

with:

```ts
        const hp = Math.max(0, view.me.hp);
        setHpWidth(`${hp}%`);
        setHpColor(hpColor(hp));
        setText(hpNum, view.me.alive ? String(Math.ceil(hp)) : 'OUT');
```

In `src/client/ui/hud.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/hud.ts"} -->
```ts
        setText(hpNum, view.me.alive ? String(Math.ceil(hp)) : 'OUT');
        for (const z of ZONES) zoneCells.get(z)!.style.background = zoneColor(view.me.zones[z]);
        setText(speed, `${view.speedKmh} km/h`);
```

with:

```ts
        setText(hpNum, view.me.alive ? String(Math.ceil(hp)) : 'OUT');
        for (const z of ZONES) setZone.get(z)!(zoneColor(view.me.zones[z]));
        setText(speed, `${view.speedKmh} km/h`);
```

In `src/client/ui/hud.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/hud.ts"} -->
```ts
      }
      banner.hidden = view.banner === null;
      banner.dataset.kind = view.banner?.kind ?? '';
      if (view.banner) {
```

with:

```ts
      }
      showBanner(view.banner !== null);
      setBannerKind(view.banner?.kind ?? '');
      if (view.banner) {
```

In `src/client/ui/hud.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/hud.ts"} -->
```ts
      }
      flash.style.opacity = view.flash.toFixed(2);
    },
```

with:

```ts
      }
      setFlash(view.flash.toFixed(2));
    },
```

In `src/client/index.html` (the column):

<!-- op {"kind": "edit", "path": "src/client/index.html"} -->
```html
      .hud-board {
        position: absolute;
        right: 16px;
        top: 12px;
        min-width: 190px;
```

with:

```html
      .hud-side {
        position: absolute;
        right: 16px;
        top: 12px;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 8px;
      }
      .hud-board {
        min-width: 190px;
```

and:

<!-- op {"kind": "edit", "path": "src/client/index.html"} -->
```html
      .hud-feed {
        position: absolute;
        right: 16px;
        top: 190px;
        margin: 0;
```

with:

```html
      .hud-feed {
        margin: 0;
```

In `src/client/ui/menu.ts`, the hint:

<!-- op {"kind": "edit", "path": "src/client/ui/menu.ts"} -->
```ts
H horn · M sound · Tab scoreboard · F3 network</p>`;
```

with:

```ts
H horn · M sound · G graphics · Tab scoreboard · F3 network (Fn+F3 on a Mac)</p>`;
```

In `src/client/game/gameClient.ts` (the cycle keys live in `spectator.ts`; the gamepad bumpers switch the watched car):

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
import { SpectatorCamera } from './spectator';
```

with:

```ts
import { SpectatorCamera, cycleDirection } from './spectator';
```

and:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
/** Keys that switch the car the spectator camera follows (they steer when you drive, so they are free once you are out). */
const CYCLE_KEYS: Readonly<Record<string, 1 | -1>> = {
  ArrowLeft: -1,
  KeyA: -1,
  KeyQ: -1,
  ArrowRight: 1,
  KeyD: 1,
  KeyE: 1,
};

/**
 * Sends inputs at 60 Hz.
```

with:

```ts
/**
 * Sends inputs at 60 Hz.
```

and:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
    const direction = CYCLE_KEYS[code];
    if (direction && !this.driving) this.spectator.cycle(this.lastPoses, direction);
```

with:

```ts
    const direction = cycleDirection(code);
    if (direction !== 0 && !this.driving) this.spectator.cycle(this.lastPoses, direction);
```

and:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
    this.driving = mine?.alive === true;
    const orbit
```

with:

```ts
    this.driving = mine?.alive === true;
    const bumper = this.keyboard.padCycle(); // read every frame, so a bumper held from earlier is not taken for a new press
    if (bumper !== 0 && !this.driving) this.spectator.cycle(poses, bumper);
    const orbit
```

- [ ] **Step 5: Run the client tests, then the whole suite**

Run: `npx vitest run tests/client`
Expected: all client tests pass

<!-- check {"cmd": "npx vitest run tests/client", "outcome": "pass"} -->

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 653} -->

- [ ] **Step 6: Check the HUD in a real browser**

`npm run build`, then `PORT=18096 STATIC_DIR=dist/client BOT_FILL=8 COUNTDOWN_SECONDS=3 node dist/server/index.js`, and open `http://localhost:18096/?auto=quick&name=Tester` at 1280x720 in the Playwright browser. Check, and write the numbers in the ledger:

1. In the first moments (before the roster) `.hud-board` is `hidden` with no rows; once the roster arrives it is visible with 8 rows.
2. In the live round, a `MutationObserver` on `.hud` for 3 seconds sees the scoreboard rebuilt only a handful of times (when a score or an alive flag changes), the clock text once a second, and **no** `style`, `hidden`, `data-kind`, flash or health writes per frame.
3. With 8 rows and five feed lines added by hand, `.hud-feed` starts at least 8 px under the board's bottom, also with `.hud-board .row { line-height: 1.9; font-size: 16px }`; the column sits 16 px from the right edge.
4. A screenshot looks as before: room panel top left, round panel top centre, board top right, health panel at the bottom.

Stop the server.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "fix(client): match-screen and effects polish \u2014 GO! only on a live transition, one clock, health capped, a board rebuilt only when it changes, one column, gamepad bumpers, one crash per collision"
```

<!-- commit "fix(client): match-screen and effects polish \u2014 GO! only on a live transition, one clock, health capped, a board rebuilt only when it changes, one column, gamepad bumpers, one crash per collision" -->

---

### Task 52: The load test and the packaged smoke check

**Files:**
- Create: `scripts/lib/e2e.ts`, `scripts/lib/loadtest.ts`, `scripts/loadtest.ts`, `scripts/smoke-e2e.ts`, `tests/scripts/e2e.test.ts`, `tests/scripts/loadtest.test.ts`
- Delete: `scripts/smoke-e2e.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `createGameServer`, the protocol (`encodeInput`, `parseServerMessage`, `NET.PROTOCOL_VERSION`), `/healthz` (Task 47).
- Produces: `joinRoom(url, hello)`, `createRoom(url)`, `copyBundle(distDir, into)` (`scripts/lib/e2e.ts`); `runLoad(options)`, `evaluate(report, limits)`, `loadInput(index, elapsed)`, `DEFAULT_LIMITS` (`scripts/lib/loadtest.ts`); `npm run loadtest`; `npm run smoke` running the bundle from an empty folder.

- [ ] **Step 1: Write the tests**

The helpers are tested against a real in-process server: `createRoom` and `joinRoom` speak the protocol version the server speaks (the old smoke script sent a literal `2` and had been failing since Plan 6), refuse with the server's reason and give up after a timeout; `copyBundle` copies `dist/server` and `dist/client` and nothing else. The load test is tested as wiring — two rooms of three players for three seconds are all seated, all hear about 30 snapshots a second, nobody is closed on or errored at, everybody has left when it ends — with limits that do not depend on how fast the machine is; `evaluate` is tested on synthetic reports, one breach at a time.

Create `tests/scripts/e2e.test.ts`:

<!-- op {"kind": "create", "path": "tests/scripts/e2e.test.ts"} -->
```ts
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../../src/shared/physics';
import { createGameServer, type GameServer } from '../../src/server/app';
import { copyBundle, createRoom, joinRoom } from '../../scripts/lib/e2e';

beforeAll(async () => {
  await initPhysics();
});

let app: GameServer | null = null;
const dirs: string[] = [];
afterEach(async () => {
  await app?.close();
  app = null;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('createRoom and joinRoom', () => {
  it('speak the protocol version the server speaks, so the end-to-end scripts cannot fall behind it', async () => {
    app = createGameServer({ botFill: 0 });
    const port = await app.listen(0, '127.0.0.1');
    const code = await createRoom(`ws://127.0.0.1:${port}/ws`);
    expect(code).toMatch(/^[A-Z]{4}$/);
    const { ws, welcome } = await joinRoom(`ws://127.0.0.1:${port}/ws`, { mode: 'quick', name: 'Ann' });
    expect(welcome.room.public).toBe(true);
    ws.close();
  });

  it('reject with the server\'s reason when it refuses the join', async () => {
    app = createGameServer({ botFill: 0 });
    const port = await app.listen(0, '127.0.0.1');
    await expect(joinRoom(`ws://127.0.0.1:${port}/ws`, { mode: 'join', code: 'ZZZZ' })).rejects.toThrow(/room_not_found/);
  });

  it('reject when nothing answers in time', async () => {
    await expect(joinRoom('ws://127.0.0.1:1/ws', { mode: 'quick' }, 300)).rejects.toThrow();
  });
});

describe('copyBundle', () => {
  it('copies the built server and client into an empty folder and nothing else', () => {
    const dist = mkdtempSync(path.join(tmpdir(), 'wreckyard-test-'));
    const into = mkdtempSync(path.join(tmpdir(), 'wreckyard-test-'));
    dirs.push(dist, into);
    mkdirSync(path.join(dist, 'server'));
    mkdirSync(path.join(dist, 'client', 'assets'), { recursive: true });
    mkdirSync(path.join(dist, 'other'));
    writeFileSync(path.join(dist, 'server', 'index.js'), '// server');
    writeFileSync(path.join(dist, 'client', 'index.html'), '<html></html>');
    writeFileSync(path.join(dist, 'client', 'assets', 'app.js'), '//');
    writeFileSync(path.join(dist, 'other', 'x.txt'), 'x');
    copyBundle(dist, into);
    expect(readdirSync(into)).toEqual(['dist']);
    expect(readdirSync(path.join(into, 'dist')).sort()).toEqual(['client', 'server']);
    expect(existsSync(path.join(into, 'dist', 'client', 'assets', 'app.js'))).toBe(true);
    expect(existsSync(path.join(into, 'node_modules'))).toBe(false);
  });
});
```

Create `tests/scripts/loadtest.test.ts`:

<!-- op {"kind": "create", "path": "tests/scripts/loadtest.test.ts"} -->
```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../../src/shared/physics';
import { createGameServer, type GameServer } from '../../src/server/app';
import { DEFAULT_LIMITS, evaluate, loadInput, runLoad, type LoadReport } from '../../scripts/lib/loadtest';

beforeAll(async () => {
  await initPhysics();
});

let app: GameServer | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

const good: LoadReport = {
  wanted: 80,
  seated: 80,
  refused: 0,
  peakRooms: 10,
  peakPlayers: 80,
  unexpectedCloses: 0,
  errors: 0,
  snapshotHzMin: 29.5,
  snapshotHzAvg: 30,
  roundsSeen: 40,
  samples: [{ at: 5, rooms: 10, players: 80, connections: 80, tickMsP99: 2.1, rssMb: 200, heapMb: 60 }],
  tickMsP99Max: 2.1,
  rssStartMb: 200,
  rssEndMb: 215,
};

describe('evaluate', () => {
  it('passes a healthy run', () => {
    expect(evaluate(good)).toEqual([]);
  });

  it('names every limit that a run breaks', () => {
    const bad: LoadReport = { ...good, seated: 70, refused: 10, tickMsP99Max: 9.3, rssEndMb: 400, snapshotHzMin: 12, unexpectedCloses: 2, errors: 3, samples: [] };
    const failures = evaluate(bad).join('\n');
    expect(failures).toMatch(/only 70 of 80 players got a seat \(10 refused\)/);
    expect(failures).toMatch(/tick p99 reached 9.3 ms \(limit 4 ms\)/);
    expect(failures).toMatch(/memory grew by 200.0 MB/);
    expect(failures).toMatch(/slowest player got 12.0 snapshots\/s/);
    expect(failures).toMatch(/2 sockets were closed by the server/);
    expect(failures).toMatch(/3 error messages/);
    expect(failures).toMatch(/no health samples/);
  });

  it('applies the limits it is given, and the spec\'s targets by default', () => {
    expect(DEFAULT_LIMITS).toEqual({ tickMsP99: 4, rssGrowthMb: 50, minSnapshotHz: 25 });
    expect(evaluate({ ...good, tickMsP99Max: 6 }, { ...DEFAULT_LIMITS, tickMsP99: 8 })).toEqual([]);
    expect(evaluate({ ...good, rssEndMb: 230 })).toEqual([]); // 30 MB of growth is inside the 50 MB allowance
  });
});

describe('loadInput', () => {
  it('drives forward with a weaving steer, and backs out for one second in nine', () => {
    const forward = loadInput(0, 2);
    expect(forward.throttle).toBe(1);
    expect(Math.abs(forward.steer)).toBeLessThanOrEqual(0.9);
    expect(loadInput(0, 8.5)).toMatchObject({ throttle: -1 });
    expect(loadInput(0, 9.5).throttle).toBe(1);
    const steers = new Set([0, 1, 2, 3, 4].map((i) => loadInput(i, 3).steer.toFixed(3)));
    expect(steers.size).toBe(5); // the players do not all steer alike
  });
});

describe('runLoad', () => {
  it('fills rooms, keeps them driving and reports what the server said about itself', async () => {
    app = createGameServer({ maxRooms: 4, botFill: 0, rules: { countdownTicks: 20, liveTicks: 300, resultsTicks: 30 } });
    const port = await app.listen(0, '127.0.0.1');
    const lines: string[] = [];
    const report = await runLoad({ url: `ws://127.0.0.1:${port}/ws`, rooms: 2, perRoom: 3, seconds: 3, warmupSeconds: 1, sampleSeconds: 0.5, log: (l) => lines.push(l) });
    expect(report).toMatchObject({ wanted: 6, seated: 6, refused: 0, peakRooms: 2, peakPlayers: 6, unexpectedCloses: 0, errors: 0 });
    expect(report.snapshotHzMin).toBeGreaterThan(5); // about 30 on a quiet machine; this is a wiring test, so a busy one must not fail it
    expect(report.samples.length).toBeGreaterThanOrEqual(4);
    expect(report.rssStartMb).toBeGreaterThan(0);
    expect(lines.some((l) => l.startsWith('t='))).toBe(true);
    // how fast the machine is (tick time, snapshot rate) is not what this test is about: only that nobody was refused or hung up on
    expect(evaluate(report, { tickMsP99: 60_000, rssGrowthMb: 500, minSnapshotHz: 0 })).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(app.lobby.playerCount).toBe(0); // everybody left when the run ended
  });

  it('counts the players a full server turns away, and says so', async () => {
    app = createGameServer({ maxRooms: 1, botFill: 0 });
    const port = await app.listen(0, '127.0.0.1');
    const report = await runLoad({ url: `ws://127.0.0.1:${port}/ws`, rooms: 2, perRoom: 1, seconds: 1, warmupSeconds: 0, sampleSeconds: 0.5 });
    expect(report).toMatchObject({ wanted: 2, seated: 1, refused: 1 });
    expect(evaluate(report, { tickMsP99: 50, rssGrowthMb: 500, minSnapshotHz: 0 }).join('\n')).toMatch(/only 1 of 2 players got a seat \(1 refused\)/);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/scripts/e2e.test.ts tests/scripts/loadtest.test.ts`
Expected: FAIL — the helper modules do not exist

<!-- check {"cmd": "npx vitest run tests/scripts/e2e.test.ts tests/scripts/loadtest.test.ts", "outcome": "fail", "match": "Cannot find module|FAIL|not a function|Failed"} -->

- [ ] **Step 3: Write the helpers, the load test and the smoke check**

`scripts/lib/e2e.ts`:

Create `scripts/lib/e2e.ts`:

<!-- op {"kind": "create", "path": "scripts/lib/e2e.ts"} -->
```ts
// Helpers shared by the end-to-end scripts (smoke check, load test): a minimal protocol client and the packaged-bundle copy.
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { WebSocket, type RawData } from 'ws';
import { NET } from '../../src/shared/constants';
import { parseServerMessage, type HelloMessage, type ServerMessage, type WelcomeMessage } from '../../src/shared/protocol';

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const toBytes = (data: RawData): Uint8Array => {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
};

export const parseText = (data: RawData): ServerMessage | null => parseServerMessage(new TextDecoder().decode(toBytes(data)));

/** Opens a socket, says hello and resolves with the socket and the server's welcome. Rejects on an error message, an early close or a timeout. */
export function joinRoom(url: string, hello: Pick<HelloMessage, 'mode'> & Partial<HelloMessage>, timeoutMs = 10_000): Promise<{ ws: WebSocket; welcome: WelcomeMessage }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const fail = (why: string): void => {
      clearTimeout(timer);
      ws.terminate();
      reject(new Error(why));
    };
    const timer = setTimeout(() => fail(`no welcome from ${url} within ${timeoutMs} ms`), timeoutMs);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: NET.PROTOCOL_VERSION, name: 'e2e', color: 0x2b7fd8, ...hello })));
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const msg = parseText(data);
      if (msg?.t === 'welcome') {
        clearTimeout(timer);
        ws.removeAllListeners('message');
        resolve({ ws, welcome: msg });
      } else if (msg?.t === 'error') {
        fail(`${msg.code}: ${msg.message}`);
      }
    });
    ws.on('close', () => fail('closed before the welcome'));
    ws.on('error', (err) => fail(err.message));
  });
}

/** Creates a private room, leaves it again and returns its code. */
export async function createRoom(url: string): Promise<string> {
  const { ws, welcome } = await joinRoom(url, { mode: 'create' });
  ws.close();
  return welcome.room.code;
}

/**
 * Copies the built game (`dist/server` and `dist/client`) into `into` and nothing else, the way the container image holds it:
 * no `node_modules`, no sources. Running `node dist/server/index.js` from `into` shows whether the bundle stands on its own.
 */
export function copyBundle(distDir: string, into: string): void {
  for (const part of ['server', 'client']) {
    mkdirSync(path.join(into, 'dist'), { recursive: true });
    cpSync(path.join(distDir, part), path.join(into, 'dist', part), { recursive: true });
  }
}
```

`scripts/lib/loadtest.ts` (10 rooms of 8 by default: one player creates each room, the others join by its code; every player sends inputs at 60 Hz, `/healthz` is sampled, and the report is judged against limits):

Create `scripts/lib/loadtest.ts`:

<!-- op {"kind": "create", "path": "scripts/lib/loadtest.ts"} -->
```ts
// A load test that plays many rooms at once against a running server and reports how the server held up.
import { WebSocket } from 'ws';
import type { CarInput } from '../../src/shared/input';
import { encodeInput } from '../../src/shared/protocol';
import { joinRoom, parseText, sleep } from './e2e';

export interface LoadOptions {
  /** The server's WebSocket address, for example ws://127.0.0.1:8080/ws. */
  url: string;
  /** Where /healthz answers; by default the same host and port as `url`. */
  healthUrl?: string;
  rooms: number;
  /** Players per room, 1 to 8. */
  perRoom: number;
  /** How long the players keep driving once everybody is in. */
  seconds: number;
  /** Health samples taken before this many seconds are left out of the memory comparison, so start-up growth does not count. */
  warmupSeconds: number;
  sampleSeconds: number;
  log?: (line: string) => void;
}

export interface HealthSample {
  /** Seconds since the players were all in. */
  at: number;
  rooms: number;
  players: number;
  connections: number;
  tickMsP99: number;
  rssMb: number;
  heapMb: number;
}

export interface LoadReport {
  wanted: number;
  seated: number;
  refused: number;
  peakRooms: number;
  peakPlayers: number;
  /** Sockets the server closed while the test was still running. */
  unexpectedCloses: number;
  errors: number;
  snapshotHzMin: number;
  snapshotHzAvg: number;
  roundsSeen: number;
  samples: HealthSample[];
  tickMsP99Max: number;
  rssStartMb: number;
  rssEndMb: number;
}

export interface LoadLimits {
  /** The server's 99th-percentile time for one 60 Hz step of all its rooms, in milliseconds. */
  tickMsP99: number;
  /** How much the resident memory may grow between the end of the warm-up and the end of the run. */
  rssGrowthMb: number;
  minSnapshotHz: number;
}

/** The spec's targets: p99 tick 4 ms or better and flat memory; a client should still get about 30 snapshots a second. */
export const DEFAULT_LIMITS: Readonly<LoadLimits> = { tickMsP99: 4, rssGrowthMb: 50, minSnapshotHz: 25 };

/** What one player sends at time `elapsed` (seconds): full throttle with a weaving steer, reversing for one second in nine to leave a wall. */
export function loadInput(index: number, elapsed: number): CarInput {
  const steer = Math.sin(elapsed * (0.5 + 0.13 * (index % 5)) + index) * 0.9;
  if ((elapsed + index * 1.3) % 9 > 8) return { throttle: -1, steer: -steer, handbrake: false };
  return { throttle: 1, steer, handbrake: false };
}

/** The reasons a run fails the limits; empty when it passes. */
export function evaluate(report: LoadReport, limits: LoadLimits = DEFAULT_LIMITS): string[] {
  const failures: string[] = [];
  if (report.seated < report.wanted) failures.push(`only ${report.seated} of ${report.wanted} players got a seat (${report.refused} refused)`);
  if (report.tickMsP99Max > limits.tickMsP99) failures.push(`tick p99 reached ${report.tickMsP99Max} ms (limit ${limits.tickMsP99} ms)`);
  const growth = report.rssEndMb - report.rssStartMb;
  if (growth > limits.rssGrowthMb) failures.push(`memory grew by ${growth.toFixed(1)} MB after the warm-up (limit ${limits.rssGrowthMb} MB)`);
  if (report.seated > 0 && report.snapshotHzMin < limits.minSnapshotHz) failures.push(`the slowest player got ${report.snapshotHzMin.toFixed(1)} snapshots/s (limit ${limits.minSnapshotHz})`);
  if (report.unexpectedCloses > 0) failures.push(`${report.unexpectedCloses} sockets were closed by the server`);
  if (report.errors > 0) failures.push(`${report.errors} error messages from the server`);
  if (report.samples.length === 0) failures.push('no health samples could be read');
  return failures;
}

interface Player {
  index: number;
  ws: WebSocket;
  seq: number;
  snapshots: number;
  closedEarly: boolean;
  finished: boolean;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

async function readHealth(healthUrl: string, at: number): Promise<HealthSample | null> {
  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
    const h = (await res.json()) as Record<string, number>;
    return { at, rooms: h.rooms ?? 0, players: h.players ?? 0, connections: h.connections ?? 0, tickMsP99: h.tickMsP99 ?? 0, rssMb: h.rssMb ?? 0, heapMb: h.heapMb ?? 0 };
  } catch {
    return null;
  }
}

export async function runLoad(options: LoadOptions): Promise<LoadReport> {
  const log = options.log ?? (() => undefined);
  const healthUrl = options.healthUrl ?? `${options.url.replace(/^ws/, 'http').replace(/\/ws$/, '')}/healthz`;
  const players: Player[] = [];
  let refused = 0;
  let errors = 0;
  let rounds = 0;

  const enter = async (hello: Parameters<typeof joinRoom>[1], first: boolean): Promise<string | null> => {
    try {
      const { ws, welcome } = await joinRoom(options.url, hello);
      const player: Player = { index: players.length, ws, seq: 0, snapshots: 0, closedEarly: false, finished: false };
      players.push(player);
      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          player.snapshots++;
          return;
        }
        const msg = parseText(data);
        if (msg?.t === 'error') errors++;
        else if (msg?.t === 'results' && first) rounds++;
      });
      ws.on('close', () => {
        if (!player.finished) player.closedEarly = true;
      });
      return welcome.room.code;
    } catch (err) {
      refused++;
      log(`refused: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  };

  // one room at a time (its host creates it, the others join by code), a little apart so a server with limits is not hit all at once
  for (let room = 0; room < options.rooms; room++) {
    const code = await enter({ mode: 'create', name: `Load ${room}.0` }, true);
    if (code === null) continue;
    for (let i = 1; i < options.perRoom; i++) await enter({ mode: 'join', code, name: `Load ${room}.${i}` }, false);
    await sleep(20);
  }
  log(`${players.length} of ${options.rooms * options.perRoom} players are in`);

  const startedAt = Date.now();
  const pump = setInterval(() => {
    const elapsed = (Date.now() - startedAt) / 1000;
    for (const p of players) {
      if (p.ws.readyState !== WebSocket.OPEN) continue;
      p.seq = (p.seq + 1) >>> 0;
      p.ws.send(encodeInput(p.seq, loadInput(p.index, elapsed)));
    }
  }, 1000 / 60);

  const samples: HealthSample[] = [];
  let peakRooms = 0;
  let peakPlayers = 0;
  const sample = async (): Promise<void> => {
    const s = await readHealth(healthUrl, round1((Date.now() - startedAt) / 1000));
    if (!s) return;
    samples.push(s);
    peakRooms = Math.max(peakRooms, s.rooms);
    peakPlayers = Math.max(peakPlayers, s.players);
    log(`t=${s.at}s rooms=${s.rooms} players=${s.players} tickP99=${s.tickMsP99} ms rss=${s.rssMb} MB heap=${s.heapMb} MB`);
  };
  await sample();
  const sampler = setInterval(() => void sample(), options.sampleSeconds * 1000);
  await sleep(options.seconds * 1000);
  clearInterval(sampler);
  clearInterval(pump);
  const elapsed = (Date.now() - startedAt) / 1000;
  await sample();

  const unexpectedCloses = players.filter((p) => p.closedEarly).length;
  const rates = players.map((p) => p.snapshots / elapsed);
  for (const p of players) {
    p.finished = true;
    p.ws.close();
  }
  await sleep(200);
  const measured = samples.filter((s) => s.at >= options.warmupSeconds);
  return {
    wanted: options.rooms * options.perRoom,
    seated: players.length,
    refused,
    peakRooms,
    peakPlayers,
    unexpectedCloses,
    errors,
    snapshotHzMin: round1(rates.length ? Math.min(...rates) : 0),
    snapshotHzAvg: round1(rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0),
    roundsSeen: rounds,
    samples,
    tickMsP99Max: measured.length ? Math.max(...measured.map((s) => s.tickMsP99)) : 0,
    rssStartMb: measured[0]?.rssMb ?? 0,
    rssEndMb: measured.at(-1)?.rssMb ?? 0,
  };
}
```

`scripts/loadtest.ts`, the command line:

Create `scripts/loadtest.ts`:

<!-- op {"kind": "create", "path": "scripts/loadtest.ts"} -->
```ts
// Plays many rooms at once against a running server and says whether it held up.
//   npx tsx scripts/loadtest.ts [--url ws://127.0.0.1:8080/ws] [--rooms 10] [--per-room 8] [--seconds 300] [--warmup 60]
//                               [--sample 5] [--max-tick-ms 4] [--max-rss-growth-mb 50] [--min-snapshot-hz 25]
// Start the server first, with short rounds so the rooms keep cycling and no per-address limit in the way, for example:
//   MAX_ROOMS=12 BOT_FILL=0 MAX_CONNECTIONS_PER_IP=0 COUNTDOWN_SECONDS=3 ROUND_SECONDS=30 RESULTS_SECONDS=5 npm start
import { DEFAULT_LIMITS, evaluate, runLoad } from './lib/loadtest';

function arg(name: string, fallback: number | string): string {
  const i = process.argv.indexOf(`--${name}`);
  return (i >= 0 ? process.argv[i + 1] : undefined) ?? String(fallback);
}
const number = (name: string, fallback: number): number => {
  const n = Number(arg(name, fallback));
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} must be a positive number`);
  return n;
};

const options = {
  url: arg('url', 'ws://127.0.0.1:8080/ws'),
  rooms: Math.floor(number('rooms', 10)),
  perRoom: Math.min(8, Math.floor(number('per-room', 8))),
  seconds: number('seconds', 300),
  warmupSeconds: number('warmup', 60),
  sampleSeconds: number('sample', 5),
  log: (line: string) => console.log(line),
};
const limits = {
  tickMsP99: number('max-tick-ms', DEFAULT_LIMITS.tickMsP99),
  rssGrowthMb: number('max-rss-growth-mb', DEFAULT_LIMITS.rssGrowthMb),
  minSnapshotHz: number('min-snapshot-hz', DEFAULT_LIMITS.minSnapshotHz),
};

console.log(`load test: ${options.rooms} rooms x ${options.perRoom} players for ${options.seconds} s against ${options.url}`);
const report = await runLoad(options);
const { samples, ...summary } = report;
console.log(JSON.stringify(summary, null, 2));
const failures = evaluate(report, limits);
if (failures.length === 0) {
  console.log('PASS');
} else {
  console.log(`FAIL\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
}
```

`scripts/smoke-e2e.ts` replaces `scripts/smoke-e2e.mjs`: the same two checks, but the bundle is now run from an empty folder (no `node_modules`), and the protocol version is the constant:

Create `scripts/smoke-e2e.ts`:

<!-- op {"kind": "create", "path": "scripts/smoke-e2e.ts"} -->
```ts
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
```

Delete `scripts/smoke-e2e.mjs`:

<!-- op {"kind": "delete", "path": "scripts/smoke-e2e.mjs"} -->
```bash
git rm scripts/smoke-e2e.mjs
```

In `package.json`, the scripts:

<!-- op {"kind": "edit", "path": "package.json"} -->
```json
    "typecheck": "tsc -p tsconfig.client.json && tsc -p tsconfig.server.json && tsc -p tsconfig.test.json",
    "smoke": "node scripts/smoke-e2e.mjs",
    "hash": "tsx scripts/hash.ts"
```

with:

```json
    "typecheck": "tsc -p tsconfig.client.json && tsc -p tsconfig.server.json && tsc -p tsconfig.test.json",
    "smoke": "tsx scripts/smoke-e2e.ts",
    "loadtest": "tsx scripts/loadtest.ts",
    "hash": "tsx scripts/hash.ts"
```

- [ ] **Step 4: Run the tests, then the whole suite**

Run: `npx vitest run tests/scripts`
Expected: the script tests pass

<!-- check {"cmd": "npx vitest run tests/scripts", "outcome": "pass"} -->

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 663} -->

- [ ] **Step 5: Run the smoke check for real**

It needs the build, and it starts a Vite dev server, so give it ports of its own with the `SMOKE_*_PORT` variables:

Run: `npm run build && SMOKE_PROD_PORT=18197 SMOKE_SERVER_PORT=18198 SMOKE_VITE_PORT=18199 npm run smoke`
Expected: both lines start with `OK`: `packaged bundle (no node_modules)` and `dev flow`

<!-- check {"cmd": "npm run build && SMOKE_PROD_PORT=18197 SMOKE_SERVER_PORT=18198 SMOKE_VITE_PORT=18199 npm run smoke", "outcome": "pass", "match": "OK   packaged bundle \\(no node_modules\\)[^\\n]*\\n[^\\n]*OK   dev flow"} -->

- [ ] **Step 6: Run the load test for real, once**

Start a server for it with short rounds (so the rooms keep cycling through countdown, live and results) and no per-address limit, on a private port: `MAX_ROOMS=12 BOT_FILL=0 MAX_CONNECTIONS_PER_IP=0 COUNTDOWN_SECONDS=3 ROUND_SECONDS=30 RESULTS_SECONDS=5 PORT=18097 node dist/server/index.js`. Then `npx tsx scripts/loadtest.ts --url ws://127.0.0.1:18097/ws --rooms 10 --per-room 8 --seconds 300 --warmup 60 --sample 10` (five minutes). Expected: `80 of 80 players are in`, `seated 80`, `refused 0`, `unexpectedCloses 0`, `errors 0`, `snapshotHzMin` about 30, and the memory numbers flat after the warm-up. **The tick p99 depends on the host:** the spec's target is 4 ms; on a busy laptop it reads much higher while the server is mostly idle (see the scope notes), so read `tickMsP99Max` next to the machine's load and pass `--max-tick-ms` for what you mean to hold a host to. Write the whole summary in the ledger, stop the server, and keep the numbers for the final report.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(scripts): a load test for many rooms and a smoke check that runs the bundle from an empty folder"
```

<!-- commit "feat(scripts): a load test for many rooms and a smoke check that runs the bundle from an empty folder" -->

---

### Task 53: The container image, CLAUDE.md and the README

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `CLAUDE.md`, `tests/packaging.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `npm run build` (Vite for the client, `scripts/build-server.mjs` for the bundle), `readConfig` (the environment variables).
- Produces: An image that holds `dist/` only and runs as the `node` user with a health check; a guard-rail test that holds the Dockerfile and `.dockerignore` to what the build needs; the docs for the settings, the limits, Docker, the load test and the new environment variables.

- [ ] **Step 1: Write the packaging test**

The image cannot be built in every environment (the daemon was not running where this plan was written), so this test reads the Dockerfile and `.dockerignore` and holds them to what the game needs: two stages on `node:24-slim`; every file the build stage copies exists and is not excluded by `.dockerignore`; everything the build scripts read is copied (`package.json`, `package-lock.json`, `vite.config.ts`, `scripts/build-server.mjs`, `src`, a tsconfig); dependencies are installed from the lock file before the sources arrive (so a code change keeps that layer cached); the run stage takes `dist` from the build and installs nothing; it runs as `node`, exposes 8080 and has a health check on `/healthz`; and `.dockerignore` keeps out `node_modules`, `dist`, `.git`, the working notes and secrets.

Create `tests/packaging.test.ts`:

<!-- op {"kind": "create", "path": "tests/packaging.test.ts"} -->
```ts
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The container image cannot be built in every environment, so these tests read the Dockerfile and hold it to what the game needs.
const dockerfile = readFileSync('Dockerfile', 'utf8');
const ignore = readFileSync('.dockerignore', 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string>; engines: { node: string } };

/** The instructions of each stage, with line continuations joined. */
function stages(): Array<{ name: string; from: string; lines: string[] }> {
  const joined = dockerfile.replace(/\\\n\s*/g, ' ').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const out: Array<{ name: string; from: string; lines: string[] }> = [];
  for (const line of joined) {
    const from = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
    if (from) out.push({ name: from[2] ?? '', from: from[1]!, lines: [] });
    else out.at(-1)?.lines.push(line);
  }
  return out;
}

/** True when `.dockerignore` would keep `file` out of the build context (patterns: names, directories and `*` globs). */
function ignored(file: string): boolean {
  return ignore.some((pattern) => {
    const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}(/.*)?$`);
    return re.test(file);
  });
}

const copies = (lines: string[]): Array<{ from: string | null; sources: string[]; dest: string }> =>
  lines
    .filter((l) => /^COPY\s/i.test(l))
    .map((l) => {
      const parts = l.split(/\s+/).slice(1);
      const flag = parts[0]!.startsWith('--from=') ? parts.shift()!.slice('--from='.length) : null;
      return { from: flag, sources: parts.slice(0, -1), dest: parts.at(-1)! };
    });

describe('Dockerfile', () => {
  const [build, run] = stages();

  it('has a build stage and a run stage on the Node version the package supports', () => {
    expect(stages()).toHaveLength(2);
    expect(build!.name).toBe('build');
    expect(build!.from).toBe('node:24-slim');
    expect(run!.from).toBe('node:24-slim');
    expect(pkg.engines.node).toMatch(/22/); // 24 satisfies ">=22.12"
  });

  it('copies into the build only files that exist and that .dockerignore lets through', () => {
    const sources = copies(build!.lines).flatMap((c) => c.sources);
    expect(sources.length).toBeGreaterThan(5);
    for (const source of sources) {
      const file = source.replace(/\/$/, '');
      expect(existsSync(file), `${source} exists`).toBe(true);
      expect(ignored(file), `${source} is not ignored`).toBe(false);
    }
  });

  it('copies everything the build scripts read', () => {
    const sources = copies(build!.lines).flatMap((c) => c.sources);
    expect(pkg.scripts['build:client']).toBe('vite build');
    expect(pkg.scripts['build:server']).toBe('node scripts/build-server.mjs');
    for (const needed of ['package.json', 'package-lock.json', 'vite.config.ts', 'scripts/build-server.mjs', 'src']) expect(sources, needed).toContain(needed);
    expect(sources.filter((s) => s.startsWith('tsconfig')).length).toBeGreaterThanOrEqual(1);
  });

  it('installs dependencies from the lock file before the sources arrive, so a code change keeps that layer cached', () => {
    const lines = build!.lines;
    const install = lines.findIndex((l) => /^RUN\s+npm ci/i.test(l));
    const sourcesCopied = lines.findIndex((l) => /^COPY\s+src\b/i.test(l));
    expect(install).toBeGreaterThan(0);
    expect(sourcesCopied).toBeGreaterThan(install);
    expect(lines.some((l) => /^RUN\s+npm run build/i.test(l))).toBe(true);
  });

  it('runs the bundle alone: the run stage takes dist from the build and installs nothing', () => {
    const c = copies(run!.lines);
    expect(c).toEqual([{ from: 'build', sources: ['/app/dist'], dest: './dist' }]);
    expect(run!.lines.some((l) => /npm|node_modules/i.test(l.replace(/HEALTHCHECK.*/i, '')))).toBe(false);
    expect(run!.lines).toContain('CMD ["node", "dist/server/index.js"]');
  });

  it('runs as the unprivileged node user, listens on 8080 and checks /healthz', () => {
    expect(run!.lines).toContain('USER node');
    expect(run!.lines).toContain('EXPOSE 8080');
    expect(run!.lines.some((l) => /^ENV .*PORT=8080/.test(l))).toBe(true);
    expect(run!.lines.some((l) => /^HEALTHCHECK\b.*\/healthz/.test(l))).toBe(true);
  });
});

describe('.dockerignore', () => {
  it('keeps out dependencies, build output, history, secrets and the working notes', () => {
    for (const file of ['node_modules', 'dist', '.git', '.superpowers', '.playwright-mcp', '.env', '.env.local', 'debug.log', 'docs/x.md', 'tests/a.test.ts']) {
      expect(ignored(file), file).toBe(true);
    }
  });

  it('lets through everything the image build reads', () => {
    for (const file of ['package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.base.json', 'scripts/build-server.mjs', 'src/client/index.html', 'src/server/index.ts']) {
      expect(ignored(file), file).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/packaging.test.ts`
Expected: FAIL — there is no `Dockerfile` yet (ENOENT)

<!-- check {"cmd": "npx vitest run tests/packaging.test.ts", "outcome": "fail", "match": "ENOENT|FAIL"} -->

- [ ] **Step 3: Write the Dockerfile and .dockerignore**

Create `Dockerfile`:

<!-- op {"kind": "create", "path": "Dockerfile"} -->
```
# syntax=docker/dockerfile:1

# ---- build: compile the client (Vite) and bundle the server with its dependencies (esbuild) --------------------------
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.base.json tsconfig.client.json tsconfig.server.json tsconfig.test.json vite.config.ts ./
COPY scripts/build-server.mjs ./scripts/build-server.mjs
COPY src ./src
RUN npm run build

# ---- run: the bundle alone. It carries its own dependencies, so the image holds no node_modules ---------------------
FROM node:24-slim
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server/index.js"]
```

Create `.dockerignore`:

<!-- op {"kind": "create", "path": ".dockerignore"} -->
```
# Only what the build needs goes into the image build: package files, tsconfigs, vite.config.ts, src/ and scripts/build-server.mjs.
node_modules
dist
coverage
docs
tests
.git
.gitignore
.superpowers
.playwright-mcp
.env
.env.*
*.log
*.md
.DS_Store
Dockerfile
.dockerignore
```

- [ ] **Step 4: Write CLAUDE.md and update the README**

Create `CLAUDE.md`:

<!-- op {"kind": "create", "path": "CLAUDE.md"} -->
```markdown
# Wreckyard — notes for working in this repo

Online 3D demolition-derby arena for the browser: TypeScript, three.js, the deterministic build of Rapier on the server **and** the client, Node `ws`, Vite, Vitest. Design in `docs/superpowers/specs/`, one plan per milestone in `docs/superpowers/plans/`.

## Commands

- `npm run dev` — game server on :8080 and Vite on :5173 (proxies `/ws`). `npm test` — Vitest. `npm run typecheck` — `tsc` for client, server and tests.
- `npm run build` then `npm start` — the production bundle (`dist/server/index.js` carries its dependencies; `dist/client` is served by it).
- `npm run smoke` — runs the bundle from an empty folder (no `node_modules`) and the dev flow. `npm run loadtest` — many rooms against a running server (see the README). `npm run hash` — the determinism hash.

## Layout

- `src/shared` — what server and client must agree on: constants (all tuning), protocol, the simulation (`sim.ts`), vehicle, arena, damage.
- `src/server` — `lobby.ts` and `room.ts` (rounds), `round.ts` and `rules.ts` (damage, eliminations), `bots.ts`, `guard.ts` and `limits.ts` (abuse limits), `app.ts` (HTTP and WebSocket), `config.ts` (environment variables).
- `src/client` — `net/` (connection, prediction with rollback, interpolation; no DOM), `game/` (scene, cars, effects, audio, input; `matchState.ts` and the other DOM-free files are tested in Node), `ui/` (menu, HUD). `tests/` mirrors `src/`; `scripts/` holds the bot, load test and smoke check.

## Rules that keep the game consistent

- Axes: forward is +X, up is +Y, right is +Z. The simulation runs at a fixed 1/60 s. Inputs are quantized before they are applied, on both sides.
- The shared simulation is deterministic: no `Math.random`, `Date.now` or `performance.now` in `src/shared`. `npm run hash` must keep printing the same hash in Node and in a browser (`await __derby.simHash()`); if a change moves it, the change altered the physics on purpose or by mistake, so say so.
- Tuning lives only in `src/shared/constants.ts`; it is frozen at run time except in the offline `?sandbox`.
- Any change to what goes over the wire changes `NET.PROTOCOL_VERSION`; the server refuses other versions, and the scripts read the constant.
- Effects (dents, parts, particles, sound, shake) are cosmetic: they read server messages and snapshots and never touch the simulation or the rules.
- The client's local impacts come from the prediction's live tick, never from a replay (or they would fire twice).

## Working here

- Write the test first and watch it fail. Some timing tests can fail when the machine is busy (the suite runs about 600 tests in about a minute); rerun a lone failure before chasing it.
- WebGL pages only animate in a visible browser: check canvas behaviour with a real automation browser and `window.__derby.debug()`, not a hidden pane. The automation browser is capped at 50 frames a second, so judge cost by `frameMs`, draw calls and triangles.
- Never stop someone's running `npm run dev`. Start anything of your own on another port (18000 and up) and stop it when done.
- Merging, pushing and deploying are decisions for the owner; nothing here does them on its own.
```

In `README.md` (the commands, the environment variables, the controls, and new sections for the settings and for the limits, Docker and the load test):

<!-- op {"kind": "edit", "path": "README.md"} -->
```markdown
| `npm start` | run the bundled server (`PORT` env, default 8080) |
| `npm run smoke` | after `npm run build`: check the production bundle and the dev flow |

```

with:

```markdown
| `npm start` | run the bundled server (`PORT` env, default 8080) |
| `npm run smoke` | after `npm run build`: run the bundle from an empty folder (no `node_modules`) and the dev flow |
| `npm run loadtest` | play many rooms at once against a running server (see *Limits and load test*) |

```

In `README.md`, replace:

<!-- op {"kind": "edit", "path": "README.md"} -->
```markdown
- Play across your network: `npm run build && npm start`, then open `http://<your-LAN-IP>:8080/` on each device.
- Server configuration (environment variables): `PORT` (8080), `ALLOWED_ORIGINS` (comma-separated exact origins; default: same host only), `MAX_ROOMS` (12), `MAX_CONNECTIONS` (200), `STATIC_DIR` (`dist/client`), `BOT_FILL` (bots fill a room up to this many cars; default 4, 0 = none), `COUNTDOWN_SECONDS` (5), `ROUND_SECONDS` (240), `RESULTS_SECONDS` (8).
- Debugging: `window.__derby.debug()` in the browser console prints the connection, phase, roster and every car's pose, hit points and whether it is still running.
```

with:

```markdown
- Play across your network: `npm run build && npm start`, then open `http://<your-LAN-IP>:8080/` on each device.
- Server configuration (environment variables): `PORT` (8080), `ALLOWED_ORIGINS` (comma-separated exact origins; default: same host only), `MAX_ROOMS` (12), `MAX_CONNECTIONS` (200), `STATIC_DIR` (`dist/client`), `BOT_FILL` (bots fill a room up to this many cars; default 4, 0 = none), `COUNTDOWN_SECONDS` (5), `ROUND_SECONDS` (240), `RESULTS_SECONDS` (8), `MAX_CONNECTIONS_PER_IP` (16; 0 = no limit), `TRUST_PROXY` (how many reverse proxies stand in front of the server; default 0).
- Debugging: `window.__derby.debug()` in the browser console prints the connection, phase, roster and every car's pose, hit points and whether it is still running.
```

In `README.md`, replace:

<!-- op {"kind": "edit", "path": "README.md"} -->
```markdown
- Debugging: `window.__derby.debug()` in the browser console prints the connection, phase, roster and every car's pose, hit points and whether it is still running.
- `npm run smoke` uses ports 18080 (production bundle), 8080 (server) and 5173 (Vite). Set `SMOKE_PROD_PORT`, `SMOKE_SERVER_PORT` and `SMOKE_VITE_PORT` to run it next to a live `npm run dev`.

```

with:

```markdown
- Debugging: `window.__derby.debug()` in the browser console prints the connection, phase, roster and every car's pose, hit points and whether it is still running.
- `npm run smoke` uses ports 18080 (the bundle, run from a temporary folder with no `node_modules`), 8080 (server) and 5173 (Vite). Set `SMOKE_PROD_PORT`, `SMOKE_SERVER_PORT` and `SMOKE_VITE_PORT` to run it next to a live `npm run dev`.

```

In `README.md`, replace:

<!-- op {"kind": "edit", "path": "README.md"} -->
```markdown
- Tuning lives in `COMBAT` and `ROUND` in `src/shared/constants.ts`.
- The match screen shows the round clock and how many cars still run (top centre), the scoreboard (top right; hold **Tab** for kills and health), a kill feed under it, your health bar with the damage taken on each side of the car and your speed (bottom centre), a red flash when you are hit, and banners for the countdown, GO, being out and the results. Other cars carry their name and a health bar. **F3** shows the network line (mode, ping, frame rate, prediction error).
- When your car is out, or you joined a round that was already running, a camera orbits a car that is still running; **← → (or A/D, Q/E)** switches car. Your controls keep being sent while you watch, so the server does not drop you as inactive.

```

with:

```markdown
- Tuning lives in `COMBAT` and `ROUND` in `src/shared/constants.ts`.
- The match screen shows the round clock and how many cars still run (top centre), the scoreboard (top right; hold **Tab** for kills and health), a kill feed under it, your health bar with the damage taken on each side of the car and your speed (bottom centre), a red flash when you are hit, and banners for the countdown, GO, being out and the results. Other cars carry their name and a health bar. **F3** shows the network line (mode, ping, frame rate, prediction error); on a Mac keyboard it is **Fn+F3** unless the function keys are set to standard.
- When your car is out, or you joined a round that was already running, a camera orbits a car that is still running; **← → (or A/D, Q/E; the bumpers on a gamepad)** switches car. Your controls keep being sent while you watch, so the server does not drop you as inactive.

```

In `README.md`, replace:

<!-- op {"kind": "edit", "path": "README.md"} -->
```markdown
- F3's line shows the script time per frame; `window.__derby.debug()` reports the draw calls and triangles of the last frame and the number of live particles and pieces of debris.


```

with:

```markdown
- F3's line shows the script time per frame; `window.__derby.debug()` reports the draw calls and triangles of the last frame and the number of live particles and pieces of debris.


## Settings

- The menu has a **Graphics** choice, a **Volume** slider and a **Sound** switch. They are remembered in this browser. In a match **G** steps through the graphics presets and **M** mutes.
- **High** is the full look (pixel ratio up to 2, 2048 px shadows, glow, crowd, every effect, 40 pieces of debris). **Medium** draws fewer pixels (up to 1.5), sharpens shadows less, and emits 60 % of the particles and 24 pieces of debris. **Low** draws at pixel ratio 1 with no shadows, no glow and no crowd, 30 % of the particles and 12 pieces of debris.
- If the frame rate stays under 40 for about six seconds the game steps down one preset by itself and says so; it never steps up on its own, so it cannot flap. `?bloom=0` still switches the glow off whatever the preset.

## Limits, hosting and Docker

- Per address, the server allows 16 open sockets (`MAX_CONNECTIONS_PER_IP`), locks an address out for 30 s after 8 failed joins in a minute (a wrong or full room code), and lets it create 6 private rooms a minute. Loopback, link-local and private-network addresses are exempt, because behind a reverse proxy on the same machine every player looks like one of them. Behind reverse proxies, set `TRUST_PROXY` to how many there are (usually `1`) so the limits apply to the real addresses: the server then reads the address from `X-Forwarded-For` counting that many entries from the right, because entries further left can be forged by the client. A socket that floods binary input is closed; room codes come from the operating system's random source.
- Only same-host WebSocket origins are accepted unless `ALLOWED_ORIGINS` lists others (exact origins, comma-separated). `/healthz` answers with the room, player and connection counts, the 99th-percentile step time and the process memory.
- Docker: `docker build -t wreckyard .` then `docker run --rm -p 8080:8080 wreckyard`, and open http://localhost:8080/. The image holds only `dist/` (the bundle carries its own dependencies) and runs as the `node` user with a health check on `/healthz`. Pass the settings above with `-e`.
- Load test: start a server with short rounds and no per-address limit (`MAX_ROOMS=12 BOT_FILL=0 MAX_CONNECTIONS_PER_IP=0 COUNTDOWN_SECONDS=3 ROUND_SECONDS=30 RESULTS_SECONDS=5 npm start`), then `npm run loadtest -- --rooms 10 --per-room 8 --seconds 300`. It seats headless drivers in that many rooms, keeps them driving, samples `/healthz` and prints PASS or the limits it broke (step time, memory growth, snapshot rate, refused or closed sockets); `--help`-style options are listed at the top of `scripts/loadtest.ts`.

```

- [ ] **Step 5: Run the test, then the whole suite**

Run: `npx vitest run tests/packaging.test.ts`
Expected: passes

<!-- check {"cmd": "npx vitest run tests/packaging.test.ts", "outcome": "pass"} -->

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 671} -->

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: a container image that holds the built bundle only, CLAUDE.md, and the README for settings, limits, Docker and the load test"
```

<!-- commit "feat: a container image that holds the built bundle only, CLAUDE.md, and the README for settings, limits, Docker and the load test" -->

---

## Plan 7 done when

- [ ] `npm run typecheck`, `npm test` (671 tests), `npm run build` pass, `npm run smoke` passes (with the `SMOKE_*_PORT` variables next to a live `npm run dev`), and `npm run hash` still prints `10c3a72a`.
- [ ] The browser checks of Tasks 50 and 51 pass on a private port with eight bots (presets and antialiasing per preset, the settings panel and its persistence, `G`, the automatic step down, the HUD write count and layout), with no console errors.
- [ ] The full five-minute load test (Task 52) was run once and its numbers are in the ledger.
- [ ] **The user has run `docker build -t wreckyard . && docker run --rm -p 8080:8080 wreckyard`** on a machine with Docker and opened http://localhost:8080/ (the environment this plan was written in could not), **and has played it** and said whether the presets feel right on their machine.

**Known limits of this baseline:** the image was never built here; preset numbers and the 40 fps threshold are first guesses; the tick target of the load test depends on the host (see the scope notes); the per-address limits protect a public server from one address, not from a distributed flood (that needs the proxy or a CDN); there is no room-count or per-room capacity planning beyond `MAX_ROOMS`; the audio automation churn, the whole-canvas tyre-mark upload, zone totals for newcomers, debris through walls and big smoke puffs on GPUs with a small point-size limit (Plan 6's deferred minors) are still open.

**Next:** M7, the deploy — only with the user's explicit go-ahead and their hosting account.

## Changes made after the final review

The whole-branch review found no Critical problem and three Important ones; a fourth finding was re-graded up. All four are fixed on this branch in one commit, each test-first (680 tests; `npm run hash` still prints `10c3a72a`).

- **The input-flood hang-up only caught a burst** (`app.ts`, Task 46). It closed a socket after 300 dropped frames *in a row*, but the token bucket refills continuously, so a flood paced at 1 000 to 20 000 frames a second was never closed (the longest run of drops measured against the real bucket was 11 to 222), although the README said such a socket is closed. Drops are now counted per second (more than 200 over the limit within one second closes the socket) and the count starts over each second, so a client that overshoots now and then over a long session is never hung up on. The Task 46 text above shows the earlier rule.
- **An IPv6 client could dodge every limit** (`guard.ts`, Task 46). Records were keyed by the full address, so a client with a /64 prefix, which is what a provider gives every server and most home lines, could use a new address every time: unlimited sockets, wrong-code guesses and rooms, which is the Plan 2 finding this plan claims to close. Every address of one /64 now counts as one client (`guardKey`); `isPrivateAddress` still looks at the full address.
- **A full room counted as a wrong guess** (`app.ts`, Task 46; re-graded up from Minor). Somebody waiting for a seat who pressed Join eight times in a minute was locked out of the whole server for 30 s and told "Could not reach the game server". Only a room code that does not exist is a guess now: a full room exists, and the lockout is there to stop enumeration.
- **The README set an operator trap** (Task 53). `TRUST_PROXY` left at 0 behind a load balancer with a public address caps the whole game at `MAX_CONNECTIONS_PER_IP` sockets and lets one player's mistakes lock everybody out (behind a private-address proxy it silently switches every limit off); with a count and no proxy that appends to `X-Forwarded-For`, any client can write its own address. The README now says both, says IPv6 is limited per /64 and that a carrier-grade NAT or a campus needs a higher `MAX_CONNECTIONS_PER_IP`, and says to check `/healthz` after deploying; `tests/docs.test.ts` holds the README's numbers to the code's defaults.
- The review's other findings were left for the run's final report: a test gap in the countdown restart (two waiting visitors), an unreachable `!wasLive` guard, the automatic step down's warm-up being 2 s in the game rather than 5, a lockout that shuts out players behind a shared NAT, a misleading "could not reach the server" message for a refused socket, and a few nits in the static handler, the smoke script, the load test and the Dockerfile.
