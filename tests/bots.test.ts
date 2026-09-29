import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ARENA, COMBAT } from '../src/shared/constants';
import { quatFromYaw } from '../src/shared/math';
import { initPhysics } from '../src/shared/physics';
import { Simulation } from '../src/shared/sim';
import type { CarState } from '../src/shared/types';
import { BOT_COLORS, BOT_NAMES, BotBrain, type BotTarget, type BotView } from '../src/server/bots';

beforeAll(async () => {
  await initPhysics();
});

const state = (x: number, z: number, yaw: number, speed = 0): CarState => ({
  pos: { x, y: 1.07, z },
  quat: quatFromYaw(yaw),
  linvel: { x: Math.cos(yaw) * speed, y: 0, z: -Math.sin(yaw) * speed },
  angvel: { x: 0, y: 0, z: 0 },
});
const target = (slot: number, x: number, z: number, hp = 100): BotTarget => ({ slot, state: state(x, z, 0), hp });

describe('BotBrain decisions', () => {
  it('steers toward a target on its right and on its left, and straight at one ahead', () => {
    const me = state(0, 0, 0); // facing +X, so +Z is to the right
    const right = new BotBrain(1, 1).think({ state: me, targets: [target(1, 20, 10)] });
    const left = new BotBrain(1, 1).think({ state: me, targets: [target(1, 20, -10)] });
    const ahead = new BotBrain(1, 1).think({ state: me, targets: [target(1, 25, 0)] });
    expect(right.steer).toBeGreaterThan(0.3);
    expect(left.steer).toBeLessThan(-0.3);
    expect(Math.abs(ahead.steer)).toBeLessThan(0.05);
    expect(ahead.throttle).toBeGreaterThan(0.9);
  });

  it('eases off for a sharp turn and rams at full throttle when close and lined up', () => {
    const me = state(0, 0, 0);
    const behind = new BotBrain(1, 1).think({ state: me, targets: [target(1, -20, 3)] });
    expect(behind.throttle).toBeLessThan(0.6);
    const close = new BotBrain(1, 0.6).think({ state: me, targets: [target(1, 6, 0)] });
    expect(close.throttle).toBe(1);
  });

  it('prefers a weakened car over a healthy one at the same distance', () => {
    const me = state(0, 0, 0);
    const brain = new BotBrain(3, 1);
    brain.think({ state: me, targets: [target(1, 20, 20, 100), target(2, 20, -20, 15)] });
    expect(brain.target).toBe(2);
    const other = new BotBrain(3, 1);
    other.think({ state: me, targets: [target(1, 20, 20, 15), target(2, 20, -20, 100)] });
    expect(other.target).toBe(1);
  });

  it('picks another target when its target is gone, and idles when nothing is left', () => {
    const me = state(0, 0, 0);
    const brain = new BotBrain(5, 1);
    brain.think({ state: me, targets: [target(1, 20, 0), target(2, -20, 0)] });
    const first = brain.target;
    const rest: BotView = { state: me, targets: [target(first === 1 ? 2 : 1, 20, 0)] };
    brain.think(rest);
    expect(brain.target).toBe(first === 1 ? 2 : 1);
    const idle = brain.think({ state: me, targets: [] });
    expect(idle).toEqual({ throttle: 0, steer: 0, handbrake: false });
    expect(brain.target).toBe(-1);
  });

  it('turns toward the middle and slows down when the wall is close ahead', () => {
    const nearWall = state(ARENA.RADIUS - 5, 0, 0, 12); // facing the wall at 12 m/s
    const out = new BotBrain(1, 1).think({ state: nearWall, targets: [target(1, ARENA.RADIUS - 5, 20)] });
    expect(Math.abs(out.steer)).toBeGreaterThan(0.6);
    expect(out.throttle).toBeLessThanOrEqual(0.7);
  });

  it('backs out turning the other way after a second of pushing without moving, then drives on', () => {
    const brain = new BotBrain(7, 1);
    const view: BotView = { state: state(0, 0, 0, 0), targets: [target(1, 3, 0)] };
    const throttles: number[] = [];
    for (let t = 0; t < 200; t++) {
      const input = brain.think(view);
      throttles.push(input.throttle);
      if (input.throttle < 0) expect(input.steer).not.toBe(0);
    }
    const first = throttles.findIndex((v) => v < 0);
    expect(first).toBeGreaterThan(55); // about a second of pushing first
    expect(first).toBeLessThan(90);
    let length = 0;
    while (throttles[first + length]! < 0) length++;
    expect(length).toBe(75); // then 75 ticks of reversing
    expect(throttles[first + length]!).toBeGreaterThan(0); // and it tries again
  });

  it('does nothing while it lies on its side', () => {
    const flipped: CarState = { ...state(0, 0, 0), quat: { x: 1, y: 0, z: 0, w: 0 } };
    expect(new BotBrain(1, 1).think({ state: flipped, targets: [target(1, 10, 0)] })).toEqual({ throttle: 0, steer: 0, handbrake: false });
  });

  it('is repeatable for a seed and differs between seeds', () => {
    const script = (seed: number): string => {
      const brain = new BotBrain(seed);
      const out: number[] = [brain.skill];
      for (let t = 0; t < 300; t++) {
        const input = brain.think({ state: state(t * 0.1, (t % 40) - 20, t * 0.01, 5), targets: [target(1, 30, 5), target(2, -20, 15, 60)] });
        out.push(input.throttle, input.steer);
      }
      return JSON.stringify(out);
    };
    expect(script(11)).toBe(script(11));
    expect(script(11)).not.toBe(script(12));
  });

  it('gives every bot a skill between 0.6 and 0.95', () => {
    for (let seed = 0; seed < 50; seed++) {
      const skill = new BotBrain(seed).skill;
      expect(skill).toBeGreaterThanOrEqual(0.6);
      expect(skill).toBeLessThan(0.95);
    }
  });

  it('has a name and colour for every seat', () => {
    expect(BOT_NAMES.length).toBeGreaterThanOrEqual(ARENA.MAX_CARS);
    expect(BOT_COLORS.length).toBeGreaterThanOrEqual(ARENA.MAX_CARS);
    expect(new Set(BOT_NAMES).size).toBe(BOT_NAMES.length);
  });
});

describe('BotBrain driving the real simulation', () => {
  const sims: Simulation[] = [];
  afterEach(() => {
    while (sims.length) sims.pop()!.dispose();
  });

  /** Runs `ticks` steps with a brain per bot slot; `still` slots get no input. Returns the biggest wall impulse seen. */
  function race(slots: number[], brains: Map<number, BotBrain>, ticks: number, setup?: (s: Simulation) => void) {
    const s = new Simulation(slots);
    sims.push(s);
    setup?.(s);
    const stats = { carHits: 0, wallPeak: 0, maxRadius: 0, closest: Infinity };
    for (let t = 0; t < ticks; t++) {
      for (const [slot, brain] of brains) {
        const targets: BotTarget[] = slots.filter((o) => o !== slot).map((o) => ({ slot: o, state: s.getState(o), hp: 100 }));
        s.setInput(slot, brain.think({ state: s.getState(slot), targets }));
      }
      s.step();
      for (const c of s.contacts(COMBAT.SCRAPE_IMPULSE)) {
        if (c.b >= 0) stats.carHits++;
        else stats.wallPeak = Math.max(stats.wallPeak, c.impulse);
      }
      for (const slot of slots) {
        const p = s.getState(slot).pos;
        stats.maxRadius = Math.max(stats.maxRadius, Math.hypot(p.x, p.z));
        for (const o of slots) if (o > slot) stats.closest = Math.min(stats.closest, Math.hypot(p.x - s.getState(o).pos.x, p.z - s.getState(o).pos.z));
      }
    }
    return { sim: s, stats };
  }

  it('drives to a parked car and hits it', () => {
    const { stats } = race([0, 1], new Map([[0, new BotBrain(1, 0.9)]]), 60 * 12, (s) => {
      s.setState(0, { ...state(-30, 0, 0), pos: { x: -30, y: 1.07, z: 0 } });
      s.setState(1, { ...state(10, 8, 1.2), pos: { x: 10, y: 1.07, z: 8 } });
    });
    expect(stats.carHits).toBeGreaterThan(0);
  });

  it('circles the arena hunting another bot without hitting the wall hard, and never leaves', () => {
    const brains = new Map([
      [0, new BotBrain(21, 0.8)],
      [1, new BotBrain(22, 0.8)],
    ]);
    const { stats } = race([0, 1], brains, 60 * 40);
    expect(stats.maxRadius).toBeLessThan(ARENA.RADIUS);
    expect(stats.carHits).toBeGreaterThan(0);
    expect(stats.wallPeak).toBeLessThan(20_000); // scrapes and glancing blows at most, never a full-speed crash
  });

  it('keeps four bots fighting for a minute without anyone escaping the arena', () => {
    const brains = new Map([0, 1, 2, 3].map((slot) => [slot, new BotBrain(100 + slot)] as const));
    const { stats, sim } = race([0, 1, 2, 3], brains, 60 * 60);
    expect(stats.maxRadius).toBeLessThan(ARENA.RADIUS);
    expect(stats.carHits).toBeGreaterThan(3);
    for (const slot of sim.slots) expect(Number.isFinite(sim.getState(slot).pos.x)).toBe(true);
  });
});
