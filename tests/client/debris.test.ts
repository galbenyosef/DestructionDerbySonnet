import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { DetachedPart } from '../../src/client/game/carView';
import { DEBRIS, DebrisSystem, stepDebris, type DebrisBody } from '../../src/client/game/debris';
import { mulberry32 } from '../../src/shared/random';

const body = (over: Partial<DebrisBody> = {}): DebrisBody => ({
  pos: { x: 0, y: 2, z: 0 },
  vel: { x: 3, y: 4, z: 0 },
  quat: { x: 0, y: 0, z: 0, w: 1 },
  spin: { x: 2, y: 5, z: -3 },
  half: { x: 0.65, y: 0.035, z: 0.9 },
  age: 0,
  ...over,
});
const part = (over: Partial<DetachedPart> = {}): DetachedPart => ({
  id: 'hood',
  position: { x: 5, y: 1.2, z: -3 },
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
  size: { x: 1.3, y: 0.07, z: 1.85 },
  color: 0xd84a2b,
  outward: { x: 0.3, y: 0.95, z: 0 },
  ...over,
});

describe('stepDebris', () => {
  it('rises, falls under gravity, bounces off the ground and settles on its thinnest side', () => {
    const d = body();
    let highest = 0;
    let bounced = false;
    for (let i = 0; i < 60 * 8; i++) {
      const before = d.vel.y;
      stepDebris(d, 1 / 60);
      highest = Math.max(highest, d.pos.y);
      if (before < -DEBRIS.MIN_BOUNCE && d.vel.y > 0) bounced = true;
      expect(d.pos.y).toBeGreaterThanOrEqual(0.035 - 1e-9);
    }
    expect(highest).toBeGreaterThan(2.5);
    expect(bounced).toBe(true);
    expect(d.pos.y).toBeCloseTo(0.035, 6);
    expect(Math.hypot(d.vel.x, d.vel.y, d.vel.z)).toBeLessThan(0.2); // slid to a stop
    expect(Math.hypot(d.spin.x, d.spin.y, d.spin.z)).toBeLessThan(0.5); // and stopped tumbling
  });

  it('keeps the rotation a unit quaternion however long it spins', () => {
    const d = body({ pos: { x: 0, y: 50, z: 0 }, vel: { x: 0, y: 0, z: 0 } });
    for (let i = 0; i < 600; i++) stepDebris(d, 1 / 60);
    expect(Math.hypot(d.quat.x, d.quat.y, d.quat.z, d.quat.w)).toBeCloseTo(1, 9);
  });
});

describe('DebrisSystem', () => {
  it('puts a part where it came off, with its size and colour, and sends it away from the car', () => {
    const system = new DebrisSystem(mulberry32(1));
    system.spawn(part(), { x: 10, y: 0, z: 0 });
    expect(system.active).toBe(1);
    const mesh = system.object.children.find((c) => c.visible) as THREE.Mesh;
    expect(mesh.position.toArray()).toEqual([5, 1.2, -3]);
    expect(mesh.scale.toArray()).toEqual([1.3, 0.07, 1.85]);
    expect((mesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xd84a2b);
    system.update(0.1);
    expect(mesh.position.x).toBeGreaterThan(5.5); // it kept the car's forward speed and was thrown outwards
    expect(mesh.position.y).toBeGreaterThan(1.2); // and up
    system.dispose();
  });

  it('shrinks a piece away and frees it at the end of its life', () => {
    const system = new DebrisSystem(mulberry32(2));
    system.spawn(part({ position: { x: 0, y: 0.1, z: 0 } }), { x: 0, y: 0, z: 0 });
    const mesh = system.object.children.find((c) => c.visible) as THREE.Mesh;
    for (let t = 0; t < DEBRIS.LIFE - 1 - 1e-9; t += 0.2) system.update(0.2);
    expect(mesh.scale.x).toBeCloseTo(0.65, 1); // fading: half way through the last two seconds
    for (let t = 0; t < 2; t += 0.2) system.update(0.2);
    expect(system.active).toBe(0);
    expect(mesh.visible).toBe(false);
    system.dispose();
  });

  it('reuses the oldest piece when more parts come off than there is room for', () => {
    const system = new DebrisSystem(mulberry32(3));
    for (let i = 0; i < DEBRIS.MAX; i++) {
      system.spawn(part({ position: { x: i, y: 5, z: 0 } }), { x: 0, y: 0, z: 0 });
      system.update(0.01);
    }
    expect(system.active).toBe(DEBRIS.MAX);
    system.spawn(part({ position: { x: 999, y: 5, z: 0 } }), { x: 0, y: 0, z: 0 });
    expect(system.active).toBe(DEBRIS.MAX);
    const xs = system.object.children.map((c) => c.position.x);
    expect(xs).toContain(999);
    expect(xs).not.toContain(0); // the first one was the oldest
    expect(system.object.children.length).toBe(DEBRIS.MAX); // never grows
    system.dispose();
  });

  it('keeps at most the number of pieces it is allowed, taking the oldest away when the limit drops', () => {
    const system = new DebrisSystem(mulberry32(5));
    for (let i = 0; i < 10; i++) {
      system.spawn(part({ position: { x: i, y: 5, z: 0 } }), { x: 0, y: 0, z: 0 });
      system.update(0.05);
    }
    expect(system.active).toBe(10);
    system.setLimit(4);
    expect(system.active).toBe(4);
    const xs = system.object.children.filter((c) => c.visible).map((c) => c.position.x);
    expect(xs.every((x) => x > 4)).toBe(true); // the four newest are left: the ones thrown last
    for (let i = 0; i < 6; i++) system.spawn(part({ position: { x: 100 + i, y: 5, z: 0 } }), { x: 0, y: 0, z: 0 });
    expect(system.active).toBe(4); // new parts replace the oldest instead of adding
    system.setLimit(0);
    system.spawn(part(), { x: 0, y: 0, z: 0 });
    expect(system.active).toBe(0);
    system.setLimit(Number.NaN);
    system.setLimit(1000);
    for (let i = 0; i < DEBRIS.MAX + 5; i++) system.spawn(part(), { x: 0, y: 0, z: 0 });
    expect(system.active).toBe(DEBRIS.MAX); // never more than the pool
    system.dispose();
  });

  it('survives absurd frame times and clears everything on request', () => {
    const system = new DebrisSystem(mulberry32(4));
    system.spawn(part(), { x: 0, y: 0, z: 0 });
    for (const dt of [0, -1, Number.NaN, 1e9]) system.update(dt);
    const mesh = system.object.children.find((c) => c.visible) as THREE.Mesh;
    expect(Number.isFinite(mesh.position.x + mesh.position.y + mesh.position.z)).toBe(true);
    system.clear();
    expect(system.active).toBe(0);
    system.dispose();
  });
});
