import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ARENA, CAR, CAR_FORWARD, CAR_RIGHT, CAR_UP, DRIVE } from '../src/shared/constants';
import { NEUTRAL_INPUT, type CarInput } from '../src/shared/input';
import { quatFromYaw, quatRotate, vdot, vlen, vsub } from '../src/shared/math';
import { initPhysics } from '../src/shared/physics';
import { Simulation, type SimOptions } from '../src/shared/sim';
import type { CarState } from '../src/shared/types';
import { wheelLocalPosition } from '../src/shared/vehicle';

/** Flat, wall-less, very large ground so straight-line handling tests are not cut short. */
const FLAT: SimOptions = { walls: false, groundHalfExtent: 600 };

const sims: Simulation[] = [];
const make = (slots: number[], options?: SimOptions): Simulation => {
  const s = new Simulation(slots, options);
  sims.push(s);
  return s;
};

beforeAll(async () => {
  await initPhysics();
});
afterEach(() => {
  while (sims.length) sims.pop()!.dispose();
});

function run(sim: Simulation, ticks: number, inputs: Record<number, CarInput> = {}): void {
  for (const [slot, input] of Object.entries(inputs)) sim.setInput(Number(slot), input);
  for (let i = 0; i < ticks; i++) sim.step();
}

const fwd = (sim: Simulation, slot = 0): number => {
  const s = sim.getState(slot);
  return vdot(s.linvel, quatRotate(s.quat, CAR_FORWARD));
};
const lat = (sim: Simulation, slot = 0): number => {
  const s = sim.getState(slot);
  return vdot(s.linvel, quatRotate(s.quat, CAR_RIGHT));
};
const upY = (sim: Simulation, slot = 0): number => quatRotate(sim.getState(slot).quat, CAR_UP).y;
const yaw = (sim: Simulation, slot = 0): number => sim.getState(slot).angvel.y;
const full: CarInput = { throttle: 1, steer: 0, handbrake: false };

/** 2D separating-axis overlap (metres) between two chassis boxes in the XZ plane; > 0 means they overlap. */
function overlap(a: CarState, b: CarState): number {
  const axes = (s: CarState) => {
    const f = quatRotate(s.quat, CAR_FORWARD);
    const n = Math.hypot(f.x, f.z) || 1;
    return { f: { x: f.x / n, z: f.z / n }, r: { x: -f.z / n, z: f.x / n } };
  };
  const A = axes(a);
  const B = axes(b);
  const d = { x: b.pos.x - a.pos.x, z: b.pos.z - a.pos.z };
  let min = Infinity;
  for (const ax of [A.f, A.r, B.f, B.r]) {
    const reach = (u: { x: number; z: number }, half: number): number => Math.abs(u.x * ax.x + u.z * ax.z) * half;
    const total = reach(A.f, CAR.HALF.x) + reach(A.r, CAR.HALF.z) + reach(B.f, CAR.HALF.x) + reach(B.r, CAR.HALF.z);
    min = Math.min(min, total - Math.abs(d.x * ax.x + d.z * ax.z));
  }
  return min;
}

describe('wheel layout', () => {
  it('puts front wheels forward (+X) and right-hand wheels on +Z', () => {
    expect(wheelLocalPosition(0, 0.3)).toEqual({ x: CAR.WHEEL.X, y: CAR.WHEEL.HARD_Y - 0.3, z: CAR.WHEEL.Z });
    expect(wheelLocalPosition(1, 0.3).z).toBe(-CAR.WHEEL.Z);
    expect(wheelLocalPosition(2, 0.3).x).toBe(-CAR.WHEEL.X);
    expect(wheelLocalPosition(3, 0.3)).toEqual({ x: -CAR.WHEEL.X, y: CAR.WHEEL.HARD_Y - 0.3, z: -CAR.WHEEL.Z });
  });

  it('rejects wheel indices outside 0..3', () => {
    expect(() => wheelLocalPosition(4, 0)).toThrow(RangeError);
    expect(() => wheelLocalPosition(-1, 0)).toThrow(RangeError);
  });
});

describe('Simulation: driving', () => {
  it('settles on its suspension with all four wheels in contact', () => {
    const sim = make([0], FLAT);
    run(sim, 240);
    const s = sim.getState(0);
    expect(s.pos.y).toBeGreaterThan(0.95);
    expect(s.pos.y).toBeLessThan(1.2);
    expect(sim.getWheels(0).every((w) => w.contact)).toBe(true);
    expect(vlen(s.linvel)).toBeLessThan(0.2);
    expect(upY(sim)).toBeGreaterThan(0.99);
  });

  it('accelerates along its forward axis and is capped near MAX_SPEED', () => {
    const sim = make([0], FLAT);
    run(sim, 60);
    const start = sim.getState(0).pos;
    run(sim, 60 * 3, { 0: full });
    const v3 = fwd(sim);
    expect(v3).toBeGreaterThan(12);
    expect(v3).toBeLessThan(19);
    const s = sim.getState(0);
    const moved = vsub(s.pos, start);
    expect(vdot(moved, quatRotate(s.quat, CAR_FORWARD))).toBeGreaterThan(20);
    expect(Math.abs(vdot(moved, quatRotate(s.quat, CAR_RIGHT)))).toBeLessThan(1);
    run(sim, 60 * 8);
    expect(fwd(sim)).toBeGreaterThan(17);
    expect(fwd(sim)).toBeLessThan(DRIVE.MAX_SPEED + 0.5);
  });

  const cruise = (sim: Simulation): void => {
    run(sim, 60);
    run(sim, 60 * 4, { 0: { throttle: 0.6, steer: 0, handbrake: false } });
  };

  it('steers right for positive steer input', () => {
    const sim = make([0], FLAT);
    cruise(sim);
    run(sim, 60, { 0: { throttle: 0.6, steer: 1, handbrake: false } });
    expect(yaw(sim)).toBeLessThan(-0.5); // clockwise seen from above
    expect(lat(sim)).toBeGreaterThan(0.5); // sliding toward the car's right (+Z)
  });

  it('steers left for negative steer input', () => {
    const sim = make([0], FLAT);
    cruise(sim);
    run(sim, 60, { 0: { throttle: 0.6, steer: -1, handbrake: false } });
    expect(yaw(sim)).toBeGreaterThan(0.5);
    expect(lat(sim)).toBeLessThan(-0.5);
  });

  it('turns only the front wheels, with a negative Rapier angle for a right turn', () => {
    const sim = make([0], FLAT);
    run(sim, 30, { 0: { throttle: 0, steer: 1, handbrake: false } });
    const w = sim.getWheels(0);
    expect(w[0]!.steering).toBeLessThan(0);
    expect(w[1]!.steering).toBeLessThan(0);
    expect(w[2]!.steering).toBeCloseTo(0, 6);
    expect(w[3]!.steering).toBeCloseTo(0, 6);
  });

  it('brakes to a stop quickly without reversing through it', () => {
    const sim = make([0], FLAT);
    run(sim, 60);
    run(sim, 60 * 6, { 0: full });
    expect(fwd(sim)).toBeGreaterThan(17);
    const p0 = sim.getState(0).pos;
    sim.setInput(0, { throttle: -1, steer: 0, handbrake: false });
    let ticks = 0;
    while (fwd(sim) > 1 && ticks < 60 * 5) {
      sim.step();
      ticks++;
    }
    expect(ticks / 60).toBeLessThan(3);
    expect(vlen(vsub(sim.getState(0).pos, p0))).toBeLessThan(30);
    expect(upY(sim)).toBeGreaterThan(0.99);
  });

  it('reverses at a moderate speed', () => {
    const sim = make([0], FLAT);
    run(sim, 60);
    run(sim, 240, { 0: { throttle: -1, steer: 0, handbrake: false } });
    expect(fwd(sim)).toBeLessThan(-6);
    expect(fwd(sim)).toBeGreaterThan(-9.5);
  });

  it('does not roll over in a full-lock circle', () => {
    const sim = make([0], FLAT);
    run(sim, 60);
    sim.setInput(0, { throttle: 1, steer: 1, handbrake: false });
    let minUp = 1;
    for (let i = 0; i < 60 * 12; i++) {
      sim.step();
      if (i % 6 === 0) minUp = Math.min(minUp, upY(sim));
    }
    expect(minUp).toBeGreaterThan(0.95);
    expect(vlen(sim.getState(0).linvel)).toBeGreaterThan(10);
  });

  it('handbrake bleeds speed and swings the tail compared with coasting', () => {
    const build = (handbrake: boolean): Simulation => {
      const sim = make([0], FLAT);
      run(sim, 60);
      run(sim, 60 * 4, { 0: full });
      run(sim, 60, { 0: { throttle: 0, steer: 0.6, handbrake } });
      return sim;
    };
    const coast = build(false);
    const braked = build(true);
    expect(fwd(braked)).toBeLessThan(fwd(coast) - 2);
    expect(Math.abs(yaw(braked))).toBeGreaterThan(Math.abs(yaw(coast)) + 0.5);
  });

  it('reports increasing wheel rotation while rolling forward', () => {
    // If this fails because Rapier reports a NEGATIVE rotation, change the assertion to `< before - 1`
    // and set WHEEL_SPIN_SIGN to 1 in Task 5's carView.ts (see the note there).
    const sim = make([0], FLAT);
    run(sim, 60);
    const before = sim.getWheels(0)[2]!.rotation;
    run(sim, 60, { 0: full });
    expect(sim.getWheels(0)[2]!.rotation).toBeGreaterThan(before + 1);
  });

  it('is contained by the arena walls', () => {
    const sim = make([0]); // default arena with walls
    run(sim, 30);
    sim.setInput(0, { throttle: -1, steer: 0, handbrake: false }); // reverse from radius 32 toward the wall at 45
    let maxR = 0;
    for (let i = 0; i < 60 * 10; i++) {
      sim.step();
      const p = sim.getState(0).pos;
      maxR = Math.max(maxR, Math.hypot(p.x, p.z));
    }
    expect(maxR).toBeGreaterThan(38); // it did reach the wall...
    expect(maxR).toBeLessThan(ARENA.RADIUS); // ...and stayed inside
  });

  it('two cars driven head-on collide instead of passing through each other', () => {
    const sim = make([0, 1], FLAT); // slots 0 and 1 spawn opposite each other, facing the centre
    run(sim, 60);
    run(sim, 0, { 0: full, 1: full });
    let maxOverlap = -Infinity;
    for (let i = 0; i < 60 * 8; i++) {
      sim.step();
      maxOverlap = Math.max(maxOverlap, overlap(sim.getState(0), sim.getState(1)));
    }
    // Touching boxes overlap by ~0. The ~30 m/s impact sinks in by ~0.7 m for a tick or two before CCD resolves it,
    // whereas a car passing through the other would reach ~2 m (the chassis width). Centre distance is NOT a valid
    // criterion: after the first hit the cars rotate and legitimately touch with centres only ~3.4 m apart.
    expect(maxOverlap).toBeLessThan(1.0);
    expect(upY(sim, 0)).toBeGreaterThan(0.9);
    expect(upY(sim, 1)).toBeGreaterThan(0.9);
  });
});

describe('test helper: overlap()', () => {
  const still = { x: 0, y: 0, z: 0 };
  const at = (x: number, z: number, yawRad = 0): CarState => ({
    pos: { x, y: 1, z },
    quat: quatFromYaw(yawRad),
    linvel: still,
    angvel: still,
  });

  it('is the chassis width for coincident aligned cars and ~0 for cars touching nose to tail', () => {
    expect(overlap(at(0, 0), at(0, 0))).toBeCloseTo(2 * CAR.HALF.z, 6);
    expect(overlap(at(0, 0), at(2 * CAR.HALF.x, 0))).toBeCloseTo(0, 6);
  });

  it('is negative for separated cars and for a nose touching a broadside', () => {
    expect(overlap(at(0, 0), at(6, 0))).toBeLessThan(0);
    // car B rotated 90 degrees sits beside car A's nose: A's half-length + B's half-width apart
    expect(overlap(at(0, 0), at(CAR.HALF.x + CAR.HALF.z + 0.1, 0, Math.PI / 2))).toBeLessThan(0);
  });
});

/** Trig-free scripted driving so results do not depend on the JS engine's Math.sin. */
function scripted(sim: Simulation, ticks: number, from = 0): void {
  const steer = [-1, 0, 1, 0, 1, -1];
  for (let i = from; i < from + ticks; i++) {
    for (const slot of sim.slots) {
      sim.setInput(slot, {
        throttle: slot === 2 && i > 600 ? -1 : 1,
        steer: steer[((i >> 5) + slot) % steer.length]!,
        handbrake: (i + slot * 37) % 240 > 200,
      });
    }
    sim.step();
  }
}
const snapshot = (sim: Simulation): string => JSON.stringify(sim.slots.map((s) => sim.getState(s)));

describe('Simulation: determinism and rollback assumptions', () => {
  it('identical scripted runs are bit-identical', () => {
    const a = make([0, 1, 2]);
    const b = make([0, 1, 2]);
    scripted(a, 900);
    scripted(b, 900);
    expect(snapshot(a)).toBe(snapshot(b));
  });

  it('different inputs give different results (the check above is not trivially true)', () => {
    const a = make([0, 1, 2]);
    const b = make([0, 1, 2]);
    scripted(a, 300);
    scripted(b, 299);
    expect(snapshot(a)).not.toBe(snapshot(b));
  });

  it('resetting body state reproduces the trajectory (client rollback assumption)', () => {
    const ref = make([0], FLAT);
    scripted(ref, 150);
    const snap = ref.getState(0);
    scripted(ref, 150, 150);
    // a second world with a completely different history, restored to the tick-150 state
    const other = make([0], FLAT);
    run(other, 150, { 0: { throttle: -1, steer: 1, handbrake: true } });
    other.setState(0, snap);
    scripted(other, 150, 150);
    const a = ref.getState(0);
    const b = other.getState(0);
    expect(vlen(vsub(a.pos, b.pos))).toBeLessThan(1e-2);
    expect(vlen(vsub(a.linvel, b.linvel))).toBeLessThan(1e-2);
  });

  it('steps 8 cars fast enough for a 60 Hz server (mean < 2 ms per tick)', () => {
    const sim = make([0, 1, 2, 3, 4, 5, 6, 7]);
    const t0 = performance.now();
    scripted(sim, 600);
    expect((performance.now() - t0) / 600).toBeLessThan(2);
  });
});

describe('Simulation: rosters, inputs and lifecycle', () => {
  it('sorts and de-duplicates slots', () => {
    expect(make([3, 1, 1, 0]).slots).toEqual([0, 1, 3]);
  });

  it('rejects invalid rosters immediately', () => {
    expect(() => new Simulation([0, 1, 2, 3, 4, 5, 6, 7, 8])).toThrow(RangeError);
    expect(() => new Simulation([8])).toThrow(RangeError);
    expect(() => new Simulation([-1])).toThrow(RangeError);
    expect(() => new Simulation([1.5])).toThrow(RangeError);
  });

  it('quantizes and sanitises inputs at the simulation boundary', () => {
    const sim = make([0]);
    sim.setInput(0, { throttle: 0.5, steer: NaN, handbrake: true });
    expect(sim.getInput(0)).toEqual({ throttle: 64 / 127, steer: 0, handbrake: true });
  });

  it('rejects unknown slots', () => {
    const sim = make([0, 2]);
    expect(() => sim.setInput(1, NEUTRAL_INPUT)).toThrow(RangeError);
    expect(() => sim.getState(5)).toThrow(RangeError);
  });

  it('counts ticks', () => {
    const sim = make([0]);
    sim.step();
    sim.step();
    expect(sim.tick).toBe(2);
  });

  it('dispose is idempotent and step-after-dispose throws', () => {
    const sim = new Simulation([0, 1]);
    sim.step();
    sim.dispose();
    sim.dispose();
    expect(() => sim.step()).toThrow(/disposed/i);
  });

  it('does not leak memory when simulations are created and destroyed repeatedly', () => {
    const cycle = (): void => {
      const s = new Simulation([0, 1, 2, 3, 4, 5, 6, 7]);
      for (let i = 0; i < 10; i++) s.step();
      s.dispose();
    };
    for (let i = 0; i < 100; i++) cycle(); // warm up the allocator
    const before = process.memoryUsage().rss;
    for (let i = 0; i < 300; i++) cycle();
    const growthMb = (process.memoryUsage().rss - before) / 1048576;
    expect(growthMb).toBeLessThan(50); // without removeVehicleController this grows by ~150 MB
  });
});
