import type { CarInput } from './input';
import { Simulation } from './sim';

/**
 * A fixed, collision-prone driving script: integer arithmetic only, so it is identical on every JavaScript engine.
 * Used to compare the simulation bit for bit between Node and browsers.
 */
export function scriptedInput(slot: number, tick: number): CarInput {
  // First 5 s: full throttle straight at the arena centre, so the cars meet (spawns face the centre). Then a mixed
  // pattern of throttle, coasting, reverse, weaving and handbrake that keeps them colliding with each other and the wall.
  const phase = (tick + slot * 37) % 240;
  const throttle = tick < 300 ? 1 : phase < 170 ? 1 : phase < 200 ? 0 : -1;
  const wave = (tick * (slot + 2) + slot * 11) % 120;
  const steer = tick < 300 ? 0 : (wave < 60 ? wave : 120 - wave) / 30 - 1; // triangle wave in [-1, 1]
  const handbrake = tick >= 300 && (tick + slot * 53) % 300 > 280;
  return { throttle, steer, handbrake };
}

export interface ScriptedRun {
  /** 8 hex digits: FNV-1a over the exact bits of every car's state at every tick. */
  hash: string;
  /** Smallest centre-to-centre distance between two cars during the run (m). */
  closestApproach: number;
  topSpeed: number;
}

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

/** Runs the script for `ticks` steps (Rapier must be initialised) and hashes every car's full state each tick. */
export function runScripted(ticks = 600, slots: readonly number[] = [0, 1, 2]): ScriptedRun {
  const sim = new Simulation(slots);
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    f64[0] = v === 0 ? 0 : v; // fold -0 into 0: engines agree on values, and this keeps the hash about the state
    for (let i = 0; i < 2; i++) {
      h ^= u32[i]!;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  let closest = Infinity;
  let top = 0;
  try {
    for (let t = 0; t < ticks; t++) {
      for (const slot of sim.slots) sim.setInput(slot, scriptedInput(slot, t));
      sim.step();
      const states = sim.slots.map((slot) => sim.getState(slot));
      for (const s of states) {
        mix(s.pos.x); mix(s.pos.y); mix(s.pos.z);
        mix(s.quat.x); mix(s.quat.y); mix(s.quat.z); mix(s.quat.w);
        mix(s.linvel.x); mix(s.linvel.y); mix(s.linvel.z);
        mix(s.angvel.x); mix(s.angvel.y); mix(s.angvel.z);
        top = Math.max(top, Math.hypot(s.linvel.x, s.linvel.z));
      }
      for (let i = 0; i < states.length; i++) {
        for (let j = i + 1; j < states.length; j++) {
          closest = Math.min(closest, Math.hypot(states[i]!.pos.x - states[j]!.pos.x, states[i]!.pos.z - states[j]!.pos.z));
        }
      }
    }
  } finally {
    sim.dispose();
  }
  return { hash: h.toString(16).padStart(8, '0'), closestApproach: closest, topSpeed: top };
}

export const simHash = (ticks = 600, slots: readonly number[] = [0, 1, 2]): string => runScripted(ticks, slots).hash;
