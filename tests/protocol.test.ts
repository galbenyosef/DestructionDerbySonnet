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

  it('accepts a vote for each arena and nothing else', () => {
    for (const arena of ['stadium', 'ice', 'quarry', 'port']) {
      expect(parseClientMessage(JSON.stringify({ t: 'vote', arena }))).toEqual({ t: 'vote', arena });
    }
    for (const bad of [undefined, '', 'Ice', 'moon', 3, null, {}, ['ice'], '__proto__', 'constructor']) {
      expect(parseClientMessage(JSON.stringify({ t: 'vote', arena: bad }))).toBeNull();
    }
    expect(parseClientMessage(JSON.stringify({ t: 'vote' }))).toBeNull();
  });

  it('rejects oversize payloads', () => {
    expect(parseClientMessage(JSON.stringify({ ...hello, name: 'x'.repeat(NET.MAX_PAYLOAD_BYTES) }))).toBeNull();
  });
});

describe('parseServerMessage', () => {
  const phase = { t: 'phase', phase: 'live', round: 2, remainingMs: 12_500 };
  const hit = { t: 'hit', tick: 500, victim: 1, attacker: -1, dmg: 12.4, hp: 61.2, zone: 'rear', j: 14.8, p: [-2.3, 0, 0.4] };
  const welcome = {
    t: 'welcome', v: NET.PROTOCOL_VERSION, you: 2, epoch: 3, tickRate: 60, snapshotEvery: 2,
    room: { code: 'ABCD', public: true, capacity: 8 },
    players: [{ slot: 2, name: 'Max', color: 255 }, { slot: 3, name: 'Rusty', color: 1, bot: true }],
    arena: 'ice', votes: { stadium: 0, ice: 2, quarry: 1, port: 0 },
    phase,
    scores: [{ slot: 2, score: 120, kills: 1 }],
    dents: [hit],
  };
  const ko = { t: 'ko', tick: 900, victim: 3, killer: 1, assists: [0, 2], reason: 'damage' };
  const row = { slot: 1, name: 'Max', color: 255, bot: false, score: 320, gained: 220, kills: 2, damage: 170.5, hp: 44, alive: true };
  const results = { t: 'results', round: 2, winner: 1, reason: 'last', rows: [row] };

  it('accepts well-formed server messages', () => {
    expect(parseServerMessage(JSON.stringify(welcome))).toEqual(welcome);
    expect(parseServerMessage(JSON.stringify({ ...welcome, you: -1, phase: null, scores: [] }))).toMatchObject({ you: -1, phase: null });
    const roster = { t: 'roster', epoch: 1, round: 4, you: -1, arena: 'port', players: [] };
    expect(parseServerMessage(JSON.stringify(roster))).toEqual(roster);
    expect(parseServerMessage(JSON.stringify({ t: 'pong', id: 1, c: 2, tick: 3 }))).toEqual({ t: 'pong', id: 1, c: 2, tick: 3 });
    expect(parseServerMessage(JSON.stringify({ t: 'error', code: 'room_full', message: 'full' }))).toEqual({ t: 'error', code: 'room_full', message: 'full' });
  });

  it('accepts a welcome whose hit log is empty or as long as it may be', () => {
    expect(parseServerMessage(JSON.stringify({ ...welcome, dents: [] }))).toMatchObject({ dents: [] });
    const full = Array.from({ length: NET.MAX_HIT_LOG }, (_, i) => ({ ...hit, tick: i }));
    expect(parseServerMessage(JSON.stringify({ ...welcome, dents: full }))).toMatchObject({ dents: full });
  });

  it('accepts the vote tally, and refuses one that is not a count per arena', () => {
    const votes = { t: 'votes', counts: { stadium: 1, ice: 2, quarry: 0, port: 3 } };
    expect(parseServerMessage(JSON.stringify(votes))).toEqual(votes);
    for (const counts of [undefined, {}, { stadium: 1 }, { stadium: 1, ice: 2, quarry: 0, port: -1 }, { stadium: 1, ice: 2, quarry: 0, port: 9 }, { stadium: 'a', ice: 0, quarry: 0, port: 0 }, [1, 2, 3, 4]]) {
      expect(parseServerMessage(JSON.stringify({ t: 'votes', counts }))).toBeNull();
    }
  });

  it('speaks protocol version 4', () => {
    expect(NET.PROTOCOL_VERSION).toBe(4);
  });

  it('accepts the match messages: phase, hit, ko, scores and results', () => {
    expect(parseServerMessage(JSON.stringify(phase))).toEqual(phase);
    expect(parseServerMessage(JSON.stringify(hit))).toEqual(hit);
    expect(parseServerMessage(JSON.stringify(ko))).toEqual(ko);
    const scores = { t: 'scores', rows: [{ slot: 0, score: 10, kills: 0 }, { slot: 5, score: 260.5, kills: 3 }] };
    expect(parseServerMessage(JSON.stringify(scores))).toEqual(scores);
    expect(parseServerMessage(JSON.stringify(results))).toEqual(results);
    expect(parseServerMessage(JSON.stringify({ ...results, winner: -1, reason: 'draw' }))).toMatchObject({ winner: -1, reason: 'draw' });
  });

  it('rejects malformed server messages', () => {
    for (const raw of [
      'nope',
      '{}',
      JSON.stringify({ t: 'welcome' }),
      JSON.stringify({ ...welcome, you: 'x' }),
      JSON.stringify({ ...welcome, you: 8 }),
      JSON.stringify({ ...welcome, phase: { ...phase, phase: 'warmup' } }),
      JSON.stringify({ ...welcome, phase: undefined }),
      JSON.stringify({ ...welcome, scores: [{ slot: 9, score: 1, kills: 0 }] }),
      JSON.stringify({ ...hit, hp: -3 }),
      JSON.stringify({ ...welcome, players: [{ slot: 1, name: 'x', color: 1, bot: 'yes' }] }),
      JSON.stringify({ ...welcome, dents: undefined }), // a welcome always carries the hit log, empty or not
      JSON.stringify({ ...welcome, dents: [{ ...hit, zone: 'roof' }] }),
      JSON.stringify({ ...welcome, dents: [{ t: 'ko' }] }),
      JSON.stringify({ ...welcome, dents: Array.from({ length: NET.MAX_HIT_LOG + 1 }, () => hit) }),
      JSON.stringify({ t: 'roster', epoch: 1, round: 1, you: 0, arena: 'ice', players: [{ slot: 'a' }] }),
      JSON.stringify({ t: 'roster', epoch: 1, players: [] }), // no round / you
      JSON.stringify({ t: 'roster', epoch: 1, round: 4, you: -1, players: [] }), // no arena
      JSON.stringify({ t: 'roster', epoch: 1, round: 4, you: -1, arena: 'moon', players: [] }),
      JSON.stringify({ ...welcome, arena: undefined }),
      JSON.stringify({ ...welcome, arena: 'moon' }),
      JSON.stringify({ ...welcome, votes: undefined }),
      JSON.stringify({ ...welcome, votes: { stadium: 0, ice: 0, quarry: 0 } }),
      JSON.stringify({ ...welcome, votes: { stadium: 0, ice: -1, quarry: 0, port: 0 } }),
      JSON.stringify({ ...welcome, votes: { stadium: 0, ice: 9, quarry: 0, port: 0 } }), // more votes than seats
      JSON.stringify({ ...welcome, votes: { stadium: 0, ice: 1.5, quarry: 0, port: 0 } }),
      JSON.stringify({ t: 'pong', id: 1 }),
      JSON.stringify({ t: 'error', code: 5, message: 'x' }),
    ]) {
      expect(parseServerMessage(raw)).toBeNull();
    }
  });

  it('rejects malformed match messages, including values a real server never sends', () => {
    for (const bad of [
      { ...phase, phase: 'warmup' },
      { ...phase, remainingMs: -1 },
      { ...phase, remainingMs: Number.NaN },
      { ...phase, round: 1.5 },
      { ...hit, zone: 'roof' },
      { ...hit, victim: -1 }, // the victim is always a car
      { ...hit, attacker: 8 },
      { ...hit, dmg: -3 },
      { ...hit, p: [1, 2] },
      { ...hit, p: [1, 2, 'x'] },
      { ...ko, reason: 'boredom' },
      { ...ko, assists: [9] },
      { ...ko, assists: Array.from({ length: 9 }, (_, i) => i % 8) },
      { ...ko, killer: -2 },
      { t: 'scores', rows: 'lots' },
      { t: 'scores', rows: [{ slot: 0, score: 'a', kills: 0 }] },
      { ...results, winner: 8 },
      { ...results, reason: 'quit' },
      { ...results, rows: [{ ...row, alive: 'yes' }] },
      { ...results, rows: Array.from({ length: 9 }, () => row) },
    ]) {
      expect(parseServerMessage(JSON.stringify(bad))).toBeNull();
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
