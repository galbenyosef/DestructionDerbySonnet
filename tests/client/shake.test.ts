import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { CameraShake, SHAKE, shakeOffset, traumaForImpact } from '../../src/client/game/shake';

describe('traumaForImpact', () => {
  it('grows with the size of the impact up to a full jolt', () => {
    expect(traumaForImpact(0)).toBe(0);
    expect(traumaForImpact(5)).toBeCloseTo(0.2, 9);
    expect(traumaForImpact(SHAKE.FULL_IMPACT)).toBe(1);
    expect(traumaForImpact(400)).toBe(1);
  });

  it('is weaker the further away it happened, and half as strong at the hearing distance times one', () => {
    expect(traumaForImpact(25, SHAKE.HEARD_DISTANCE)).toBeCloseTo(0.5, 9);
    expect(traumaForImpact(25, 40)).toBeLessThan(traumaForImpact(25, 10));
  });

  it('is zero for broken numbers', () => {
    expect(traumaForImpact(Number.NaN)).toBe(0);
    expect(traumaForImpact(-3)).toBe(0);
    expect(traumaForImpact(10, Number.NaN)).toBe(0);
  });
});

describe('shakeOffset', () => {
  it('is nothing without trauma, and never exceeds the maximum with it', () => {
    expect(shakeOffset(0, 5)).toEqual({ x: 0, y: 0, roll: 0 });
    for (let t = 0; t < 20; t += 0.013) {
      const s = shakeOffset(1, t);
      expect(Math.abs(s.x)).toBeLessThanOrEqual(SHAKE.MAX_OFFSET);
      expect(Math.abs(s.y)).toBeLessThanOrEqual(SHAKE.MAX_OFFSET);
      expect(Math.abs(s.roll)).toBeLessThanOrEqual(SHAKE.MAX_ROLL);
    }
  });

  it('grows with the square of the trauma, so a small knock is barely felt', () => {
    const size = (trauma: number): number => {
      let most = 0;
      for (let t = 0; t < 20; t += 0.01) most = Math.max(most, Math.abs(shakeOffset(trauma, t).x));
      return most;
    };
    expect(size(0.5) / size(1)).toBeCloseTo(0.25, 1);
  });

  it('is repeatable and smooth from one moment to the next', () => {
    expect(shakeOffset(0.8, 3.3)).toEqual(shakeOffset(0.8, 3.3));
    expect(Math.abs(shakeOffset(1, 3.3).x - shakeOffset(1, 3.301).x)).toBeLessThan(0.02);
  });
});

describe('CameraShake', () => {
  it('adds up jolts, never beyond a full one, and dies away by itself', () => {
    const shake = new CameraShake();
    const camera = new PerspectiveCamera();
    shake.add(0.6);
    shake.add(0.6);
    expect(shake.level).toBe(1);
    shake.apply(camera, 0.25);
    expect(shake.level).toBeCloseTo(1 - SHAKE.DECAY * 0.25, 9);
    for (let i = 0; i < 20; i++) shake.apply(camera, 0.1);
    expect(shake.level).toBe(0);
  });

  it('moves the camera while there is trauma and leaves it alone afterwards', () => {
    const shake = new CameraShake();
    const camera = new PerspectiveCamera();
    camera.position.set(3, 4, 5);
    shake.apply(camera, 0.016);
    expect(camera.position.toArray()).toEqual([3, 4, 5]);
    shake.add(1);
    let moved = false;
    for (let i = 0; i < 10; i++) {
      camera.position.set(3, 4, 5);
      camera.rotation.set(0, 0, 0);
      shake.apply(camera, 0.016);
      if (camera.position.x !== 3 || camera.rotation.z !== 0) moved = true;
    }
    expect(moved).toBe(true);
  });

  it('ignores broken jolts and frame times, and forgets everything on reset', () => {
    const shake = new CameraShake();
    const camera = new PerspectiveCamera();
    shake.add(Number.NaN);
    shake.add(-1);
    expect(shake.level).toBe(0);
    shake.add(0.5);
    shake.apply(camera, Number.NaN);
    shake.apply(camera, 1e9);
    expect(shake.level).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(camera.position.x + camera.position.y + camera.position.z)).toBe(true);
    shake.add(1);
    shake.reset();
    expect(shake.level).toBe(0);
  });
});
