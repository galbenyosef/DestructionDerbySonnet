import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../src/shared/physics';
import { ARENA_IDS, getArena } from '../src/shared/arenas';
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

describe('simHash in each arena', () => {
  // Recorded from `npm run hash -- 600 <arena>`; the browser must print the same (`await __derby.simHash(600, '<arena>')`).
  // A change to the physics, the tuning or a layout moves them on purpose or by mistake: say which, and record the new ones.
  const RECORDED = { stadium: '8719c2e8', ice: '76ca0746', quarry: '170a27e5', port: '454e9fb5' } as const;

  for (const id of ARENA_IDS) {
    it(`prints the recorded hash for ${id}`, () => {
      expect(simHash(600, [0, 1, 2], getArena(id))).toBe(RECORDED[id]);
    });
  }

  it('differs from one arena to the next', () => {
    expect(new Set(ARENA_IDS.map((id) => simHash(300, [0, 1, 2], getArena(id)))).size).toBe(ARENA_IDS.length);
  });

  it('defaults to the Stadium', () => {
    expect(simHash(120)).toBe(simHash(120, [0, 1, 2], getArena('stadium')));
  });
});
