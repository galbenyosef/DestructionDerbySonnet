import { describe, expect, it } from 'vitest';
import { DelayLine, LagSocket, mulberry32, parseLagParams } from '../../src/client/net/latency';

describe('mulberry32', () => {
  it('is deterministic per seed and stays within [0, 1)', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const seq = Array.from({ length: 50 }, () => a());
    expect(seq).toEqual(Array.from({ length: 50 }, () => b()));
    expect(seq.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(mulberry32(8)()).not.toBe(seq[0]);
  });
});

describe('DelayLine', () => {
  it('delays every message by the one-way latency', () => {
    const line = new DelayLine<string>({ oneWayMs: 50, jitterMs: 0, lossPct: 0 }, mulberry32(1));
    expect(line.push(1000, 'a')).toBe(1050);
    expect(line.due(1049)).toEqual([]);
    expect(line.due(1050)).toEqual(['a']);
    expect(line.pending).toBe(0);
  });

  it('keeps jitter inside its bounds and never reorders (FIFO like TCP)', () => {
    const line = new DelayLine<number>({ oneWayMs: 50, jitterMs: 30, lossPct: 0 }, mulberry32(2));
    let lastAt = -Infinity;
    for (let i = 0; i < 500; i++) {
      const sentAt = i * 16;
      const at = line.push(sentAt, i)!;
      expect(at).toBeGreaterThanOrEqual(sentAt + 20 - 1e-9); // 50 - 30, unless clamped up by an earlier message
      expect(at).toBeLessThanOrEqual(sentAt + 80 + 1e-9); // 50 + 30; FIFO clamping never exceeds the previous maximum
      expect(at).toBeGreaterThanOrEqual(lastAt);
      lastAt = at;
    }
    const out = line.due(Infinity);
    expect(out).toEqual(Array.from({ length: 500 }, (_, i) => i));
  });

  it('only drops messages flagged lossy, at roughly the configured rate', () => {
    const line = new DelayLine<number>({ oneWayMs: 0, jitterMs: 0, lossPct: 50 }, mulberry32(3));
    for (let i = 0; i < 1000; i++) line.push(0, i, false);
    expect(line.due(0)).toHaveLength(1000); // reliable traffic is never dropped
    let kept = 0;
    for (let i = 0; i < 4000; i++) if (line.push(0, i, true) !== null) kept++;
    expect(kept).toBeGreaterThan(1800);
    expect(kept).toBeLessThan(2200);
  });

  it('is repeatable for a given seed', () => {
    const run = (): number[] => {
      const line = new DelayLine<number>({ oneWayMs: 40, jitterMs: 25, lossPct: 10 }, mulberry32(9));
      return Array.from({ length: 200 }, (_, i) => line.push(i * 16, i, true) ?? -1);
    };
    expect(run()).toEqual(run());
  });
});

describe('parseLagParams', () => {
  const parse = (q: string) => parseLagParams(new URLSearchParams(q));

  it('returns null when nothing is simulated', () => {
    expect(parse('')).toBeNull();
    expect(parse('lag=0&jitter=0&loss=0')).toBeNull();
    expect(parse('lag=abc&jitter=&loss=-3')).toBeNull();
  });

  it('reads the three parameters', () => {
    expect(parse('lag=120&jitter=30&loss=1')).toEqual({ lagMs: 120, jitterMs: 30, lossPct: 1 });
    expect(parse('lag=80')).toEqual({ lagMs: 80, jitterMs: 0, lossPct: 0 });
  });

  it('clamps absurd values', () => {
    expect(parse('lag=999999&jitter=999999&loss=999')).toEqual({ lagMs: 2000, jitterMs: 500, lossPct: 50 });
    expect(parse('lag=-5&jitter=NaN&loss=Infinity')).toEqual({ lagMs: 0, jitterMs: 0, lossPct: 50 });
  });
});

class FakeInner {
  readyState = 1;
  binaryType = 'blob';
  sent: unknown[] = [];
  closedWith: [number?, string?] | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send(d: unknown): void {
    this.sent.push(d);
  }
  close(code?: number, reason?: string): void {
    this.closedWith = [code, reason];
  }
}

function lagSetup(options: { lagMs: number; jitterMs: number; lossPct: number }) {
  const inner = new FakeInner();
  let now = 0;
  const timers: Array<{ at: number; fn: () => void }> = [];
  const socket = new LagSocket(inner as unknown as WebSocket, options, {
    now: () => now,
    schedule: (fn, ms) => timers.push({ at: now + ms, fn }),
    random: mulberry32(5),
  });
  const received: unknown[] = [];
  const closes: unknown[] = [];
  socket.onmessage = (ev) => received.push(ev.data);
  socket.onclose = (ev) => closes.push([ev.code, ev.reason]);
  const advance = (to: number): void => {
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > to) break;
      timers.shift();
      now = Math.max(now, next.at);
      next.fn();
    }
    now = to;
  };
  return { inner, socket, received, closes, advance, setNow: (t: number) => (now = t) };
}

describe('LagSocket', () => {
  it('delays outgoing and incoming frames by half the added round trip each', () => {
    const { inner, socket, received, advance } = lagSetup({ lagMs: 100, jitterMs: 0, lossPct: 0 });
    socket.send('hello');
    expect(inner.sent).toEqual([]);
    advance(49);
    expect(inner.sent).toEqual([]);
    advance(50);
    expect(inner.sent).toEqual(['hello']);
    inner.onmessage!({ data: 'pong' });
    advance(99);
    expect(received).toEqual([]);
    advance(100);
    expect(received).toEqual(['pong']);
  });

  it('forwards binaryType and the ready state to the real socket', () => {
    const { inner, socket } = lagSetup({ lagMs: 10, jitterMs: 0, lossPct: 0 });
    socket.binaryType = 'arraybuffer';
    expect(inner.binaryType).toBe('arraybuffer');
    inner.readyState = 3;
    expect(socket.readyState).toBe(3);
  });

  it('drops only binary frames when loss is high, never JSON control messages', () => {
    const { inner, socket, received, advance } = lagSetup({ lagMs: 0, jitterMs: 0, lossPct: 50 });
    for (let i = 0; i < 400; i++) socket.send(new Uint8Array([i & 255]));
    for (let i = 0; i < 50; i++) socket.send(JSON.stringify({ t: 'ping', id: i }));
    advance(10);
    const binaries = inner.sent.filter((d) => typeof d !== 'string');
    const texts = inner.sent.filter((d) => typeof d === 'string');
    expect(texts).toHaveLength(50);
    expect(binaries.length).toBeGreaterThan(140);
    expect(binaries.length).toBeLessThan(260);
    for (let i = 0; i < 300; i++) inner.onmessage!({ data: new ArrayBuffer(4) });
    for (let i = 0; i < 20; i++) inner.onmessage!({ data: '{"t":"roster"}' });
    advance(20);
    expect(received.filter((d) => typeof d === 'string')).toHaveLength(20);
    expect(received.filter((d) => typeof d !== 'string').length).toBeLessThan(220);
  });

  it('delivers the close event after the frames that preceded it', () => {
    const { inner, socket, received, closes, advance } = lagSetup({ lagMs: 60, jitterMs: 0, lossPct: 0 });
    inner.onmessage!({ data: 'last words' });
    inner.onclose!({ code: 4001, reason: 'inactive' });
    advance(29);
    expect(received).toEqual([]);
    expect(closes).toEqual([]);
    advance(30);
    expect(received).toEqual(['last words']);
    expect(closes).toEqual([[4001, 'inactive']]);
    void socket;
  });

  it('closes the real socket immediately and drops anything still in flight', () => {
    const { inner, socket, received, advance } = lagSetup({ lagMs: 100, jitterMs: 0, lossPct: 0 });
    socket.send('bye');
    inner.onmessage!({ data: 'late' });
    socket.close(1000, 'done');
    expect(inner.closedWith).toEqual([1000, 'done']);
    advance(500);
    expect(inner.sent).toEqual([]);
    expect(received).toEqual([]);
  });
});
