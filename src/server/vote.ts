import { ARENA_IDS, type ArenaId } from '../shared/arenas';
import type { VoteCounts } from '../shared/protocol';

/** Votes per arena; an arena nobody chose counts zero. */
export function tally(votes: Iterable<ArenaId>): VoteCounts {
  const counts: VoteCounts = { stadium: 0, ice: 0, quarry: 0, port: 0 };
  for (const v of votes) counts[v]++;
  return counts;
}

/**
 * The arena of the next round: the one with the most votes; among arenas with the same top count, `random` picks (so does a
 * room where nobody voted: every arena is then tied at zero). `random` is the room's seeded generator, never `Math.random`.
 */
export function chooseArena(counts: VoteCounts, random: () => number): ArenaId {
  const top = Math.max(...ARENA_IDS.map((id) => counts[id]));
  const leaders = ARENA_IDS.filter((id) => counts[id] === top);
  return leaders[Math.min(leaders.length - 1, Math.floor(random() * leaders.length))]!;
}
