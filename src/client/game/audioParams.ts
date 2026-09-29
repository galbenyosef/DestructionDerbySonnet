import { clamp } from '../../shared/math';
import type { Phase } from '../../shared/protocol';

/** What one car's engine sounds like, from how fast it goes and how hard its driver is on the throttle. */
export function engineVoice(speed: number, throttle: number): { frequency: number; gain: number; cutoff: number } {
  const v = Number.isFinite(speed) ? clamp(Math.abs(speed), 0, 30) : 0;
  const t = Number.isFinite(throttle) ? clamp(throttle, -1, 1) : 0;
  const push = Math.max(t, 0);
  return {
    frequency: clamp(55 + v * 5.2 + push * 18, 45, 260),
    gain: clamp(0.05 + 0.11 * Math.abs(t) + 0.05 * (v / 20), 0, 0.3),
    cutoff: 380 + v * 60 + push * 500,
  };
}

/** How loud a sound is at `distance` metres from the listener: full close by, gone at 120 m. */
export function distanceGain(distance: number): number {
  if (!Number.isFinite(distance) || distance >= 120) return 0;
  const d = Math.max(0, distance) / 15;
  return 1 / (1 + d * d);
}

/** Left-right position of a sound, -1 (left) to 1 (right), from how far to the listener's right it is. */
export function stereoPan(right: number): number {
  if (!Number.isFinite(right)) return 0;
  return clamp(right / (Math.abs(right) + 8), -1, 1);
}

/** A crash: how loud, how low the thump, how long and how bright the noise, from the impulse in kN·s. */
export function crashVoice(kns: number): { gain: number; thumpHz: number; seconds: number; noiseGain: number } {
  const k = Number.isFinite(kns) ? clamp(kns / 25, 0, 1) : 0;
  return { gain: 0.15 + 0.85 * k, thumpHz: 90 - 45 * k, seconds: 0.18 + 0.5 * k, noiseGain: 0.3 + 0.7 * k };
}

export type Beep = 'count' | 'go';

/**
 * Says when a countdown beep is due: `count` each time the number of seconds shown changes during the countdown, `go` when
 * the round goes live. Feed it what the match screen shows every frame.
 */
export class CountdownBeeper {
  private lastPhase: Phase | null = null;
  private lastSecond = -1;

  next(view: { phase: Phase | null; clock: string }): Beep | null {
    const phase = view.phase;
    let beep: Beep | null = null;
    if (phase === 'countdown') {
      const second = Number.parseInt(view.clock, 10);
      if (Number.isFinite(second) && second !== this.lastSecond && second <= 3) beep = 'count';
      if (Number.isFinite(second)) this.lastSecond = second;
    } else {
      this.lastSecond = -1;
      if (phase === 'live' && this.lastPhase === 'countdown') beep = 'go';
    }
    this.lastPhase = phase;
    return beep;
  }
}
