import { describe, expect, it } from 'vitest';
import { ErrorSmoother, type SmoothPose } from '../../src/client/net/smoothing';
import { QUAT_IDENTITY, quatFromYaw, vlen, vsub } from '../../src/shared/math';

const pose = (x: number, y = 0, z = 0, yaw = 0): SmoothPose => ({ pos: { x, y, z }, quat: quatFromYaw(yaw) });
const yawOf = (q: { y: number; w: number }): number => 2 * Math.atan2(q.y, q.w);

describe('ErrorSmoother', () => {
  it('leaves poses untouched until a correction is absorbed', () => {
    const s = new ErrorSmoother();
    const p = pose(1, 2, 3, 0.4);
    expect(s.apply(0, p)).toEqual(p);
    expect(s.offsetMagnitude(0)).toBe(0);
  });

  it('hides a correction: the rendered pose does not jump, then eases onto the new state', () => {
    const s = new ErrorSmoother(0.1, 2);
    expect(s.absorb(0, pose(10), pose(10.2))).toBe('smoothed');
    expect(s.apply(0, pose(10.2)).pos.x).toBeCloseTo(10, 9); // still drawn where it was
    s.decay(0.1); // one time constant
    expect(s.apply(0, pose(10.2)).pos.x).toBeCloseTo(10.2 - 0.2 * Math.exp(-1), 9);
    for (let i = 0; i < 100; i++) s.decay(0.05);
    expect(s.apply(0, pose(10.2)).pos.x).toBeCloseTo(10.2, 9);
    expect(s.offsetMagnitude(0)).toBe(0);
  });

  it('composes successive corrections without a visible jump at either', () => {
    const s = new ErrorSmoother(0.1, 2);
    s.absorb(0, pose(0), pose(0.3));
    s.decay(0.05);
    const seenBefore = s.apply(0, pose(0.5));
    s.absorb(0, pose(0.5), pose(0.8));
    const seenAfter = s.apply(0, pose(0.8));
    expect(seenAfter.pos.x).toBeCloseTo(seenBefore.pos.x, 9);
  });

  it('snaps instead of smoothing a large error and clears any earlier offset', () => {
    const s = new ErrorSmoother(0.1, 2);
    s.absorb(0, pose(0), pose(0.4));
    expect(s.absorb(0, pose(0.4), pose(5))).toBe('snapped');
    expect(s.apply(0, pose(5)).pos.x).toBe(5);
    expect(s.offsetMagnitude(0)).toBe(0);
  });

  it('smooths orientation errors too, and snaps a large turn', () => {
    const s = new ErrorSmoother(0.1, 2, 0.6);
    expect(s.absorb(0, pose(0, 0, 0, 0.0), pose(0, 0, 0, 0.2))).toBe('smoothed');
    expect(yawOf(s.apply(0, pose(0, 0, 0, 0.2)).quat)).toBeCloseTo(0, 6);
    s.decay(0.1);
    expect(yawOf(s.apply(0, pose(0, 0, 0, 0.2)).quat)).toBeCloseTo(0.2 - 0.2 * Math.exp(-1), 2);
    expect(s.absorb(0, pose(0, 0, 0, 0), pose(0, 0, 0, 1.5))).toBe('snapped');
    expect(yawOf(s.apply(0, pose(0, 0, 0, 1.5)).quat)).toBeCloseTo(1.5, 6);
  });

  it('keeps one offset per slot and can forget or clear them', () => {
    const s = new ErrorSmoother();
    s.absorb(0, pose(0), pose(0.1));
    s.absorb(3, pose(0), pose(-0.1));
    expect(s.apply(0, pose(0.1)).pos.x).toBeCloseTo(0, 9);
    expect(s.apply(3, pose(-0.1)).pos.x).toBeCloseTo(0, 9);
    s.forget(0);
    expect(s.apply(0, pose(0.1)).pos.x).toBe(0.1);
    s.clear();
    expect(s.apply(3, pose(-0.1)).pos.x).toBe(-0.1);
  });

  it('never propagates NaN: bad input snaps and ignores non-positive time steps', () => {
    const s = new ErrorSmoother();
    expect(s.absorb(0, pose(Number.NaN), pose(1))).toBe('snapped');
    s.absorb(0, pose(0), pose(0.1));
    s.decay(Number.NaN);
    s.decay(-1);
    const applied = s.apply(0, pose(0.1));
    expect(Number.isFinite(applied.pos.x)).toBe(true);
    expect(applied.pos.x).toBeCloseTo(0, 9);
    expect(vlen(vsub(applied.pos, { x: 0, y: 0, z: 0 }))).toBeLessThan(1e-9);
    expect(s.apply(0, { pos: { x: 0, y: 0, z: 0 }, quat: QUAT_IDENTITY }).quat.w).toBeCloseTo(1, 6);
  });
});
