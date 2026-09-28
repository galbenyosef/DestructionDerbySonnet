import { NET, PHYSICS } from '../../shared/constants';
import { quatIntegrate, quatNlerp, vlerp } from '../../shared/math';
import type { Snapshot, SnapshotCar } from '../../shared/protocol';
import type { CarState } from '../../shared/types';

const TICK_MS = 1000 / PHYSICS.TICK_RATE;

export interface InterpPose {
  slot: number;
  flags: number;
  hp: number;
  state: CarState;
  throttle: number;
  steer: number;
  extrapolated: boolean;
}

export const lerpState = (a: CarState, b: CarState, t: number): CarState => ({
  pos: vlerp(a.pos, b.pos, t),
  quat: quatNlerp(a.quat, b.quat, t),
  linvel: vlerp(a.linvel, b.linvel, t),
  angvel: vlerp(a.angvel, b.angvel, t),
});

/** Dead reckoning: advance position by linear velocity and orientation by angular velocity. */
const extrapolate = (s: CarState, seconds: number): CarState => ({
  pos: { x: s.pos.x + s.linvel.x * seconds, y: s.pos.y + s.linvel.y * seconds, z: s.pos.z + s.linvel.z * seconds },
  quat: quatIntegrate(s.quat, s.angvel, seconds),
  linvel: s.linvel,
  angvel: s.angvel,
});

const pose = (c: SnapshotCar, state: CarState, extrapolated: boolean): InterpPose => ({
  slot: c.slot,
  flags: c.flags,
  hp: c.hp,
  state,
  throttle: c.throttle,
  steer: c.steer,
  extrapolated,
});

/**
 * Buffers server snapshots and renders the world `delayMs` in the past by interpolating between the two
 * snapshots that bracket the render time. The local-to-server clock offset tracks the *fastest* arrival path
 * (immediately adopts smaller offsets, drifts up slowly), which keeps jitter out of the render time.
 */
export class SnapshotInterpolator {
  private buf: Snapshot[] = [];
  private epoch: number | null = null;
  private offset: number | null = null; // local ms minus server ms
  /** Snapshots ignored because of a wrong epoch, a duplicate tick or an older tick. */
  stale = 0;

  constructor(
    private readonly delayMs: number = NET.INTERP_DELAY_MS,
    private readonly maxExtrapolationMs: number = NET.MAX_EXTRAPOLATION_MS,
    private readonly capacity = 64,
  ) {}

  get size(): number {
    return this.buf.length;
  }

  /** Switches to a new world epoch and discards all history. */
  reset(epoch: number): void {
    this.epoch = epoch & 0xff;
    this.buf = [];
    this.offset = null;
  }

  /** Returns false when the snapshot was ignored. */
  push(s: Snapshot, arrivalMs: number): boolean {
    if (this.epoch === null || s.epoch !== this.epoch) {
      this.stale++;
      return false;
    }
    const newest = this.buf[this.buf.length - 1];
    if (newest && s.tick <= newest.tick) {
      this.stale++;
      return false;
    }
    const sample = arrivalMs - s.tick * TICK_MS;
    if (this.offset === null || sample < this.offset) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.02;
    this.buf.push(s);
    if (this.buf.length > this.capacity) this.buf.shift();
    return true;
  }

  /** Poses of every car at render time (now - delay). */
  sample(nowMs: number): InterpPose[] {
    if (this.offset === null || this.buf.length === 0) return [];
    const t = nowMs - this.offset - this.delayMs; // render time in server milliseconds
    const ms = (s: Snapshot): number => s.tick * TICK_MS;
    const first = this.buf[0]!;
    const newest = this.buf[this.buf.length - 1]!;
    if (t <= ms(first)) return first.cars.map((c) => pose(c, c.state, false));
    if (t >= ms(newest)) {
      const seconds = Math.min(t - ms(newest), this.maxExtrapolationMs) / 1000;
      return newest.cars.map((c) => pose(c, extrapolate(c.state, seconds), seconds > 0));
    }
    let hi = this.buf.length - 1;
    while (hi > 0 && ms(this.buf[hi - 1]!) > t) hi--;
    const a = this.buf[hi - 1]!;
    const b = this.buf[hi]!;
    const alpha = (t - ms(a)) / (ms(b) - ms(a));
    const before = new Map(a.cars.map((c) => [c.slot, c] as const));
    return b.cars.map((cb) => {
      const ca = before.get(cb.slot);
      return ca ? pose(cb, lerpState(ca.state, cb.state, alpha), false) : pose(cb, cb.state, false);
    });
  }
}
