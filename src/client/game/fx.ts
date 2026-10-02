import * as THREE from 'three';
import { boundsHalfSize, type ArenaDef } from '../../shared/arenas';
import { ARENA, COMBAT } from '../../shared/constants';
import { clamp, quatRotate, vadd, vdot, vlen } from '../../shared/math';
import type { HitMessage, KoMessage } from '../../shared/protocol';
import { mulberry32 } from '../../shared/random';
import type { Quat, Vec3 } from '../../shared/types';
import { wheelLocalPosition } from '../../shared/vehicle';
import type { LocalImpact } from '../net/prediction';
import type { DrawPose } from '../net/session';
import type { AudioEngine, EngineCar, Listener } from './audio';
import { DamageBook } from './carDamage';
import { REST_SUSPENSION, type CarView } from './carView';
import { DebrisSystem } from './debris';
import { ParticleSystem } from './particles';
import { CameraShake, traumaForImpact } from './shake';
import { SkidMarks, skidStrength, type MarkSurface } from './skidMarks';

/** Tuning of the effects. Times in seconds, rates per second. */
export const FX = {
  /** A car below this many HP smokes, the more the lower it is; below FIRE_HP it also burns. */
  SMOKE_HP: 50,
  FIRE_HP: 25,
  /** A wreck smokes for this long after it goes out, and burns for the first part of it. */
  WRECK_SMOKE_SECONDS: 25,
  WRECK_FIRE_SECONDS: 6,
  /** A crash sound for the same pair of cars is not repeated within this time. */
  CRASH_COOLDOWN: 0.15,
  /** A `hit` message makes its own sparks and sound unless a local impact of the same car was seen within this time. */
  LOCAL_COVERS: 1.5,
  /** Speed (m/s) above which a car on the ground kicks up dust. */
  DUST_SPEED: 4,
} as const;

/** Where the marks are drawn and how they get to the screen (a canvas in the browser, a recorder in tests). */
export interface MarkTarget {
  surface: MarkSurface;
  object?: THREE.Object3D;
  upload(): void;
}

export interface FxOptions {
  scene: THREE.Scene;
  audio: AudioEngine;
  marks: MarkTarget;
  /** Finds the view of a car (the client owns them). */
  view(slot: number): CarView | undefined;
  random?: () => number;
}

/** What the effects need to know about this frame. */
export interface FxFrame {
  dt: number;
  /** Seconds on a steady clock. */
  now: number;
  poses: readonly DrawPose[];
  mySlot: number;
  listener: Listener;
  camera: THREE.PerspectiveCamera;
  /** Screen pixels per metre at one metre from the camera (`height / (2 tan(fov / 2))`). */
  pixelScale: number;
}

const worldPoint = (pose: { pos: Vec3; quat: Quat }, local: Vec3): Vec3 => vadd(pose.pos, quatRotate(pose.quat, local));

/**
 * Everything that makes crashes feel like crashes: dents and lost parts, sparks, dust, smoke and fire, tyre marks, debris, camera
 * shake and sound. It is told what happens (a hit message from the server, an impact of the local prediction, a car going out)
 * and is asked once a frame to keep the continuous effects going. It never decides anything about the game.
 */
export class FxDirector {
  readonly particles = new ParticleSystem();
  readonly debris: DebrisSystem;
  readonly shake = new CameraShake();
  readonly damage = new DamageBook();
  private readonly marks: SkidMarks;
  private readonly random: () => number;
  private readonly rates = new Map<number, { smoke: number; fire: number; dust: number }>();
  private readonly wentOutAt = new Map<number, number>();
  private readonly crashedAt = new Map<string, number>();
  private readonly localImpactAt = new Map<number, number>();
  /** Collisions the server has told about (by the two cars and the tick): it tells each once per car in it, and they are played once. */
  private readonly told = new Map<string, number>();
  private now = 0;
  /** Multiplies how many particles are emitted (the graphics preset). */
  private density = 1;

  constructor(private readonly options: FxOptions) {
    this.random = options.random ?? mulberry32(0xf00d);
    this.debris = new DebrisSystem(this.random);
    this.marks = new SkidMarks(options.marks.surface);
    options.scene.add(this.particles.object, this.debris.object);
    if (options.marks.object) options.scene.add(options.marks.object);
  }

  /** Sets how many particles the effects emit (1 = all, 0.3 = under a third) and how many pieces of debris may lie around. */
  setDensity(particles: number, debris: number): void {
    this.density = Number.isFinite(particles) ? clamp(particles, 0, 1) : 1;
    this.debris.setLimit(debris);
  }

  /** `count` particles thinned by the density, rounded up or down at random so that the average is right. */
  private thin(count: number): number {
    const k = count * this.density;
    const whole = Math.floor(k);
    return whole + (this.random() < k - whole ? 1 : 0);
  }

  // ---- what happens -----------------------------------------------------------------------------

  /**
   * A newcomer's hit log: dents and missing parts are put on the cars as the players saw them, with no sparks, no sound and no
   * flying debris (all of that happened before they arrived).
   */
  onWelcome(log: readonly HitMessage[]): void {
    for (const h of log) this.wear(h, false);
  }

  /** The arena of the coming round: the tyre marks cover all of it (a little beyond its walls) and start blank. */
  setArena(arena: ArenaDef): void {
    this.marks.setColor(arena.look.marks);
    this.marks.setExtent(boundsHalfSize(arena.bounds) + 2);
    this.options.marks.upload();
  }

  /** A new round: every car is whole again and the ground is clean. */
  onRoster(): void {
    this.damage.reset();
    this.debris.clear();
    this.particles.clear();
    this.marks.clear();
    this.options.marks.upload();
    this.shake.reset();
    this.rates.clear();
    this.wentOutAt.clear();
    this.crashedAt.clear();
    this.localImpactAt.clear();
    this.told.clear();
    for (const view of this.allViews()) view.restore();
  }

  /** The server says a car was hit: the dent and the parts always; sparks, sound and shake only if the local prediction has not made them already. */
  onHit(h: HitMessage, frame: Pick<FxFrame, 'poses' | 'mySlot' | 'listener'>): void {
    this.wear(h, true, frame.poses);
    const mine = frame.mySlot >= 0 && (h.victim === frame.mySlot || h.attacker === frame.mySlot); // -1 is "no car" for a watcher, and "a wall" as an attacker
    const other = h.victim === frame.mySlot ? h.attacker : h.victim; // what the local car ran into: another car, or -1 for a wall
    const covered = mine && this.now - (this.localImpactAt.get(other) ?? -1e9) < FX.LOCAL_COVERS;
    if (covered) return;
    const key = `${Math.min(h.victim, h.attacker)}:${Math.max(h.victim, h.attacker)}:${h.tick}`;
    if (this.told.has(key)) return; // the same collision, told for the other car in it
    this.told.set(key, this.now);
    for (const [k, at] of this.told) if (this.now - at > 2) this.told.delete(k);
    const pose = frame.poses.find((p) => p.slot === h.victim);
    if (!pose) return;
    const at = worldPoint(pose, { x: h.p[0], y: h.p[1], z: h.p[2] });
    this.impact(h.j, at, pose.linvel, `${h.victim}:${h.attacker}`, frame.listener, mine ? 0 : vlen({ x: at.x - frame.listener.pos.x, y: at.y - frame.listener.pos.y, z: at.z - frame.listener.pos.z }));
  }

  /** A car goes out: a burst of fire and smoke, a big thump, and it will keep smoking. */
  onKo(k: KoMessage, frame: Pick<FxFrame, 'poses' | 'listener'>): void {
    this.wentOutAt.set(k.victim, this.now);
    const pose = frame.poses.find((p) => p.slot === k.victim);
    if (!pose || k.reason === 'disconnected') return;
    const at = worldPoint(pose, { x: 0.6, y: 0.5, z: 0 });
    for (let i = this.thin(14); i > 0; i--) this.puff('fire', at, 2.5, 1.2 + this.random() * 0.8, 0.5 + this.random() * 0.5);
    for (let i = this.thin(10); i > 0; i--) this.puff('smoke', at, 1.8, 2 + this.random() * 1.5, 0.9 + this.random() * 0.6);
    this.options.audio.crash(25, at, frame.listener);
  }

  /** The local prediction's impacts, the moment they happen: sparks in proportion, a jolt, a sound for the real ones. */
  onLocalImpacts(impacts: readonly LocalImpact[], frame: Pick<FxFrame, 'poses' | 'listener'>): void {
    for (const i of impacts) {
      const pose = frame.poses.find((p) => p.slot === i.slot);
      if (!pose?.alive) continue; // your own wreck being rammed is not a jolt for the camera that orbits somebody else
      const at = worldPoint(pose, i.point);
      this.localImpactAt.set(i.other, this.now);
      const real = i.kns * 1000 >= COMBAT.IMPACT_IMPULSE;
      this.sparks(at, pose.linvel, real ? clamp(Math.round(i.kns * 3), 4, 40) : 2);
      if (real) this.impact(i.kns, at, pose.linvel, `${i.slot}:${i.other}`, frame.listener, 0, false);
    }
  }

  // ---- every frame ------------------------------------------------------------------------------

  frame(f: FxFrame): void {
    this.now = f.now;
    const dt = clamp(Number.isFinite(f.dt) ? f.dt : 0, 0, 0.1);
    const engines: EngineCar[] = [];
    for (const p of f.poses) {
      if (!p.visible) continue;
      const speed = vlen(p.linvel);
      engines.push({ slot: p.slot, pos: p.pos, speed, throttle: p.throttle, alive: p.alive });
      if (!p.alive) {
        if (!this.wentOutAt.has(p.slot)) this.wentOutAt.set(p.slot, f.now - FX.WRECK_FIRE_SECONDS); // a wreck we met has already burnt: it only smoulders
        this.burn(p, dt, f.now);
        continue;
      }
      this.wentOutAt.delete(p.slot);
      this.smoulder(p, dt);
      this.roll(p, speed, dt);
    }
    this.debris.update(dt);
    this.particles.update(f.now, f.pixelScale);
    if (this.marks.takeDirty()) this.options.marks.upload();
    this.shake.apply(f.camera, dt);
    this.options.audio.update(f.listener, engines);
  }

  dispose(): void {
    this.particles.dispose();
    this.debris.dispose();
    this.options.marks.object?.removeFromParent();
  }

  // ---- parts of the above -----------------------------------------------------------------------

  private allViews(): CarView[] {
    const views: CarView[] = [];
    for (let slot = 0; slot < ARENA.MAX_CARS; slot++) {
      const v = this.options.view(slot);
      if (v) views.push(v);
    }
    return views;
  }

  /** Dents the victim, takes off what the damage rules say, and (live) sends the parts flying. */
  private wear(h: HitMessage, live: boolean, poses: readonly DrawPose[] = []): void {
    const outcome = this.damage.onHit(h);
    const view = this.options.view(h.victim);
    if (!view) return;
    view.dent(outcome.dent);
    const velocity = poses.find((p) => p.slot === h.victim)?.linvel ?? { x: 0, y: 0, z: 0 };
    for (const id of outcome.lost) {
      const part = view.detach(id);
      if (part && live) this.debris.spawn(part, velocity);
    }
  }

  /** Sparks, a puff of dust, a jolt of the camera and a crash sound for an impact of `kns` kN·s at `at`. */
  private impact(kns: number, at: Vec3, carVelocity: Vec3, pair: string, listener: Listener, distance: number, sparks = true): void {
    if (sparks) this.sparks(at, carVelocity, clamp(Math.round(kns * 3), 4, 40));
    for (let i = this.thin(4); i > 0; i--) this.puff('dust', at, 2, 0.8 + this.random() * 0.6, 0.6 + this.random() * 0.5);
    this.shake.add(traumaForImpact(kns, distance));
    const last = this.crashedAt.get(pair) ?? -1e9;
    if (this.now - last >= FX.CRASH_COOLDOWN) {
      this.crashedAt.set(pair, this.now);
      this.options.audio.crash(kns, at, listener);
    }
  }

  private sparks(at: Vec3, carVelocity: Vec3, count: number): void {
    for (let i = this.thin(count); i > 0; i--) {
      const a = this.random() * Math.PI * 2;
      const up = 1 + this.random() * 4;
      const out = 1 + this.random() * 5;
      this.particles.emit('spark', {
        x: at.x, y: Math.max(at.y, 0.1), z: at.z,
        vx: carVelocity.x * 0.3 + Math.cos(a) * out, vy: up, vz: carVelocity.z * 0.3 + Math.sin(a) * out,
        life: 0.3 + this.random() * 0.4, size: 0.09 + this.random() * 0.08, seed: this.random(),
      });
    }
  }

  private puff(kind: 'smoke' | 'fire' | 'dust', at: Vec3, spread: number, life: number, size: number): void {
    this.particles.emit(kind, {
      x: at.x + (this.random() - 0.5) * 0.5, y: at.y, z: at.z + (this.random() - 0.5) * 0.5,
      vx: (this.random() - 0.5) * spread, vy: 0.5 + this.random() * spread * 0.6, vz: (this.random() - 0.5) * spread,
      life, size, seed: this.random(),
    });
  }

  private rate(slot: number): { smoke: number; fire: number; dust: number } {
    let r = this.rates.get(slot);
    if (!r) {
      r = { smoke: 0, fire: 0, dust: 0 };
      this.rates.set(slot, r);
    }
    return r;
  }

  /** How many whole particles are due after `dt` seconds at `perSecond`, keeping the remainder for the next frame. */
  private due(slot: number, key: 'smoke' | 'fire' | 'dust', perSecond: number, dt: number): number {
    const r = this.rate(slot);
    r[key] += perSecond * this.density * dt;
    const n = Math.floor(r[key]);
    r[key] -= n;
    return n;
  }

  /** A hurt car smokes from under its bonnet, and burns when it is nearly out. */
  private smoulder(p: DrawPose, dt: number): void {
    if (p.hp >= FX.SMOKE_HP) return;
    const hood = worldPoint(p, { x: 1.5, y: 0.35, z: 0 });
    const hurt = (FX.SMOKE_HP - p.hp) / FX.SMOKE_HP;
    for (let i = this.due(p.slot, 'smoke', 4 + 12 * hurt, dt); i > 0; i--) this.puff('smoke', hood, 1.2, 1.6 + this.random(), 0.5);
    if (p.hp < FX.FIRE_HP) {
      for (let i = this.due(p.slot, 'fire', 4 + 10 * ((FX.FIRE_HP - p.hp) / FX.FIRE_HP), dt); i > 0; i--) this.puff('fire', hood, 1, 0.5 + this.random() * 0.4, 0.4);
    }
  }

  /** A wreck burns for a few seconds, then smoulders for a good while longer. */
  private burn(p: DrawPose, dt: number, now: number): void {
    const age = now - (this.wentOutAt.get(p.slot) ?? now);
    if (age > FX.WRECK_SMOKE_SECONDS) return;
    const engine = worldPoint(p, { x: 1.2, y: 0.4, z: 0 });
    for (let i = this.due(p.slot, 'smoke', 7 * (1 - age / FX.WRECK_SMOKE_SECONDS) + 1, dt); i > 0; i--) this.puff('smoke', engine, 1, 2 + this.random() * 1.2, 0.7);
    if (age < FX.WRECK_FIRE_SECONDS) {
      for (let i = this.due(p.slot, 'fire', 14 * (1 - age / FX.WRECK_FIRE_SECONDS), dt); i > 0; i--) this.puff('fire', engine, 1.2, 0.5 + this.random() * 0.5, 0.5);
    }
  }

  /** Tyre marks and dust from a car that is moving on the ground. */
  private roll(p: DrawPose, speed: number, dt: number): void {
    const forward = quatRotate(p.quat, { x: 1, y: 0, z: 0 });
    const right = quatRotate(p.quat, { x: 0, y: 0, z: 1 });
    const strength = skidStrength({
      forward: vdot(p.linvel, forward),
      lateral: vdot(p.linvel, right),
      handbrake: p.handbrake,
      grounded: p.grounded,
      throttle: p.throttle,
    });
    for (let i = 0; i < 4; i++) {
      const wheel = worldPoint(p, wheelLocalPosition(i, REST_SUSPENSION));
      this.marks.wheel(p.slot * 4 + i, wheel.x, wheel.z, i >= 2 ? strength : strength * 0.6);
    }
    if (p.grounded && speed > FX.DUST_SPEED) {
      const rear = worldPoint(p, wheelLocalPosition(2 + Math.floor(this.random() * 2), REST_SUSPENSION)); // either rear wheel
      for (let i = this.due(p.slot, 'dust', clamp(speed, 0, 20) * 0.8 + strength * 30, dt); i > 0; i--) {
        this.puff('dust', { x: rear.x, y: 0.15, z: rear.z }, 1.2, 0.6 + this.random() * 0.5, 0.35);
      }
    }
  }
}
