import type { BoxSpec } from '../../src/shared/arena';
import { round3, round6 } from '../../src/shared/math';

/** The Stadium as it was built before arenas became data (Plans 1-7): the identity test compares stadium.json with this, bit for bit. */
export const LEGACY = {
  RADIUS: 45,
  WALL_SEGMENTS: 32,
  WALL_HALF_HEIGHT: 1.5,
  WALL_HALF_THICKNESS: 1.0,
  GROUND_HALF_EXTENT: 120,
  SPAWN_RADIUS: 32,
  OBSTACLE_COUNT: 4,
  OBSTACLE_RING_RADIUS: 14,
  OBSTACLE_HALF: { x: 2.5, y: 0.75, z: 1.0 },
} as const;

export function legacyWallSegments(): BoxSpec[] {
  const n = LEGACY.WALL_SEGMENTS;
  const t = LEGACY.WALL_HALF_THICKNESS;
  const r = LEGACY.RADIUS + t;
  const hx = round3(r * Math.tan(Math.PI / n) + 0.3);
  const out: BoxSpec[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({ x: round3(Math.cos(a) * r), y: LEGACY.WALL_HALF_HEIGHT, z: round3(Math.sin(a) * r), yaw: round6(-a - Math.PI / 2), hx, hy: LEGACY.WALL_HALF_HEIGHT, hz: t });
  }
  return out;
}

export function legacyObstacleBoxes(): BoxSpec[] {
  const out: BoxSpec[] = [];
  for (let i = 0; i < LEGACY.OBSTACLE_COUNT; i++) {
    const a = ((i + 0.25) / LEGACY.OBSTACLE_COUNT) * Math.PI * 2;
    out.push({
      x: round3(Math.cos(a) * LEGACY.OBSTACLE_RING_RADIUS), y: LEGACY.OBSTACLE_HALF.y, z: round3(Math.sin(a) * LEGACY.OBSTACLE_RING_RADIUS),
      yaw: round6(-a - Math.PI / 2), hx: LEGACY.OBSTACLE_HALF.x, hy: LEGACY.OBSTACLE_HALF.y, hz: LEGACY.OBSTACLE_HALF.z,
    });
  }
  return out;
}

export function legacySpawn(index: number, count: number): { x: number; z: number; yaw: number } {
  const a = (index / count) * Math.PI * 2;
  return { x: round3(Math.cos(a) * LEGACY.SPAWN_RADIUS), z: round3(Math.sin(a) * LEGACY.SPAWN_RADIUS), yaw: round6(Math.PI - a) };
}
