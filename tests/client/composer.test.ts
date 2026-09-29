import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { COMPOSER_SAMPLES, createComposerTarget, needsComposer } from '../../src/client/game/composer';

describe('createComposerTarget', () => {
  it('is a multisampled, high-range buffer: the scene is drawn into it, and the renderer\'s own antialiasing does not reach it', () => {
    const target = createComposerTarget();
    expect(COMPOSER_SAMPLES).toBeGreaterThanOrEqual(4);
    expect(target.samples).toBe(COMPOSER_SAMPLES);
    expect(target.texture.type).toBe(THREE.HalfFloatType);
    target.dispose();
  });

  it('keeps its sample count when the composer makes its second buffer from it', () => {
    const target = createComposerTarget();
    const copy = target.clone();
    expect(copy.samples).toBe(target.samples);
    target.dispose();
    copy.dispose();
  });

  it('can be asked for fewer samples, or none', () => {
    expect(createComposerTarget(2).samples).toBe(2);
    expect(createComposerTarget(0).samples).toBe(0);
    expect(createComposerTarget(Number.NaN).samples).toBe(COMPOSER_SAMPLES);
  });
});

describe('needsComposer', () => {
  it('sends the scene through the composer for the glow or for multisampling, and straight to the screen for neither', () => {
    expect(needsComposer(true, 4)).toBe(true);
    expect(needsComposer(true, 0)).toBe(true); // the glow alone still needs the buffer
    expect(needsComposer(false, 2)).toBe(true); // so does antialiasing with the glow off (?bloom=0 on High)
    expect(needsComposer(false, 0)).toBe(false); // Low: the screen's own antialiasing applies
  });
});
