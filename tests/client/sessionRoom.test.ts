import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ClientSession } from '../../src/client/net/session';
import { quantizeInput, type CarInput } from '../../src/shared/input';
import { initPhysics } from '../../src/shared/physics';
import { decodeSnapshot } from '../../src/shared/protocol';
import { Simulation } from '../../src/shared/sim';
import { Player } from '../../src/server/player';
import { Room } from '../../src/server/room';
import { FakeSocket } from '../helpers/fakeSocket';

beforeAll(async () => {
  await initPhysics();
});

const rooms: Room[] = [];
const sessions: ClientSession[] = [];
afterEach(() => {
  while (rooms.length) rooms.pop()!.dispose();
  while (sessions.length) sessions.pop()!.dispose();
});

const straight: CarInput = { throttle: 1, steer: 0, handbrake: false };
const swerve: CarInput = { throttle: 0.5, steer: -0.5, handbrake: false };

describe('a client that gives up prediction in the middle of a game', () => {
  it('keeps numbering its inputs after the server-visible ones, so the server keeps consuming them', () => {
    const room = new Room('FALL', true, () => undefined, { botFill: 0, rules: { countdownTicks: 2, liveTicks: 400, resultsTicks: 30 } });
    rooms.push(room);
    const socket = new FakeSocket();
    const me = new Player(1, socket);
    room.addPlayer(me);
    room.addPlayer(new Player(2, new FakeSocket()));

    let canBuildWorlds = true;
    const session = new ClientSession('predict', {
      world: {
        predictor: {
          createSimulation: (slots) => {
            if (!canBuildWorlds) throw new Error('out of memory');
            return new Simulation(slots);
          },
        },
      },
    });
    sessions.push(session);
    session.onWelcome(me.slot, room.epoch);

    let read = 0;
    let input = straight;
    const tick = (k: number): void => {
      const sent = quantizeInput(input); // the wire carries quantized inputs, and so does the prediction
      me.pushInput(session.nextInput(sent), sent); // a zero-latency link, client first
      room.step();
      while (read < socket.sent.length) {
        const frame = socket.sent[read++]!;
        if (typeof frame === 'string') {
          const msg = JSON.parse(frame) as { t: string; epoch?: number };
          if (msg.t === 'roster') session.onRoster(msg.epoch!, (msg as { you?: number }).you ?? -1);
          else if (msg.t === 'phase') session.onPhase((msg as { phase?: 'countdown' | 'live' | 'results' }).phase!);
        } else {
          const snapshot = decodeSnapshot(frame);
          if (snapshot) session.onSnapshot(snapshot, k * (1000 / 60));
        }
      }
    };

    let k = 0;
    for (; k < 300; k++) tick(k); // five seconds of ordinary prediction
    expect(session.mode).toBe('predict');
    expect(session.snapshotsReceived).toBeGreaterThan(100);
    expect(me.ackSeq).toBe(300);

    // A third player joins and watches; when the next round starts the world has three cars, which this client cannot build.
    canBuildWorlds = false;
    room.addPlayer(new Player(3, new FakeSocket()));
    for (let i = 0; i < 300 && session.mode === 'predict'; i++, k++) tick(k);
    expect(session.mode).toBe('interp');
    const ackedAtFallback = me.ackSeq;

    // Four more seconds, now steering differently: the server must still be hearing every input.
    input = swerve;
    for (let i = 0; i < 240; i++, k++) tick(k);
    expect(me.ackSeq).toBe(ackedAtFallback + 240);
    expect(me.ackSeq).toBe(session.inputSequence);
    expect(me.lastInput).toEqual(quantizeInput(swerve));
    expect(session.interpolator.size).toBeGreaterThan(0); // and it is drawing the server's world instead
  });
});
