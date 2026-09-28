import RAPIER from '@dimforge/rapier3d-deterministic-compat';

let ready: Promise<void> | null = null;
let initialised = false;

/** Await once per process / page before creating any physics object. Safe to call repeatedly. */
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init().then(
    () => {
      initialised = true;
    },
    (err: unknown) => {
      ready = null; // allow a retry
      throw err;
    },
  );
  return ready;
}

/** True once `initPhysics()` has completed. */
export const physicsReady = (): boolean => initialised;

export { RAPIER };
