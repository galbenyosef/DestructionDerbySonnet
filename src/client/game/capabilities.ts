/** three r186 needs WebGL 2. Never throws. */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!canvas.getContext('webgl2');
  } catch {
    return false;
  }
}
