import * as THREE from 'three';

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
