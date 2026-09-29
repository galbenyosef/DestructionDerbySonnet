import * as THREE from 'three';
import { CAR } from '../../shared/constants';
import type { Quat, Vec3, WheelPose } from '../../shared/types';
import { wheelLocalPosition } from '../../shared/vehicle';
import type { PartId } from './carDamage';
import { DentSurface, type Dent } from './dents';

/**
 * Rapier's wheel rotation increases while rolling forward (asserted in tests/vehicle.test.ts). A wheel rolling
 * toward +X with its axle along +Z spins about -Z, hence -1. If the wheels turn the wrong way in the sandbox
 * (or the Task 4 rotation test had to be flipped), change this constant.
 */
export const WHEEL_SPIN_SIGN = -1;
const REST_SUSPENSION = 0.374; // measured settled suspension length
/** Body colour of a car that is out of the round. */
export const WRECK_COLOR = 0x2a2b2e;

/** A part that has just come off a car: where it was in the world, how big, what colour, and which way it should fly. */
export interface DetachedPart {
  id: PartId;
  position: Vec3;
  quaternion: Quat;
  size: Vec3;
  color: number;
  /** Unit vector pointing away from the middle of the car, in the world. */
  outward: Vec3;
}

/** Where each detachable part sits (car frame), its size and subdivision, and which way it flies off (car frame). */
const PART_SPECS: Record<PartId, { size: [number, number, number]; segments: [number, number, number]; at: [number, number, number]; outward: [number, number, number]; trim: boolean }> = {
  bumperFront: { size: [0.25, 0.32, 2.0], segments: [1, 2, 8], at: [2.3, -0.32, 0], outward: [1, 0.1, 0], trim: true },
  bumperRear: { size: [0.25, 0.32, 2.0], segments: [1, 2, 8], at: [-2.3, -0.32, 0], outward: [-1, 0.1, 0], trim: true },
  hood: { size: [1.3, 0.07, 1.85], segments: [6, 1, 8], at: [1.5, 0.185, 0], outward: [0.35, 1, 0], trim: false },
  trunk: { size: [1.0, 0.07, 1.85], segments: [5, 1, 8], at: [-1.75, 0.185, 0], outward: [-0.35, 1, 0], trim: false },
  doorLeft: { size: [1.3, 0.5, 0.05], segments: [6, 3, 1], at: [0.05, -0.1, -1.0], outward: [0, 0.25, -1], trim: false },
  doorRight: { size: [1.3, 0.5, 0.05], segments: [6, 3, 1], at: [0.05, -0.1, 1.0], outward: [0, 0.25, 1], trim: false },
};

export class CarView {
  readonly group = new THREE.Group();
  private readonly bodyMaterial: THREE.MeshStandardMaterial;
  private readonly surfaces: DentSurface[] = [];
  private readonly parts = new Map<PartId, THREE.Mesh>();
  private readonly pivots: THREE.Group[] = [];
  private readonly spinners: THREE.Group[] = [];
  private readonly spin = [0, 0, 0, 0];
  private readonly disposables: Array<{ dispose(): void }> = [];
  private paint: number;
  private wrecked = false;

  constructor(color: number) {
    this.paint = color;
    this.bodyMaterial = this.track(
      new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.25, flatShading: true }),
    );
    const trim = this.track(new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.8, metalness: 0.2, flatShading: true }));
    const glass = this.track(new THREE.MeshStandardMaterial({ color: 0x101a26, roughness: 0.25, metalness: 0.6, flatShading: true }));
    const headlight = this.track(
      new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xfff1c9, emissiveIntensity: 2 }),
    );
    const taillight = this.track(
      new THREE.MeshStandardMaterial({ color: 0x8a0f0f, emissive: 0xff2222, emissiveIntensity: 1.2 }),
    );
    const tyre = this.track(new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.95 }));
    const hub = this.track(new THREE.MeshStandardMaterial({ color: 0xb8bcc6, roughness: 0.4, metalness: 0.8 }));

    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number): void => {
      const mesh = new THREE.Mesh(this.track(new THREE.BoxGeometry(w, h, d)), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    // forward = +X, up = +Y, right = +Z; the physics chassis box is 4.6 x 1.0 x 2.0 centred on the origin.
    // The body is made of subdivided boxes with flat shading, so a dent is just moved vertices: no normals to recompute.
    this.crumpling(4.5, 0.6, 1.95, [18, 3, 8], this.bodyMaterial, 0, -0.15, 0); // lower body
    this.crumpling(2.4, 0.62, 1.7, [10, 3, 7], glass, -0.25, 0.46, 0); // cabin glass band
    this.crumpling(2.3, 0.08, 1.65, [10, 1, 7], this.bodyMaterial, -0.25, 0.81, 0); // roof
    for (const id of Object.keys(PART_SPECS) as PartId[]) {
      const spec = PART_SPECS[id];
      const mesh = this.crumpling(spec.size[0], spec.size[1], spec.size[2], spec.segments, spec.trim ? trim : this.bodyMaterial, spec.at[0], spec.at[1], spec.at[2]);
      this.parts.set(id, mesh);
    }
    box(0.06, 0.16, 0.36, headlight, 2.27, -0.02, 0.7);
    box(0.06, 0.16, 0.36, headlight, 2.27, -0.02, -0.7);
    box(0.06, 0.16, 0.36, taillight, -2.27, -0.02, 0.7);
    box(0.06, 0.16, 0.36, taillight, -2.27, -0.02, -0.7);

    const tyreGeometry = this.track(new THREE.CylinderGeometry(CAR.WHEEL.RADIUS, CAR.WHEEL.RADIUS, 0.35, 20));
    tyreGeometry.rotateX(Math.PI / 2); // cylinder axis Y -> Z (the axle)
    const hubGeometry = this.track(new THREE.CylinderGeometry(0.2, 0.2, 0.37, 12));
    hubGeometry.rotateX(Math.PI / 2);
    const spokeGeometry = this.track(new THREE.BoxGeometry(0.7, 0.07, 0.38)); // makes the spin visible
    for (let i = 0; i < 4; i++) {
      const pivot = new THREE.Group();
      const spinner = new THREE.Group();
      const t = new THREE.Mesh(tyreGeometry, tyre);
      t.castShadow = true;
      spinner.add(t, new THREE.Mesh(hubGeometry, hub), new THREE.Mesh(spokeGeometry, hub));
      pivot.add(spinner);
      const p = wheelLocalPosition(i, REST_SUSPENSION);
      pivot.position.set(p.x, p.y, p.z);
      this.group.add(pivot);
      this.pivots.push(pivot);
      this.spinners.push(spinner);
    }
  }

  private track<T extends { dispose(): void }>(o: T): T {
    this.disposables.push(o);
    return o;
  }

  /** A box of subdivided faces that a dent can push around. */
  private crumpling(w: number, h: number, d: number, segments: [number, number, number], material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const geometry = this.track(new THREE.BoxGeometry(w, h, d, segments[0], segments[1], segments[2]));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.surfaces.push(new DentSurface(geometry, { x, y, z }));
    return mesh;
  }

  /** Crumples the bodywork where a hit landed (car frame). */
  dent(d: Dent): void {
    for (const surface of this.surfaces) surface.apply(d);
  }

  /**
   * Takes a part off the car (it stops being drawn) and says where it was, so the caller can send it flying. Null when the part is
   * already off.
   */
  detach(id: PartId): DetachedPart | null {
    const mesh = this.parts.get(id);
    if (!mesh || !mesh.visible) return null;
    mesh.visible = false;
    this.group.updateMatrixWorld(true);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    mesh.matrixWorld.decompose(position, quaternion, new THREE.Vector3());
    const [ox, oy, oz] = PART_SPECS[id].outward;
    const outward = new THREE.Vector3(ox, oy, oz).normalize().applyQuaternion(this.group.quaternion);
    const [w, h, d] = PART_SPECS[id].size;
    return {
      id,
      position: { x: position.x, y: position.y, z: position.z },
      quaternion: { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
      size: { x: w, y: h, z: d },
      color: (mesh.material as THREE.MeshStandardMaterial).color.getHex(),
      outward: { x: outward.x, y: outward.y, z: outward.z },
    };
  }

  /** A new round: every part back on, every dent out. */
  restore(): void {
    for (const mesh of this.parts.values()) mesh.visible = true;
    for (const surface of this.surfaces) surface.reset();
  }

  /** Whether a part is still on the car. */
  hasPart(id: PartId): boolean {
    return this.parts.get(id)?.visible ?? false;
  }

  setPose(pos: Vec3, quat: Quat): void {
    this.group.position.set(pos.x, pos.y, pos.z);
    this.group.quaternion.set(quat.x, quat.y, quat.z, quat.w);
  }

  /** Exact wheel pose from a local simulation. */
  setWheels(wheels: readonly WheelPose[]): void {
    for (let i = 0; i < 4; i++) {
      const w = wheels[i];
      if (!w) continue;
      const p = wheelLocalPosition(i, w.suspensionLength);
      this.pivots[i]!.position.set(p.x, p.y, p.z);
      this.pivots[i]!.rotation.y = i < 2 ? w.steering : 0; // Rapier steering is positive = left = +Y rotation
      this.spinners[i]!.rotation.z = WHEEL_SPIN_SIGN * w.rotation;
    }
  }

  /** Approximate wheel animation for cars that have no local simulation. */
  animateWheels(forwardSpeed: number, steerAngle: number, dt: number): void {
    for (let i = 0; i < 4; i++) {
      this.spin[i] += (forwardSpeed / CAR.WHEEL.RADIUS) * dt;
      this.spinners[i]!.rotation.z = WHEEL_SPIN_SIGN * this.spin[i];
      this.pivots[i]!.rotation.y = i < 2 ? steerAngle : 0;
    }
  }

  setColor(color: number): void {
    this.paint = color;
    if (!this.wrecked) this.bodyMaterial.color.setHex(color);
  }

  /** A wreck is charred; it gets its paint back when the next round starts. */
  setWreck(wrecked: boolean): void {
    if (wrecked === this.wrecked) return;
    this.wrecked = wrecked;
    this.bodyMaterial.color.setHex(wrecked ? WRECK_COLOR : this.paint);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
