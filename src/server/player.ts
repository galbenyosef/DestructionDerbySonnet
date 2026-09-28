import { NET } from '../shared/constants';
import { NEUTRAL_INPUT, isNewerSeq, type CarInput } from '../shared/input';
import type { ErrorCode, ServerMessage } from '../shared/protocol';
import type { Room } from './room';

/** The subset of `ws`' WebSocket that Player needs (test fakes implement it too). */
export interface SocketLike {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string | Uint8Array, options?: { binary?: boolean }): void;
  close(code?: number, reason?: string): void;
}

const WS_OPEN = 1;

interface QueuedInput {
  seq: number;
  input: CarInput;
}

export class Player {
  name = '';
  color = 0xd84a2b;
  /** Seat number inside the room; -1 when not seated. */
  slot = -1;
  room: Room | null = null;
  /** True once a hello was accepted and a seat assigned. */
  joined = false;
  /** Highest input sequence number consumed by the simulation. */
  ackSeq = 0;
  lastInput: CarInput = { ...NEUTRAL_INPUT };
  /** Ticks since the last input frame arrived; the room disconnects players who stay silent too long. */
  ticksSinceInput = 0;
  skippedSnapshots = 0;
  private queue: QueuedInput[] = [];
  private newestSeq: number | null = null;
  private starved = 0;

  constructor(
    readonly id: number,
    private readonly socket: SocketLike,
  ) {}

  send(msg: ServerMessage): void {
    if (this.socket.readyState !== WS_OPEN) return;
    try {
      this.socket.send(JSON.stringify(msg));
    } catch {
      /* socket is closing */
    }
  }

  sendError(code: ErrorCode, message: string): void {
    this.send({ t: 'error', code, message });
  }

  /** Sends a snapshot unless the socket's send buffer is backed up. Returns whether it was sent. */
  sendSnapshot(packet: Uint8Array): boolean {
    if (this.socket.readyState !== WS_OPEN) return false;
    if (this.socket.bufferedAmount > NET.MAX_BUFFERED_BYTES) {
      this.skippedSnapshots++;
      return false;
    }
    try {
      this.socket.send(packet, { binary: true });
      return true;
    } catch {
      return false;
    }
  }

  close(code = 1000, reason = ''): void {
    try {
      this.socket.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  /** Queues an input unless its sequence number is not newer than the newest one seen (u32 wrap-aware). */
  pushInput(seq: number, input: CarInput): boolean {
    if (this.newestSeq !== null && !isNewerSeq(seq, this.newestSeq)) return false;
    this.newestSeq = seq;
    this.queue.push({ seq, input });
    while (this.queue.length > NET.INPUT_QUEUE_MAX) this.queue.shift();
    this.ticksSinceInput = 0;
    return true;
  }

  /** Called once per simulation tick: consumes one queued input, repeating the last one on starvation. */
  nextInput(): CarInput {
    this.ticksSinceInput++;
    const next = this.queue.shift();
    if (next) {
      this.lastInput = next.input;
      this.ackSeq = next.seq;
      this.starved = 0;
    } else if (++this.starved > NET.INPUT_STARVE_NEUTRAL_TICKS) {
      this.lastInput = { ...NEUTRAL_INPUT };
    }
    return this.lastInput;
  }

  resetInputState(): void {
    this.queue = [];
    this.newestSeq = null;
    this.starved = 0;
    this.ticksSinceInput = 0;
    this.lastInput = { ...NEUTRAL_INPUT };
  }
}
