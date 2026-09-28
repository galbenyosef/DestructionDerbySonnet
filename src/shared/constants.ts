import type { Vec3 } from './types';

export const PHYSICS = {
  TICK_RATE: 60,
  DT: 1 / 60,
  GRAVITY: 9.81,
} as const;

/** Local axes of a car: forward +X, up +Y, right +Z. */
export const CAR_FORWARD: Readonly<Vec3> = { x: 1, y: 0, z: 0 };
export const CAR_UP: Readonly<Vec3> = { x: 0, y: 1, z: 0 };
export const CAR_RIGHT: Readonly<Vec3> = { x: 0, y: 0, z: 1 };

export const CAR = {
  MASS: 1500,
  /** Chassis collider half extents (forward = +X). */
  HALF: { x: 2.3, y: 0.5, z: 1.0 },
  /** Centre of mass sits this far below the chassis centre (stability). */
  COM_Y: -0.35,
  /** Principal inertia: roll about X, yaw about Y, pitch about Z. */
  INERTIA: { x: 625, y: 3145, z: 2770 },
  FRICTION: 0.5,
  RESTITUTION: 0.25,
  LINEAR_DAMPING: 0.02,
  ANGULAR_DAMPING: 0.6,
  /** Spawn height of the chassis centre; the car settles to ~1.07 m. */
  SPAWN_HEIGHT: 1.3,
  WHEEL: { X: 1.45, Z: 0.95, HARD_Y: -0.3, REST_LENGTH: 0.45, RADIUS: 0.4 },
} as const;

export interface SuspensionTuning {
  STIFFNESS: number;
  COMPRESSION: number;
  RELAXATION: number;
  MAX_TRAVEL: number;
  MAX_FORCE: number;
}
export const SUSPENSION: SuspensionTuning = {
  STIFFNESS: 30,
  COMPRESSION: 3.0,
  RELAXATION: 2.6,
  MAX_TRAVEL: 0.4,
  MAX_FORCE: 60000,
};

export interface TireTuning {
  SLIP: number;
  SIDE_STIFFNESS: number;
  /** Rear tyre grip multiplier while the handbrake is held. */
  HANDBRAKE_SLIP_SCALE: number;
}
export const TIRE: TireTuning = {
  SLIP: 2.0,
  SIDE_STIFFNESS: 1.0,
  HANDBRAKE_SLIP_SCALE: 0.5,
};

export interface DriveTuning {
  ENGINE: number;
  REVERSE_SCALE: number;
  BRAKE: number;
  HANDBRAKE: number;
  MAX_SPEED: number;
  MAX_STEER: number;
  MAX_STEER_FAST: number;
  STEER_FADE_SPEED: number;
  /** Rapier turns LEFT for positive angles; input +1 means RIGHT, hence -1. */
  STEER_SIGN: 1 | -1;
}
export const DRIVE: DriveTuning = {
  ENGINE: 8000,
  REVERSE_SCALE: 0.6,
  BRAKE: 55,
  HANDBRAKE: 30,
  MAX_SPEED: 21,
  MAX_STEER: 0.55,
  MAX_STEER_FAST: 0.25,
  STEER_FADE_SPEED: 20,
  STEER_SIGN: -1,
};

export const ARENA = {
  /** Distance from the centre to the inner face of the wall ring (m). */
  RADIUS: 45,
  WALL_SEGMENTS: 32,
  WALL_HALF_HEIGHT: 1.5,
  WALL_HALF_THICKNESS: 1.0,
  GROUND_HALF_EXTENT: 120,
  SPAWN_RADIUS: 32,
  MAX_CARS: 8,
  OBSTACLE_COUNT: 4,
  OBSTACLE_RING_RADIUS: 14,
  OBSTACLE_HALF: { x: 2.5, y: 0.75, z: 1.0 },
} as const;
