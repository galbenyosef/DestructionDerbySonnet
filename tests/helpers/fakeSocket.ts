import type { SocketLike } from '../../src/server/player';

/** In-memory stand-in for a WebSocket. */
export class FakeSocket implements SocketLike {
  readyState = 1;
  bufferedAmount = 0;
  readonly sent: Array<string | Uint8Array> = [];
  closed: { code?: number; reason?: string } | null = null;
  throwOnSend = false;

  send(data: string | Uint8Array): void {
    if (this.throwOnSend) throw new Error('socket is closing');
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closed = { code, reason };
  }

  /** Parsed JSON of every text frame sent so far. */
  json(): Array<Record<string, unknown>> {
    return this.sent.filter((d): d is string => typeof d === 'string').map((s) => JSON.parse(s) as Record<string, unknown>);
  }

  /** Every binary frame sent so far. */
  binary(): Uint8Array[] {
    return this.sent.filter((d): d is Uint8Array => typeof d !== 'string');
  }
}
