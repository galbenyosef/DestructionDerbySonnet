import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ARENA, NET, ROUND } from '../../src/shared/constants';
import { vlen, vsub } from '../../src/shared/math';
import { initPhysics } from '../../src/shared/physics';
import { SNAP_FLAG_ALIVE, SNAP_FLAG_HANDBRAKE } from '../../src/shared/protocol';
import { Player } from '../../src/server/player';
import { DEFAULT_RULES } from '../../src/server/room';
import { FakeSocket } from '../helpers/fakeSocket';
import { disposeRooms, drive, join, makeRoom, messages, serverSim, snapshots, steps } from '../helpers/roomKit';

beforeAll(async () => {
  await initPhysics();
});
afterEach(disposeRooms);

describe('Room joining', () => {
  it('lets eight humans in and turns a ninth away', () => {
    const { room } = makeRoom();
    for (let i = 0; i < ARENA.MAX_CARS; i++) join(room, `P${i}`);
    expect(room.playerCount).toBe(8);
    expect(room.isFull).toBe(true);
    expect(room.addPlayer(new Player(999, new FakeSocket()))).toBe(false);
  });

  it('describes itself, and has no cars before the first round starts', () => {
    const { room } = makeRoom();
    join(room, 'Ann');
    expect(room.info()).toEqual({ code: 'ABCD', public: true, capacity: ARENA.MAX_CARS });
    expect(room.playerInfos()).toEqual([]);
    expect(room.greeting(room.seated()[0]!)).toEqual({ you: -1, players: [], phase: null, scores: [], dents: [] });
  });

  it('has the documented default round timing', () => {
    expect(DEFAULT_RULES).toEqual({ countdownTicks: 300, liveTicks: 14_400, resultsTicks: 480 });
    expect(ROUND.BOT_FILL).toBe(4);
  });
});

describe('Room rounds', () => {
  it('starts the first round on the first tick: the roster tells each player their slot, then the countdown begins', () => {
    const { room } = makeRoom({ rules: { countdownTicks: 120 } });
    const a = join(room, 'Ann');
    const b = join(room, 'Bob');
    expect(messages(a.socket)).toHaveLength(0);
    room.step();
    expect(room.epoch).toBe(1);
    expect(room.round).toBe(1);
    const [rosterA] = messages(a.socket, 'roster');
    const [rosterB] = messages(b.socket, 'roster');
    expect(rosterA).toMatchObject({ epoch: 1, round: 1, you: 0 });
    expect(rosterB).toMatchObject({ epoch: 1, round: 1, you: 1 });
    expect((rosterA!.players as unknown[]).length).toBe(2);
    expect(messages(a.socket).map((m) => m.t)).toEqual(['roster', 'phase', 'scores']);
    expect(messages(a.socket, 'phase')[0]).toMatchObject({ phase: 'countdown', round: 1, remainingMs: 2000 });
    expect(a.player.slot).toBe(0);
    expect(b.player.slot).toBe(1);
  });

  it('fills the room with bots up to four cars and puts humans first', () => {
    const { room } = makeRoom({ botFill: 4 });
    const a = join(room, 'Ann');
    room.step();
    const infos = room.playerInfos();
    expect(infos.map((p) => p.slot)).toEqual([0, 1, 2, 3]);
    expect(infos.map((p) => Boolean(p.bot))).toEqual([false, true, true, true]);
    expect(new Set(infos.map((p) => p.name)).size).toBe(4);
    expect(snapshots(a.socket).length).toBe(0); // the first snapshot comes on the second tick
    steps(room, 1);
    expect(snapshots(a.socket)[0]!.cars.map((c) => c.slot)).toEqual([0, 1, 2, 3]);
  });

  it('has fewer bots as humans join, and none once four humans are in', () => {
    const { room } = makeRoom({ botFill: 4, rules: { countdownTicks: 200, liveTicks: 10, resultsTicks: 5 } });
    join(room);
    room.step();
    expect(room.playerInfos().filter((p) => p.bot)).toHaveLength(3);
    join(room);
    room.step(); // joined during the countdown: the countdown restarts with two humans
    expect(room.playerInfos().filter((p) => p.bot)).toHaveLength(2);
    join(room);
    join(room);
    room.step();
    expect(room.playerInfos().map((p) => Boolean(p.bot))).toEqual([false, false, false, false]);
    join(room);
    room.step();
    expect(room.playerInfos()).toHaveLength(5);
    expect(room.playerInfos().some((p) => p.bot)).toBe(false);
  });

  it('keeps bots and their scores from one round to the next while they are still needed', () => {
    const { room } = makeRoom({ botFill: 4, rules: { countdownTicks: 2, liveTicks: 30, resultsTicks: 5 } });
    join(room);
    room.step();
    const names = room.playerInfos().map((p) => p.name);
    steps(room, 60);
    expect(room.round).toBeGreaterThan(1);
    expect(room.playerInfos().map((p) => p.name)).toEqual(names);
  });

  it('freezes the cars during the countdown, ignores their inputs, and still acknowledges them', () => {
    const { room } = makeRoom({ rules: { countdownTicks: 120 } });
    const a = join(room);
    room.step();
    const start = serverSim(room).getState(0).pos;
    for (let seq = 1; seq <= 100; seq++) {
      a.player.pushInput(seq, drive);
      room.step();
    }
    const now = serverSim(room).getState(0).pos;
    expect(Math.hypot(now.x - start.x, now.z - start.z)).toBeLessThan(0.3); // settled on its suspension, no driving
    const last = snapshots(a.socket).at(-1)!;
    expect(last.ackSeq).toBeGreaterThanOrEqual(98);
    expect(last.cars[0]!.flags & SNAP_FLAG_HANDBRAKE).toBe(SNAP_FLAG_HANDBRAKE); // parked
    expect(last.cars[0]!.throttle).toBe(0);
  });

  it('goes live when the countdown is over and then applies inputs', () => {
    const { room } = makeRoom({ rules: { countdownTicks: 60 } });
    const a = join(room);
    steps(room, 1);
    let seq = 0;
    for (let t = 0; t < 59; t++) {
      a.player.pushInput(++seq, drive);
      room.step();
    }
    expect(room.phase).toBe('countdown');
    for (let t = 0; t < 90; t++) {
      a.player.pushInput(++seq, drive);
      room.step();
    }
    expect(room.phase).toBe('live');
    expect(messages(a.socket, 'phase').map((m) => m.phase)).toEqual(['countdown', 'live']);
    const cars = snapshots(a.socket).at(-1)!.cars;
    expect(vlen(vsub(cars[0]!.state.pos, serverSim(room).getState(0).pos))).toBeLessThan(2);
    expect(vlen(serverSim(room).getState(0).linvel)).toBeGreaterThan(4); // it is really driving
    expect(cars[0]!.throttle).toBe(1);
  });

  it('restarts the countdown for a player who joins during it, so a burst of joiners plays together', () => {
    const { room } = makeRoom({ rules: { countdownTicks: 100 } });
    const a = join(room, 'Ann');
    steps(room, 10);
    expect(room.epoch).toBe(1);
    const b = join(room, 'Bob');
    expect(room.greeting(b.player).you).toBe(-1); // no car yet
    steps(room, 1);
    expect(room.epoch).toBe(2);
    expect(room.round).toBe(1); // the same round, started over
    expect(messages(b.socket, 'roster')).toHaveLength(1);
    expect(messages(b.socket, 'roster')[0]).toMatchObject({ epoch: 2, round: 1, you: 1 });
    expect(messages(a.socket, 'roster').map((m) => m.epoch)).toEqual([1, 2]);
    expect(messages(a.socket, 'phase').at(-1)).toMatchObject({ phase: 'countdown', remainingMs: 1667 });
  });

  it('stops restarting the countdown after a number of joins, so nobody can hold a room back by joining and leaving', () => {
    const { room } = makeRoom({ rules: { countdownTicks: 100 } });
    join(room);
    steps(room, 2);
    for (let i = 0; i < ROUND.MAX_COUNTDOWN_RESTARTS; i++) {
      const visitor = join(room);
      steps(room, 2);
      room.removePlayer(visitor.player); // in and out again
    }
    expect(room.epoch).toBe(1 + ROUND.MAX_COUNTDOWN_RESTARTS);
    const late = join(room);
    steps(room, 5);
    expect(room.epoch).toBe(1 + ROUND.MAX_COUNTDOWN_RESTARTS); // no more restarts this round
    expect(late.player.slot).toBe(-1);
  });

  it('keeps a player who joins during the live round out of it, but shows them the running round', () => {
    const { room } = makeRoom();
    const a = join(room, 'Ann');
    join(room, 'Bob');
    steps(room, 20);
    expect(room.phase).toBe('live');
    const late = join(room, 'Cy');
    steps(room, 10);
    const greeting = room.greeting(late.player);
    expect(greeting.you).toBe(-1);
    expect(greeting.players.map((p) => p.name)).toEqual(['Ann', 'Bob']);
    expect(greeting.phase).toMatchObject({ phase: 'live', round: 1 });
    expect(messages(late.socket, 'roster')).toHaveLength(0); // no new world for them
    const seen = snapshots(late.socket);
    expect(seen.length).toBeGreaterThan(0); // but they watch
    expect(seen.at(-1)!.cars.map((c) => c.slot)).toEqual([0, 1]);
    expect(seen.at(-1)!.epoch).toBe(room.epoch);
    expect(a.socket.json().some((m) => m.t === 'roster' && (m.players as unknown[]).length === 3)).toBe(false);
  });

  it('keeps draining and acknowledging the inputs of a player who is watching', () => {
    const { room } = makeRoom();
    join(room, 'Ann');
    steps(room, 10);
    const late = join(room, 'Cy');
    for (let seq = 1; seq <= 40; seq++) {
      late.player.pushInput(seq, drive);
      room.step();
    }
    expect(snapshots(late.socket).at(-1)!.ackSeq).toBeGreaterThanOrEqual(38);
  });

  it('starts the countdown over without a player who leaves during it, instead of leaving their car behind', () => {
    const { room } = makeRoom({ rules: { countdownTicks: 200 } });
    const a = join(room, 'Ann');
    const b = join(room, 'Bob');
    const c = join(room, 'Cy');
    steps(room, 5);
    room.removePlayer(b.player);
    expect(messages(a.socket, 'ko')).toHaveLength(0); // nobody has driven yet: nobody is eliminated
    steps(room, 1);
    expect(room.epoch).toBe(2);
    expect(room.round).toBe(1); // the same round, started over
    expect(messages(a.socket, 'roster').at(-1)).toMatchObject({ epoch: 2, you: 0 });
    expect(messages(c.socket, 'roster').at(-1)).toMatchObject({ epoch: 2, you: 1 });
    expect(room.playerInfos().map((p) => p.name)).toEqual(['Ann', 'Cy']);
    steps(room, 400);
    expect(room.phase).toBe('live'); // Ann and Cy carry on
    expect(snapshots(a.socket).at(-1)!.cars.map((car) => car.slot)).toEqual([0, 1]);
  });

  it('turns a player who leaves once the countdown has restarted too often into a wreck, so nobody can hold a room back by joining and leaving', () => {
    const { room } = makeRoom({ rules: { countdownTicks: 200 } });
    const a = join(room, 'Ann');
    join(room, 'Bob');
    steps(room, 2);
    for (let i = 0; i < ROUND.MAX_COUNTDOWN_RESTARTS; i++) {
      const visitor = join(room, 'Vic');
      steps(room, 2);
      room.removePlayer(visitor.player);
    }
    expect(room.epoch).toBe(1 + ROUND.MAX_COUNTDOWN_RESTARTS);
    expect(messages(a.socket, 'ko').at(-1)).toMatchObject({ victim: 2, reason: 'disconnected' }); // the last visitor's car stays
    steps(room, 3);
    expect(room.epoch).toBe(1 + ROUND.MAX_COUNTDOWN_RESTARTS); // and the countdown keeps running
  });

  it('does not restart the countdown for somebody who joins and leaves again before it could', () => {
    const { room } = makeRoom({ rules: { countdownTicks: 100 } });
    const a = join(room, 'Ann');
    steps(room, 10);
    const visitor = join(room, 'Vic');
    room.removePlayer(visitor.player);
    steps(room, 5);
    expect(room.epoch).toBe(1);
    expect(messages(a.socket, 'roster')).toHaveLength(1);
  });

  it('still restarts the countdown when a player with a car leaves in the same tick as a newcomer who comes and goes', () => {
    const { room } = makeRoom({ rules: { countdownTicks: 100 } });
    join(room, 'Ann');
    const b = join(room, 'Bob');
    steps(room, 10);
    room.removePlayer(b.player);
    const visitor = join(room, 'Vic');
    room.removePlayer(visitor.player);
    steps(room, 1);
    expect(room.epoch).toBe(2);
    expect(room.playerInfos().map((p) => p.name)).toEqual(['Ann']);
  });

  it('stops stepping once its last human has left, instead of playing rounds against its bots until somebody disposes of it', () => {
    const { room, emptied } = makeRoom({ botFill: 4 });
    const a = join(room, 'Ann');
    steps(room, 5);
    const tick = room.simTick;
    room.removePlayer(a.player);
    expect(emptied).toEqual([room]);
    steps(room, 30);
    expect(room.simTick).toBe(tick);
  });

  it('gives a player who joins while the results are showing a car in the next round', () => {
    const { room } = makeRoom({ rules: { resultsTicks: 60 } });
    const a = join(room, 'Ann');
    const b = join(room, 'Bob');
    steps(room, 20);
    room.removePlayer(b.player);
    steps(room, 2);
    expect(room.phase).toBe('results');
    const c = join(room, 'Cy');
    expect(room.greeting(c.player).you).toBe(-1);
    steps(room, 70);
    expect(room.round).toBe(2);
    expect(messages(c.socket, 'roster').at(-1)).toMatchObject({ round: 2, you: 1 });
    expect(room.playerInfos().map((p) => p.name)).toEqual(['Ann', 'Cy']);
    expect(a.player.slot).toBe(0);
  });

  it('does not eliminate anybody who leaves while the results are showing', () => {
    const { room } = makeRoom({ rules: { resultsTicks: 300 } });
    const a = join(room, 'Ann');
    const b = join(room, 'Bob');
    steps(room, 20);
    room.removePlayer(b.player);
    steps(room, 2);
    expect(room.phase).toBe('results');
    const kos = messages(a.socket, 'ko').length;
    room.removePlayer(a.player); // the winner leaves too: the room empties
    expect(messages(a.socket, 'ko').length).toBe(kos);
  });

  it('ends the round when one car is left, names the winner, and starts the next round with a new world', () => {
    const { room } = makeRoom({ rules: { resultsTicks: 40 } });
    const a = join(room, 'Ann');
    const b = join(room, 'Bob');
    steps(room, 20);
    room.removePlayer(b.player); // Bob leaves mid-round: his car is out
    expect(messages(a.socket, 'ko')).toMatchObject([{ victim: 1, killer: -1, assists: [], reason: 'disconnected' }]);
    room.step();
    expect(room.phase).toBe('results');
    const [results] = messages(a.socket, 'results');
    expect(results).toMatchObject({ round: 1, winner: 0, reason: 'last' });
    expect((results!.rows as Array<Record<string, unknown>>).map((r) => [r.slot, r.name, r.alive])).toEqual([[0, 'Ann', true], [1, 'Bob', false]]);
    expect(messages(a.socket, 'phase').at(-1)).toMatchObject({ phase: 'results', remainingMs: 667 });
    steps(room, 41);
    expect(room.phase).toBe('countdown');
    expect(room.round).toBe(2);
    expect(room.epoch).toBe(2);
    expect(messages(a.socket, 'roster').at(-1)).toMatchObject({ epoch: 2, round: 2, you: 0 });
    expect(room.playerInfos().map((p) => p.name)).toEqual(['Ann']);
  });

  it('adds the win bonus to the winner and carries running scores into the next round', () => {
    const { room } = makeRoom({ rules: { resultsTicks: 10 } });
    const a = join(room, 'Ann');
    const b = join(room, 'Bob');
    steps(room, 20);
    room.removePlayer(b.player);
    room.step();
    const results = messages(a.socket, 'results')[0]!;
    const rows = results.rows as Array<Record<string, number>>;
    expect(rows[0]).toMatchObject({ slot: 0, gained: 100, score: 100, kills: 0 });
    expect(rows[1]).toMatchObject({ slot: 1, gained: 0, score: 0 });
    steps(room, 12);
    expect(messages(a.socket, 'scores').at(-1)).toMatchObject({ rows: [{ slot: 0, score: 100, kills: 0 }] });
  });

  it('ends the round when the time runs out; equal HP is a draw', () => {
    const { room } = makeRoom({ rules: { liveTicks: 50 } });
    const a = join(room);
    join(room);
    steps(room, 60);
    const [results] = messages(a.socket, 'results');
    expect(results).toMatchObject({ round: 1, winner: -1, reason: 'draw' });
    expect(room.phase).toBe('results');
  });

  it('plays a lone player without bots until the time runs out, since there is nobody to beat; surviving wins', () => {
    const { room } = makeRoom({ rules: { liveTicks: 200 } });
    const a = join(room);
    steps(room, 100);
    expect(room.phase).toBe('live');
    steps(room, 110);
    expect(messages(a.socket, 'results')[0]).toMatchObject({ winner: 0, reason: 'timeout' });
  });

  it('turns a departed player into a wreck that stays in the world and keeps its slot', () => {
    const { room } = makeRoom({ botFill: 4 });
    const a = join(room, 'Ann');
    const b = join(room, 'Bob');
    steps(room, 20);
    room.removePlayer(b.player);
    steps(room, 10);
    expect(room.phase).toBe('live'); // two bots and Ann are still running
    const snap = snapshots(a.socket).at(-1)!;
    expect(snap.cars.map((c) => c.slot)).toEqual([0, 1, 2, 3]);
    const wreck = snap.cars.find((c) => c.slot === 1)!;
    expect(wreck.flags & SNAP_FLAG_ALIVE).toBe(0);
    expect(wreck.hp).toBe(0);
    expect(room.playerInfos()[1]!.name).toBe('Bob');
    // and a new joiner does not inherit the wreck
    const late = join(room, 'Cy');
    expect(room.greeting(late.player).you).toBe(-1);
  });
});

describe('Room snapshots', () => {
  it('broadcasts snapshots at 30 Hz with every car, its hit points and whether it is running', () => {
    const { room } = makeRoom({ botFill: 4 });
    const a = join(room);
    steps(room, 60);
    const snaps = snapshots(a.socket);
    expect(snaps.length).toBeGreaterThanOrEqual(29);
    expect(snaps.length).toBeLessThanOrEqual(31);
    const last = snaps.at(-1)!;
    expect(last.epoch).toBe(1);
    expect(last.cars.map((c) => c.slot)).toEqual([0, 1, 2, 3]);
    for (const c of last.cars) {
      expect(c.flags & SNAP_FLAG_ALIVE).toBe(SNAP_FLAG_ALIVE);
      expect(c.hp).toBe(100);
    }
  });

  it('applies queued inputs (one per tick), moves the car and acknowledges sequence numbers', () => {
    const { room } = makeRoom();
    const a = join(room);
    steps(room, 3);
    for (let seq = 1; seq <= 90; seq++) {
      a.player.pushInput(seq, drive);
      room.step();
    }
    const snaps = snapshots(a.socket);
    const last = snaps.at(-1)!;
    expect(last.ackSeq).toBeGreaterThanOrEqual(88);
    expect(last.ackSeq).toBeLessThanOrEqual(90);
    expect(vlen(vsub(last.cars[0]!.state.pos, snaps[0]!.cars[0]!.state.pos))).toBeGreaterThan(3);
    expect(last.cars[0]!.throttle).toBe(1);
  });

  it('acknowledges inputs received before a round starts, so the first snapshot does not claim they are still pending', () => {
    const { room } = makeRoom();
    const a = join(room);
    for (let seq = 1; seq <= 10; seq++) a.player.pushInput(seq, drive);
    steps(room, 4);
    expect(snapshots(a.socket)[0]!.ackSeq).toBe(10);
  });

  it('acknowledges the inputs a new round discards', () => {
    const { room } = makeRoom({ rules: { liveTicks: 20, resultsTicks: 5 } });
    const a = join(room);
    let seq = 0;
    for (let t = 0; t < 28; t++) {
      a.player.pushInput(++seq, drive);
      room.step();
    }
    for (let i = 0; i < 6; i++) a.player.pushInput(++seq, drive); // in flight when the next round is built
    steps(room, 1);
    expect(room.epoch).toBe(2);
    const first = snapshots(a.socket).filter((s) => s.epoch === 2)[0];
    steps(room, 2);
    const firstOfNewRound = snapshots(a.socket).find((s) => s.epoch === 2)!;
    expect(first === undefined || first.ackSeq >= 28).toBe(true);
    expect(firstOfNewRound.ackSeq).toBeGreaterThanOrEqual(28);
  });

  it('neutralises the input echo after the input stream stalls', () => {
    const { room } = makeRoom();
    const a = join(room);
    steps(room, 4);
    a.player.pushInput(1, drive);
    steps(room, 120);
    const snaps = snapshots(a.socket);
    expect(snaps.find((s) => s.cars[0]!.throttle === 1)).toBeDefined();
    expect(snaps.at(-1)!.cars[0]!.throttle).toBe(0);
  });

  it('skips snapshots for a backed-up socket but still delivers JSON', () => {
    const { room } = makeRoom();
    const a = join(room);
    a.socket.bufferedAmount = NET.MAX_BUFFERED_BYTES + 1;
    steps(room, 30);
    expect(a.socket.binary()).toHaveLength(0);
    expect(a.player.skippedSnapshots).toBeGreaterThan(0);
    expect(messages(a.socket, 'roster')).toHaveLength(1);
  });
});

describe('Room lifecycle', () => {
  it('disconnects players who stay silent for 30 s', () => {
    const { room } = makeRoom();
    const a = join(room);
    steps(room, 3);
    a.player.ticksSinceInput = NET.INACTIVE_KICK_TICKS + 1;
    room.step();
    expect(a.socket.closed?.code).toBe(4001);
  });

  it('calls onEmpty exactly once when the last player leaves, and stepping a disposed room is a no-op', () => {
    const { room, emptied } = makeRoom();
    const a = join(room);
    const b = join(room);
    steps(room, 5);
    room.removePlayer(a.player);
    expect(emptied).toHaveLength(0);
    room.removePlayer(b.player);
    room.removePlayer(b.player); // second call is harmless
    expect(emptied).toEqual([room]);
    room.dispose();
    room.dispose();
    expect(() => steps(room, 5)).not.toThrow();
  });

  it('does nothing while nobody is in the room', () => {
    const { room } = makeRoom();
    expect(() => steps(room, 10)).not.toThrow();
    expect(room.epoch).toBe(0);
    expect(room.simTick).toBe(0);
  });
});
