import { ARENA, PHYSICS } from './constants';
import { buildArena, spawnPose, type ArenaOptions } from './arena';
import { quantizeInput, type CarInput } from './input';
import { RAPIER, physicsReady } from './physics';
import type { CarState, WheelPose } from './types';
import { createCarRig, driveCar, type CarRig } from './vehicle';

export type SimOptions = ArenaOptions;

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
    buildArena(this.world, options);
    unique.forEach((slot, index) => {
      const rig = createCarRig(this.world, slot, spawnPose(index, unique.length));
      this.rigs.set(slot, rig);
      this.ordered.push(rig);
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
