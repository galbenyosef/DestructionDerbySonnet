# Wreckyard Plan 6 — Destruction and Juice (M5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make crashes look and sound like crashes. Cars crumple where they are hit, the same way on every screen; bumpers, hoods, trunks and doors come off and fly; impacts throw sparks and dust and shake the camera; hurt cars smoke and burn, and wrecks burn and smoulder; sliding tyres leave marks; every car has an engine sound and crashes have a thud; the stadium has a crowd, stacks of tyres and floodlights that glow. What happens to **your** car is felt at once, not after the round trip.

**Architecture:** Nothing here decides anything about the game. The server already sends a `hit` message for every impact (Plan 4); every client turns it into the same dent on the same mesh (a dent depends on nothing but the message) and takes parts off by the damage each side has taken. A newcomer's welcome carries the round's latest hits (protocol version 3) so it can put the same dents and missing parts on the cars silently. Impacts of your own car come from the local prediction's live ticks (`Simulation.contacts()`, read-only), never from replays. An `FxDirector` is told what happens and orchestrates GPU particle pools (sparks, fire, smoke, dust in ring buffers animated by their birth time), flying debris, tyre marks drawn into one texture, trauma-based camera shake and synthesised Web Audio; the scene is drawn through a bloom pass.

**Tech Stack:** as Plans 1-5. three's post-processing add-ons (`EffectComposer`, `RenderPass`, `UnrealBloomPass`, `OutputPass`) ship with three; the Web Audio API is the browser's. No new dependencies, no sound or image files.

**Spec:** `docs/superpowers/specs/2026-09-28-wreckyard-design.md` — "Client experience" (Look, Cars, Destruction, Camera, Audio) and the M5 row. **Prerequisite:** Plan 5 complete and reviewed (branch `plan-5-match-screen`, HEAD `06f49ed`, 469 tests). This plan starts on a new branch cut from it.

**Scope notes:**
- All of M5 is here: dents, parts and debris, particles, skid marks, shake, bloom, audio and the arena dressing (crowd and tyre stacks; the floodlights and the fog exist since Plan 1).
- Deviations from the spec text, each with its reason: (1) the newcomer's "capped dent log" rides in the welcome message, which changes its shape, so the protocol version becomes 3 (an old cached client is told to reload); (2) the painted number on the cars is not built (a canvas decal for a detail nobody can read at speed; a Plan 7 polish item if wanted); (3) **the horn is local**: there is no horn on the wire, so other players cannot hear yours; (4) the spec's "≥ 55 fps with 8 cars on this Mac" could not be measured on a real display here (the automation browser is capped at 50 Hz); the rehearsal measured what a processor spends (2 ms of script per frame, 280 draw calls) and `?bloom=0` removes the most expensive pass; (5) the crowd is silhouettes in jersey colours on a lit bowl, drawn as one instanced mesh.
- Nothing here changes the shared simulation, the server's rules or the wire apart from the welcome's hit log: `npm run hash` still prints `10c3a72a`, and no effect ever sends anything to the server.
- Sound levels and the sound design are first guesses: the sounds were checked as graphs of nodes and numbers, not listened to.

## How a hit becomes what you see (read this first)

| What happens | Where it comes from | Dent and parts | Sparks, dust, sound, shake |
|---|---|---|---|
| **Your car** touches a car or a wall | the local prediction's live tick (`takeImpacts`) | (they come with the server's message) | at once |
| Any hit | the server's `hit` message, every client | the victim's dent (deterministic) and any parts that come off | only when neither car is yours, or your local impact did not already cover it (1.5 s) |
| A car goes out | `ko` | — | a burst of fire and smoke and a thump; then smoke |
| A player joins mid-round | `welcome.dents` (up to 64 hits, oldest first) | replayed, silently | none, and no debris |
| A new round | `roster` | every car whole, marks wiped | — |

A **dent** is a set of moved vertices: the body is subdivided boxes with flat shading, so no normals are recomputed. Its irregularity comes from an integer hash of each vertex's rest position, so two clients that are told the same hits in the same order build the same wreck bit for bit, and the duplicated vertices along the edges of a box move together. **Parts** come off by the damage each side has taken this round (`PART_RULES`: bumper at 10 HP, hood or trunk at 28, doors at 20). **Debris is cosmetic:** it is thrown differently on every screen and no car touches it.

**Why your own impacts come from the prediction:** a `hit` message arrives after a round trip and 3-33 ticks after the collision began. The local simulation already contains the collision; reading its contacts costs nothing and is read-only. The only trap is replays: after each snapshot the predictor re-simulates up to 240 ticks, passing through the same collision again, so contacts are read on the live tick only.

## Rehearsal findings (measured before this plan was written)

I rehearsed everything below in a scratch copy of the Plan 5 code (the reviewed version), with a production build served on a private port, one human in Chromium and eight cars, and a scratch page that puts cars with different damage in front of a camera; then I executed this plan text against a fresh copy to check that it reproduces the rehearsal file for file.

- **The crumple works.** A car with two front hits shows an irregular, faceted dent in the bonnet and bumper; a car hit on every side is missing its bumpers, hood and doors and looks mangled; the undamaged one is smooth. A charred wreck is dark grey with its parts gone.
- **All the effects were seen in a live eight-car round:** sparks at a contact (174 alive at once while two cars ground together), a hood spinning through the air, debris lying on the ground, smoke plumes from hurt cars, fire, dust behind fast cars, dark tyre marks curving behind a car that slides with the handbrake, the red edge flash, the crowd, glowing floodlights and headlights.
- **Cost, eight cars, everything on:** about 280 draw calls and 130 000 triangles a frame (the shadow pass included), 2.0 ms of script per frame on average (2.6 at most). The automation browser is capped at 50 frames a second and held it throughout, so the frame rate cannot be judged here; `?bloom=0` turns the bloom pass off. Sound: after a real key press the audio context is `running`, M mutes, no console warnings.
- **Defects the rehearsal caught, now pinned by tests:** (1) a dent rewrote, and re-uploaded to the GPU, every mesh of the car, including ones it never touched (and turned every `-0` into `+0`): a mesh the dent misses is now left alone; (2) birth times are stored as 32-bit floats, so a particle emitted "now" could be "not born yet" for a hair (`Math.fround` on the comparison); (3) the server's hit for a wall hit on your car was not recognised as already covered by your local impact with the wall (the wall is `other = -1`); (4) dust came from one rear wheel only; (5) with the bloom threshold below white, the plain white name tags glowed (the threshold is 1.05).
- **A Plan 5 reviewer's notes this plan follows:** camera shake is applied after the camera was chosen and placed and before the scene is drawn, and never mutates the spectator camera's internal vectors; the anti-stall drain has no message, so the smoke and fire follow the snapshot's HP, not the hit messages.

## Global Constraints

- Everything in Plans 1-5's Global Constraints still applies (single package, relative imports, exact pins, axes, deterministic simulation path, quantised inputs, `freezeTuning`, commits only because the user opted in).
- **Cosmetic only.** No effect changes what the simulation or the server does, and none sends anything. `npm run hash` prints `10c3a72a`.
- Effects fire from live ticks and from server messages, **never from a replay**.
- Fixed pools: particles live in ring buffers, debris in a fixed set of meshes; nothing grows during play. GPU resources, the audio context and event listeners are released when the game ends.
- Everything is generated in code: no sound files, no image files. Sound starts only after a user gesture, and the game is silent, without failing, where there is no Web Audio.
- The wire changes once: `NET.PROTOCOL_VERSION` becomes 3 and the welcome message gains `dents` (a list of at most `NET.MAX_HIT_LOG` = 64 `hit` messages).
- DOM and WebGL code stays in `gameClient.ts`, `scene.ts` and the browser-facing classes (`CanvasMarks`, `AudioEngine`'s default context); the logic behind them takes its surfaces as parameters and is tested in Node.
- The user's own `npm run dev` may be running on ports 8080/5173: never stop it. Use `PORT` with another port for anything that needs a server, and do not start a second Vite next to it.

## Review Focus

1. **A newcomer to a round in progress:** the cars carry the same dents and missing parts as everyone sees, there is no burst of sound, sparks or flying debris at the moment of joining, and an empty log or a full one (64 hits) is fine. → Task 37 (`roomCombat.test.ts`, `protocol.test.ts`), Task 44 (`fx.test.ts`).
2. **The same collision must not fire twice:** your local impact and the server's message for it; a replay after a snapshot; walls as well as cars; and `?net=interp` (no local prediction) must still show effects. → Task 43 (`localImpacts.test.ts`), Task 44.
3. **Round boundaries and long sessions:** dents, parts, debris, particles, marks, shake and the damage book are reset at every round; pools never grow; GPU resources, the audio context and listeners are released on dispose. → Tasks 38-41, 44-45.
4. **Broken or odd input:** NaN or infinite positions and numbers, a hit for a car that has no view, zero, negative or huge frame times, log entries that are not valid hits, a browser without Web Audio or before any gesture. → Tasks 36, 37, 39-41, 44.
5. **A full room:** eight cars with every effect and the bloom pass do bounded work per frame; the glow can be switched off. → Tasks 39, 42, 45.

## File Structure

| File | Responsibility |
|---|---|
| `src/client/game/dents.ts`, `carDamage.ts` (new) | a hit becomes a deterministic dent; the damage each side has taken decides which parts come off |
| `src/shared/constants.ts`, `protocol.ts`, `src/server/room.ts`, `app.ts` (modify) | protocol 3: the welcome carries the round's latest hits |
| `src/client/game/carView.ts` (modify) | bodywork of subdivided boxes, detachable parts, `dent`, `detach`, `restore` |
| `src/client/game/particles.ts`, `debris.ts` (new) | GPU particle pools in ring buffers; flying debris |
| `src/client/game/skidMarks.ts`, `shake.ts` (new) | tyre marks in one texture; trauma-based camera shake |
| `src/client/game/audioParams.ts`, `audio.ts` (new) | the sound design as numbers; the Web Audio engine |
| `src/client/game/dressing.ts` (new), `scene.ts` (modify) | stands, crowd, tyre stacks; bloom pass and draw-call counting |
| `src/client/net/prediction.ts`, `session.ts` (modify) | the local car's impacts from live ticks; draw poses carry throttle, handbrake, ground contact |
| `src/client/game/fx.ts` (new) | the effects director |
| `src/client/game/gameClient.ts`, `main.ts`, `ui/menu.ts`, `README.md` (modify) | wiring, `H` and `M`, `?bloom=0`, docs |
| `tests/…` | one file per new module, `tests/helpers/fakeAudio.ts`, and additions to the protocol, room, car view and session tests |

---

### Task 36: Dents and lost parts: the model

**Files:**
- Create: `src/client/game/dents.ts`, `src/client/game/carDamage.ts`
- Test: `tests/client/dents.test.ts`, `tests/client/carDamage.test.ts`

**Interfaces:**
- Consumes: `HitMessage` (protocol 2, Plan 4), `CAR.HALF`, `clamp`, `Vec3`, `Zone`, three.js buffer geometry.
- Produces: `DENT`, `Dent`, `dentFromHit(hit)`, `hash3(seed, a, b, c)`, `accumulateDent(rest, raw, origin, dent)`, `DentSurface(geometry, origin)` with `apply(dent)` / `reset()`. `PartId`, `PART_RULES`, `HitOutcome {dent, lost}`, `CarDamage.add(hit)`, `DamageBook` with `car(slot)`, `onHit(hit)`, `reset()`. Tasks 38 and 44 use them.

- [ ] **Step 1: Write the failing tests**

`dents.test.ts` pins how a hit becomes a dent (deeper and wider for harder hits, kept on the body, seeded by the event), and how a dent moves a mesh: it pushes the surface in at the hit and nowhere else, moves the duplicated vertices of a box edge together so the surface does not tear, never pushes a point further than 0.45 m however many hits, gives the same shape whichever order two dents are added in, gives two cars that see the same hits **exactly** the same shape, and does not touch (or re-upload) a mesh the dent missed. `carDamage.test.ts` pins which parts come off when, and that a newcomer replaying a log ends where a live client is.

Create `tests/client/dents.test.ts`:

<!-- op {"kind": "create", "path": "tests/client/dents.test.ts"} -->
```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DENT, DentSurface, accumulateDent, dentFromHit, hash3, type Dent } from '../../src/client/game/dents';

const hit = (over: Partial<Parameters<typeof dentFromHit>[0]> = {}): Parameters<typeof dentFromHit>[0] => ({
  tick: 100,
  victim: 1,
  attacker: 2,
  dmg: 10,
  p: [2.3, -0.3, 0],
  ...over,
});
/** The lower body of a car as the client builds it: a box 4.5 x 0.6 x 1.95 whose middle is 0.15 m below the chassis centre. */
const body = () => new THREE.BoxGeometry(4.5, 0.6, 1.95, 18, 3, 8);
const ORIGIN = { x: 0, y: -0.15, z: 0 };
const positions = (g: THREE.BufferGeometry): number[] => Array.from(g.getAttribute('position').array as Float32Array);

describe('dentFromHit', () => {
  it('makes deeper and wider dents for harder hits, within limits', () => {
    const small = dentFromHit(hit({ dmg: 1 }));
    const medium = dentFromHit(hit({ dmg: 10 }));
    const huge = dentFromHit(hit({ dmg: 400 }));
    expect(small.depth).toBeGreaterThanOrEqual(DENT.MIN_DEPTH);
    expect(medium.depth).toBeGreaterThan(small.depth);
    expect(huge.depth).toBe(DENT.MAX_DEPTH);
    expect(medium.radius).toBeGreaterThan(small.radius);
    expect(huge.radius).toBe(DENT.MAX_RADIUS);
  });

  it('puts the dent where the contact was, and keeps it on the body', () => {
    expect(dentFromHit(hit({ p: [2.3, -0.3, 0.4] }))).toMatchObject({ x: 2.3, y: -0.3, z: 0.4 });
    expect(dentFromHit(hit({ p: [9, -9, 9] }))).toMatchObject({ x: 2.3, y: -0.5, z: 1 });
  });

  it('copes with broken numbers', () => {
    const d = dentFromHit(hit({ dmg: Number.NaN, p: [Number.NaN, Number.POSITIVE_INFINITY, 0] }));
    for (const v of [d.x, d.y, d.z, d.depth, d.radius]) expect(Number.isFinite(v)).toBe(true);
    expect(d.depth).toBe(DENT.MIN_DEPTH);
  });

  it('seeds a dent by its event: the same event always, another event another seed', () => {
    expect(dentFromHit(hit()).seed).toBe(dentFromHit(hit()).seed);
    const seeds = new Set([hit(), hit({ tick: 101 }), hit({ victim: 3 }), hit({ attacker: -1 })].map((h) => dentFromHit(h).seed));
    expect(seeds.size).toBe(4);
  });
});

describe('hash3', () => {
  it('is repeatable, stays in [0, 1) and spreads evenly enough', () => {
    expect(hash3(7, 1, 2, 3)).toBe(hash3(7, 1, 2, 3));
    let sum = 0;
    for (let i = 0; i < 2000; i++) {
      const v = hash3(12345, i, i * 3, -i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 2000).toBeGreaterThan(0.45);
    expect(sum / 2000).toBeLessThan(0.55);
  });
});

describe('DentSurface', () => {
  const dent = (over: Partial<Dent> = {}): Dent => ({ ...dentFromHit(hit()), ...over });

  it('pushes the surface in at the hit and leaves the far end of the car alone', () => {
    const g = body();
    const before = positions(g);
    new DentSurface(g, ORIGIN).apply(dent());
    const after = positions(g);
    let deepest = 0;
    let movedFar = 0;
    for (let i = 0; i < after.length; i += 3) {
      const x = before[i]!;
      const moved = Math.hypot(after[i]! - x, after[i + 1]! - before[i + 1]!, after[i + 2]! - before[i + 2]!);
      if (x > 2) deepest = Math.max(deepest, moved);
      if (x < 0) movedFar = Math.max(movedFar, moved);
    }
    expect(deepest).toBeGreaterThan(0.1); // a 10 HP hit is 0.2 m deep, times an irregular 0.6-1.4
    expect(deepest).toBeLessThan(0.4);
    expect(movedFar).toBe(0);
    // a point in the middle of the front face went backwards
    const at = before.findIndex((v, i) => i % 3 === 0 && Math.abs(v - 2.25) < 1e-6 && Math.abs(before[i + 2]!) < 1e-6 && Math.abs(before[i + 1]! + 0.3) < 1e-6);
    expect(after[at]!).toBeLessThan(before[at]! - 0.05);
  });

  it('moves the duplicated vertices along the edges of a box together, so the surface does not tear', () => {
    const g = body();
    new DentSurface(g, ORIGIN).apply(dent({ x: 2.2, y: 0.1, z: 0.9 }));
    const now = positions(g);
    const seen = new Map<string, number[]>();
    const rest = positions(body());
    let pairs = 0;
    for (let i = 0; i < rest.length; i += 3) {
      const key = `${rest[i]},${rest[i + 1]},${rest[i + 2]}`;
      const there = seen.get(key);
      if (there) {
        pairs++;
        expect([now[i], now[i + 1], now[i + 2]]).toEqual(there);
      } else seen.set(key, [now[i]!, now[i + 1]!, now[i + 2]!]);
    }
    expect(pairs).toBeGreaterThan(50);
  });

  it('never pushes a point further than MAX_TOTAL, however many hits it takes', () => {
    const g = body();
    const surface = new DentSurface(g, ORIGIN);
    for (let i = 0; i < 80; i++) surface.apply(dentFromHit(hit({ tick: i, dmg: 30 })));
    const before = positions(body());
    const after = positions(g);
    let most = 0;
    for (let i = 0; i < after.length; i += 3) most = Math.max(most, Math.hypot(after[i]! - before[i]!, after[i + 1]! - before[i + 1]!, after[i + 2]! - before[i + 2]!));
    expect(most).toBeLessThanOrEqual(DENT.MAX_TOTAL + 1e-5);
    expect(most).toBeGreaterThan(DENT.MAX_TOTAL - 1e-3); // and the limit was really reached
  });

  it('gives the same shape whichever order two dents are added in', () => {
    const a = dentFromHit(hit({ tick: 10, p: [2.3, 0, -0.5] }));
    const b = dentFromHit(hit({ tick: 11, p: [2.3, -0.2, 0.6], dmg: 6 }));
    const one = body();
    const other = body();
    const s1 = new DentSurface(one, ORIGIN);
    s1.apply(a);
    s1.apply(b);
    const s2 = new DentSurface(other, ORIGIN);
    s2.apply(b);
    s2.apply(a);
    const p1 = positions(one);
    const p2 = positions(other);
    for (let i = 0; i < p1.length; i++) expect(Math.abs(p1[i]! - p2[i]!)).toBeLessThan(1e-5);
  });

  it('crumples two cars that see the same hits exactly the same way', () => {
    const hits = [hit({ tick: 5 }), hit({ tick: 9, p: [-2.3, -0.3, 0.3], dmg: 4 }), hit({ tick: 40, attacker: -1, p: [0.4, 0, 1], dmg: 15 })];
    const mine = body();
    const yours = body();
    const s1 = new DentSurface(mine, ORIGIN);
    const s2 = new DentSurface(yours, ORIGIN);
    for (const h of hits) {
      s1.apply(dentFromHit(h));
      s2.apply(dentFromHit(h));
    }
    expect(positions(mine)).toEqual(positions(yours));
    expect(positions(mine)).not.toEqual(positions(body()));
  });

  it('is undamaged again after a reset', () => {
    const g = body();
    const surface = new DentSurface(g, ORIGIN);
    surface.apply(dent());
    expect(positions(g)).not.toEqual(positions(body()));
    surface.reset();
    const fresh = positions(body());
    expect(positions(g).map((v, i) => Math.abs(v - fresh[i]!))).toEqual(fresh.map(() => 0));
  });

  it('says how many vertices a dent reached, and does not touch a mesh it missed', () => {
    const rest = Float32Array.from(positions(body()));
    const raw = new Float32Array(rest.length);
    expect(accumulateDent(rest, raw, ORIGIN, dent({ x: -2.3, radius: 0.5 }))).toBeGreaterThan(0);
    expect(accumulateDent(rest, new Float32Array(rest.length), ORIGIN, dent({ x: 40, radius: 1 }))).toBe(0);
    const g = body();
    const array = g.getAttribute('position') as THREE.BufferAttribute;
    const version = array.version;
    new DentSurface(g, ORIGIN).apply(dent({ x: 40, radius: 1 }));
    expect(array.version).toBe(version); // nothing changed, so nothing to upload
    new DentSurface(g, ORIGIN).apply(dent());
    expect(array.version).toBeGreaterThan(version); // a dent that lands is uploaded
  });

  it('leaves vertices outside the radius exactly where they were', () => {
    const rest = Float32Array.from(positions(body()));
    const raw = new Float32Array(rest.length);
    const d = dent({ radius: 0.5 });
    accumulateDent(rest, raw, ORIGIN, d);
    let touched = 0;
    for (let i = 0; i < rest.length; i += 3) {
      const away = Math.hypot(rest[i]! - d.x, rest[i + 1]! + ORIGIN.y - d.y, rest[i + 2]! - d.z);
      const moved = raw[i] !== 0 || raw[i + 1] !== 0 || raw[i + 2] !== 0;
      if (away >= d.radius) expect(moved).toBe(false);
      if (moved) touched++;
    }
    expect(touched).toBeGreaterThan(0);
  });
});
```

Create `tests/client/carDamage.test.ts`:

<!-- op {"kind": "create", "path": "tests/client/carDamage.test.ts"} -->
```ts
import { describe, expect, it } from 'vitest';
import { CarDamage, DamageBook, PART_RULES } from '../../src/client/game/carDamage';
import type { HitMessage } from '../../src/shared/protocol';
import type { Zone } from '../../src/shared/types';

const hit = (over: Partial<HitMessage> = {}): HitMessage => ({
  t: 'hit', tick: 50, victim: 1, attacker: 0, dmg: 6, hp: 90, zone: 'front', j: 5, p: [2.3, -0.3, 0], ...over,
});

describe('CarDamage', () => {
  it('adds the damage to the side that took it and takes a part off once that side has taken enough', () => {
    const car = new CarDamage();
    expect(car.add(hit({ dmg: 6 })).lost).toEqual([]);
    expect(car.zones.front).toBe(6);
    expect(car.add(hit({ dmg: 5 })).lost).toEqual(['bumperFront']); // 11 HP in front
    expect(car.add(hit({ dmg: 20 })).lost).toEqual(['hood']); // 31 HP in front
    expect([...car.lost].sort()).toEqual(['bumperFront', 'hood']);
  });

  it('takes a part off once, however much more damage that side takes', () => {
    const car = new CarDamage();
    car.add(hit({ dmg: 15 }));
    for (let i = 0; i < 5; i++) expect(car.add(hit({ dmg: 1 })).lost).toEqual([]);
    expect(car.lost.has('bumperFront')).toBe(true);
  });

  it('counts each side on its own: a knock on the rear does not loosen the hood', () => {
    const car = new CarDamage();
    car.add(hit({ zone: 'rear', dmg: 12, p: [-2.3, -0.3, 0] }));
    expect([...car.lost]).toEqual(['bumperRear']);
    car.add(hit({ zone: 'left', dmg: 25, p: [0, 0, -1] }));
    car.add(hit({ zone: 'right', dmg: 21, p: [0, 0, 1] }));
    expect([...car.lost].sort()).toEqual(['bumperRear', 'doorLeft', 'doorRight']);
    expect(car.zones).toEqual({ front: 0, rear: 12, left: 25, right: 21 });
  });

  it('has a rule for every side, and the parts come off in a sensible order (bumper before hood, bumper before trunk)', () => {
    const zones = new Set<Zone>(PART_RULES.map((r) => r.zone));
    expect(zones).toEqual(new Set<Zone>(['front', 'rear', 'left', 'right']));
    const at = (id: string) => PART_RULES.find((r) => r.id === id)!.at;
    expect(at('bumperFront')).toBeLessThan(at('hood'));
    expect(at('bumperRear')).toBeLessThan(at('trunk'));
    expect(new Set(PART_RULES.map((r) => r.id)).size).toBe(PART_RULES.length);
  });

  it('ignores a broken damage number but still makes a dent', () => {
    const car = new CarDamage();
    const outcome = car.add(hit({ dmg: Number.NaN }));
    expect(car.zones.front).toBe(0);
    expect(Number.isFinite(outcome.dent.depth)).toBe(true);
    expect(outcome.lost).toEqual([]);
  });
});

describe('DamageBook', () => {
  it('keeps every car\'s damage apart and forgets it all when the round is over', () => {
    const book = new DamageBook();
    book.onHit(hit({ victim: 1, dmg: 12 }));
    book.onHit(hit({ victim: 2, dmg: 3 }));
    expect(book.car(1).lost.has('bumperFront')).toBe(true);
    expect(book.car(2).lost.size).toBe(0);
    book.reset();
    expect(book.car(1).zones.front).toBe(0);
    expect(book.car(1).lost.size).toBe(0);
  });

  it('replays a log of hits to the state a client that saw them live has', () => {
    const log = [hit({ tick: 10, dmg: 7 }), hit({ tick: 12, victim: 2, zone: 'left', dmg: 22, p: [0, 0, -1] }), hit({ tick: 30, dmg: 9 }), hit({ tick: 44, victim: 2, zone: 'rear', dmg: 3, p: [-2.3, 0, 0] })];
    const live = new DamageBook();
    const newcomer = new DamageBook();
    const liveOutcomes = log.map((h) => live.onHit(h));
    const replayed = log.map((h) => newcomer.onHit(h));
    expect(replayed).toEqual(liveOutcomes);
    for (const slot of [1, 2]) {
      expect(newcomer.car(slot).zones).toEqual(live.car(slot).zones);
      expect([...newcomer.car(slot).lost]).toEqual([...live.car(slot).lost]);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/client/dents.test.ts tests/client/carDamage.test.ts`
Expected: FAIL — both files fail to load: they import `src/client/game/dents` and `src/client/game/carDamage`, which do not exist yet.

<!-- check {"cmd": "npx vitest run tests/client/dents.test.ts tests/client/carDamage.test.ts", "outcome": "fail", "match": "Failed to resolve import|Cannot find module|Does the file exist"} -->

- [ ] **Step 3: Implement**

`src/client/game/dents.ts` — the crumple. A dent depends on nothing but the `hit` message (its tick, victim, attacker, damage and contact point), so every client that is told the same hits in the same order crumples a car identically. The irregularity comes from an integer hash of the vertex's rest position, not of its index or of a random generator that has been used before.

Create `src/client/game/dents.ts`:

<!-- op {"kind": "create", "path": "src/client/game/dents.ts"} -->
```ts
import * as THREE from 'three';
import { CAR } from '../../shared/constants';
import { clamp } from '../../shared/math';
import type { HitMessage } from '../../shared/protocol';
import type { Vec3 } from '../../shared/types';

/** How a car crumples. Depths and radii are in metres, in the car's own frame (forward +X, up +Y, right +Z). */
export const DENT = {
  /** depth = DEPTH_PER_HP * damage^0.75, kept between MIN_DEPTH and MAX_DEPTH. */
  DEPTH_PER_HP: 0.035,
  MIN_DEPTH: 0.04,
  MAX_DEPTH: 0.32,
  /** radius = MIN_RADIUS + RADIUS_PER_HP * damage, kept at most MAX_RADIUS. */
  MIN_RADIUS: 0.8,
  RADIUS_PER_HP: 0.045,
  MAX_RADIUS: 1.9,
  /** However many hits a car takes, no point of it moves further than this from where it started. */
  MAX_TOTAL: 0.45,
} as const;

/** One dent: where (car frame), how deep, how wide, and the seed of its irregularity. */
export interface Dent {
  x: number;
  y: number;
  z: number;
  depth: number;
  radius: number;
  seed: number;
}

const finite = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);

/**
 * The dent a `hit` message makes. It depends on nothing but the message, so every client that sees the same hits (in the same
 * order) crumples the car the same way; the seed is the tick, the victim and the attacker.
 */
export function dentFromHit(h: Pick<HitMessage, 'tick' | 'victim' | 'attacker' | 'dmg' | 'p'>): Dent {
  const damage = Math.max(0, finite(h.dmg, 0));
  const [px, py, pz] = h.p;
  return {
    x: clamp(finite(px, 0), -CAR.HALF.x, CAR.HALF.x),
    y: clamp(finite(py, 0), -CAR.HALF.y, CAR.HALF.y),
    z: clamp(finite(pz, 0), -CAR.HALF.z, CAR.HALF.z),
    depth: clamp(DENT.DEPTH_PER_HP * damage ** 0.75, DENT.MIN_DEPTH, DENT.MAX_DEPTH),
    radius: clamp(DENT.MIN_RADIUS + DENT.RADIUS_PER_HP * damage, DENT.MIN_RADIUS, DENT.MAX_RADIUS),
    seed: (Math.imul(h.tick | 0, 73856093) ^ Math.imul(h.victim | 0, 19349663) ^ Math.imul((h.attacker | 0) + 1, 83492791)) >>> 0,
  };
}

/** A repeatable number in [0, 1) from a seed and three integers (integer arithmetic only). */
export function hash3(seed: number, a: number, b: number, c: number): number {
  let h = (seed ^ Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ Math.imul(c, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Adds a dent to `raw`, the summed displacement of every vertex (x, y, z triples), for vertices whose rest positions are in
 * `rest` (a mesh whose origin sits at `origin` in the car frame). Vertices push toward the middle of the body, most at the hit and
 * fading to nothing at the radius, each by an irregular amount. The irregularity comes from the vertex's position, not its index,
 * so the duplicated vertices along the edges of a box move together and the surface does not tear. Returns how many vertices the dent
 * reached (0 when it missed the mesh altogether).
 */
export function accumulateDent(rest: Float32Array, raw: Float32Array, origin: Vec3, dent: Dent): number {
  let dx = -dent.x;
  let dy = -dent.y * 0.3;
  let dz = -dent.z;
  let length = Math.hypot(dx, dy, dz);
  if (length < 1e-6) {
    dx = -1; // a hit dead in the middle: push it backwards
    dy = 0;
    dz = 0;
    length = 1;
  }
  dx /= length;
  dy /= length;
  dz /= length;
  const r2 = dent.radius * dent.radius;
  let touched = 0;
  for (let i = 0; i < rest.length; i += 3) {
    const cx = rest[i]! + origin.x;
    const cy = rest[i + 1]! + origin.y;
    const cz = rest[i + 2]! + origin.z;
    const ex = cx - dent.x;
    const ey = cy - dent.y;
    const ez = cz - dent.z;
    const d2 = ex * ex + ey * ey + ez * ez;
    if (d2 >= r2) continue;
    touched++;
    const t = 1 - d2 / r2;
    const w = t * t;
    const ix = Math.round(cx * 1000);
    const iy = Math.round(cy * 1000);
    const iz = Math.round(cz * 1000);
    const push = dent.depth * w * (0.6 + 0.8 * hash3(dent.seed, ix, iy, iz));
    const scatter = dent.depth * w * 0.25;
    raw[i] = raw[i]! + dx * push + scatter * (hash3(dent.seed ^ 0x51ed270b, ix, iy, iz) - 0.5);
    raw[i + 1] = raw[i + 1]! + dy * push + scatter * (hash3(dent.seed ^ 0x2f6b1a93, ix, iy, iz) - 0.5);
    raw[i + 2] = raw[i + 2]! + dz * push + scatter * (hash3(dent.seed ^ 0x7c3d9e61, ix, iy, iz) - 0.5);
  }
  return touched;
}

/** The summed displacement of a vertex, cut down to DENT.MAX_TOTAL long if it is longer. */
function cappedOffset(raw: Float32Array, i: number, out: [number, number, number]): void {
  const x = raw[i]!;
  const y = raw[i + 1]!;
  const z = raw[i + 2]!;
  const len = Math.hypot(x, y, z);
  const k = len > DENT.MAX_TOTAL ? DENT.MAX_TOTAL / len : 1;
  out[0] = x * k;
  out[1] = y * k;
  out[2] = z * k;
}

/** A mesh geometry that can be dented: remembers its undamaged shape and the dents added to it. */
export class DentSurface {
  private readonly rest: Float32Array;
  private readonly raw: Float32Array;

  /** `origin` is where the mesh sits in the car frame (meshes are not rotated). */
  constructor(
    readonly geometry: THREE.BufferGeometry,
    private readonly origin: Vec3,
  ) {
    this.rest = Float32Array.from(geometry.getAttribute('position').array as ArrayLike<number>);
    this.raw = new Float32Array(this.rest.length);
  }

  /** Adds a dent; a mesh the dent does not reach is left alone (and not uploaded to the GPU again). */
  apply(dent: Dent): void {
    if (accumulateDent(this.rest, this.raw, this.origin, dent) > 0) this.write();
  }

  /** Back to the undamaged shape (a new round). */
  reset(): void {
    this.raw.fill(0);
    this.write();
  }

  private write(): void {
    const position = this.geometry.getAttribute('position');
    const out = position.array as Float32Array;
    const offset: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < out.length; i += 3) {
      cappedOffset(this.raw, i, offset);
      out[i] = this.rest[i]! + offset[0];
      out[i + 1] = this.rest[i + 1]! + offset[1];
      out[i + 2] = this.rest[i + 2]! + offset[2];
    }
    position.needsUpdate = true;
  }
}
```

`src/client/game/carDamage.ts` — which parts come off: the damage each side has taken this round, and a table of thresholds.

Create `src/client/game/carDamage.ts`:

<!-- op {"kind": "create", "path": "src/client/game/carDamage.ts"} -->
```ts
import type { HitMessage } from '../../shared/protocol';
import type { Zone } from '../../shared/types';
import { dentFromHit, type Dent } from './dents';

export type PartId = 'bumperFront' | 'hood' | 'bumperRear' | 'trunk' | 'doorLeft' | 'doorRight';

/** A part comes off once the car has taken this much damage (HP) on that side during the round. */
export const PART_RULES: ReadonlyArray<{ id: PartId; zone: Zone; at: number }> = [
  { id: 'bumperFront', zone: 'front', at: 10 },
  { id: 'hood', zone: 'front', at: 28 },
  { id: 'bumperRear', zone: 'rear', at: 10 },
  { id: 'trunk', zone: 'rear', at: 28 },
  { id: 'doorLeft', zone: 'left', at: 20 },
  { id: 'doorRight', zone: 'right', at: 20 },
];

/** What one hit does to a car's looks: the dent, and the parts that come off because of it. */
export interface HitOutcome {
  dent: Dent;
  lost: PartId[];
}

/** The damage one car has taken this round, side by side, and which of its parts are gone. */
export class CarDamage {
  readonly zones: Record<Zone, number> = { front: 0, rear: 0, left: 0, right: 0 };
  readonly lost = new Set<PartId>();

  add(h: HitMessage): HitOutcome {
    const dent = dentFromHit(h);
    if (Number.isFinite(h.dmg) && h.dmg > 0) this.zones[h.zone] += h.dmg;
    const lost: PartId[] = [];
    for (const rule of PART_RULES) {
      if (!this.lost.has(rule.id) && this.zones[rule.zone] >= rule.at) {
        this.lost.add(rule.id);
        lost.push(rule.id);
      }
    }
    return { dent, lost };
  }
}

/** Every car's damage in the running round, from the `hit` messages (and the log a newcomer is given). */
export class DamageBook {
  private readonly cars = new Map<number, CarDamage>();

  car(slot: number): CarDamage {
    let car = this.cars.get(slot);
    if (!car) {
      car = new CarDamage();
      this.cars.set(slot, car);
    }
    return car;
  }

  onHit(h: HitMessage): HitOutcome {
    return this.car(h.victim).add(h);
  }

  /** A new round: every car is whole again. */
  reset(): void {
    this.cars.clear();
  }
}
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/client/dents.test.ts tests/client/carDamage.test.ts && npm run typecheck`
Expected: PASS — 20 tests; type-check clean.

<!-- check {"cmd": "npx vitest run tests/client/dents.test.ts tests/client/carDamage.test.ts && npm run typecheck", "outcome": "pass", "tests": 20} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(client): deterministic dents and the damage that takes parts off a car"
```

<!-- commit "feat(client): deterministic dents and the damage that takes parts off a car" -->

---

### Task 37: The hit log for newcomers (protocol version 3)

**Files:**
- Modify: `src/shared/constants.ts` (`NET`), `src/shared/protocol.ts`, `src/server/room.ts`, `src/server/app.ts`
- Test: `tests/protocol.test.ts`, `tests/server/room.test.ts`, `tests/server/roomCombat.test.ts`; fixtures in `tests/client/matchState.test.ts` and `tests/scripts/bot.test.ts`

**Interfaces:**
- Consumes: `Room.step` (the `hit` broadcast), `Room.greeting`, `parseServerMessage`, `HitMessage` (Plan 4).
- Produces: `NET.PROTOCOL_VERSION` 3 and `NET.MAX_HIT_LOG` (64); `WelcomeMessage.dents: HitMessage[]`; `Room.greeting(player).dents` (the round's latest hits, oldest first, empty at the start of every round). Tasks 44-45 replay the log on the client.

- [ ] **Step 1: Write the failing tests**

A player who joins a round that is already running has to see the cars as the others do, so the welcome carries the round's latest hits (the spec's "capped dent log"). The protocol tests pin the new field and its strict parsing (a log is required, at most 64 valid `hit` messages); the room tests pin what a newcomer is greeted with, the cap, and that a new round starts with an empty log. The fixtures of two other test files get the new field so that they still type-check.

In `tests/protocol.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/protocol.test.ts"} -->
```ts
  const phase = { t: 'phase', phase: 'live', round: 2, remainingMs: 12_500 };
  const welcome = {
```

with:

```ts
  const phase = { t: 'phase', phase: 'live', round: 2, remainingMs: 12_500 };
  const hit = { t: 'hit', tick: 500, victim: 1, attacker: -1, dmg: 12.4, hp: 61.2, zone: 'rear', j: 14.8, p: [-2.3, 0, 0.4] };
  const welcome = {
```

In `tests/protocol.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/protocol.test.ts"} -->
```ts
    scores: [{ slot: 2, score: 120, kills: 1 }],
  };
```

with:

```ts
    scores: [{ slot: 2, score: 120, kills: 1 }],
    dents: [hit],
  };
```

In `tests/protocol.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/protocol.test.ts"} -->
```ts
  };
  const hit = { t: 'hit', tick: 500, victim: 1, attacker: -1, dmg: 12.4, hp: 61.2, zone: 'rear', j: 14.8, p: [-2.3, 0, 0.4] };
  const ko = { t: 'ko', tick: 900, victim: 3, killer: 1, assists: [0, 2], reason: 'damage' };
```

with:

```ts
  };
  const ko = { t: 'ko', tick: 900, victim: 3, killer: 1, assists: [0, 2], reason: 'damage' };
```

In `tests/protocol.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/protocol.test.ts"} -->
```ts

  it('accepts the match messages: phase, hit, ko, scores and results', () => {
```

with:

```ts

  it('accepts a welcome whose hit log is empty or as long as it may be', () => {
    expect(parseServerMessage(JSON.stringify({ ...welcome, dents: [] }))).toMatchObject({ dents: [] });
    const full = Array.from({ length: NET.MAX_HIT_LOG }, (_, i) => ({ ...hit, tick: i }));
    expect(parseServerMessage(JSON.stringify({ ...welcome, dents: full }))).toMatchObject({ dents: full });
  });

  it('accepts the match messages: phase, hit, ko, scores and results', () => {
```

In `tests/protocol.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/protocol.test.ts"} -->
```ts
      JSON.stringify({ ...welcome, players: [{ slot: 1, name: 'x', color: 1, bot: 'yes' }] }),
      JSON.stringify({ t: 'roster', epoch: 1, round: 1, you: 0, players: [{ slot: 'a' }] }),
```

with:

```ts
      JSON.stringify({ ...welcome, players: [{ slot: 1, name: 'x', color: 1, bot: 'yes' }] }),
      JSON.stringify({ ...welcome, dents: undefined }), // a welcome always carries the hit log, empty or not
      JSON.stringify({ ...welcome, dents: [{ ...hit, zone: 'roof' }] }),
      JSON.stringify({ ...welcome, dents: [{ t: 'ko' }] }),
      JSON.stringify({ ...welcome, dents: Array.from({ length: NET.MAX_HIT_LOG + 1 }, () => hit) }),
      JSON.stringify({ t: 'roster', epoch: 1, round: 1, you: 0, players: [{ slot: 'a' }] }),
```

In `tests/server/room.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/room.test.ts"} -->
```ts
    expect(room.playerInfos()).toEqual([]);
    expect(room.greeting(room.seated()[0]!)).toEqual({ you: -1, players: [], phase: null, scores: [] });
  });
```

with:

```ts
    expect(room.playerInfos()).toEqual([]);
    expect(room.greeting(room.seated()[0]!)).toEqual({ you: -1, players: [], phase: null, scores: [], dents: [] });
  });
```

In `tests/server/roomCombat.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/roomCombat.test.ts"} -->
```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { COMBAT } from '../../src/shared/constants';
import { quatFromYaw } from '../../src/shared/math';
```

with:

```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { COMBAT, NET } from '../../src/shared/constants';
import { quatFromYaw } from '../../src/shared/math';
```

In `tests/server/roomCombat.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/roomCombat.test.ts"} -->
```ts

  it('does not hurt anybody outside the live phase', () => {
```

with:

```ts

  it('greets a newcomer with the hits of the round so far, oldest first', () => {
    const { room, a } = duel();
    expect(room.greeting(join(room, 'Early').player).dents).toEqual([]);
    headOn(room);
    steps(room, 90);
    const seen = messages(a.socket, 'hit');
    expect(seen).toHaveLength(2);
    const late = join(room, 'Cy');
    expect(room.greeting(late.player).dents).toEqual(seen);
  });

  it('keeps only the latest hits for a newcomer, and starts every round with an empty log', () => {
    const { room, a } = duel({ rules: { resultsTicks: 10 } });
    const logHit = Reflect.get(room, 'logHit') as (h: unknown) => void;
    for (let i = 0; i < NET.MAX_HIT_LOG + 36; i++) logHit.call(room, { t: 'hit', tick: i, victim: 0, attacker: 1, dmg: 1, hp: 90, zone: 'front', j: 5, p: [2.3, 0, 0] });
    const dents = room.greeting(a.player).dents;
    expect(dents).toHaveLength(NET.MAX_HIT_LOG);
    expect([dents[0]!.tick, dents.at(-1)!.tick]).toEqual([36, NET.MAX_HIT_LOG + 35]);
    roundState(room).status.get(1)!.hp = 5;
    headOn(room);
    steps(room, 120); // the collision ends the round, the results last 10 ticks, the next round starts
    expect(room.round).toBe(2);
    expect(room.greeting(a.player).dents).toEqual([]);
  });

  it('does not hurt anybody outside the live phase', () => {
```

In `tests/client/matchState.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/matchState.test.ts"} -->
```ts
const welcome = (over: Partial<WelcomeMessage> = {}): WelcomeMessage => ({
  t: 'welcome', v: 2, you: 0, room: { code: 'ABCD', public: true, capacity: 8 }, epoch: 1, players, tickRate: 60, snapshotEvery: 2, phase: null, scores: [], ...over,
});
```

with:

```ts
const welcome = (over: Partial<WelcomeMessage> = {}): WelcomeMessage => ({
  t: 'welcome', v: 2, you: 0, room: { code: 'ABCD', public: true, capacity: 8 }, epoch: 1, players, tickRate: 60, snapshotEvery: 2, phase: null, scores: [], dents: [], ...over,
});
```

In `tests/scripts/bot.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/scripts/bot.test.ts"} -->
```ts
  scores: [],
});
```

with:

```ts
  scores: [],
  dents: [],
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/protocol.test.ts tests/server/room.test.ts tests/server/roomCombat.test.ts`
Expected: FAIL — the welcome parser accepts a welcome without a hit log, and `greeting().dents` is undefined (several tests in the three files fail).

<!-- check {"cmd": "npx vitest run tests/protocol.test.ts tests/server/room.test.ts tests/server/roomCombat.test.ts", "outcome": "fail", "match": "FAIL"} -->

- [ ] **Step 3: Implement**

The constants: the protocol version changes because the welcome message changes shape (an old cached client is told to reload instead of misreading it), and the log has a size limit.

In `src/shared/constants.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/constants.ts"} -->
```ts
  /** 2: rounds, hit/ko/scores/results messages, `you` in the roster. */
  PROTOCOL_VERSION: 2,
  /** Simulation ticks per snapshot: 2 => 30 Hz. */
```

with:

```ts
  /** 2: rounds, hit/ko/scores/results messages, `you` in the roster. */
  PROTOCOL_VERSION: 3,
  /** The welcome message carries this many of the round's latest hits (a newcomer replays them to dent the cars). */
  MAX_HIT_LOG: 64,
  /** Simulation ticks per snapshot: 2 => 30 Hz. */
```

`src/shared/protocol.ts` — the welcome carries the log; the validation of a `hit` message moves into one function that the `hit` case and the welcome both use:

In `src/shared/protocol.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/protocol.ts"} -->
```ts
  scores: ScoreRow[];
}
```

with:

```ts
  scores: ScoreRow[];
  /** The round's latest hits, oldest first (at most NET.MAX_HIT_LOG): a newcomer replays them to dent and strip the cars as the players saw them. */
  dents: HitMessage[];
}
```

In `src/shared/protocol.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/protocol.ts"} -->
```ts
  isObj(v) && v.t === 'phase' && PHASES.includes(v.phase) && isInt(v.round) && isNum(v.remainingMs) && v.remainingMs >= 0;

```

with:

```ts
  isObj(v) && v.t === 'phase' && PHASES.includes(v.phase) && isInt(v.round) && isNum(v.remainingMs) && v.remainingMs >= 0;
const isHitMessage = (v: unknown): v is HitMessage =>
  isObj(v) && v.t === 'hit' && isInt(v.tick) && isSlot(v.victim) && isSlotOrNone(v.attacker) && isNum(v.dmg) && v.dmg >= 0 && isNum(v.hp) &&
  ZONES.includes(v.zone) && isNum(v.j) && v.j >= 0 && Array.isArray(v.p) && v.p.length === 3 && v.p.every(isNum);

```

In `src/shared/protocol.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/protocol.ts"} -->
```ts
      const scores = v.scores;
      if (
```

with:

```ts
      const scores = v.scores;
      const dents = v.dents;
      if (
```

In `src/shared/protocol.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/protocol.ts"} -->
```ts
        (v.phase === null || isPhaseMessage(v.phase)) &&
        isList(scores) && scores.every(isScoreRow)
      ) {
```

with:

```ts
        (v.phase === null || isPhaseMessage(v.phase)) &&
        isList(scores) && scores.every(isScoreRow) &&
        Array.isArray(dents) && dents.length <= NET.MAX_HIT_LOG && dents.every(isHitMessage)
      ) {
```

In `src/shared/protocol.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/protocol.ts"} -->
```ts
      return isPhaseMessage(v) ? v : null;
    case 'hit': {
      const p = v.p;
      return isInt(v.tick) && isSlot(v.victim) && isSlotOrNone(v.attacker) && isNum(v.dmg) && v.dmg >= 0 && isNum(v.hp) &&
        ZONES.includes(v.zone) && isNum(v.j) && v.j >= 0 && Array.isArray(p) && p.length === 3 && p.every(isNum)
        ? (v as unknown as HitMessage)
        : null;
    }
    case 'ko': {
```

with:

```ts
      return isPhaseMessage(v) ? v : null;
    case 'hit':
      return isHitMessage(v) ? v : null;
    case 'ko': {
```

`src/server/room.ts` and `src/server/app.ts` — the room remembers the round's latest hits and hands them to the greeting:

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
  encodeCarBlock,
  type Phase,
```

with:

```ts
  encodeCarBlock,
  type HitMessage,
  type Phase,
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
  private scoresSentAt = 0;
  private disposed = false;
```

with:

```ts
  private scoresSentAt = 0;
  /** The round's latest hits, oldest first (at most NET.MAX_HIT_LOG): what a player who joins mid-round needs to dent the cars. */
  private hitLog: HitMessage[] = [];
  private disposed = false;
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
  /** What a player who has just joined needs to know: their slot (-1 = watching), the cars, the phase and the scores. */
  greeting(player: Player): { you: number; players: PlayerInfo[]; phase: PhaseMessage | null; scores: ScoreRow[] } {
    const me = this.participants.find((p) => p.player === player);
```

with:

```ts
  /** What a player who has just joined needs to know: their slot (-1 = watching), the cars, the phase and the scores. */
  greeting(player: Player): { you: number; players: PlayerInfo[]; phase: PhaseMessage | null; scores: ScoreRow[]; dents: HitMessage[] } {
    const me = this.participants.find((p) => p.player === player);
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
    const me = this.participants.find((p) => p.player === player);
    return { you: me?.slot ?? -1, players: this.playerInfos(), phase: this.sim ? this.phaseMessage() : null, scores: this.scoreRows() };
  }
```

with:

```ts
    const me = this.participants.find((p) => p.player === player);
    return {
      you: me?.slot ?? -1,
      players: this.playerInfos(),
      phase: this.sim ? this.phaseMessage() : null,
      scores: this.scoreRows(),
      dents: [...this.hitLog],
    };
  }
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
      const events = state.step(sim.tick, sim);
      for (const hit of events.hits) this.broadcast(hit);
      for (const ko of events.kos) this.broadcast(ko);
```

with:

```ts
      const events = state.step(sim.tick, sim);
      for (const hit of events.hits) {
        this.broadcast(hit);
        this.logHit(hit);
      }
      for (const ko of events.kos) this.broadcast(ko);
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
    this.folded = false;
    this.phase = 'countdown';
```

with:

```ts
    this.folded = false;
    this.hitLog = [];
    this.phase = 'countdown';
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts

  private broadcast(msg: ServerMessage, except?: Player): void {
```

with:

```ts

  private logHit(hit: HitMessage): void {
    this.hitLog.push(hit);
    if (this.hitLog.length > NET.MAX_HIT_LOG) this.hitLog.shift();
  }

  private broadcast(msg: ServerMessage, except?: Player): void {
```

In `src/server/app.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts
      scores: greeting.scores,
    });
```

with:

```ts
      scores: greeting.scores,
      dents: greeting.dents,
    });
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/protocol.test.ts tests/server tests/client/matchState.test.ts tests/scripts && npm run typecheck`
Expected: PASS — the protocol, server, match-state and bot-script tests (164 tests with the ones this task adds); type-check clean.

<!-- check {"cmd": "npx vitest run tests/protocol.test.ts tests/server tests/client/matchState.test.ts tests/scripts && npm run typecheck", "outcome": "pass", "tests": 164} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): a newcomer is greeted with the latest hits of the round (protocol version 3)"
```

<!-- commit "feat(server): a newcomer is greeted with the latest hits of the round (protocol version 3)" -->

---

### Task 38: A car that crumples and loses parts

**Files:**
- Modify: `src/client/game/carView.ts`
- Test: `tests/client/carView.test.ts`

**Interfaces:**
- Consumes: `DentSurface`, `Dent` (Task 36), `PartId`, `PART_RULES` (Task 36), `wheelLocalPosition`.
- Produces: `CarView.dent(dent)`, `CarView.detach(id): DetachedPart | null`, `CarView.restore()`, `CarView.hasPart(id)`, and `DetachedPart {id, position, quaternion, size, color, outward}` (world frame). Tasks 39, 44 use them.

- [ ] **Step 1: Write the failing tests**

The body of a car becomes subdivided boxes with flat shading (a dent is then nothing but moved vertices, with no normals to recompute), and the hood, trunk, doors and bumpers become separate pieces that can come off. The tests pin: a hit crumples the front of the car and leaves the rear untouched; a badly hit car never grows by more than the limit; a part comes off once, is reported where it was **in the world** (it follows the car's pose) with its size and colour, and everything is back for the next round; every part the damage rules can take off exists; a wreck's parts are charred.

In `tests/client/carView.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/carView.test.ts"} -->
```ts
import { describe, expect, it } from 'vitest';
```

with:

```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
```

In `tests/client/carView.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/carView.test.ts"} -->
```ts
import { describe, expect, it } from 'vitest';
import { CarView, WRECK_COLOR } from '../../src/client/game/carView';
```

with:

```ts
import { describe, expect, it } from 'vitest';
import { PART_RULES } from '../../src/client/game/carDamage';
import { CarView, WRECK_COLOR } from '../../src/client/game/carView';
```

In `tests/client/carView.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/carView.test.ts"} -->
```ts
import { CarView, WRECK_COLOR } from '../../src/client/game/carView';

```

with:

```ts
import { CarView, WRECK_COLOR } from '../../src/client/game/carView';
import { dentFromHit } from '../../src/client/game/dents';
import { quatFromYaw } from '../../src/shared/math';

```

In `tests/client/carView.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/carView.test.ts"} -->
```ts
  });
});

```

with:

```ts
  });
});

const hit = (over: Partial<Parameters<typeof dentFromHit>[0]> = {}) => dentFromHit({ tick: 90, victim: 1, attacker: 2, dmg: 12, p: [2.3, -0.3, 0], ...over });
/** Every vertex of every mesh of the car, in the order the meshes were added. */
const shape = (view: CarView): number[] =>
  view.group.children.flatMap((c) => (c instanceof THREE.Mesh ? Array.from(c.geometry.getAttribute('position').array as Float32Array) : []));
const size = (view: CarView): THREE.Vector3 => new THREE.Box3().setFromObject(view.group).getSize(new THREE.Vector3());

describe('CarView damage', () => {
  it('crumples where it was hit and nowhere else', () => {
    const view = new CarView(0xd84a2b);
    const meshAt = (x: number, y: number): THREE.Mesh =>
      view.group.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh && Math.abs(c.position.x - x) < 1e-6 && Math.abs(c.position.y - y) < 1e-6)!;
    const verts = (m: THREE.Mesh): number[] => Array.from(m.geometry.getAttribute('position').array as Float32Array);
    const front = meshAt(2.3, -0.32);
    const hood = meshAt(1.5, 0.185);
    const rear = meshAt(-2.3, -0.32);
    const trunk = meshAt(-1.75, 0.185);
    const was = new Map([front, hood, rear, trunk].map((m) => [m, verts(m)] as const));
    const whole = shape(view);
    view.dent(hit());
    expect(shape(view)).not.toEqual(whole);
    expect(verts(front)).not.toEqual(was.get(front));
    expect(verts(hood)).not.toEqual(was.get(hood));
    expect(verts(rear)).toEqual(was.get(rear));
    expect(verts(trunk)).toEqual(was.get(trunk));
    view.dispose();
  });

  it('never grows a badly hit car by more than the limit on each side', () => {
    const view = new CarView(0xd84a2b);
    const fresh = size(view);
    for (let i = 0; i < 60; i++) view.dent(hit({ tick: i, dmg: 25, p: [i % 2 ? 2.3 : -2.3, -0.2, (i % 5) * 0.4 - 0.8] }));
    const worn = size(view);
    for (const axis of ['x', 'y', 'z'] as const) expect(worn[axis]).toBeLessThan(fresh[axis] + 1.0);
    view.dispose();
  });

  it('takes a part off once, says where it was in the world, and puts everything back for the next round', () => {
    const view = new CarView(0x112233);
    view.setPose({ x: 10, y: 1, z: 5 }, quatFromYaw(Math.PI / 2)); // forward is now -Z
    const fresh = shape(new CarView(0x112233));
    view.dent(hit());
    const hood = view.detach('hood')!;
    expect(view.hasPart('hood')).toBe(false);
    expect(hood.position.x).toBeCloseTo(10, 5);
    expect(hood.position.y).toBeCloseTo(1.185, 5);
    expect(hood.position.z).toBeCloseTo(3.5, 5); // 1.5 m ahead of the middle of the car
    expect(hood.size).toEqual({ x: 1.3, y: 0.07, z: 1.85 });
    expect(hood.color).toBe(0x112233);
    expect(Math.hypot(hood.outward.x, hood.outward.y, hood.outward.z)).toBeCloseTo(1, 9);
    expect(hood.outward.y).toBeGreaterThan(0.9); // a hood flies up
    expect(view.detach('hood')).toBeNull();
    expect(view.detach('bumperFront')!.color).toBe(0x23262d); // bumpers are dark trim, whatever the paint
    view.restore();
    expect(view.hasPart('hood')).toBe(true);
    expect(view.hasPart('bumperFront')).toBe(true);
    expect(shape(view).map((v, i) => Math.abs(v - fresh[i]!))).toEqual(fresh.map(() => 0));
    view.dispose();
  });

  it('has a part for every part the damage rules can take off', () => {
    const view = new CarView(0xd84a2b);
    for (const rule of PART_RULES) expect(view.hasPart(rule.id)).toBe(true);
    view.dispose();
  });

  it('gives a part the charred colour when the car is a wreck', () => {
    const view = new CarView(0xd84a2b);
    view.setWreck(true);
    expect(view.detach('trunk')!.color).toBe(WRECK_COLOR);
    view.dispose();
  });
});

```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/client/carView.test.ts`
Expected: FAIL — the five damage tests fail (`view.dent is not a function`, `view.hasPart is not a function`); the two wreck-look tests still pass.

<!-- check {"cmd": "npx vitest run tests/client/carView.test.ts", "outcome": "fail", "match": "is not a function"} -->

- [ ] **Step 3: Implement**

`src/client/game/carView.ts` — the bodywork as crumpling boxes, the parts table (where each sits, how big, which way it flies off), and the four new methods:

In `src/client/game/carView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/carView.ts"} -->
```ts
import { wheelLocalPosition } from '../../shared/vehicle';

```

with:

```ts
import { wheelLocalPosition } from '../../shared/vehicle';
import type { PartId } from './carDamage';
import { DentSurface, type Dent } from './dents';

```

In `src/client/game/carView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/carView.ts"} -->
```ts

export class CarView {
```

with:

```ts

/** A part that has just come off a car: where it was in the world, how big, what colour, and which way it should fly. */
export interface DetachedPart {
  id: PartId;
  position: Vec3;
  quaternion: Quat;
  size: Vec3;
  color: number;
  /** Unit vector pointing away from the middle of the car, in the world. */
  outward: Vec3;
}

/** Where each detachable part sits (car frame), its size and subdivision, and which way it flies off (car frame). */
const PART_SPECS: Record<PartId, { size: [number, number, number]; segments: [number, number, number]; at: [number, number, number]; outward: [number, number, number]; trim: boolean }> = {
  bumperFront: { size: [0.25, 0.32, 2.0], segments: [1, 2, 8], at: [2.3, -0.32, 0], outward: [1, 0.1, 0], trim: true },
  bumperRear: { size: [0.25, 0.32, 2.0], segments: [1, 2, 8], at: [-2.3, -0.32, 0], outward: [-1, 0.1, 0], trim: true },
  hood: { size: [1.3, 0.07, 1.85], segments: [6, 1, 8], at: [1.5, 0.185, 0], outward: [0.35, 1, 0], trim: false },
  trunk: { size: [1.0, 0.07, 1.85], segments: [5, 1, 8], at: [-1.75, 0.185, 0], outward: [-0.35, 1, 0], trim: false },
  doorLeft: { size: [1.3, 0.5, 0.05], segments: [6, 3, 1], at: [0.05, -0.1, -1.0], outward: [0, 0.25, -1], trim: false },
  doorRight: { size: [1.3, 0.5, 0.05], segments: [6, 3, 1], at: [0.05, -0.1, 1.0], outward: [0, 0.25, 1], trim: false },
};

export class CarView {
```

In `src/client/game/carView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/carView.ts"} -->
```ts
  private readonly bodyMaterial: THREE.MeshStandardMaterial;
  private readonly pivots: THREE.Group[] = [];
```

with:

```ts
  private readonly bodyMaterial: THREE.MeshStandardMaterial;
  private readonly surfaces: DentSurface[] = [];
  private readonly parts = new Map<PartId, THREE.Mesh>();
  private readonly pivots: THREE.Group[] = [];
```

In `src/client/game/carView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/carView.ts"} -->
```ts
    );
    const trim = this.track(new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.8, metalness: 0.2 }));
    const glass = this.track(new THREE.MeshStandardMaterial({ color: 0x101a26, roughness: 0.25, metalness: 0.6 }));
    const headlight = this.track(
```

with:

```ts
    );
    const trim = this.track(new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.8, metalness: 0.2, flatShading: true }));
    const glass = this.track(new THREE.MeshStandardMaterial({ color: 0x101a26, roughness: 0.25, metalness: 0.6, flatShading: true }));
    const headlight = this.track(
```

In `src/client/game/carView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/carView.ts"} -->
```ts
    };
    // forward = +X, up = +Y, right = +Z; the physics chassis box is 4.6 x 1.0 x 2.0 centred on the origin
    box(4.5, 0.6, 1.95, this.bodyMaterial, 0, -0.15, 0); // lower body
    box(2.4, 0.62, 1.7, glass, -0.25, 0.46, 0); // cabin glass band
    box(2.3, 0.08, 1.65, this.bodyMaterial, -0.25, 0.81, 0); // roof
    box(0.25, 0.32, 2.0, trim, 2.3, -0.32, 0); // front bumper
    box(0.25, 0.32, 2.0, trim, -2.3, -0.32, 0); // rear bumper
    box(0.06, 0.16, 0.36, headlight, 2.27, -0.02, 0.7);
```

with:

```ts
    };
    // forward = +X, up = +Y, right = +Z; the physics chassis box is 4.6 x 1.0 x 2.0 centred on the origin.
    // The body is made of subdivided boxes with flat shading, so a dent is just moved vertices: no normals to recompute.
    this.crumpling(4.5, 0.6, 1.95, [18, 3, 8], this.bodyMaterial, 0, -0.15, 0); // lower body
    this.crumpling(2.4, 0.62, 1.7, [10, 3, 7], glass, -0.25, 0.46, 0); // cabin glass band
    this.crumpling(2.3, 0.08, 1.65, [10, 1, 7], this.bodyMaterial, -0.25, 0.81, 0); // roof
    for (const id of Object.keys(PART_SPECS) as PartId[]) {
      const spec = PART_SPECS[id];
      const mesh = this.crumpling(spec.size[0], spec.size[1], spec.size[2], spec.segments, spec.trim ? trim : this.bodyMaterial, spec.at[0], spec.at[1], spec.at[2]);
      this.parts.set(id, mesh);
    }
    box(0.06, 0.16, 0.36, headlight, 2.27, -0.02, 0.7);
```

In `src/client/game/carView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/carView.ts"} -->
```ts

  setPose(pos: Vec3, quat: Quat): void {
```

with:

```ts

  /** A box of subdivided faces that a dent can push around. */
  private crumpling(w: number, h: number, d: number, segments: [number, number, number], material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const geometry = this.track(new THREE.BoxGeometry(w, h, d, segments[0], segments[1], segments[2]));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.surfaces.push(new DentSurface(geometry, { x, y, z }));
    return mesh;
  }

  /** Crumples the bodywork where a hit landed (car frame). */
  dent(d: Dent): void {
    for (const surface of this.surfaces) surface.apply(d);
  }

  /**
   * Takes a part off the car (it stops being drawn) and says where it was, so the caller can send it flying. Null when the part is
   * already off.
   */
  detach(id: PartId): DetachedPart | null {
    const mesh = this.parts.get(id);
    if (!mesh || !mesh.visible) return null;
    mesh.visible = false;
    this.group.updateMatrixWorld(true);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    mesh.matrixWorld.decompose(position, quaternion, new THREE.Vector3());
    const [ox, oy, oz] = PART_SPECS[id].outward;
    const outward = new THREE.Vector3(ox, oy, oz).normalize().applyQuaternion(this.group.quaternion);
    const [w, h, d] = PART_SPECS[id].size;
    return {
      id,
      position: { x: position.x, y: position.y, z: position.z },
      quaternion: { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
      size: { x: w, y: h, z: d },
      color: (mesh.material as THREE.MeshStandardMaterial).color.getHex(),
      outward: { x: outward.x, y: outward.y, z: outward.z },
    };
  }

  /** A new round: every part back on, every dent out. */
  restore(): void {
    for (const mesh of this.parts.values()) mesh.visible = true;
    for (const surface of this.surfaces) surface.reset();
  }

  /** Whether a part is still on the car. */
  hasPart(id: PartId): boolean {
    return this.parts.get(id)?.visible ?? false;
  }

  setPose(pos: Vec3, quat: Quat): void {
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/client/carView.test.ts && npm run typecheck`
Expected: PASS — 7 tests; type-check clean.

<!-- check {"cmd": "npx vitest run tests/client/carView.test.ts && npm run typecheck", "outcome": "pass", "tests": 7} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(client): cars crumple where they are hit and lose bumpers, hoods, trunks and doors"
```

<!-- commit "feat(client): cars crumple where they are hit and lose bumpers, hoods, trunks and doors" -->

---

### Task 39: Particles and debris

**Files:**
- Create: `src/client/game/particles.ts`, `src/client/game/debris.ts`
- Test: `tests/client/particles.test.ts`, `tests/client/debris.test.ts`

**Interfaces:**
- Consumes: `DetachedPart` (Task 38), `mulberry32`, `quatIntegrate`, three.js `Points` and `ShaderMaterial`.
- Produces: `ParticleRing(capacity)` (`emit`, `aliveAt`, `dirty`, `clearDirty`); `ParticleSystem` with `object`, `emit(kind, emission)`, `update(nowSeconds, pixelScale)`, `alive(kind)`, `clear()`, `dispose()` for the kinds `spark`, `smoke`, `fire`, `dust`; `DEBRIS`, `stepDebris(body, dt)`, `DebrisSystem` with `object`, `spawn(part, carVelocity)`, `update(dt)`, `clear()`, `active`, `dispose()`. Task 44 uses them.

- [ ] **Step 1: Write the failing tests**

`particles.test.ts` covers the ring buffer (a new particle overwrites the oldest, nothing grows, broken numbers are refused, lifetimes and sizes are capped, only the slots written since the last upload are reported, wrapping at the end) and the system that owns four GPU pools (one clock uniform, uploads of just what changed, clear, dispose). One test pins a subtle thing found in the rehearsal: birth times live in 32-bit floats, so a particle must count as alive at the very moment it is born. `debris.test.ts` covers the flight (gravity, bouncing, settling on the thinnest side, a rotation that stays a rotation) and the pool (a part keeps the car's speed and is thrown away from it, fades and is freed, the oldest piece is reused).

Create `tests/client/particles.test.ts`:

<!-- op {"kind": "create", "path": "tests/client/particles.test.ts"} -->
```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ParticleRing, ParticleSystem, type Emission } from '../../src/client/game/particles';

const spark = (over: Partial<Emission> = {}): Emission => ({ x: 1, y: 2, z: 3, vx: 4, vy: 5, vz: 6, life: 0.5, size: 0.2, seed: 0.25, ...over });

describe('ParticleRing', () => {
  it('writes a particle at the head and moves the head on', () => {
    const ring = new ParticleRing(8);
    expect(ring.emit(spark(), 10)).toBe(0);
    expect(ring.emit(spark({ x: 9 }), 10.1)).toBe(1);
    expect(Array.from(ring.origin.slice(0, 6))).toEqual([1, 2, 3, 9, 2, 3]);
    expect(Array.from(ring.velocity.slice(0, 3))).toEqual([4, 5, 6]);
    expect([ring.birth[0], ring.life[0], ring.size[0], ring.seed[0]]).toEqual([10, 0.5, expect.closeTo(0.2, 6), 0.25]);
    expect(ring.head).toBe(2);
  });

  it('overwrites the oldest particle when it is full, and never grows', () => {
    const ring = new ParticleRing(4);
    for (let i = 0; i < 6; i++) ring.emit(spark({ x: i }), i);
    expect(ring.head).toBe(2);
    expect(Array.from(ring.origin).filter((_, k) => k % 3 === 0)).toEqual([4, 5, 2, 3]); // 0 and 1 were overwritten by 4 and 5
    expect(ring.origin.length).toBe(12);
  });

  it('counts a particle as alive at the very moment it is born, whatever the rounding of times to 32 bits does', () => {
    const ring = new ParticleRing(8);
    for (const now of [100.016666, 12345.678901, 0.1, 3600.0000001]) {
      ring.emit(spark({ life: 1 }), now);
      expect(ring.aliveAt(now)).toBeGreaterThan(0);
      ring.birth.fill(-1e9);
    }
  });

  it('counts the particles that are alive: born already, not yet dead', () => {
    const ring = new ParticleRing(8);
    ring.emit(spark({ life: 1 }), 10);
    ring.emit(spark({ life: 3 }), 10);
    expect(ring.aliveAt(9.9)).toBe(0); // not born yet
    expect(ring.aliveAt(10.5)).toBe(2);
    expect(ring.aliveAt(11.5)).toBe(1);
    expect(ring.aliveAt(13.5)).toBe(0);
  });

  it('refuses particles with broken numbers, and limits how long and how big one can be', () => {
    const ring = new ParticleRing(4);
    for (const bad of [{ x: Number.NaN }, { vy: Number.POSITIVE_INFINITY }, { life: 0 }, { life: -1 }, { size: 0 }, { size: Number.NaN }]) {
      expect(ring.emit(spark(bad), 1)).toBe(-1);
    }
    expect(ring.emit(spark(), Number.NaN)).toBe(-1);
    expect(ring.head).toBe(0);
    ring.emit(spark({ life: 999, size: 999 }), 1);
    expect(ring.life[0]).toBeLessThanOrEqual(10);
    expect(ring.size[0]).toBeLessThanOrEqual(20);
  });

  it('reports what changed since the last upload, wrapping at the end of the ring', () => {
    const ring = new ParticleRing(8);
    expect(ring.dirty()).toBeNull();
    for (let i = 0; i < 3; i++) ring.emit(spark(), i);
    expect(ring.dirty()).toEqual({ from: 0, count: 3, wrapped: false });
    ring.clearDirty();
    expect(ring.dirty()).toBeNull();
    for (let i = 0; i < 4; i++) ring.emit(spark(), i); // slots 3..6
    ring.clearDirty();
    for (let i = 0; i < 3; i++) ring.emit(spark(), i); // slots 7, 0, 1
    expect(ring.dirty()).toEqual({ from: 7, count: 3, wrapped: true });
    ring.clearDirty();
    for (let i = 0; i < 20; i++) ring.emit(spark(), i); // more than the ring holds: everything
    expect(ring.dirty()!.count).toBe(8);
  });
});

describe('ParticleSystem', () => {
  it('has a pool for each kind, animates them through one clock uniform, and counts what is alive', () => {
    const system = new ParticleSystem();
    expect(system.object.children).toHaveLength(4);
    system.update(5, 600);
    system.emit('spark', spark({ life: 1 }));
    system.emit('smoke', spark({ life: 2 }));
    expect([system.alive('spark'), system.alive('smoke'), system.alive('fire'), system.alive('dust')]).toEqual([1, 1, 0, 0]);
    system.update(5.5, 600);
    const material = (system.object.children[0] as THREE.Points).material as THREE.ShaderMaterial;
    expect(material.uniforms.uTime!.value).toBe(5.5);
    expect(material.uniforms.uScale!.value).toBe(600);
    system.update(9, 600);
    expect([system.alive('spark'), system.alive('smoke')]).toEqual([0, 0]);
    system.dispose();
  });

  it('uploads only the slots that were written, and wraps around the end of the ring', () => {
    const system = new ParticleSystem();
    system.update(0, 500);
    const points = system.object.children[0] as THREE.Points; // the sparks
    const birth = points.geometry.getAttribute('aBirth') as THREE.BufferAttribute;
    for (let i = 0; i < 5; i++) system.emit('spark', spark());
    system.update(0.1, 500);
    expect(birth.updateRanges).toEqual([{ start: 0, count: 5 }]);
    for (let i = 0; i < 1024 - 5 - 2; i++) system.emit('spark', spark()); // slots 5..1021: the head ends up at 1022
    system.update(0.2, 500);
    expect(birth.updateRanges).toEqual([{ start: 5, count: 1017 }]);
    for (let i = 0; i < 4; i++) system.emit('spark', spark()); // slots 1022, 1023, 0, 1: past the end of the ring
    system.update(0.3, 500);
    expect(birth.updateRanges).toEqual([{ start: 1022, count: 2 }, { start: 0, count: 2 }]);
    system.dispose();
  });

  it('forgets every particle on clear, and adds no cost to a scene with nothing emitted', () => {
    const system = new ParticleSystem();
    system.update(1, 500);
    for (const kind of ['spark', 'fire', 'smoke', 'dust'] as const) system.emit(kind, spark({ life: 5 }));
    system.clear();
    expect(['spark', 'fire', 'smoke', 'dust'].map((k) => system.alive(k as 'spark'))).toEqual([0, 0, 0, 0]);
    system.dispose();
  });

  it('releases its GPU resources when disposed', () => {
    const system = new ParticleSystem();
    let disposed = 0;
    for (const child of system.object.children) {
      const points = child as THREE.Points;
      points.geometry.addEventListener('dispose', () => disposed++);
      (points.material as THREE.ShaderMaterial).addEventListener('dispose', () => disposed++);
    }
    system.dispose();
    expect(disposed).toBe(8);
  });
});
```

Create `tests/client/debris.test.ts`:

<!-- op {"kind": "create", "path": "tests/client/debris.test.ts"} -->
```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { DetachedPart } from '../../src/client/game/carView';
import { DEBRIS, DebrisSystem, stepDebris, type DebrisBody } from '../../src/client/game/debris';
import { mulberry32 } from '../../src/shared/random';

const body = (over: Partial<DebrisBody> = {}): DebrisBody => ({
  pos: { x: 0, y: 2, z: 0 },
  vel: { x: 3, y: 4, z: 0 },
  quat: { x: 0, y: 0, z: 0, w: 1 },
  spin: { x: 2, y: 5, z: -3 },
  half: { x: 0.65, y: 0.035, z: 0.9 },
  age: 0,
  ...over,
});
const part = (over: Partial<DetachedPart> = {}): DetachedPart => ({
  id: 'hood',
  position: { x: 5, y: 1.2, z: -3 },
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
  size: { x: 1.3, y: 0.07, z: 1.85 },
  color: 0xd84a2b,
  outward: { x: 0.3, y: 0.95, z: 0 },
  ...over,
});

describe('stepDebris', () => {
  it('rises, falls under gravity, bounces off the ground and settles on its thinnest side', () => {
    const d = body();
    let highest = 0;
    let bounced = false;
    for (let i = 0; i < 60 * 8; i++) {
      const before = d.vel.y;
      stepDebris(d, 1 / 60);
      highest = Math.max(highest, d.pos.y);
      if (before < -DEBRIS.MIN_BOUNCE && d.vel.y > 0) bounced = true;
      expect(d.pos.y).toBeGreaterThanOrEqual(0.035 - 1e-9);
    }
    expect(highest).toBeGreaterThan(2.5);
    expect(bounced).toBe(true);
    expect(d.pos.y).toBeCloseTo(0.035, 6);
    expect(Math.hypot(d.vel.x, d.vel.y, d.vel.z)).toBeLessThan(0.2); // slid to a stop
    expect(Math.hypot(d.spin.x, d.spin.y, d.spin.z)).toBeLessThan(0.5); // and stopped tumbling
  });

  it('keeps the rotation a unit quaternion however long it spins', () => {
    const d = body({ pos: { x: 0, y: 50, z: 0 }, vel: { x: 0, y: 0, z: 0 } });
    for (let i = 0; i < 600; i++) stepDebris(d, 1 / 60);
    expect(Math.hypot(d.quat.x, d.quat.y, d.quat.z, d.quat.w)).toBeCloseTo(1, 9);
  });
});

describe('DebrisSystem', () => {
  it('puts a part where it came off, with its size and colour, and sends it away from the car', () => {
    const system = new DebrisSystem(mulberry32(1));
    system.spawn(part(), { x: 10, y: 0, z: 0 });
    expect(system.active).toBe(1);
    const mesh = system.object.children.find((c) => c.visible) as THREE.Mesh;
    expect(mesh.position.toArray()).toEqual([5, 1.2, -3]);
    expect(mesh.scale.toArray()).toEqual([1.3, 0.07, 1.85]);
    expect((mesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xd84a2b);
    system.update(0.1);
    expect(mesh.position.x).toBeGreaterThan(5.5); // it kept the car's forward speed and was thrown outwards
    expect(mesh.position.y).toBeGreaterThan(1.2); // and up
    system.dispose();
  });

  it('shrinks a piece away and frees it at the end of its life', () => {
    const system = new DebrisSystem(mulberry32(2));
    system.spawn(part({ position: { x: 0, y: 0.1, z: 0 } }), { x: 0, y: 0, z: 0 });
    const mesh = system.object.children.find((c) => c.visible) as THREE.Mesh;
    for (let t = 0; t < DEBRIS.LIFE - 1 - 1e-9; t += 0.2) system.update(0.2);
    expect(mesh.scale.x).toBeCloseTo(0.65, 1); // fading: half way through the last two seconds
    for (let t = 0; t < 2; t += 0.2) system.update(0.2);
    expect(system.active).toBe(0);
    expect(mesh.visible).toBe(false);
    system.dispose();
  });

  it('reuses the oldest piece when more parts come off than there is room for', () => {
    const system = new DebrisSystem(mulberry32(3));
    for (let i = 0; i < DEBRIS.MAX; i++) {
      system.spawn(part({ position: { x: i, y: 5, z: 0 } }), { x: 0, y: 0, z: 0 });
      system.update(0.01);
    }
    expect(system.active).toBe(DEBRIS.MAX);
    system.spawn(part({ position: { x: 999, y: 5, z: 0 } }), { x: 0, y: 0, z: 0 });
    expect(system.active).toBe(DEBRIS.MAX);
    const xs = system.object.children.map((c) => c.position.x);
    expect(xs).toContain(999);
    expect(xs).not.toContain(0); // the first one was the oldest
    expect(system.object.children.length).toBe(DEBRIS.MAX); // never grows
    system.dispose();
  });

  it('survives absurd frame times and clears everything on request', () => {
    const system = new DebrisSystem(mulberry32(4));
    system.spawn(part(), { x: 0, y: 0, z: 0 });
    for (const dt of [0, -1, Number.NaN, 1e9]) system.update(dt);
    const mesh = system.object.children.find((c) => c.visible) as THREE.Mesh;
    expect(Number.isFinite(mesh.position.x + mesh.position.y + mesh.position.z)).toBe(true);
    system.clear();
    expect(system.active).toBe(0);
    system.dispose();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/client/particles.test.ts tests/client/debris.test.ts`
Expected: FAIL — both files fail to load: `src/client/game/particles` and `src/client/game/debris` do not exist yet.

<!-- check {"cmd": "npx vitest run tests/client/particles.test.ts tests/client/debris.test.ts", "outcome": "fail", "match": "Failed to resolve import|Cannot find module|Does the file exist"} -->

- [ ] **Step 3: Implement**

`src/client/game/particles.ts` — sparks, fire, smoke and dust. Each kind is a `THREE.Points` whose vertex shader works out where every particle is from its birth time and velocity (with drag and gravity), so the only thing that changes per frame is one uniform; emitting is a few array writes into a ring buffer, and only the written slots are uploaded.

Create `src/client/game/particles.ts`:

<!-- op {"kind": "create", "path": "src/client/game/particles.ts"} -->
```ts
import * as THREE from 'three';

export type ParticleKind = 'spark' | 'smoke' | 'fire' | 'dust';

/** One particle to emit: where and how fast it starts (world frame), how long it lives, how big it starts and a seed for variety. */
export interface Emission {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size: number;
  seed?: number;
}

const NEVER = -1e9;
const MAX_LIFE = 10;
const MAX_SIZE = 20;

/**
 * The storage of one particle pool: a ring buffer of fixed size. A new particle overwrites the oldest one, so nothing is ever
 * allocated or freed while the game runs, and each frame only the slots written since the last upload have to be sent to the GPU.
 * The particles themselves are never moved by code: the vertex shader works out where each one is from its birth time.
 */
export class ParticleRing {
  readonly origin: Float32Array;
  readonly velocity: Float32Array;
  readonly birth: Float32Array;
  readonly life: Float32Array;
  readonly size: Float32Array;
  readonly seed: Float32Array;
  /** Index the next particle goes to. */
  head = 0;
  private dirtyFrom = 0;
  private dirtyCount = 0;

  constructor(readonly capacity: number) {
    this.origin = new Float32Array(capacity * 3);
    this.velocity = new Float32Array(capacity * 3);
    this.birth = new Float32Array(capacity).fill(NEVER);
    this.life = new Float32Array(capacity).fill(1);
    this.size = new Float32Array(capacity);
    this.seed = new Float32Array(capacity);
  }

  /** Puts a particle in the ring at time `now` (seconds). Returns its index, or -1 when the numbers are not usable. */
  emit(e: Emission, now: number): number {
    const numbers = [e.x, e.y, e.z, e.vx, e.vy, e.vz, e.life, e.size, now];
    if (!numbers.every(Number.isFinite) || e.life <= 0 || e.size <= 0) return -1;
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    this.origin.set([e.x, e.y, e.z], i * 3);
    this.velocity.set([e.vx, e.vy, e.vz], i * 3);
    this.birth[i] = now;
    this.life[i] = Math.min(e.life, MAX_LIFE);
    this.size[i] = Math.min(e.size, MAX_SIZE);
    this.seed[i] = e.seed ?? 0;
    if (this.dirtyCount === 0) this.dirtyFrom = i;
    this.dirtyCount = Math.min(this.capacity, this.dirtyCount + 1);
    return i;
  }

  /** How many particles are alive at `now`. Birth times are stored as 32-bit floats, so `now` is rounded the same way before comparing. */
  aliveAt(now: number): number {
    const t = Math.fround(now);
    let n = 0;
    for (let i = 0; i < this.capacity; i++) {
      const age = t - this.birth[i]!;
      if (age >= 0 && age < this.life[i]!) n++;
    }
    return n;
  }

  /** The slots written since the last `clearDirty`: `[from, count]`, or null when nothing was; `wrapped` when it passes the end of the ring. */
  dirty(): { from: number; count: number; wrapped: boolean } | null {
    if (this.dirtyCount === 0) return null;
    return { from: this.dirtyFrom, count: this.dirtyCount, wrapped: this.dirtyFrom + this.dirtyCount > this.capacity };
  }

  clearDirty(): void {
    this.dirtyCount = 0;
  }
}

/** How each kind looks and moves. Gravity in m/s², drag per second, growth in world units per second of age. */
const LOOKS: Record<ParticleKind, { gravity: [number, number, number]; drag: number; grow: number; additive: boolean; colour: string; capacity: number }> = {
  spark: {
    gravity: [0, -9, 0],
    drag: 0.6,
    grow: 0,
    additive: true,
    // white-hot to orange, fading out
    colour: 'vec3 c = mix(vec3(1.0, 0.95, 0.75), vec3(1.0, 0.45, 0.08), t); float a = (1.0 - t) * soft; gl_FragColor = vec4(c * 2.2, a);',
    capacity: 1024,
  },
  fire: {
    gravity: [0, 2.5, 0],
    drag: 1.2,
    grow: 0.9,
    additive: true,
    colour: 'vec3 c = mix(vec3(1.0, 0.85, 0.3), vec3(0.9, 0.18, 0.02), smoothstep(0.0, 0.7, t)); float a = pow(1.0 - t, 1.5) * soft * 0.9; gl_FragColor = vec4(c * 1.6, a);',
    capacity: 512,
  },
  smoke: {
    gravity: [0, 1.4, 0],
    drag: 0.9,
    grow: 1.6,
    additive: false,
    colour: 'float g = 0.16 + 0.12 * vSeed; float a = (1.0 - t) * soft * 0.42; gl_FragColor = vec4(vec3(g), a);',
    capacity: 768,
  },
  dust: {
    gravity: [0, -0.6, 0],
    drag: 2.4,
    grow: 1.1,
    additive: false,
    colour: 'vec3 c = vec3(0.42, 0.33, 0.24); float a = (1.0 - t) * soft * 0.3; gl_FragColor = vec4(c, a);',
    capacity: 768,
  },
};

const VERTEX = /* glsl */ `
attribute vec3 aVelocity;
attribute float aBirth;
attribute float aLife;
attribute float aSize;
attribute float aSeed;
uniform float uTime;
uniform vec3 uGravity;
uniform float uDrag;
uniform float uGrow;
uniform float uScale;
varying float vAge;
varying float vSeed;
void main() {
  float age = uTime - aBirth;
  float t = age / aLife;
  vAge = t;
  vSeed = aSeed;
  if (age < 0.0 || t >= 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  float travel = (1.0 - exp(-uDrag * age)) / uDrag;
  vec3 p = position + aVelocity * travel + 0.5 * uGravity * age * age;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (aSize + uGrow * age) * uScale / -mv.z;
}
`;

const fragment = (colour: string): string => /* glsl */ `
varying float vAge;
varying float vSeed;
void main() {
  float t = vAge;
  vec2 d = gl_PointCoord - vec2(0.5);
  float r = length(d) * 2.0;
  if (r > 1.0) discard;
  float soft = 1.0 - r * r;
  ${colour}
}
`;

/**
 * Sparks, fire, smoke and dust for the whole scene: four `THREE.Points` objects, each a ring buffer the GPU animates from the
 * birth time of every particle (one uniform, `uTime`, is all that changes per frame). Emitting costs a few array writes.
 */
export class ParticleSystem {
  readonly object = new THREE.Group();
  private readonly rings = new Map<ParticleKind, ParticleRing>();
  private readonly points = new Map<ParticleKind, THREE.Points>();
  private readonly materials: THREE.ShaderMaterial[] = [];
  private now = 0;

  constructor() {
    for (const kind of Object.keys(LOOKS) as ParticleKind[]) {
      const look = LOOKS[kind];
      const ring = new ParticleRing(look.capacity);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(ring.origin, 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('aVelocity', new THREE.BufferAttribute(ring.velocity, 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('aBirth', new THREE.BufferAttribute(ring.birth, 1).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('aLife', new THREE.BufferAttribute(ring.life, 1).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('aSize', new THREE.BufferAttribute(ring.size, 1).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('aSeed', new THREE.BufferAttribute(ring.seed, 1).setUsage(THREE.DynamicDrawUsage));
      const material = new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: fragment(look.colour),
        uniforms: {
          uTime: { value: 0 },
          uGravity: { value: new THREE.Vector3(...look.gravity) },
          uDrag: { value: look.drag },
          uGrow: { value: look.grow },
          uScale: { value: 400 },
        },
        transparent: true,
        depthWrite: false,
        blending: look.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false; // the shader moves the points; the geometry's own bounds mean nothing
      points.renderOrder = 20;
      this.object.add(points);
      this.rings.set(kind, ring);
      this.points.set(kind, points);
      this.materials.push(material);
    }
  }

  /** Emits one particle of `kind` at the current time. */
  emit(kind: ParticleKind, e: Emission): void {
    this.rings.get(kind)!.emit(e, this.now);
  }

  /** How many particles of `kind` are alive right now. */
  alive(kind: ParticleKind): number {
    return this.rings.get(kind)!.aliveAt(this.now);
  }

  /**
   * Once per frame: sets the clock and the pixel scale (`viewportHeight / (2 tan(fov / 2))`, so a size in metres is a size on
   * screen) and uploads what was emitted since the last frame.
   */
  update(nowSeconds: number, pixelScale: number): void {
    this.now = nowSeconds;
    for (const kind of this.rings.keys()) {
      const ring = this.rings.get(kind)!;
      const material = this.points.get(kind)!.material as THREE.ShaderMaterial;
      material.uniforms.uTime!.value = nowSeconds;
      material.uniforms.uScale!.value = pixelScale;
      const dirty = ring.dirty();
      if (!dirty) continue;
      const geometry = this.points.get(kind)!.geometry;
      for (const [name, itemSize] of [['position', 3], ['aVelocity', 3], ['aBirth', 1], ['aLife', 1], ['aSize', 1], ['aSeed', 1]] as const) {
        const attribute = geometry.getAttribute(name) as THREE.BufferAttribute;
        attribute.clearUpdateRanges();
        if (!dirty.wrapped) attribute.addUpdateRange(dirty.from * itemSize, dirty.count * itemSize);
        else {
          attribute.addUpdateRange(dirty.from * itemSize, (ring.capacity - dirty.from) * itemSize);
          attribute.addUpdateRange(0, (dirty.from + dirty.count - ring.capacity) * itemSize);
        }
        attribute.needsUpdate = true;
      }
      ring.clearDirty();
    }
  }

  /** Forgets every particle (a new round). */
  clear(): void {
    for (const [kind, ring] of this.rings) {
      ring.birth.fill(NEVER);
      ring.head = 0;
      ring.clearDirty();
      const attribute = this.points.get(kind)!.geometry.getAttribute('aBirth') as THREE.BufferAttribute;
      attribute.clearUpdateRanges();
      attribute.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const points of this.points.values()) points.geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.object.removeFromParent();
  }
}
```

`src/client/game/debris.ts` — the parts that come off cars, as a fixed pool of boxes. Purely cosmetic: no car ever touches them, and every client may throw them differently.

Create `src/client/game/debris.ts`:

<!-- op {"kind": "create", "path": "src/client/game/debris.ts"} -->
```ts
import * as THREE from 'three';
import { quatIntegrate } from '../../shared/math';
import { mulberry32 } from '../../shared/random';
import type { Quat, Vec3 } from '../../shared/types';
import type { DetachedPart } from './carView';

export const DEBRIS = {
  GRAVITY: 9.81,
  /** Speed kept after a bounce, and the slowest fall that still bounces. */
  RESTITUTION: 0.35,
  MIN_BOUNCE: 1,
  /** Seconds a piece lies around, of which the last FADE are spent shrinking away. */
  LIFE: 12,
  FADE: 2,
  /** Pieces alive at once; when there are more, the oldest is reused. */
  MAX: 40,
} as const;

/** A piece of debris in flight. */
export interface DebrisBody {
  pos: Vec3;
  vel: Vec3;
  quat: Quat;
  /** World angular velocity (rad/s). */
  spin: Vec3;
  /** Half the piece's size in each direction. */
  half: Vec3;
  age: number;
}

/** One step of its flight: gravity, bouncing off the ground, sliding and spinning to a stop. Purely cosmetic: no other car ever touches it. */
export function stepDebris(d: DebrisBody, dt: number): void {
  d.age += dt;
  d.vel.y -= DEBRIS.GRAVITY * dt;
  d.pos.x += d.vel.x * dt;
  d.pos.y += d.vel.y * dt;
  d.pos.z += d.vel.z * dt;
  d.quat = quatIntegrate(d.quat, d.spin, dt);
  const rest = Math.min(d.half.x, d.half.y, d.half.z); // it lies on its thinnest side
  if (d.pos.y <= rest) {
    d.pos.y = rest;
    d.vel.y = d.vel.y < -DEBRIS.MIN_BOUNCE ? -d.vel.y * DEBRIS.RESTITUTION : 0;
    const slide = Math.exp(-3 * dt);
    const stop = Math.exp(-4 * dt);
    d.vel.x *= slide;
    d.vel.z *= slide;
    d.spin.x *= stop;
    d.spin.y *= stop;
    d.spin.z *= stop;
  }
}

interface Piece {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  body: DebrisBody;
  active: boolean;
}

/** The parts that come off cars, flying, bouncing and fading away. A fixed pool of boxes, reused oldest first. */
export class DebrisSystem {
  readonly object = new THREE.Group();
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly pieces: Piece[] = [];
  private cursor = 0;

  constructor(private readonly random: () => number = mulberry32(0xde0b715)) {
    for (let i = 0; i < DEBRIS.MAX; i++) {
      const material = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.3, flatShading: true });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.visible = false;
      mesh.castShadow = true;
      this.object.add(mesh);
      this.pieces.push({
        mesh,
        material,
        active: false,
        body: { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 }, spin: { x: 0, y: 0, z: 0 }, half: { x: 0.5, y: 0.5, z: 0.5 }, age: 0 },
      });
    }
  }

  /** How many pieces are lying around or flying. */
  get active(): number {
    return this.pieces.filter((p) => p.active).length;
  }

  /** Sends a part flying: it keeps the speed of the car it came off and is thrown away from it and upwards. */
  spawn(part: DetachedPart, carVelocity: Vec3): void {
    const piece = this.pieces.find((p) => !p.active) ?? this.oldest();
    const r = this.random;
    const away = 3 + 4 * r();
    const up = 2 + 3 * r();
    const b = piece.body;
    b.pos = { ...part.position };
    b.vel = {
      x: carVelocity.x + part.outward.x * away + (r() - 0.5) * 2,
      y: carVelocity.y + part.outward.y * away + up,
      z: carVelocity.z + part.outward.z * away + (r() - 0.5) * 2,
    };
    b.quat = { ...part.quaternion };
    b.spin = { x: (r() - 0.5) * 12, y: (r() - 0.5) * 12, z: (r() - 0.5) * 12 };
    b.half = { x: part.size.x / 2, y: part.size.y / 2, z: part.size.z / 2 };
    b.age = 0;
    piece.material.color.setHex(part.color);
    piece.mesh.scale.set(part.size.x, part.size.y, part.size.z);
    piece.mesh.visible = true;
    piece.active = true;
    this.place(piece);
  }

  update(dt: number): void {
    if (!(dt > 0) || dt > 0.25) dt = Math.min(Math.max(dt || 0, 0), 0.25);
    for (const piece of this.pieces) {
      if (!piece.active) continue;
      stepDebris(piece.body, dt);
      if (piece.body.age >= DEBRIS.LIFE) {
        piece.active = false;
        piece.mesh.visible = false;
        continue;
      }
      this.place(piece);
    }
  }

  /** Removes every piece (a new round). */
  clear(): void {
    for (const piece of this.pieces) {
      piece.active = false;
      piece.mesh.visible = false;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    for (const piece of this.pieces) piece.material.dispose();
    this.object.removeFromParent();
  }

  private oldest(): Piece {
    return this.pieces.reduce((a, b) => (b.body.age > a.body.age ? b : a));
  }

  private place(piece: Piece): void {
    const { pos, quat, half, age } = piece.body;
    piece.mesh.position.set(pos.x, pos.y, pos.z);
    piece.mesh.quaternion.set(quat.x, quat.y, quat.z, quat.w);
    const fade = Math.min(1, Math.max(0, (DEBRIS.LIFE - age) / DEBRIS.FADE));
    piece.mesh.scale.set(half.x * 2 * fade, half.y * 2 * fade, half.z * 2 * fade);
  }
}
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/client/particles.test.ts tests/client/debris.test.ts && npm run typecheck`
Expected: PASS — 16 tests; type-check clean.

<!-- check {"cmd": "npx vitest run tests/client/particles.test.ts tests/client/debris.test.ts && npm run typecheck", "outcome": "pass", "tests": 16} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(client): GPU particles for sparks, smoke, fire and dust, and flying debris"
```

<!-- commit "feat(client): GPU particles for sparks, smoke, fire and dust, and flying debris" -->

---

### Task 40: Tyre marks and camera shake

**Files:**
- Create: `src/client/game/skidMarks.ts`, `src/client/game/shake.ts`
- Test: `tests/client/skidMarks.test.ts`, `tests/client/shake.test.ts`

**Interfaces:**
- Consumes: `ARENA.RADIUS`, `clamp`, three.js canvas texture and `PerspectiveCamera`.
- Produces: `SKID`, `worldToTexture(x, z)`, `skidStrength(car)`, `MarkSurface`, `SkidMarks(surface)` with `wheel(key, x, z, strength)`, `takeDirty()`, `clear()`, and the browser side `CanvasMarks` (`texture`, `mesh`, `line`, `clear`, `upload`, `dispose`); `SHAKE`, `traumaForImpact(kns, distance)`, `shakeOffset(trauma, t)`, `CameraShake` with `add`, `apply(camera, dt)`, `level`, `reset()`. Task 44 uses them.

- [ ] **Step 1: Write the failing tests**

`skidMarks.test.ts` pins the mapping from the world to the texture (the ground plane is turned, so canvas y grows with world z), when a tyre skids (sliding sideways, the handbrake at speed, standing on the brake, never in the air), and the mark recorder: a line from where a wheel was to where it is (never across a teleport), broken when the wheel stops skidding, darker for a harder skid, wiped for a new round. `shake.test.ts` pins the trauma model: bigger impacts jolt more, far ones less, the offset grows with the square of the trauma and never exceeds its maximum, and the camera settles by itself.

Create `tests/client/skidMarks.test.ts`:

<!-- op {"kind": "create", "path": "tests/client/skidMarks.test.ts"} -->
```ts
import { describe, expect, it } from 'vitest';
import { SKID, SkidMarks, skidStrength, worldToTexture, type MarkSurface } from '../../src/client/game/skidMarks';

class Recorder implements MarkSurface {
  lines: Array<[number, number, number, number, number, number]> = [];
  cleared = 0;
  line(x0: number, y0: number, x1: number, y1: number, width: number, alpha: number): void {
    this.lines.push([x0, y0, x1, y1, width, alpha]);
  }
  clear(): void {
    this.cleared++;
  }
}
const rolling = { forward: 12, lateral: 0, handbrake: false, grounded: true, throttle: 1 };

describe('worldToTexture', () => {
  it('puts the middle of the arena in the middle of the texture and its edges on the texture\'s edges', () => {
    expect(worldToTexture(0, 0)).toEqual({ u: SKID.SIZE / 2, v: SKID.SIZE / 2 });
    expect(worldToTexture(-SKID.EXTENT, -SKID.EXTENT)).toEqual({ u: 0, v: 0 });
    const far = worldToTexture(SKID.EXTENT, SKID.EXTENT);
    expect([far.u, far.v]).toEqual([SKID.SIZE, SKID.SIZE]);
  });

  it('runs down the canvas as z grows, the way the ground plane is turned', () => {
    expect(worldToTexture(0, 10).v).toBeGreaterThan(worldToTexture(0, -10).v);
    expect(worldToTexture(10, 0).u).toBeGreaterThan(worldToTexture(-10, 0).u);
  });
});

describe('skidStrength', () => {
  it('is zero for a car that just rolls, and for one in the air', () => {
    expect(skidStrength(rolling)).toBe(0);
    expect(skidStrength({ ...rolling, lateral: 20, handbrake: true, grounded: false })).toBe(0);
  });

  it('grows as the car slides further sideways, up to a full skid', () => {
    const at = (lateral: number) => skidStrength({ ...rolling, lateral });
    expect(at(2)).toBe(0);
    expect(at(4)).toBeGreaterThan(0);
    expect(at(6)).toBeGreaterThan(at(4));
    expect(at(30)).toBe(1);
    expect(at(-6)).toBe(at(6)); // either way
  });

  it('locks the tyres with the handbrake at speed, and standing on the brake from a high speed', () => {
    expect(skidStrength({ ...rolling, handbrake: true })).toBeGreaterThanOrEqual(0.7);
    expect(skidStrength({ ...rolling, handbrake: true, forward: 1 })).toBe(0); // too slow to matter
    expect(skidStrength({ ...rolling, throttle: -1 })).toBeGreaterThan(0);
    expect(skidStrength({ ...rolling, throttle: -1, forward: 4 })).toBe(0);
    expect(skidStrength({ ...rolling, throttle: -1, forward: -12 })).toBe(0); // reversing is not braking
  });

  it('copes with broken numbers', () => {
    expect(skidStrength({ ...rolling, lateral: Number.NaN, handbrake: false })).toBe(0);
  });
});

describe('SkidMarks', () => {
  it('draws a line from where a skidding wheel was to where it is, and only from the second frame on', () => {
    const surface = new Recorder();
    const marks = new SkidMarks(surface);
    marks.wheel(0, 0, 0, 1);
    expect(surface.lines).toHaveLength(0);
    expect(marks.takeDirty()).toBe(false);
    marks.wheel(0, 1, 0, 1);
    expect(surface.lines).toHaveLength(1);
    const [x0, y0, x1, y1, width, alpha] = surface.lines[0]!;
    expect([x0, y0]).toEqual([worldToTexture(0, 0).u, worldToTexture(0, 0).v]);
    expect([x1, y1]).toEqual([worldToTexture(1, 0).u, worldToTexture(1, 0).v]);
    expect(width).toBeCloseTo(SKID.WIDTH * (SKID.SIZE / (2 * SKID.EXTENT)), 9);
    expect(alpha).toBeCloseTo(SKID.ALPHA, 9);
    expect(marks.takeDirty()).toBe(true);
    expect(marks.takeDirty()).toBe(false); // once
  });

  it('breaks the line when the wheel stops skidding, and darkens it with the strength of the skid', () => {
    const surface = new Recorder();
    const marks = new SkidMarks(surface);
    marks.wheel(3, 0, 0, 0.5);
    marks.wheel(3, 1, 0, 0.5);
    marks.wheel(3, 2, 0, 0); // rolling again
    marks.wheel(3, 3, 0, 0.5); // a new line starts here: no segment back to (2, 0)
    marks.wheel(3, 4, 0, 1);
    expect(surface.lines).toHaveLength(2);
    expect(surface.lines[0]![5]).toBeCloseTo(SKID.ALPHA * 0.5, 9);
    expect(surface.lines[1]![5]).toBeCloseTo(SKID.ALPHA, 9);
  });

  it('keeps every wheel\'s line apart, and never draws a line across a teleport', () => {
    const surface = new Recorder();
    const marks = new SkidMarks(surface);
    marks.wheel(0, 0, 0, 1);
    marks.wheel(1, 20, 20, 1);
    marks.wheel(0, 1, 0, 1);
    marks.wheel(1, 21, 20, 1);
    expect(surface.lines).toHaveLength(2);
    marks.wheel(0, 30, -30, 1); // a jump of 40 m in one frame
    expect(surface.lines).toHaveLength(2);
  });

  it('ignores broken numbers and wipes the ground for a new round', () => {
    const surface = new Recorder();
    const marks = new SkidMarks(surface);
    marks.wheel(0, Number.NaN, 0, 1);
    marks.wheel(0, 0, 0, Number.NaN);
    marks.wheel(0, 0, 0, 1);
    marks.wheel(0, 1, 0, 1);
    expect(surface.lines).toHaveLength(1);
    marks.clear();
    expect(surface.cleared).toBe(1);
    marks.wheel(0, 2, 0, 1); // the wheel's last position was forgotten too
    expect(surface.lines).toHaveLength(1);
    expect(marks.takeDirty()).toBe(true);
  });
});
```

Create `tests/client/shake.test.ts`:

<!-- op {"kind": "create", "path": "tests/client/shake.test.ts"} -->
```ts
import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { CameraShake, SHAKE, shakeOffset, traumaForImpact } from '../../src/client/game/shake';

describe('traumaForImpact', () => {
  it('grows with the size of the impact up to a full jolt', () => {
    expect(traumaForImpact(0)).toBe(0);
    expect(traumaForImpact(5)).toBeCloseTo(0.2, 9);
    expect(traumaForImpact(SHAKE.FULL_IMPACT)).toBe(1);
    expect(traumaForImpact(400)).toBe(1);
  });

  it('is weaker the further away it happened, and half as strong at the hearing distance times one', () => {
    expect(traumaForImpact(25, SHAKE.HEARD_DISTANCE)).toBeCloseTo(0.5, 9);
    expect(traumaForImpact(25, 40)).toBeLessThan(traumaForImpact(25, 10));
  });

  it('is zero for broken numbers', () => {
    expect(traumaForImpact(Number.NaN)).toBe(0);
    expect(traumaForImpact(-3)).toBe(0);
    expect(traumaForImpact(10, Number.NaN)).toBe(0);
  });
});

describe('shakeOffset', () => {
  it('is nothing without trauma, and never exceeds the maximum with it', () => {
    expect(shakeOffset(0, 5)).toEqual({ x: 0, y: 0, roll: 0 });
    for (let t = 0; t < 20; t += 0.013) {
      const s = shakeOffset(1, t);
      expect(Math.abs(s.x)).toBeLessThanOrEqual(SHAKE.MAX_OFFSET);
      expect(Math.abs(s.y)).toBeLessThanOrEqual(SHAKE.MAX_OFFSET);
      expect(Math.abs(s.roll)).toBeLessThanOrEqual(SHAKE.MAX_ROLL);
    }
  });

  it('grows with the square of the trauma, so a small knock is barely felt', () => {
    const size = (trauma: number): number => {
      let most = 0;
      for (let t = 0; t < 20; t += 0.01) most = Math.max(most, Math.abs(shakeOffset(trauma, t).x));
      return most;
    };
    expect(size(0.5) / size(1)).toBeCloseTo(0.25, 1);
  });

  it('is repeatable and smooth from one moment to the next', () => {
    expect(shakeOffset(0.8, 3.3)).toEqual(shakeOffset(0.8, 3.3));
    expect(Math.abs(shakeOffset(1, 3.3).x - shakeOffset(1, 3.301).x)).toBeLessThan(0.02);
  });
});

describe('CameraShake', () => {
  it('adds up jolts, never beyond a full one, and dies away by itself', () => {
    const shake = new CameraShake();
    const camera = new PerspectiveCamera();
    shake.add(0.6);
    shake.add(0.6);
    expect(shake.level).toBe(1);
    shake.apply(camera, 0.25);
    expect(shake.level).toBeCloseTo(1 - SHAKE.DECAY * 0.25, 9);
    for (let i = 0; i < 20; i++) shake.apply(camera, 0.1);
    expect(shake.level).toBe(0);
  });

  it('moves the camera while there is trauma and leaves it alone afterwards', () => {
    const shake = new CameraShake();
    const camera = new PerspectiveCamera();
    camera.position.set(3, 4, 5);
    shake.apply(camera, 0.016);
    expect(camera.position.toArray()).toEqual([3, 4, 5]);
    shake.add(1);
    let moved = false;
    for (let i = 0; i < 10; i++) {
      camera.position.set(3, 4, 5);
      camera.rotation.set(0, 0, 0);
      shake.apply(camera, 0.016);
      if (camera.position.x !== 3 || camera.rotation.z !== 0) moved = true;
    }
    expect(moved).toBe(true);
  });

  it('ignores broken jolts and frame times, and forgets everything on reset', () => {
    const shake = new CameraShake();
    const camera = new PerspectiveCamera();
    shake.add(Number.NaN);
    shake.add(-1);
    expect(shake.level).toBe(0);
    shake.add(0.5);
    shake.apply(camera, Number.NaN);
    shake.apply(camera, 1e9);
    expect(shake.level).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(camera.position.x + camera.position.y + camera.position.z)).toBe(true);
    shake.add(1);
    shake.reset();
    expect(shake.level).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/client/skidMarks.test.ts tests/client/shake.test.ts`
Expected: FAIL — both files fail to load: `src/client/game/skidMarks` and `src/client/game/shake` do not exist yet.

<!-- check {"cmd": "npx vitest run tests/client/skidMarks.test.ts tests/client/shake.test.ts", "outcome": "fail", "match": "Failed to resolve import|Cannot find module|Does the file exist"} -->

- [ ] **Step 3: Implement**

`src/client/game/skidMarks.ts` — tyre marks drawn into one texture that covers the arena. The drawing target is an interface, so the logic is tested with a recorder and the browser gets a canvas.

Create `src/client/game/skidMarks.ts`:

<!-- op {"kind": "create", "path": "src/client/game/skidMarks.ts"} -->
```ts
import * as THREE from 'three';
import { ARENA } from '../../shared/constants';
import { clamp } from '../../shared/math';

export const SKID = {
  /** Side of the marks texture in pixels, and the half-width of the world square it covers (metres). */
  SIZE: 1024,
  EXTENT: ARENA.RADIUS + 2,
  /** Sideways speed (m/s) above which a tyre is sliding, and the forward speed above which the handbrake locks it. */
  SLIDE_SPEED: 2.5,
  HANDBRAKE_SPEED: 3,
  /** A wheel that moved further than this between two frames was teleported (a new round, a correction): do not draw a line across the arena. */
  MAX_SEGMENT: 3,
  /** Width of a mark in metres and its darkest opacity. */
  WIDTH: 0.34,
  ALPHA: 0.5,
} as const;

/** Where a world point lands on the marks texture (pixels; x to the right, y down as canvases do), for the plane the marks are drawn on. */
export function worldToTexture(x: number, z: number): { u: number; v: number } {
  const scale = SKID.SIZE / (2 * SKID.EXTENT);
  return { u: (x + SKID.EXTENT) * scale, v: (z + SKID.EXTENT) * scale };
}

/**
 * How hard a tyre skids, from 0 (rolling) to 1 (locked and sliding), from the car's velocity in its own frame: sliding sideways,
 * the handbrake at speed, or standing on the brake from a high speed. Nothing while the wheels are off the ground.
 */
export function skidStrength(car: { forward: number; lateral: number; handbrake: boolean; grounded: boolean; throttle: number }): number {
  if (!car.grounded) return 0;
  const side = Math.abs(car.lateral);
  let strength = side > SKID.SLIDE_SPEED ? clamp((side - SKID.SLIDE_SPEED) / 5, 0, 1) : 0;
  if (car.handbrake && Math.abs(car.forward) > SKID.HANDBRAKE_SPEED) strength = Math.max(strength, 0.7);
  if (car.throttle * car.forward < -0.5 && Math.abs(car.forward) > 8) strength = Math.max(strength, 0.4);
  return Number.isFinite(strength) ? strength : 0;
}

/** Where marks are drawn: a canvas in the browser, a recorder in tests. */
export interface MarkSurface {
  line(x0: number, y0: number, x1: number, y1: number, width: number, alpha: number): void;
  clear(): void;
}

/**
 * Tyre marks on the ground, drawn into one texture that covers the arena. A wheel that skids leaves a line from where it was last
 * frame to where it is now; when it stops skidding the line breaks. Cheap: a few 2D lines a frame, one texture upload.
 */
export class SkidMarks {
  private readonly last = new Map<number, { x: number; z: number }>();
  private dirty = false;

  constructor(private readonly surface: MarkSurface) {}

  /** A wheel (`slot * 4 + wheel`) is at (x, z) this frame, skidding with `strength` (0 = not skidding). */
  wheel(key: number, x: number, z: number, strength: number): void {
    if (!Number.isFinite(x + z + strength) || strength < 0.05) {
      this.last.delete(key);
      return;
    }
    const before = this.last.get(key);
    this.last.set(key, { x, z });
    if (!before || Math.hypot(x - before.x, z - before.z) > SKID.MAX_SEGMENT) return;
    const a = worldToTexture(before.x, before.z);
    const b = worldToTexture(x, z);
    this.surface.line(a.u, a.v, b.u, b.v, SKID.WIDTH * (SKID.SIZE / (2 * SKID.EXTENT)), SKID.ALPHA * clamp(strength, 0, 1));
    this.dirty = true;
  }

  /** True once after something was drawn: the texture has to be uploaded. */
  takeDirty(): boolean {
    const d = this.dirty;
    this.dirty = false;
    return d;
  }

  /** A new round: wipe the ground. */
  clear(): void {
    this.surface.clear();
    this.last.clear();
    this.dirty = true;
  }
}

/** The browser side: a canvas, its texture and the plane that shows it just above the ground. */
export class CanvasMarks implements MarkSurface {
  readonly texture: THREE.CanvasTexture;
  readonly mesh: THREE.Mesh;
  private readonly context: CanvasRenderingContext2D;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = SKID.SIZE;
    canvas.height = SKID.SIZE;
    this.context = canvas.getContext('2d')!;
    this.context.lineCap = 'round';
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * SKID.EXTENT, 2 * SKID.EXTENT), material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.03;
    this.mesh.renderOrder = 1;
  }

  line(x0: number, y0: number, x1: number, y1: number, width: number, alpha: number): void {
    const g = this.context;
    g.strokeStyle = `rgba(8, 6, 4, ${alpha.toFixed(3)})`;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  }

  clear(): void {
    this.context.clearRect(0, 0, SKID.SIZE, SKID.SIZE);
  }

  /** Uploads the canvas to the GPU. */
  upload(): void {
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.removeFromParent();
  }
}
```

`src/client/game/shake.ts` — trauma-based camera shake.

Create `src/client/game/shake.ts`:

<!-- op {"kind": "create", "path": "src/client/game/shake.ts"} -->
```ts
import type { PerspectiveCamera } from 'three';
import { clamp } from '../../shared/math';

export const SHAKE = {
  /** Trauma lost per second. */
  DECAY: 1.6,
  /** Shake at full trauma: sideways/vertical metres and roll in radians. */
  MAX_OFFSET: 0.35,
  MAX_ROLL: 0.03,
  /** An impact of this many kN·s is a full jolt. */
  FULL_IMPACT: 25,
  /** Shakes from cars other than yours reach this far (metres) before they are half as strong. */
  HEARD_DISTANCE: 12,
} as const;

/** How much of a jolt an impact is (0..1): by its size, and how far from the camera it happened (0 for your own car). */
export function traumaForImpact(kns: number, distance = 0): number {
  if (!(kns > 0) || !Number.isFinite(distance)) return 0;
  const size = clamp(kns / SHAKE.FULL_IMPACT, 0, 1);
  const d = Math.max(0, distance) / SHAKE.HEARD_DISTANCE;
  return size / (1 + d * d);
}

/** Smooth repeatable noise in [-1, 1]: three sines that never line up. */
const noise = (t: number, seed: number): number => (Math.sin(t * 17.3 + seed) + 0.5 * Math.sin(t * 29.1 + seed * 2.3) + 0.25 * Math.sin(t * 43.7 + seed * 3.1)) / 1.75;

/** The camera's offset at time `t` for a trauma level: it grows with the square of the trauma, so small knocks are barely felt. */
export function shakeOffset(trauma: number, t: number): { x: number; y: number; roll: number } {
  const s = clamp(trauma, 0, 1) ** 2;
  if (s === 0) return { x: 0, y: 0, roll: 0 };
  return { x: SHAKE.MAX_OFFSET * s * noise(t, 1), y: SHAKE.MAX_OFFSET * s * noise(t, 7), roll: SHAKE.MAX_ROLL * s * noise(t, 13) };
}

/** Camera shake that builds up with impacts and dies away by itself. */
export class CameraShake {
  private trauma = 0;
  private time = 0;

  get level(): number {
    return this.trauma;
  }

  /** A jolt: trauma adds up, never beyond 1. */
  add(amount: number): void {
    if (!(amount > 0)) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Moves the camera by this frame's shake (call after the camera has been placed) and lets the trauma decay. */
  apply(camera: PerspectiveCamera, dt: number): void {
    const step = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;
    this.time += step;
    const offset = shakeOffset(this.trauma, this.time);
    if (offset.x !== 0 || offset.y !== 0 || offset.roll !== 0) {
      camera.translateX(offset.x);
      camera.translateY(offset.y);
      camera.rotateZ(offset.roll);
    }
    this.trauma = Math.max(0, this.trauma - SHAKE.DECAY * step);
  }

  reset(): void {
    this.trauma = 0;
  }
}
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/client/skidMarks.test.ts tests/client/shake.test.ts && npm run typecheck`
Expected: PASS — 19 tests; type-check clean.

<!-- check {"cmd": "npx vitest run tests/client/skidMarks.test.ts tests/client/shake.test.ts && npm run typecheck", "outcome": "pass", "tests": 19} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(client): tyre marks on the ground and trauma-based camera shake"
```

<!-- commit "feat(client): tyre marks on the ground and trauma-based camera shake" -->

---

### Task 41: Sound

**Files:**
- Create: `src/client/game/audioParams.ts`, `src/client/game/audio.ts`, `tests/helpers/fakeAudio.ts`
- Test: `tests/client/audio.test.ts`

**Interfaces:**
- Consumes: `clamp`, `quatRotate`, `vlen`, `vsub`, `Phase` (protocol), the Web Audio API.
- Produces: `engineVoice(speed, throttle)`, `distanceGain(d)`, `stereoPan(right)`, `crashVoice(kns)`, `CountdownBeeper.next(view)`, `Beep`; `AudioEngine(makeContext?)` with `unlock()`, `ready`, `muted`, `setMuted`, `update(listener, cars)`, `crash(kns, at, listener)`, `horn()`, `beep(kind)`, `dispose()`, and `Listener`, `EngineCar`. The test helper `FakeContext`, `engineWith`. Tasks 44-45 use them.

- [ ] **Step 1: Write the failing tests**

Sound is synthesised, so it is tested against a stand-in for the browser's `AudioContext` that records the nodes made and the parameters set (kept in `tests/helpers/fakeAudio.ts`, because the effects director's tests use it too). The tests pin the sound design as numbers (an engine rises with speed and throttle, fades with distance, sits left or right of the listener, crashes are louder, lower and longer when bigger), the countdown beeps (the last three seconds and GO, once each), and the engine's behaviour: nothing exists until a gesture unlocks it, one engine per running car and none for a wreck, an engine stops when its car goes, muting, crash and horn sounds that end by themselves, silence without failing when there is no Web Audio, and closing the context on dispose.

Create `tests/helpers/fakeAudio.ts`:

<!-- op {"kind": "create", "path": "tests/helpers/fakeAudio.ts"} -->
```ts
import { AudioEngine } from '../../src/client/game/audio';

/** Stand-ins for the browser's AudioContext and its nodes: they record what was made and which parameters were set. */
export class Param {
  value = 0;
  targets: number[] = [];
  setTargetAtTime(v: number): void {
    this.value = v;
    this.targets.push(v);
  }
  setValueAtTime(v: number): void {
    this.value = v;
  }
  exponentialRampToValueAtTime(): void {}
}
export class Node {
  gain = new Param();
  frequency = new Param();
  pan = new Param();
  Q = new Param();
  type = '';
  buffer: unknown = null;
  onended: (() => void) | null = null;
  started = 0;
  stopped = 0;
  disconnected = 0;
  connectedTo: Node[] = [];
  connect(n: Node): Node {
    this.connectedTo.push(n);
    return n;
  }
  disconnect(): void {
    this.disconnected++;
  }
  start(): void {
    this.started++;
  }
  stop(): void {
    this.stopped++;
  }
}
export class FakeContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0;
  sampleRate = 8000;
  destination = new Node();
  nodes: Node[] = [];
  resumed = 0;
  closed = 0;
  private make(): Node {
    const n = new Node();
    this.nodes.push(n);
    return n;
  }
  createGain = () => this.make();
  createOscillator = () => this.make();
  createBiquadFilter = () => this.make();
  createStereoPanner = () => this.make();
  createBufferSource = () => this.make();
  createBuffer = (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) });
  async resume(): Promise<void> {
    this.resumed++;
    this.state = 'running';
  }
  async close(): Promise<void> {
    this.closed++;
    this.state = 'closed';
  }
}
export const engineWith = (ctx: FakeContext | null | (() => never)) => new AudioEngine((typeof ctx === 'function' ? ctx : () => ctx) as unknown as () => AudioContext | null);
```

Create `tests/client/audio.test.ts`:

<!-- op {"kind": "create", "path": "tests/client/audio.test.ts"} -->
```ts
import { describe, expect, it } from 'vitest';
import { AudioEngine, type EngineCar, type Listener } from '../../src/client/game/audio';
import { FakeContext, engineWith } from '../helpers/fakeAudio';
import { CountdownBeeper, crashVoice, distanceGain, engineVoice, stereoPan } from '../../src/client/game/audioParams';

const still: Listener = { pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 } };
const car = (slot: number, over: Partial<EngineCar> = {}): EngineCar => ({ slot, pos: { x: 5, y: 0, z: 0 }, speed: 10, throttle: 1, alive: true, ...over });

describe('engineVoice', () => {
  it('rises with speed and with the driver\'s foot, within limits', () => {
    expect(engineVoice(20, 0).frequency).toBeGreaterThan(engineVoice(5, 0).frequency);
    expect(engineVoice(10, 1).frequency).toBeGreaterThan(engineVoice(10, 0).frequency);
    expect(engineVoice(10, 1).cutoff).toBeGreaterThan(engineVoice(10, 0).cutoff);
    expect(engineVoice(10, 1).gain).toBeGreaterThan(engineVoice(10, 0).gain);
    for (const [s, t] of [[1000, 5], [-30, -9], [0, 0]] as const) {
      const v = engineVoice(s, t);
      expect(v.frequency).toBeGreaterThanOrEqual(45);
      expect(v.frequency).toBeLessThanOrEqual(260);
      expect(v.gain).toBeLessThanOrEqual(0.3);
    }
  });

  it('copes with broken numbers', () => {
    const v = engineVoice(Number.NaN, Number.POSITIVE_INFINITY);
    for (const n of [v.frequency, v.gain, v.cutoff]) expect(Number.isFinite(n)).toBe(true);
  });
});

describe('distanceGain and stereoPan', () => {
  it('fade a sound with distance, to nothing far away', () => {
    expect(distanceGain(0)).toBe(1);
    expect(distanceGain(15)).toBeCloseTo(0.5, 9);
    expect(distanceGain(60)).toBeLessThan(distanceGain(30));
    expect(distanceGain(120)).toBe(0);
    expect(distanceGain(Number.NaN)).toBe(0);
  });

  it('put a sound left or right by which side it is on, never past the edge', () => {
    expect(stereoPan(0)).toBe(0);
    expect(stereoPan(8)).toBeCloseTo(0.5, 9);
    expect(stereoPan(-8)).toBeCloseTo(-0.5, 9);
    expect(Math.abs(stereoPan(1e9))).toBeLessThanOrEqual(1);
    expect(stereoPan(Number.NaN)).toBe(0);
  });
});

describe('crashVoice', () => {
  it('makes a bigger crash louder, longer and lower', () => {
    const small = crashVoice(3);
    const big = crashVoice(25);
    expect(big.gain).toBeGreaterThan(small.gain);
    expect(big.seconds).toBeGreaterThan(small.seconds);
    expect(big.thumpHz).toBeLessThan(small.thumpHz);
    expect(crashVoice(1000)).toEqual(big);
    expect(crashVoice(Number.NaN).gain).toBeCloseTo(0.15, 9);
  });
});

describe('CountdownBeeper', () => {
  it('beeps for the last three seconds of the countdown and again when the round goes live, once each', () => {
    const b = new CountdownBeeper();
    const seen: Array<string | null> = [];
    for (const [phase, clock] of [['countdown', '5'], ['countdown', '5'], ['countdown', '4'], ['countdown', '3'], ['countdown', '3'], ['countdown', '2'], ['countdown', '1'], ['live', '1:30'], ['live', '1:29']] as const) {
      seen.push(b.next({ phase, clock }));
    }
    expect(seen).toEqual([null, null, null, 'count', null, 'count', 'count', 'go', null]);
  });

  it('starts over for the next round, and does not go off for a player who joins while it is live', () => {
    const b = new CountdownBeeper();
    expect(b.next({ phase: 'live', clock: '1:00' })).toBeNull();
    expect(b.next({ phase: 'results', clock: '8' })).toBeNull();
    expect(b.next({ phase: 'countdown', clock: '3' })).toBe('count');
    expect(b.next({ phase: null, clock: '' })).toBeNull();
    expect(b.next({ phase: 'countdown', clock: '3' })).toBe('count'); // a restarted countdown beeps again
  });
});

describe('AudioEngine', () => {
  it('does nothing, and does not fail, until it is unlocked', () => {
    const ctx = new FakeContext();
    const audio = engineWith(ctx);
    audio.update(still, [car(0)]);
    audio.crash(20, { x: 1, y: 0, z: 0 }, still);
    audio.horn();
    audio.beep('go');
    expect(ctx.nodes).toHaveLength(0);
    expect(audio.ready).toBe(false);
  });

  it('creates its audio context once, from the first gesture, and wakes it up', () => {
    let made = 0;
    const ctx = new FakeContext();
    const audio = new AudioEngine((() => {
      made++;
      return ctx;
    }) as unknown as () => AudioContext);
    audio.unlock();
    audio.unlock();
    expect(made).toBe(1);
    expect(ctx.resumed).toBeGreaterThanOrEqual(1);
    expect(ctx.state).toBe('running');
    expect(audio.ready).toBe(true);
  });

  it('keeps one engine per running car, tuned to it, and none for a wreck', () => {
    const ctx = new FakeContext();
    const audio = engineWith(ctx);
    audio.unlock();
    const before = ctx.nodes.length;
    audio.update(still, [car(0), car(1, { alive: false }), car(2, { speed: 20 })]);
    expect(ctx.nodes.length - before).toBe(2 * 5); // two engines: two oscillators, a filter, a gain and a panner
    audio.update(still, [car(0), car(2, { speed: 20 })]);
    expect(ctx.nodes.length - before).toBe(2 * 5); // nothing new for cars that already sound
    const oscillators = ctx.nodes.filter((n) => n.started > 0 && n.frequency.targets.length > 0);
    const want = engineVoice(10, 1).frequency;
    expect(oscillators.some((n) => Math.abs(n.frequency.value - want) < 1e-9)).toBe(true);
  });

  it('stops the engine of a car that has gone', () => {
    const ctx = new FakeContext();
    const audio = engineWith(ctx);
    audio.unlock();
    audio.update(still, [car(0), car(1)]);
    const started = ctx.nodes.filter((n) => n.started > 0);
    expect(started).toHaveLength(4);
    audio.update(still, [car(0)]);
    expect(started.filter((n) => n.stopped > 0)).toHaveLength(2);
    expect(ctx.nodes.filter((n) => n.disconnected > 0)).toHaveLength(1); // the panner of the car that left
  });

  it('puts a car on the right of the listener in the right ear, and a far one lower', () => {
    const ctx = new FakeContext();
    const audio = engineWith(ctx);
    audio.unlock();
    audio.update(still, [car(0, { pos: { x: 0, y: 0, z: 12 } }), car(1, { pos: { x: 0, y: 0, z: -12 } }), car(2, { pos: { x: 0, y: 0, z: 90 } })]);
    const pans = ctx.nodes.filter((n) => n.pan.targets.length > 0).map((n) => n.pan.value);
    expect(pans[0]!).toBeGreaterThan(0);
    expect(pans[1]!).toBeLessThan(0);
    const gains = ctx.nodes.filter((n) => n.gain.targets.length > 0).map((n) => n.gain.value);
    expect(gains[2]!).toBeLessThan(gains[0]!);
  });

  it('mutes and unmutes', () => {
    const ctx = new FakeContext();
    const audio = engineWith(ctx);
    audio.unlock();
    const master = ctx.nodes[0]!;
    expect(master.gain.value).toBeGreaterThan(0);
    audio.setMuted(true);
    expect([audio.muted, master.gain.value]).toEqual([true, 0]);
    audio.setMuted(false);
    expect(master.gain.value).toBeGreaterThan(0);
  });

  it('plays a crash near, and skips one too far away to hear', () => {
    const ctx = new FakeContext();
    const audio = engineWith(ctx);
    audio.unlock();
    const before = ctx.nodes.length;
    audio.crash(20, { x: 4, y: 0, z: 0 }, still);
    const added = ctx.nodes.slice(before);
    expect(added.length).toBeGreaterThan(4);
    expect(added.filter((n) => n.started > 0 && n.stopped > 0).length).toBeGreaterThanOrEqual(2); // the noise burst and the thump both end
    const after = ctx.nodes.length;
    audio.crash(20, { x: 500, y: 0, z: 0 }, still);
    expect(ctx.nodes.length).toBe(after);
  });

  it('plays a horn and the countdown beeps, each ending by itself', () => {
    const ctx = new FakeContext();
    const audio = engineWith(ctx);
    audio.unlock();
    const before = ctx.nodes.length;
    audio.horn();
    audio.beep('count');
    audio.beep('go');
    const oscillators = ctx.nodes.slice(before).filter((n) => n.started > 0);
    expect(oscillators.length).toBe(4); // two horn notes, two beeps
    expect(oscillators.every((n) => n.stopped > 0)).toBe(true);
  });

  it('stays silent, without failing, when there is no Web Audio, or it fails to start', () => {
    for (const make of [null, () => { throw new Error('blocked'); }] as const) {
      const audio = engineWith(make as never);
      audio.unlock();
      audio.update(still, [car(0)]);
      audio.crash(10, { x: 1, y: 0, z: 0 }, still);
      audio.setMuted(true);
      audio.dispose();
      expect(audio.ready).toBe(false);
    }
  });

  it('closes the audio context when it is disposed', () => {
    const ctx = new FakeContext();
    const audio = engineWith(ctx);
    audio.unlock();
    audio.update(still, [car(0)]);
    audio.dispose();
    expect(ctx.closed).toBe(1);
    expect(audio.ready).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/client/audio.test.ts`
Expected: FAIL — the test file fails to load: `src/client/game/audio` and `src/client/game/audioParams` do not exist yet.

<!-- check {"cmd": "npx vitest run tests/client/audio.test.ts", "outcome": "fail", "match": "Failed to resolve import|Cannot find module|Does the file exist"} -->

- [ ] **Step 3: Implement**

`src/client/game/audioParams.ts` — the numbers of the sound design, and the countdown beeper. Pure functions.

Create `src/client/game/audioParams.ts`:

<!-- op {"kind": "create", "path": "src/client/game/audioParams.ts"} -->
```ts
import { clamp } from '../../shared/math';
import type { Phase } from '../../shared/protocol';

/** What one car's engine sounds like, from how fast it goes and how hard its driver is on the throttle. */
export function engineVoice(speed: number, throttle: number): { frequency: number; gain: number; cutoff: number } {
  const v = Number.isFinite(speed) ? clamp(Math.abs(speed), 0, 30) : 0;
  const t = Number.isFinite(throttle) ? clamp(throttle, -1, 1) : 0;
  const push = Math.max(t, 0);
  return {
    frequency: clamp(55 + v * 5.2 + push * 18, 45, 260),
    gain: clamp(0.05 + 0.11 * Math.abs(t) + 0.05 * (v / 20), 0, 0.3),
    cutoff: 380 + v * 60 + push * 500,
  };
}

/** How loud a sound is at `distance` metres from the listener: full close by, gone at 120 m. */
export function distanceGain(distance: number): number {
  if (!Number.isFinite(distance) || distance >= 120) return 0;
  const d = Math.max(0, distance) / 15;
  return 1 / (1 + d * d);
}

/** Left-right position of a sound, -1 (left) to 1 (right), from how far to the listener's right it is. */
export function stereoPan(right: number): number {
  if (!Number.isFinite(right)) return 0;
  return clamp(right / (Math.abs(right) + 8), -1, 1);
}

/** A crash: how loud, how low the thump, how long and how bright the noise, from the impulse in kN·s. */
export function crashVoice(kns: number): { gain: number; thumpHz: number; seconds: number; noiseGain: number } {
  const k = Number.isFinite(kns) ? clamp(kns / 25, 0, 1) : 0;
  return { gain: 0.15 + 0.85 * k, thumpHz: 90 - 45 * k, seconds: 0.18 + 0.5 * k, noiseGain: 0.3 + 0.7 * k };
}

export type Beep = 'count' | 'go';

/**
 * Says when a countdown beep is due: `count` each time the number of seconds shown changes during the countdown, `go` when
 * the round goes live. Feed it what the match screen shows every frame.
 */
export class CountdownBeeper {
  private lastPhase: Phase | null = null;
  private lastSecond = -1;

  next(view: { phase: Phase | null; clock: string }): Beep | null {
    const phase = view.phase;
    let beep: Beep | null = null;
    if (phase === 'countdown') {
      const second = Number.parseInt(view.clock, 10);
      if (Number.isFinite(second) && second !== this.lastSecond && second <= 3) beep = 'count';
      if (Number.isFinite(second)) this.lastSecond = second;
    } else {
      this.lastSecond = -1;
      if (phase === 'live' && this.lastPhase === 'countdown') beep = 'go';
    }
    this.lastPhase = phase;
    return beep;
  }
}
```

`src/client/game/audio.ts` — the Web Audio engine: an engine voice per car (two oscillators through a low-pass filter, panned and attenuated by where the car is), one-shot crashes (a noise burst and a thump), the horn and the beeps, behind a master gain that `M` mutes.

Create `src/client/game/audio.ts`:

<!-- op {"kind": "create", "path": "src/client/game/audio.ts"} -->
```ts
import { quatRotate, vlen, vsub } from '../../shared/math';
import type { Quat, Vec3 } from '../../shared/types';
import { crashVoice, distanceGain, engineVoice, stereoPan, type Beep } from './audioParams';

/** Where the player is listening from (the car they drive or watch). */
export interface Listener {
  pos: Vec3;
  quat: Quat;
}

/** What an engine needs to know about one car each frame. */
export interface EngineCar {
  slot: number;
  pos: Vec3;
  speed: number;
  throttle: number;
  alive: boolean;
}

const MASTER_LEVEL = 0.55;
const SMOOTHING = 0.06; // seconds: the time constant of every parameter change, so nothing clicks

interface Voice {
  low: OscillatorNode;
  high: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode;
}

const browserContext = (): AudioContext | null => (typeof AudioContext === 'undefined' ? null : new AudioContext());

/**
 * All the sound of the game, synthesised: an engine per car (pitch from speed and throttle, quieter and panned by where the car
 * is), crashes (a noise burst and a thump, by the size of the impact), the horn and the countdown beeps. There are no sound files.
 * Browsers only allow sound after a gesture, so nothing exists until `unlock()` is called from one; without Web Audio it does nothing.
 */
export class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly voices = new Map<number, Voice>();
  private silenced = false;

  constructor(private readonly makeContext: () => AudioContext | null = browserContext) {}

  /** Creates the audio context (call it from a click or a key press) or wakes it up. Harmless to call again. */
  unlock(): void {
    if (!this.context) {
      try {
        this.context = this.makeContext();
      } catch {
        this.context = null;
      }
      const created = this.context;
      if (!created) return;
      this.master = created.createGain();
      this.master.gain.value = this.silenced ? 0 : MASTER_LEVEL;
      this.master.connect(created.destination);
      this.noise = created.createBuffer(1, Math.floor(created.sampleRate * 1), created.sampleRate);
      const samples = this.noise.getChannelData(0);
      let seed = 0x1234abcd;
      for (let i = 0; i < samples.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        samples[i] = (seed / 4294967296) * 2 - 1;
      }
    }
    const ctx = this.context;
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  }

  /** True once sound can actually play. */
  get ready(): boolean {
    return this.context !== null && this.context.state === 'running';
  }

  get muted(): boolean {
    return this.silenced;
  }

  setMuted(muted: boolean): void {
    this.silenced = muted;
    if (this.master && this.context) this.master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL, this.context.currentTime, 0.02);
  }

  /** Once per frame: keeps one engine per running car, tuned to its speed and throttle and placed by where it is. */
  update(listener: Listener, cars: readonly EngineCar[]): void {
    const ctx = this.context;
    if (!ctx || !this.master) return;
    const right = quatRotate(listener.quat, { x: 0, y: 0, z: 1 });
    const seen = new Set<number>();
    for (const car of cars) {
      if (!car.alive) continue; // a wreck is silent
      seen.add(car.slot);
      const offset = vsub(car.pos, listener.pos);
      const distance = vlen(offset);
      const voice = this.voices.get(car.slot) ?? this.addVoice(car.slot);
      const p = engineVoice(car.speed, car.throttle);
      const now = ctx.currentTime;
      voice.low.frequency.setTargetAtTime(p.frequency * 0.5, now, SMOOTHING);
      voice.high.frequency.setTargetAtTime(p.frequency, now, SMOOTHING);
      voice.filter.frequency.setTargetAtTime(p.cutoff, now, SMOOTHING);
      voice.gain.gain.setTargetAtTime(p.gain * distanceGain(distance), now, SMOOTHING);
      voice.pan.pan.setTargetAtTime(distance < 0.5 ? 0 : stereoPan(offset.x * right.x + offset.y * right.y + offset.z * right.z), now, SMOOTHING);
    }
    for (const slot of [...this.voices.keys()]) if (!seen.has(slot)) this.removeVoice(slot);
  }

  /** A crash of `kns` kN·s at `at`. */
  crash(kns: number, at: Vec3, listener: Listener): void {
    const ctx = this.context;
    if (!ctx || !this.master || !this.noise) return;
    const v = crashVoice(kns);
    const distance = vlen(vsub(at, listener.pos));
    const level = v.gain * distanceGain(distance);
    if (level < 0.01) return;
    const right = quatRotate(listener.quat, { x: 0, y: 0, z: 1 });
    const offset = vsub(at, listener.pos);
    const pan = ctx.createStereoPanner();
    pan.pan.value = distance < 0.5 ? 0 : stereoPan(offset.x * right.x + offset.y * right.y + offset.z * right.z);
    pan.connect(this.master);
    const now = ctx.currentTime;
    const burst = ctx.createBufferSource();
    burst.buffer = this.noise;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 900 + 3000 * (v.gain - 0.15);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(v.noiseGain * level, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + v.seconds);
    burst.connect(tone);
    tone.connect(noiseGain);
    noiseGain.connect(pan);
    burst.start(now);
    burst.stop(now + v.seconds + 0.05);
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(v.thumpHz, now);
    thump.frequency.exponentialRampToValueAtTime(28, now + 0.25);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(level, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    thump.connect(thumpGain);
    thumpGain.connect(pan);
    thump.start(now);
    thump.stop(now + 0.32);
    burst.onended = () => pan.disconnect();
  }

  /** Your own horn (other players cannot hear it: there is no horn on the wire). */
  horn(): void {
    const ctx = this.context;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.35, now + 0.03);
    gain.gain.setValueAtTime(0.35, now + 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    gain.connect(this.master);
    for (const hz of [392, 494]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = hz;
      o.connect(gain);
      o.start(now);
      o.stop(now + 0.52);
    }
  }

  beep(kind: Beep): void {
    const ctx = this.context;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const seconds = kind === 'go' ? 0.4 : 0.12;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = kind === 'go' ? 880 : 440;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + seconds);
    o.connect(gain);
    gain.connect(this.master);
    o.start(now);
    o.stop(now + seconds + 0.02);
  }

  dispose(): void {
    for (const slot of [...this.voices.keys()]) this.removeVoice(slot);
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.master = null;
    this.noise = null;
  }

  private addVoice(slot: number): Voice {
    const ctx = this.context!;
    const low = ctx.createOscillator();
    low.type = 'triangle';
    const high = ctx.createOscillator();
    high.type = 'sawtooth';
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    low.connect(filter);
    high.connect(filter);
    filter.connect(gain);
    gain.connect(pan);
    pan.connect(this.master!);
    low.start();
    high.start();
    const voice = { low, high, filter, gain, pan };
    this.voices.set(slot, voice);
    return voice;
  }

  private removeVoice(slot: number): void {
    const voice = this.voices.get(slot);
    if (!voice) return;
    voice.low.stop();
    voice.high.stop();
    voice.pan.disconnect();
    this.voices.delete(slot);
  }
}
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/client/audio.test.ts && npm run typecheck`
Expected: PASS — 17 tests; type-check clean.

<!-- check {"cmd": "npx vitest run tests/client/audio.test.ts && npm run typecheck", "outcome": "pass", "tests": 17} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(client): synthesised sound \u2014 engines, crashes, horn and countdown beeps"
```

<!-- commit "feat(client): synthesised sound \u2014 engines, crashes, horn and countdown beeps" -->

---

### Task 42: The arena and the glow

**Files:**
- Create: `src/client/game/dressing.ts`
- Modify: `src/client/game/scene.ts`
- Test: `tests/client/dressing.test.ts`

**Interfaces:**
- Consumes: `ARENA` (Plan 1), `mulberry32`, `createGameScene` (Plan 1), the three.js post-processing add-ons.
- Produces: `createDressing()` (`group`, `dispose()`), `tyreStacks()`, `crowd()`, `bowlHeight(r)`, `BOWL`, `OUTER_WALL`; `GameScene.setBloom(enabled)`; the scene now renders through bloom. Task 45 uses `setBloom`.

- [ ] **Step 1: Write the failing tests**

The look of the stadium is a layout problem that can be tested: every tyre stack stands outside the barrier (nothing a player can drive on is out there), the crowd sits on the bowl between its edges and never inside the arena, it is a big crowd that is still two draw calls, and it is the same every time. The bloom itself is a WebGL matter and is checked in the browser below.

Create `tests/client/dressing.test.ts`:

<!-- op {"kind": "create", "path": "tests/client/dressing.test.ts"} -->
```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BOWL, OUTER_WALL, bowlHeight, createDressing, crowd, tyreStacks } from '../../src/client/game/dressing';

const radius = (p: { x: number; z: number }): number => Math.hypot(p.x, p.z);

describe('tyreStacks', () => {
  it('stands every stack outside the barrier, where nobody can drive into it', () => {
    const stacks = tyreStacks();
    expect(stacks).toHaveLength(30);
    for (const s of stacks) {
      expect(radius(s)).toBeGreaterThan(OUTER_WALL + 0.5);
      expect(radius(s)).toBeLessThan(OUTER_WALL + 2.5);
      expect(s.y).toBe(0);
    }
  });

  it('is the same every time for the same seed, and different for another', () => {
    expect(tyreStacks(30, 3)).toEqual(tyreStacks(30, 3));
    expect(tyreStacks(30, 3)).not.toEqual(tyreStacks(30, 4));
  });

  it('goes all the way round', () => {
    const angles = tyreStacks().map((s) => Math.atan2(s.z, s.x));
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(Math.PI * 1.8);
  });
});

describe('crowd', () => {
  it('sits on the bowl, between its inner and outer edge, and never in the arena', () => {
    const people = crowd();
    for (const p of people) {
      const r = radius(p);
      expect(r).toBeGreaterThan(BOWL.INNER);
      expect(r).toBeLessThan(BOWL.OUTER);
      expect(r).toBeGreaterThan(OUTER_WALL + 5);
      expect(p.y).toBeCloseTo(bowlHeight(r) + 0.62 * p.scale, 9);
    }
  });

  it('is a big crowd that is still cheap to draw, the same every time, with a few gaps', () => {
    const people = crowd();
    expect(people.length).toBeGreaterThan(500);
    expect(people.length).toBeLessThan(2500);
    expect(crowd(5)).toEqual(people);
    const rows = new Set(people.map((p) => Math.round(radius(p) * 10)));
    expect(rows.size).toBeGreaterThan(5);
  });

  it('gives every spectator a jersey colour from the palette', () => {
    for (const p of crowd()) {
      expect(Number.isInteger(p.tint)).toBe(true);
      expect(p.tint).toBeGreaterThanOrEqual(0);
      expect(p.tint).toBeLessThan(8);
    }
  });
});

describe('bowlHeight', () => {
  it('starts on the ground at the inner edge and rises to the full height at the outer edge', () => {
    expect(bowlHeight(BOWL.INNER)).toBe(0);
    expect(bowlHeight(BOWL.OUTER)).toBeCloseTo(BOWL.HEIGHT, 9);
    expect(bowlHeight((BOWL.INNER + BOWL.OUTER) / 2)).toBeCloseTo(BOWL.HEIGHT / 2, 9);
  });
});

describe('createDressing', () => {
  it('builds the stands, the crowd and the tyres as three draw calls, and releases them when disposed', () => {
    const dressing = createDressing();
    const meshes = dressing.group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    expect(meshes).toHaveLength(3); // the bowl, and two instanced meshes
    const instanced = meshes.filter((m): m is THREE.InstancedMesh => m instanceof THREE.InstancedMesh);
    expect(instanced.map((m) => m.count).sort((a, b) => a - b)).toEqual([tyreStacks().length * 3, crowd().length]);
    let disposed = 0;
    for (const m of meshes) {
      m.geometry.addEventListener('dispose', () => disposed++);
      (m.material as THREE.Material).addEventListener('dispose', () => disposed++);
    }
    dressing.dispose();
    expect(disposed).toBe(6);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/client/dressing.test.ts`
Expected: FAIL — the test file fails to load: `src/client/game/dressing` does not exist yet.

<!-- check {"cmd": "npx vitest run tests/client/dressing.test.ts", "outcome": "fail", "match": "Failed to resolve import|Cannot find module|Does the file exist"} -->

- [ ] **Step 3: Implement**

`src/client/game/dressing.ts` — a stepped bowl of stands with a crowd of instanced silhouettes in jersey colours, and stacks of tyres outside the barrier; three meshes in all.

Create `src/client/game/dressing.ts`:

<!-- op {"kind": "create", "path": "src/client/game/dressing.ts"} -->
```ts
import * as THREE from 'three';
import { ARENA } from '../../shared/constants';
import { mulberry32 } from '../../shared/random';

/** Where one prop stands: position (m), turn about +Y (rad), size factor, and a palette index for its colour. */
export interface Placement {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  tint: number;
}

/** The rim of the wall's outer face: nothing the players can drive on is ever outside it. */
export const OUTER_WALL = ARENA.RADIUS + 2 * ARENA.WALL_HALF_THICKNESS;

/** The bowl the crowd sits on: a cone rising away from the barrier. */
export const BOWL = { INNER: ARENA.RADIUS + 9, OUTER: ARENA.RADIUS + 34, HEIGHT: 12 } as const;

/** Height of the bowl's surface at a distance from the middle of the arena. */
export function bowlHeight(radius: number): number {
  return ((radius - BOWL.INNER) / (BOWL.OUTER - BOWL.INNER)) * BOWL.HEIGHT;
}

const TYRES_PER_STACK = 3;
const TYRE_TUBE = 0.28;

/** Stacks of tyres on the ground just outside the barrier (a tyre is 0.56 m thick and there are three to a stack). */
export function tyreStacks(count = 30, seed = 11): Placement[] {
  const random = mulberry32(seed);
  const out: Placement[] = [];
  for (let i = 0; i < count; i++) {
    const a = ((i + (random() - 0.5) * 0.4) / count) * Math.PI * 2;
    const r = OUTER_WALL + 1.1 + random() * 0.4;
    out.push({ x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r, yaw: random() * Math.PI, scale: 0.9 + random() * 0.25, tint: 0 });
  }
  return out;
}

/** Spectators in rows on the bowl, a few gaps here and there, each with a jersey colour from the palette. */
export function crowd(seed = 5): Placement[] {
  const random = mulberry32(seed);
  const out: Placement[] = [];
  for (let radius = BOWL.INNER + 1.5; radius < BOWL.OUTER - 1; radius += 2.6) {
    const n = Math.floor((2 * Math.PI * radius) / 2.2);
    for (let i = 0; i < n; i++) {
      if (random() < 0.12) continue;
      const a = ((i + random() * 0.6) / n) * Math.PI * 2;
      const scale = 0.85 + random() * 0.3;
      out.push({ x: Math.cos(a) * radius, y: bowlHeight(radius) + 0.62 * scale, z: Math.sin(a) * radius, yaw: -a + Math.PI / 2, scale, tint: Math.floor(random() * JERSEYS.length) });
    }
  }
  return out;
}

const JERSEYS = [0x2a2f3d, 0x3a2a2a, 0x2a3a30, 0x4a4030, 0x30384a, 0x5a5a66, 0x6a2a2a, 0x2a4a5a];

/** The stands, the crowd and the tyre stacks: everything around the arena that is only there to look at. */
export interface Dressing {
  readonly group: THREE.Group;
  dispose(): void;
}

export function createDressing(): Dressing {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const dummy = new THREE.Object3D();

  const bowlGeometry = new THREE.CylinderGeometry(BOWL.OUTER, BOWL.INNER, BOWL.HEIGHT, 96, 1, true);
  const bowlMaterial = new THREE.MeshStandardMaterial({ color: 0x1a2236, roughness: 1, side: THREE.DoubleSide });
  geometries.push(bowlGeometry);
  materials.push(bowlMaterial);
  const bowl = new THREE.Mesh(bowlGeometry, bowlMaterial);
  bowl.position.y = BOWL.HEIGHT / 2;
  bowl.receiveShadow = true;
  group.add(bowl);

  const people = crowd();
  const personGeometry = new THREE.CapsuleGeometry(0.26, 0.62, 1, 5);
  const personMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
  geometries.push(personGeometry);
  materials.push(personMaterial);
  const crowdMesh = new THREE.InstancedMesh(personGeometry, personMaterial, people.length);
  const colour = new THREE.Color();
  people.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.yaw, 0);
    dummy.scale.setScalar(p.scale);
    dummy.updateMatrix();
    crowdMesh.setMatrixAt(i, dummy.matrix);
    crowdMesh.setColorAt(i, colour.setHex(JERSEYS[p.tint]!));
  });
  crowdMesh.instanceMatrix.needsUpdate = true;
  if (crowdMesh.instanceColor) crowdMesh.instanceColor.needsUpdate = true;
  group.add(crowdMesh);

  const stacks = tyreStacks();
  const tyreGeometry = new THREE.TorusGeometry(0.55, TYRE_TUBE, 8, 18);
  tyreGeometry.rotateX(Math.PI / 2); // lie flat
  const tyreMaterial = new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.9, flatShading: true });
  geometries.push(tyreGeometry);
  materials.push(tyreMaterial);
  const tyres = new THREE.InstancedMesh(tyreGeometry, tyreMaterial, stacks.length * TYRES_PER_STACK);
  tyres.castShadow = true;
  stacks.forEach((s, i) => {
    for (let k = 0; k < TYRES_PER_STACK; k++) {
      dummy.position.set(s.x, TYRE_TUBE * s.scale + k * 2 * TYRE_TUBE * s.scale, s.z);
      dummy.rotation.set(0, s.yaw + k * 0.7, 0);
      dummy.scale.setScalar(s.scale);
      dummy.updateMatrix();
      tyres.setMatrixAt(i * TYRES_PER_STACK + k, dummy.matrix);
    }
  });
  tyres.instanceMatrix.needsUpdate = true;
  group.add(tyres);

  return {
    group,
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      crowdMesh.dispose();
      tyres.dispose();
      group.removeFromParent();
    },
  };
}
```

`src/client/game/scene.ts` — the old dark ring of stands is replaced by the dressing, and the scene is drawn through an effect composer: render, bloom, tone-map. The bloom threshold is just above white, so only what is brighter than a lit surface glows (lamps, headlights, sparks, fire) and the plain white name tags stay crisp. Draw-call counting is switched to manual because the bloom passes render several times a frame.

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
import * as THREE from 'three';
import { obstacleBoxes, wallSegments, type BoxSpec } from '../../shared/arena';
```

with:

```ts
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { obstacleBoxes, wallSegments, type BoxSpec } from '../../shared/arena';
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
import { ARENA } from '../../shared/constants';
import { needsResize } from './viewport';
```

with:

```ts
import { ARENA } from '../../shared/constants';
import { createDressing } from './dressing';
import { needsResize } from './viewport';
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
  resize(): void;
  render(): void;
```

with:

```ts
  resize(): void;
  /** Draws the scene through the bloom pass (things brighter than the sky glow: lamps, headlights, sparks, fire). */
  render(): void;
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
  render(): void;
  dispose(): void;
```

with:

```ts
  render(): void;
  /** Turns the glow on or off (it is the most expensive part of a frame on a weak GPU). */
  setBloom(enabled: boolean): void;
  dispose(): void;
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
  renderer.toneMappingExposure = 1.05;

```

with:

```ts
  renderer.toneMappingExposure = 1.05;
  renderer.info.autoReset = false; // the bloom passes render several times a frame: count them all, reset once per frame

```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts

  // Dark stands ring behind the walls and a few floodlight masts (purely decorative in this plan).
  const standsGeometry = new THREE.CylinderGeometry(ARENA.RADIUS + 22, ARENA.RADIUS + 30, 10, 64, 1, true);
  geometries.push(standsGeometry);
  const standsMaterial = new THREE.MeshStandardMaterial({ color: 0x1a2236, roughness: 1, side: THREE.DoubleSide });
  materials.push(standsMaterial);
  const stands = new THREE.Mesh(standsGeometry, standsMaterial);
  stands.position.y = 5;
  scene.add(stands);

```

with:

```ts

  // The stands with their crowd, the tyre stacks outside the barrier, and a few floodlight masts.
  const dressing = createDressing();
  scene.add(dressing.group);

```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts

  function resize(): void {
```

with:

```ts

  // Bloom: the scene is drawn into a high-range buffer, the bright parts are blurred and added back, and the result is tone mapped.
  // The threshold is just above white, so only what is brighter than a lit surface glows (lamps, headlights, sparks, fire): the
  // name tags, which are plain white, stay crisp.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.6, 1.05);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize(): void {
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
```

with:

```ts
      renderer.setSize(w, h, false);
      composer.setPixelRatio(dpr);
      composer.setSize(w, h);
      camera.aspect = w / h;
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
    resize,
    render: () => renderer.render(scene, camera),
    dispose: () => {
```

with:

```ts
    resize,
    render: () => {
      renderer.info.reset();
      composer.render();
    },
    setBloom: (enabled) => {
      bloom.enabled = enabled;
    },
    dispose: () => {
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
    dispose: () => {
      for (const g of geometries) g.dispose();
```

with:

```ts
    dispose: () => {
      dressing.dispose();
      composer.dispose();
      for (const g of geometries) g.dispose();
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/client/dressing.test.ts && npm run typecheck`
Expected: PASS — 8 tests; type-check clean.

<!-- check {"cmd": "npx vitest run tests/client/dressing.test.ts && npm run typecheck", "outcome": "pass", "tests": 8} -->

- [ ] **Step 5: Look at it**

Build and serve it on a private port (never stop your own `npm run dev`):

```bash
npm run build && PORT=18092 STATIC_DIR=dist/client node dist/server/index.js
```

Open `http://localhost:18092/?auto=quick&name=Tester`. The countdown scene should show a crowd of small figures on stands that rise away from the barrier, floodlights with a soft glow around them, headlights that glow, and the name tags still crisp white. Open `http://localhost:18092/?sandbox` too: the offline sandbox renders through the same pipeline. No console errors in either. Stop the server with Ctrl-C.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(client): stands with a crowd, tyre stacks and a bloom pass for the lamps, headlights and sparks"
```

<!-- commit "feat(client): stands with a crowd, tyre stacks and a bloom pass for the lamps, headlights and sparks" -->

---

### Task 43: Your own impacts, at once

**Files:**
- Modify: `src/client/net/prediction.ts`, `src/client/net/session.ts`
- Create test: `tests/client/localImpacts.test.ts`; modify test: `tests/client/session.test.ts`

**Interfaces:**
- Consumes: `Simulation.contacts()` (Plan 4, read-only), `COMBAT.SCRAPE_IMPULSE`, `Predictor.step`, `ClientSession.poses`.
- Produces: `LocalImpact {slot, other, kns, point}` and `Predictor.takeImpacts()` (the local car's contacts with cars and walls, from live ticks only); `ClientSession.takeImpacts()`; `DrawPose` gains `throttle`, `handbrake` and `grounded`. Tasks 44-45 use them.

- [ ] **Step 1: Write the failing tests**

Sparks, sound and shake for **your own** car must not wait for the server: the local prediction already simulates the collision, so it reports it the moment it happens (the damage stays the server's business). The one trap is replays: after every snapshot the predictor re-simulates up to 240 ticks, passing through the same collision again, so impacts are read only from the live tick. The tests use the real simulation: a head-on collision is reported with the other car, how hard and where on our car; a wall is `other = -1`; nothing is reported for a car that touches nothing; and a snapshot that makes the predictor replay a collision reports it **zero** more times. The session tests pin the new draw-pose fields and that interpolation mode has no impacts.

Create `tests/client/localImpacts.test.ts`:

<!-- op {"kind": "create", "path": "tests/client/localImpacts.test.ts"} -->
```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Predictor, type LocalImpact } from '../../src/client/net/prediction';
import { COMBAT } from '../../src/shared/constants';
import { quatFromYaw } from '../../src/shared/math';
import { initPhysics } from '../../src/shared/physics';
import { SNAP_FLAG_ALIVE, type Snapshot } from '../../src/shared/protocol';
import { Simulation } from '../../src/shared/sim';
import type { CarState } from '../../src/shared/types';

beforeAll(async () => {
  await initPhysics();
});

const sims: Simulation[] = [];
afterEach(() => {
  while (sims.length) sims.pop()!.dispose();
});

const drive = (x: number, z: number, yaw: number, speed: number): CarState => ({
  pos: { x, y: 1.07, z },
  quat: quatFromYaw(yaw),
  linvel: { x: Math.cos(yaw) * speed, y: 0, z: -Math.sin(yaw) * speed },
  angvel: { x: 0, y: 0, z: 0 },
});
const coast = { throttle: 0, steer: 0, handbrake: false };

/** A predictor for slot 0 that has been synced to a world where `place` has put the cars. */
function predictor(slots: number[], place: (s: Simulation) => void): Predictor {
  const s = new Simulation(slots);
  sims.push(s);
  place(s);
  const snapshot: Snapshot = {
    epoch: 3,
    tick: 1,
    ackSeq: 0,
    cars: slots.map((slot) => ({ slot, flags: SNAP_FLAG_ALIVE, hp: 100, state: s.getState(slot), throttle: 0, steer: 0 })),
  };
  const p = new Predictor(0);
  p.beginWorld(3);
  expect(p.reconcile(snapshot).outcome).toBe('synced');
  return p;
}

function run(p: Predictor, ticks: number): LocalImpact[] {
  const seen: LocalImpact[] = [];
  for (let i = 0; i < ticks; i++) {
    p.step(coast);
    seen.push(...p.takeImpacts());
  }
  return seen;
}

describe('Predictor.takeImpacts', () => {
  it('reports a head-on collision the moment the local prediction has it: the other car, how hard, and where on our car', () => {
    const p = predictor([0, 1], (s) => {
      s.setState(0, drive(-9, 0, 0, 10));
      s.setState(1, drive(9, 0, Math.PI, 10));
    });
    const impacts = run(p, 90);
    const hard = impacts.filter((i) => i.kns > 2);
    expect(hard.length).toBeGreaterThan(0);
    expect(hard[0]).toMatchObject({ slot: 0, other: 1 });
    expect(hard[0]!.point.x).toBeGreaterThan(2); // the front face of our car
    expect(impacts.reduce((sum, i) => sum + i.kns, 0)).toBeGreaterThan(15); // about 19 kN·s per car in total
    p.dispose();
  });

  it('reports a wall as the other car being -1', () => {
    const p = predictor([0], (s) => s.setState(0, drive(25, 0, 0, 15)));
    const impacts = run(p, 120);
    expect(impacts.length).toBeGreaterThan(0);
    expect(impacts.every((i) => i.other === -1 && i.slot === 0)).toBe(true);
    expect(Math.max(...impacts.map((i) => i.kns))).toBeGreaterThan(10);
    p.dispose();
  });

  it('says nothing for a car that touches nothing, or only scrapes lightly, and hands each impact over once', () => {
    const p = predictor([0, 1], (s) => {
      s.setState(0, drive(-20, 0, 0, 0));
      s.setState(1, drive(20, 0, Math.PI, 0));
    });
    expect(run(p, 60)).toEqual([]);
    expect(p.takeImpacts()).toEqual([]);
    const q = predictor([0], (s) => s.setState(0, drive(25, 0, 0, 15)));
    q.step(coast);
    for (let i = 0; i < 120; i++) q.step(coast);
    const first = q.takeImpacts();
    expect(first.length).toBeGreaterThan(0);
    expect(q.takeImpacts()).toEqual([]);
    for (const i of first) expect(i.kns * 1000).toBeGreaterThanOrEqual(COMBAT.SCRAPE_IMPULSE);
    p.dispose();
    q.dispose();
  });

  it('does not repeat an impact when a snapshot makes it replay the same ticks', () => {
    const s = new Simulation([0, 1]);
    sims.push(s);
    s.setState(0, drive(-9, 0, 0, 10));
    s.setState(1, drive(9, 0, Math.PI, 10));
    const snap = (tick: number, ackSeq: number): Snapshot => ({
      epoch: 3,
      tick,
      ackSeq,
      cars: [0, 1].map((slot) => ({ slot, flags: SNAP_FLAG_ALIVE, hp: 100, state: s.getState(slot), throttle: 0, steer: 0 })),
    });
    const p = new Predictor(0);
    p.beginWorld(3);
    p.reconcile(snap(1, 0));
    const live = run(p, 100);
    const total = live.reduce((sum, i) => sum + i.kns, 0);
    expect(total).toBeGreaterThan(15);
    // a snapshot from long ago: the predictor rewinds and replays 100 ticks, passing through the collision again
    const late = p.reconcile(snap(2, 1));
    expect(late.resimSteps).toBeGreaterThan(50);
    expect(p.takeImpacts()).toEqual([]);
    p.dispose();
  });

  it('forgets the impacts nobody read when a new world begins, and keeps at most 64 unread ones', () => {
    const p = predictor([0], (s) => s.setState(0, drive(25, 0, 0, 15)));
    for (let i = 0; i < 150; i++) p.step(coast);
    expect(p.takeImpacts().length).toBeLessThanOrEqual(64);
    for (let i = 0; i < 20; i++) p.step(coast);
    p.beginWorld(4);
    expect(p.takeImpacts()).toEqual([]);
    p.dispose();
  });
});
```

In `tests/client/session.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/session.test.ts"} -->
```ts
import { initPhysics } from '../../src/shared/physics';
import { SNAP_FLAG_ALIVE, type Snapshot } from '../../src/shared/protocol';
import { Simulation } from '../../src/shared/sim';
```

with:

```ts
import { initPhysics } from '../../src/shared/physics';
import { SNAP_FLAG_ALIVE, SNAP_FLAG_GROUNDED, SNAP_FLAG_HANDBRAKE, type Snapshot } from '../../src/shared/protocol';
import { Simulation } from '../../src/shared/sim';
```

In `tests/client/session.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/session.test.ts"} -->
```ts
    expect(reasons).toEqual([]);
    session.dispose();
  });
});

```

with:

```ts
    expect(reasons).toEqual([]);
    session.dispose();
  });
});

describe('ClientSession draw poses for effects', () => {
  it('carry the throttle, the handbrake and whether the wheels touch the ground, in both modes', () => {
    for (const mode of ['predict', 'interp'] as const) {
      const session = new ClientSession(mode);
      const w = world([0, 1]);
      session.onWelcome(0, 3);
      const cars = (tick: number): Snapshot => ({
        epoch: 3,
        tick,
        ackSeq: 0,
        cars: [
          { slot: 0, flags: SNAP_FLAG_ALIVE | SNAP_FLAG_GROUNDED, hp: 80, state: w.getState(0), throttle: 0.5, steer: 0 },
          { slot: 1, flags: SNAP_FLAG_ALIVE | SNAP_FLAG_HANDBRAKE, hp: 60, state: w.getState(1), throttle: -1, steer: 0 },
        ],
      });
      session.onSnapshot(cars(10), 1000);
      session.onSnapshot(cars(12), 1033);
      const poses = session.poses(1, 0.016, 1060);
      const remote = poses.find((p) => p.slot === 1)!;
      expect(remote).toMatchObject({ throttle: -1, handbrake: true, grounded: false });
      expect(poses.find((p) => p.slot === 0)).toMatchObject({ handbrake: false, grounded: true });
      session.dispose();
    }
  });

  it('hands over the local car\'s impacts in prediction mode, and has none in interpolation mode', () => {
    const w = world([0, 1]);
    w.setState(0, { pos: { x: -9, y: 1.07, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 }, linvel: { x: 10, y: 0, z: 0 }, angvel: { x: 0, y: 0, z: 0 } });
    w.setState(1, { pos: { x: 9, y: 1.07, z: 0 }, quat: { x: 0, y: 1, z: 0, w: 0 }, linvel: { x: -10, y: 0, z: 0 }, angvel: { x: 0, y: 0, z: 0 } });
    const predicting = new ClientSession('predict');
    predicting.onWelcome(0, 3);
    predicting.onSnapshot(snapshotOf(w, { tick: 2 }), 1000);
    const seen = [];
    for (let i = 0; i < 90; i++) {
      predicting.nextInput({ throttle: 0, steer: 0, handbrake: false });
      seen.push(...predicting.takeImpacts());
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((i) => i.slot === 0)).toBe(true);
    predicting.dispose();
    expect(new ClientSession('interp').takeImpacts()).toEqual([]);
  });
});

```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/client/localImpacts.test.ts tests/client/session.test.ts`
Expected: FAIL — `p.takeImpacts is not a function` in the local impact tests, and the session tests do not find the new pose fields or `takeImpacts`.

<!-- check {"cmd": "npx vitest run tests/client/localImpacts.test.ts tests/client/session.test.ts", "outcome": "fail", "match": "is not a function"} -->

- [ ] **Step 3: Implement**

`src/client/net/prediction.ts` — the live tick reads the contacts of the step it just made and keeps those of the local car (at most 64 unread ones; a new world forgets them):

In `src/client/net/prediction.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/prediction.ts"} -->
```ts
import { ARENA } from '../../shared/constants';
import { NEUTRAL_INPUT, PARKED_INPUT, quantizeInput, type CarInput } from '../../shared/input';
```

with:

```ts
import { ARENA, COMBAT } from '../../shared/constants';
import { NEUTRAL_INPUT, PARKED_INPUT, quantizeInput, type CarInput } from '../../shared/input';
```

In `src/client/net/prediction.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/prediction.ts"} -->
```ts
  visible: boolean;
}

interface HistoryEntry {
```

with:

```ts
  visible: boolean;
}

/** The local car touching another car or a wall, as the local prediction saw it (`kns` in kN·s; `point` in the local car's own frame). */
export interface LocalImpact {
  /** The local car's slot. */
  slot: number;
  /** The car it touched, or -1 for a wall or an obstacle. */
  other: number;
  kns: number;
  point: Vec3;
}

/** More than this many unread impacts means nobody is reading them: the oldest are dropped. */
const MAX_UNREAD_IMPACTS = 64;

interface HistoryEntry {
```

In `src/client/net/prediction.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/prediction.ts"} -->
```ts
  private readonly remoteInputs = new Map<number, CarInput>();
  private readonly meta = new Map<number, { flags: number; hp: number; throttle: number; steer: number }>();
```

with:

```ts
  private readonly remoteInputs = new Map<number, CarInput>();
  private impacts: LocalImpact[] = [];
  private readonly meta = new Map<number, { flags: number; hp: number; throttle: number; steer: number }>();
```

In `src/client/net/prediction.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/prediction.ts"} -->
```ts
    this.lastTick = -1;
    this.remoteInputs.clear();
    this.meta.clear();
    this.present = new Set();
```

with:

```ts
    this.lastTick = -1;
    this.remoteInputs.clear();
    this.impacts = [];
    this.meta.clear();
    this.present = new Set();
```

In `src/client/net/prediction.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/prediction.ts"} -->
```ts
      this.simulate(this.stalled ? NEUTRAL_INPUT : q);
      if (this.hasLocalCar && !this.stalled) entry.after = this.curr.get(this.mySlot) ?? null;
```

with:

```ts
      this.simulate(this.stalled ? NEUTRAL_INPUT : q);
      this.noteImpacts();
      if (this.hasLocalCar && !this.stalled) entry.after = this.curr.get(this.mySlot) ?? null;
```

In `src/client/net/prediction.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/prediction.ts"} -->
```ts

  /** Rewinds to the snapshot and replays the unacknowledged inputs. Never throws on hostile or odd snapshots. */
```

with:

```ts

  /**
   * The impacts the local car has had since the last call, in order, for sounds, sparks and shaking the camera the moment they
   * happen. They are read from live ticks only: a replay after a snapshot re-simulates the same collision many times and would
   * repeat every one of them. (The damage is the server's business; this is only for the senses.)
   */
  takeImpacts(): LocalImpact[] {
    const out = this.impacts;
    this.impacts = [];
    return out;
  }

  /** Rewinds to the snapshot and replays the unacknowledged inputs. Never throws on hostile or odd snapshots. */
```

In `src/client/net/prediction.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/prediction.ts"} -->
```ts

  private simulate(localInput: CarInput): void {
```

with:

```ts

  /** Reads the contacts of the tick the local prediction has just stepped and keeps those of the local car. */
  private noteImpacts(): void {
    if (!this.sim || !this.hasLocalCar) return;
    for (const c of this.sim.contacts(COMBAT.SCRAPE_IMPULSE)) {
      if (c.a === this.mySlot) this.impacts.push({ slot: c.a, other: c.b, kns: c.impulse / 1000, point: c.pointA });
      else if (c.b === this.mySlot) this.impacts.push({ slot: c.b, other: c.a, kns: c.impulse / 1000, point: c.pointB });
    }
    if (this.impacts.length > MAX_UNREAD_IMPACTS) this.impacts.splice(0, this.impacts.length - MAX_UNREAD_IMPACTS);
  }

  private simulate(localInput: CarInput): void {
```

`src/client/net/session.ts` — draw poses carry what the effects need (throttle for the engine, handbrake and ground contact for tyre marks and dust), and the session hands the impacts on:

In `src/client/net/session.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/session.ts"} -->
```ts
import type { CarInput } from '../../shared/input';
import { SNAP_FLAG_ALIVE, type Phase, type Snapshot } from '../../shared/protocol';
import type { Quat, Vec3 } from '../../shared/types';
```

with:

```ts
import type { CarInput } from '../../shared/input';
import { SNAP_FLAG_ALIVE, SNAP_FLAG_GROUNDED, SNAP_FLAG_HANDBRAKE, type Phase, type Snapshot } from '../../shared/protocol';
import type { Quat, Vec3 } from '../../shared/types';
```

In `src/client/net/session.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/session.ts"} -->
```ts
import { PredictedWorld, type PredictedWorldOptions } from './predictedWorld';

```

with:

```ts
import { PredictedWorld, type PredictedWorldOptions } from './predictedWorld';
import type { LocalImpact } from './prediction';

```

In `src/client/net/session.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/session.ts"} -->
```ts
  hp: number;
}
```

with:

```ts
  hp: number;
  /** The driver's throttle (-1..1) and handbrake, and whether any wheel touches the ground: for engine sound, tyre marks and dust. */
  throttle: number;
  handbrake: boolean;
  grounded: boolean;
}
```

In `src/client/net/session.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/session.ts"} -->
```ts
        hp: p.hp,
      }));
```

with:

```ts
        hp: p.hp,
        throttle: p.throttle,
        handbrake: (p.flags & SNAP_FLAG_HANDBRAKE) !== 0,
        grounded: (p.flags & SNAP_FLAG_GROUNDED) !== 0,
      }));
```

In `src/client/net/session.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/session.ts"} -->
```ts
      hp: p.hp,
    }));
```

with:

```ts
      hp: p.hp,
      throttle: p.throttle,
      handbrake: (p.flags & SNAP_FLAG_HANDBRAKE) !== 0,
      grounded: (p.flags & SNAP_FLAG_GROUNDED) !== 0,
    }));
```

In `src/client/net/session.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/session.ts"} -->
```ts

  dispose(): void {
```

with:

```ts

  /** The local car's collisions since the last call, as the local prediction saw them (nothing in interpolation mode). */
  takeImpacts(): LocalImpact[] {
    return this.world?.predictor.takeImpacts() ?? [];
  }

  dispose(): void {
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/client/localImpacts.test.ts tests/client/session.test.ts tests/client/prediction.test.ts && npm run typecheck`
Expected: PASS — the local impact, session and prediction tests (43 tests); type-check clean.

<!-- check {"cmd": "npx vitest run tests/client/localImpacts.test.ts tests/client/session.test.ts tests/client/prediction.test.ts && npm run typecheck", "outcome": "pass", "tests": 43} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(client): the local prediction reports your own impacts as they happen"
```

<!-- commit "feat(client): the local prediction reports your own impacts as they happen" -->

---

### Task 44: The effects director

**Files:**
- Create: `src/client/game/fx.ts`
- Test: `tests/client/fx.test.ts`

**Interfaces:**
- Consumes: `CarView.dent/detach/restore/hasPart` (Task 38), `DamageBook` (Task 36), `ParticleSystem`, `DebrisSystem` (Task 39), `SkidMarks`, `skidStrength`, `CameraShake`, `traumaForImpact` (Task 40), `AudioEngine` (Task 41), `LocalImpact`, `DrawPose` (Task 43).
- Produces: `FxDirector(options)` with `onWelcome(log)`, `onRoster()`, `onHit(hit, frame)`, `onKo(ko, frame)`, `onLocalImpacts(impacts, frame)`, `frame(f)`, `dispose()`, and the `particles`, `debris`, `shake`, `damage` it owns; `FX` (tuning), `FxOptions`, `FxFrame`, `MarkTarget`. Task 45 wires it into the client.

- [ ] **Step 1: Write the failing tests**

The director is told what happens and asked once a frame to keep the continuous effects going; it decides nothing about the game. Its tests run it against real `CarView`s, the real particle pools and debris, and the fake audio context. They pin: a hit on other cars dents the victim, adds to the damage of that side, and makes sparks, a crash sound and a jolt; a part comes off and flies when a side has taken enough; **your own** car's sparks and sound come from the local impact and the server's hit message does not repeat them (for cars and for walls, for 1.5 s), while its dent and damage still come from the server; scrapes make a couple of sparks and no sound, real impacts a shower, a jolt and a crash that is not repeated on every tick it lasts; a hurt car smokes and burns, a wreck burns then smoulders then stops; tyre marks and dust for a sliding car (both rear wheels), none in the air; a new round makes every car whole and the ground clean; a newcomer replaying the log ends with exactly the cars a live client has, silently.

Create `tests/client/fx.test.ts`:

<!-- op {"kind": "create", "path": "tests/client/fx.test.ts"} -->
```ts
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

  it('burns a wreck for a few seconds, smoulders for a good while, and then stops', () => {
    const t = setup();
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/client/fx.test.ts`
Expected: FAIL — the test file fails to load: `src/client/game/fx` does not exist yet.

<!-- check {"cmd": "npx vitest run tests/client/fx.test.ts", "outcome": "fail", "match": "Failed to resolve import|Cannot find module|Does the file exist"} -->

- [ ] **Step 3: Implement**

`src/client/game/fx.ts`:

Create `src/client/game/fx.ts`:

<!-- op {"kind": "create", "path": "src/client/game/fx.ts"} -->
```ts
import * as THREE from 'three';
import { COMBAT } from '../../shared/constants';
import { clamp, quatRotate, vadd, vdot, vlen } from '../../shared/math';
import type { HitMessage, KoMessage } from '../../shared/protocol';
import { mulberry32 } from '../../shared/random';
import type { Quat, Vec3 } from '../../shared/types';
import { wheelLocalPosition } from '../../shared/vehicle';
import type { LocalImpact } from '../net/prediction';
import type { DrawPose } from '../net/session';
import type { AudioEngine, EngineCar, Listener } from './audio';
import { DamageBook } from './carDamage';
import type { CarView } from './carView';
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
  private now = 0;

  constructor(private readonly options: FxOptions) {
    this.random = options.random ?? mulberry32(0xf00d);
    this.debris = new DebrisSystem(this.random);
    this.marks = new SkidMarks(options.marks.surface);
    options.scene.add(this.particles.object, this.debris.object);
    if (options.marks.object) options.scene.add(options.marks.object);
  }

  // ---- what happens -----------------------------------------------------------------------------

  /**
   * A newcomer's hit log: dents and missing parts are put on the cars as the players saw them, with no sparks, no sound and no
   * flying debris (all of that happened before they arrived).
   */
  onWelcome(log: readonly HitMessage[]): void {
    for (const h of log) this.wear(h, false);
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
    for (const view of this.allViews()) view.restore();
  }

  /** The server says a car was hit: the dent and the parts always; sparks, sound and shake only if the local prediction has not made them already. */
  onHit(h: HitMessage, frame: Pick<FxFrame, 'poses' | 'mySlot' | 'listener'>): void {
    this.wear(h, true, frame.poses);
    const mine = h.victim === frame.mySlot || h.attacker === frame.mySlot;
    const other = h.victim === frame.mySlot ? h.attacker : h.victim; // what the local car ran into: another car, or -1 for a wall
    const covered = mine && this.now - (this.localImpactAt.get(other) ?? -1e9) < FX.LOCAL_COVERS;
    if (covered) return;
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
    for (let i = 0; i < 14; i++) this.puff('fire', at, 2.5, 1.2 + this.random() * 0.8, 0.5 + this.random() * 0.5);
    for (let i = 0; i < 10; i++) this.puff('smoke', at, 1.8, 2 + this.random() * 1.5, 0.9 + this.random() * 0.6);
    this.options.audio.crash(25, at, frame.listener);
  }

  /** The local prediction's impacts, the moment they happen: sparks in proportion, a jolt, a sound for the real ones. */
  onLocalImpacts(impacts: readonly LocalImpact[], frame: Pick<FxFrame, 'poses' | 'listener'>): void {
    for (const i of impacts) {
      const pose = frame.poses.find((p) => p.slot === i.slot);
      if (!pose) continue;
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
        if (!this.wentOutAt.has(p.slot)) this.wentOutAt.set(p.slot, f.now); // a wreck we met already burnt out
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
    for (let slot = 0; slot < 8; slot++) {
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
    for (let i = 0; i < 4; i++) this.puff('dust', at, 2, 0.8 + this.random() * 0.6, 0.6 + this.random() * 0.5);
    this.shake.add(traumaForImpact(kns, distance));
    const last = this.crashedAt.get(pair) ?? -1e9;
    if (this.now - last >= FX.CRASH_COOLDOWN) {
      this.crashedAt.set(pair, this.now);
      this.options.audio.crash(kns, at, listener);
    }
  }

  private sparks(at: Vec3, carVelocity: Vec3, count: number): void {
    for (let i = 0; i < count; i++) {
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
    r[key] += perSecond * dt;
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
      const wheel = worldPoint(p, wheelLocalPosition(i, 0.374));
      this.marks.wheel(p.slot * 4 + i, wheel.x, wheel.z, i >= 2 ? strength : strength * 0.6);
    }
    if (p.grounded && speed > FX.DUST_SPEED) {
      const rear = worldPoint(p, wheelLocalPosition(2 + Math.floor(this.random() * 2), 0.374)); // either rear wheel
      for (let i = this.due(p.slot, 'dust', clamp(speed, 0, 20) * 0.8 + strength * 30, dt); i > 0; i--) {
        this.puff('dust', { x: rear.x, y: 0.15, z: rear.z }, 1.2, 0.6 + this.random() * 0.5, 0.35);
      }
    }
  }
}
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/client/fx.test.ts && npm run typecheck`
Expected: PASS — 20 tests; type-check clean.

<!-- check {"cmd": "npx vitest run tests/client/fx.test.ts && npm run typecheck", "outcome": "pass", "tests": 20} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(client): the effects director \u2014 dents, parts, sparks, smoke, fire, dust, tyre marks, shake and sound from what happens"
```

<!-- commit "feat(client): the effects director \u2014 dents, parts, sparks, smoke, fire, dust, tyre marks, shake and sound from what happens" -->

---

### Task 45: Wire the effects into the client

**Files:**
- Modify: `src/client/game/gameClient.ts`, `src/client/main.ts`, `src/client/ui/menu.ts`, `README.md`

**Interfaces:**
- Consumes: `FxDirector` (Task 44), `AudioEngine`, `CountdownBeeper` (Task 41), `CanvasMarks` (Task 40), `GameScene.setBloom` (Task 42), `ClientSession.takeImpacts` (Task 43), `WelcomeMessage.dents` (Task 37).
- Produces: The game shows and sounds what happens. Keys: **H** horn, **M** mute. `?bloom=0` turns the glow off. F3's line shows the script time per frame; `window.__derby.debug()` reports draw calls, triangles, live particles, debris and the audio state.

- [ ] **Step 1: Wire it up**

`src/client/game/gameClient.ts` — the client owns an `AudioEngine`, the tyre-mark canvas and an `FxDirector`; it feeds the director from the server's messages (`welcome` replays the hit log, `roster` makes everything whole again, `hit` and `ko` as they arrive) and from every frame (your own impacts from the prediction, then the continuous effects, after the camera has been placed and before the scene is drawn); it plays the countdown beeps; H sounds the horn, M mutes, and any key or click unlocks sound (browsers allow it only after a gesture). It also measures the script time per frame and puts the draw-call counts in the debug hook.

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
import type { JoinChoice } from '../ui/menu';
import { applyChaseView, ChaseCamera } from './camera';
```

with:

```ts
import type { JoinChoice } from '../ui/menu';
import { AudioEngine, type Listener } from './audio';
import { CountdownBeeper } from './audioParams';
import { applyChaseView, ChaseCamera } from './camera';
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
import { CarView } from './carView';
import { KeyboardInput } from './input';
```

with:

```ts
import { CarView } from './carView';
import { FxDirector } from './fx';
import { KeyboardInput } from './input';
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
import type { GameScene } from './scene';
import { SpectatorCamera } from './spectator';
```

with:

```ts
import type { GameScene } from './scene';
import { CanvasMarks } from './skidMarks';
import { SpectatorCamera } from './spectator';
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
  private readonly keyboard = new KeyboardInput(undefined, undefined, (code) => this.onKey(code));
  private readonly stepper = new FixedStepper(PHYSICS.DT);
```

with:

```ts
  private readonly keyboard = new KeyboardInput(undefined, undefined, (code) => this.onKey(code));
  private readonly audio = new AudioEngine();
  private readonly beeper = new CountdownBeeper();
  private readonly marks = new CanvasMarks();
  private readonly fx: FxDirector;
  private readonly drawingSize = new THREE.Vector2();
  private readonly stepper = new FixedStepper(PHYSICS.DT);
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
  private driving = false;
  private statsVisible = false;
```

with:

```ts
  private driving = false;
  /** The car the camera follows (yours, or the one being watched): the point sound is heard from. */
  private focus: DrawPose | null = null;
  private statsVisible = false;
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
  private fps = 0;
  private fpsAt = performance.now();
```

with:

```ts
  private fps = 0;
  /** Milliseconds of script per frame, smoothed (what this machine's processor spends; the graphics card is not included). */
  private frameMs = 0;
  private fpsAt = performance.now();
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
    this.timer.connect(document);
    const lag = opts.lag ?? null;
```

with:

```ts
    this.timer.connect(document);
    this.fx = new FxDirector({
      scene: opts.gs.scene,
      audio: this.audio,
      marks: { surface: this.marks, object: this.marks.mesh, upload: () => this.marks.upload() },
      view: (slot) => this.views.get(slot),
    });
    const lag = opts.lag ?? null;
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
  start(): void {
    this.conn.connect();
```

with:

```ts
  start(): void {
    if (navigator.userActivation?.isActive) this.audio.unlock(); // inside the click that started the game; otherwise the first key or click does it
    window.addEventListener('pointerdown', this.unlockAudio);
    this.conn.connect();
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
    this.keyboard.dispose();
    this.conn.close();
```

with:

```ts
    this.keyboard.dispose();
    window.removeEventListener('pointerdown', this.unlockAudio);
    this.fx.dispose();
    this.marks.dispose();
    this.audio.dispose();
    this.conn.close();
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
        this.applyRoster();
        this.opts.hud.setRoom(m.room.code, m.room.public);
```

with:

```ts
        this.applyRoster();
        this.fx.onWelcome(m.dents); // the cars of a round in progress are dented and stripped as the players saw them
        this.opts.hud.setRoom(m.room.code, m.room.public);
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
        this.applyRoster();
        break;
```

with:

```ts
        this.applyRoster();
        this.fx.onRoster();
        break;
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
        this.match.onHit(m);
        break;
```

with:

```ts
        this.match.onHit(m);
        this.fx.onHit(m, { poses: this.lastPoses, mySlot: this.mySlot, listener: this.listener() });
        break;
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
        this.match.onKo(m);
        break;
```

with:

```ts
        this.match.onKo(m);
        this.fx.onKo(m, { poses: this.lastPoses, listener: this.listener() });
        break;
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts

  /** F3 shows the network line; while you are out, the cycle keys pick the next car to watch. */
  private onKey(code: string): void {
```

with:

```ts

  private readonly unlockAudio = (): void => this.audio.unlock();

  /** Where sound is heard from: the car you drive or watch, or the camera when there is none. */
  private listener(): Listener {
    if (this.focus) return { pos: this.focus.pos, quat: this.focus.quat };
    const c = this.opts.gs.camera;
    return { pos: { x: c.position.x, y: c.position.y, z: c.position.z }, quat: { x: c.quaternion.x, y: c.quaternion.y, z: c.quaternion.z, w: c.quaternion.w } };
  }

  /** F3 shows the network line, H sounds the horn, M mutes; while you are out, the cycle keys pick the next car to watch. */
  private onKey(code: string): void {
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
  private onKey(code: string): void {
    if (code === 'F3') {
```

with:

```ts
  private onKey(code: string): void {
    this.audio.unlock(); // any key is a gesture the browser accepts
    if (code === 'KeyH') {
      this.audio.horn();
      return;
    }
    if (code === 'KeyM') {
      this.audio.setMuted(!this.audio.muted);
      this.opts.hud.showNotice(this.audio.muted ? 'Sound off (M)' : 'Sound on (M)');
      return;
    }
    if (code === 'F3') {
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
    if (this.stopped) return;
    this.timer.update(ts);
```

with:

```ts
    if (this.stopped) return;
    const started = performance.now();
    this.timer.update(ts);
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
    this.match.onCars(poses.filter((p) => p.visible).map((p) => ({ slot: p.slot, hp: p.hp, alive: p.alive, speed: vlen(p.linvel) })));
    this.opts.hud.setMatch(this.match.view(), this.keyboard.isDown('Tab'));
    this.opts.gs.resize();
```

with:

```ts
    this.match.onCars(poses.filter((p) => p.visible).map((p) => ({ slot: p.slot, hp: p.hp, alive: p.alive, speed: vlen(p.linvel) })));
    const view = this.match.view();
    this.opts.hud.setMatch(view, this.keyboard.isDown('Tab'));
    const beep = this.beeper.next(view);
    if (beep) this.audio.beep(beep);

    // effects: what your own car ran into this tick shows and sounds now; everything else runs from what the server said
    this.focus = this.driving ? (mine ?? null) : (poses.find((p) => p.slot === this.spectator.watching && p.visible) ?? null);
    const listener = this.listener();
    this.fx.onLocalImpacts(this.session.takeImpacts(), { poses, listener });
    const cam = this.opts.gs.camera;
    this.opts.gs.renderer.getDrawingBufferSize(this.drawingSize);
    this.fx.frame({
      dt,
      now: performance.now() / 1000,
      poses,
      mySlot: this.mySlot,
      listener,
      camera: cam,
      pixelScale: this.drawingSize.y / (2 * Math.tan((cam.fov * Math.PI) / 360)),
    });
    this.opts.gs.resize();
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
    this.updateStats();
    this.raf = requestAnimationFrame(this.frame);
```

with:

```ts
    this.updateStats();
    this.frameMs += (performance.now() - started - this.frameMs) * 0.05;
    this.raf = requestAnimationFrame(this.frame);
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
        : `snapshots ${this.session.snapshotsReceived} · buffer ${this.session.interpolator.size}`;
      this.opts.hud.setStats(`${this.session.mode} · ping ${Math.round(this.conn.rttMs)} ms · ${this.fps} fps · ${net}`);
    }
```

with:

```ts
        : `snapshots ${this.session.snapshotsReceived} · buffer ${this.session.interpolator.size}`;
      this.opts.hud.setStats(`${this.session.mode} · ping ${Math.round(this.conn.rttMs)} ms · ${this.fps} fps · ${this.frameMs.toFixed(1)} ms/frame · ${net}`);
    }
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
        : null,
      snapshotsReceived: this.session.snapshotsReceived,
```

with:

```ts
        : null,
      fx: {
        debris: this.fx.debris.active,
        shake: this.fx.shake.level,
        particles: { spark: this.fx.particles.alive('spark'), smoke: this.fx.particles.alive('smoke'), fire: this.fx.particles.alive('fire'), dust: this.fx.particles.alive('dust') },
        audio: { ready: this.audio.ready, muted: this.audio.muted },
      },
      snapshotsReceived: this.session.snapshotsReceived,
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
      fps: this.fps,
      poses: this.lastPoses.map((p) => ({
```

with:

```ts
      fps: this.fps,
      frameMs: this.frameMs,
      render: (() => {
        const info = this.opts.gs.renderer.info;
        return { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures };
      })(),
      poses: this.lastPoses.map((p) => ({
```

`src/client/main.ts` — the glow can be switched off with `?bloom=0`, to see what it costs on a machine; `src/client/ui/menu.ts` — the controls hint; `README.md` — a section on what you can see and hear.

In `src/client/main.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/main.ts"} -->
```ts
    const gs = createGameScene(canvas);
    const initialCode = params.get('room') ?? undefined;
```

with:

```ts
    const gs = createGameScene(canvas);
    gs.setBloom(params.get('bloom') !== '0'); // ?bloom=0 turns the glow off, to see what it costs on this machine
    const initialCode = params.get('room') ?? undefined;
```

In `src/client/ui/menu.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/menu.ts"} -->
```ts
    <p class="error" id="m-error" role="alert"></p>
    <p class="hint">W/S throttle · A/D steer · Space handbrake · Tab scoreboard · F3 network</p>`;
  root.append(menu);
```

with:

```ts
    <p class="error" id="m-error" role="alert"></p>
    <p class="hint">W/S throttle · A/D steer · Space handbrake · H horn · M sound · Tab scoreboard · F3 network</p>`;
  root.append(menu);
```

In `README.md`, replace:

<!-- op {"kind": "edit", "path": "README.md"} -->
```markdown
- When your car is out, or you joined a round that was already running, a camera orbits a car that is still running; **← → (or A/D, Q/E)** switches car. Your controls keep being sent while you watch, so the server does not drop you as inactive.

```

with:

```markdown
- When your car is out, or you joined a round that was already running, a camera orbits a car that is still running; **← → (or A/D, Q/E)** switches car. Your controls keep being sent while you watch, so the server does not drop you as inactive.

## Damage you can see and hear

- Every hit dents the car where it landed. The server tells everyone which car was hit, where and how hard, and each browser crumples the same mesh the same way, so two players see the same wreck. A player who joins mid-round is sent the round's latest hits (up to 64) and sees the cars dented as they are. Parts come off when a side has taken enough damage (bumpers first, then hood or trunk, and doors) and fly away as debris; the next round starts with whole cars.
- Sparks, dust, smoke and fire are particles drawn on the GPU: sparks on impacts and scrapes, dust behind fast cars, smoke from a car under 50 HP and fire under 25, and a wreck burns, then smoulders. Tyre marks are drawn into one texture over the arena while a tyre slides or the handbrake is on, and wiped for the next round.
- The camera shakes with impacts of your own car, felt at once from the local simulation rather than after the round trip, and a little with nearby ones. Bloom makes the lamps, headlights and sparks glow; `?bloom=0` turns it off. The stands have a crowd, and tyre stacks stand outside the barrier.
- Sound is synthesised in the browser, with no sound files: an engine for every running car, crashes by the size of the impact, the countdown beeps and the horn. **H** honks (other players cannot hear it) and **M** mutes. Browsers allow sound only after a click or a key press.
- With `?net=interp` there is no local prediction, so impacts show and sound when the server's hit message arrives.
- F3's line shows the script time per frame; `window.__derby.debug()` reports the draw calls and triangles of the last frame and the number of live particles and pieces of debris.


```

- [ ] **Step 2: Run the whole suite**

Run: `npm run typecheck && npm test && npm run build && npm run hash`
Expected: Type-check clean, 584 tests pass, the production build succeeds, and `npm run hash` still prints `10c3a72a`.

<!-- check {"cmd": "npm run typecheck && npm test && npm run build && npm run hash", "outcome": "pass", "tests": 584, "match": "10c3a72a"} -->

- [ ] **Step 3: Look at it in a browser**

Serve the build on a private port, with eight cars so that there is something to see (`BOT_FILL=8`) and short phases:

```bash
PORT=18092 STATIC_DIR=dist/client COUNTDOWN_SECONDS=5 ROUND_SECONDS=120 RESULTS_SECONDS=10 BOT_FILL=8 node dist/server/index.js
```

Open `http://localhost:18092/?auto=quick&name=Tester` and drive (W held, steer with A/D). Check, each of which was seen in the rehearsal:

- **Crashes:** when you hit a bot or the wall there are sparks at the contact, dust, the camera jolts, a red edge flash, and (after your first key press) a crash sound. `window.__derby.debug().fx.particles.spark` is above zero for a moment.
- **Damage:** cars that have been hit show crumpled bodywork (irregular dents, most at the front for head-on hits), and bumpers, hoods, trunks and doors fly off and lie on the ground for about twelve seconds. A hurt car (under 50 HP) smokes; under 25 HP it also burns; a wreck burns, then smoulders for a while.
- **Marks:** hold W, then D with Space for a second in open ground: dark tyre marks stay behind the car and dust drifts from the tyres; they are gone at the start of the next round, and so are dents and missing parts (every car is whole again).
- **A newcomer:** in a second tab, join the same room by its code while a round is live: the cars already carry their dents and are missing the parts that came off.
- **Sound:** after a key press `window.__derby.debug().fx.audio` is `{ ready: true, muted: false }`; **H** honks, **M** mutes (the notice says "Sound off (M)"). The countdown beeps in the last three seconds and again at GO.
- **Performance** with eight cars: F3 shows the script time per frame (about 2 ms in the rehearsal) and `debug().render` about 280 draw calls and 130 000 triangles; the frame rate is whatever your display gives (the automation browser is capped at 50). `?bloom=0` removes the glow if a weak graphics card needs the frames.
- No console errors or warnings. Stop the server with Ctrl-C.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(client): the game shows and sounds what happens \u2014 effects, sound, the H and M keys and ?bloom=0"
```

<!-- commit "feat(client): the game shows and sounds what happens \u2014 effects, sound, the H and M keys and ?bloom=0" -->

---

## Plan 6 done when

- [ ] `npm run typecheck`, `npm test` (584 tests), `npm run build` pass, and `npm run hash` still prints `10c3a72a`.
- [ ] The browser check of Task 45 passes on a private port with eight cars: sparks, dust and a jolt on impacts, crumpled cars and parts on the ground, smoke and fire on hurt cars and wrecks, tyre marks that are wiped for the next round, a newcomer who sees the cars as they are, sound after a key press with H and M working, no console errors or warnings.
- [ ] **The user has played it** and said whether the effects are too much or too little, whether the sounds are right, and how it runs on their machine (the numbers to change are in `FX`, `DENT`, `PART_RULES`, `SHAKE`, `SKID` and the bloom pass in `scene.ts`; `?bloom=0` is the quick way to see what the glow costs).

**Known limits of this baseline (each addressed by a later plan or accepted):** the sounds were never listened to (levels and timbres are first guesses); the horn is heard only by you; there is no painted number on the cars; a newcomer sees at most the round's latest 64 hits, so a car dented earlier in a very long round looks cleaner to them; debris and particles are thrown differently on every screen; the frame rate on a real display was not measured (see the rehearsal findings); the bloom pass is the first thing to drop on a weak graphics card and there is no automatic downgrade yet (Plan 7's presets).

**Next plan** (written after this one is verified, against the code as it then stands): Plan 7 — polish and packaging (menu and settings, graphics presets that use `setBloom`, limits and the origin check, CLAUDE.md, the Dockerfile with the esbuild bundle, a load test).
