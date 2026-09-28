import { afterEach, describe, expect, it, vi } from 'vitest';
import { Connection, serverUrl } from '../../src/client/net/connection';
import { NEUTRAL_INPUT } from '../../src/shared/input';
import { SNAP_FLAG_ALIVE, decodeInput, encodeSnapshot, type Snapshot } from '../../src/shared/protocol';

class FakeWebSocket {
  readyState = 0;
  binaryType = 'blob';
  sent: Array<string | Uint8Array> = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(d: string | Uint8Array): void {
    this.sent.push(d);
  }
  close(code = 1000, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(data: unknown): void {
    this.onmessage?.({ data });
  }
}

const connections: Connection[] = [];

function setup() {
  const fake = new FakeWebSocket();
  const events = { open: 0, messages: [] as unknown[], snapshots: [] as Array<[Snapshot, number]>, closes: [] as unknown[] };
  let now = 1000;
  const conn = new Connection(
    'ws://x/ws',
    {
      onOpen: () => events.open++,
      onMessage: (m) => events.messages.push(m),
      onSnapshot: (s, at) => events.snapshots.push([s, at]),
      onClose: (info) => events.closes.push(info),
    },
    () => now,
    () => fake as unknown as WebSocket,
  );
  connections.push(conn);
  return { fake, conn, events, setNow: (t: number) => (now = t) };
}

afterEach(() => {
  for (const c of connections.splice(0)) c.close(); // clears ping timers (fake or real) before real timers return
  vi.useRealTimers();
});

const snapshot: Snapshot = {
  epoch: 1,
  tick: 4,
  ackSeq: 2,
  cars: [
    {
      slot: 0,
      flags: SNAP_FLAG_ALIVE,
      hp: 100,
      state: { pos: { x: 1, y: 1, z: 1 }, quat: { x: 0, y: 0, z: 0, w: 1 }, linvel: { x: 0, y: 0, z: 0 }, angvel: { x: 0, y: 0, z: 0 } },
      throttle: 0,
      steer: 0,
    },
  ],
};

describe('serverUrl', () => {
  it('derives ws/wss from the page location and honours an override', () => {
    expect(serverUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/ws');
    expect(serverUrl({ protocol: 'https:', host: 'play.example.com' })).toBe('wss://play.example.com/ws');
    expect(serverUrl({ protocol: 'http:', host: 'x' }, 'wss://game.example.com/ws')).toBe('wss://game.example.com/ws');
  });
});

describe('Connection', () => {
  it('requests arraybuffer frames, reports open, and dispatches parsed messages', () => {
    const { fake, conn, events } = setup();
    conn.connect();
    expect(fake.binaryType).toBe('arraybuffer');
    fake.open();
    expect(events.open).toBe(1);
    fake.receive(JSON.stringify({ t: 'roster', epoch: 2, players: [] }));
    fake.receive('not json'); // ignored
    fake.receive(JSON.stringify({ t: 'mystery' })); // ignored
    expect(events.messages).toEqual([{ t: 'roster', epoch: 2, players: [] }]);
  });

  it('decodes binary snapshots and stamps them with the arrival time', () => {
    const { fake, conn, events, setNow } = setup();
    conn.connect();
    fake.open();
    setNow(1234);
    const bytes = encodeSnapshot(snapshot);
    fake.receive(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    fake.receive(new ArrayBuffer(3)); // malformed, ignored
    expect(events.snapshots).toHaveLength(1);
    expect(events.snapshots[0]![1]).toBe(1234);
    expect(events.snapshots[0]![0].tick).toBe(4);
  });

  it('sends inputs as 8-byte frames only while the socket is open', () => {
    const { fake, conn } = setup();
    conn.connect();
    conn.sendInput(1, NEUTRAL_INPUT); // not open yet: dropped
    expect(fake.sent).toHaveLength(0);
    fake.open();
    fake.sent.length = 0; // start from a clean slate
    conn.sendInput(7, { throttle: 1, steer: 0, handbrake: false });
    const frame = fake.sent[0] as Uint8Array;
    expect(frame.byteLength).toBe(8);
    expect(decodeInput(frame)!.seq).toBe(7);
  });

  it('pings every second and smooths the round-trip time', () => {
    vi.useFakeTimers();
    const { fake, conn, setNow } = setup();
    conn.connect();
    fake.open();
    setNow(2000);
    vi.advanceTimersByTime(1000);
    const ping = JSON.parse(fake.sent.filter((d): d is string => typeof d === 'string').at(-1)!);
    expect(ping).toMatchObject({ t: 'ping', c: 2000 });
    setNow(2040);
    fake.receive(JSON.stringify({ t: 'pong', id: ping.id, c: 2000, tick: 0 }));
    expect(conn.rttMs).toBeCloseTo(40, 6);
    setNow(3100);
    fake.receive(JSON.stringify({ t: 'pong', id: 2, c: 3000, tick: 0 })); // 100 ms sample
    expect(conn.rttMs).toBeCloseTo(40 * 0.8 + 100 * 0.2, 6);
  });

  it('reports close events and stops pinging afterwards', () => {
    vi.useFakeTimers();
    const { fake, conn, events } = setup();
    conn.connect();
    fake.open();
    fake.close(4001, 'inactive');
    expect(events.closes).toEqual([{ code: 4001, reason: 'inactive' }]);
    const sentBefore = fake.sent.length;
    vi.advanceTimersByTime(5000);
    expect(fake.sent.length).toBe(sentBefore);
  });
});
