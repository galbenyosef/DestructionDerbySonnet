import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ARENA, NET } from '../../src/shared/constants';
import { initPhysics } from '../../src/shared/physics';
import { Lobby, type JoinResult } from '../../src/server/lobby';
import { Player } from '../../src/server/player';
import type { RoomOptions } from '../../src/server/room';
import { FakeSocket } from '../helpers/fakeSocket';

beforeAll(async () => {
  await initPhysics();
});

const lobbies: Lobby[] = [];
const makeLobby = (maxRooms = 5, random?: () => number, room?: RoomOptions): Lobby => {
  const l = new Lobby({ maxRooms, random, room: { botFill: 0, ...room } });
  lobbies.push(l);
  return l;
};
afterEach(() => {
  while (lobbies.length) lobbies.pop()!.dispose();
});

let nextId = 1;
const newPlayer = (): Player => new Player(nextId++, new FakeSocket());
function ok(result: JoinResult) {
  if (!result.ok) throw new Error(`expected a successful join, got ${result.code}`);
  return result;
}

describe('Lobby room codes', () => {
  it('are not drawn from Math.random: a stuck Math.random still gives every room its own code', () => {
    const stuck = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const lobby = makeLobby(30);
      const codes = new Set<string>();
      for (let i = 0; i < 20; i++) codes.add(ok(lobby.createPrivate(newPlayer())).room.code);
      expect(codes.size).toBe(20);
      for (const code of codes) expect(code).toMatch(new RegExp(`^[${NET.ROOM_CODE_ALPHABET}]{${NET.ROOM_CODE_LENGTH}}$`));
    } finally {
      stuck.mockRestore();
    }
  });

  it('spread over the whole alphabet', () => {
    const lobby = makeLobby(300);
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) for (const ch of ok(lobby.createPrivate(newPlayer())).room.code) seen.add(ch);
    expect(seen.size).toBeGreaterThan(NET.ROOM_CODE_ALPHABET.length - 3);
  });
});

describe('Lobby quick play', () => {
  it('puts players into the same public room until it is full, then opens another', () => {
    const lobby = makeLobby();
    const first = ok(lobby.quickPlay(newPlayer()));
    for (let i = 1; i < ARENA.MAX_CARS; i++) expect(ok(lobby.quickPlay(newPlayer())).room).toBe(first.room);
    expect(first.room.isFull).toBe(true);
    const ninth = ok(lobby.quickPlay(newPlayer()));
    expect(ninth.room).not.toBe(first.room);
    expect(lobby.roomCount).toBe(2);
    expect(lobby.playerCount).toBe(9);
  });

  it('prefers the fullest public room that still has space', () => {
    const lobby = makeLobby();
    const a = ok(lobby.quickPlay(newPlayer())).room;
    for (let i = 1; i < ARENA.MAX_CARS; i++) lobby.quickPlay(newPlayer()); // fill room A
    const b = ok(lobby.quickPlay(newPlayer())).room; // room B with 1 player
    ok(lobby.quickPlay(newPlayer())); // -> B (2 players)
    const leaver = a.seated()[0]!;
    lobby.leave(leaver); // A now has 7
    expect(ok(lobby.quickPlay(newPlayer())).room).toBe(a); // A (7) is fuller than B (2)
    expect(b.playerCount).toBe(2);
  });

  it('prefers a room where a car comes soon (between rounds) over a fuller one that is mid-round', () => {
    const lobby = makeLobby(5, undefined, { rules: { countdownTicks: 2, liveTicks: 30, resultsTicks: 500 } });
    const crowded = ok(lobby.quickPlay(newPlayer())).room;
    for (let i = 1; i < ARENA.MAX_CARS; i++) lobby.quickPlay(newPlayer());
    const quiet = ok(lobby.quickPlay(newPlayer())).room; // the ninth player opens a second public room
    expect(quiet).not.toBe(crowded);
    for (let i = 0; i < 5; i++) crowded.step(); // the crowded room is now mid-round
    for (let i = 0; i < 40; i++) quiet.step(); // the quiet room has finished its round
    expect([crowded.phase, quiet.phase]).toEqual(['live', 'results']);
    for (const p of crowded.seated().slice(0, 5)) lobby.leave(p); // both rooms have space now: 3 humans against 1
    expect(ok(lobby.quickPlay(newPlayer())).room).toBe(quiet);
    for (let i = 0; i < 700 && quiet.phase !== 'live'; i++) quiet.step(); // the quiet room starts its next round
    expect(quiet.phase).toBe('live');
    expect(ok(lobby.quickPlay(newPlayer())).room).toBe(crowded); // both are mid-round now, so the fuller one wins
  });

  it('never places quick-play players into private rooms', () => {
    const lobby = makeLobby();
    const priv = ok(lobby.createPrivate(newPlayer())).room;
    const pub = ok(lobby.quickPlay(newPlayer())).room;
    expect(pub).not.toBe(priv);
    expect(pub.isPublic).toBe(true);
    expect(priv.isPublic).toBe(false);
  });

  it('reports server_full when the room limit is reached', () => {
    const lobby = makeLobby(1);
    for (let i = 0; i < ARENA.MAX_CARS; i++) ok(lobby.quickPlay(newPlayer()));
    expect(lobby.quickPlay(newPlayer())).toEqual({ ok: false, code: 'server_full' });
    expect(lobby.createPrivate(newPlayer())).toEqual({ ok: false, code: 'server_full' });
  });
});

describe('Lobby private rooms', () => {
  it('creates rooms with unique 4-letter codes from the allowed alphabet', () => {
    const lobby = makeLobby(200);
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const code = ok(lobby.createPrivate(newPlayer())).room.code;
      expect(code).toMatch(new RegExp(`^[${NET.ROOM_CODE_ALPHABET}]{${NET.ROOM_CODE_LENGTH}}$`));
      codes.add(code);
    }
    expect(codes.size).toBe(100);
  });

  it('builds codes from the injected random source', () => {
    const values = [0.5 / 24, 1.5 / 24, 2.5 / 24, 3.5 / 24]; // mid-bucket values avoid floating-point edge cases
    let i = 0;
    const lobby = makeLobby(5, () => values[i++ % values.length]!);
    expect(ok(lobby.createPrivate(newPlayer())).room.code).toBe('ABCD');
  });

  it('joins by code, and reports unknown or full rooms', () => {
    const lobby = makeLobby();
    const created = ok(lobby.createPrivate(newPlayer()));
    const joined = ok(lobby.join(newPlayer(), created.room.code));
    expect(joined.room).toBe(created.room);
    expect(joined.slot).toBe(-1); // a car comes with the next roster
    expect(lobby.join(newPlayer(), 'ZZZZ')).toEqual({ ok: false, code: 'room_not_found' });
    for (let i = 2; i < ARENA.MAX_CARS; i++) ok(lobby.join(newPlayer(), created.room.code));
    expect(lobby.join(newPlayer(), created.room.code)).toEqual({ ok: false, code: 'room_full' });
  });
});

describe('Lobby lifecycle', () => {
  it('removes and disposes a room when its last player leaves', () => {
    const lobby = makeLobby();
    const a = newPlayer();
    const b = newPlayer();
    const { room } = ok(lobby.quickPlay(a));
    ok(lobby.quickPlay(b));
    lobby.leave(a);
    expect(lobby.roomCount).toBe(1);
    lobby.leave(b);
    lobby.leave(b); // harmless
    expect(lobby.roomCount).toBe(0);
    expect(lobby.getRoom(room.code)).toBeUndefined();
  });

  it('isolates a room whose tick throws: its players are closed, the room is dropped, other rooms keep running', () => {
    const lobby = makeLobby();
    const sockets = [new FakeSocket(), new FakeSocket()];
    const players = sockets.map((s) => new Player(nextId++, s));
    const broken = ok(lobby.createPrivate(players[0]!)).room;
    ok(lobby.createPrivate(players[1]!));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(broken, 'step').mockImplementation(() => {
      throw new Error('wasm panic');
    });
    expect(() => lobby.tickAll()).not.toThrow();
    expect(sockets[0]!.closed).toEqual({ code: 1011, reason: 'internal error' });
    expect(lobby.getRoom(broken.code)).toBeUndefined();
    expect(lobby.roomCount).toBe(1);
    expect(log).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i++) lobby.tickAll();
    expect(sockets[1]!.json().some((m) => m.t === 'roster')).toBe(true); // the healthy room still runs
    expect(sockets[1]!.closed).toBeNull();
    log.mockRestore();
    lobby.leave(players[0]!); // the late socket-close event of a failed room is harmless
    expect(lobby.roomCount).toBe(1);
  });

  it('steps every room on tickAll', () => {
    const lobby = makeLobby();
    const sockets = [new FakeSocket(), new FakeSocket()];
    const players = sockets.map((s) => new Player(nextId++, s));
    ok(lobby.createPrivate(players[0]!));
    ok(lobby.createPrivate(players[1]!));
    for (let i = 0; i < 3; i++) lobby.tickAll();
    for (const s of sockets) expect(s.json().some((m) => m.t === 'roster')).toBe(true);
  });
});
