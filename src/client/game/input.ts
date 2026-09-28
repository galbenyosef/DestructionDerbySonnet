import type { CarInput } from '../../shared/input';
import { clamp } from '../../shared/math';

/** Smooths digital steering so keyboard players get an analogue-like ramp. */
export class SteerRamp {
  value = 0;

  constructor(
    private readonly attack = 5,
    private readonly release = 8,
  ) {}

  step(target: number, dt: number): number {
    const t = clamp(Number.isFinite(target) ? target : 0, -1, 1);
    const d = Number.isFinite(dt) ? Math.max(dt, 0) : 0;
    let rate = this.attack;
    if (t === 0) rate = this.release;
    else if (this.value !== 0 && Math.sign(t) !== Math.sign(this.value)) rate = this.attack * 2; // counter-steer faster
    const maxStep = rate * d;
    this.value += clamp(t - this.value, -maxStep, maxStep);
    return this.value;
  }
}

export interface GamepadLike {
  readonly axes: readonly number[];
  readonly buttons: ReadonlyArray<{ readonly value: number; readonly pressed: boolean }>;
}
export type GamepadReader = () => GamepadLike | null;

const DEAD_ZONE = 0.12;
const finite = (v: number | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Standard mapping: left stick X steers, RT drives, LT brakes/reverses, A or B is the handbrake. */
export function mapGamepad(pad: GamepadLike | null): CarInput | null {
  if (!pad) return null;
  const ax = finite(pad.axes[0]);
  const steer = Math.abs(ax) < DEAD_ZONE ? 0 : (ax - Math.sign(ax) * DEAD_ZONE) / (1 - DEAD_ZONE);
  const throttle = clamp(finite(pad.buttons[7]?.value) - finite(pad.buttons[6]?.value), -1, 1);
  const handbrake = (pad.buttons[0]?.pressed ?? false) || (pad.buttons[1]?.pressed ?? false);
  if (steer === 0 && throttle === 0 && !handbrake) return null; // idle: let the keyboard win
  return { throttle, steer: clamp(steer, -1, 1), handbrake };
}

const defaultGamepadReader: GamepadReader = () => {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
  for (const pad of navigator.getGamepads()) if (pad && pad.connected) return pad;
  return null;
};

const PREVENT_DEFAULT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export class KeyboardInput {
  private readonly keys = new Set<string>();
  private readonly ramp = new SteerRamp();
  private readonly onKeyDown = (e: Event): void => {
    const code = (e as KeyboardEvent).code;
    if (PREVENT_DEFAULT.has(code)) e.preventDefault();
    this.keys.add(code);
  };
  private readonly onKeyUp = (e: Event): void => {
    this.keys.delete((e as KeyboardEvent).code);
  };
  private readonly onBlur = (): void => {
    this.keys.clear();
  };

  constructor(
    private readonly target: EventTarget = window,
    private readonly readPad: GamepadReader = defaultGamepadReader,
  ) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  /** Samples the current input; advances the steering ramp by `dt` seconds. */
  sample(dt: number): CarInput {
    const k = this.keys;
    const up = k.has('KeyW') || k.has('ArrowUp');
    const down = k.has('KeyS') || k.has('ArrowDown');
    const left = k.has('KeyA') || k.has('ArrowLeft');
    const right = k.has('KeyD') || k.has('ArrowRight');
    const steer = this.ramp.step((right ? 1 : 0) - (left ? 1 : 0), dt);
    const keyboard: CarInput = { throttle: (up ? 1 : 0) - (down ? 1 : 0), steer, handbrake: k.has('Space') };
    return mapGamepad(this.readPad()) ?? keyboard;
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}
