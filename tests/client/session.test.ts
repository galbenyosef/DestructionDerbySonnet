import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ClientSession } from '../../src/client/net/session';
import type { CarInput } from '../../src/shared/input';
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

/** A snapshot of `sim`'s cars as the server would send it. */
function snapshotOf(sim: Simulation, over: Partial<Snapshot> = {}): Snapshot {
  return {
    epoch: 3,
    tick: 10,
    ackSeq: 0,
    cars: sim.slots.map((slot) => ({ slot, flags: SNAP_FLAG_ALIVE, hp: 100, state: sim.getState(slot), throttle: 0, steer: 0 })),
    ...over,
  };
}

describe('ClientSession in prediction mode', () => {
  it('predicts after the welcome, numbers inputs and counts the snapshots it applied', () => {
    const session = new ClientSession('predict');
    const w = world([0, 1]);
    session.onWelcome(0, 3);
    expect(session.mode).toBe('predict');
    expect(session.nextInput(straight())).toBe(1);
    expect(session.nextInput(straight())).toBe(2);
    session.onSnapshot(snapshotOf(w, { tick: 2, ackSeq: 0 }), 100);
    session.onSnapshot(snapshotOf(w, { tick: 4, ackSeq: 1 }), 133);
    expect(session.snapshotsReceived).toBe(2);
    expect(session.inputSequence).toBe(2);
    expect(session.poses(1, 1 / 60, 150).map((p) => [p.slot, p.visible])).toEqual([[0, true], [1, true]]);
    session.dispose();
  });

  it('starts a fresh world on a roster message and drops snapshots of the old one', () => {
    const session = new ClientSession('predict');
    const w = world([0, 1]);
    session.onWelcome(0, 3);
    session.onSnapshot(snapshotOf(w, { tick: 2 }), 100);
    session.onRoster(4, 0);
    expect(session.poses(1, 1 / 60, 120)).toEqual([]); // no world until the first snapshot of epoch 4
    session.onSnapshot(snapshotOf(w, { epoch: 3, tick: 4 }), 133); // stale epoch: dropped
    expect(session.snapshotsReceived).toBe(1);
    session.onSnapshot(snapshotOf(w, { epoch: 4, tick: 2 }), 150);
    expect(session.snapshotsReceived).toBe(2);
    session.dispose();
  });

  it('reports a stalled connection through the predictor', () => {
    const session = new ClientSession('predict');
    const w = world([0, 1]);
    session.onWelcome(0, 3);
    session.onSnapshot(snapshotOf(w, { tick: 2 }), 100);
    for (let i = 0; i < 300; i++) session.nextInput(straight());
    expect(session.stalled).toBe(false);
    session.onSnapshot(snapshotOf(w, { tick: 4, ackSeq: 0 }), 133);
    expect(session.stalled).toBe(true);
    session.dispose();
  });
});

describe('ClientSession stall notice', () => {
  it('reports the start of a stall once, and again after a recovery', () => {
    let stalls = 0;
    const session = new ClientSession('predict', { onStall: () => stalls++ });
    const w = world([0, 1]);
    session.onWelcome(0, 3);
    session.onSnapshot(snapshotOf(w, { tick: 2 }), 100);
    for (let i = 0; i < 300; i++) session.nextInput(straight());
    session.onSnapshot(snapshotOf(w, { tick: 4, ackSeq: 0 }), 133); // 300 unacknowledged inputs: the server is not hearing us
    session.onSnapshot(snapshotOf(w, { tick: 6, ackSeq: 0 }), 166); // still stalled: no second report
    expect(stalls).toBe(1);
    session.onSnapshot(snapshotOf(w, { tick: 8, ackSeq: 300 }), 200); // acknowledgements are back
    expect(session.stalled).toBe(false);
    for (let i = 0; i < 300; i++) session.nextInput(straight());
    session.onSnapshot(snapshotOf(w, { tick: 10, ackSeq: 300 }), 233); // dead again
    expect(stalls).toBe(2);
    session.dispose();
  });

  it('reports a stall again when a new world starts out stalled', () => {
    let stalls = 0;
    const session = new ClientSession('predict', { onStall: () => stalls++ });
    const w = world([0, 1]);
    session.onWelcome(0, 3);
    session.onSnapshot(snapshotOf(w, { tick: 2 }), 100);
    for (let i = 0; i < 300; i++) session.nextInput(straight());
    session.onSnapshot(snapshotOf(w, { tick: 4, ackSeq: 0 }), 133);
    expect(stalls).toBe(1);
    session.onRoster(4, 0); // a rebuild while the uplink is still dead: the new world's very first snapshot is stalled too
    session.onSnapshot(snapshotOf(w, { epoch: 4, tick: 2, ackSeq: 0 }), 250);
    expect(session.stalled).toBe(true);
    expect(stalls).toBe(2);
    session.dispose();
  });
});

describe('ClientSession across rounds', () => {
  it('learns its own slot from each roster, and holds the local car until the round is live', () => {
    const session = new ClientSession('predict');
    const w = world([0, 1]);
    session.onWelcome(-1, 3, null); // joined mid-round: watching
    expect(session.phase).toBeNull();
    session.onSnapshot(snapshotOf(w, { tick: 2 }), 100);
    expect(session.predicted!.mySlot).toBe(-1);
    expect(session.predicted!.predictor.hasLocalCar).toBe(false);

    session.onRoster(4, 1); // the next round: this player drives slot 1
    expect(session.predicted!.mySlot).toBe(1);
    expect(session.phase).toBe('countdown');
    expect(session.predicted!.predictor.isLive).toBe(false);
    session.onSnapshot(snapshotOf(w, { epoch: 4, tick: 2 }), 200);
    expect(session.predicted!.predictor.hasLocalCar).toBe(true);
    session.onPhase('live');
    expect(session.phase).toBe('live');
    expect(session.predicted!.predictor.isLive).toBe(true);
    session.onPhase('results');
    expect(session.predicted!.predictor.isLive).toBe(false);
    session.dispose();
  });

  it('holds the car again at the start of every round, even right after a live one', () => {
    const session = new ClientSession('predict');
    session.onWelcome(0, 3, 'live');
    expect(session.predicted!.predictor.isLive).toBe(true);
    session.onRoster(4, 0); // the next round opens with a countdown
    expect(session.predicted!.predictor.isLive).toBe(false);
    session.dispose();
  });

  it('copes with round messages that arrive before there is a world', () => {
    const session = new ClientSession('predict');
    expect(() => {
      session.onPhase('live');
      session.onRoster(2, 0);
      session.onPhase('countdown');
    }).not.toThrow();
    expect(session.phase).toBe('countdown');
    expect(session.predicted).toBeNull();
    expect(session.nextInput(straight())).toBe(1);
    session.dispose();
  });

  it('starts live when it joins a round that is already under way', () => {
    const session = new ClientSession('predict');
    session.onWelcome(0, 3, 'live');
    expect(session.predicted!.predictor.isLive).toBe(true);
    session.dispose();
    const counting = new ClientSession('predict');
    counting.onWelcome(0, 3, 'countdown');
    expect(counting.predicted!.predictor.isLive).toBe(false);
    counting.dispose();
  });

  it('keeps numbering inputs across rounds', () => {
    const session = new ClientSession('predict');
    session.onWelcome(0, 3, 'live');
    for (let i = 0; i < 50; i++) session.nextInput(straight());
    session.onRoster(4, 0);
    expect(session.nextInput(straight())).toBe(51);
    session.dispose();
  });

  it('says whether each car is running and how many hit points it has, in both modes', () => {
    const w = world([0, 1]);
    const snap = snapshotOf(w, { tick: 2 });
    snap.cars[1]!.flags = 0;
    snap.cars[1]!.hp = 0;
    snap.cars[0]!.hp = 61;
    const predicting = new ClientSession('predict');
    predicting.onWelcome(0, 3);
    predicting.onSnapshot(snap, 100);
    expect(predicting.poses(1, 1 / 60, 150).map((p) => [p.slot, p.alive, p.hp])).toEqual([[0, true, 61], [1, false, 0]]);
    predicting.dispose();
    const watching = new ClientSession('interp');
    watching.onWelcome(0, 3);
    watching.onSnapshot(snap, 100);
    watching.onSnapshot({ ...snap, tick: 4 }, 133);
    expect(watching.poses(1, 1 / 60, 300).map((p) => [p.slot, p.alive, p.hp])).toEqual([[0, true, 61], [1, false, 0]]);
  });
});

describe('ClientSession in interpolation mode', () => {
  it('numbers inputs itself and draws interpolated snapshots', () => {
    const session = new ClientSession('interp');
    const w = world([0, 1]);
    session.onWelcome(0, 3);
    expect(session.predicted).toBeNull();
    expect(session.nextInput(straight())).toBe(1);
    expect(session.nextInput(straight())).toBe(2);
    session.onSnapshot(snapshotOf(w, { tick: 2 }), 100);
    session.onSnapshot(snapshotOf(w, { tick: 4 }), 133);
    expect(session.snapshotsReceived).toBe(2);
    expect(session.poses(1, 1 / 60, 300).map((p) => p.slot)).toEqual([0, 1]);
    expect(session.stalled).toBe(false);
  });

  it('resets its buffer on a roster message', () => {
    const session = new ClientSession('interp');
    const w = world([0, 1]);
    session.onWelcome(0, 3);
    session.onSnapshot(snapshotOf(w, { tick: 2 }), 100);
    expect(session.interpolator.size).toBe(1);
    session.onRoster(4, 0);
    expect(session.interpolator.size).toBe(0);
  });
});

describe('ClientSession fallback', () => {
  it('falls back to interpolation when a local world cannot be built, and keeps the input sequence going', () => {
    let builds = 0;
    const reasons: string[] = [];
    const session = new ClientSession('predict', {
      world: {
        predictor: {
          createSimulation: (slots) => {
            if (++builds > 1) throw new Error('out of memory');
            return world(slots);
          },
        },
      },
      onFallback: (reason) => reasons.push(reason),
    });
    session.onWelcome(0, 3);
    session.onSnapshot(snapshotOf(world([0, 1]), { tick: 2 }), 100); // the first world builds fine
    let last = 0;
    for (let i = 0; i < 500; i++) last = session.nextInput(straight());
    expect(last).toBe(500);
    session.onSnapshot(snapshotOf(world([0, 1, 5]), { tick: 4, ackSeq: 490 }), 150); // a car it never had: needs a new world, which fails
    expect(session.mode).toBe('interp');
    expect(reasons).toEqual(['out of memory']);
    expect(session.predicted).toBeNull();
    // The next input must continue where the predictor stopped: the server drops every input that is not newer than
    // the last one it saw, so restarting at 1 would leave the player unable to drive.
    expect(session.nextInput(straight())).toBe(501);
    expect(session.nextInput(straight())).toBe(502);
    expect(session.interpolator.size).toBe(1); // the snapshot that triggered the fallback is already drawable
    expect(session.snapshotsReceived).toBe(2); // the applied first one plus the one handed to the interpolator
  });

  it('does not fall back for hostile snapshots, only for a world it cannot build', () => {
    const reasons: string[] = [];
    const session = new ClientSession('predict', { onFallback: (reason) => reasons.push(reason) });
    const w = world([0, 1]);
    session.onWelcome(0, 3);
    session.onSnapshot(snapshotOf(w, { tick: 2 }), 100);
    const nan = snapshotOf(w, { tick: 4 });
    nan.cars[0]!.state.pos.x = Number.NaN;
    session.onSnapshot(nan, 133);
    session.onSnapshot(snapshotOf(w, { tick: 6, cars: [] }), 166);
    expect(session.mode).toBe('predict');
    expect(reasons).toEqual([]);
    session.dispose();
  });
});
