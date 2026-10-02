import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Predictor } from '../../src/client/net/prediction';
import { ARENA_IDS, ARENAS } from '../../src/shared/arenas';
import type { CarInput } from '../../src/shared/input';
import { initPhysics } from '../../src/shared/physics';
import { SNAP_FLAG_ALIVE } from '../../src/shared/protocol';
import { Simulation } from '../../src/shared/sim';
import { seedForArena } from '../helpers/arenaSeed';
import { Loopback, percentile } from '../helpers/loopback';

beforeAll(async () => {
  await initPhysics();
});

const straight = (): CarInput => ({ throttle: 1, steer: 0, handbrake: false });
const gentle = (k: number): CarInput => ({ throttle: 0.9, steer: Math.sin(k / 37 + 1) * 0.7, handbrake: false });

const loops: Loopback[] = [];
const sims: Simulation[] = [];
afterEach(() => {
  while (loops.length) loops.pop()!.dispose();
  while (sims.length) sims.pop()!.dispose();
});

describe('Predictor in the round\'s arena', () => {
  it('builds its local world from the arena it was told about', () => {
    const asked: string[] = [];
    const p = new Predictor(0, {
      createSimulation: (slots, arena) => {
        asked.push(arena.id);
        const s = new Simulation(slots, { arena });
        sims.push(s);
        return s;
      },
    });
    const server = new Simulation([0, 1], { arena: ARENAS.quarry });
    sims.push(server);
    p.beginWorld(3, 0, ARENAS.quarry);
    p.reconcile({ epoch: 3, tick: 10, ackSeq: 0, cars: server.slots.map((slot) => ({ slot, flags: SNAP_FLAG_ALIVE, hp: 100, state: server.getState(slot), throttle: 0, steer: 0 })) });
    expect(asked).toEqual(['quarry']);
    p.beginWorld(4, 0, ARENAS.port);
    p.reconcile({ epoch: 4, tick: 10, ackSeq: 0, cars: server.slots.map((slot) => ({ slot, flags: SNAP_FLAG_ALIVE, hp: 100, state: server.getState(slot), throttle: 0, steer: 0 })) });
    expect(asked).toEqual(['quarry', 'port']);
    p.dispose();
  });

  for (const id of ARENA_IDS) {
    it(`matches a real server room playing in ${id} when the network is perfect`, () => {
      const l = new Loopback({ local: straight, remote: gentle, roomSeed: seedForArena(id) });
      loops.push(l);
      l.run(6);
      expect(l.room.greeting(l.local).arena).toBe(id);
      expect(l.results.filter((r) => r.outcome === 'applied').length).toBeGreaterThan(150);
      expect(percentile(l.localErrors(), 0.95)).toBeLessThan(0.01);
      expect(Math.max(...l.localErrors())).toBeLessThan(0.05);
    });
  }
});
