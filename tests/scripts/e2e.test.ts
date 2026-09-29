import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../../src/shared/physics';
import { createGameServer, type GameServer } from '../../src/server/app';
import { copyBundle, createRoom, joinRoom } from '../../scripts/lib/e2e';

beforeAll(async () => {
  await initPhysics();
});

let app: GameServer | null = null;
const dirs: string[] = [];
afterEach(async () => {
  await app?.close();
  app = null;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('createRoom and joinRoom', () => {
  it('speak the protocol version the server speaks, so the end-to-end scripts cannot fall behind it', async () => {
    app = createGameServer({ botFill: 0 });
    const port = await app.listen(0, '127.0.0.1');
    const code = await createRoom(`ws://127.0.0.1:${port}/ws`);
    expect(code).toMatch(/^[A-Z]{4}$/);
    const { ws, welcome } = await joinRoom(`ws://127.0.0.1:${port}/ws`, { mode: 'quick', name: 'Ann' });
    expect(welcome.room.public).toBe(true);
    ws.close();
  });

  it('reject with the server\'s reason when it refuses the join', async () => {
    app = createGameServer({ botFill: 0 });
    const port = await app.listen(0, '127.0.0.1');
    await expect(joinRoom(`ws://127.0.0.1:${port}/ws`, { mode: 'join', code: 'ZZZZ' })).rejects.toThrow(/room_not_found/);
  });

  it('reject when nothing answers in time', async () => {
    await expect(joinRoom('ws://127.0.0.1:1/ws', { mode: 'quick' }, 300)).rejects.toThrow();
  });
});

describe('copyBundle', () => {
  it('copies the built server and client into an empty folder and nothing else', () => {
    const dist = mkdtempSync(path.join(tmpdir(), 'wreckyard-test-'));
    const into = mkdtempSync(path.join(tmpdir(), 'wreckyard-test-'));
    dirs.push(dist, into);
    mkdirSync(path.join(dist, 'server'));
    mkdirSync(path.join(dist, 'client', 'assets'), { recursive: true });
    mkdirSync(path.join(dist, 'other'));
    writeFileSync(path.join(dist, 'server', 'index.js'), '// server');
    writeFileSync(path.join(dist, 'client', 'index.html'), '<html></html>');
    writeFileSync(path.join(dist, 'client', 'assets', 'app.js'), '//');
    writeFileSync(path.join(dist, 'other', 'x.txt'), 'x');
    copyBundle(dist, into);
    expect(readdirSync(into)).toEqual(['dist']);
    expect(readdirSync(path.join(into, 'dist')).sort()).toEqual(['client', 'server']);
    expect(existsSync(path.join(into, 'dist', 'client', 'assets', 'app.js'))).toBe(true);
    expect(existsSync(path.join(into, 'node_modules'))).toBe(false);
  });
});
