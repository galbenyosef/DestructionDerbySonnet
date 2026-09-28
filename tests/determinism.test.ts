import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../src/shared/physics';
import { runScripted, scriptedInput, simHash } from '../src/shared/determinism';

beforeAll(async () => {
  await initPhysics();
});

describe('scriptedInput', () => {
  it('stays inside the legal range and is a pure function of slot and tick', () => {
    for (let slot = 0; slot < 8; slot++) {
      for (let tick = 0; tick < 1200; tick += 7) {
        const a = scriptedInput(slot, tick);
        expect(a).toEqual(scriptedInput(slot, tick));
        expect(Math.abs(a.throttle)).toBeLessThanOrEqual(1);
        expect(Math.abs(a.steer)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('exercises throttle, reverse, both steering directions and the handbrake', () => {
    const inputs = Array.from({ length: 600 }, (_, t) => scriptedInput(0, t));
    expect(inputs.some((i) => i.throttle === 1)).toBe(true);
    expect(inputs.some((i) => i.throttle === -1)).toBe(true);
    expect(inputs.some((i) => i.steer > 0.5)).toBe(true);
    expect(inputs.some((i) => i.steer < -0.5)).toBe(true);
    expect(inputs.some((i) => i.handbrake)).toBe(true);
  });
});

describe('simHash', () => {
  it('is a fixed-width hex string', () => {
    expect(simHash(60)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is identical across repeated runs in one process', () => {
    expect(simHash(600)).toBe(simHash(600));
  });

  it('does not depend on the order the roster is given in', () => {
    expect(simHash(300, [2, 0, 1])).toBe(simHash(300, [0, 1, 2]));
  });

  it('changes when the run is longer, shorter or has different cars', () => {
    const base = simHash(300);
    expect(simHash(301)).not.toBe(base);
    expect(simHash(299)).not.toBe(base);
    expect(simHash(300, [0, 1])).not.toBe(base);
  });

  it('covers contact dynamics: the scripted cars really collide within 600 ticks', () => {
    const run = runScripted(600, [0, 1, 2]);
    expect(run.closestApproach).toBeLessThan(5);
    expect(run.topSpeed).toBeGreaterThan(10);
  });
});
