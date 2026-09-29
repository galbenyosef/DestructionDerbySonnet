import { describe, expect, it } from 'vitest';
import { ARENA, COMBAT } from '../src/shared/constants';
import { quatFromYaw } from '../src/shared/math';
import type { CarState } from '../src/shared/types';
import { CarWatch } from '../src/server/rules';

const rolling = (over: Partial<CarState> = {}): CarState => ({
  pos: { x: 0, y: 1.07, z: 0 },
  quat: quatFromYaw(0.3),
  linvel: { x: 8, y: 0, z: 0 },
  angvel: { x: 0, y: 0, z: 0 },
  ...over,
});
const onSide: CarState = rolling({ quat: { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 } }); // quarter turn about the forward axis
const onRoof: CarState = rolling({ quat: { x: 1, y: 0, z: 0, w: 0 } });
const parked = rolling({ linvel: { x: 0.1, y: 0, z: 0.1 } });

/** Ticks a watch until it reports a fault; returns how many ticks that took (or -1). */
function ticksToFault(state: CarState, max: number, inHit = false): { ticks: number; fault: string | null } {
  const w = new CarWatch();
  for (let t = 1; t <= max; t++) {
    const r = w.update(state, inHit);
    if (r.fault) return { ticks: t, fault: r.fault };
  }
  return { ticks: -1, fault: null };
}

describe('CarWatch elimination rules', () => {
  it('leaves a car that drives around alone', () => {
    expect(ticksToFault(rolling(), 5000, true).fault).toBeNull();
  });

  it('eliminates a car that stays flipped for 3 seconds, on its side or on its roof', () => {
    expect(ticksToFault(onSide, 1000)).toEqual({ ticks: COMBAT.FLIP_TICKS, fault: 'flipped' });
    expect(ticksToFault(onRoof, 1000)).toEqual({ ticks: COMBAT.FLIP_TICKS, fault: 'flipped' });
  });

  it('forgives a flip that rights itself in time, and counts again from zero afterwards', () => {
    const w = new CarWatch();
    for (let t = 0; t < COMBAT.FLIP_TICKS - 1; t++) expect(w.update(onSide, true).fault).toBeNull();
    expect(w.update(rolling(), true).fault).toBeNull(); // back on its wheels
    for (let t = 0; t < COMBAT.FLIP_TICKS - 1; t++) expect(w.update(onSide, true).fault).toBeNull();
    expect(w.update(onSide, true).fault).toBe('flipped');
  });

  it('eliminates a car that does not move for 8 seconds, but not one that keeps rolling', () => {
    expect(ticksToFault(parked, 2000, true)).toEqual({ ticks: COMBAT.IMMOBILE_TICKS, fault: 'stuck' });
    const w = new CarWatch();
    for (let t = 0; t < 3 * COMBAT.IMMOBILE_TICKS; t++) {
      const state = t % (COMBAT.IMMOBILE_TICKS - 1) === 0 ? rolling() : parked; // a nudge every 7.98 s resets the count
      expect(w.update(state, true).fault).toBeNull();
    }
  });

  it('eliminates a car outside the arena or below the floor, at once', () => {
    const w = new CarWatch();
    expect(w.update(rolling({ pos: { x: ARENA.RADIUS + COMBAT.BOUNDS_MARGIN - 0.1, y: 1, z: 0 } }), true).fault).toBeNull();
    expect(w.update(rolling({ pos: { x: 0, y: 1, z: -(ARENA.RADIUS + COMBAT.BOUNDS_MARGIN + 0.1) } }), true).fault).toBe('bounds');
    expect(new CarWatch().update(rolling({ pos: { x: 0, y: COMBAT.BOUNDS_MIN_Y - 0.1, z: 0 } }), true).fault).toBe('bounds');
  });

  it('eliminates a car whose state is not a number, so a broken body cannot linger in the round', () => {
    expect(new CarWatch().update(rolling({ pos: { x: Number.NaN, y: 1, z: 0 } }), true).fault).toBe('bounds');
    expect(new CarWatch().update(rolling({ linvel: { x: Number.POSITIVE_INFINITY, y: 0, z: 0 } }), true).fault).toBe('bounds');
  });

  it('drains HP after 20 quiet seconds, at 2 HP per second, until the car is in a hit', () => {
    const w = new CarWatch();
    let total = 0;
    for (let t = 1; t < COMBAT.STALL_TICKS; t++) total += w.update(rolling(), false).drain;
    expect(total).toBe(0);
    for (let t = 0; t < 60; t++) total += w.update(rolling(), false).drain;
    expect(total).toBeCloseTo(2, 9); // one second of draining
    expect(w.update(rolling(), true).drain).toBe(0); // a hit stops it at once
    expect(w.update(rolling(), false).drain).toBe(0); // and the 20 s start again
  });

  it('does not let a hit-free car hide from the drain by sitting still: it is eliminated as stuck first', () => {
    expect(ticksToFault(parked, COMBAT.STALL_TICKS + 100, false).fault).toBe('stuck');
  });
});
