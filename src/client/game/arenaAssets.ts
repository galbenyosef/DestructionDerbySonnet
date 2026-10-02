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
