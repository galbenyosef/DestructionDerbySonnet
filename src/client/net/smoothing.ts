import { QUAT_IDENTITY, quatConjugate, quatMul, quatNlerp, quatNormalize, vadd, vlen, vscale, vsub } from '../../shared/math';
import type { Quat, Vec3 } from '../../shared/types';

export interface SmoothPose {
  pos: Vec3;
  quat: Quat;
}

interface Offset {
  pos: Vec3;
  rot: Quat;
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
const EPSILON_POS = 1e-4; // metres
const EPSILON_ROT = 1e-4; // 1 - |w| of the offset quaternion (~0.8 milliradians)

const finitePose = (p: SmoothPose): boolean =>
  Number.isFinite(p.pos.x) && Number.isFinite(p.pos.y) && Number.isFinite(p.pos.z) &&
  Number.isFinite(p.quat.x) && Number.isFinite(p.quat.y) && Number.isFinite(p.quat.z) && Number.isFinite(p.quat.w);

/**
 * Hides prediction corrections. When reconciliation moves a car's present pose, the difference between what was
 * on screen and the corrected pose is kept as a render offset that decays exponentially, so the car eases onto
 * the corrected state instead of jumping. Errors beyond `snapDistance` (or `snapAngle`) snap immediately.
 */
export class ErrorSmoother {
  private readonly offsets = new Map<number, Offset>();

  constructor(
    /** Time constant of the decay in seconds. */
    private readonly tauSeconds = 0.1,
    /** Position errors larger than this many metres are not smoothed. */
    private readonly snapDistance = 2,
    /** Orientation errors larger than this many radians are not smoothed. */
    private readonly snapAngle = 0.6,
  ) {}

  /** Adds the current offset to a simulated pose. */
  apply(slot: number, pose: SmoothPose): SmoothPose {
    const off = this.offsets.get(slot);
    if (!off) return pose;
    return { pos: vadd(pose.pos, off.pos), quat: quatNormalize(quatMul(off.rot, pose.quat)) };
  }

  /**
   * Call when reconciliation changed a car's present pose from `before` to `after`. Keeps what the player was
   * seeing continuous by storing the difference as the new offset (including any offset still decaying).
   */
  absorb(slot: number, before: SmoothPose, after: SmoothPose): 'smoothed' | 'snapped' {
    if (!finitePose(before) || !finitePose(after)) {
      this.offsets.delete(slot);
      return 'snapped';
    }
    const seen = this.apply(slot, before);
    const pos = vsub(seen.pos, after.pos);
    const rot = quatNormalize(quatMul(seen.quat, quatConjugate(after.quat)));
    const angle = 2 * Math.acos(Math.min(1, Math.abs(rot.w)));
    if (vlen(pos) > this.snapDistance || angle > this.snapAngle) {
      this.offsets.delete(slot);
      return 'snapped';
    }
    this.offsets.set(slot, { pos, rot });
    return 'smoothed';
  }

  /** Advances the decay by `dtSeconds` (ignored when not a positive finite number). */
  decay(dtSeconds: number): void {
    if (!(dtSeconds > 0) || !Number.isFinite(dtSeconds)) return;
    const k = Math.exp(-dtSeconds / this.tauSeconds);
    for (const [slot, off] of this.offsets) {
      const pos = vscale(off.pos, k);
      const rot = quatNlerp(QUAT_IDENTITY, off.rot, k);
      if (vlen(pos) < EPSILON_POS && 1 - Math.abs(rot.w) < EPSILON_ROT) this.offsets.delete(slot);
      else this.offsets.set(slot, { pos, rot });
    }
  }

  /** Current positional offset in metres (0 when none). */
  offsetMagnitude(slot: number): number {
    return vlen(this.offsets.get(slot)?.pos ?? ZERO);
  }

  forget(slot: number): void {
    this.offsets.delete(slot);
  }

  clear(): void {
    this.offsets.clear();
  }
}
