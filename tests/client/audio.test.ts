import { describe, expect, it } from 'vitest';
import { AudioEngine, type EngineCar, type Listener } from '../../src/client/game/audio';
import { FakeContext, engineWith } from '../helpers/fakeAudio';
import { CountdownBeeper, crashVoice, distanceGain, engineVoice, stereoPan } from '../../src/client/game/audioParams';

const still: Listener = { pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 } };
const car = (slot: number, over: Partial<EngineCar> = {}): EngineCar => ({ slot, pos: { x: 5, y: 0, z: 0 }, speed: 10, throttle: 1, alive: true, ...over });

describe('engineVoice', () => {
  it('rises with speed and with the driver\'s foot, within limits', () => {
    expect(engineVoice(20, 0).frequency).toBeGreaterThan(engineVoice(5, 0).frequency);
    expect(engineVoice(10, 1).frequency).toBeGreaterThan(engineVoice(10, 0).frequency);
    expect(engineVoice(10, 1).cutoff).toBeGreaterThan(engineVoice(10, 0).cutoff);
    expect(engineVoice(10, 1).gain).toBeGreaterThan(engineVoice(10, 0).gain);
    for (const [s, t] of [[1000, 5], [-30, -9], [0, 0]] as const) {
      const v = engineVoice(s, t);
      expect(v.frequency).toBeGreaterThanOrEqual(45);
      expect(v.frequency).toBeLessThanOrEqual(260);
      expect(v.gain).toBeLessThanOrEqual(0.3);
    }
  });

  it('copes with broken numbers', () => {
    const v = engineVoice(Number.NaN, Number.POSITIVE_INFINITY);
    for (const n of [v.frequency, v.gain, v.cutoff]) expect(Number.isFinite(n)).toBe(true);
  });
});

describe('distanceGain and stereoPan', () => {
  it('fade a sound with distance, to nothing far away', () => {
    expect(distanceGain(0)).toBe(1);
    expect(distanceGain(15)).toBeCloseTo(0.5, 9);
    expect(distanceGain(60)).toBeLessThan(distanceGain(30));
    expect(distanceGain(120)).toBe(0);
    expect(distanceGain(Number.NaN)).toBe(0);
  });

  it('put a sound left or right by which side it is on, never past the edge', () => {
    expect(stereoPan(0)).toBe(0);
    expect(stereoPan(8)).toBeCloseTo(0.5, 9);
    expect(stereoPan(-8)).toBeCloseTo(-0.5, 9);
    expect(Math.abs(stereoPan(1e9))).toBeLessThanOrEqual(1);
    expect(stereoPan(Number.NaN)).toBe(0);
  });
});

describe('crashVoice', () => {
  it('makes a bigger crash louder, longer and lower', () => {
    const small = crashVoice(3);
    const big = crashVoice(25);
    expect(big.gain).toBeGreaterThan(small.gain);
    expect(big.seconds).toBeGreaterThan(small.seconds);
    expect(big.thumpHz).toBeLessThan(small.thumpHz);
    expect(crashVoice(1000)).toEqual(big);
    expect(crashVoice(Number.NaN).gain).toBeCloseTo(0.15, 9);
  });
});

describe('CountdownBeeper', () => {
  it('beeps for the last three seconds of the countdown and again when the round goes live, once each', () => {
    const b = new CountdownBeeper();
    const seen: Array<string | null> = [];
    for (const [phase, clock] of [['countdown', '5'], ['countdown', '5'], ['countdown', '4'], ['countdown', '3'], ['countdown', '3'], ['countdown', '2'], ['countdown', '1'], ['live', '1:30'], ['live', '1:29']] as const) {
      seen.push(b.next({ phase, clock }));
    }
    expect(seen).toEqual([null, null, null, 'count', null, 'count', 'count', 'go', null]);
  });

  it('starts over for the next round, and does not go off for a player who joins while it is live', () => {
    const b = new CountdownBeeper();
    expect(b.next({ phase: 'live', clock: '1:00' })).toBeNull();
    expect(b.next({ phase: 'results', clock: '8' })).toBeNull();
    expect(b.next({ phase: 'countdown', clock: '3' })).toBe('count');
    expect(b.next({ phase: null, clock: '' })).toBeNull();
    expect(b.next({ phase: 'countdown', clock: '3' })).toBe('count'); // a restarted countdown beeps again
  });
});

describe('AudioEngine', () => {
  it('does nothing, and does not fail, until it is unlocked', () => {
    const ctx = new FakeContext();
    const audio = engineWith(ctx);
    audio.update(still, [car(0)]);
    audio.crash(20, { x: 1, y: 0, z: 0 }, still);
    audio.horn();
    audio.beep('go');
    expect(ctx.nodes).toHaveLength(0);
    expect(audio.ready).toBe(false);
  });

  it('creates its audio context once, from the first gesture, and wakes it up', () => {
    let made = 0;
    const ctx = new FakeContext();
    const audio = new AudioEngine((() => {
      made++;
      return ctx;
    }) as unknown as () => AudioContext);
    audio.unlock();
    audio.unlock();
    expect(made).toBe(1);
    expect(ctx.resumed).toBeGreaterThanOrEqual(1);
    expect(ctx.state).toBe('running');
    expect(audio.ready).toBe(true);
  });

  it('keeps one engine per running car, tuned to it, and none for a wreck', () => {
    const ctx = new FakeContext();
    const audio = engineWith(ctx);
    audio.unlock();
    const before = ctx.nodes.length;
    audio.update(still, [car(0), car(1, { alive: false }), car(2, { speed: 20 })]);
    expect(ctx.nodes.length - before).toBe(2 * 5); // two engines: two oscillators, a filter, a gain and a panner
    audio.update(still, [car(0), car(2, { speed: 20 })]);
    expect(ctx.nodes.length - before).toBe(2 * 5); // nothing new for cars that already sound
    const oscillators = ctx.nodes.filter((n) => n.started > 0 && n.frequency.targets.length > 0);
    const want = engineVoice(10, 1).frequency;
    expect(oscillators.some((n) => Math.abs(n.frequency.value - want) < 1e-9)).toBe(true);
  });

  it('stops the engine of a car that has gone', () => {
    const ctx = new FakeContext();
    const audio = engineWith(ctx);
    audio.unlock();
    audio.update(still, [car(0), car(1)]);
    const started = ctx.nodes.filter((n) => n.started > 0);
    expect(started).toHaveLength(4);
    audio.update(still, [car(0)]);
    expect(started.filter((n) => n.stopped > 0)).toHaveLength(2);
    expect(ctx.nodes.filter((n) => n.disconnected > 0)).toHaveLength(1); // the panner of the car that left
  });

  it('puts a car on the right of the listener in the right ear, and a far one lower', () => {
    const ctx = new FakeContext();
    const audio = engineWith(ctx);
    audio.unlock();
    audio.update(still, [car(0, { pos: { x: 0, y: 0, z: 12 } }), car(1, { pos: { x: 0, y: 0, z: -12 } }), car(2, { pos: { x: 0, y: 0, z: 90 } })]);
    const pans = ctx.nodes.filter((n) => n.pan.targets.length > 0).map((n) => n.pan.value);
    expect(pans[0]!).toBeGreaterThan(0);
    expect(pans[1]!).toBeLessThan(0);
    const gains = ctx.nodes.filter((n) => n.gain.targets.length > 0).map((n) => n.gain.value);
    expect(gains[2]!).toBeLessThan(gains[0]!);
  });

  it('scales the master level with the volume setting, before and after it is unlocked, and keeps mute in charge', () => {
    const ctx = new FakeContext();
    const audio = engineWith(ctx);
    audio.setVolume(0.5); // set before there is a context: applied when it is made
    audio.unlock();
    const master = ctx.nodes[0]!;
    const full = master.gain.value * 2;
    expect(full).toBeGreaterThan(0.3);
    audio.setVolume(0.25);
    expect(master.gain.value).toBeCloseTo(full * 0.25, 9);
    audio.setMuted(true);
    expect(master.gain.value).toBe(0);
    audio.setVolume(1);
    expect(master.gain.value).toBe(0); // still muted
    audio.setMuted(false);
    expect(master.gain.value).toBeCloseTo(full, 9);
    audio.setVolume(Number.NaN);
    audio.setVolume(7);
    expect(master.gain.value).toBeCloseTo(full, 9); // clamped to 1
    audio.setVolume(-1);
    expect(master.gain.value).toBe(0);
  });

  it('mutes and unmutes', () => {
    const ctx = new FakeContext();
    const audio = engineWith(ctx);
    audio.unlock();
    const master = ctx.nodes[0]!;
    expect(master.gain.value).toBeGreaterThan(0);
    audio.setMuted(true);
    expect([audio.muted, master.gain.value]).toEqual([true, 0]);
    audio.setMuted(false);
    expect(master.gain.value).toBeGreaterThan(0);
  });

  it('plays a crash near, and skips one too far away to hear', () => {
    const ctx = new FakeContext();
    const audio = engineWith(ctx);
    audio.unlock();
    const before = ctx.nodes.length;
    audio.crash(20, { x: 4, y: 0, z: 0 }, still);
    const added = ctx.nodes.slice(before);
    expect(added.length).toBeGreaterThan(4);
    expect(added.filter((n) => n.started > 0 && n.stopped > 0).length).toBeGreaterThanOrEqual(2); // the noise burst and the thump both end
    const after = ctx.nodes.length;
    audio.crash(20, { x: 500, y: 0, z: 0 }, still);
    expect(ctx.nodes.length).toBe(after);
  });

  it('plays a horn and the countdown beeps, each ending by itself', () => {
    const ctx = new FakeContext();
    const audio = engineWith(ctx);
    audio.unlock();
    const before = ctx.nodes.length;
    audio.horn();
    audio.beep('count');
    audio.beep('go');
    const oscillators = ctx.nodes.slice(before).filter((n) => n.started > 0);
    expect(oscillators.length).toBe(4); // two horn notes, two beeps
    expect(oscillators.every((n) => n.stopped > 0)).toBe(true);
  });

  it('stays silent, without failing, when there is no Web Audio, or it fails to start', () => {
    for (const make of [null, () => { throw new Error('blocked'); }] as const) {
      const audio = engineWith(make as never);
      audio.unlock();
      audio.update(still, [car(0)]);
      audio.crash(10, { x: 1, y: 0, z: 0 }, still);
      audio.setMuted(true);
      audio.dispose();
      expect(audio.ready).toBe(false);
    }
  });

  it('closes the audio context when it is disposed', () => {
    const ctx = new FakeContext();
    const audio = engineWith(ctx);
    audio.unlock();
    audio.update(still, [car(0)]);
    audio.dispose();
    expect(ctx.closed).toBe(1);
    expect(audio.ready).toBe(false);
  });
});
