import { normalizeRoomCode } from '../../shared/protocol';
import { carOrDefault } from '../../shared/cars';
import { PALETTE } from '../profile';
import type { JoinChoice } from './menu';

/** ?auto=quick | create | join:CODE (+ &name= &color=<palette index> &car=<sedan|coupe|wagon|pickup>) skips the menu — for links and automated checks. */
export function automaticChoice(params: URLSearchParams): JoinChoice | null {
  const auto = params.get('auto');
  if (!auto) return null;
  const name = params.get('name') ?? 'Guest';
  const color = PALETTE[Math.floor(Math.abs(Number(params.get('color') ?? 0))) % PALETTE.length] ?? PALETTE[0]!;
  const car = carOrDefault(params.get('car'));
  if (auto === 'quick' || auto === 'create') return { name, color, car, mode: auto };
  if (auto.startsWith('join:')) {
    const code = normalizeRoomCode(auto.slice(5));
    if (code) return { name, color, car, mode: 'join', code };
  }
  return null;
}
