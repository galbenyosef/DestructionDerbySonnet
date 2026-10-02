import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { COMBAT } from '../../src/shared/constants';
import { quatFromYaw } from '../../src/shared/math';
import { initPhysics } from '../../src/shared/physics';
import type { HitMessage, KoMessage } from '../../src/shared/protocol';
import { ARENAS } from '../../src/shared/arenas';
import { Simulation } from '../../src/shared/sim';
import type { CarState } from '../../src/shared/types';
import { RoundState, type StepEvents } from '../../src/server/round';

beforeAll(async () => {
  await initPhysics();
});

const sims: Simulation[] = [];
afterEach(() => {
  while (sims.length) sims.pop()!.dispose();
});

const still = (x: number, z: number, yaw = 0, speed = 0): CarState => ({
  pos: { x, y: 1.07, z },
  quat: quatFromYaw(yaw),
  linvel: { x: Math.cos(yaw) * speed, y: 0, z: -Math.sin(yaw) * speed },
  angvel: { x: 0, y: 0, z: 0 },
});

/** A round of `slots.length` cars, with a helper that runs it and collects every event. */
function setup(slots: number[], place?: (sim: Simulation) => void) {
  const sim = new Simulation(slots);
  sims.push(sim);
  place?.(sim);
  const state = new RoundState(slots);
  const hits: HitMessage[] = [];
  const kos: KoMessage[] = [];
  const run = (ticks: number, each?: (tick: number) => void): StepEvents => {
    const last: StepEvents = { hits: [], kos: [] };
    for (let t = 0; t < ticks; t++) {
      each?.(sim.tick);
      sim.step();
      const events = state.step(sim.tick, sim);
      hits.push(...events.hits);
      kos.push(...events.kos);
    }
    return last;
  };
  return { sim, state, hits, kos, run };
}

const headOn = (sim: Simulation): void => {
  sim.setState(0, still(-9, 0, 0, 10));
  sim.setState(1, still(9, 0, Math.PI, 10));
};

describe('RoundState.step: impacts', () => {
  it('turns a head-on collision into a hit on each car, HP off, and points for the damage dealt', () => {
    const { state, hits, run } = setup([0, 1], headOn);
    run(90);
    expect(hits).toHaveLength(2);
    for (const h of hits) {
      expect(h.zone).toBe('front');
      expect(h.attacker).toBe(h.victim === 0 ? 1 : 0);
      expect(h.dmg).toBeGreaterThan(22);
      expect(h.dmg).toBeLessThan(29);
      expect(h.hp).toBeCloseTo(100 - h.dmg, 1);
      expect(h.j).toBeGreaterThan(17);
      expect(h.p[0]).toBeGreaterThan(2); // the front face of the car that was hit
    }
    for (const slot of [0, 1]) {
      const car = state.status.get(slot)!;
      expect(car.hp).toBeCloseTo(100 - hits.find((h) => h.victim === slot)!.dmg, 0);
      expect(car.damage).toBeCloseTo(hits.find((h) => h.attacker === slot)!.dmg, 0); // dealt what the other lost
      expect(car.gained).toBeCloseTo(car.damage * COMBAT.POINTS_PER_HP, 9);
    }
  });

  it('hurts less against a wall, gives the wall no points, and reports attacker -1', () => {
    const { state, hits, run } = setup([0], (sim) => sim.setState(0, still(25, 0, 0, 15)));
    run(150);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.attacker).toBe(-1);
    expect(hits[0]!.dmg).toBeGreaterThan(15);
    expect(hits[0]!.dmg).toBeLessThan(28);
    expect(state.status.get(0)!.gained).toBe(0);
  });

  it('does not take more HP than a car has left, nor credit more damage than was done', () => {
    const { state, hits, run } = setup([0, 1], headOn);
    state.status.get(1)!.hp = 5;
    run(90);
    expect(hits.find((h) => h.victim === 1)!.dmg).toBe(5);
    expect(state.status.get(0)!.damage).toBeCloseTo(5, 9);
  });

  it('ignores hits on a wreck', () => {
    const { state, hits, kos, run } = setup([0, 1], headOn);
    state.eliminate(1, 'disconnected', 0);
    run(90);
    expect(hits.map((h) => h.victim)).toEqual([0]); // the wreck still hits back, but is not hurt
    expect(kos).toHaveLength(0);
    expect(state.status.get(1)!.hp).toBe(0);
  });
});

describe('RoundState.step: wrecks are obstacles', () => {
  const wreckRun = (hpOfVictim?: number) => {
    const t = setup([0, 1], headOn);
    t.state.eliminate(1, 'disconnected', 0); // car 1 is out before the cars meet
    if (hpOfVictim !== undefined) t.state.status.get(0)!.hp = hpOfVictim;
    t.run(90);
    return t;
  };

  it('hurts a car that rams it at wall strength, not at the strength of a running car', () => {
    const alive = setup([0, 1], headOn);
    alive.run(90);
    const { hits } = wreckRun();
    const byCar = alive.hits.find((h) => h.victim === 0)!;
    const byWreck = hits.find((h) => h.victim === 0)!;
    expect(byWreck.attacker).toBe(1); // still named, so a client can dent the wreck
    expect(byWreck.dmg).toBeGreaterThan(5);
    expect(Math.abs(byWreck.dmg - byCar.dmg * COMBAT.WALL_MULTIPLIER)).toBeLessThanOrEqual(0.1);
  });

  it('earns a wreck nothing: no points, no damage dealt, no kills, no place in the assist log', () => {
    const { state } = wreckRun();
    expect(state.status.get(1)).toMatchObject({ alive: false, kills: 0, damage: 0, gained: 0 });
  });

  it('does not name a wreck as the killer of the car that rams it', () => {
    const { state, kos } = wreckRun(4);
    expect(kos).toMatchObject([{ victim: 0, killer: -1, assists: [], reason: 'damage' }]);
    expect(state.status.get(1)).toMatchObject({ kills: 0, gained: 0 });
  });

  it('still credits the last blow of a car that goes out while its hit is being paid out', () => {
    const probe = setup([0, 1], headOn);
    probe.run(90);
    const opened = probe.hits.find((h) => h.victim === 0)!.tick; // the tick the impact began
    const t = setup([0, 1], headOn);
    t.state.status.get(0)!.hp = 4;
    t.run(90, (tick) => {
      if (tick === opened) t.state.eliminate(1, 'stuck', tick); // it was running when the blow landed
    });
    expect(t.kos.find((k) => k.victim === 0)).toMatchObject({ killer: 1, reason: 'damage' });
    expect(t.state.status.get(1)!.kills).toBe(1);
  });
});

describe('RoundState.step: eliminations', () => {
  it('eliminates a car whose HP runs out, credits the killer with the points, and lists assists', () => {
    const { state, hits, kos, run } = setup([0, 1, 2], (sim) => {
      sim.setState(0, still(-9, 0, 0, 10));
      sim.setState(1, still(9, 0, Math.PI, 10));
      sim.setState(2, still(0, 30, 0, 0));
    });
    state.status.get(1)!.hp = 8;
    // car 2 hit car 1 a moment ago: it should come out as an assist
    (state as unknown as { log: { record(v: number, a: number, t: number): void } }).log.record(1, 2, 0);
    run(90);
    expect(kos).toHaveLength(1);
    expect(kos[0]).toMatchObject({ victim: 1, killer: 0, assists: [2], reason: 'damage' });
    expect(state.isAlive(1)).toBe(false);
    expect(state.status.get(0)!.kills).toBe(1);
    expect(state.status.get(0)!.gained).toBeCloseTo(8 + COMBAT.KILL_POINTS, 6);
    expect(hits.find((h) => h.victim === 1)!.hp).toBe(0);
  });

  it('gives nobody the kill when a player who was hit a moment ago disconnects', () => {
    const { state } = setup([0, 1]);
    (state as unknown as { log: { record(v: number, a: number, t: number): void } }).log.record(0, 1, 5);
    expect(state.eliminate(0, 'disconnected', 10)).toMatchObject({ victim: 0, killer: -1, assists: [], reason: 'disconnected' });
    expect(state.status.get(1)!.kills).toBe(0);
    expect(state.status.get(1)!.gained).toBe(0);
  });

  it('credits a wall kill to the car that hit the victim last, if that was recent', () => {
    const { state, kos, run } = setup([0, 1], (sim) => {
      sim.setState(0, still(25, 0, 0, 15)); // into the wall
      sim.setState(1, still(-30, 30, 0, 0));
    });
    state.status.get(0)!.hp = 10;
    (state as unknown as { log: { record(v: number, a: number, t: number): void } }).log.record(0, 1, 0);
    run(150);
    expect(kos).toMatchObject([{ victim: 0, killer: 1, assists: [], reason: 'damage' }]);
    expect(state.status.get(1)!.kills).toBe(1);
  });

  it('eliminates a car that stays on its roof for three seconds', () => {
    const { kos, run } = setup([0], (sim) =>
      sim.setState(0, { ...still(0, 0), pos: { x: 0, y: 0.7, z: 0 }, quat: { x: 1, y: 0, z: 0, w: 0 } }),
    );
    run(COMBAT.FLIP_TICKS + 30);
    expect(kos).toMatchObject([{ victim: 0, killer: -1, reason: 'flipped' }]);
    expect(kos[0]!.tick).toBeGreaterThanOrEqual(COMBAT.FLIP_TICKS);
    expect(kos[0]!.tick).toBeLessThan(COMBAT.FLIP_TICKS + 5);
  });

  it('eliminates a car that does not move for eight seconds', () => {
    const { kos, run } = setup([0, 1], (sim) => {
      sim.setState(0, still(-20, 0));
      sim.setState(1, still(20, 0));
    });
    run(COMBAT.IMMOBILE_TICKS + 10);
    expect(kos.map((k) => [k.victim, k.reason])).toEqual([[0, 'stuck'], [1, 'stuck']]);
  });

  it('eliminates a car that leaves the arena', () => {
    const { kos, run } = setup([0], (sim) => sim.setState(0, still(60, 0, 0, 0)));
    run(3);
    expect(kos).toMatchObject([{ victim: 0, reason: 'bounds' }]);
  });

  it('replaces a car whose body went to NaN with a finite wreck, so no snapshot of the round can carry NaN', () => {
    const allFinite = (st: CarState): boolean =>
      [st.pos.x, st.pos.y, st.pos.z, st.quat.x, st.quat.y, st.quat.z, st.quat.w, st.linvel.x, st.linvel.y, st.linvel.z, st.angvel.x, st.angvel.y, st.angvel.z].every(
        Number.isFinite,
      );
    const { sim, kos, run } = setup([0, 1], (s) => {
      s.setState(0, still(-20, 0));
      s.setState(1, still(20, 0, Math.PI, 3));
    });
    sim.setState(0, { ...still(0, 0), pos: { x: Number.NaN, y: 1.07, z: 0 } });
    expect(allFinite(sim.getState(0))).toBe(false);
    run(1);
    expect(kos).toMatchObject([{ victim: 0, killer: -1, reason: 'bounds' }]);
    expect(allFinite(sim.getState(0))).toBe(true); // replaced within the same tick, before the snapshot is built
    run(300);
    expect([0, 1].every((slot) => allFinite(sim.getState(slot)))).toBe(true);
  });

  it('plays by the arena it is given: bounds and the place a broken car is put back', () => {
    const sim = new Simulation([0, 1], { arena: ARENAS.port });
    sims.push(sim);
    sim.setState(0, still(-20, 0));
    sim.setState(1, still(20, 0, Math.PI, 3));
    const state = new RoundState([0, 1], ARENAS.port);
    sim.setState(0, { ...still(0, 0), pos: { x: Number.NaN, y: 1.07, z: 0 } });
    sim.step();
    const events = state.step(sim.tick, sim);
    expect(events.kos).toMatchObject([{ victim: 0, reason: 'bounds' }]);
    const back = sim.getState(0).pos;
    expect(back).toMatchObject({ x: -12, z: -26 }); // the port's first spawn, not a point of the Stadium's ring
    sim.setState(1, still(20, 36.5, 0, 0));
    sim.step();
    expect(state.step(sim.tick, sim).kos).toMatchObject([{ victim: 1, reason: 'bounds' }]); // 3.5 m beyond the yard's wall
  });

  it('also replaces a wreck whose body goes to NaN later', () => {
    const { sim, state, run } = setup([0, 1], (s) => {
      s.setState(0, still(-20, 0));
      s.setState(1, still(20, 0));
    });
    state.eliminate(0, 'disconnected', 0);
    run(2);
    sim.setState(0, { ...still(0, 0), pos: { x: 0, y: Number.POSITIVE_INFINITY, z: 0 } });
    run(1);
    const st = sim.getState(0);
    expect(Object.values(st.pos).every(Number.isFinite)).toBe(true);
    expect(state.isAlive(0)).toBe(false);
  });

  it('drains a car that avoids every fight, and eliminates it when the HP is gone', () => {
    const { state, kos } = setup([0]);
    // drive the anti-stall rule directly: a car that keeps moving but is never in a hit
    const roll = still(0, 0, 0, 8);
    const fake = { getState: () => roll, contacts: () => [] } as unknown as Simulation;
    let tick = 0;
    for (; tick < COMBAT.STALL_TICKS - 1; tick++) state.step(tick, fake); // 19.98 s without a hit: not yet
    expect(state.hpOf(0)).toBe(100);
    for (let t = 0; t < 60; t++) state.step(++tick, fake); // one second of draining
    expect(state.hpOf(0)).toBeCloseTo(100 - 2, 6);
    const events: KoMessage[] = [];
    for (let t = 0; t < 60 * 60; t++) events.push(...state.step(++tick, fake).kos);
    expect(events).toMatchObject([{ victim: 0, killer: -1, assists: [], reason: 'stall' }]);
    expect(kos).toHaveLength(0);
    expect(state.isAlive(0)).toBe(false);
  });
});
