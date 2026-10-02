import { describe, expect, it } from 'vitest';
import { ARENA_IDS } from '../../src/shared/arenas';
import { mulberry32 } from '../../src/shared/random';
import { chooseArena, tally } from '../../src/server/vote';

const none = { stadium: 0, ice: 0, quarry: 0, port: 0 };

describe('tally', () => {
  it('counts votes per arena, with zero for the arenas nobody chose', () => {
    expect(tally(['ice', 'port', 'ice'])).toEqual({ stadium: 0, ice: 2, quarry: 0, port: 1 });
    expect(tally([])).toEqual(none);
  });
});

describe('chooseArena', () => {
  it('picks the arena with the most votes', () => {
    expect(chooseArena({ ...none, quarry: 3, ice: 2 }, mulberry32(1))).toBe('quarry');
    expect(chooseArena({ ...none, port: 1 }, mulberry32(99))).toBe('port'); // one vote is enough
  });

  it('breaks a tie between the leaders only, by the seeded random', () => {
    const counts = { ...none, ice: 2, port: 2, stadium: 1 };
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) seen.add(chooseArena(counts, mulberry32(seed)));
    expect([...seen].sort()).toEqual(['ice', 'port']); // both can win, the others never
    expect(chooseArena(counts, mulberry32(5))).toBe(chooseArena(counts, mulberry32(5))); // and a seed decides it the same way each time
  });

  it('picks any arena when nobody voted, each one now and then', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 80; seed++) seen.add(chooseArena(none, mulberry32(seed)));
    expect([...seen].sort()).toEqual([...ARENA_IDS].sort());
  });
});
