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

/** Combat tuning. Impulses are in kN·s (1000 N·s), damage in HP, durations in simulation ticks (60 per second). */
export const COMBAT = {
  MAX_HP: 100,
  /** A contact that transmits less impulse than this (N·s) in one tick is a scrape or a push, not an impact. */
  SCRAPE_IMPULSE: 350,
  /**
   * A hit starts only on a tick that transmits at least this much (N·s): every collision measured so far does in its first
   * tick (3.7 to 29 kN·s), while cars pushing in a line against a wall stay near 0.5 to 1.1 kN·s per tick, however long they do.
   */
  IMPACT_IMPULSE: 2000,
  /** Lighter ticks (still above SCRAPE_IMPULSE) join a hit only within this many ticks of its last impact-sized tick: the tail of a collision counts, a shove after it does not. */
  IMPACT_TAIL_TICKS: 6,
  /** An impact window closes after this many ticks without an impact, or when it has been open this long. */
  WINDOW_GAP_TICKS: 3,
  WINDOW_MAX_TICKS: 30,
  /** Impacts weaker than this (kN·s) do no damage. */
  MIN_IMPULSE: 1.5,
  /** damage = DAMAGE_SCALE * (impulse - MIN_IMPULSE) ^ DAMAGE_EXPONENT, before the multipliers. */
  DAMAGE_SCALE: 0.295,
  DAMAGE_EXPONENT: 1.5,
  /** Applied to the zone of the car that is hit: backing into an opponent is the smart move. */
  ZONE_MULTIPLIER: { front: 1.15, rear: 0.9, left: 1, right: 1 },
  /** Walls and obstacles hurt less than cars do. */
  WALL_MULTIPLIER: 0.5,
  /** An attacker stays credited (assist / kill) for this long after its last hit on a victim (5 s). */
  ASSIST_TICKS: 300,
  POINTS_PER_HP: 1,
  KILL_POINTS: 50,
  WIN_POINTS: 100,
  /** Flipped: the car's up axis points less than this far up (world Y component) for FLIP_TICKS (3 s). */
  FLIP_UP_Y: 0.25,
  FLIP_TICKS: 180,
  /** Immobile: horizontal speed under IMMOBILE_SPEED (m/s) for IMMOBILE_TICKS (8 s). */
  IMMOBILE_SPEED: 0.6,
  IMMOBILE_TICKS: 480,
  /** Out of bounds: further than ARENA.RADIUS + BOUNDS_MARGIN from the centre, or below BOUNDS_MIN_Y. */
  BOUNDS_MARGIN: 2,
  BOUNDS_MIN_Y: -3,
  /** Anti-stall: after STALL_TICKS (20 s) without hitting or being hit a car loses 2 HP per second until it is in a hit. */
  STALL_TICKS: 1200,
  STALL_DRAIN_PER_TICK: 2 / 60,
} as const;

/** Round structure. */
export const ROUND = {
  COUNTDOWN_TICKS: 5 * 60,
  LIVE_TICKS: 4 * 60 * 60,
  RESULTS_TICKS: 8 * 60,
  /** Bots fill a room up to this many cars; they step aside as humans join. */
  BOT_FILL: 4,
  /** A player who joins during a countdown restarts it (so a burst of joiners plays together), at most this often per round. */
  MAX_COUNTDOWN_RESTARTS: 8,
} as const;

export const NET = {
  /** 3: the welcome carries the round's latest hits (`dents`). 2: rounds, hit/ko/scores/results messages, `you` in the roster. */
  PROTOCOL_VERSION: 3,
  /** The welcome message carries this many of the round's latest hits (a newcomer replays them to dent the cars). */
  MAX_HIT_LOG: 64,
  /** Simulation ticks per snapshot: 2 => 30 Hz. */
  SNAPSHOT_EVERY: 2,
  INPUT_QUEUE_MAX: 6,
  /** Ticks without a fresh input before the last input is replaced by neutral (0.5 s). */
  INPUT_STARVE_NEUTRAL_TICKS: 30,
  /** Ticks without any input before the player is disconnected (30 s). */
  INACTIVE_KICK_TICKS: 60 * 30,
  MAX_BUFFERED_BYTES: 64 * 1024,
  MAX_PAYLOAD_BYTES: 1024,
  HEARTBEAT_MS: 30_000,
  /** A socket that has not joined a room within this long is closed (it would otherwise hold a connection slot forever). */
  HELLO_TIMEOUT_MS: 10_000,
  NAME_MAX: 16,
  ROOM_CODE_LENGTH: 4,
  ROOM_CODE_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  QUAT_SCALE: 32767,
  LINVEL_SCALE: 512,
  ANGVEL_SCALE: 1024,
  INTERP_DELAY_MS: 100,
  MAX_EXTRAPOLATION_MS: 250,
} as const;

/**
 * Locks `DRIVE`, `TIRE` and `SUSPENSION`. The offline sandbox edits them live through its tuning panel; every other
 * route calls this at start-up so nothing can change the shared simulation's physics behind the server's back.
 */
export function freezeTuning(): void {
  Object.freeze(DRIVE);
  Object.freeze(TIRE);
  Object.freeze(SUSPENSION);
}
