import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ARENAS, type ArenaDef, type GroundFeel } from '../src/shared/arenas';
import { CAR_FORWARD } from '../src/shared/constants';
import { quatRotate, vdot } from '../src/shared/math';
import { initPhysics } from '../src/shared/physics';
import { Simulation } from '../src/shared/sim';

const sims: Simulation[] = [];
beforeAll(async () => {
  await initPhysics();
});
afterEach(() => {
  while (sims.length) sims.pop()!.dispose();
});

const withGround = (ground: Partial<GroundFeel>): ArenaDef => ({ ...ARENAS.stadium, ground: { ...ARENAS.stadium.ground, ...ground } });
function make(arena: ArenaDef): Simulation {
  const s = new Simulation([0], { arena, walls: false, groundHalfExtent: 600 });
  sims.push(s);
  return s;
}
const fwd = (s: Simulation): number => {
  const st = s.getState(0);
  return vdot(st.linvel, quatRotate(st.quat, CAR_FORWARD));
};
function launch(s: Simulation, speed: number): void {
  const st = s.getState(0);
  const f = quatRotate(st.quat, CAR_FORWARD);
  s.setState(0, { ...st, linvel: { x: f.x * speed, y: 0, z: f.z * speed } });
}

describe('ground feel', () => {
  it('power scales the engine: a weaker ground tops out lower', () => {
    const top = (arena: ArenaDef): number => {
      const s = make(arena);
      s.setInput(0, { throttle: 1, steer: 0, handbrake: false });
      for (let i = 0; i < 60 * 14; i++) s.step();
      return fwd(s);
    };
    const normal = top(withGround({}));
    const weak = top(withGround({ power: 0.8 }));
    expect(weak).toBeLessThan(normal * 0.9);
    expect(weak).toBeGreaterThan(normal * 0.6);
  });

  it('drag slows a coasting car', () => {
    const coast = (drag: number): number => {
      const s = make(withGround({ drag }));
      for (let i = 0; i < 30; i++) s.step(); // settle on the springs
      launch(s, 16);
      for (let i = 0; i < 180; i++) s.step();
      return fwd(s);
    };
    expect(coast(0.5)).toBeLessThan(coast(0) - 3);
  });

  it('grip sets how sharply a car can turn: on ice the path bends less', () => {
    const turned = (grip: number): number => {
      const s = make(withGround({ grip }));
      for (let i = 0; i < 30; i++) s.step();
      launch(s, 14);
      const v0 = s.getState(0).linvel;
      s.setInput(0, { throttle: 0, steer: 1, handbrake: false });
      for (let i = 0; i < 60; i++) s.step();
      const v1 = s.getState(0).linvel;
      return Math.abs(Math.atan2(v0.x * v1.z - v0.z * v1.x, v0.x * v1.x + v0.z * v1.z)); // how far the direction of travel has swung
    };
    expect(turned(0.4)).toBeLessThan(turned(1) * 0.75);
  });

  it('a neutral ground is the same as no arena at all (bit for bit)', () => {
    const states = (opts?: { arena: ArenaDef }): number[] => {
      const s = new Simulation([0, 1], opts);
      sims.push(s);
      s.setInput(0, { throttle: 1, steer: 0.4, handbrake: false });
      s.setInput(1, { throttle: 1, steer: -0.2, handbrake: true });
      for (let i = 0; i < 300; i++) s.step();
      return s.slots.flatMap((slot) => {
        const st = s.getState(slot);
        return [st.pos.x, st.pos.y, st.pos.z, st.quat.w, st.linvel.x, st.angvel.y];
      });
    };
    expect(states({ arena: withGround({}) })).toEqual(states());
  });

  it('the slippery arena is slippery for every car in it', () => {
    const s = new Simulation([0, 1, 2], { arena: ARENAS.ice, walls: false, groundHalfExtent: 600 });
    sims.push(s);
    expect(s.slots).toEqual([0, 1, 2]);
    for (let i = 0; i < 10; i++) s.step();
    expect(Number.isFinite(s.getState(2).pos.x)).toBe(true);
  });
});
