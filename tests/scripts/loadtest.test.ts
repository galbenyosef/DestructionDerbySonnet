import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../../src/shared/physics';
import { createGameServer, type GameServer } from '../../src/server/app';
import { DEFAULT_LIMITS, evaluate, loadInput, runLoad, type LoadReport } from '../../scripts/lib/loadtest';

beforeAll(async () => {
  await initPhysics();
});

let app: GameServer | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

const good: LoadReport = {
  wanted: 80,
  seated: 80,
  refused: 0,
  peakRooms: 10,
  peakPlayers: 80,
  unexpectedCloses: 0,
  errors: 0,
  snapshotHzMin: 29.5,
  snapshotHzAvg: 30,
  roundsSeen: 40,
  samples: [{ at: 5, rooms: 10, players: 80, connections: 80, tickMsP99: 2.1, rssMb: 200, heapMb: 60 }],
  tickMsP99Max: 2.1,
  rssStartMb: 200,
  rssEndMb: 215,
};

describe('evaluate', () => {
  it('passes a healthy run', () => {
    expect(evaluate(good)).toEqual([]);
  });

  it('names every limit that a run breaks', () => {
    const bad: LoadReport = { ...good, seated: 70, refused: 10, tickMsP99Max: 9.3, rssEndMb: 400, snapshotHzMin: 12, unexpectedCloses: 2, errors: 3, samples: [] };
    const failures = evaluate(bad).join('\n');
    expect(failures).toMatch(/only 70 of 80 players got a seat \(10 refused\)/);
    expect(failures).toMatch(/tick p99 reached 9.3 ms \(limit 4 ms\)/);
    expect(failures).toMatch(/memory grew by 200.0 MB/);
    expect(failures).toMatch(/slowest player got 12.0 snapshots\/s/);
    expect(failures).toMatch(/2 sockets were closed by the server/);
    expect(failures).toMatch(/3 error messages/);
    expect(failures).toMatch(/no health samples/);
  });

  it('applies the limits it is given, and the spec\'s targets by default', () => {
    expect(DEFAULT_LIMITS).toEqual({ tickMsP99: 4, rssGrowthMb: 50, minSnapshotHz: 25 });
    expect(evaluate({ ...good, tickMsP99Max: 6 }, { ...DEFAULT_LIMITS, tickMsP99: 8 })).toEqual([]);
    expect(evaluate({ ...good, rssEndMb: 230 })).toEqual([]); // 30 MB of growth is inside the 50 MB allowance
  });
});

describe('loadInput', () => {
  it('drives forward with a weaving steer, and backs out for one second in nine', () => {
    const forward = loadInput(0, 2);
    expect(forward.throttle).toBe(1);
    expect(Math.abs(forward.steer)).toBeLessThanOrEqual(0.9);
    expect(loadInput(0, 8.5)).toMatchObject({ throttle: -1 });
    expect(loadInput(0, 9.5).throttle).toBe(1);
    const steers = new Set([0, 1, 2, 3, 4].map((i) => loadInput(i, 3).steer.toFixed(3)));
    expect(steers.size).toBe(5); // the players do not all steer alike
  });
});

describe('runLoad', () => {
  it('fills rooms, keeps them driving and reports what the server said about itself', async () => {
    app = createGameServer({ maxRooms: 4, botFill: 0, rules: { countdownTicks: 20, liveTicks: 300, resultsTicks: 30 } });
    const port = await app.listen(0, '127.0.0.1');
    const lines: string[] = [];
    const report = await runLoad({ url: `ws://127.0.0.1:${port}/ws`, rooms: 2, perRoom: 3, seconds: 3, warmupSeconds: 1, sampleSeconds: 0.5, log: (l) => lines.push(l) });
    expect(report).toMatchObject({ wanted: 6, seated: 6, refused: 0, peakRooms: 2, peakPlayers: 6, unexpectedCloses: 0, errors: 0 });
    expect(report.snapshotHzMin).toBeGreaterThan(5); // about 30 on a quiet machine; this is a wiring test, so a busy one must not fail it
    expect(report.samples.length).toBeGreaterThanOrEqual(4);
    expect(report.rssStartMb).toBeGreaterThan(0);
    expect(lines.some((l) => l.startsWith('t='))).toBe(true);
    // how fast the machine is (tick time, snapshot rate) is not what this test is about: only that nobody was refused or hung up on
    expect(evaluate(report, { tickMsP99: 60_000, rssGrowthMb: 500, minSnapshotHz: 0 })).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(app.lobby.playerCount).toBe(0); // everybody left when the run ended
  });

  it('counts the players a full server turns away, and says so', async () => {
    app = createGameServer({ maxRooms: 1, botFill: 0 });
    const port = await app.listen(0, '127.0.0.1');
    const report = await runLoad({ url: `ws://127.0.0.1:${port}/ws`, rooms: 2, perRoom: 1, seconds: 1, warmupSeconds: 0, sampleSeconds: 0.5 });
    expect(report).toMatchObject({ wanted: 2, seated: 1, refused: 1 });
    expect(evaluate(report, { tickMsP99: 50, rssGrowthMb: 500, minSnapshotHz: 0 }).join('\n')).toMatch(/only 1 of 2 players got a seat \(1 refused\)/);
  });
});
