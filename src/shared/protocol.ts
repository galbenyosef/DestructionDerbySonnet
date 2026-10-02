import { ARENA_IDS, isArenaId, type ArenaId } from './arenas';
import { ARENA, NET } from './constants';
import { FLAG_HANDBRAKE, packInput, unpackInput, type CarInput } from './input';
import { clamp } from './math';
import type { CarState, Zone } from './types';

// ---- binary frames: first byte is the message type --------------------------------------------
export const MSG_INPUT = 1;
export const MSG_SNAPSHOT = 2;

/** Per-car flag bits inside snapshots (separate namespace from the input flags in input.ts). */
export const SNAP_FLAG_ALIVE = 1;
export const SNAP_FLAG_HANDBRAKE = 2;
export const SNAP_FLAG_GROUNDED = 4;

export const SNAPSHOT_HEADER_BYTES = 11;
export const SNAPSHOT_CAR_BYTES = 37;

// ---- JSON messages ------------------------------------------------------------------------------
export type JoinMode = 'quick' | 'create' | 'join';

export interface HelloMessage {
  t: 'hello';
  v: number;
  name: string;
  color: number;
  mode: JoinMode;
  code?: string;
}
export interface PingMessage {
  t: 'ping';
  id: number;
  c: number;
}
/** A vote for the next round's arena; counts only while the room shows its results. */
export interface VoteMessage {
  t: 'vote';
  arena: ArenaId;
}
export type ClientMessage = HelloMessage | PingMessage | VoteMessage;

/** Votes per arena (every arena is present; none is more than the seats in a room). */
export type VoteCounts = Record<ArenaId, number>;

export interface PlayerInfo {
  slot: number;
  name: string;
  color: number;
  /** True for server-driven cars. */
  bot?: boolean;
}
export interface RoomInfo {
  code: string;
  public: boolean;
  capacity: number;
}
export type ErrorCode =
  | 'bad_message'
  | 'bad_version'
  | 'already_joined'
  | 'room_full'
  | 'room_not_found'
  | 'server_full'
  | 'rate_limited'
  | 'too_many_rooms'
  | 'inactive';

export type Phase = 'countdown' | 'live' | 'results';
export type KoReason = 'damage' | 'flipped' | 'stuck' | 'bounds' | 'stall' | 'disconnected';
export type RoundEnd = 'last' | 'timeout' | 'no_humans' | 'draw';

export interface PhaseMessage {
  t: 'phase';
  phase: Phase;
  round: number;
  /** Time left in this phase when the message was sent. */
  remainingMs: number;
}
export interface ScoreRow {
  slot: number;
  score: number;
  kills: number;
}
export interface ResultRow {
  slot: number;
  name: string;
  color: number;
  bot: boolean;
  /** Running total in this room, and what this round added. */
  score: number;
  gained: number;
  kills: number;
  damage: number;
  hp: number;
  alive: boolean;
}

export interface WelcomeMessage {
  t: 'welcome';
  v: number;
  /** Your car's slot in the running round, or -1 when you are watching until the next round starts. */
  you: number;
  room: RoomInfo;
  epoch: number;
  /** The cars of the running round. */
  players: PlayerInfo[];
  /** The arena of the running (or coming) round, and the tally of the vote under way (all zero outside the results). */
  arena: ArenaId;
  votes: VoteCounts;
  tickRate: number;
  snapshotEvery: number;
  /** Where the room is in its round (null before the first round starts) and the running scores. */
  phase: PhaseMessage | null;
  scores: ScoreRow[];
  /** The round's latest hits, oldest first (at most NET.MAX_HIT_LOG): a newcomer replays them to dent and strip the cars as the players saw them. */
  dents: HitMessage[];
}
/** A new round's cars. Sent to every player, each with their own `you` (-1 when there is no car for them). */
export interface RosterMessage {
  t: 'roster';
  epoch: number;
  round: number;
  you: number;
  /** The arena this round is played in: the vote's winner. */
  arena: ArenaId;
  players: PlayerInfo[];
}
/** The vote's running tally: at most four a second while votes change, and an empty one when a results phase opens. */
export interface VotesMessage {
  t: 'votes';
  counts: VoteCounts;
}
export interface HitMessage {
  t: 'hit';
  tick: number;
  victim: number;
  /** Slot of the car that hit, or -1 for a wall or obstacle. */
  attacker: number;
  /** HP taken off, and the victim's HP afterwards. */
  dmg: number;
  hp: number;
  zone: Zone;
  /** Impulse of the impact in kN·s, and the contact point in the victim's local frame (metres). */
  j: number;
  p: [number, number, number];
}
export interface KoMessage {
  t: 'ko';
  tick: number;
  victim: number;
  /** Slot of the car credited with the elimination, or -1. */
  killer: number;
  assists: number[];
  reason: KoReason;
}
/** The room's running totals: at most four a second while points change, and once more right after `results` with that round folded in. */
export interface ScoresMessage {
  t: 'scores';
  rows: ScoreRow[];
}
export interface ResultsMessage {
  t: 'results';
  round: number;
  /** Slot of the winner, or -1 for a draw. */
  winner: number;
  reason: RoundEnd;
  rows: ResultRow[];
}
export interface PongMessage {
  t: 'pong';
  id: number;
  c: number;
  tick: number;
}
export interface ErrorMessage {
  t: 'error';
  code: ErrorCode;
  message: string;
}
export type ServerMessage =
  | WelcomeMessage
  | RosterMessage
  | VotesMessage
  | PhaseMessage
  | HitMessage
  | KoMessage
  | ScoresMessage
  | ResultsMessage
  | PongMessage
  | ErrorMessage;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Strict parser for anything a browser (or attacker) can send as text. Returns null when invalid. */
export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > NET.MAX_PAYLOAD_BYTES) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v)) return null;
  if (v.t === 'ping') {
    const id = v.id;
    const c = v.c;
    return isNum(id) && isNum(c) ? { t: 'ping', id, c } : null;
  }
  if (v.t === 'vote') {
    return isArenaId(v.arena) ? { t: 'vote', arena: v.arena } : null;
  }
  if (v.t === 'hello') {
    const mode = v.mode;
    const version = v.v;
    const name = v.name;
    const color = v.color;
    const code = v.code;
    if (mode !== 'quick' && mode !== 'create' && mode !== 'join') return null;
    if (!isInt(version) || typeof name !== 'string') return null;
    if (!isInt(color) || color < 0 || color > 0xffffff) return null;
    if (mode === 'join' && typeof code !== 'string') return null;
    return { t: 'hello', v: version, name, color, mode, code: typeof code === 'string' ? code : undefined };
  }
  return null;
}

const isSlot = (v: unknown): v is number => isInt(v) && v >= 0 && v < ARENA.MAX_CARS;
const isSlotOrNone = (v: unknown): v is number => isInt(v) && v >= -1 && v < ARENA.MAX_CARS;
const isVoteCounts = (v: unknown): v is VoteCounts =>
  isObj(v) && Object.keys(v).length === ARENA_IDS.length && ARENA_IDS.every((id) => isInt(v[id]) && (v[id] as number) >= 0 && (v[id] as number) <= ARENA.MAX_CARS);
const isList = (v: unknown): v is unknown[] => Array.isArray(v) && v.length <= ARENA.MAX_CARS;
const isPlayerInfo = (v: unknown): v is PlayerInfo =>
  isObj(v) && isSlot(v.slot) && typeof v.name === 'string' && isInt(v.color) && (v.bot === undefined || typeof v.bot === 'boolean');
const isScoreRow = (v: unknown): v is ScoreRow => isObj(v) && isSlot(v.slot) && isNum(v.score) && isNum(v.kills);
const isResultRow = (v: unknown): v is ResultRow =>
  isObj(v) && isSlot(v.slot) && typeof v.name === 'string' && isInt(v.color) && typeof v.bot === 'boolean' &&
  isNum(v.score) && isNum(v.gained) && isNum(v.kills) && isNum(v.damage) && isNum(v.hp) && typeof v.alive === 'boolean';
const PHASES: readonly unknown[] = ['countdown', 'live', 'results'];
const ZONES: readonly unknown[] = ['front', 'rear', 'left', 'right'];
const KO_REASONS: readonly unknown[] = ['damage', 'flipped', 'stuck', 'bounds', 'stall', 'disconnected'];
const ROUND_ENDS: readonly unknown[] = ['last', 'timeout', 'no_humans', 'draw'];
const isPhaseMessage = (v: unknown): v is PhaseMessage =>
  isObj(v) && v.t === 'phase' && PHASES.includes(v.phase) && isInt(v.round) && isNum(v.remainingMs) && v.remainingMs >= 0;
const isHitMessage = (v: unknown): v is HitMessage =>
  isObj(v) && v.t === 'hit' && isInt(v.tick) && isSlot(v.victim) && isSlotOrNone(v.attacker) && isNum(v.dmg) && v.dmg >= 0 && isNum(v.hp) && v.hp >= 0 &&
  ZONES.includes(v.zone) && isNum(v.j) && v.j >= 0 && Array.isArray(v.p) && v.p.length === 3 && v.p.every(isNum);

/** Defensive parser used by the client (and test clients) for server text frames. */
export function parseServerMessage(raw: string): ServerMessage | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v)) return null;
  switch (v.t) {
    case 'welcome': {
      const room = v.room;
      const players = v.players;
      const scores = v.scores;
      const dents = v.dents;
      if (
        isInt(v.v) && isSlotOrNone(v.you) && isArenaId(v.arena) && isVoteCounts(v.votes) && isInt(v.epoch) && isInt(v.tickRate) && isInt(v.snapshotEvery) &&
        isObj(room) && typeof room.code === 'string' && typeof room.public === 'boolean' && isInt(room.capacity) &&
        isList(players) && players.every(isPlayerInfo) &&
        (v.phase === null || isPhaseMessage(v.phase)) &&
        isList(scores) && scores.every(isScoreRow) &&
        Array.isArray(dents) && dents.length <= NET.MAX_HIT_LOG && dents.every(isHitMessage)
      ) {
        return v as unknown as WelcomeMessage;
      }
      return null;
    }
    case 'roster': {
      const players = v.players;
      return isInt(v.epoch) && isInt(v.round) && isSlotOrNone(v.you) && isArenaId(v.arena) && isList(players) && players.every(isPlayerInfo)
        ? (v as unknown as RosterMessage)
        : null;
    }
    case 'votes':
      return isVoteCounts(v.counts) ? (v as unknown as VotesMessage) : null;
    case 'phase':
      return isPhaseMessage(v) ? v : null;
    case 'hit':
      return isHitMessage(v) ? v : null;
    case 'ko': {
      const assists = v.assists;
      return isInt(v.tick) && isSlot(v.victim) && isSlotOrNone(v.killer) && isList(assists) && assists.every(isSlot) &&
        KO_REASONS.includes(v.reason)
        ? (v as unknown as KoMessage)
        : null;
    }
    case 'scores':
      return isList(v.rows) && v.rows.every(isScoreRow) ? (v as unknown as ScoresMessage) : null;
    case 'results':
      return isInt(v.round) && isSlotOrNone(v.winner) && ROUND_ENDS.includes(v.reason) && isList(v.rows) && v.rows.every(isResultRow)
        ? (v as unknown as ResultsMessage)
        : null;
    case 'pong':
      return isNum(v.id) && isNum(v.c) && isInt(v.tick) ? (v as unknown as PongMessage) : null;
    case 'error':
      return typeof v.code === 'string' && typeof v.message === 'string' ? (v as unknown as ErrorMessage) : null;
    default:
      return null;
  }
}

/** Removes control / bidi-override / zero-width characters, collapses spaces, caps at NAME_MAX code points. */
export function sanitizeName(raw: string, fallback: string): string {
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const capped = Array.from(cleaned).slice(0, NET.NAME_MAX).join('').trim();
  return capped.length > 0 ? capped : fallback;
}

const ROOM_CODE_RE = new RegExp(`^[${NET.ROOM_CODE_ALPHABET}]{${NET.ROOM_CODE_LENGTH}}$`);

/** Upper-cases and validates a room code; null when it can never exist. */
export function normalizeRoomCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return ROOM_CODE_RE.test(code) ? code : null;
}

// ---- input frame (client -> server): 8 bytes ---------------------------------------------------
export interface InputPacket {
  seq: number;
  input: CarInput;
}

export function encodeInput(seq: number, input: CarInput): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(8);
  const dv = new DataView(out.buffer);
  const p = packInput(input);
  dv.setUint8(0, MSG_INPUT);
  dv.setUint32(1, seq >>> 0, true);
  dv.setInt8(5, p.throttle);
  dv.setInt8(6, p.steer);
  dv.setUint8(7, p.flags);
  return out;
}

export function decodeInput(data: Uint8Array): InputPacket | null {
  if (data.byteLength !== 8) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (dv.getUint8(0) !== MSG_INPUT) return null;
  const throttle = dv.getInt8(5);
  const steer = dv.getInt8(6);
  if (throttle < -127 || steer < -127) return null; // -128 is never produced by packInput
  return {
    seq: dv.getUint32(1, true),
    input: unpackInput({ throttle, steer, flags: dv.getUint8(7) & FLAG_HANDBRAKE }),
  };
}

// ---- snapshot frame (server -> client) ---------------------------------------------------------
export interface SnapshotCar {
  slot: number;
  flags: number;
  hp: number;
  state: CarState;
  /** Echo of the car's current input, -1..1 (used for wheel animation and dead reckoning). */
  throttle: number;
  steer: number;
}

export interface Snapshot {
  epoch: number;
  tick: number;
  /** Highest input sequence number of the recipient that the server has consumed. */
  ackSeq: number;
  cars: SnapshotCar[];
}

const q16 = (v: number, scale: number): number => Math.round(clamp(v * scale, -32767, 32767));
const q8 = (v: number): number => (Number.isFinite(v) ? Math.round(clamp(v, -1, 1) * 127) + 0 : 0);

/** The recipient-independent part of a snapshot; build it once, then prepend a header per recipient. */
export function encodeCarBlock(cars: readonly SnapshotCar[]): Uint8Array {
  const out = new Uint8Array(cars.length * SNAPSHOT_CAR_BYTES);
  const dv = new DataView(out.buffer);
  cars.forEach((c, i) => {
    const o = i * SNAPSHOT_CAR_BYTES;
    const { pos, quat, linvel, angvel } = c.state;
    dv.setUint8(o, c.slot);
    dv.setUint8(o + 1, c.flags);
    dv.setUint8(o + 2, clamp(Math.round(c.hp), 0, 255));
    dv.setFloat32(o + 3, pos.x, true);
    dv.setFloat32(o + 7, pos.y, true);
    dv.setFloat32(o + 11, pos.z, true);
    dv.setInt16(o + 15, q16(quat.x, NET.QUAT_SCALE), true);
    dv.setInt16(o + 17, q16(quat.y, NET.QUAT_SCALE), true);
    dv.setInt16(o + 19, q16(quat.z, NET.QUAT_SCALE), true);
    dv.setInt16(o + 21, q16(quat.w, NET.QUAT_SCALE), true);
    dv.setInt16(o + 23, q16(linvel.x, NET.LINVEL_SCALE), true);
    dv.setInt16(o + 25, q16(linvel.y, NET.LINVEL_SCALE), true);
    dv.setInt16(o + 27, q16(linvel.z, NET.LINVEL_SCALE), true);
    dv.setInt16(o + 29, q16(angvel.x, NET.ANGVEL_SCALE), true);
    dv.setInt16(o + 31, q16(angvel.y, NET.ANGVEL_SCALE), true);
    dv.setInt16(o + 33, q16(angvel.z, NET.ANGVEL_SCALE), true);
    dv.setInt8(o + 35, q8(c.throttle));
    dv.setInt8(o + 36, q8(c.steer));
  });
  return out;
}

export function buildSnapshotPacket(epoch: number, tick: number, ackSeq: number, count: number, block: Uint8Array): Uint8Array {
  const out = new Uint8Array(SNAPSHOT_HEADER_BYTES + block.byteLength);
  const dv = new DataView(out.buffer);
  dv.setUint8(0, MSG_SNAPSHOT);
  dv.setUint8(1, epoch & 0xff);
  dv.setUint32(2, tick >>> 0, true);
  dv.setUint32(6, ackSeq >>> 0, true);
  dv.setUint8(10, count);
  out.set(block, SNAPSHOT_HEADER_BYTES);
  return out;
}

export const encodeSnapshot = (s: Snapshot): Uint8Array =>
  buildSnapshotPacket(s.epoch, s.tick, s.ackSeq, s.cars.length, encodeCarBlock(s.cars));

export function decodeSnapshot(data: Uint8Array): Snapshot | null {
  if (data.byteLength < SNAPSHOT_HEADER_BYTES) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (dv.getUint8(0) !== MSG_SNAPSHOT) return null;
  const count = dv.getUint8(10);
  if (count > ARENA.MAX_CARS || data.byteLength !== SNAPSHOT_HEADER_BYTES + count * SNAPSHOT_CAR_BYTES) return null;
  const cars: SnapshotCar[] = [];
  for (let i = 0; i < count; i++) {
    const o = SNAPSHOT_HEADER_BYTES + i * SNAPSHOT_CAR_BYTES;
    const slot = dv.getUint8(o);
    if (slot >= ARENA.MAX_CARS) return null;
    const qx = dv.getInt16(o + 15, true) / NET.QUAT_SCALE;
    const qy = dv.getInt16(o + 17, true) / NET.QUAT_SCALE;
    const qz = dv.getInt16(o + 19, true) / NET.QUAT_SCALE;
    const qw = dv.getInt16(o + 21, true) / NET.QUAT_SCALE;
    const qn = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) || 1;
    cars.push({
      slot,
      flags: dv.getUint8(o + 1),
      hp: dv.getUint8(o + 2),
      state: {
        pos: { x: dv.getFloat32(o + 3, true), y: dv.getFloat32(o + 7, true), z: dv.getFloat32(o + 11, true) },
        quat: { x: qx / qn, y: qy / qn, z: qz / qn, w: qw / qn },
        linvel: {
          x: dv.getInt16(o + 23, true) / NET.LINVEL_SCALE,
          y: dv.getInt16(o + 25, true) / NET.LINVEL_SCALE,
          z: dv.getInt16(o + 27, true) / NET.LINVEL_SCALE,
        },
        angvel: {
          x: dv.getInt16(o + 29, true) / NET.ANGVEL_SCALE,
          y: dv.getInt16(o + 31, true) / NET.ANGVEL_SCALE,
          z: dv.getInt16(o + 33, true) / NET.ANGVEL_SCALE,
        },
      },
      throttle: dv.getInt8(o + 35) / 127,
      steer: dv.getInt8(o + 36) / 127,
    });
  }
  return { epoch: dv.getUint8(1), tick: dv.getUint32(2, true), ackSeq: dv.getUint32(6, true), cars };
}
