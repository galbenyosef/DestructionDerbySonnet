import * as THREE from 'three';
import { quatIntegrate } from '../../shared/math';
import { mulberry32 } from '../../shared/random';
import type { Quat, Vec3 } from '../../shared/types';
import type { DetachedPart } from './carView';

export const DEBRIS = {
  GRAVITY: 9.81,
  /** Speed kept after a bounce, and the slowest fall that still bounces. */
  RESTITUTION: 0.35,
  MIN_BOUNCE: 1,
  /** Seconds a piece lies around, of which the last FADE are spent shrinking away. */
  LIFE: 12,
  FADE: 2,
  /** Pieces alive at once; when there are more, the oldest is reused. */
  MAX: 40,
} as const;

/** A piece of debris in flight. */
export interface DebrisBody {
  pos: Vec3;
  vel: Vec3;
  quat: Quat;
  /** World angular velocity (rad/s). */
  spin: Vec3;
  /** Half the piece's size in each direction. */
  half: Vec3;
  age: number;
}

/** One step of its flight: gravity, bouncing off the ground, sliding and spinning to a stop. Purely cosmetic: no other car ever touches it. */
export function stepDebris(d: DebrisBody, dt: number): void {
  d.age += dt;
  d.vel.y -= DEBRIS.GRAVITY * dt;
  d.pos.x += d.vel.x * dt;
  d.pos.y += d.vel.y * dt;
  d.pos.z += d.vel.z * dt;
  d.quat = quatIntegrate(d.quat, d.spin, dt);
  const rest = Math.min(d.half.x, d.half.y, d.half.z); // it lies on its thinnest side
  if (d.pos.y <= rest) {
    d.pos.y = rest;
    d.vel.y = d.vel.y < -DEBRIS.MIN_BOUNCE ? -d.vel.y * DEBRIS.RESTITUTION : 0;
    const slide = Math.exp(-3 * dt);
    const stop = Math.exp(-4 * dt);
    d.vel.x *= slide;
    d.vel.z *= slide;
    d.spin.x *= stop;
    d.spin.y *= stop;
    d.spin.z *= stop;
  }
}

interface Piece {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  body: DebrisBody;
  active: boolean;
}

/** The parts that come off cars, flying, bouncing and fading away. A fixed pool of boxes, reused oldest first. */
export class DebrisSystem {
  readonly object = new THREE.Group();
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly pieces: Piece[] = [];
  private limit: number = DEBRIS.MAX;

  constructor(private readonly random: () => number = mulberry32(0xde0b715)) {
    for (let i = 0; i < DEBRIS.MAX; i++) {
      const material = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.3, flatShading: true });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.visible = false;
      mesh.castShadow = true;
      this.object.add(mesh);
      this.pieces.push({
        mesh,
        material,
        active: false,
        body: { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 }, spin: { x: 0, y: 0, z: 0 }, half: { x: 0.5, y: 0.5, z: 0.5 }, age: 0 },
      });
    }
  }

  /** How many pieces are lying around or flying. */
  get active(): number {
    return this.pieces.filter((p) => p.active).length;
  }

  /** The most pieces alive at once (at most DEBRIS.MAX): lowering it takes the oldest pieces away at once. */
  setLimit(limit: number): void {
    this.limit = Math.max(0, Math.min(DEBRIS.MAX, Math.floor(Number.isFinite(limit) ? limit : DEBRIS.MAX)));
    while (this.active > this.limit) {
      const old = this.oldest();
      old.active = false;
      old.mesh.visible = false;
    }
  }

  /** Sends a part flying: it keeps the speed of the car it came off and is thrown away from it and upwards. */
  spawn(part: DetachedPart, carVelocity: Vec3): void {
    if (this.limit === 0) return;
    const piece = (this.active < this.limit ? this.pieces.find((p) => !p.active) : undefined) ?? this.oldest();
    const r = this.random;
    const away = 3 + 4 * r();
    const up = 2 + 3 * r();
    const b = piece.body;
    b.pos = { ...part.position };
    b.vel = {
      x: carVelocity.x + part.outward.x * away + (r() - 0.5) * 2,
      y: carVelocity.y + part.outward.y * away + up,
      z: carVelocity.z + part.outward.z * away + (r() - 0.5) * 2,
    };
    b.quat = { ...part.quaternion };
    b.spin = { x: (r() - 0.5) * 12, y: (r() - 0.5) * 12, z: (r() - 0.5) * 12 };
    b.half = { x: part.size.x / 2, y: part.size.y / 2, z: part.size.z / 2 };
    b.age = 0;
    piece.material.color.setHex(part.color);
    piece.mesh.scale.set(part.size.x, part.size.y, part.size.z);
    piece.mesh.visible = true;
    piece.active = true;
    this.place(piece);
  }

  update(dt: number): void {
    if (!(dt > 0) || dt > 0.25) dt = Math.min(Math.max(dt || 0, 0), 0.25);
    for (const piece of this.pieces) {
      if (!piece.active) continue;
      stepDebris(piece.body, dt);
      if (piece.body.age >= DEBRIS.LIFE) {
        piece.active = false;
        piece.mesh.visible = false;
        continue;
      }
      this.place(piece);
    }
  }

  /** Removes every piece (a new round). */
  clear(): void {
    for (const piece of this.pieces) {
      piece.active = false;
      piece.mesh.visible = false;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    for (const piece of this.pieces) piece.material.dispose();
    this.object.removeFromParent();
  }

  /** The active piece that has been flying longest. */
  private oldest(): Piece {
    return this.pieces.filter((p) => p.active).reduce((a, b) => (b.body.age > a.body.age ? b : a));
  }

  private place(piece: Piece): void {
    const { pos, quat, half, age } = piece.body;
    piece.mesh.position.set(pos.x, pos.y, pos.z);
    piece.mesh.quaternion.set(quat.x, quat.y, quat.z, quat.w);
    const fade = Math.min(1, Math.max(0, (DEBRIS.LIFE - age) / DEBRIS.FADE));
    piece.mesh.scale.set(half.x * 2 * fade, half.y * 2 * fade, half.z * 2 * fade);
  }
}
