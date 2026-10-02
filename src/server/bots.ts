import { boundsClearance, DEFAULT_ARENA, type ArenaDef } from '../shared/arenas';
import { CAR_FORWARD, COMBAT } from '../shared/constants';
import { NEUTRAL_INPUT, type CarInput } from '../shared/input';
import { clamp, quatRotate } from '../shared/math';
import { mulberry32 } from '../shared/random';
import type { CarState } from '../shared/types';

export const BOT_NAMES = ['Rusty', 'Dent', 'Scrap', 'Torque', 'Clunker', 'Rivet', 'Gasket', 'Piston'] as const;
export const BOT_COLORS = [0x8a8f98, 0x6d9c5a, 0xc9a227, 0x7b5ea7, 0x3fa7a3, 0xb5651d, 0x9c4a4a, 0x4b6eaf] as const;

export interface BotTarget {
  slot: number;
  state: CarState;
  hp: number;
}

/** What a bot may look at: its own body and every other car that is still running. */
export interface BotView {
  state: CarState;
  targets: readonly BotTarget[];
}

/** Ticks between looking for a better target, how long stuck before backing out, and how long to back out. */
const RETARGET_TICKS = 45;
const STUCK_TICKS = 60;
const REVERSE_TICKS = 75;
const WOBBLE_TICKS = 20;
/** A bot turns away when the playable area's edge is closer than this (m), at its own place or at the look-ahead point. */
const WALL_MARGIN = 4;
const UP: { x: number; y: number; z: number } = { x: 0, y: 1, z: 0 };

/** Unit vector on the ground plane (falls back to +X). */
function flat(x: number, z: number): { x: number; z: number } {
  const len = Math.hypot(x, z);
  return len < 1e-6 ? { x: 1, z: 0 } : { x: x / len, z: z / len };
}

/**
 * The driver behind a server-side bot. It produces the same kind of input a player's keyboard does, once per tick:
 * chase the nearest or weakest car with a lead on its motion, keep away from the wall, back out when stuck. A per-bot
 * skill adds steering noise, aim error and a little caution so bots are beatable. Everything random comes from the
 * seed, so a bot is repeatable in tests. Server-only: never part of the shared simulation.
 */
export class BotBrain {
  readonly skill: number;
  private readonly random: () => number;
  private tick = 0;
  private targetSlot = -1;
  private retargetAt = 0;
  private aimOffset = 0;
  private wobble = 0;
  private wobbleAt = 0;
  private stuck = 0;
  private reversing = 0;
  private reverseSteer = 1;

  /** `arena` tells the bot where its walls are (the Stadium's by default). */
  constructor(seed: number, skill?: number, private readonly arena: ArenaDef = DEFAULT_ARENA) {
    this.random = mulberry32(seed);
    this.skill = clamp(skill ?? 0.6 + this.random() * 0.35, 0, 1);
  }

  /** Slot of the car this bot is currently after (-1: none). */
  get target(): number {
    return this.targetSlot;
  }

  think(view: BotView): CarInput {
    this.tick++;
    const { pos, quat, linvel } = view.state;
    const forward = quatRotate(quat, CAR_FORWARD);
    const f = flat(forward.x, forward.z);
    const speed = linvel.x * f.x + linvel.z * f.z;
    if (quatRotate(quat, UP).y < 0.3) return { ...NEUTRAL_INPUT }; // on its side or roof: nothing to do but wait

    if (this.reversing > 0) {
      this.reversing--;
      return { throttle: -1, steer: this.reverseSteer, handbrake: false };
    }

    const target = this.chooseTarget(view);
    if (this.tick >= this.wobbleAt) {
      this.wobble = (this.random() - 0.5) * 2 * (1 - this.skill) * 0.5;
      this.wobbleAt = this.tick + WOBBLE_TICKS;
    }

    let steer = 0;
    let throttle = 0;
    if (target) {
      const tp = target.state.pos;
      const dist = Math.hypot(tp.x - pos.x, tp.z - pos.z);
      const lead = clamp(dist / Math.max(6, speed + 6), 0, 1.2);
      const side = { x: -f.z, z: f.x }; // to the car's right
      const aimX = tp.x + target.state.linvel.x * lead + side.x * this.aimOffset;
      const aimZ = tp.z + target.state.linvel.z * lead + side.z * this.aimOffset;
      const dx = aimX - pos.x;
      const dz = aimZ - pos.z;
      const angle = Math.atan2(dx * side.x + dz * side.z, dx * f.x + dz * f.z); // + = target is to the right
      steer = clamp(angle * 1.8, -1, 1);
      const cap = 0.75 + 0.25 * this.skill;
      throttle = cap * clamp(1.4 - Math.abs(angle) * 0.6, 0.35, 1);
      if (dist < 8 && Math.abs(angle) < 0.5) throttle = 1; // close and lined up: ram
    }
    steer = clamp(steer + this.wobble, -1, 1);

    // keep off the wall: when the road ahead runs out, turn toward the middle and ease off
    const look = 5 + Math.max(0, speed) * 0.6;
    const margin = WALL_MARGIN;
    const here = boundsClearance(this.arena.bounds, pos.x, pos.z);
    if (here < margin || boundsClearance(this.arena.bounds, pos.x + f.x * look, pos.z + f.z * look) < margin) {
      const side = { x: -f.z, z: f.x };
      const toCentre = Math.atan2(-pos.x * side.x - pos.z * side.z, -pos.x * f.x - pos.z * f.z);
      steer = clamp(toCentre * 2, -1, 1);
      throttle = Math.min(throttle || 0.5, here < margin - 2 ? 0.5 : 0.7);
    }

    // stuck: pushing without getting anywhere for a second, so back out turning the other way
    if (Math.abs(speed) < 1 && Math.abs(throttle) > 0.3) this.stuck++;
    else this.stuck = Math.max(0, this.stuck - 2);
    if (this.stuck > STUCK_TICKS) {
      this.stuck = 0;
      this.reversing = REVERSE_TICKS;
      this.reverseSteer = steer >= 0 ? -1 : 1;
    }
    return { throttle, steer, handbrake: false };
  }

  private chooseTarget(view: BotView): BotTarget | null {
    const current = view.targets.find((t) => t.slot === this.targetSlot);
    if (current && this.tick < this.retargetAt) return current;
    const { pos } = view.state;
    let best: BotTarget | null = null;
    let bestScore = Infinity;
    for (const t of view.targets) {
      const dist = Math.hypot(t.state.pos.x - pos.x, t.state.pos.z - pos.z);
      // nearest, but a hurt car looks closer than it is; a little noise keeps a pack from choosing the same victim
      const score = dist * (0.6 + (0.4 * t.hp) / COMBAT.MAX_HP) * (0.85 + 0.3 * this.random());
      if (score < bestScore) {
        best = t;
        bestScore = score;
      }
    }
    this.targetSlot = best ? best.slot : -1;
    this.retargetAt = this.tick + RETARGET_TICKS + Math.floor(this.random() * 30);
    this.aimOffset = (this.random() - 0.5) * 2 * (1 - this.skill) * 4;
    return best;
  }
}
