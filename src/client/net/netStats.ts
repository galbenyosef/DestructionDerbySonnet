import type { ReconcileResult } from './prediction';

export interface NetStatsSummary {
  /** Snapshots that arrived per second over the last 2 s (any outcome). */
  snapshotsPerSecond: number;
  /** Gap between consecutive arrivals over the last 5 s: mean and worst (jitter shows up as the difference). */
  intervalMeanMs: number;
  intervalMaxMs: number;
  /** How far the local car's present position moved when a snapshot was applied (metres), over the recent history. */
  localErrorP50: number;
  localErrorP95: number;
  localErrorMax: number;
  /** The same for remote cars. */
  remoteErrorP95: number;
  remoteErrorMax: number;
  /** Fraction of applied snapshots that kept the local prediction untouched. */
  deadbandHitRate: number;
  resetsTotal: number;
  deadbandHitsTotal: number;
  /** Average inputs replayed per applied snapshot and the average wall time of the replay. */
  resimStepsAvg: number;
  resimMsAvg: number;
  /** Snapshots ignored as stale, from another world, or malformed. */
  droppedTotal: number;
  /** Corrections too large to smooth, which snapped the car. */
  snapsTotal: number;
  /** Snapshots that arrived while the server was not acknowledging our inputs (a dead or badly delayed uplink). */
  stallsTotal: number;
}

const percentile = (values: readonly number[], q: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
};
const mean = (values: readonly number[]): number => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);
const max = (values: readonly number[]): number => (values.length === 0 ? 0 : Math.max(...values));

/** Rolling prediction and network statistics, exposed as `window.__derby.netStats` and used by scripted lag checks. */
export class NetStats {
  private arrivals: number[] = [];
  private local: number[] = [];
  private remote: number[] = [];
  private replay: number[] = [];
  private replayMs: number[] = [];
  private totals = { resets: 0, deadband: 0, dropped: 0, snaps: 0, stalled: 0 };

  constructor(
    private readonly mySlot: number,
    private readonly capacity = 300,
  ) {}

  /** Records the outcome of one snapshot. `resimMs` is the wall time the reconciliation took. */
  record(arrivalMs: number, result: ReconcileResult, resimMs = 0): void {
    this.arrivals.push(arrivalMs);
    if (this.arrivals.length > 600) this.arrivals.shift();
    if (result.outcome !== 'applied') {
      if (result.outcome !== 'synced') this.totals.dropped++;
      return;
    }
    this.push(this.local, result.localError);
    for (const c of result.corrections) if (c.slot !== this.mySlot) this.push(this.remote, c.error);
    this.push(this.replay, result.resimSteps);
    this.push(this.replayMs, resimMs);
    if (result.stalled) this.totals.stalled++;
    if (result.resetLocal) this.totals.resets++;
    else this.totals.deadband++;
  }

  /** Call when a correction was too large to smooth. */
  recordSnap(): void {
    this.totals.snaps++;
  }

  summary(nowMs: number): NetStatsSummary {
    const recent = this.arrivals.filter((t) => t >= nowMs - 5000);
    const lastTwoSeconds = recent.filter((t) => t >= nowMs - 2000).length;
    const gaps = recent.slice(1).map((t, i) => t - recent[i]!);
    const applied = this.totals.resets + this.totals.deadband;
    return {
      snapshotsPerSecond: lastTwoSeconds / 2,
      intervalMeanMs: mean(gaps),
      intervalMaxMs: max(gaps),
      localErrorP50: percentile(this.local, 0.5),
      localErrorP95: percentile(this.local, 0.95),
      localErrorMax: max(this.local),
      remoteErrorP95: percentile(this.remote, 0.95),
      remoteErrorMax: max(this.remote),
      deadbandHitRate: applied === 0 ? 0 : this.totals.deadband / applied,
      resetsTotal: this.totals.resets,
      deadbandHitsTotal: this.totals.deadband,
      resimStepsAvg: mean(this.replay),
      resimMsAvg: mean(this.replayMs),
      droppedTotal: this.totals.dropped,
      snapsTotal: this.totals.snaps,
      stallsTotal: this.totals.stalled,
    };
  }

  reset(): void {
    this.arrivals = [];
    this.local = [];
    this.remote = [];
    this.replay = [];
    this.replayMs = [];
    this.totals = { resets: 0, deadband: 0, dropped: 0, snaps: 0, stalled: 0 };
  }

  private push(list: number[], value: number): void {
    list.push(value);
    if (list.length > this.capacity) list.shift();
  }
}

/** One compact line for the HUD, e.g. "30/s · err 1.2 cm · kept 96% · replay 7". */
export function formatNetStats(s: NetStatsSummary): string {
  return `${s.snapshotsPerSecond.toFixed(0)}/s · err ${(s.localErrorP95 * 100).toFixed(1)} cm · kept ${(s.deadbandHitRate * 100).toFixed(0)}% · replay ${s.resimStepsAvg.toFixed(0)}`;
}
