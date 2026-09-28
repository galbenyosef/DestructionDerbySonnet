import { WebSocket, type RawData } from 'ws';
import { NET } from '../../src/shared/constants';
import type { CarInput } from '../../src/shared/input';
import {
  decodeSnapshot,
  encodeInput,
  parseServerMessage,
  type ErrorMessage,
  type HelloMessage,
  type ServerMessage,
  type Snapshot,
  type WelcomeMessage,
} from '../../src/shared/protocol';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const bytes = (d: RawData): Uint8Array => {
  if (Array.isArray(d)) return new Uint8Array(Buffer.concat(d));
  if (d instanceof ArrayBuffer) return new Uint8Array(d);
  return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
};

/** A headless protocol client for integration tests and scripts. */
export class TestClient {
  readonly messages: ServerMessage[] = [];
  readonly snapshots: Snapshot[] = [];
  closed: { code: number; reason: string } | null = null;
  seq = 0;

  private constructor(readonly ws: WebSocket) {}

  static connect(port: number, headers: Record<string, string> = {}): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
      const client = new TestClient(ws);
      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          const s = decodeSnapshot(bytes(data));
          if (s) client.snapshots.push(s);
        } else {
          const m = parseServerMessage(Buffer.from(bytes(data)).toString('utf8'));
          if (m) client.messages.push(m);
        }
      });
      ws.on('close', (code, reason) => {
        client.closed = { code, reason: reason.toString() };
      });
      ws.on('open', () => resolve(client));
      ws.on('error', reject);
    });
  }

  hello(overrides: Partial<HelloMessage> = {}): void {
    this.ws.send(
      JSON.stringify({ t: 'hello', v: NET.PROTOCOL_VERSION, name: 'Tester', color: 0xd84a2b, mode: 'quick', ...overrides }),
    );
  }

  sendRaw(data: string | Uint8Array): void {
    this.ws.send(data);
  }

  sendInput(input: CarInput): void {
    this.seq = (this.seq + 1) >>> 0;
    this.ws.send(encodeInput(this.seq, input));
  }

  /** Sends the same input at ~60 Hz for `ms` milliseconds. */
  async drive(input: CarInput, ms: number): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      this.sendInput(input);
      await sleep(16);
    }
  }

  /** Polls until `pick()` returns something truthy. */
  async waitFor<T>(pick: () => T | undefined | false | null, timeoutMs = 5000, label = 'condition'): Promise<T> {
    const t0 = Date.now();
    for (;;) {
      const v = pick();
      if (v) return v;
      if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${label}`);
      await sleep(10);
    }
  }

  welcome(): WelcomeMessage | undefined {
    return this.messages.find((m): m is WelcomeMessage => m.t === 'welcome');
  }

  errors(): ErrorMessage[] {
    return this.messages.filter((m): m is ErrorMessage => m.t === 'error');
  }

  close(): void {
    this.ws.close();
  }
}
