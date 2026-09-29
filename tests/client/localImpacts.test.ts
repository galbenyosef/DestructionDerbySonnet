import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Predictor, type LocalImpact } from '../../src/client/net/prediction';
import { COMBAT } from '../../src/shared/constants';
import { quatFromYaw } from '../../src/shared/math';
import { initPhysics } from '../../src/shared/physics';
import { SNAP_FLAG_ALIVE, type Snapshot } from '../../src/shared/protocol';
import { Simulation } from '../../src/shared/sim';
import type { CarState } from '../../src/shared/types';

beforeAll(async () => {
  await initPhysics();
});

const sims: Simulation[] = [];
afterEach(() => {
  while (sims.length) sims.pop()!.dispose();
});

const drive = (x: number, z: number, yaw: number, speed: number): CarState => ({
  pos: { x, y: 1.07, z },
  quat: quatFromYaw(yaw),
  linvel: { x: Math.cos(yaw) * speed, y: 0, z: -Math.sin(yaw) * speed },
  angvel: { x: 0, y: 0, z: 0 },
});
const coast = { throttle: 0, steer: 0, handbrake: false };

/** A predictor for slot 0 that has been synced to a world where `place` has put the cars. */
function predictor(slots: number[], place: (s: Simulation) => void): Predictor {
  const s = new Simulation(slots);
  sims.push(s);
  place(s);
  const snapshot: Snapshot = {
    epoch: 3,
    tick: 1,
    ackSeq: 0,
    cars: slots.map((slot) => ({ slot, flags: SNAP_FLAG_ALIVE, hp: 100, state: s.getState(slot), throttle: 0, steer: 0 })),
  };
  const p = new Predictor(0);
  p.beginWorld(3);
  expect(p.reconcile(snapshot).outcome).toBe('synced');
  return p;
}

function run(p: Predictor, ticks: number): LocalImpact[] {
  const seen: LocalImpact[] = [];
  for (let i = 0; i < ticks; i++) {
    p.step(coast);
    seen.push(...p.takeImpacts());
  }
  return seen;
}

describe('Predictor.takeImpacts', () => {
  it('reports a head-on collision the moment the local prediction has it: the other car, how hard, and where on our car', () => {
    const p = predictor([0, 1], (s) => {
      s.setState(0, drive(-9, 0, 0, 10));
      s.setState(1, drive(9, 0, Math.PI, 10));
    });
    const impacts = run(p, 90);
    const hard = impacts.filter((i) => i.kns > 2);
    expect(hard.length).toBeGreaterThan(0);
    expect(hard[0]).toMatchObject({ slot: 0, other: 1 });
    expect(hard[0]!.point.x).toBeGreaterThan(2); // the front face of our car
    expect(impacts.reduce((sum, i) => sum + i.kns, 0)).toBeGreaterThan(15); // about 19 kN·s per car in total
    p.dispose();
  });

  it('reports a wall as the other car being -1', () => {
    const p = predictor([0], (s) => s.setState(0, drive(25, 0, 0, 15)));
    const impacts = run(p, 120);
    expect(impacts.length).toBeGreaterThan(0);
    expect(impacts.every((i) => i.other === -1 && i.slot === 0)).toBe(true);
    expect(Math.max(...impacts.map((i) => i.kns))).toBeGreaterThan(10);
    p.dispose();
  });

  it('says nothing for a car that touches nothing, or only scrapes lightly, and hands each impact over once', () => {
    const p = predictor([0, 1], (s) => {
      s.setState(0, drive(-20, 0, 0, 0));
      s.setState(1, drive(20, 0, Math.PI, 0));
    });
    expect(run(p, 60)).toEqual([]);
    expect(p.takeImpacts()).toEqual([]);
    const q = predictor([0], (s) => s.setState(0, drive(25, 0, 0, 15)));
    q.step(coast);
    for (let i = 0; i < 120; i++) q.step(coast);
    const first = q.takeImpacts();
    expect(first.length).toBeGreaterThan(0);
    expect(q.takeImpacts()).toEqual([]);
    for (const i of first) expect(i.kns * 1000).toBeGreaterThanOrEqual(COMBAT.SCRAPE_IMPULSE);
    p.dispose();
    q.dispose();
  });

  it('does not repeat an impact when a snapshot makes it replay the same ticks', () => {
    const s = new Simulation([0, 1]);
    sims.push(s);
    s.setState(0, drive(-9, 0, 0, 10));
    s.setState(1, drive(9, 0, Math.PI, 10));
    const snap = (tick: number, ackSeq: number): Snapshot => ({
      epoch: 3,
      tick,
      ackSeq,
      cars: [0, 1].map((slot) => ({ slot, flags: SNAP_FLAG_ALIVE, hp: 100, state: s.getState(slot), throttle: 0, steer: 0 })),
    });
    const p = new Predictor(0);
    p.beginWorld(3);
    p.reconcile(snap(1, 0));
    const live = run(p, 100);
    const total = live.reduce((sum, i) => sum + i.kns, 0);
    expect(total).toBeGreaterThan(15);
    // a snapshot from long ago: the predictor rewinds and replays 100 ticks, passing through the collision again
    const late = p.reconcile(snap(2, 1));
    expect(late.resimSteps).toBeGreaterThan(50);
    expect(p.takeImpacts()).toEqual([]);
    p.dispose();
  });

  it('forgets the impacts nobody read when a new world begins, and keeps at most 64 unread ones', () => {
    const p = predictor([0], (s) => s.setState(0, drive(25, 0, 0, 15)));
    for (let i = 0; i < 150; i++) p.step(coast);
    expect(p.takeImpacts().length).toBeLessThanOrEqual(64);
    for (let i = 0; i < 20; i++) p.step(coast);
    p.beginWorld(4);
    expect(p.takeImpacts()).toEqual([]);
    p.dispose();
  });
});
