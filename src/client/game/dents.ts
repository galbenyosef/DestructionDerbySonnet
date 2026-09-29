import * as THREE from 'three';
import { CAR } from '../../shared/constants';
import { clamp } from '../../shared/math';
import type { HitMessage } from '../../shared/protocol';
import type { Vec3 } from '../../shared/types';

/** How a car crumples. Depths and radii are in metres, in the car's own frame (forward +X, up +Y, right +Z). */
export const DENT = {
  /** depth = DEPTH_PER_HP * damage^0.75, kept between MIN_DEPTH and MAX_DEPTH. */
  DEPTH_PER_HP: 0.035,
  MIN_DEPTH: 0.04,
  MAX_DEPTH: 0.32,
  /** radius = MIN_RADIUS + RADIUS_PER_HP * damage, kept at most MAX_RADIUS. */
  MIN_RADIUS: 0.8,
  RADIUS_PER_HP: 0.045,
  MAX_RADIUS: 1.9,
  /** However many hits a car takes, no point of it moves further than this from where it started. */
  MAX_TOTAL: 0.45,
} as const;

/** One dent: where (car frame), how deep, how wide, and the seed of its irregularity. */
export interface Dent {
  x: number;
  y: number;
  z: number;
  depth: number;
  radius: number;
  seed: number;
}

const finite = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);

/**
 * The dent a `hit` message makes. It depends on nothing but the message, so every client that sees the same hits (in the same
 * order) crumples the car the same way; the seed is the tick, the victim and the attacker.
 */
export function dentFromHit(h: Pick<HitMessage, 'tick' | 'victim' | 'attacker' | 'dmg' | 'p'>): Dent {
  const damage = Math.max(0, finite(h.dmg, 0));
  const [px, py, pz] = h.p;
  return {
    x: clamp(finite(px, 0), -CAR.HALF.x, CAR.HALF.x),
    y: clamp(finite(py, 0), -CAR.HALF.y, CAR.HALF.y),
    z: clamp(finite(pz, 0), -CAR.HALF.z, CAR.HALF.z),
    depth: clamp(DENT.DEPTH_PER_HP * damage ** 0.75, DENT.MIN_DEPTH, DENT.MAX_DEPTH),
    radius: clamp(DENT.MIN_RADIUS + DENT.RADIUS_PER_HP * damage, DENT.MIN_RADIUS, DENT.MAX_RADIUS),
    seed: (Math.imul(h.tick | 0, 73856093) ^ Math.imul(h.victim | 0, 19349663) ^ Math.imul((h.attacker | 0) + 1, 83492791)) >>> 0,
  };
}

/** A repeatable number in [0, 1) from a seed and three integers (integer arithmetic only). */
export function hash3(seed: number, a: number, b: number, c: number): number {
  let h = (seed ^ Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ Math.imul(c, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Adds a dent to `raw`, the summed displacement of every vertex (x, y, z triples), for vertices whose rest positions are in
 * `rest` (a mesh whose origin sits at `origin` in the car frame). Vertices push toward the middle of the body, most at the hit and
 * fading to nothing at the radius, each by an irregular amount. The irregularity comes from the vertex's position, not its index,
 * so the duplicated vertices along the edges of a box move together and the surface does not tear. Returns how many vertices the dent
 * reached (0 when it missed the mesh altogether).
 */
export function accumulateDent(rest: Float32Array, raw: Float32Array, origin: Vec3, dent: Dent): number {
  let dx = -dent.x;
  let dy = -dent.y * 0.3;
  let dz = -dent.z;
  let length = Math.hypot(dx, dy, dz);
  if (length < 1e-6) {
    dx = -1; // a hit dead in the middle: push it backwards
    dy = 0;
    dz = 0;
    length = 1;
  }
  dx /= length;
  dy /= length;
  dz /= length;
  const r2 = dent.radius * dent.radius;
  let touched = 0;
  for (let i = 0; i < rest.length; i += 3) {
    const cx = rest[i]! + origin.x;
    const cy = rest[i + 1]! + origin.y;
    const cz = rest[i + 2]! + origin.z;
    const ex = cx - dent.x;
    const ey = cy - dent.y;
    const ez = cz - dent.z;
    const d2 = ex * ex + ey * ey + ez * ez;
    if (d2 >= r2) continue;
    touched++;
    const t = 1 - d2 / r2;
    const w = t * t;
    const ix = Math.round(cx * 1000);
    const iy = Math.round(cy * 1000);
    const iz = Math.round(cz * 1000);
    const push = dent.depth * w * (0.6 + 0.8 * hash3(dent.seed, ix, iy, iz));
    const scatter = dent.depth * w * 0.25;
    raw[i] = raw[i]! + dx * push + scatter * (hash3(dent.seed ^ 0x51ed270b, ix, iy, iz) - 0.5);
    raw[i + 1] = raw[i + 1]! + dy * push + scatter * (hash3(dent.seed ^ 0x2f6b1a93, ix, iy, iz) - 0.5);
    raw[i + 2] = raw[i + 2]! + dz * push + scatter * (hash3(dent.seed ^ 0x7c3d9e61, ix, iy, iz) - 0.5);
  }
  return touched;
}

/** The summed displacement of a vertex, cut down to DENT.MAX_TOTAL long if it is longer. */
function cappedOffset(raw: Float32Array, i: number, out: [number, number, number]): void {
  const x = raw[i]!;
  const y = raw[i + 1]!;
  const z = raw[i + 2]!;
  const len = Math.hypot(x, y, z);
  const k = len > DENT.MAX_TOTAL ? DENT.MAX_TOTAL / len : 1;
  out[0] = x * k;
  out[1] = y * k;
  out[2] = z * k;
}

/** A mesh geometry that can be dented: remembers its undamaged shape and the dents added to it. */
export class DentSurface {
  private readonly rest: Float32Array;
  private readonly raw: Float32Array;

  /** `origin` is where the mesh sits in the car frame (meshes are not rotated). */
  constructor(
    readonly geometry: THREE.BufferGeometry,
    private readonly origin: Vec3,
  ) {
    this.rest = Float32Array.from(geometry.getAttribute('position').array as ArrayLike<number>);
    this.raw = new Float32Array(this.rest.length);
  }

  /** Adds a dent; a mesh the dent does not reach is left alone (and not uploaded to the GPU again). */
  apply(dent: Dent): void {
    if (accumulateDent(this.rest, this.raw, this.origin, dent) > 0) this.write();
  }

  /** Back to the undamaged shape (a new round). */
  reset(): void {
    this.raw.fill(0);
    this.write();
  }

  private write(): void {
    const position = this.geometry.getAttribute('position');
    const out = position.array as Float32Array;
    const offset: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < out.length; i += 3) {
      cappedOffset(this.raw, i, offset);
      out[i] = this.rest[i]! + offset[0];
      out[i + 1] = this.rest[i + 1]! + offset[1];
      out[i + 2] = this.rest[i + 2]! + offset[2];
    }
    position.needsUpdate = true;
  }
}
