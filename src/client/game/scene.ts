import * as THREE from 'three';
import { obstacleBoxes, wallSegments, type BoxSpec } from '../../shared/arena';
import { ARENA } from '../../shared/constants';
import { needsResize } from './viewport';

export interface GameScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Matches the drawing buffer to the canvas' CSS size; cheap when nothing changed. */
  resize(): void;
  render(): void;
  dispose(): void;
}

/** Deterministic speckled dirt so the ground looks the same on every load. */
function dirtTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#5a4630';
  g.fillRect(0, 0, size, size);
  let seed = 1337;
  const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 9000; i++) {
    const v = 60 + rnd() * 50;
    g.fillStyle = `rgb(${Math.round(v + 30)},${Math.round(v + 10)},${Math.round(v - 10)})`;
    g.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(24, 24);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function boxMesh(b: BoxSpec, material: THREE.Material, geometries: THREE.BufferGeometry[]): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(b.hx * 2, b.hy * 2, b.hz * 2);
  geometries.push(geometry);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(b.x, b.y, b.z);
  mesh.rotation.y = b.yaw; // same yaw convention as the physics colliders (rotation about +Y)
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createGameScene(canvas: HTMLCanvasElement): GameScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap is deprecated in r186
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const night = new THREE.Color(0x0b1226);
  scene.background = night;
  scene.fog = new THREE.Fog(night, 70, 240);

  scene.add(new THREE.HemisphereLight(0x9db4ff, 0x3b2c1c, 0.75));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
  sun.position.set(35, 70, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const extent = ARENA.RADIUS + 8;
  sun.shadow.camera.left = -extent;
  sun.shadow.camera.right = extent;
  sun.shadow.camera.top = extent;
  sun.shadow.camera.bottom = -extent;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 180;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const dirt = dirtTexture();
  textures.push(dirt);
  const groundMaterial = new THREE.MeshStandardMaterial({ map: dirt, roughness: 1, metalness: 0 });
  materials.push(groundMaterial);
  const groundGeometry = new THREE.CircleGeometry(ARENA.RADIUS + 30, 96);
  geometries.push(groundGeometry);
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const concrete = new THREE.MeshStandardMaterial({ color: 0x8a8d91, roughness: 0.9, metalness: 0.05 });
  materials.push(concrete);
  for (const seg of wallSegments()) scene.add(boxMesh(seg, concrete, geometries));
  const blocks = new THREE.MeshStandardMaterial({ color: 0x9a9da1, roughness: 0.85, metalness: 0.05 });
  materials.push(blocks);
  for (const o of obstacleBoxes()) scene.add(boxMesh(o, blocks, geometries));

  // Dark stands ring behind the walls and a few floodlight masts (purely decorative in this plan).
  const standsGeometry = new THREE.CylinderGeometry(ARENA.RADIUS + 22, ARENA.RADIUS + 30, 10, 64, 1, true);
  geometries.push(standsGeometry);
  const standsMaterial = new THREE.MeshStandardMaterial({ color: 0x1a2236, roughness: 1, side: THREE.DoubleSide });
  materials.push(standsMaterial);
  const stands = new THREE.Mesh(standsGeometry, standsMaterial);
  stands.position.y = 5;
  scene.add(stands);

  const poleGeometry = new THREE.CylinderGeometry(0.3, 0.4, 16, 8);
  const lampGeometry = new THREE.BoxGeometry(3, 0.6, 1.2);
  geometries.push(poleGeometry, lampGeometry);
  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.8 });
  const lampMaterial = new THREE.MeshStandardMaterial({ color: 0xfff3d0, emissive: 0xfff3d0, emissiveIntensity: 3 });
  materials.push(poleMaterial, lampMaterial);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const r = ARENA.RADIUS + 12;
    const pole = new THREE.Mesh(poleGeometry, poleMaterial);
    pole.position.set(Math.cos(a) * r, 8, Math.sin(a) * r);
    const lamp = new THREE.Mesh(lampGeometry, lampMaterial);
    lamp.position.set(Math.cos(a) * r, 16.3, Math.sin(a) * r);
    lamp.lookAt(0, 0, 0);
    scene.add(pole, lamp);
  }

  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 600);

  function resize(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    if (needsResize(canvas.width, canvas.height, w, h, dpr)) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  return {
    renderer,
    scene,
    camera,
    resize,
    render: () => renderer.render(scene, camera),
    dispose: () => {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
      renderer.dispose();
    },
  };
}
