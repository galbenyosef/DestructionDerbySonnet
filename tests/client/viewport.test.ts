import { describe, expect, it } from 'vitest';
import { drawingBufferSize, needsResize } from '../../src/client/game/viewport';

/** What three r186 `renderer.setSize(w, h)` allocates: `canvas.width = Math.floor(w * pixelRatio)` (WebGLRenderer.js). */
const allocatedByThree = (w: number, h: number, dpr: number): { width: number; height: number } => ({
  width: Math.floor(w * dpr),
  height: Math.floor(h * dpr),
});

describe('drawingBufferSize', () => {
  it('matches the size three.js allocates, including fractional pixel ratios', () => {
    expect(drawingBufferSize(1001, 720, 1.5)).toEqual({ width: 1501, height: 1080 });
    expect(drawingBufferSize(1002, 720, 1.25)).toEqual({ width: 1252, height: 900 });
    expect(drawingBufferSize(800, 600, 2)).toEqual({ width: 1600, height: 1200 });
  });
});

describe('needsResize', () => {
  // A resize decision that disagrees with three.js re-allocates the WebGL buffer on every single frame.
  it.each([
    [1001, 720, 1.5], // 1501.5 -> 1501
    [1000, 719, 1.5], // 1078.5 -> 1078
    [1002, 720, 1.25], // 1252.5 -> 1252
    [1279, 803, 1.75], // 2238.25 / 1405.25
    [1920, 1080, 1],
    [800, 600, 2],
  ])('is false once the canvas already holds what three allocates for %i x %i at pixel ratio %f', (w, h, dpr) => {
    const canvas = allocatedByThree(w, h, dpr);
    expect(needsResize(canvas.width, canvas.height, w, h, dpr)).toBe(false);
  });

  it('is true when the CSS size or the pixel ratio changes', () => {
    expect(needsResize(1501, 1080, 1101, 720, 1.5)).toBe(true); // wider
    expect(needsResize(1501, 1080, 1001, 730, 1.5)).toBe(true); // taller
    expect(needsResize(1501, 1080, 1001, 720, 2)).toBe(true); // pixel ratio changed
    expect(needsResize(300, 150, 1001, 720, 1.5)).toBe(true); // fresh canvas default size
  });
});
