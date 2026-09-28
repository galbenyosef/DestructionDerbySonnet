import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ARENA, NET } from '../../src/shared/constants';
import { vlen, vsub } from '../../src/shared/math';
import { initPhysics } from '../../src/shared/physics';
import { SNAP_FLAG_ALIVE, decodeSnapshot, type Snapshot } from '../../src/shared/protocol';
import { Player } from '../../src/server/player';
import { Room } from '../../src/server/room';
import { FakeSocket } from '../helpers/fakeSocket';

beforeAll(async () => {
  await initPhysics();
});

const rooms: Room[] = [];
function makeRoom(): { room: Room; emptied: Room[] } {
  const emptied: Room[] = [];
  const room = new Room('ABCD', true, (r) => emptied.push(r));
  rooms.push(room);
  return { room, emptied };
}
afterEach(() => {
  while (rooms.length) rooms.pop()!.dispose();
});

let nextId = 1;
function join(room: Room, name = 'P'): { player: Player; socket: FakeSocket } {
  const socket = new FakeSocket();
  const player = new Player(nextId++, socket);
  player.name = name;
  expect(room.addPlayer(player)).toBeGreaterThanOrEqual(0);
  return { player, socket };
}
const steps = (room: Room, n: number): void => {
  for (let i = 0; i < n; i++) room.step();
};
const snapshots = (socket: FakeSocket): Snapshot[] => socket.binary().map((b) => decodeSnapshot(b)!);
const drive = { throttle: 1, steer: 0, handbrake: false };

describe('Room seating', () => {
  it('seats players in slots 0..7 and rejects a 9th', () => {
    const { room } = makeRoom();
    const players = Array.from({ length: 8 }, (_, i) => join(room, `P${i}`));
    expect(players.map((p) => p.player.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(room.isFull).toBe(true);
    expect(room.playerCount).toBe(8);
    expect(room.addPlayer(new Player(999, new FakeSocket()))).toBe(-1);
  });

  it('describes itself and its players', () => {
    const { room } = makeRoom();
    join(room, 'Ann');
    join(room, 'Bob');
    expect(room.info()).toEqual({ code: 'ABCD', public: true, capacity: ARENA.MAX_CARS });
    expect(room.playerInfos().map((p) => [p.slot, p.name])).toEqual([[0, 'Ann'], [1, 'Bob']]);
  });

  it('reuses the lowest free slot after someone leaves', () => {
    const { room } = makeRoom();
    const a = join(room);
    join(room);
    room.removePlayer(a.player);
    expect(a.player.slot).toBe(-1);
    expect(join(room).player.slot).toBe(0);
  });
});

describe('Room world rebuild and snapshots', () => {
  it('rebuilds the world after the delay and announces the roster with a new epoch', () => {
    const { room } = makeRoom();
    const a = join(room, 'Ann');
    const b = join(room, 'Bob');
    steps(room, NET.REBUILD_DELAY_TICKS - 1);
    expect(a.socket.json()).toHaveLength(0);
    steps(room, 1);
    for (const s of [a, b]) {
      const roster = s.socket.json().find((m) => m.t === 'roster')!;
      expect(roster.epoch).toBe(1);
      expect(roster.players).toHaveLength(2);
    }
    expect(room.epoch).toBe(1);
  });

  it('broadcasts snapshots at 30 Hz containing every seated car', () => {
    const { room } = makeRoom();
    const a = join(room);
    join(room);
    steps(room, NET.REBUILD_DELAY_TICKS + 60);
    const snaps = snapshots(a.socket);
    expect(snaps.length).toBeGreaterThanOrEqual(29);
    expect(snaps.length).toBeLessThanOrEqual(31);
    const last = snaps[snaps.length - 1]!;
    expect(last.epoch).toBe(1);
    expect(last.cars.map((c) => c.slot)).toEqual([0, 1]);
    expect(last.cars[0]!.flags & SNAP_FLAG_ALIVE).toBe(SNAP_FLAG_ALIVE);
    expect(last.cars[0]!.hp).toBe(100);
  });

  it('applies queued inputs (one per tick), moves the car and acknowledges sequence numbers', () => {
    const { room } = makeRoom();
    const a = join(room);
    steps(room, NET.REBUILD_DELAY_TICKS);
    for (let seq = 1; seq <= 90; seq++) {
      a.player.pushInput(seq, drive);
      room.step();
    }
    const snaps = snapshots(a.socket);
    const first = snaps[0]!;
    const last = snaps[snaps.length - 1]!;
    expect(last.ackSeq).toBeGreaterThanOrEqual(88);
    expect(last.ackSeq).toBeLessThanOrEqual(90);
    expect(vlen(vsub(last.cars[0]!.state.pos, first.cars[0]!.state.pos))).toBeGreaterThan(3);
    expect(last.cars[0]!.throttle).toBe(1);
  });

  it('neutralises the input echo after the input stream stalls', () => {
    const { room } = makeRoom();
    const a = join(room);
    steps(room, NET.REBUILD_DELAY_TICKS);
    a.player.pushInput(1, drive);
    steps(room, 120);
    const snaps = snapshots(a.socket);
    expect(snaps[0]!.cars[0]!.throttle).toBe(1);
    expect(snaps[snaps.length - 1]!.cars[0]!.throttle).toBe(0);
  });

  it('drops a departed player from snapshots immediately and rebuilds later', () => {
    const { room } = makeRoom();
    const a = join(room);
    const b = join(room);
    steps(room, NET.REBUILD_DELAY_TICKS + 4);
    room.removePlayer(a.player);
    const before = b.socket.binary().length;
    steps(room, 4);
    const fresh = snapshots(b.socket).slice(before); // only the snapshots sent after the departure
    expect(fresh.length).toBeGreaterThan(0);
    for (const s of fresh) expect(s.cars.map((c) => c.slot)).toEqual([1]);
    steps(room, NET.REBUILD_DELAY_TICKS);
    const rosters = b.socket.json().filter((m) => m.t === 'roster');
    expect((rosters[rosters.length - 1]!.players as unknown[]).length).toBe(1);
    expect(room.epoch).toBe(2);
  });

  it('skips snapshots for a backed-up socket but still delivers JSON', () => {
    const { room } = makeRoom();
    const a = join(room);
    a.socket.bufferedAmount = NET.MAX_BUFFERED_BYTES + 1;
    steps(room, NET.REBUILD_DELAY_TICKS + 20);
    expect(a.socket.binary()).toHaveLength(0);
    expect(a.player.skippedSnapshots).toBeGreaterThan(0);
    expect(a.socket.json().some((m) => m.t === 'roster')).toBe(true);
  });

  it('lets a player who joins after a rebuild wait for the next one without breaking the running world', () => {
    const { room } = makeRoom();
    const a = join(room);
    steps(room, NET.REBUILD_DELAY_TICKS + 10);
    const late = join(room);
    expect(() => steps(room, 5)).not.toThrow();
    expect(snapshots(late.socket).length).toBe(0); // no car yet, so no snapshots
    steps(room, NET.REBUILD_DELAY_TICKS);
    const snaps = snapshots(late.socket);
    expect(snaps.length).toBeGreaterThan(0);
    expect(snaps[snaps.length - 1]!.cars.map((c) => c.slot)).toEqual([0, 1]);
    expect(a.socket.json().filter((m) => m.t === 'roster')).toHaveLength(2);
  });
});

describe('Room lifecycle', () => {
  it('disconnects players who stay silent for 30 s', () => {
    const { room } = makeRoom();
    const a = join(room);
    steps(room, NET.REBUILD_DELAY_TICKS);
    a.player.ticksSinceInput = NET.INACTIVE_KICK_TICKS + 1;
    room.step();
    expect(a.socket.closed?.code).toBe(4001);
  });

  it('calls onEmpty exactly once when the last player leaves, and stepping a disposed room is a no-op', () => {
    const { room, emptied } = makeRoom();
    const a = join(room);
    const b = join(room);
    steps(room, NET.REBUILD_DELAY_TICKS + 2);
    room.removePlayer(a.player);
    expect(emptied).toHaveLength(0);
    room.removePlayer(b.player);
    room.removePlayer(b.player); // second call is harmless
    expect(emptied).toEqual([room]);
    room.dispose();
    room.dispose();
    expect(() => steps(room, 5)).not.toThrow();
  });
});
