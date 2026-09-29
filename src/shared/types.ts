export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Full rigid-body state of one car (what gets sent in snapshots and restored during rollback). */
export interface CarState {
  pos: Vec3;
  quat: Quat;
  linvel: Vec3;
  angvel: Vec3;
}

/** Visual/diagnostic state of one wheel. */
export interface WheelPose {
  contact: boolean;
  suspensionLength: number;
  /** Accumulated rolling angle in radians; increases while rolling forward. */
  rotation: number;
  /** Rapier steering angle in radians; positive = left. */
  steering: number;
}

/** Which side of a car took an impact: front (+X), rear (-X), left (-Z), right (+Z). */
export type Zone = 'front' | 'rear' | 'left' | 'right';
