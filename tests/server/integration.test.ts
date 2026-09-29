import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NET } from '../../src/shared/constants';
import { initPhysics } from '../../src/shared/physics';
import { encodeInput, type PhaseMessage, type RosterMessage } from '../../src/shared/protocol';
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
const goesLive = (c: TestClient) => c.messages.find((m): m is PhaseMessage => m.t === 'phase' && m.phase === 'live');

beforeAll(async () => {
  await initPhysics();
});
beforeEach(async () => {
  app = createGameServer({ maxRooms: 6, botFill: 0, rules: { countdownTicks: 30, liveTicks: 6000, resultsTicks: 60 } });
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

    // both joined during the first countdown, so both get a car in the same round
    const roster = await b.waitFor(() => rosterWith(b, 2), 4000, 'roster with both players');
    const rosterA = await a.waitFor(() => rosterWith(a, 2), 4000, 'roster for A');
    expect(new Set([rosterA.you, roster.you])).toEqual(new Set([0, 1]));
    expect(rosterA.epoch).toBe(roster.epoch);
    await b.waitFor(() => goesLive(b), 3000, 'the round to go live');
    await b.waitFor(() => b.snapshots.find((s) => s.epoch === roster.epoch && s.cars.length === 2), 3000, 'first snapshot');

    const n0 = b.snapshots.length;
    const t0 = Date.now();
    await a.drive(forward, 1500);
    const seconds = (Date.now() - t0) / 1000;
    const rate = (b.snapshots.length - n0) / seconds;
    expect(rate).toBeGreaterThan(20);
    expect(rate).toBeLessThan(40);

    const inEpoch = b.snapshots.filter((s) => s.epoch === roster.epoch);
    const start = inEpoch[0]!.cars.find((c) => c.slot === rosterA.you)!.state.pos;
    const end = inEpoch[inEpoch.length - 1]!.cars.find((c) => c.slot === rosterA.you)!.state.pos;
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
    expect(wb.you).toBe(-1); // no car until the next roster
    expect((await b.waitFor(() => rosterWith(b, 2), 4000, 'roster with both')).you).toBe(1);

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
    await b.waitFor(() => goesLive(b), 4000, 'the round to go live'); // a player who leaves during the countdown is not eliminated: the countdown starts over
    a.close();
    await b.waitFor(() => b.messages.find((m) => m.t === 'ko' && m.reason === 'disconnected'), 4000, 'A to be eliminated');
    expect(app.lobby.playerCount).toBe(1);
    b.close();
    const t0 = Date.now();
    while (app.lobby.roomCount > 0 && Date.now() - t0 < 3000) await sleep(20);
    expect(app.lobby.roomCount).toBe(0);
  });

  it('neutralises a car whose player stops sending input', async () => {
    const a = await connect();
    a.hello();
    await a.waitFor(() => a.welcome());
    const roster = await a.waitFor(() => rosterWith(a, 1), 4000, 'roster');
    await a.waitFor(() => goesLive(a), 3000, 'the round to go live');
    await a.drive(forward, 300);
    await sleep(1200);
    const last = await a.waitFor(() => a.snapshots.filter((s) => s.epoch === roster.epoch).at(-1));
    expect(last.cars.find((c) => c.slot === roster.you)!.throttle).toBe(0);
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
    expect(health.rssMb as number).toBeGreaterThan(20); // the process's memory, for the load test and for monitoring
    expect(health.heapMb as number).toBeGreaterThan(1);
    expect(health.heapMb as number).toBeLessThan(health.rssMb as number);
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

describe('whole rounds over the wire', () => {
  const phases = (c: TestClient): string[] => c.messages.filter((m): m is PhaseMessage => m.t === 'phase').map((m) => m.phase);

  it('plays a round between two humans to a winner, then starts the next round', async () => {
    const a = await connect();
    const b = await connect();
    a.hello({ name: 'Ann' });
    b.hello({ name: 'Bob' });
    const ra = await a.waitFor(() => rosterWith(a, 2), 4000, 'roster for Ann');
    const rb = await b.waitFor(() => rosterWith(b, 2), 4000, 'roster for Bob');
    expect(ra.players.map((p) => p.name).sort()).toEqual(['Ann', 'Bob']);
    await a.waitFor(() => goesLive(a), 3000, 'the round to go live');
    expect(phases(a).slice(0, 2)).toEqual(['countdown', 'live']);

    b.close(); // Bob leaves: Ann is the last car running
    const ko = await a.waitFor(() => a.messages.find((m) => m.t === 'ko'), 3000, 'the ko');
    expect(ko).toMatchObject({ t: 'ko', victim: rb.you, reason: 'disconnected' });
    const results = await a.waitFor(() => a.messages.find((m) => m.t === 'results'), 3000, 'the results');
    expect(results).toMatchObject({ t: 'results', round: 1, winner: ra.you, reason: 'last' });
    expect(phases(a).at(-1)).toBe('results');

    const next = await a.waitFor(() => a.messages.filter((m): m is RosterMessage => m.t === 'roster' && m.round === 2)[0], 4000, 'the next round');
    expect(next.you).toBe(0);
    expect(next.players.map((p) => p.name)).toEqual(['Ann']);
    expect(next.epoch).toBeGreaterThan(ra.epoch);
  });

  it('fills a room with bots, and a round against them runs through countdown, live and results', async () => {
    const withBots = createGameServer({ botFill: 4, seed: 5, rules: { countdownTicks: 20, liveTicks: 150, resultsTicks: 30 } });
    try {
      const p = await withBots.listen(0, '127.0.0.1');
      const c = await TestClient.connect(p);
      clients.push(c);
      c.hello({ name: 'Solo' });
      // generous budgets: the whole suite runs beside other CPU-heavy suites, and the round itself takes about three seconds
      const roster = await c.waitFor(() => c.messages.find((m): m is RosterMessage => m.t === 'roster'), 10_000, 'roster');
      expect(roster.you).toBe(0);
      expect(roster.players.map((q) => Boolean(q.bot))).toEqual([false, true, true, true]);
      await c.waitFor(() => c.messages.find((m) => m.t === 'results'), 20_000, 'results');
      expect(phases(c).slice(0, 3)).toEqual(['countdown', 'live', 'results']);
      const snap = c.snapshots.find((s) => s.epoch === roster.epoch && s.cars.length === 4);
      expect(snap).toBeDefined();
      await c.waitFor(() => c.messages.filter((m) => m.t === 'roster').length >= 2, 10_000, 'a second round');
    } finally {
      await withBots.close();
    }
  });
});
