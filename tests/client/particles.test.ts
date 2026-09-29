import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ParticleRing, ParticleSystem, type Emission } from '../../src/client/game/particles';

const spark = (over: Partial<Emission> = {}): Emission => ({ x: 1, y: 2, z: 3, vx: 4, vy: 5, vz: 6, life: 0.5, size: 0.2, seed: 0.25, ...over });

describe('ParticleRing', () => {
  it('writes a particle at the head and moves the head on', () => {
    const ring = new ParticleRing(8);
    expect(ring.emit(spark(), 10)).toBe(0);
    expect(ring.emit(spark({ x: 9 }), 10.1)).toBe(1);
    expect(Array.from(ring.origin.slice(0, 6))).toEqual([1, 2, 3, 9, 2, 3]);
    expect(Array.from(ring.velocity.slice(0, 3))).toEqual([4, 5, 6]);
    expect([ring.birth[0], ring.life[0], ring.size[0], ring.seed[0]]).toEqual([10, 0.5, expect.closeTo(0.2, 6), 0.25]);
    expect(ring.head).toBe(2);
  });

  it('overwrites the oldest particle when it is full, and never grows', () => {
    const ring = new ParticleRing(4);
    for (let i = 0; i < 6; i++) ring.emit(spark({ x: i }), i);
    expect(ring.head).toBe(2);
    expect(Array.from(ring.origin).filter((_, k) => k % 3 === 0)).toEqual([4, 5, 2, 3]); // 0 and 1 were overwritten by 4 and 5
    expect(ring.origin.length).toBe(12);
  });

  it('counts a particle as alive at the very moment it is born, whatever the rounding of times to 32 bits does', () => {
    const ring = new ParticleRing(8);
    for (const now of [100.016666, 12345.678901, 0.1, 3600.0000001]) {
      ring.emit(spark({ life: 1 }), now);
      expect(ring.aliveAt(now)).toBeGreaterThan(0);
      ring.birth.fill(-1e9);
    }
  });

  it('counts the particles that are alive: born already, not yet dead', () => {
    const ring = new ParticleRing(8);
    ring.emit(spark({ life: 1 }), 10);
    ring.emit(spark({ life: 3 }), 10);
    expect(ring.aliveAt(9.9)).toBe(0); // not born yet
    expect(ring.aliveAt(10.5)).toBe(2);
    expect(ring.aliveAt(11.5)).toBe(1);
    expect(ring.aliveAt(13.5)).toBe(0);
  });

  it('refuses particles with broken numbers, and limits how long and how big one can be', () => {
    const ring = new ParticleRing(4);
    for (const bad of [{ x: Number.NaN }, { vy: Number.POSITIVE_INFINITY }, { life: 0 }, { life: -1 }, { size: 0 }, { size: Number.NaN }]) {
      expect(ring.emit(spark(bad), 1)).toBe(-1);
    }
    expect(ring.emit(spark(), Number.NaN)).toBe(-1);
    expect(ring.head).toBe(0);
    ring.emit(spark({ life: 999, size: 999 }), 1);
    expect(ring.life[0]).toBeLessThanOrEqual(10);
    expect(ring.size[0]).toBeLessThanOrEqual(20);
  });

  it('reports what changed since the last upload, wrapping at the end of the ring', () => {
    const ring = new ParticleRing(8);
    expect(ring.dirty()).toBeNull();
    for (let i = 0; i < 3; i++) ring.emit(spark(), i);
    expect(ring.dirty()).toEqual({ from: 0, count: 3, wrapped: false });
    ring.clearDirty();
    expect(ring.dirty()).toBeNull();
    for (let i = 0; i < 4; i++) ring.emit(spark(), i); // slots 3..6
    ring.clearDirty();
    for (let i = 0; i < 3; i++) ring.emit(spark(), i); // slots 7, 0, 1
    expect(ring.dirty()).toEqual({ from: 7, count: 3, wrapped: true });
    ring.clearDirty();
    for (let i = 0; i < 20; i++) ring.emit(spark(), i); // more than the ring holds: everything
    expect(ring.dirty()!.count).toBe(8);
  });
});

describe('ParticleSystem', () => {
  it('has a pool for each kind, animates them through one clock uniform, and counts what is alive', () => {
    const system = new ParticleSystem();
    expect(system.object.children).toHaveLength(4);
    system.update(5, 600);
    system.emit('spark', spark({ life: 1 }));
    system.emit('smoke', spark({ life: 2 }));
    expect([system.alive('spark'), system.alive('smoke'), system.alive('fire'), system.alive('dust')]).toEqual([1, 1, 0, 0]);
    system.update(5.5, 600);
    const material = (system.object.children[0] as THREE.Points).material as THREE.ShaderMaterial;
    expect(material.uniforms.uTime!.value).toBe(5.5);
    expect(material.uniforms.uScale!.value).toBe(600);
    system.update(9, 600);
    expect([system.alive('spark'), system.alive('smoke')]).toEqual([0, 0]);
    system.dispose();
  });

  it('uploads only the slots that were written, and wraps around the end of the ring', () => {
    const system = new ParticleSystem();
    system.update(0, 500);
    const points = system.object.children[0] as THREE.Points; // the sparks
    const birth = points.geometry.getAttribute('aBirth') as THREE.BufferAttribute;
    for (let i = 0; i < 5; i++) system.emit('spark', spark());
    system.update(0.1, 500);
    expect(birth.updateRanges).toEqual([{ start: 0, count: 5 }]);
    for (let i = 0; i < 1024 - 5 - 2; i++) system.emit('spark', spark()); // slots 5..1021: the head ends up at 1022
    system.update(0.2, 500);
    expect(birth.updateRanges).toEqual([{ start: 5, count: 1017 }]);
    for (let i = 0; i < 4; i++) system.emit('spark', spark()); // slots 1022, 1023, 0, 1: past the end of the ring
    system.update(0.3, 500);
    expect(birth.updateRanges).toEqual([{ start: 1022, count: 2 }, { start: 0, count: 2 }]);
    system.dispose();
  });

  it('forgets every particle on clear, and adds no cost to a scene with nothing emitted', () => {
    const system = new ParticleSystem();
    system.update(1, 500);
    for (const kind of ['spark', 'fire', 'smoke', 'dust'] as const) system.emit(kind, spark({ life: 5 }));
    system.clear();
    expect(['spark', 'fire', 'smoke', 'dust'].map((k) => system.alive(k as 'spark'))).toEqual([0, 0, 0, 0]);
    system.dispose();
  });

  it('releases its GPU resources when disposed', () => {
    const system = new ParticleSystem();
    let disposed = 0;
    for (const child of system.object.children) {
      const points = child as THREE.Points;
      points.geometry.addEventListener('dispose', () => disposed++);
      (points.material as THREE.ShaderMaterial).addEventListener('dispose', () => disposed++);
    }
    system.dispose();
    expect(disposed).toBe(8);
  });
});
