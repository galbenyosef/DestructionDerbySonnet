import type { PerspectiveCamera } from 'three';
import { CAR_FORWARD } from '../../shared/constants';
import { clamp, lerp, quatRotate, vlerp } from '../../shared/math';
import type { Quat, Vec3 } from '../../shared/types';

export interface ChaseTarget {
  pos: Vec3;
  quat: Quat;
  /** Speed in m/s (>= 0). */
  speed: number;
}

export interface ChaseView {
  position: Vec3;
  lookAt: Vec3;
  fov: number;
}

/** Pure camera placement: behind and above the car along its horizontal heading. */
export function computeChaseView(t: ChaseTarget): ChaseView {
  const f = quatRotate(t.quat, CAR_FORWARD);
  let fx = f.x;
  let fz = f.z;
  const len = Math.hypot(fx, fz);
  if (len < 1e-6) {
    fx = 1;
    fz = 0;
  } else {
    fx /= len;
    fz /= len;
  }
  const speed = Math.max(0, Number.isFinite(t.speed) ? t.speed : 0);
  const back = 9 + speed * 0.12;
  const height = 4 + speed * 0.03;
  return {
    position: { x: t.pos.x - fx * back, y: t.pos.y + height, z: t.pos.z - fz * back },
    lookAt: { x: t.pos.x + fx * 5, y: t.pos.y + 0.8, z: t.pos.z + fz * 5 },
    fov: clamp(62 + speed * 0.7, 62, 78),
  };
}

/** Puts a three.js camera where a view says (the field of view is only touched when it changed). */
export function applyChaseView(camera: PerspectiveCamera, view: ChaseView): void {
  camera.position.set(view.position.x, view.position.y, view.position.z);
  camera.lookAt(view.lookAt.x, view.lookAt.y, view.lookAt.z);
  if (Math.abs(camera.fov - view.fov) > 0.01) {
    camera.fov = view.fov;
    camera.updateProjectionMatrix();
  }
}

/** Smoothing wrapper that applies a ChaseView to a three.js camera. */
export class ChaseCamera {
  private position: Vec3 | null = null;
  private lookAt: Vec3 | null = null;
  private fov = 62;

  reset(): void {
    this.position = null;
    this.lookAt = null;
  }

  update(camera: PerspectiveCamera, target: ChaseTarget, dt: number): void {
    const want = computeChaseView(target);
    if (!this.position || !this.lookAt) {
      this.position = want.position;
      this.lookAt = want.lookAt;
      this.fov = want.fov;
    } else {
      const k = 1 - Math.exp(-Math.max(dt, 0) * 6);
      this.position = vlerp(this.position, want.position, k);
      this.lookAt = vlerp(this.lookAt, want.lookAt, Math.min(1, k * 1.5));
      this.fov = lerp(this.fov, want.fov, k);
    }
    applyChaseView(camera, { position: this.position, lookAt: this.lookAt, fov: this.fov });
  }
}
