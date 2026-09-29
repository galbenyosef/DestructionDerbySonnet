import { spawnPose } from '../shared/arena';
import { COMBAT } from '../shared/constants';
import type { HitMessage, KoMessage, KoReason } from '../shared/protocol';
import type { Simulation } from '../shared/sim';
import type { CarState } from '../shared/types';
import { AttackLog, HitTracker } from './combat';
import { CarWatch, isFiniteState } from './rules';

/** How one car is doing in the running round. */
export interface CarStatus {
  slot: number;
  hp: number;
  alive: boolean;
  /** Eliminations credited to this car, HP of damage it dealt, and the points it earned this round. */
  kills: number;
  damage: number;
  gained: number;
}

export interface StepEvents {
  hits: HitMessage[];
  kos: KoMessage[];
}

const ZERO = { x: 0, y: 0, z: 0 } as const;

/** Where a car stands and how it is at the start of the round: a finite place to leave a broken body. */
function spawnState(sim: Simulation, slot: number): CarState {
  const pose = spawnPose(sim.slots.indexOf(slot), sim.slots.length);
  return { pos: pose.pos, quat: pose.quat, linvel: ZERO, angvel: ZERO };
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Everything the server tracks about one round's cars: hit points, who is still running, who hit whom, and the points
 * earned. It knows nothing about players, sockets or phases; the Room feeds it the simulation and turns what comes back
 * into messages.
 */
export class RoundState {
  readonly status = new Map<number, CarStatus>();
  private readonly tracker = new HitTracker();
  private readonly log = new AttackLog();
  private readonly watches = new Map<number, CarWatch>();

  constructor(slots: readonly number[]) {
    for (const slot of slots) {
      this.status.set(slot, { slot, hp: COMBAT.MAX_HP, alive: true, kills: 0, damage: 0, gained: 0 });
      this.watches.set(slot, new CarWatch());
    }
  }

  isAlive(slot: number): boolean {
    return this.status.get(slot)?.alive ?? false;
  }

  hpOf(slot: number): number {
    return this.status.get(slot)?.hp ?? 0;
  }

  aliveSlots(): number[] {
    return [...this.status.values()].filter((s) => s.alive).map((s) => s.slot);
  }

  /** The alive car with the most HP, or -1 when nobody is alive or the best two are level. */
  leader(): number {
    const alive = [...this.status.values()].filter((s) => s.alive).sort((a, b) => b.hp - a.hp || a.slot - b.slot);
    if (alive.length === 0) return -1;
    if (alive.length > 1 && Math.abs(alive[0]!.hp - alive[1]!.hp) < 1e-9) return -1;
    return alive[0]!.slot;
  }

  /** Takes a car out of the round. Returns the message to send, or null when it was out already. */
  eliminate(slot: number, reason: KoReason, tick: number): KoMessage | null {
    const car = this.status.get(slot);
    if (!car || !car.alive) return null;
    car.alive = false;
    car.hp = 0;
    // a disconnect is nobody's kill; anything else goes to whoever hit the car last, if that was recent
    const { killer, assists } = reason === 'disconnected' ? { killer: -1, assists: [] } : this.log.credit(slot, tick);
    if (killer >= 0) {
      const credited = this.status.get(killer);
      if (credited) {
        credited.kills++;
        credited.gained += COMBAT.KILL_POINTS;
      }
    }
    return { t: 'ko', tick, victim: slot, killer, assists, reason };
  }

  awardWin(slot: number): void {
    const car = this.status.get(slot);
    if (car) car.gained += COMBAT.WIN_POINTS;
  }

  /**
   * Reads the simulation's contacts for this tick: impacts become damage, and cars are eliminated when they run out of HP,
   * flip, stall, leave the arena or sit still too long. Call once per live tick, after `sim.step()`.
   */
  step(tick: number, sim: Simulation): StepEvents {
    const events: StepEvents = { hits: [], kos: [] };
    const involved = new Set<number>();
    for (const hit of this.tracker.update(tick, sim.contacts(COMBAT.SCRAPE_IMPULSE), (slot) => this.isAlive(slot))) {
      const victim = this.status.get(hit.victim);
      if (!victim || !victim.alive) continue; // a wreck cannot be hurt any more
      const dealt = Math.min(hit.damage, victim.hp);
      victim.hp -= dealt;
      involved.add(hit.victim);
      if (hit.attacker >= 0 && !hit.byWreck) {
        involved.add(hit.attacker);
        this.log.record(hit.victim, hit.attacker, tick);
        const attacker = this.status.get(hit.attacker);
        if (attacker) {
          attacker.damage += dealt;
          attacker.gained += dealt * COMBAT.POINTS_PER_HP;
        }
      }
      events.hits.push({
        t: 'hit',
        tick: hit.tick,
        victim: hit.victim,
        attacker: hit.attacker,
        dmg: round1(dealt),
        hp: round1(victim.hp),
        zone: hit.zone,
        j: round1(hit.impulse),
        p: [round2(hit.point.x), round2(hit.point.y), round2(hit.point.z)],
      });
      if (victim.hp <= 1e-9) {
        const ko = this.eliminate(hit.victim, 'damage', tick);
        if (ko) events.kos.push(ko);
      }
    }
    for (const car of this.status.values()) {
      let state = sim.getState(car.slot);
      const broken = !isFiniteState(state);
      if (broken) {
        // Rapier turned the body into NaN: leave a finite wreck at its spawn point, or every snapshot of the round would carry
        // NaN and the clients (which drop such a snapshot whole) would freeze until the next round.
        sim.setState(car.slot, spawnState(sim, car.slot));
        state = sim.getState(car.slot);
      }
      if (!car.alive) continue;
      const watch = this.watches.get(car.slot)!;
      const result = watch.update(state, involved.has(car.slot));
      if (result.drain > 0) car.hp -= result.drain;
      const reason: KoReason | null = broken ? 'bounds' : car.hp <= 1e-9 ? 'stall' : result.fault;
      if (reason) {
        const ko = this.eliminate(car.slot, reason, tick);
        if (ko) events.kos.push(ko);
      }
    }
    return events;
  }
}
