import { ARENA, NET } from '../shared/constants';
import { NEUTRAL_INPUT } from '../shared/input';
import {
  SNAP_FLAG_ALIVE,
  SNAP_FLAG_GROUNDED,
  SNAP_FLAG_HANDBRAKE,
  buildSnapshotPacket,
  encodeCarBlock,
  type PlayerInfo,
  type RoomInfo,
  type SnapshotCar,
} from '../shared/protocol';
import { Simulation } from '../shared/sim';
import type { Player } from './player';

/**
 * One arena instance. Baseline policy for this plan: any roster change rebuilds the world a moment later
 * (fresh cars at fresh spawns) and bumps `epoch`. Later plans replace this with rounds.
 */
export class Room {
  readonly seats: Array<Player | null> = Array.from({ length: ARENA.MAX_CARS }, () => null);
  /** Increments on every world rebuild; clients drop snapshots from other epochs. */
  epoch = 0;
  private sim: Simulation | null = null;
  private ticks = 0;
  private rebuildAt: number | null = null;
  private disposed = false;

  constructor(
    readonly code: string,
    readonly isPublic: boolean,
    private readonly onEmpty: (room: Room) => void,
  ) {}

  /** Simulation tick of the current world (0 before the first build). */
  get simTick(): number {
    return this.sim?.tick ?? 0;
  }

  get playerCount(): number {
    let n = 0;
    for (const p of this.seats) if (p) n++;
    return n;
  }

  get isFull(): boolean {
    return this.playerCount >= ARENA.MAX_CARS;
  }

  seated(): Player[] {
    return this.seats.filter((p): p is Player => p !== null);
  }

  info(): RoomInfo {
    return { code: this.code, public: this.isPublic, capacity: ARENA.MAX_CARS };
  }

  playerInfos(): PlayerInfo[] {
    return this.seated().map((p) => ({ slot: p.slot, name: p.name, color: p.color }));
  }

  /** Seats the player in the lowest free slot. Returns the slot, or -1 when full or disposed. */
  addPlayer(player: Player): number {
    const slot = this.seats.indexOf(null);
    if (slot < 0 || this.disposed) return -1;
    this.seats[slot] = player;
    player.slot = slot;
    player.room = this;
    player.resetInputState();
    this.scheduleRebuild();
    return slot;
  }

  removePlayer(player: Player): void {
    const slot = player.slot;
    if (slot < 0 || this.seats[slot] !== player) return;
    this.seats[slot] = null;
    player.slot = -1;
    player.room = null;
    if (this.playerCount === 0) {
      this.onEmpty(this);
      return;
    }
    this.scheduleRebuild();
  }

  private scheduleRebuild(): void {
    this.rebuildAt = this.ticks + NET.REBUILD_DELAY_TICKS;
  }

  private rebuild(): void {
    this.rebuildAt = null;
    this.sim?.dispose();
    this.sim = null;
    const players = this.seated();
    this.epoch = (this.epoch + 1) & 0xff;
    if (players.length > 0) this.sim = new Simulation(players.map((p) => p.slot));
    for (const p of players) p.resetInputState();
    const roster = { t: 'roster', epoch: this.epoch, players: this.playerInfos() } as const;
    for (const p of players) p.send(roster);
  }

  /** One 60 Hz tick. */
  step(): void {
    if (this.disposed) return;
    this.ticks++;
    if (this.rebuildAt !== null && this.ticks >= this.rebuildAt) this.rebuild();
    for (const p of this.seated()) {
      if (p.ticksSinceInput > NET.INACTIVE_KICK_TICKS) p.close(4001, 'inactive');
    }
    const sim = this.sim;
    if (!sim) return;
    const inSim = new Set(sim.slots);
    for (const slot of sim.slots) {
      const p = this.seats[slot];
      sim.setInput(slot, p ? p.nextInput() : NEUTRAL_INPUT);
    }
    // players seated after the last rebuild have no car yet; keep draining their queue so it cannot grow
    for (const p of this.seated()) if (!inSim.has(p.slot)) p.nextInput();
    sim.step();
    if (sim.tick % NET.SNAPSHOT_EVERY === 0) this.broadcastSnapshot(sim);
  }

  private broadcastSnapshot(sim: Simulation): void {
    const cars: SnapshotCar[] = [];
    const recipients: Player[] = [];
    for (const slot of sim.slots) {
      const p = this.seats[slot];
      if (!p) continue;
      recipients.push(p);
      const input = sim.getInput(slot);
      let flags = SNAP_FLAG_ALIVE;
      if (input.handbrake) flags |= SNAP_FLAG_HANDBRAKE;
      if (sim.getWheels(slot).some((w) => w.contact)) flags |= SNAP_FLAG_GROUNDED;
      cars.push({ slot, flags, hp: 100, state: sim.getState(slot), throttle: input.throttle, steer: input.steer });
    }
    if (cars.length === 0) return;
    const block = encodeCarBlock(cars);
    for (const p of recipients) p.sendSnapshot(buildSnapshotPacket(this.epoch, sim.tick, p.ackSeq, cars.length, block));
  }

  /** Frees the simulation. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sim?.dispose();
    this.sim = null;
  }
}
