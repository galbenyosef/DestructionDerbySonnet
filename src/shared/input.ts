import { clamp } from './math';

export interface CarInput {
  /** -1 (reverse/brake) .. 1 (forward). */
  throttle: number;
  /** -1 (left) .. 1 (right). */
  steer: number;
  handbrake: boolean;
}

export const NEUTRAL_INPUT: Readonly<CarInput> = { throttle: 0, steer: 0, handbrake: false };

export const FLAG_HANDBRAKE = 1;

/** Wire representation: two int8 and a flags byte. */
export interface PackedInput {
  throttle: number;
  steer: number;
  flags: number;
}

const q8 = (v: number): number => (Number.isFinite(v) ? Math.round(clamp(v, -1, 1) * 127) + 0 : 0);

export function packInput(i: CarInput): PackedInput {
  return { throttle: q8(i.throttle), steer: q8(i.steer), flags: i.handbrake ? FLAG_HANDBRAKE : 0 };
}

export function unpackInput(p: PackedInput): CarInput {
  return {
    throttle: p.throttle / 127,
    steer: p.steer / 127,
    handbrake: (p.flags & FLAG_HANDBRAKE) !== 0,
  };
}

/** Both sides quantize before applying an input so client prediction and the server see identical values. */
export const quantizeInput = (i: CarInput): CarInput => unpackInput(packInput(i));

/** True when sequence number `a` is newer than `b` (u32, wrap-aware). */
export const isNewerSeq = (a: number, b: number): boolean => ((a - b) | 0) > 0;
