import { randomInt } from 'node:crypto';
import { NET } from '../shared/constants';
import type { ErrorCode } from '../shared/protocol';
import type { Player } from './player';
import { Room, type RoomOptions } from './room';

export type JoinResult = { ok: true; room: Room } | { ok: false; code: ErrorCode };

export interface LobbyOptions {
  maxRooms: number;
  /** A number in [0, 1) that picks the letters of a room code. Injectable for tests; the default is cryptographically random, so codes cannot be predicted. */
  random?: () => number;
  /** Round timing, bot count and bot seed for every room. */
  room?: RoomOptions;
}

export class Lobby {
  private readonly rooms = new Map<string, Room>();
  private readonly random: () => number;

  constructor(private readonly options: LobbyOptions) {
    this.random = options.random ?? (() => randomInt(0x1_0000_0000) / 0x1_0000_0000);
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  get playerCount(): number {
    let n = 0;
    for (const r of this.rooms.values()) n += r.playerCount;
    return n;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  /**
   * Joins a public room that still has space and where a car is soonest: one that is between rounds or has not started,
   * then the fullest, or opens a new public room.
   */
  quickPlay(player: Player): JoinResult {
    let best: Room | null = null;
    for (const r of this.rooms.values()) {
      if (!r.isPublic || r.isFull) continue;
      if (!best || (r.carSoon && !best.carSoon) || (r.carSoon === best.carSoon && r.playerCount > best.playerCount)) best = r;
    }
    if (!best) {
      if (this.rooms.size >= this.options.maxRooms) return { ok: false, code: 'server_full' };
      best = this.createRoom(true);
    }
    return this.seat(best, player);
  }

  createPrivate(player: Player): JoinResult {
    if (this.rooms.size >= this.options.maxRooms) return { ok: false, code: 'server_full' };
    return this.seat(this.createRoom(false), player);
  }

  /** `code` must already be normalised (see normalizeRoomCode). */
  join(player: Player, code: string): JoinResult {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, code: 'room_not_found' };
    if (room.isFull) return { ok: false, code: 'room_full' };
    return this.seat(room, player);
  }

  leave(player: Player): void {
    player.room?.removePlayer(player);
  }

  /** Steps every room. A room that throws is closed on its own; it never takes the other rooms down with it. */
  tickAll(): void {
    for (const room of [...this.rooms.values()]) {
      try {
        room.step();
      } catch (err) {
        console.error(`room ${room.code} failed and was closed:`, err);
        this.rooms.delete(room.code);
        for (const player of room.seated()) player.close(1011, 'internal error');
        room.dispose();
      }
    }
  }

  dispose(): void {
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
  }

  private seat(room: Room, player: Player): JoinResult {
    return room.addPlayer(player) ? { ok: true, room } : { ok: false, code: 'room_full' };
  }

  private createRoom(isPublic: boolean): Room {
    const code = this.newCode();
    const room = new Room(
      code,
      isPublic,
      (r) => {
        this.rooms.delete(r.code);
        r.dispose();
      },
      { seed: (Math.random() * 0x1_0000_0000) >>> 0, ...this.options.room },
    );
    this.rooms.set(code, room);
    return room;
  }

  private newCode(): string {
    const alphabet = NET.ROOM_CODE_ALPHABET;
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < NET.ROOM_CODE_LENGTH; i++) {
        code += alphabet[Math.min(alphabet.length - 1, Math.floor(this.random() * alphabet.length))];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('could not allocate a room code');
  }
}
