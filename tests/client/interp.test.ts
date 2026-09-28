import { describe, expect, it } from 'vitest';
import { SnapshotInterpolator } from '../../src/client/net/interp';
import type { Snapshot, SnapshotCar } from '../../src/shared/protocol';

const TICK_MS = 1000 / 60;
const car = (slot: number, x: number, vx = 0): SnapshotCar => ({
  slot,
  flags: 1,
  hp: 100,
  state: { pos: { x, y: 1, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 }, linvel: { x: vx, y: 0, z: 0 }, angvel: { x: 0, y: 0, z: 0 } },
  throttle: 0,
  steer: 0,
});
const snap = (tick: number, cars: SnapshotCar[], epoch = 1): Snapshot => ({ epoch, tick, ackSeq: 0, cars });

/** Two snapshots (ticks 0 and 2) that arrive with zero jitter; render time 0 corresponds to now = 1100 (delay 100). */
function twoSnapshots(): SnapshotInterpolator {
  const i = new SnapshotInterpolator(100, 250);
  i.reset(1);
  i.push(snap(0, [car(0, 0, 10)]), 1000);
  i.push(snap(2, [car(0, 10, 10)]), 1000 + 2 * TICK_MS);
  return i;
}

describe('SnapshotInterpolator', () => {
  it('returns nothing before a world epoch is set or any snapshot arrives', () => {
    const i = new SnapshotInterpolator();
    expect(i.sample(5000)).toEqual([]);
    i.reset(1);
    expect(i.sample(5000)).toEqual([]);
  });

  it('interpolates between the two bracketing snapshots', () => {
    const i = twoSnapshots();
    const poses = i.sample(1100 + TICK_MS); // render time = halfway between tick 0 and tick 2
    expect(poses).toHaveLength(1);
    expect(poses[0]!.state.pos.x).toBeCloseTo(5, 4);
    expect(poses[0]!.extrapolated).toBe(false);
  });

  it('holds the oldest snapshot when render time is earlier than the buffer', () => {
    const i = twoSnapshots();
    expect(i.sample(1000)[0]!.state.pos.x).toBe(0);
  });

  it('extrapolates with velocity when the buffer runs dry, capped at maxExtrapolationMs', () => {
    const i = twoSnapshots();
    const newestMs = 2 * TICK_MS;
    const at100 = i.sample(1000 + 100 + newestMs + 100)[0]!; // 100 ms past the newest snapshot
    expect(at100.extrapolated).toBe(true);
    expect(at100.state.pos.x).toBeCloseTo(10 + 10 * 0.1, 4);
    const far = i.sample(1000 + 100 + newestMs + 5000)[0]!; // far past: capped at 250 ms
    expect(far.state.pos.x).toBeCloseTo(10 + 10 * 0.25, 4);
  });

  it('drops snapshots from other epochs, duplicates and older ticks', () => {
    const i = new SnapshotInterpolator();
    expect(i.push(snap(0, [car(0, 0)]), 1000)).toBe(false); // no epoch yet
    i.reset(3);
    expect(i.push(snap(1, [car(0, 0)], 2), 1000)).toBe(false); // wrong epoch
    expect(i.push(snap(4, [car(0, 0)], 3), 1000)).toBe(true);
    expect(i.push(snap(4, [car(0, 0)], 3), 1001)).toBe(false); // duplicate tick
    expect(i.push(snap(3, [car(0, 0)], 3), 1002)).toBe(false); // older tick
    expect(i.size).toBe(1);
    expect(i.stale).toBe(4);
  });

  it('reset clears history and switches epoch', () => {
    const i = twoSnapshots();
    i.reset(2);
    expect(i.size).toBe(0);
    expect(i.sample(2000)).toEqual([]);
    expect(i.push(snap(0, [car(0, 0)], 1), 1000)).toBe(false);
    expect(i.push(snap(0, [car(0, 0)], 2), 1000)).toBe(true);
  });

  it('only interpolates cars present in both snapshots and uses the newer state for new cars', () => {
    const i = new SnapshotInterpolator(100, 250);
    i.reset(1);
    i.push(snap(0, [car(0, 0), car(1, 100)]), 1000);
    i.push(snap(2, [car(0, 10), car(2, 50)]), 1000 + 2 * TICK_MS);
    const poses = i.sample(1100 + TICK_MS);
    expect(poses.map((p) => p.slot)).toEqual([0, 2]); // slot 1 vanished, slot 2 appeared
    expect(poses[0]!.state.pos.x).toBeCloseTo(5, 4);
    expect(poses[1]!.state.pos.x).toBe(50);
  });

  it('stays monotonic and close to the truth under arrival jitter', () => {
    const interp = new SnapshotInterpolator();
    interp.reset(1);
    const arrivals = Array.from({ length: 90 }, (_, i) => ({ tick: i * 2, at: 5000 + i * 2 * TICK_MS + ((i * 7919) % 26) }));
    let next = 0;
    let last = -Infinity;
    let lastNow = 5000;
    let x = 0;
    for (let now = 5000; now < 7900; now += 1000 / 60) {
      while (next < arrivals.length && arrivals[next]!.at <= now) {
        const a = arrivals[next++]!;
        interp.push(snap(a.tick, [car(0, 10 * ((a.tick * TICK_MS) / 1000), 10)]), a.at);
      }
      const poses = interp.sample(now);
      if (poses.length === 0) continue;
      x = poses[0]!.state.pos.x;
      expect(x).toBeGreaterThanOrEqual(last - 1e-9);
      last = x;
      lastNow = now;
    }
    const truth = 10 * ((lastNow - 5000 - 100) / 1000);
    expect(Math.abs(x - truth)).toBeLessThan(0.5);
  });
});
