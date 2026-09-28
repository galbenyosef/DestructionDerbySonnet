import { describe, it, expect } from 'vitest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { clamp } from '../src/shared/math';
import { createGameServer } from '../src/server/app';

describe('toolchain smoke', () => {
  it('shared code is importable', () => {
    expect(clamp(5, 0, 1)).toBe(1);
  });

  it('server serves /healthz and echoes over /ws', async () => {
    const { server, wss } = createGameServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(await health.text()).toBe('ok');

    const echoed = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      ws.on('open', () => ws.send('hi'));
      ws.on('message', (d) => {
        resolve(String(d));
        ws.close();
      });
      ws.on('error', reject);
    });
    expect(echoed).toBe('hi');

    wss.close();
    server.close();
  });
});
