import { clamp } from '../../shared/math';
import type { BoardRow, MatchView } from '../game/matchState';

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

/** Wraps `write` so it runs only when the value differs from the last one written: the HUD is refreshed every frame and most frames change nothing. */
export function once<T>(write: (value: T) => void): (value: T) => void {
  let last: T | undefined;
  let written = false;
  return (value) => {
    if (written && Object.is(value, last)) return;
    written = true;
    last = value;
    write(value);
  };
}

/**
 * Everything the scoreboard draws, as a string: the board is rebuilt only when this changes. The compact board shows
 * neither health nor kills, so a car being hurt does not rebuild it; the detailed one shows whole hit points.
 */
export function boardSignature(rows: readonly BoardRow[], detailed: boolean): string {
  return JSON.stringify([
    detailed,
    rows.map((r) => {
      const drawn = [r.slot, r.name, r.color, r.bot, r.score, r.alive, r.you];
      return detailed ? [...drawn, r.kills, Math.ceil(r.hp)] : drawn;
    }),
  ]);
}

/** "no votes", "1 vote", "3 votes" under an arena card. */
export const voteLabel = (count: number): string => {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return n === 0 ? 'no votes' : n === 1 ? '1 vote' : `${n} votes`;
};

/** Everything the vote panel draws, as a string: the panel is rebuilt only when this changes. Empty when there is no vote. */
export function voteSignature(vote: MatchView['vote']): string {
  return vote ? JSON.stringify(vote.options.map((o) => [o.id, o.name, o.count, o.mine])) : '';
}
