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
const TRIGGER_DEAD_ZONE = 0.05; // worn triggers rest at 0.01-0.05 and must not count as "the pad is in use"
const finite = (v: number | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Standard mapping: left stick X steers, RT drives, LT brakes/reverses, A or B is the handbrake. */
export function mapGamepad(pad: GamepadLike | null): CarInput | null {
  if (!pad) return null;
  const ax = finite(pad.axes[0]);
  const steer = Math.abs(ax) < DEAD_ZONE ? 0 : (ax - Math.sign(ax) * DEAD_ZONE) / (1 - DEAD_ZONE);
  const triggers = clamp(finite(pad.buttons[7]?.value) - finite(pad.buttons[6]?.value), -1, 1);
  const throttle = Math.abs(triggers) < TRIGGER_DEAD_ZONE ? 0 : triggers;
  const handbrake = (pad.buttons[0]?.pressed ?? false) || (pad.buttons[1]?.pressed ?? false);
  if (steer === 0 && throttle === 0 && !handbrake) return null; // idle: let the keyboard win
  return { throttle, steer: clamp(steer, -1, 1), handbrake };
}

const defaultGamepadReader: GamepadReader = () => {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
  for (const pad of navigator.getGamepads()) if (pad && pad.connected) return pad;
  return null;
};

const PREVENT_DEFAULT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab', 'F3']);

/** True for elements the player types into (the tuning panel's number fields); game keys must not fire there. */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

export class KeyboardInput {
  private readonly keys = new Set<string>();
  private readonly ramp = new SteerRamp();
  private bumpers = { left: false, right: false };
  private readonly onKeyDown = (e: Event): void => {
    const ev = e as KeyboardEvent;
    if (isEditableTarget(ev.target)) return;
    if (ev.metaKey) {
      this.keys.clear(); // macOS swallows the key-up of anything pressed while cmd is held
      return;
    }
    if (ev.ctrlKey || ev.altKey) return;
    if (PREVENT_DEFAULT.has(ev.code)) ev.preventDefault();
    this.keys.add(ev.code);
    if (!ev.repeat) this.onPress?.(ev.code);
  };
  /** Unconditional: a release must always register, wherever focus is. */
  private readonly onKeyUp = (e: Event): void => {
    this.keys.delete((e as KeyboardEvent).code);
  };
  private readonly onBlur = (): void => {
    this.keys.clear();
  };

  /**
   * Key listeners run in the capture phase: the sandbox's lil-gui panel stops key events from bubbling and any
   * click leaves focus inside it, so bubble-phase listeners would miss releases (stuck throttle) or presses.
   * `onPress` fires once per physical press (not for auto-repeat, typing in a field, or modifier combos).
   */
  constructor(
    private readonly target: EventTarget = window,
    private readonly readPad: GamepadReader = defaultGamepadReader,
    private readonly onPress?: (code: string) => void,
  ) {
    target.addEventListener('keydown', this.onKeyDown, { capture: true });
    target.addEventListener('keyup', this.onKeyUp, { capture: true });
    target.addEventListener('blur', this.onBlur);
  }

  /** True while the key with this `KeyboardEvent.code` is held (the scoreboard shows while Tab is down). */
  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /**
   * The gamepad's way of switching the car you watch: -1 for a press of the left bumper, 1 for the right one, 0 otherwise.
   * Reports each press once; call it every frame so a bumper held from earlier does not count as a new press.
   */
  padCycle(): 1 | -1 | 0 {
    const pad = this.readPad();
    const left = pad?.buttons[4]?.pressed ?? false;
    const right = pad?.buttons[5]?.pressed ?? false;
    const direction = right && !this.bumpers.right ? 1 : left && !this.bumpers.left ? -1 : 0;
    this.bumpers = { left, right };
    return direction;
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
    this.target.removeEventListener('keydown', this.onKeyDown, { capture: true });
    this.target.removeEventListener('keyup', this.onKeyUp, { capture: true });
    this.target.removeEventListener('blur', this.onBlur);
  }
}
