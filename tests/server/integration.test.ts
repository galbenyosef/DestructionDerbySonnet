import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NET } from '../../src/shared/constants';
import { initPhysics } from '../../src/shared/physics';
import { encodeInput, type RosterMessage } from '../../src/shared/protocol';
import { createGameServer, originAllowed, type GameServer } from '../../src/server/app';
import { TestClient } from '../helpers/testClient';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const forward = { throttle: 1, steer: 0, handbrake: false };

let app: GameServer;
let port: number;
const clients: TestClient[] = [];
const connect = async (headers?: Record<string, string>): Promise<TestClient> => {
  const c = await TestClient.connect(port, headers);
  clients.push(c);
  return c;
};
const rosterWith = (c: TestClient, n: number) =>
  c.messages.find((m): m is RosterMessage => m.t === 'roster' && m.players.length === n);

beforeAll(async () => {
  await initPhysics();
});
beforeEach(async () => {
  app = createGameServer({ maxRooms: 6 });
  port = await app.listen(0, '127.0.0.1');
});
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await app.close();
});

describe('multiplayer flow', () => {
  it('puts two quick-play players in one room and streams movement at about 30 Hz', async () => {
    const a = await connect();
    const b = await connect();
    a.hello({ name: 'Ann' });
    b.hello({ name: 'Bob' });
    const wa = await a.waitFor(() => a.welcome(), 3000, 'welcome for A');
    const wb = await b.waitFor(() => b.welcome(), 3000, 'welcome for B');
    expect(wa.room.code).toBe(wb.room.code);
    expect(new Set([wa.you, wb.you])).toEqual(new Set([0, 1]));

    const roster = await b.waitFor(() => rosterWith(b, 2), 4000, 'roster with both players');
    await a.waitFor(() => rosterWith(a, 2), 4000, 'roster for A');
    await b.waitFor(() => b.snapshots.find((s) => s.epoch === roster.epoch && s.cars.length === 2), 3000, 'first snapshot');

    const n0 = b.snapshots.length;
    const t0 = Date.now();
    await a.drive(forward, 1500);
    const seconds = (Date.now() - t0) / 1000;
    const rate = (b.snapshots.length - n0) / seconds;
    expect(rate).toBeGreaterThan(20);
    expect(rate).toBeLessThan(40);

    const inEpoch = b.snapshots.filter((s) => s.epoch === roster.epoch);
    const start = inEpoch[0]!.cars.find((c) => c.slot === wa.you)!.state.pos;
    const end = inEpoch[inEpoch.length - 1]!.cars.find((c) => c.slot === wa.you)!.state.pos;
    expect(Math.hypot(end.x - start.x, end.z - start.z)).toBeGreaterThan(3); // B sees A's car move
    const lastForA = a.snapshots[a.snapshots.length - 1]!;
    expect(lastForA.ackSeq).toBeGreaterThan(a.seq - 40); // the server keeps consuming A's inputs
  });

  it('creates private rooms and lets others join by case-insensitive code', async () => {
    const a = await connect();
    a.hello({ mode: 'create' });
    const wa = await a.waitFor(() => a.welcome());
    expect(wa.room.public).toBe(false);
    expect(wa.room.code).toMatch(/^[A-Z]{4}$/);

    const b = await connect();
    b.hello({ mode: 'join', code: wa.room.code.toLowerCase() });
    const wb = await b.waitFor(() => b.welcome());
    expect(wb.room.code).toBe(wa.room.code);
    expect(wb.you).toBe(1);

    const c = await connect();
    c.hello({ mode: 'join', code: 'ZZZZ' });
    expect(await c.waitFor(() => c.errors()[0])).toMatchObject({ code: 'room_not_found' });
    const d = await connect();
    d.hello({ mode: 'join', code: 'ROOM' }); // 'O' is not in the alphabet, so no such code can exist
    expect(await d.waitFor(() => d.errors()[0])).toMatchObject({ code: 'room_not_found' });

    c.hello({ mode: 'join', code: wa.room.code }); // a failed joiner can retry on the same socket
    await c.waitFor(() => c.welcome());
  });

  it('reports room_full for a 9th player in a private room', async () => {
    const host = await connect();
    host.hello({ mode: 'create' });
    const { room } = await host.waitFor(() => host.welcome());
    for (let i = 1; i < 8; i++) {
      const c = await connect();
      c.hello({ mode: 'join', code: room.code });
      await c.waitFor(() => c.welcome());
    }
    const ninth = await connect();
    ninth.hello({ mode: 'join', code: room.code });
    expect(await ninth.waitFor(() => ninth.errors()[0])).toMatchObject({ code: 'room_full' });
  });

  it('frees seats on disconnect and disposes rooms that become empty', async () => {
    const a = await connect();
    const b = await connect();
    a.hello();
    b.hello();
    await a.waitFor(() => a.welcome());
    await b.waitFor(() => b.welcome());
    await b.waitFor(() => rosterWith(b, 2), 4000, 'both seated');
    a.close();
    await b.waitFor(() => rosterWith(b, 1), 4000, 'roster after A left');
    expect(app.lobby.playerCount).toBe(1);
    b.close();
    const t0 = Date.now();
    while (app.lobby.roomCount > 0 && Date.now() - t0 < 3000) await sleep(20);
    expect(app.lobby.roomCount).toBe(0);
  });

  it('neutralises a car whose player stops sending input', async () => {
    const a = await connect();
    a.hello();
    const w = await a.waitFor(() => a.welcome());
    const roster = await a.waitFor(() => rosterWith(a, 1), 4000, 'roster');
    await a.drive(forward, 300);
    await sleep(1200);
    const last = await a.waitFor(() => a.snapshots.filter((s) => s.epoch === roster.epoch).at(-1));
    expect(last.cars.find((c) => c.slot === w.you)!.throttle).toBe(0);
  });
});

describe('hostile and broken clients', () => {
  it('survives garbage without affecting other players', async () => {
    const good = await connect();
    good.hello();
    await good.waitFor(() => good.welcome());

    const evil = await connect();
    evil.sendRaw(encodeInput(1, forward)); // binary before hello: silently ignored
    evil.sendRaw('this is not json');
    expect(await evil.waitFor(() => evil.errors()[0])).toMatchObject({ code: 'bad_message' });
    evil.sendRaw(JSON.stringify({ t: 'hello', v: NET.PROTOCOL_VERSION, name: 5, color: 'red', mode: 'quick' })); // wrong types
    await evil.waitFor(() => evil.errors().length >= 2, 2000, 'second error');
    evil.hello({ v: 99 }); // wrong protocol version
    await evil.waitFor(() => evil.errors().find((e) => e.code === 'bad_version'), 2000, 'bad_version');
    await evil.waitFor(() => evil.closed, 2000, 'close after bad version');

    const big = await connect();
    big.sendRaw(new Uint8Array(4096)); // over maxPayload
    await big.waitFor(() => big.closed, 3000, 'close after oversize frame');

    const twice = await connect();
    twice.hello();
    await twice.waitFor(() => twice.welcome());
    twice.hello();
    expect(await twice.waitFor(() => twice.errors()[0])).toMatchObject({ code: 'already_joined' });

    expect(good.closed).toBeNull();
    const health = (await (await fetch(`http://127.0.0.1:${port}/healthz`)).json()) as { ok: boolean };
    expect(health.ok).toBe(true);
  });

  it('closes connections that flood text messages', async () => {
    const c = await connect();
    for (let i = 0; i < 60; i++) c.sendRaw(JSON.stringify({ t: 'ping', id: i, c: 0 }));
    await c.waitFor(() => c.closed, 3000, 'close after flood');
    expect(c.errors().some((e) => e.code === 'rate_limited')).toBe(true);
  });

  it('rejects browser origins that do not match the host', async () => {
    await expect(TestClient.connect(port, { Origin: 'http://evil.example' })).rejects.toThrow();
    const ok = await connect({ Origin: `http://127.0.0.1:${port}` });
    ok.hello();
    await ok.waitFor(() => ok.welcome());
  });

  it('drops sockets that never say hello, freeing their connection slot, and leaves talkative ones alone', async () => {
    const quick = createGameServer({ helloTimeoutMs: 150 });
    const p = await quick.listen(0, '127.0.0.1');
    const idle = await TestClient.connect(p);
    const chatty = await TestClient.connect(p);
    chatty.hello();
    await chatty.waitFor(() => chatty.welcome(), 3000, 'welcome for the talkative client');
    await idle.waitFor(() => idle.closed, 3000, 'close of the silent socket');
    expect(idle.closed).toMatchObject({ code: 1008 });
    expect(chatty.closed).toBeNull();
    expect(quick.stats().connections).toBe(1);
    chatty.close();
    await quick.close();
  });

  it('refuses connections beyond the connection limit', async () => {
    const small = createGameServer({ maxConnections: 2 });
    const p = await small.listen(0, '127.0.0.1');
    const c1 = await TestClient.connect(p);
    const c2 = await TestClient.connect(p);
    await expect(TestClient.connect(p)).rejects.toThrow();
    c1.close();
    c2.close();
    await small.close();
  });
});

describe('http endpoints', () => {
  it('serves /healthz with live stats and 404 for everything else', async () => {
    const a = await connect();
    a.hello();
    await a.waitFor(() => a.welcome());
    const health = (await (await fetch(`http://127.0.0.1:${port}/healthz`)).json()) as Record<string, unknown>;
    expect(health).toMatchObject({ ok: true, rooms: 1, players: 1, connections: 1 });
    expect(typeof health.tickMsP99).toBe('number');
    const missing = await fetch(`http://127.0.0.1:${port}/nope`);
    expect(missing.status).toBe(404);
  });
});

describe('originAllowed', () => {
  it('allows a missing Origin (non-browser clients)', () => {
    expect(originAllowed(undefined, 'localhost:8080')).toBe(true);
  });
  it('is same-host only by default', () => {
    expect(originAllowed('http://localhost:5173', 'localhost:5173')).toBe(true);
    expect(originAllowed('http://evil.example', 'localhost:5173')).toBe(false);
  });
  it('honours an explicit allow-list', () => {
    const allowed = ['https://play.example.com'];
    expect(originAllowed('https://play.example.com', 'game.internal', allowed)).toBe(true);
    expect(originAllowed('https://other.example.com', 'game.internal', allowed)).toBe(false);
  });
  it('rejects unparsable origins', () => {
    expect(originAllowed('not a url', 'localhost')).toBe(false);
  });
});
