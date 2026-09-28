// Prints the hash of the scripted determinism run. Compare with the browser: `await __derby.simHash()` on any page.
//   npx tsx scripts/hash.ts [ticks]
import { runScripted } from '../src/shared/determinism';
import { initPhysics } from '../src/shared/physics';

await initPhysics();
const ticks = Number(process.argv[2] ?? 600);
const run = runScripted(Number.isFinite(ticks) && ticks > 0 ? Math.floor(ticks) : 600);
console.log(run.hash);
console.error(`ticks=${ticks} closestApproach=${run.closestApproach.toFixed(2)} m topSpeed=${run.topSpeed.toFixed(1)} m/s`);
