import { describe, expect, it } from 'vitest';
import { initPhysics, physicsReady } from '../src/shared/physics';
import { Simulation } from '../src/shared/sim';

// Deliberately no beforeAll(initPhysics): every test file gets a fresh module registry, so physics starts uninitialised here.
describe('physics initialisation guard', () => {
  it('refuses to build a Simulation before initPhysics() and says what to do', () => {
    expect(physicsReady()).toBe(false);
    expect(() => new Simulation([0])).toThrow(/initPhysics/);
  });

  it('works once initialised, and initPhysics can be awaited repeatedly', async () => {
    await initPhysics();
    await initPhysics();
    expect(physicsReady()).toBe(true);
    const sim = new Simulation([0]);
    sim.step();
    sim.dispose();
  });
});
