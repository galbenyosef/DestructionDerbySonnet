# Wreckyard Plan 2 — Multiplayer Baseline (M2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real-time online multiplayer on top of the Plan 1 simulation: a Node server with lobby, rooms, a 60 Hz authoritative loop, a compact binary protocol and 30 Hz snapshots, and a browser client with a menu, snapshot interpolation and a minimal HUD. Two people can open the site, land in the same room and shove each other around.

**Architecture:** The server owns one `Simulation` (from Plan 1) per room and steps every room from a single 60 Hz loop. Clients send 8-byte binary inputs at 60 Hz; the server consumes one input per tick per player and broadcasts a binary snapshot every 2nd tick. The browser renders *interpolated* snapshots (no prediction yet — that is Plan 3). Any roster change rebuilds the room's world after 0.5 s and bumps an `epoch` so stale snapshots are dropped; rounds and combat replace this in later plans.

**Tech Stack:** as Plan 1, plus `ws` (`noServer` mode, HTTP `upgrade` handler).

**Scope note:** the spec lists "spectate until the next round" under M2. That only makes sense once rounds exist, so it moves to Plan 4. Until then a player who joins simply waits up to 0.5 s for the next world rebuild (and the arena resets for everyone).

**Spec:** `docs/superpowers/specs/2026-09-28-wreckyard-design.md`. **Prerequisite:** Plan 1 complete and its playtest gate passed (`2026-09-28-wreckyard-plan-1-offline-foundation.md`). Re-read this plan against any constants or exports that changed during that playtest.

## Global Constraints

- Everything in Plan 1's Global Constraints still applies (single package, relative imports, exact pins, axes, deterministic sim path, `removeVehicleController` on dispose, `PCFShadowMap`/`Timer`, no commits unless the user opted in).
- Server: 60 Hz simulation; snapshot every 2nd tick (30 Hz); WebSocket via `WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false })` attached through the HTTP `upgrade` handler; heartbeat ping every 30 s; skip a snapshot for a socket whose `bufferedAmount` > 65536.
- Wire format (little-endian): input frame = 8 bytes (`type u8=1, seq u32, throttle i8, steer i8, flags u8`); snapshot = 11-byte header (`type u8=2, epoch u8, tick u32, ackSeq u32, count u8`) + 37 bytes per car (`slot u8, flags u8, hp u8, pos f32×3, quat i16×4 (scale 32767), linvel i16×3 (scale 512), angvel i16×3 (scale 1024), throttle i8, steer i8`). `PROTOCOL_VERSION = 1`.
- Rooms: capacity 8 (`ARENA.MAX_CARS`); 4-letter codes from `ABCDEFGHJKLMNPQRSTUVWXYZ`; `MAX_ROOMS` default 12; `MAX_CONNECTIONS` default 200; names ≤ 16 code points.
- Input handling: one input consumed per tick per player; the last input repeats on starvation and becomes neutral after 30 starved ticks (0.5 s); queue depth ≤ 6; a player with no input for 1800 ticks (30 s) is closed with code 4001 `inactive`.
- Client interpolation: render delay 100 ms, extrapolate at most 250 ms.
- Server code must `await initPhysics()` before creating any room; tests do so in `beforeAll`.
- Baseline rebuild policy (temporary, replaced by rounds later): a roster change schedules a world rebuild 30 ticks later and increments `epoch` (u8, wraps).

## Review Focus

1. **Hostile or malformed traffic.** Garbage/oversize JSON, wrong field types, binary frames before `hello`, oversize frames, `hello` twice, wrong protocol version. Expected: the offending socket gets an error or is closed; the server, its rooms and other players are unaffected. → parse tests (Task 7), server behaviour tests (Task 10).
2. **Abrupt disconnects and the last player leaving.** Expected: the seat is freed, others continue, and when the room empties it is disposed (WASM freed) and disappears from the lobby. → room/lobby tests (Task 9), integration tests (Task 10).
3. **Input starvation** (hidden tab, stalled network). Expected: input becomes neutral after 0.5 s so a car cannot drive forever, and a player idle for 30 s is disconnected. → `Player` tests (Task 8), room tests (Task 9), integration tests (Task 10).
4. **Stale, duplicate, reordered or wrapped sequence numbers, and epoch changes.** Expected: old inputs are ignored (u32 wrap-aware); snapshots from an old epoch or older ticks are dropped by the client. → `Player` tests (Task 8), `SnapshotInterpolator` tests (Task 11).
5. **Bad names, room codes and capacity.** Empty/over-long/control-character names, lower-case or invalid codes, unknown codes, a 9th player, server at `MAX_ROOMS`. Expected: sanitised names, a clear error code, no crash. → Tasks 7, 9 and 10.

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/constants.ts` (modify) | add the `NET` block |
| `src/shared/protocol.ts` | message types, JSON parsers, sanitisers, binary codecs |
| `src/shared/vehicle.ts` (modify) | extract `steeringAngle()` for reuse by the client |
| `src/server/limits.ts` | `TokenBucket` |
| `src/server/player.ts` | `Player` (socket wrapper, input queue, backpressure) |
| `src/server/static.ts` | safe static-file handler |
| `src/server/room.ts` | `Room` (seats, rebuild policy, tick, snapshots) |
| `src/server/lobby.ts` | `Lobby` (quick play, private rooms, codes) |
| `src/server/app.ts`, `src/server/index.ts` (replace) | HTTP + WebSocket server, tick loop, entry point |
| `src/client/net/connection.ts` | `Connection` (WebSocket wrapper, RTT), `serverUrl()` |
| `src/client/net/interp.ts` | `SnapshotInterpolator` |
| `src/client/ui/menu.ts`, `src/client/ui/hud.ts` | DOM menu and HUD |
| `src/client/game/gameClient.ts` | wires connection, interpolation, views, camera, input |
| `src/client/main.ts`, `src/client/index.html` (modify) | routing (`?sandbox`, `?auto=`), styles |
| `scripts/bot.ts` | headless bot client for manual multiplayer testing |
| `tests/protocol.test.ts`, `tests/server/*.test.ts`, `tests/client/{interp,connection}.test.ts`, `tests/helpers/*` | Vitest |

---

### Task 7: `NET` constants and the wire protocol

**Files:**
- Modify: `src/shared/constants.ts` (append the `NET` block)
- Create: `src/shared/protocol.ts`
- Test: `tests/protocol.test.ts`

**Interfaces:**
- Consumes: `ARENA` (constants), `packInput`, `unpackInput`, `FLAG_HANDBRAKE`, `CarInput` (input), `clamp` (math), `CarState` (types).
- Produces (later tasks rely on these exact names):
  - `constants.ts`: `NET` = `{PROTOCOL_VERSION, SNAPSHOT_EVERY, REBUILD_DELAY_TICKS, INPUT_QUEUE_MAX, INPUT_STARVE_NEUTRAL_TICKS, INACTIVE_KICK_TICKS, MAX_BUFFERED_BYTES, MAX_PAYLOAD_BYTES, HEARTBEAT_MS, NAME_MAX, ROOM_CODE_LENGTH, ROOM_CODE_ALPHABET, QUAT_SCALE, LINVEL_SCALE, ANGVEL_SCALE, INTERP_DELAY_MS, MAX_EXTRAPOLATION_MS}`.
  - `protocol.ts`:
    - byte constants `MSG_INPUT = 1`, `MSG_SNAPSHOT = 2`, `SNAP_FLAG_ALIVE = 1`, `SNAP_FLAG_HANDBRAKE = 2`, `SNAP_FLAG_GROUNDED = 4`, `SNAPSHOT_HEADER_BYTES = 11`, `SNAPSHOT_CAR_BYTES = 37`.
    - types `JoinMode`, `HelloMessage`, `PingMessage`, `ClientMessage`, `PlayerInfo {slot, name, color}`, `RoomInfo {code, public, capacity}`, `ErrorCode`, `WelcomeMessage {t:'welcome', v, you, room, epoch, players, tickRate, snapshotEvery}`, `RosterMessage {t:'roster', epoch, players}`, `PongMessage {t:'pong', id, c, tick}`, `ErrorMessage {t:'error', code, message}`, `ServerMessage`, `InputPacket {seq, input}`, `SnapshotCar {slot, flags, hp, state: CarState, throttle, steer}`, `Snapshot {epoch, tick, ackSeq, cars}`.
    - functions `parseClientMessage(raw: string): ClientMessage | null`, `parseServerMessage(raw: string): ServerMessage | null`, `sanitizeName(raw: string, fallback: string): string`, `normalizeRoomCode(raw: string): string | null`, `encodeInput(seq: number, input: CarInput): Uint8Array`, `decodeInput(data: Uint8Array): InputPacket | null`, `encodeCarBlock(cars: readonly SnapshotCar[]): Uint8Array`, `buildSnapshotPacket(epoch, tick, ackSeq, count, block): Uint8Array`, `encodeSnapshot(s: Snapshot): Uint8Array`, `decodeSnapshot(data: Uint8Array): Snapshot | null`.

- [ ] **Step 1: Append the `NET` block to `src/shared/constants.ts`**

```ts
export const NET = {
  PROTOCOL_VERSION: 1,
  /** Simulation ticks per snapshot: 2 => 30 Hz. */
  SNAPSHOT_EVERY: 2,
  /** Ticks between a roster change and the world rebuild (baseline policy). */
  REBUILD_DELAY_TICKS: 30,
  INPUT_QUEUE_MAX: 6,
  /** Ticks without a fresh input before the last input is replaced by neutral (0.5 s). */
  INPUT_STARVE_NEUTRAL_TICKS: 30,
  /** Ticks without any input before the player is disconnected (30 s). */
  INACTIVE_KICK_TICKS: 60 * 30,
  MAX_BUFFERED_BYTES: 64 * 1024,
  MAX_PAYLOAD_BYTES: 1024,
  HEARTBEAT_MS: 30_000,
  NAME_MAX: 16,
  ROOM_CODE_LENGTH: 4,
  ROOM_CODE_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  QUAT_SCALE: 32767,
  LINVEL_SCALE: 512,
  ANGVEL_SCALE: 1024,
  INTERP_DELAY_MS: 100,
  MAX_EXTRAPOLATION_MS: 250,
} as const;
```

- [ ] **Step 2: Write the failing protocol tests**

`tests/protocol.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ARENA, NET } from '../src/shared/constants';
import { NEUTRAL_INPUT } from '../src/shared/input';
import { quatFromYaw } from '../src/shared/math';
import {
  MSG_INPUT,
  MSG_SNAPSHOT,
  SNAPSHOT_CAR_BYTES,
  SNAPSHOT_HEADER_BYTES,
  SNAP_FLAG_ALIVE,
  SNAP_FLAG_GROUNDED,
  buildSnapshotPacket,
  decodeInput,
  decodeSnapshot,
  encodeCarBlock,
  encodeInput,
  encodeSnapshot,
  normalizeRoomCode,
  parseClientMessage,
  parseServerMessage,
  sanitizeName,
  type Snapshot,
  type SnapshotCar,
} from '../src/shared/protocol';

const car = (slot: number, over: Partial<SnapshotCar> = {}): SnapshotCar => ({
  slot,
  flags: SNAP_FLAG_ALIVE | SNAP_FLAG_GROUNDED,
  hp: 100,
  state: {
    pos: { x: 12.3456, y: 1.074, z: -33.5 },
    quat: quatFromYaw(0.7),
    linvel: { x: 10.2, y: -0.05, z: 3.3 },
    angvel: { x: 0.01, y: -1.5, z: 0.02 },
  },
  throttle: 1,
  steer: -0.5,
  ...over,
});

describe('input frames', () => {
  it('round-trips sequence number and quantised input', () => {
    const bytes = encodeInput(123456, { throttle: 0.5, steer: -1, handbrake: true });
    expect(bytes.byteLength).toBe(8);
    expect(bytes[0]).toBe(MSG_INPUT);
    const pkt = decodeInput(bytes)!;
    expect(pkt.seq).toBe(123456);
    expect(pkt.input.throttle).toBeCloseTo(0.5, 2);
    expect(pkt.input.steer).toBe(-1);
    expect(pkt.input.handbrake).toBe(true);
  });

  it('carries the largest u32 sequence number', () => {
    expect(decodeInput(encodeInput(0xffffffff, NEUTRAL_INPUT))!.seq).toBe(0xffffffff);
  });

  it('rejects wrong length, wrong type byte and the unused int8 value -128', () => {
    const good = encodeInput(1, NEUTRAL_INPUT);
    expect(decodeInput(good.slice(0, 7))).toBeNull();
    expect(decodeInput(new Uint8Array(9))).toBeNull();
    const wrongType = good.slice();
    wrongType[0] = 9;
    expect(decodeInput(wrongType)).toBeNull();
    const bad = good.slice();
    new DataView(bad.buffer).setInt8(5, -128);
    expect(decodeInput(bad)).toBeNull();
  });

  it('decodes correctly from a view with a non-zero byteOffset', () => {
    const inner = encodeInput(77, { throttle: 1, steer: 0, handbrake: false });
    const padded = new Uint8Array(20);
    padded.set(inner, 5);
    expect(decodeInput(padded.subarray(5, 13))!.seq).toBe(77);
  });
});

describe('snapshot frames', () => {
  it('has the documented sizes', () => {
    expect(SNAPSHOT_HEADER_BYTES).toBe(11);
    expect(SNAPSHOT_CAR_BYTES).toBe(37);
    const s: Snapshot = { epoch: 0, tick: 0, ackSeq: 0, cars: Array.from({ length: 8 }, (_, i) => car(i)) };
    expect(encodeSnapshot(s).byteLength).toBe(11 + 8 * 37);
  });

  it('round-trips within quantisation error', () => {
    const s: Snapshot = { epoch: 7, tick: 123456, ackSeq: 0xfffffff0, cars: [car(0), car(3, { hp: 42, flags: SNAP_FLAG_ALIVE })] };
    const bytes = encodeSnapshot(s);
    expect(bytes[0]).toBe(MSG_SNAPSHOT);
    const back = decodeSnapshot(bytes)!;
    expect(back.epoch).toBe(7);
    expect(back.tick).toBe(123456);
    expect(back.ackSeq).toBe(0xfffffff0);
    expect(back.cars).toHaveLength(2);
    const a = s.cars[0]!;
    const b = back.cars[0]!;
    expect(b.slot).toBe(0);
    expect(b.flags).toBe(a.flags);
    expect(b.hp).toBe(100);
    expect(back.cars[1]!.slot).toBe(3);
    expect(back.cars[1]!.hp).toBe(42);
    expect(b.state.pos.x).toBeCloseTo(a.state.pos.x, 4);
    expect(b.state.pos.y).toBeCloseTo(a.state.pos.y, 4);
    expect(b.state.pos.z).toBeCloseTo(a.state.pos.z, 4);
    const dot =
      a.state.quat.x * b.state.quat.x + a.state.quat.y * b.state.quat.y + a.state.quat.z * b.state.quat.z + a.state.quat.w * b.state.quat.w;
    expect(dot).toBeGreaterThan(1 - 1e-6);
    expect(b.state.linvel.x).toBeCloseTo(a.state.linvel.x, 2);
    expect(b.state.linvel.z).toBeCloseTo(a.state.linvel.z, 2);
    expect(b.state.angvel.y).toBeCloseTo(a.state.angvel.y, 2);
    expect(b.throttle).toBeCloseTo(1, 6);
    expect(b.steer).toBeCloseTo(-0.5, 2);
  });

  it('lets several recipients share one car block', () => {
    const block = encodeCarBlock([car(0)]);
    const a = buildSnapshotPacket(1, 10, 5, 1, block);
    const b = buildSnapshotPacket(1, 10, 9, 1, block);
    expect(decodeSnapshot(a)!.ackSeq).toBe(5);
    expect(decodeSnapshot(b)!.ackSeq).toBe(9);
    expect(a.slice(SNAPSHOT_HEADER_BYTES)).toEqual(b.slice(SNAPSHOT_HEADER_BYTES));
  });

  it('rejects malformed snapshots', () => {
    const good = encodeSnapshot({ epoch: 1, tick: 2, ackSeq: 3, cars: [car(0), car(1)] });
    expect(decodeSnapshot(good.slice(0, 5))).toBeNull(); // shorter than the header
    expect(decodeSnapshot(good.slice(0, good.length - 1))).toBeNull(); // count mismatch
    const wrongType = good.slice();
    wrongType[0] = 9;
    expect(decodeSnapshot(wrongType)).toBeNull();
    const tooMany = buildSnapshotPacket(0, 0, 0, ARENA.MAX_CARS + 1, new Uint8Array((ARENA.MAX_CARS + 1) * SNAPSHOT_CAR_BYTES));
    expect(decodeSnapshot(tooMany)).toBeNull();
    const badSlot = encodeSnapshot({ epoch: 0, tick: 0, ackSeq: 0, cars: [car(ARENA.MAX_CARS)] });
    expect(decodeSnapshot(badSlot)).toBeNull();
  });

  it('decodes an empty snapshot', () => {
    const s = decodeSnapshot(encodeSnapshot({ epoch: 4, tick: 9, ackSeq: 0, cars: [] }))!;
    expect(s.cars).toEqual([]);
    expect(s.epoch).toBe(4);
  });
});

describe('parseClientMessage', () => {
  const hello = { t: 'hello', v: NET.PROTOCOL_VERSION, name: 'Max', color: 0xd84a2b, mode: 'quick' };

  it('accepts valid hello and ping messages', () => {
    expect(parseClientMessage(JSON.stringify(hello))).toEqual({ ...hello, code: undefined });
    expect(parseClientMessage(JSON.stringify({ ...hello, mode: 'join', code: 'ABCD' }))).toMatchObject({ mode: 'join', code: 'ABCD' });
    expect(parseClientMessage(JSON.stringify({ t: 'ping', id: 3, c: 1234.5 }))).toEqual({ t: 'ping', id: 3, c: 1234.5 });
  });

  it('rejects garbage and wrongly typed fields', () => {
    for (const raw of [
      '',
      'not json',
      '[]',
      'null',
      '42',
      '{}',
      JSON.stringify({ ...hello, mode: 'spectate' }),
      JSON.stringify({ ...hello, name: 5 }),
      JSON.stringify({ ...hello, color: 'red' }),
      JSON.stringify({ ...hello, color: -1 }),
      JSON.stringify({ ...hello, color: 0x1000000 }),
      JSON.stringify({ ...hello, v: 1.5 }),
      JSON.stringify({ ...hello, mode: 'join' }), // join needs a code
      JSON.stringify({ t: 'ping', id: 'x', c: 1 }),
      JSON.stringify({ t: 'ping', id: NaN, c: 1 }),
      JSON.stringify({ t: 'nope' }),
    ]) {
      expect(parseClientMessage(raw)).toBeNull();
    }
  });

  it('rejects oversize payloads', () => {
    expect(parseClientMessage(JSON.stringify({ ...hello, name: 'x'.repeat(NET.MAX_PAYLOAD_BYTES) }))).toBeNull();
  });
});

describe('parseServerMessage', () => {
  it('accepts well-formed server messages', () => {
    const welcome = {
      t: 'welcome', v: 1, you: 2, epoch: 3, tickRate: 60, snapshotEvery: 2,
      room: { code: 'ABCD', public: true, capacity: 8 },
      players: [{ slot: 2, name: 'Max', color: 255 }],
    };
    expect(parseServerMessage(JSON.stringify(welcome))).toEqual(welcome);
    expect(parseServerMessage(JSON.stringify({ t: 'roster', epoch: 1, players: [] }))).toEqual({ t: 'roster', epoch: 1, players: [] });
    expect(parseServerMessage(JSON.stringify({ t: 'pong', id: 1, c: 2, tick: 3 }))).toEqual({ t: 'pong', id: 1, c: 2, tick: 3 });
    expect(parseServerMessage(JSON.stringify({ t: 'error', code: 'room_full', message: 'full' }))).toEqual({ t: 'error', code: 'room_full', message: 'full' });
  });

  it('rejects malformed server messages', () => {
    for (const raw of [
      'nope',
      '{}',
      JSON.stringify({ t: 'welcome' }),
      JSON.stringify({ t: 'welcome', v: 1, you: 'x', epoch: 0, tickRate: 60, snapshotEvery: 2, room: {}, players: [] }),
      JSON.stringify({ t: 'roster', epoch: 1, players: [{ slot: 'a' }] }),
      JSON.stringify({ t: 'pong', id: 1 }),
      JSON.stringify({ t: 'error', code: 5, message: 'x' }),
    ]) {
      expect(parseServerMessage(raw)).toBeNull();
    }
  });
});

describe('sanitizeName', () => {
  it('trims and collapses whitespace', () => {
    expect(sanitizeName('  Max   Power ', 'x')).toBe('Max Power');
  });

  it('strips control and bidi-override characters', () => {
    expect(sanitizeName('A\u0000B‮C​D\u0007', 'x')).toBe('ABCD');
  });

  it('caps the length by code points and keeps emoji', () => {
    expect(Array.from(sanitizeName('x'.repeat(40), 'y'))).toHaveLength(NET.NAME_MAX);
    expect(sanitizeName('🚗Racer', 'x')).toBe('🚗Racer');
    expect(Array.from(sanitizeName('🚗'.repeat(30), 'x'))).toHaveLength(NET.NAME_MAX);
  });

  it('falls back when nothing usable remains', () => {
    expect(sanitizeName('', 'Driver 4')).toBe('Driver 4');
    expect(sanitizeName('   \u0000‮ ', 'Driver 4')).toBe('Driver 4');
  });
});

describe('normalizeRoomCode', () => {
  it('upper-cases and trims valid codes', () => {
    expect(normalizeRoomCode(' abcd ')).toBe('ABCD');
  });

  it('rejects wrong length, letters outside the alphabet and non-letters', () => {
    for (const bad of ['ABC', 'ABCDE', 'ROOM', 'AB1D', 'ÄBCD', '', '    ']) expect(normalizeRoomCode(bad)).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/protocol.test.ts`
Expected: FAIL — cannot resolve `../src/shared/protocol`.

- [ ] **Step 4: Implement `src/shared/protocol.ts`**

```ts
import { ARENA, NET } from './constants';
import { FLAG_HANDBRAKE, packInput, unpackInput, type CarInput } from './input';
import { clamp } from './math';
import type { CarState } from './types';

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
export type ClientMessage = HelloMessage | PingMessage;

export interface PlayerInfo {
  slot: number;
  name: string;
  color: number;
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
  | 'inactive';

export interface WelcomeMessage {
  t: 'welcome';
  v: number;
  you: number;
  room: RoomInfo;
  epoch: number;
  players: PlayerInfo[];
  tickRate: number;
  snapshotEvery: number;
}
export interface RosterMessage {
  t: 'roster';
  epoch: number;
  players: PlayerInfo[];
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
export type ServerMessage = WelcomeMessage | RosterMessage | PongMessage | ErrorMessage;

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

const isPlayerInfo = (v: unknown): v is PlayerInfo =>
  isObj(v) && isInt(v.slot) && typeof v.name === 'string' && isInt(v.color);

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
      if (
        isInt(v.v) && isInt(v.you) && isInt(v.epoch) && isInt(v.tickRate) && isInt(v.snapshotEvery) &&
        isObj(room) && typeof room.code === 'string' && typeof room.public === 'boolean' && isInt(room.capacity) &&
        Array.isArray(players) && players.every(isPlayerInfo)
      ) {
        return v as unknown as WelcomeMessage;
      }
      return null;
    }
    case 'roster': {
      const players = v.players;
      return isInt(v.epoch) && Array.isArray(players) && players.every(isPlayerInfo) ? (v as unknown as RosterMessage) : null;
    }
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

export function encodeInput(seq: number, input: CarInput): Uint8Array {
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
```

- [ ] **Step 5: Run the tests and type-check**

Run: `npx vitest run tests/protocol.test.ts && npm run typecheck`
Expected: PASS (all protocol tests), type-check clean.

- [ ] **Step 6: Commit (only if the user opted in to commits)**

```bash
git add -A
git commit -m "feat(shared): wire protocol with binary input/snapshot codecs and strict parsers"
```

---

### Task 8: Rate limiting, `Player` and the static-file handler

**Files:**
- Create: `src/server/limits.ts`, `src/server/player.ts`, `src/server/static.ts`
- Create (test helper): `tests/helpers/fakeSocket.ts`
- Test: `tests/server/limits.test.ts`, `tests/server/player.test.ts`, `tests/server/static.test.ts`

**Interfaces:**
- Consumes: `NET` (constants); `NEUTRAL_INPUT`, `isNewerSeq`, `CarInput` (input); `ErrorCode`, `ServerMessage` (protocol); `Room` type from `room.ts` (type-only import; the file arrives in Task 9, so type-check this task after Task 9 — tests run fine without it).
- Produces:
  - `limits.ts`: `class TokenBucket` — `constructor(capacity: number, refillPerSec: number, now?: () => number)`, `take(cost = 1): boolean`.
  - `player.ts`: `interface SocketLike {readyState, bufferedAmount, send(data, options?), close(code?, reason?)}` (a real `ws` WebSocket satisfies it), `class Player` — `id`, `name`, `color`, `slot` (-1 = unseated), `room`, `joined`, `ackSeq`, `lastInput`, `ticksSinceInput`, `skippedSnapshots`, `send(msg: ServerMessage)`, `sendError(code, message)`, `sendSnapshot(packet: Uint8Array): boolean`, `close(code?, reason?)`, `pushInput(seq, input): boolean`, `nextInput(): CarInput`, `resetInputState()`.
  - `static.ts`: `createStaticHandler(rootDir: string): (req: http.IncomingMessage, res: http.ServerResponse) => boolean` (returns true when it answered the request).
  - `tests/helpers/fakeSocket.ts`: `class FakeSocket implements SocketLike` with `sent`, `closed`, `throwOnSend`, `json()`, `binary()`.

- [ ] **Step 1: Write the fake socket helper**

`tests/helpers/fakeSocket.ts`:

```ts
import type { SocketLike } from '../../src/server/player';

/** In-memory stand-in for a WebSocket. */
export class FakeSocket implements SocketLike {
  readyState = 1;
  bufferedAmount = 0;
  readonly sent: Array<string | Uint8Array> = [];
  closed: { code?: number; reason?: string } | null = null;
  throwOnSend = false;

  send(data: string | Uint8Array): void {
    if (this.throwOnSend) throw new Error('socket is closing');
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closed = { code, reason };
  }

  /** Parsed JSON of every text frame sent so far. */
  json(): Array<Record<string, unknown>> {
    return this.sent.filter((d): d is string => typeof d === 'string').map((s) => JSON.parse(s) as Record<string, unknown>);
  }

  /** Every binary frame sent so far. */
  binary(): Uint8Array[] {
    return this.sent.filter((d): d is Uint8Array => typeof d !== 'string');
  }
}
```

- [ ] **Step 2: Write the failing limiter test, then implement `limits.ts`**

`tests/server/limits.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TokenBucket } from '../../src/server/limits';

describe('TokenBucket', () => {
  it('allows bursts up to capacity, then refills over time (capped at capacity)', () => {
    let now = 0;
    const b = new TokenBucket(3, 2, () => now); // capacity 3, 2 tokens per second
    expect([b.take(), b.take(), b.take(), b.take()]).toEqual([true, true, true, false]);
    now += 500; // +1 token
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
    now += 60_000; // refill is capped
    expect([b.take(), b.take(), b.take(), b.take()]).toEqual([true, true, true, false]);
  });

  it('supports costs above 1 and refuses when the cost is too high', () => {
    const b = new TokenBucket(5, 0, () => 0);
    expect(b.take(4)).toBe(true);
    expect(b.take(2)).toBe(false);
    expect(b.take(1)).toBe(true);
  });
});
```

Run `npx vitest run tests/server/limits.test.ts` — Expected: FAIL (module not found). Then `src/server/limits.ts`:

```ts
/** Token-bucket rate limiter: `capacity` burst, refilled at `refillPerSec`. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  take(cost = 1): boolean {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.refillPerSec);
    this.last = t;
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return true;
    }
    return false;
  }
}
```

Run again — Expected: PASS.

- [ ] **Step 3: Write the failing `Player` tests**

`tests/server/player.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { NET } from '../../src/shared/constants';
import { Player } from '../../src/server/player';
import { FakeSocket } from '../helpers/fakeSocket';

const drive = { throttle: 1, steer: 0, handbrake: false };
const at = (throttle: number) => ({ throttle, steer: 0, handbrake: false });
const make = () => {
  const socket = new FakeSocket();
  return { socket, player: new Player(1, socket) };
};

describe('Player input queue', () => {
  it('consumes one input per tick in order and tracks the acknowledged sequence', () => {
    const { player } = make();
    player.pushInput(1, at(0.2));
    player.pushInput(2, at(0.4));
    player.pushInput(3, at(0.6));
    expect(player.nextInput().throttle).toBe(0.2);
    expect(player.ackSeq).toBe(1);
    expect(player.nextInput().throttle).toBe(0.4);
    expect(player.ackSeq).toBe(2);
    expect(player.nextInput().throttle).toBe(0.6);
    expect(player.ackSeq).toBe(3);
  });

  it('repeats the last input while starved, then goes neutral after 0.5 s', () => {
    const { player } = make();
    player.pushInput(1, drive);
    expect(player.nextInput().throttle).toBe(1);
    for (let i = 0; i < NET.INPUT_STARVE_NEUTRAL_TICKS; i++) expect(player.nextInput().throttle).toBe(1);
    expect(player.nextInput().throttle).toBe(0);
    expect(player.ackSeq).toBe(1); // starvation never advances the ack
  });

  it('ignores stale, duplicate and reordered sequence numbers', () => {
    const { player } = make();
    expect(player.pushInput(5, drive)).toBe(true);
    expect(player.pushInput(5, drive)).toBe(false);
    expect(player.pushInput(4, drive)).toBe(false);
    expect(player.pushInput(6, drive)).toBe(true);
  });

  it('handles u32 sequence wraparound', () => {
    const { player } = make();
    expect(player.pushInput(0xfffffffe, drive)).toBe(true);
    expect(player.pushInput(0xffffffff, drive)).toBe(true);
    expect(player.pushInput(0, drive)).toBe(true);
    expect(player.pushInput(0xffffffff, drive)).toBe(false);
  });

  it('caps the queue depth by dropping the oldest inputs', () => {
    const { player } = make();
    for (let seq = 1; seq <= 10; seq++) player.pushInput(seq, drive);
    player.nextInput();
    expect(player.ackSeq).toBe(10 - NET.INPUT_QUEUE_MAX + 1);
  });

  it('resetInputState clears the queue and accepts any sequence again', () => {
    const { player } = make();
    player.pushInput(50, drive);
    player.nextInput();
    player.resetInputState();
    expect(player.lastInput).toEqual({ throttle: 0, steer: 0, handbrake: false });
    expect(player.pushInput(1, drive)).toBe(true);
  });

  it('counts silent ticks and resets the counter when an input arrives', () => {
    const { player } = make();
    player.nextInput();
    player.nextInput();
    expect(player.ticksSinceInput).toBe(2);
    player.pushInput(1, drive);
    expect(player.ticksSinceInput).toBe(0);
  });
});

describe('Player I/O', () => {
  it('sends JSON messages and errors', () => {
    const { player, socket } = make();
    player.send({ t: 'pong', id: 1, c: 2, tick: 3 });
    player.sendError('room_full', 'full');
    expect(socket.json()).toEqual([
      { t: 'pong', id: 1, c: 2, tick: 3 },
      { t: 'error', code: 'room_full', message: 'full' },
    ]);
  });

  it('does nothing when the socket is closed and swallows send errors', () => {
    const { player, socket } = make();
    socket.throwOnSend = true;
    expect(() => player.send({ t: 'pong', id: 1, c: 2, tick: 3 })).not.toThrow();
    expect(player.sendSnapshot(new Uint8Array(4))).toBe(false);
    socket.throwOnSend = false;
    socket.readyState = 3;
    player.send({ t: 'pong', id: 1, c: 2, tick: 3 });
    expect(player.sendSnapshot(new Uint8Array(4))).toBe(false);
    expect(socket.sent).toHaveLength(0);
  });

  it('skips (and counts) snapshots while the send buffer is backed up', () => {
    const { player, socket } = make();
    expect(player.sendSnapshot(new Uint8Array(4))).toBe(true);
    socket.bufferedAmount = NET.MAX_BUFFERED_BYTES + 1;
    expect(player.sendSnapshot(new Uint8Array(4))).toBe(false);
    expect(player.skippedSnapshots).toBe(1);
    expect(socket.binary()).toHaveLength(1);
    socket.bufferedAmount = 0;
    expect(player.sendSnapshot(new Uint8Array(4))).toBe(true);
  });

  it('forwards close codes and tolerates a socket that throws on close', () => {
    const { player, socket } = make();
    player.close(4001, 'inactive');
    expect(socket.closed).toEqual({ code: 4001, reason: 'inactive' });
    const broken = new Player(2, {
      readyState: 1,
      bufferedAmount: 0,
      send: () => undefined,
      close: () => {
        throw new Error('boom');
      },
    });
    expect(() => broken.close()).not.toThrow();
  });
});
```

- [ ] **Step 4: Run to verify failure, then implement `player.ts`**

Run: `npx vitest run tests/server/player.test.ts` — Expected: FAIL (module not found).

`src/server/player.ts`:

```ts
import { NET } from '../shared/constants';
import { NEUTRAL_INPUT, isNewerSeq, type CarInput } from '../shared/input';
import type { ErrorCode, ServerMessage } from '../shared/protocol';
import type { Room } from './room';

/** The subset of `ws`' WebSocket that Player needs (test fakes implement it too). */
export interface SocketLike {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string | Uint8Array, options?: { binary?: boolean }): void;
  close(code?: number, reason?: string): void;
}

const WS_OPEN = 1;

interface QueuedInput {
  seq: number;
  input: CarInput;
}

export class Player {
  name = '';
  color = 0xd84a2b;
  /** Seat number inside the room; -1 when not seated. */
  slot = -1;
  room: Room | null = null;
  /** True once a hello was accepted and a seat assigned. */
  joined = false;
  /** Highest input sequence number consumed by the simulation. */
  ackSeq = 0;
  lastInput: CarInput = { ...NEUTRAL_INPUT };
  /** Ticks since the last input frame arrived; the room disconnects players who stay silent too long. */
  ticksSinceInput = 0;
  skippedSnapshots = 0;
  private queue: QueuedInput[] = [];
  private newestSeq: number | null = null;
  private starved = 0;

  constructor(
    readonly id: number,
    private readonly socket: SocketLike,
  ) {}

  send(msg: ServerMessage): void {
    if (this.socket.readyState !== WS_OPEN) return;
    try {
      this.socket.send(JSON.stringify(msg));
    } catch {
      /* socket is closing */
    }
  }

  sendError(code: ErrorCode, message: string): void {
    this.send({ t: 'error', code, message });
  }

  /** Sends a snapshot unless the socket's send buffer is backed up. Returns whether it was sent. */
  sendSnapshot(packet: Uint8Array): boolean {
    if (this.socket.readyState !== WS_OPEN) return false;
    if (this.socket.bufferedAmount > NET.MAX_BUFFERED_BYTES) {
      this.skippedSnapshots++;
      return false;
    }
    try {
      this.socket.send(packet, { binary: true });
      return true;
    } catch {
      return false;
    }
  }

  close(code = 1000, reason = ''): void {
    try {
      this.socket.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  /** Queues an input unless its sequence number is not newer than the newest one seen (u32 wrap-aware). */
  pushInput(seq: number, input: CarInput): boolean {
    if (this.newestSeq !== null && !isNewerSeq(seq, this.newestSeq)) return false;
    this.newestSeq = seq;
    this.queue.push({ seq, input });
    while (this.queue.length > NET.INPUT_QUEUE_MAX) this.queue.shift();
    this.ticksSinceInput = 0;
    return true;
  }

  /** Called once per simulation tick: consumes one queued input, repeating the last one on starvation. */
  nextInput(): CarInput {
    this.ticksSinceInput++;
    const next = this.queue.shift();
    if (next) {
      this.lastInput = next.input;
      this.ackSeq = next.seq;
      this.starved = 0;
    } else if (++this.starved > NET.INPUT_STARVE_NEUTRAL_TICKS) {
      this.lastInput = { ...NEUTRAL_INPUT };
    }
    return this.lastInput;
  }

  resetInputState(): void {
    this.queue = [];
    this.newestSeq = null;
    this.starved = 0;
    this.ticksSinceInput = 0;
    this.lastInput = { ...NEUTRAL_INPUT };
  }
}
```

Run again — Expected: PASS. (The `import type { Room }` is erased at runtime; the type resolves once Task 9 exists.)

- [ ] **Step 5: Write the failing static-handler tests, then implement `static.ts`**

`tests/server/static.test.ts`:

```ts
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStaticHandler } from '../../src/server/static';

let tmp: string;
let server: http.Server;
let base: string;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wreckyard-static-'));
  const root = path.join(tmp, 'root');
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>hello</h1>');
  fs.writeFileSync(path.join(root, 'assets', 'app-abc.js'), 'console.log(1)');
  fs.writeFileSync(path.join(tmp, 'secret.txt'), 'top secret');
  const handler = createStaticHandler(root);
  server = http.createServer((req, res) => {
    if (!handler(req, res)) {
      res.writeHead(404);
      res.end('fallthrough');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('static handler', () => {
  it('serves index.html at / without long-lived caching', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.text()).toBe('<h1>hello</h1>');
  });

  it('serves hashed assets with immutable caching and the right mime type', async () => {
    const res = await fetch(`${base}/assets/app-abc.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(await res.text()).toBe('console.log(1)');
  });

  it('falls through for missing files', async () => {
    const res = await fetch(`${base}/nope.txt`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('fallthrough');
  });

  it('never serves files outside the root', async () => {
    for (const p of ['/..%2fsecret.txt', '/%2e%2e/secret.txt', '/../secret.txt', '/assets/..%2f..%2fsecret.txt']) {
      const res = await fetch(base + p);
      expect(res.status).not.toBe(200);
      expect(await res.text()).not.toContain('top secret');
    }
  });

  it('rejects malformed percent-encoding', async () => {
    const res = await fetch(`${base}/%E0%A4%A`);
    expect(res.status).toBe(400);
  });

  it('answers HEAD without a body and ignores other methods', async () => {
    const head = await fetch(`${base}/`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    const post = await fetch(`${base}/`, { method: 'POST', body: 'x' });
    expect(post.status).toBe(404);
    expect(await post.text()).toBe('fallthrough');
  });
});
```

Run: `npx vitest run tests/server/static.test.ts` — Expected: FAIL (module not found). Then `src/server/static.ts`:

```ts
import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
};

/**
 * Serves files from `rootDir`. Returns true when it answered the request, false to let the caller fall through
 * (missing file, or a method other than GET/HEAD).
 */
export function createStaticHandler(rootDir: string): (req: http.IncomingMessage, res: http.ServerResponse) => boolean {
  const root = path.resolve(rootDir);
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('bad request');
      return true;
    }
    if (pathname.includes('\0')) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('bad request');
      return true;
    }
    const rel = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
    const file = path.resolve(root, `.${rel}`);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('forbidden');
      return true;
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      return false;
    }
    if (!stat.isFile()) return false;
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': String(stat.size),
      'x-content-type-options': 'nosniff',
      'cache-control': rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
    return true;
  };
}
```

Run: `npx vitest run tests/server` — Expected: limits, player and static tests pass.

- [ ] **Step 6: Commit (only if the user opted in to commits)**

```bash
git add -A
git commit -m "feat(server): token bucket, Player input queue and safe static-file handler"
```

---

### Task 9: `Room` and `Lobby`

**Files:**
- Create: `src/server/room.ts`, `src/server/lobby.ts`
- Test: `tests/server/room.test.ts`, `tests/server/lobby.test.ts`

**Interfaces:**
- Consumes: `ARENA`, `NET` (constants); `NEUTRAL_INPUT` (input); `Simulation` (sim); `SNAP_FLAG_*`, `buildSnapshotPacket`, `encodeCarBlock`, `PlayerInfo`, `RoomInfo`, `SnapshotCar`, `ErrorCode` (protocol); `Player` (player).
- Produces:
  - `room.ts`: `class Room` — `constructor(code: string, isPublic: boolean, onEmpty: (room: Room) => void)`, `code`, `isPublic`, `seats: Array<Player | null>`, `epoch: number`, `simTick: number` (getter; 0 before the first build), `playerCount`, `isFull`, `seated(): Player[]`, `info(): RoomInfo`, `playerInfos(): PlayerInfo[]`, `addPlayer(player): number` (slot, or -1), `removePlayer(player): void`, `step(): void` (one 60 Hz tick), `dispose(): void`.
  - `lobby.ts`: `type JoinResult = {ok: true; room: Room; slot: number} | {ok: false; code: ErrorCode}`, `interface LobbyOptions {maxRooms: number; random?: () => number}`, `class Lobby` — `roomCount`, `playerCount`, `getRoom(code)`, `quickPlay(player)`, `createPrivate(player)`, `join(player, code)`, `leave(player)`, `tickAll()`, `dispose()`.

- [ ] **Step 1: Write the failing room tests**

`tests/server/room.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure, then implement `src/server/room.ts`**

Run: `npx vitest run tests/server/room.test.ts` — Expected: FAIL (`../../src/server/room` not found).

`src/server/room.ts`:

```ts
import { ARENA, NET } from '../shared/constants';
import { NEUTRAL_INPUT } from '../shared/input';
import {
  SNAP_FLAG_ALIVE,
  SNAP_FLAG_GROUNDED,
  SNAP_FLAG_HANDBRAKE,
  buildSnapshotPacket,
  encodeCarBlock,
  type PlayerInfo,
  type RoomInfo,
  type SnapshotCar,
} from '../shared/protocol';
import { Simulation } from '../shared/sim';
import type { Player } from './player';

/**
 * One arena instance. Baseline policy for this plan: any roster change rebuilds the world a moment later
 * (fresh cars at fresh spawns) and bumps `epoch`. Later plans replace this with rounds.
 */
export class Room {
  readonly seats: Array<Player | null> = Array.from({ length: ARENA.MAX_CARS }, () => null);
  /** Increments on every world rebuild; clients drop snapshots from other epochs. */
  epoch = 0;
  private sim: Simulation | null = null;
  private ticks = 0;
  private rebuildAt: number | null = null;
  private disposed = false;

  constructor(
    readonly code: string,
    readonly isPublic: boolean,
    private readonly onEmpty: (room: Room) => void,
  ) {}

  /** Simulation tick of the current world (0 before the first build). */
  get simTick(): number {
    return this.sim?.tick ?? 0;
  }

  get playerCount(): number {
    let n = 0;
    for (const p of this.seats) if (p) n++;
    return n;
  }

  get isFull(): boolean {
    return this.playerCount >= ARENA.MAX_CARS;
  }

  seated(): Player[] {
    return this.seats.filter((p): p is Player => p !== null);
  }

  info(): RoomInfo {
    return { code: this.code, public: this.isPublic, capacity: ARENA.MAX_CARS };
  }

  playerInfos(): PlayerInfo[] {
    return this.seated().map((p) => ({ slot: p.slot, name: p.name, color: p.color }));
  }

  /** Seats the player in the lowest free slot. Returns the slot, or -1 when full or disposed. */
  addPlayer(player: Player): number {
    const slot = this.seats.indexOf(null);
    if (slot < 0 || this.disposed) return -1;
    this.seats[slot] = player;
    player.slot = slot;
    player.room = this;
    player.resetInputState();
    this.scheduleRebuild();
    return slot;
  }

  removePlayer(player: Player): void {
    const slot = player.slot;
    if (slot < 0 || this.seats[slot] !== player) return;
    this.seats[slot] = null;
    player.slot = -1;
    player.room = null;
    if (this.playerCount === 0) {
      this.onEmpty(this);
      return;
    }
    this.scheduleRebuild();
  }

  private scheduleRebuild(): void {
    this.rebuildAt = this.ticks + NET.REBUILD_DELAY_TICKS;
  }

  private rebuild(): void {
    this.rebuildAt = null;
    this.sim?.dispose();
    this.sim = null;
    const players = this.seated();
    this.epoch = (this.epoch + 1) & 0xff;
    if (players.length > 0) this.sim = new Simulation(players.map((p) => p.slot));
    for (const p of players) p.resetInputState();
    const roster = { t: 'roster', epoch: this.epoch, players: this.playerInfos() } as const;
    for (const p of players) p.send(roster);
  }

  /** One 60 Hz tick. */
  step(): void {
    if (this.disposed) return;
    this.ticks++;
    if (this.rebuildAt !== null && this.ticks >= this.rebuildAt) this.rebuild();
    for (const p of this.seated()) {
      if (p.ticksSinceInput > NET.INACTIVE_KICK_TICKS) p.close(4001, 'inactive');
    }
    const sim = this.sim;
    if (!sim) return;
    const inSim = new Set(sim.slots);
    for (const slot of sim.slots) {
      const p = this.seats[slot];
      sim.setInput(slot, p ? p.nextInput() : NEUTRAL_INPUT);
    }
    // players seated after the last rebuild have no car yet; keep draining their queue so it cannot grow
    for (const p of this.seated()) if (!inSim.has(p.slot)) p.nextInput();
    sim.step();
    if (sim.tick % NET.SNAPSHOT_EVERY === 0) this.broadcastSnapshot(sim);
  }

  private broadcastSnapshot(sim: Simulation): void {
    const cars: SnapshotCar[] = [];
    const recipients: Player[] = [];
    for (const slot of sim.slots) {
      const p = this.seats[slot];
      if (!p) continue;
      recipients.push(p);
      const input = sim.getInput(slot);
      let flags = SNAP_FLAG_ALIVE;
      if (input.handbrake) flags |= SNAP_FLAG_HANDBRAKE;
      if (sim.getWheels(slot).some((w) => w.contact)) flags |= SNAP_FLAG_GROUNDED;
      cars.push({ slot, flags, hp: 100, state: sim.getState(slot), throttle: input.throttle, steer: input.steer });
    }
    if (cars.length === 0) return;
    const block = encodeCarBlock(cars);
    for (const p of recipients) p.sendSnapshot(buildSnapshotPacket(this.epoch, sim.tick, p.ackSeq, cars.length, block));
  }

  /** Frees the simulation. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sim?.dispose();
    this.sim = null;
  }
}
```

Run: `npx vitest run tests/server/room.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing lobby tests**

`tests/server/lobby.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ARENA, NET } from '../../src/shared/constants';
import { initPhysics } from '../../src/shared/physics';
import { Lobby, type JoinResult } from '../../src/server/lobby';
import { Player } from '../../src/server/player';
import { FakeSocket } from '../helpers/fakeSocket';

beforeAll(async () => {
  await initPhysics();
});

const lobbies: Lobby[] = [];
const makeLobby = (maxRooms = 5, random?: () => number): Lobby => {
  const l = new Lobby({ maxRooms, random });
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
    expect(joined.slot).toBe(1);
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

  it('steps every room on tickAll', () => {
    const lobby = makeLobby();
    const sockets = [new FakeSocket(), new FakeSocket()];
    const players = sockets.map((s) => new Player(nextId++, s));
    ok(lobby.createPrivate(players[0]!));
    ok(lobby.createPrivate(players[1]!));
    for (let i = 0; i < NET.REBUILD_DELAY_TICKS; i++) lobby.tickAll();
    for (const s of sockets) expect(s.json().some((m) => m.t === 'roster')).toBe(true);
  });
});
```

- [ ] **Step 4: Run to verify failure, then implement `src/server/lobby.ts`**

Run: `npx vitest run tests/server/lobby.test.ts` — Expected: FAIL (module not found).

`src/server/lobby.ts`:

```ts
import { NET } from '../shared/constants';
import type { ErrorCode } from '../shared/protocol';
import type { Player } from './player';
import { Room } from './room';

export type JoinResult = { ok: true; room: Room; slot: number } | { ok: false; code: ErrorCode };

export interface LobbyOptions {
  maxRooms: number;
  /** Injectable for tests; defaults to Math.random (server-only, never used by the simulation). */
  random?: () => number;
}

export class Lobby {
  private readonly rooms = new Map<string, Room>();
  private readonly random: () => number;

  constructor(private readonly options: LobbyOptions) {
    this.random = options.random ?? Math.random;
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

  /** Joins the fullest public room that still has space, or opens a new public room. */
  quickPlay(player: Player): JoinResult {
    let best: Room | null = null;
    for (const r of this.rooms.values()) {
      if (r.isPublic && !r.isFull && (!best || r.playerCount > best.playerCount)) best = r;
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

  tickAll(): void {
    for (const room of [...this.rooms.values()]) room.step();
  }

  dispose(): void {
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
  }

  private seat(room: Room, player: Player): JoinResult {
    const slot = room.addPlayer(player);
    return slot < 0 ? { ok: false, code: 'room_full' } : { ok: true, room, slot };
  }

  private createRoom(isPublic: boolean): Room {
    const code = this.newCode();
    const room = new Room(code, isPublic, (r) => {
      this.rooms.delete(r.code);
      r.dispose();
    });
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
```

Run: `npx vitest run tests/server && npm run typecheck`
Expected: PASS for limits, player, static, room and lobby tests; type-check clean (the `Room` type import in `player.ts` now resolves).

- [ ] **Step 5: Commit (only if the user opted in to commits)**

```bash
git add -A
git commit -m "feat(server): Room (seats, rebuild policy, snapshots) and Lobby (quick play, private rooms)"
```

---

### Task 10: HTTP + WebSocket server, entry point and integration tests

**Files:**
- Replace: `src/server/app.ts`, `src/server/index.ts`, `tests/smoke.test.ts`, `scripts/smoke-e2e.mjs`
- Create (test helper): `tests/helpers/testClient.ts`
- Test: `tests/server/integration.test.ts`

**Interfaces:**
- Consumes: `Lobby`, `JoinResult` (lobby); `Player` (player); `TokenBucket` (limits); `createStaticHandler` (static); `decodeInput`, `normalizeRoomCode`, `parseClientMessage`, `sanitizeName`, `ErrorCode` (protocol); `NET`, `PHYSICS` (constants); `initPhysics` (physics).
- Produces:
  - `app.ts`: `GameServerOptions {staticDir?, allowedOrigins?, maxRooms?, maxConnections?}`, `ServerStats {rooms, players, connections, tickMsP99, uptimeSec}`, `GameServer {server, wss, lobby, listen(port, host?): Promise<number>, close(): Promise<void>, stats(): ServerStats}`, `createGameServer(options?): GameServer`, `originAllowed(origin, host, allowed?): boolean`.
  - `index.ts`: process entry. Env: `PORT` (8080), `ALLOWED_ORIGINS` (comma-separated exact origins), `MAX_ROOMS` (12), `MAX_CONNECTIONS` (200), `STATIC_DIR` (`dist/client`).
  - `tests/helpers/testClient.ts`: `class TestClient` — `static connect(port, headers?)`, `messages`, `snapshots`, `closed`, `seq`, `hello(overrides?)`, `sendRaw(data)`, `sendInput(input)`, `drive(input, ms)`, `waitFor(pick, timeoutMs?, label?)`, `welcome()`, `close()`.
- HTTP: `GET /healthz` → `200 application/json` `{ok: true, rooms, players, connections, tickMsP99, uptimeSec}`; `GET /ws` upgrade; everything else → static files, else `404`.

- [ ] **Step 1: Replace the smoke test (the server no longer echoes)**

`tests/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createGameServer } from '../src/server/app';
import { clamp } from '../src/shared/math';

describe('toolchain smoke', () => {
  it('shared code is importable', () => {
    expect(clamp(5, 0, 1)).toBe(1);
  });

  it('server answers /healthz with JSON', async () => {
    const app = createGameServer();
    const port = await app.listen(0, '127.0.0.1');
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toMatchObject({ ok: true, rooms: 0, players: 0 });
    await app.close();
  });
});
```

- [ ] **Step 2: Write the test client helper**

`tests/helpers/testClient.ts`:

```ts
import { WebSocket, type RawData } from 'ws';
import { NET } from '../../src/shared/constants';
import type { CarInput } from '../../src/shared/input';
import {
  decodeSnapshot,
  encodeInput,
  parseServerMessage,
  type ErrorMessage,
  type HelloMessage,
  type ServerMessage,
  type Snapshot,
  type WelcomeMessage,
} from '../../src/shared/protocol';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const bytes = (d: RawData): Uint8Array => {
  if (Array.isArray(d)) return new Uint8Array(Buffer.concat(d));
  if (d instanceof ArrayBuffer) return new Uint8Array(d);
  return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
};

/** A headless protocol client for integration tests and scripts. */
export class TestClient {
  readonly messages: ServerMessage[] = [];
  readonly snapshots: Snapshot[] = [];
  closed: { code: number; reason: string } | null = null;
  seq = 0;

  private constructor(readonly ws: WebSocket) {}

  static connect(port: number, headers: Record<string, string> = {}): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
      const client = new TestClient(ws);
      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          const s = decodeSnapshot(bytes(data));
          if (s) client.snapshots.push(s);
        } else {
          const m = parseServerMessage(Buffer.from(bytes(data)).toString('utf8'));
          if (m) client.messages.push(m);
        }
      });
      ws.on('close', (code, reason) => {
        client.closed = { code, reason: reason.toString() };
      });
      ws.on('open', () => resolve(client));
      ws.on('error', reject);
    });
  }

  hello(overrides: Partial<HelloMessage> = {}): void {
    this.ws.send(
      JSON.stringify({ t: 'hello', v: NET.PROTOCOL_VERSION, name: 'Tester', color: 0xd84a2b, mode: 'quick', ...overrides }),
    );
  }

  sendRaw(data: string | Uint8Array): void {
    this.ws.send(data);
  }

  sendInput(input: CarInput): void {
    this.seq = (this.seq + 1) >>> 0;
    this.ws.send(encodeInput(this.seq, input));
  }

  /** Sends the same input at ~60 Hz for `ms` milliseconds. */
  async drive(input: CarInput, ms: number): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      this.sendInput(input);
      await sleep(16);
    }
  }

  /** Polls until `pick()` returns something truthy. */
  async waitFor<T>(pick: () => T | undefined | false | null, timeoutMs = 5000, label = 'condition'): Promise<T> {
    const t0 = Date.now();
    for (;;) {
      const v = pick();
      if (v) return v;
      if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${label}`);
      await sleep(10);
    }
  }

  welcome(): WelcomeMessage | undefined {
    return this.messages.find((m): m is WelcomeMessage => m.t === 'welcome');
  }

  errors(): ErrorMessage[] {
    return this.messages.filter((m): m is ErrorMessage => m.t === 'error');
  }

  close(): void {
    this.ws.close();
  }
}
```

- [ ] **Step 3: Write the failing integration tests**

`tests/server/integration.test.ts`:

```ts
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initPhysics } from '../../src/shared/physics';
import { encodeInput, type RosterMessage } from '../../src/shared/protocol';
import { createGameServer, originAllowed, type GameServer } from '../../src/server/app';
import { TestClient } from '../helpers/testClient';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const forward = { throttle: 1, steer: 0, handbrake: false };

let app: GameServer;
let port: number;
const clients: TestClient[] = [];
const connect = async (headers?: Record<string, string>): Promise<TestClient> => {
  const c = await TestClient.connect(port, headers);
  clients.push(c);
  return c;
};
const rosterWith = (c: TestClient, n: number) =>
  c.messages.find((m): m is RosterMessage => m.t === 'roster' && m.players.length === n);

beforeAll(async () => {
  await initPhysics();
});
beforeEach(async () => {
  app = createGameServer({ maxRooms: 6 });
  port = await app.listen(0, '127.0.0.1');
});
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await app.close();
});

describe('multiplayer flow', () => {
  it('puts two quick-play players in one room and streams movement at about 30 Hz', async () => {
    const a = await connect();
    const b = await connect();
    a.hello({ name: 'Ann' });
    b.hello({ name: 'Bob' });
    const wa = await a.waitFor(() => a.welcome(), 3000, 'welcome for A');
    const wb = await b.waitFor(() => b.welcome(), 3000, 'welcome for B');
    expect(wa.room.code).toBe(wb.room.code);
    expect(new Set([wa.you, wb.you])).toEqual(new Set([0, 1]));

    const roster = await b.waitFor(() => rosterWith(b, 2), 4000, 'roster with both players');
    await a.waitFor(() => rosterWith(a, 2), 4000, 'roster for A');
    await b.waitFor(() => b.snapshots.find((s) => s.epoch === roster.epoch && s.cars.length === 2), 3000, 'first snapshot');

    const n0 = b.snapshots.length;
    const t0 = Date.now();
    await a.drive(forward, 1500);
    const seconds = (Date.now() - t0) / 1000;
    const rate = (b.snapshots.length - n0) / seconds;
    expect(rate).toBeGreaterThan(20);
    expect(rate).toBeLessThan(40);

    const inEpoch = b.snapshots.filter((s) => s.epoch === roster.epoch);
    const start = inEpoch[0]!.cars.find((c) => c.slot === wa.you)!.state.pos;
    const end = inEpoch[inEpoch.length - 1]!.cars.find((c) => c.slot === wa.you)!.state.pos;
    expect(Math.hypot(end.x - start.x, end.z - start.z)).toBeGreaterThan(3); // B sees A's car move
    const lastForA = a.snapshots[a.snapshots.length - 1]!;
    expect(lastForA.ackSeq).toBeGreaterThan(a.seq - 40); // the server keeps consuming A's inputs
  });

  it('creates private rooms and lets others join by case-insensitive code', async () => {
    const a = await connect();
    a.hello({ mode: 'create' });
    const wa = await a.waitFor(() => a.welcome());
    expect(wa.room.public).toBe(false);
    expect(wa.room.code).toMatch(/^[A-Z]{4}$/);

    const b = await connect();
    b.hello({ mode: 'join', code: wa.room.code.toLowerCase() });
    const wb = await b.waitFor(() => b.welcome());
    expect(wb.room.code).toBe(wa.room.code);
    expect(wb.you).toBe(1);

    const c = await connect();
    c.hello({ mode: 'join', code: 'ZZZZ' });
    expect(await c.waitFor(() => c.errors()[0])).toMatchObject({ code: 'room_not_found' });
    const d = await connect();
    d.hello({ mode: 'join', code: 'ROOM' }); // 'O' is not in the alphabet, so no such code can exist
    expect(await d.waitFor(() => d.errors()[0])).toMatchObject({ code: 'room_not_found' });

    c.hello({ mode: 'join', code: wa.room.code }); // a failed joiner can retry on the same socket
    await c.waitFor(() => c.welcome());
  });

  it('reports room_full for a 9th player in a private room', async () => {
    const host = await connect();
    host.hello({ mode: 'create' });
    const { room } = await host.waitFor(() => host.welcome());
    for (let i = 1; i < 8; i++) {
      const c = await connect();
      c.hello({ mode: 'join', code: room.code });
      await c.waitFor(() => c.welcome());
    }
    const ninth = await connect();
    ninth.hello({ mode: 'join', code: room.code });
    expect(await ninth.waitFor(() => ninth.errors()[0])).toMatchObject({ code: 'room_full' });
  });

  it('frees seats on disconnect and disposes rooms that become empty', async () => {
    const a = await connect();
    const b = await connect();
    a.hello();
    b.hello();
    await a.waitFor(() => a.welcome());
    await b.waitFor(() => b.welcome());
    await b.waitFor(() => rosterWith(b, 2), 4000, 'both seated');
    a.close();
    await b.waitFor(() => rosterWith(b, 1), 4000, 'roster after A left');
    expect(app.lobby.playerCount).toBe(1);
    b.close();
    const t0 = Date.now();
    while (app.lobby.roomCount > 0 && Date.now() - t0 < 3000) await sleep(20);
    expect(app.lobby.roomCount).toBe(0);
  });

  it('neutralises a car whose player stops sending input', async () => {
    const a = await connect();
    a.hello();
    const w = await a.waitFor(() => a.welcome());
    const roster = await a.waitFor(() => rosterWith(a, 1), 4000, 'roster');
    await a.drive(forward, 300);
    await sleep(1200);
    const last = await a.waitFor(() => a.snapshots.filter((s) => s.epoch === roster.epoch).at(-1));
    expect(last.cars.find((c) => c.slot === w.you)!.throttle).toBe(0);
  });
});

describe('hostile and broken clients', () => {
  it('survives garbage without affecting other players', async () => {
    const good = await connect();
    good.hello();
    await good.waitFor(() => good.welcome());

    const evil = await connect();
    evil.sendRaw(encodeInput(1, forward)); // binary before hello: silently ignored
    evil.sendRaw('this is not json');
    expect(await evil.waitFor(() => evil.errors()[0])).toMatchObject({ code: 'bad_message' });
    evil.sendRaw(JSON.stringify({ t: 'hello', v: 1, name: 5, color: 'red', mode: 'quick' })); // wrong types
    await evil.waitFor(() => evil.errors().length >= 2, 2000, 'second error');
    evil.hello({ v: 99 }); // wrong protocol version
    await evil.waitFor(() => evil.errors().find((e) => e.code === 'bad_version'), 2000, 'bad_version');
    await evil.waitFor(() => evil.closed, 2000, 'close after bad version');

    const big = await connect();
    big.sendRaw(new Uint8Array(4096)); // over maxPayload
    await big.waitFor(() => big.closed, 3000, 'close after oversize frame');

    const twice = await connect();
    twice.hello();
    await twice.waitFor(() => twice.welcome());
    twice.hello();
    expect(await twice.waitFor(() => twice.errors()[0])).toMatchObject({ code: 'already_joined' });

    expect(good.closed).toBeNull();
    const health = (await (await fetch(`http://127.0.0.1:${port}/healthz`)).json()) as { ok: boolean };
    expect(health.ok).toBe(true);
  });

  it('closes connections that flood text messages', async () => {
    const c = await connect();
    for (let i = 0; i < 60; i++) c.sendRaw(JSON.stringify({ t: 'ping', id: i, c: 0 }));
    await c.waitFor(() => c.closed, 3000, 'close after flood');
    expect(c.errors().some((e) => e.code === 'rate_limited')).toBe(true);
  });

  it('rejects browser origins that do not match the host', async () => {
    await expect(TestClient.connect(port, { Origin: 'http://evil.example' })).rejects.toThrow();
    const ok = await connect({ Origin: `http://127.0.0.1:${port}` });
    ok.hello();
    await ok.waitFor(() => ok.welcome());
  });

  it('refuses connections beyond the connection limit', async () => {
    const small = createGameServer({ maxConnections: 2 });
    const p = await small.listen(0, '127.0.0.1');
    const c1 = await TestClient.connect(p);
    const c2 = await TestClient.connect(p);
    await expect(TestClient.connect(p)).rejects.toThrow();
    c1.close();
    c2.close();
    await small.close();
  });
});

describe('http endpoints', () => {
  it('serves /healthz with live stats and 404 for everything else', async () => {
    const a = await connect();
    a.hello();
    await a.waitFor(() => a.welcome());
    const health = (await (await fetch(`http://127.0.0.1:${port}/healthz`)).json()) as Record<string, unknown>;
    expect(health).toMatchObject({ ok: true, rooms: 1, players: 1, connections: 1 });
    expect(typeof health.tickMsP99).toBe('number');
    const missing = await fetch(`http://127.0.0.1:${port}/nope`);
    expect(missing.status).toBe(404);
  });
});

describe('originAllowed', () => {
  it('allows a missing Origin (non-browser clients)', () => {
    expect(originAllowed(undefined, 'localhost:8080')).toBe(true);
  });
  it('is same-host only by default', () => {
    expect(originAllowed('http://localhost:5173', 'localhost:5173')).toBe(true);
    expect(originAllowed('http://evil.example', 'localhost:5173')).toBe(false);
  });
  it('honours an explicit allow-list', () => {
    const allowed = ['https://play.example.com'];
    expect(originAllowed('https://play.example.com', 'game.internal', allowed)).toBe(true);
    expect(originAllowed('https://other.example.com', 'game.internal', allowed)).toBe(false);
  });
  it('rejects unparsable origins', () => {
    expect(originAllowed('not a url', 'localhost')).toBe(false);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run tests/server/integration.test.ts`
Expected: FAIL — `originAllowed` / new `createGameServer` signature do not exist (the Task 1 echo server is still in `app.ts`).

- [ ] **Step 5: Implement `src/server/app.ts`**

```ts
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { NET, PHYSICS } from '../shared/constants';
import { decodeInput, normalizeRoomCode, parseClientMessage, sanitizeName, type ErrorCode } from '../shared/protocol';
import { TokenBucket } from './limits';
import { Lobby, type JoinResult } from './lobby';
import { Player } from './player';
import { createStaticHandler } from './static';

export interface GameServerOptions {
  /** Directory with the built client (dist/client). Omit to serve only /healthz and /ws. */
  staticDir?: string;
  /** Exact allowed Origin values (e.g. "https://play.example.com"). Empty or omitted = same-host only. */
  allowedOrigins?: readonly string[];
  maxRooms?: number;
  maxConnections?: number;
}

export interface ServerStats {
  rooms: number;
  players: number;
  connections: number;
  tickMsP99: number;
  uptimeSec: number;
}

export interface GameServer {
  readonly server: http.Server;
  readonly wss: WebSocketServer;
  readonly lobby: Lobby;
  /** Starts listening and the 60 Hz loop; resolves with the bound port. */
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
  stats(): ServerStats;
}

const ERROR_TEXT: Record<ErrorCode, string> = {
  bad_message: 'Unrecognised or invalid message.',
  bad_version: `Client and server protocol versions differ (the server speaks version ${NET.PROTOCOL_VERSION}).`,
  already_joined: 'You are already in a room.',
  room_full: 'That room is full.',
  room_not_found: 'No room with that code.',
  server_full: 'The server is full — try again in a moment.',
  rate_limited: 'Too many messages.',
  inactive: 'Disconnected for inactivity.',
};

/** Browsers always send Origin on WebSocket upgrades; scripts and tests usually do not. */
export function originAllowed(origin: string | undefined, host: string | undefined, allowed?: readonly string[]): boolean {
  if (!origin) return true;
  if (allowed && allowed.length > 0) return allowed.includes(origin);
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

const DT_MS = 1000 / PHYSICS.TICK_RATE;

export function createGameServer(options: GameServerOptions = {}): GameServer {
  const lobby = new Lobby({ maxRooms: options.maxRooms ?? 12 });
  const staticHandler = options.staticDir ? createStaticHandler(options.staticDir) : null;
  const maxConnections = options.maxConnections ?? 200;
  const startedAt = Date.now();
  const tickTimes: number[] = [];
  let connections = 0;
  let nextPlayerId = 1;
  let loop: ReturnType<typeof setInterval> | null = null;

  const stats = (): ServerStats => {
    const sorted = [...tickTimes].sort((a, b) => a - b);
    const p99 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))]! : 0;
    return {
      rooms: lobby.roomCount,
      players: lobby.playerCount,
      connections,
      tickMsP99: Math.round(p99 * 1000) / 1000,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    };
  };

  const server = http.createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0];
    if (pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, ...stats() }));
      return;
    }
    if (staticHandler?.(req, res)) return;
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: NET.MAX_PAYLOAD_BYTES, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    const refuse = (status: string): void => {
      socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if ((req.url ?? '').split('?')[0] !== '/ws') return refuse('404 Not Found');
    if (!originAllowed(req.headers.origin, req.headers.host, options.allowedOrigins)) return refuse('403 Forbidden');
    if (connections >= maxConnections) return refuse('503 Service Unavailable');
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  function onBinary(player: Player, data: RawData, bucket: TokenBucket): void {
    if (!player.joined || !player.room) return; // inputs before a seat exists are ignored
    if (!bucket.take()) return; // silently drop input floods
    const pkt = decodeInput(toBytes(data));
    if (pkt) player.pushInput(pkt.seq, pkt.input);
  }

  function onText(player: Player, ws: WebSocket, text: string, bucket: TokenBucket): void {
    if (!bucket.take()) {
      player.sendError('rate_limited', ERROR_TEXT.rate_limited);
      ws.close(1008, 'rate limited');
      return;
    }
    const msg = parseClientMessage(text);
    if (!msg) {
      player.sendError('bad_message', ERROR_TEXT.bad_message);
      return;
    }
    if (msg.t === 'ping') {
      player.send({ t: 'pong', id: msg.id, c: msg.c, tick: player.room?.simTick ?? 0 });
      return;
    }
    if (player.joined) {
      player.sendError('already_joined', ERROR_TEXT.already_joined);
      return;
    }
    if (msg.v !== NET.PROTOCOL_VERSION) {
      player.sendError('bad_version', ERROR_TEXT.bad_version);
      ws.close(1002, 'bad version');
      return;
    }
    player.name = sanitizeName(msg.name, `Driver ${player.id}`);
    player.color = msg.color;
    let result: JoinResult;
    if (msg.mode === 'quick') result = lobby.quickPlay(player);
    else if (msg.mode === 'create') result = lobby.createPrivate(player);
    else {
      const code = normalizeRoomCode(msg.code ?? '');
      result = code ? lobby.join(player, code) : { ok: false, code: 'room_not_found' };
    }
    if (!result.ok) {
      player.sendError(result.code, ERROR_TEXT[result.code]);
      return;
    }
    player.joined = true;
    player.send({
      t: 'welcome',
      v: NET.PROTOCOL_VERSION,
      you: result.slot,
      room: result.room.info(),
      epoch: result.room.epoch,
      players: result.room.playerInfos(),
      tickRate: PHYSICS.TICK_RATE,
      snapshotEvery: NET.SNAPSHOT_EVERY,
    });
  }

  wss.on('connection', (ws: WebSocket) => {
    connections++;
    const player = new Player(nextPlayerId++, ws);
    const textBucket = new TokenBucket(20, 10);
    const inputBucket = new TokenBucket(120, 90);
    let alive = true;
    ws.on('pong', () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      try {
        ws.ping();
      } catch {
        /* closing */
      }
    }, NET.HEARTBEAT_MS);
    ws.on('message', (data: RawData, isBinary: boolean) => {
      try {
        if (isBinary) onBinary(player, data, inputBucket);
        else onText(player, ws, new TextDecoder().decode(toBytes(data)), textBucket);
      } catch (err) {
        console.error('message handler failed', err);
        ws.close(1011, 'internal error');
      }
    });
    ws.on('close', () => {
      clearInterval(heartbeat);
      connections--;
      lobby.leave(player);
    });
    // 'error' must have a listener or Node crashes; ws closes the socket itself (e.g. 1009 for oversize frames)
    // and always emits 'close' afterwards, where cleanup happens.
    ws.on('error', () => undefined);
  });

  function startLoop(): void {
    let last = performance.now();
    let acc = 0;
    loop = setInterval(() => {
      const now = performance.now();
      acc += Math.min(now - last, 250); // never try to catch up more than 250 ms
      last = now;
      let steps = 0;
      while (acc >= DT_MS && steps < 5) {
        const t0 = performance.now();
        lobby.tickAll();
        tickTimes.push(performance.now() - t0);
        if (tickTimes.length > 600) tickTimes.shift();
        acc -= DT_MS;
        steps++;
      }
      if (steps === 5) acc = 0;
    }, 4);
  }

  return {
    server,
    wss,
    lobby,
    stats,
    listen: (port, host) =>
      new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          startLoop();
          resolve((server.address() as AddressInfo).port);
        });
      }),
    close: async () => {
      if (loop) clearInterval(loop);
      loop = null;
      for (const client of wss.clients) client.terminate();
      lobby.dispose();
      wss.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
```

- [ ] **Step 6: Implement `src/server/index.ts`**

```ts
import path from 'node:path';
import { initPhysics } from '../shared/physics';
import { createGameServer } from './app';

const int = (value: string | undefined, fallback: number): number => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

await initPhysics();

const port = int(process.env.PORT, 8080);
const staticDir = process.env.STATIC_DIR ?? path.resolve(process.cwd(), 'dist/client');
const app = createGameServer({
  staticDir,
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  maxRooms: int(process.env.MAX_ROOMS, 12),
  maxConnections: int(process.env.MAX_CONNECTIONS, 200),
});

const bound = await app.listen(port);
console.log(`wreckyard listening on :${bound} (static files: ${staticDir})`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().finally(() => process.exit(0));
  });
}
```

- [ ] **Step 7: Update `scripts/smoke-e2e.mjs` to speak the protocol**

Replace the whole file:

```js
// Smoke check: production bundle and dev flow (tsx server + vite dev proxy). Requires `npm run build` first.
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

if (!existsSync('dist/server/index.js') || !existsSync('dist/client/index.html')) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function start(cmd, args, env = {}) {
  const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  return { child, output: () => out };
}

async function waitFor(fn, label, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* not ready yet */
    }
    await sleep(150);
  }
  throw new Error(`timeout waiting for ${label}`);
}

/** Opens a private room over the WebSocket and resolves with its code. */
function createRoom(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error('ws timeout ' + url)), 5000);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 1, name: 'smoke', color: 255, mode: 'create' })));
    ws.on('message', (d, isBinary) => {
      if (isBinary) return;
      const m = JSON.parse(String(d));
      if (m.t === 'welcome') {
        clearTimeout(timer);
        resolve(m.room.code);
        ws.close();
      }
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

const results = [];
let failed = false;
const kill = (p) => p.child.kill('SIGTERM');

{
  const p = start('node', ['dist/server/index.js'], { PORT: '18080' });
  try {
    await waitFor(() => p.output().includes('listening on :18080'), 'prod bundle to listen');
    const health = await (await fetch('http://127.0.0.1:18080/healthz')).json();
    const page = await (await fetch('http://127.0.0.1:18080/')).text();
    if (!page.includes('Wreckyard')) throw new Error('static client not served by the bundle');
    const code = await createRoom('ws://127.0.0.1:18080/ws');
    results.push(`OK   prod bundle: healthz ok=${health.ok}, static page served, private room ${code} created`);
  } catch (err) {
    failed = true;
    results.push(`FAIL prod bundle: ${err.message}\n${p.output()}`);
  } finally {
    kill(p);
  }
}

{
  const server = start('npx', ['tsx', 'src/server/index.ts'], { PORT: '8080' });
  const vite = start('npx', ['vite', '--port', '5173', '--strictPort']);
  try {
    await waitFor(() => server.output().includes('listening on :8080'), 'tsx server to listen');
    await waitFor(async () => (await fetch('http://127.0.0.1:5173/')).ok, 'vite dev to serve');
    const html = await (await fetch('http://127.0.0.1:5173/')).text();
    if (!html.includes('Wreckyard')) throw new Error('vite did not serve the Wreckyard page');
    const code = await createRoom('ws://127.0.0.1:5173/ws');
    results.push(`OK   dev flow: vite page served, room ${code} created through the /ws proxy`);
  } catch (err) {
    failed = true;
    results.push(`FAIL dev flow: ${err.message}\nserver:\n${server.output()}\nvite:\n${vite.output()}`);
  } finally {
    kill(server);
    kill(vite);
  }
}

console.log(results.join('\n'));
await sleep(300);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 8: Run tests, type-check, build and smoke**

Run: `npx vitest run tests/server tests/smoke.test.ts && npm run typecheck`
Expected: all server tests and the smoke test pass (the integration file takes ~10–20 s); type-check clean.

Run: `npm run build && npm run smoke`
Expected: build succeeds; `smoke` prints two `OK` lines. The prod line proves the bundled server (with `dist/client` static files) serves the page, `/healthz`, and creates a room.

If an integration test is flaky on a loaded machine, first re-run it alone; timing assertions have generous margins (snapshot rate 20–40 Hz for a 30 Hz stream). Do not loosen the hostile-traffic assertions.

- [ ] **Step 9: Commit (only if the user opted in to commits)**

```bash
git add -A
git commit -m "feat(server): WebSocket game server with lobby, tick loop, limits and integration tests"
```

---

### Task 11: Client networking — `Connection` and `SnapshotInterpolator`

**Files:**
- Create: `src/client/net/connection.ts`, `src/client/net/interp.ts`
- Test: `tests/client/connection.test.ts`, `tests/client/interp.test.ts`

**Interfaces:**
- Consumes: `CarInput` (input); `decodeSnapshot`, `encodeInput`, `parseServerMessage`, `ClientMessage`, `ServerMessage`, `Snapshot`, `SnapshotCar` (protocol); `NET`, `PHYSICS` (constants); `quatIntegrate`, `quatNlerp`, `vlerp` (math); `CarState` (types).
- Produces:
  - `connection.ts`: `serverUrl(loc: {protocol: string; host: string}, override?: string): string`, `ConnectionHandlers {onOpen?, onMessage, onSnapshot(snapshot, arrivalMs), onClose({code, reason})}`, `class Connection` — `constructor(url, handlers, now?, createSocket?)`, `rttMs`, `connect()`, `send(msg: ClientMessage)`, `sendInput(seq, input)`, `close()`. Pings every 1 s and smooths RTT.
  - `interp.ts`: `InterpPose {slot, flags, hp, state, throttle, steer, extrapolated}`, `class SnapshotInterpolator` — `constructor(delayMs?, maxExtrapolationMs?, capacity?)`, `stale`, `size`, `reset(epoch)`, `push(snapshot, arrivalMs): boolean`, `sample(nowMs): InterpPose[]`.

- [ ] **Step 1: Write the failing connection tests**

`tests/client/connection.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Connection, serverUrl } from '../../src/client/net/connection';
import { NEUTRAL_INPUT } from '../../src/shared/input';
import { SNAP_FLAG_ALIVE, decodeInput, encodeSnapshot, type Snapshot } from '../../src/shared/protocol';

class FakeWebSocket {
  readyState = 0;
  binaryType = 'blob';
  sent: Array<string | Uint8Array> = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(d: string | Uint8Array): void {
    this.sent.push(d);
  }
  close(code = 1000, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(data: unknown): void {
    this.onmessage?.({ data });
  }
}

const connections: Connection[] = [];

function setup() {
  const fake = new FakeWebSocket();
  const events = { open: 0, messages: [] as unknown[], snapshots: [] as Array<[Snapshot, number]>, closes: [] as unknown[] };
  let now = 1000;
  const conn = new Connection(
    'ws://x/ws',
    {
      onOpen: () => events.open++,
      onMessage: (m) => events.messages.push(m),
      onSnapshot: (s, at) => events.snapshots.push([s, at]),
      onClose: (info) => events.closes.push(info),
    },
    () => now,
    () => fake as unknown as WebSocket,
  );
  connections.push(conn);
  return { fake, conn, events, setNow: (t: number) => (now = t) };
}

afterEach(() => {
  for (const c of connections.splice(0)) c.close(); // clears ping timers (fake or real) before real timers return
  vi.useRealTimers();
});

const snapshot: Snapshot = {
  epoch: 1,
  tick: 4,
  ackSeq: 2,
  cars: [
    {
      slot: 0,
      flags: SNAP_FLAG_ALIVE,
      hp: 100,
      state: { pos: { x: 1, y: 1, z: 1 }, quat: { x: 0, y: 0, z: 0, w: 1 }, linvel: { x: 0, y: 0, z: 0 }, angvel: { x: 0, y: 0, z: 0 } },
      throttle: 0,
      steer: 0,
    },
  ],
};

describe('serverUrl', () => {
  it('derives ws/wss from the page location and honours an override', () => {
    expect(serverUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/ws');
    expect(serverUrl({ protocol: 'https:', host: 'play.example.com' })).toBe('wss://play.example.com/ws');
    expect(serverUrl({ protocol: 'http:', host: 'x' }, 'wss://game.example.com/ws')).toBe('wss://game.example.com/ws');
  });
});

describe('Connection', () => {
  it('requests arraybuffer frames, reports open, and dispatches parsed messages', () => {
    const { fake, conn, events } = setup();
    conn.connect();
    expect(fake.binaryType).toBe('arraybuffer');
    fake.open();
    expect(events.open).toBe(1);
    fake.receive(JSON.stringify({ t: 'roster', epoch: 2, players: [] }));
    fake.receive('not json'); // ignored
    fake.receive(JSON.stringify({ t: 'mystery' })); // ignored
    expect(events.messages).toEqual([{ t: 'roster', epoch: 2, players: [] }]);
  });

  it('decodes binary snapshots and stamps them with the arrival time', () => {
    const { fake, conn, events, setNow } = setup();
    conn.connect();
    fake.open();
    setNow(1234);
    const bytes = encodeSnapshot(snapshot);
    fake.receive(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    fake.receive(new ArrayBuffer(3)); // malformed, ignored
    expect(events.snapshots).toHaveLength(1);
    expect(events.snapshots[0]![1]).toBe(1234);
    expect(events.snapshots[0]![0].tick).toBe(4);
  });

  it('sends inputs as 8-byte frames only while the socket is open', () => {
    const { fake, conn } = setup();
    conn.connect();
    conn.sendInput(1, NEUTRAL_INPUT); // not open yet: dropped
    expect(fake.sent).toHaveLength(0);
    fake.open();
    fake.sent.length = 0; // start from a clean slate
    conn.sendInput(7, { throttle: 1, steer: 0, handbrake: false });
    const frame = fake.sent[0] as Uint8Array;
    expect(frame.byteLength).toBe(8);
    expect(decodeInput(frame)!.seq).toBe(7);
  });

  it('pings every second and smooths the round-trip time', () => {
    vi.useFakeTimers();
    const { fake, conn, setNow } = setup();
    conn.connect();
    fake.open();
    setNow(2000);
    vi.advanceTimersByTime(1000);
    const ping = JSON.parse(fake.sent.filter((d): d is string => typeof d === 'string').at(-1)!);
    expect(ping).toMatchObject({ t: 'ping', c: 2000 });
    setNow(2040);
    fake.receive(JSON.stringify({ t: 'pong', id: ping.id, c: 2000, tick: 0 }));
    expect(conn.rttMs).toBeCloseTo(40, 6);
    setNow(3100);
    fake.receive(JSON.stringify({ t: 'pong', id: 2, c: 3000, tick: 0 })); // 100 ms sample
    expect(conn.rttMs).toBeCloseTo(40 * 0.8 + 100 * 0.2, 6);
  });

  it('reports close events and stops pinging afterwards', () => {
    vi.useFakeTimers();
    const { fake, conn, events } = setup();
    conn.connect();
    fake.open();
    fake.close(4001, 'inactive');
    expect(events.closes).toEqual([{ code: 4001, reason: 'inactive' }]);
    const sentBefore = fake.sent.length;
    vi.advanceTimersByTime(5000);
    expect(fake.sent.length).toBe(sentBefore);
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement `connection.ts`**

Run: `npx vitest run tests/client/connection.test.ts` — Expected: FAIL (module not found).

`src/client/net/connection.ts`:

```ts
import type { CarInput } from '../../shared/input';
import {
  decodeSnapshot,
  encodeInput,
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
  type Snapshot,
} from '../../shared/protocol';

export interface ConnectionHandlers {
  onOpen?(): void;
  onMessage(msg: ServerMessage): void;
  onSnapshot(snapshot: Snapshot, arrivalMs: number): void;
  onClose(info: { code: number; reason: string }): void;
}

const WS_OPEN = 1;
const PING_EVERY_MS = 1000;

/** ws:// or wss:// URL of the game server for the current page (or an explicit override). */
export function serverUrl(loc: { protocol: string; host: string }, override?: string): string {
  if (override) return override;
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`;
}

export class Connection {
  /** Smoothed round-trip time in ms; 0 until the first pong arrives. */
  rttMs = 0;
  private ws: WebSocket | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pingId = 0;

  constructor(
    private readonly url: string,
    private readonly handlers: ConnectionHandlers,
    private readonly now: () => number = () => performance.now(),
    private readonly createSocket: (url: string) => WebSocket = (u) => new WebSocket(u),
  ) {}

  connect(): void {
    const ws = this.createSocket(this.url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      this.startPing();
      this.handlers.onOpen?.();
    };
    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === 'string') {
        const msg = parseServerMessage(ev.data);
        if (!msg) return;
        if (msg.t === 'pong') this.recordPong(msg.c);
        this.handlers.onMessage(msg);
      } else if (ev.data instanceof ArrayBuffer) {
        const snapshot = decodeSnapshot(new Uint8Array(ev.data));
        if (snapshot) this.handlers.onSnapshot(snapshot, this.now());
      }
    };
    ws.onclose = (ev: CloseEvent) => {
      this.stopPing();
      this.handlers.onClose({ code: ev.code, reason: ev.reason });
    };
    ws.onerror = () => {
      /* a close event always follows */
    };
    this.ws = ws;
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WS_OPEN) this.ws.send(JSON.stringify(msg));
  }

  sendInput(seq: number, input: CarInput): void {
    if (this.ws?.readyState === WS_OPEN) this.ws.send(encodeInput(seq, input));
  }

  close(): void {
    this.stopPing();
    this.ws?.close();
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => this.send({ t: 'ping', id: ++this.pingId, c: this.now() }), PING_EVERY_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private recordPong(sentAt: number): void {
    const rtt = Math.max(0, this.now() - sentAt);
    this.rttMs = this.rttMs === 0 ? rtt : this.rttMs * 0.8 + rtt * 0.2;
  }
}
```

Run again — Expected: PASS.

- [ ] **Step 3: Write the failing interpolator tests**

`tests/client/interp.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SnapshotInterpolator } from '../../src/client/net/interp';
import type { Snapshot, SnapshotCar } from '../../src/shared/protocol';

const TICK_MS = 1000 / 60;
const car = (slot: number, x: number, vx = 0): SnapshotCar => ({
  slot,
  flags: 1,
  hp: 100,
  state: { pos: { x, y: 1, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 }, linvel: { x: vx, y: 0, z: 0 }, angvel: { x: 0, y: 0, z: 0 } },
  throttle: 0,
  steer: 0,
});
const snap = (tick: number, cars: SnapshotCar[], epoch = 1): Snapshot => ({ epoch, tick, ackSeq: 0, cars });

/** Two snapshots (ticks 0 and 2) that arrive with zero jitter; render time 0 corresponds to now = 1100 (delay 100). */
function twoSnapshots(): SnapshotInterpolator {
  const i = new SnapshotInterpolator(100, 250);
  i.reset(1);
  i.push(snap(0, [car(0, 0, 10)]), 1000);
  i.push(snap(2, [car(0, 10, 10)]), 1000 + 2 * TICK_MS);
  return i;
}

describe('SnapshotInterpolator', () => {
  it('returns nothing before a world epoch is set or any snapshot arrives', () => {
    const i = new SnapshotInterpolator();
    expect(i.sample(5000)).toEqual([]);
    i.reset(1);
    expect(i.sample(5000)).toEqual([]);
  });

  it('interpolates between the two bracketing snapshots', () => {
    const i = twoSnapshots();
    const poses = i.sample(1100 + TICK_MS); // render time = halfway between tick 0 and tick 2
    expect(poses).toHaveLength(1);
    expect(poses[0]!.state.pos.x).toBeCloseTo(5, 4);
    expect(poses[0]!.extrapolated).toBe(false);
  });

  it('holds the oldest snapshot when render time is earlier than the buffer', () => {
    const i = twoSnapshots();
    expect(i.sample(1000)[0]!.state.pos.x).toBe(0);
  });

  it('extrapolates with velocity when the buffer runs dry, capped at maxExtrapolationMs', () => {
    const i = twoSnapshots();
    const newestMs = 2 * TICK_MS;
    const at100 = i.sample(1000 + 100 + newestMs + 100)[0]!; // 100 ms past the newest snapshot
    expect(at100.extrapolated).toBe(true);
    expect(at100.state.pos.x).toBeCloseTo(10 + 10 * 0.1, 4);
    const far = i.sample(1000 + 100 + newestMs + 5000)[0]!; // far past: capped at 250 ms
    expect(far.state.pos.x).toBeCloseTo(10 + 10 * 0.25, 4);
  });

  it('drops snapshots from other epochs, duplicates and older ticks', () => {
    const i = new SnapshotInterpolator();
    expect(i.push(snap(0, [car(0, 0)]), 1000)).toBe(false); // no epoch yet
    i.reset(3);
    expect(i.push(snap(1, [car(0, 0)], 2), 1000)).toBe(false); // wrong epoch
    expect(i.push(snap(4, [car(0, 0)], 3), 1000)).toBe(true);
    expect(i.push(snap(4, [car(0, 0)], 3), 1001)).toBe(false); // duplicate tick
    expect(i.push(snap(3, [car(0, 0)], 3), 1002)).toBe(false); // older tick
    expect(i.size).toBe(1);
    expect(i.stale).toBe(4);
  });

  it('reset clears history and switches epoch', () => {
    const i = twoSnapshots();
    i.reset(2);
    expect(i.size).toBe(0);
    expect(i.sample(2000)).toEqual([]);
    expect(i.push(snap(0, [car(0, 0)], 1), 1000)).toBe(false);
    expect(i.push(snap(0, [car(0, 0)], 2), 1000)).toBe(true);
  });

  it('only interpolates cars present in both snapshots and uses the newer state for new cars', () => {
    const i = new SnapshotInterpolator(100, 250);
    i.reset(1);
    i.push(snap(0, [car(0, 0), car(1, 100)]), 1000);
    i.push(snap(2, [car(0, 10), car(2, 50)]), 1000 + 2 * TICK_MS);
    const poses = i.sample(1100 + TICK_MS);
    expect(poses.map((p) => p.slot)).toEqual([0, 2]); // slot 1 vanished, slot 2 appeared
    expect(poses[0]!.state.pos.x).toBeCloseTo(5, 4);
    expect(poses[1]!.state.pos.x).toBe(50);
  });

  it('stays monotonic and close to the truth under arrival jitter', () => {
    const interp = new SnapshotInterpolator();
    interp.reset(1);
    const arrivals = Array.from({ length: 90 }, (_, i) => ({ tick: i * 2, at: 5000 + i * 2 * TICK_MS + ((i * 7919) % 26) }));
    let next = 0;
    let last = -Infinity;
    let lastNow = 5000;
    let x = 0;
    for (let now = 5000; now < 7900; now += 1000 / 60) {
      while (next < arrivals.length && arrivals[next]!.at <= now) {
        const a = arrivals[next++]!;
        interp.push(snap(a.tick, [car(0, 10 * ((a.tick * TICK_MS) / 1000), 10)]), a.at);
      }
      const poses = interp.sample(now);
      if (poses.length === 0) continue;
      x = poses[0]!.state.pos.x;
      expect(x).toBeGreaterThanOrEqual(last - 1e-9);
      last = x;
      lastNow = now;
    }
    const truth = 10 * ((lastNow - 5000 - 100) / 1000);
    expect(Math.abs(x - truth)).toBeLessThan(0.5);
  });
});
```

- [ ] **Step 4: Run to verify failure, then implement `interp.ts`**

Run: `npx vitest run tests/client/interp.test.ts` — Expected: FAIL (module not found).

`src/client/net/interp.ts`:

```ts
import { NET, PHYSICS } from '../../shared/constants';
import { quatIntegrate, quatNlerp, vlerp } from '../../shared/math';
import type { Snapshot, SnapshotCar } from '../../shared/protocol';
import type { CarState } from '../../shared/types';

const TICK_MS = 1000 / PHYSICS.TICK_RATE;

export interface InterpPose {
  slot: number;
  flags: number;
  hp: number;
  state: CarState;
  throttle: number;
  steer: number;
  extrapolated: boolean;
}

const lerpState = (a: CarState, b: CarState, t: number): CarState => ({
  pos: vlerp(a.pos, b.pos, t),
  quat: quatNlerp(a.quat, b.quat, t),
  linvel: vlerp(a.linvel, b.linvel, t),
  angvel: vlerp(a.angvel, b.angvel, t),
});

/** Dead reckoning: advance position by linear velocity and orientation by angular velocity. */
const extrapolate = (s: CarState, seconds: number): CarState => ({
  pos: { x: s.pos.x + s.linvel.x * seconds, y: s.pos.y + s.linvel.y * seconds, z: s.pos.z + s.linvel.z * seconds },
  quat: quatIntegrate(s.quat, s.angvel, seconds),
  linvel: s.linvel,
  angvel: s.angvel,
});

const pose = (c: SnapshotCar, state: CarState, extrapolated: boolean): InterpPose => ({
  slot: c.slot,
  flags: c.flags,
  hp: c.hp,
  state,
  throttle: c.throttle,
  steer: c.steer,
  extrapolated,
});

/**
 * Buffers server snapshots and renders the world `delayMs` in the past by interpolating between the two
 * snapshots that bracket the render time. The local-to-server clock offset tracks the *fastest* arrival path
 * (immediately adopts smaller offsets, drifts up slowly), which keeps jitter out of the render time.
 */
export class SnapshotInterpolator {
  private buf: Snapshot[] = [];
  private epoch: number | null = null;
  private offset: number | null = null; // local ms minus server ms
  /** Snapshots ignored because of a wrong epoch, a duplicate tick or an older tick. */
  stale = 0;

  constructor(
    private readonly delayMs: number = NET.INTERP_DELAY_MS,
    private readonly maxExtrapolationMs: number = NET.MAX_EXTRAPOLATION_MS,
    private readonly capacity = 64,
  ) {}

  get size(): number {
    return this.buf.length;
  }

  /** Switches to a new world epoch and discards all history. */
  reset(epoch: number): void {
    this.epoch = epoch & 0xff;
    this.buf = [];
    this.offset = null;
  }

  /** Returns false when the snapshot was ignored. */
  push(s: Snapshot, arrivalMs: number): boolean {
    if (this.epoch === null || s.epoch !== this.epoch) {
      this.stale++;
      return false;
    }
    const newest = this.buf[this.buf.length - 1];
    if (newest && s.tick <= newest.tick) {
      this.stale++;
      return false;
    }
    const sample = arrivalMs - s.tick * TICK_MS;
    if (this.offset === null || sample < this.offset) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.02;
    this.buf.push(s);
    if (this.buf.length > this.capacity) this.buf.shift();
    return true;
  }

  /** Poses of every car at render time (now - delay). */
  sample(nowMs: number): InterpPose[] {
    if (this.offset === null || this.buf.length === 0) return [];
    const t = nowMs - this.offset - this.delayMs; // render time in server milliseconds
    const ms = (s: Snapshot): number => s.tick * TICK_MS;
    const first = this.buf[0]!;
    const newest = this.buf[this.buf.length - 1]!;
    if (t <= ms(first)) return first.cars.map((c) => pose(c, c.state, false));
    if (t >= ms(newest)) {
      const seconds = Math.min(t - ms(newest), this.maxExtrapolationMs) / 1000;
      return newest.cars.map((c) => pose(c, extrapolate(c.state, seconds), seconds > 0));
    }
    let hi = this.buf.length - 1;
    while (hi > 0 && ms(this.buf[hi - 1]!) > t) hi--;
    const a = this.buf[hi - 1]!;
    const b = this.buf[hi]!;
    const alpha = (t - ms(a)) / (ms(b) - ms(a));
    const before = new Map(a.cars.map((c) => [c.slot, c] as const));
    return b.cars.map((cb) => {
      const ca = before.get(cb.slot);
      return ca ? pose(cb, lerpState(ca.state, cb.state, alpha), false) : pose(cb, cb.state, false);
    });
  }
}
```

Run: `npx vitest run tests/client && npm run typecheck`
Expected: PASS (connection, interp and the Plan 1 client tests); type-check clean.

- [ ] **Step 5: Commit (only if the user opted in to commits)**

```bash
git add -A
git commit -m "feat(client): WebSocket connection with RTT and snapshot interpolator"
```

---

### Task 12: Multiplayer client — menu, HUD, game wiring, bot script, browser verification

**Files:**
- Modify: `src/shared/vehicle.ts` (extract `steeringAngle`), `src/client/index.html` (UI container + styles), `src/client/main.ts` (routing), `README.md`
- Create: `src/client/ui/menu.ts`, `src/client/ui/hud.ts`, `src/client/game/nameTag.ts`, `src/client/game/gameClient.ts`, `scripts/bot.ts`
- Test: `tests/steering.test.ts`

**Interfaces:**
- Consumes: `Connection`, `serverUrl` (net/connection); `SnapshotInterpolator`, `InterpPose` (net/interp); `CarView`, `ChaseCamera`, `KeyboardInput`, `FixedStepper`, `createGameScene`, `GameScene`, `webglAvailable`, `startSandbox` (client/game); `quantizeInput`; `NET`, `PHYSICS`, `CAR_FORWARD`; `quatRotate`, `vdot`, `vlen`; protocol types.
- Produces:
  - `vehicle.ts`: `steeringAngle(steer: number, forwardSpeed: number): number` (Rapier radians, positive = left; `driveCar` now uses it).
  - `menu.ts`: `JoinChoice {name, color, mode, code?}`, `PALETTE`, `MenuOptions {initialCode?, error?}`, `showMenu(root, options?): Promise<JoinChoice>`.
  - `hud.ts`: `Hud {setRoom, setPlayers, setStats, showNotice, dispose}`, `createHud(root): Hud`.
  - `nameTag.ts`: `createNameTag(text: string): THREE.Sprite` (billboarded label, 4 × 1 m, hovering 2.3 m above the car's origin), `disposeNameTag(sprite)`.
  - `gameClient.ts`: `GameClientOptions {gs, hud, choice, url, onExit}`, `class GameClient` — `start()`, `stop()`; exposes `window.__derby.debug()`.
  - URL parameters: `?auto=quick|create|join:CODE` (+ `&name=`, `&color=<palette index>`) skips the menu; `?room=CODE` pre-fills the join box; `?sandbox` opens the Plan 1 sandbox.
  - `scripts/bot.ts`: `npx tsx scripts/bot.ts [--url ws://localhost:8080/ws] [--mode quick|create|join] [--code ABCD] [--name Bot] [--seconds 120]`.

- [ ] **Step 1: Write the failing steering test**

`tests/steering.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DRIVE } from '../src/shared/constants';
import { steeringAngle } from '../src/shared/vehicle';

describe('steeringAngle', () => {
  it('is zero without input and uses the configured sign and maximum at standstill', () => {
    expect(steeringAngle(0, 10)).toBeCloseTo(0, 9);
    expect(steeringAngle(1, 0)).toBeCloseTo(DRIVE.STEER_SIGN * DRIVE.MAX_STEER, 9);
    expect(steeringAngle(-1, 0)).toBeCloseTo(-DRIVE.STEER_SIGN * DRIVE.MAX_STEER, 9);
  });

  it('tapers with speed in either direction of travel and clamps the input', () => {
    expect(Math.abs(steeringAngle(1, DRIVE.STEER_FADE_SPEED))).toBeCloseTo(DRIVE.MAX_STEER_FAST, 9);
    expect(Math.abs(steeringAngle(1, -DRIVE.STEER_FADE_SPEED))).toBeCloseTo(DRIVE.MAX_STEER_FAST, 9);
    expect(Math.abs(steeringAngle(1, DRIVE.STEER_FADE_SPEED * 3))).toBeCloseTo(DRIVE.MAX_STEER_FAST, 9);
    expect(steeringAngle(5, 0)).toBeCloseTo(steeringAngle(1, 0), 9);
  });
});
```

- [ ] **Step 2: Run to verify failure, then extract `steeringAngle` in `src/shared/vehicle.ts`**

Run: `npx vitest run tests/steering.test.ts` — Expected: FAIL (`steeringAngle` is not exported).

In `src/shared/vehicle.ts`, add this function directly above `driveCar`:

```ts
/** Rapier steering angle in radians (positive = left) for a steer input in [-1, 1] at a forward speed in m/s. */
export function steeringAngle(steer: number, forwardSpeed: number): number {
  const steerMax = lerp(
    DRIVE.MAX_STEER,
    DRIVE.MAX_STEER_FAST,
    clamp(Math.abs(forwardSpeed) / DRIVE.STEER_FADE_SPEED, 0, 1),
  );
  return DRIVE.STEER_SIGN * clamp(steer, -1, 1) * steerMax;
}
```

and inside `driveCar` replace these two lines:

```ts
  const steerMax = lerp(DRIVE.MAX_STEER, DRIVE.MAX_STEER_FAST, clamp(Math.abs(vf) / DRIVE.STEER_FADE_SPEED, 0, 1));
  const steering = DRIVE.STEER_SIGN * clamp(input.steer, -1, 1) * steerMax;
```

with:

```ts
  const steering = steeringAngle(input.steer, vf);
```

Run: `npx vitest run tests/steering.test.ts tests/vehicle.test.ts` — Expected: PASS (behaviour is unchanged, so the Plan 1 handling tests still pass).

- [ ] **Step 3: Replace `src/client/index.html` with the version that has the UI container and styles**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Wreckyard</title>
    <style>
      :root {
        --bg: #0b1226;
        --ink: #dfe7ff;
        --muted: #8fa0c8;
        --panel: rgba(13, 20, 42, 0.86);
        --line: rgba(160, 180, 255, 0.22);
        --accent: #ff7a1a;
      }
      html,
      body {
        margin: 0;
        height: 100%;
        background: var(--bg);
        overflow: hidden;
        color: var(--ink);
        font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      }
      #game {
        position: fixed;
        inset: 0;
        width: 100%;
        height: 100%;
        display: block;
      }
      #hud {
        position: fixed;
        left: 16px;
        top: 12px;
        margin: 0;
        max-width: calc(100vw - 32px);
        font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
        text-shadow: 0 1px 2px #000;
        white-space: pre-wrap;
        pointer-events: none;
      }
      #ui {
        position: fixed;
        inset: 0;
        pointer-events: none;
      }
      #ui button,
      #ui input {
        pointer-events: auto;
      }

      .menu {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        width: min(420px, calc(100vw - 32px));
        box-sizing: border-box;
        padding: 28px 28px 22px;
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 14px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(6px);
        pointer-events: auto;
      }
      .menu h1 {
        margin: 0;
        font-size: 34px;
        letter-spacing: 0.18em;
        color: #fff;
      }
      .menu .tag {
        margin: 4px 0 18px;
        color: var(--muted);
        font-size: 13px;
      }
      .menu label {
        display: block;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }
      .menu input {
        width: 100%;
        box-sizing: border-box;
        margin-top: 6px;
        padding: 10px 12px;
        font: inherit;
        font-size: 16px;
        color: var(--ink);
        background: rgba(0, 0, 0, 0.35);
        border: 1px solid var(--line);
        border-radius: 8px;
      }
      .menu input:focus-visible,
      .menu button:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
      }
      .swatches {
        display: flex;
        gap: 8px;
        margin: 14px 0;
      }
      .swatch {
        width: 30px;
        height: 30px;
        padding: 0;
        border-radius: 50%;
        border: 2px solid transparent;
        cursor: pointer;
      }
      .swatch[aria-checked='true'] {
        border-color: #fff;
        box-shadow: 0 0 0 2px var(--accent);
      }
      .menu .row {
        display: flex;
        gap: 8px;
        margin-top: 10px;
      }
      .menu .row input {
        flex: none;
        width: 110px;
        margin-top: 0;
        text-align: center;
        text-transform: uppercase;
        letter-spacing: 0.3em;
      }
      .menu button {
        flex: 1;
        padding: 11px 14px;
        font: inherit;
        font-weight: 600;
        color: var(--ink);
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid var(--line);
        border-radius: 8px;
        cursor: pointer;
      }
      .menu button.primary {
        background: var(--accent);
        border-color: var(--accent);
        color: #1a0d00;
      }
      .menu button:hover {
        filter: brightness(1.15);
      }
      .menu .error {
        min-height: 1.3em;
        margin: 12px 0 0;
        color: #ff8a8a;
        font-size: 13px;
      }
      .menu .hint {
        margin: 6px 0 0;
        color: var(--muted);
        font-size: 12px;
      }

      .hud {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      .hud-room {
        position: absolute;
        left: 16px;
        top: 12px;
        display: flex;
        gap: 10px;
        align-items: center;
        padding: 6px 10px;
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        font-size: 13px;
      }
      .hud-room button {
        padding: 3px 8px;
        font: inherit;
        font-size: 12px;
        color: var(--ink);
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid var(--line);
        border-radius: 6px;
        cursor: pointer;
      }
      .hud-players {
        position: absolute;
        right: 16px;
        top: 12px;
        min-width: 150px;
        margin: 0;
        padding: 8px 12px;
        list-style: none;
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        font-size: 13px;
      }
      .hud-players li {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 2px 0;
      }
      .hud-players .chip {
        flex: none;
        width: 10px;
        height: 10px;
        border-radius: 50%;
      }
      .hud-players .you {
        color: var(--accent);
        font-size: 11px;
      }
      .hud-stats {
        position: absolute;
        left: 16px;
        bottom: 12px;
        font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
        color: var(--muted);
        text-shadow: 0 1px 2px #000;
      }
      .hud-notice {
        position: absolute;
        left: 50%;
        bottom: 40px;
        transform: translateX(-50%);
        font-size: 15px;
        text-shadow: 0 1px 3px #000;
      }
    </style>
  </head>
  <body>
    <canvas id="game"></canvas>
    <pre id="hud"></pre>
    <div id="ui"></div>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 4: Write `src/client/ui/menu.ts`**

```ts
import { normalizeRoomCode, type JoinMode } from '../../shared/protocol';

export interface JoinChoice {
  name: string;
  color: number;
  mode: JoinMode;
  code?: string;
}

export const PALETTE: readonly number[] = [0xd84a2b, 0x2b7fd8, 0x2fb457, 0xe0b122, 0x9b59d0, 0x18b5b5, 0xe8527d, 0xe9e9e9];

const STORE_KEY = 'wreckyard.profile';
interface Profile {
  name: string;
  color: number;
}

function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Profile>;
      if (typeof p.name === 'string' && typeof p.color === 'number' && PALETTE.includes(p.color)) {
        return { name: p.name, color: p.color };
      }
    }
  } catch {
    /* storage unavailable or corrupt: fall through to defaults */
  }
  return { name: '', color: PALETTE[0]! };
}

function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(p));
  } catch {
    /* private mode: not fatal */
  }
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

export interface MenuOptions {
  /** Pre-fills the room-code box (e.g. from an invite link). */
  initialCode?: string;
  error?: string;
}

/** Renders the main menu into `root` and resolves once the player picks a way to join. */
export function showMenu(root: HTMLElement, options: MenuOptions = {}): Promise<JoinChoice> {
  const profile = loadProfile();
  root.replaceChildren();
  const menu = document.createElement('div');
  menu.className = 'menu';
  // static markup only — user-provided text is always assigned through .value / .textContent below
  menu.innerHTML = `
    <h1>WRECKYARD</h1>
    <p class="tag">Demolition derby arena · last car running wins</p>
    <label>Driver name<input id="m-name" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Your name" /></label>
    <div class="swatches" id="m-colors" role="radiogroup" aria-label="Car colour"></div>
    <div class="row"><button id="m-quick" class="primary" type="button">Quick Play</button><button id="m-create" type="button">Create private room</button></div>
    <div class="row"><input id="m-code" maxlength="4" placeholder="CODE" autocomplete="off" spellcheck="false" aria-label="Room code" /><button id="m-join" type="button">Join with code</button></div>
    <p class="error" id="m-error" role="alert"></p>
    <p class="hint">W/S throttle · A/D steer · Space handbrake</p>`;
  root.append(menu);

  const q = <T extends HTMLElement>(selector: string): T => menu.querySelector<T>(selector)!;
  const nameInput = q<HTMLInputElement>('#m-name');
  const codeInput = q<HTMLInputElement>('#m-code');
  const errorEl = q<HTMLElement>('#m-error');
  const swatches = q<HTMLElement>('#m-colors');
  nameInput.value = profile.name;
  if (options.initialCode) codeInput.value = options.initialCode.toUpperCase().slice(0, 4);
  if (options.error) errorEl.textContent = options.error;

  let color = profile.color;
  for (const c of PALETTE) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.background = hex(c);
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', `Car colour ${hex(c)}`);
    b.setAttribute('aria-checked', String(c === color));
    b.addEventListener('click', () => {
      color = c;
      for (const s of swatches.children) s.setAttribute('aria-checked', String(s === b));
    });
    swatches.append(b);
  }

  return new Promise<JoinChoice>((resolve) => {
    const choose = (mode: JoinMode): void => {
      const name = nameInput.value.trim();
      let code: string | undefined;
      if (mode === 'join') {
        const normalized = normalizeRoomCode(codeInput.value);
        if (!normalized) {
          errorEl.textContent = 'Enter a 4-letter room code.';
          codeInput.focus();
          return;
        }
        code = normalized;
      }
      saveProfile({ name, color });
      resolve({ name, color, mode, code });
    };
    q('#m-quick').addEventListener('click', () => choose('quick'));
    q('#m-create').addEventListener('click', () => choose('create'));
    q('#m-join').addEventListener('click', () => choose('join'));
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') choose('quick');
    });
    codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') choose('join');
    });
    (options.initialCode ? codeInput : nameInput).focus();
  });
}
```

- [ ] **Step 5: Write `src/client/ui/hud.ts`**

```ts
import type { PlayerInfo } from '../../shared/protocol';

export interface Hud {
  setRoom(code: string, isPublic: boolean): void;
  setPlayers(players: readonly PlayerInfo[], you: number): void;
  setStats(text: string): void;
  /** Shows a short message near the bottom of the screen for a few seconds. */
  showNotice(text: string): void;
  dispose(): void;
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

export function createHud(root: HTMLElement): Hud {
  root.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = 'hud';
  const room = document.createElement('div');
  room.className = 'hud-room';
  const list = document.createElement('ul');
  list.className = 'hud-players';
  const stats = document.createElement('div');
  stats.className = 'hud-stats';
  const notice = document.createElement('div');
  notice.className = 'hud-notice';
  notice.setAttribute('role', 'status');
  wrap.append(room, list, stats, notice);
  root.append(wrap);

  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  const notify = (text: string): void => {
    notice.textContent = text;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      notice.textContent = '';
    }, 4000);
  };

  return {
    setRoom(code, isPublic) {
      room.replaceChildren();
      const label = document.createElement('span');
      label.textContent = `${isPublic ? 'Public' : 'Private'} room ${code}`;
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.textContent = 'Copy invite link';
      copy.addEventListener('click', () => {
        const url = new URL(location.href);
        url.search = '';
        url.searchParams.set('room', code);
        void navigator.clipboard?.writeText(url.toString()).then(
          () => notify('Invite link copied'),
          () => notify(url.toString()),
        );
      });
      room.append(label, copy);
    },
    setPlayers(players, you) {
      list.replaceChildren();
      for (const p of players) {
        const li = document.createElement('li');
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.style.background = hex(p.color);
        const name = document.createElement('span');
        name.textContent = p.name;
        li.append(chip, name);
        if (p.slot === you) {
          const tag = document.createElement('span');
          tag.className = 'you';
          tag.textContent = 'you';
          li.append(tag);
        }
        list.append(li);
      }
    },
    setStats(text) {
      stats.textContent = text;
    },
    showNotice: notify,
    dispose() {
      if (noticeTimer) clearTimeout(noticeTimer);
      root.replaceChildren();
    },
  };
}
```

- [ ] **Step 5b: Write `src/client/game/nameTag.ts` (floating driver names)**

```ts
import * as THREE from 'three';

/** A billboarded text label drawn on a canvas; hovers above a car and always faces the camera. */
export function createNameTag(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const g = canvas.getContext('2d')!;
  const font = (px: number): string => `600 ${px}px ui-sans-serif, system-ui, sans-serif`;
  let size = 30;
  g.font = font(size);
  while (g.measureText(text).width > 240 && size > 14) {
    size -= 2;
    g.font = font(size);
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(0, 0, 0, 0.75)';
  g.strokeText(text, 128, 34);
  g.fillStyle = '#ffffff';
  g.fillText(text, 128, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(4, 1, 1);
  sprite.position.set(0, 2.3, 0);
  sprite.renderOrder = 10;
  return sprite;
}

export function disposeNameTag(sprite: THREE.Sprite): void {
  sprite.material.map?.dispose();
  sprite.material.dispose();
  sprite.removeFromParent();
}
```

- [ ] **Step 6: Write `src/client/game/gameClient.ts`**

```ts
import * as THREE from 'three';
import { CAR_FORWARD, NET, PHYSICS } from '../../shared/constants';
import { quantizeInput } from '../../shared/input';
import { quatRotate, vdot, vlen } from '../../shared/math';
import type { PlayerInfo, ServerMessage } from '../../shared/protocol';
import { steeringAngle } from '../../shared/vehicle';
import { Connection } from '../net/connection';
import { SnapshotInterpolator, type InterpPose } from '../net/interp';
import type { Hud } from '../ui/hud';
import type { JoinChoice } from '../ui/menu';
import { ChaseCamera } from './camera';
import { CarView } from './carView';
import { KeyboardInput } from './input';
import { createNameTag, disposeNameTag } from './nameTag';
import type { GameScene } from './scene';
import { FixedStepper } from './stepper';

export interface GameClientOptions {
  gs: GameScene;
  hud: Hud;
  choice: JoinChoice;
  url: string;
  /** Called once when the game ends (server refused, connection lost, ...). */
  onExit(message?: string): void;
}

/**
 * Plan 2 baseline client: sends inputs at 60 Hz and renders every car (including your own) from interpolated
 * server snapshots. Client-side prediction arrives in Plan 3.
 */
export class GameClient {
  private readonly views = new Map<number, CarView>();
  private readonly tags = new Map<number, THREE.Sprite>();
  private readonly interp = new SnapshotInterpolator();
  private readonly chase = new ChaseCamera();
  private readonly keyboard = new KeyboardInput();
  private readonly stepper = new FixedStepper(PHYSICS.DT);
  private readonly timer = new THREE.Timer();
  private readonly conn: Connection;
  private mySlot = -1;
  private roomCode = '';
  private joined = false;
  private opened = false;
  private roster: PlayerInfo[] = [];
  private epoch = 0;
  private seq = 0;
  private snapshotsReceived = 0;
  private lastPoses: InterpPose[] = [];
  private raf = 0;
  private stopped = false;
  private frames = 0;
  private fps = 0;
  private fpsAt = performance.now();
  private statsAt = 0;

  constructor(private readonly opts: GameClientOptions) {
    this.timer.connect(document);
    this.conn = new Connection(opts.url, {
      onOpen: () => this.onOpen(),
      onMessage: (m) => this.onMessage(m),
      onSnapshot: (s, at) => {
        if (this.interp.push(s, at)) this.snapshotsReceived++;
      },
      onClose: (info) => this.onClose(info),
    });
  }

  start(): void {
    this.conn.connect();
    this.raf = requestAnimationFrame(this.frame);
    Object.assign(window, { __derby: { debug: () => this.debug() } });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    this.keyboard.dispose();
    this.conn.close();
    for (const slot of [...this.tags.keys()]) this.removeTag(slot);
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.timer.dispose();
    this.opts.hud.dispose();
  }

  private finish(message?: string): void {
    if (this.stopped) return;
    this.stop();
    this.opts.onExit(message);
  }

  private onOpen(): void {
    this.opened = true;
    const { choice } = this.opts;
    this.conn.send({
      t: 'hello',
      v: NET.PROTOCOL_VERSION,
      name: choice.name,
      color: choice.color,
      mode: choice.mode,
      code: choice.code,
    });
  }

  private onMessage(m: ServerMessage): void {
    switch (m.t) {
      case 'welcome':
        this.mySlot = m.you;
        this.roomCode = m.room.code;
        this.joined = true;
        this.epoch = m.epoch;
        this.roster = m.players;
        this.interp.reset(m.epoch);
        this.applyRoster();
        this.opts.hud.setRoom(m.room.code, m.room.public);
        this.opts.hud.setPlayers(this.roster, this.mySlot);
        break;
      case 'roster':
        this.epoch = m.epoch;
        this.roster = m.players;
        this.interp.reset(m.epoch); // a new world: drop all buffered snapshots
        this.applyRoster();
        this.opts.hud.setPlayers(this.roster, this.mySlot);
        break;
      case 'error':
        if (this.joined) this.opts.hud.showNotice(m.message);
        else this.finish(m.message);
        break;
      case 'pong':
        break;
    }
  }

  private onClose(info: { code: number; reason: string }): void {
    if (this.stopped) return;
    let message: string;
    if (!this.opened) message = 'Could not reach the game server.';
    else if (info.code === 4001) message = 'You were disconnected for inactivity.';
    else if (info.code === 1002) message = 'The game was updated — reload the page and try again.';
    else message = `Disconnected from the server${info.reason ? `: ${info.reason}` : ''}.`;
    this.finish(message);
  }

  private applyRoster(): void {
    const slots = new Set(this.roster.map((p) => p.slot));
    for (const p of this.roster) {
      const existing = this.views.get(p.slot);
      if (existing) {
        existing.setColor(p.color);
      } else {
        const view = new CarView(p.color);
        view.group.visible = false; // shown once the first snapshot for this world arrives
        this.opts.gs.scene.add(view.group);
        this.views.set(p.slot, view);
      }
      if (p.slot === this.mySlot) this.removeTag(p.slot); // no floating name over your own car
      else this.setTag(p.slot, p.name);
    }
    for (const [slot, view] of this.views) {
      if (!slots.has(slot)) {
        this.removeTag(slot);
        view.dispose();
        this.views.delete(slot);
      }
    }
  }

  private setTag(slot: number, name: string): void {
    const view = this.views.get(slot);
    if (!view) return;
    const existing = this.tags.get(slot);
    if (existing && existing.userData.name === name) return;
    if (existing) disposeNameTag(existing);
    const tag = createNameTag(name);
    tag.userData.name = name;
    view.group.add(tag);
    this.tags.set(slot, tag);
  }

  private removeTag(slot: number): void {
    const tag = this.tags.get(slot);
    if (!tag) return;
    disposeNameTag(tag);
    this.tags.delete(slot);
  }

  private readonly frame = (ts: number): void => {
    if (this.stopped) return;
    this.timer.update(ts);
    const dt = this.timer.getDelta();

    if (this.joined) {
      this.stepper.advance(dt, () => {
        this.seq = (this.seq + 1) >>> 0;
        this.conn.sendInput(this.seq, quantizeInput(this.keyboard.sample(PHYSICS.DT)));
      });
    }

    const poses = this.interp.sample(performance.now());
    this.lastPoses = poses;
    const seen = new Set<number>();
    for (const p of poses) {
      const view = this.views.get(p.slot);
      if (!view) continue;
      seen.add(p.slot);
      view.group.visible = true;
      view.setPose(p.state.pos, p.state.quat);
      const vf = vdot(p.state.linvel, quatRotate(p.state.quat, CAR_FORWARD));
      view.animateWheels(vf, steeringAngle(p.steer, vf), dt);
    }
    for (const [slot, view] of this.views) if (!seen.has(slot)) view.group.visible = false;

    const me = poses.find((p) => p.slot === this.mySlot);
    if (me) {
      this.chase.update(this.opts.gs.camera, { pos: me.state.pos, quat: me.state.quat, speed: vlen(me.state.linvel) }, dt);
    }
    this.opts.gs.resize();
    this.opts.gs.render();
    this.updateStats();
    this.raf = requestAnimationFrame(this.frame);
  };

  private updateStats(): void {
    this.frames++;
    const now = performance.now();
    if (now - this.fpsAt >= 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsAt));
      this.frames = 0;
      this.fpsAt = now;
    }
    if (now - this.statsAt > 250) {
      this.statsAt = now;
      this.opts.hud.setStats(
        `ping ${Math.round(this.conn.rttMs)} ms · ${this.fps} fps · snapshots ${this.snapshotsReceived} · buffer ${this.interp.size}`,
      );
    }
  }

  /** Read-only snapshot of client state for automated checks: `window.__derby.debug()`. */
  private debug() {
    return {
      mySlot: this.mySlot,
      roomCode: this.roomCode,
      epoch: this.epoch,
      joined: this.joined,
      roster: this.roster,
      rttMs: Math.round(this.conn.rttMs),
      seq: this.seq,
      snapshotsReceived: this.snapshotsReceived,
      interpSize: this.interp.size,
      stale: this.interp.stale,
      fps: this.fps,
      poses: this.lastPoses.map((p) => ({
        slot: p.slot,
        x: p.state.pos.x,
        y: p.state.pos.y,
        z: p.state.pos.z,
        speed: vlen(p.state.linvel),
        extrapolated: p.extrapolated,
      })),
    };
  }
}
```

- [ ] **Step 7: Replace `src/client/main.ts` with menu / game / sandbox routing**

```ts
import { normalizeRoomCode } from '../shared/protocol';
import { webglAvailable } from './game/capabilities';
import { GameClient } from './game/gameClient';
import { startSandbox } from './game/sandbox';
import { createGameScene, type GameScene } from './game/scene';
import { serverUrl } from './net/connection';
import { createHud } from './ui/hud';
import { PALETTE, showMenu, type JoinChoice } from './ui/menu';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hudEl = document.getElementById('hud') as HTMLElement;
const ui = document.getElementById('ui') as HTMLElement;

/** ?auto=quick | create | join:CODE (+ &name= &color=<palette index>) skips the menu — for links and automated checks. */
function automaticChoice(params: URLSearchParams): JoinChoice | null {
  const auto = params.get('auto');
  if (!auto) return null;
  const name = params.get('name') ?? 'Guest';
  const color = PALETTE[Math.abs(Number(params.get('color') ?? 0)) % PALETTE.length] ?? PALETTE[0]!;
  if (auto === 'quick' || auto === 'create') return { name, color, mode: auto };
  if (auto.startsWith('join:')) {
    const code = normalizeRoomCode(auto.slice(5));
    if (code) return { name, color, mode: 'join', code };
  }
  return null;
}

/** Slow orbit around the arena behind the menu. Returns a function that stops it. */
function startBackdrop(gs: GameScene): () => void {
  let raf = 0;
  let t = 0;
  let running = true;
  const frame = (): void => {
    if (!running) return;
    t += 0.003;
    gs.camera.position.set(Math.cos(t) * 46, 20, Math.sin(t) * 46);
    gs.camera.lookAt(0, 1, 0);
    gs.resize();
    gs.render();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    running = false;
    cancelAnimationFrame(raf);
  };
}

function play(gs: GameScene, choice: JoinChoice): Promise<string | undefined> {
  return new Promise((resolve) => {
    const url = serverUrl(location, import.meta.env.VITE_WS_URL as string | undefined);
    new GameClient({ gs, hud: createHud(ui), choice, url, onExit: resolve }).start();
  });
}

async function boot(): Promise<void> {
  if (!webglAvailable()) {
    hudEl.textContent =
      'WebGL 2 is not available in this browser. Try a current Chrome, Edge, Firefox or Safari with hardware acceleration enabled.';
    return;
  }
  const params = new URLSearchParams(location.search);
  try {
    if (params.has('sandbox')) {
      await startSandbox(canvas, hudEl);
      return;
    }
    hudEl.textContent = '';
    const gs = createGameScene(canvas);
    const initialCode = params.get('room') ?? undefined;
    let auto = automaticChoice(params);
    let error: string | undefined;
    for (;;) {
      const stopBackdrop = startBackdrop(gs);
      const choice = auto ?? (await showMenu(ui, { initialCode, error }));
      auto = null;
      stopBackdrop();
      ui.replaceChildren();
      error = await play(gs, choice); // resolves when the game ends; loop back to the menu with the reason
    }
  } catch (err) {
    console.error(err);
    hudEl.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
  }
}

void boot();
```

- [ ] **Step 8: Write `scripts/bot.ts`**

```ts
// Headless bot for manual multiplayer testing (no browser needed).
//   npx tsx scripts/bot.ts [--url ws://localhost:8080/ws] [--mode quick|create|join] [--code ABCD] [--name Bot] [--seconds 120]
import { WebSocket, type RawData } from 'ws';
import { NET } from '../src/shared/constants';
import { decodeSnapshot, encodeInput, parseServerMessage, type JoinMode } from '../src/shared/protocol';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  return value ?? fallback;
}

const url = arg('url', 'ws://localhost:8080/ws');
const mode = arg('mode', 'quick') as JoinMode;
const code = arg('code', '');
const name = arg('name', 'Bot');
const seconds = Number(arg('seconds', '120'));

const toBytes = (d: RawData): Uint8Array =>
  Array.isArray(d)
    ? new Uint8Array(Buffer.concat(d))
    : d instanceof ArrayBuffer
      ? new Uint8Array(d)
      : new Uint8Array(d.buffer, d.byteOffset, d.byteLength);

const ws = new WebSocket(url);
let seq = 0;
let mySlot = -1;
let epoch = -1;
let lastPos = { x: 0, z: 0 };
let lastCheck = Date.now();
let reverseUntil = 0;
const startedAt = Date.now();

/** If the car has barely moved for 1.5 s (stuck on a wall), back out for 1.5 s. */
function trackProgress(pos: { x: number; z: number }): void {
  const now = Date.now();
  if (now - lastCheck < 1500) return;
  if (Math.hypot(pos.x - lastPos.x, pos.z - lastPos.z) < 1.5 && now > reverseUntil) reverseUntil = now + 1500;
  lastPos = { x: pos.x, z: pos.z };
  lastCheck = now;
}

ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'hello', v: NET.PROTOCOL_VERSION, name, color: 0x18b5b5, mode, code: code || undefined }));
});

ws.on('message', (data: RawData, isBinary: boolean) => {
  if (isBinary) {
    const s = decodeSnapshot(toBytes(data));
    if (s && s.epoch === epoch) {
      const me = s.cars.find((c) => c.slot === mySlot);
      if (me) trackProgress(me.state.pos);
    }
    return;
  }
  const msg = parseServerMessage(new TextDecoder().decode(toBytes(data)));
  if (!msg) return;
  if (msg.t === 'welcome') {
    mySlot = msg.you;
    epoch = msg.epoch;
    console.log(`joined ${msg.room.public ? 'public' : 'private'} room ${msg.room.code} as slot ${mySlot}`);
  } else if (msg.t === 'roster') {
    epoch = msg.epoch;
    console.log(`roster (epoch ${msg.epoch}): ${msg.players.map((p) => p.name).join(', ')}`);
  } else if (msg.t === 'error') {
    console.log(`server error: ${msg.message}`);
  }
});

setInterval(() => {
  if (mySlot < 0 || ws.readyState !== WebSocket.OPEN) return;
  const elapsed = (Date.now() - startedAt) / 1000;
  let throttle = 0.8;
  let steer = Math.sin(elapsed * 0.6) * 0.8;
  if (Date.now() < reverseUntil) {
    throttle = -1;
    steer = -steer;
  }
  seq = (seq + 1) >>> 0;
  ws.send(encodeInput(seq, { throttle, steer, handbrake: false }));
}, 16);

ws.on('close', () => process.exit(0));
ws.on('error', (err) => {
  console.error(`connection error: ${err.message}`);
  process.exit(1);
});
setTimeout(() => {
  ws.close();
  process.exit(0);
}, seconds * 1000);
```

- [ ] **Step 9: Type-check, run everything, build**

Run: `npm run typecheck && npm test && npm run build && npm run smoke`
Expected: type-check clean; all tests pass; build succeeds; smoke prints two `OK` lines.

- [ ] **Step 10: Verify in the browser with the bot as the second driver**

```bash
npm run dev                                                    # terminal 1: server :8080 + client :5173
npx tsx scripts/bot.ts --mode quick --name Bot --seconds 300   # terminal 2 (or run in the background)
```

The bot should print `joined public room XXXX as slot 0`. Open `http://localhost:5173/?auto=quick&name=Tester` in the in-app browser (foreground tab — hidden tabs pause `requestAnimationFrame`). After ~3 s run in the page:

```js
await new Promise((r) => setTimeout(r, 3000));
const d1 = window.__derby.debug();
console.log(JSON.stringify(d1));
await new Promise((r) => setTimeout(r, 2000));
const d2 = window.__derby.debug();
const before = d1.poses.find((p) => p.slot !== d1.mySlot);
const after = d2.poses.find((p) => p.slot !== d2.mySlot);
console.log('bot moved (m):', Math.hypot(after.x - before.x, after.z - before.z));
```

Expected: `joined: true`; `roster` has two players (`Tester`, `Bot`); `poses` has two entries; `snapshotsReceived` climbs by ~30 per second; `rttMs` small (< 50 locally); `interpSize` ≥ 3; the bot moved more than 3 m in 2 s; no console errors. Then drive your own car:

```js
window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
await new Promise((r) => setTimeout(r, 2500));
console.log('my speed (m/s):', window.__derby.debug().poses.find((p) => p.slot === window.__derby.debug().mySlot).speed);   // expect > 5
window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
```

Take a screenshot showing both cars, the HUD (room code, player list, stats line), the chase camera and the floating `Bot` name tag above the other car (your own car has none). Then check the menu: open `http://localhost:5173/`, confirm the menu renders over the orbiting arena (name box, colour swatches, Quick Play / Create / Join), click **Create private room**, and confirm the HUD shows `Private room XXXX` with a *Copy invite link* button. Finally join that code from a second tab with `http://localhost:5173/?auto=join:XXXX&name=Second` (or `?room=XXXX` to see the pre-filled box). Stop the dev servers and the bot afterwards.

- [ ] **Step 11: Extend the README and commit**

Append to `README.md`:

```markdown
## Playing

- `npm run dev`, then open http://localhost:5173/ — pick a name and colour, then **Quick Play** or **Create private room**. Share the 4-letter code (or the *Copy invite link* button) with friends.
- Skip the menu with URL parameters: `?auto=quick`, `?auto=create` or `?auto=join:ABCD`, plus `&name=Tester&color=2`. `?room=ABCD` pre-fills the join box. `?sandbox` opens the offline driving sandbox.
- No friends around? `npx tsx scripts/bot.ts --mode quick --name Bot` joins the same public room and drives around (`--mode join --code ABCD` for a private room).
- Play across your network: `npm run build && npm start`, then open `http://<your-LAN-IP>:8080/` on each device.
- Server configuration (environment variables): `PORT` (8080), `ALLOWED_ORIGINS` (comma-separated exact origins; default: same host only), `MAX_ROOMS` (12), `MAX_CONNECTIONS` (200), `STATIC_DIR` (`dist/client`).
- Debugging: `window.__derby.debug()` in the browser console prints the connection, roster and interpolated poses.
```

Commit (only if the user opted in to commits):

```bash
git add -A
git commit -m "feat(client): menu, HUD and interpolated multiplayer game client; bot script"
```

---

## Plan 2 done when

- [ ] `npm run typecheck`, `npm test`, `npm run build` and `npm run smoke` all pass.
- [ ] Task 12 Step 10 checks pass in a real browser: two cars visible, the bot's movement streamed at ~30 Hz, your own car drivable, menu and private-room flow working, no console errors.
- [ ] **The user has played it** — ideally two browser windows, or one window plus the bot — and confirmed the baseline is good enough to build on.

**Known limits of this baseline (by design, each addressed by a later plan):** every join or leave resets the arena (rounds replace this); your own car is shown 100 ms + RTT behind your input because there is no client-side prediction yet (Plan 3); cars can collide but take no damage and nobody wins (Plan 4: combat, rounds, server-side bots); no dents, particles or audio (Plan 5); no Dockerfile, rate-limit tuning or load test yet (Plan 6); deployment needs the user's go-ahead (M7).

**Next plans** (written after this baseline is verified, against the code as it then stands): Plan 3 — client prediction and rollback re-simulation with a latency simulator and cross-runtime determinism check; Plan 4 — damage, rounds, scoring, bots; Plan 5 — destruction visuals and audio; Plan 6 — polish and packaging.

