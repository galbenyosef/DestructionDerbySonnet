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
    expect(readdirSync(ASSETS).filter((f) => f.startsWith('arena_') && f.endsWith('.glb')).sort()).toEqual(SCENERY.map((id) => `arena_${id}.glb`).sort());
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
