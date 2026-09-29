import { ARENA } from '../../shared/constants';
import { clamp, vlerp } from '../../shared/math';
import type { Vec3 } from '../../shared/types';
import type { ChaseView } from './camera';

/** A car the spectator camera may follow. */
export interface Followable {
  slot: number;
  pos: Vec3;
  alive: boolean;
  visible: boolean;
}

/** The next car to watch after `current`, in slot order (`direction` 1 = up, -1 = down), skipping cars that are out. -1 when none is left. */
export function nextTarget(cars: readonly Followable[], current: number, direction: 1 | -1): number {
  const running = cars.filter((c) => c.alive && c.visible).sort((a, b) => a.slot - b.slot);
  if (running.length === 0) return -1;
  if (direction > 0) return (running.find((c) => c.slot > current) ?? running[0]!).slot;
  return (running.findLast((c) => c.slot < current) ?? running[running.length - 1]!).slot;
}

const ORBIT_RADIUS = 13;
const ORBIT_HEIGHT = 6;
const ORBIT_SPEED = 0.25; // rad/s: a lap every 25 s
/** The camera never goes further from the arena's centre than this: outside the barrier all it would see is the back of the wall. */
export const MAX_CAMERA_RADIUS = ARENA.RADIUS - 1.5;

/** Where to put the camera to look at a car from `angle` radians around it (0 = on the +X side). */
export function computeOrbitView(target: Vec3, angle: number): ChaseView {
  let x = target.x + Math.cos(angle) * ORBIT_RADIUS;
  let z = target.z + Math.sin(angle) * ORBIT_RADIUS;
  const r = Math.hypot(x, z);
  if (r > MAX_CAMERA_RADIUS) {
    x *= MAX_CAMERA_RADIUS / r;
    z *= MAX_CAMERA_RADIUS / r;
  }
  return {
    position: { x, y: target.y + ORBIT_HEIGHT, z },
    lookAt: { x: target.x, y: target.y + 0.8, z: target.z },
    fov: 62,
  };
}

/** What the camera does while you have no car to drive: orbit a car that is still running, and move on when it is out. */
export class SpectatorCamera {
  private target = -1;
  private angle = Math.PI;
  private position: Vec3 | null = null;
  private lookAt: Vec3 | null = null;

  /** Slot of the car being watched (-1: none). */
  get watching(): number {
    return this.target;
  }

  /** Switches to the next (1) or previous (-1) car that is still running. */
  cycle(cars: readonly Followable[], direction: 1 | -1): void {
    this.target = nextTarget(cars, this.target, direction);
  }

  /** Forgets everything (a new round). */
  reset(): void {
    this.target = -1;
    this.position = null;
    this.lookAt = null;
  }

  /** Advances the orbit by `dt` seconds and returns the smoothed view, or null when no car is left to watch. */
  view(cars: readonly Followable[], dt: number): ChaseView | null {
    if (!cars.some((c) => c.slot === this.target && c.alive && c.visible)) this.target = nextTarget(cars, this.target, 1);
    const car = cars.find((c) => c.slot === this.target);
    if (!car) return null;
    this.angle += Math.max(0, Number.isFinite(dt) ? dt : 0) * ORBIT_SPEED;
    const want = computeOrbitView(car.pos, this.angle);
    if (!this.position || !this.lookAt) {
      this.position = want.position;
      this.lookAt = want.lookAt;
    } else {
      const k = clamp(1 - Math.exp(-Math.max(dt, 0) * 5), 0, 1);
      this.position = vlerp(this.position, want.position, k);
      this.lookAt = vlerp(this.lookAt, want.lookAt, k);
    }
    return { position: this.position, lookAt: this.lookAt, fov: want.fov };
  }
}
