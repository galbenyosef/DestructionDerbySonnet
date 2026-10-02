import { DEFAULT_CAR, isCarId, type CarId } from '../shared/cars';

/** The colours a player can paint their car. */
export const PALETTE: readonly number[] = [0xd84a2b, 0x2b7fd8, 0x2fb457, 0xe0b122, 0x9b59d0, 0x18b5b5, 0xe8527d, 0xe9e9e9];

export const PROFILE_KEY = 'wreckyard.profile';

/** What the menu remembers about the player between visits. */
export interface Profile {
  name: string;
  color: number;
  car: CarId;
}

export const DEFAULT_PROFILE: Profile = { name: '', color: PALETTE[0]!, car: DEFAULT_CAR };

/** The saved profile, repaired one field at a time: a damaged field falls back to its default, and storage that is missing or throws is survived. */
export function loadProfile(storage: Pick<Storage, 'getItem'> | null): Profile {
  try {
    const raw = storage?.getItem(PROFILE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Record<string, unknown> | null;
      if (p && typeof p === 'object') {
        return {
          name: typeof p.name === 'string' ? p.name : DEFAULT_PROFILE.name,
          color: typeof p.color === 'number' && PALETTE.includes(p.color) ? p.color : DEFAULT_PROFILE.color,
          car: isCarId(p.car) ? p.car : DEFAULT_PROFILE.car,
        };
      }
    }
  } catch {
    /* storage unavailable or corrupt: fall through to defaults */
  }
  return { ...DEFAULT_PROFILE };
}

export function saveProfile(storage: Pick<Storage, 'setItem'> | null, profile: Profile): void {
  try {
    storage?.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    /* private mode: not fatal */
  }
}
