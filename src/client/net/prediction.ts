import { ARENA } from '../../shared/constants';
import { NEUTRAL_INPUT, quantizeInput, type CarInput } from '../../shared/input';
import { vlen, vsub } from '../../shared/math';
import { SNAP_FLAG_ALIVE, SNAP_FLAG_HANDBRAKE, type Snapshot, type SnapshotCar } from '../../shared/protocol';
import { Simulation } from '../../shared/sim';
import type { CarState, Vec3 } from '../../shared/types';
import { lerpState } from './interp';

export interface PredictorOptions {
  /** A local prediction within this distance (m) of the server's state is kept rather than reset. */
  deadbandPos?: number;
  /** ... and within this velocity difference (m/s). */
  deadbandVel?: number;
  /** How many of the most recent local inputs are remembered for re-simulation. */
  historySize?: number;
  /** Within this distance (m) of another car the deadband is off: the exact server state is used, since cars can collide. */
  interactionRange?: number;
  /** First sequence number is startSeq + 1 (tests use it to exercise the u32 wrap). */
  startSeq?: number;
  /** Builds the local world for the given slots; tests inject a failing one. Defaults to `new Simulation(slots)`. */
  createSimulation?: (slots: number[]) => Simulation;
}

export interface Correction {
  slot: number;
  /** The car's present state before reconciliation and after it. */
  before: CarState;
  after: CarState;
  /** Metres the car's present position moved. */
  error: number;
}

export type ReconcileOutcome = 'synced' | 'applied' | 'dropped-epoch' | 'dropped-old' | 'ignored';

export interface ReconcileResult {
  outcome: ReconcileOutcome;
  /** True when the local car was reset to the server's state (false when the deadband kept the prediction). */
  resetLocal: boolean;
  /** Local inputs replayed on top of the server's state. */
  resimSteps: number;
  corrections: Correction[];
  /** Metres the local car's present position moved (0 without a local car). */
  localError: number;
}

export interface PredictedPose {
  slot: number;
  state: CarState;
  flags: number;
  hp: number;
  throttle: number;
  steer: number;
  /** False for cars the latest snapshot no longer lists (a departed player's parked car). */
  visible: boolean;
}

interface HistoryEntry {
  input: CarInput;
  /** The local car's state right after this input was applied in the prediction (null until known). */
  after: CarState | null;
}

const DEFAULTS = { deadbandPos: 0.05, deadbandVel: 0.2, historySize: 240, interactionRange: 10 };

const finiteVec = (v: Vec3): boolean => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const finiteState = (s: CarState): boolean =>
  finiteVec(s.pos) && finiteVec(s.linvel) && finiteVec(s.angvel) &&
  Number.isFinite(s.quat.x) && Number.isFinite(s.quat.y) && Number.isFinite(s.quat.z) && Number.isFinite(s.quat.w);
const distance = (a: Vec3, b: Vec3): number => vlen(vsub(a, b));
const inputOf = (c: SnapshotCar): CarInput => ({
  throttle: c.throttle,
  steer: c.steer,
  handbrake: (c.flags & SNAP_FLAG_HANDBRAKE) !== 0,
});

const none = (outcome: ReconcileOutcome): ReconcileResult => ({
  outcome,
  resetLocal: false,
  resimSteps: 0,
  corrections: [],
  localError: 0,
});

/**
 * Client-side prediction with rollback. Every local 60 Hz tick numbers an input, applies it to a local copy of the
 * whole world and steps it. When a server snapshot arrives, every car is put back to the server's state for the
 * tick that consumed input `ackSeq`, and the inputs the server has not consumed yet are replayed on top, so the
 * result is the server's truth pushed forward to the present. The local car keeps its own (more precise) state when
 * it already agrees with the server within the deadband. Remote cars are advanced with their last known input.
 *
 * DOM-free: it only needs the shared Simulation, so it runs in Node tests against a real server room.
 */
export class Predictor {
  private readonly deadbandPos: number;
  private readonly deadbandVel: number;
  private readonly historySize: number;
  private readonly interactionRange: number;
  private readonly createSimulation: (slots: number[]) => Simulation;
  private sim: Simulation | null = null;
  private epoch: number | null = null;
  private synced = false;
  private seq: number;
  private lastTick = -1;
  /** Why the most recent snapshot was ignored (diagnostics for `window.__derby.debug()`). */
  lastIgnored: string | null = null;
  /**
   * Set when a well-formed snapshot could not be turned into a local world (for example the physics engine failed
   * to load). Prediction cannot work then; callers should fall back to interpolation.
   */
  failure: string | null = null;
  private readonly history = new Map<number, HistoryEntry>();
  private readonly remoteInputs = new Map<number, CarInput>();
  private readonly meta = new Map<number, { flags: number; hp: number; throttle: number; steer: number }>();
  private present = new Set<number>();
  private prev = new Map<number, CarState>();
  private curr = new Map<number, CarState>();
  readonly counters = {
    synced: 0,
    applied: 0,
    droppedEpoch: 0,
    droppedOld: 0,
    ignored: 0,
    resets: 0,
    deadbandHits: 0,
    resimSteps: 0,
    worldRebuilds: 0,
  };

  constructor(
    readonly mySlot: number,
    options: PredictorOptions = {},
  ) {
    this.deadbandPos = options.deadbandPos ?? DEFAULTS.deadbandPos;
    this.deadbandVel = options.deadbandVel ?? DEFAULTS.deadbandVel;
    this.historySize = Math.max(1, Math.floor(options.historySize ?? DEFAULTS.historySize));
    this.interactionRange = options.interactionRange ?? DEFAULTS.interactionRange;
    this.createSimulation = options.createSimulation ?? ((slots) => new Simulation(slots));
    this.seq = (options.startSeq ?? 0) >>> 0;
  }

  /** Sequence number of the newest local input. */
  get sequence(): number {
    return this.seq;
  }

  get isSynced(): boolean {
    return this.synced;
  }

  get worldEpoch(): number | null {
    return this.epoch;
  }

  get hasLocalCar(): boolean {
    return this.sim !== null && this.sim.slots.includes(this.mySlot);
  }

  /**
   * Starts accepting snapshots for a new world. The world itself is built from the first snapshot (it lists exactly
   * the cars the server simulates). Inputs not yet acknowledged are kept so they can be replayed.
   */
  beginWorld(epoch: number): void {
    this.epoch = epoch & 0xff;
    if (this.sim) this.counters.worldRebuilds++;
    this.disposeSim();
    this.synced = false;
    this.lastTick = -1;
    this.remoteInputs.clear();
    this.meta.clear();
    this.present = new Set();
    for (const entry of this.history.values()) entry.after = null;
  }

  /** One local 60 Hz tick: numbers `input`, applies it to the prediction and returns its sequence number to send. */
  step(input: CarInput): number {
    const q = quantizeInput(input);
    this.seq = (this.seq + 1) >>> 0;
    const entry: HistoryEntry = { input: q, after: null };
    this.history.set(this.seq, entry);
    this.history.delete((this.seq - this.historySize) >>> 0);
    if (this.sim && this.synced) {
      this.simulate(q);
      if (this.hasLocalCar) entry.after = this.curr.get(this.mySlot) ?? null;
    }
    return this.seq;
  }

  /** Rewinds to the snapshot and replays the unacknowledged inputs. Never throws on hostile or odd snapshots. */
  reconcile(s: Snapshot): ReconcileResult {
    if (this.epoch === null || s.epoch !== this.epoch) {
      this.counters.droppedEpoch++;
      return none('dropped-epoch');
    }
    if (s.tick <= this.lastTick) {
      this.counters.droppedOld++;
      return none('dropped-old');
    }
    const behind = (this.seq - s.ackSeq) >>> 0;
    const problem =
      behind > 0x7fffffff ? `ack ${s.ackSeq} is ahead of the newest input ${this.seq}`
      : s.cars.length === 0 ? 'no cars'
      : !s.cars.every((c) => finiteState(c.state)) ? 'non-finite state'
      : null;
    if (problem !== null) {
      this.counters.ignored++;
      this.lastIgnored = problem;
      return none('ignored');
    }

    const inSnapshot = new Set(s.cars.map((c) => c.slot));
    let fresh = !this.synced;
    if (!this.sim || !s.cars.every((c) => this.sim!.slots.includes(c.slot))) {
      const slots = [...inSnapshot];
      if (!slots.every((slot) => Number.isInteger(slot) && slot >= 0 && slot < ARENA.MAX_CARS)) {
        this.counters.ignored++;
        this.lastIgnored = `slots out of range: [${slots}]`;
        return none('ignored');
      }
      let next: Simulation;
      try {
        next = this.createSimulation(slots); // the current world is untouched if this throws
      } catch (err) {
        this.failure = err instanceof Error ? err.message : String(err);
        this.counters.ignored++;
        this.lastIgnored = `cannot build a world for slots [${slots}]: ${this.failure}`;
        return none('ignored');
      }
      if (this.sim) {
        this.disposeSim();
        this.counters.worldRebuilds++;
        this.remoteInputs.clear();
        this.meta.clear();
        for (const entry of this.history.values()) entry.after = null;
      }
      this.sim = next;
      fresh = true;
    }
    const sim = this.sim;
    this.lastTick = s.tick;
    this.synced = true;
    const hasLocal = sim.slots.includes(this.mySlot);
    const beforeMap = fresh ? new Map<number, CarState>() : this.curr;

    // 1. put every car back to the server's state at the tick that consumed input `ackSeq`
    const mine = s.cars.find((c) => c.slot === this.mySlot);
    const crowded = mine !== undefined && s.cars.some((c) => c.slot !== this.mySlot && distance(c.state.pos, mine.state.pos) < this.interactionRange);
    const kept = !fresh && hasLocal && !crowded ? this.history.get(s.ackSeq)?.after ?? null : null;
    let keptLocal = false;
    for (const c of s.cars) {
      let state = c.state;
      if (c.slot === this.mySlot) {
        if (kept && distance(kept.pos, c.state.pos) < this.deadbandPos && distance(kept.linvel, c.state.linvel) < this.deadbandVel) {
          state = kept;
          keptLocal = true;
        }
      } else {
        this.remoteInputs.set(c.slot, inputOf(c));
      }
      sim.setState(c.slot, state);
      this.meta.set(c.slot, { flags: c.flags, hp: c.hp, throttle: c.throttle, steer: c.steer });
    }
    for (const slot of sim.slots) if (!inSnapshot.has(slot) && slot !== this.mySlot) this.remoteInputs.set(slot, NEUTRAL_INPUT);
    this.present = inSnapshot;
    this.curr = this.readAll();
    this.prev = this.curr;

    // 2. replay the inputs the server has not consumed yet
    const steps = Math.min(behind, this.historySize);
    for (let i = 0; i < steps; i++) {
      const entry = this.history.get((this.seq - steps + 1 + i) >>> 0);
      this.simulate(entry?.input ?? NEUTRAL_INPUT);
      if (entry && hasLocal) entry.after = this.curr.get(this.mySlot) ?? null;
    }

    const corrections: Correction[] = [];
    if (!fresh) {
      for (const [slot, after] of this.curr) {
        const before = beforeMap.get(slot);
        if (before && inSnapshot.has(slot)) corrections.push({ slot, before, after, error: distance(before.pos, after.pos) });
      }
    }
    const local = corrections.find((c) => c.slot === this.mySlot);
    const resetLocal = hasLocal && !keptLocal;
    if (fresh) this.counters.synced++;
    else {
      this.counters.applied++;
      if (resetLocal) this.counters.resets++;
      if (keptLocal) this.counters.deadbandHits++;
    }
    this.counters.resimSteps += steps;
    return { outcome: fresh ? 'synced' : 'applied', resetLocal, resimSteps: steps, corrections, localError: local?.error ?? 0 };
  }

  /** Poses to draw, interpolated between the last two simulation steps by `alpha` in [0, 1]. Empty until synced. */
  poses(alpha: number): PredictedPose[] {
    if (!this.sim || !this.synced) return [];
    const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;
    const out: PredictedPose[] = [];
    for (const [slot, curr] of this.curr) {
      const meta = this.meta.get(slot);
      const own = slot === this.mySlot ? this.history.get(this.seq)?.input : undefined;
      out.push({
        slot,
        state: lerpState(this.prev.get(slot) ?? curr, curr, a),
        flags: meta?.flags ?? SNAP_FLAG_ALIVE,
        hp: meta?.hp ?? 100,
        throttle: own?.throttle ?? meta?.throttle ?? 0,
        steer: own?.steer ?? meta?.steer ?? 0,
        visible: this.present.has(slot),
      });
    }
    return out;
  }

  dispose(): void {
    this.disposeSim();
    this.history.clear();
    this.remoteInputs.clear();
    this.meta.clear();
  }

  private simulate(localInput: CarInput): void {
    const sim = this.sim!;
    if (sim.slots.includes(this.mySlot)) sim.setInput(this.mySlot, localInput);
    for (const [slot, input] of this.remoteInputs) if (sim.slots.includes(slot)) sim.setInput(slot, input);
    sim.step();
    this.prev = this.curr;
    this.curr = this.readAll();
  }

  private readAll(): Map<number, CarState> {
    const out = new Map<number, CarState>();
    for (const slot of this.sim!.slots) out.set(slot, this.sim!.getState(slot));
    return out;
  }

  private disposeSim(): void {
    this.sim?.dispose();
    this.sim = null;
    this.prev = new Map();
    this.curr = new Map();
  }
}
