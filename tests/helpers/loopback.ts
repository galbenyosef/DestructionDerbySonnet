import { DelayLine, mulberry32 } from '../../src/client/net/latency';
import type { Predictor, PredictorOptions, ReconcileResult } from '../../src/client/net/prediction';
import { PredictedWorld, type RenderPose } from '../../src/client/net/predictedWorld';
import { quantizeInput, type CarInput } from '../../src/shared/input';
import { decodeSnapshot, type Snapshot } from '../../src/shared/protocol';
import type { Simulation } from '../../src/shared/sim';
import type { CarState } from '../../src/shared/types';
import { Player } from '../../src/server/player';
import { Room } from '../../src/server/room';
import { FakeSocket } from './fakeSocket';

export const TICK_MS = 1000 / 60;

type Down = { kind: 'snapshot'; snapshot: Snapshot } | { kind: 'roster'; epoch: number };
type Up = { seq: number; input: CarInput };

export interface LoopbackOptions {
  /** Added round trip and jitter of the simulated link (ms), and the percentage of binary frames lost. */
  rttMs?: number;
  jitterMs?: number;
  lossPct?: number;
  seed?: number;
  /** Scripted input for the local (predicted) player and the remote player, as a function of the 60 Hz tick index. */
  local: (k: number) => CarInput;
  remote: (k: number) => CarInput;
  predictor?: PredictorOptions;
  /** Set false to record the raw, unsmoothed prediction. */
  smoothing?: boolean;
  /** Fraction between two simulation steps at which every frame is drawn (default 1 = exactly on a step). */
  alpha?: number;
  /** From this many simulated seconds on, nothing the client sends reaches the server (snapshots keep arriving). */
  uplinkDeadAfterSeconds?: number;
  /**
   * Steps the client before the server within each tick. On a zero-latency link the server then consumes the newest
   * input immediately, so snapshots need no replay (the situation on localhost and fast LANs).
   */
  clientFirst?: boolean;
}

/**
 * A real server Room with two players behind a simulated, seeded network, driven in lock step at 60 Hz by a
 * client Predictor. Time is simulated, so runs are fast and repeatable.
 */
export class Loopback {
  readonly room = new Room('LOOP', true, () => undefined);
  readonly local = new Player(1, new FakeSocket());
  readonly remote = new Player(2, new FakeSocket());
  readonly world: PredictedWorld;
  readonly results: ReconcileResult[] = [];
  /** What the client would draw each 60 Hz frame. */
  readonly frames: RenderPose[][] = [];
  k = 0;
  private remoteSeq = 0;
  private sentIndex = 0;
  private readonly up: DelayLine<Up>;
  private readonly upRemote: DelayLine<Up>;
  private readonly down: DelayLine<Down>;

  constructor(private readonly options: LoopbackOptions) {
    const random = mulberry32(options.seed ?? 1);
    const line = { oneWayMs: (options.rttMs ?? 0) / 2, jitterMs: options.jitterMs ?? 0, lossPct: options.lossPct ?? 0 };
    this.up = new DelayLine(line, random);
    this.upRemote = new DelayLine({ ...line, lossPct: 0 }, random);
    this.down = new DelayLine(line, random);
    this.room.addPlayer(this.local);
    this.room.addPlayer(this.remote);
    this.world = new PredictedWorld(this.local.slot, { predictor: options.predictor, smoothing: options.smoothing });
    this.world.beginWorld(this.room.epoch);
  }

  get predictor(): Predictor {
    return this.world.predictor;
  }

  private get socket(): FakeSocket {
    return (this.local as unknown as { socket: FakeSocket }).socket;
  }

  /** The server's simulation for the current world (null before the first rebuild). */
  get serverSim(): Simulation | null {
    return (Reflect.get(this.room, 'sim') as Simulation | null) ?? null;
  }

  serverState(slot: number): CarState {
    return this.serverSim!.getState(slot);
  }

  private clientStep(now: number): void {
    const input = quantizeInput(this.options.local(this.k));
    const seq = this.world.step(input);
    const dead = this.options.uplinkDeadAfterSeconds !== undefined && now >= this.options.uplinkDeadAfterSeconds * 1000;
    if (!dead) this.up.push(now, { seq, input }, true);
  }

  /** Advances the simulated clock by one 60 Hz tick. */
  tick(): void {
    const now = this.k * TICK_MS;
    if (this.options.clientFirst) this.clientStep(now);
    for (const m of this.up.due(now)) this.local.pushInput(m.seq, m.input);
    for (const m of this.upRemote.due(now)) this.remote.pushInput(m.seq, m.input);
    this.room.step();
    const frames = this.socket.sent;
    while (this.sentIndex < frames.length) {
      const frame = frames[this.sentIndex++]!;
      if (typeof frame === 'string') {
        const msg = JSON.parse(frame) as { t: string; epoch?: number };
        if (msg.t === 'roster') this.down.push(now, { kind: 'roster', epoch: msg.epoch! });
      } else {
        const snapshot = decodeSnapshot(frame);
        if (snapshot) this.down.push(now, { kind: 'snapshot', snapshot }, true);
      }
    }
    for (const d of this.down.due(now)) {
      if (d.kind === 'roster') this.world.beginWorld(d.epoch);
      else this.results.push(this.world.onSnapshot(d.snapshot, now));
    }
    this.remoteSeq++;
    this.upRemote.push(now, { seq: this.remoteSeq, input: quantizeInput(this.options.remote(this.k)) });
    if (!this.options.clientFirst) this.clientStep(now);
    this.frames.push(this.world.frame(this.options.alpha ?? 1, 1 / 60));
    this.k++;
  }

  run(seconds: number): void {
    const n = Math.round((seconds * 1000) / TICK_MS);
    for (let i = 0; i < n; i++) this.tick();
  }

  /** Position errors (m) of the local car's present pose at each applied snapshot. */
  localErrors(): number[] {
    return this.results.filter((r) => r.outcome === 'applied').map((r) => r.localError);
  }

  remoteErrors(): number[] {
    return this.results
      .filter((r) => r.outcome === 'applied')
      .flatMap((r) => r.corrections.filter((c) => c.slot !== this.local.slot).map((c) => c.error));
  }

  /**
   * Largest frame-to-frame jump (m) of a car's drawn position beyond the motion its own velocity explains, ignoring
   * the first `skipFrames` frames (world start) and frames within 3 frames of a sudden speed change (an impact
   * really does change a car's motion abruptly). What remains is what a player would see as a teleport.
   */
  maxVisualJump(slot: number, skipFrames = 90): number {
    const at = (i: number): RenderPose | undefined => this.frames[i]?.find((p) => p.slot === slot);
    const speedAt = (i: number): number => {
      const p = at(i);
      return p ? Math.hypot(p.linvel.x, p.linvel.z) : 0;
    };
    const impactNear = (i: number): boolean => {
      for (let j = i - 3; j <= i + 3; j++) if (j >= 1 && Math.abs(speedAt(j) - speedAt(j - 1)) > 2) return true;
      return false;
    };
    let worst = 0;
    for (let i = Math.max(1, skipFrames); i < this.frames.length; i++) {
      const a = at(i - 1);
      const b = at(i);
      if (!a || !b || !a.visible || !b.visible || impactNear(i)) continue;
      worst = Math.max(worst, Math.hypot(b.pos.x - a.pos.x - b.linvel.x / 60, b.pos.z - a.pos.z - b.linvel.z / 60));
    }
    return worst;
  }

  dispose(): void {
    this.world.dispose();
    this.room.dispose();
  }
}

export const percentile = (values: readonly number[], q: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
};
