import type { CarInput } from '../../shared/input';
import { SNAP_FLAG_ALIVE, type Phase, type Snapshot } from '../../shared/protocol';
import type { Quat, Vec3 } from '../../shared/types';
import { SnapshotInterpolator } from './interp';
import { PredictedWorld, type PredictedWorldOptions } from './predictedWorld';

export type NetMode = 'predict' | 'interp';

/** One car as drawn this frame, whichever networking mode produced it. */
export interface DrawPose {
  slot: number;
  pos: Vec3;
  quat: Quat;
  linvel: Vec3;
  steer: number;
  visible: boolean;
  extrapolated: boolean;
  /** False for a wreck. */
  alive: boolean;
  hp: number;
}

export interface ClientSessionOptions {
  world?: PredictedWorldOptions;
  /** Called once when prediction gives up and the session switches to interpolation; `reason` is for the log. */
  onFallback?(reason: string): void;
  /** Called each time the connection becomes stalled (the server stopped acknowledging our inputs), not while it stays so. */
  onStall?(): void;
}

/**
 * The client's networking state without a DOM: numbers local inputs, feeds snapshots to the predicted world (or to the
 * interpolator in `?net=interp` mode) and switches from the former to the latter if the local simulation cannot run.
 * `GameClient` owns the socket, the scene and the HUD and delegates everything else here, so this is testable in Node.
 */
export class ClientSession {
  readonly interpolator = new SnapshotInterpolator();
  private world: PredictedWorld | null = null;
  private current: NetMode;
  private epoch = 0;
  private seq = 0;
  private received = 0;
  private wasStalled = false;
  private currentPhase: Phase | null = null;

  constructor(
    mode: NetMode,
    private readonly options: ClientSessionOptions = {},
  ) {
    this.current = mode;
  }

  get mode(): NetMode {
    return this.current;
  }

  /** The prediction machinery; null in interpolation mode. */
  get predicted(): PredictedWorld | null {
    return this.world;
  }

  /** Snapshots that were used (applied to the local world or buffered for interpolation). */
  get snapshotsReceived(): number {
    return this.received;
  }

  /** Sequence number of the newest input, in either mode. */
  get inputSequence(): number {
    return this.world ? this.world.predictor.sequence : this.seq;
  }

  /** Where the round is (countdown, live, results), as far as the server has told us. */
  get phase(): Phase | null {
    return this.currentPhase;
  }

  /** True while the server is not acknowledging our inputs (dead or badly delayed uplink). */
  get stalled(): boolean {
    return this.world?.predictor.isStalled ?? false;
  }

  /** `slot` is the local car's slot in the running round, or -1 while the player is watching. */
  onWelcome(slot: number, epoch: number, phase: Phase | null = null): void {
    this.epoch = epoch;
    this.currentPhase = phase;
    this.interpolator.reset(epoch);
    if (this.current === 'predict') {
      this.world?.dispose();
      this.world = new PredictedWorld(slot, this.options.world);
      this.world.beginWorld(epoch);
      this.world.setLive(phase === 'live');
    }
  }

  /** A new round's world: every buffered or predicted state belongs to the old one, and the local car may have a new slot. */
  onRoster(epoch: number, you: number): void {
    this.epoch = epoch;
    this.wasStalled = false;
    this.currentPhase = 'countdown'; // a roster always opens with the countdown; the phase message repeats it
    this.interpolator.reset(epoch);
    this.world?.beginWorld(epoch, you);
    this.world?.setLive(false);
  }

  onPhase(phase: Phase): void {
    this.currentPhase = phase;
    this.world?.setLive(phase === 'live');
  }

  /** One local 60 Hz tick: returns the sequence number to send with `input`. */
  nextInput(input: CarInput): number {
    if (this.world) return this.world.step(input);
    this.seq = (this.seq + 1) >>> 0;
    return this.seq;
  }

  onSnapshot(snapshot: Snapshot, arrivalMs: number): void {
    if (!this.world) {
      if (this.interpolator.push(snapshot, arrivalMs)) this.received++;
      return;
    }
    const { outcome } = this.world.onSnapshot(snapshot, arrivalMs);
    if (this.world.failure !== null) {
      this.fallBack(this.world.failure, snapshot, arrivalMs);
      return;
    }
    if (outcome === 'applied' || outcome === 'synced') this.received++;
    const stalled = this.world.predictor.isStalled;
    if (stalled && !this.wasStalled) this.options.onStall?.();
    this.wasStalled = stalled;
  }

  /** Poses to draw this frame. `alpha` is the fraction of the way to the next fixed step, `nowMs` the frame's clock. */
  poses(alpha: number, dtSeconds: number, nowMs: number): DrawPose[] {
    if (this.world) {
      return this.world.frame(alpha, dtSeconds).map((p) => ({
        slot: p.slot,
        pos: p.pos,
        quat: p.quat,
        linvel: p.linvel,
        steer: p.steer,
        visible: p.visible,
        extrapolated: false,
        alive: (p.flags & SNAP_FLAG_ALIVE) !== 0,
        hp: p.hp,
      }));
    }
    return this.interpolator.sample(nowMs).map((p) => ({
      slot: p.slot,
      pos: p.state.pos,
      quat: p.state.quat,
      linvel: p.state.linvel,
      steer: p.steer,
      visible: true,
      extrapolated: p.extrapolated,
      alive: (p.flags & SNAP_FLAG_ALIVE) !== 0,
      hp: p.hp,
    }));
  }

  dispose(): void {
    this.world?.dispose();
    this.world = null;
  }

  private fallBack(reason: string, snapshot: Snapshot, arrivalMs: number): void {
    // The server drops every input that is not newer than the newest one it has seen, so numbering must go on from
    // where the predictor stopped; restarting at 1 would leave the player unable to steer until the count caught up.
    this.seq = this.world!.predictor.sequence;
    this.world!.dispose();
    this.world = null;
    this.current = 'interp';
    this.interpolator.reset(this.epoch);
    if (this.interpolator.push(snapshot, arrivalMs)) this.received++;
    this.options.onFallback?.(reason);
  }
}
