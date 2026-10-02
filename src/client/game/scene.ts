import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { BoxSpec } from '../../shared/arena';
import { DEFAULT_ARENA } from '../../shared/arenas';
import { ARENA } from '../../shared/constants';
import type { QualityProfile } from '../settings';
import { COMPOSER_SAMPLES, createComposerTarget, needsComposer } from './composer';
import { createDressing } from './dressing';
import { needsResize } from './viewport';

export interface GameScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Matches the drawing buffer to the canvas' CSS size; cheap when nothing changed. */
  resize(): void;
  /** Draws the scene through the bloom pass (things brighter than the sky glow: lamps, headlights, sparks, fire), or straight to the screen on Low. */
  render(): void;
  /**
   * Switches the glow off for good (`?bloom=0`; it is the most expensive part of a frame on a weak GPU) or lets the graphics presets
   * decide again. A preset can never turn on a glow that was switched off here.
   */
  setBloom(enabled: boolean): void;
  /** Samples per pixel the scene is antialiased with (the composer's buffer, or the screen's own on Low); `window.__derby.debug()` reports it. */
  antialiasSamples(): number;
  /** Applies a graphics preset: pixel ratio, shadows, glow and crowd. */
  applyQuality(profile: QualityProfile): void;
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
  let pixelCap = 2; // the highest device pixel ratio the game draws at (a graphics preset lowers it)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelCap));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap is deprecated in r186
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.info.autoReset = false; // the bloom passes render several times a frame: count them all, reset once per frame

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
  for (const seg of DEFAULT_ARENA.boxes) if (seg.kind === 'wall') scene.add(boxMesh(seg, concrete, geometries));
  const blocks = new THREE.MeshStandardMaterial({ color: 0x9a9da1, roughness: 0.85, metalness: 0.05 });
  materials.push(blocks);
  for (const o of DEFAULT_ARENA.boxes) if (o.kind !== 'wall') scene.add(boxMesh(o, blocks, geometries));

  // The stands with their crowd, the tyre stacks outside the barrier, and a few floodlight masts.
  const dressing = createDressing();
  scene.add(dressing.group);

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

  // Bloom: the scene is drawn into a high-range buffer, the bright parts are blurred and added back, and the result is tone mapped.
  // The threshold is just above white, so only what is brighter than a lit surface glows (lamps, headlights, sparks, fire): the
  // name tags, which are plain white, stay crisp.
  let bloomWanted = true; // what the graphics preset asks for
  let bloomForcedOff = false; // what ?bloom=0 asks for
  const composer = new EffectComposer(renderer, createComposerTarget());
  let msaa = COMPOSER_SAMPLES; // samples of the composer's buffers (a graphics preset sets it)
  const setSamples = (samples: number): void => {
    msaa = samples;
    for (const target of [composer.renderTarget1, composer.renderTarget2]) {
      if (target.samples !== samples) {
        target.samples = samples;
        target.dispose(); // the buffer is built again with the new sample count on the next frame
      }
    }
  };
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.6, 1.05);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    const dpr = Math.min(window.devicePixelRatio, pixelCap);
    if (needsResize(canvas.width, canvas.height, w, h, dpr)) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      composer.setPixelRatio(dpr);
      composer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  return {
    renderer,
    scene,
    camera,
    resize,
    render: () => {
      renderer.info.reset();
      if (needsComposer(bloom.enabled, msaa)) composer.render();
      else renderer.render(scene, camera); // Low: no glow, no multisampled buffer, so the screen's own antialiasing applies
    },
    setBloom: (enabled) => {
      bloomForcedOff = !enabled;
      bloom.enabled = enabled && bloomWanted;
    },
    applyQuality: (profile) => {
      pixelCap = profile.pixelRatio;
      sun.castShadow = profile.shadows;
      if (sun.shadow.mapSize.x !== profile.shadowMapSize) {
        sun.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
        sun.shadow.map?.dispose(); // the shadow map is rebuilt at the new size on the next frame
        sun.shadow.map = null;
      }
      setSamples(profile.msaa);
      bloomWanted = profile.bloom;
      bloom.enabled = bloomWanted && !bloomForcedOff;
      dressing.setCrowd(profile.crowd);
    },
    antialiasSamples: () => {
      if (needsComposer(bloom.enabled, msaa)) return composer.renderTarget1.samples;
      const gl = renderer.getContext();
      return gl.getParameter(gl.SAMPLES) as number;
    },
    dispose: () => {
      dressing.dispose();
      composer.dispose();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
      renderer.dispose();
    },
  };
}
