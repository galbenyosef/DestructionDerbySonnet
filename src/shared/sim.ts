import { ARENA, PHYSICS } from './constants';
import { buildArena, spawnPose, type ArenaOptions } from './arena';
import { quantizeInput, type CarInput } from './input';
import { RAPIER, physicsReady } from './physics';
import type { CarState, Vec3, WheelPose } from './types';
import { createCarRig, driveCar, type CarRig } from './vehicle';

export type SimOptions = ArenaOptions;

/** One car's contact with another car or with the arena during the last step, as the solver resolved it. */
export interface Contact {
  /** Slot of the car the contact is reported for (for a pair of cars, the lower slot). */
  a: number;
  /** Slot of the other car, or -1 for walls and obstacles (all of them together). */
  b: number;
  /** Sum of the normal impulses at the contact points (N·s). */
  impulse: number;
  /** Impulse-weighted mean contact point in car `a`'s local frame (forward +X, up +Y, right +Z), and in car `b`'s (zero for -1). */
  pointA: Vec3;
  pointB: Vec3;
}

const scratchA: Vec3 = { x: 0, y: 0, z: 0 };
const scratchB: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * The one step function both the server and (later) the browser run. Deterministic for identical
 * roster, options and input sequences.
 */
export class Simulation {
  /** Sorted, de-duplicated slot numbers of the cars in this world. */
  readonly slots: readonly number[];
  /** Number of completed steps. */
  tick = 0;
  private readonly world: RAPIER.World;
  private readonly rigs = new Map<number, CarRig>();
  private readonly ordered: CarRig[] = [];
  private readonly slotOfCollider = new Map<number, number>();
  private readonly groundHandle: number;
  private disposed = false;

  constructor(slots: readonly number[], options: SimOptions = {}) {
    if (!physicsReady()) throw new Error('Physics is not initialised: await initPhysics() before creating a Simulation.');
    const unique = [...new Set(slots)].sort((a, b) => a - b);
    if (unique.length > ARENA.MAX_CARS) {
      throw new RangeError(`at most ${ARENA.MAX_CARS} cars per simulation, got ${unique.length}`);
    }
    for (const s of unique) {
      if (!Number.isInteger(s) || s < 0 || s >= ARENA.MAX_CARS) throw new RangeError(`invalid slot ${s}`);
    }
    this.slots = unique;
    this.world = new RAPIER.World({ x: 0, y: -PHYSICS.GRAVITY, z: 0 });
    this.world.timestep = PHYSICS.DT;
    this.groundHandle = buildArena(this.world, options).ground;
    unique.forEach((slot, index) => {
      const rig = createCarRig(this.world, slot, spawnPose(index, unique.length));
      this.rigs.set(slot, rig);
      this.ordered.push(rig);
      this.slotOfCollider.set(rig.collider.handle, slot);
    });
  }

  private rig(slot: number): CarRig {
    const rig = this.rigs.get(slot);
    if (!rig) throw new RangeError(`unknown slot ${slot}`);
    return rig;
  }

  /** Stores the input for subsequent steps. Values are quantized and sanitised (NaN -> 0). */
  setInput(slot: number, input: CarInput): void {
    this.rig(slot).input = quantizeInput(input);
  }

  getInput(slot: number): CarInput {
    return { ...this.rig(slot).input };
  }

  step(): void {
    if (this.disposed) throw new Error('Simulation is disposed');
    for (const rig of this.ordered) {
      driveCar(rig);
      rig.controller.updateVehicle(PHYSICS.DT, RAPIER.QueryFilterFlags.ONLY_FIXED);
    }
    this.world.step();
    this.tick++;
  }

  getState(slot: number): CarState {
    const b = this.rig(slot).body;
    const t = b.translation();
    const r = b.rotation();
    const v = b.linvel();
    const w = b.angvel();
    return {
      pos: { x: t.x, y: t.y, z: t.z },
      quat: { x: r.x, y: r.y, z: r.z, w: r.w },
      linvel: { x: v.x, y: v.y, z: v.z },
      angvel: { x: w.x, y: w.y, z: w.z },
    };
  }

  /** Overwrites a car's rigid-body state (used by client rollback). */
  setState(slot: number, s: CarState): void {
    const b = this.rig(slot).body;
    b.setTranslation(s.pos, true);
    b.setRotation(s.quat, true);
    b.setLinvel(s.linvel, true);
    b.setAngvel(s.angvel, true);
  }

  /**
   * Contacts of the last step that transmitted at least `minImpulse` N·s: between two cars (reported once, for the lower
   * slot) and between a car and the walls or obstacles (one entry per car, `b` = -1). The ground is never reported: a car
   * body only touches it when it lies on its roof. Read-only; it does not change the simulation, so the server and the
   * browser may call it whenever they like without losing bit-for-bit agreement.
   */
  contacts(minImpulse = 0): Contact[] {
    const out: Contact[] = [];
    const others: RAPIER.Collider[] = [];
    for (const rig of this.ordered) {
      others.length = 0;
      this.world.contactPairsWith(rig.collider, (other) => {
        others.push(other);
      });
      let wall: Contact | null = null;
      for (const other of others) {
        if (other.handle === this.groundHandle) continue;
        const otherSlot = this.slotOfCollider.get(other.handle);
        if (otherSlot !== undefined && otherSlot < rig.slot) continue; // each pair of cars once, from its lower slot
        let impulse = 0;
        let ax = 0, ay = 0, az = 0, bx = 0, by = 0, bz = 0;
        this.world.contactPair(rig.collider, other, (manifold, flipped) => {
          for (let i = 0, n = manifold.numContacts(); i < n; i++) {
            const w = manifold.contactImpulse(i);
            if (!(w > 0)) continue;
            const first = manifold.localContactPoint1(i, scratchA);
            const second = manifold.localContactPoint2(i, scratchB);
            const mine = flipped ? second : first;
            const theirs = flipped ? first : second;
            impulse += w;
            if (mine) { ax += w * mine.x; ay += w * mine.y; az += w * mine.z; }
            if (theirs) { bx += w * theirs.x; by += w * theirs.y; bz += w * theirs.z; }
          }
        });
        if (impulse <= 0) continue;
        if (otherSlot === undefined) {
          if (wall) {
            const total = wall.impulse + impulse;
            wall.pointA = { x: (wall.pointA.x * wall.impulse + ax) / total, y: (wall.pointA.y * wall.impulse + ay) / total, z: (wall.pointA.z * wall.impulse + az) / total };
            wall.impulse = total;
          } else {
            wall = { a: rig.slot, b: -1, impulse, pointA: { x: ax / impulse, y: ay / impulse, z: az / impulse }, pointB: { x: 0, y: 0, z: 0 } };
          }
        } else if (impulse >= minImpulse) {
          out.push({
            a: rig.slot,
            b: otherSlot,
            impulse,
            pointA: { x: ax / impulse, y: ay / impulse, z: az / impulse },
            pointB: { x: bx / impulse, y: by / impulse, z: bz / impulse },
          });
        }
      }
      if (wall && wall.impulse >= minImpulse) out.push(wall);
    }
    return out.sort((p, q) => p.a - q.a || p.b - q.b);
  }

  getWheels(slot: number): WheelPose[] {
    const c = this.rig(slot).controller;
    const out: WheelPose[] = [];
    for (let i = 0; i < 4; i++) {
      out.push({
        contact: c.wheelIsInContact(i),
        suspensionLength: c.wheelSuspensionLength(i) ?? 0,
        rotation: c.wheelRotation(i) ?? 0,
        steering: c.wheelSteering(i) ?? 0,
      });
    }
    return out;
  }

  /**
   * Frees all WASM memory eagerly. Idempotent. Controllers are removed first; Rapier 0.21's `World.free()` would
   * also free them, so that is defence in depth. What matters is one prompt `world.free()` per world.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const rig of this.ordered) this.world.removeVehicleController(rig.controller);
    this.world.free();
  }
}
