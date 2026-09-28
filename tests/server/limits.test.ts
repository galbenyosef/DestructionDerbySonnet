import { describe, expect, it } from 'vitest';
import { TokenBucket } from '../../src/server/limits';

describe('TokenBucket', () => {
  it('allows bursts up to capacity, then refills over time (capped at capacity)', () => {
    let now = 0;
    const b = new TokenBucket(3, 2, () => now); // capacity 3, 2 tokens per second
    expect([b.take(), b.take(), b.take(), b.take()]).toEqual([true, true, true, false]);
    now += 500; // +1 token
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
    now += 60_000; // refill is capped
    expect([b.take(), b.take(), b.take(), b.take()]).toEqual([true, true, true, false]);
  });

  it('supports costs above 1 and refuses when the cost is too high', () => {
    const b = new TokenBucket(5, 0, () => 0);
    expect(b.take(4)).toBe(true);
    expect(b.take(2)).toBe(false);
    expect(b.take(1)).toBe(true);
  });
});
