import { ARENA, CAR } from './constants';
import { quatFromYaw, round3, round6 } from './math';
import { RAPIER } from './physics';
import type { Quat, Vec3 } from './types';

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
}

export interface ArenaOptions {
  /** false builds only the ground (handy for handling tests). Default true. */
  walls?: boolean;
  groundHalfExtent?: number;
}

/** Regular polygon of wall boxes whose inner faces sit at ARENA.RADIUS. */
export function wallSegments(): BoxSpec[] {
  const n = ARENA.WALL_SEGMENTS;
  const t = ARENA.WALL_HALF_THICKNESS;
  const r = ARENA.RADIUS + t;
  const hx = round3(r * Math.tan(Math.PI / n) + 0.3); // +0.3 overlaps neighbours so there are no gaps
  const out: BoxSpec[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({
      x: round3(Math.cos(a) * r),
      y: ARENA.WALL_HALF_HEIGHT,
      z: round3(Math.sin(a) * r),
      yaw: round6(-a - Math.PI / 2), // local +X (the long axis) becomes tangent to the ring
      hx,
      hy: ARENA.WALL_HALF_HEIGHT,
      hz: t,
    });
  }
  return out;
}

/** Concrete blocks on a ring, offset by 22.5 degrees so they never sit on a spawn line. */
export function obstacleBoxes(): BoxSpec[] {
  const out: BoxSpec[] = [];
  for (let i = 0; i < ARENA.OBSTACLE_COUNT; i++) {
    const a = ((i + 0.25) / ARENA.OBSTACLE_COUNT) * Math.PI * 2;
    out.push({
      x: round3(Math.cos(a) * ARENA.OBSTACLE_RING_RADIUS),
      y: ARENA.OBSTACLE_HALF.y,
      z: round3(Math.sin(a) * ARENA.OBSTACLE_RING_RADIUS),
      yaw: round6(-a - Math.PI / 2),
      hx: ARENA.OBSTACLE_HALF.x,
      hy: ARENA.OBSTACLE_HALF.y,
      hz: ARENA.OBSTACLE_HALF.z,
    });
  }
  return out;
}

/** Evenly spaced spawn on a circle, facing the centre. `index` is the position in the sorted roster. */
export function spawnPose(index: number, count: number): SpawnPose {
  const a = (index / count) * Math.PI * 2;
  const x = round3(Math.cos(a) * ARENA.SPAWN_RADIUS);
  const z = round3(Math.sin(a) * ARENA.SPAWN_RADIUS);
  // forward (+X rotated by yaw about +Y) = (cos yaw, 0, -sin yaw) must equal (-cos a, 0, -sin a)
  const yaw = round6(Math.PI - a);
  return { pos: { x, y: CAR.SPAWN_HEIGHT, z }, quat: quatFromYaw(yaw), yaw };
}

export interface ArenaColliders {
  /** Handle of the ground collider: the one static surface a car body is not meant to touch (only wheels and a flipped roof do). */
  ground: number;
}

export function buildArena(world: RAPIER.World, options: ArenaOptions = {}): ArenaColliders {
  const walls = options.walls ?? true;
  const half = options.groundHalfExtent ?? ARENA.GROUND_HALF_EXTENT;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const ground = world.createCollider(
    RAPIER.ColliderDesc.cuboid(half, 0.5, half).setTranslation(0, -0.5, 0).setFriction(1).setRestitution(0),
    body,
  );
  const colliders = { ground: ground.handle };
  if (!walls) return colliders;
  for (const b of [...wallSegments(), ...obstacleBoxes()]) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz)
        .setTranslation(b.x, b.y, b.z)
        .setRotation(quatFromYaw(b.yaw))
        .setFriction(0.3)
        .setRestitution(0.3),
      body,
    );
  }
  return colliders;
}
