import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AudioEngine } from '../../src/client/game/audio';
import { CarView } from '../../src/client/game/carView';
import { FX, FxDirector } from '../../src/client/game/fx';
import { SKID, type MarkSurface } from '../../src/client/game/skidMarks';
import type { LocalImpact } from '../../src/client/net/prediction';
import type { DrawPose } from '../../src/client/net/session';
import { COMBAT } from '../../src/shared/constants';
import type { HitMessage, KoMessage } from '../../src/shared/protocol';
import { mulberry32 } from '../../src/shared/random';
import { FakeContext } from '../helpers/fakeAudio';

class Recorder implements MarkSurface {
  lines = 0;
  cleared = 0;
  line(): void {
    this.lines++;
  }
  clear(): void {
    this.cleared++;
  }
}

const pose = (slot: number, over: Partial<DrawPose> = {}): DrawPose => ({
  slot,
  pos: { x: slot * 12, y: 1, z: 0 },
  quat: { x: 0, y: 0, z: 0, w: 1 },
  linvel: { x: 0, y: 0, z: 0 },
  steer: 0,
  visible: true,
  extrapolated: false,
  alive: true,
  hp: 100,
  throttle: 0,
  handbrake: false,
  grounded: true,
  ...over,
});
const hit = (over: Partial<HitMessage> = {}): HitMessage => ({ t: 'hit', tick: 100, victim: 1, attacker: 2, dmg: 8, hp: 80, zone: 'front', j: 10, p: [2.3, -0.3, 0], ...over });
const ko = (over: Partial<KoMessage> = {}): KoMessage => ({ t: 'ko', tick: 300, victim: 1, killer: 2, assists: [], reason: 'damage', ...over });
const listener = { pos: { x: 0, y: 1, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 } };

function setup() {
  const ctx = new FakeContext();
  const audio = new AudioEngine((() => ctx) as unknown as () => AudioContext);
  audio.unlock();
  const scene = new THREE.Scene();
  const views = new Map<number, CarView>([0, 1, 2].map((s) => [s, new CarView(0x445566 + s)] as const));
  const surface = new Recorder();
  let uploads = 0;
  const fx = new FxDirector({ scene, audio, marks: { surface, upload: () => uploads++ }, view: (s) => views.get(s), random: mulberry32(9) });
  const camera = new THREE.PerspectiveCamera();
  let now = 100;
  let poses: DrawPose[] = [pose(0), pose(1), pose(2)];
  const crashes = () => ctx.nodes.filter((n) => n.started > 0 && n.stopped > 0).length;
  const api = {
    fx, ctx, views, surface, scene, camera,
    get uploads() { return uploads; },
    get poses() { return poses; },
    setPoses(p: DrawPose[]) { poses = p; },
    frame(dt = 1 / 60) {
      now += dt;
      fx.frame({ dt, now, poses, mySlot: 0, listener, camera, pixelScale: 500 });
    },
    frames(seconds: number) {
      for (let t = 0; t < seconds; t += 1 / 60) api.frame();
    },
    sparks: () => fx.particles.alive('spark'),
    crashes,
    ctxNodes: () => ctx.nodes.length,
    shape: (slot: number) => Array.from((views.get(slot)!.group.children[0] as THREE.Mesh).geometry.getAttribute('position').array as Float32Array),
    frameArgs: () => ({ poses, mySlot: 0, listener }),
  };
  api.frame(); // sets the clock
  return api;
}
const impact = (kns: number, other = 1): LocalImpact => ({ slot: 0, other, kns, point: { x: 2.3, y: 0, z: 0 } });

describe('FxDirector hits reported by the server', () => {
  it('dents the victim, counts the damage on that side, and makes sparks and a crash sound for a hit on other cars', () => {
    const t = setup();
    const before = t.shape(1);
    const nodes = t.ctxNodes();
    t.fx.onHit(hit(), t.frameArgs());
    expect(t.shape(1)).not.toEqual(before);
    expect(t.shape(2)).toEqual(t.shape(2));
    expect(t.fx.damage.car(1).zones.front).toBe(8);
    expect(t.sparks()).toBeGreaterThan(0);
    expect(t.ctxNodes()).toBeGreaterThan(nodes); // a crash
    expect(t.fx.shake.level).toBeGreaterThan(0);
  });

  it('does not jolt the camera of a player who is only watching (no car of their own) for a wall hit far away', () => {
    const t = setup();
    const at = (x: number) => [pose(0), pose(1, { pos: { x, y: 1, z: 0 } }), pose(2)];
    const watching = (x: number) => ({ poses: at(x), mySlot: -1, listener }); // a wall has attacker -1, which is also what "no car" is
    t.fx.onHit(hit({ victim: 1, attacker: -1, j: 25 }), watching(80));
    const far = t.fx.shake.level;
    expect(far).toBeLessThan(0.05);
    t.fx.shake.reset();
    t.fx.onHit(hit({ victim: 1, attacker: -1, j: 25, tick: 101 }), watching(4));
    expect(t.fx.shake.level).toBeGreaterThan(far * 10); // the same hit close to the camera still shakes it
  });

  it('takes a part off when a side has taken enough, and sends it flying', () => {
    const t = setup();
    t.fx.onHit(hit({ dmg: 6 }), t.frameArgs());
    expect(t.views.get(1)!.hasPart('bumperFront')).toBe(true);
    expect(t.fx.debris.active).toBe(0);
    t.fx.onHit(hit({ dmg: 6, tick: 110 }), t.frameArgs());
    expect(t.views.get(1)!.hasPart('bumperFront')).toBe(false);
    expect(t.fx.debris.active).toBe(1);
  });

  it('leaves the sparks and the sound of a hit on your car to the local prediction when it has just made them', () => {
    const t = setup();
    t.fx.onLocalImpacts([impact(10, 1)], t.frameArgs());
    const sparks = t.sparks();
    const nodes = t.ctxNodes();
    t.fx.onHit(hit({ victim: 0, attacker: 1 }), t.frameArgs()); // the same collision, as the server tells it
    expect(t.sparks()).toBe(sparks);
    expect(t.ctxNodes()).toBe(nodes);
    expect(t.fx.damage.car(0).zones.front).toBe(8); // but the dent and the damage still come from the server
    t.frames(FX.LOCAL_COVERS + 0.5);
    t.fx.onHit(hit({ victim: 0, attacker: 1, tick: 900 }), t.frameArgs()); // nothing local for a while: the server's hit makes its own
    expect(t.sparks()).toBeGreaterThan(0);
  });

  it('treats a wall the same way: a wall hit on your car is covered by the local impact with the wall', () => {
    const t = setup();
    t.fx.onLocalImpacts([impact(12, -1)], t.frameArgs());
    const sparks = t.sparks();
    const nodes = t.ctxNodes();
    t.fx.onHit(hit({ victim: 0, attacker: -1 }), t.frameArgs());
    expect(t.sparks()).toBe(sparks);
    expect(t.ctxNodes()).toBe(nodes);
    expect(t.fx.damage.car(0).zones.front).toBe(8);
  });

  it('does not take touching a car for having touched the wall', () => {
    const t = setup();
    t.fx.onLocalImpacts([impact(12, 1)], t.frameArgs());
    const before = t.sparks();
    t.fx.onHit(hit({ victim: 0, attacker: -1 }), t.frameArgs());
    expect(t.sparks()).toBeGreaterThan(before);
  });

  it('does not make a car worse for hits it is told about twice at different times: damage only ever adds up', () => {
    const t = setup();
    t.fx.onHit(hit({ dmg: 3 }), t.frameArgs());
    t.fx.onHit(hit({ dmg: 4, tick: 200 }), t.frameArgs());
    expect(t.fx.damage.car(1).zones.front).toBe(7);
  });
});

describe('FxDirector impacts of the local car', () => {
  it('makes a couple of sparks for a scrape and no sound, and a shower with a jolt and a crash for a real impact', () => {
    const t = setup();
    const nodes = t.ctxNodes();
    t.fx.onLocalImpacts([impact(COMBAT.SCRAPE_IMPULSE / 1000 + 0.05)], t.frameArgs());
    expect(t.sparks()).toBe(2);
    expect(t.ctxNodes()).toBe(nodes);
    expect(t.fx.shake.level).toBe(0);
    t.fx.onLocalImpacts([impact(12)], t.frameArgs());
    expect(t.sparks()).toBeGreaterThan(20);
    expect(t.ctxNodes()).toBeGreaterThan(nodes);
    expect(t.fx.shake.level).toBeGreaterThan(0.3);
  });

  it('does not play the crash of one collision again on every tick it lasts, but does for the next collision', () => {
    const t = setup();
    t.fx.onLocalImpacts([impact(8)], t.frameArgs());
    const once = t.ctxNodes();
    t.fx.onLocalImpacts([impact(6)], t.frameArgs()); // the next tick of the same collision
    expect(t.ctxNodes()).toBe(once);
    t.frames(FX.CRASH_COOLDOWN + 0.1);
    t.fx.onLocalImpacts([impact(6)], t.frameArgs());
    expect(t.ctxNodes()).toBeGreaterThan(once);
  });

  it('hears a wall as well as a car', () => {
    const t = setup();
    t.fx.onLocalImpacts([impact(15, -1)], t.frameArgs());
    expect(t.sparks()).toBeGreaterThan(10);
  });
});

describe('FxDirector smoke, fire and wrecks', () => {
  it('lets a badly hurt car smoke and then burn, and a healthy one do neither', () => {
    const t = setup();
    t.setPoses([pose(0), pose(1, { hp: 20 }), pose(2, { hp: 90 })]);
    t.frames(1.5);
    expect(t.fx.particles.alive('smoke')).toBeGreaterThan(5);
    expect(t.fx.particles.alive('fire')).toBeGreaterThan(2);
    const healthy = setup();
    healthy.setPoses([pose(0), pose(1, { hp: 90 })]);
    healthy.frames(1.5);
    expect(healthy.fx.particles.alive('smoke')).toBe(0);
    expect(healthy.fx.particles.alive('fire')).toBe(0);
  });

  it('burns a wreck for a few seconds after it goes out, smoulders for a good while, and then stops', () => {
    const t = setup();
    t.fx.onKo(ko({ reason: 'damage' }), t.frameArgs());
    t.setPoses([pose(0), pose(1, { alive: false, hp: 0 })]);
    t.frames(1);
    expect(t.fx.particles.alive('fire')).toBeGreaterThan(3);
    t.frames(FX.WRECK_FIRE_SECONDS + 2);
    expect(t.fx.particles.alive('fire')).toBe(0);
    expect(t.fx.particles.alive('smoke')).toBeGreaterThan(3);
    t.frames(FX.WRECK_SMOKE_SECONDS);
    t.frames(6); // longer than any puff lives
    expect(t.fx.particles.alive('smoke')).toBe(0);
  });

  it('lets a wreck that was already there when we arrived smoulder, without setting it on fire in front of a newcomer', () => {
    const t = setup();
    const nodes = t.ctxNodes();
    t.setPoses([pose(0), pose(1, { alive: false, hp: 0 })]);
    t.frames(2);
    expect(t.fx.particles.alive('fire')).toBe(0);
    expect(t.fx.particles.alive('smoke')).toBeGreaterThan(3);
    expect(t.ctxNodes()).toBe(nodes); // and no thump
  });

  it('gives a car that goes out a burst of fire and smoke and a big thump, unless the player simply left', () => {
    const t = setup();
    const nodes = t.ctxNodes();
    t.fx.onKo(ko({ reason: 'disconnected' }), t.frameArgs());
    expect(t.fx.particles.alive('fire')).toBe(0);
    expect(t.ctxNodes()).toBe(nodes);
    t.fx.onKo(ko(), t.frameArgs());
    expect(t.fx.particles.alive('fire')).toBeGreaterThan(8);
    expect(t.fx.particles.alive('smoke')).toBeGreaterThan(5);
    expect(t.ctxNodes()).toBeGreaterThan(nodes);
  });
});

describe('FxDirector tyre marks and dust', () => {
  const sliding = (slot = 1) => pose(slot, { linvel: { x: 12, y: 0, z: 8 }, throttle: 1 });

  it('leaves marks behind a car that slides and uploads the texture, but not behind one that rolls straight', () => {
    const t = setup();
    t.setPoses([pose(0), sliding()]);
    const uploads = t.uploads;
    t.frames(0.2);
    expect(t.surface.lines).toBeGreaterThan(0);
    expect(t.uploads).toBeGreaterThan(uploads);
    const straight = setup();
    straight.setPoses([pose(0), pose(1, { linvel: { x: 12, y: 0, z: 0 }, throttle: 1 })]);
    straight.frames(0.2);
    expect(straight.surface.lines).toBe(0);
  });

  it('draws a line for each wheel that skids, and kicks up dust from a car that is moving fast on the ground', () => {
    const t = setup();
    t.setPoses([pose(0), sliding()]);
    t.frame();
    t.frame();
    expect(t.surface.lines).toBeGreaterThanOrEqual(4); // four wheels, from the second frame on
    t.frames(0.5);
    expect(t.fx.particles.alive('dust')).toBeGreaterThan(3);
    const slow = setup();
    slow.setPoses([pose(0), pose(1, { linvel: { x: 2, y: 0, z: 0 } })]);
    slow.frames(0.5);
    expect(slow.fx.particles.alive('dust')).toBe(0);
    expect(SKID.SLIDE_SPEED).toBeGreaterThan(0);
  });

  it('kicks the dust up from both rear wheels', () => {
    const t = setup();
    t.setPoses([pose(0), pose(1, { linvel: { x: 14, y: 0, z: 0 } })]);
    t.frames(1);
    const rings = Reflect.get(t.fx.particles, 'rings') as Map<string, { origin: Float32Array; birth: Float32Array }>;
    const dust = rings.get('dust')!;
    const zs = Array.from({ length: dust.birth.length }, (_, i) => (dust.birth[i]! > -1e8 ? dust.origin[i * 3 + 2]! : null)).filter((z): z is number => z !== null);
    expect(zs.some((z) => z > 0.4)).toBe(true);
    expect(zs.some((z) => z < -0.4)).toBe(true);
  });

  it('makes no marks in the air', () => {
    const t = setup();
    t.setPoses([pose(0), pose(1, { linvel: { x: 12, y: 0, z: 9 }, grounded: false })]);
    t.frames(0.3);
    expect(t.surface.lines).toBe(0);
  });
});

describe('FxDirector rounds and newcomers', () => {
  it('makes every car whole and the ground clean again when a new round starts', () => {
    const t = setup();
    const whole = t.shape(1);
    t.fx.onHit(hit({ dmg: 30 }), t.frameArgs());
    t.setPoses([pose(0), pose(1, { linvel: { x: 12, y: 0, z: 8 } })]);
    t.frames(0.3);
    expect(t.views.get(1)!.hasPart('hood')).toBe(false);
    expect(t.fx.debris.active).toBeGreaterThan(0);
    t.fx.shake.add(1);
    t.fx.onRoster();
    expect(t.views.get(1)!.hasPart('hood')).toBe(true);
    expect(t.shape(1).map((v, i) => Math.abs(v - whole[i]!))).toEqual(whole.map(() => 0));
    expect(t.fx.debris.active).toBe(0);
    expect(['spark', 'smoke', 'fire', 'dust'].map((k) => t.fx.particles.alive(k as 'spark'))).toEqual([0, 0, 0, 0]);
    expect(t.surface.cleared).toBeGreaterThanOrEqual(1);
    expect(t.fx.shake.level).toBe(0);
    expect(t.fx.damage.car(1).zones.front).toBe(0);
  });

  it('dents and strips the cars of a newcomer as the players saw them, silently', () => {
    const t = setup();
    const log = [hit({ tick: 10, dmg: 12 }), hit({ tick: 20, dmg: 20 }), hit({ tick: 30, victim: 2, attacker: 1, zone: 'left', dmg: 25, p: [0, 0, -1] })];
    const whole = t.shape(1);
    const nodes = t.ctxNodes();
    t.fx.onWelcome(log);
    expect(t.shape(1)).not.toEqual(whole);
    expect(t.views.get(1)!.hasPart('bumperFront')).toBe(false);
    expect(t.views.get(2)!.hasPart('doorLeft')).toBe(false);
    expect(t.fx.debris.active).toBe(0);
    expect(t.sparks()).toBe(0);
    expect(t.ctxNodes()).toBe(nodes);
    // and they end up exactly like a client that saw the same hits live
    const live = setup();
    for (const h of log) live.fx.onHit(h, live.frameArgs());
    expect(t.shape(1)).toEqual(live.shape(1));
    expect(t.shape(2)).toEqual(live.shape(2));
  });

  it('copes with a hit on a car it has no view for, and with odd frame times', () => {
    const t = setup();
    expect(() => t.fx.onHit(hit({ victim: 6 }), t.frameArgs())).not.toThrow();
    for (const dt of [0, -1, Number.NaN, 1e9]) expect(() => t.frame(dt)).not.toThrow();
    expect(() => t.fx.dispose()).not.toThrow();
  });

  it('keeps an engine going for every running car through the audio engine, and silences a wreck', () => {
    const t = setup(); // the first frame started three engines of five nodes each
    expect(t.ctx.nodes.filter((n) => n.started > 0)).toHaveLength(6);
    t.setPoses([pose(0), pose(1, { linvel: { x: 10, y: 0, z: 0 }, throttle: 1 }), pose(2, { alive: false })]);
    t.frame();
    expect(t.ctx.nodes.filter((n) => n.started > 0 && n.stopped > 0)).toHaveLength(2); // the two oscillators of the wreck's engine
  });
});
