import { describe, expect, it } from 'vitest';
import { KeyboardInput, SteerRamp, mapGamepad, type GamepadLike } from '../../src/client/game/input';

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
});

function keyEvent(type: 'keydown' | 'keyup', code: string): Event {
  return Object.assign(new Event(type, { cancelable: true }), { code });
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

  it('lets an active gamepad override the keyboard', () => {
    const target = new EventTarget();
    const buttons = Array.from({ length: 8 }, () => btn(0));
    buttons[7] = btn(1);
    const kb = new KeyboardInput(target, () => pad([0, 0], buttons));
    expect(kb.sample(1 / 60).throttle).toBe(1);
    kb.dispose();
  });
});
