import { CAR_IDS, type CarId } from '../../shared/cars';
import { CAR_MODEL_URLS } from './carAssets';
import { ModelCache, loadGltfScenery, type SceneryLoad } from './modelCache';

/** The Blender models of the cars, loaded in the background (a `CarView` is drawn as boxes until its model is here). */
export class CarModels extends ModelCache<CarId> {
  constructor(load: SceneryLoad = loadGltfScenery, urls: Readonly<Partial<Record<CarId, string>>> = CAR_MODEL_URLS) {
    super(urls, load);
  }

  /** Asks for every model at once (about 1.6 MB in all, kept for the session). */
  preloadAll(): void {
    for (const id of CAR_IDS) void this.request(id);
  }
}
