import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Predictor } from '../../src/client/net/prediction';
import { NEUTRAL_INPUT, type CarInput } from '../../src/shared/input';
import { initPhysics } from '../../src/shared/physics';
import { SNAP_FLAG_ALIVE, type Snapshot } from '../../src/shared/protocol';
import { Simulation } from '../../src/shared/sim';

beforeAll(async () => {
  await initPhysics();
});

const straight = (): CarInput => ({ throttle: 1, steer: 0, handbrake: false });

const sims: Simulation[] = [];
afterEach(() => {
  while (sims.length) sims.pop()!.dispose();
});

function world(slots: number[]): Simulation {
  const s = new Simulation(slots);
  sims.push(s);
  return s;
}

/** A snapshot of `sim`'s cars (optionally only some of them) as the server would send it. */
function snapshotOf(sim: Simulation, over: Partial<Snapshot> = {}, only?: number[]): Snapshot {
  return {
    epoch: 3,
    tick: 10,
    ackSeq: 0,
    cars: sim.slots
      .filter((slot) => !only || only.includes(slot))
      .map((slot) => ({ slot, flags: SNAP_FLAG_ALIVE, hp: 100, state: sim.getState(slot), throttle: 0, steer: 0 })),
    ...over,
  };
}

const posesOf = (p: Predictor) => JSON.stringify(p.poses(1));

describe('Predictor snapshot handling', () => {
  it('ignores snapshots until a world begins', () => {
    const p = new Predictor(0);
    expect(p.reconcile(snapshotOf(world([0, 1]))).outcome).toBe('dropped-epoch');
    expect(p.isSynced).toBe(false);
    expect(p.poses(1)).toEqual([]);
    p.dispose();
  });

  it('syncs on the first snapshot of an epoch, then applies later ones and replays unacknowledged inputs', () => {
    const p = new Predictor(0);
    const w = world([0, 1]);
    p.beginWorld(3);
    const first = p.reconcile(snapshotOf(w, { tick: 2, ackSeq: 0 }));
    expect(first).toMatchObject({ outcome: 'synced', corrections: [] });
    expect(p.isSynced).toBe(true);
    expect(p.poses(1).map((x) => [x.slot, x.visible])).toEqual([[0, true], [1, true]]);
    for (let i = 0; i < 3; i++) p.step(straight());
    expect(p.sequence).toBe(3);
    const next = p.reconcile(snapshotOf(w, { tick: 4, ackSeq: 1 }));
    expect(next.outcome).toBe('applied');
    expect(next.resimSteps).toBe(2);
    expect(next.corrections.map((c) => c.slot).sort()).toEqual([0, 1]);
    p.dispose();
  });

  it('drops other epochs and stale or duplicate ticks', () => {
    const p = new Predictor(0);
    const w = world([0, 1]);
    p.beginWorld(3);
    expect(p.reconcile(snapshotOf(w, { epoch: 4, tick: 2 })).outcome).toBe('dropped-epoch');
    expect(p.reconcile(snapshotOf(w, { tick: 6 })).outcome).toBe('synced');
    expect(p.reconcile(snapshotOf(w, { tick: 6 })).outcome).toBe('dropped-old');
    expect(p.reconcile(snapshotOf(w, { tick: 4 })).outcome).toBe('dropped-old');
    expect(p.counters).toMatchObject({ droppedEpoch: 1, droppedOld: 2, synced: 1 });
    p.dispose();
  });

  it('rejects nonsense without touching its state', () => {
    const p = new Predictor(0);
    const w = world([0, 1]);
    p.beginWorld(3);
    p.reconcile(snapshotOf(w, { tick: 2 }));
    const before = posesOf(p);
    expect(p.reconcile(snapshotOf(w, { tick: 4, ackSeq: 5 })).outcome).toBe('ignored'); // acknowledges inputs never sent
    const nan = snapshotOf(w, { tick: 6 });
    nan.cars[1]!.state.pos.x = Number.NaN;
    expect(p.reconcile(nan).outcome).toBe('ignored');
    const inf = snapshotOf(w, { tick: 8 });
    inf.cars[0]!.state.linvel.y = Number.POSITIVE_INFINITY;
    expect(p.reconcile(inf).outcome).toBe('ignored');
    expect(p.reconcile(snapshotOf(w, { tick: 10, cars: [] })).outcome).toBe('ignored');
    const outOfRange = snapshotOf(w, { tick: 12 });
    outOfRange.cars[0]!.slot = 99;
    expect(p.reconcile(outOfRange).outcome).toBe('ignored');
    expect(posesOf(p)).toBe(before);
    expect(p.counters.ignored).toBe(5);
    expect(p.failure).toBeNull(); // hostile input is ignored, it is not a reason to give up on prediction
    p.dispose();
  });

  it('reports a failure when it cannot build a local world, so the caller can fall back', () => {
    const p = new Predictor(0, {
      createSimulation: () => {
        throw new Error('WASM unavailable');
      },
    });
    p.beginWorld(3);
    expect(p.reconcile(snapshotOf(world([0, 1]))).outcome).toBe('ignored');
    expect(p.failure).toBe('WASM unavailable');
    expect(p.lastIgnored).toMatch(/WASM unavailable/);
    expect(p.isSynced).toBe(false);
    p.dispose();
  });

  it('numbers inputs before it has a world and replays them once it syncs', () => {
    const p = new Predictor(0);
    for (let i = 1; i <= 10; i++) expect(p.step(straight())).toBe(i);
    p.beginWorld(3);
    const r = p.reconcile(snapshotOf(world([0, 1]), { ackSeq: 4 }));
    expect(r).toMatchObject({ outcome: 'synced', resimSteps: 6 });
    p.dispose();
  });

  it('caps the replay at the history size', () => {
    const p = new Predictor(0, { historySize: 8 });
    p.beginWorld(3);
    for (let i = 0; i < 20; i++) p.step(straight());
    expect(p.reconcile(snapshotOf(world([0, 1]), { ackSeq: 2 })).resimSteps).toBe(8);
    p.dispose();
  });

  it('treats cars missing from a snapshot as parked and hidden', () => {
    const p = new Predictor(0);
    const w = world([0, 1, 2]);
    p.beginWorld(3);
    p.reconcile(snapshotOf(w, { tick: 2 }));
    p.reconcile(snapshotOf(w, { tick: 4 }, [0, 1]));
    expect(p.poses(1).map((x) => [x.slot, x.visible])).toEqual([[0, true], [1, true], [2, false]]);
    p.dispose();
  });

  it('rebuilds its world when a snapshot brings a car it has never seen', () => {
    const p = new Predictor(0);
    p.beginWorld(3);
    p.reconcile(snapshotOf(world([0, 1]), { tick: 2 }));
    const r = p.reconcile(snapshotOf(world([0, 1, 5]), { tick: 4 }));
    expect(r.outcome).toBe('synced');
    expect(p.counters.worldRebuilds).toBe(1);
    expect(p.poses(1).map((x) => x.slot)).toEqual([0, 1, 5]);
    p.dispose();
  });

  it.each([
    ['another car is 5 m away', 5, true],
    ['every other car is far away', 60, false],
  ])('%s: the local car is reset to the server state only when it could be colliding', (_label, gap, expectReset) => {
    const p = new Predictor(0);
    const w = world([0, 1]);
    p.beginWorld(3);
    const first = snapshotOf(w, { tick: 2 });
    first.cars[1]!.state.pos = { ...first.cars[0]!.state.pos, x: first.cars[0]!.state.pos.x - gap };
    p.reconcile(first);
    p.step(NEUTRAL_INPUT);
    p.step(NEUTRAL_INPUT);
    const mine = p.poses(1).find((x) => x.slot === 0)!.state; // exactly what the prediction holds after input 2
    const next = snapshotOf(w, { tick: 4, ackSeq: 2 });
    next.cars[0]!.state = { ...mine, pos: { ...mine.pos, x: mine.pos.x + 0.02 } }; // 2 cm off: inside the deadband
    next.cars[1]!.state.pos = { ...mine.pos, x: mine.pos.x - gap };
    const r = p.reconcile(next);
    expect(r.outcome).toBe('applied');
    expect(r.resetLocal).toBe(expectReset);
    p.dispose();
  });

  it('keeps the interpolation base when a snapshot needs no replay, so a frame drawn between two steps does not pop', () => {
    const p = new Predictor(0);
    const w = world([0, 1]);
    p.beginWorld(3);
    p.reconcile(snapshotOf(w, { tick: 2 }));
    for (let i = 0; i < 90; i++) p.step(straight()); // about 8 m/s: one step moves the car ~0.13 m
    const midStep = () => p.poses(0.5).find((x) => x.slot === 0)!.state.pos;
    const before = midStep();
    const now = snapshotOf(w, { tick: 4, ackSeq: p.sequence }); // the server has consumed every input and agrees exactly
    for (const c of now.cars) c.state = p.poses(1).find((x) => x.slot === c.slot)!.state;
    expect(p.reconcile(now)).toMatchObject({ outcome: 'applied', resimSteps: 0 });
    const after = midStep();
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.01);
    p.dispose();
  });

  it('treats a long run of unacknowledged inputs as a stall: shows the server state, replays nothing, resumes when acks return', () => {
    const p = new Predictor(0);
    const w = world([0, 1]);
    p.beginWorld(3);
    p.reconcile(snapshotOf(w, { tick: 2 }));
    for (let i = 0; i < 300; i++) p.step(straight());
    const stalled = p.reconcile(snapshotOf(w, { tick: 4, ackSeq: 0 }));
    expect(stalled).toMatchObject({ outcome: 'applied', stalled: true, resimSteps: 0 });
    expect(p.isStalled).toBe(true);
    expect(p.counters.stalls).toBe(1);
    const server = w.getState(0).pos;
    const shown = () => p.poses(1).find((x) => x.slot === 0)!.state.pos;
    expect(Math.hypot(shown().x - server.x, shown().z - server.z)).toBeLessThan(1e-6); // exactly the server's car, not a 300-step replay
    for (let i = 0; i < 10; i++) p.step(straight()); // local steps do not run away while stalled
    expect(Math.hypot(shown().x - server.x, shown().z - server.z)).toBeLessThan(1e-6);
    const back = p.reconcile(snapshotOf(w, { tick: 6, ackSeq: p.sequence - 12 })); // acknowledgements return
    expect(back).toMatchObject({ stalled: false, resimSteps: 12 });
    expect(p.isStalled).toBe(false);
    p.dispose();
  });

  it('detects a dead uplink from acknowledgements that stop while inputs keep flowing, and recovers when they return', () => {
    const p = new Predictor(0);
    const w = world([0, 1]);
    p.beginWorld(3);
    p.reconcile(snapshotOf(w, { tick: 2, ackSeq: 0 }));
    let tick = 2;
    for (let i = 0; i < 6; i++) {
      p.step(straight());
      p.step(straight());
      tick += 2;
      p.reconcile(snapshotOf(w, { tick, ackSeq: p.sequence - 6 })); // healthy: acknowledgements trail by 6 inputs
    }
    const frozenAck = p.sequence - 6;
    const stalledAfter: boolean[] = [];
    for (let i = 0; i < 20; i++) {
      p.step(straight());
      p.step(straight()); // two inputs per snapshot, none of them acknowledged any more
      tick += 2;
      stalledAfter.push(p.reconcile(snapshotOf(w, { tick, ackSeq: frozenAck })).stalled);
    }
    expect(stalledAfter.slice(0, 6).some(Boolean)).toBe(false); // a few snapshots of growth are not yet evidence
    expect(stalledAfter[stalledAfter.length - 1]).toBe(true); // 46 pending and growing on every snapshot
    expect(p.isStalled).toBe(true);
    const steady = p.reconcile(snapshotOf(w, { tick: tick + 2, ackSeq: p.sequence - 6 })); // acknowledgements are back
    expect(steady).toMatchObject({ stalled: false, resimSteps: 6 });
    p.dispose();
  });

  it('does not mistake steady high latency for a stall', () => {
    const p = new Predictor(0);
    const w = world([0, 1]);
    p.beginWorld(3);
    p.reconcile(snapshotOf(w, { tick: 2, ackSeq: 0 }));
    let seq = 0;
    for (let i = 1; i <= 40; i++) {
      p.step(straight());
      p.step(straight());
      seq += 2;
      const r = p.reconcile(snapshotOf(w, { tick: 2 + 2 * i, ackSeq: Math.max(0, seq - 30) })); // a constant 30 pending inputs
      expect(r.stalled).toBe(false);
    }
    p.dispose();
  });

  it('keeps counting sequence numbers through the u32 wrap', () => {
    const p = new Predictor(0, { startSeq: 0xfffffffd });
    p.beginWorld(3);
    const seqs = Array.from({ length: 5 }, () => p.step(straight()));
    expect(seqs).toEqual([0xfffffffe, 0xffffffff, 0, 1, 2]);
    expect(p.reconcile(snapshotOf(world([0, 1]), { ackSeq: 0xffffffff })).resimSteps).toBe(3);
    p.dispose();
  });

  it('starts a fresh world for a new epoch but keeps the inputs the server has not acknowledged', () => {
    const p = new Predictor(0);
    const w = world([0, 1]);
    p.beginWorld(3);
    for (let i = 0; i < 5; i++) p.step(straight());
    expect(p.reconcile(snapshotOf(w, { tick: 2, ackSeq: 2 })).resimSteps).toBe(3);
    p.beginWorld(4);
    expect(p.isSynced).toBe(false);
    expect(p.poses(1)).toEqual([]);
    for (let i = 0; i < 2; i++) p.step(NEUTRAL_INPUT);
    expect(p.reconcile(snapshotOf(w, { epoch: 4, tick: 2, ackSeq: 4 }))).toMatchObject({ outcome: 'synced', resimSteps: 3 });
    p.dispose();
  });
});

describe('Predictor while the server holds the car still', () => {
  const travelled = (p: Predictor, slot: number, from: { x: number; z: number }): number => {
    const pos = p.poses(1).find((x) => x.slot === slot)!.state.pos;
    return Math.hypot(pos.x - from.x, pos.z - from.z);
  };

  it('parks the local car while the round is not live, and lets it drive once it is', () => {
    const p = new Predictor(0);
    const w = world([0, 1]);
    p.beginWorld(3);
    p.reconcile(snapshotOf(w, { tick: 2 }));
    p.setLive(false);
    const start = p.poses(1).find((x) => x.slot === 0)!.state.pos;
    for (let i = 0; i < 120; i++) p.step(straight());
    expect(travelled(p, 0, start)).toBeLessThan(0.3); // settled on its suspension, nothing more
    p.setLive(true);
    for (let i = 0; i < 120; i++) p.step(straight());
    expect(travelled(p, 0, start)).toBeGreaterThan(5);
    p.dispose();
  });

  it('parks the local car once the server says it is out of the round', () => {
    const p = new Predictor(0);
    const w = world([0, 1]);
    p.beginWorld(3);
    p.reconcile(snapshotOf(w, { tick: 2 }));
    const wrecked = snapshotOf(w, { tick: 4 });
    wrecked.cars[0]!.flags = 0; // no SNAP_FLAG_ALIVE
    wrecked.cars[0]!.hp = 0;
    p.reconcile(wrecked);
    const start = p.poses(1).find((x) => x.slot === 0)!.state.pos;
    for (let i = 0; i < 120; i++) p.step(straight());
    expect(travelled(p, 0, start)).toBeLessThan(0.3);
    p.dispose();
  });

  it('holds the car still when the replay covers inputs sent during a countdown', () => {
    const p = new Predictor(0);
    const w = world([0, 1]);
    p.beginWorld(3);
    p.setLive(false);
    for (let i = 0; i < 10; i++) p.step(straight()); // pressed while the server was holding the cars
    p.reconcile(snapshotOf(w, { tick: 2, ackSeq: 0 }));
    const start = p.poses(1).find((x) => x.slot === 0)!.state.pos;
    expect(travelled(p, 0, start)).toBeLessThan(0.3); // the ten replayed inputs did not drive it
    p.dispose();
  });

  it('takes a new local slot with each world and keeps numbering inputs', () => {
    const p = new Predictor(-1);
    const w = world([0, 1, 2]);
    p.beginWorld(3);
    expect(p.step(straight())).toBe(1);
    p.beginWorld(4, 2); // a new round: the player now drives slot 2
    expect(p.mySlot).toBe(2);
    expect(p.sequence).toBe(1);
    p.reconcile(snapshotOf(w, { epoch: 4, tick: 2, ackSeq: 1 }));
    expect(p.hasLocalCar).toBe(true);
    expect(p.step(straight())).toBe(2);
    p.beginWorld(5); // no slot given: unchanged
    expect(p.mySlot).toBe(2);
    p.beginWorld(6, -1); // watching
    p.reconcile(snapshotOf(w, { epoch: 6, tick: 2, ackSeq: 2 }));
    expect(p.hasLocalCar).toBe(false);
    p.dispose();
  });
});
