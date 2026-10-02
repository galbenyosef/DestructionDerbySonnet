import * as THREE from 'three';
import type { BoxSpec } from '../../shared/arena';
import { boundsRadius, type ArenaDef } from '../../shared/arenas';
import { ARENA } from '../../shared/constants';
import { quatFromYawPitch } from '../../shared/math';
import { createDressing } from './dressing';

export interface ArenaViewOptions {
  /** Whether the crowd is drawn (the graphics preset). */
  crowd: boolean;
  /** Makes the texture of the ground (the Stadium's dirt). Without it the ground is the layout's plain colour. */
  groundTexture?: () => THREE.Texture;
}

/** Everything that stands in one arena: the ground, the walls and obstacles drawn from the layout, and the Stadium's dressing. */
export interface ArenaView {
  readonly group: THREE.Group;
  /** Shows or hides what the graphics preset may drop: the Stadium's crowd, the other arenas' props and backdrop. */
  setCrowd(visible: boolean): void;
  /**
   * Draws a loaded Blender model in place of the plain ground and boxes (null: back to the plain ones). The model is shared, so a copy
   * of it is added and what it holds is never disposed here.
   */
  setScenery(model: THREE.Object3D | null): void;
  dispose(): void;
}

/** The four colours of a shipping container, indexed by the box's `tint`. */
const CONTAINER_COLOURS = [0xb5532a, 0x2f6aa8, 0x3f8a4f, 0xc9a227] as const;

function boxMesh(b: BoxSpec, material: THREE.Material, geometries: THREE.BufferGeometry[]): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(b.hx * 2, b.hy * 2, b.hz * 2);
  geometries.push(geometry);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(b.x, b.y, b.z);
  const q = quatFromYawPitch(b.yaw, b.pitch ?? 0); // the very rotation the physics collider has
  mesh.quaternion.set(q.x, q.y, q.z, q.w);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.kind = b.kind ?? 'block';
  return mesh;
}

export function createArenaView(def: ArenaDef, options: ArenaViewOptions): ArenaView {
  const group = new THREE.Group();
  group.name = `arena-${def.id}`;
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const plain = new THREE.Group(); // the ground and the boxes of the layout: what is drawn until (and unless) a model replaces them
  plain.name = 'plain';
  group.add(plain);
  const texture = options.groundTexture?.();
  if (texture) textures.push(texture);
  const groundMaterial = new THREE.MeshStandardMaterial(texture ? { map: texture, roughness: 1, metalness: 0 } : { color: def.look.ground, roughness: 1, metalness: 0 });
  materials.push(groundMaterial);
  const groundGeometry = new THREE.CircleGeometry(boundsRadius(def.bounds) + 30, 96);
  geometries.push(groundGeometry);
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.name = 'ground';
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  plain.add(ground);

  // one material per kind of box (and per container colour): the walls are one draw state, not forty
  const byKind = new Map<string, THREE.Material>();
  const materialFor = (b: BoxSpec): THREE.Material => {
    const kind = b.kind ?? 'block';
    const key = kind === 'container' ? `container-${(b.tint ?? 0) % CONTAINER_COLOURS.length}` : kind;
    let m = byKind.get(key);
    if (!m) {
      const colour = kind === 'wall' ? def.look.wall : kind === 'container' ? CONTAINER_COLOURS[(b.tint ?? 0) % CONTAINER_COLOURS.length]! : def.look.block;
      m = new THREE.MeshStandardMaterial({ color: colour, roughness: kind === 'wall' ? 0.9 : 0.85, metalness: kind === 'container' ? 0.3 : 0.05 });
      byKind.set(key, m);
      materials.push(m);
    }
    return m;
  };
  for (const b of def.boxes) plain.add(boxMesh(b, materialFor(b), geometries));

  // the Stadium alone has its stands, tyre stacks and floodlight masts (the other arenas get their scenery from Blender, Plan 9)
  let dressing: ReturnType<typeof createDressing> | null = null;
  if (def.id === 'stadium') {
    dressing = createDressing();
    dressing.group.name = 'dressing';
    dressing.setCrowd(options.crowd);
    group.add(dressing.group);
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
      group.add(pole, lamp);
    }
  }

  let extras = options.crowd;
  let scenery: THREE.Object3D | null = null;
  const applyExtras = (): void => {
    scenery?.traverse((o) => {
      if (o.name.startsWith('props_') || o.name.startsWith('far_')) o.visible = extras;
    });
  };

  return {
    group,
    setCrowd: (visible) => {
      extras = visible;
      dressing?.setCrowd(visible);
      applyExtras();
    },
    setScenery: (model) => {
      if (scenery) group.remove(scenery);
      scenery = null;
      plain.visible = model === null;
      if (!model) return;
      scenery = model.clone(true); // shares geometry and materials with the loaded model
      scenery.name = 'scenery';
      scenery.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const part = o.name.split('_')[0];
        o.castShadow = part === 'walls' || part === 'obstacles' || part === 'props';
        o.receiveShadow = part !== 'far';
      });
      group.add(scenery);
      applyExtras();
    },
    dispose: () => {
      dressing?.dispose();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
      scenery = null; // the model is shared: whoever loaded it frees it
      group.removeFromParent();
    },
  };
}
