import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CarView, REST_SUSPENSION, WRECK_COLOR } from '../../src/client/game/carView';
import { dentFromHit } from '../../src/client/game/dents';
import { CAR } from '../../src/shared/constants';
import { fakeCarModel } from '../helpers/carModel';

const hit = (over: Partial<Parameters<typeof dentFromHit>[0]> = {}) => dentFromHit({ tick: 90, victim: 1, attacker: 2, dmg: 14, p: [2.3, 0, 0], ...over });
const mesh = (view: CarView, name: string): THREE.Mesh => view.group.getObjectByName(name) as THREE.Mesh;
const positions = (m: THREE.Mesh): number[] => Array.from(m.geometry.getAttribute('position').array as Float32Array);
const paintOf = (view: CarView, name = 'body'): THREE.MeshStandardMaterial => mesh(view, name).material as THREE.MeshStandardMaterial;
/** The ground sits this far below the middle of the chassis when the springs are at rest. */
const GROUND_Y = CAR.WHEEL.HARD_Y - REST_SUSPENSION - CAR.WHEEL.RADIUS;

describe('CarView with a Blender model', () => {
  it('draws the model instead of its own boxes, with the ground of the model at the ground of the car', () => {
    const view = new CarView(0xd84a2b, 'coupe');
    expect(view.car).toBe('coupe');
    expect(view.usesModel).toBe(false);
    const boxes = view.group.children.length;
    view.useModel(fakeCarModel());
    expect(view.usesModel).toBe(true);
    expect(mesh(view, 'body')).toBeDefined();
    expect(mesh(view, 'body').parent!.position.y).toBeCloseTo(GROUND_Y, 6);
    expect(view.group.children.length).toBeLessThan(boxes); // the crumpling boxes are gone (the wheel pivots stay)
    view.dispose();
  });

  it('tints the paint with the player\'s colour, one paint per car, and shares everything else', () => {
    const model = fakeCarModel();
    const a = new CarView(0xd84a2b);
    const b = new CarView(0x2b7fd8);
    a.useModel(model);
    b.useModel(model);
    expect(paintOf(a).color.getHex()).toBe(0xd84a2b);
    expect(paintOf(b).color.getHex()).toBe(0x2b7fd8);
    expect(paintOf(a, 'hood')).toBe(paintOf(a)); // every panel of one car shares its paint
    expect(paintOf(a)).not.toBe(paintOf(b));
    expect(paintOf(a, 'bumper_F')).toBe(paintOf(b, 'bumper_F')); // the chrome is the same material for all
    expect((model.getObjectByName('body') as THREE.Mesh).material).not.toBe(paintOf(a)); // and the loaded model is not painted
    a.dispose();
    b.dispose();
  });

  it('follows setColor and the wreck look through the paint', () => {
    const view = new CarView(0x112233);
    view.useModel(fakeCarModel());
    view.setColor(0x445566);
    expect(paintOf(view).color.getHex()).toBe(0x445566);
    view.setWreck(true);
    expect(paintOf(view).color.getHex()).toBe(WRECK_COLOR);
    view.setColor(0x778899);
    expect(paintOf(view).color.getHex()).toBe(WRECK_COLOR);
    view.setWreck(false);
    expect(paintOf(view).color.getHex()).toBe(0x778899);
    view.dispose();
  });

  it('turns the glass\'s transmission off (it would cost the renderer a whole extra pass) and keeps it see-through', () => {
    const view = new CarView(0xd84a2b);
    view.useModel(fakeCarModel());
    const glass = mesh(view, 'glass').material as THREE.MeshPhysicalMaterial;
    expect(glass.transmission).toBe(0);
    expect(glass.transparent).toBe(true);
    expect(glass.opacity).toBeLessThan(1);
    view.dispose();
  });

  it('puts the wheels on the physics wheels: they steer and spin where the boxes\' wheels did', () => {
    const view = new CarView(0xd84a2b);
    view.useModel(fakeCarModel());
    const wheel = mesh(view, 'wheel_FR');
    expect(wheel.position.toArray()).toEqual([0, 0, 0]); // the node sits at the centre of its spinner, not where the file put it
    const wheels = [0, 1, 2, 3].map((i) => ({ suspensionLength: 0.3 + i * 0.01, rotation: 1.5, steering: 0.2, contact: true, steer: 0, suspensionForce: 0 }));
    view.setWheels(wheels as never);
    const spinner = wheel.parent!;
    const pivot = spinner.parent!;
    expect(Math.abs(spinner.rotation.z)).toBeCloseTo(1.5, 6);
    expect(pivot.rotation.y).toBeCloseTo(0.2, 6); // a front wheel steers
    expect(pivot.position.x).toBeCloseTo(CAR.WHEEL.X, 6);
    expect((mesh(view, 'wheel_RR').parent!.parent as THREE.Object3D).rotation.y).toBe(0); // a rear wheel does not
    view.dispose();
  });

  it('dents the bodywork where it was hit and the neighbouring panels with it, and leaves wheels, decals and interior alone', () => {
    const view = new CarView(0xd84a2b);
    view.useModel(fakeCarModel());
    const before = Object.fromEntries(['body', 'hood', 'bumper_F', 'wheel_FR', 'number_L', 'interior_1'].map((n) => [n, positions(mesh(view, n))]));
    view.dent(hit());
    for (const n of ['body', 'hood', 'bumper_F']) expect(positions(mesh(view, n)), n).not.toEqual(before[n]);
    for (const n of ['wheel_FR', 'number_L', 'interior_1']) expect(positions(mesh(view, n)), n).toEqual(before[n]);
    view.restore();
    expect(positions(mesh(view, 'body'))).toEqual(before.body);
    view.dispose();
  });

  it('keeps the dents of one car to itself although they came from one model', () => {
    const model = fakeCarModel();
    const a = new CarView(0xd84a2b);
    const b = new CarView(0x2b7fd8);
    a.useModel(model);
    b.useModel(model);
    const untouched = positions(mesh(b, 'body'));
    a.dent(hit());
    expect(positions(mesh(b, 'body'))).toEqual(untouched);
    expect(positions(model.getObjectByName('body') as THREE.Mesh)).toEqual(untouched);
    a.dispose();
    b.dispose();
  });

  it('shades the bent surface again, so a dent catches the light', () => {
    const view = new CarView(0xd84a2b);
    view.useModel(fakeCarModel());
    const normals = (): number[] => Array.from(mesh(view, 'hood').geometry.getAttribute('normal').array as Float32Array);
    const flat = normals();
    view.dent(hit({ dmg: 30, p: [1.5, 0.8, 0] }));
    expect(normals()).not.toEqual(flat);
    view.dispose();
  });

  it('takes a part off the car by name: its pieces vanish, and the caller is told its place, size and colour', () => {
    const view = new CarView(0xd84a2b);
    view.useModel(fakeCarModel());
    expect(view.hasPart('bumperFront')).toBe(true);
    const part = view.detach('bumperFront')!;
    expect(view.hasPart('bumperFront')).toBe(false);
    expect(mesh(view, 'bumper_F').visible).toBe(false);
    expect(mesh(view, 'bumper_F_rubber').visible).toBe(false);
    expect(mesh(view, 'bumper_R').visible).toBe(true);
    expect(part.id).toBe('bumperFront');
    expect(part.size.z).toBeGreaterThan(1.8);
    expect(part.position.x).toBeGreaterThan(2.0);
    expect(part.position.y).toBeCloseTo(GROUND_Y + 0.45, 1);
    expect(part.outward.x).toBeGreaterThan(0.9);
    expect(view.detach('bumperFront')).toBeNull();
    const hood = view.detach('hood')!;
    expect(hood.color).toBe(0xd84a2b); // a painted part flies off in the player's paint
    view.restore();
    expect(view.hasPart('bumperFront')).toBe(true);
    expect(mesh(view, 'bumper_F_rubber').visible).toBe(true);
    view.dispose();
  });

  it('copes with a car that has no trunk lid', () => {
    const view = new CarView(0xd84a2b);
    view.useModel(fakeCarModel({ trunk: false }));
    expect(view.hasPart('trunk')).toBe(false);
    expect(view.detach('trunk')).toBeNull();
    expect(view.detach('hood')).not.toBeNull();
    view.dispose();
  });

  it('puts the damage back on the model when it arrives after the car was hurt', () => {
    const view = new CarView(0xd84a2b);
    view.dent(hit());
    view.detach('hood');
    view.useModel(fakeCarModel());
    expect(mesh(view, 'hood').visible).toBe(false);
    const fresh = new CarView(0xd84a2b);
    fresh.useModel(fakeCarModel());
    expect(positions(mesh(view, 'body'))).not.toEqual(positions(mesh(fresh, 'body')));
    view.restore();
    expect(positions(mesh(view, 'body'))).toEqual(positions(mesh(fresh, 'body')));
    view.dispose();
    fresh.dispose();
  });

  it('can be told to draw less: the interior, decals and small trim go, the car does not', () => {
    const view = new CarView(0xd84a2b);
    view.useModel(fakeCarModel());
    view.setDetail(false);
    const interior = view.group.getObjectByName('interior')!;
    const pieces: THREE.Mesh[] = [];
    interior.traverse((o) => o instanceof THREE.Mesh && pieces.push(o));
    expect(pieces.map((p) => p.name)).toEqual(['interior', 'interior_1', 'interior_2']); // the real one is three pieces
    expect(pieces.map((p) => p.visible)).toEqual([false, false, false]);
    expect([mesh(view, 'number_L').visible, mesh(view, 'roundel_L').visible]).toEqual([false, false]);
    expect([mesh(view, 'body').visible, mesh(view, 'glass').visible, mesh(view, 'wheel_FR').visible]).toEqual([true, true, true]);
    view.setDetail(true);
    expect(pieces.map((p) => p.visible)).toEqual([true, true, true]);
    const later = new CarView(0xd84a2b);
    later.setDetail(false); // decided before the model came
    later.useModel(fakeCarModel());
    expect(mesh(later, 'interior_1').visible).toBe(false);
    expect(mesh(later, 'interior_2').visible).toBe(false);
    view.dispose();
    later.dispose();
  });

  it('frees what it made (its own geometry and paint) and nothing it shares', () => {
    const model = fakeCarModel();
    const shared = { geometry: 0, material: 0 };
    for (const name of ['wheel_FR', 'bumper_F', 'body']) {
      const m = model.getObjectByName(name) as THREE.Mesh;
      m.geometry.addEventListener('dispose', () => shared.geometry++);
      (m.material as THREE.Material).addEventListener('dispose', () => shared.material++);
    }
    const view = new CarView(0xd84a2b);
    view.useModel(model);
    let own = 0;
    const body = mesh(view, 'body');
    body.geometry.addEventListener('dispose', () => own++);
    (body.material as THREE.Material).addEventListener('dispose', () => own++);
    view.dispose();
    expect(own).toBe(2);
    expect(shared).toEqual({ geometry: 0, material: 0 });
  });

  it('holds one model at a time when it is given another', () => {
    const view = new CarView(0xd84a2b);
    view.useModel(fakeCarModel());
    view.useModel(fakeCarModel({ trunk: false }));
    expect(view.group.getObjectsByProperty('name', 'body')).toHaveLength(1);
    expect(view.hasPart('trunk')).toBe(false);
    view.dispose();
  });
});
