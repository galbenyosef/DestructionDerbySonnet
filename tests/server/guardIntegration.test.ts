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
