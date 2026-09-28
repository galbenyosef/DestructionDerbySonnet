/**
 * Drawing-buffer size for a CSS size and pixel ratio, exactly as three's `renderer.setSize` allocates it (it
 * floors). Rounding here instead makes a fractional pixel ratio (Windows at 125% / 150%) disagree with the real
 * canvas by one pixel, and the buffer would be re-allocated every frame.
 */
export function drawingBufferSize(
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
): { width: number; height: number } {
  return { width: Math.floor(cssWidth * pixelRatio), height: Math.floor(cssHeight * pixelRatio) };
}

/** True when the canvas backing store differs from what `renderer.setSize` would allocate for this layout. */
export function needsResize(
  canvasWidth: number,
  canvasHeight: number,
  cssWidth: number,
  cssHeight: number,
  pixelRatio: number,
): boolean {
  const want = drawingBufferSize(cssWidth, cssHeight, pixelRatio);
  return canvasWidth !== want.width || canvasHeight !== want.height;
}
