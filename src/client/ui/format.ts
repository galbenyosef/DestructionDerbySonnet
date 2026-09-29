import { clamp } from '../../shared/math';

/** "#rrggbb" from a 24-bit colour. */
export const hexColor = (c: number): string => `#${(Math.max(0, Math.min(0xffffff, Math.floor(c))) >>> 0).toString(16).padStart(6, '0')}`;

/** Colour of a hit-point bar or tag: green when healthy, amber when hurt, red when nearly out. */
export function hpColor(hp: number): string {
  const t = clamp(Number.isFinite(hp) ? hp : 0, 0, 100) / 100;
  return `hsl(${Math.round(t * 120)}, 80%, 48%)`;
}

/** Fill of one side of the damage diagram: a faint tint for an untouched side, solid red at 40 HP of damage or more. */
export function zoneColor(damage: number): string {
  const t = clamp(Number.isFinite(damage) ? damage / 40 : 0, 0, 1);
  return `hsla(${Math.round((1 - t) * 55)}, 90%, 55%, ${(0.16 + 0.84 * t).toFixed(2)})`;
}
