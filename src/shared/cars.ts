/** The car models a player can choose from. They differ in looks only: every one has the physics, hitbox and tuning of `CAR`. */
export const CAR_IDS = ['sedan', 'coupe', 'wagon', 'pickup'] as const;
export type CarId = (typeof CAR_IDS)[number];
export const DEFAULT_CAR: CarId = 'sedan';

export const CAR_NAMES: Readonly<Record<CarId, string>> = { sedan: 'Sedan', coupe: 'Coupe', wagon: 'Wagon', pickup: 'Pickup' };

export const isCarId = (v: unknown): v is CarId => typeof v === 'string' && (CAR_IDS as readonly string[]).includes(v);

/** `v` when it names a car, the sedan otherwise: an old or odd client is never refused for its choice of car. */
export const carOrDefault = (v: unknown): CarId => (isCarId(v) ? v : DEFAULT_CAR);
