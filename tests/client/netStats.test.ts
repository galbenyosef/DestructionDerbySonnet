import { describe, expect, it } from 'vitest';
import { NetStats, formatNetStats } from '../../src/client/net/netStats';
import type { ReconcileResult } from '../../src/client/net/prediction';

const state = { pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 }, linvel: { x: 0, y: 0, z: 0 }, angvel: { x: 0, y: 0, z: 0 } };
const applied = (localError: number, over: Partial<ReconcileResult> = {}, remoteError = 0): ReconcileResult => ({
  outcome: 'applied',
  resetLocal: false,
  resimSteps: 6,
  localError,
  corrections: [
    { slot: 0, before: state, after: state, error: localError },
    { slot: 1, before: state, after: state, error: remoteError },
  ],
  ...over,
});
const dropped = (outcome: ReconcileResult['outcome']): ReconcileResult => ({ outcome, resetLocal: false, resimSteps: 0, corrections: [], localError: 0 });

describe('NetStats', () => {
  it('is all zeros before anything happened', () => {
    const s = new NetStats(0).summary(1000);
    expect(s).toMatchObject({ snapshotsPerSecond: 0, localErrorP95: 0, deadbandHitRate: 0, resimStepsAvg: 0, droppedTotal: 0 });
  });

  it('measures the snapshot rate and the arrival jitter', () => {
    const n = new NetStats(0);
    for (let i = 0; i < 90; i++) n.record(1000 + i * 33.333 + (i % 3 === 0 ? 8 : 0), applied(0));
    const s = n.summary(1000 + 89 * 33.333 + 8);
    expect(s.snapshotsPerSecond).toBeGreaterThan(28);
    expect(s.snapshotsPerSecond).toBeLessThan(32);
    expect(s.intervalMeanMs).toBeGreaterThan(30);
    expect(s.intervalMeanMs).toBeLessThan(36);
    expect(s.intervalMaxMs).toBeGreaterThan(38); // the 8 ms wobble shows up as jitter
  });

  it('reports percentiles of the local and remote correction sizes', () => {
    const n = new NetStats(0);
    for (let i = 1; i <= 100; i++) n.record(i * 33, applied(i / 1000, {}, i / 500));
    const s = n.summary(3300);
    expect(s.localErrorP50).toBeCloseTo(0.05, 2);
    expect(s.localErrorP95).toBeCloseTo(0.096, 2);
    expect(s.localErrorMax).toBeCloseTo(0.1, 3);
    expect(s.remoteErrorMax).toBeCloseTo(0.2, 3);
    expect(s.remoteErrorP95).toBeGreaterThan(s.localErrorP95);
  });

  it('counts resets against deadband hits and averages the replay work', () => {
    const n = new NetStats(0);
    for (let i = 0; i < 9; i++) n.record(i * 33, applied(0, { resetLocal: false, resimSteps: 4 }), 0.1);
    n.record(300, applied(0.5, { resetLocal: true, resimSteps: 14 }), 0.3);
    const s = n.summary(400);
    expect(s.deadbandHitRate).toBeCloseTo(0.9, 6);
    expect(s.resetsTotal).toBe(1);
    expect(s.deadbandHitsTotal).toBe(9);
    expect(s.resimStepsAvg).toBeCloseTo(5, 6);
    expect(s.resimMsAvg).toBeCloseTo(0.12, 6);
  });

  it('counts dropped and ignored snapshots but keeps them out of the error statistics', () => {
    const n = new NetStats(0);
    n.record(0, dropped('dropped-old'));
    n.record(33, dropped('dropped-epoch'));
    n.record(66, dropped('ignored'));
    n.record(99, applied(0.01));
    const s = n.summary(100);
    expect(s.droppedTotal).toBe(3);
    expect(s.localErrorMax).toBeCloseTo(0.01, 6);
  });

  it('remembers only the most recent corrections', () => {
    const n = new NetStats(0, 50);
    for (let i = 0; i < 50; i++) n.record(i * 33, applied(5));
    for (let i = 50; i < 100; i++) n.record(i * 33, applied(0.01));
    expect(n.summary(3400).localErrorMax).toBeCloseTo(0.01, 6); // the early spikes have rotated out
  });

  it('counts corrections that were too large to smooth, and can be reset', () => {
    const n = new NetStats(0);
    n.recordSnap();
    n.recordSnap();
    n.record(0, applied(0.1));
    expect(n.summary(10).snapsTotal).toBe(2);
    n.reset();
    expect(n.summary(10)).toMatchObject({ snapsTotal: 0, localErrorMax: 0, snapshotsPerSecond: 0 });
  });

  it('formats a compact one-line summary for the HUD', () => {
    const n = new NetStats(0);
    for (let i = 0; i < 60; i++) n.record(1000 + i * 33.3, applied(0.012, { resimSteps: 7 }));
    const text = formatNetStats(n.summary(3000));
    expect(text).toMatch(/30\/s/);
    expect(text).toMatch(/err 1\.2 cm/);
    expect(text).toMatch(/replay 7/);
  });
});
