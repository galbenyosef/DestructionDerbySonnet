import { describe, expect, it } from 'vitest';
import { FixedStepper } from '../../src/client/game/stepper';

const DT = 1 / 60;

describe('FixedStepper', () => {
  it('runs whole ticks and returns the interpolation alpha', () => {
    const s = new FixedStepper(DT);
    let n = 0;
    const alpha = s.advance(DT * 2.5, () => n++);
    expect(n).toBe(2);
    expect(alpha).toBeCloseTo(0.5, 5);
  });

  it('carries the remainder into the next frame', () => {
    const s = new FixedStepper(DT);
    let n = 0;
    s.advance(DT * 0.6, () => n++);
    expect(n).toBe(0);
    s.advance(DT * 0.6, () => n++);
    expect(n).toBe(1);
  });

  it('caps a huge frame time (hidden tab) at 0.1 s', () => {
    const s = new FixedStepper(DT);
    let n = 0;
    s.advance(5, () => n++);
    expect(n).toBeLessThanOrEqual(6);
    expect(n).toBeGreaterThanOrEqual(5);
  });

  it('ignores NaN, Infinity and negative frame times', () => {
    const s = new FixedStepper(DT);
    let n = 0;
    for (const bad of [NaN, Infinity, -Infinity, -1]) s.advance(bad, () => n++);
    expect(n).toBe(0);
  });

  it('reset clears the accumulator', () => {
    const s = new FixedStepper(DT);
    let n = 0;
    s.advance(DT * 0.9, () => n++);
    s.reset();
    s.advance(DT * 0.2, () => n++);
    expect(n).toBe(0);
  });
});
