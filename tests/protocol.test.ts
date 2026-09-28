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
