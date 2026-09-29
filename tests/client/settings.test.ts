import { describe, expect, it } from 'vitest';
import { AutoQuality, DEFAULT_SETTINGS, QUALITIES, QUALITY, loadSettings, lowerQuality, nextQuality, saveSettings, type Settings } from '../../src/client/settings';

const memory = (initial?: string) => {
  const data = new Map<string, string>(initial === undefined ? [] : [['wreckyard.settings', initial]]);
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};

describe('QUALITY presets', () => {
  it('get cheaper step by step: every number of a lower preset is no bigger, and every switch is no more on', () => {
    for (let i = 1; i < QUALITIES.length; i++) {
      const lower = QUALITY[QUALITIES[i - 1]!];
      const higher = QUALITY[QUALITIES[i]!];
      expect(lower.pixelRatio).toBeLessThanOrEqual(higher.pixelRatio);
      expect(lower.msaa).toBeLessThanOrEqual(higher.msaa);
      expect(lower.shadowMapSize).toBeLessThanOrEqual(higher.shadowMapSize);
      expect(lower.particles).toBeLessThanOrEqual(higher.particles);
      expect(lower.debris).toBeLessThanOrEqual(higher.debris);
      for (const key of ['shadows', 'bloom', 'crowd'] as const) expect(Number(lower[key])).toBeLessThanOrEqual(Number(higher[key]));
    }
    expect(QUALITY.low.pixelRatio).toBeGreaterThanOrEqual(1);
    expect(QUALITY.low.particles).toBeGreaterThan(0); // low still shows something
  });
});

describe('QUALITY antialiasing', () => {
  it('multisamples the scene at four samples on High, two on Medium, and on Low draws it straight to the screen with none', () => {
    expect(QUALITY.high.msaa).toBe(4);
    expect(QUALITY.medium.msaa).toBe(2);
    expect(QUALITY.low.msaa).toBe(0);
  });
});

describe('loadSettings and saveSettings', () => {
  it('give the defaults when nothing is saved, and when there is no storage at all', () => {
    expect(loadSettings(memory())).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('remember what was saved', () => {
    const store = memory();
    const chosen: Settings = { quality: 'low', volume: 0.25, muted: true };
    saveSettings(store, chosen);
    expect(loadSettings(store)).toEqual(chosen);
  });

  it('repair a damaged or hostile entry one field at a time instead of failing', () => {
    expect(loadSettings(memory('{not json'))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(memory('null'))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(memory(JSON.stringify({ quality: 'ultra', volume: 7, muted: 'yes' })))).toEqual({ quality: 'high', volume: 1, muted: false });
    expect(loadSettings(memory(JSON.stringify({ quality: 'medium', volume: -3 })))).toEqual({ quality: 'medium', volume: 0, muted: false });
    expect(loadSettings(memory(JSON.stringify({ volume: Number.NaN, quality: 'low' }))).quality).toBe('low');
  });

  it('survive storage that throws (private browsing, quota)', () => {
    const angry = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
    expect(loadSettings(angry)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(angry, DEFAULT_SETTINGS)).not.toThrow();
  });
});

describe('lowerQuality and nextQuality', () => {
  it('step down to the bottom and stop, and cycle round for the G key', () => {
    expect(lowerQuality('high')).toBe('medium');
    expect(lowerQuality('medium')).toBe('low');
    expect(lowerQuality('low')).toBeNull();
    expect([nextQuality('low'), nextQuality('medium'), nextQuality('high')]).toEqual(['medium', 'high', 'low']);
  });
});

describe('AutoQuality', () => {
  const run = (auto: AutoQuality, fps: number, seconds: number): number => {
    let downgrades = 0;
    const dt = 1 / fps;
    for (let t = 0; t < seconds; t += dt) if (auto.frame(dt)) downgrades++;
    return downgrades;
  };

  it('never asks for anything while the game runs at a steady 60 frames a second', () => {
    expect(run(new AutoQuality(), 60, 60)).toBe(0);
  });

  it('asks once for a step down after two slow windows, when the frame rate stays at 25', () => {
    expect(run(new AutoQuality(), 25, 30)).toBeGreaterThanOrEqual(1);
    const auto = new AutoQuality({ warmupSeconds: 0 });
    let first = -1;
    let elapsed = 0;
    for (let i = 0; i < 25 * 30 && first < 0; i++) {
      elapsed += 1 / 25;
      if (auto.frame(1 / 25)) first = elapsed;
    }
    expect(first).toBeGreaterThan(5.9); // two windows of three seconds
    expect(first).toBeLessThan(6.2);
  });

  it('does not count the warm-up: slow frames while things load are not held against the game', () => {
    const auto = new AutoQuality({ warmupSeconds: 5 });
    expect(run(auto, 10, 5)).toBe(0); // the warm-up itself, very slow
    expect(run(auto, 60, 30)).toBe(0); // then fine
  });

  it('gives a slow patch that does not last a chance to recover, and forgives a hidden tab', () => {
    const auto = new AutoQuality({ warmupSeconds: 0 });
    expect(run(auto, 20, 3.5)).toBe(0); // one slow window
    expect(run(auto, 60, 6)).toBe(0); // a good one wipes it
    expect(run(auto, 20, 3.5)).toBe(0);
    expect(auto.frame(30)).toBe(false); // the tab was hidden for half a minute: one huge frame
    expect(run(auto, 20, 3.5)).toBe(0); // the count started over
  });

  it('starts over with its own short warm-up after a change (reset)', () => {
    const auto = new AutoQuality({ warmupSeconds: 0 });
    expect(run(auto, 20, 7)).toBeGreaterThanOrEqual(1);
    auto.reset();
    expect(run(auto, 20, 2)).toBe(0); // the warm-up after a change
    expect(run(auto, 20, 8)).toBeGreaterThanOrEqual(1); // still slow: asks again
  });

  it('ignores broken frame times', () => {
    const auto = new AutoQuality({ warmupSeconds: 0 });
    for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(auto.frame(dt)).toBe(false);
  });
});
