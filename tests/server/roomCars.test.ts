import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CAR_IDS } from '../../src/shared/cars';
import { initPhysics } from '../../src/shared/physics';
import { disposeRooms, join, makeRoom, messages, steps } from '../helpers/roomKit';

beforeAll(async () => {
  await initPhysics();
});
afterEach(disposeRooms);

describe('Room cars', () => {
  it('shows each player\'s car in the roster, the sedan for a player who chose none', () => {
    const { room } = makeRoom();
    const a = join(room, 'Ann', 'pickup');
    const b = join(room, 'Bob');
    steps(room, 2);
    expect(room.playerInfos().map((p) => [p.name, p.car])).toEqual([['Ann', 'pickup'], ['Bob', 'sedan']]);
    expect(messages(a.socket, 'roster').at(-1)!.players).toMatchObject([{ car: 'pickup' }, { car: 'sedan' }]);
    expect(room.greeting(b.player).players.map((p) => p.car)).toEqual(['pickup', 'sedan']);
  });

  it('gives each bot a model, the same ones for the same room seed, and different ones for another', () => {
    const botCars = (seed: number): string[] => {
      const { room } = makeRoom({ botFill: 4, seed });
      join(room, 'Ann');
      steps(room, 2);
      return room.playerInfos().filter((p) => p.bot).map((p) => p.car);
    };
    expect(botCars(5)).toEqual(botCars(5));
    expect(botCars(5)).toHaveLength(3);
    for (const car of botCars(5)) expect(CAR_IDS).toContain(car);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) for (const car of botCars(seed)) seen.add(car);
    expect([...seen].sort()).toEqual([...CAR_IDS].sort());
    disposeRooms();
  });
});
