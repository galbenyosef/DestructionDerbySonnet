import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../../src/shared/physics';
import { disposeRooms, join, makeRoom, messages, steps } from '../helpers/roomKit';

beforeAll(async () => {
  await initPhysics();
});
afterEach(disposeRooms);

/** Two players, the second leaves, the round ends at once: the room is in its results phase with Ann in it. */
function inResults(options: Parameters<typeof makeRoom>[0] = {}) {
  const { room } = makeRoom({ rules: { resultsTicks: 120 }, ...options });
  const ann = join(room, 'Ann');
  const bob = join(room, 'Bob');
  steps(room, 20);
  room.removePlayer(bob.player);
  steps(room, 2);
  expect(room.phase).toBe('results');
  return { room, ann, bob };
}
const lastVotes = (s: Parameters<typeof messages>[0]) => messages(s, 'votes').at(-1);
const counts = (ids: Partial<Record<'stadium' | 'ice' | 'quarry' | 'port', number>>) => ({ stadium: 0, ice: 0, quarry: 0, port: 0, ...ids });

describe('Room arena', () => {
  it('names the arena of every round in the roster and the welcome', () => {
    const { room } = makeRoom();
    const ann = join(room, 'Ann');
    room.step();
    const roster = messages(ann.socket, 'roster').at(-1)!;
    expect(['stadium', 'ice', 'quarry', 'port']).toContain(roster.arena);
    expect(room.greeting(ann.player).arena).toBe(roster.arena);
    expect(room.greeting(ann.player).votes).toEqual(counts({}));
  });

  it('plays the first round in an arena chosen by the room seed, and another seed can choose another', () => {
    const first = (seed: number): unknown => {
      const { room } = makeRoom({ seed });
      const p = join(room, 'Ann');
      room.step();
      return messages(p.socket, 'roster').at(-1)!.arena;
    };
    const seen = new Set<unknown>();
    for (let seed = 1; seed <= 40; seed++) seen.add(first(seed));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('Room vote', () => {
  it('counts votes cast during the results and tells everyone', () => {
    const { room, ann } = inResults();
    const cy = join(room, 'Cy'); // a newcomer may vote too
    room.vote(ann.player, 'ice');
    room.vote(cy.player, 'quarry');
    steps(room, 20); // the tally goes out within a quarter of a second
    expect(lastVotes(ann.socket)).toMatchObject({ counts: counts({ ice: 1, quarry: 1 }) });
    expect(lastVotes(cy.socket)).toMatchObject({ counts: counts({ ice: 1, quarry: 1 }) });
  });

  it('lets a vote change, counting only the last one', () => {
    const { room, ann } = inResults();
    room.vote(ann.player, 'ice');
    room.vote(ann.player, 'port');
    steps(room, 20);
    expect(lastVotes(ann.socket)).toMatchObject({ counts: counts({ port: 1 }) });
  });

  it('ignores a vote outside the results phase', () => {
    const { room } = makeRoom();
    const ann = join(room, 'Ann');
    steps(room, 5); // countdown
    room.vote(ann.player, 'ice');
    steps(room, 20);
    expect(messages(ann.socket, 'votes')).toEqual([]);
    expect(room.greeting(ann.player).votes).toEqual(counts({}));
  });

  it('ignores a vote from someone who is not in the room', () => {
    const { room, bob } = inResults();
    room.vote(bob.player, 'ice'); // Bob left
    steps(room, 20);
    expect(lastVotes(join(room, 'Cy').socket)).toBeUndefined();
    expect(room.greeting(room.seated()[0]!).votes).toEqual(counts({}));
  });

  it('drops the vote of a player who leaves', () => {
    const { room, ann } = inResults();
    const cy = join(room, 'Cy');
    room.vote(cy.player, 'ice');
    steps(room, 20);
    expect(lastVotes(ann.socket)).toMatchObject({ counts: counts({ ice: 1 }) });
    room.removePlayer(cy.player);
    steps(room, 20);
    expect(lastVotes(ann.socket)).toMatchObject({ counts: counts({}) });
  });

  it('starts the next round in the arena with the most votes', () => {
    for (const choice of ['ice', 'quarry', 'port', 'stadium'] as const) {
      const { room, ann } = inResults();
      const cy = join(room, 'Cy');
      room.vote(ann.player, choice);
      room.vote(cy.player, choice);
      steps(room, 130);
      expect(room.round).toBe(2);
      expect(messages(ann.socket, 'roster').at(-1)).toMatchObject({ round: 2, arena: choice });
      disposeRooms();
    }
  });

  it('breaks a tie with the room seed, and does the same thing again for the same seed', () => {
    const outcome = (seed: number): unknown => {
      const { room, ann } = inResults({ seed });
      const cy = join(room, 'Cy');
      room.vote(ann.player, 'ice');
      room.vote(cy.player, 'port');
      steps(room, 130);
      return messages(ann.socket, 'roster').at(-1)!.arena;
    };
    const seen = new Set<unknown>();
    for (let seed = 1; seed <= 30; seed++) {
      const a = outcome(seed);
      expect(['ice', 'port']).toContain(a);
      expect(outcome(seed)).toBe(a);
      seen.add(a);
    }
    expect(seen.size).toBe(2);
  });

  it('forgets the votes once the round they chose has started', () => {
    const { room, ann } = inResults();
    room.vote(ann.player, 'ice');
    steps(room, 130);
    expect(messages(ann.socket, 'roster').at(-1)).toMatchObject({ round: 2, arena: 'ice' });
    expect(room.greeting(ann.player).votes).toEqual(counts({}));
  });

  it('picks one of the four when nobody voted', () => {
    const { room, ann } = inResults();
    steps(room, 130);
    expect(['stadium', 'ice', 'quarry', 'port']).toContain(messages(ann.socket, 'roster').at(-1)!.arena);
  });

  it('keeps the same arena when a countdown starts over for a newcomer', () => {
    const { room, ann } = inResults();
    room.vote(ann.player, 'quarry');
    steps(room, 130);
    const arena = messages(ann.socket, 'roster').at(-1)!.arena;
    expect(arena).toBe('quarry');
    join(room, 'Dee'); // restarts the countdown
    steps(room, 3);
    expect(messages(ann.socket, 'roster').at(-1)).toMatchObject({ arena: 'quarry' });
  });

  it('opens each results phase with an empty tally', () => {
    const { room, ann } = inResults();
    expect(lastVotes(ann.socket)).toMatchObject({ counts: counts({}) });
  });
});
