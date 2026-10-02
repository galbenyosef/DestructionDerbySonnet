import { expect } from 'vitest';
import type { CarId } from '../../src/shared/cars';
import { decodeSnapshot, type Snapshot } from '../../src/shared/protocol';
import type { Simulation } from '../../src/shared/sim';
import { Player } from '../../src/server/player';
import { Room, type RoomOptions, type RoomRules } from '../../src/server/room';
import { FakeSocket } from './fakeSocket';

/** Rounds that start at once and last long enough not to end by themselves unless a test wants them to. */
export const QUICK: RoomRules = { countdownTicks: 2, liveTicks: 60_000, resultsTicks: 30 };

const rooms: Room[] = [];
/** Call from `afterEach` to free every room the test made. */
export const disposeRooms = (): void => {
  while (rooms.length) rooms.pop()!.dispose();
};

/** A room with no bots and quick rounds unless the test says otherwise. */
export function makeRoom(options: RoomOptions = {}): { room: Room; emptied: Room[] } {
  const emptied: Room[] = [];
  const room = new Room('ABCD', true, (r) => emptied.push(r), { botFill: 0, seed: 7, ...options, rules: { ...QUICK, ...options.rules } });
  rooms.push(room);
  return { room, emptied };
}

let nextId = 1;
export function join(room: Room, name = 'P', car?: CarId): { player: Player; socket: FakeSocket } {
  const socket = new FakeSocket();
  const player = new Player(nextId++, socket);
  player.name = name;
  if (car) player.car = car;
  expect(room.addPlayer(player)).toBe(true);
  return { player, socket };
}

export const steps = (room: Room, n: number): void => {
  for (let i = 0; i < n; i++) room.step();
};
export const snapshots = (socket: FakeSocket): Snapshot[] => socket.binary().map((b) => decodeSnapshot(b)!);
export type Json = Record<string, unknown> & { t: string };
export const messages = (socket: FakeSocket, type?: string): Json[] =>
  (socket.json() as Json[]).filter((m) => type === undefined || m.t === type);
export const drive = { throttle: 1, steer: 0, handbrake: false };

/** The room's current simulation (private; tests reach in to stage collisions). */
export const serverSim = (room: Room): Simulation => Reflect.get(room, 'sim') as Simulation;
