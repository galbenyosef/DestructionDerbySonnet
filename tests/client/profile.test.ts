import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE, PALETTE, PROFILE_KEY, loadProfile, saveProfile } from '../../src/client/profile';

const store = (value: string | null) => ({ getItem: (k: string) => (k === PROFILE_KEY ? value : null) });

describe('the saved profile', () => {
  it('starts with a nameless red sedan', () => {
    expect(DEFAULT_PROFILE).toEqual({ name: '', color: PALETTE[0], car: 'sedan' });
    expect(loadProfile(store(null))).toEqual(DEFAULT_PROFILE);
    expect(loadProfile(null)).toEqual(DEFAULT_PROFILE);
  });

  it('keeps what was saved, the car included', () => {
    const mine = { name: 'Max', color: PALETTE[3]!, car: 'pickup' as const };
    const saved: Record<string, string> = {};
    saveProfile({ setItem: (k, v) => void (saved[k] = v) }, mine);
    expect(loadProfile(store(saved[PROFILE_KEY]!))).toEqual(mine);
  });

  it('is repaired one field at a time: a profile saved before there were four cars gets the sedan and keeps its name and colour', () => {
    expect(loadProfile(store(JSON.stringify({ name: 'Ann', color: PALETTE[2] })))).toEqual({ name: 'Ann', color: PALETTE[2], car: 'sedan' });
    expect(loadProfile(store(JSON.stringify({ name: 'Ann', color: 123, car: 'coupe' })))).toEqual({ name: 'Ann', color: PALETTE[0], car: 'coupe' });
    expect(loadProfile(store(JSON.stringify({ name: 5, color: PALETTE[1], car: 'tank' })))).toEqual({ name: '', color: PALETTE[1], car: 'sedan' });
  });

  it('survives storage that is corrupt, holds the wrong thing, or throws', () => {
    for (const raw of ['not json', 'null', '7', '"x"', '[]']) expect(loadProfile(store(raw))).toEqual(DEFAULT_PROFILE);
    expect(loadProfile({ getItem: () => { throw new Error('blocked'); } })).toEqual(DEFAULT_PROFILE);
    expect(() => saveProfile({ setItem: () => { throw new Error('full'); } }, DEFAULT_PROFILE)).not.toThrow();
    expect(() => saveProfile(null, DEFAULT_PROFILE)).not.toThrow();
  });
});
