import { COMBAT } from '../shared/constants';
import { classifyZone, hitDamage } from '../shared/damage';
import type { Contact } from '../shared/sim';
import type { Vec3, Zone } from '../shared/types';

/** One impact on one car, after its contact ticks were merged into a single event. */
export interface Hit {
  /** Simulation tick of the first contact of the impact. */
  tick: number;
  /** Slot of the car that was hit. */
  victim: number;
  /** Slot of the car that hit it, or -1 for a wall or obstacle. */
  attacker: number;
  /** True when that car was already out when the impact began: a wreck is an obstacle, priced like a wall and credited to nobody. */
  byWreck: boolean;
  /** Total impulse transmitted (kN·s), as the victim felt it. */
  impulse: number;
  zone: Zone;
  /** HP this impact takes off (zone and wall multipliers included), before capping at the victim's remaining HP. */
  damage: number;
  /** Impulse-weighted contact point in the victim's local frame. */
  point: Vec3;
}

interface Window {
  victim: number;
  attacker: number;
  wreck: boolean;
  openedAt: number;
  lastAt: number;
  /** Last tick that transmitted an impact-sized impulse (COMBAT.IMPACT_IMPULSE). */
  lastImpactAt: number;
  impulse: number; // N·s
  sx: number;
  sy: number;
  sz: number;
}

/**
 * Turns the per-tick contacts of a simulation into discrete hits. A collision spreads over a few ticks (and a slide along
 * a wall over many), so contacts between the same two bodies are merged into a window that closes after a short quiet
 * spell or a maximum length; damage is computed once per window from its total impulse. A window is opened only by a tick
 * that transmits an impact-sized impulse, and lighter ticks join it only in the few ticks after the last such tick (the
 * tail of the collision). So scraping and pushing never wear a car down, however many cars push in a line: a car pinned
 * against a wall by two others feels a steady half kN·s a tick, which is weight and engines, not a blow.
 */
export class HitTracker {
  private readonly windows = new Map<number, Window>();

  /**
   * Feed the contacts of one simulation step (ticks must increase); returns the hits whose window closed on this tick.
   * `isRunning` says whether a car is still in the round: a hit whose attacker was already out when it began is a wreck's.
   */
  update(tick: number, contacts: readonly Contact[], isRunning: (slot: number) => boolean = () => true): Hit[] {
    const hits: Hit[] = [];
    for (const c of contacts) {
      if (!(c.impulse >= COMBAT.SCRAPE_IMPULSE)) continue;
      this.add(tick, c.a, c.b, c.impulse, c.pointA, hits, isRunning);
      if (c.b >= 0) this.add(tick, c.b, c.a, c.impulse, c.pointB, hits, isRunning);
    }
    for (const [key, w] of this.windows) {
      if (tick - w.lastAt < COMBAT.WINDOW_GAP_TICKS) continue;
      this.windows.delete(key);
      this.close(w, hits);
    }
    return hits.sort((p, q) => p.victim - q.victim || p.attacker - q.attacker || p.tick - q.tick);
  }

  private add(tick: number, victim: number, attacker: number, impulse: number, point: Vec3, hits: Hit[], isRunning: (slot: number) => boolean): void {
    const key = victim * 16 + attacker + 1;
    const impact = impulse >= COMBAT.IMPACT_IMPULSE;
    let w = this.windows.get(key);
    if (w && tick - w.openedAt >= COMBAT.WINDOW_MAX_TICKS) {
      this.close(w, hits); // a window that has been open this long is paid out; an impact-sized contact starts the next one
      this.windows.delete(key);
      w = undefined;
    }
    if (!w) {
      if (!impact) return; // a shove or a scrape never starts a hit
      w = { victim, attacker, wreck: attacker >= 0 && !isRunning(attacker), openedAt: tick, lastAt: tick, lastImpactAt: tick, impulse: 0, sx: 0, sy: 0, sz: 0 };
      this.windows.set(key, w);
    } else if (impact) {
      w.lastImpactAt = tick;
    } else if (tick - w.lastImpactAt > COMBAT.IMPACT_TAIL_TICKS) {
      return; // the tail of a collision counts; a steady push long after it does not
    }
    w.lastAt = tick;
    w.impulse += impulse;
    w.sx += impulse * point.x;
    w.sy += impulse * point.y;
    w.sz += impulse * point.z;
  }

  private close(w: Window, hits: Hit[]): void {
    const kns = w.impulse / 1000;
    const point = { x: w.sx / w.impulse, y: w.sy / w.impulse, z: w.sz / w.impulse };
    const zone = classifyZone(point);
    const damage = hitDamage(kns, zone, w.attacker < 0 || w.wreck);
    if (damage > 0) hits.push({ tick: w.openedAt, victim: w.victim, attacker: w.attacker, byWreck: w.wreck, impulse: kns, zone, damage, point });
  }
}

/** Remembers who hit whom lately, to name a killer and the assisting cars when a car is eliminated. */
export class AttackLog {
  private readonly lastHit = new Map<number, Map<number, number>>();

  record(victim: number, attacker: number, tick: number): void {
    if (attacker < 0 || attacker === victim) return;
    let byAttacker = this.lastHit.get(victim);
    if (!byAttacker) {
      byAttacker = new Map();
      this.lastHit.set(victim, byAttacker);
    }
    byAttacker.set(attacker, tick);
  }

  /** The car that most recently hit `victim` within the assist window is the killer; the others in the window assist. */
  credit(victim: number, tick: number): { killer: number; assists: number[] } {
    const recent = [...(this.lastHit.get(victim) ?? [])]
      .filter(([, at]) => tick - at <= COMBAT.ASSIST_TICKS)
      .sort((p, q) => q[1] - p[1] || p[0] - q[0]);
    if (recent.length === 0) return { killer: -1, assists: [] };
    return { killer: recent[0]![0], assists: recent.slice(1).map(([slot]) => slot).sort((p, q) => p - q) };
  }
}
