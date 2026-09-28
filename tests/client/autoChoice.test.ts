import { describe, expect, it } from 'vitest';
import { automaticChoice } from '../../src/client/ui/autoChoice';
import { PALETTE } from '../../src/client/ui/menu';

const choice = (query: string) => automaticChoice(new URLSearchParams(query));

describe('automaticChoice (?auto= routing that skips the menu)', () => {
  it('does nothing without an auto parameter', () => {
    expect(choice('')).toBeNull();
    expect(choice('name=Max&color=2')).toBeNull();
    expect(choice('auto=')).toBeNull();
  });

  it('maps quick and create with the default name and colour', () => {
    expect(choice('auto=quick')).toEqual({ name: 'Guest', color: PALETTE[0], mode: 'quick' });
    expect(choice('auto=create&name=Max')).toEqual({ name: 'Max', color: PALETTE[0], mode: 'create' });
  });

  it('normalises the room code for join', () => {
    expect(choice('auto=join:abcd&name=Ann')).toEqual({ name: 'Ann', color: PALETTE[0], mode: 'join', code: 'ABCD' });
  });

  it('refuses codes that can never exist and unknown modes', () => {
    for (const q of ['auto=join:', 'auto=join:ABC', 'auto=join:ABCDE', 'auto=join:ROOM', 'auto=join:AB1D', 'auto=spectate', 'auto=JOIN:ABCD']) {
      expect(choice(q)).toBeNull();
    }
  });

  it('picks the colour by palette index and copes with hostile values', () => {
    expect(choice('auto=quick&color=3')!.color).toBe(PALETTE[3]);
    expect(choice(`auto=quick&color=${PALETTE.length + 2}`)!.color).toBe(PALETTE[2]); // wraps
    expect(choice('auto=quick&color=-4')!.color).toBe(PALETTE[4]); // sign ignored
    expect(choice('auto=quick&color=2.7')!.color).toBe(PALETTE[2]); // fractions floor
    for (const bad of ['abc', 'NaN', 'Infinity', '']) expect(choice(`auto=quick&color=${bad}`)!.color).toBe(PALETTE[0]);
  });
});
