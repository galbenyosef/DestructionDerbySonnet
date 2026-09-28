import { describe, expect, it } from 'vitest';
import { DRIVE, SUSPENSION, TIRE, freezeTuning } from '../src/shared/constants';

describe('freezeTuning', () => {
  it('makes the live-tunable objects read-only so nothing can drift the shared simulation by accident', () => {
    expect(Object.isFrozen(DRIVE)).toBe(false); // the offline sandbox edits these through its tuning panel
    const engine = DRIVE.ENGINE;
    freezeTuning();
    expect(Object.isFrozen(DRIVE) && Object.isFrozen(TIRE) && Object.isFrozen(SUSPENSION)).toBe(true);
    expect(() => {
      DRIVE.ENGINE = 1;
    }).toThrow(TypeError);
    expect(() => {
      TIRE.SLIP = 9;
    }).toThrow(TypeError);
    expect(() => {
      SUSPENSION.STIFFNESS = 9;
    }).toThrow(TypeError);
    expect(DRIVE.ENGINE).toBe(engine);
  });

  it('is safe to call more than once', () => {
    freezeTuning();
    expect(() => freezeTuning()).not.toThrow();
  });
});
