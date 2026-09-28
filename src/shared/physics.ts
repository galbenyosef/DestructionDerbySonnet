import RAPIER from '@dimforge/rapier3d-deterministic-compat';

let ready: Promise<void> | null = null;

/** Await once per process / page before creating any physics object. Safe to call repeatedly. */
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

export { RAPIER };
