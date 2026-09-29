// A load test that plays many rooms at once against a running server and reports how the server held up.
import { WebSocket } from 'ws';
import type { CarInput } from '../../src/shared/input';
import { encodeInput } from '../../src/shared/protocol';
import { joinRoom, parseText, sleep } from './e2e';

export interface LoadOptions {
  /** The server's WebSocket address, for example ws://127.0.0.1:8080/ws. */
  url: string;
  /** Where /healthz answers; by default the same host and port as `url`. */
  healthUrl?: string;
  rooms: number;
  /** Players per room, 1 to 8. */
  perRoom: number;
  /** How long the players keep driving once everybody is in. */
  seconds: number;
  /** Health samples taken before this many seconds are left out of the memory comparison, so start-up growth does not count. */
  warmupSeconds: number;
  sampleSeconds: number;
  log?: (line: string) => void;
}

export interface HealthSample {
  /** Seconds since the players were all in. */
  at: number;
  rooms: number;
  players: number;
  connections: number;
  tickMsP99: number;
  rssMb: number;
  heapMb: number;
}

export interface LoadReport {
  wanted: number;
  seated: number;
  refused: number;
  peakRooms: number;
  peakPlayers: number;
  /** Sockets the server closed while the test was still running. */
  unexpectedCloses: number;
  errors: number;
  snapshotHzMin: number;
  snapshotHzAvg: number;
  roundsSeen: number;
  samples: HealthSample[];
  tickMsP99Max: number;
  rssStartMb: number;
  rssEndMb: number;
}

export interface LoadLimits {
  /** The server's 99th-percentile time for one 60 Hz step of all its rooms, in milliseconds. */
  tickMsP99: number;
  /** How much the resident memory may grow between the end of the warm-up and the end of the run. */
  rssGrowthMb: number;
  minSnapshotHz: number;
}

/** The spec's targets: p99 tick 4 ms or better and flat memory; a client should still get about 30 snapshots a second. */
export const DEFAULT_LIMITS: Readonly<LoadLimits> = { tickMsP99: 4, rssGrowthMb: 50, minSnapshotHz: 25 };

/** What one player sends at time `elapsed` (seconds): full throttle with a weaving steer, reversing for one second in nine to leave a wall. */
export function loadInput(index: number, elapsed: number): CarInput {
  const steer = Math.sin(elapsed * (0.5 + 0.13 * (index % 5)) + index) * 0.9;
  if ((elapsed + index * 1.3) % 9 > 8) return { throttle: -1, steer: -steer, handbrake: false };
  return { throttle: 1, steer, handbrake: false };
}

/** The reasons a run fails the limits; empty when it passes. */
export function evaluate(report: LoadReport, limits: LoadLimits = DEFAULT_LIMITS): string[] {
  const failures: string[] = [];
  if (report.seated < report.wanted) failures.push(`only ${report.seated} of ${report.wanted} players got a seat (${report.refused} refused)`);
  if (report.tickMsP99Max > limits.tickMsP99) failures.push(`tick p99 reached ${report.tickMsP99Max} ms (limit ${limits.tickMsP99} ms)`);
  const growth = report.rssEndMb - report.rssStartMb;
  if (growth > limits.rssGrowthMb) failures.push(`memory grew by ${growth.toFixed(1)} MB after the warm-up (limit ${limits.rssGrowthMb} MB)`);
  if (report.seated > 0 && report.snapshotHzMin < limits.minSnapshotHz) failures.push(`the slowest player got ${report.snapshotHzMin.toFixed(1)} snapshots/s (limit ${limits.minSnapshotHz})`);
  if (report.unexpectedCloses > 0) failures.push(`${report.unexpectedCloses} sockets were closed by the server`);
  if (report.errors > 0) failures.push(`${report.errors} error messages from the server`);
  if (report.samples.length === 0) failures.push('no health samples could be read');
  return failures;
}

interface Player {
  index: number;
  ws: WebSocket;
  seq: number;
  snapshots: number;
  closedEarly: boolean;
  finished: boolean;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

async function readHealth(healthUrl: string, at: number): Promise<HealthSample | null> {
  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
    const h = (await res.json()) as Record<string, number>;
    return { at, rooms: h.rooms ?? 0, players: h.players ?? 0, connections: h.connections ?? 0, tickMsP99: h.tickMsP99 ?? 0, rssMb: h.rssMb ?? 0, heapMb: h.heapMb ?? 0 };
  } catch {
    return null;
  }
}

export async function runLoad(options: LoadOptions): Promise<LoadReport> {
  const log = options.log ?? (() => undefined);
  const healthUrl = options.healthUrl ?? `${options.url.replace(/^ws/, 'http').replace(/\/ws$/, '')}/healthz`;
  const players: Player[] = [];
  let refused = 0;
  let errors = 0;
  let rounds = 0;

  const enter = async (hello: Parameters<typeof joinRoom>[1], first: boolean): Promise<string | null> => {
    try {
      const { ws, welcome } = await joinRoom(options.url, hello);
      const player: Player = { index: players.length, ws, seq: 0, snapshots: 0, closedEarly: false, finished: false };
      players.push(player);
      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          player.snapshots++;
          return;
        }
        const msg = parseText(data);
        if (msg?.t === 'error') errors++;
        else if (msg?.t === 'results' && first) rounds++;
      });
      ws.on('close', () => {
        if (!player.finished) player.closedEarly = true;
      });
      return welcome.room.code;
    } catch (err) {
      refused++;
      log(`refused: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  };

  // one room at a time (its host creates it, the others join by code), a little apart so a server with limits is not hit all at once
  for (let room = 0; room < options.rooms; room++) {
    const code = await enter({ mode: 'create', name: `Load ${room}.0` }, true);
    if (code === null) continue;
    for (let i = 1; i < options.perRoom; i++) await enter({ mode: 'join', code, name: `Load ${room}.${i}` }, false);
    await sleep(20);
  }
  log(`${players.length} of ${options.rooms * options.perRoom} players are in`);

  const startedAt = Date.now();
  const pump = setInterval(() => {
    const elapsed = (Date.now() - startedAt) / 1000;
    for (const p of players) {
      if (p.ws.readyState !== WebSocket.OPEN) continue;
      p.seq = (p.seq + 1) >>> 0;
      p.ws.send(encodeInput(p.seq, loadInput(p.index, elapsed)));
    }
  }, 1000 / 60);

  const samples: HealthSample[] = [];
  let peakRooms = 0;
  let peakPlayers = 0;
  const sample = async (): Promise<void> => {
    const s = await readHealth(healthUrl, round1((Date.now() - startedAt) / 1000));
    if (!s) return;
    samples.push(s);
    peakRooms = Math.max(peakRooms, s.rooms);
    peakPlayers = Math.max(peakPlayers, s.players);
    log(`t=${s.at}s rooms=${s.rooms} players=${s.players} tickP99=${s.tickMsP99} ms rss=${s.rssMb} MB heap=${s.heapMb} MB`);
  };
  await sample();
  const sampler = setInterval(() => void sample(), options.sampleSeconds * 1000);
  await sleep(options.seconds * 1000);
  clearInterval(sampler);
  clearInterval(pump);
  const elapsed = (Date.now() - startedAt) / 1000;
  await sample();

  const unexpectedCloses = players.filter((p) => p.closedEarly).length;
  const rates = players.map((p) => p.snapshots / elapsed);
  for (const p of players) {
    p.finished = true;
    p.ws.close();
  }
  await sleep(200);
  const measured = samples.filter((s) => s.at >= options.warmupSeconds);
  return {
    wanted: options.rooms * options.perRoom,
    seated: players.length,
    refused,
    peakRooms,
    peakPlayers,
    unexpectedCloses,
    errors,
    snapshotHzMin: round1(rates.length ? Math.min(...rates) : 0),
    snapshotHzAvg: round1(rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0),
    roundsSeen: rounds,
    samples,
    tickMsP99Max: measured.length ? Math.max(...measured.map((s) => s.tickMsP99)) : 0,
    rssStartMb: measured[0]?.rssMb ?? 0,
    rssEndMb: measured.at(-1)?.rssMb ?? 0,
  };
}
