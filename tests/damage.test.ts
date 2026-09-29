import { describe, expect, it } from 'vitest';
import { CAR, COMBAT } from '../src/shared/constants';
import { classifyZone, hitDamage, impactDamage } from '../src/shared/damage';

describe('impactDamage', () => {
  it('ignores impacts under the minimum, including nonsense values', () => {
    expect(impactDamage(0)).toBe(0);
    expect(impactDamage(COMBAT.MIN_IMPULSE)).toBe(0);
    expect(impactDamage(-5)).toBe(0);
    expect(impactDamage(Number.NaN)).toBe(0);
    expect(impactDamage(Number.POSITIVE_INFINITY)).toBe(0); // a broken simulation must not read as a killing blow
  });

  it('is anchored to measured collisions (1500 kg cars, impulse = mass x velocity change)', () => {
    // head-on at 2, 5 and 10 m/s each measured 3.7, 9.5 and 19.2 kN·s per car
    expect(impactDamage(3.7)).toBeGreaterThan(0.5);
    expect(impactDamage(3.7)).toBeLessThan(1.5); // a bump barely scratches
    expect(impactDamage(9.5)).toBeGreaterThan(5);
    expect(impactDamage(9.5)).toBeLessThan(8); // a firm hit costs a few percent
    expect(impactDamage(19.2)).toBeGreaterThan(20);
    expect(impactDamage(19.2)).toBeLessThan(24); // a hard head-on is about a fifth of a car
  });

  it('grows faster than linearly, so hard hits hurt disproportionately', () => {
    expect(impactDamage(20)).toBeGreaterThan(2 * impactDamage(10));
    let last = 0;
    for (let j = 2; j <= 40; j += 2) {
      const d = impactDamage(j);
      expect(d).toBeGreaterThan(last);
      last = d;
    }
  });
});

describe('classifyZone', () => {
  const h = CAR.HALF;
  it('names the side a contact point lies on (forward +X, right +Z)', () => {
    expect(classifyZone({ x: h.x, y: 0, z: 0 })).toBe('front');
    expect(classifyZone({ x: -h.x, y: 0, z: 0.2 })).toBe('rear');
    expect(classifyZone({ x: 0.3, y: 0, z: h.z })).toBe('right');
    expect(classifyZone({ x: -0.3, y: 0, z: -h.z })).toBe('left');
  });

  it('gives corners to the front or rear, and treats the centre as front', () => {
    expect(classifyZone({ x: h.x, y: 0, z: h.z })).toBe('front');
    expect(classifyZone({ x: -h.x, y: 0, z: -h.z })).toBe('rear');
    expect(classifyZone({ x: 0, y: 0, z: 0 })).toBe('front');
  });

  it('compares the two axes relative to the car size, not in metres', () => {
    // 1.5 m forward of centre is less far along the 2.3 m half length than 1.0 m sideways is along the 1.0 m half width
    expect(classifyZone({ x: 1.5, y: 0, z: 0.99 })).toBe('right');
    expect(classifyZone({ x: 2.2, y: 0, z: 0.5 })).toBe('front');
  });
});

describe('hitDamage', () => {
  it('multiplies by the zone that was hit: rear is the safest, front the most exposed', () => {
    const base = impactDamage(15);
    expect(hitDamage(15, 'front', false)).toBeCloseTo(base * 1.15, 9);
    expect(hitDamage(15, 'rear', false)).toBeCloseTo(base * 0.9, 9);
    expect(hitDamage(15, 'left', false)).toBeCloseTo(base, 9);
    expect(hitDamage(15, 'right', false)).toBeCloseTo(base, 9);
    expect(hitDamage(15, 'rear', false)).toBeLessThan(hitDamage(15, 'right', false));
    expect(hitDamage(15, 'right', false)).toBeLessThan(hitDamage(15, 'front', false));
  });

  it('halves damage against walls and obstacles', () => {
    expect(hitDamage(15, 'front', true)).toBeCloseTo(hitDamage(15, 'front', false) * 0.5, 9);
  });
});
