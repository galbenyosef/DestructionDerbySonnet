import { ARENA, COMBAT } from '../shared/constants';
import { quatRotate } from '../shared/math';
import type { CarState } from '../shared/types';

export type Fault = 'flipped' | 'stuck' | 'bounds';

export interface WatchResult {
  /** Set when the car has to be eliminated for what its own state says. */
  fault: Fault | null;
  /** HP the anti-stall rule takes off this tick (0 most of the time). */
  drain: number;
}

const UP = { x: 0, y: 1, z: 0 };
const finite = (v: number): boolean => Number.isFinite(v);

/**
 * Watches one car during a live round for the elimination rules that come from the car's own state (flipped for 3 s,
 * immobile for 8 s, out of bounds) and for the anti-stall rule (20 s without hitting or being hit costs 2 HP per second
 * until the car is in a hit). Create one per car per round and call `update` once per live tick.
 */
export class CarWatch {
  private flippedTicks = 0;
  private stillTicks = 0;
  private quietTicks = 0;

  /** `inHit` is true on ticks where a hit closed for this car, as victim or as attacker. */
  update(state: CarState, inHit: boolean): WatchResult {
    const { pos, quat, linvel } = state;
    const numbers = [pos.x, pos.y, pos.z, quat.x, quat.y, quat.z, quat.w, linvel.x, linvel.y, linvel.z];
    if (!numbers.every(finite)) return { fault: 'bounds', drain: 0 }; // a broken body must not stay in the round
    if (Math.hypot(pos.x, pos.z) > ARENA.RADIUS + COMBAT.BOUNDS_MARGIN || pos.y < COMBAT.BOUNDS_MIN_Y) {
      return { fault: 'bounds', drain: 0 };
    }
    this.flippedTicks = quatRotate(quat, UP).y < COMBAT.FLIP_UP_Y ? this.flippedTicks + 1 : 0;
    if (this.flippedTicks >= COMBAT.FLIP_TICKS) return { fault: 'flipped', drain: 0 };
    this.stillTicks = Math.hypot(linvel.x, linvel.z) < COMBAT.IMMOBILE_SPEED ? this.stillTicks + 1 : 0;
    if (this.stillTicks >= COMBAT.IMMOBILE_TICKS) return { fault: 'stuck', drain: 0 };
    this.quietTicks = inHit ? 0 : this.quietTicks + 1;
    return { fault: null, drain: this.quietTicks >= COMBAT.STALL_TICKS ? COMBAT.STALL_DRAIN_PER_TICK : 0 };
  }
}
