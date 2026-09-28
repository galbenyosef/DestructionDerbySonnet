import { describe, expect, it } from 'vitest';
import {
  QUAT_IDENTITY,
  clamp,
  lerp,
  quatConjugate,
  quatFromYaw,
  quatIntegrate,
  quatNlerp,
  quatNormalize,
  quatRotate,
  round3,
  round6,
  vdot,
  vlen,
  vlerp,
  wrapPi,
} from '../src/shared/math';

describe('scalar helpers', () => {
  it('clamp bounds values', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it('lerp interpolates', () => {
    expect(lerp(0, 10, 0.25)).toBe(2.5);
    expect(lerp(4, 8, 0)).toBe(4);
    expect(lerp(4, 8, 1)).toBe(8);
  });

  it('round3 and round6 round to fixed decimals', () => {
    expect(round3(1.23456)).toBe(1.235);
    expect(round6(0.1234567)).toBe(0.123457);
  });

  it('wrapPi wraps into [-pi, pi)', () => {
    expect(wrapPi(0.5)).toBeCloseTo(0.5, 9);
    expect(wrapPi(Math.PI * 2 + 0.5)).toBeCloseTo(0.5, 9);
    expect(wrapPi(-Math.PI * 2 - 0.5)).toBeCloseTo(-0.5, 9);
    for (const a of [-10, -3.5, 0, 3.5, 10]) {
      const w = wrapPi(a);
      expect(w).toBeGreaterThanOrEqual(-Math.PI);
      expect(w).toBeLessThan(Math.PI);
    }
  });
});

describe('vectors', () => {
  it('vlen, vdot and vlerp', () => {
    expect(vlen({ x: 3, y: 4, z: 0 })).toBe(5);
    expect(vdot({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })).toBe(32);
    expect(vlerp({ x: 0, y: 0, z: 0 }, { x: 2, y: 4, z: 6 }, 0.5)).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe('quaternions', () => {
  it('quatFromYaw(90 degrees) rotates forward +X to -Z', () => {
    const f = quatRotate(quatFromYaw(Math.PI / 2), { x: 1, y: 0, z: 0 });
    expect(f.x).toBeCloseTo(0, 5);
    expect(f.y).toBeCloseTo(0, 5);
    expect(f.z).toBeCloseTo(-1, 5);
  });

  it('quatFromYaw is unit length', () => {
    for (const yaw of [0, 0.3, 1.7, -2.2, Math.PI]) {
      const q = quatFromYaw(yaw);
      expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 9);
    }
  });

  it('conjugate undoes a rotation', () => {
    const q = quatFromYaw(0.9);
    const v = { x: 1.5, y: -2, z: 0.25 };
    const back = quatRotate(quatConjugate(q), quatRotate(q, v));
    expect(back.x).toBeCloseTo(v.x, 5);
    expect(back.y).toBeCloseTo(v.y, 5);
    expect(back.z).toBeCloseTo(v.z, 5);
  });

  it('nlerp halfway between identity and 90 degrees is 45 degrees', () => {
    const mid = quatNlerp(QUAT_IDENTITY, quatFromYaw(Math.PI / 2), 0.5);
    const f = quatRotate(mid, { x: 1, y: 0, z: 0 });
    expect(f.x).toBeCloseTo(Math.SQRT1_2, 4);
    expect(f.z).toBeCloseTo(-Math.SQRT1_2, 4);
  });

  it('nlerp takes the shortest path (q and -q are the same rotation)', () => {
    const neg = { x: 0, y: 0, z: 0, w: -1 };
    const mid = quatNlerp(QUAT_IDENTITY, neg, 0.5);
    expect(Math.abs(mid.w)).toBeCloseTo(1, 6);
  });

  it('quatNormalize falls back to identity for a zero quaternion', () => {
    expect(quatNormalize({ x: 0, y: 0, z: 0, w: 0 })).toEqual(QUAT_IDENTITY);
  });

  it('quatIntegrate rotates about the angular-velocity axis', () => {
    let q = QUAT_IDENTITY;
    for (let i = 0; i < 60; i++) q = quatIntegrate(q, { x: 0, y: 1, z: 0 }, 1 / 60); // 1 rad/s for 1 s
    const f = quatRotate(q, { x: 1, y: 0, z: 0 });
    expect(f.x).toBeCloseTo(Math.cos(1), 3);
    expect(f.z).toBeCloseTo(-Math.sin(1), 3);
  });
});
