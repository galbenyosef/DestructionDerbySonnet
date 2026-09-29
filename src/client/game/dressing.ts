import * as THREE from 'three';
import { ARENA } from '../../shared/constants';
import { mulberry32 } from '../../shared/random';

/** Where one prop stands: position (m), turn about +Y (rad), size factor, and a palette index for its colour. */
export interface Placement {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  tint: number;
}

/** The rim of the wall's outer face: nothing the players can drive on is ever outside it. */
export const OUTER_WALL = ARENA.RADIUS + 2 * ARENA.WALL_HALF_THICKNESS;

/** The bowl the crowd sits on: a cone rising away from the barrier. */
export const BOWL = { INNER: ARENA.RADIUS + 9, OUTER: ARENA.RADIUS + 34, HEIGHT: 12 } as const;

/** Height of the bowl's surface at a distance from the middle of the arena. */
export function bowlHeight(radius: number): number {
  return ((radius - BOWL.INNER) / (BOWL.OUTER - BOWL.INNER)) * BOWL.HEIGHT;
}

const TYRES_PER_STACK = 3;
const TYRE_TUBE = 0.28;

/** Stacks of tyres on the ground just outside the barrier (a tyre is 0.56 m thick and there are three to a stack). */
export function tyreStacks(count = 30, seed = 11): Placement[] {
  const random = mulberry32(seed);
  const out: Placement[] = [];
  for (let i = 0; i < count; i++) {
    const a = ((i + (random() - 0.5) * 0.4) / count) * Math.PI * 2;
    const r = OUTER_WALL + 1.1 + random() * 0.4;
    out.push({ x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r, yaw: random() * Math.PI, scale: 0.9 + random() * 0.25, tint: 0 });
  }
  return out;
}

/** Spectators in rows on the bowl, a few gaps here and there, each with a jersey colour from the palette. */
export function crowd(seed = 5): Placement[] {
  const random = mulberry32(seed);
  const out: Placement[] = [];
  for (let radius = BOWL.INNER + 1.5; radius < BOWL.OUTER - 1; radius += 2.6) {
    const n = Math.floor((2 * Math.PI * radius) / 2.2);
    for (let i = 0; i < n; i++) {
      if (random() < 0.12) continue;
      const a = ((i + random() * 0.6) / n) * Math.PI * 2;
      const scale = 0.85 + random() * 0.3;
      out.push({ x: Math.cos(a) * radius, y: bowlHeight(radius) + 0.62 * scale, z: Math.sin(a) * radius, yaw: -a + Math.PI / 2, scale, tint: Math.floor(random() * JERSEYS.length) });
    }
  }
  return out;
}

const JERSEYS = [0x2a2f3d, 0x3a2a2a, 0x2a3a30, 0x4a4030, 0x30384a, 0x5a5a66, 0x6a2a2a, 0x2a4a5a];

/** The stands, the crowd and the tyre stacks: everything around the arena that is only there to look at. */
export interface Dressing {
  readonly group: THREE.Group;
  /** Shows or hides the crowd (the low graphics preset draws the stands empty). */
  setCrowd(visible: boolean): void;
  dispose(): void;
}

export function createDressing(): Dressing {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const dummy = new THREE.Object3D();

  const bowlGeometry = new THREE.CylinderGeometry(BOWL.OUTER, BOWL.INNER, BOWL.HEIGHT, 96, 1, true);
  const bowlMaterial = new THREE.MeshStandardMaterial({ color: 0x1a2236, roughness: 1, side: THREE.DoubleSide });
  geometries.push(bowlGeometry);
  materials.push(bowlMaterial);
  const bowl = new THREE.Mesh(bowlGeometry, bowlMaterial);
  bowl.position.y = BOWL.HEIGHT / 2;
  bowl.receiveShadow = true;
  group.add(bowl);

  const people = crowd();
  const personGeometry = new THREE.CapsuleGeometry(0.26, 0.62, 1, 5);
  const personMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
  geometries.push(personGeometry);
  materials.push(personMaterial);
  const crowdMesh = new THREE.InstancedMesh(personGeometry, personMaterial, people.length);
  const colour = new THREE.Color();
  people.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.yaw, 0);
    dummy.scale.setScalar(p.scale);
    dummy.updateMatrix();
    crowdMesh.setMatrixAt(i, dummy.matrix);
    crowdMesh.setColorAt(i, colour.setHex(JERSEYS[p.tint]!));
  });
  crowdMesh.instanceMatrix.needsUpdate = true;
  if (crowdMesh.instanceColor) crowdMesh.instanceColor.needsUpdate = true;
  group.add(crowdMesh);

  const stacks = tyreStacks();
  const tyreGeometry = new THREE.TorusGeometry(0.55, TYRE_TUBE, 8, 18);
  tyreGeometry.rotateX(Math.PI / 2); // lie flat
  const tyreMaterial = new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.9, flatShading: true });
  geometries.push(tyreGeometry);
  materials.push(tyreMaterial);
  const tyres = new THREE.InstancedMesh(tyreGeometry, tyreMaterial, stacks.length * TYRES_PER_STACK);
  tyres.castShadow = true;
  stacks.forEach((s, i) => {
    for (let k = 0; k < TYRES_PER_STACK; k++) {
      dummy.position.set(s.x, TYRE_TUBE * s.scale + k * 2 * TYRE_TUBE * s.scale, s.z);
      dummy.rotation.set(0, s.yaw + k * 0.7, 0);
      dummy.scale.setScalar(s.scale);
      dummy.updateMatrix();
      tyres.setMatrixAt(i * TYRES_PER_STACK + k, dummy.matrix);
    }
  });
  tyres.instanceMatrix.needsUpdate = true;
  group.add(tyres);

  return {
    group,
    setCrowd(visible) {
      crowdMesh.visible = visible;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      crowdMesh.dispose();
      tyres.dispose();
      group.removeFromParent();
    },
  };
}
