import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DENT, DentSurface, accumulateDent, dentFromHit, hash3, type Dent } from '../../src/client/game/dents';

const hit = (over: Partial<Parameters<typeof dentFromHit>[0]> = {}): Parameters<typeof dentFromHit>[0] => ({
  tick: 100,
  victim: 1,
  attacker: 2,
  dmg: 10,
  p: [2.3, -0.3, 0],
  ...over,
});
/** The lower body of a car as the client builds it: a box 4.5 x 0.6 x 1.95 whose middle is 0.15 m below the chassis centre. */
const body = () => new THREE.BoxGeometry(4.5, 0.6, 1.95, 18, 3, 8);
const ORIGIN = { x: 0, y: -0.15, z: 0 };
const positions = (g: THREE.BufferGeometry): number[] => Array.from(g.getAttribute('position').array as Float32Array);

describe('dentFromHit', () => {
  it('makes deeper and wider dents for harder hits, within limits', () => {
    const small = dentFromHit(hit({ dmg: 1 }));
    const medium = dentFromHit(hit({ dmg: 10 }));
    const huge = dentFromHit(hit({ dmg: 400 }));
    expect(small.depth).toBeGreaterThanOrEqual(DENT.MIN_DEPTH);
    expect(medium.depth).toBeGreaterThan(small.depth);
    expect(huge.depth).toBe(DENT.MAX_DEPTH);
    expect(medium.radius).toBeGreaterThan(small.radius);
    expect(huge.radius).toBe(DENT.MAX_RADIUS);
  });

  it('puts the dent where the contact was, and keeps it on the body', () => {
    expect(dentFromHit(hit({ p: [2.3, -0.3, 0.4] }))).toMatchObject({ x: 2.3, y: -0.3, z: 0.4 });
    expect(dentFromHit(hit({ p: [9, -9, 9] }))).toMatchObject({ x: 2.3, y: -0.5, z: 1 });
  });

  it('copes with broken numbers', () => {
    const d = dentFromHit(hit({ dmg: Number.NaN, p: [Number.NaN, Number.POSITIVE_INFINITY, 0] }));
    for (const v of [d.x, d.y, d.z, d.depth, d.radius]) expect(Number.isFinite(v)).toBe(true);
    expect(d.depth).toBe(DENT.MIN_DEPTH);
  });

  it('seeds a dent by its event: the same event always, another event another seed', () => {
    expect(dentFromHit(hit()).seed).toBe(dentFromHit(hit()).seed);
    const seeds = new Set([hit(), hit({ tick: 101 }), hit({ victim: 3 }), hit({ attacker: -1 })].map((h) => dentFromHit(h).seed));
    expect(seeds.size).toBe(4);
  });
});

describe('hash3', () => {
  it('is repeatable, stays in [0, 1) and spreads evenly enough', () => {
    expect(hash3(7, 1, 2, 3)).toBe(hash3(7, 1, 2, 3));
    let sum = 0;
    for (let i = 0; i < 2000; i++) {
      const v = hash3(12345, i, i * 3, -i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 2000).toBeGreaterThan(0.45);
    expect(sum / 2000).toBeLessThan(0.55);
  });
});

describe('DentSurface', () => {
  const dent = (over: Partial<Dent> = {}): Dent => ({ ...dentFromHit(hit()), ...over });

  it('pushes the surface in at the hit and leaves the far end of the car alone', () => {
    const g = body();
    const before = positions(g);
    new DentSurface(g, ORIGIN).apply(dent());
    const after = positions(g);
    let deepest = 0;
    let movedFar = 0;
    for (let i = 0; i < after.length; i += 3) {
      const x = before[i]!;
      const moved = Math.hypot(after[i]! - x, after[i + 1]! - before[i + 1]!, after[i + 2]! - before[i + 2]!);
      if (x > 2) deepest = Math.max(deepest, moved);
      if (x < 0) movedFar = Math.max(movedFar, moved);
    }
    expect(deepest).toBeGreaterThan(0.1); // a 10 HP hit is 0.2 m deep, times an irregular 0.6-1.4
    expect(deepest).toBeLessThan(0.4);
    expect(movedFar).toBe(0);
    // a point in the middle of the front face went backwards
    const at = before.findIndex((v, i) => i % 3 === 0 && Math.abs(v - 2.25) < 1e-6 && Math.abs(before[i + 2]!) < 1e-6 && Math.abs(before[i + 1]! + 0.3) < 1e-6);
    expect(after[at]!).toBeLessThan(before[at]! - 0.05);
  });

  it('moves the duplicated vertices along the edges of a box together, so the surface does not tear', () => {
    const g = body();
    new DentSurface(g, ORIGIN).apply(dent({ x: 2.2, y: 0.1, z: 0.9 }));
    const now = positions(g);
    const seen = new Map<string, number[]>();
    const rest = positions(body());
    let pairs = 0;
    for (let i = 0; i < rest.length; i += 3) {
      const key = `${rest[i]},${rest[i + 1]},${rest[i + 2]}`;
      const there = seen.get(key);
      if (there) {
        pairs++;
        expect([now[i], now[i + 1], now[i + 2]]).toEqual(there);
      } else seen.set(key, [now[i]!, now[i + 1]!, now[i + 2]!]);
    }
    expect(pairs).toBeGreaterThan(50);
  });

  it('never pushes a point further than MAX_TOTAL, however many hits it takes', () => {
    const g = body();
    const surface = new DentSurface(g, ORIGIN);
    for (let i = 0; i < 80; i++) surface.apply(dentFromHit(hit({ tick: i, dmg: 30 })));
    const before = positions(body());
    const after = positions(g);
    let most = 0;
    for (let i = 0; i < after.length; i += 3) most = Math.max(most, Math.hypot(after[i]! - before[i]!, after[i + 1]! - before[i + 1]!, after[i + 2]! - before[i + 2]!));
    expect(most).toBeLessThanOrEqual(DENT.MAX_TOTAL + 1e-5);
    expect(most).toBeGreaterThan(DENT.MAX_TOTAL - 1e-3); // and the limit was really reached
  });

  it('gives the same shape whichever order two dents are added in', () => {
    const a = dentFromHit(hit({ tick: 10, p: [2.3, 0, -0.5] }));
    const b = dentFromHit(hit({ tick: 11, p: [2.3, -0.2, 0.6], dmg: 6 }));
    const one = body();
    const other = body();
    const s1 = new DentSurface(one, ORIGIN);
    s1.apply(a);
    s1.apply(b);
    const s2 = new DentSurface(other, ORIGIN);
    s2.apply(b);
    s2.apply(a);
    const p1 = positions(one);
    const p2 = positions(other);
    for (let i = 0; i < p1.length; i++) expect(Math.abs(p1[i]! - p2[i]!)).toBeLessThan(1e-5);
  });

  it('crumples two cars that see the same hits exactly the same way', () => {
    const hits = [hit({ tick: 5 }), hit({ tick: 9, p: [-2.3, -0.3, 0.3], dmg: 4 }), hit({ tick: 40, attacker: -1, p: [0.4, 0, 1], dmg: 15 })];
    const mine = body();
    const yours = body();
    const s1 = new DentSurface(mine, ORIGIN);
    const s2 = new DentSurface(yours, ORIGIN);
    for (const h of hits) {
      s1.apply(dentFromHit(h));
      s2.apply(dentFromHit(h));
    }
    expect(positions(mine)).toEqual(positions(yours));
    expect(positions(mine)).not.toEqual(positions(body()));
  });

  it('is undamaged again after a reset', () => {
    const g = body();
    const surface = new DentSurface(g, ORIGIN);
    surface.apply(dent());
    expect(positions(g)).not.toEqual(positions(body()));
    surface.reset();
    const fresh = positions(body());
    expect(positions(g).map((v, i) => Math.abs(v - fresh[i]!))).toEqual(fresh.map(() => 0));
  });

  it('says how many vertices a dent reached, and does not touch a mesh it missed', () => {
    const rest = Float32Array.from(positions(body()));
    const raw = new Float32Array(rest.length);
    expect(accumulateDent(rest, raw, ORIGIN, dent({ x: -2.3, radius: 0.5 }))).toBeGreaterThan(0);
    expect(accumulateDent(rest, new Float32Array(rest.length), ORIGIN, dent({ x: 40, radius: 1 }))).toBe(0);
    const g = body();
    const array = g.getAttribute('position') as THREE.BufferAttribute;
    const version = array.version;
    new DentSurface(g, ORIGIN).apply(dent({ x: 40, radius: 1 }));
    expect(array.version).toBe(version); // nothing changed, so nothing to upload
    new DentSurface(g, ORIGIN).apply(dent());
    expect(array.version).toBeGreaterThan(version); // a dent that lands is uploaded
  });

  it('leaves vertices outside the radius exactly where they were', () => {
    const rest = Float32Array.from(positions(body()));
    const raw = new Float32Array(rest.length);
    const d = dent({ radius: 0.5 });
    accumulateDent(rest, raw, ORIGIN, d);
    let touched = 0;
    for (let i = 0; i < rest.length; i += 3) {
      const away = Math.hypot(rest[i]! - d.x, rest[i + 1]! + ORIGIN.y - d.y, rest[i + 2]! - d.z);
      const moved = raw[i] !== 0 || raw[i + 1] !== 0 || raw[i + 2] !== 0;
      if (away >= d.radius) expect(moved).toBe(false);
      if (moved) touched++;
    }
    expect(touched).toBeGreaterThan(0);
  });
});
