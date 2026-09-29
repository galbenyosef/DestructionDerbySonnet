import { ARENA, NET, PHYSICS, ROUND } from '../shared/constants';
import { PARKED_INPUT, type CarInput } from '../shared/input';
import {
  SNAP_FLAG_ALIVE,
  SNAP_FLAG_GROUNDED,
  SNAP_FLAG_HANDBRAKE,
  buildSnapshotPacket,
  encodeCarBlock,
  type Phase,
  type PhaseMessage,
  type PlayerInfo,
  type ResultRow,
  type RoomInfo,
  type RoundEnd,
  type ScoreRow,
  type ServerMessage,
  type SnapshotCar,
} from '../shared/protocol';
import { Simulation } from '../shared/sim';
import type { CarState } from '../shared/types';
import { BOT_COLORS, BOT_NAMES, BotBrain, type BotTarget } from './bots';
import type { Player } from './player';
import { RoundState } from './round';

/** How long each phase of a round lasts, in simulation ticks. */
export interface RoomRules {
  countdownTicks: number;
  liveTicks: number;
  resultsTicks: number;
}

export const DEFAULT_RULES: Readonly<RoomRules> = {
  countdownTicks: ROUND.COUNTDOWN_TICKS,
  liveTicks: ROUND.LIVE_TICKS,
  resultsTicks: ROUND.RESULTS_TICKS,
};

export interface RoomOptions {
  rules?: Partial<RoomRules>;
  /** Bots fill the room up to this many cars (default ROUND.BOT_FILL); humans push them out. 0 = no bots. */
  botFill?: number;
  /** Seeds the bots' randomness (default 1). */
  seed?: number;
}

/** A human or a bot taking part in the room. Running totals live here; hit points and the like live in RoundState. */
interface Participant {
  key: string;
  player: Player | null;
  bot: boolean;
  name: string;
  color: number;
  /** Slot of this participant's car in the running round, or -1 while it waits for the next one. */
  slot: number;
  score: number;
  kills: number;
}

const MS_PER_TICK = 1000 / PHYSICS.TICK_RATE;
const SCORES_EVERY_TICKS = 15;

/**
 * One arena instance, played in rounds: COUNTDOWN (a fresh world, cars frozen) -> LIVE (until one car is left, the time
 * runs out or no human is left) -> RESULTS -> a new round. Everyone in the room at the start of a round gets a car;
 * players who arrive later watch until the next one. Bots fill the room up to `botFill` cars.
 */
export class Room {
  /** Increments on every new world; clients drop snapshots from other epochs. */
  epoch = 0;
  round = 0;
  phase: Phase = 'countdown';
  private readonly rules: RoomRules;
  private readonly botFill: number;
  private readonly seed: number;
  private participants: Participant[] = [];
  /** The cars of the running round; the index is the slot. Includes players who have left since. */
  private roundCars: Participant[] = [];
  private brains = new Map<number, BotBrain>();
  private sim: Simulation | null = null;
  private state: RoundState | null = null;
  private folded = false;
  private restartPending = false;
  private restarts = 0;
  private ticks = 0;
  private phaseTicks = 0;
  private botsMade = 0;
  private scoresDirty = false;
  private scoresSentAt = 0;
  private disposed = false;

  constructor(
    readonly code: string,
    readonly isPublic: boolean,
    private readonly onEmpty: (room: Room) => void,
    options: RoomOptions = {},
  ) {
    this.rules = { ...DEFAULT_RULES, ...options.rules };
    this.botFill = Math.max(0, Math.min(ARENA.MAX_CARS, Math.floor(options.botFill ?? ROUND.BOT_FILL)));
    this.seed = (options.seed ?? 1) >>> 0;
  }

  /** Simulation tick of the current world (0 before the first round starts). */
  get simTick(): number {
    return this.sim?.tick ?? 0;
  }

  /** Humans in the room, whether or not they have a car in the running round. */
  get playerCount(): number {
    return this.humans().length;
  }

  get isFull(): boolean {
    return this.playerCount >= ARENA.MAX_CARS;
  }

  /** True when a player joining now gets a car soon: before the first round, in a countdown, or between rounds. */
  get carSoon(): boolean {
    return this.phase !== 'live';
  }

  /** Every human in the room. */
  seated(): Player[] {
    return this.humans().map((p) => p.player!);
  }

  info(): RoomInfo {
    return { code: this.code, public: this.isPublic, capacity: ARENA.MAX_CARS };
  }

  /** The cars of the running round. */
  playerInfos(): PlayerInfo[] {
    return this.roundCars.map((p, slot) => (p.bot ? { slot, name: p.name, color: p.color, bot: true } : { slot, name: p.name, color: p.color }));
  }

  /** What a player who has just joined needs to know: their slot (-1 = watching), the cars, the phase and the scores. */
  greeting(player: Player): { you: number; players: PlayerInfo[]; phase: PhaseMessage | null; scores: ScoreRow[] } {
    const me = this.participants.find((p) => p.player === player);
    return { you: me?.slot ?? -1, players: this.playerInfos(), phase: this.sim ? this.phaseMessage() : null, scores: this.scoreRows() };
  }

  /** Adds a human. Returns false when the room is full or closed. They get a car when the next round starts. */
  addPlayer(player: Player): boolean {
    if (this.disposed || this.isFull) return false;
    this.participants.push({ key: `p${player.id}`, player, bot: false, name: player.name, color: player.color, slot: -1, score: 0, kills: 0 });
    player.slot = -1;
    player.room = this;
    player.resetInputState();
    // still counting down: start over with this player in the world, unless that has happened too often this round
    if (this.sim && this.phase === 'countdown' && this.restarts < ROUND.MAX_COUNTDOWN_RESTARTS) this.restartPending = true;
    return true;
  }

  removePlayer(player: Player): void {
    const index = this.participants.findIndex((p) => p.player === player);
    if (index < 0) return;
    const leaving = this.participants[index]!;
    if (this.state && leaving.slot >= 0 && this.phase !== 'results') {
      const ko = this.state.eliminate(leaving.slot, 'disconnected', this.simTick);
      if (ko) {
        this.broadcast(ko, player);
        this.scoresDirty = true;
      }
    }
    this.participants.splice(index, 1);
    player.slot = -1;
    player.room = null;
    if (this.humans().length === 0) this.onEmpty(this);
  }

  /** One 60 Hz tick. */
  step(): void {
    if (this.disposed) return;
    this.ticks++;
    const humans = this.humans();
    for (const p of humans) if (p.player!.ticksSinceInput > NET.INACTIVE_KICK_TICKS) p.player!.close(4001, 'inactive');
    if (!this.sim) {
      if (humans.length === 0) return;
      this.startRound(false);
    } else if (this.restartPending && this.phase === 'countdown') {
      this.startRound(true);
    } else if (this.phase === 'results' && this.phaseTicks >= this.rules.resultsTicks) {
      this.startRound(false);
    } else if (this.phase === 'countdown' && this.phaseTicks >= this.rules.countdownTicks) {
      this.enterLive();
    }
    const sim = this.sim!;
    const state = this.state!;
    this.applyInputs(sim, state);
    sim.step();
    this.phaseTicks++;
    if (this.phase === 'live') {
      const events = state.step(sim.tick, sim);
      for (const hit of events.hits) this.broadcast(hit);
      for (const ko of events.kos) this.broadcast(ko);
      if (events.hits.length + events.kos.length > 0) this.scoresDirty = true;
      this.checkEnd(state);
    }
    this.flushScores();
    if (sim.tick % NET.SNAPSHOT_EVERY === 0) this.broadcastSnapshot(sim, state);
  }

  /** Frees the simulation. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sim?.dispose();
    this.sim = null;
  }

  // ---- rounds ------------------------------------------------------------------------------------

  private humans(): Participant[] {
    return this.participants.filter((p) => p.player !== null);
  }

  /** Builds a fresh world. `restart` repeats the current round's countdown with whoever is here now. */
  private startRound(restart: boolean): void {
    this.sim?.dispose();
    this.restartPending = false;
    this.restarts = restart ? this.restarts + 1 : 0;
    if (!restart) this.round++;
    this.epoch = (this.epoch + 1) & 0xff;
    const humans = this.humans();
    const inRound = humans.slice(0, ARENA.MAX_CARS);
    const wantBots = Math.max(0, Math.min(this.botFill - inRound.length, ARENA.MAX_CARS - inRound.length));
    const bots = this.participants.filter((p) => p.bot).slice(0, wantBots); // bots that stay keep their names and scores
    while (bots.length < wantBots) bots.push(this.newBot());
    this.participants = [...humans, ...bots];
    this.roundCars = [...inRound, ...bots];
    for (const p of this.participants) p.slot = -1;
    this.roundCars.forEach((p, slot) => {
      p.slot = slot;
    });
    this.brains = new Map(bots.map((b, i) => [b.slot, new BotBrain((this.seed + this.round * 7919 + i * 104_729) >>> 0)] as const));
    const slots = this.roundCars.map((_, slot) => slot);
    this.sim = new Simulation(slots);
    this.state = new RoundState(slots);
    this.folded = false;
    this.phase = 'countdown';
    this.phaseTicks = 0;
    const cars = this.playerInfos();
    for (const p of humans) {
      p.player!.slot = p.slot;
      p.player!.resetInputState();
      p.player!.send({ t: 'roster', epoch: this.epoch, round: this.round, you: p.slot, players: cars });
    }
    this.broadcast(this.phaseMessage());
    this.scoresDirty = true;
    this.scoresSentAt = -SCORES_EVERY_TICKS;
  }

  private newBot(): Participant {
    const n = this.botsMade++;
    return {
      key: `b${n}`,
      player: null,
      bot: true,
      name: BOT_NAMES[n % BOT_NAMES.length]!,
      color: BOT_COLORS[n % BOT_COLORS.length]!,
      slot: -1,
      score: 0,
      kills: 0,
    };
  }

  private enterLive(): void {
    this.phase = 'live';
    this.phaseTicks = 0;
    this.broadcast(this.phaseMessage());
  }

  private checkEnd(state: RoundState): void {
    const alive = state.aliveSlots();
    const humansAlive = alive.some((slot) => !this.roundCars[slot]!.bot);
    if (this.roundCars.length >= 2 && alive.length <= 1) {
      this.enterResults('last', alive[0] ?? -1);
    } else if (this.roundCars.some((p) => !p.bot) && !humansAlive) {
      this.enterResults('no_humans', state.leader());
    } else if (this.phaseTicks >= this.rules.liveTicks) {
      this.enterResults('timeout', state.leader());
    }
  }

  private enterResults(reason: RoundEnd, winner: number): void {
    const state = this.state!;
    if (winner >= 0) state.awardWin(winner);
    const rows: ResultRow[] = this.roundCars.map((p, slot) => {
      const car = state.status.get(slot)!;
      p.score += car.gained;
      p.kills += car.kills;
      return {
        slot,
        name: p.name,
        color: p.color,
        bot: p.bot,
        score: Math.round(p.score),
        gained: Math.round(car.gained),
        kills: car.kills,
        damage: Math.round(car.damage),
        hp: Math.ceil(car.hp),
        alive: car.alive,
      };
    });
    this.folded = true;
    this.broadcast({ t: 'results', round: this.round, winner, reason: winner < 0 ? 'draw' : reason, rows });
    this.phase = 'results';
    this.phaseTicks = 0;
    this.broadcast(this.phaseMessage());
    this.scoresDirty = false;
  }

  // ---- per tick ----------------------------------------------------------------------------------

  private applyInputs(sim: Simulation, state: RoundState): void {
    // every human's queue is drained every tick, so acknowledgements keep moving whatever the car is doing
    const drained = new Map<Player, CarInput>();
    for (const p of this.humans()) drained.set(p.player!, p.player!.nextInput());
    const live = this.phase === 'live';
    const states = new Map<number, CarState>();
    if (live) for (const slot of sim.slots) states.set(slot, sim.getState(slot));
    for (const slot of sim.slots) {
      const p = this.roundCars[slot]!;
      let input: CarInput = PARKED_INPUT;
      if (live && state.isAlive(slot)) {
        if (p.bot) {
          const targets: BotTarget[] = state
            .aliveSlots()
            .filter((other) => other !== slot)
            .map((other) => ({ slot: other, state: states.get(other)!, hp: state.hpOf(other) }));
          input = this.brains.get(slot)?.think({ state: states.get(slot)!, targets }) ?? PARKED_INPUT;
        } else if (p.player) {
          input = drained.get(p.player) ?? PARKED_INPUT;
        }
      }
      sim.setInput(slot, input);
    }
  }

  private flushScores(): void {
    if (!this.scoresDirty || this.ticks - this.scoresSentAt < SCORES_EVERY_TICKS) return;
    this.scoresDirty = false;
    this.scoresSentAt = this.ticks;
    this.broadcast({ t: 'scores', rows: this.scoreRows() });
  }

  private broadcastSnapshot(sim: Simulation, state: RoundState): void {
    const cars: SnapshotCar[] = [];
    for (const slot of sim.slots) {
      const input = sim.getInput(slot);
      const alive = state.isAlive(slot);
      let flags = alive ? SNAP_FLAG_ALIVE : 0;
      if (input.handbrake) flags |= SNAP_FLAG_HANDBRAKE;
      if (sim.getWheels(slot).some((w) => w.contact)) flags |= SNAP_FLAG_GROUNDED;
      cars.push({ slot, flags, hp: alive ? Math.ceil(state.hpOf(slot)) : 0, state: sim.getState(slot), throttle: input.throttle, steer: input.steer });
    }
    const block = encodeCarBlock(cars);
    for (const p of this.humans()) {
      p.player!.sendSnapshot(buildSnapshotPacket(this.epoch, sim.tick, p.player!.ackSeq, cars.length, block));
    }
  }

  // ---- messages ----------------------------------------------------------------------------------

  private phaseMessage(): PhaseMessage {
    const limit = this.phase === 'countdown' ? this.rules.countdownTicks : this.phase === 'live' ? this.rules.liveTicks : this.rules.resultsTicks;
    return { t: 'phase', phase: this.phase, round: this.round, remainingMs: Math.max(0, Math.round((limit - this.phaseTicks) * MS_PER_TICK)) };
  }

  private scoreRows(): ScoreRow[] {
    return this.roundCars.map((p, slot) => {
      const car = this.state?.status.get(slot);
      const open = car && !this.folded;
      return { slot, score: Math.round(p.score + (open ? car.gained : 0)), kills: p.kills + (open ? car.kills : 0) };
    });
  }

  private broadcast(msg: ServerMessage, except?: Player): void {
    for (const p of this.humans()) if (p.player !== except) p.player!.send(msg);
  }
}
