import { describe, expect, it } from 'vitest';
import { COMBAT } from '../../src/shared/constants';
import { RoundState } from '../../src/server/round';

describe('RoundState bookkeeping', () => {
  it('starts every car alive with full hit points', () => {
    const state = new RoundState([0, 1, 2]);
    expect(state.aliveSlots()).toEqual([0, 1, 2]);
    expect(state.hpOf(1)).toBe(COMBAT.MAX_HP);
    expect(state.isAlive(2)).toBe(true);
    expect(state.isAlive(5)).toBe(false); // not in this round
    expect(state.hpOf(5)).toBe(0);
  });

  it('eliminates a car once and says so in a ko message', () => {
    const state = new RoundState([0, 1]);
    expect(state.eliminate(1, 'flipped', 500)).toEqual({ t: 'ko', tick: 500, victim: 1, killer: -1, assists: [], reason: 'flipped' });
    expect(state.isAlive(1)).toBe(false);
    expect(state.hpOf(1)).toBe(0);
    expect(state.aliveSlots()).toEqual([0]);
    expect(state.eliminate(1, 'bounds', 501)).toBeNull(); // already out
    expect(state.eliminate(7, 'bounds', 501)).toBeNull(); // not in this round
  });

  it('names the leader: the alive car with the most HP, or nobody when the best two are level', () => {
    const state = new RoundState([0, 1, 2]);
    expect(state.leader()).toBe(-1); // all level
    state.status.get(1)!.hp = 80;
    state.status.get(0)!.hp = 60;
    state.status.get(2)!.hp = 40;
    expect(state.leader()).toBe(1);
    state.eliminate(1, 'damage', 10);
    expect(state.leader()).toBe(0); // a wreck never leads, whatever it had
    state.eliminate(0, 'damage', 11);
    state.eliminate(2, 'damage', 12);
    expect(state.leader()).toBe(-1);
  });

  it('adds the win bonus to a car\'s points for the round', () => {
    const state = new RoundState([0, 1]);
    state.awardWin(1);
    expect(state.status.get(1)!.gained).toBe(COMBAT.WIN_POINTS);
    expect(state.status.get(0)!.gained).toBe(0);
    state.awardWin(9); // not in this round: ignored
  });
});
