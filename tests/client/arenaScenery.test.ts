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
