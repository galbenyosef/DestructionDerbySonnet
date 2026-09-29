import { CAR, COMBAT } from './constants';
import type { Vec3, Zone } from './types';

/** HP an impact of `impulse` kN·s is worth before any multiplier. Nothing below COMBAT.MIN_IMPULSE, then a power curve. */
export function impactDamage(impulse: number): number {
  const over = impulse - COMBAT.MIN_IMPULSE;
  return Number.isFinite(over) && over > 0 ? COMBAT.DAMAGE_SCALE * over ** COMBAT.DAMAGE_EXPONENT : 0;
}

/** The side of the car that a contact point (in the car's local frame, forward +X, right +Z) lies on. Corners count as front/rear. */
export function classifyZone(local: Vec3): Zone {
  const nx = local.x / CAR.HALF.x;
  const nz = local.z / CAR.HALF.z;
  if (Math.abs(nx) >= Math.abs(nz)) return nx >= 0 ? 'front' : 'rear';
  return nz >= 0 ? 'right' : 'left';
}

/** HP taken by the car that was hit: the impact curve times the zone multiplier, halved against walls and obstacles. */
export function hitDamage(impulse: number, zone: Zone, againstWall: boolean): number {
  return impactDamage(impulse) * COMBAT.ZONE_MULTIPLIER[zone] * (againstWall ? COMBAT.WALL_MULTIPLIER : 1);
}
