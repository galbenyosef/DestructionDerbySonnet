import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { COMBAT } from '../src/shared/constants';
import { quatFromYaw } from '../src/shared/math';
import { initPhysics } from '../src/shared/physics';
import { Simulation, type Contact } from '../src/shared/sim';
import { AttackLog, HitTracker, type Hit } from '../src/server/combat';

beforeAll(async () => {
  await initPhysics();
});

const at = (x: number, z = 0) => ({ x, y: 0, z });
const carCar = (impulse: number, a = 0, b = 1): Contact => ({ a, b, impulse, pointA: at(2.3), pointB: at(2.3) });
const wall = (impulse: number, a = 0): Contact => ({ a, b: -1, impulse, pointA: at(2.3), pointB: at(0) });

/** Feeds `perTick[t]` (or nothing) at ticks 0.. and collects every hit until the windows have certainly closed. */
function run(perTick: Contact[][], extra = COMBAT.WINDOW_MAX_TICKS + 5): Hit[] {
  const tracker = new HitTracker();
  const hits: Hit[] = [];
  for (let t = 0; t < perTick.length + extra; t++) hits.push(...tracker.update(t, perTick[t] ?? []));
  return hits;
}

describe('HitTracker', () => {
  it('turns one hard collision into one hit per car, a few ticks after the impact', () => {
    const tracker = new HitTracker();
    expect(tracker.update(10, [carCar(19_200)])).toEqual([]);
    expect(tracker.update(11, [])).toEqual([]);
    expect(tracker.update(12, [])).toEqual([]);
    const hits = tracker.update(13, []); // WINDOW_GAP_TICKS after the last contact
    expect(hits.map((h) => [h.victim, h.attacker])).toEqual([[0, 1], [1, 0]]);
    for (const h of hits) {
      expect(h.tick).toBe(10);
      expect(h.zone).toBe('front');
      expect(h.impulse).toBeCloseTo(19.2, 9);
      expect(h.damage).toBeGreaterThan(24); // ~21.8 x 1.15 for a front hit
      expect(h.damage).toBeLessThan(27);
    }
  });

  it('merges the ticks of one impact and adds their impulses', () => {
    // a T-bone: a hard first tick, then two lighter ones, then the cars slide apart
    const hits = run([[], [], [carCar(9_600, 0, 1)], [carCar(1_400, 0, 1)], [carCar(900, 0, 1)]]);
    expect(hits).toHaveLength(2);
    expect(hits[0]!.impulse).toBeCloseTo(11.9, 9);
    expect(hits[0]!.tick).toBe(2);
  });

  it('ignores scrapes and pushing: any number of light ticks is never an impact', () => {
    const light = Array.from({ length: 200 }, () => [carCar(COMBAT.SCRAPE_IMPULSE - 1), wall(COMBAT.SCRAPE_IMPULSE - 1, 2)]);
    expect(run(light)).toEqual([]);
  });

  it('starts a new hit after a quiet spell', () => {
    const hits = run([[carCar(9_000)], [], [], [], [], [], [], [], [], [], [carCar(9_000)]]);
    expect(hits.filter((h) => h.victim === 0)).toHaveLength(2);
  });

  it('closes a window that stays open, so long grinding is paid for as it happens', () => {
    const grind = Array.from({ length: 65 }, () => [carCar(COMBAT.SCRAPE_IMPULSE + 150)]);
    const hits = run(grind).filter((h) => h.victim === 0);
    expect(hits).toHaveLength(3); // windows of 30, 30 and 5 ticks
    expect(hits.map((h) => h.tick)).toEqual([0, 30, 60]);
    expect(hits[0]!.impulse).toBeCloseTo((30 * (COMBAT.SCRAPE_IMPULSE + 150)) / 1000, 9);
    expect(hits[2]!.impulse).toBeCloseTo((5 * (COMBAT.SCRAPE_IMPULSE + 150)) / 1000, 9);
  });

  it('gives impacts below the minimum no damage at all', () => {
    expect(run([[carCar(COMBAT.MIN_IMPULSE * 1000 - 10)]])).toEqual([]);
  });

  it('reports a wall hit for the car alone, at half damage', () => {
    const hits = run([[wall(29_000, 3)]]);
    expect(hits).toHaveLength(1);
    const h = hits[0]!;
    expect([h.victim, h.attacker]).toEqual([3, -1]);
    const carHit = run([[carCar(29_000, 3, 4)]]).find((k) => k.victim === 3)!;
    expect(h.damage).toBeCloseTo(carHit.damage * 0.5, 6); // same impulse and front zone in both, wall factor 0.5
  });

  it('measures the zone from the impulse-weighted contact point', () => {
    const side: Contact = { a: 0, b: 1, impulse: 12_000, pointA: at(2.3), pointB: { x: 0.2, y: 0, z: 1.0 } };
    const hits = run([[side]]);
    expect(hits.find((h) => h.victim === 1)!.zone).toBe('right');
    expect(hits.find((h) => h.victim === 0)!.zone).toBe('front');
    const mixed = run([[{ a: 0, b: 1, impulse: 3_000, pointA: at(2.3), pointB: at(2.3) }, { a: 0, b: 1, impulse: 9_000, pointA: at(2.3), pointB: { x: 0, y: 0, z: -1 } }]]);
    expect(mixed.find((h) => h.victim === 1)!.zone).toBe('left'); // most of the impulse came in on the left
  });

  it('reports every hit in a fixed order and forgets open windows on reset', () => {
    const tracker = new HitTracker();
    tracker.update(0, [carCar(9_000, 2, 5), carCar(9_000, 0, 1)]);
    const hits = tracker.update(5, []);
    expect(hits.map((h) => [h.victim, h.attacker])).toEqual([[0, 1], [1, 0], [2, 5], [5, 2]]);
    tracker.update(6, [carCar(9_000)]);
    tracker.reset();
    expect(tracker.update(20, [])).toEqual([]);
  });
});

describe('AttackLog', () => {
  it('names the latest attacker as the killer and the other recent ones as assists', () => {
    const log = new AttackLog();
    log.record(1, 2, 100);
    log.record(1, 3, 200);
    log.record(1, 4, 250);
    expect(log.credit(1, 300)).toEqual({ killer: 4, assists: [2, 3] });
    expect(log.credit(0, 300)).toEqual({ killer: -1, assists: [] });
  });

  it('forgets attackers after the assist window and ignores walls and self-hits', () => {
    const log = new AttackLog();
    log.record(1, 2, 0);
    log.record(1, -1, 10);
    log.record(1, 1, 10);
    expect(log.credit(1, COMBAT.ASSIST_TICKS)).toEqual({ killer: 2, assists: [] });
    expect(log.credit(1, COMBAT.ASSIST_TICKS + 1)).toEqual({ killer: -1, assists: [] });
  });

  it('keeps the most recent hit per attacker and can be reset', () => {
    const log = new AttackLog();
    log.record(1, 2, 0);
    log.record(1, 3, 100);
    log.record(1, 2, 200);
    expect(log.credit(1, 210)).toEqual({ killer: 2, assists: [3] });
    log.reset();
    expect(log.credit(1, 210).killer).toBe(-1);
  });
});

describe('HitTracker on the real simulation', () => {
  const sims: Simulation[] = [];
  afterEach(() => {
    while (sims.length) sims.pop()!.dispose();
  });
  function drive(s: Simulation, ticks: number): Hit[] {
    const tracker = new HitTracker();
    const hits: Hit[] = [];
    for (let t = 0; t < ticks; t++) {
      s.step();
      hits.push(...tracker.update(s.tick, s.contacts(COMBAT.SCRAPE_IMPULSE)));
    }
    return hits;
  }
  const place = (s: Simulation, slot: number, x: number, z: number, yaw: number, speed: number): void =>
    s.setState(slot, {
      pos: { x, y: 1.07, z },
      quat: quatFromYaw(yaw),
      linvel: { x: Math.cos(yaw) * speed, y: 0, z: -Math.sin(yaw) * speed },
      angvel: { x: 0, y: 0, z: 0 },
    });

  it('prices a 10 m/s head-on at about a quarter of a car, on the front of both', () => {
    const s = new Simulation([0, 1]);
    sims.push(s);
    place(s, 0, -9, 0, 0, 10);
    place(s, 1, 9, 0, Math.PI, 10);
    const hits = drive(s, 90);
    expect(hits).toHaveLength(2);
    for (const h of hits) {
      expect(h.zone).toBe('front');
      expect(h.damage).toBeGreaterThan(22);
      expect(h.damage).toBeLessThan(29);
    }
  });

  it('prices a 15 m/s wall hit at about a fifth of a car', () => {
    const s = new Simulation([0]);
    sims.push(s);
    place(s, 0, 25, 0, 0, 15);
    const hits = drive(s, 150);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.attacker).toBe(-1);
    expect(hits[0]!.damage).toBeGreaterThan(15);
    expect(hits[0]!.damage).toBeLessThan(28);
  });

  it('does nothing for a gentle bump', () => {
    const s = new Simulation([0, 1]);
    sims.push(s);
    place(s, 0, -6, 0, 0, 2);
    place(s, 1, 6, 0, Math.PI, 2);
    const hits = drive(s, 150);
    expect(hits.reduce((sum, h) => sum + h.damage, 0)).toBeLessThan(2.5);
  });

  it('costs only a few HP to grind along the wall at full throttle for seven seconds', () => {
    const s = new Simulation([0]);
    sims.push(s);
    const yaw = -Math.PI / 2 - (5 * Math.PI) / 180; // along the wall, five degrees into it
    place(s, 0, 40, 0, yaw, 14);
    const tracker = new HitTracker();
    let total = 0;
    let wallTicks = 0;
    for (let t = 0; t < 600; t++) {
      s.setInput(0, { throttle: 1, steer: 0, handbrake: false });
      s.step();
      if (s.contacts().some((c) => c.b === -1)) wallTicks++;
      for (const h of tracker.update(s.tick, s.contacts(COMBAT.SCRAPE_IMPULSE))) total += h.damage;
    }
    expect(wallTicks).toBeGreaterThan(300); // it really did grind along the wall
    expect(total).toBeLessThan(12);
  });

  it('does not wear cars down when they merely push against each other at full throttle', () => {
    const s = new Simulation([0, 1]);
    sims.push(s);
    place(s, 0, -3, 0, 0, 0.5);
    place(s, 1, 3, 0, Math.PI, 0.5);
    const tracker = new HitTracker();
    const hits: Hit[] = [];
    for (let t = 0; t < 600; t++) {
      s.setInput(0, { throttle: 1, steer: 0, handbrake: false });
      s.setInput(1, { throttle: 1, steer: 0, handbrake: false });
      s.step();
      hits.push(...tracker.update(s.tick, s.contacts(COMBAT.SCRAPE_IMPULSE)));
    }
    // the cars meet within the first second (a tap and a rebound); the following nine seconds of pushing add nothing
    expect(hits.length).toBeGreaterThan(0);
    expect(Math.max(...hits.map((h) => h.tick))).toBeLessThan(90);
    expect(hits.reduce((sum, h) => sum + h.damage, 0)).toBeLessThan(12);
  });
});
