import * as THREE from 'three';
import { clamp } from '../../shared/math';
import { hpColor } from '../ui/format';

/** A billboarded text label drawn on a canvas; hovers above a car and always faces the camera. */
export function createNameTag(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const g = canvas.getContext('2d')!;
  const font = (px: number): string => `600 ${px}px ui-sans-serif, system-ui, sans-serif`;
  let size = 30;
  g.font = font(size);
  while (g.measureText(text).width > 240 && size > 14) {
    size -= 2;
    g.font = font(size);
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(0, 0, 0, 0.75)';
  g.strokeText(text, 128, 34);
  g.fillStyle = '#ffffff';
  g.fillText(text, 128, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(4, 1, 1);
  sprite.position.set(0, 2.3, 0);
  sprite.renderOrder = 10;
  return sprite;
}

export function disposeNameTag(sprite: THREE.Sprite): void {
  sprite.material.map?.dispose();
  sprite.material.dispose();
  sprite.removeFromParent();
}

/** Width and height of the health bar under a name, in metres. */
export const HP_BAR = { width: 2.2, height: 0.2, y: 1.85 } as const;

const solidSprite = (color: number, opacity: number, renderOrder: number): THREE.Sprite => {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ color, opacity, transparent: true, depthWrite: false }));
  sprite.renderOrder = renderOrder;
  return sprite;
};

/**
 * What floats above another car: its name and, under it, a health bar that shrinks and goes from green to red as the
 * car is hurt. The bar is two flat sprites (no canvas), so following the car's health costs nothing per frame.
 */
export class NameTag {
  readonly group = new THREE.Group();
  private readonly label: THREE.Sprite;
  private readonly back = solidSprite(0x000000, 0.6, 10);
  private readonly fill = solidSprite(0xffffff, 1, 11);
  private hp = Number.NaN;
  private alive = true;

  /** `makeLabel` draws the name; it defaults to the canvas label and is replaced in Node, where there is no canvas. */
  constructor(
    readonly name: string,
    makeLabel: (text: string) => THREE.Sprite = createNameTag,
  ) {
    this.label = makeLabel(name);
    const pad = 0.05;
    // both sit on the car's vertical axis: a sprite always faces the camera, so an offset in the car's own space would slide sideways
    this.back.position.set(0, HP_BAR.y, 0);
    this.back.scale.set(HP_BAR.width + 2 * pad, HP_BAR.height + 2 * pad, 1);
    this.fill.position.set(0, HP_BAR.y, 0);
    this.group.add(this.label, this.back, this.fill);
    this.update(100, true);
  }

  /** Shows `hp` (0..100); a car that is out has no tag at all. Cheap to call every frame. */
  update(hp: number, alive: boolean): void {
    if (alive !== this.alive) {
      this.alive = alive;
      this.group.visible = alive;
    }
    const value = clamp(Number.isFinite(hp) ? hp : 0, 0, 100);
    if (value === this.hp) return;
    this.hp = value;
    const fraction = Math.max(1e-3, value / 100);
    this.fill.scale.set(HP_BAR.width * fraction, HP_BAR.height, 1);
    this.fill.center.set(0.5 / fraction, 0.5); // the sprite spans [-center, 1 - center] of its width: this pins its left edge at -width/2
    this.fill.material.color.set(hpColor(value));
  }

  dispose(): void {
    this.label.material.map?.dispose();
    this.label.material.dispose();
    this.back.material.dispose();
    this.fill.material.dispose();
    this.group.removeFromParent();
  }
}
