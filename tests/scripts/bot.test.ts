import { spawn } from 'node:child_process';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { NET } from '../../src/shared/constants';
import type { WelcomeMessage } from '../../src/shared/protocol';

const welcome = (you: number): WelcomeMessage => ({
  t: 'welcome',
  v: NET.PROTOCOL_VERSION,
  you,
  room: { code: 'TEST', public: true, capacity: 8 },
  epoch: 1,
  players: [],
  tickRate: 60,
  snapshotEvery: 2,
  phase: { t: 'phase', phase: 'live', round: 1, remainingMs: 100_000 },
  scores: [],
});

/** Runs the real bot script against a stand-in server that greets it with `you`, and counts the input frames it sends for `ms`. */
async function inputFramesSent(you: number, ms: number): Promise<number> {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  let frames = 0;
  let greeted!: () => void;
  const hello = new Promise<void>((resolve) => (greeted = resolve));
  server.on('connection', (socket) => {
    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        frames++;
        return;
      }
      socket.send(JSON.stringify(welcome(you)));
      greeted();
    });
  });
  const bot = spawn(process.execPath, ['--import', 'tsx', 'scripts/bot.ts', '--url', `ws://127.0.0.1:${port}/ws`, '--seconds', '30'], { stdio: 'ignore' });
  try {
    await hello;
    frames = 0;
    await new Promise((resolve) => setTimeout(resolve, ms));
    return frames;
  } finally {
    bot.kill();
    server.close();
  }
}

describe('scripts/bot.ts', () => {
  it('keeps sending inputs while it drives, at about 60 a second', async () => {
    const frames = await inputFramesSent(0, 1000);
    expect(frames).toBeGreaterThan(30);
  });

  it('keeps sending inputs while it only watches, or the server drops it as inactive after 30 s', async () => {
    const frames = await inputFramesSent(-1, 1000);
    expect(frames).toBeGreaterThan(30);
  });
});
