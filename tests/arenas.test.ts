import { beforeAll, describe, expect, it } from 'vitest';
import { spawnPose } from '../src/shared/arena';
import { ARENAS, ARENA_IDS, boundsClearance, boundsHalfSize, boundsRadius, clampToBounds, getArena, isArenaId, outOfBounds, parseArena, type ArenaDef } from '../src/shared/arenas';
import { CAR_FORWARD, ARENA } from '../src/shared/constants';
import { quatFromYaw, quatFromYawPitch, quatRotate, vdot } from '../src/shared/math';
import { initPhysics } from '../src/shared/physics';
import { legacyObstacleBoxes, legacySpawn, legacyWallSegments } from './helpers/legacyArena';

beforeAll(async () => {
  await initPhysics();
});

const raw = (id: (typeof ARENA_IDS)[number]) => JSON.parse(JSON.stringify(ARENAS[id])) as Record<string, any>;

describe('the Stadium layout', () => {
  it('is exactly the circle the game had before arenas were data', () => {
    const stripped = ARENAS.stadium.boxes.map(({ x, y, z, yaw, hx, hy, hz }) => ({ x, y, z, yaw, hx, hy, hz }));
    // JSON cannot hold -0, so the legacy numbers are compared with their negative zeros turned into plain ones
    const legacy = [...legacyWallSegments(), ...legacyObstacleBoxes()].map((b) => ({ ...b, x: b.x + 0, z: b.z + 0 }));
    expect(stripped).toEqual(legacy);
    expect(ARENAS.stadium.groundHalfExtent).toBe(120);
    expect(ARENAS.stadium.ground).toEqual({ friction: 1, grip: 1, drag: 0, power: 1 });
  });

  it('spawns where it used to', () => {
    for (let i = 0; i < 8; i++) {
      const p = spawnPose(i, 8, ARENAS.stadium);
      const old = legacySpawn(i, 8);
      expect([p.pos.x, p.pos.z, p.yaw]).toEqual([old.x, old.z, old.yaw]);
    }
  });
});

describe('every arena layout', () => {
  for (const id of ARENA_IDS) {
    const arena = getArena(id);
    describe(arena.name, () => {
      it('has its own id and a name', () => {
        expect(arena.id).toBe(id);
        expect(arena.name.length).toBeGreaterThan(2);
      });

      it('gives eight spawns inside the bounds, clear of every box, facing the middle', () => {
        const seen = new Set<string>();
        for (let i = 0; i < 8; i++) {
          const p = spawnPose(i, 8, arena);
          seen.add(`${p.pos.x},${p.pos.z}`);
          expect(boundsClearance(arena.bounds, p.pos.x, p.pos.z)).toBeGreaterThan(5);
          for (const b of arena.boxes) {
            const q = quatRotate(quatFromYaw(-b.yaw), { x: p.pos.x - b.x, y: 0, z: p.pos.z - b.z });
            const gap = Math.hypot(Math.max(Math.abs(q.x) - b.hx, 0), Math.max(Math.abs(q.z) - b.hz, 0));
            expect(gap, `${id} spawn ${i} against ${b.kind}`).toBeGreaterThan(2.5);
          }
          const r = Math.hypot(p.pos.x, p.pos.z);
          const f = quatRotate(p.quat, CAR_FORWARD);
          expect(vdot(f, { x: -p.pos.x / r, y: 0, z: -p.pos.z / r })).toBeGreaterThan(0.99);
        }
        expect(seen.size).toBe(8);
      });

      it('keeps every box inside the ground, with sane sizes and a kind', () => {
        for (const b of arena.boxes) {
          expect(typeof b.kind).toBe('string');
          expect(Math.abs(b.x) + Math.max(b.hx, b.hz)).toBeLessThan(arena.groundHalfExtent);
          expect(Math.abs(b.z) + Math.max(b.hx, b.hz)).toBeLessThan(arena.groundHalfExtent);
          expect(b.hy).toBeGreaterThan(0);
          expect(Math.abs(b.pitch ?? 0)).toBeLessThan(0.5);
        }
      });

      it('has a ground feel within the range the physics is tuned for', () => {
        expect(arena.ground.grip).toBeGreaterThan(0.2);
        expect(arena.ground.grip).toBeLessThanOrEqual(1.5);
        expect(arena.ground.power).toBeGreaterThan(0.6);
        expect(arena.ground.power).toBeLessThanOrEqual(1.2);
        expect(arena.ground.drag).toBeGreaterThanOrEqual(0);
        expect(arena.ground.drag).toBeLessThan(1);
      });

      it('has walls all the way round (a point just outside the bounds meets a box)', () => {
        const probes = 48;
        for (let k = 0; k < probes; k++) {
          const a = (k / probes) * Math.PI * 2;
          let x = Math.cos(a) * 3;
          let z = Math.sin(a) * 3;
          while (boundsClearance(arena.bounds, x, z) > 0.2) { x += Math.cos(a) * 0.25; z += Math.sin(a) * 0.25; }
          x += Math.cos(a) * 1.2;
          z += Math.sin(a) * 1.2;
          const hit = arena.boxes.some((b) => {
            const dx = x - b.x;
            const dz = z - b.z;
            const q = quatRotate(quatFromYaw(-b.yaw), { x: dx, y: 0, z: dz });
            return Math.abs(q.x) <= b.hx + 0.05 && Math.abs(q.z) <= b.hz + 0.05;
          });
          expect(hit, `${id} probe ${k}`).toBe(true);
        }
      });
    });
  }
});

describe('parseArena', () => {
  it('accepts every shipped layout unchanged', () => {
    for (const id of ARENA_IDS) expect(parseArena(raw(id))).toEqual(ARENAS[id]);
  });

  it.each([
    ['an unknown id', (a: any) => { a.id = 'moon'; }],
    ['no boxes', (a: any) => { a.boxes = []; }],
    ['a box with a NaN', (a: any) => { a.boxes[0].x = Number.NaN; }],
    ['a box with a negative half extent', (a: any) => { a.boxes[0].hy = -1; }],
    ['a grip of zero', (a: any) => { a.ground.grip = 0; }],
    ['a power far above the tuned range', (a: any) => { a.ground.power = 9; }],
    ['bounds of an unknown kind', (a: any) => { a.bounds = { kind: 'blob' }; }],
    ['a polygon with two points', (a: any) => { a.bounds = { kind: 'polygon', points: [[0, 0], [1, 1]] }; }],
    ['seven spawn points', (a: any) => { a.spawn = { kind: 'points', points: Array.from({ length: 7 }, (_, i) => [i, 0]) }; }],
    ['a missing look', (a: any) => { delete a.look; }],
    ['a tyre-mark colour that is not #rrggbb', (a: any) => { a.look.marks = 'red'; }],
    ['no tyre-mark colour', (a: any) => { delete a.look.marks; }],
  ])('rejects %s', (_name, damage) => {
    const a = raw('stadium');
    damage(a);
    expect(() => parseArena(a)).toThrow(/arena layout/);
  });

  it('rejects things that are not objects', () => {
    for (const bad of [null, 3, 'x', [], undefined]) expect(() => parseArena(bad)).toThrow(/arena layout/);
  });
});

describe('the look of each arena', () => {
  it('has a tyre-mark colour of its own, written #rrggbb', () => {
    const colours = ARENA_IDS.map((id) => ARENAS[id].look.marks);
    for (const c of colours) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    expect(new Set(colours).size).toBe(ARENA_IDS.length);
  });
});

describe('arena ids', () => {
  it('recognises exactly the four', () => {
    expect([...ARENA_IDS]).toEqual(['stadium', 'ice', 'quarry', 'port']);
    expect(isArenaId('ice')).toBe(true);
    for (const bad of ['', 'Ice', 'moon', 3, null, undefined, {}]) expect(isArenaId(bad)).toBe(false);
  });
});

describe('bounds', () => {
  const circle: ArenaDef['bounds'] = { kind: 'circle', radius: 10 };
  const square: ArenaDef['bounds'] = { kind: 'polygon', points: [[-10, -10], [10, -10], [10, 10], [-10, 10]] };

  it('measures clearance in metres, negative outside', () => {
    expect(boundsClearance(circle, 4, 0)).toBeCloseTo(6);
    expect(boundsClearance(circle, 13, 0)).toBeCloseTo(-3);
    expect(boundsClearance(square, 4, 0)).toBeCloseTo(6);
    expect(boundsClearance(square, 13, 0)).toBeCloseTo(-3);
    expect(boundsClearance(square, 13, 13)).toBeCloseTo(-Math.hypot(3, 3));
  });

  it('keeps the circle test the game always had: further than radius + margin', () => {
    expect(outOfBounds(circle, 12, 0, 2)).toBe(false);
    expect(outOfBounds(circle, 12.001, 0, 2)).toBe(true);
  });

  it('applies the margin outside a polygon', () => {
    expect(outOfBounds(square, 11.9, 0, 2)).toBe(false);
    expect(outOfBounds(square, 12.1, 0, 2)).toBe(true);
    expect(outOfBounds(square, 12.1, 12.1, 2)).toBe(true);
  });

  it('clamps a point towards the middle until it is `inset` inside', () => {
    const c = clampToBounds(circle, 30, 0, 3);
    expect(c.x).toBeCloseTo(7);
    const s = clampToBounds(square, 30, 5, 3);
    expect(boundsClearance(square, s.x, s.z)).toBeGreaterThanOrEqual(3 - 1e-3);
    expect(boundsClearance(square, s.x, s.z)).toBeLessThan(3.05);
    expect(clampToBounds(square, 1, 1, 3)).toEqual({ x: 1, z: 1 });
  });

  it('survives a point at the exact middle and a non-finite one', () => {
    expect(clampToBounds(circle, 0, 0, 50)).toEqual({ x: 0, z: 0 });
    expect(Number.isFinite(boundsClearance(square, 0, 0))).toBe(true);
  });
});

describe('how far an arena reaches', () => {
  it('measures the furthest point from the middle, and the half-width of the square that holds it', () => {
    expect(boundsRadius({ kind: 'circle', radius: 52 })).toBe(52);
    expect(boundsHalfSize({ kind: 'circle', radius: 52 })).toBe(52);
    const rect: ArenaDef['bounds'] = { kind: 'polygon', points: [[-45, -33], [45, -33], [45, 33], [-45, 33]] };
    expect(boundsRadius(rect)).toBeCloseTo(Math.hypot(45, 33));
    expect(boundsHalfSize(rect)).toBe(45);
  });

  it('puts every wall inside the reach, so scenery and marks can be sized from it', () => {
    for (const id of ARENA_IDS) {
      const a = ARENAS[id];
      for (const b of a.boxes) expect(Math.hypot(b.x, b.z)).toBeLessThan(boundsRadius(a.bounds) + 6);
    }
  });
});

describe('quatFromYawPitch', () => {
  it('is exactly quatFromYaw when there is no pitch', () => {
    for (const yaw of [0, 0.7, -2.2, 3]) expect(quatFromYawPitch(yaw, 0)).toEqual(quatFromYaw(yaw));
  });

  it('tilts a ramp so its +X end rises', () => {
    const q = quatFromYawPitch(0, 0.3);
    const along = quatRotate(q, { x: 1, y: 0, z: 0 });
    expect(along.y).toBeCloseTo(Math.sin(0.3), 3);
    expect(along.x).toBeCloseTo(Math.cos(0.3), 3);
  });

  it('applies the yaw about +Y after the pitch', () => {
    const q = quatFromYawPitch(Math.PI / 2, 0.3);
    const along = quatRotate(q, { x: 1, y: 0, z: 0 });
    expect(along.y).toBeCloseTo(Math.sin(0.3), 3);
    expect(along.z).toBeCloseTo(-Math.cos(0.3), 3);
  });

  it('uses the stadium radius constant for nothing any more', () => {
    expect(ARENA.RADIUS).toBe(45);
  });
});
