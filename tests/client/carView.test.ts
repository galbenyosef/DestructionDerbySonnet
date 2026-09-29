import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PART_RULES } from '../../src/client/game/carDamage';
import { CarView, WRECK_COLOR } from '../../src/client/game/carView';
import { dentFromHit } from '../../src/client/game/dents';
import { quatFromYaw } from '../../src/shared/math';

const bodyColor = (view: CarView): number => {
  const material = (view as unknown as { bodyMaterial: { color: { getHex(): number } } }).bodyMaterial;
  return material.color.getHex();
};

describe('CarView wreck look', () => {
  it('chars the body of a wreck and restores the paint for the next round', () => {
    const view = new CarView(0xd84a2b);
    expect(bodyColor(view)).toBe(0xd84a2b);
    view.setWreck(true);
    expect(bodyColor(view)).toBe(WRECK_COLOR);
    view.setWreck(true); // idempotent
    expect(bodyColor(view)).toBe(WRECK_COLOR);
    view.setWreck(false);
    expect(bodyColor(view)).toBe(0xd84a2b);
    view.dispose();
  });

  it('remembers a colour change made while the car is a wreck', () => {
    const view = new CarView(0x112233);
    view.setWreck(true);
    view.setColor(0x445566);
    expect(bodyColor(view)).toBe(WRECK_COLOR);
    view.setWreck(false);
    expect(bodyColor(view)).toBe(0x445566);
    view.dispose();
  });
});

const hit = (over: Partial<Parameters<typeof dentFromHit>[0]> = {}) => dentFromHit({ tick: 90, victim: 1, attacker: 2, dmg: 12, p: [2.3, -0.3, 0], ...over });
/** Every vertex of every mesh of the car, in the order the meshes were added. */
const shape = (view: CarView): number[] =>
  view.group.children.flatMap((c) => (c instanceof THREE.Mesh ? Array.from(c.geometry.getAttribute('position').array as Float32Array) : []));
const size = (view: CarView): THREE.Vector3 => new THREE.Box3().setFromObject(view.group).getSize(new THREE.Vector3());

describe('CarView damage', () => {
  it('crumples where it was hit and nowhere else', () => {
    const view = new CarView(0xd84a2b);
    const meshAt = (x: number, y: number): THREE.Mesh =>
      view.group.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh && Math.abs(c.position.x - x) < 1e-6 && Math.abs(c.position.y - y) < 1e-6)!;
    const verts = (m: THREE.Mesh): number[] => Array.from(m.geometry.getAttribute('position').array as Float32Array);
    const front = meshAt(2.3, -0.32);
    const hood = meshAt(1.5, 0.185);
    const rear = meshAt(-2.3, -0.32);
    const trunk = meshAt(-1.75, 0.185);
    const was = new Map([front, hood, rear, trunk].map((m) => [m, verts(m)] as const));
    const whole = shape(view);
    view.dent(hit());
    expect(shape(view)).not.toEqual(whole);
    expect(verts(front)).not.toEqual(was.get(front));
    expect(verts(hood)).not.toEqual(was.get(hood));
    expect(verts(rear)).toEqual(was.get(rear));
    expect(verts(trunk)).toEqual(was.get(trunk));
    view.dispose();
  });

  it('never grows a badly hit car by more than the limit on each side', () => {
    const view = new CarView(0xd84a2b);
    const fresh = size(view);
    for (let i = 0; i < 60; i++) view.dent(hit({ tick: i, dmg: 25, p: [i % 2 ? 2.3 : -2.3, -0.2, (i % 5) * 0.4 - 0.8] }));
    const worn = size(view);
    for (const axis of ['x', 'y', 'z'] as const) expect(worn[axis]).toBeLessThan(fresh[axis] + 1.0);
    view.dispose();
  });

  it('takes a part off once, says where it was in the world, and puts everything back for the next round', () => {
    const view = new CarView(0x112233);
    view.setPose({ x: 10, y: 1, z: 5 }, quatFromYaw(Math.PI / 2)); // forward is now -Z
    const fresh = shape(new CarView(0x112233));
    view.dent(hit());
    const hood = view.detach('hood')!;
    expect(view.hasPart('hood')).toBe(false);
    expect(hood.position.x).toBeCloseTo(10, 5);
    expect(hood.position.y).toBeCloseTo(1.185, 5);
    expect(hood.position.z).toBeCloseTo(3.5, 5); // 1.5 m ahead of the middle of the car
    expect(hood.size).toEqual({ x: 1.3, y: 0.07, z: 1.85 });
    expect(hood.color).toBe(0x112233);
    expect(Math.hypot(hood.outward.x, hood.outward.y, hood.outward.z)).toBeCloseTo(1, 9);
    expect(hood.outward.y).toBeGreaterThan(0.9); // a hood flies up
    expect(view.detach('hood')).toBeNull();
    expect(view.detach('bumperFront')!.color).toBe(0x23262d); // bumpers are dark trim, whatever the paint
    view.restore();
    expect(view.hasPart('hood')).toBe(true);
    expect(view.hasPart('bumperFront')).toBe(true);
    expect(shape(view).map((v, i) => Math.abs(v - fresh[i]!))).toEqual(fresh.map(() => 0));
    view.dispose();
  });

  it('has a part for every part the damage rules can take off', () => {
    const view = new CarView(0xd84a2b);
    for (const rule of PART_RULES) expect(view.hasPart(rule.id)).toBe(true);
    view.dispose();
  });

  it('gives a part the charred colour when the car is a wreck', () => {
    const view = new CarView(0xd84a2b);
    view.setWreck(true);
    expect(view.detach('trunk')!.color).toBe(WRECK_COLOR);
    view.dispose();
  });
});
