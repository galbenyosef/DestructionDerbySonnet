import { clampToBounds, DEFAULT_ARENA, type Bounds } from '../../shared/arenas';
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

/** Keys that switch the car the spectator camera follows (they steer when you drive, so they are free once you are out). */
const CYCLE_KEYS: ReadonlyMap<string, 1 | -1> = new Map([
  ['ArrowLeft', -1],
  ['KeyA', -1],
  ['KeyQ', -1],
  ['ArrowRight', 1],
  ['KeyD', 1],
  ['KeyE', 1],
]);

/** Which way a key (a `KeyboardEvent.code`) switches the watched car: -1 previous, 1 next, 0 not a switching key. */
export const cycleDirection = (code: string): 1 | -1 | 0 => CYCLE_KEYS.get(code) ?? 0;

const ORBIT_RADIUS = 13;
const ORBIT_HEIGHT = 6;
const ORBIT_SPEED = 0.25; // rad/s: a lap every 25 s
/** How far inside the playable area's edge the camera stays (m). */
const CAMERA_INSET = 1.5;
/** The camera never goes further from the arena's centre than this: outside the barrier all it would see is the back of the wall. */
export const MAX_CAMERA_RADIUS = ARENA.RADIUS - CAMERA_INSET;

/** Where to put the camera to look at a car from `angle` radians around it (0 = on the +X side), inside `bounds` (the arena's). */
export function computeOrbitView(target: Vec3, angle: number, bounds: Bounds = DEFAULT_ARENA.bounds): ChaseView {
  const { x, z } = clampToBounds(bounds, target.x + Math.cos(angle) * ORBIT_RADIUS, target.z + Math.sin(angle) * ORBIT_RADIUS, CAMERA_INSET);
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
  private bounds: Bounds = DEFAULT_ARENA.bounds;

  /** The playable area of the round's arena, which the camera stays inside. */
  setBounds(bounds: Bounds): void {
    this.bounds = bounds;
  }

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
    const want = computeOrbitView(car.pos, this.angle, this.bounds);
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
