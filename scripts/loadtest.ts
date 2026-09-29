// Plays many rooms at once against a running server and says whether it held up.
//   npx tsx scripts/loadtest.ts [--url ws://127.0.0.1:8080/ws] [--rooms 10] [--per-room 8] [--seconds 300] [--warmup 60]
//                               [--sample 5] [--max-tick-ms 4] [--max-rss-growth-mb 50] [--min-snapshot-hz 25]
// Start the server first, with short rounds so the rooms keep cycling and no per-address limit in the way, for example:
//   MAX_ROOMS=12 BOT_FILL=0 MAX_CONNECTIONS_PER_IP=0 COUNTDOWN_SECONDS=3 ROUND_SECONDS=30 RESULTS_SECONDS=5 npm start
import { DEFAULT_LIMITS, evaluate, runLoad } from './lib/loadtest';

function arg(name: string, fallback: number | string): string {
  const i = process.argv.indexOf(`--${name}`);
  return (i >= 0 ? process.argv[i + 1] : undefined) ?? String(fallback);
}
const number = (name: string, fallback: number): number => {
  const n = Number(arg(name, fallback));
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} must be a positive number`);
  return n;
};

const options = {
  url: arg('url', 'ws://127.0.0.1:8080/ws'),
  rooms: Math.floor(number('rooms', 10)),
  perRoom: Math.min(8, Math.floor(number('per-room', 8))),
  seconds: number('seconds', 300),
  warmupSeconds: number('warmup', 60),
  sampleSeconds: number('sample', 5),
  log: (line: string) => console.log(line),
};
const limits = {
  tickMsP99: number('max-tick-ms', DEFAULT_LIMITS.tickMsP99),
  rssGrowthMb: number('max-rss-growth-mb', DEFAULT_LIMITS.rssGrowthMb),
  minSnapshotHz: number('min-snapshot-hz', DEFAULT_LIMITS.minSnapshotHz),
};

console.log(`load test: ${options.rooms} rooms x ${options.perRoom} players for ${options.seconds} s against ${options.url}`);
const report = await runLoad(options);
const { samples, ...summary } = report;
console.log(JSON.stringify(summary, null, 2));
const failures = evaluate(report, limits);
if (failures.length === 0) {
  console.log('PASS');
} else {
  console.log(`FAIL\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
}
