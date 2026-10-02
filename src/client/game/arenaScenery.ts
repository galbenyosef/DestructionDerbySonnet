import { ARENA_IDS, type ArenaId } from '../../shared/arenas';
import type { VoteCounts } from '../../shared/protocol';
import { ModelCache, loadGltfScenery, type SceneryLoad } from './modelCache';

export { loadGltfScenery, type SceneryLoad };

/**
 * The Blender scenery of the arenas: loaded on request (the game asks for the arenas leading the vote, so the winner is ready for the
 * countdown). An arena that has no model, or whose model fails to load, is drawn as the boxes of its layout.
 */
export class ArenaScenery extends ModelCache<ArenaId> {}

/** The arenas with the most votes (all of them, on a tie), in the order of the panel; none when nobody voted. */
export function leadingArenas(counts: VoteCounts): ArenaId[] {
  const top = Math.max(...ARENA_IDS.map((id) => counts[id]));
  return top > 0 ? ARENA_IDS.filter((id) => counts[id] === top) : [];
}
