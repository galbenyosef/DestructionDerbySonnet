import { describe, expect, it } from 'vitest';
import { computeChaseView } from '../../src/client/game/camera';
import { quatFromYaw, vlen, vsub } from '../../src/shared/math';

const at = (yaw: number, speed = 0) => ({ pos: { x: 0, y: 1, z: 0 }, quat: quatFromYaw(yaw), speed });

describe('computeChaseView', () => {
  it('sits behind and above a car that faces +X, looking ahead of it', () => {
    const v = computeChaseView(at(0));
    expect(v.position.x).toBeLessThan(-5);
    expect(v.position.y).toBeGreaterThan(2);
    expect(v.lookAt.x).toBeGreaterThan(2);
  });

  it('follows the car when it faces -X', () => {
    const v = computeChaseView(at(Math.PI));
    expect(v.position.x).toBeGreaterThan(5);
    expect(v.lookAt.x).toBeLessThan(-2);
  });

  it('pulls back and widens the field of view with speed', () => {
    const slow = computeChaseView(at(0, 0));
    const fast = computeChaseView(at(0, 20));
    expect(vlen(vsub(fast.position, at(0).pos))).toBeGreaterThan(vlen(vsub(slow.position, at(0).pos)));
    expect(fast.fov).toBeGreaterThan(slow.fov);
    expect(fast.fov).toBeLessThanOrEqual(78);
  });

  it('stays level even when the car is pitched', () => {
    // pitching the car must not tilt the camera height by more than the fixed offset
    const v = computeChaseView({ pos: { x: 0, y: 1, z: 0 }, quat: { x: 0, y: 0, z: 0.5, w: 0.866 }, speed: 0 });
    expect(v.position.y).toBeCloseTo(1 + 4, 1);
  });
});
