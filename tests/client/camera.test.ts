import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { applyChaseView, computeChaseView } from '../../src/client/game/camera';
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

describe('applyChaseView', () => {
  const view = { position: { x: 10, y: 5, z: -3 }, lookAt: { x: 0, y: 1, z: 0 }, fov: 62 };

  it('puts the camera at the position and aims it at the look-at point', () => {
    const camera = new PerspectiveCamera(62, 1.5, 0.1, 500);
    applyChaseView(camera, view);
    expect(camera.position.toArray()).toEqual([10, 5, -3]);
    const towards = new Vector3(-10, -4, 3).normalize();
    expect(camera.getWorldDirection(new Vector3()).distanceTo(towards)).toBeLessThan(1e-6);
  });

  it('changes the field of view and its projection only when it differs', () => {
    const camera = new PerspectiveCamera(62, 1.5, 0.1, 500);
    const before = camera.projectionMatrix.elements[5];
    applyChaseView(camera, view);
    expect(camera.projectionMatrix.elements[5]).toBe(before);
    applyChaseView(camera, { ...view, fov: 78 });
    expect(camera.fov).toBe(78);
    expect(camera.projectionMatrix.elements[5]).toBeCloseTo(1 / Math.tan((39 * Math.PI) / 180), 6);
  });
});
