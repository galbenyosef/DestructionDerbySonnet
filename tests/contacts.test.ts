import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CAR } from '../src/shared/constants';
import { classifyZone } from '../src/shared/damage';
import { scriptedInput } from '../src/shared/determinism';
import { quatFromYaw } from '../src/shared/math';
import { initPhysics } from '../src/shared/physics';
import { Simulation, type Contact } from '../src/shared/sim';
import type { Quat } from '../src/shared/types';

beforeAll(async () => {
  await initPhysics();
});

const sims: Simulation[] = [];
afterEach(() => {
  while (sims.length) sims.pop()!.dispose();
});
function sim(slots: number[]): Simulation {
  const s = new Simulation(slots);
  sims.push(s);
  return s;
}

/** Puts a car at (x, z) facing `yaw` (0 = +X, PI = -X) and moving forward at `speed` m/s. */
function place(s: Simulation, slot: number, x: number, z: number, yaw: number, speed: number): void {
  s.setState(slot, {
    pos: { x, y: 1.07, z },
    quat: quatFromYaw(yaw),
    linvel: { x: Math.cos(yaw) * speed, y: 0, z: -Math.sin(yaw) * speed },
    angvel: { x: 0, y: 0, z: 0 },
  });
}

/** Steps until the first tick with a contact at least `min` N·s strong; returns the ticks stepped and every contact seen. */
function runUntilContact(s: Simulation, max: number, min = 1): { tick: number; contacts: Contact[] } {
  for (let t = 1; t <= max; t++) {
    s.step();
    const contacts = s.contacts(min);
    if (contacts.length > 0) return { tick: t, contacts };
  }
  return { tick: max, contacts: [] };
}

describe('Simulation.contacts', () => {
  it('reports nothing while cars drive on open ground', () => {
    const s = sim([0, 1]);
    place(s, 0, -10, -20, 0, 8);
    place(s, 1, -10, 20, 0, 8);
    for (let t = 0; t < 120; t++) {
      s.step();
      expect(s.contacts()).toEqual([]);
    }
  });

  it('measures a head-on collision as the momentum change of each car, on the front of both', () => {
    const s = sim([0, 1]);
    place(s, 0, -9, 0, 0, 10);
    place(s, 1, 9, 0, Math.PI, 10);
    const { contacts } = runUntilContact(s, 120);
    expect(contacts).toHaveLength(1); // a pair of cars is reported once
    const c = contacts[0]!;
    expect([c.a, c.b]).toEqual([0, 1]);
    // restitution 0.25: each car's velocity changes by 10 x 1.25 = 12.5 m/s, and 1500 kg x 12.5 = 18.75 kN·s
    expect(c.impulse).toBeGreaterThan(17_500);
    expect(c.impulse).toBeLessThan(20_500);
    expect(classifyZone(c.pointA)).toBe('front');
    expect(classifyZone(c.pointB)).toBe('front');
    expect(c.pointA.x).toBeGreaterThan(CAR.HALF.x - 0.2);
    expect(c.pointB.x).toBeGreaterThan(CAR.HALF.x - 0.2);
    expect(Math.abs(c.pointA.z)).toBeLessThan(0.3); // the corner contacts average out across the centre line
  });

  it('puts a T-bone on the side of the car that was hit and the front of the car that hit', () => {
    const s = sim([0, 1]);
    place(s, 0, -10, 0, 0, 10); // drives +X
    place(s, 1, 0, 0, Math.PI / 2, 0); // parked across its path, so it is hit on a long side
    const { contacts } = runUntilContact(s, 120);
    const c = contacts.find((k) => k.a === 0 && k.b === 1)!;
    expect(c).toBeDefined();
    expect(classifyZone(c.pointA)).toBe('front');
    expect(['left', 'right']).toContain(classifyZone(c.pointB));
    expect(Math.abs(c.pointB.z)).toBeGreaterThan(CAR.HALF.z - 0.15);
    expect(c.impulse).toBeGreaterThan(8_000);
  });

  it('reports a wall hit for the car alone (b = -1)', () => {
    const s = sim([0]);
    place(s, 0, 25, 0, 0, 15); // toward the wall ring at x = 45
    const { contacts } = runUntilContact(s, 200);
    expect(contacts).toHaveLength(1);
    const c = contacts[0]!;
    expect([c.a, c.b]).toEqual([0, -1]);
    expect(c.impulse).toBeGreaterThan(25_000); // 1500 kg x 15 m/s x ~1.3 = 29 kN·s
    expect(c.impulse).toBeLessThan(33_000);
    expect(classifyZone(c.pointA)).toBe('front');
    expect(c.pointB).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('merges the contacts with several walls into one entry, so a hit on the seam between two wall segments counts in full', () => {
    const theta = Math.PI / 32; // the seam between wall segment 0 and segment 1
    const s = sim([0]);
    s.setState(0, {
      pos: { x: 30 * Math.cos(theta), y: 1.07, z: 30 * Math.sin(theta) },
      quat: quatFromYaw(-theta),
      linvel: { x: 15 * Math.cos(theta), y: 0, z: 15 * Math.sin(theta) },
      angvel: { x: 0, y: 0, z: 0 },
    });
    let peak = 0;
    for (let t = 0; t < 150; t++) {
      s.step();
      const walls = s.contacts().filter((c) => c.b === -1);
      expect(walls.length).toBeLessThanOrEqual(1);
      for (const w of walls) peak = Math.max(peak, w.impulse);
    }
    expect(peak).toBeGreaterThan(25_000); // both segments' impulses are added up (one alone is about 12 kN·s)
  });

  it('honours the minimum impulse', () => {
    const s = sim([0, 1]);
    place(s, 0, -9, 0, 0, 10);
    place(s, 1, 9, 0, Math.PI, 10);
    const { tick } = runUntilContact(s, 120);
    const t = sim([0, 1]);
    place(t, 0, -9, 0, 0, 10);
    place(t, 1, 9, 0, Math.PI, 10);
    for (let i = 0; i < tick; i++) t.step();
    expect(t.contacts(1e9)).toEqual([]);
    expect(t.contacts(1)).toHaveLength(1);
  });

  it('does not report the ground, even for a car lying on its roof', () => {
    const s = sim([0]);
    const upsideDown: Quat = { x: 1, y: 0, z: 0, w: 0 }; // half a turn about the forward axis
    s.setState(0, { pos: { x: 0, y: 0.7, z: 0 }, quat: upsideDown, linvel: { x: 0, y: 0, z: 0 }, angvel: { x: 0, y: 0, z: 0 } });
    for (let t = 0; t < 120; t++) {
      s.step();
      expect(s.contacts()).toEqual([]);
    }
    expect(s.getState(0).pos.y).toBeLessThan(1.2); // it really did come to rest on the ground
  });

  it('lists contacts in a stable order and never changes the simulation', () => {
    const run = (readContacts: boolean): string[] => {
      const s = sim([0, 1, 2]);
      const trace: string[] = [];
      for (let t = 0; t < 600; t++) {
        for (const slot of s.slots) s.setInput(slot, scriptedInput(slot, t));
        s.step();
        if (readContacts) {
          const cs = s.contacts();
          for (let i = 1; i < cs.length; i++) expect(cs[i - 1]!.a * 8 + cs[i - 1]!.b + 1).toBeLessThan(cs[i]!.a * 8 + cs[i]!.b + 1);
        }
        const st = s.slots.map((slot) => s.getState(slot));
        trace.push(JSON.stringify(st));
      }
      return trace;
    };
    const plain = run(false);
    const observed = run(true);
    expect(observed).toEqual(plain); // bit-identical states every tick
  });
});
