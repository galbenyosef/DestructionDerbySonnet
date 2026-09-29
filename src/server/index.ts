import { initPhysics } from '../shared/physics';
import { createGameServer } from './app';
import { readConfig } from './config';

await initPhysics();

const { port, staticDir, options } = readConfig(process.env);
const app = createGameServer({ staticDir, ...options });

const bound = await app.listen(port);
console.log(`wreckyard listening on :${bound} (static files: ${staticDir})`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().finally(() => process.exit(0));
  });
}
