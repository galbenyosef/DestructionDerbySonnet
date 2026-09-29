import { describe, expect, it } from 'vitest';
import { CarDamage, DamageBook, PART_RULES } from '../../src/client/game/carDamage';
import type { HitMessage } from '../../src/shared/protocol';
import type { Zone } from '../../src/shared/types';

const hit = (over: Partial<HitMessage> = {}): HitMessage => ({
  t: 'hit', tick: 50, victim: 1, attacker: 0, dmg: 6, hp: 90, zone: 'front', j: 5, p: [2.3, -0.3, 0], ...over,
});

describe('CarDamage', () => {
  it('adds the damage to the side that took it and takes a part off once that side has taken enough', () => {
    const car = new CarDamage();
    expect(car.add(hit({ dmg: 6 })).lost).toEqual([]);
    expect(car.zones.front).toBe(6);
    expect(car.add(hit({ dmg: 5 })).lost).toEqual(['bumperFront']); // 11 HP in front
    expect(car.add(hit({ dmg: 20 })).lost).toEqual(['hood']); // 31 HP in front
    expect([...car.lost].sort()).toEqual(['bumperFront', 'hood']);
  });

  it('takes a part off once, however much more damage that side takes', () => {
    const car = new CarDamage();
    car.add(hit({ dmg: 15 }));
    for (let i = 0; i < 5; i++) expect(car.add(hit({ dmg: 1 })).lost).toEqual([]);
    expect(car.lost.has('bumperFront')).toBe(true);
  });

  it('counts each side on its own: a knock on the rear does not loosen the hood', () => {
    const car = new CarDamage();
    car.add(hit({ zone: 'rear', dmg: 12, p: [-2.3, -0.3, 0] }));
    expect([...car.lost]).toEqual(['bumperRear']);
    car.add(hit({ zone: 'left', dmg: 25, p: [0, 0, -1] }));
    car.add(hit({ zone: 'right', dmg: 21, p: [0, 0, 1] }));
    expect([...car.lost].sort()).toEqual(['bumperRear', 'doorLeft', 'doorRight']);
    expect(car.zones).toEqual({ front: 0, rear: 12, left: 25, right: 21 });
  });

  it('has a rule for every side, and the parts come off in a sensible order (bumper before hood, bumper before trunk)', () => {
    const zones = new Set<Zone>(PART_RULES.map((r) => r.zone));
    expect(zones).toEqual(new Set<Zone>(['front', 'rear', 'left', 'right']));
    const at = (id: string) => PART_RULES.find((r) => r.id === id)!.at;
    expect(at('bumperFront')).toBeLessThan(at('hood'));
    expect(at('bumperRear')).toBeLessThan(at('trunk'));
    expect(new Set(PART_RULES.map((r) => r.id)).size).toBe(PART_RULES.length);
  });

  it('ignores a broken damage number but still makes a dent', () => {
    const car = new CarDamage();
    const outcome = car.add(hit({ dmg: Number.NaN }));
    expect(car.zones.front).toBe(0);
    expect(Number.isFinite(outcome.dent.depth)).toBe(true);
    expect(outcome.lost).toEqual([]);
  });
});

describe('DamageBook', () => {
  it('keeps every car\'s damage apart and forgets it all when the round is over', () => {
    const book = new DamageBook();
    book.onHit(hit({ victim: 1, dmg: 12 }));
    book.onHit(hit({ victim: 2, dmg: 3 }));
    expect(book.car(1).lost.has('bumperFront')).toBe(true);
    expect(book.car(2).lost.size).toBe(0);
    book.reset();
    expect(book.car(1).zones.front).toBe(0);
    expect(book.car(1).lost.size).toBe(0);
  });

  it('replays a log of hits to the state a client that saw them live has', () => {
    const log = [hit({ tick: 10, dmg: 7 }), hit({ tick: 12, victim: 2, zone: 'left', dmg: 22, p: [0, 0, -1] }), hit({ tick: 30, dmg: 9 }), hit({ tick: 44, victim: 2, zone: 'rear', dmg: 3, p: [-2.3, 0, 0] })];
    const live = new DamageBook();
    const newcomer = new DamageBook();
    const liveOutcomes = log.map((h) => live.onHit(h));
    const replayed = log.map((h) => newcomer.onHit(h));
    expect(replayed).toEqual(liveOutcomes);
    for (const slot of [1, 2]) {
      expect(newcomer.car(slot).zones).toEqual(live.car(slot).zones);
      expect([...newcomer.car(slot).lost]).toEqual([...live.car(slot).lost]);
    }
  });
});
