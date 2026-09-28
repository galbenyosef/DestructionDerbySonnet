import type { CarInput } from '../../shared/input';
import {
  decodeSnapshot,
  encodeInput,
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
  type Snapshot,
} from '../../shared/protocol';

export interface ConnectionHandlers {
  onOpen?(): void;
  onMessage(msg: ServerMessage): void;
  onSnapshot(snapshot: Snapshot, arrivalMs: number): void;
  onClose(info: { code: number; reason: string }): void;
}

const WS_OPEN = 1;
const PING_EVERY_MS = 1000;

/** ws:// or wss:// URL of the game server for the current page (or an explicit override). */
export function serverUrl(loc: { protocol: string; host: string }, override?: string): string {
  if (override) return override;
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`;
}

export class Connection {
  /** Smoothed round-trip time in ms; 0 until the first pong arrives. */
  rttMs = 0;
  private ws: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pingId = 0;

  constructor(
    private readonly url: string,
    private readonly handlers: ConnectionHandlers,
    private readonly now: () => number = () => performance.now(),
    private readonly createSocket: (url: string) => WebSocket = (u) => new WebSocket(u),
  ) {}

  connect(): void {
    const ws = this.createSocket(this.url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      this.startPing();
      this.handlers.onOpen?.();
    };
    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === 'string') {
        const msg = parseServerMessage(ev.data);
        if (!msg) return;
        if (msg.t === 'pong') this.recordPong(msg.c);
        this.handlers.onMessage(msg);
      } else if (ev.data instanceof ArrayBuffer) {
        const snapshot = decodeSnapshot(new Uint8Array(ev.data));
        if (snapshot) this.handlers.onSnapshot(snapshot, this.now());
      }
    };
    ws.onclose = (ev: CloseEvent) => {
      this.stopPing();
      this.handlers.onClose({ code: ev.code, reason: ev.reason });
    };
    ws.onerror = () => {
      /* a close event always follows */
    };
    this.ws = ws;
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WS_OPEN) this.ws.send(JSON.stringify(msg));
  }

  sendInput(seq: number, input: CarInput): void {
    if (this.ws?.readyState === WS_OPEN) this.ws.send(encodeInput(seq, input));
  }

  close(): void {
    this.stopPing();
    this.ws?.close();
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => this.send({ t: 'ping', id: ++this.pingId, c: this.now() }), PING_EVERY_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private recordPong(sentAt: number): void {
    const rtt = Math.max(0, this.now() - sentAt);
    this.rttMs = this.rttMs === 0 ? rtt : this.rttMs * 0.8 + rtt * 0.2;
  }
}
