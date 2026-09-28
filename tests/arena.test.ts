import { beforeAll, describe, expect, it } from 'vitest';
import { ARENA, CAR, CAR_FORWARD } from '../src/shared/constants';
import { buildArena, obstacleBoxes, spawnPose, wallSegments } from '../src/shared/arena';
import { quatFromYaw, quatRotate, vdot } from '../src/shared/math';
import { RAPIER, initPhysics } from '../src/shared/physics';

beforeAll(async () => {
  await initPhysics();
});

describe('spawnPose', () => {
  it('places cars on a circle facing the centre', () => {
    for (let i = 0; i < 8; i++) {
      const p = spawnPose(i, 8);
      expect(Math.hypot(p.pos.x, p.pos.z)).toBeCloseTo(ARENA.SPAWN_RADIUS, 2);
      expect(p.pos.y).toBe(CAR.SPAWN_HEIGHT);
      const forward = quatRotate(p.quat, CAR_FORWARD);
      const inward = { x: -p.pos.x / ARENA.SPAWN_RADIUS, y: 0, z: -p.pos.z / ARENA.SPAWN_RADIUS };
      expect(vdot(forward, inward)).toBeCloseTo(1, 2);
    }
  });

  it('spaces cars evenly', () => {
    const chord = 2 * ARENA.SPAWN_RADIUS * Math.sin(Math.PI / 8);
    for (let i = 0; i < 8; i++) {
      const a = spawnPose(i, 8).pos;
      const b = spawnPose((i + 1) % 8, 8).pos;
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeCloseTo(chord, 1);
    }
  });

  it('is deterministic', () => {
    expect(spawnPose(3, 8)).toEqual(spawnPose(3, 8));
  });

  it('keeps every spawn clear of the walls and obstacles', () => {
    for (let i = 0; i < 8; i++) {
      const p = spawnPose(i, 8).pos;
      expect(Math.hypot(p.x, p.z)).toBeLessThan(ARENA.RADIUS - 5);
      for (const o of obstacleBoxes()) expect(Math.hypot(p.x - o.x, p.z - o.z)).toBeGreaterThan(8);
    }
  });
});

describe('arena geometry specs', () => {
  it('builds a closed ring of wall segments at the arena radius', () => {
    const segments = wallSegments();
    expect(segments).toHaveLength(ARENA.WALL_SEGMENTS);
    for (const s of segments) {
      const r = Math.hypot(s.x, s.z);
      expect(r).toBeCloseTo(ARENA.RADIUS + ARENA.WALL_HALF_THICKNESS, 2);
      // the long local axis must be tangent to the ring, i.e. perpendicular to the radial direction
      const axis = quatRotate(quatFromYaw(s.yaw), { x: 1, y: 0, z: 0 });
      const radial = { x: s.x / r, y: 0, z: s.z / r };
      expect(Math.abs(vdot(axis, radial))).toBeLessThan(1e-3);
    }
  });

  it('overlaps adjacent segments so there are no gaps', () => {
    const chord = 2 * (ARENA.RADIUS + ARENA.WALL_HALF_THICKNESS) * Math.sin(Math.PI / ARENA.WALL_SEGMENTS);
    expect(wallSegments()[0]!.hx * 2).toBeGreaterThan(chord);
  });

  it('offsets obstacles from the spawn lines by 22.5 degrees', () => {
    for (const o of obstacleBoxes()) {
      const deg = (Math.atan2(o.z, o.x) * 180) / Math.PI;
      const mod = ((deg % 45) + 45) % 45;
      expect(mod).toBeCloseTo(22.5, 0);
    }
  });
});

describe('buildArena physics', () => {
  function makeWorld(options?: Parameters<typeof buildArena>[1]): RAPIER.World {
    const w = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    w.timestep = 1 / 60;
    buildArena(w, options);
    return w;
  }

  it('creates ground, walls and obstacles', () => {
    const w = makeWorld();
    expect(w.colliders.len()).toBe(1 + ARENA.WALL_SEGMENTS + ARENA.OBSTACLE_COUNT);
    w.free();
  });

  it('creates only the ground when walls are disabled', () => {
    const w = makeWorld({ walls: false });
    expect(w.colliders.len()).toBe(1);
    w.free();
  });

  it('supports a ball resting on the ground', () => {
    const w = makeWorld();
    const b = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 3, 0));
    w.createCollider(RAPIER.ColliderDesc.ball(0.5), b);
    for (let i = 0; i < 240; i++) w.step();
    expect(b.translation().y).toBeGreaterThan(0.45);
    expect(b.translation().y).toBeLessThan(0.55);
    w.free();
  });

  it('keeps fast objects inside the wall ring', () => {
    const w = makeWorld();
    const balls: RAPIER.RigidBody[] = [];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const b = w.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(Math.cos(a) * 1.5, 0.6, Math.sin(a) * 1.5)
          .setLinvel(Math.cos(a) * 40, 0, Math.sin(a) * 40)
          .setCcdEnabled(true),
      );
      w.createCollider(RAPIER.ColliderDesc.ball(0.5).setRestitution(0.3), b);
      balls.push(b);
    }
    for (let i = 0; i < 600; i++) w.step();
    for (const b of balls) {
      const t = b.translation();
      expect(Math.hypot(t.x, t.z)).toBeLessThan(ARENA.RADIUS);
      expect(t.y).toBeLessThan(3);
    }
    w.free();
  });
});
