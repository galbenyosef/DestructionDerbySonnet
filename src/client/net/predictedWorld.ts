import type { CarInput } from '../../shared/input';
import type { Snapshot } from '../../shared/protocol';
import type { Quat, Vec3 } from '../../shared/types';
import { NetStats } from './netStats';
import { Predictor, type PredictorOptions, type ReconcileResult } from './prediction';
import { ErrorSmoother } from './smoothing';

export interface RenderPose {
  slot: number;
  /** Position and orientation to draw: the predicted pose plus the decaying correction offset. */
  pos: Vec3;
  quat: Quat;
  linvel: Vec3;
  flags: number;
  hp: number;
  throttle: number;
  steer: number;
  visible: boolean;
}

export interface PredictedWorldOptions {
  predictor?: PredictorOptions;
  /** Set false to draw the raw prediction (used to measure how much the smoothing hides). Default true. */
  smoothing?: boolean;
  tauSeconds?: number;
  snapDistance?: number;
}

/**
 * Everything the client does in prediction mode, without a DOM: numbers and predicts local inputs, reconciles
 * snapshots, hides corrections with the error smoother and keeps the network statistics.
 */
export class PredictedWorld {
  readonly predictor: Predictor;
  readonly smoother: ErrorSmoother;
  readonly stats: NetStats;
  private readonly smoothing: boolean;

  constructor(
    mySlot: number,
    options: PredictedWorldOptions = {},
  ) {
    this.predictor = new Predictor(mySlot, options.predictor);
    this.smoother = new ErrorSmoother(options.tauSeconds, options.snapDistance);
    this.stats = new NetStats(mySlot);
    this.smoothing = options.smoothing ?? true;
  }

  /** Slot of the local car in the current world (-1: watching). */
  get mySlot(): number {
    return this.predictor.mySlot;
  }

  /** Non-null when prediction cannot run at all (see Predictor.failure); the caller should fall back to interpolation. */
  get failure(): string | null {
    return this.predictor.failure;
  }

  /** A new world (welcome or roster message), in which the local car has slot `mySlot`: forget predictions and pending corrections. */
  beginWorld(epoch: number, mySlot: number = this.mySlot): void {
    this.predictor.beginWorld(epoch, mySlot);
    this.stats.mySlot = mySlot;
    this.smoother.clear();
  }

  /** Whether the server is applying the driver's input (false in the countdown and the results). */
  setLive(live: boolean): void {
    this.predictor.setLive(live);
  }

  /** One local 60 Hz tick. Returns the input's sequence number, to send to the server with the same input. */
  step(input: CarInput): number {
    return this.predictor.step(input);
  }

  /** Feeds a decoded snapshot that arrived at `arrivalMs`. */
  onSnapshot(snapshot: Snapshot, arrivalMs: number, clock: () => number = () => performance.now()): ReconcileResult {
    const started = clock();
    const result = this.predictor.reconcile(snapshot);
    this.stats.record(arrivalMs, result, clock() - started);
    if (result.outcome === 'synced') this.smoother.clear();
    else if (result.outcome === 'applied' && this.smoothing) {
      for (const c of result.corrections) {
        const kind = this.smoother.absorb(c.slot, { pos: c.before.pos, quat: c.before.quat }, { pos: c.after.pos, quat: c.after.quat });
        if (kind === 'snapped' && c.error > 0) this.stats.recordSnap();
      }
    }
    return result;
  }

  /** Poses to draw this frame; `alpha` is the fraction of the way to the next fixed step, `dtSeconds` the frame time. */
  frame(alpha: number, dtSeconds: number): RenderPose[] {
    this.smoother.decay(dtSeconds);
    return this.predictor.poses(alpha).map((p) => {
      const drawn = this.smoother.apply(p.slot, { pos: p.state.pos, quat: p.state.quat });
      return {
        slot: p.slot,
        pos: drawn.pos,
        quat: drawn.quat,
        linvel: p.state.linvel,
        flags: p.flags,
        hp: p.hp,
        throttle: p.throttle,
        steer: p.steer,
        visible: p.visible,
      };
    });
  }

  dispose(): void {
    this.predictor.dispose();
    this.smoother.clear();
  }
}
