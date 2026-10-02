import type { Quat, Vec3 } from './types';

// Note: helpers using Math.sin/cos/atan2 (quatFromYaw) are for one-time geometry and client code,
// never for per-tick simulation code (see Global Constraints).

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const round3 = (v: number): number => Math.round(v * 1e3) / 1e3;
export const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/** Rotation by `pitch` about the box's own Z axis (a ramp's slope), then by `yaw` about +Y. With no pitch it is exactly `quatFromYaw`. */
export function quatFromYawPitch(yaw: number, pitch: number): Quat {
  if (!pitch) return quatFromYaw(yaw);
  const sy = Math.sin(yaw / 2);
  const cy = Math.cos(yaw / 2);
  const sp = Math.sin(pitch / 2);
  const cp = Math.cos(pitch / 2);
  return quatNormalize({ x: round6(sy * sp), y: round6(sy * cp), z: round6(cy * sp), w: round6(cy * cp) });
}

/** Wraps an angle into [-pi, pi). */
export const wrapPi = (a: number): number => {
  const twoPi = Math.PI * 2;
  let r = (a + Math.PI) % twoPi;
  if (r < 0) r += twoPi;
  return r - Math.PI;
};

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const vadd = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vsub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vscale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const vdot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const vlen = (a: Vec3): number => Math.sqrt(vdot(a, a));
export const vlerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

export const QUAT_IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** Rotates a vector by a unit quaternion (arithmetic only, safe on the simulation path). */
export function quatRotate(q: Quat, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

export const quatConjugate = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

export function quatNormalize(q: Quat): Quat {
  const n = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (n === 0) return { ...QUAT_IDENTITY };
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

/** Hamilton product a ⊗ b: rotating by the result equals rotating by `b` first, then by `a`. */
export const quatMul = (a: Quat, b: Quat): Quat => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});

/** Normalised linear interpolation along the shortest path. */
export function quatNlerp(a: Quat, b: Quat, t: number): Quat {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  const s = dot < 0 ? -1 : 1;
  return quatNormalize({
    x: a.x + (s * b.x - a.x) * t,
    y: a.y + (s * b.y - a.y) * t,
    z: a.z + (s * b.z - a.z) * t,
    w: a.w + (s * b.w - a.w) * t,
  });
}

/** Rotation of `yaw` radians about +Y. Rounded so different JS engines build identical colliders. */
export function quatFromYaw(yaw: number): Quat {
  const h = yaw / 2;
  return quatNormalize({ x: 0, y: round6(Math.sin(h)), z: 0, w: round6(Math.cos(h)) });
}

/** First-order integration of a world-space angular velocity `w` over `dt` seconds. */
export function quatIntegrate(q: Quat, w: Vec3, dt: number): Quat {
  const hx = 0.5 * dt * w.x;
  const hy = 0.5 * dt * w.y;
  const hz = 0.5 * dt * w.z;
  return quatNormalize({
    x: q.x + hx * q.w + hy * q.z - hz * q.y,
    y: q.y + hy * q.w + hz * q.x - hx * q.z,
    z: q.z + hz * q.w + hx * q.y - hy * q.x,
    w: q.w - hx * q.x - hy * q.y - hz * q.z,
  });
}
