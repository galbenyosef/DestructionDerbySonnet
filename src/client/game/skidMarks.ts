import * as THREE from 'three';
import { ARENA } from '../../shared/constants';
import { clamp } from '../../shared/math';

export const SKID = {
  /** Side of the marks texture in pixels, and the half-width of the world square it covers (metres). */
  SIZE: 1024,
  EXTENT: ARENA.RADIUS + 2,
  /** Sideways speed (m/s) above which a tyre is sliding, and the forward speed above which the handbrake locks it. */
  SLIDE_SPEED: 2.5,
  HANDBRAKE_SPEED: 3,
  /** A wheel that moved further than this between two frames was teleported (a new round, a correction): do not draw a line across the arena. */
  MAX_SEGMENT: 3,
  /** Width of a mark in metres and its darkest opacity. */
  WIDTH: 0.34,
  ALPHA: 0.5,
} as const;

/** [r, g, b] of a `#rrggbb` colour; the default dark rubber when it is anything else. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : [8, 6, 4];
}

/** Where a world point lands on the marks texture (pixels; x to the right, y down as canvases do), for the plane the marks are drawn on. */
export function worldToTexture(x: number, z: number, extent: number = SKID.EXTENT): { u: number; v: number } {
  const scale = SKID.SIZE / (2 * extent);
  return { u: (x + extent) * scale, v: (z + extent) * scale };
}

/**
 * How hard a tyre skids, from 0 (rolling) to 1 (locked and sliding), from the car's velocity in its own frame: sliding sideways,
 * the handbrake at speed, or standing on the brake from a high speed. Nothing while the wheels are off the ground.
 */
export function skidStrength(car: { forward: number; lateral: number; handbrake: boolean; grounded: boolean; throttle: number }): number {
  if (!car.grounded) return 0;
  const side = Math.abs(car.lateral);
  let strength = side > SKID.SLIDE_SPEED ? clamp((side - SKID.SLIDE_SPEED) / 5, 0, 1) : 0;
  if (car.handbrake && Math.abs(car.forward) > SKID.HANDBRAKE_SPEED) strength = Math.max(strength, 0.7);
  if (car.throttle * car.forward < -0.5 && Math.abs(car.forward) > 8) strength = Math.max(strength, 0.4);
  return Number.isFinite(strength) ? strength : 0;
}

/** Where marks are drawn: a canvas in the browser, a recorder in tests. */
export interface MarkSurface {
  line(x0: number, y0: number, x1: number, y1: number, width: number, alpha: number): void;
  clear(): void;
  /** The marks now cover a square of half-width `extent` metres (another arena); the picture on it is wiped. */
  setExtent?(extent: number): void;
  /** The marks are drawn in this `#rrggbb` colour from now on (the ground of another arena). */
  setColor?(colour: string): void;
}

/**
 * Tyre marks on the ground, drawn into one texture that covers the arena. A wheel that skids leaves a line from where it was last
 * frame to where it is now; when it stops skidding the line breaks. Cheap: a few 2D lines a frame, one texture upload.
 */
export class SkidMarks {
  private readonly last = new Map<number, { x: number; z: number }>();
  private dirty = false;
  private extent: number = SKID.EXTENT;

  constructor(private readonly surface: MarkSurface) {}

  /** The colour the marks are drawn in (it follows the ground). */
  setColor(colour: string): void {
    this.surface.setColor?.(colour);
  }

  /** Another arena: the texture covers a square of half-width `extent` metres from now on, and starts blank. */
  setExtent(extent: number): void {
    this.extent = extent;
    this.surface.setExtent?.(extent);
    this.clear();
  }

  /** A wheel (`slot * 4 + wheel`) is at (x, z) this frame, skidding with `strength` (0 = not skidding). */
  wheel(key: number, x: number, z: number, strength: number): void {
    if (!Number.isFinite(x + z + strength) || strength < 0.05) {
      this.last.delete(key);
      return;
    }
    const before = this.last.get(key);
    this.last.set(key, { x, z });
    if (!before || Math.hypot(x - before.x, z - before.z) > SKID.MAX_SEGMENT) return;
    const a = worldToTexture(before.x, before.z, this.extent);
    const b = worldToTexture(x, z, this.extent);
    this.surface.line(a.u, a.v, b.u, b.v, SKID.WIDTH * (SKID.SIZE / (2 * this.extent)), SKID.ALPHA * clamp(strength, 0, 1));
    this.dirty = true;
  }

  /** True once after something was drawn: the texture has to be uploaded. */
  takeDirty(): boolean {
    const d = this.dirty;
    this.dirty = false;
    return d;
  }

  /** A new round: wipe the ground. */
  clear(): void {
    this.surface.clear();
    this.last.clear();
    this.dirty = true;
  }
}

/** The browser side: a canvas, its texture and the plane that shows it just above the ground. */
export class CanvasMarks implements MarkSurface {
  readonly texture: THREE.CanvasTexture;
  readonly mesh: THREE.Mesh;
  private readonly context: CanvasRenderingContext2D;
  private rgb = '8, 6, 4';

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = SKID.SIZE;
    canvas.height = SKID.SIZE;
    this.context = canvas.getContext('2d')!;
    this.context.lineCap = 'round';
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * SKID.EXTENT, 2 * SKID.EXTENT), material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.03;
    this.mesh.renderOrder = 1;
  }

  line(x0: number, y0: number, x1: number, y1: number, width: number, alpha: number): void {
    const g = this.context;
    g.strokeStyle = `rgba(${this.rgb}, ${alpha.toFixed(3)})`;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  }

  clear(): void {
    this.context.clearRect(0, 0, SKID.SIZE, SKID.SIZE);
  }

  setColor(colour: string): void {
    this.rgb = hexToRgb(colour).join(', ');
  }

  setExtent(extent: number): void {
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.PlaneGeometry(2 * extent, 2 * extent);
  }

  /** Uploads the canvas to the GPU. */
  upload(): void {
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.removeFromParent();
  }
}
