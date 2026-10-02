import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createArenaView } from '../../src/client/game/arenaView';
import { ARENA_IDS, ARENAS, boundsRadius } from '../../src/shared/arenas';
import { quatFromYawPitch } from '../../src/shared/math';

const boxMeshes = (group: THREE.Group): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  group.traverse((o) => {
    if (o instanceof THREE.Mesh && o.userData.kind !== undefined) out.push(o);
  });
  return out;
};

describe('createArenaView', () => {
  for (const id of ARENA_IDS) {
    const arena = ARENAS[id];
    describe(arena.name, () => {
      it('draws one mesh for every wall and obstacle of the layout, where the collider is', () => {
        const view = createArenaView(arena, { crowd: true });
        const meshes = boxMeshes(view.group);
        expect(meshes).toHaveLength(arena.boxes.length);
        meshes.forEach((m, i) => {
          const b = arena.boxes[i]!;
          expect(m.position.toArray()).toEqual([b.x, b.y, b.z]);
          const q = quatFromYawPitch(b.yaw, b.pitch ?? 0);
          expect(m.quaternion.angleTo(new THREE.Quaternion(q.x, q.y, q.z, q.w))).toBeLessThan(1e-5);
          expect((m.geometry as THREE.BoxGeometry).parameters).toMatchObject({ width: b.hx * 2, height: b.hy * 2, depth: b.hz * 2 });
          expect(m.userData.kind).toBe(b.kind);
        });
        view.dispose();
      });

      it('has a ground that reaches well past the walls', () => {
        const view = createArenaView(arena, { crowd: true });
        const ground = view.group.getObjectByName('ground') as THREE.Mesh;
        expect((ground.geometry as THREE.CircleGeometry).parameters.radius).toBeGreaterThan(boundsRadius(arena.bounds) + 20);
        view.dispose();
      });
    });
  }

  it('lifts the high end of a ramp: a positive pitch raises the +X end of the box', () => {
    const view = createArenaView(ARENAS.port, { crowd: false });
    const ramp = boxMeshes(view.group).find((m) => m.userData.kind === 'ramp' && Math.abs(m.rotation.y) < 0.01)!;
    const along = new THREE.Vector3(1, 0, 0).applyQuaternion(ramp.quaternion);
    expect(along.y).toBeGreaterThan(0.05);
    view.dispose();
  });

  it('dresses only the Stadium with a crowd, which the graphics preset can switch off', () => {
    const stadium = createArenaView(ARENAS.stadium, { crowd: true });
    expect(stadium.group.getObjectByName('dressing')).toBeDefined();
    stadium.setCrowd(false);
    stadium.setCrowd(true);
    stadium.dispose();
    for (const id of ['ice', 'quarry', 'port'] as const) {
      const view = createArenaView(ARENAS[id], { crowd: true });
      expect(view.group.getObjectByName('dressing')).toBeUndefined();
      view.setCrowd(false); // nothing to switch, and no error
      view.dispose();
    }
  });

  it('colours the shipping containers in four colours by their tint', () => {
    const view = createArenaView(ARENAS.port, { crowd: false });
    const colours = new Set(boxMeshes(view.group).filter((m) => m.userData.kind === 'container').map((m) => ((m.material as THREE.MeshStandardMaterial).color.getHex())));
    expect(colours.size).toBe(4);
    view.dispose();
  });

  it('frees its geometry and materials when it is disposed, and shares a material among boxes of one kind', () => {
    const view = createArenaView(ARENAS.ice, { crowd: true });
    const disposed = { geometry: 0, material: 0 };
    const seen = new Set<THREE.Material>();
    view.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.addEventListener('dispose', () => disposed.geometry++);
      for (const m of [o.material].flat()) {
        if (!seen.has(m)) m.addEventListener('dispose', () => disposed.material++);
        seen.add(m);
      }
    });
    const walls = boxMeshes(view.group).filter((m) => m.userData.kind === 'wall');
    expect(new Set(walls.map((m) => m.material)).size).toBe(1);
    view.dispose();
    expect(disposed.geometry).toBeGreaterThan(boxMeshes(view.group).length - 1);
    expect(disposed.material).toBe(seen.size);
  });
});

describe('an arena view with Blender scenery', () => {
  /** A stand-in for a loaded model: one mesh in each group the game knows. */
  function model(): THREE.Group {
    const g = new THREE.Group();
    for (const name of ['ground_floor', 'walls_snow', 'obstacles_block', 'props_pine', 'far_mount']) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
      m.name = name;
      g.add(m);
    }
    return g;
  }
  const meshNamed = (root: THREE.Object3D, name: string): THREE.Mesh => root.getObjectByName(name) as THREE.Mesh;

  it('shows the model instead of the plain ground and boxes, and the plain ones again when the model goes', () => {
    const view = createArenaView(ARENAS.ice, { crowd: true });
    const plain = view.group.getObjectByName('plain')!;
    expect(plain.visible).toBe(true);
    view.setScenery(model());
    expect(view.group.getObjectByName('scenery')).toBeDefined();
    expect(plain.visible).toBe(false);
    view.setScenery(null);
    expect(view.group.getObjectByName('scenery')).toBeUndefined();
    expect(plain.visible).toBe(true);
    view.dispose();
  });

  it('keeps the plain boxes (the colliders\' shape) in the view so a failed model costs nothing', () => {
    const view = createArenaView(ARENAS.port, { crowd: true });
    view.setScenery(model());
    expect(boxMeshes(view.group)).toHaveLength(ARENAS.port.boxes.length);
    view.dispose();
  });

  it('holds one copy of the model at a time, however often it is set', () => {
    const view = createArenaView(ARENAS.quarry, { crowd: true });
    const m = model();
    view.setScenery(m);
    view.setScenery(m);
    view.setScenery(model());
    expect(view.group.children.filter((c) => c.name === 'scenery')).toHaveLength(1);
    view.dispose();
  });

  it('shares the model\'s geometry and materials, and leaves them alone when it is disposed', () => {
    const m = model();
    const original = meshNamed(m, 'walls_snow');
    let freed = 0;
    original.geometry.addEventListener('dispose', () => freed++);
    (original.material as THREE.Material).addEventListener('dispose', () => freed++);
    const view = createArenaView(ARENAS.ice, { crowd: true });
    view.setScenery(m);
    const shown = meshNamed(view.group.getObjectByName('scenery')!, 'walls_snow');
    expect(shown).not.toBe(original);
    expect(shown.geometry).toBe(original.geometry);
    view.dispose();
    expect(freed).toBe(0);
  });

  it('hides the props and the backdrop when the crowd is off (the Low preset), and shows them again', () => {
    const view = createArenaView(ARENAS.port, { crowd: false });
    view.setScenery(model());
    const scenery = view.group.getObjectByName('scenery')!;
    const visible = (name: string): boolean => meshNamed(scenery, name).visible;
    expect([visible('props_pine'), visible('far_mount'), visible('walls_snow'), visible('ground_floor'), visible('obstacles_block')]).toEqual([false, false, true, true, true]);
    view.setCrowd(true);
    expect([visible('props_pine'), visible('far_mount')]).toEqual([true, true]);
    view.setCrowd(false);
    expect(visible('props_pine')).toBe(false);
    view.dispose();
  });

  it('lets the walls and obstacles cast shadows and the backdrop neither cast nor receive them', () => {
    const view = createArenaView(ARENAS.ice, { crowd: true });
    view.setScenery(model());
    const scenery = view.group.getObjectByName('scenery')!;
    expect(meshNamed(scenery, 'walls_snow').castShadow).toBe(true);
    expect(meshNamed(scenery, 'ground_floor').castShadow).toBe(false);
    expect(meshNamed(scenery, 'ground_floor').receiveShadow).toBe(true);
    expect(meshNamed(scenery, 'far_mount').castShadow).toBe(false);
    expect(meshNamed(scenery, 'far_mount').receiveShadow).toBe(false);
    view.dispose();
  });

  it('does nothing to the Stadium\'s own dressing when it is given a model', () => {
    const view = createArenaView(ARENAS.stadium, { crowd: true });
    view.setScenery(model());
    expect(view.group.getObjectByName('dressing')).toBeDefined();
    view.dispose();
  });
});
