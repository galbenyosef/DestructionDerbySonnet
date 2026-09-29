import { quatRotate, vlen, vsub } from '../../shared/math';
import type { Quat, Vec3 } from '../../shared/types';
import { crashVoice, distanceGain, engineVoice, stereoPan, type Beep } from './audioParams';

/** Where the player is listening from (the car they drive or watch). */
export interface Listener {
  pos: Vec3;
  quat: Quat;
}

/** What an engine needs to know about one car each frame. */
export interface EngineCar {
  slot: number;
  pos: Vec3;
  speed: number;
  throttle: number;
  alive: boolean;
}

const MASTER_LEVEL = 0.55;
const SMOOTHING = 0.06; // seconds: the time constant of every parameter change, so nothing clicks

interface Voice {
  low: OscillatorNode;
  high: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode;
}

const browserContext = (): AudioContext | null => (typeof AudioContext === 'undefined' ? null : new AudioContext());

/**
 * All the sound of the game, synthesised: an engine per car (pitch from speed and throttle, quieter and panned by where the car
 * is), crashes (a noise burst and a thump, by the size of the impact), the horn and the countdown beeps. There are no sound files.
 * Browsers only allow sound after a gesture, so nothing exists until `unlock()` is called from one; without Web Audio it does nothing.
 */
export class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly voices = new Map<number, Voice>();
  private silenced = false;

  constructor(private readonly makeContext: () => AudioContext | null = browserContext) {}

  /** Creates the audio context (call it from a click or a key press) or wakes it up. Harmless to call again. */
  unlock(): void {
    if (!this.context) {
      try {
        this.context = this.makeContext();
      } catch {
        this.context = null;
      }
      const created = this.context;
      if (!created) return;
      this.master = created.createGain();
      this.master.gain.value = this.silenced ? 0 : MASTER_LEVEL;
      this.master.connect(created.destination);
      this.noise = created.createBuffer(1, Math.floor(created.sampleRate * 1), created.sampleRate);
      const samples = this.noise.getChannelData(0);
      let seed = 0x1234abcd;
      for (let i = 0; i < samples.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        samples[i] = (seed / 4294967296) * 2 - 1;
      }
    }
    const ctx = this.context;
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  }

  /** True once sound can actually play. */
  get ready(): boolean {
    return this.context !== null && this.context.state === 'running';
  }

  get muted(): boolean {
    return this.silenced;
  }

  setMuted(muted: boolean): void {
    this.silenced = muted;
    if (this.master && this.context) this.master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL, this.context.currentTime, 0.02);
  }

  /** Once per frame: keeps one engine per running car, tuned to its speed and throttle and placed by where it is. */
  update(listener: Listener, cars: readonly EngineCar[]): void {
    const ctx = this.context;
    if (!ctx || !this.master) return;
    const right = quatRotate(listener.quat, { x: 0, y: 0, z: 1 });
    const seen = new Set<number>();
    for (const car of cars) {
      if (!car.alive) continue; // a wreck is silent
      seen.add(car.slot);
      const offset = vsub(car.pos, listener.pos);
      const distance = vlen(offset);
      const voice = this.voices.get(car.slot) ?? this.addVoice(car.slot);
      const p = engineVoice(car.speed, car.throttle);
      const now = ctx.currentTime;
      voice.low.frequency.setTargetAtTime(p.frequency * 0.5, now, SMOOTHING);
      voice.high.frequency.setTargetAtTime(p.frequency, now, SMOOTHING);
      voice.filter.frequency.setTargetAtTime(p.cutoff, now, SMOOTHING);
      voice.gain.gain.setTargetAtTime(p.gain * distanceGain(distance), now, SMOOTHING);
      voice.pan.pan.setTargetAtTime(distance < 0.5 ? 0 : stereoPan(offset.x * right.x + offset.y * right.y + offset.z * right.z), now, SMOOTHING);
    }
    for (const slot of [...this.voices.keys()]) if (!seen.has(slot)) this.removeVoice(slot);
  }

  /** A crash of `kns` kN·s at `at`. */
  crash(kns: number, at: Vec3, listener: Listener): void {
    const ctx = this.context;
    if (!ctx || !this.master || !this.noise) return;
    const v = crashVoice(kns);
    const distance = vlen(vsub(at, listener.pos));
    const level = v.gain * distanceGain(distance);
    if (level < 0.01) return;
    const right = quatRotate(listener.quat, { x: 0, y: 0, z: 1 });
    const offset = vsub(at, listener.pos);
    const pan = ctx.createStereoPanner();
    pan.pan.value = distance < 0.5 ? 0 : stereoPan(offset.x * right.x + offset.y * right.y + offset.z * right.z);
    pan.connect(this.master);
    const now = ctx.currentTime;
    const burst = ctx.createBufferSource();
    burst.buffer = this.noise;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 900 + 3000 * (v.gain - 0.15);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(v.noiseGain * level, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + v.seconds);
    burst.connect(tone);
    tone.connect(noiseGain);
    noiseGain.connect(pan);
    burst.start(now);
    burst.stop(now + v.seconds + 0.05);
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(v.thumpHz, now);
    thump.frequency.exponentialRampToValueAtTime(28, now + 0.25);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(level, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    thump.connect(thumpGain);
    thumpGain.connect(pan);
    thump.start(now);
    thump.stop(now + 0.32);
    burst.onended = () => pan.disconnect();
  }

  /** Your own horn (other players cannot hear it: there is no horn on the wire). */
  horn(): void {
    const ctx = this.context;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.35, now + 0.03);
    gain.gain.setValueAtTime(0.35, now + 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    gain.connect(this.master);
    for (const hz of [392, 494]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = hz;
      o.connect(gain);
      o.start(now);
      o.stop(now + 0.52);
    }
  }

  beep(kind: Beep): void {
    const ctx = this.context;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const seconds = kind === 'go' ? 0.4 : 0.12;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = kind === 'go' ? 880 : 440;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + seconds);
    o.connect(gain);
    gain.connect(this.master);
    o.start(now);
    o.stop(now + seconds + 0.02);
  }

  dispose(): void {
    for (const slot of [...this.voices.keys()]) this.removeVoice(slot);
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.master = null;
    this.noise = null;
  }

  private addVoice(slot: number): Voice {
    const ctx = this.context!;
    const low = ctx.createOscillator();
    low.type = 'triangle';
    const high = ctx.createOscillator();
    high.type = 'sawtooth';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    low.connect(filter);
    high.connect(filter);
    filter.connect(gain);
    gain.connect(pan);
    pan.connect(this.master!);
    low.start();
    high.start();
    const voice = { low, high, filter, gain, pan };
    this.voices.set(slot, voice);
    return voice;
  }

  private removeVoice(slot: number): void {
    const voice = this.voices.get(slot);
    if (!voice) return;
    voice.low.stop();
    voice.high.stop();
    voice.pan.disconnect();
    this.voices.delete(slot);
  }
}
