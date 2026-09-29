import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BOWL, OUTER_WALL, bowlHeight, createDressing, crowd, tyreStacks } from '../../src/client/game/dressing';

const radius = (p: { x: number; z: number }): number => Math.hypot(p.x, p.z);

describe('tyreStacks', () => {
  it('stands every stack outside the barrier, where nobody can drive into it', () => {
    const stacks = tyreStacks();
    expect(stacks).toHaveLength(30);
    for (const s of stacks) {
      expect(radius(s)).toBeGreaterThan(OUTER_WALL + 0.5);
      expect(radius(s)).toBeLessThan(OUTER_WALL + 2.5);
      expect(s.y).toBe(0);
    }
  });

  it('is the same every time for the same seed, and different for another', () => {
    expect(tyreStacks(30, 3)).toEqual(tyreStacks(30, 3));
    expect(tyreStacks(30, 3)).not.toEqual(tyreStacks(30, 4));
  });

  it('goes all the way round', () => {
    const angles = tyreStacks().map((s) => Math.atan2(s.z, s.x));
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(Math.PI * 1.8);
  });
});

describe('crowd', () => {
  it('sits on the bowl, between its inner and outer edge, and never in the arena', () => {
    const people = crowd();
    for (const p of people) {
      const r = radius(p);
      expect(r).toBeGreaterThan(BOWL.INNER);
      expect(r).toBeLessThan(BOWL.OUTER);
      expect(r).toBeGreaterThan(OUTER_WALL + 5);
      expect(p.y).toBeCloseTo(bowlHeight(r) + 0.62 * p.scale, 9);
    }
  });

  it('is a big crowd that is still cheap to draw, the same every time, with a few gaps', () => {
    const people = crowd();
    expect(people.length).toBeGreaterThan(500);
    expect(people.length).toBeLessThan(2500);
    expect(crowd(5)).toEqual(people);
    const rows = new Set(people.map((p) => Math.round(radius(p) * 10)));
    expect(rows.size).toBeGreaterThan(5);
  });

  it('gives every spectator a jersey colour from the palette', () => {
    for (const p of crowd()) {
      expect(Number.isInteger(p.tint)).toBe(true);
      expect(p.tint).toBeGreaterThanOrEqual(0);
      expect(p.tint).toBeLessThan(8);
    }
  });
});

describe('bowlHeight', () => {
  it('starts on the ground at the inner edge and rises to the full height at the outer edge', () => {
    expect(bowlHeight(BOWL.INNER)).toBe(0);
    expect(bowlHeight(BOWL.OUTER)).toBeCloseTo(BOWL.HEIGHT, 9);
    expect(bowlHeight((BOWL.INNER + BOWL.OUTER) / 2)).toBeCloseTo(BOWL.HEIGHT / 2, 9);
  });
});

describe('createDressing', () => {
  it('builds the stands, the crowd and the tyres as three draw calls, and releases them when disposed', () => {
    const dressing = createDressing();
    const meshes = dressing.group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    expect(meshes).toHaveLength(3); // the bowl, and two instanced meshes
    const instanced = meshes.filter((m): m is THREE.InstancedMesh => m instanceof THREE.InstancedMesh);
    expect(instanced.map((m) => m.count).sort((a, b) => a - b)).toEqual([tyreStacks().length * 3, crowd().length]);
    let disposed = 0;
    for (const m of meshes) {
      m.geometry.addEventListener('dispose', () => disposed++);
      (m.material as THREE.Material).addEventListener('dispose', () => disposed++);
    }
    dressing.dispose();
    expect(disposed).toBe(6);
  });
});
