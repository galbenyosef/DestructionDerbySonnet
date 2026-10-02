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
