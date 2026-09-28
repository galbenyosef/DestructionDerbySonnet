import { describe, expect, it } from 'vitest';
import {
  FLAG_HANDBRAKE,
  NEUTRAL_INPUT,
  isNewerSeq,
  packInput,
  quantizeInput,
  unpackInput,
} from '../src/shared/input';

describe('packInput / unpackInput', () => {
  it('round-trips within one int8 step', () => {
    const packed = packInput({ throttle: 0.5, steer: -0.25, handbrake: true });
    const back = unpackInput(packed);
    expect(back.throttle).toBeCloseTo(0.5, 2);
    expect(back.steer).toBeCloseTo(-0.25, 2);
    expect(back.handbrake).toBe(true);
    expect(packed.flags & FLAG_HANDBRAKE).toBe(FLAG_HANDBRAKE);
  });

  it('clamps out-of-range values', () => {
    expect(packInput({ throttle: 5, steer: -5, handbrake: false })).toEqual({ throttle: 127, steer: -127, flags: 0 });
  });

  it('treats NaN and infinities as neutral', () => {
    expect(packInput({ throttle: NaN, steer: Infinity, handbrake: false })).toEqual({ throttle: 0, steer: 0, flags: 0 });
    expect(packInput({ throttle: -Infinity, steer: NaN, handbrake: false })).toEqual({ throttle: 0, steer: 0, flags: 0 });
  });

  it('never produces negative zero', () => {
    const p = packInput({ throttle: -0.001, steer: -0, handbrake: false });
    expect(Object.is(p.throttle, 0)).toBe(true);
    expect(Object.is(p.steer, 0)).toBe(true);
  });
});

describe('quantizeInput', () => {
  it('is idempotent', () => {
    const once = quantizeInput({ throttle: 0.3333, steer: -0.777, handbrake: false });
    expect(quantizeInput(once)).toEqual(once);
  });

  it('snaps to multiples of 1/127', () => {
    const q = quantizeInput({ throttle: 0.3333, steer: 0, handbrake: false });
    expect(Math.round(q.throttle * 127)).toBeCloseTo(q.throttle * 127, 9);
  });

  it('leaves the neutral input neutral', () => {
    expect(quantizeInput({ ...NEUTRAL_INPUT })).toEqual(NEUTRAL_INPUT);
  });
});

describe('isNewerSeq (u32, wrap-aware)', () => {
  it('orders ordinary sequence numbers', () => {
    expect(isNewerSeq(5, 3)).toBe(true);
    expect(isNewerSeq(3, 5)).toBe(false);
    expect(isNewerSeq(4, 4)).toBe(false);
  });

  it('handles wraparound at 2^32', () => {
    expect(isNewerSeq(0, 0xffffffff)).toBe(true);
    expect(isNewerSeq(0xffffffff, 0)).toBe(false);
    expect(isNewerSeq(2, 0xfffffffe)).toBe(true);
  });
});
