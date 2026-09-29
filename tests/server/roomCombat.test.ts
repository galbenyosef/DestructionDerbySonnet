import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { COMBAT } from '../../src/shared/constants';
import { quatFromYaw } from '../../src/shared/math';
import { initPhysics } from '../../src/shared/physics';
import type { CarState } from '../../src/shared/types';
import type { Room } from '../../src/server/room';
import type { RoundState } from '../../src/server/round';
import { disposeRooms, join, makeRoom, messages, serverSim, snapshots, steps } from '../helpers/roomKit';

beforeAll(async () => {
  await initPhysics();
});
afterEach(disposeRooms);

const car = (x: number, z: number, yaw = 0, speed = 0): CarState => ({
  pos: { x, y: 1.07, z },
  quat: quatFromYaw(yaw),
  linvel: { x: Math.cos(yaw) * speed, y: 0, z: -Math.sin(yaw) * speed },
  angvel: { x: 0, y: 0, z: 0 },
});
const headOn = (room: Room, a = 0, b = 1): void => {
  serverSim(room).setState(a, car(-9, 0, 0, 10));
  serverSim(room).setState(b, car(9, 0, Math.PI, 10));
};
const roundState = (room: Room): RoundState => Reflect.get(room, 'state') as RoundState;

/** Two humans, Ann and Bob, already in the live phase of round 1. */
function duel(options: Parameters<typeof makeRoom>[0] = {}) {
  const { room } = makeRoom(options);
  const a = join(room, 'Ann');
  const b = join(room, 'Bob');
  steps(room, 6);
  expect(room.phase).toBe('live');
  return { room, a, b };
}

describe('Room combat', () => {
  it('damages both cars in a head-on collision and tells everyone, spectators included', () => {
    const { room, a, b } = duel();
    const late = join(room, 'Cy');
    headOn(room);
    steps(room, 90);
    for (const who of [a, b, late]) {
      const hits = messages(who.socket, 'hit');
      expect(hits).toHaveLength(2);
      expect(hits.map((h) => [h.victim, h.attacker, h.zone])).toEqual([[0, 1, 'front'], [1, 0, 'front']]);
      expect(hits[0]!.dmg as number).toBeGreaterThan(22);
    }
    const last = snapshots(a.socket).at(-1)!;
    for (const c of last.cars) {
      expect(c.hp).toBeGreaterThan(70);
      expect(c.hp).toBeLessThan(80);
    }
    expect(roundState(room).aliveSlots()).toEqual([0, 1]);
  });

  it('shows a car with a sliver of HP as 1 and a wreck as 0, never a running car at 0', () => {
    const { room, a } = duel();
    roundState(room).status.get(0)!.hp = 0.3;
    steps(room, 4);
    const cars = snapshots(a.socket).at(-1)!.cars;
    expect(cars.find((c) => c.slot === 0)!.hp).toBe(1);
    expect(cars.find((c) => c.slot === 1)!.hp).toBe(100);
    roundState(room).eliminate(0, 'flipped', 10);
    steps(room, 4);
    expect(snapshots(a.socket).at(-1)!.cars.find((c) => c.slot === 0)!.hp).toBe(0);
  });

  it('scores 1 point per HP of damage dealt and shares the running scores', () => {
    const { room, a } = duel();
    headOn(room);
    steps(room, 90);
    const rows = (messages(a.socket, 'scores').at(-1)!.rows as Array<{ slot: number; score: number; kills: number }>);
    expect(rows.map((r) => r.slot)).toEqual([0, 1]);
    for (const r of rows) {
      expect(r.score).toBeGreaterThan(22);
      expect(r.score).toBeLessThan(29);
      expect(r.kills).toBe(0);
    }
  });

  it('does not send scores more often than four times a second', () => {
    const { room, a } = duel();
    headOn(room);
    const before = messages(a.socket, 'scores').length;
    steps(room, 120);
    expect(messages(a.socket, 'scores').length - before).toBeLessThanOrEqual(3);
  });

  it('eliminates a car whose HP runs out: ko for everyone, a wreck in the snapshots, and the round goes to the last car', () => {
    const { room, a, b } = duel({ rules: { resultsTicks: 600 } });
    roundState(room).status.get(1)!.hp = 5;
    headOn(room);
    steps(room, 90);
    const [ko] = messages(a.socket, 'ko');
    expect(ko).toMatchObject({ victim: 1, killer: 0, assists: [], reason: 'damage' });
    expect(messages(b.socket, 'ko')).toHaveLength(1);
    expect(room.phase).toBe('results');
    const [results] = messages(a.socket, 'results');
    expect(results).toMatchObject({ round: 1, winner: 0, reason: 'last' });
    const rows = results!.rows as Array<Record<string, number>>;
    expect(rows[0]).toMatchObject({ slot: 0, kills: 1, damage: 5, alive: true });
    expect(rows[0]!.gained).toBeCloseTo(5 + COMBAT.KILL_POINTS + COMBAT.WIN_POINTS, 0); // damage + kill + win
    expect(rows[1]).toMatchObject({ slot: 1, kills: 0, alive: false, hp: 0 });
    expect(rows[1]!.gained).toBeGreaterThan(22); // the wreck still earned the damage it dealt before it went
    const wreck = snapshots(a.socket).at(-1)!.cars.find((c) => c.slot === 1)!;
    expect(wreck.flags & 1).toBe(0);
    expect(wreck.hp).toBe(0);
  });

  it('sends the final standings, win bonus included, right after the results, whatever the throttle says', () => {
    const { room, a } = duel({ rules: { resultsTicks: 600 } });
    roundState(room).status.get(1)!.hp = 5;
    headOn(room);
    steps(room, 90);
    expect(room.phase).toBe('results');
    const log = messages(a.socket);
    const at = log.findIndex((m) => m.t === 'results');
    expect(at).toBeGreaterThan(-1);
    const finalScores = log.slice(at + 1).find((m) => m.t === 'scores');
    expect(finalScores).toBeDefined(); // the last points and the win bonus are not lost to the four-a-second throttle
    const shown = (rows: unknown) => (rows as Array<{ slot: number; score: number; kills: number }>).map((r) => [r.slot, r.score, r.kills]);
    expect(shown(finalScores!.rows)).toEqual(shown(log[at]!.rows));
    expect(shown(finalScores!.rows)[0]![1]).toBeGreaterThan(150); // Ann: damage + kill + the win
  });

  it('carries points from one round to the next', () => {
    const { room, a } = duel({ rules: { resultsTicks: 10 } });
    roundState(room).status.get(1)!.hp = 5;
    headOn(room);
    steps(room, 90);
    const scoreOfAnn = (messages(a.socket, 'results')[0]!.rows as Array<Record<string, number>>)[0]!.score!;
    expect(scoreOfAnn).toBeGreaterThan(150);
    steps(room, 30);
    expect(room.round).toBe(2);
    expect(messages(a.socket, 'scores').at(-1)!.rows).toMatchObject([{ slot: 0, score: scoreOfAnn, kills: 1 }, { slot: 1 }]);
  });

  it('ends the round when every human is out even though bots are still running', () => {
    const { room } = makeRoom({ botFill: 4 });
    const a = join(room, 'Ann');
    steps(room, 6);
    const state = roundState(room);
    state.status.get(1)!.hp = 90;
    state.status.get(2)!.hp = 100;
    state.status.get(3)!.hp = 80;
    state.eliminate(0, 'flipped', 10);
    steps(room, 1);
    const [results] = messages(a.socket, 'results');
    expect(results).toMatchObject({ winner: 2, reason: 'no_humans' });
    expect((results!.rows as Array<Record<string, unknown>>).map((r) => r.bot)).toEqual([false, true, true, true]);
    expect(room.phase).toBe('results');
  });

  it('calls it a draw when every car goes out on the same tick', () => {
    const { room, a } = duel();
    steps(room, COMBAT.IMMOBILE_TICKS + 5); // neither player moves: both are eliminated as stuck
    const kos = messages(a.socket, 'ko');
    expect(kos.map((k) => [k.victim, k.reason])).toEqual([[0, 'stuck'], [1, 'stuck']]);
    expect(messages(a.socket, 'results')[0]).toMatchObject({ winner: -1, reason: 'draw' });
  });

  it('never sends a snapshot with a NaN car: a body Rapier breaks is replaced by a finite wreck in the same tick', () => {
    const { room, a } = duel();
    serverSim(room).setState(1, { ...car(0, 0), pos: { x: Number.NaN, y: 1.07, z: 0 } });
    const before = snapshots(a.socket).length;
    steps(room, 30);
    const fresh = snapshots(a.socket).slice(before);
    expect(fresh.length).toBeGreaterThan(10);
    for (const snap of fresh) {
      for (const c of snap.cars) expect([c.state.pos.x, c.state.pos.y, c.state.pos.z, c.state.linvel.x, c.state.linvel.y, c.state.linvel.z].every(Number.isFinite)).toBe(true);
    }
    expect(messages(a.socket, 'ko')).toMatchObject([{ victim: 1, killer: -1, reason: 'bounds' }]);
  });

  it('does not hurt anybody outside the live phase', () => {
    const { room } = makeRoom({ rules: { countdownTicks: 200 } });
    const a = join(room);
    join(room);
    steps(room, 5);
    expect(room.phase).toBe('countdown');
    headOn(room);
    steps(room, 90);
    expect(messages(a.socket, 'hit')).toHaveLength(0);
    expect(roundState(room).aliveSlots()).toEqual([0, 1]);
  });

  it('runs a whole round with a driving human and three bots: bots chase and hit, and the round ends', () => {
    const { room } = makeRoom({ botFill: 4, seed: 3, rules: { liveTicks: 3600, resultsTicks: 60 } });
    const human = join(room, 'Ann');
    let seq = 0;
    for (let t = 0; t < 3700; t++) {
      // circle the middle of the arena at speed
      human.player.pushInput(++seq, { throttle: 0.8, steer: 0.35, handbrake: false });
      room.step();
      if (room.phase === 'results') break;
    }
    expect(room.phase).toBe('results');
    const hits = messages(human.socket, 'hit');
    expect(hits.length).toBeGreaterThan(2);
    expect(hits.some((h) => (h.attacker as number) >= 1)).toBe(true); // a bot hit somebody
    const [results] = messages(human.socket, 'results');
    expect(results!.rows as unknown[]).toHaveLength(4);
    expect(['last', 'timeout', 'no_humans', 'draw']).toContain(results!.reason);
    for (const r of snapshots(human.socket).at(-1)!.cars) expect(Number.isFinite(r.state.pos.x)).toBe(true);
  });
});
