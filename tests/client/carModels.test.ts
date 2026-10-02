import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CarModels } from '../../src/client/game/carModels';
import { CAR_IDS } from '../../src/shared/cars';

describe('CarModels', () => {
  it('has a model for each of the four cars', () => {
    const models = new CarModels(() => Promise.resolve(new THREE.Group()));
    for (const id of CAR_IDS) expect(models.has(id)).toBe(true);
  });

  it('asks for every model once when told to preload, however often that is', async () => {
    const asked: string[] = [];
    const models = new CarModels((url) => {
      asked.push(url);
      return Promise.resolve(new THREE.Group());
    });
    models.preloadAll();
    models.preloadAll();
    await Promise.all(CAR_IDS.map((id) => models.request(id)));
    expect(asked).toHaveLength(4);
    expect(new Set(asked).size).toBe(4);
    for (const id of CAR_IDS) expect(models.peek(id)).not.toBeNull();
  });

  it('answers null for a car whose file does not load, and the others still do', async () => {
    const models = new CarModels((url) => (url.includes('coupe') ? Promise.reject(new Error('404')) : Promise.resolve(new THREE.Group())));
    expect(await models.request('coupe')).toBeNull();
    expect(await models.request('sedan')).not.toBeNull();
  });
});
