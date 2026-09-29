import { COMBAT } from '../shared/constants';
import type { KoMessage, KoReason } from '../shared/protocol';
import { AttackLog } from './combat';

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


/**
 * Everything the server tracks about one round's cars: hit points, who is still running, who hit whom, and the points
 * earned. It knows nothing about players, sockets or phases; the Room feeds it the simulation and turns what comes back
 * into messages.
 */
export class RoundState {
  readonly status = new Map<number, CarStatus>();
  private readonly log = new AttackLog();

  constructor(slots: readonly number[]) {
    for (const slot of slots) {
      this.status.set(slot, { slot, hp: COMBAT.MAX_HP, alive: true, kills: 0, damage: 0, gained: 0 });
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

}
