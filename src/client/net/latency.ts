/** Small seeded PRNG so simulated networks are repeatable in tests. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface LagOptions {
  /** Added round-trip time in ms, split evenly between the two directions. */
  lagMs: number;
  /** Each frame is delayed by a further random amount in [-jitterMs, +jitterMs] per direction. */
  jitterMs: number;
  /** Percentage (0-50) of binary frames (inputs and snapshots) that never arrive. JSON control messages are never dropped. */
  lossPct: number;
}

export interface LineOptions {
  oneWayMs: number;
  jitterMs: number;
  lossPct: number;
}

/**
 * One direction of a simulated link. Delivery is FIFO like TCP: a message is never delivered before an earlier one,
 * so jitter shows up as bunching rather than reordering.
 */
export class DelayLine<T> {
  private queue: Array<{ at: number; msg: T }> = [];
  private last = -Infinity;

  constructor(
    private readonly options: LineOptions,
    private readonly random: () => number,
  ) {}

  /** Queues `msg` sent at `nowMs`. Returns its delivery time, or null when it was dropped (only `lossy` messages can be). */
  push(nowMs: number, msg: T, lossy = false): number | null {
    if (lossy && this.options.lossPct > 0 && this.random() * 100 < this.options.lossPct) return null;
    const jitter = this.options.jitterMs > 0 ? (this.random() * 2 - 1) * this.options.jitterMs : 0;
    const at = Math.max(this.last, nowMs + this.options.oneWayMs + jitter);
    this.last = at;
    this.queue.push({ at, msg });
    return at;
  }

  /** Removes and returns every message due at `nowMs`, oldest first. */
  due(nowMs: number): T[] {
    const out: T[] = [];
    while (this.queue.length > 0 && this.queue[0]!.at <= nowMs) out.push(this.queue.shift()!.msg);
    return out;
  }

  get pending(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
  }
}

const readNumber = (raw: string | null, max: number): number => {
  if (raw === null || raw.trim() === '') return 0;
  const n = Number(raw);
  return Number.isNaN(n) ? 0 : Math.min(max, Math.max(0, n));
};

/** `?lag=120&jitter=30&loss=1` (round-trip ms, jitter ms, percent of binary frames lost). Null when nothing is simulated. */
export function parseLagParams(params: URLSearchParams): LagOptions | null {
  const lagMs = readNumber(params.get('lag'), 2000);
  const jitterMs = readNumber(params.get('jitter'), 500);
  const lossPct = readNumber(params.get('loss'), 50);
  if (lagMs === 0 && jitterMs === 0 && lossPct === 0) return null;
  return { lagMs, jitterMs, lossPct };
}

export interface LagEnv {
  now(): number;
  schedule(fn: () => void, ms: number): void;
  random(): number;
}

const realEnv = (): LagEnv => ({
  now: () => performance.now(),
  schedule: (fn, ms) => void setTimeout(fn, ms),
  random: Math.random,
});

type Incoming = { kind: 'message'; ev: MessageEvent } | { kind: 'close'; ev: CloseEvent };
type Outgoing = Parameters<WebSocket['send']>[0];

/**
 * Wraps a real WebSocket and delays (and, for binary frames, drops) traffic in both directions. It implements just
 * the surface `Connection` uses, so it can be handed over through `Connection`'s socket factory.
 */
export class LagSocket {
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  private readonly outgoing: DelayLine<Outgoing>;
  private readonly incoming: DelayLine<Incoming>;
  private closing = false;

  constructor(
    private readonly inner: WebSocket,
    options: LagOptions,
    private readonly env: LagEnv = realEnv(),
  ) {
    const line: LineOptions = { oneWayMs: options.lagMs / 2, jitterMs: options.jitterMs, lossPct: options.lossPct };
    this.outgoing = new DelayLine(line, env.random);
    this.incoming = new DelayLine(line, env.random);
    inner.onopen = (ev) => this.onopen?.(ev);
    inner.onmessage = (ev) => this.enqueue({ kind: 'message', ev }, typeof ev.data !== 'string');
    inner.onclose = (ev) => this.enqueue({ kind: 'close', ev }, false);
    inner.onerror = (ev) => this.onerror?.(ev);
  }

  get readyState(): number {
    return this.inner.readyState;
  }

  get binaryType(): BinaryType {
    return this.inner.binaryType;
  }

  set binaryType(value: BinaryType) {
    this.inner.binaryType = value;
  }

  send(data: Outgoing): void {
    if (this.closing) return;
    const now = this.env.now();
    const at = this.outgoing.push(now, data, typeof data !== 'string');
    if (at !== null) this.env.schedule(() => this.flushOutgoing(), Math.max(0, at - now));
  }

  /** Closes the real socket immediately; frames still in flight are discarded. */
  close(code?: number, reason?: string): void {
    this.closing = true;
    this.outgoing.clear();
    this.incoming.clear();
    this.inner.close(code, reason);
  }

  private flushOutgoing(): void {
    if (this.closing) return;
    for (const data of this.outgoing.due(this.env.now())) {
      try {
        this.inner.send(data);
      } catch {
        /* the real socket is closing */
      }
    }
  }

  private enqueue(item: Incoming, lossy: boolean): void {
    if (this.closing && item.kind === 'message') return;
    const now = this.env.now();
    const at = this.incoming.push(now, item, lossy);
    if (at !== null) this.env.schedule(() => this.flushIncoming(), Math.max(0, at - now));
  }

  private flushIncoming(): void {
    for (const item of this.incoming.due(this.env.now())) {
      if (item.kind === 'message') this.onmessage?.(item.ev);
      else this.onclose?.(item.ev);
    }
  }
}
