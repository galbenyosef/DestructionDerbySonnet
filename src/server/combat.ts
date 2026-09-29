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
  openedAt: number;
  lastAt: number;
  impulse: number; // N·s
  sx: number;
  sy: number;
  sz: number;
}

/**
 * Turns the per-tick contacts of a simulation into discrete hits. A collision spreads over a few ticks (and a slide along
 * a wall over many), so contacts between the same two bodies are merged into a window that closes after a short quiet
 * spell or a maximum length; damage is computed once per window from its total impulse. Ticks with only a light
 * touch (a scrape, or two cars pushing against each other) are ignored, so pushing and scraping never wear a car down.
 */
export class HitTracker {
  private readonly windows = new Map<number, Window>();

  /** Feed the contacts of one simulation step (ticks must increase); returns the hits whose window closed on this tick. */
  update(tick: number, contacts: readonly Contact[]): Hit[] {
    const hits: Hit[] = [];
    for (const c of contacts) {
      if (!(c.impulse >= COMBAT.SCRAPE_IMPULSE)) continue;
      this.add(tick, c.a, c.b, c.impulse, c.pointA, hits);
      if (c.b >= 0) this.add(tick, c.b, c.a, c.impulse, c.pointB, hits);
    }
    for (const [key, w] of this.windows) {
      if (tick - w.lastAt < COMBAT.WINDOW_GAP_TICKS) continue;
      this.windows.delete(key);
      this.close(w, hits);
    }
    return hits.sort((p, q) => p.victim - q.victim || p.attacker - q.attacker || p.tick - q.tick);
  }

  /** Forgets every open window (the world was rebuilt). */
  reset(): void {
    this.windows.clear();
  }

  private add(tick: number, victim: number, attacker: number, impulse: number, point: Vec3, hits: Hit[]): void {
    const key = victim * 16 + attacker + 1;
    let w = this.windows.get(key);
    if (w && tick - w.openedAt >= COMBAT.WINDOW_MAX_TICKS) {
      this.close(w, hits); // a window that has been open this long is paid out; this contact starts the next one
      w = undefined;
    }
    if (!w) {
      w = { victim, attacker, openedAt: tick, lastAt: tick, impulse: 0, sx: 0, sy: 0, sz: 0 };
      this.windows.set(key, w);
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
    const damage = hitDamage(kns, zone, w.attacker < 0);
    if (damage > 0) hits.push({ tick: w.openedAt, victim: w.victim, attacker: w.attacker, impulse: kns, zone, damage, point });
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

  reset(): void {
    this.lastHit.clear();
  }
}
