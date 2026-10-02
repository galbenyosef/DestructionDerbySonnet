import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Loads one model. Tests give a fake one; the game uses `loadGltfScenery`. */
export type SceneryLoad = (url: string) => Promise<THREE.Object3D>;

export const loadGltfScenery: SceneryLoad = async (url) => (await new GLTFLoader().loadAsync(url)).scene;

/**
 * Blender models by name (arenas, cars): loaded on request, kept for the rest of the session, never asked for twice at once. A name that
 * has no model, or whose model fails to load, answers `null` (the caller draws its plain fallback); a failed file is tried again after
 * `retryMs`. The models are shared: add a clone of one to a scene and never dispose what it holds; `dispose` frees them all.
 */
export class ModelCache<K extends string> {
  private readonly ready = new Map<K, THREE.Object3D>();
  private readonly pending = new Map<K, Promise<THREE.Object3D | null>>();
  private readonly failedAt = new Map<K, number>();
  private disposed = false;

  constructor(
    private readonly urls: Readonly<Partial<Record<K, string>>>,
    private readonly load: SceneryLoad,
    private readonly now: () => number = () => performance.now(),
    private readonly retryMs = 15_000,
  ) {}

  /** True when there is a model to load for this arena. */
  has(id: K): boolean {
    return this.urls[id] !== undefined;
  }

  /** The model, when it is loaded already. Shared: add a clone of it to a scene and never dispose what it holds. */
  peek(id: K): THREE.Object3D | null {
    return this.ready.get(id) ?? null;
  }

  request(id: K): Promise<THREE.Object3D | null> {
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
