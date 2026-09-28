import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import { createGameServer } from './app';

await RAPIER.init();
console.log(`rapier ${RAPIER.version()} initialised in node`);

const { server } = createGameServer();
const port = Number(process.env.PORT ?? 8080);
server.listen(port, () => console.log(`listening on :${port}`));
