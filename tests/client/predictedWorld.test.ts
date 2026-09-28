import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../../src/shared/physics';
import type { CarInput } from '../../src/shared/input';
import { Loopback, percentile } from '../helpers/loopback';

beforeAll(async () => {
  await initPhysics();
});

const straight = (): CarInput => ({ throttle: 1, steer: 0, handbrake: false });
const weave = (k: number): CarInput => ({ throttle: 1, steer: Math.sin(k / 20) * 0.9, handbrake: false });
const gentle = (k: number): CarInput => ({ throttle: 0.9, steer: Math.sin(k / 37 + 1) * 0.7, handbrake: false });

const loops: Loopback[] = [];
const loopback = (options: ConstructorParameters<typeof Loopback>[0]): Loopback => {
  const l = new Loopback(options);
  loops.push(l);
  return l;
};
afterEach(() => {
  while (loops.length) loops.pop()!.dispose();
});

describe('Predictor against a real server room', () => {
  it('matches the server almost exactly when the network is perfect', () => {
    const l = loopback({ local: straight, remote: gentle });
    l.run(8);
    const applied = l.results.filter((r) => r.outcome === 'applied');
    expect(applied.length).toBeGreaterThan(200);
    expect(percentile(l.localErrors(), 0.95)).toBeLessThan(0.01);
    expect(Math.max(...l.localErrors())).toBeLessThan(0.05);
    const kept = applied.filter((r) => !r.resetLocal).length;
    expect(kept / applied.length).toBeGreaterThan(0.95); // the deadband keeps the local prediction
  });

  it('stays smooth at 100 ms round trip with 20 ms jitter', () => {
    const l = loopback({ rttMs: 100, jitterMs: 20, local: weave, remote: gentle });
    l.run(10);
    expect(percentile(l.localErrors(), 0.95)).toBeLessThan(0.03);
    expect(Math.max(...l.localErrors())).toBeLessThan(0.35);
    expect(percentile(l.remoteErrors(), 0.95)).toBeLessThan(0.08);
    const resim = l.results.filter((r) => r.outcome === 'applied').map((r) => r.resimSteps);
    expect(Math.max(...resim)).toBeGreaterThan(3); // it really re-simulates the unacknowledged inputs
    expect(Math.max(...resim)).toBeLessThan(30);
  });

  it('predicts a head-on collision about as well as the server plays it', () => {
    const l = loopback({ rttMs: 100, jitterMs: 15, local: straight, remote: straight });
    l.run(9);
    const a = l.serverState(0).pos;
    const b = l.serverState(1).pos;
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(8); // the cars did meet
    expect(Math.max(...l.localErrors())).toBeLessThan(0.35);
  });

  it('survives packet loss and reordering pressure with bounded corrections', () => {
    const l = loopback({ rttMs: 100, jitterMs: 20, lossPct: 3, local: weave, remote: gentle, seed: 7 });
    l.run(10);
    expect(Math.max(...l.localErrors())).toBeLessThan(0.6);
    expect(percentile(l.localErrors(), 0.95)).toBeLessThan(0.2);
  });

  it('snaps back to the server after the authority moves the car, then converges', () => {
    const l = loopback({ rttMs: 60, jitterMs: 5, local: straight, remote: gentle });
    l.run(4);
    const before = l.results.length;
    const sim = l.serverSim!;
    const s = sim.getState(0);
    sim.setState(0, { ...s, pos: { x: s.pos.x, y: s.pos.y, z: s.pos.z + 2 } }); // e.g. a hit the client never saw coming
    l.run(1.5);
    const after = l.results.slice(before);
    expect(after.some((r) => r.outcome === 'applied' && r.resetLocal && r.localError > 1)).toBe(true);
    const tail = after.slice(-20).filter((r) => r.outcome === 'applied');
    expect(Math.max(...tail.map((r) => r.localError))).toBeLessThan(0.1); // converged again
  });

});

describe('PredictedWorld: what the player would see', () => {
  it('never shows a visible teleport on the local car at 100 ms round trip with jitter', () => {
    const l = loopback({ rttMs: 100, jitterMs: 20, local: weave, remote: gentle });
    l.run(10);
    expect(l.maxVisualJump(0)).toBeLessThan(0.02);
  });

  it('never shows a visible teleport on other cars either', () => {
    const l = loopback({ rttMs: 100, jitterMs: 20, local: weave, remote: gentle });
    l.run(10);
    expect(l.maxVisualJump(1)).toBeLessThan(0.05);
  });

  it('stays smooth through a head-on collision under lag', () => {
    const l = loopback({ rttMs: 120, jitterMs: 25, local: straight, remote: straight });
    l.run(9);
    expect(l.maxVisualJump(0)).toBeLessThan(0.03);
    expect(l.maxVisualJump(1)).toBeLessThan(0.03);
  });

  it('is visibly smoother than drawing the raw prediction', () => {
    const smooth = loopback({ rttMs: 120, jitterMs: 25, local: weave, remote: weave, seed: 4 });
    const raw = loopback({ rttMs: 120, jitterMs: 25, local: weave, remote: weave, seed: 4, smoothing: false });
    smooth.run(10);
    raw.run(10);
    const worstSmooth = Math.max(smooth.maxVisualJump(0), smooth.maxVisualJump(1));
    const worstRaw = Math.max(raw.maxVisualJump(0), raw.maxVisualJump(1));
    expect(worstRaw).toBeGreaterThan(worstSmooth * 2);
  });

  it('snaps instead of smoothing when the authority moves a car far away, and counts it', () => {
    const l = loopback({ rttMs: 60, jitterMs: 5, local: straight, remote: gentle });
    l.run(4);
    const sim = l.serverSim!;
    const s = sim.getState(0);
    sim.setState(0, { ...s, pos: { x: s.pos.x, y: s.pos.y, z: s.pos.z + 6 } }); // a 6 m teleport
    l.run(1);
    expect(l.world.stats.summary(l.k * (1000 / 60)).snapsTotal).toBeGreaterThan(0);
  });

  it('reports the network statistics the debug overlay shows', () => {
    const l = loopback({ rttMs: 100, jitterMs: 20, local: weave, remote: gentle });
    l.run(6);
    const s = l.world.stats.summary(l.k * (1000 / 60));
    expect(s.snapshotsPerSecond).toBeGreaterThan(25);
    expect(s.snapshotsPerSecond).toBeLessThan(35);
    expect(s.localErrorP95).toBeLessThan(0.05);
    expect(s.deadbandHitRate).toBeGreaterThan(0.7);
    expect(s.resimStepsAvg).toBeGreaterThan(3);
  });
});
