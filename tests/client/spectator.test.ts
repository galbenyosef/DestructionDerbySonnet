import { describe, expect, it } from 'vitest';
import { MAX_CAMERA_RADIUS, SpectatorCamera, computeOrbitView, nextTarget, type Followable } from '../../src/client/game/spectator';
import { vlen, vsub } from '../../src/shared/math';

const car = (slot: number, over: Partial<Followable> = {}): Followable => ({ slot, pos: { x: slot * 10, y: 1, z: 0 }, alive: true, visible: true, ...over });

describe('nextTarget', () => {
  const cars = [car(0), car(1, { alive: false }), car(2), car(3, { visible: false }), car(5)];

  it('moves up through the cars that are still running, and wraps around', () => {
    expect(nextTarget(cars, -1, 1)).toBe(0);
    expect(nextTarget(cars, 0, 1)).toBe(2);
    expect(nextTarget(cars, 2, 1)).toBe(5);
    expect(nextTarget(cars, 5, 1)).toBe(0);
  });

  it('moves down and wraps the other way', () => {
    expect(nextTarget(cars, 5, -1)).toBe(2);
    expect(nextTarget(cars, 2, -1)).toBe(0);
    expect(nextTarget(cars, 0, -1)).toBe(5);
    expect(nextTarget(cars, -1, -1)).toBe(5);
  });

  it('carries on from a car that has just gone out, in the direction asked', () => {
    expect(nextTarget(cars, 1, 1)).toBe(2);
    expect(nextTarget(cars, 1, -1)).toBe(0);
    expect(nextTarget(cars, 3, 1)).toBe(5);
  });

  it('says -1 when nothing is running', () => {
    expect(nextTarget([], 0, 1)).toBe(-1);
    expect(nextTarget([car(0, { alive: false })], -1, 1)).toBe(-1);
  });

  it('stays on the only car left', () => {
    expect(nextTarget([car(4)], 4, 1)).toBe(4);
    expect(nextTarget([car(4)], 4, -1)).toBe(4);
  });
});

describe('computeOrbitView', () => {
  it('circles the target at a fixed distance and height, looking at it', () => {
    const target = { x: 3, y: 1, z: -2 };
    for (const angle of [0, 1, 2.5, 4]) {
      const v = computeOrbitView(target, angle);
      expect(Math.hypot(v.position.x - target.x, v.position.z - target.z)).toBeCloseTo(13, 9);
      expect(v.position.y).toBeCloseTo(7, 9);
      expect(v.lookAt).toEqual({ x: 3, y: 1.8, z: -2 });
    }
    expect(computeOrbitView(target, 0).position.x).toBeGreaterThan(target.x);
  });

  it('never leaves the arena: beside the barrier the camera slides along the inside of it', () => {
    const target = { x: 43, y: 1, z: 0 };
    for (const angle of [0, 0.5, 1, 2, 3.14, 5]) {
      const v = computeOrbitView(target, angle);
      expect(Math.hypot(v.position.x, v.position.z)).toBeLessThanOrEqual(MAX_CAMERA_RADIUS + 1e-9);
      expect(v.lookAt).toEqual({ x: 43, y: 1.8, z: 0 }); // it still looks at the car
    }
    const outside = computeOrbitView(target, 0); // straight out over the wall: pulled back in
    expect(Math.hypot(outside.position.x, outside.position.z)).toBeCloseTo(MAX_CAMERA_RADIUS, 9);
  });
});

describe('SpectatorCamera', () => {
  it('picks a car by itself, follows it, and keeps it while it runs', () => {
    const cam = new SpectatorCamera();
    const cars = [car(1), car(2)];
    const v = cam.view(cars, 0.016)!;
    expect(cam.watching).toBe(1);
    expect(vlen(vsub(v.lookAt, { x: 10, y: 1.8, z: 0 }))).toBeLessThan(1e-9);
    cam.view([car(0), car(1), car(2)], 0.016);
    expect(cam.watching).toBe(1);
  });

  it('moves to another car when the one it watches goes out, and to none when all are out', () => {
    const cam = new SpectatorCamera();
    cam.view([car(1), car(2)], 0.016);
    expect(cam.watching).toBe(1);
    expect(cam.view([car(1, { alive: false }), car(2)], 0.016)).not.toBeNull();
    expect(cam.watching).toBe(2);
    expect(cam.view([car(1, { alive: false }), car(2, { alive: false })], 0.016)).toBeNull();
  });

  it('cycles on request', () => {
    const cam = new SpectatorCamera();
    const cars = [car(0), car(1), car(2)];
    cam.view(cars, 0.016);
    cam.cycle(cars, 1);
    expect(cam.watching).toBe(1);
    cam.cycle(cars, 1);
    cam.cycle(cars, 1);
    expect(cam.watching).toBe(0);
    cam.cycle(cars, -1);
    expect(cam.watching).toBe(2);
  });

  it('orbits slowly, smoothing the move when the target changes', () => {
    const cam = new SpectatorCamera();
    const cars = [car(0), car(3)];
    const a = cam.view(cars, 0.016)!;
    const b = cam.view(cars, 1)!;
    expect(vlen(vsub(a.position, b.position))).toBeGreaterThan(1); // it went round
    cam.cycle(cars, 1);
    const c = cam.view(cars, 0.016)!;
    expect(vlen(vsub(c.position, b.position))).toBeLessThan(3); // and did not jump the 30 m to the other car in one frame
    expect(c.lookAt.x).toBeGreaterThan(b.lookAt.x);
  });

  it('starts afresh after a reset, and survives odd frame times', () => {
    const cam = new SpectatorCamera();
    cam.view([car(2)], 0.016);
    cam.reset();
    expect(cam.watching).toBe(-1);
    expect(() => cam.view([car(2)], Number.NaN)).not.toThrow();
    expect(() => cam.view([car(2)], -5)).not.toThrow();
    expect(cam.view([car(2)], 0.016)).not.toBeNull();
  });
});
