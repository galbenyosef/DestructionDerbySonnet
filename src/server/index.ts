import path from 'node:path';
import { initPhysics } from '../shared/physics';
import { createGameServer } from './app';

const int = (value: string | undefined, fallback: number): number => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

await initPhysics();

const port = int(process.env.PORT, 8080);
const staticDir = process.env.STATIC_DIR ?? path.resolve(process.cwd(), 'dist/client');
const app = createGameServer({
  staticDir,
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  maxRooms: int(process.env.MAX_ROOMS, 12),
  maxConnections: int(process.env.MAX_CONNECTIONS, 200),
});

const bound = await app.listen(port);
console.log(`wreckyard listening on :${bound} (static files: ${staticDir})`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().finally(() => process.exit(0));
  });
}
