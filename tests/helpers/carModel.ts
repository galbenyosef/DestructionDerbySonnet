import * as THREE from 'three';
import { CAR } from '../../src/shared/constants';

export interface FakeCarOptions {
  /** The wagon and the pickup have no trunk lid. */
  trunk?: boolean;
}

/**
 * A stand-in for a loaded car model with the structure the real ones have (the nodes the game finds by name, the vertices already in
 * the model's own coordinates with its origin on the ground, the wheels as nodes at their centres, one `paint*` material, a glass that
 * asks for transmission), so `CarView.useModel` is tested without a file.
 */
export function fakeCarModel(options: FakeCarOptions = {}): THREE.Group {
  const root = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ name: 'paint.001', color: 0xc08020 });
  const black = new THREE.MeshStandardMaterial({ name: 'black', color: 0x111111 });
  const chrome = new THREE.MeshStandardMaterial({ name: 'chrome', color: 0xcccccc });
  const glass = new THREE.MeshPhysicalMaterial({ name: 'glass', color: 0x223344, transmission: 0.9 });
  const part = (name: string, m: THREE.Material, size: [number, number, number], at: [number, number, number], seg: [number, number, number] = [6, 2, 4]): THREE.Mesh => {
    const g = new THREE.BoxGeometry(size[0], size[1], size[2], seg[0], seg[1], seg[2]);
    g.translate(at[0], at[1], at[2]); // the vertices carry the position, as in an exported model
    const mesh = new THREE.Mesh(g, m);
    mesh.name = name;
    root.add(mesh);
    return mesh;
  };
  part('body', paint, [4.5, 0.6, 1.95], [0, 0.55, 0], [18, 3, 8]);
  part('hood', paint, [1.3, 0.07, 1.85], [1.5, 0.87, 0]);
  if (options.trunk !== false) part('trunk', paint, [1.0, 0.07, 1.85], [-1.75, 0.87, 0]);
  part('door_L', paint, [1.3, 0.5, 0.05], [0.05, 0.7, -1.0], [6, 3, 1]);
  part('door_R', paint, [1.3, 0.5, 0.05], [0.05, 0.7, 1.0], [6, 3, 1]);
  part('bumper_F', chrome, [0.25, 0.32, 2.0], [2.3, 0.45, 0], [1, 2, 8]);
  part('bumper_F_rubber', black, [0.05, 0.1, 1.9], [2.43, 0.4, 0], [1, 1, 4]);
  part('bumper_R', chrome, [0.25, 0.32, 2.0], [-2.3, 0.45, 0], [1, 2, 8]);
  part('bumper_R_rubber', black, [0.05, 0.1, 1.9], [-2.43, 0.4, 0], [1, 1, 4]);
  part('glass', glass, [2.4, 0.5, 1.7], [-0.25, 1.1, 0], [6, 1, 4]);
  part('headlamps', black, [0.06, 0.16, 1.4], [2.3, 0.75, 0], [1, 1, 2]);
  part('interior', black, [2.0, 0.3, 1.5], [-0.2, 0.7, 0], [2, 1, 2]);
  part('roundel_L', black, [0.3, 0.3, 0.02], [0.3, 0.7, -1.03], [1, 1, 1]);
  const decal = part('number_L', black, [0.3, 0.3, 0.02], [0, 0, 0], [1, 1, 1]); // a decal: positioned by its node, turned a little
  decal.position.set(0.27, 0.62, -1.07);
  decal.rotation.y = 0.1;
  for (const [name, sx, sz] of [['wheel_FR', 1, 1], ['wheel_FL', 1, -1], ['wheel_RR', -1, 1], ['wheel_RL', -1, -1]] as const) {
    const wheel = part(name, black, [0.8, 0.8, 0.35], [0, 0, 0], [2, 2, 1]);
    wheel.position.set(sx * CAR.WHEEL.X, CAR.WHEEL.RADIUS, sz * CAR.WHEEL.Z);
  }
  return root;
}
