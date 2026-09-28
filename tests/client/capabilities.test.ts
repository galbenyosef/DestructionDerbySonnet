import { afterEach, describe, expect, it, vi } from 'vitest';
import { webglAvailable } from '../../src/client/game/capabilities';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('webglAvailable', () => {
  it('is true when a webgl2 context can be created', () => {
    vi.stubGlobal('document', {
      createElement: () => ({ getContext: (kind: string) => (kind === 'webgl2' ? {} : null) }),
    });
    expect(webglAvailable()).toBe(true);
  });

  it('is false when no context is available', () => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
    expect(webglAvailable()).toBe(false);
  });

  it('is false (not a crash) when creating the canvas throws', () => {
    vi.stubGlobal('document', {
      createElement: () => {
        throw new Error('boom');
      },
    });
    expect(webglAvailable()).toBe(false);
  });
});
