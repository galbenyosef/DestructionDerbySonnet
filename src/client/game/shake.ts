import type { PerspectiveCamera } from 'three';
import { clamp } from '../../shared/math';

export const SHAKE = {
  /** Trauma lost per second. */
  DECAY: 1.6,
  /** Shake at full trauma: sideways/vertical metres and roll in radians. */
  MAX_OFFSET: 0.35,
  MAX_ROLL: 0.03,
  /** An impact of this many kN·s is a full jolt. */
  FULL_IMPACT: 25,
  /** Shakes from cars other than yours reach this far (metres) before they are half as strong. */
  HEARD_DISTANCE: 12,
} as const;

/** How much of a jolt an impact is (0..1): by its size, and how far from the camera it happened (0 for your own car). */
export function traumaForImpact(kns: number, distance = 0): number {
  if (!(kns > 0) || !Number.isFinite(distance)) return 0;
  const size = clamp(kns / SHAKE.FULL_IMPACT, 0, 1);
  const d = Math.max(0, distance) / SHAKE.HEARD_DISTANCE;
  return size / (1 + d * d);
}

/** Smooth repeatable noise in [-1, 1]: three sines that never line up. */
const noise = (t: number, seed: number): number => (Math.sin(t * 17.3 + seed) + 0.5 * Math.sin(t * 29.1 + seed * 2.3) + 0.25 * Math.sin(t * 43.7 + seed * 3.1)) / 1.75;

/** The camera's offset at time `t` for a trauma level: it grows with the square of the trauma, so small knocks are barely felt. */
export function shakeOffset(trauma: number, t: number): { x: number; y: number; roll: number } {
  const s = clamp(trauma, 0, 1) ** 2;
  if (s === 0) return { x: 0, y: 0, roll: 0 };
  return { x: SHAKE.MAX_OFFSET * s * noise(t, 1), y: SHAKE.MAX_OFFSET * s * noise(t, 7), roll: SHAKE.MAX_ROLL * s * noise(t, 13) };
}

/** Camera shake that builds up with impacts and dies away by itself. */
export class CameraShake {
  private trauma = 0;
  private time = 0;

  get level(): number {
    return this.trauma;
  }

  /** A jolt: trauma adds up, never beyond 1. */
  add(amount: number): void {
    if (!(amount > 0)) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Moves the camera by this frame's shake (call after the camera has been placed) and lets the trauma decay. */
  apply(camera: PerspectiveCamera, dt: number): void {
    const step = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;
    this.time += step;
    const offset = shakeOffset(this.trauma, this.time);
    if (offset.x !== 0 || offset.y !== 0 || offset.roll !== 0) {
      camera.translateX(offset.x);
      camera.translateY(offset.y);
      camera.rotateZ(offset.roll);
    }
    this.trauma = Math.max(0, this.trauma - SHAKE.DECAY * step);
  }

  reset(): void {
    this.trauma = 0;
  }
}
