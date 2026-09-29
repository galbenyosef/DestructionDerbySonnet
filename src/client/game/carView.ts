import * as THREE from 'three';
import { CAR } from '../../shared/constants';
import type { Quat, Vec3, WheelPose } from '../../shared/types';
import { wheelLocalPosition } from '../../shared/vehicle';

/**
 * Rapier's wheel rotation increases while rolling forward (asserted in tests/vehicle.test.ts). A wheel rolling
 * toward +X with its axle along +Z spins about -Z, hence -1. If the wheels turn the wrong way in the sandbox
 * (or the Task 4 rotation test had to be flipped), change this constant.
 */
export const WHEEL_SPIN_SIGN = -1;
const REST_SUSPENSION = 0.374; // measured settled suspension length
/** Body colour of a car that is out of the round. */
export const WRECK_COLOR = 0x2a2b2e;

export class CarView {
  readonly group = new THREE.Group();
  private readonly bodyMaterial: THREE.MeshStandardMaterial;
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
    const trim = this.track(new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.8, metalness: 0.2 }));
    const glass = this.track(new THREE.MeshStandardMaterial({ color: 0x101a26, roughness: 0.25, metalness: 0.6 }));
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
    // forward = +X, up = +Y, right = +Z; the physics chassis box is 4.6 x 1.0 x 2.0 centred on the origin
    box(4.5, 0.6, 1.95, this.bodyMaterial, 0, -0.15, 0); // lower body
    box(2.4, 0.62, 1.7, glass, -0.25, 0.46, 0); // cabin glass band
    box(2.3, 0.08, 1.65, this.bodyMaterial, -0.25, 0.81, 0); // roof
    box(0.25, 0.32, 2.0, trim, 2.3, -0.32, 0); // front bumper
    box(0.25, 0.32, 2.0, trim, -2.3, -0.32, 0); // rear bumper
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
