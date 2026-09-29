import { ARENA, COMBAT } from '../../shared/constants';
import { NEUTRAL_INPUT, PARKED_INPUT, quantizeInput, type CarInput } from '../../shared/input';
import { quatConjugate, quatMul, quatNormalize, vadd, vlen, vsub } from '../../shared/math';
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
  /**
   * More unacknowledged inputs than this means the server is not hearing us (a dead uplink) rather than that they are
   * in flight: the local car then shows the server's state, coasting on neutral input like the server plays it, and nothing is
   * replayed. Keep it above any `?lag` round trip.
   */
  stallTicks?: number;
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
  /** True when so many inputs were unacknowledged that nothing was replayed (see `PredictorOptions.stallTicks`). */
  stalled: boolean;
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

/** The local car touching another car or a wall, as the local prediction saw it (`kns` in kN·s; `point` in the local car's own frame). */
export interface LocalImpact {
  /** The local car's slot. */
  slot: number;
  /** The car it touched, or -1 for a wall or an obstacle. */
  other: number;
  kns: number;
  point: Vec3;
}

/** More than this many unread impacts means nobody is reading them: the oldest are dropped. */
const MAX_UNREAD_IMPACTS = 64;

interface HistoryEntry {
  input: CarInput;
  /** The local car's state right after this input was applied in the prediction (null until known). */
  after: CarState | null;
}

const DEFAULTS = { deadbandPos: 0.05, deadbandVel: 0.2, historySize: 240, interactionRange: 10, stallTicks: 180 };
/**
 * A dead uplink shows as the unacknowledged count growing on every snapshot — this many in a row, above the minimum —
 * after acknowledgements had been arriving. (Before the very first acknowledgement the count also grows for one round
 * trip on any connection, so that is not evidence of anything.)
 */
const STALL_STREAK = 8;
const STALL_MIN_BEHIND = 24;

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
  stalled: false,
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
  private readonly stallTicks: number;
  private readonly createSimulation: (slots: number[]) => Simulation;
  private sim: Simulation | null = null;
  private epoch: number | null = null;
  private synced = false;
  private live = true;
  private stalled = false;
  private lastBehind: number | null = null;
  private lastAck: number | null = null;
  private ackSeen = false;
  private growthStreak = 0;
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
  private impacts: LocalImpact[] = [];
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
    stalls: 0,
  };

  constructor(
    /** The slot of the local car in the current world (-1: none, the player is watching). Changes with every round. */
    public mySlot: number,
    options: PredictorOptions = {},
  ) {
    this.deadbandPos = options.deadbandPos ?? DEFAULTS.deadbandPos;
    this.deadbandVel = options.deadbandVel ?? DEFAULTS.deadbandVel;
    this.historySize = Math.max(1, Math.floor(options.historySize ?? DEFAULTS.historySize));
    this.interactionRange = options.interactionRange ?? DEFAULTS.interactionRange;
    this.stallTicks = Math.max(1, Math.floor(options.stallTicks ?? DEFAULTS.stallTicks));
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

  /** True while the server is not acknowledging our inputs (see `PredictorOptions.stallTicks`). */
  get isStalled(): boolean {
    return this.stalled;
  }

  get worldEpoch(): number | null {
    return this.epoch;
  }

  get hasLocalCar(): boolean {
    return this.sim !== null && this.sim.slots.includes(this.mySlot);
  }

  /** False while the server ignores the driver's input (countdown, results): the local car is then held still like the server's. */
  setLive(live: boolean): void {
    this.live = live;
  }

  get isLive(): boolean {
    return this.live;
  }

  /**
   * Starts accepting snapshots for a new world, in which the local car has slot `mySlot` (default: unchanged, -1 = none).
   * The world itself is built from the first snapshot (it lists exactly the cars the server simulates). Inputs not yet
   * acknowledged are kept so they can be replayed, and the input numbering carries on.
   */
  beginWorld(epoch: number, mySlot: number = this.mySlot): void {
    this.mySlot = mySlot;
    this.epoch = epoch & 0xff;
    if (this.sim) this.counters.worldRebuilds++;
    this.disposeSim();
    this.synced = false;
    this.stalled = false;
    this.lastTick = -1;
    this.remoteInputs.clear();
    this.impacts = [];
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
      // While stalled the server is not hearing us and plays neutral input for us, so predict exactly that.
      this.simulate(this.stalled ? NEUTRAL_INPUT : q);
      this.noteImpacts();
      if (this.hasLocalCar && !this.stalled) entry.after = this.curr.get(this.mySlot) ?? null;
    }
    return this.seq;
  }

  /**
   * The impacts the local car has had since the last call, in order, for sounds, sparks and shaking the camera the moment they
   * happen. They are read from live ticks only: a replay after a snapshot re-simulates the same collision many times and would
   * repeat every one of them. (The damage is the server's business; this is only for the senses.)
   */
  takeImpacts(): LocalImpact[] {
    const out = this.impacts;
    this.impacts = [];
    return out;
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

    // Stalled: far too many inputs unacknowledged, or the count has grown on every one of the last few snapshots
    // (acknowledgements have stopped while we keep sending). Replaying from the server's state would then drift wildly.
    if (this.lastAck !== null && s.ackSeq !== this.lastAck) this.ackSeen = true;
    this.lastAck = s.ackSeq;
    if (this.lastBehind !== null && behind > this.lastBehind) this.growthStreak++;
    else this.growthStreak = 0;
    this.lastBehind = behind;
    const stalled =
      behind > this.stallTicks || (this.ackSeen && this.growthStreak >= STALL_STREAK && behind >= STALL_MIN_BEHIND);
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
    const kept = !fresh && hasLocal && !crowded && !stalled ? this.history.get(s.ackSeq)?.after ?? null : null;
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
    const priorPrev = this.prev;
    this.curr = this.readAll();
    this.prev = this.curr;

    // 2. replay the inputs the server has not consumed yet
    const steps = stalled ? 0 : Math.min(behind, this.historySize);
    this.stalled = stalled;
    if (stalled) this.counters.stalls++;
    for (let i = 0; i < steps; i++) {
      const entry = this.history.get((this.seq - steps + 1 + i) >>> 0);
      this.simulate(entry?.input ?? NEUTRAL_INPUT);
      if (entry && hasLocal) entry.after = this.curr.get(this.mySlot) ?? null;
    }
    // Nothing replayed: the rewind collapsed the interpolation base (prev === curr) and a frame drawn between two steps
    // would pop forward by up to one step of motion. Move the old base by the same correction as the present instead.
    if (!fresh && steps === 0) this.prev = this.shiftBase(priorPrev, beforeMap, this.curr);

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
    return { outcome: fresh ? 'synced' : 'applied', resetLocal, resimSteps: steps, stalled, corrections, localError: local?.error ?? 0 };
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

  /** What the server does with the driver's input: nothing while the round is not live or once the car is wrecked. */
  private appliedLocal(input: CarInput): CarInput {
    const alive = ((this.meta.get(this.mySlot)?.flags ?? SNAP_FLAG_ALIVE) & SNAP_FLAG_ALIVE) !== 0;
    return this.live && alive ? input : PARKED_INPUT;
  }

  /** Reads the contacts of the tick the local prediction has just stepped and keeps those of the local car. */
  private noteImpacts(): void {
    if (!this.sim || !this.hasLocalCar) return;
    for (const c of this.sim.contacts(COMBAT.SCRAPE_IMPULSE)) {
      if (c.a === this.mySlot) this.impacts.push({ slot: c.a, other: c.b, kns: c.impulse / 1000, point: c.pointA });
      else if (c.b === this.mySlot) this.impacts.push({ slot: c.b, other: c.a, kns: c.impulse / 1000, point: c.pointB });
    }
    if (this.impacts.length > MAX_UNREAD_IMPACTS) this.impacts.splice(0, this.impacts.length - MAX_UNREAD_IMPACTS);
  }

  private simulate(localInput: CarInput): void {
    const sim = this.sim!;
    if (sim.slots.includes(this.mySlot)) sim.setInput(this.mySlot, this.appliedLocal(localInput));
    for (const [slot, input] of this.remoteInputs) if (sim.slots.includes(slot)) sim.setInput(slot, input);
    sim.step();
    this.prev = this.curr;
    this.curr = this.readAll();
  }

  /** The previous step's states moved by the same correction as the present ones, so interpolation stays continuous. */
  private shiftBase(
    oldPrev: Map<number, CarState>,
    oldCurr: Map<number, CarState>,
    newCurr: Map<number, CarState>,
  ): Map<number, CarState> {
    const out = new Map<number, CarState>();
    for (const [slot, nc] of newCurr) {
      const op = oldPrev.get(slot);
      const oc = oldCurr.get(slot);
      if (!op || !oc) {
        out.set(slot, nc);
        continue;
      }
      out.set(slot, {
        pos: vadd(op.pos, vsub(nc.pos, oc.pos)),
        quat: quatNormalize(quatMul(nc.quat, quatMul(quatConjugate(oc.quat), op.quat))),
        linvel: nc.linvel,
        angvel: nc.angvel,
      });
    }
    return out;
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
