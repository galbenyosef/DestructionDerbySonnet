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
