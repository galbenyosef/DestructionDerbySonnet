import { describe, expect, it } from 'vitest';
import { CAR_IDS, CAR_NAMES, DEFAULT_CAR, carOrDefault, isCarId } from '../src/shared/cars';

describe('car ids', () => {
  it('are the four models, the sedan first, each with a name', () => {
    expect([...CAR_IDS]).toEqual(['sedan', 'coupe', 'wagon', 'pickup']);
    expect(DEFAULT_CAR).toBe('sedan');
    for (const id of CAR_IDS) expect(CAR_NAMES[id].length).toBeGreaterThan(2);
  });

  it('are recognised exactly', () => {
    for (const id of CAR_IDS) expect(isCarId(id)).toBe(true);
    for (const bad of ['', 'Sedan', 'tank', 3, null, undefined, {}, ['sedan'], '__proto__', 'constructor']) expect(isCarId(bad)).toBe(false);
  });

  it('fall back to the sedan for anything else, and keep a good one', () => {
    expect(carOrDefault('pickup')).toBe('pickup');
    for (const bad of ['tank', 7, null, undefined, {}, '__proto__']) expect(carOrDefault(bad)).toBe('sedan');
  });
});
