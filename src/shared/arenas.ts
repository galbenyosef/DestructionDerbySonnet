import type { BoxSpec } from './arena';
import iceJson from './arenas/ice.json';
import portJson from './arenas/port.json';
import quarryJson from './arenas/quarry.json';
import stadiumJson from './arenas/stadium.json';

/** The arenas a room can play in, in the order the vote panel lists them. */
export const ARENA_IDS = ['stadium', 'ice', 'quarry', 'port'] as const;
export type ArenaId = (typeof ARENA_IDS)[number];
export const isArenaId = (v: unknown): v is ArenaId => typeof v === 'string' && (ARENA_IDS as readonly string[]).includes(v);

/** How the ground treats a car. 1 / 0 / 1 / 1 is the Stadium's dirt: every other arena is relative to it. */
export interface GroundFeel {
  /** Friction of the ground against the car's body (scraping). */
  friction: number;
  /** Multiplies the tyres' grip, sideways and along. */
  grip: number;
  /** Added to the car's linear damping: mud drags. */
  drag: number;
  /** Multiplies the engine force and the speed it fades out at. */
  power: number;
}

/** The Stadium's dirt, and what a car is built with when nobody says otherwise. */
export const NEUTRAL_GROUND: GroundFeel = Object.freeze({ friction: 1, grip: 1, drag: 0, power: 1 });

export type Bounds = { kind: 'circle'; radius: number } | { kind: 'polygon'; points: Array<[number, number]> };
export type SpawnLayout = { kind: 'ring'; radius: number } | { kind: 'points'; points: Array<[number, number]> };

/** Colours and light for the arena as the client draws it from the layout alone (the Blender scenery comes on top). */
export interface ArenaLook {
  sky: string;
  fog: string;
  fogNear: number;
  fogFar: number;
  ground: string;
  wall: string;
  block: string;
  sun: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
}

export interface ArenaDef {
  id: ArenaId;
  name: string;
  groundHalfExtent: number;
  ground: GroundFeel;
  /** Walls and obstacles (static boxes), walls first. */
  boxes: BoxSpec[];
  /** The playable area: a car outside it (plus a margin) is out of the round. */
  bounds: Bounds;
  spawn: SpawnLayout;
  look: ArenaLook;
}

// ---- reading a layout file ------------------------------------------------------------------------------------

function fail(path: string, why: string): never {
  throw new Error(`arena layout: ${path} ${why}`);
}
const obj = (v: unknown, path: string): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(path, 'must be an object');
const num = (v: unknown, path: string): number => (typeof v === 'number' && Number.isFinite(v) ? v : fail(path, 'must be a finite number'));
const str = (v: unknown, path: string): string => (typeof v === 'string' && v.length > 0 ? v : fail(path, 'must be a non-empty string'));
const pairs = (v: unknown, path: string, min: number): Array<[number, number]> => {
  if (!Array.isArray(v) || v.length < min) fail(path, `must be a list of at least ${min} [x, z] pairs`);
  return v.map((p, i) => {
    if (!Array.isArray(p) || p.length !== 2) fail(`${path}[${i}]`, 'must be an [x, z] pair');
    return [num(p[0], `${path}[${i}][0]`), num(p[1], `${path}[${i}][1]`)] as [number, number];
  });
};

/** Checks a layout (the JSON files, or anything a test makes up) and returns it typed; throws a readable error otherwise. */
export function parseArena(raw: unknown): ArenaDef {
  const a = obj(raw, 'arena');
  const id = str(a.id, 'id');
  if (!isArenaId(id)) fail('id', `must be one of ${ARENA_IDS.join(', ')}`);
  const g = obj(a.ground, 'ground');
  const ground: GroundFeel = { friction: num(g.friction, 'ground.friction'), grip: num(g.grip, 'ground.grip'), drag: num(g.drag, 'ground.drag'), power: num(g.power, 'ground.power') };
  if (ground.grip <= 0 || ground.grip > 3 || ground.power <= 0 || ground.power > 3 || ground.drag < 0 || ground.drag > 2 || ground.friction < 0) {
    fail('ground', 'is outside the range the physics is tuned for');
  }
  if (!Array.isArray(a.boxes) || a.boxes.length === 0) fail('boxes', 'must be a non-empty list');
  const boxes = a.boxes.map((b, i): BoxSpec => {
    const o = obj(b, `boxes[${i}]`);
    const box: BoxSpec = {
      x: num(o.x, `boxes[${i}].x`), y: num(o.y, `boxes[${i}].y`), z: num(o.z, `boxes[${i}].z`), yaw: num(o.yaw, `boxes[${i}].yaw`),
      hx: num(o.hx, `boxes[${i}].hx`), hy: num(o.hy, `boxes[${i}].hy`), hz: num(o.hz, `boxes[${i}].hz`),
    };
    if (box.hx <= 0 || box.hy <= 0 || box.hz <= 0) fail(`boxes[${i}]`, 'must have positive half extents');
    if (o.pitch !== undefined) box.pitch = num(o.pitch, `boxes[${i}].pitch`);
    if (o.kind !== undefined) box.kind = str(o.kind, `boxes[${i}].kind`);
    if (o.tint !== undefined) box.tint = num(o.tint, `boxes[${i}].tint`);
    return box;
  });
  const b = obj(a.bounds, 'bounds');
  const bounds: Bounds =
    b.kind === 'circle' ? { kind: 'circle', radius: num(b.radius, 'bounds.radius') } : b.kind === 'polygon' ? { kind: 'polygon', points: pairs(b.points, 'bounds.points', 3) } : fail('bounds.kind', 'must be circle or polygon');
  if (bounds.kind === 'circle' && bounds.radius <= 0) fail('bounds.radius', 'must be positive');
  const s = obj(a.spawn, 'spawn');
  const spawn: SpawnLayout =
    s.kind === 'ring' ? { kind: 'ring', radius: num(s.radius, 'spawn.radius') } : s.kind === 'points' ? { kind: 'points', points: pairs(s.points, 'spawn.points', 8) } : fail('spawn.kind', 'must be ring or points');
  if (spawn.kind === 'points' && spawn.points.length !== 8) fail('spawn.points', 'must list exactly 8 places');
  const l = obj(a.look, 'look');
  const look: ArenaLook = {
    sky: str(l.sky, 'look.sky'), fog: str(l.fog, 'look.fog'), fogNear: num(l.fogNear, 'look.fogNear'), fogFar: num(l.fogFar, 'look.fogFar'),
    ground: str(l.ground, 'look.ground'), wall: str(l.wall, 'look.wall'), block: str(l.block, 'look.block'), sun: str(l.sun, 'look.sun'),
    sunIntensity: num(l.sunIntensity, 'look.sunIntensity'), hemiSky: str(l.hemiSky, 'look.hemiSky'), hemiGround: str(l.hemiGround, 'look.hemiGround'),
  };
  return { id, name: str(a.name, 'name'), groundHalfExtent: num(a.groundHalfExtent, 'groundHalfExtent'), ground, boxes, bounds, spawn, look };
}

export const ARENAS: Readonly<Record<ArenaId, ArenaDef>> = {
  stadium: parseArena(stadiumJson),
  ice: parseArena(iceJson),
  quarry: parseArena(quarryJson),
  port: parseArena(portJson),
};
export const DEFAULT_ARENA: ArenaDef = ARENAS.stadium;
export const getArena = (id: ArenaId): ArenaDef => ARENAS[id];

// ---- the playable area -----------------------------------------------------------------------------------------

function distanceToSegment(px: number, pz: number, x0: number, z0: number, x1: number, z1: number): number {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (pz - z0) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - (x0 + t * dx), pz - (z0 + t * dz));
}

function insidePolygon(points: ReadonlyArray<readonly [number, number]>, x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = points[i]!;
    const [xj, zj] = points[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** The furthest the playable area gets from the middle (m): what a shadow camera or a ring of scenery has to cover. */
export function boundsRadius(bounds: Bounds): number {
  return bounds.kind === 'circle' ? bounds.radius : Math.max(...bounds.points.map(([x, z]) => Math.hypot(x, z)));
}

/** Half the side of the smallest square around the middle that holds the playable area (m): what the tyre-mark texture covers. */
export function boundsHalfSize(bounds: Bounds): number {
  return bounds.kind === 'circle' ? bounds.radius : Math.max(...bounds.points.map(([x, z]) => Math.max(Math.abs(x), Math.abs(z))));
}

/** How far inside the playable area a point is (metres): negative outside. */
export function boundsClearance(bounds: Bounds, x: number, z: number): number {
  if (bounds.kind === 'circle') return bounds.radius - Math.hypot(x, z);
  let nearest = Infinity;
  for (let i = 0; i < bounds.points.length; i++) {
    const [x0, z0] = bounds.points[i]!;
    const [x1, z1] = bounds.points[(i + 1) % bounds.points.length]!;
    nearest = Math.min(nearest, distanceToSegment(x, z, x0, z0, x1, z1));
  }
  return insidePolygon(bounds.points, x, z) ? nearest : -nearest;
}

/** True once a point is further than `margin` outside the playable area. */
export function outOfBounds(bounds: Bounds, x: number, z: number, margin: number): boolean {
  return bounds.kind === 'circle' ? Math.hypot(x, z) > bounds.radius + margin : boundsClearance(bounds, x, z) < -margin;
}

/** The nearest point to (x, z) towards the middle that is at least `inset` inside the playable area. */
export function clampToBounds(bounds: Bounds, x: number, z: number, inset: number): { x: number; z: number } {
  if (boundsClearance(bounds, x, z) >= inset) return { x, z };
  if (bounds.kind === 'circle') {
    const r = Math.hypot(x, z);
    const max = Math.max(0, bounds.radius - inset);
    return r > max ? { x: (x * max) / r, z: (z * max) / r } : { x, z };
  }
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (boundsClearance(bounds, x * (1 - mid), z * (1 - mid)) >= inset) hi = mid;
    else lo = mid;
  }
  return { x: x * (1 - hi), z: z * (1 - hi) };
}
