import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { boundsRadius, DEFAULT_ARENA, type ArenaDef, type ArenaId } from '../../shared/arenas';
import type { QualityProfile } from '../settings';
import { COMPOSER_SAMPLES, createComposerTarget, needsComposer } from './composer';
import { createArenaView, type ArenaView } from './arenaView';
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
  /** Builds the arena of the coming round (ground, walls, obstacles, scenery) and sets the sky, fog and light to its look. */
  setArena(arena: ArenaDef, scenery?: THREE.Object3D | null): void;
  /** The Blender model of arena `id` has arrived: draws it in place of the plain boxes, when that arena is the one standing. */
  setScenery(id: ArenaId, model: THREE.Object3D): void;
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
  const sky = new THREE.Color();
  scene.background = sky;
  const fog = new THREE.Fog(sky, 70, 240);
  scene.fog = fog;

  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x444444, 0.75);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(35, 70, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 180;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  let crowdVisible = true; // the graphics preset's choice, kept for the next arena
  let view: ArenaView | null = null;
  let standing: ArenaId = DEFAULT_ARENA.id;
  const setArena = (def: ArenaDef, scenery: THREE.Object3D | null = null): void => {
    view?.dispose();
    standing = def.id;
    view = createArenaView(def, { crowd: crowdVisible, groundTexture: def.id === 'stadium' ? dirtTexture : undefined });
    scene.add(view.group);
    if (scenery) view.setScenery(scenery);
    const look = def.look;
    sky.set(look.sky);
    fog.color.set(look.fog);
    fog.near = look.fogNear;
    fog.far = look.fogFar;
    hemisphere.color.set(look.hemiSky);
    hemisphere.groundColor.set(look.hemiGround);
    sun.color.set(look.sun);
    sun.intensity = look.sunIntensity;
    const extent = boundsRadius(def.bounds) + 8; // the floodlight's shadow covers the whole playable area
    sun.shadow.camera.left = -extent;
    sun.shadow.camera.right = extent;
    sun.shadow.camera.top = extent;
    sun.shadow.camera.bottom = -extent;
    sun.shadow.camera.updateProjectionMatrix();
  };
  setArena(DEFAULT_ARENA);

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
      crowdVisible = profile.crowd;
      view?.setCrowd(profile.crowd);
    },
    antialiasSamples: () => {
      if (needsComposer(bloom.enabled, msaa)) return composer.renderTarget1.samples;
      const gl = renderer.getContext();
      return gl.getParameter(gl.SAMPLES) as number;
    },
    setArena,
    setScenery: (id, model) => {
      if (id === standing) view?.setScenery(model);
    },
    dispose: () => {
      view?.dispose();
      composer.dispose();
      renderer.dispose();
    },
  };
}
