import { describe, expect, it } from 'vitest';
import { KeyboardInput, SteerRamp, isEditableTarget, mapGamepad, type GamepadLike } from '../../src/client/game/input';

describe('SteerRamp', () => {
  it('ramps toward the target at the attack rate', () => {
    const r = new SteerRamp(5, 8);
    expect(r.step(1, 0.1)).toBeCloseTo(0.5, 6);
    expect(r.step(1, 0.1)).toBeCloseTo(1, 6);
  });

  it('returns to centre at the release rate', () => {
    const r = new SteerRamp(5, 8);
    r.value = 1;
    expect(r.step(0, 0.05)).toBeCloseTo(0.6, 6);
  });

  it('counter-steers faster than it steers', () => {
    const r = new SteerRamp(5, 8);
    r.value = 1;
    expect(r.step(-1, 0.1)).toBeCloseTo(0, 6); // 10 units/s for 0.1 s
  });

  it('treats NaN as neutral and ignores bad dt', () => {
    const r = new SteerRamp(5, 8);
    r.value = 0.5;
    expect(r.step(NaN, 0)).toBe(0.5);
    expect(r.step(1, -1)).toBe(0.5);
    expect(r.step(1, NaN)).toBe(0.5);
  });
});

const pad = (axes: number[], buttons: Array<{ value: number; pressed: boolean }>): GamepadLike => ({ axes, buttons });
const btn = (value: number) => ({ value, pressed: value > 0.5 });

describe('mapGamepad', () => {
  it('returns null when the pad is idle or missing', () => {
    expect(mapGamepad(null)).toBeNull();
    expect(mapGamepad(pad([0, 0], []))).toBeNull();
    expect(mapGamepad(pad([0.05, 0], []))).toBeNull(); // inside the dead zone
  });

  it('maps stick, triggers and face buttons', () => {
    const buttons = Array.from({ length: 8 }, () => btn(0));
    buttons[7] = btn(1); // right trigger
    const p = mapGamepad(pad([1, 0], buttons))!;
    expect(p.steer).toBeCloseTo(1, 6);
    expect(p.throttle).toBe(1);
    expect(p.handbrake).toBe(false);
    buttons[7] = btn(0);
    buttons[6] = btn(1); // left trigger = reverse/brake
    buttons[0] = btn(1); // A = handbrake
    const q = mapGamepad(pad([-1, 0], buttons))!;
    expect(q.steer).toBeCloseTo(-1, 6);
    expect(q.throttle).toBe(-1);
    expect(q.handbrake).toBe(true);
  });

  it('treats NaN axes as centred', () => {
    expect(mapGamepad(pad([NaN, NaN], []))).toBeNull();
  });

  it('ignores a resting trigger that reports a small non-zero value', () => {
    const buttons = Array.from({ length: 8 }, () => btn(0));
    buttons[7] = { value: 0.03, pressed: false }; // worn triggers rest at 0.01-0.05
    expect(mapGamepad(pad([0, 0], buttons))).toBeNull();
    buttons[7] = { value: 0.06, pressed: false }; // just outside the dead zone
    expect(mapGamepad(pad([0, 0], buttons))?.throttle).toBeCloseTo(0.06, 6);
  });
});

/** Builds a key event; `props` shadows read-only fields such as `target` the way a real dispatch would set them. */
function keyEvent(type: 'keydown' | 'keyup', code: string, props: Record<string, unknown> = {}): Event {
  const e = Object.assign(new Event(type, { cancelable: true }), { code });
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v, configurable: true });
  return e;
}

describe('KeyboardInput', () => {
  it('maps W/S to throttle and cancels out when both are held', () => {
    const target = new EventTarget();
    const kb = new KeyboardInput(target, () => null);
    target.dispatchEvent(keyEvent('keydown', 'KeyW'));
    expect(kb.sample(1 / 60).throttle).toBe(1);
    target.dispatchEvent(keyEvent('keydown', 'KeyS'));
    expect(kb.sample(1 / 60).throttle).toBe(0);
    target.dispatchEvent(keyEvent('keyup', 'KeyW'));
    expect(kb.sample(1 / 60).throttle).toBe(-1);
    kb.dispose();
  });

  it('ramps steering and returns to centre', () => {
    const target = new EventTarget();
    const kb = new KeyboardInput(target, () => null);
    target.dispatchEvent(keyEvent('keydown', 'KeyD'));
    let s = 0;
    for (let i = 0; i < 20; i++) s = kb.sample(1 / 60).steer;
    expect(s).toBeGreaterThan(0.99);
    target.dispatchEvent(keyEvent('keyup', 'KeyD'));
    for (let i = 0; i < 20; i++) s = kb.sample(1 / 60).steer;
    expect(s).toBeCloseTo(0, 6);
    kb.dispose();
  });

  it('clears held keys on blur so a backgrounded tab cannot leave the throttle stuck', () => {
    const target = new EventTarget();
    const kb = new KeyboardInput(target, () => null);
    target.dispatchEvent(keyEvent('keydown', 'ArrowUp'));
    target.dispatchEvent(keyEvent('keydown', 'Space'));
    expect(kb.sample(1 / 60)).toMatchObject({ throttle: 1, handbrake: true });
    target.dispatchEvent(new Event('blur'));
    expect(kb.sample(1 / 60)).toMatchObject({ throttle: 0, handbrake: false });
    kb.dispose();
  });

  it('prevents page scrolling for arrow keys and space', () => {
    const target = new EventTarget();
    const kb = new KeyboardInput(target, () => null);
    const e = keyEvent('keydown', 'ArrowDown');
    target.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    kb.dispose();
  });

  it('says which keys are held right now, and forgets them on release and on blur', () => {
    const target = new EventTarget();
    const kb = new KeyboardInput(target, () => null);
    expect(kb.isDown('Tab')).toBe(false);
    target.dispatchEvent(keyEvent('keydown', 'Tab'));
    expect(kb.isDown('Tab')).toBe(true);
    target.dispatchEvent(keyEvent('keyup', 'Tab'));
    expect(kb.isDown('Tab')).toBe(false);
    target.dispatchEvent(keyEvent('keydown', 'Tab'));
    target.dispatchEvent(new Event('blur'));
    expect(kb.isDown('Tab')).toBe(false);
    kb.dispose();
  });

  it('keeps the browser from moving focus on Tab or opening find on F3', () => {
    const target = new EventTarget();
    const kb = new KeyboardInput(target, () => null);
    for (const code of ['Tab', 'F3']) {
      const e = keyEvent('keydown', code);
      target.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    }
    kb.dispose();
  });

  it('lets an active gamepad override the keyboard', () => {
    const target = new EventTarget();
    const buttons = Array.from({ length: 8 }, () => btn(0));
    buttons[7] = btn(1);
    const kb = new KeyboardInput(target, () => pad([0, 0], buttons));
    expect(kb.sample(1 / 60).throttle).toBe(1);
    kb.dispose();
  });

  it('lets the keyboard drive when the pad only reports a resting trigger', () => {
    const target = new EventTarget();
    const buttons = Array.from({ length: 8 }, () => btn(0));
    buttons[7] = { value: 0.03, pressed: false };
    const kb = new KeyboardInput(target, () => pad([0, 0], buttons));
    target.dispatchEvent(keyEvent('keydown', 'KeyW'));
    expect(kb.sample(1 / 60).throttle).toBe(1);
    kb.dispose();
  });
});

describe('KeyboardInput gamepad bumpers', () => {
  const held = (...pressed: number[]): GamepadLike => pad([0, 0], Array.from({ length: 8 }, (_, i) => btn(pressed.includes(i) ? 1 : 0)));

  it('reports each bumper press once: the right bumper is the next car, the left one the previous', () => {
    let current: GamepadLike | null = held();
    const kb = new KeyboardInput(new EventTarget(), () => current);
    expect(kb.padCycle()).toBe(0);
    current = held(5);
    expect(kb.padCycle()).toBe(1);
    expect(kb.padCycle()).toBe(0); // still held
    current = held();
    expect(kb.padCycle()).toBe(0);
    current = held(4);
    expect(kb.padCycle()).toBe(-1);
    current = held(4, 5); // both at once: the right one wins, and neither repeats
    expect(kb.padCycle()).toBe(1);
    expect(kb.padCycle()).toBe(0);
    current = null; // unplugged
    expect(kb.padCycle()).toBe(0);
    current = held(5);
    expect(kb.padCycle()).toBe(1); // a press after being unplugged counts again
    kb.dispose();
  });

  it('does not steer or accelerate when only a bumper is pressed', () => {
    const kb = new KeyboardInput(new EventTarget(), () => held(4, 5));
    expect(kb.sample(1 / 60)).toEqual({ throttle: 0, steer: 0, handbrake: false });
    kb.dispose();
  });
});

describe('isEditableTarget', () => {
  const el = (props: Record<string, unknown>): EventTarget => props as unknown as EventTarget;

  it('recognises text-entry elements only', () => {
    expect(isEditableTarget(el({ tagName: 'INPUT' }))).toBe(true);
    expect(isEditableTarget(el({ tagName: 'textarea' }))).toBe(true);
    expect(isEditableTarget(el({ tagName: 'SELECT' }))).toBe(true);
    expect(isEditableTarget(el({ tagName: 'DIV', isContentEditable: true }))).toBe(true);
    expect(isEditableTarget(el({ tagName: 'BUTTON' }))).toBe(false);
    expect(isEditableTarget(el({ tagName: 'CANVAS' }))).toBe(false);
    expect(isEditableTarget(new EventTarget())).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

// The sandbox's lil-gui panel stops keydown/keyup from bubbling, and any click leaves focus inside it.
describe('KeyboardInput with the tuning panel focused', () => {
  const field = { tagName: 'INPUT' };

  it('listens in the capture phase so a panel that stops propagation cannot hide key events', () => {
    const registered: Array<[string, boolean]> = [];
    const fake = {
      addEventListener: (type: string, _listener: unknown, options?: boolean | AddEventListenerOptions) => {
        registered.push([type, typeof options === 'object' ? options.capture === true : options === true]);
      },
      removeEventListener: () => undefined,
    } as unknown as EventTarget;
    const kb = new KeyboardInput(fake, () => null);
    expect(registered.filter(([type]) => type === 'keydown' || type === 'keyup')).toEqual([
      ['keydown', true],
      ['keyup', true],
    ]);
    kb.dispose();
  });

  it('detaches every listener it attached', () => {
    const target = new EventTarget();
    const kb = new KeyboardInput(target, () => null);
    kb.dispose();
    target.dispatchEvent(keyEvent('keydown', 'KeyW'));
    expect(kb.sample(1 / 60).throttle).toBe(0);
  });

  it('ignores game keys typed into an input field', () => {
    const target = new EventTarget();
    const kb = new KeyboardInput(target, () => null);
    target.dispatchEvent(keyEvent('keydown', 'KeyW', { target: field }));
    target.dispatchEvent(keyEvent('keydown', 'KeyD', { target: field }));
    expect(kb.sample(1 / 60)).toMatchObject({ throttle: 0, steer: 0 });
    kb.dispose();
  });

  it('always honours a key release, even one that comes from an input field', () => {
    const target = new EventTarget();
    const kb = new KeyboardInput(target, () => null);
    target.dispatchEvent(keyEvent('keydown', 'KeyW'));
    target.dispatchEvent(keyEvent('keyup', 'KeyW', { target: field }));
    expect(kb.sample(1 / 60).throttle).toBe(0);
    kb.dispose();
  });

  it('ignores keys pressed with ctrl or alt, and drops held keys when cmd goes down', () => {
    const target = new EventTarget();
    const kb = new KeyboardInput(target, () => null);
    target.dispatchEvent(keyEvent('keydown', 'KeyW', { ctrlKey: true }));
    target.dispatchEvent(keyEvent('keydown', 'KeyW', { altKey: true }));
    expect(kb.sample(1 / 60).throttle).toBe(0);
    target.dispatchEvent(keyEvent('keydown', 'KeyW'));
    expect(kb.sample(1 / 60).throttle).toBe(1);
    target.dispatchEvent(keyEvent('keydown', 'MetaLeft', { metaKey: true })); // macOS then swallows the key-ups
    expect(kb.sample(1 / 60).throttle).toBe(0);
    kb.dispose();
  });

  it('reports each physical key press once to the onPress callback', () => {
    const target = new EventTarget();
    const pressed: string[] = [];
    const kb = new KeyboardInput(target, () => null, (code) => pressed.push(code));
    target.dispatchEvent(keyEvent('keydown', 'KeyR'));
    target.dispatchEvent(keyEvent('keydown', 'KeyR', { repeat: true }));
    target.dispatchEvent(keyEvent('keydown', 'KeyR', { target: field }));
    target.dispatchEvent(keyEvent('keydown', 'KeyR', { metaKey: true }));
    target.dispatchEvent(keyEvent('keydown', 'KeyR', { ctrlKey: true }));
    expect(pressed).toEqual(['KeyR']);
    kb.dispose();
  });
});
