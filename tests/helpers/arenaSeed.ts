import type { ArenaId } from '../../src/shared/arenas';
import { Player } from '../../src/server/player';
import { Room } from '../../src/server/room';
import { FakeSocket } from './fakeSocket';

const found = new Map<ArenaId, number>();

/** A room seed whose first round is played in `id` (a room draws its first arena from its seed). Needs Rapier initialised. */
export function seedForArena(id: ArenaId): number {
  const known = found.get(id);
  if (known !== undefined) return known;
  for (let seed = 1; seed < 500; seed++) {
    const room = new Room('SEED', true, () => undefined, { botFill: 0, seed });
    const player = new Player(1, new FakeSocket());
    room.addPlayer(player);
    room.step();
    const arena = room.greeting(player).arena;
    room.dispose();
    if (arena === id) {
      found.set(id, seed);
      return seed;
    }
  }
  throw new Error(`no room seed starts in ${id}`);
}
