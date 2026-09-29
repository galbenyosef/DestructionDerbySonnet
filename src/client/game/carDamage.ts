import type { HitMessage } from '../../shared/protocol';
import type { Zone } from '../../shared/types';
import { dentFromHit, type Dent } from './dents';

export type PartId = 'bumperFront' | 'hood' | 'bumperRear' | 'trunk' | 'doorLeft' | 'doorRight';

/** A part comes off once the car has taken this much damage (HP) on that side during the round. */
export const PART_RULES: ReadonlyArray<{ id: PartId; zone: Zone; at: number }> = [
  { id: 'bumperFront', zone: 'front', at: 10 },
  { id: 'hood', zone: 'front', at: 28 },
  { id: 'bumperRear', zone: 'rear', at: 10 },
  { id: 'trunk', zone: 'rear', at: 28 },
  { id: 'doorLeft', zone: 'left', at: 20 },
  { id: 'doorRight', zone: 'right', at: 20 },
];

/** What one hit does to a car's looks: the dent, and the parts that come off because of it. */
export interface HitOutcome {
  dent: Dent;
  lost: PartId[];
}

/** The damage one car has taken this round, side by side, and which of its parts are gone. */
export class CarDamage {
  readonly zones: Record<Zone, number> = { front: 0, rear: 0, left: 0, right: 0 };
  readonly lost = new Set<PartId>();

  add(h: HitMessage): HitOutcome {
    const dent = dentFromHit(h);
    if (Number.isFinite(h.dmg) && h.dmg > 0) this.zones[h.zone] += h.dmg;
    const lost: PartId[] = [];
    for (const rule of PART_RULES) {
      if (!this.lost.has(rule.id) && this.zones[rule.zone] >= rule.at) {
        this.lost.add(rule.id);
        lost.push(rule.id);
      }
    }
    return { dent, lost };
  }
}

/** Every car's damage in the running round, from the `hit` messages (and the log a newcomer is given). */
export class DamageBook {
  private readonly cars = new Map<number, CarDamage>();

  car(slot: number): CarDamage {
    let car = this.cars.get(slot);
    if (!car) {
      car = new CarDamage();
      this.cars.set(slot, car);
    }
    return car;
  }

  onHit(h: HitMessage): HitOutcome {
    return this.car(h.victim).add(h);
  }

  /** A new round: every car is whole again. */
  reset(): void {
    this.cars.clear();
  }
}
