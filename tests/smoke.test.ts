import { describe, expect, it } from 'vitest';
import { createGameServer } from '../src/server/app';
import { clamp } from '../src/shared/math';

describe('toolchain smoke', () => {
  it('shared code is importable', () => {
    expect(clamp(5, 0, 1)).toBe(1);
  });

  it('server answers /healthz with JSON', async () => {
    const app = createGameServer();
    const port = await app.listen(0, '127.0.0.1');
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toMatchObject({ ok: true, rooms: 0, players: 0 });
    await app.close();
  });
});
