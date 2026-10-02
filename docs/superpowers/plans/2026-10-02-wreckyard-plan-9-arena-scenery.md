# Wreckyard Plan 9 — Arena Scenery (Blender models, loaded during the vote) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Frozen Lake, the Mud Quarry and the Container Port the scenery that makes them different places: a Blender model of each, built from the same boxes as the physics, loaded by the browser while the vote is open so the winner is ready for the countdown, with the plain boxes of Plan 8 as the fallback, props and backdrop that the Low graphics preset drops, and tyre marks in the colour of each ground.

**Architecture:** `art/arenas/build_arenas.py` (Blender 5, `bpy` and `bmesh` only) imports `layouts.py`, draws the walls, blocks, containers and ramps from its boxes, adds the decoration around them, merges everything per (group, material) and exports one GLB per arena into `src/client/assets/`. The groups are named (`ground_`, `walls_`, `obstacles_`, `props_`, `far_`) and the game relies on the names. `ArenaScenery` loads a model on request, once, shares it, answers `null` on failure; `ArenaView.setScenery` shows a copy that shares the model\'s geometry and materials in place of the plain ground and boxes; the game asks for the models of the arenas leading the vote and shows the one of the round\'s arena when it is here. Nothing in the simulation, the rules or the wire changes.

**Tech Stack:** as Plans 1-8, plus three\'s `GLTFLoader` (already in the package) and Blender 5 for the build of the models (the models are committed; Blender is needed only to change them).

**Spec:** `docs/superpowers/specs/2026-10-02-wreckyard-arenas-and-cars-design.md` — "Architecture" (one source of truth per arena, the client\'s arena loader and look), "Risks" (size, performance). **Prerequisite:** Plans 1-8 merged on `main` (`8497e26`, 794 tests). This plan starts on a new branch cut from it. Plan 10 (the car models, protocol 5) is separate.

**Scope notes:**
- Deviations from the spec text, each with its reason: (1) **the Stadium keeps the scenery it builds in code** (stands, crowd, tyre stacks, floodlights): it already has a crowd preset and a look the owner has seen, replacing it with a model would only risk it; the spec\'s "become part of that arena\'s scenery" is met by its being part of that arena\'s view. (2) **No `arena_<id>.json` is written by the Blender script:** Plan 8 made `layouts.py` the one source of the layouts and the JSON, and the script imports it, which is what keeps the walls you see where the colliders are. (3) **The tyre marks on the ice are dark, not white,** because the ground is nearly white; the colour of each arena is one line in its layout. (4) **"Low lightens the scenery" is the props and the backdrop only** (the ground, walls and obstacles are the arena); the preset flag is the existing `crowd`. (5) **The models are not compressed** (no Draco or meshopt): 0.5 to 1.1 MB each loads during a vote that lasts 12 s; the budget test (`arenaAssets.test.ts`) fails at 1.5 MB, which is when to add it.
- **Blender is needed to run Task 63\'s build step** (`/Applications/Blender.app/Contents/MacOS/Blender`, version 5.x; the path is the macOS default). The result is committed, so nothing else needs it.
- What stays open: the feel of the grip numbers of Plan 8 (a playtest), the quality of the modelling (low-poly, seeded, hand-placed: a first pass that a modeller would improve), and Plan 10.

## What the rehearsal found (measured before this plan was written)

I rehearsed everything in a scratch copy of `main`, generated this text from the rehearsal, and executed it against a fresh copy to check that it reproduces the rehearsal file for file.

- **The models:** the Frozen Lake is 17 936 triangles in 16 meshes (1.07 MB), the Mud Quarry 8 416 in 22 (0.47 MB), the Container Port 14 724 in 39 (0.82 MB); no textures, no images, 9 to 25 materials each; and the export is **byte-for-byte repeatable** (two runs give the same hashes), which is what lets the plan\'s dry run compare trees.
- **In a real browser** (private port, short rounds, three bots, the Playwright browser, 1280x720; no console errors): each model was fetched once, during the vote (74 ms, 10 ms and 7 ms on localhost), the lake showed banks of snow, pines, blocks of ice with shards, mountains and dark blue tyre marks, the quarry showed terraces, a mound with plank ramps, an excavator, trucks, masts and mesas through a dusty fog, the port showed ribbed containers, striped steel ramps, sodium light masts, a crane and a warehouse. With the port on screen the renderer reported 177 draw calls and about 52 000 triangles for the scene and eight cars\' worth of the others; geometries stayed at 133 and textures at 19 across arena changes.
- **A defect in my first loader draft, found by a test I wrote for it:** when the load function threw instead of returning a rejected promise, the arena stayed "loading" for good and was never tried again (the cleanup ran before the pending promise was recorded). The loader now starts the load inside a `try`, turns a throw into a rejection, and cleans up from a promise callback, which never runs synchronously.
- **Two things I changed after looking at the pictures:** the port was too dark to read (its sun goes from 1.9 to 2.6 and its sky light is lighter), and white tyre marks on the lake would have been invisible.
- **Known limits of this baseline:** the models are low-poly and procedural; the ground of each arena is flat colour; the first time an arena is voted on a slow link its model may arrive after the countdown starts (the plain boxes show until it does, then the scenery appears); the lake is very bright and the vote panel\'s text is hard to read over it.

## Global Constraints

- Everything in Plans 1-8\'s Global Constraints still applies (single package, relative imports, exact pins, axes, deterministic simulation path, effects cosmetic, one protocol version, commits only because the user opted in).
- **Nothing here touches the simulation, the rules or the wire:** `NET.PROTOCOL_VERSION` stays 4 and `npm run hash` still prints `8719c2e8` (and the other three arenas\' hashes) after every task.
- **Axes:** a game point `(x, y, z)` is Blender `(x, -z, y)`; yaw is a rotation about Blender\'s Z; a positive pitch lifts a box\'s +X end.
- **The models are generated, never edited:** `build_arenas.py` is the source; the export is repeatable; a model with a node that moves, turns or scales the arena fails the asset test.
- **The physics never depends on a model:** the plain boxes of the layout stay in every view, and an arena whose model is missing or broken plays as before.
- **No new dependency**; nothing in this plan deploys, pushes or creates an account.
- The user\'s own `npm run dev` may be running on ports 8080/5173: never stop it. Use `PORT` with another port (18000 and up) for anything that needs a server. **Never commit a symlink or a build output:** `node_modules` and `dist` are ignored.

## Review Focus

1. **A model that never comes, or comes late:** a 404, a corrupt file, a slow link, the player leaving before it arrives, a model for an arena that is no longer the one standing. → Tasks 65 and 66 (`arenaScenery.test.ts`, `arenaView.test.ts`, the browser check).
2. **Scenery that disagrees with the physics:** a wall you see that is not there, a wall that is there and invisible, a ramp that tilts the other way, a container you can drive through. → Task 63 (`arenaAssets.test.ts`: walls reach the edge, no transformed nodes) and the browser check of Task 66.
3. **Memory and GPU use across many arena changes:** shared geometry freed once and only by its owner, the copy of the model not disposing it, the cache kept for the session. → Tasks 65 and 66.
4. **A weak machine:** the Low preset hides the props and backdrop; the models stay under the triangle and size budget. → Tasks 63 and 66.
5. **The build and the container:** the models are hashed assets in the production build, served with the right type and immutable caching, and part of the image. → Task 63 (`static.test.ts`) and the browser check.

## File Structure

| File | Responsibility |
|---|---|
| `art/arenas/build_arenas.py` (new) | the Blender build of the three sceneries from `layouts.py` |
| `src/client/assets/arena_{ice,quarry,port}.glb` (new, generated) | the models |
| `src/client/game/arenaAssets.ts`, `arenaScenery.ts` (new) | where the models are served from; the loader with its cache and its fallback |
| `src/client/game/arenaView.ts`, `scene.ts`, `gameClient.ts` (modify) | showing a model in place of the plain boxes; asking for it when the vote points at it |
| `src/server/static.ts` (modify) | `.glb` as `model/gltf-binary` |
| `art/arenas/layouts.py`, `src/shared/arenas.ts`, `src/shared/arenas/*.json` (modify) | the tyre-mark colour of each look; a brighter port |
| `src/client/game/skidMarks.ts`, `fx.ts` (modify) | marks in the colour of the ground |
| `README.md`, `CLAUDE.md` (modify) | the docs |
| `tests/…` | one file per new module and additions to the existing suites |

---

### Task 63: The Blender scenery of the Frozen Lake, the Mud Quarry and the Container Port

**Files:**
- Create: `art/arenas/build_arenas.py`, `src/client/assets/arena_ice.glb`, `src/client/assets/arena_quarry.glb`, `src/client/assets/arena_port.glb` (the script writes them), `src/client/game/arenaAssets.ts`, `tests/client/arenaAssets.test.ts`
- Modify: `src/server/static.ts`, `tests/server/static.test.ts`

**Interfaces:**
- Consumes: `art/arenas/layouts.py` (Plan 8: the boxes of every arena), Blender 5 (`/Applications/Blender.app`; the script uses `bpy` and `bmesh` only), Vite's `?url` imports, `createStaticHandler` (Plan 2).
- Produces: `ARENA_SCENERY_URLS` (arena id → the served URL of its model; the Stadium has none); three GLB files of scenery only (no collision), in groups the game knows by name: `ground_*`, `walls_*`, `obstacles_*`, `props_*` (decoration near the arena) and `far_*` (the backdrop); `.glb` served as `model/gltf-binary`. Not in this task: loading them (Task 65) or drawing them (Task 66).

- [ ] **Step 1: Write the tests**

The models are generated files, so the test holds them to what the game needs rather than to a picture: each exists (and the Stadium has none), is a valid GLB under 1.5 MB with its data inside the file (no images, no textures, no external buffer), costs at most 30 000 triangles, 45 materials and 60 meshes, has every mesh in one of the five groups, has walls that reach out past the edge of the playable area, and has **no node that moves, turns or scales the arena** (the exporter bakes the transforms into the vertices; a model exported rotated would not match the walls). The static handler must serve a model as `model/gltf-binary` with the immutable caching every hashed asset gets.

Create `tests/client/arenaAssets.test.ts`:

<!-- op {"kind": "create", "path": "tests/client/arenaAssets.test.ts"} -->
```ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARENA_SCENERY_URLS } from '../../src/client/game/arenaAssets';
import { ARENAS, boundsHalfSize, type ArenaId } from '../../src/shared/arenas';

const ASSETS = path.resolve('src/client/assets');
const SCENERY: ArenaId[] = ['ice', 'quarry', 'port'];
/** The groups the game relies on: the Low preset hides `props` and `far`; the rest is the arena itself. */
const GROUPS = ['ground', 'walls', 'obstacles', 'props', 'far'];

interface Accessor {
  count: number;
  min?: number[];
  max?: number[];
}
interface Gltf {
  asset: { version: string };
  nodes: Array<{ name?: string; mesh?: number; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }>;
  meshes: Array<{ name?: string; primitives: Array<{ attributes: { POSITION: number }; indices?: number; material?: number }> }>;
  materials?: unknown[];
  accessors: Accessor[];
  images?: unknown[];
  textures?: unknown[];
  buffers: Array<{ uri?: string; byteLength: number }>;
}

function readGlb(file: string): { gltf: Gltf; bytes: number } {
  const data = readFileSync(file);
  expect(data.toString('latin1', 0, 4)).toBe('glTF');
  expect(data.readUInt32LE(4)).toBe(2);
  expect(data.readUInt32LE(8)).toBe(data.length);
  const jsonLength = data.readUInt32LE(12);
  expect(data.toString('latin1', 16, 20)).toBe('JSON');
  return { gltf: JSON.parse(data.toString('utf8', 20, 20 + jsonLength)) as Gltf, bytes: data.length };
}

describe('the arena models', () => {
  it('exist for the three arenas that have scenery, and for none other', () => {
    expect(readdirSync(ASSETS).filter((f) => f.endsWith('.glb')).sort()).toEqual(SCENERY.map((id) => `arena_${id}.glb`).sort());
    expect(Object.keys(ARENA_SCENERY_URLS).sort()).toEqual([...SCENERY].sort());
    for (const url of Object.values(ARENA_SCENERY_URLS)) expect(url).toMatch(/\.glb/);
  });

  for (const id of SCENERY) {
    describe(id, () => {
      const file = path.join(ASSETS, `arena_${id}.glb`);
      const { gltf } = readGlb(file);

      it('is small enough to load during a vote: under 1.5 MB, with nothing outside the file', () => {
        expect(statSync(file).size).toBeLessThan(1.5 * 1024 * 1024);
        expect(gltf.asset.version).toBe('2.0');
        expect(gltf.images ?? []).toEqual([]);
        expect(gltf.textures ?? []).toEqual([]);
        for (const b of gltf.buffers) expect(b.uri).toBeUndefined();
      });

      it('is cheap to draw: at most 30 000 triangles, 45 materials and 60 meshes', () => {
        let triangles = 0;
        for (const mesh of gltf.meshes) for (const p of mesh.primitives) triangles += (p.indices === undefined ? gltf.accessors[p.attributes.POSITION]!.count : gltf.accessors[p.indices]!.count) / 3;
        expect(triangles).toBeGreaterThan(3000);
        expect(triangles).toBeLessThanOrEqual(30_000);
        expect(gltf.materials?.length ?? 0).toBeLessThanOrEqual(45);
        expect(gltf.meshes.length).toBeLessThanOrEqual(60);
      });

      it('puts every mesh into a group the game knows (ground, walls, obstacles, props, far)', () => {
        const meshNodes = gltf.nodes.filter((n) => n.mesh !== undefined);
        expect(meshNodes.length).toBeGreaterThan(5);
        for (const n of meshNodes) expect(n.name, 'mesh node name').toMatch(new RegExp(`^(${GROUPS.join('|')})_`));
        for (const g of ['ground', 'walls', 'props']) expect(meshNodes.some((n) => n.name!.startsWith(`${g}_`)), `has ${g}`).toBe(true);
      });

      it('has walls that reach the edge of the playable area, where the colliders are', () => {
        // the exporter bakes every transform into the vertices, so the position bounds are in game coordinates (x, y up, z)
        let reach = 0;
        for (const n of gltf.nodes) {
          if (n.mesh === undefined || !n.name!.startsWith('walls_')) continue;
          for (const p of gltf.meshes[n.mesh]!.primitives) {
            const a = gltf.accessors[p.attributes.POSITION]!;
            reach = Math.max(reach, ...a.max!.map(Math.abs).filter((_, i) => i !== 1));
          }
        }
        expect(reach).toBeGreaterThan(boundsHalfSize(ARENAS[id].bounds));
      });

      it('is made of nodes that do not move or turn the arena (a model that was exported rotated would not match the walls)', () => {
        for (const n of gltf.nodes) {
          if (n.translation) expect(n.translation.map(Math.abs).every((v) => v < 1e-4), `${n.name} translation`).toBe(true);
          if (n.rotation) expect(n.rotation.slice(0, 3).map(Math.abs).every((v) => v < 1e-4), `${n.name} rotation`).toBe(true);
          if (n.scale) expect(n.scale.every((v) => Math.abs(v - 1) < 1e-4), `${n.name} scale`).toBe(true);
        }
      });
    });
  }
});
```

In `tests/server/static.test.ts`:

<!-- op {"kind": "edit", "path": "tests/server/static.test.ts"} -->
```ts
  fs.writeFileSync(path.join(root, 'assets', 'app-abc.js'), 'console.log(1)');
  fs.writeFileSync(path.join(tmp, 'secret.txt'), 'top secret');
```

with:

```ts
  fs.writeFileSync(path.join(root, 'assets', 'app-abc.js'), 'console.log(1)');
  fs.writeFileSync(path.join(root, 'assets', 'arena_ice-abc.glb'), 'glTF');
  fs.writeFileSync(path.join(tmp, 'secret.txt'), 'top secret');
```

In `tests/server/static.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/static.test.ts"} -->
```ts
    expect(await res.text()).toBe('<h1>hello</h1>');
  });
```

with:

```ts
    expect(await res.text()).toBe('<h1>hello</h1>');
  });

  it('serves an arena model as a glTF binary, cached like every hashed asset', async () => {
    const res = await fetch(`${base}/assets/arena_ice-abc.glb`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('model/gltf-binary');
    expect(res.headers.get('cache-control')).toContain('immutable');
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/client/arenaAssets.test.ts tests/server/static.test.ts`
Expected: FAIL — there are no models and no `arenaAssets.ts`, and `.glb` is served as an unknown type

<!-- check {"cmd": "npx vitest run tests/client/arenaAssets.test.ts tests/server/static.test.ts", "outcome": "fail", "match": "Cannot find module|FAIL|not a function|Failed|ENOENT"} -->

- [ ] **Step 3: Write the Blender script**

One script builds the three sceneries from the boxes of `layouts.py`, so the walls, blocks, containers and ramps you see are where the colliders are: **the physics boxes are drawn first (merged per group and material to keep the draw calls few), and the decoration is added around them.** A game point `(x, y, z)` is Blender `(x, -z, y)`, and the glTF exporter turns it back; a box's yaw is a rotation about Blender's Z, and a positive pitch (which lifts the +X end) a rotation of `-pitch` about its Y. The Frozen Lake is a pale disc with cracks, banks of snow where the walls are, blocks of ice with shards, pines, drifts and mountains; the Mud Quarry is a pit ringed by terraces of rock with strata, a mound with four plank ramps, an excavator and dump trucks on the first terrace, barrels, gravel, floodlight masts and mesas on the horizon; the Container Port is an asphalt yard with lane markings, concrete barriers with red and white bands, ribbed containers in four colours, steel ramps with chevrons, a fence, light masts, stacked containers, a warehouse, two gantry cranes, a ship alongside the quay and a distant city. Everything is seeded, so **the export is byte-for-byte repeatable**. `ARENA=ice` builds one; `PREVIEW=<folder>` also renders three pictures of each.

Create `art/arenas/build_arenas.py`:

<!-- op {"kind": "create", "path": "art/arenas/build_arenas.py"} -->
```
"""Builds the scenery of the Frozen Lake, the Mud Quarry and the Container Port in Blender and exports one GLB per arena.

    /Applications/Blender.app/Contents/MacOS/Blender -b --python art/arenas/build_arenas.py            # all three
    ARENA=ice QUICK=1 PREVIEW=1 ... --python art/arenas/build_arenas.py                                  # one, with preview renders

Environment: ARENA (ice | quarry | port | all), OUT (folder of the GLBs, default src/client/assets), PREVIEW (folder for PNG renders; off
by default), QUICK (fewer render samples).

The walls, obstacles and ramps are built from the very boxes of `layouts.py` (the physics), so the scenery sits exactly where the colliders
are. Game axes: X forward, Y up, Z right; Blender: X forward, Y left, Z up, so a game point (x, y, z) is Blender (x, -z, y), and the glTF
exporter turns it back. Everything is merged per (group, material) to keep the draw calls few. Group names the game relies on: `ground`,
`walls`, `obstacles`, `props` (decoration near the arena; the Low preset hides it) and `far` (the backdrop; Low hides it too).
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.dont_write_bytecode = True  # importing layouts.py must not leave a __pycache__ in the repository
sys.path.insert(0, HERE)
import layouts  # noqa: E402

OUT = os.environ.get('OUT', os.path.join(ROOT, 'src', 'client', 'assets'))
PREVIEW = os.environ.get('PREVIEW', '')
QUICK = bool(os.environ.get('QUICK'))


def srgb(hex_colour):
    h = hex_colour.lstrip('#') if isinstance(hex_colour, str) else '%06x' % hex_colour
    return tuple(((int(h[i:i + 2], 16) / 255.0) ** 2.2) for i in (0, 2, 4)) + (1.0,)


def G(x, y, z):
    """A game point as a Blender point."""
    return Vector((x, -z, y))


def yaw_pitch(yaw, pitch=0.0):
    """The game's rotation of a box (yaw about +Y, after a pitch about its own Z axis that lifts +X) as a Blender quaternion."""
    return Quaternion((0, 0, 1), yaw) @ Quaternion((0, 1, 0), -pitch)


class Scene:
    def __init__(self, name):
        self.name = name
        self.meshes = {}  # (group, material name) -> bmesh
        self.materials = {}

    def mat(self, name, colour, rough=0.85, metal=0.0, emit=0.0):
        if name not in self.materials:
            m = bpy.data.materials.new(f'{self.name}_{name}')
            m.use_nodes = True
            bsdf = m.node_tree.nodes['Principled BSDF']
            bsdf.inputs['Base Color'].default_value = srgb(colour)
            bsdf.inputs['Roughness'].default_value = rough
            bsdf.inputs['Metallic'].default_value = metal
            if emit:
                bsdf.inputs['Emission Color'].default_value = srgb(colour)
                bsdf.inputs['Emission Strength'].default_value = emit
            self.materials[name] = m
        return name

    def bm(self, group, mat):
        key = (group, mat)
        if key not in self.meshes:
            self.meshes[key] = bmesh.new()
        return self.meshes[key]

    # ---- primitives, in game coordinates (centre x, y, z; rotation as a Blender quaternion) ----
    def _place(self, bm, verts, scale, rot, centre):
        m = Matrix.Translation(G(*centre)) @ rot.to_matrix().to_4x4() @ Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0))
        bmesh.ops.transform(bm, matrix=m, verts=verts)

    def box(self, group, mat, centre, half, yaw=0.0, pitch=0.0, bevel=0.0, rot=None):
        """A box of half extents (hx, hy, hz) in game axes, optionally with its edges rounded off."""
        bm = self.bm(group, mat)
        verts = bmesh.ops.create_cube(bm, size=2.0)['verts']
        self._place(bm, verts, (half[0], half[2], half[1]), rot or yaw_pitch(yaw, pitch), centre)
        if bevel > 0:
            edges = list({e for v in verts for e in v.link_edges})
            bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=1, affect='EDGES')

    def sphere(self, group, mat, centre, radii, rot=None, subdiv=1, jitter=0.0, rnd=None):
        """An icosphere of radii (rx, ry, rz) in game axes; `jitter` roughens it."""
        bm = self.bm(group, mat)
        verts = bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)['verts']
        if jitter and rnd:
            for v in verts:
                v.co *= 1.0 + rnd.uniform(-jitter, jitter)
        self._place(bm, verts, (radii[0], radii[2], radii[1]), rot or Quaternion(), centre)

    def cone(self, group, mat, base_centre, r1, r2, height, segs=8, rot=None, cap=True):
        """A (truncated) cone standing on `base_centre` along game +Y."""
        bm = self.bm(group, mat)
        verts = bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=1.0)['verts']
        for v in verts:
            v.co.z += 0.5  # stand on the base
        x, y, z = base_centre
        self._place(bm, verts, (1.0, 1.0, height), rot or Quaternion(), (x, y, z))

    def quad(self, group, mat, a, b, c, d):
        """A flat face from four game points."""
        bm = self.bm(group, mat)
        vs = [bm.verts.new(G(*p)) for p in (a, b, c, d)]
        try:
            bm.faces.new(vs)
        except ValueError:
            pass

    def strip(self, group, mat, points, width, y=0.02):
        """A flat ribbon along game ground points (x, z)."""
        for (x0, z0), (x1, z1) in zip(points, points[1:]):
            dx, dz = x1 - x0, z1 - z0
            n = math.hypot(dx, dz) or 1.0
            ox, oz = -dz / n * width / 2, dx / n * width / 2
            self.quad(group, mat, (x0 - ox, y, z0 - oz), (x0 + ox, y, z0 + oz), (x1 + ox, y, z1 + oz), (x1 - ox, y, z1 - oz))

    def disc(self, group, mat, radius, y=0.0, segs=64):
        self.cone(group, mat, (0, y, 0), radius, radius, 0.0001, segs=segs)

    def finish(self):
        """Turns the accumulators into objects (one per group and material) under one empty named after the arena."""
        root = bpy.data.objects.new(f'arena_{self.name}', None)
        bpy.context.scene.collection.objects.link(root)
        for (group, mat), bm in sorted(self.meshes.items()):
            if not bm.verts:
                continue
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            me = bpy.data.meshes.new(f'{group}_{mat}')
            bm.to_mesh(me)
            bm.free()
            me.materials.append(self.materials[mat])
            for p in me.polygons:
                p.use_smooth = False
            ob = bpy.data.objects.new(f'{group}_{mat}', me)
            ob.parent = root
            bpy.context.scene.collection.objects.link(ob)
        return root


def tri_count(root):
    total = 0
    for ob in root.children:
        me = ob.data
        me.calc_loop_triangles()
        total += len(me.loop_triangles)
    return total


# ============================================================================== the Frozen Lake
def build_ice(layout):
    s = Scene('ice')
    r = random.Random(11)
    for name, col, rough in (('floor', 0xc9e3f4, 0.12), ('floor2', 0xb4d6ec, 0.15), ('crack', 0x4f86ad, 0.3), ('snow', 0xf3f7fd, 0.95),
                             ('snow2', 0xdfe9f4, 0.95), ('block', 0x86c3ea, 0.1), ('block2', 0xb8e0f5, 0.1), ('pine', 0x2c5a40, 0.9),
                             ('pine2', 0x3b6e4d, 0.9), ('trunk', 0x4a3a2c, 0.9), ('rock', 0x79838f, 0.9), ('mount', 0x93a5ba, 0.9),
                             ('cap', 0xffffff, 0.95)):
        s.mat(name, col, rough)
    s.disc('ground', 'floor', 175.0, 0.0, 72)
    # patches of a slightly darker ice and the cracks that run across it
    for _ in range(9):
        a, d = r.uniform(0, math.tau), r.uniform(8, 44)
        s.cone('ground', 'floor2', (math.cos(a) * d, 0.012, math.sin(a) * d), 1, 1, 0.0001, segs=9)
    for _ in range(16):
        a, d = r.uniform(0, math.tau), r.uniform(4, 44)
        x, z, h = math.cos(a) * d, math.sin(a) * d, r.uniform(0, math.tau)
        pts = [(x, z)]
        for _k in range(r.randint(3, 6)):
            h += r.uniform(-0.7, 0.7)
            x, z = x + math.cos(h) * r.uniform(2, 5), z + math.sin(h) * r.uniform(2, 5)
            pts.append((x, z))
        s.strip('ground', 'crack', pts, 0.1, 0.02)

    for b in layout['boxes']:
        c, half = (b['x'], b['y'], b['z']), (b['hx'], b['hy'], b['hz'])
        if b['kind'] == 'wall':  # a bank of snow: the collider box itself, rounded, with lumps on top
            s.box('walls', 'snow', c, half, yaw=b['yaw'], bevel=0.3)
            q = yaw_pitch(b['yaw'])
            for k in (-0.55, 0.0, 0.55):
                off = q @ Vector((k * half[0], 0, 0))
                s.sphere('walls', 'snow2', (c[0] + off.x, c[1] + 0.35, c[2] - off.y), (half[0] * 0.36, half[1] * 1.35, half[2] * 1.15), rot=q, rnd=r, jitter=0.1)
        else:  # a block of ice with shards
            s.box('obstacles', 'block', c, half, yaw=b['yaw'], bevel=0.2)
            q = yaw_pitch(b['yaw'])
            for _k in range(3):
                dx, dz = r.uniform(-0.6, 0.6) * half[0], r.uniform(-0.6, 0.6) * half[2]
                off = q @ Vector((dx, dz * -1, 0))
                lean = Quaternion((r.uniform(-1, 1), r.uniform(-1, 1), 0), r.uniform(0.0, 0.35))
                s.cone('obstacles', 'block2', (c[0] + off.x, c[1] + half[1] * 0.9, c[2] - off.y), r.uniform(0.35, 0.6), 0.0, r.uniform(1.2, 2.4), segs=5, rot=lean)

    # drifts along the outside of the bank, and the shore
    for k in range(70):
        a = k / 70 * math.tau + r.uniform(-0.03, 0.03)
        d = r.uniform(55.5, 60)
        s.sphere('props', 'snow', (math.cos(a) * d, r.uniform(-0.5, 0.0), math.sin(a) * d), (r.uniform(3, 6), r.uniform(1.4, 2.6), r.uniform(3, 6)), rnd=r, jitter=0.08)
    for _ in range(120):  # pines, the nearer ones bigger
        a, d = r.uniform(0, math.tau), r.uniform(64, 100)
        sc = r.uniform(0.8, 1.7)
        x, z = math.cos(a) * d, math.sin(a) * d
        s.cone('props', 'trunk', (x, 0, z), 0.22 * sc, 0.2 * sc, 1.2 * sc, segs=5)
        m = 'pine' if r.random() < 0.6 else 'pine2'
        s.cone('props', m, (x, 0.9 * sc, z), 1.7 * sc, 0.15 * sc, 2.6 * sc, segs=7)
        s.cone('props', m, (x, 2.3 * sc, z), 1.3 * sc, 0.1 * sc, 2.3 * sc, segs=7)
        s.cone('props', 'cap', (x, 3.7 * sc, z), 0.55 * sc, 0.0, 1.2 * sc, segs=7)
    for _ in range(26):
        a, d = r.uniform(0, math.tau), r.uniform(62, 96)
        s.sphere('props', 'rock', (math.cos(a) * d, 0.2, math.sin(a) * d), (r.uniform(0.8, 2.2), r.uniform(0.6, 1.4), r.uniform(0.8, 2.2)), rnd=r, jitter=0.2)
    # far hills and mountains
    for k in range(16):
        a = k / 16 * math.tau + r.uniform(-0.1, 0.1)
        d = r.uniform(120, 135)
        s.sphere('far', 'snow2', (math.cos(a) * d, -4, math.sin(a) * d), (r.uniform(24, 40), r.uniform(14, 24), r.uniform(24, 40)), subdiv=2, rnd=r, jitter=0.06)
    for k in range(14):
        a = k / 14 * math.tau + r.uniform(-0.12, 0.12)
        d = r.uniform(158, 178)
        h = r.uniform(45, 85)
        rad = r.uniform(30, 48)
        s.cone('far', 'mount', (math.cos(a) * d, -2, math.sin(a) * d), rad, 0.0, h, segs=7)
        s.cone('far', 'cap', (math.cos(a) * d, -2 + h * 0.62, math.sin(a) * d), rad * 0.38, 0.0, h * 0.38, segs=7)
    return s


def local_pt(centre, q, lx, ly, lz):
    """The game point at local game offset (lx, ly, lz) of a box centred on `centre` and rotated by the Blender quaternion `q`."""
    off = q @ Vector((lx, -lz, ly))
    return (centre[0] + off.x, centre[1] + off.z, centre[2] - off.y)


def axis_quat(axis, angle):
    return Quaternion(axis, angle)


# ============================================================================== the Mud Quarry
def build_quarry(layout):
    s = Scene('quarry')
    r = random.Random(23)
    for name, col, rough in (('dirt', 0x8a5a32, 0.95), ('dirt2', 0x7a4e2b, 0.95), ('track', 0x4e3220, 0.95), ('rock1', 0x8d6a45, 0.9),
                             ('rock2', 0xa4794b, 0.9), ('rock3', 0x6e4a2c, 0.9), ('strata', 0xc9a56e, 0.9), ('wood', 0x9b7a4a, 0.85),
                             ('wood2', 0x6e5232, 0.85), ('gravel', 0x9a8f80, 0.95), ('yellow', 0xd9a521, 0.6), ('metal', 0x7d8186, 0.5),
                             ('dark', 0x23201d, 0.8), ('glass', 0x6aa3b8, 0.2), ('barrel', 0xb23a2c, 0.6), ('barrel2', 0x2f6aa8, 0.6),
                             ('mesa', 0xb2764a, 0.9), ('mesa2', 0x94623d, 0.9), ('lamp', 0xffd9a0, 0.4)):
        s.mat(name, col, rough, emit=6.0 if name == 'lamp' else 0.0)
    pts = layout['bounds']['points']
    n = len(pts)
    a_ax, b_ax = 62.0, 42.0
    s.disc('ground', 'dirt', 200.0, 0.0, 72)
    for k in range(3):  # worn tracks round the pit floor
        f = 0.35 + 0.2 * k
        ring = [(a_ax * f * math.cos(t / 48 * math.tau + k), b_ax * f * math.sin(t / 48 * math.tau + k)) for t in range(49)]
        for dx in (-0.9, 0.9):
            s.strip('ground', 'track', [(x + dx * 0.4, z + dx * 0.4) for x, z in ring], 0.7, 0.02)
    for _ in range(14):
        a, rr = r.uniform(0, math.tau), r.uniform(0.2, 0.85)
        s.cone('ground', 'dirt2', (a_ax * rr * math.cos(a), 0.012, b_ax * rr * math.sin(a)), r.uniform(2, 5), r.uniform(2, 5), 0.0001, segs=9)

    # terraced rock rising away from the wall (the wall's outer face is at about 2 m from the outline)
    def pt(off, i):
        x, z = pts[i % n]
        nx, nz = x / (a_ax * a_ax), z / (b_ax * b_ax)
        ln = math.hypot(nx, nz) or 1.0
        j = random.Random(i * 31 + int(off * 7)).uniform(-0.8, 0.8)
        return (x + nx / ln * (off + j), z + nz / ln * (off + j))
    levels = [(2.0, 3.0), (9.0, 6.5), (17.0, 10.0), (27.0, 13.5), (40.0, 16.0)]
    for lv in range(len(levels) - 1):
        (o0, h0), (o1, h1) = levels[lv], levels[lv + 1]
        for i in range(n):
            p0, p1 = pt(o0, i), pt(o0, i + 1)
            q0, q1 = pt(o1, i), pt(o1, i + 1)
            mat_top = 'rock1' if (i + lv) % 3 else 'rock2'
            s.quad('walls', mat_top, (p0[0], h0, p0[1]), (q0[0], h1, q0[1]), (q1[0], h1, q1[1]), (p1[0], h0, p1[1]))
    for lv in range(1, len(levels)):  # the cliff faces between terraces, with a band of lighter strata
        (o1, h1) = levels[lv]
        (_, h0) = levels[lv - 1]
        for i in range(n):
            p0, p1 = pt(o1, i), pt(o1, i + 1)
            mid = h0 + (h1 - h0) * 0.55
            s.quad('walls', 'rock3', (p0[0], h0, p0[1]), (p0[0], mid, p0[1]), (p1[0], mid, p1[1]), (p1[0], h0, p1[1]))
            s.quad('walls', 'strata', (p0[0], mid, p0[1]), (p0[0], h1, p0[1]), (p1[0], h1, p1[1]), (p1[0], mid, p1[1]))

    for b in layout['boxes']:
        c, half = (b['x'], b['y'], b['z']), (b['hx'], b['hy'], b['hz'])
        q = yaw_pitch(b['yaw'], b.get('pitch', 0.0))
        if b['kind'] == 'wall':  # a rock face with a band of strata and boulders on top
            s.box('walls', 'rock1', c, half, yaw=b['yaw'], bevel=0.12)
            s.box('walls', 'strata', (c[0], c[1] + 0.25, c[2]), (half[0] * 0.99, 0.22, half[2] + 0.05), yaw=b['yaw'])
            if r.random() < 0.6:
                off = local_pt(c, q, r.uniform(-half[0], half[0]) * 0.8, half[1] + 0.2, 0)
                s.sphere('walls', 'rock3', off, (r.uniform(0.7, 1.4), r.uniform(0.5, 1.0), r.uniform(0.7, 1.2)), rnd=r, jitter=0.25)
        elif b['kind'] == 'block':  # the mound
            s.box('obstacles', 'dirt2', c, half, yaw=b['yaw'], bevel=0.25)
            for _ in range(7):
                s.sphere('obstacles', 'gravel', (c[0] + r.uniform(-4.5, 4.5), c[1] + half[1] - 0.05, c[2] + r.uniform(-4.5, 4.5)), (r.uniform(0.8, 1.6), 0.28, r.uniform(0.8, 1.6)), rnd=r, jitter=0.15)
        else:  # a ramp of planks
            s.box('obstacles', 'wood', c, half, yaw=b['yaw'], pitch=b.get('pitch', 0.0), bevel=0.04)
            for k in range(-4, 5):
                p = local_pt(c, q, 0, half[1] + 0.01, k * half[2] / 4.4)
                s.box('obstacles', 'wood2', p, (half[0] * 0.995, 0.015, 0.03), rot=q)
            for sgn in (-1, 1):
                p = local_pt(c, q, 0, half[1] + 0.12, sgn * (half[2] - 0.08))
                s.box('obstacles', 'wood2', p, (half[0] * 0.99, 0.12, 0.08), rot=q)

    # machinery on the first terrace: an excavator and a dump truck
    def excavator(x, z, yaw, y=6.5):
        q = yaw_pitch(yaw)
        for sgn in (-1, 1):
            s.box('props', 'dark', local_pt((x, y, z), q, 0, 0.45, sgn * 1.1), (2.0, 0.45, 0.45), rot=q, bevel=0.1)
        s.box('props', 'yellow', local_pt((x, y, z), q, 0, 1.2, 0), (1.6, 0.5, 1.2), rot=q, bevel=0.1)
        s.box('props', 'yellow', local_pt((x, y, z), q, -0.4, 2.2, 0.2), (0.9, 0.7, 0.8), rot=q, bevel=0.08)
        s.box('props', 'glass', local_pt((x, y, z), q, 0.1, 2.35, 0.2), (0.85, 0.45, 0.82), rot=q)
        arm = q @ Quaternion((0, 1, 0), -0.7)
        s.box('props', 'yellow', local_pt((x, y, z), q, 2.4, 2.9, -0.4), (2.2, 0.22, 0.22), rot=arm)
        arm2 = q @ Quaternion((0, 1, 0), 0.9)
        s.box('props', 'yellow', local_pt((x, y, z), q, 4.6, 2.6, -0.4), (1.6, 0.18, 0.18), rot=arm2)
        s.box('props', 'metal', local_pt((x, y, z), q, 5.7, 1.5, -0.4), (0.5, 0.45, 0.6), rot=q, bevel=0.05)

    def truck(x, z, yaw, y=6.5):
        q = yaw_pitch(yaw)
        s.box('props', 'yellow', local_pt((x, y, z), q, 2.3, 1.7, 0), (1.1, 0.9, 1.3), rot=q, bevel=0.1)
        s.box('props', 'glass', local_pt((x, y, z), q, 3.0, 2.0, 0), (0.45, 0.4, 1.2), rot=q)
        s.box('props', 'metal', local_pt((x, y, z), q, -0.6, 1.3, 0), (3.0, 0.15, 1.3), rot=q)
        bed = q @ Quaternion((0, 1, 0), -0.18)
        s.box('props', 'yellow', local_pt((x, y, z), q, -0.7, 2.0, 0), (2.6, 0.75, 1.4), rot=bed, bevel=0.1)
        for wx in (-2.4, 0.2, 2.5):
            for sgn in (-1, 1):
                s.cone('props', 'dark', local_pt((x, y, z), q, wx, 0.0, sgn * 1.45), 0.9, 0.9, 0.55, segs=10, rot=q @ Quaternion((1, 0, 0), math.pi / 2))

    excavator(*pt(5.5, 6), yaw=0.4)
    excavator(*pt(5.5, 27), yaw=3.5)
    truck(*pt(5.0, 14), yaw=-1.2)
    truck(*pt(5.0, 33), yaw=1.9)
    for _ in range(30):  # barrels, gravel piles and boulders on the terraces
        i = r.randrange(n)
        x, z = pt(r.uniform(3.5, 8.0), i)
        y = 6.5 if r.random() < 0.8 else 3.0
        k = r.random()
        if k < 0.3:
            s.cone('props', r.choice(['barrel', 'barrel2']), (x, y, z), 0.4, 0.4, 0.9, segs=8)
        elif k < 0.65:
            s.cone('props', 'gravel', (x, y, z), r.uniform(1.4, 2.6), 0.2, r.uniform(1.0, 2.0), segs=7)
        else:
            s.sphere('props', 'rock3', (x, y + 0.4, z), (r.uniform(0.8, 1.8), r.uniform(0.6, 1.2), r.uniform(0.8, 1.6)), rnd=r, jitter=0.25)
    for i in range(2, n, 8):  # floodlight masts on the rim
        x, z = pt(9.0, i)
        s.cone('props', 'metal', (x, 6.5, z), 0.22, 0.18, 12.0, segs=6)
        s.box('props', 'lamp', (x, 18.7, z), (1.2, 0.2, 0.5), yaw=math.atan2(-z, x))
    for k in range(18):  # mesas on the horizon
        a = k / 18 * math.tau + r.uniform(-0.1, 0.1)
        d = r.uniform(150, 185)
        h = r.uniform(26, 55)
        rad = r.uniform(28, 46)
        s.cone('far', 'mesa' if k % 2 else 'mesa2', (math.cos(a) * d, -2, math.sin(a) * d), rad, rad * r.uniform(0.55, 0.8), h, segs=9)
    return s


# ============================================================================== the Container Port
def build_port(layout):
    s = Scene('port')
    r = random.Random(37)
    for name, col, rough, metal in (('asphalt', 0x4a4d52, 0.9, 0), ('asphalt2', 0x55585d, 0.9, 0), ('gravel', 0x6f6a60, 0.95, 0), ('line_y', 0xe3b023, 0.7, 0),
                                    ('line_w', 0xdcdcdc, 0.7, 0), ('concrete', 0x8d9096, 0.9, 0), ('concrete2', 0x6f7277, 0.9, 0), ('red', 0xc8372d, 0.7, 0),
                                    ('white', 0xe8e8e8, 0.7, 0), ('steel', 0x9aa0a6, 0.45, 0.6), ('steel_d', 0x5f656b, 0.5, 0.6), ('dark', 0x1f2226, 0.8, 0),
                                    ('water', 0x1d3a52, 0.1, 0), ('hull', 0x2c3f52, 0.6, 0.2), ('crane', 0xc8372d, 0.6, 0.2), ('lamp', 0xffb066, 0.4, 0),
                                    ('wall', 0x9a9a92, 0.9, 0), ('glass', 0x7aa5b8, 0.2, 0.3), ('city', 0x2b3342, 0.9, 0), ('city2', 0x3a4256, 0.9, 0),
                                    ('c0', 0xb5532a, 0.6, 0.2), ('c1', 0x2f6aa8, 0.6, 0.2), ('c2', 0x3f8a4f, 0.6, 0.2), ('c3', 0xc9a227, 0.6, 0.2),
                                    ('c0d', 0x8b3d1f, 0.6, 0.2), ('c1d', 0x214d7c, 0.6, 0.2), ('c2d', 0x2d6139, 0.6, 0.2), ('c3d', 0x967a1c, 0.6, 0.2)):
        s.mat(name, col, rough, metal, emit=7.0 if name == 'lamp' else 0.0)
    hx, hz = 45.0, 33.0
    # the yard's apron, the gravel round it and the sea beyond the quay on the +X side
    s.disc('ground', 'gravel', 190.0, -0.5, 72)
    s.box('ground', 'asphalt', (0, -0.25, 0), (hx + 18, 0.25, hz + 18))
    for _ in range(14):
        s.box('ground', 'asphalt2', (r.uniform(-hx, hx), 0.012, r.uniform(-hz, hz)), (r.uniform(2, 6), 0.0005, r.uniform(1.5, 4)), yaw=r.uniform(0, 3))
    s.box('ground', 'water', (hx + 18 + 70, -1.9, 0), (70, 0.5, 120))
    s.box('ground', 'concrete', (hx + 18.5, -0.45, 0), (0.6, 0.55, hz + 18))  # the quay edge
    # lane markings: a dashed yellow line 4 m inside the wall, a white cross, hazard stripes by the ramps
    def dashed(x0, z0, x1, z1, mat, width=0.18):
        length = math.hypot(x1 - x0, z1 - z0)
        steps = int(length // 6)
        ux, uz = (x1 - x0) / length, (z1 - z0) / length
        for k in range(steps):
            a0, a1 = k * 6, k * 6 + 3
            s.strip('ground', mat, [(x0 + ux * a0, z0 + uz * a0), (x0 + ux * a1, z0 + uz * a1)], width, 0.02)
    dashed(-hx + 4, -hz + 4, hx - 4, -hz + 4, 'line_y')
    dashed(-hx + 4, hz - 4, hx - 4, hz - 4, 'line_y')
    dashed(-hx + 4, -hz + 4, -hx + 4, hz - 4, 'line_y')
    dashed(hx - 4, -hz + 4, hx - 4, hz - 4, 'line_y')
    dashed(-hx + 10, 0, hx - 10, 0, 'line_w', 0.3)
    dashed(0, -hz + 10, 0, hz - 10, 'line_w', 0.3)

    for idx, b in enumerate(layout['boxes']):
        c, half = (b['x'], b['y'], b['z']), (b['hx'], b['hy'], b['hz'])
        q = yaw_pitch(b['yaw'], b.get('pitch', 0.0))
        if b['kind'] == 'wall':  # a concrete barrier with a red or white band
            s.box('walls', 'concrete', c, half, yaw=b['yaw'], bevel=0.1)
            s.box('walls', 'red' if idx % 2 else 'white', (c[0], c[1] + 0.35, c[2]), (half[0] * 0.98, 0.22, half[2] + 0.04), yaw=b['yaw'])
            s.box('walls', 'concrete2', (c[0], c[1] + half[1] - 0.05, c[2]), (half[0] * 0.98, 0.08, half[2] + 0.06), yaw=b['yaw'])
        elif b['kind'] == 'container':
            t = b.get('tint', 0) % 4
            s.box('obstacles', f'c{t}', c, half, yaw=b['yaw'], bevel=0.04)
            for sgn in (-1, 1):  # the corrugation
                for k in range(-4, 5):
                    p = local_pt(c, q, k * half[0] / 4.6, 0, sgn * (half[2] + 0.02))
                    s.box('obstacles', f'c{t}d', p, (0.07, half[1] * 0.92, 0.04), rot=q)
            end = local_pt(c, q, half[0] + 0.02, 0, 0)  # the doors
            s.box('obstacles', f'c{t}d', end, (0.03, half[1] * 0.95, half[2] * 0.95), rot=q)
            for sgn in (-0.4, 0.4):
                s.box('obstacles', 'steel', local_pt(c, q, half[0] + 0.06, 0, sgn * half[2]), (0.03, half[1] * 0.85, 0.04), rot=q)
        else:  # a steel ramp with chevrons
            s.box('obstacles', 'steel', c, half, yaw=b['yaw'], pitch=b.get('pitch', 0.0), bevel=0.04)
            for k in range(-3, 4):
                p = local_pt(c, q, k * half[0] / 3.4, half[1] + 0.012, 0)
                s.box('obstacles', 'line_y' if k % 2 == 0 else 'dark', p, (half[0] / 8, 0.012, half[2] * 0.96), rot=q)
            for sgn in (-1, 1):
                s.box('obstacles', 'steel_d', local_pt(c, q, 0, half[1] + 0.1, sgn * (half[2] - 0.06)), (half[0], 0.1, 0.06), rot=q)

    # the fence round the yard, light masts, stacks of containers, a warehouse, the cranes and a ship at the quay
    fx, fz = hx + 8, hz + 8
    for k in range(-int(fx // 3), int(fx // 3) + 1):
        for sgn in (-1, 1):
            if sgn > 0 and False:
                continue
            s.box('props', 'steel_d', (k * 3.0, 1.2, sgn * fz), (0.06, 1.2, 0.06))
    for k in range(-int(fz // 3), int(fz // 3) + 1):
        s.box('props', 'steel_d', (-fx, 1.2, k * 3.0), (0.06, 1.2, 0.06))
        s.box('props', 'steel_d', (fx, 1.2, k * 3.0), (0.06, 1.2, 0.06))
    for sgn in (-1, 1):
        s.box('props', 'steel', (0, 2.35, sgn * fz), (fx, 0.04, 0.04))
        s.box('props', 'steel', (0, 0.1, sgn * fz), (fx, 0.04, 0.04))
        s.box('props', 'dark', (0, 1.2, sgn * fz), (fx, 1.1, 0.02))
    s.box('props', 'steel', (-fx, 2.35, 0), (0.04, 0.04, fz))
    s.box('props', 'dark', (-fx, 1.2, 0), (0.02, 1.1, fz))
    s.box('props', 'steel', (fx, 2.35, 0), (0.04, 0.04, fz))
    s.box('props', 'dark', (fx, 1.2, 0), (0.02, 1.1, fz))
    for px, pz in ((-fx, -fz), (fx, -fz), (-fx, fz), (fx, fz), (0, -fz), (0, fz), (-fx, 0), (fx, 0)):
        s.box('props', 'steel_d', (px, 7.5, pz), (0.18, 7.5, 0.18))
        s.box('props', 'lamp', (px, 15.1, pz), (0.9, 0.12, 0.45), yaw=math.atan2(-pz, px) + 1.57)
    for row in range(5):  # stacked containers behind the fence on the far sides
        for col in range(7):
            for lvl in range(r.randint(1, 3)):
                t = r.randrange(4)
                s.box('props', f'c{t}', (-hx - 24 - row * 2.6, 1.3 + lvl * 2.6, -hz + 4 + col * 6.3 - 18), (1.2, 1.3, 3.0), bevel=0.04)
    for col in range(8):
        for lvl in range(r.randint(1, 3)):
            t = r.randrange(4)
            s.box('props', f'c{t}', (-hx + 4 + col * 6.3, 1.3 + lvl * 2.6, -hz - 22), (3.0, 1.3, 1.2), bevel=0.04)
    s.box('props', 'wall', (10, 5, hz + 34), (24, 5, 9), bevel=0.2)
    s.box('props', 'steel_d', (10, 10.4, hz + 34), (24.5, 0.4, 9.5))
    for k in range(6):
        s.box('props', 'dark', (-10 + k * 8, 3, hz + 24.9), (2.2, 3, 0.1))
    for cz in (-22, 20):  # gantry cranes on the quay
        for lx in (-5, 5):
            for lz in (-6, 6):
                s.box('props', 'crane', (hx + 14 + lx * 0.2, 15, cz + lz), (0.45, 15, 0.45))
        s.box('props', 'crane', (hx + 14, 30.5, cz), (1.0, 1.0, 22))
        s.box('props', 'crane', (hx + 14 + 14, 30.5, cz), (14, 0.8, 0.8))
        s.box('props', 'steel_d', (hx + 24, 27.5, cz), (1.6, 1.6, 1.6))
    s.box('props', 'hull', (hx + 56, 1.2, 0), (9, 4.2, 50), bevel=0.4)  # a ship alongside
    s.box('props', 'red', (hx + 56, -1.0, 0), (9.05, 0.8, 50.05))
    s.box('props', 'white', (hx + 62, 9, 40), (4, 6, 6), bevel=0.2)
    for row in range(3):
        for col in range(10):
            for lvl in range(2):
                s.box('props', f'c{(row + col + lvl) % 4}', (hx + 51 + row * 2.6, 6.0 + lvl * 2.6, -42 + col * 6.3), (1.2, 1.3, 3.0))
    for k in range(7):  # bollards
        s.cone('props', 'line_y', (hx + 17.2, 0.0, -45 + k * 15), 0.35, 0.3, 0.7, segs=8)
    # distant city
    for k in range(60):
        a = r.uniform(math.pi * 0.35, math.pi * 1.65)
        d = r.uniform(130, 170)
        w, h = r.uniform(5, 14), r.uniform(10, 55)
        s.box('far', 'city' if k % 2 else 'city2', (math.cos(a) * d, h / 2 - 1, math.sin(a) * d), (w, h / 2, w * r.uniform(0.7, 1.4)), yaw=r.uniform(0, 3))
    return s


BUILDERS = {'ice': build_ice, 'quarry': build_quarry, 'port': build_port}


# ============================================================================== export and preview
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def export(root, name):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f'arena_{name}.glb')
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for c in root.children:
        c.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                              export_materials='EXPORT', export_cameras=False, export_lights=False, export_image_format='NONE')
    return path


def preview(name, layout):
    if not PREVIEW:
        return
    os.makedirs(PREVIEW, exist_ok=True)
    scn = bpy.context.scene
    look = layout['look']
    scn.render.engine = 'CYCLES'
    scn.cycles.device = 'CPU'
    scn.cycles.samples = 12 if QUICK else 48
    scn.cycles.use_denoising = False
    scn.render.resolution_x, scn.render.resolution_y = (900, 506) if QUICK else (1280, 720)
    scn.view_settings.view_transform = 'AgX'
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = srgb(look['sky'])
    bg.inputs['Strength'].default_value = 1.0
    scn.world = world
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.0
    sun.color = srgb(look['sun'])[:3]
    sob = bpy.data.objects.new('sun', sun)
    sob.rotation_euler = (math.radians(55), 0, math.radians(35))
    scn.collection.objects.link(sob)
    cam = bpy.data.cameras.new('cam')
    cam.lens = 28
    cam.clip_end = 900
    cob = bpy.data.objects.new('cam', cam)
    scn.collection.objects.link(cob)
    scn.camera = cob
    reach = 55
    views = {
        'over': (G(-reach * 0.95, reach * 0.85, reach * 0.95), G(0, 0, 0)),
        'low': (G(-reach * 0.55, 3.4, reach * 0.15), G(reach * 0.4, 1.5, -reach * 0.1)),
        'rim': (G(reach * 0.92, 5.5, -reach * 0.1), G(-reach * 0.2, 0.5, reach * 0.1)),
    }
    for vname, (pos, target) in views.items():
        cob.location = pos
        cob.rotation_euler = (target - pos).to_track_quat('-Z', 'Y').to_euler()
        scn.render.filepath = os.path.join(PREVIEW, f'{name}_{vname}.png')
        bpy.ops.render.render(write_still=True)


def main():
    which = os.environ.get('ARENA', 'all')
    names = list(BUILDERS) if which == 'all' else [which]
    for name in names:
        reset()
        layout = {'ice': layouts.ice, 'quarry': layouts.quarry, 'port': layouts.port}[name]()
        root = BUILDERS[name](layout).finish()
        print(f'{name}: {tri_count(root)} triangles in {len(root.children)} meshes')
        path = export(root, name)
        print(f'{name}: wrote {path} ({os.path.getsize(path) // 1024} KB)')
        preview(name, layout)


main()
```

- [ ] **Step 4: Build the models**

Run: `/Applications/Blender.app/Contents/MacOS/Blender -b --python art/arenas/build_arenas.py`
Expected: it prints, for each arena, its triangle count and `wrote .../src/client/assets/arena_<id>.glb` (about 1 MB for the lake, 0.5 MB for the quarry, 0.8 MB for the port)

<!-- check {"cmd": "/Applications/Blender.app/Contents/MacOS/Blender -b --python art/arenas/build_arenas.py", "outcome": "pass", "match": "ice: wrote[\\s\\S]*quarry: wrote[\\s\\S]*port: wrote"} -->

The files are committed (the browser serves them), but nobody edits them: change the script and run it again.

- [ ] **Step 5: Serve them**

`src/client/game/arenaAssets.ts` (Vite turns each `?url` import into the hashed URL of the file in the build):

Create `src/client/game/arenaAssets.ts`:

<!-- op {"kind": "create", "path": "src/client/game/arenaAssets.ts"} -->
```ts
import type { ArenaId } from '../../shared/arenas';
import iceUrl from '../assets/arena_ice.glb?url';
import portUrl from '../assets/arena_port.glb?url';
import quarryUrl from '../assets/arena_quarry.glb?url';

/**
 * Where the Blender scenery of each arena is served from (`art/arenas/build_arenas.py` writes the files). The Stadium has none: its
 * stands, crowd and floodlights are built in `dressing.ts`. An arena with no entry here, or whose file fails to load, is drawn as
 * the plain boxes of its layout.
 */
export const ARENA_SCENERY_URLS: Readonly<Partial<Record<ArenaId, string>>> = { ice: iceUrl, quarry: quarryUrl, port: portUrl };
```

In `src/server/static.ts`:

<!-- op {"kind": "edit", "path": "src/server/static.ts"} -->
```ts
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
```

with:

```ts
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
```

- [ ] **Step 6: Run the tests, then the whole suite**

Run: `npx vitest run tests/client/arenaAssets.test.ts tests/server/static.test.ts`
Expected: both pass

<!-- check {"cmd": "npx vitest run tests/client/arenaAssets.test.ts tests/server/static.test.ts", "outcome": "pass"} -->

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 811} -->

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(art): Blender scenery for the Frozen Lake, the Mud Quarry and the Container Port, built from the layouts, and served as glTF binaries"
```

<!-- commit "feat(art): Blender scenery for the Frozen Lake, the Mud Quarry and the Container Port, built from the layouts, and served as glTF binaries" -->

---

### Task 64: Tyre marks in the colour of the ground, and a brighter port

**Files:**
- Modify: `art/arenas/layouts.py`, `src/shared/arenas/*.json` (the script writes them), `src/shared/arenas.ts`, `src/client/game/skidMarks.ts`, `src/client/game/fx.ts`, `tests/arenas.test.ts`, `tests/client/skidMarks.test.ts`, `tests/client/fx.test.ts`

**Interfaces:**
- Consumes: `ArenaLook`, `parseArena` (Plan 8), `SkidMarks`, `CanvasMarks`, `MarkSurface`, `FxDirector.setArena` (Plan 8).
- Produces: `ArenaLook.marks` (`#rrggbb`, required: `#080604` in the Stadium, `#2a4a6a` on the ice, `#2a1a0e` in the quarry, `#0a0a0a` in the port); `hexToRgb(hex)`; `SkidMarks.setColor(colour)`; `MarkSurface.setColor?(colour)`; `FxDirector.setArena` sets the colour with the extent. The port's sun is brighter (2.6, was 1.9) and its sky light lighter. Nothing here touches the physics: `npm run hash` is unchanged.

- [ ] **Step 1: Write the tests**

Each arena has a mark colour of its own, written `#rrggbb`, and `parseArena` refuses one that is not (and a missing one). The spec asked for white marks on the ice; **on a ground that is nearly white they would not show**, so the lake's marks are a dark blue-grey and the choice is one line in the layout. `hexToRgb` reads the colour (anything else gives the old dark rubber), `SkidMarks` passes it to the surface, and the effects director sets it when the arena changes.

In `tests/arenas.test.ts`:

<!-- op {"kind": "edit", "path": "tests/arenas.test.ts"} -->
```ts
    ['a missing look', (a: any) => { delete a.look; }],
  ])('rejects %s', (_name, damage) => {
```

with:

```ts
    ['a missing look', (a: any) => { delete a.look; }],
    ['a tyre-mark colour that is not #rrggbb', (a: any) => { a.look.marks = 'red'; }],
    ['no tyre-mark colour', (a: any) => { delete a.look.marks; }],
  ])('rejects %s', (_name, damage) => {
```

In `tests/arenas.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/arenas.test.ts"} -->
```ts

describe('arena ids', () => {
```

with:

```ts

describe('the look of each arena', () => {
  it('has a tyre-mark colour of its own, written #rrggbb', () => {
    const colours = ARENA_IDS.map((id) => ARENAS[id].look.marks);
    for (const c of colours) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    expect(new Set(colours).size).toBe(ARENA_IDS.length);
  });
});

describe('arena ids', () => {
```

In `tests/client/skidMarks.test.ts`:

<!-- op {"kind": "edit", "path": "tests/client/skidMarks.test.ts"} -->
```ts
import { describe, expect, it } from 'vitest';
import { SKID, SkidMarks, skidStrength, worldToTexture, type MarkSurface } from '../../src/client/game/skidMarks';

```

with:

```ts
import { describe, expect, it } from 'vitest';
import { SKID, SkidMarks, hexToRgb, skidStrength, worldToTexture, type MarkSurface } from '../../src/client/game/skidMarks';

```

In `tests/client/skidMarks.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/skidMarks.test.ts"} -->
```ts
    expect(skidStrength({ ...rolling, lateral: Number.NaN, handbrake: false })).toBe(0);
  });
```

with:

```ts
    expect(skidStrength({ ...rolling, lateral: Number.NaN, handbrake: false })).toBe(0);
  });
});

describe('the colour of the marks', () => {
  it('reads #rrggbb into three numbers, and falls back to the dark default for anything else', () => {
    expect(hexToRgb('#2a4a6a')).toEqual([42, 74, 106]);
    expect(hexToRgb('#FFFFFF')).toEqual([255, 255, 255]);
    for (const bad of ['', 'red', '#12345', '#gggggg', '2a4a6a']) expect(hexToRgb(bad)).toEqual([8, 6, 4]);
  });

  it('tells the surface the colour of the ground it is drawn on', () => {
    const seen: string[] = [];
    const surface = new Recorder();
    (surface as MarkSurface).setColor = (c) => seen.push(c);
    new SkidMarks(surface).setColor('#2a4a6a');
    expect(seen).toEqual(['#2a4a6a']);
  });
```

In `tests/client/fx.test.ts`:

<!-- op {"kind": "edit", "path": "tests/client/fx.test.ts"} -->
```ts
  extents: number[] = [];
  setExtent(extent: number): void {
```

with:

```ts
  extents: number[] = [];
  colours: string[] = [];
  setColor(c: string): void {
    this.colours.push(c);
  }
  setExtent(extent: number): void {
```

In `tests/client/fx.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/fx.test.ts"} -->
```ts
    expect(t.surface.extents).toEqual([64, SKID.EXTENT]);
  });
});

```

with:

```ts
    expect(t.surface.extents).toEqual([64, SKID.EXTENT]);
  });

  it('draws the marks in the colour of the arena\'s ground', () => {
    const t = setup();
    t.fx.setArena(ARENAS.ice);
    t.fx.setArena(ARENAS.port);
    expect(t.surface.colours).toEqual([ARENAS.ice.look.marks, ARENAS.port.look.marks]);
  });
});

```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/arenas.test.ts tests/client/skidMarks.test.ts tests/client/fx.test.ts`
Expected: FAIL — there is no `look.marks` and no `hexToRgb`

<!-- check {"cmd": "npx vitest run tests/arenas.test.ts tests/client/skidMarks.test.ts tests/client/fx.test.ts", "outcome": "fail", "match": "FAIL|\u00d7|failed"} -->

- [ ] **Step 3: Add the colour**

In `art/arenas/layouts.py`, a `marks` colour in each look, and a brighter port:

<!-- op {"kind": "edit", "path": "art/arenas/layouts.py"} -->
```
        'look': {'sky': '#0b1226', 'fog': '#0b1226', 'fogNear': 70, 'fogFar': 240, 'ground': '#6b4a2f', 'wall': '#8a8d91',
                 'block': '#9a9da1', 'sun': '#fff0d8', 'sunIntensity': 2.4, 'hemiSky': '#9db4ff', 'hemiGround': '#3b2c1c'},
    }
```

with:

```
        'look': {'sky': '#0b1226', 'fog': '#0b1226', 'fogNear': 70, 'fogFar': 240, 'ground': '#6b4a2f', 'wall': '#8a8d91',
                 'block': '#9a9da1', 'sun': '#fff0d8', 'sunIntensity': 2.4, 'hemiSky': '#9db4ff', 'hemiGround': '#3b2c1c', 'marks': '#080604'},
    }
```

In `art/arenas/layouts.py`, replace:

<!-- op {"kind": "edit", "path": "art/arenas/layouts.py"} -->
```
        'look': {'sky': '#a9c7e8', 'fog': '#c9dcef', 'fogNear': 60, 'fogFar': 260, 'ground': '#dff0fb', 'wall': '#f4f9ff',
                 'block': '#9fd0f0', 'sun': '#fff2e0', 'sunIntensity': 2.2, 'hemiSky': '#cfe3ff', 'hemiGround': '#9fb8d0'},
    }
```

with:

```
        'look': {'sky': '#a9c7e8', 'fog': '#c9dcef', 'fogNear': 60, 'fogFar': 260, 'ground': '#dff0fb', 'wall': '#f4f9ff',
                 'block': '#9fd0f0', 'sun': '#fff2e0', 'sunIntensity': 2.2, 'hemiSky': '#cfe3ff', 'hemiGround': '#9fb8d0', 'marks': '#2a4a6a'},
    }
```

In `art/arenas/layouts.py`, replace:

<!-- op {"kind": "edit", "path": "art/arenas/layouts.py"} -->
```
        'look': {'sky': '#d8a066', 'fog': '#c98f58', 'fogNear': 50, 'fogFar': 200, 'ground': '#8a5a32', 'wall': '#6e4a2c',
                 'block': '#7a5b3b', 'sun': '#ffcf99', 'sunIntensity': 2.6, 'hemiSky': '#ffd9a8', 'hemiGround': '#5a3a20'},
    }
```

with:

```
        'look': {'sky': '#d8a066', 'fog': '#c98f58', 'fogNear': 50, 'fogFar': 200, 'ground': '#8a5a32', 'wall': '#6e4a2c',
                 'block': '#7a5b3b', 'sun': '#ffcf99', 'sunIntensity': 2.6, 'hemiSky': '#ffd9a8', 'hemiGround': '#5a3a20', 'marks': '#2a1a0e'},
    }
```

In `art/arenas/layouts.py`, replace:

<!-- op {"kind": "edit", "path": "art/arenas/layouts.py"} -->
```
        'look': {'sky': '#1a1f2e', 'fog': '#252a3a', 'fogNear': 60, 'fogFar': 220, 'ground': '#4a4d52', 'wall': '#6b6e73',
                 'block': '#7d8086', 'sun': '#ffb066', 'sunIntensity': 1.9, 'hemiSky': '#8d9ccf', 'hemiGround': '#33281f'},
    }
```

with:

```
        'look': {'sky': '#1a1f2e', 'fog': '#252a3a', 'fogNear': 60, 'fogFar': 220, 'ground': '#4a4d52', 'wall': '#6b6e73',
                 'block': '#7d8086', 'sun': '#ffb066', 'sunIntensity': 2.6, 'hemiSky': '#a3b2e0', 'hemiGround': '#33281f', 'marks': '#0a0a0a'},
    }
```

Run: `python3 art/arenas/layouts.py`
Expected: it writes the four JSON files again, now with `look.marks`

<!-- check {"cmd": "python3 art/arenas/layouts.py", "outcome": "pass", "match": "port\\.json 26 boxes"} -->

In `src/shared/arenas.ts`:

<!-- op {"kind": "edit", "path": "src/shared/arenas.ts"} -->
```ts
  hemiGround: string;
}
```

with:

```ts
  hemiGround: string;
  /** The colour of the tyre marks on this ground (#rrggbb). */
  marks: string;
}
```

In `src/shared/arenas.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/arenas.ts"} -->
```ts
const str = (v: unknown, path: string): string => (typeof v === 'string' && v.length > 0 ? v : fail(path, 'must be a non-empty string'));
const pairs = (v: unknown, path: string, min: number): Array<[number, number]> => {
```

with:

```ts
const str = (v: unknown, path: string): string => (typeof v === 'string' && v.length > 0 ? v : fail(path, 'must be a non-empty string'));
const hexColour = (v: unknown, path: string): string => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fail(path, 'must be a #rrggbb colour'));
const pairs = (v: unknown, path: string, min: number): Array<[number, number]> => {
```

In `src/shared/arenas.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/arenas.ts"} -->
```ts
    ground: str(l.ground, 'look.ground'), wall: str(l.wall, 'look.wall'), block: str(l.block, 'look.block'), sun: str(l.sun, 'look.sun'),
    sunIntensity: num(l.sunIntensity, 'look.sunIntensity'), hemiSky: str(l.hemiSky, 'look.hemiSky'), hemiGround: str(l.hemiGround, 'look.hemiGround'),
  };
```

with:

```ts
    ground: str(l.ground, 'look.ground'), wall: str(l.wall, 'look.wall'), block: str(l.block, 'look.block'), sun: str(l.sun, 'look.sun'),
    sunIntensity: num(l.sunIntensity, 'look.sunIntensity'), hemiSky: str(l.hemiSky, 'look.hemiSky'), hemiGround: str(l.hemiGround, 'look.hemiGround'), marks: hexColour(l.marks, 'look.marks'),
  };
```

In `src/client/game/skidMarks.ts`:

<!-- op {"kind": "edit", "path": "src/client/game/skidMarks.ts"} -->
```ts
} as const;

```

with:

```ts
} as const;

/** [r, g, b] of a `#rrggbb` colour; the default dark rubber when it is anything else. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : [8, 6, 4];
}

```

In `src/client/game/skidMarks.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/skidMarks.ts"} -->
```ts
  setExtent?(extent: number): void;
}
```

with:

```ts
  setExtent?(extent: number): void;
  /** The marks are drawn in this `#rrggbb` colour from now on (the ground of another arena). */
  setColor?(colour: string): void;
}
```

In `src/client/game/skidMarks.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/skidMarks.ts"} -->
```ts

  /** Another arena: the texture covers a square of half-width `extent` metres from now on, and starts blank. */
```

with:

```ts

  /** The colour the marks are drawn in (it follows the ground). */
  setColor(colour: string): void {
    this.surface.setColor?.(colour);
  }

  /** Another arena: the texture covers a square of half-width `extent` metres from now on, and starts blank. */
```

In `src/client/game/skidMarks.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/skidMarks.ts"} -->
```ts
  private readonly context: CanvasRenderingContext2D;

```

with:

```ts
  private readonly context: CanvasRenderingContext2D;
  private rgb = '8, 6, 4';

```

In `src/client/game/skidMarks.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/skidMarks.ts"} -->
```ts
    const g = this.context;
    g.strokeStyle = `rgba(8, 6, 4, ${alpha.toFixed(3)})`;
    g.lineWidth = width;
```

with:

```ts
    const g = this.context;
    g.strokeStyle = `rgba(${this.rgb}, ${alpha.toFixed(3)})`;
    g.lineWidth = width;
```

In `src/client/game/skidMarks.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/skidMarks.ts"} -->
```ts
  }

  setExtent(extent: number): void {
    this.mesh.geometry.dispose();
```

with:

```ts
  }

  setColor(colour: string): void {
    this.rgb = hexToRgb(colour).join(', ');
  }

  setExtent(extent: number): void {
    this.mesh.geometry.dispose();
```

In `src/client/game/fx.ts`:

<!-- op {"kind": "edit", "path": "src/client/game/fx.ts"} -->
```ts
  setArena(arena: ArenaDef): void {
    this.marks.setExtent(boundsHalfSize(arena.bounds) + 2);
```

with:

```ts
  setArena(arena: ArenaDef): void {
    this.marks.setColor(arena.look.marks);
    this.marks.setExtent(boundsHalfSize(arena.bounds) + 2);
```

- [ ] **Step 4: Run the tests, then the whole suite, then the hash**

Run: `npx vitest run tests/arenas.test.ts tests/client/skidMarks.test.ts tests/client/fx.test.ts`
Expected: all pass

<!-- check {"cmd": "npx vitest run tests/arenas.test.ts tests/client/skidMarks.test.ts tests/client/fx.test.ts", "outcome": "pass"} -->

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 817} -->

Run: `npm run hash`
Expected: prints `8719c2e8`, unchanged

<!-- check {"cmd": "npm run hash", "outcome": "pass", "match": "8719c2e8"} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: tyre marks in the colour of each ground, and a brighter container port"
```

<!-- commit "feat: tyre marks in the colour of each ground, and a brighter container port" -->

---

### Task 65: The scenery loader: on request, once, with a fallback

**Files:**
- Create: `src/client/game/arenaScenery.ts`, `tests/client/arenaScenery.test.ts`

**Interfaces:**
- Consumes: `ARENA_IDS`, `ArenaId` (Plan 8), `VoteCounts` (Plan 8), `ARENA_SCENERY_URLS` (Task 63), three's `GLTFLoader`.
- Produces: `ArenaScenery(urls, load, now?, retryMs?)` with `has(id)`, `peek(id)`, `request(id): Promise<Object3D | null>` and `dispose()`; `loadGltfScenery(url)`; `leadingArenas(counts)`. A model is asked for once however often it is requested, kept for the session, answered with `null` when there is none or it fails (and not asked for again for 15 s), and freed once, on `dispose`.

- [ ] **Step 1: Write the tests**

The loader is tested with a fake that the test completes by hand: one load for any number of requests (also two at once), `null` and no load at all for an arena without a model, `null` for a failure with a wait before the next try (**also when the loader throws instead of rejecting, which must not leave the arena "loading" for good** — a defect the first draft had), two arenas in parallel, geometry and materials freed once on `dispose`, and a model that arrives after `dispose` is freed and not handed out. `leadingArenas` names the arenas with the most votes (all of a tie, none when nobody voted).

Create `tests/client/arenaScenery.test.ts`:

<!-- op {"kind": "create", "path": "tests/client/arenaScenery.test.ts"} -->
```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ArenaScenery, leadingArenas } from '../../src/client/game/arenaScenery';

const urls = { ice: '/a/ice.glb', port: '/a/port.glb' };

/** A loader the test finishes by hand. */
function fakeLoader() {
  const calls: string[] = [];
  const waiting: Array<{ url: string; ok: (o: THREE.Object3D) => void; fail: (e: Error) => void }> = [];
  const load = (url: string): Promise<THREE.Object3D> =>
    new Promise((ok, fail) => {
      calls.push(url);
      waiting.push({ url, ok, fail });
    });
  return { calls, waiting, load };
}
const model = (): THREE.Group => {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
  return g;
};
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('ArenaScenery', () => {
  it('knows which arenas have scenery at all', () => {
    const s = new ArenaScenery(urls, fakeLoader().load);
    expect(s.has('ice')).toBe(true);
    expect(s.has('stadium')).toBe(false);
    expect(s.peek('ice')).toBeNull();
  });

  it('loads a model once, however many times it is asked for, and then has it ready', async () => {
    const l = fakeLoader();
    const s = new ArenaScenery(urls, l.load);
    const a = s.request('ice');
    const b = s.request('ice');
    expect(l.calls).toEqual(['/a/ice.glb']);
    const m = model();
    l.waiting[0]!.ok(m);
    expect(await a).toBe(m);
    expect(await b).toBe(m);
    expect(s.peek('ice')).toBe(m);
    expect(await s.request('ice')).toBe(m);
    expect(l.calls).toHaveLength(1);
  });

  it('answers null at once for an arena without scenery, without asking the loader', async () => {
    const l = fakeLoader();
    const s = new ArenaScenery(urls, l.load);
    expect(await s.request('stadium')).toBeNull();
    expect(l.calls).toEqual([]);
  });

  it('answers null when the model fails to load, so the arena is drawn as boxes, and does not retry at once', async () => {
    const l = fakeLoader();
    let now = 1000;
    const s = new ArenaScenery(urls, l.load, () => now, 15_000);
    const first = s.request('port');
    l.waiting[0]!.fail(new Error('404'));
    expect(await first).toBeNull();
    expect(s.peek('port')).toBeNull();
    now += 5000;
    expect(await s.request('port')).toBeNull();
    expect(l.calls).toHaveLength(1); // a broken file is not asked for again every frame
    now += 11_000;
    const again = s.request('port');
    expect(l.calls).toHaveLength(2); // but it is tried again after a while
    const m = model();
    l.waiting[1]!.ok(m);
    expect(await again).toBe(m);
  });

  it('treats a loader that throws instead of rejecting as a failure', async () => {
    const s = new ArenaScenery(urls, () => {
      throw new Error('boom');
    });
    expect(await s.request('ice')).toBeNull();
    expect(await s.request('ice')).toBeNull(); // and it is not left "loading" for good
  });

  it('can be asked again once a failed load has been forgotten, even when the loader threw', async () => {
    let now = 0;
    let calls = 0;
    const s = new ArenaScenery(urls, () => {
      calls++;
      if (calls === 1) throw new Error('boom');
      return Promise.resolve(model());
    }, () => now, 1000);
    expect(await s.request('ice')).toBeNull();
    now = 2000;
    expect(await s.request('ice')).not.toBeNull();
    expect(calls).toBe(2);
  });

  it('keeps loading two arenas side by side', async () => {
    const l = fakeLoader();
    const s = new ArenaScenery(urls, l.load);
    const a = s.request('ice');
    const b = s.request('port');
    expect(l.calls).toEqual(['/a/ice.glb', '/a/port.glb']);
    const ma = model();
    const mb = model();
    l.waiting[1]!.ok(mb);
    l.waiting[0]!.ok(ma);
    expect([await a, await b]).toEqual([ma, mb]);
    await flush();
  });

  it('frees the geometry and materials of what it loaded, once, when it is disposed', async () => {
    const l = fakeLoader();
    const s = new ArenaScenery(urls, l.load);
    const p = s.request('ice');
    const m = model();
    l.waiting[0]!.ok(m);
    await p;
    let freed = 0;
    const mesh = m.children[0] as THREE.Mesh;
    mesh.geometry.addEventListener('dispose', () => freed++);
    (mesh.material as THREE.Material).addEventListener('dispose', () => freed++);
    s.dispose();
    s.dispose();
    expect(freed).toBe(2);
    expect(s.peek('ice')).toBeNull();
  });

  it('does not hand out a model that arrives after it was disposed', async () => {
    const l = fakeLoader();
    const s = new ArenaScenery(urls, l.load);
    const p = s.request('ice');
    s.dispose();
    l.waiting[0]!.ok(model());
    expect(await p).toBeNull();
    expect(s.peek('ice')).toBeNull();
  });
});

describe('leadingArenas', () => {
  const counts = (o: Partial<Record<'stadium' | 'ice' | 'quarry' | 'port', number>>) => ({ stadium: 0, ice: 0, quarry: 0, port: 0, ...o });

  it('names the arenas with the most votes, and none when nobody voted', () => {
    expect(leadingArenas(counts({}))).toEqual([]);
    expect(leadingArenas(counts({ ice: 1 }))).toEqual(['ice']);
    expect(leadingArenas(counts({ ice: 2, port: 3, quarry: 1 }))).toEqual(['port']);
  });

  it('names all the leaders of a tie, in the order of the panel', () => {
    expect(leadingArenas(counts({ port: 2, ice: 2, stadium: 1 }))).toEqual(['ice', 'port']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/client/arenaScenery.test.ts`
Expected: FAIL — the module does not exist

<!-- check {"cmd": "npx vitest run tests/client/arenaScenery.test.ts", "outcome": "fail", "match": "Cannot find module|FAIL|not a function|Failed|ENOENT"} -->

- [ ] **Step 3: Write the loader**

Create `src/client/game/arenaScenery.ts`:

<!-- op {"kind": "create", "path": "src/client/game/arenaScenery.ts"} -->
```ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ARENA_IDS, type ArenaId } from '../../shared/arenas';
import type { VoteCounts } from '../../shared/protocol';

/** Loads one model. Tests give a fake one; the game uses `loadGltfScenery`. */
export type SceneryLoad = (url: string) => Promise<THREE.Object3D>;

export const loadGltfScenery: SceneryLoad = async (url) => (await new GLTFLoader().loadAsync(url)).scene;

/**
 * The Blender scenery of the arenas: loaded on request (the game asks for the arenas leading the vote, so the winner is ready for the
 * countdown), kept for the rest of the session, and never asked for twice at once. An arena that has no model, or whose model fails
 * to load, answers `null` and is drawn as the boxes of its layout; a failed file is tried again after `retryMs`.
 */
export class ArenaScenery {
  private readonly ready = new Map<ArenaId, THREE.Object3D>();
  private readonly pending = new Map<ArenaId, Promise<THREE.Object3D | null>>();
  private readonly failedAt = new Map<ArenaId, number>();
  private disposed = false;

  constructor(
    private readonly urls: Readonly<Partial<Record<ArenaId, string>>>,
    private readonly load: SceneryLoad,
    private readonly now: () => number = () => performance.now(),
    private readonly retryMs = 15_000,
  ) {}

  /** True when there is a model to load for this arena. */
  has(id: ArenaId): boolean {
    return this.urls[id] !== undefined;
  }

  /** The model, when it is loaded already. Shared: add a clone of it to a scene and never dispose what it holds. */
  peek(id: ArenaId): THREE.Object3D | null {
    return this.ready.get(id) ?? null;
  }

  request(id: ArenaId): Promise<THREE.Object3D | null> {
    const url = this.urls[id];
    if (url === undefined || this.disposed) return Promise.resolve(null);
    const have = this.ready.get(id);
    if (have) return Promise.resolve(have);
    const pending = this.pending.get(id);
    if (pending) return pending;
    const failed = this.failedAt.get(id);
    if (failed !== undefined && this.now() - failed < this.retryMs) return Promise.resolve(null);
    let loading: Promise<THREE.Object3D>;
    try {
      loading = this.load(url);
    } catch (err) {
      loading = Promise.reject(err); // a loader that throws is a loader that fails
    }
    const started = loading
      .then(
        (model): THREE.Object3D | null => {
          if (this.disposed) {
            freeModel(model);
            return null;
          }
          this.ready.set(id, model);
          this.failedAt.delete(id);
          return model;
        },
        (): null => {
          this.failedAt.set(id, this.now());
          return null;
        },
      )
      .finally(() => this.pending.delete(id)); // always after `pending.set` below: a callback of a promise never runs synchronously
    this.pending.set(id, started);
    return started;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of this.ready.values()) freeModel(model);
    this.ready.clear();
  }
}

function freeModel(model: THREE.Object3D): void {
  const seen = new Set<THREE.Material>();
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    for (const m of [o.material].flat()) {
      if (seen.has(m)) continue;
      seen.add(m);
      m.dispose();
    }
  });
}

/** The arenas with the most votes (all of them, on a tie), in the order of the panel; none when nobody voted. */
export function leadingArenas(counts: VoteCounts): ArenaId[] {
  const top = Math.max(...ARENA_IDS.map((id) => counts[id]));
  return top > 0 ? ARENA_IDS.filter((id) => counts[id] === top) : [];
}
```

- [ ] **Step 4: Run the test, then the whole suite**

Run: `npx vitest run tests/client/arenaScenery.test.ts`
Expected: passes

<!-- check {"cmd": "npx vitest run tests/client/arenaScenery.test.ts", "outcome": "pass"} -->

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 828} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(client): a loader for the arena models \u2014 on request, once, shared, null on failure"
```

<!-- commit "feat(client): a loader for the arena models \u2014 on request, once, shared, null on failure" -->

---

### Task 66: The scenery on screen: the view, the scene, and the vote that preloads it

**Files:**
- Modify: `src/client/game/arenaView.ts`, `src/client/game/scene.ts`, `src/client/game/gameClient.ts`, `tests/client/arenaView.test.ts`

**Interfaces:**
- Consumes: `ArenaView`, `createArenaView`, `GameScene` (Plan 8), `ArenaScenery`, `leadingArenas`, `loadGltfScenery` (Task 65), `ARENA_SCENERY_URLS` (Task 63), the `votes` message (Plan 8).
- Produces: `ArenaView.setScenery(model | null)`: the plain ground and boxes (kept in a `plain` group) are hidden while a model is shown, the model is added as a copy that shares its geometry and materials, and `setCrowd(false)` (the Low preset) hides its `props_*` and `far_*` parts; `GameScene.setArena(arena, scenery?)` and `GameScene.setScenery(id, model)`; the game asks for the models of the arenas leading the vote, and draws the model of the round's arena as soon as it is here (the plain boxes until then, and for good if it never comes).

- [ ] **Step 1: Write the tests**

With a stand-in model that has one mesh in each group: the model replaces the plain ground and boxes and the plain ones come back when it goes; the plain boxes stay in the view (a failed load costs nothing); however often the model is set there is one copy; **the copy shares the model's geometry and materials and disposing the view frees none of them** (the loader owns them, and the next time the arena is played they are used again); the Low preset hides the props and the backdrop and the other parts stay; the walls, obstacles and props cast shadows and the backdrop neither casts nor receives them; and the Stadium's own dressing is untouched.

In `tests/client/arenaView.test.ts` (a new `describe` at the end):

<!-- op {"kind": "edit", "path": "tests/client/arenaView.test.ts"} -->
```ts
  });
});

```

with:

```ts
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

```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/client/arenaView.test.ts`
Expected: FAIL — `setScenery` does not exist

<!-- check {"cmd": "npx vitest run tests/client/arenaView.test.ts", "outcome": "fail", "match": "FAIL|\u00d7|failed"} -->

- [ ] **Step 3: Draw the model, and ask for it when the vote points at it**

In `src/client/game/arenaView.ts`:

<!-- op {"kind": "edit", "path": "src/client/game/arenaView.ts"} -->
```ts
  readonly group: THREE.Group;
  /** Shows or hides the crowd (only the Stadium has one). */
  setCrowd(visible: boolean): void;
```

with:

```ts
  readonly group: THREE.Group;
  /** Shows or hides what the graphics preset may drop: the Stadium's crowd, the other arenas' props and backdrop. */
  setCrowd(visible: boolean): void;
```

In `src/client/game/arenaView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/arenaView.ts"} -->
```ts
  setCrowd(visible: boolean): void;
  dispose(): void;
```

with:

```ts
  setCrowd(visible: boolean): void;
  /**
   * Draws a loaded Blender model in place of the plain ground and boxes (null: back to the plain ones). The model is shared, so a copy
   * of it is added and what it holds is never disposed here.
   */
  setScenery(model: THREE.Object3D | null): void;
  dispose(): void;
```

In `src/client/game/arenaView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/arenaView.ts"} -->
```ts

  const texture = options.groundTexture?.();
```

with:

```ts

  const plain = new THREE.Group(); // the ground and the boxes of the layout: what is drawn until (and unless) a model replaces them
  plain.name = 'plain';
  group.add(plain);
  const texture = options.groundTexture?.();
```

In `src/client/game/arenaView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/arenaView.ts"} -->
```ts
  ground.receiveShadow = true;
  group.add(ground);

```

with:

```ts
  ground.receiveShadow = true;
  plain.add(ground);

```

In `src/client/game/arenaView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/arenaView.ts"} -->
```ts
  };
  for (const b of def.boxes) group.add(boxMesh(b, materialFor(b), geometries));

```

with:

```ts
  };
  for (const b of def.boxes) plain.add(boxMesh(b, materialFor(b), geometries));

```

In `src/client/game/arenaView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/arenaView.ts"} -->
```ts

  return {
```

with:

```ts

  let extras = options.crowd;
  let scenery: THREE.Object3D | null = null;
  const applyExtras = (): void => {
    scenery?.traverse((o) => {
      if (o.name.startsWith('props_') || o.name.startsWith('far_')) o.visible = extras;
    });
  };

  return {
```

In `src/client/game/arenaView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/arenaView.ts"} -->
```ts
    group,
    setCrowd: (visible) => dressing?.setCrowd(visible),
    dispose: () => {
```

with:

```ts
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
```

In `src/client/game/arenaView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/arenaView.ts"} -->
```ts
      for (const t of textures) t.dispose();
      group.removeFromParent();
```

with:

```ts
      for (const t of textures) t.dispose();
      scenery = null; // the model is shared: whoever loaded it frees it
      group.removeFromParent();
```

In `src/client/game/scene.ts`:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { boundsRadius, DEFAULT_ARENA, type ArenaDef } from '../../shared/arenas';
import type { QualityProfile } from '../settings';
```

with:

```ts
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { boundsRadius, DEFAULT_ARENA, type ArenaDef, type ArenaId } from '../../shared/arenas';
import type { QualityProfile } from '../settings';
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
  /** Builds the arena of the coming round (ground, walls, obstacles, scenery) and sets the sky, fog and light to its look. */
  setArena(arena: ArenaDef): void;
  dispose(): void;
```

with:

```ts
  /** Builds the arena of the coming round (ground, walls, obstacles, scenery) and sets the sky, fog and light to its look. */
  setArena(arena: ArenaDef, scenery?: THREE.Object3D | null): void;
  /** The Blender model of arena `id` has arrived: draws it in place of the plain boxes, when that arena is the one standing. */
  setScenery(id: ArenaId, model: THREE.Object3D): void;
  dispose(): void;
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
  let view: ArenaView | null = null;
  const setArena = (def: ArenaDef): void => {
    view?.dispose();
```

with:

```ts
  let view: ArenaView | null = null;
  let standing: ArenaId = DEFAULT_ARENA.id;
  const setArena = (def: ArenaDef, scenery: THREE.Object3D | null = null): void => {
    view?.dispose();
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
    view?.dispose();
    view = createArenaView(def, { crowd: crowdVisible, groundTexture: def.id === 'stadium' ? dirtTexture : undefined });
```

with:

```ts
    view?.dispose();
    standing = def.id;
    view = createArenaView(def, { crowd: crowdVisible, groundTexture: def.id === 'stadium' ? dirtTexture : undefined });
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
    scene.add(view.group);
    const look = def.look;
```

with:

```ts
    scene.add(view.group);
    if (scenery) view.setScenery(scenery);
    const look = def.look;
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
    setArena,
    dispose: () => {
```

with:

```ts
    setArena,
    setScenery: (id, model) => {
      if (id === standing) view?.setScenery(model);
    },
    dispose: () => {
```

In `src/client/game/gameClient.ts` (a `votes` message asks for the models of the leading arenas, so the winner is ready for the countdown; entering an arena shows its model when it is loaded, asks for it when it is not, and shows it when it arrives if that arena is still the one standing):

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
import { CarView } from './carView';
import { FxDirector } from './fx';
```

with:

```ts
import { CarView } from './carView';
import { ARENA_SCENERY_URLS } from './arenaAssets';
import { ArenaScenery, leadingArenas, loadGltfScenery } from './arenaScenery';
import { FxDirector } from './fx';
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
  private readonly marks = new CanvasMarks();
  private readonly fx: FxDirector;
```

with:

```ts
  private readonly marks = new CanvasMarks();
  /** The Blender models of the arenas, loaded when the vote points at them. */
  private readonly scenery = new ArenaScenery(ARENA_SCENERY_URLS, loadGltfScenery);
  private readonly fx: FxDirector;
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
    this.marks.dispose();
    this.audio.dispose();
```

with:

```ts
    this.marks.dispose();
    this.scenery.dispose();
    this.audio.dispose();
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
        this.match.onVotes(m);
        break;
```

with:

```ts
        this.match.onVotes(m);
        for (const id of leadingArenas(m.counts)) void this.scenery.request(id); // the winner will be ready for the countdown
        break;
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
    const arena = getArena(id);
    this.opts.gs.setArena(arena);
    this.fx.setArena(arena);
```

with:

```ts
    const arena = getArena(id);
    this.opts.gs.setArena(arena, this.scenery.peek(id)); // the plain boxes until the model is here, and for good if it never comes
    this.fx.setArena(arena);
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
    this.spectator.setBounds(arena.bounds);
  }
```

with:

```ts
    this.spectator.setBounds(arena.bounds);
    if (this.scenery.has(id) && !this.scenery.peek(id)) {
      void this.scenery.request(id).then((model) => {
        if (model && this.arenaId === id && !this.stopped) this.opts.gs.setScenery(id, model);
      });
    }
  }
```

- [ ] **Step 4: Run the tests, then the whole suite**

Run: `npx vitest run tests/client/arenaView.test.ts`
Expected: passes

<!-- check {"cmd": "npx vitest run tests/client/arenaView.test.ts", "outcome": "pass"} -->

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 835} -->

- [ ] **Step 5: Look at every arena in a real browser**

WebGL only animates in a visible browser: use the Playwright browser, not the app's hidden pane. `npm run build`, then a server of your own on a private port with short rounds: `PORT=18290 STATIC_DIR=dist/client BOT_FILL=3 COUNTDOWN_SECONDS=3 ROUND_SECONDS=14 RESULTS_SECONDS=10 node dist/server/index.js`. Open `http://localhost:18290/?auto=quick&name=Tester` at 1280x720. Check, and write what you saw in the ledger:

1. The build lists three `arena_*.glb` files under `assets/`, and the server answers them with `model/gltf-binary`.
2. Vote for each of the lake, the quarry and the port in turn (keys `2`, `3`, `4` during the results): `performance.getEntriesByType('resource')` shows each model fetched **once**, during the vote and before the round starts; in the round the scenery is there — the lake has banks of snow, pines, blocks of ice with shards and mountains; the quarry has terraces, a mound with plank ramps, an excavator, trucks and masts; the port has ribbed containers in four colours, striped steel ramps, light masts, a crane and a warehouse. Take a screenshot of each.
3. The scenery agrees with the physics: a car is stopped by what looks like a wall, the ramps look the way they tilt, and a container you drive into is a container you see.
4. Press `G` until Low: the props and the backdrop disappear, the walls and containers stay. Back to High: they return.
5. Tyre marks are dark blue on the lake, dark brown in the quarry, black in the port.
6. After ten arena changes `debug().render.geometries` and `.textures` are not growing; no console errors.

Stop the server.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(client): the Blender scenery on screen \u2014 preloaded for the arenas leading the vote, with the plain boxes as the fallback, and the Low preset dropping props and backdrop"
```

<!-- commit "feat(client): the Blender scenery on screen \u2014 preloaded for the arenas leading the vote, with the plain boxes as the fallback, and the Low preset dropping props and backdrop" -->

---

### Task 67: Documentation

**Files:**
- Modify: `README.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: Everything above.
- Produces: The README says how the scenery is made, loaded and dropped; `CLAUDE.md` says the models are generated, repeatable, and budgeted by a test.

- [ ] **Step 1: Update the docs**

In `README.md`, a bullet on the scenery:

<!-- op {"kind": "edit", "path": "README.md"} -->
```markdown
- Four arenas: the Stadium (the round dirt bowl), the Frozen Lake (slippery ice, low snow banks, blocks of ice), the Mud Quarry (an oval pit with a raised mound and ramps; the mud drags at the cars and costs a little top speed) and the Container Port (a rectangular yard of shipping containers and two ramps, with a little more grip). Each is a layout file, `src/shared/arenas/<id>.json`, which the server and the browser both build the physics from; `python3 art/arenas/layouts.py` writes them. A room's first round is in a random arena. During the results every player in the room can vote (click a card or press 1 to 4); the arena with the most votes is played next, a tie or no vote at all is settled by the room's seeded random. Bots do not vote. The server and the client agree on the version of the protocol: it is 4.
- Damage comes from impacts, measured as the impulse the collision transmits. Walls hurt half as much as cars, the rear of a car is its sturdiest side and the front its weakest, and scraping or pushing does nothing. A car is out at 0 HP, after 3 s upside down, after 8 s without moving, or when it leaves the arena; after 20 s without hitting or being hit it loses 2 HP per second until it is in a hit. Cars that are out stay in the arena as wrecks.
```

with:

```markdown
- Four arenas: the Stadium (the round dirt bowl), the Frozen Lake (slippery ice, low snow banks, blocks of ice), the Mud Quarry (an oval pit with a raised mound and ramps; the mud drags at the cars and costs a little top speed) and the Container Port (a rectangular yard of shipping containers and two ramps, with a little more grip). Each is a layout file, `src/shared/arenas/<id>.json`, which the server and the browser both build the physics from; `python3 art/arenas/layouts.py` writes them. A room's first round is in a random arena. During the results every player in the room can vote (click a card or press 1 to 4); the arena with the most votes is played next, a tie or no vote at all is settled by the room's seeded random. Bots do not vote. The server and the client agree on the version of the protocol: it is 4.
- Scenery: the Frozen Lake, the Mud Quarry and the Container Port have Blender models (`src/client/assets/arena_<id>.glb`, scenery only, no collision) that `art/arenas/build_arenas.py` builds from the same layouts as the physics: `/Applications/Blender.app/Contents/MacOS/Blender -b --python art/arenas/build_arenas.py` (Blender 5; `ARENA=ice` for one; `PREVIEW=<folder>` also renders pictures). The browser loads the model of the arena leading the vote while the vote is open, so the winner is ready for the countdown; until it arrives, and for good if it never does, the arena is drawn as the plain boxes of its layout. The Low graphics preset drops the props and the backdrop. The Stadium keeps the stands, crowd and floodlights it builds in code. Tyre marks are drawn in the colour of each ground.
- Damage comes from impacts, measured as the impulse the collision transmits. Walls hurt half as much as cars, the rear of a car is its sturdiest side and the front its weakest, and scraping or pushing does nothing. A car is out at 0 HP, after 3 s upside down, after 8 s without moving, or when it leaves the arena; after 20 s without hitting or being hit it loses 2 HP per second until it is in a hit. Cars that are out stay in the arena as wrecks.
```

In `CLAUDE.md`:

<!-- op {"kind": "edit", "path": "CLAUDE.md"} -->
```markdown
- Tuning lives only in `src/shared/constants.ts`; it is frozen at run time except in the offline `?sandbox`. What an arena changes (grip, drag, power of its ground) is in its layout and is read when the cars are built.
- Arena layouts are data: change `art/arenas/layouts.py`, run it, commit the JSON it writes. `tests/arenas.test.ts` checks every layout (spawns, bounds, walls all round).
```

with:

```markdown
- Tuning lives only in `src/shared/constants.ts`; it is frozen at run time except in the offline `?sandbox`. What an arena changes (grip, drag, power of its ground) is in its layout and is read when the cars are built.
- The arena models in `src/client/assets/*.glb` are generated by `art/arenas/build_arenas.py` (Blender, from the layouts; the export is byte-for-byte repeatable): never edit them, and run the script again after changing a layout's boxes. `tests/client/arenaAssets.test.ts` holds them to a size and triangle budget.
- Arena layouts are data: change `art/arenas/layouts.py`, run it, commit the JSON it writes. `tests/arenas.test.ts` checks every layout (spawns, bounds, walls all round).
```

- [ ] **Step 2: Run the whole suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 835} -->

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: the arena scenery \u2014 built in Blender from the layouts, loaded during the vote, dropped by the Low preset"
```

<!-- commit "docs: the arena scenery \u2014 built in Blender from the layouts, loaded during the vote, dropped by the Low preset" -->

---

## Plan 9 done when

- [ ] `npm run typecheck`, `npm test` (835 tests) and `npm run build` pass; the build lists three `arena_*.glb` files; `npm run hash` still prints `8719c2e8`.
- [ ] The browser check of Task 66 was done on a private port: each arena seen with its scenery, each model fetched once during the vote, the Low preset dropping props and backdrop, no console errors, geometries steady over ten arena changes.
- [ ] **The owner has looked at the three arenas** and said what to change in the modelling (colours, density of props, what feels empty).

**Known limits of this baseline:** low-poly procedural models, flat-colour ground; no compression of the models; the lake is very bright; the vote panel is hard to read over it; the numbers of the ground feels and the retune (Plan 8) are still first guesses.

**Next:** Plan 10 (the four car models from `art/`, protocol 5, the menu picker, `CarView` from GLB with dentable panels).
