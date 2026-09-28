import { CAR, CAR_FORWARD, DRIVE, SUSPENSION, TIRE } from './constants';
import { NEUTRAL_INPUT, type CarInput } from './input';
import { clamp, lerp, quatRotate, vdot } from './math';
import { RAPIER } from './physics';
import type { Quat, Vec3 } from './types';

/** Wheel order: 0 = front right (+Z), 1 = front left, 2 = rear right, 3 = rear left. */
export const FRONT_WHEELS = [0, 1] as const;
export const REAR_WHEELS = [2, 3] as const;
const WHEEL_SIGNS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Chassis-local position of a wheel centre for a given suspension length (index 0..3). */
export function wheelLocalPosition(index: number, suspensionLength: number): Vec3 {
  const signs = WHEEL_SIGNS[index];
  if (!signs) throw new RangeError(`wheel index ${index} out of range`);
  return { x: signs[0] * CAR.WHEEL.X, y: CAR.WHEEL.HARD_Y - suspensionLength, z: signs[1] * CAR.WHEEL.Z };
}

export interface CarRig {
  readonly slot: number;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  input: CarInput;
}

export function createCarRig(world: RAPIER.World, slot: number, pose: { pos: Vec3; quat: Quat }): CarRig {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pose.pos.x, pose.pos.y, pose.pos.z)
      .setRotation(pose.quat)
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setLinearDamping(CAR.LINEAR_DAMPING)
      .setAngularDamping(CAR.ANGULAR_DAMPING),
  );
  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(CAR.HALF.x, CAR.HALF.y, CAR.HALF.z)
      .setMassProperties(CAR.MASS, { x: 0, y: CAR.COM_Y, z: 0 }, CAR.INERTIA, { x: 0, y: 0, z: 0, w: 1 })
      .setFriction(CAR.FRICTION)
      .setRestitution(CAR.RESTITUTION),
    body,
  );
  const controller = world.createVehicleController(body);
  controller.indexUpAxis = 1;
  controller.setIndexForwardAxis = 0; // Rapier exposes this setter as an accessor literally named `setIndexForwardAxis`
  for (let i = 0; i < 4; i++) {
    controller.addWheel(
      wheelLocalPosition(i, 0), // suspension length 0 = the hard point on the chassis
      { x: 0, y: -1, z: 0 },
      { x: 0, y: 0, z: 1 },
      CAR.WHEEL.REST_LENGTH,
      CAR.WHEEL.RADIUS,
    );
    controller.setWheelSuspensionStiffness(i, SUSPENSION.STIFFNESS);
    controller.setWheelSuspensionCompression(i, SUSPENSION.COMPRESSION);
    controller.setWheelSuspensionRelaxation(i, SUSPENSION.RELAXATION);
    controller.setWheelMaxSuspensionTravel(i, SUSPENSION.MAX_TRAVEL);
    controller.setWheelMaxSuspensionForce(i, SUSPENSION.MAX_FORCE);
    controller.setWheelFrictionSlip(i, TIRE.SLIP);
    controller.setWheelSideFrictionStiffness(i, TIRE.SIDE_STIFFNESS);
  }
  return { slot, body, collider, controller, input: { ...NEUTRAL_INPUT } };
}

/** Signed speed along the car's forward axis (m/s). */
export function forwardSpeed(body: RAPIER.RigidBody): number {
  return vdot(body.linvel(), quatRotate(body.rotation(), CAR_FORWARD));
}

/** Rapier steering angle in radians (positive = left) for a steer input in [-1, 1] at a forward speed in m/s. */
export function steeringAngle(steer: number, forwardSpeed: number): number {
  const steerMax = lerp(
    DRIVE.MAX_STEER,
    DRIVE.MAX_STEER_FAST,
    clamp(Math.abs(forwardSpeed) / DRIVE.STEER_FADE_SPEED, 0, 1),
  );
  return DRIVE.STEER_SIGN * clamp(steer, -1, 1) * steerMax;
}

/** Turns the car's current input into wheel forces. Arithmetic only — no trig on the per-tick path. */
export function driveCar(rig: CarRig): void {
  const { controller: c, body, input } = rig;
  const vf = forwardSpeed(body);
  const t = clamp(input.throttle, -1, 1);
  let engine = 0;
  let brake = 0;
  if (t > 0) {
    if (vf < -1) brake = DRIVE.BRAKE * t; // moving backwards: brake first
    else engine = t * DRIVE.ENGINE * clamp(1 - vf / DRIVE.MAX_SPEED, 0, 1);
  } else if (t < 0) {
    if (vf > 1) brake = DRIVE.BRAKE * -t; // moving forwards: brake first, reverse once stopped
    else engine = t * DRIVE.ENGINE * DRIVE.REVERSE_SCALE * clamp(1 + vf / (DRIVE.MAX_SPEED * 0.4), 0, 1);
  }
  const steering = steeringAngle(input.steer, vf);
  for (const i of FRONT_WHEELS) {
    c.setWheelSteering(i, steering);
    c.setWheelBrake(i, brake);
    c.setWheelEngineForce(i, 0);
    c.setWheelFrictionSlip(i, TIRE.SLIP);
  }
  for (const i of REAR_WHEELS) {
    c.setWheelEngineForce(i, engine);
    c.setWheelBrake(i, brake + (input.handbrake ? DRIVE.HANDBRAKE : 0));
    c.setWheelFrictionSlip(i, input.handbrake ? TIRE.SLIP * TIRE.HANDBRAKE_SLIP_SCALE : TIRE.SLIP);
  }
}
