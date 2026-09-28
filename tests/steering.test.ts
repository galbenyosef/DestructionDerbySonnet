import { describe, expect, it } from 'vitest';
import { DRIVE } from '../src/shared/constants';
import { steeringAngle } from '../src/shared/vehicle';

describe('steeringAngle', () => {
  it('is zero without input and uses the configured sign and maximum at standstill', () => {
    expect(steeringAngle(0, 10)).toBeCloseTo(0, 9);
    expect(steeringAngle(1, 0)).toBeCloseTo(DRIVE.STEER_SIGN * DRIVE.MAX_STEER, 9);
    expect(steeringAngle(-1, 0)).toBeCloseTo(-DRIVE.STEER_SIGN * DRIVE.MAX_STEER, 9);
  });

  it('tapers with speed in either direction of travel and clamps the input', () => {
    expect(Math.abs(steeringAngle(1, DRIVE.STEER_FADE_SPEED))).toBeCloseTo(DRIVE.MAX_STEER_FAST, 9);
    expect(Math.abs(steeringAngle(1, -DRIVE.STEER_FADE_SPEED))).toBeCloseTo(DRIVE.MAX_STEER_FAST, 9);
    expect(Math.abs(steeringAngle(1, DRIVE.STEER_FADE_SPEED * 3))).toBeCloseTo(DRIVE.MAX_STEER_FAST, 9);
    expect(steeringAngle(5, 0)).toBeCloseTo(steeringAngle(1, 0), 9);
  });
});
