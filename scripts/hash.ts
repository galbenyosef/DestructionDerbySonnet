// Prints the hash of the scripted determinism run. Compare with the browser: `await __derby.simHash()` on any page.
//   npx tsx scripts/hash.ts [ticks] [arena]      arena: stadium (default), ice, quarry or port
import { getArena, isArenaId } from '../src/shared/arenas';
import { runScripted } from '../src/shared/determinism';
import { initPhysics } from '../src/shared/physics';

await initPhysics();
const ticks = Number(process.argv[2] ?? 600);
const id = process.argv[3] ?? 'stadium';
if (!isArenaId(id)) {
  console.error(`unknown arena "${id}" (stadium, ice, quarry or port)`);
  process.exit(1);
}
const run = runScripted(Number.isFinite(ticks) && ticks > 0 ? Math.floor(ticks) : 600, [0, 1, 2], getArena(id));
console.log(run.hash);
console.error(`arena=${id} ticks=${ticks} closestApproach=${run.closestApproach.toFixed(2)} m topSpeed=${run.topSpeed.toFixed(1)} m/s`);
