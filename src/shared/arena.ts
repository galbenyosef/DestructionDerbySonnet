import { CAR } from './constants';
import { quatFromYaw, quatFromYawPitch, round3, round6 } from './math';
import { RAPIER } from './physics';
import type { Quat, Vec3 } from './types';
import { DEFAULT_ARENA, type ArenaDef } from './arenas';

export interface SpawnPose {
  pos: Vec3;
  quat: Quat;
  yaw: number;
}

/** A yaw-rotated box described by its centre and half extents (used for colliders and for visuals). */
export interface BoxSpec {
  x: number;
  y: number;
  z: number;
  yaw: number;
  hx: number;
  hy: number;
  hz: number;
  /** Tilt about the box's own Z axis, in radians: a positive pitch lifts the +X end (a ramp). Default 0. */
  pitch?: number;
  /** What the box is (wall, block, ice, ramp, container...): the client dresses it; the physics ignores it. */
  kind?: string;
  /** Which variant of the kind to draw (the colour of a container). Cosmetic. */
  tint?: number;
}

export interface ArenaOptions {
  /** The arena to build. Default: the Stadium. */
  arena?: ArenaDef;
  /** false builds only the ground (handy for handling tests). Default true. */
  walls?: boolean;
  groundHalfExtent?: number;
}

/** Spawn `index` of `count` (the position in the sorted roster): on a ring facing the centre, or on the arena's listed places. */
export function spawnPose(index: number, count: number, arena: ArenaDef = DEFAULT_ARENA): SpawnPose {
  const layout = arena.spawn;
  if (layout.kind === 'points') {
    const [px, pz] = layout.points[Math.floor((index * layout.points.length) / count)]!;
    // forward (+X rotated by yaw about +Y) = (cos yaw, 0, -sin yaw) must equal (-x, 0, -z) / r
    const yaw = px || pz ? round6(Math.atan2(pz, -px)) : 0;
    return { pos: { x: px, y: CAR.SPAWN_HEIGHT, z: pz }, quat: quatFromYaw(yaw), yaw };
  }
  const a = (index / count) * Math.PI * 2;
  const x = round3(Math.cos(a) * layout.radius);
  const z = round3(Math.sin(a) * layout.radius);
  // forward (+X rotated by yaw about +Y) = (cos yaw, 0, -sin yaw) must equal (-cos a, 0, -sin a)
  const yaw = round6(Math.PI - a);
  return { pos: { x, y: CAR.SPAWN_HEIGHT, z }, quat: quatFromYaw(yaw), yaw };
}

export interface ArenaColliders {
  /** Handle of the ground collider: the one static surface a car body is not meant to touch (only wheels and a flipped roof do). */
  ground: number;
}

export function buildArena(world: RAPIER.World, options: ArenaOptions = {}): ArenaColliders {
  const arena = options.arena ?? DEFAULT_ARENA;
  const walls = options.walls ?? true;
  const half = options.groundHalfExtent ?? arena.groundHalfExtent;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const ground = world.createCollider(
    RAPIER.ColliderDesc.cuboid(half, 0.5, half).setTranslation(0, -0.5, 0).setFriction(arena.ground.friction).setRestitution(0),
    body,
  );
  const colliders = { ground: ground.handle };
  if (!walls) return colliders;
  for (const b of arena.boxes) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz)
        .setTranslation(b.x, b.y, b.z)
        .setRotation(b.pitch ? quatFromYawPitch(b.yaw, b.pitch) : quatFromYaw(b.yaw))
        .setFriction(0.3)
        .setRestitution(0.3),
      body,
    );
  }
  return colliders;
}
