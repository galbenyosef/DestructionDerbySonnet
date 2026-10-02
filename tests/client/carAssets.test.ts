import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAR_MODEL_URLS, CAR_PICTURE_URLS } from '../../src/client/game/carAssets';
import { CAR_IDS, type CarId } from '../../src/shared/cars';
import { CAR } from '../../src/shared/constants';

const ASSETS = path.resolve('src/client/assets');
/** The pieces the game moves, hides or tints by name. */
const REQUIRED = ['body', 'hood', 'door_L', 'door_R', 'bumper_F', 'bumper_R', 'wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'];
const HAS_TRUNK: Record<CarId, boolean> = { sedan: true, coupe: true, wagon: false, pickup: false };

interface Accessor {
  count: number;
  min?: number[];
  max?: number[];
}
interface Gltf {
  asset: { version: string };
  nodes: Array<{ name?: string; mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[] }>;
  meshes: Array<{ primitives: Array<{ attributes: { POSITION: number }; indices?: number }> }>;
  materials?: Array<{ name?: string }>;
  accessors: Accessor[];
  images?: unknown[];
  buffers: Array<{ uri?: string }>;
}

function readGlb(file: string): Gltf {
  const data = readFileSync(file);
  expect(data.toString('latin1', 0, 4)).toBe('glTF');
  expect(data.readUInt32LE(8)).toBe(data.length);
  return JSON.parse(data.toString('utf8', 20, 20 + data.readUInt32LE(12))) as Gltf;
}

describe('the car models', () => {
  it('are served from a URL each, with a picture for the menu', () => {
    expect(Object.keys(CAR_MODEL_URLS).sort()).toEqual([...CAR_IDS].sort());
    for (const id of CAR_IDS) {
      expect(CAR_MODEL_URLS[id]).toMatch(/\.glb/);
      expect(CAR_PICTURE_URLS[id]).toMatch(/\.png/);
    }
  });

  for (const id of CAR_IDS) {
    describe(id, () => {
      const file = path.join(ASSETS, `car_${id}.glb`);
      const gltf = readGlb(file);
      const named = (name: string) => gltf.nodes.find((n) => n.name === name);

      it('is small: under 600 KB, a valid GLB with everything inside the file', () => {
        expect(statSync(file).size).toBeLessThan(600 * 1024);
        expect(gltf.asset.version).toBe('2.0');
        expect(gltf.images ?? []).toEqual([]);
        for (const b of gltf.buffers) expect(b.uri).toBeUndefined();
      });

      it('is cheap enough for eight on screen: under 17 000 triangles', () => {
        let triangles = 0;
        for (const mesh of gltf.meshes) for (const p of mesh.primitives) triangles += (p.indices === undefined ? gltf.accessors[p.attributes.POSITION]!.count : gltf.accessors[p.indices]!.count) / 3;
        expect(triangles).toBeGreaterThan(8000);
        expect(triangles).toBeLessThan(17_000);
      });

      it('has the pieces the game moves, hides and tints by name, and one paint material', () => {
        for (const name of REQUIRED) expect(named(name), name).toBeDefined();
        expect(named('trunk') !== undefined).toBe(HAS_TRUNK[id]);
        expect((gltf.materials ?? []).filter((m) => /^paint/.test(m.name ?? ''))).toHaveLength(1);
      });

      it('has its wheels where the physics has them, standing on the ground', () => {
        for (const [name, sx, sz] of [['wheel_FR', 1, 1], ['wheel_FL', 1, -1], ['wheel_RR', -1, 1], ['wheel_RL', -1, -1]] as const) {
          const t = named(name)!.translation!;
          expect(t[0]).toBeCloseTo(sx * CAR.WHEEL.X, 2);
          expect(t[1]).toBeCloseTo(CAR.WHEEL.RADIUS, 2); // the model's origin is on the ground
          expect(t[2]).toBeCloseTo(sz * CAR.WHEEL.Z, 2);
        }
      });

      it('is about the size of the physics car (4.6 x 2.0 m, the fenders a few centimetres wider): every model shares one hitbox', () => {
        const mesh = gltf.meshes[named('body')!.mesh!]!;
        const a = gltf.accessors[mesh.primitives[0]!.attributes.POSITION]!;
        expect(a.max![0]! - a.min![0]!).toBeGreaterThan(4.2);
        expect(a.max![0]! - a.min![0]!).toBeLessThan(4.9);
        expect(a.max![2]! - a.min![2]!).toBeGreaterThan(1.7);
        expect(a.max![2]! - a.min![2]!).toBeLessThan(2.25);
      });

      it('moves, turns and scales nothing but the wheels and the number decals', () => {
        const moved = gltf.nodes.filter((n) => n.translation || n.rotation || n.scale).map((n) => n.name);
        for (const name of moved) expect(name, 'a node with a transform').toMatch(/^(wheel_|number_)/);
      });

      it('has a picture for the menu', () => {
        const png = path.join(ASSETS, `car_${id}.png`);
        expect(readFileSync(png).toString('latin1', 1, 4)).toBe('PNG');
        expect(statSync(png).size).toBeLessThan(120 * 1024);
      });
    });
  }
});
