import * as THREE from 'three';

/**
 * Samples per pixel for the buffer the scene is drawn into. The renderer's own `antialias: true` only smooths the default
 * framebuffer, and with the bloom pass the scene is drawn into the composer's buffer instead, so that buffer has to be
 * multisampled itself or every edge in the game is jagged.
 */
export const COMPOSER_SAMPLES = 4;

/** The high-range, multisampled buffer the effect composer draws the scene into (its size is set by the composer). */
export function createComposerTarget(samples: number = COMPOSER_SAMPLES): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: Number.isFinite(samples) ? Math.max(0, Math.floor(samples)) : COMPOSER_SAMPLES });
}

/**
 * Whether the scene goes through the effect composer (a high-range buffer, multisampled, with the glow added on top) or straight to
 * the screen. Straight is the cheap way: with neither the glow nor multisampling asked for, the screen's own antialiasing applies.
 */
export const needsComposer = (glow: boolean, samples: number): boolean => glow || samples > 0;
