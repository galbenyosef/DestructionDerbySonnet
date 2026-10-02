# Wreckyard Plan 8 — The Arena Engine (four arenas, a vote, and a small retune) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four arenas that differ in shape, obstacles and how the ground feels (the Stadium, the Frozen Lake, the Mud Quarry, the Container Port), each described by one layout file that the server and the browser both build the physics from; a vote between rounds that picks the next arena; the scene, the camera and the tyre marks that follow the arena; and the owner's retune (cars a little faster and a bit more robust). The game is playable end to end with plain boxes; the Blender scenery (Plan 9) and the car models (Plan 10) come on top.

**Architecture:** An arena is data (`src/shared/arenas/<id>.json`, written by `art/arenas/layouts.py`) checked by `parseArena`: boxes (walls, obstacles, ramps as tilted boxes), a playable boundary (a circle or a polygon), eight spawns, the ground feel (`friction`, `grip`, `drag`, `power`) and the look. `buildArena`, `spawnPose` and `Simulation` take an `ArenaDef`; the Stadium layout is the old circle bit for bit, so the first tasks prove the refactor moved nothing (`npm run hash` = `10c3a72a`). The ground feel is applied when the cars are built and driven (tyre grip scales `TIRE.SLIP`, drag adds to the linear damping, power scales the engine and its fade-out speed), by multiplications by 1 that change no bit for the Stadium. Out of bounds, the bots' wall avoidance, broken-car respawns, the spectator camera and the tyre-mark texture all ask the arena for its edge. The room draws its first arena from its seed, opens a ballot when the results begin, and decides it by majority (ties and empty ballots by the seed) when the next round starts; protocol 4 carries `vote`, `votes` and the `arena`. The client predicts in the announced arena, builds the scene from the layout (`arenaView.ts`) and shows a vote panel. The retune is the last code task so the refactor could be proved first.

**Tech Stack:** as Plans 1-7. No new dependency. Python 3 (standard library only) for the layout script.

**Spec:** `docs/superpowers/specs/2026-10-02-wreckyard-arenas-and-cars-design.md` — "The four arenas", "Architecture" (shared code, server, protocol version 4, client), "Tuning". **Prerequisite:** Plans 1-7 merged on `main` (`6280280`, 680 tests plus the docs). This plan starts on a new branch cut from it. Plans 9 (scenery) and 10 (cars, protocol 5) are separate.

**Scope notes:**
- Deviations from the spec text, each with its reason: (1) **no `nextArena` field in the last `phase` message.** The roster that starts the next round is sent in the same tick as the world is rebuilt and carries the arena, so the client learns the winner exactly when it needs it; a second announcement would only be a second place to disagree. (2) **`Simulation` takes its arena through its options object** (`new Simulation(slots, { arena })`) rather than as a second positional argument, because the options object already carries `walls` and `groundHalfExtent` and every test passes it. (3) **The Blender script is not in this plan:** the layouts come from a small Python module (`art/arenas/layouts.py`, standard library only) that Plan 9's Blender script will import, so the scenery cannot drift from the walls; **only that file is added under `art/`** (the rest of that folder, the car models, is not part of this plan). (4) **The ground feel numbers are first guesses** (ice: grip 0.4 and friction 0.2; mud: grip 0.9, drag 0.25, power 0.88; port: grip 1.15), set in the layout files and settled by playtest, like every other tuning number. (5) **Tyre-mark colours and the arenas' scenery are Plan 9;** here the marks are the same dark line everywhere and an arena is plain boxes on a plain ground, lit and fogged to its `look`.
- The retune (Task 61) is `ENGINE` +12 %, `MAX_SPEED` +12 %, `STEER_FADE_SPEED` scaled with it, `DAMAGE_SCALE` -20 %; the numbers are first guesses for the owner to confirm in a playtest.
- Findings of the earlier reviews that this plan touches: Plan 7's deferred "results screen" items are not among them; what stays open is in the run's final report.

## What the rehearsal found (measured before this plan was written)

I rehearsed everything in a scratch copy of `main`, generated this text from the rehearsal, and executed it against a fresh copy to check that it reproduces the rehearsal file for file.

- **The Stadium is the same physics, to the bit:** after the layout refactor (Task 54), after the ground feel (Task 55), after the room learned about arenas (Tasks 56-57) `npm run hash` printed `10c3a72a` every time. A JSON file cannot hold `-0` (the old wall formula produced one), so the identity test compares the legacy numbers with their negative zeros turned into plain zeros; the colliders are indistinguishable.
- **Four defects my own drafts had, found by the new validation test or the existing suite before they could ship:** (1) the Container Port's first spawns were 3 m from the wall (the test demands 5 m) — moved to 7 m; (2) my first "is this spawn clear of the walls" check measured the distance to a circle around each box, which a 90 m wall always fails — it now measures the distance to the oriented box; (3) once the first round's arena became random, the existing prediction tests (which assume the Stadium) failed: the loopback helper now gives its room a seed that plays in the Stadium, and a new test runs the same comparison in each of the four arenas; (4) braking is limited by the brake force, not by tyre grip, so my first test of grip (stopping distance on ice) found no difference — grip shows in the corner, and the test measures how far the direction of travel swings in one second of full steering (the ice bends less than 75 % of what dirt does).
- **The retune, measured:** a 10 m/s head-on costs each car 20.2 HP instead of 25.2 (100 → 80); the Stadium hash is now `8719c2e8`, the lake `76ca0746`, the quarry `170a27e5`, the port `454e9fb5`. The scripted run's top speed rises from 15.9 to 17.3 m/s. Five prediction-smoothness tolerances (worst visual jump 0.0202 and 0.027 m against 0.02, 0.062 m against 0.05, four orientation snaps against two, 94.6 % of reconciliations keeping the local prediction against 95 %) were just over their limits at the higher speed and are widened by about half; the 95th percentile and worst-case position errors on a perfect network did not move.
- **In a real browser** (private port, short rounds, three bots, the Playwright browser, 1280x720; no console errors): the first round of one room started in the Container Port (coloured containers and two ramps, the high end of each ramp is the high end), the vote panel showed four cards, `2` and `3` highlighted the Frozen Lake and the Mud Quarry with "1 vote", and the next rounds were played there (a pale lake with low banks and blocks of ice, an oval orange pit with a mound). The panel and hint text are hard to read over the lake\'s white ground: an effect of the plain look that Plan 9's scenery and a darker panel will settle.
- **Known limits of this baseline:** the ice and mud numbers have not been driven by a person; a car on the Container Port\'s ramps can launch (that is the design) and the bots do not plan around the containers (they back out of them like any obstacle); the scenery is plain boxes; the vote panel has no thumbnails.

## Global Constraints

- Everything in Plans 1-7's Global Constraints still applies (single package, relative imports, exact pins, axes, deterministic simulation path, quantised inputs, `freezeTuning`, commits only because the user opted in).
- **Tasks 54-57 change no physics:** `npm run hash` prints `10c3a72a` after each of them. Task 61 changes it once, on purpose.
- **Axes:** forward is +X, up is +Y, right is +Z; a box\'s `yaw` turns it about +Y and a positive `pitch` lifts its +X end (about its own Z axis).
- **The layout files are generated** by `art/arenas/layouts.py` and committed; nobody edits them by hand. The server and the client build the physics from the same files.
- **Effects stay cosmetic:** the scenery and the vote panel read messages and the layout and never touch the simulation or the rules.
- **A change to what goes over the wire changes `NET.PROTOCOL_VERSION`:** it is 4 after Task 57.
- **No new dependency**; nothing in this plan deploys, pushes or creates an account.
- The user\'s own `npm run dev` may be running on ports 8080/5173: never stop it. Use `PORT` with another port (18000 and up) for anything that needs a server, and a Vite of your own only on another port too (`WRECKYARD_SERVER_PORT` names the game server to proxy to).

## Review Focus

1. **A vote under abuse and in odd moments:** a vote outside the results, from a socket that never joined, for an arena that does not exist (`"__proto__"`, `"constructor"`, `""`, a number), a player who changes their mind many times, a player who leaves after voting, a newcomer who joins during the results, two arenas tied, nobody voting. → Task 57 (`protocol.test.ts`, `vote.test.ts`, `roomVote.test.ts`).
2. **A rectangle is not a circle:** a car in a corner of the Container Port, a bot driving along its wall, a spectator camera behind a container, a broken car put back where it started. → Tasks 56 and 60 (`rules.test.ts`, `bots.test.ts`, `roundCombat.test.ts`, `spectator.test.ts`).
3. **A client that predicts in the wrong arena is wrong from the first tick:** a newcomer who joins mid-round in the Quarry, a roster that changes the arena between rounds, a welcome and a roster that disagree. → Task 58 (`arenaPrediction.test.ts`).
4. **Switching arenas many times:** meshes, materials and textures are freed, the tyre-mark texture changes size without leaking, the crowd preset survives a switch, the Stadium looks as it did. → Task 60 (`arenaView.test.ts` and the browser check).
5. **A layout that is slightly wrong:** a spawn on a wall, a gap in a wall, a ramp that tilts the wrong way, a ground feel outside the range the physics is tuned for. → Task 54 (`arenas.test.ts`) and Task 55 (`groundFeel.test.ts`).

## File Structure

| File | Responsibility |
|---|---|
| `art/arenas/layouts.py` (new), `src/shared/arenas/*.json` (new, generated) | the four layouts: boxes, bounds, spawns, ground feel, look |
| `src/shared/arenas.ts` (new), `arena.ts`, `math.ts`, `constants.ts` (modify) | `ArenaDef`, validation, bounds helpers; the physics world built from a layout; `quatFromYawPitch`; `ARENA` reduced |
| `src/shared/vehicle.ts`, `sim.ts`, `determinism.ts`, `scripts/hash.ts`, `src/client/main.ts` (modify) | ground feel; a simulation and a hash per arena |
| `src/server/rules.ts`, `round.ts`, `bots.ts`, `room.ts` (modify), `src/server/vote.ts` (new), `app.ts`, `src/shared/protocol.ts` (modify) | bounds by arena; the ballot; protocol 4 |
| `src/client/net/{prediction,predictedWorld,session}.ts` (modify) | prediction in the announced arena |
| `src/client/game/arenaView.ts` (new), `scene.ts`, `spectator.ts`, `skidMarks.ts`, `fx.ts`, `matchState.ts`, `gameClient.ts` (modify), `ui/{format,hud}.ts`, `index.html` (modify) | the scene from the layout; the vote panel and the arena in the banner |
| `README.md`, `CLAUDE.md`, `docs/deployment.md` (modify) | the docs |
| `tests/…` | one file per new module and additions to the existing suites |

---

### Task 54: Arenas as data: the layout files, `ArenaDef`, and a physics world built from them

**Files:**
- Create: `art/arenas/layouts.py` (and the four files in `src/shared/arenas/` it writes), `src/shared/arenas.ts`, `tests/helpers/legacyArena.ts`, `tests/arenas.test.ts`
- Modify: `src/shared/arena.ts`, `src/shared/math.ts`, `src/shared/constants.ts`, `src/client/game/scene.ts`, `tests/arena.test.ts`

**Interfaces:**
- Consumes: `BoxSpec`, `spawnPose`, `buildArena`, `ARENA` (Plan 1), `quatFromYaw`, `round3`, `round6` (Plan 1), the scene (Plan 5).
- Produces: `ArenaDef` (`id`, `name`, `groundHalfExtent`, `ground: GroundFeel`, `boxes: BoxSpec[]`, `bounds: Bounds`, `spawn: SpawnLayout`, `look: ArenaLook`), `ARENA_IDS`, `ArenaId`, `isArenaId`, `ARENAS`, `getArena(id)`, `DEFAULT_ARENA` (the Stadium), `NEUTRAL_GROUND`, `parseArena(raw)`, `boundsClearance`, `outOfBounds`, `clampToBounds`, `boundsRadius`, `boundsHalfSize`; `BoxSpec` gains `pitch?`, `kind?`, `tint?`; `spawnPose(index, count, arena = DEFAULT_ARENA)`; `buildArena(world, { arena?, walls?, groundHalfExtent? })`; `quatFromYawPitch(yaw, pitch)`. `ARENA` keeps only `RADIUS`, `WALL_HALF_THICKNESS` and `MAX_CARS`. **The Stadium layout is exactly the geometry of Plans 1-7 and `npm run hash` still prints `10c3a72a`.**

- [ ] **Step 1: Write the tests**

The Stadium's old formulas move into a test helper (`legacyArena.ts`), and a test compares `stadium.json` with them box for box (JSON cannot hold `-0`, so the helper's negative zeros are compared as plain zeros). Every layout is validated alike: eight spawns that are distinct, inside the bounds by 5 m, clear of every box (by distance to the oriented box, not to a circle round it) and facing the middle; every box inside the ground and with a kind; ground feel within the range the physics is tuned for; and a wall all the way round (48 probes just outside the bounds must meet a box). `parseArena` is tested on the shipped layouts and on ten kinds of damage. The bounds helpers are tested on a circle and a square, and `quatFromYawPitch` must equal `quatFromYaw` when there is no pitch, and tilt a ramp the right way.

Create `tests/helpers/legacyArena.ts`:

<!-- op {"kind": "create", "path": "tests/helpers/legacyArena.ts"} -->
```ts
import type { BoxSpec } from '../../src/shared/arena';
import { round3, round6 } from '../../src/shared/math';

/** The Stadium as it was built before arenas became data (Plans 1-7): the identity test compares stadium.json with this, bit for bit. */
export const LEGACY = {
  RADIUS: 45,
  WALL_SEGMENTS: 32,
  WALL_HALF_HEIGHT: 1.5,
  WALL_HALF_THICKNESS: 1.0,
  GROUND_HALF_EXTENT: 120,
  SPAWN_RADIUS: 32,
  OBSTACLE_COUNT: 4,
  OBSTACLE_RING_RADIUS: 14,
  OBSTACLE_HALF: { x: 2.5, y: 0.75, z: 1.0 },
} as const;

export function legacyWallSegments(): BoxSpec[] {
  const n = LEGACY.WALL_SEGMENTS;
  const t = LEGACY.WALL_HALF_THICKNESS;
  const r = LEGACY.RADIUS + t;
  const hx = round3(r * Math.tan(Math.PI / n) + 0.3);
  const out: BoxSpec[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({ x: round3(Math.cos(a) * r), y: LEGACY.WALL_HALF_HEIGHT, z: round3(Math.sin(a) * r), yaw: round6(-a - Math.PI / 2), hx, hy: LEGACY.WALL_HALF_HEIGHT, hz: t });
  }
  return out;
}

export function legacyObstacleBoxes(): BoxSpec[] {
  const out: BoxSpec[] = [];
  for (let i = 0; i < LEGACY.OBSTACLE_COUNT; i++) {
    const a = ((i + 0.25) / LEGACY.OBSTACLE_COUNT) * Math.PI * 2;
    out.push({
      x: round3(Math.cos(a) * LEGACY.OBSTACLE_RING_RADIUS), y: LEGACY.OBSTACLE_HALF.y, z: round3(Math.sin(a) * LEGACY.OBSTACLE_RING_RADIUS),
      yaw: round6(-a - Math.PI / 2), hx: LEGACY.OBSTACLE_HALF.x, hy: LEGACY.OBSTACLE_HALF.y, hz: LEGACY.OBSTACLE_HALF.z,
    });
  }
  return out;
}

export function legacySpawn(index: number, count: number): { x: number; z: number; yaw: number } {
  const a = (index / count) * Math.PI * 2;
  return { x: round3(Math.cos(a) * LEGACY.SPAWN_RADIUS), z: round3(Math.sin(a) * LEGACY.SPAWN_RADIUS), yaw: round6(Math.PI - a) };
}
```

Create `tests/arenas.test.ts`:

<!-- op {"kind": "create", "path": "tests/arenas.test.ts"} -->
```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { spawnPose } from '../src/shared/arena';
import { ARENAS, ARENA_IDS, boundsClearance, boundsHalfSize, boundsRadius, clampToBounds, getArena, isArenaId, outOfBounds, parseArena, type ArenaDef } from '../src/shared/arenas';
import { CAR_FORWARD, ARENA } from '../src/shared/constants';
import { quatFromYaw, quatFromYawPitch, quatRotate, vdot } from '../src/shared/math';
import { initPhysics } from '../src/shared/physics';
import { legacyObstacleBoxes, legacySpawn, legacyWallSegments } from './helpers/legacyArena';

beforeAll(async () => {
  await initPhysics();
});

const raw = (id: (typeof ARENA_IDS)[number]) => JSON.parse(JSON.stringify(ARENAS[id])) as Record<string, any>;

describe('the Stadium layout', () => {
  it('is exactly the circle the game had before arenas were data', () => {
    const stripped = ARENAS.stadium.boxes.map(({ x, y, z, yaw, hx, hy, hz }) => ({ x, y, z, yaw, hx, hy, hz }));
    // JSON cannot hold -0, so the legacy numbers are compared with their negative zeros turned into plain ones
    const legacy = [...legacyWallSegments(), ...legacyObstacleBoxes()].map((b) => ({ ...b, x: b.x + 0, z: b.z + 0 }));
    expect(stripped).toEqual(legacy);
    expect(ARENAS.stadium.groundHalfExtent).toBe(120);
    expect(ARENAS.stadium.ground).toEqual({ friction: 1, grip: 1, drag: 0, power: 1 });
  });

  it('spawns where it used to', () => {
    for (let i = 0; i < 8; i++) {
      const p = spawnPose(i, 8, ARENAS.stadium);
      const old = legacySpawn(i, 8);
      expect([p.pos.x, p.pos.z, p.yaw]).toEqual([old.x, old.z, old.yaw]);
    }
  });
});

describe('every arena layout', () => {
  for (const id of ARENA_IDS) {
    const arena = getArena(id);
    describe(arena.name, () => {
      it('has its own id and a name', () => {
        expect(arena.id).toBe(id);
        expect(arena.name.length).toBeGreaterThan(2);
      });

      it('gives eight spawns inside the bounds, clear of every box, facing the middle', () => {
        const seen = new Set<string>();
        for (let i = 0; i < 8; i++) {
          const p = spawnPose(i, 8, arena);
          seen.add(`${p.pos.x},${p.pos.z}`);
          expect(boundsClearance(arena.bounds, p.pos.x, p.pos.z)).toBeGreaterThan(5);
          for (const b of arena.boxes) {
            const q = quatRotate(quatFromYaw(-b.yaw), { x: p.pos.x - b.x, y: 0, z: p.pos.z - b.z });
            const gap = Math.hypot(Math.max(Math.abs(q.x) - b.hx, 0), Math.max(Math.abs(q.z) - b.hz, 0));
            expect(gap, `${id} spawn ${i} against ${b.kind}`).toBeGreaterThan(2.5);
          }
          const r = Math.hypot(p.pos.x, p.pos.z);
          const f = quatRotate(p.quat, CAR_FORWARD);
          expect(vdot(f, { x: -p.pos.x / r, y: 0, z: -p.pos.z / r })).toBeGreaterThan(0.99);
        }
        expect(seen.size).toBe(8);
      });

      it('keeps every box inside the ground, with sane sizes and a kind', () => {
        for (const b of arena.boxes) {
          expect(typeof b.kind).toBe('string');
          expect(Math.abs(b.x) + Math.max(b.hx, b.hz)).toBeLessThan(arena.groundHalfExtent);
          expect(Math.abs(b.z) + Math.max(b.hx, b.hz)).toBeLessThan(arena.groundHalfExtent);
          expect(b.hy).toBeGreaterThan(0);
          expect(Math.abs(b.pitch ?? 0)).toBeLessThan(0.5);
        }
      });

      it('has a ground feel within the range the physics is tuned for', () => {
        expect(arena.ground.grip).toBeGreaterThan(0.2);
        expect(arena.ground.grip).toBeLessThanOrEqual(1.5);
        expect(arena.ground.power).toBeGreaterThan(0.6);
        expect(arena.ground.power).toBeLessThanOrEqual(1.2);
        expect(arena.ground.drag).toBeGreaterThanOrEqual(0);
        expect(arena.ground.drag).toBeLessThan(1);
      });

      it('has walls all the way round (a point just outside the bounds meets a box)', () => {
        const probes = 48;
        for (let k = 0; k < probes; k++) {
          const a = (k / probes) * Math.PI * 2;
          let x = Math.cos(a) * 3;
          let z = Math.sin(a) * 3;
          while (boundsClearance(arena.bounds, x, z) > 0.2) { x += Math.cos(a) * 0.25; z += Math.sin(a) * 0.25; }
          x += Math.cos(a) * 1.2;
          z += Math.sin(a) * 1.2;
          const hit = arena.boxes.some((b) => {
            const dx = x - b.x;
            const dz = z - b.z;
            const q = quatRotate(quatFromYaw(-b.yaw), { x: dx, y: 0, z: dz });
            return Math.abs(q.x) <= b.hx + 0.05 && Math.abs(q.z) <= b.hz + 0.05;
          });
          expect(hit, `${id} probe ${k}`).toBe(true);
        }
      });
    });
  }
});

describe('parseArena', () => {
  it('accepts every shipped layout unchanged', () => {
    for (const id of ARENA_IDS) expect(parseArena(raw(id))).toEqual(ARENAS[id]);
  });

  it.each([
    ['an unknown id', (a: any) => { a.id = 'moon'; }],
    ['no boxes', (a: any) => { a.boxes = []; }],
    ['a box with a NaN', (a: any) => { a.boxes[0].x = Number.NaN; }],
    ['a box with a negative half extent', (a: any) => { a.boxes[0].hy = -1; }],
    ['a grip of zero', (a: any) => { a.ground.grip = 0; }],
    ['a power far above the tuned range', (a: any) => { a.ground.power = 9; }],
    ['bounds of an unknown kind', (a: any) => { a.bounds = { kind: 'blob' }; }],
    ['a polygon with two points', (a: any) => { a.bounds = { kind: 'polygon', points: [[0, 0], [1, 1]] }; }],
    ['seven spawn points', (a: any) => { a.spawn = { kind: 'points', points: Array.from({ length: 7 }, (_, i) => [i, 0]) }; }],
    ['a missing look', (a: any) => { delete a.look; }],
  ])('rejects %s', (_name, damage) => {
    const a = raw('stadium');
    damage(a);
    expect(() => parseArena(a)).toThrow(/arena layout/);
  });

  it('rejects things that are not objects', () => {
    for (const bad of [null, 3, 'x', [], undefined]) expect(() => parseArena(bad)).toThrow(/arena layout/);
  });
});

describe('arena ids', () => {
  it('recognises exactly the four', () => {
    expect([...ARENA_IDS]).toEqual(['stadium', 'ice', 'quarry', 'port']);
    expect(isArenaId('ice')).toBe(true);
    for (const bad of ['', 'Ice', 'moon', 3, null, undefined, {}]) expect(isArenaId(bad)).toBe(false);
  });
});

describe('bounds', () => {
  const circle: ArenaDef['bounds'] = { kind: 'circle', radius: 10 };
  const square: ArenaDef['bounds'] = { kind: 'polygon', points: [[-10, -10], [10, -10], [10, 10], [-10, 10]] };

  it('measures clearance in metres, negative outside', () => {
    expect(boundsClearance(circle, 4, 0)).toBeCloseTo(6);
    expect(boundsClearance(circle, 13, 0)).toBeCloseTo(-3);
    expect(boundsClearance(square, 4, 0)).toBeCloseTo(6);
    expect(boundsClearance(square, 13, 0)).toBeCloseTo(-3);
    expect(boundsClearance(square, 13, 13)).toBeCloseTo(-Math.hypot(3, 3));
  });

  it('keeps the circle test the game always had: further than radius + margin', () => {
    expect(outOfBounds(circle, 12, 0, 2)).toBe(false);
    expect(outOfBounds(circle, 12.001, 0, 2)).toBe(true);
  });

  it('applies the margin outside a polygon', () => {
    expect(outOfBounds(square, 11.9, 0, 2)).toBe(false);
    expect(outOfBounds(square, 12.1, 0, 2)).toBe(true);
    expect(outOfBounds(square, 12.1, 12.1, 2)).toBe(true);
  });

  it('clamps a point towards the middle until it is `inset` inside', () => {
    const c = clampToBounds(circle, 30, 0, 3);
    expect(c.x).toBeCloseTo(7);
    const s = clampToBounds(square, 30, 5, 3);
    expect(boundsClearance(square, s.x, s.z)).toBeGreaterThanOrEqual(3 - 1e-3);
    expect(boundsClearance(square, s.x, s.z)).toBeLessThan(3.05);
    expect(clampToBounds(square, 1, 1, 3)).toEqual({ x: 1, z: 1 });
  });

  it('survives a point at the exact middle and a non-finite one', () => {
    expect(clampToBounds(circle, 0, 0, 50)).toEqual({ x: 0, z: 0 });
    expect(Number.isFinite(boundsClearance(square, 0, 0))).toBe(true);
  });
});

describe('how far an arena reaches', () => {
  it('measures the furthest point from the middle, and the half-width of the square that holds it', () => {
    expect(boundsRadius({ kind: 'circle', radius: 52 })).toBe(52);
    expect(boundsHalfSize({ kind: 'circle', radius: 52 })).toBe(52);
    const rect: ArenaDef['bounds'] = { kind: 'polygon', points: [[-45, -33], [45, -33], [45, 33], [-45, 33]] };
    expect(boundsRadius(rect)).toBeCloseTo(Math.hypot(45, 33));
    expect(boundsHalfSize(rect)).toBe(45);
  });

  it('puts every wall inside the reach, so scenery and marks can be sized from it', () => {
    for (const id of ARENA_IDS) {
      const a = ARENAS[id];
      for (const b of a.boxes) expect(Math.hypot(b.x, b.z)).toBeLessThan(boundsRadius(a.bounds) + 6);
    }
  });
});

describe('quatFromYawPitch', () => {
  it('is exactly quatFromYaw when there is no pitch', () => {
    for (const yaw of [0, 0.7, -2.2, 3]) expect(quatFromYawPitch(yaw, 0)).toEqual(quatFromYaw(yaw));
  });

  it('tilts a ramp so its +X end rises', () => {
    const q = quatFromYawPitch(0, 0.3);
    const along = quatRotate(q, { x: 1, y: 0, z: 0 });
    expect(along.y).toBeCloseTo(Math.sin(0.3), 3);
    expect(along.x).toBeCloseTo(Math.cos(0.3), 3);
  });

  it('applies the yaw about +Y after the pitch', () => {
    const q = quatFromYawPitch(Math.PI / 2, 0.3);
    const along = quatRotate(q, { x: 1, y: 0, z: 0 });
    expect(along.y).toBeCloseTo(Math.sin(0.3), 3);
    expect(along.z).toBeCloseTo(-Math.cos(0.3), 3);
  });

  it('uses the stadium radius constant for nothing any more', () => {
    expect(ARENA.RADIUS).toBe(45);
  });
});
```

In `tests/arena.test.ts`, the geometry tests describe the Stadium through the legacy numbers and the physics tests build the Stadium from its layout:

<!-- op {"kind": "edit", "path": "tests/arena.test.ts"} -->
```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { ARENA, CAR, CAR_FORWARD } from '../src/shared/constants';
import { buildArena, obstacleBoxes, spawnPose, wallSegments } from '../src/shared/arena';
import { quatFromYaw, quatRotate, vdot } from '../src/shared/math';
```

with:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { CAR, CAR_FORWARD } from '../src/shared/constants';
import { buildArena, spawnPose } from '../src/shared/arena';
import { ARENAS } from '../src/shared/arenas';
import { quatFromYaw, quatRotate, vdot } from '../src/shared/math';
```

In `tests/arena.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/arena.test.ts"} -->
```ts
import { RAPIER, initPhysics } from '../src/shared/physics';

```

with:

```ts
import { RAPIER, initPhysics } from '../src/shared/physics';
import { LEGACY as ARENA, legacyObstacleBoxes as obstacleBoxes, legacyWallSegments as wallSegments } from './helpers/legacyArena';

```

In `tests/arena.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/arena.test.ts"} -->
```ts

describe('spawnPose', () => {
  it('places cars on a circle facing the centre', () => {
```

with:

```ts

describe('spawnPose on the Stadium ring', () => {
  it('places cars on a circle facing the centre', () => {
```

In `tests/arena.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/arena.test.ts"} -->
```ts

describe('arena geometry specs', () => {
  it('builds a closed ring of wall segments at the arena radius', () => {
```

with:

```ts

describe('the Stadium geometry (as it was before arenas were data)', () => {
  it('builds a closed ring of wall segments at the arena radius', () => {
```

In `tests/arena.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/arena.test.ts"} -->
```ts
    const w = makeWorld();
    expect(w.colliders.len()).toBe(1 + ARENA.WALL_SEGMENTS + ARENA.OBSTACLE_COUNT);
    w.free();
```

with:

```ts
    const w = makeWorld();
    expect(w.colliders.len()).toBe(1 + ARENAS.stadium.boxes.length);
    expect(ARENAS.stadium.boxes.length).toBe(ARENA.WALL_SEGMENTS + ARENA.OBSTACLE_COUNT);
    w.free();
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/arenas.test.ts tests/arena.test.ts`
Expected: FAIL — `src/shared/arenas.ts` does not exist yet

<!-- check {"cmd": "npx vitest run tests/arenas.test.ts tests/arena.test.ts", "outcome": "fail", "match": "Cannot find module|FAIL|not a function|Failed"} -->

- [ ] **Step 3: Write the layouts**

`art/arenas/layouts.py` is the one place the four layouts are described (the Blender scenery of the next plan imports it too, so the walls you see are the walls you hit). Boxes are rounded the way the game rounds them (millimetres, micro-radians); the Stadium's wall ring uses the old formula bit for bit. **Only this file is added under `art/`**: the rest of that folder (the car models) is not part of this plan. Run it from the repository root to write the four JSON files:

Create `art/arenas/layouts.py`:

<!-- op {"kind": "create", "path": "art/arenas/layouts.py"} -->
```
#!/usr/bin/env python3
"""The layouts of the four arenas, as data. Run `python3 art/arenas/layouts.py` from the repository root to write
src/shared/arenas/<id>.json, which the server and the browser both build the physics from (the Blender scenery script
imports this module too, so the walls you see are the walls you hit).

Axes as in the game: X forward, Y up, Z right; a box's `yaw` turns it about +Y, its `pitch` tilts it about its own Z axis
(a positive pitch lifts the +X end: a ramp). Numbers are rounded the way the game rounds them (millimetres, micro-radians).
"""
import json
import math
import os

TAU = math.tau


def r3(v):
    return math.floor(v * 1e3 + 0.5) / 1e3


def r6(v):
    return math.floor(v * 1e6 + 0.5) / 1e6


def box(kind, x, y, z, yaw, hx, hy, hz, pitch=0.0, tint=None):
    b = {'kind': kind, 'x': r3(x), 'y': r3(y), 'z': r3(z), 'yaw': r6(yaw), 'hx': r3(hx), 'hy': r3(hy), 'hz': r3(hz)}
    if pitch:
        b['pitch'] = r6(pitch)
    if tint is not None:
        b['tint'] = tint
    return b


def ring_walls(radius, segments, half_h, half_t, kind='wall'):
    """A regular polygon of wall boxes whose inner faces sit at `radius` (the Stadium's formula, bit for bit)."""
    r = radius + half_t
    hx = r3(r * math.tan(math.pi / segments) + 0.3)  # +0.3 overlaps the neighbours so there are no gaps
    out = []
    for i in range(segments):
        a = (i / segments) * TAU
        out.append(box(kind, math.cos(a) * r, half_h, math.sin(a) * r, -a - math.pi / 2, hx, half_h, half_t))
    return out


def polygon_walls(points, half_h, half_t, kind='wall'):
    """Walls on the outside of a closed polygon (its inner faces run along the polygon)."""
    cx = sum(p[0] for p in points) / len(points)
    cz = sum(p[1] for p in points) / len(points)
    out = []
    for i, (x0, z0) in enumerate(points):
        x1, z1 = points[(i + 1) % len(points)]
        dx, dz = x1 - x0, z1 - z0
        length = math.hypot(dx, dz)
        nx, nz = -dz / length, dx / length
        mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
        if nx * (mx - cx) + nz * (mz - cz) < 0:
            nx, nz = -nx, -nz
        out.append(box(kind, mx + nx * half_t, half_h, mz + nz * half_t, math.atan2(-dz, dx), length / 2 + 0.3, half_h, half_t))
    return out


def ramp(sx, sz, angle, length, height, half_w, kind='ramp', half_t=0.2):
    """A slab that starts on the ground at (sx, sz), runs `length` along direction `angle` and ends `height` up."""
    theta = math.asin(height / length)
    d = length / 2 * math.cos(theta) + half_t * math.sin(theta)
    return box(kind, sx + math.cos(angle) * d, height / 2 - half_t * math.cos(theta), sz + math.sin(angle) * d, -angle,
               length / 2, half_t, half_w, pitch=theta)


def container_block(cx, cz, along, count, rows, stack=1, tint=0):
    """`rows` rows of `count` shipping containers (6.1 x 2.4 m), side by side; `along` is 'x' or 'z'."""
    out = []
    yaw = 0.0 if along == 'x' else math.pi / 2
    hy = 1.3 * stack
    for r in range(rows):
        off = (r - (rows - 1) / 2) * 2.5
        for c in range(count):
            pos = (c - (count - 1) / 2) * 6.1
            x, z = (cx + pos, cz + off) if along == 'x' else (cx + off, cz + pos)
            out.append(box('container', x, hy, z, yaw, 3.0, hy, 1.2, tint=(tint + r + c) % 4))
    return out


def facing_centre_yaw(x, z):
    return r6(math.atan2(z, -x)) if (x or z) else 0.0


def pts(points):
    return [[r3(x), r3(z)] for x, z in points]


# ------------------------------------------------------------------ the arenas
def stadium():
    boxes = ring_walls(45, 32, 1.5, 1.0)
    for i in range(4):  # concrete blocks on a ring, offset so they never sit on a spawn line
        a = ((i + 0.25) / 4) * TAU
        boxes.append(box('block', math.cos(a) * 14, 0.75, math.sin(a) * 14, -a - math.pi / 2, 2.5, 0.75, 1.0))
    return {
        'id': 'stadium', 'name': 'Stadium',
        'groundHalfExtent': 120,
        'ground': {'friction': 1.0, 'grip': 1.0, 'drag': 0.0, 'power': 1.0},
        'boxes': boxes,
        'bounds': {'kind': 'circle', 'radius': 45},
        'spawn': {'kind': 'ring', 'radius': 32},
        'look': {'sky': '#0b1226', 'fog': '#0b1226', 'fogNear': 70, 'fogFar': 240, 'ground': '#6b4a2f', 'wall': '#8a8d91',
                 'block': '#9a9da1', 'sun': '#fff0d8', 'sunIntensity': 2.4, 'hemiSky': '#9db4ff', 'hemiGround': '#3b2c1c'},
    }


def ice():
    radius = 52
    boxes = ring_walls(radius, 40, 0.9, 1.5)
    for i in range(6):  # blocks of ice, a ring of them well inside the lake
        a = ((i + 0.5) / 6) * TAU
        boxes.append(box('ice', math.cos(a) * 21, 0.9, math.sin(a) * 21, -a - math.pi / 2 + 0.6, 2.4, 0.9, 2.4))
    return {
        'id': 'ice', 'name': 'Frozen Lake',
        'groundHalfExtent': 140,
        'ground': {'friction': 0.2, 'grip': 0.4, 'drag': 0.0, 'power': 1.0},
        'boxes': boxes,
        'bounds': {'kind': 'circle', 'radius': radius},
        'spawn': {'kind': 'ring', 'radius': 38},
        'look': {'sky': '#a9c7e8', 'fog': '#c9dcef', 'fogNear': 60, 'fogFar': 260, 'ground': '#dff0fb', 'wall': '#f4f9ff',
                 'block': '#9fd0f0', 'sun': '#fff2e0', 'sunIntensity': 2.2, 'hemiSky': '#cfe3ff', 'hemiGround': '#9fb8d0'},
    }


def quarry():
    a_axis, b_axis, n = 62.0, 42.0, 40
    outline = [(a_axis * math.cos(i / n * TAU), b_axis * math.sin(i / n * TAU)) for i in range(n)]
    boxes = polygon_walls(outline, 1.5, 1.0)
    height = 1.2
    boxes.append(box('block', 0, height / 2, 0, 0, 6, height / 2, 6))  # a raised mound with a ramp on each side
    for k in range(4):
        angle = k * math.pi / 2
        boxes.append(ramp(math.cos(angle) * 15.5, math.sin(angle) * 15.5, angle + math.pi, 9.5, height, 5.0))
    spawns = [(0.72 * a_axis * math.cos((k + 0.5) / 8 * TAU), 0.72 * b_axis * math.sin((k + 0.5) / 8 * TAU)) for k in range(8)]
    return {
        'id': 'quarry', 'name': 'Mud Quarry',
        'groundHalfExtent': 130,
        'ground': {'friction': 1.0, 'grip': 0.9, 'drag': 0.25, 'power': 0.88},
        'boxes': boxes,
        'bounds': {'kind': 'polygon', 'points': pts(outline)},
        'spawn': {'kind': 'points', 'points': pts(spawns)},
        'look': {'sky': '#d8a066', 'fog': '#c98f58', 'fogNear': 50, 'fogFar': 200, 'ground': '#8a5a32', 'wall': '#6e4a2c',
                 'block': '#7a5b3b', 'sun': '#ffcf99', 'sunIntensity': 2.6, 'hemiSky': '#ffd9a8', 'hemiGround': '#5a3a20'},
    }


def port():
    hx, hz = 45.0, 33.0
    outline = [(-hx, -hz), (hx, -hz), (hx, hz), (-hx, hz)]
    boxes = polygon_walls(outline, 1.5, 1.0)
    boxes += container_block(-27, -20, 'x', 2, 2, tint=0)
    boxes += container_block(21, -26, 'z', 2, 2, tint=1)
    boxes += container_block(27, 20, 'x', 2, 2, tint=2)
    boxes += container_block(-21, 26, 'z', 2, 2, tint=3)
    boxes += [box('container', 0, 1.3, -27, 0, 3.0, 1.3, 1.2, tint=1), box('container', 0, 1.3, 27, 0, 3.0, 1.3, 1.2, tint=2),
              box('container', -38, 1.3, 0, math.pi / 2, 3.0, 1.3, 1.2, tint=3), box('container', 38, 1.3, 0, math.pi / 2, 3.0, 1.3, 1.2, tint=0)]
    boxes += [ramp(-15, 0, 0, 7, 1.0, 3.0), ramp(15, 0, math.pi, 7, 1.0, 3.0)]  # two kickers facing each other across the middle
    spawns = [(-12, -26), (12, -26), (38, -8), (38, 8), (12, 26), (-12, 26), (-38, 8), (-38, -8)]
    return {
        'id': 'port', 'name': 'Container Port',
        'groundHalfExtent': 120,
        'ground': {'friction': 1.0, 'grip': 1.15, 'drag': 0.0, 'power': 1.0},
        'boxes': boxes,
        'bounds': {'kind': 'polygon', 'points': pts(outline)},
        'spawn': {'kind': 'points', 'points': pts(spawns)},
        'look': {'sky': '#1a1f2e', 'fog': '#252a3a', 'fogNear': 60, 'fogFar': 220, 'ground': '#4a4d52', 'wall': '#6b6e73',
                 'block': '#7d8086', 'sun': '#ffb066', 'sunIntensity': 1.9, 'hemiSky': '#8d9ccf', 'hemiGround': '#33281f'},
    }


ARENAS = [stadium, ice, quarry, port]


def main():
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'shared', 'arenas')
    os.makedirs(root, exist_ok=True)
    for build in ARENAS:
        arena = build()
        path = os.path.join(root, arena['id'] + '.json')
        with open(path, 'w') as f:
            json.dump(arena, f, indent=1)
            f.write('\n')
        print('wrote', os.path.normpath(path), len(arena['boxes']), 'boxes')


if __name__ == '__main__':
    main()
```

Run: `python3 art/arenas/layouts.py`
Expected: it prints one line per arena (36, 46, 45 and 26 boxes) and writes `src/shared/arenas/{stadium,ice,quarry,port}.json`

<!-- check {"cmd": "python3 art/arenas/layouts.py", "outcome": "pass", "match": "stadium\\.json 36 boxes[\\s\\S]*ice\\.json 46 boxes[\\s\\S]*quarry\\.json 45 boxes[\\s\\S]*port\\.json 26 boxes"} -->

The four JSON files are generated: they are committed (the server, the browser and the tests read them), but nobody edits them by hand. Change the script and run it again.

- [ ] **Step 4: Add the loader and build the physics from a layout**

`src/shared/arenas.ts` reads and checks a layout (anything out of range is a readable error, never a half-built arena), holds the four arenas and the bounds helpers (a circle keeps the exact `Math.hypot > radius + margin` test the game always had):

Create `src/shared/arenas.ts`:

<!-- op {"kind": "create", "path": "src/shared/arenas.ts"} -->
```ts
import type { BoxSpec } from './arena';
import iceJson from './arenas/ice.json';
import portJson from './arenas/port.json';
import quarryJson from './arenas/quarry.json';
import stadiumJson from './arenas/stadium.json';

/** The arenas a room can play in, in the order the vote panel lists them. */
export const ARENA_IDS = ['stadium', 'ice', 'quarry', 'port'] as const;
export type ArenaId = (typeof ARENA_IDS)[number];
export const isArenaId = (v: unknown): v is ArenaId => typeof v === 'string' && (ARENA_IDS as readonly string[]).includes(v);

/** How the ground treats a car. 1 / 0 / 1 / 1 is the Stadium's dirt: every other arena is relative to it. */
export interface GroundFeel {
  /** Friction of the ground against the car's body (scraping). */
  friction: number;
  /** Multiplies the tyres' grip, sideways and along. */
  grip: number;
  /** Added to the car's linear damping: mud drags. */
  drag: number;
  /** Multiplies the engine force and the speed it fades out at. */
  power: number;
}

/** The Stadium's dirt, and what a car is built with when nobody says otherwise. */
export const NEUTRAL_GROUND: GroundFeel = Object.freeze({ friction: 1, grip: 1, drag: 0, power: 1 });

export type Bounds = { kind: 'circle'; radius: number } | { kind: 'polygon'; points: Array<[number, number]> };
export type SpawnLayout = { kind: 'ring'; radius: number } | { kind: 'points'; points: Array<[number, number]> };

/** Colours and light for the arena as the client draws it from the layout alone (the Blender scenery comes on top). */
export interface ArenaLook {
  sky: string;
  fog: string;
  fogNear: number;
  fogFar: number;
  ground: string;
  wall: string;
  block: string;
  sun: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
}

export interface ArenaDef {
  id: ArenaId;
  name: string;
  groundHalfExtent: number;
  ground: GroundFeel;
  /** Walls and obstacles (static boxes), walls first. */
  boxes: BoxSpec[];
  /** The playable area: a car outside it (plus a margin) is out of the round. */
  bounds: Bounds;
  spawn: SpawnLayout;
  look: ArenaLook;
}

// ---- reading a layout file ------------------------------------------------------------------------------------

function fail(path: string, why: string): never {
  throw new Error(`arena layout: ${path} ${why}`);
}
const obj = (v: unknown, path: string): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(path, 'must be an object');
const num = (v: unknown, path: string): number => (typeof v === 'number' && Number.isFinite(v) ? v : fail(path, 'must be a finite number'));
const str = (v: unknown, path: string): string => (typeof v === 'string' && v.length > 0 ? v : fail(path, 'must be a non-empty string'));
const pairs = (v: unknown, path: string, min: number): Array<[number, number]> => {
  if (!Array.isArray(v) || v.length < min) fail(path, `must be a list of at least ${min} [x, z] pairs`);
  return v.map((p, i) => {
    if (!Array.isArray(p) || p.length !== 2) fail(`${path}[${i}]`, 'must be an [x, z] pair');
    return [num(p[0], `${path}[${i}][0]`), num(p[1], `${path}[${i}][1]`)] as [number, number];
  });
};

/** Checks a layout (the JSON files, or anything a test makes up) and returns it typed; throws a readable error otherwise. */
export function parseArena(raw: unknown): ArenaDef {
  const a = obj(raw, 'arena');
  const id = str(a.id, 'id');
  if (!isArenaId(id)) fail('id', `must be one of ${ARENA_IDS.join(', ')}`);
  const g = obj(a.ground, 'ground');
  const ground: GroundFeel = { friction: num(g.friction, 'ground.friction'), grip: num(g.grip, 'ground.grip'), drag: num(g.drag, 'ground.drag'), power: num(g.power, 'ground.power') };
  if (ground.grip <= 0 || ground.grip > 3 || ground.power <= 0 || ground.power > 3 || ground.drag < 0 || ground.drag > 2 || ground.friction < 0) {
    fail('ground', 'is outside the range the physics is tuned for');
  }
  if (!Array.isArray(a.boxes) || a.boxes.length === 0) fail('boxes', 'must be a non-empty list');
  const boxes = a.boxes.map((b, i): BoxSpec => {
    const o = obj(b, `boxes[${i}]`);
    const box: BoxSpec = {
      x: num(o.x, `boxes[${i}].x`), y: num(o.y, `boxes[${i}].y`), z: num(o.z, `boxes[${i}].z`), yaw: num(o.yaw, `boxes[${i}].yaw`),
      hx: num(o.hx, `boxes[${i}].hx`), hy: num(o.hy, `boxes[${i}].hy`), hz: num(o.hz, `boxes[${i}].hz`),
    };
    if (box.hx <= 0 || box.hy <= 0 || box.hz <= 0) fail(`boxes[${i}]`, 'must have positive half extents');
    if (o.pitch !== undefined) box.pitch = num(o.pitch, `boxes[${i}].pitch`);
    if (o.kind !== undefined) box.kind = str(o.kind, `boxes[${i}].kind`);
    if (o.tint !== undefined) box.tint = num(o.tint, `boxes[${i}].tint`);
    return box;
  });
  const b = obj(a.bounds, 'bounds');
  const bounds: Bounds =
    b.kind === 'circle' ? { kind: 'circle', radius: num(b.radius, 'bounds.radius') } : b.kind === 'polygon' ? { kind: 'polygon', points: pairs(b.points, 'bounds.points', 3) } : fail('bounds.kind', 'must be circle or polygon');
  if (bounds.kind === 'circle' && bounds.radius <= 0) fail('bounds.radius', 'must be positive');
  const s = obj(a.spawn, 'spawn');
  const spawn: SpawnLayout =
    s.kind === 'ring' ? { kind: 'ring', radius: num(s.radius, 'spawn.radius') } : s.kind === 'points' ? { kind: 'points', points: pairs(s.points, 'spawn.points', 8) } : fail('spawn.kind', 'must be ring or points');
  if (spawn.kind === 'points' && spawn.points.length !== 8) fail('spawn.points', 'must list exactly 8 places');
  const l = obj(a.look, 'look');
  const look: ArenaLook = {
    sky: str(l.sky, 'look.sky'), fog: str(l.fog, 'look.fog'), fogNear: num(l.fogNear, 'look.fogNear'), fogFar: num(l.fogFar, 'look.fogFar'),
    ground: str(l.ground, 'look.ground'), wall: str(l.wall, 'look.wall'), block: str(l.block, 'look.block'), sun: str(l.sun, 'look.sun'),
    sunIntensity: num(l.sunIntensity, 'look.sunIntensity'), hemiSky: str(l.hemiSky, 'look.hemiSky'), hemiGround: str(l.hemiGround, 'look.hemiGround'),
  };
  return { id, name: str(a.name, 'name'), groundHalfExtent: num(a.groundHalfExtent, 'groundHalfExtent'), ground, boxes, bounds, spawn, look };
}

export const ARENAS: Readonly<Record<ArenaId, ArenaDef>> = {
  stadium: parseArena(stadiumJson),
  ice: parseArena(iceJson),
  quarry: parseArena(quarryJson),
  port: parseArena(portJson),
};
export const DEFAULT_ARENA: ArenaDef = ARENAS.stadium;
export const getArena = (id: ArenaId): ArenaDef => ARENAS[id];

// ---- the playable area -----------------------------------------------------------------------------------------

function distanceToSegment(px: number, pz: number, x0: number, z0: number, x1: number, z1: number): number {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (pz - z0) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - (x0 + t * dx), pz - (z0 + t * dz));
}

function insidePolygon(points: ReadonlyArray<readonly [number, number]>, x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = points[i]!;
    const [xj, zj] = points[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** The furthest the playable area gets from the middle (m): what a shadow camera or a ring of scenery has to cover. */
export function boundsRadius(bounds: Bounds): number {
  return bounds.kind === 'circle' ? bounds.radius : Math.max(...bounds.points.map(([x, z]) => Math.hypot(x, z)));
}

/** Half the side of the smallest square around the middle that holds the playable area (m): what the tyre-mark texture covers. */
export function boundsHalfSize(bounds: Bounds): number {
  return bounds.kind === 'circle' ? bounds.radius : Math.max(...bounds.points.map(([x, z]) => Math.max(Math.abs(x), Math.abs(z))));
}

/** How far inside the playable area a point is (metres): negative outside. */
export function boundsClearance(bounds: Bounds, x: number, z: number): number {
  if (bounds.kind === 'circle') return bounds.radius - Math.hypot(x, z);
  let nearest = Infinity;
  for (let i = 0; i < bounds.points.length; i++) {
    const [x0, z0] = bounds.points[i]!;
    const [x1, z1] = bounds.points[(i + 1) % bounds.points.length]!;
    nearest = Math.min(nearest, distanceToSegment(x, z, x0, z0, x1, z1));
  }
  return insidePolygon(bounds.points, x, z) ? nearest : -nearest;
}

/** True once a point is further than `margin` outside the playable area. */
export function outOfBounds(bounds: Bounds, x: number, z: number, margin: number): boolean {
  return bounds.kind === 'circle' ? Math.hypot(x, z) > bounds.radius + margin : boundsClearance(bounds, x, z) < -margin;
}

/** The nearest point to (x, z) towards the middle that is at least `inset` inside the playable area. */
export function clampToBounds(bounds: Bounds, x: number, z: number, inset: number): { x: number; z: number } {
  if (boundsClearance(bounds, x, z) >= inset) return { x, z };
  if (bounds.kind === 'circle') {
    const r = Math.hypot(x, z);
    const max = Math.max(0, bounds.radius - inset);
    return r > max ? { x: (x * max) / r, z: (z * max) / r } : { x, z };
  }
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (boundsClearance(bounds, x * (1 - mid), z * (1 - mid)) >= inset) hi = mid;
    else lo = mid;
  }
  return { x: x * (1 - hi), z: z * (1 - hi) };
}
```

`quatFromYawPitch` (a ramp's slope, about the box's own Z axis, then the yaw about +Y; with no pitch it is exactly `quatFromYaw`):

In `src/shared/math.ts`:

<!-- op {"kind": "edit", "path": "src/shared/math.ts"} -->
```ts
export const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;

```

with:

```ts
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

```

`src/shared/arena.ts` now builds the world from an `ArenaDef` (the Stadium unless told otherwise). The functions `wallSegments()` and `obstacleBoxes()` are gone: their output is the layout's `boxes`.

Replace `src/shared/arena.ts` with:

<!-- op {"kind": "replace", "path": "src/shared/arena.ts"} -->
```ts
import { CAR } from './constants';
import { quatFromYaw, quatFromYawPitch, round3, round6 } from './math';
import { RAPIER } from './physics';
import type { Quat, Vec3 } from './types';
import { DEFAULT_ARENA, type ArenaDef } from './arenas';

export interface SpawnPose {
  pos: Vec3;
  quat: Quat;
  yaw: number;
}

/** A yaw-rotated box described by its centre and half extents (used for colliders and for visuals). */
export interface BoxSpec {
  x: number;
  y: number;
  z: number;
  yaw: number;
  hx: number;
  hy: number;
  hz: number;
  /** Tilt about the box's own Z axis, in radians: a positive pitch lifts the +X end (a ramp). Default 0. */
  pitch?: number;
  /** What the box is (wall, block, ice, ramp, container...): the client dresses it; the physics ignores it. */
  kind?: string;
  /** Which variant of the kind to draw (the colour of a container). Cosmetic. */
  tint?: number;
}

export interface ArenaOptions {
  /** The arena to build. Default: the Stadium. */
  arena?: ArenaDef;
  /** false builds only the ground (handy for handling tests). Default true. */
  walls?: boolean;
  groundHalfExtent?: number;
}

/** Spawn `index` of `count` (the position in the sorted roster): on a ring facing the centre, or on the arena's listed places. */
export function spawnPose(index: number, count: number, arena: ArenaDef = DEFAULT_ARENA): SpawnPose {
  const layout = arena.spawn;
  if (layout.kind === 'points') {
    const [px, pz] = layout.points[Math.floor((index * layout.points.length) / count)]!;
    // forward (+X rotated by yaw about +Y) = (cos yaw, 0, -sin yaw) must equal (-x, 0, -z) / r
    const yaw = px || pz ? round6(Math.atan2(pz, -px)) : 0;
    return { pos: { x: px, y: CAR.SPAWN_HEIGHT, z: pz }, quat: quatFromYaw(yaw), yaw };
  }
  const a = (index / count) * Math.PI * 2;
  const x = round3(Math.cos(a) * layout.radius);
  const z = round3(Math.sin(a) * layout.radius);
  // forward (+X rotated by yaw about +Y) = (cos yaw, 0, -sin yaw) must equal (-cos a, 0, -sin a)
  const yaw = round6(Math.PI - a);
  return { pos: { x, y: CAR.SPAWN_HEIGHT, z }, quat: quatFromYaw(yaw), yaw };
}

export interface ArenaColliders {
  /** Handle of the ground collider: the one static surface a car body is not meant to touch (only wheels and a flipped roof do). */
  ground: number;
}

export function buildArena(world: RAPIER.World, options: ArenaOptions = {}): ArenaColliders {
  const arena = options.arena ?? DEFAULT_ARENA;
  const walls = options.walls ?? true;
  const half = options.groundHalfExtent ?? arena.groundHalfExtent;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const ground = world.createCollider(
    RAPIER.ColliderDesc.cuboid(half, 0.5, half).setTranslation(0, -0.5, 0).setFriction(arena.ground.friction).setRestitution(0),
    body,
  );
  const colliders = { ground: ground.handle };
  if (!walls) return colliders;
  for (const b of arena.boxes) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz)
        .setTranslation(b.x, b.y, b.z)
        .setRotation(b.pitch ? quatFromYawPitch(b.yaw, b.pitch) : quatFromYaw(b.yaw))
        .setFriction(0.3)
        .setRestitution(0.3),
      body,
    );
  }
  return colliders;
}
```

In `src/shared/constants.ts`, the Stadium's numbers leave `ARENA` (they are in `stadium.json` now; the test helper keeps a copy of the old ones to prove it):

<!-- op {"kind": "edit", "path": "src/shared/constants.ts"} -->
```ts
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
```

with:

```ts
/**
 * What every arena shares, and the Stadium's radius and wall thickness (its bowl, its floodlights and its tyre marks are dressed from them).
 * The walls, obstacles, spawns and ground of each arena are layout data: `src/shared/arenas/<id>.json`.
 */
export const ARENA = {
  /** Distance from the centre to the inner face of the Stadium's wall ring (m). */
  RADIUS: 45,
  WALL_HALF_THICKNESS: 1.0,
  MAX_CARS: 8,
} as const;
```

In `src/client/game/scene.ts`, the Stadium's walls and blocks are drawn from its layout (Task 60 gives the scene an arena of its own):

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
import { obstacleBoxes, wallSegments, type BoxSpec } from '../../shared/arena';
```

with:

```ts
import type { BoxSpec } from '../../shared/arena';
import { DEFAULT_ARENA } from '../../shared/arenas';
```

and:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
  for (const seg of wallSegments()) scene.add(boxMesh(seg, concrete, geometries));
```

with:

```ts
  for (const seg of DEFAULT_ARENA.boxes) if (seg.kind === 'wall') scene.add(boxMesh(seg, concrete, geometries));
```

and:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
  for (const o of obstacleBoxes()) scene.add(boxMesh(o, blocks, geometries));
```

with:

```ts
  for (const o of DEFAULT_ARENA.boxes) if (o.kind !== 'wall') scene.add(boxMesh(o, blocks, geometries));
```

- [ ] **Step 5: Run the tests, then the whole suite, then the hash**

Run: `npx vitest run tests/arenas.test.ts tests/arena.test.ts`
Expected: both files pass

<!-- check {"cmd": "npx vitest run tests/arenas.test.ts tests/arena.test.ts", "outcome": "pass"} -->

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 726} -->

Run: `npm run hash`
Expected: prints `10c3a72a`: the Stadium is the same physics as before

<!-- check {"cmd": "npm run hash", "outcome": "pass", "match": "10c3a72a"} -->

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(shared): arenas as data \u2014 four layout files, ArenaDef with bounds and spawns, a physics world built from a layout, and the Stadium reproduced bit for bit"
```

<!-- commit "feat(shared): arenas as data \u2014 four layout files, ArenaDef with bounds and spawns, a physics world built from a layout, and the Stadium reproduced bit for bit" -->

---

### Task 55: Ground feel, a simulation per arena, and a hash per arena

**Files:**
- Create: `tests/groundFeel.test.ts`
- Modify: `src/shared/vehicle.ts`, `src/shared/sim.ts`, `src/shared/determinism.ts`, `scripts/hash.ts`, `src/client/main.ts`, `tests/determinism.test.ts`

**Interfaces:**
- Consumes: `ArenaDef`, `GroundFeel`, `NEUTRAL_GROUND`, `DEFAULT_ARENA`, `spawnPose(index, count, arena)` (Task 54), `Simulation`, `createCarRig`, `driveCar` (Plan 1).
- Produces: `new Simulation(slots, { arena, walls?, groundHalfExtent? })` and `sim.arena`; `createCarRig(world, slot, pose, ground = NEUTRAL_GROUND)` and `rig.ground`; the ground feel applied: tyre grip multiplies `TIRE.SLIP`, drag adds to the car's linear damping, power multiplies the engine force and the speed it fades out at; `runScripted(ticks, slots, arena)`, `simHash(ticks, slots, arena)`, `npm run hash -- 600 <arena>`, `__derby.simHash(600, '<arena>')`.

- [ ] **Step 1: Write the tests**

Four behaviours, each measured on a flat wall-less ground so a wall never gets in the way: less power gives a lower top speed (between 60 and 90 % of the normal one at power 0.8), drag slows a coasting car, less grip makes the path bend less in a corner (the ice goes straight on; braking is limited by the brake force here, not by grip, so it is the corner that shows it), and **a ground with neutral numbers gives the same states as no arena at all, bit for bit**. The hash of the scripted run is recorded for each arena (these are the tuning of Plans 1-7; Task 61 records the new ones).

Create `tests/groundFeel.test.ts`:

<!-- op {"kind": "create", "path": "tests/groundFeel.test.ts"} -->
```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ARENAS, type ArenaDef, type GroundFeel } from '../src/shared/arenas';
import { CAR_FORWARD } from '../src/shared/constants';
import { quatRotate, vdot } from '../src/shared/math';
import { initPhysics } from '../src/shared/physics';
import { Simulation } from '../src/shared/sim';

const sims: Simulation[] = [];
beforeAll(async () => {
  await initPhysics();
});
afterEach(() => {
  while (sims.length) sims.pop()!.dispose();
});

const withGround = (ground: Partial<GroundFeel>): ArenaDef => ({ ...ARENAS.stadium, ground: { ...ARENAS.stadium.ground, ...ground } });
function make(arena: ArenaDef): Simulation {
  const s = new Simulation([0], { arena, walls: false, groundHalfExtent: 600 });
  sims.push(s);
  return s;
}
const fwd = (s: Simulation): number => {
  const st = s.getState(0);
  return vdot(st.linvel, quatRotate(st.quat, CAR_FORWARD));
};
function launch(s: Simulation, speed: number): void {
  const st = s.getState(0);
  const f = quatRotate(st.quat, CAR_FORWARD);
  s.setState(0, { ...st, linvel: { x: f.x * speed, y: 0, z: f.z * speed } });
}

describe('ground feel', () => {
  it('power scales the engine: a weaker ground tops out lower', () => {
    const top = (arena: ArenaDef): number => {
      const s = make(arena);
      s.setInput(0, { throttle: 1, steer: 0, handbrake: false });
      for (let i = 0; i < 60 * 14; i++) s.step();
      return fwd(s);
    };
    const normal = top(withGround({}));
    const weak = top(withGround({ power: 0.8 }));
    expect(weak).toBeLessThan(normal * 0.9);
    expect(weak).toBeGreaterThan(normal * 0.6);
  });

  it('drag slows a coasting car', () => {
    const coast = (drag: number): number => {
      const s = make(withGround({ drag }));
      for (let i = 0; i < 30; i++) s.step(); // settle on the springs
      launch(s, 16);
      for (let i = 0; i < 180; i++) s.step();
      return fwd(s);
    };
    expect(coast(0.5)).toBeLessThan(coast(0) - 3);
  });

  it('grip sets how sharply a car can turn: on ice the path bends less', () => {
    const turned = (grip: number): number => {
      const s = make(withGround({ grip }));
      for (let i = 0; i < 30; i++) s.step();
      launch(s, 14);
      const v0 = s.getState(0).linvel;
      s.setInput(0, { throttle: 0, steer: 1, handbrake: false });
      for (let i = 0; i < 60; i++) s.step();
      const v1 = s.getState(0).linvel;
      return Math.abs(Math.atan2(v0.x * v1.z - v0.z * v1.x, v0.x * v1.x + v0.z * v1.z)); // how far the direction of travel has swung
    };
    expect(turned(0.4)).toBeLessThan(turned(1) * 0.75);
  });

  it('a neutral ground is the same as no arena at all (bit for bit)', () => {
    const states = (opts?: { arena: ArenaDef }): number[] => {
      const s = new Simulation([0, 1], opts);
      sims.push(s);
      s.setInput(0, { throttle: 1, steer: 0.4, handbrake: false });
      s.setInput(1, { throttle: 1, steer: -0.2, handbrake: true });
      for (let i = 0; i < 300; i++) s.step();
      return s.slots.flatMap((slot) => {
        const st = s.getState(slot);
        return [st.pos.x, st.pos.y, st.pos.z, st.quat.w, st.linvel.x, st.angvel.y];
      });
    };
    expect(states({ arena: withGround({}) })).toEqual(states());
  });

  it('the slippery arena is slippery for every car in it', () => {
    const s = new Simulation([0, 1, 2], { arena: ARENAS.ice, walls: false, groundHalfExtent: 600 });
    sims.push(s);
    expect(s.slots).toEqual([0, 1, 2]);
    for (let i = 0; i < 10; i++) s.step();
    expect(Number.isFinite(s.getState(2).pos.x)).toBe(true);
  });
});
```

In `tests/determinism.test.ts`:

<!-- op {"kind": "edit", "path": "tests/determinism.test.ts"} -->
```ts
import { initPhysics } from '../src/shared/physics';
import { runScripted, scriptedInput, simHash } from '../src/shared/determinism';
```

with:

```ts
import { initPhysics } from '../src/shared/physics';
import { ARENA_IDS, getArena } from '../src/shared/arenas';
import { runScripted, scriptedInput, simHash } from '../src/shared/determinism';
```

In `tests/determinism.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/determinism.test.ts"} -->
```ts
    expect(run.topSpeed).toBeGreaterThan(10);
  });
});

```

with:

```ts
    expect(run.topSpeed).toBeGreaterThan(10);
  });
});

describe('simHash in each arena', () => {
  // Recorded from `npm run hash -- 600 <arena>`; the browser must print the same (`await __derby.simHash(600, '<arena>')`).
  // A change to the physics, the tuning or a layout moves them on purpose or by mistake: say which, and record the new ones.
  const RECORDED = { stadium: '10c3a72a', ice: '349f6dd7', quarry: 'c44738de', port: '4037f0e3' } as const;

  for (const id of ARENA_IDS) {
    it(`prints the recorded hash for ${id}`, () => {
      expect(simHash(600, [0, 1, 2], getArena(id))).toBe(RECORDED[id]);
    });
  }

  it('differs from one arena to the next', () => {
    expect(new Set(ARENA_IDS.map((id) => simHash(300, [0, 1, 2], getArena(id)))).size).toBe(ARENA_IDS.length);
  });

  it('defaults to the Stadium', () => {
    expect(simHash(120)).toBe(simHash(120, [0, 1, 2], getArena('stadium')));
  });
});

```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/groundFeel.test.ts tests/determinism.test.ts`
Expected: FAIL — power, drag and grip change nothing yet, and `simHash` takes no arena

<!-- check {"cmd": "npx vitest run tests/groundFeel.test.ts tests/determinism.test.ts", "outcome": "fail", "match": "FAIL|\u00d7|failed"} -->

- [ ] **Step 3: Apply the ground feel and carry the arena through the simulation**

In `src/shared/vehicle.ts` (with grip, drag and power all 1 or 0 the arithmetic is the same numbers, so the Stadium does not move):

<!-- op {"kind": "edit", "path": "src/shared/vehicle.ts"} -->
```ts
import { NEUTRAL_INPUT, type CarInput } from './input';
import { clamp, lerp, quatRotate, vdot } from './math';
```

with:

```ts
import { NEUTRAL_INPUT, type CarInput } from './input';
import { NEUTRAL_GROUND, type GroundFeel } from './arenas';
import { clamp, lerp, quatRotate, vdot } from './math';
```

In `src/shared/vehicle.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/vehicle.ts"} -->
```ts
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  input: CarInput;
```

with:

```ts
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  /** How the arena's ground treats this car: tyre grip, extra drag, engine power. */
  readonly ground: GroundFeel;
  input: CarInput;
```

In `src/shared/vehicle.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/vehicle.ts"} -->
```ts

export function createCarRig(world: RAPIER.World, slot: number, pose: { pos: Vec3; quat: Quat }): CarRig {
  const body = world.createRigidBody(
```

with:

```ts

export function createCarRig(world: RAPIER.World, slot: number, pose: { pos: Vec3; quat: Quat }, ground: GroundFeel = NEUTRAL_GROUND): CarRig {
  const body = world.createRigidBody(
```

In `src/shared/vehicle.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/vehicle.ts"} -->
```ts
      .setCcdEnabled(true)
      .setLinearDamping(CAR.LINEAR_DAMPING)
      .setAngularDamping(CAR.ANGULAR_DAMPING),
```

with:

```ts
      .setCcdEnabled(true)
      .setLinearDamping(CAR.LINEAR_DAMPING + ground.drag)
      .setAngularDamping(CAR.ANGULAR_DAMPING),
```

In `src/shared/vehicle.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/vehicle.ts"} -->
```ts
    controller.setWheelMaxSuspensionForce(i, SUSPENSION.MAX_FORCE);
    controller.setWheelFrictionSlip(i, TIRE.SLIP);
    controller.setWheelSideFrictionStiffness(i, TIRE.SIDE_STIFFNESS);
```

with:

```ts
    controller.setWheelMaxSuspensionForce(i, SUSPENSION.MAX_FORCE);
    controller.setWheelFrictionSlip(i, TIRE.SLIP * ground.grip);
    controller.setWheelSideFrictionStiffness(i, TIRE.SIDE_STIFFNESS);
```

In `src/shared/vehicle.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/vehicle.ts"} -->
```ts
  }
  return { slot, body, collider, controller, input: { ...NEUTRAL_INPUT } };
}
```

with:

```ts
  }
  return { slot, body, collider, controller, ground, input: { ...NEUTRAL_INPUT } };
}
```

In `src/shared/vehicle.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/vehicle.ts"} -->
```ts
  const { controller: c, body, input } = rig;
  const vf = forwardSpeed(body);
```

with:

```ts
  const { controller: c, body, input } = rig;
  const { grip, power } = rig.ground;
  const topSpeed = DRIVE.MAX_SPEED * power;
  const vf = forwardSpeed(body);
```

In `src/shared/vehicle.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/vehicle.ts"} -->
```ts
    if (vf < -1) brake = DRIVE.BRAKE * t; // moving backwards: brake first
    else engine = t * DRIVE.ENGINE * clamp(1 - vf / DRIVE.MAX_SPEED, 0, 1);
  } else if (t < 0) {
```

with:

```ts
    if (vf < -1) brake = DRIVE.BRAKE * t; // moving backwards: brake first
    else engine = t * DRIVE.ENGINE * power * clamp(1 - vf / topSpeed, 0, 1);
  } else if (t < 0) {
```

In `src/shared/vehicle.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/vehicle.ts"} -->
```ts
    if (vf > 1) brake = DRIVE.BRAKE * -t; // moving forwards: brake first, reverse once stopped
    else engine = t * DRIVE.ENGINE * DRIVE.REVERSE_SCALE * clamp(1 + vf / (DRIVE.MAX_SPEED * 0.4), 0, 1);
  }
```

with:

```ts
    if (vf > 1) brake = DRIVE.BRAKE * -t; // moving forwards: brake first, reverse once stopped
    else engine = t * DRIVE.ENGINE * power * DRIVE.REVERSE_SCALE * clamp(1 + vf / (topSpeed * 0.4), 0, 1);
  }
```

In `src/shared/vehicle.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/vehicle.ts"} -->
```ts
    c.setWheelEngineForce(i, 0);
    c.setWheelFrictionSlip(i, TIRE.SLIP);
  }
```

with:

```ts
    c.setWheelEngineForce(i, 0);
    c.setWheelFrictionSlip(i, TIRE.SLIP * grip);
  }
```

In `src/shared/vehicle.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/vehicle.ts"} -->
```ts
    c.setWheelBrake(i, brake + (input.handbrake ? DRIVE.HANDBRAKE : 0));
    c.setWheelFrictionSlip(i, input.handbrake ? TIRE.SLIP * TIRE.HANDBRAKE_SLIP_SCALE : TIRE.SLIP);
  }
```

with:

```ts
    c.setWheelBrake(i, brake + (input.handbrake ? DRIVE.HANDBRAKE : 0));
    c.setWheelFrictionSlip(i, input.handbrake ? TIRE.SLIP * grip * TIRE.HANDBRAKE_SLIP_SCALE : TIRE.SLIP * grip);
  }
```

In `src/shared/sim.ts`:

<!-- op {"kind": "edit", "path": "src/shared/sim.ts"} -->
```ts
import { buildArena, spawnPose, type ArenaOptions } from './arena';
import { quantizeInput, type CarInput } from './input';
```

with:

```ts
import { buildArena, spawnPose, type ArenaOptions } from './arena';
import { DEFAULT_ARENA, type ArenaDef } from './arenas';
import { quantizeInput, type CarInput } from './input';
```

In `src/shared/sim.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/sim.ts"} -->
```ts
  readonly slots: readonly number[];
  /** Number of completed steps. */
```

with:

```ts
  readonly slots: readonly number[];
  /** The arena this world was built from. */
  readonly arena: ArenaDef;
  /** Number of completed steps. */
```

In `src/shared/sim.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/sim.ts"} -->
```ts
    this.slots = unique;
    this.world = new RAPIER.World({ x: 0, y: -PHYSICS.GRAVITY, z: 0 });
```

with:

```ts
    this.slots = unique;
    this.arena = options.arena ?? DEFAULT_ARENA;
    this.world = new RAPIER.World({ x: 0, y: -PHYSICS.GRAVITY, z: 0 });
```

In `src/shared/sim.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/sim.ts"} -->
```ts
    this.world.timestep = PHYSICS.DT;
    this.groundHandle = buildArena(this.world, options).ground;
    unique.forEach((slot, index) => {
```

with:

```ts
    this.world.timestep = PHYSICS.DT;
    this.groundHandle = buildArena(this.world, { ...options, arena: this.arena }).ground;
    unique.forEach((slot, index) => {
```

In `src/shared/sim.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/sim.ts"} -->
```ts
    unique.forEach((slot, index) => {
      const rig = createCarRig(this.world, slot, spawnPose(index, unique.length));
      this.rigs.set(slot, rig);
```

with:

```ts
    unique.forEach((slot, index) => {
      const rig = createCarRig(this.world, slot, spawnPose(index, unique.length, this.arena), this.arena.ground);
      this.rigs.set(slot, rig);
```

In `src/shared/determinism.ts`:

<!-- op {"kind": "edit", "path": "src/shared/determinism.ts"} -->
```ts
import type { CarInput } from './input';
```

with:

```ts
import { DEFAULT_ARENA, type ArenaDef } from './arenas';
import type { CarInput } from './input';
```

In `src/shared/determinism.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/determinism.ts"} -->
```ts
/** Runs the script for `ticks` steps (Rapier must be initialised) and hashes every car's full state each tick. */
export function runScripted(ticks = 600, slots: readonly number[] = [0, 1, 2]): ScriptedRun {
  const sim = new Simulation(slots);
  let h = 0x811c9dc5;
```

with:

```ts
/** Runs the script for `ticks` steps (Rapier must be initialised) and hashes every car's full state each tick. */
export function runScripted(ticks = 600, slots: readonly number[] = [0, 1, 2], arena: ArenaDef = DEFAULT_ARENA): ScriptedRun {
  const sim = new Simulation(slots, { arena });
  let h = 0x811c9dc5;
```

In `src/shared/determinism.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/determinism.ts"} -->
```ts

export const simHash = (ticks = 600, slots: readonly number[] = [0, 1, 2]): string => runScripted(ticks, slots).hash;

```

with:

```ts

export const simHash = (ticks = 600, slots: readonly number[] = [0, 1, 2], arena: ArenaDef = DEFAULT_ARENA): string => runScripted(ticks, slots, arena).hash;

```

Replace `scripts/hash.ts` with: `scripts/hash.ts` takes an optional arena:

<!-- op {"kind": "replace", "path": "scripts/hash.ts"} -->
```ts
// Prints the hash of the scripted determinism run. Compare with the browser: `await __derby.simHash()` on any page.
//   npx tsx scripts/hash.ts [ticks] [arena]      arena: stadium (default), ice, quarry or port
import { getArena, isArenaId } from '../src/shared/arenas';
import { runScripted } from '../src/shared/determinism';
import { initPhysics } from '../src/shared/physics';

await initPhysics();
const ticks = Number(process.argv[2] ?? 600);
const id = process.argv[3] ?? 'stadium';
if (!isArenaId(id)) {
  console.error(`unknown arena "${id}" (stadium, ice, quarry or port)`);
  process.exit(1);
}
const run = runScripted(Number.isFinite(ticks) && ticks > 0 ? Math.floor(ticks) : 600, [0, 1, 2], getArena(id));
console.log(run.hash);
console.error(`arena=${id} ticks=${ticks} closestApproach=${run.closestApproach.toFixed(2)} m topSpeed=${run.topSpeed.toFixed(1)} m/s`);
```

In `src/client/main.ts`, the browser side of the hash check:

<!-- op {"kind": "edit", "path": "src/client/main.ts"} -->
```ts
import { initPhysics } from '../shared/physics';
import { simHash } from '../shared/determinism';
```

with:

```ts
import { initPhysics } from '../shared/physics';
import { getArena, isArenaId } from '../shared/arenas';
import { simHash } from '../shared/determinism';
```

In `src/client/main.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/main.ts"} -->
```ts
Object.assign((window as unknown as { __derby?: object }).__derby ?? ((window as unknown as { __derby: object }).__derby = {}), {
  simHash: async (ticks = 600): Promise<string> => {
    await initPhysics();
```

with:

```ts
Object.assign((window as unknown as { __derby?: object }).__derby ?? ((window as unknown as { __derby: object }).__derby = {}), {
  simHash: async (ticks = 600, arena: string = 'stadium'): Promise<string> => {
    await initPhysics();
```

In `src/client/main.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/main.ts"} -->
```ts
    await initPhysics();
    return simHash(ticks);
  },
```

with:

```ts
    await initPhysics();
    if (!isArenaId(arena)) throw new Error(`unknown arena "${arena}"`);
    return simHash(ticks, [0, 1, 2], getArena(arena));
  },
```

- [ ] **Step 4: Run the tests, then the whole suite, then the hashes**

Run: `npx vitest run tests/groundFeel.test.ts tests/determinism.test.ts`
Expected: both pass

<!-- check {"cmd": "npx vitest run tests/groundFeel.test.ts tests/determinism.test.ts", "outcome": "pass"} -->

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 737} -->

Run: `npm run hash`
Expected: prints `10c3a72a` again

<!-- check {"cmd": "npm run hash", "outcome": "pass", "match": "10c3a72a"} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(shared): the ground of an arena changes grip, drag and engine power; a simulation and a determinism hash per arena"
```

<!-- commit "feat(shared): the ground of an arena changes grip, drag and engine power; a simulation and a determinism hash per arena" -->

---

### Task 56: The rules, the round and the bots play by the walls of their arena

**Files:**
- Modify: `src/server/rules.ts`, `src/server/round.ts`, `src/server/bots.ts`, `src/server/room.ts`, `tests/rules.test.ts`, `tests/bots.test.ts`, `tests/server/roundCombat.test.ts`

**Interfaces:**
- Consumes: `outOfBounds`, `boundsClearance`, `DEFAULT_ARENA`, `ArenaDef`, `Simulation.arena`, `spawnPose(index, count, arena)` (Tasks 54-55), `CarWatch`, `RoundState`, `BotBrain`, `Room` (Plan 4).
- Produces: `new CarWatch(arena = DEFAULT_ARENA)`, `new RoundState(slots, arena = DEFAULT_ARENA)`, `new BotBrain(seed, skill?, arena = DEFAULT_ARENA)`; a car is out of bounds when it is further than `COMBAT.BOUNDS_MARGIN` outside the arena's bounds (a circle, or a polygon); a bot turns away when the edge is closer than 4 m at its place or at its look-ahead point; a broken car is put back at its arena's own spawn; the `Room` keeps an `arena` for its round (the Stadium until Task 57).

- [ ] **Step 1: Write the tests**

A rectangle is not a circle: the Container Port's corner (40, 30) is 50 m from the middle, outside the Stadium's radius, yet inside the yard, so it must not be a fault; 2.1 m beyond its wall must be. The lake is wider than the Stadium and its limit is its own. A bot at (-20, 23) facing the Port's wall 10 m ahead must turn away, while the same place in the Stadium has plenty of room; and a car whose body went to NaN is put back at the first spawn of the arena it is in, not on the Stadium's ring.

In `tests/rules.test.ts`:

<!-- op {"kind": "edit", "path": "tests/rules.test.ts"} -->
```ts
import { CarWatch } from '../src/server/rules';

```

with:

```ts
import { CarWatch } from '../src/server/rules';
import { ARENAS } from '../src/shared/arenas';

```

In `tests/rules.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/rules.test.ts"} -->
```ts

  it('eliminates a car whose state is not a number, so a broken body cannot linger in the round', () => {
```

with:

```ts

  it('judges a car against the walls of its own arena: a rectangle is not a circle', () => {
    // the Container Port is a rectangle (+-45 by +-33): a corner is further from the middle than the Stadium's whole radius
    const w = new CarWatch(ARENAS.port);
    expect(w.update(rolling({ pos: { x: 40, y: 1, z: 30 } }), true).fault).toBeNull();
    expect(w.update(rolling({ pos: { x: 0, y: 1, z: 33 + COMBAT.BOUNDS_MARGIN + 0.1 } }), true).fault).toBe('bounds');
    expect(new CarWatch(ARENAS.port).update(rolling({ pos: { x: 45 + COMBAT.BOUNDS_MARGIN + 0.1, y: 1, z: 0 } }), true).fault).toBe('bounds');
    expect(new CarWatch(ARENAS.ice).update(rolling({ pos: { x: 50, y: 1, z: 0 } }), true).fault).toBeNull(); // the lake is wider than the Stadium
    expect(new CarWatch(ARENAS.ice).update(rolling({ pos: { x: 52 + COMBAT.BOUNDS_MARGIN + 0.1, y: 1, z: 0 } }), true).fault).toBe('bounds');
  });

  it('eliminates a car whose state is not a number, so a broken body cannot linger in the round', () => {
```

In `tests/bots.test.ts`:

<!-- op {"kind": "edit", "path": "tests/bots.test.ts"} -->
```ts
import type { CarState } from '../src/shared/types';
import { BOT_COLORS, BOT_NAMES, BotBrain, type BotTarget, type BotView } from '../src/server/bots';
```

with:

```ts
import type { CarState } from '../src/shared/types';
import { ARENAS } from '../src/shared/arenas';
import { BOT_COLORS, BOT_NAMES, BotBrain, type BotTarget, type BotView } from '../src/server/bots';
```

In `tests/bots.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/bots.test.ts"} -->
```ts
    expect(out.throttle).toBeLessThanOrEqual(0.7);
  });
```

with:

```ts
    expect(out.throttle).toBeLessThanOrEqual(0.7);
  });

  it('keeps off the wall of a rectangular arena, where the middle is nearer than the circle says', () => {
    // the Container Port's wall is at z = 33: this spot is 30 m from the middle, well inside the Stadium's circle, and 11 m ahead is the wall
    const nearWall = state(-20, 23, -Math.PI / 2, 10); // facing +Z, towards it
    const view = { state: nearWall, targets: [target(1, -20, 60)] };
    const port = new BotBrain(1, 1, ARENAS.port).think(view);
    expect(Math.abs(port.steer)).toBeGreaterThan(0.6);
    expect(port.throttle).toBeLessThanOrEqual(0.7);
    const stadium = new BotBrain(1, 1).think(view);
    expect(Math.abs(stadium.steer)).toBeLessThan(0.3); // with the circle's numbers there is still room
  });
```

In `tests/server/roundCombat.test.ts`:

<!-- op {"kind": "edit", "path": "tests/server/roundCombat.test.ts"} -->
```ts
import type { HitMessage, KoMessage } from '../../src/shared/protocol';
import { Simulation } from '../../src/shared/sim';
```

with:

```ts
import type { HitMessage, KoMessage } from '../../src/shared/protocol';
import { ARENAS } from '../../src/shared/arenas';
import { Simulation } from '../../src/shared/sim';
```

In `tests/server/roundCombat.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/roundCombat.test.ts"} -->
```ts

  it('also replaces a wreck whose body goes to NaN later', () => {
```

with:

```ts

  it('plays by the arena it is given: bounds and the place a broken car is put back', () => {
    const sim = new Simulation([0, 1], { arena: ARENAS.port });
    sims.push(sim);
    sim.setState(0, still(-20, 0));
    sim.setState(1, still(20, 0, Math.PI, 3));
    const state = new RoundState([0, 1], ARENAS.port);
    sim.setState(0, { ...still(0, 0), pos: { x: Number.NaN, y: 1.07, z: 0 } });
    sim.step();
    const events = state.step(sim.tick, sim);
    expect(events.kos).toMatchObject([{ victim: 0, reason: 'bounds' }]);
    const back = sim.getState(0).pos;
    expect(back).toMatchObject({ x: -12, z: -26 }); // the port's first spawn, not a point of the Stadium's ring
    sim.setState(1, still(20, 36.5, 0, 0));
    sim.step();
    expect(state.step(sim.tick, sim).kos).toMatchObject([{ victim: 1, reason: 'bounds' }]); // 3.5 m beyond the yard's wall
  });

  it('also replaces a wreck whose body goes to NaN later', () => {
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/rules.test.ts tests/bots.test.ts tests/server/roundCombat.test.ts`
Expected: FAIL — the three new tests: the rules and the bots still think every arena is a circle of 45 m

<!-- check {"cmd": "npx vitest run tests/rules.test.ts tests/bots.test.ts tests/server/roundCombat.test.ts", "outcome": "fail", "match": "FAIL|\u00d7|failed"} -->

- [ ] **Step 3: Pass the arena down**

In `src/server/rules.ts`:

<!-- op {"kind": "edit", "path": "src/server/rules.ts"} -->
```ts
import { ARENA, COMBAT } from '../shared/constants';
import { quatRotate } from '../shared/math';
```

with:

```ts
import { DEFAULT_ARENA, outOfBounds, type ArenaDef } from '../shared/arenas';
import { COMBAT } from '../shared/constants';
import { quatRotate } from '../shared/math';
```

In `src/server/rules.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/rules.ts"} -->
```ts

  /** `inHit` is true on ticks where a hit closed for this car, as victim or as attacker. */
```

with:

```ts

  /** `arena` says where the walls are; the Stadium by default. */
  constructor(private readonly arena: ArenaDef = DEFAULT_ARENA) {}

  /** `inHit` is true on ticks where a hit closed for this car, as victim or as attacker. */
```

In `src/server/rules.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/rules.ts"} -->
```ts
    if (!isFiniteState(state)) return { fault: 'bounds', drain: 0 }; // a broken body must not stay in the round
    if (Math.hypot(pos.x, pos.z) > ARENA.RADIUS + COMBAT.BOUNDS_MARGIN || pos.y < COMBAT.BOUNDS_MIN_Y) {
      return { fault: 'bounds', drain: 0 };
```

with:

```ts
    if (!isFiniteState(state)) return { fault: 'bounds', drain: 0 }; // a broken body must not stay in the round
    if (outOfBounds(this.arena.bounds, pos.x, pos.z, COMBAT.BOUNDS_MARGIN) || pos.y < COMBAT.BOUNDS_MIN_Y) {
      return { fault: 'bounds', drain: 0 };
```

In `src/server/round.ts`:

<!-- op {"kind": "edit", "path": "src/server/round.ts"} -->
```ts
import { spawnPose } from '../shared/arena';
import { COMBAT } from '../shared/constants';
```

with:

```ts
import { spawnPose } from '../shared/arena';
import { DEFAULT_ARENA, type ArenaDef } from '../shared/arenas';
import { COMBAT } from '../shared/constants';
```

In `src/server/round.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/round.ts"} -->
```ts
function spawnState(sim: Simulation, slot: number): CarState {
  const pose = spawnPose(sim.slots.indexOf(slot), sim.slots.length);
  return { pos: pose.pos, quat: pose.quat, linvel: ZERO, angvel: ZERO };
```

with:

```ts
function spawnState(sim: Simulation, slot: number): CarState {
  const pose = spawnPose(sim.slots.indexOf(slot), sim.slots.length, sim.arena);
  return { pos: pose.pos, quat: pose.quat, linvel: ZERO, angvel: ZERO };
```

In `src/server/round.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/round.ts"} -->
```ts

  constructor(slots: readonly number[]) {
    for (const slot of slots) {
```

with:

```ts

  constructor(slots: readonly number[], arena: ArenaDef = DEFAULT_ARENA) {
    for (const slot of slots) {
```

In `src/server/round.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/round.ts"} -->
```ts
      this.status.set(slot, { slot, hp: COMBAT.MAX_HP, alive: true, kills: 0, damage: 0, gained: 0 });
      this.watches.set(slot, new CarWatch());
    }
```

with:

```ts
      this.status.set(slot, { slot, hp: COMBAT.MAX_HP, alive: true, kills: 0, damage: 0, gained: 0 });
      this.watches.set(slot, new CarWatch(arena));
    }
```

In `src/server/bots.ts` (the wall test is the distance to the edge of the playable area, at the bot's place and at a point ahead of it):

<!-- op {"kind": "edit", "path": "src/server/bots.ts"} -->
```ts
import { ARENA, CAR_FORWARD, COMBAT } from '../shared/constants';
import { NEUTRAL_INPUT, type CarInput } from '../shared/input';
```

with:

```ts
import { boundsClearance, DEFAULT_ARENA, type ArenaDef } from '../shared/arenas';
import { CAR_FORWARD, COMBAT } from '../shared/constants';
import { NEUTRAL_INPUT, type CarInput } from '../shared/input';
```

In `src/server/bots.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/bots.ts"} -->
```ts
const WOBBLE_TICKS = 20;
const UP: { x: number; y: number; z: number } = { x: 0, y: 1, z: 0 };
```

with:

```ts
const WOBBLE_TICKS = 20;
/** A bot turns away when the playable area's edge is closer than this (m), at its own place or at the look-ahead point. */
const WALL_MARGIN = 4;
const UP: { x: number; y: number; z: number } = { x: 0, y: 1, z: 0 };
```

In `src/server/bots.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/bots.ts"} -->
```ts

  constructor(seed: number, skill?: number) {
    this.random = mulberry32(seed);
```

with:

```ts

  /** `arena` tells the bot where its walls are (the Stadium's by default). */
  constructor(seed: number, skill?: number, private readonly arena: ArenaDef = DEFAULT_ARENA) {
    this.random = mulberry32(seed);
```

In `src/server/bots.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/bots.ts"} -->
```ts
    // keep off the wall: when the road ahead runs out, turn toward the middle and ease off
    const radius = Math.hypot(pos.x, pos.z);
    const look = 5 + Math.max(0, speed) * 0.6;
```

with:

```ts
    // keep off the wall: when the road ahead runs out, turn toward the middle and ease off
    const look = 5 + Math.max(0, speed) * 0.6;
```

In `src/server/bots.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/bots.ts"} -->
```ts
    const look = 5 + Math.max(0, speed) * 0.6;
    const limit = ARENA.RADIUS - 4;
    if (radius > limit || Math.hypot(pos.x + f.x * look, pos.z + f.z * look) > limit) {
      const side = { x: -f.z, z: f.x };
```

with:

```ts
    const look = 5 + Math.max(0, speed) * 0.6;
    const margin = WALL_MARGIN;
    const here = boundsClearance(this.arena.bounds, pos.x, pos.z);
    if (here < margin || boundsClearance(this.arena.bounds, pos.x + f.x * look, pos.z + f.z * look) < margin) {
      const side = { x: -f.z, z: f.x };
```

In `src/server/bots.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/bots.ts"} -->
```ts
      steer = clamp(toCentre * 2, -1, 1);
      throttle = Math.min(throttle || 0.5, radius > limit + 2 ? 0.5 : 0.7);
    }
```

with:

```ts
      steer = clamp(toCentre * 2, -1, 1);
      throttle = Math.min(throttle || 0.5, here < margin - 2 ? 0.5 : 0.7);
    }
```

In `src/server/room.ts`, the room keeps the arena of its round and builds the world, the round and the bots' brains with it:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
import { ARENA, NET, PHYSICS, ROUND } from '../shared/constants';
```

with:

```ts
import { DEFAULT_ARENA, type ArenaDef } from '../shared/arenas';
import { ARENA, NET, PHYSICS, ROUND } from '../shared/constants';
```

and:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
  private sim: Simulation | null = null;
```

with:

```ts
  /** The arena of the running (or coming) round. */
  private arena: ArenaDef = DEFAULT_ARENA;
  private sim: Simulation | null = null;
```

and:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
new BotBrain((this.seed + this.round * 7919 + i * 104_729) >>> 0)
```

with:

```ts
new BotBrain((this.seed + this.round * 7919 + i * 104_729) >>> 0, undefined, this.arena)
```

and:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
    this.sim = new Simulation(slots);
    this.state = new RoundState(slots);
```

with:

```ts
    this.sim = new Simulation(slots, { arena: this.arena });
    this.state = new RoundState(slots, this.arena);
```

- [ ] **Step 4: Run the tests, then the whole suite**

Run: `npx vitest run tests/rules.test.ts tests/bots.test.ts tests/server/roundCombat.test.ts`
Expected: all pass

<!-- check {"cmd": "npx vitest run tests/rules.test.ts tests/bots.test.ts tests/server/roundCombat.test.ts", "outcome": "pass"} -->

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 740} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): out of bounds, bot wall avoidance and broken-car spawns follow the arena's own bounds"
```

<!-- commit "feat(server): out of bounds, bot wall avoidance and broken-car spawns follow the arena's own bounds" -->

---

### Task 57: The vote: protocol 4, the room's results phase as a ballot

**Files:**
- Create: `src/server/vote.ts`, `tests/server/vote.test.ts`, `tests/server/roomVote.test.ts`, `tests/helpers/arenaSeed.ts`
- Modify: `src/shared/protocol.ts`, `src/shared/constants.ts`, `src/server/room.ts`, `src/server/app.ts`, `tests/protocol.test.ts`, `tests/server/room.test.ts`, `tests/scripts/bot.test.ts`, `tests/client/connection.test.ts`, `tests/client/matchState.test.ts`, `tests/helpers/loopback.ts`

**Interfaces:**
- Consumes: `ArenaId`, `ARENA_IDS`, `isArenaId`, `getArena` (Task 54), `Room.arena` (Task 56), `mulberry32` (Plan 1), the message parsers (Plans 2-4).
- Produces: `tally(votes)`, `chooseArena(counts, random)` (`src/server/vote.ts`); `VoteMessage` (`{ t: 'vote', arena }`, client to server), `VotesMessage` (`{ t: 'votes', counts }`), `VoteCounts`; `arena` in `welcome` and `roster`, `votes` in `welcome`; `Room.vote(player, arena)`, `Room.greeting(player)` with `arena` and `votes`; `NET.PROTOCOL_VERSION` 4; `ROUND.RESULTS_TICKS` 12 s; `seedForArena(id)` (a room seed whose first round is in `id`, for tests).

- [ ] **Step 1: Write the tests**

The wire first: `parseClientMessage` accepts a vote for each of the four arenas and nothing else (not `""`, `"Ice"`, `"__proto__"`, a number, an array or a missing field); `parseServerMessage` requires an arena in the roster and the welcome and a tally of exactly four non-negative whole numbers no larger than the seats in a room. Then the rules of the ballot, with the room under test: counting during the results for anyone in the room (a newcomer without a car too), a vote that can be changed, ignored outside the results and from someone who has left, a leaver's vote going with them, the arena with the most votes played next, **a tie settled by the room's seed (both leaders can win, the others never, and the same seed always decides the same way)**, nobody voting giving one of the four, the votes forgotten once the round has started, the arena kept when a countdown starts over for a newcomer, and every results phase opening with an empty tally. The first round of a room is drawn from its seed. Existing fixtures learn the new fields, and the loopback test helper is given a room seed that plays in the Stadium (the tuning tests were written there).

Create `tests/server/vote.test.ts`:

<!-- op {"kind": "create", "path": "tests/server/vote.test.ts"} -->
```ts
import { describe, expect, it } from 'vitest';
import { ARENA_IDS } from '../../src/shared/arenas';
import { mulberry32 } from '../../src/shared/random';
import { chooseArena, tally } from '../../src/server/vote';

const none = { stadium: 0, ice: 0, quarry: 0, port: 0 };

describe('tally', () => {
  it('counts votes per arena, with zero for the arenas nobody chose', () => {
    expect(tally(['ice', 'port', 'ice'])).toEqual({ stadium: 0, ice: 2, quarry: 0, port: 1 });
    expect(tally([])).toEqual(none);
  });
});

describe('chooseArena', () => {
  it('picks the arena with the most votes', () => {
    expect(chooseArena({ ...none, quarry: 3, ice: 2 }, mulberry32(1))).toBe('quarry');
    expect(chooseArena({ ...none, port: 1 }, mulberry32(99))).toBe('port'); // one vote is enough
  });

  it('breaks a tie between the leaders only, by the seeded random', () => {
    const counts = { ...none, ice: 2, port: 2, stadium: 1 };
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) seen.add(chooseArena(counts, mulberry32(seed)));
    expect([...seen].sort()).toEqual(['ice', 'port']); // both can win, the others never
    expect(chooseArena(counts, mulberry32(5))).toBe(chooseArena(counts, mulberry32(5))); // and a seed decides it the same way each time
  });

  it('picks any arena when nobody voted, each one now and then', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 80; seed++) seen.add(chooseArena(none, mulberry32(seed)));
    expect([...seen].sort()).toEqual([...ARENA_IDS].sort());
  });
});
```

Create `tests/server/roomVote.test.ts`:

<!-- op {"kind": "create", "path": "tests/server/roomVote.test.ts"} -->
```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../../src/shared/physics';
import { disposeRooms, join, makeRoom, messages, steps } from '../helpers/roomKit';

beforeAll(async () => {
  await initPhysics();
});
afterEach(disposeRooms);

/** Two players, the second leaves, the round ends at once: the room is in its results phase with Ann in it. */
function inResults(options: Parameters<typeof makeRoom>[0] = {}) {
  const { room } = makeRoom({ rules: { resultsTicks: 120 }, ...options });
  const ann = join(room, 'Ann');
  const bob = join(room, 'Bob');
  steps(room, 20);
  room.removePlayer(bob.player);
  steps(room, 2);
  expect(room.phase).toBe('results');
  return { room, ann, bob };
}
const lastVotes = (s: Parameters<typeof messages>[0]) => messages(s, 'votes').at(-1);
const counts = (ids: Partial<Record<'stadium' | 'ice' | 'quarry' | 'port', number>>) => ({ stadium: 0, ice: 0, quarry: 0, port: 0, ...ids });

describe('Room arena', () => {
  it('names the arena of every round in the roster and the welcome', () => {
    const { room } = makeRoom();
    const ann = join(room, 'Ann');
    room.step();
    const roster = messages(ann.socket, 'roster').at(-1)!;
    expect(['stadium', 'ice', 'quarry', 'port']).toContain(roster.arena);
    expect(room.greeting(ann.player).arena).toBe(roster.arena);
    expect(room.greeting(ann.player).votes).toEqual(counts({}));
  });

  it('plays the first round in an arena chosen by the room seed, and another seed can choose another', () => {
    const first = (seed: number): unknown => {
      const { room } = makeRoom({ seed });
      const p = join(room, 'Ann');
      room.step();
      return messages(p.socket, 'roster').at(-1)!.arena;
    };
    const seen = new Set<unknown>();
    for (let seed = 1; seed <= 40; seed++) seen.add(first(seed));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('Room vote', () => {
  it('counts votes cast during the results and tells everyone', () => {
    const { room, ann } = inResults();
    const cy = join(room, 'Cy'); // a newcomer may vote too
    room.vote(ann.player, 'ice');
    room.vote(cy.player, 'quarry');
    steps(room, 20); // the tally goes out within a quarter of a second
    expect(lastVotes(ann.socket)).toMatchObject({ counts: counts({ ice: 1, quarry: 1 }) });
    expect(lastVotes(cy.socket)).toMatchObject({ counts: counts({ ice: 1, quarry: 1 }) });
  });

  it('lets a vote change, counting only the last one', () => {
    const { room, ann } = inResults();
    room.vote(ann.player, 'ice');
    room.vote(ann.player, 'port');
    steps(room, 20);
    expect(lastVotes(ann.socket)).toMatchObject({ counts: counts({ port: 1 }) });
  });

  it('ignores a vote outside the results phase', () => {
    const { room } = makeRoom();
    const ann = join(room, 'Ann');
    steps(room, 5); // countdown
    room.vote(ann.player, 'ice');
    steps(room, 20);
    expect(messages(ann.socket, 'votes')).toEqual([]);
    expect(room.greeting(ann.player).votes).toEqual(counts({}));
  });

  it('ignores a vote from someone who is not in the room', () => {
    const { room, bob } = inResults();
    room.vote(bob.player, 'ice'); // Bob left
    steps(room, 20);
    expect(lastVotes(join(room, 'Cy').socket)).toBeUndefined();
    expect(room.greeting(room.seated()[0]!).votes).toEqual(counts({}));
  });

  it('drops the vote of a player who leaves', () => {
    const { room, ann } = inResults();
    const cy = join(room, 'Cy');
    room.vote(cy.player, 'ice');
    steps(room, 20);
    expect(lastVotes(ann.socket)).toMatchObject({ counts: counts({ ice: 1 }) });
    room.removePlayer(cy.player);
    steps(room, 20);
    expect(lastVotes(ann.socket)).toMatchObject({ counts: counts({}) });
  });

  it('starts the next round in the arena with the most votes', () => {
    for (const choice of ['ice', 'quarry', 'port', 'stadium'] as const) {
      const { room, ann } = inResults();
      const cy = join(room, 'Cy');
      room.vote(ann.player, choice);
      room.vote(cy.player, choice);
      steps(room, 130);
      expect(room.round).toBe(2);
      expect(messages(ann.socket, 'roster').at(-1)).toMatchObject({ round: 2, arena: choice });
      disposeRooms();
    }
  });

  it('breaks a tie with the room seed, and does the same thing again for the same seed', () => {
    const outcome = (seed: number): unknown => {
      const { room, ann } = inResults({ seed });
      const cy = join(room, 'Cy');
      room.vote(ann.player, 'ice');
      room.vote(cy.player, 'port');
      steps(room, 130);
      return messages(ann.socket, 'roster').at(-1)!.arena;
    };
    const seen = new Set<unknown>();
    for (let seed = 1; seed <= 30; seed++) {
      const a = outcome(seed);
      expect(['ice', 'port']).toContain(a);
      expect(outcome(seed)).toBe(a);
      seen.add(a);
    }
    expect(seen.size).toBe(2);
  });

  it('forgets the votes once the round they chose has started', () => {
    const { room, ann } = inResults();
    room.vote(ann.player, 'ice');
    steps(room, 130);
    expect(messages(ann.socket, 'roster').at(-1)).toMatchObject({ round: 2, arena: 'ice' });
    expect(room.greeting(ann.player).votes).toEqual(counts({}));
  });

  it('picks one of the four when nobody voted', () => {
    const { room, ann } = inResults();
    steps(room, 130);
    expect(['stadium', 'ice', 'quarry', 'port']).toContain(messages(ann.socket, 'roster').at(-1)!.arena);
  });

  it('keeps the same arena when a countdown starts over for a newcomer', () => {
    const { room, ann } = inResults();
    room.vote(ann.player, 'quarry');
    steps(room, 130);
    const arena = messages(ann.socket, 'roster').at(-1)!.arena;
    expect(arena).toBe('quarry');
    join(room, 'Dee'); // restarts the countdown
    steps(room, 3);
    expect(messages(ann.socket, 'roster').at(-1)).toMatchObject({ arena: 'quarry' });
  });

  it('opens each results phase with an empty tally', () => {
    const { room, ann } = inResults();
    expect(lastVotes(ann.socket)).toMatchObject({ counts: counts({}) });
  });
});
```

Create `tests/helpers/arenaSeed.ts`:

<!-- op {"kind": "create", "path": "tests/helpers/arenaSeed.ts"} -->
```ts
import type { ArenaId } from '../../src/shared/arenas';
import { Player } from '../../src/server/player';
import { Room } from '../../src/server/room';
import { FakeSocket } from './fakeSocket';

const found = new Map<ArenaId, number>();

/** A room seed whose first round is played in `id` (a room draws its first arena from its seed). Needs Rapier initialised. */
export function seedForArena(id: ArenaId): number {
  const known = found.get(id);
  if (known !== undefined) return known;
  for (let seed = 1; seed < 500; seed++) {
    const room = new Room('SEED', true, () => undefined, { botFill: 0, seed });
    const player = new Player(1, new FakeSocket());
    room.addPlayer(player);
    room.step();
    const arena = room.greeting(player).arena;
    room.dispose();
    if (arena === id) {
      found.set(id, seed);
      return seed;
    }
  }
  throw new Error(`no room seed starts in ${id}`);
}
```

In `tests/protocol.test.ts`:

<!-- op {"kind": "edit", "path": "tests/protocol.test.ts"} -->
```ts

  it('rejects oversize payloads', () => {
```

with:

```ts

  it('accepts a vote for each arena and nothing else', () => {
    for (const arena of ['stadium', 'ice', 'quarry', 'port']) {
      expect(parseClientMessage(JSON.stringify({ t: 'vote', arena }))).toEqual({ t: 'vote', arena });
    }
    for (const bad of [undefined, '', 'Ice', 'moon', 3, null, {}, ['ice'], '__proto__', 'constructor']) {
      expect(parseClientMessage(JSON.stringify({ t: 'vote', arena: bad }))).toBeNull();
    }
    expect(parseClientMessage(JSON.stringify({ t: 'vote' }))).toBeNull();
  });

  it('rejects oversize payloads', () => {
```

In `tests/protocol.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/protocol.test.ts"} -->
```ts
    players: [{ slot: 2, name: 'Max', color: 255 }, { slot: 3, name: 'Rusty', color: 1, bot: true }],
    phase,
```

with:

```ts
    players: [{ slot: 2, name: 'Max', color: 255 }, { slot: 3, name: 'Rusty', color: 1, bot: true }],
    arena: 'ice', votes: { stadium: 0, ice: 2, quarry: 1, port: 0 },
    phase,
```

In `tests/protocol.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/protocol.test.ts"} -->
```ts
    expect(parseServerMessage(JSON.stringify({ ...welcome, you: -1, phase: null, scores: [] }))).toMatchObject({ you: -1, phase: null });
    const roster = { t: 'roster', epoch: 1, round: 4, you: -1, players: [] };
    expect(parseServerMessage(JSON.stringify(roster))).toEqual(roster);
```

with:

```ts
    expect(parseServerMessage(JSON.stringify({ ...welcome, you: -1, phase: null, scores: [] }))).toMatchObject({ you: -1, phase: null });
    const roster = { t: 'roster', epoch: 1, round: 4, you: -1, arena: 'port', players: [] };
    expect(parseServerMessage(JSON.stringify(roster))).toEqual(roster);
```

In `tests/protocol.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/protocol.test.ts"} -->
```ts

  it('accepts the match messages: phase, hit, ko, scores and results', () => {
```

with:

```ts

  it('accepts the vote tally, and refuses one that is not a count per arena', () => {
    const votes = { t: 'votes', counts: { stadium: 1, ice: 2, quarry: 0, port: 3 } };
    expect(parseServerMessage(JSON.stringify(votes))).toEqual(votes);
    for (const counts of [undefined, {}, { stadium: 1 }, { stadium: 1, ice: 2, quarry: 0, port: -1 }, { stadium: 1, ice: 2, quarry: 0, port: 9 }, { stadium: 'a', ice: 0, quarry: 0, port: 0 }, [1, 2, 3, 4]]) {
      expect(parseServerMessage(JSON.stringify({ t: 'votes', counts }))).toBeNull();
    }
  });

  it('speaks protocol version 4', () => {
    expect(NET.PROTOCOL_VERSION).toBe(4);
  });

  it('accepts the match messages: phase, hit, ko, scores and results', () => {
```

In `tests/protocol.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/protocol.test.ts"} -->
```ts
      JSON.stringify({ ...welcome, dents: Array.from({ length: NET.MAX_HIT_LOG + 1 }, () => hit) }),
      JSON.stringify({ t: 'roster', epoch: 1, round: 1, you: 0, players: [{ slot: 'a' }] }),
      JSON.stringify({ t: 'roster', epoch: 1, players: [] }), // no round / you
```

with:

```ts
      JSON.stringify({ ...welcome, dents: Array.from({ length: NET.MAX_HIT_LOG + 1 }, () => hit) }),
      JSON.stringify({ t: 'roster', epoch: 1, round: 1, you: 0, arena: 'ice', players: [{ slot: 'a' }] }),
      JSON.stringify({ t: 'roster', epoch: 1, players: [] }), // no round / you
```

In `tests/protocol.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/protocol.test.ts"} -->
```ts
      JSON.stringify({ t: 'roster', epoch: 1, players: [] }), // no round / you
      JSON.stringify({ t: 'pong', id: 1 }),
```

with:

```ts
      JSON.stringify({ t: 'roster', epoch: 1, players: [] }), // no round / you
      JSON.stringify({ t: 'roster', epoch: 1, round: 4, you: -1, players: [] }), // no arena
      JSON.stringify({ t: 'roster', epoch: 1, round: 4, you: -1, arena: 'moon', players: [] }),
      JSON.stringify({ ...welcome, arena: undefined }),
      JSON.stringify({ ...welcome, arena: 'moon' }),
      JSON.stringify({ ...welcome, votes: undefined }),
      JSON.stringify({ ...welcome, votes: { stadium: 0, ice: 0, quarry: 0 } }),
      JSON.stringify({ ...welcome, votes: { stadium: 0, ice: -1, quarry: 0, port: 0 } }),
      JSON.stringify({ ...welcome, votes: { stadium: 0, ice: 9, quarry: 0, port: 0 } }), // more votes than seats
      JSON.stringify({ ...welcome, votes: { stadium: 0, ice: 1.5, quarry: 0, port: 0 } }),
      JSON.stringify({ t: 'pong', id: 1 }),
```

In `tests/server/room.test.ts` (the greeting carries the arena and the tally; the results last 12 s):

<!-- op {"kind": "edit", "path": "tests/server/room.test.ts"} -->
```ts
    expect(room.playerInfos()).toEqual([]);
    expect(room.greeting(room.seated()[0]!)).toEqual({ you: -1, players: [], phase: null, scores: [], dents: [] });
  });
```

with:

```ts
    expect(room.playerInfos()).toEqual([]);
    expect(room.greeting(room.seated()[0]!)).toEqual({
      you: -1,
      players: [],
      arena: 'stadium',
      votes: { stadium: 0, ice: 0, quarry: 0, port: 0 },
      phase: null,
      scores: [],
      dents: [],
    });
  });
```

In `tests/server/room.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/room.test.ts"} -->
```ts
  it('has the documented default round timing', () => {
    expect(DEFAULT_RULES).toEqual({ countdownTicks: 300, liveTicks: 14_400, resultsTicks: 480 });
    expect(ROUND.BOT_FILL).toBe(4);
```

with:

```ts
  it('has the documented default round timing', () => {
    expect(DEFAULT_RULES).toEqual({ countdownTicks: 300, liveTicks: 14_400, resultsTicks: 720 });
    expect(ROUND.BOT_FILL).toBe(4);
```

In `tests/scripts/bot.test.ts`, the stand-in server's welcome:

<!-- op {"kind": "edit", "path": "tests/scripts/bot.test.ts"} -->
```ts
  players: [],
  tickRate: 60,
```

with:

```ts
  players: [],
  arena: 'stadium',
  votes: { stadium: 0, ice: 0, quarry: 0, port: 0 },
  tickRate: 60,
```

In `tests/client/connection.test.ts`, the roster:

<!-- op {"kind": "edit", "path": "tests/client/connection.test.ts"} -->
```ts
    expect(events.open).toBe(1);
    fake.receive(JSON.stringify({ t: 'roster', epoch: 2, round: 1, you: -1, players: [] }));
    fake.receive('not json'); // ignored
```

with:

```ts
    expect(events.open).toBe(1);
    fake.receive(JSON.stringify({ t: 'roster', epoch: 2, round: 1, you: -1, arena: 'stadium', players: [] }));
    fake.receive('not json'); // ignored
```

In `tests/client/connection.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/connection.test.ts"} -->
```ts
    fake.receive(JSON.stringify({ t: 'mystery' })); // ignored
    expect(events.messages).toEqual([{ t: 'roster', epoch: 2, round: 1, you: -1, players: [] }]);
  });
```

with:

```ts
    fake.receive(JSON.stringify({ t: 'mystery' })); // ignored
    expect(events.messages).toEqual([{ t: 'roster', epoch: 2, round: 1, you: -1, arena: 'stadium', players: [] }]);
  });
```

In `tests/client/matchState.test.ts`, the fixtures:

<!-- op {"kind": "edit", "path": "tests/client/matchState.test.ts"} -->
```ts
snapshotEvery: 2, phase: null, scores: [], dents: [], ...over,
```

with:

```ts
snapshotEvery: 2, phase: null, scores: [], dents: [], arena: 'stadium', votes: { stadium: 0, ice: 0, quarry: 0, port: 0 }, ...over,
```

and:

<!-- op {"kind": "edit", "path": "tests/client/matchState.test.ts"} -->
```ts
({ t: 'roster', epoch: 2, round: 1, you: 0, players, ...over })
```

with:

```ts
({ t: 'roster', epoch: 2, round: 1, you: 0, arena: 'stadium', players, ...over })
```

In `tests/helpers/loopback.ts`:

<!-- op {"kind": "edit", "path": "tests/helpers/loopback.ts"} -->
```ts
import { FakeSocket } from './fakeSocket';
```

with:

```ts
import { seedForArena } from './arenaSeed';
import { FakeSocket } from './fakeSocket';
```

and:

<!-- op {"kind": "edit", "path": "tests/helpers/loopback.ts"} -->
```ts
  seed?: number;
  /** Scripted input
```

with:

```ts
  seed?: number;
  /** Seeds the room, which draws the first round's arena from it (default: a seed that plays in the Stadium, which the tuning tests were written in). */
  roomSeed?: number;
  /** Scripted input
```

and:

<!-- op {"kind": "edit", "path": "tests/helpers/loopback.ts"} -->
```ts
      botFill: 0,
      rules:
```

with:

```ts
      botFill: 0,
      seed: options.roomSeed ?? seedForArena('stadium'),
      rules:
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/server/vote.test.ts tests/server/roomVote.test.ts tests/protocol.test.ts tests/server/room.test.ts`
Expected: FAIL — `vote.ts` does not exist, the parsers know no vote, the room has no ballot

<!-- check {"cmd": "npx vitest run tests/server/vote.test.ts tests/server/roomVote.test.ts tests/protocol.test.ts tests/server/room.test.ts", "outcome": "fail", "match": "Cannot find module|FAIL|not a function|Failed"} -->

- [ ] **Step 3: Add the ballot**

`src/server/vote.ts` (pure, so the tie rule is tested without a room):

Create `src/server/vote.ts`:

<!-- op {"kind": "create", "path": "src/server/vote.ts"} -->
```ts
import { ARENA_IDS, type ArenaId } from '../shared/arenas';
import type { VoteCounts } from '../shared/protocol';

/** Votes per arena; an arena nobody chose counts zero. */
export function tally(votes: Iterable<ArenaId>): VoteCounts {
  const counts: VoteCounts = { stadium: 0, ice: 0, quarry: 0, port: 0 };
  for (const v of votes) counts[v]++;
  return counts;
}

/**
 * The arena of the next round: the one with the most votes; among arenas with the same top count, `random` picks (so does a
 * room where nobody voted: every arena is then tied at zero). `random` is the room's seeded generator, never `Math.random`.
 */
export function chooseArena(counts: VoteCounts, random: () => number): ArenaId {
  const top = Math.max(...ARENA_IDS.map((id) => counts[id]));
  const leaders = ARENA_IDS.filter((id) => counts[id] === top);
  return leaders[Math.min(leaders.length - 1, Math.floor(random() * leaders.length))]!;
}
```

In `src/shared/protocol.ts` (the messages, their parsers, and a tally validator that refuses a count no room could produce):

<!-- op {"kind": "edit", "path": "src/shared/protocol.ts"} -->
```ts
import { ARENA, NET } from './constants';
```

with:

```ts
import { ARENA_IDS, isArenaId, type ArenaId } from './arenas';
import { ARENA, NET } from './constants';
```

In `src/shared/protocol.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/protocol.ts"} -->
```ts
}
export type ClientMessage = HelloMessage | PingMessage;

```

with:

```ts
}
/** A vote for the next round's arena; counts only while the room shows its results. */
export interface VoteMessage {
  t: 'vote';
  arena: ArenaId;
}
export type ClientMessage = HelloMessage | PingMessage | VoteMessage;

/** Votes per arena (every arena is present; none is more than the seats in a room). */
export type VoteCounts = Record<ArenaId, number>;

```

In `src/shared/protocol.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/protocol.ts"} -->
```ts
  players: PlayerInfo[];
  tickRate: number;
```

with:

```ts
  players: PlayerInfo[];
  /** The arena of the running (or coming) round, and the tally of the vote under way (all zero outside the results). */
  arena: ArenaId;
  votes: VoteCounts;
  tickRate: number;
```

In `src/shared/protocol.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/protocol.ts"} -->
```ts
  you: number;
  players: PlayerInfo[];
```

with:

```ts
  you: number;
  /** The arena this round is played in: the vote's winner. */
  arena: ArenaId;
  players: PlayerInfo[];
```

In `src/shared/protocol.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/protocol.ts"} -->
```ts
}
export interface HitMessage {
```

with:

```ts
}
/** The vote's running tally: at most four a second while votes change, and an empty one when a results phase opens. */
export interface VotesMessage {
  t: 'votes';
  counts: VoteCounts;
}
export interface HitMessage {
```

In `src/shared/protocol.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/protocol.ts"} -->
```ts
  | RosterMessage
  | PhaseMessage
```

with:

```ts
  | RosterMessage
  | VotesMessage
  | PhaseMessage
```

In `src/shared/protocol.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/protocol.ts"} -->
```ts
  }
  if (v.t === 'hello') {
```

with:

```ts
  }
  if (v.t === 'vote') {
    return isArenaId(v.arena) ? { t: 'vote', arena: v.arena } : null;
  }
  if (v.t === 'hello') {
```

In `src/shared/protocol.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/protocol.ts"} -->
```ts
const isSlotOrNone = (v: unknown): v is number => isInt(v) && v >= -1 && v < ARENA.MAX_CARS;
const isList = (v: unknown): v is unknown[] => Array.isArray(v) && v.length <= ARENA.MAX_CARS;
```

with:

```ts
const isSlotOrNone = (v: unknown): v is number => isInt(v) && v >= -1 && v < ARENA.MAX_CARS;
const isVoteCounts = (v: unknown): v is VoteCounts =>
  isObj(v) && Object.keys(v).length === ARENA_IDS.length && ARENA_IDS.every((id) => isInt(v[id]) && (v[id] as number) >= 0 && (v[id] as number) <= ARENA.MAX_CARS);
const isList = (v: unknown): v is unknown[] => Array.isArray(v) && v.length <= ARENA.MAX_CARS;
```

In `src/shared/protocol.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/protocol.ts"} -->
```ts
      if (
        isInt(v.v) && isSlotOrNone(v.you) && isInt(v.epoch) && isInt(v.tickRate) && isInt(v.snapshotEvery) &&
        isObj(room) && typeof room.code === 'string' && typeof room.public === 'boolean' && isInt(room.capacity) &&
```

with:

```ts
      if (
        isInt(v.v) && isSlotOrNone(v.you) && isArenaId(v.arena) && isVoteCounts(v.votes) && isInt(v.epoch) && isInt(v.tickRate) && isInt(v.snapshotEvery) &&
        isObj(room) && typeof room.code === 'string' && typeof room.public === 'boolean' && isInt(room.capacity) &&
```

In `src/shared/protocol.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/protocol.ts"} -->
```ts
      const players = v.players;
      return isInt(v.epoch) && isInt(v.round) && isSlotOrNone(v.you) && isList(players) && players.every(isPlayerInfo)
        ? (v as unknown as RosterMessage)
```

with:

```ts
      const players = v.players;
      return isInt(v.epoch) && isInt(v.round) && isSlotOrNone(v.you) && isArenaId(v.arena) && isList(players) && players.every(isPlayerInfo)
        ? (v as unknown as RosterMessage)
```

In `src/shared/protocol.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/protocol.ts"} -->
```ts
    }
    case 'phase':
```

with:

```ts
    }
    case 'votes':
      return isVoteCounts(v.counts) ? (v as unknown as VotesMessage) : null;
    case 'phase':
```

In `src/shared/constants.ts` (protocol 4; the results phase is 12 s because it is also the vote):

<!-- op {"kind": "edit", "path": "src/shared/constants.ts"} -->
```ts
  LIVE_TICKS: 4 * 60 * 60,
  RESULTS_TICKS: 8 * 60,
  /** Bots fill a room up to this many cars; they step aside as humans join. */
```

with:

```ts
  LIVE_TICKS: 4 * 60 * 60,
  /** The results screen is also the vote for the next arena. */
  RESULTS_TICKS: 12 * 60,
  /** Bots fill a room up to this many cars; they step aside as humans join. */
```

In `src/shared/constants.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/constants.ts"} -->
```ts
export const NET = {
  /** 3: the welcome carries the round's latest hits (`dents`). 2: rounds, hit/ko/scores/results messages, `you` in the roster. */
  PROTOCOL_VERSION: 3,
  /** The welcome message carries this many of the round's latest hits (a newcomer replays them to dent the cars). */
```

with:

```ts
export const NET = {
  /** 4: arenas: `vote` (client) and `votes` (server), `arena` in the welcome and the roster, `votes` in the welcome. 3: the welcome carries the round's latest hits (`dents`). 2: rounds, hit/ko/scores/results messages, `you` in the roster. */
  PROTOCOL_VERSION: 4,
  /** The welcome message carries this many of the round's latest hits (a newcomer replays them to dent the cars). */
```

In `src/server/room.ts` (the room keeps who voted for what; `vote` counts only during the results; a new round draws its arena from the tally with the room's seed and forgets the votes; the tally goes out at most four times a second, and an empty one opens each results phase):

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
import { DEFAULT_ARENA, type ArenaDef } from '../shared/arenas';
import { ARENA, NET, PHYSICS, ROUND } from '../shared/constants';
```

with:

```ts
import { getArena, DEFAULT_ARENA, type ArenaDef, type ArenaId } from '../shared/arenas';
import { ARENA, NET, PHYSICS, ROUND } from '../shared/constants';
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
  type SnapshotCar,
} from '../shared/protocol';
```

with:

```ts
  type SnapshotCar,
  type VoteCounts,
} from '../shared/protocol';
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
} from '../shared/protocol';
import { Simulation } from '../shared/sim';
```

with:

```ts
} from '../shared/protocol';
import { mulberry32 } from '../shared/random';
import { Simulation } from '../shared/sim';
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
import { RoundState } from './round';

```

with:

```ts
import { RoundState } from './round';
import { chooseArena, tally } from './vote';

```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
const SCORES_EVERY_TICKS = 15;

```

with:

```ts
const SCORES_EVERY_TICKS = 15;
/** The vote's tally goes out at most this often (four times a second). */
const VOTES_EVERY_TICKS = 15;

```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
  private arena: ArenaDef = DEFAULT_ARENA;
  private sim: Simulation | null = null;
```

with:

```ts
  private arena: ArenaDef = DEFAULT_ARENA;
  /** Who voted for what during the results phase. A leaver's vote goes with them. */
  private readonly votes = new Map<Player, ArenaId>();
  private votesDirty = false;
  private votesSentAt = 0;
  private sim: Simulation | null = null;
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
  /** What a player who has just joined needs to know: their slot (-1 = watching), the cars, the phase and the scores. */
  greeting(player: Player): { you: number; players: PlayerInfo[]; phase: PhaseMessage | null; scores: ScoreRow[]; dents: HitMessage[] } {
    const me = this.participants.find((p) => p.player === player);
```

with:

```ts
  /** What a player who has just joined needs to know: their slot (-1 = watching), the cars, the phase and the scores. */
  greeting(player: Player): {
    you: number;
    players: PlayerInfo[];
    arena: ArenaId;
    votes: VoteCounts;
    phase: PhaseMessage | null;
    scores: ScoreRow[];
    dents: HitMessage[];
  } {
    const me = this.participants.find((p) => p.player === player);
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
      players: this.playerInfos(),
      phase: this.sim ? this.phaseMessage() : null,
```

with:

```ts
      players: this.playerInfos(),
      arena: this.arena.id,
      votes: this.voteCounts(),
      phase: this.sim ? this.phaseMessage() : null,
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts

  removePlayer(player: Player): void {
```

with:

```ts

  /** The arena vote: counts during the results phase for anyone in the room (with or without a car); the last vote of a player stands. */
  vote(player: Player, arena: ArenaId): void {
    if (this.phase !== 'results' || !this.sim || !this.participants.some((p) => p.player === player)) return;
    if (this.votes.get(player) === arena) return;
    this.votes.set(player, arena);
    this.votesDirty = true;
  }

  private voteCounts(): VoteCounts {
    return tally(this.votes.values());
  }

  removePlayer(player: Player): void {
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
    if (index < 0) return;
    const leaving = this.participants[index]!;
```

with:

```ts
    if (index < 0) return;
    if (this.votes.delete(player)) this.votesDirty = true;
    const leaving = this.participants[index]!;
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
    this.flushScores();
    if (sim.tick % NET.SNAPSHOT_EVERY === 0) this.broadcastSnapshot(sim, state);
```

with:

```ts
    this.flushScores();
    this.flushVotes();
    if (sim.tick % NET.SNAPSHOT_EVERY === 0) this.broadcastSnapshot(sim, state);
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
    this.restarts = restart ? this.restarts + 1 : 0;
    if (!restart) this.round++;
    this.epoch = (this.epoch + 1) & 0xff;
```

with:

```ts
    this.restarts = restart ? this.restarts + 1 : 0;
    if (!restart) {
      this.round++;
      // the vote decides (a first round, or a room where nobody voted, is a draw among all four); the same seed gives the same draw
      this.arena = getArena(chooseArena(this.voteCounts(), mulberry32((this.seed + this.round * 15_485_863) >>> 0)));
      this.votes.clear();
      this.votesDirty = false;
    }
    this.epoch = (this.epoch + 1) & 0xff;
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
      p.player!.resetInputState();
      p.player!.send({ t: 'roster', epoch: this.epoch, round: this.round, you: p.slot, players: cars });
    }
```

with:

```ts
      p.player!.resetInputState();
      p.player!.send({ t: 'roster', epoch: this.epoch, round: this.round, you: p.slot, arena: this.arena.id, players: cars });
    }
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
    this.phase = 'results';
    this.phaseTicks = 0;
    this.broadcast(this.phaseMessage());
    // the standings with this round folded in go out at once, throttle or not: the board on screen must show what the results say
```

with:

```ts
    this.phase = 'results';
    this.phaseTicks = 0;
    this.votes.clear();
    this.votesDirty = false;
    this.votesSentAt = this.ticks;
    this.broadcast(this.phaseMessage());
    // the standings with this round folded in go out at once, throttle or not: the board on screen must show what the results say
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
    this.broadcast(this.phaseMessage());
    // the standings with this round folded in go out at once, throttle or not: the board on screen must show what the results say
```

with:

```ts
    this.broadcast(this.phaseMessage());
    this.broadcast({ t: 'votes', counts: this.voteCounts() }); // an empty tally opens the vote
    // the standings with this round folded in go out at once, throttle or not: the board on screen must show what the results say
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts

  private broadcastSnapshot(sim: Simulation, state: RoundState): void {
```

with:

```ts

  private flushVotes(): void {
    if (!this.votesDirty || this.ticks - this.votesSentAt < VOTES_EVERY_TICKS) return;
    this.votesDirty = false;
    this.votesSentAt = this.ticks;
    this.broadcast({ t: 'votes', counts: this.voteCounts() });
  }

  private broadcastSnapshot(sim: Simulation, state: RoundState): void {
```

In `src/server/app.ts` (a `vote` from a socket that is not in a room, or outside the results, is nothing; the welcome carries the arena and the tally):

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts
  helloTimeoutMs?: number;
  /** Round timing in simulation ticks (defaults: 5 s countdown, 4 min round, 8 s results). */
  rules?: Partial<RoomRules>;
```

with:

```ts
  helloTimeoutMs?: number;
  /** Round timing in simulation ticks (defaults: 5 s countdown, 4 min round, 12 s results). */
  rules?: Partial<RoomRules>;
```

In `src/server/app.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts
    }
    if (player.joined) {
```

with:

```ts
    }
    if (msg.t === 'vote') {
      player.room?.vote(player, msg.arena); // from a player who is not in a room, or outside the results phase, it is nothing
      return;
    }
    if (player.joined) {
```

In `src/server/app.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts
      players: greeting.players,
      tickRate: PHYSICS.TICK_RATE,
```

with:

```ts
      players: greeting.players,
      arena: greeting.arena,
      votes: greeting.votes,
      tickRate: PHYSICS.TICK_RATE,
```

- [ ] **Step 4: Run the tests, then the whole suite, then the hash**

Run: `npx vitest run tests/server/vote.test.ts tests/server/roomVote.test.ts tests/protocol.test.ts tests/server/room.test.ts`
Expected: all pass

<!-- check {"cmd": "npx vitest run tests/server/vote.test.ts tests/server/roomVote.test.ts tests/protocol.test.ts tests/server/room.test.ts", "outcome": "pass"} -->

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 760} -->

Run: `npm run hash`
Expected: prints `10c3a72a`

<!-- check {"cmd": "npm run hash", "outcome": "pass", "match": "10c3a72a"} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: a vote for the next arena \u2014 protocol 4, a ballot in the results phase decided by majority and the room's seed, a 12 s results phase"
```

<!-- commit "feat: a vote for the next arena \u2014 protocol 4, a ballot in the results phase decided by majority and the room's seed, a 12 s results phase" -->

---

### Task 58: The client predicts in the arena of the round

**Files:**
- Create: `tests/client/arenaPrediction.test.ts`
- Modify: `src/client/net/prediction.ts`, `src/client/net/predictedWorld.ts`, `src/client/net/session.ts`, `src/client/game/gameClient.ts`, `tests/helpers/loopback.ts`

**Interfaces:**
- Consumes: `ArenaDef`, `getArena`, `DEFAULT_ARENA`, `Simulation(slots, { arena })` (Tasks 54-55), the `arena` of the welcome and the roster, `seedForArena` (Task 57), `Predictor`, `PredictedWorld`, `ClientSession` (Plan 3).
- Produces: `Predictor.beginWorld(epoch, mySlot?, arena?)`, `PredictorOptions.createSimulation(slots, arena)`, `PredictedWorld.beginWorld(epoch, mySlot?, arena?)`, `ClientSession.onWelcome(slot, epoch, phase?, arena?)` and `onRoster(epoch, you, arena?)`; the local world is built from the arena the server announced.

- [ ] **Step 1: Write the tests**

The local prediction must run the same physics as the server or it is wrong from the first tick. Two tests: the predictor asks its world builder for the arena it was told about, and again for the next one after the next `beginWorld`; and for each of the four arenas a loopback with a real server room that plays in it predicts the local car to within 1 cm (95th percentile) and 5 cm (worst) on a perfect network. The Stadium case passes before the change (it is the default); the other three are the ones that fail.

Create `tests/client/arenaPrediction.test.ts`:

<!-- op {"kind": "create", "path": "tests/client/arenaPrediction.test.ts"} -->
```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Predictor } from '../../src/client/net/prediction';
import { ARENA_IDS, ARENAS } from '../../src/shared/arenas';
import type { CarInput } from '../../src/shared/input';
import { initPhysics } from '../../src/shared/physics';
import { SNAP_FLAG_ALIVE } from '../../src/shared/protocol';
import { Simulation } from '../../src/shared/sim';
import { seedForArena } from '../helpers/arenaSeed';
import { Loopback, percentile } from '../helpers/loopback';

beforeAll(async () => {
  await initPhysics();
});

const straight = (): CarInput => ({ throttle: 1, steer: 0, handbrake: false });
const gentle = (k: number): CarInput => ({ throttle: 0.9, steer: Math.sin(k / 37 + 1) * 0.7, handbrake: false });

const loops: Loopback[] = [];
const sims: Simulation[] = [];
afterEach(() => {
  while (loops.length) loops.pop()!.dispose();
  while (sims.length) sims.pop()!.dispose();
});

describe('Predictor in the round\'s arena', () => {
  it('builds its local world from the arena it was told about', () => {
    const asked: string[] = [];
    const p = new Predictor(0, {
      createSimulation: (slots, arena) => {
        asked.push(arena.id);
        const s = new Simulation(slots, { arena });
        sims.push(s);
        return s;
      },
    });
    const server = new Simulation([0, 1], { arena: ARENAS.quarry });
    sims.push(server);
    p.beginWorld(3, 0, ARENAS.quarry);
    p.reconcile({ epoch: 3, tick: 10, ackSeq: 0, cars: server.slots.map((slot) => ({ slot, flags: SNAP_FLAG_ALIVE, hp: 100, state: server.getState(slot), throttle: 0, steer: 0 })) });
    expect(asked).toEqual(['quarry']);
    p.beginWorld(4, 0, ARENAS.port);
    p.reconcile({ epoch: 4, tick: 10, ackSeq: 0, cars: server.slots.map((slot) => ({ slot, flags: SNAP_FLAG_ALIVE, hp: 100, state: server.getState(slot), throttle: 0, steer: 0 })) });
    expect(asked).toEqual(['quarry', 'port']);
    p.dispose();
  });

  for (const id of ARENA_IDS) {
    it(`matches a real server room playing in ${id} when the network is perfect`, () => {
      const l = new Loopback({ local: straight, remote: gentle, roomSeed: seedForArena(id) });
      loops.push(l);
      l.run(6);
      expect(l.room.greeting(l.local).arena).toBe(id);
      expect(l.results.filter((r) => r.outcome === 'applied').length).toBeGreaterThan(150);
      expect(percentile(l.localErrors(), 0.95)).toBeLessThan(0.01);
      expect(Math.max(...l.localErrors())).toBeLessThan(0.05);
    });
  }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/client/arenaPrediction.test.ts`
Expected: FAIL — the predictor builds the Stadium whatever it is told: three of the five tests fail

<!-- check {"cmd": "npx vitest run tests/client/arenaPrediction.test.ts", "outcome": "fail", "match": "FAIL|\u00d7|failed"} -->

- [ ] **Step 3: Carry the arena to the predictor**

In `src/client/net/prediction.ts`:

<!-- op {"kind": "edit", "path": "src/client/net/prediction.ts"} -->
```ts
import { ARENA, COMBAT } from '../../shared/constants';
```

with:

```ts
import { DEFAULT_ARENA, type ArenaDef } from '../../shared/arenas';
import { ARENA, COMBAT } from '../../shared/constants';
```

In `src/client/net/prediction.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/prediction.ts"} -->
```ts
  startSeq?: number;
  /** Builds the local world for the given slots; tests inject a failing one. Defaults to `new Simulation(slots)`. */
  createSimulation?: (slots: number[]) => Simulation;
}
```

with:

```ts
  startSeq?: number;
  /** Builds the local world for the given slots in the round's arena; tests inject a failing one. Defaults to `new Simulation(slots, { arena })`. */
  createSimulation?: (slots: number[], arena: ArenaDef) => Simulation;
}
```

In `src/client/net/prediction.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/prediction.ts"} -->
```ts
  private readonly stallTicks: number;
  private readonly createSimulation: (slots: number[]) => Simulation;
  private sim: Simulation | null = null;
```

with:

```ts
  private readonly stallTicks: number;
  private readonly createSimulation: (slots: number[], arena: ArenaDef) => Simulation;
  /** The arena of the current world (from the roster or the welcome); the Stadium until told otherwise. */
  private arena: ArenaDef = DEFAULT_ARENA;
  private sim: Simulation | null = null;
```

In `src/client/net/prediction.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/prediction.ts"} -->
```ts
    this.stallTicks = Math.max(1, Math.floor(options.stallTicks ?? DEFAULTS.stallTicks));
    this.createSimulation = options.createSimulation ?? ((slots) => new Simulation(slots));
    this.seq = (options.startSeq ?? 0) >>> 0;
```

with:

```ts
    this.stallTicks = Math.max(1, Math.floor(options.stallTicks ?? DEFAULTS.stallTicks));
    this.createSimulation = options.createSimulation ?? ((slots, arena) => new Simulation(slots, { arena }));
    this.seq = (options.startSeq ?? 0) >>> 0;
```

In `src/client/net/prediction.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/prediction.ts"} -->
```ts
   * The world itself is built from the first snapshot (it lists exactly the cars the server simulates). Inputs not yet
   * acknowledged are kept so they can be replayed, and the input numbering carries on.
   */
```

with:

```ts
   * The world itself is built from the first snapshot (it lists exactly the cars the server simulates). Inputs not yet
   * acknowledged are kept so they can be replayed, and the input numbering carries on. `arena` is the one the round is played
   * in (default: the same as before).
   */
```

In `src/client/net/prediction.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/prediction.ts"} -->
```ts
   */
  beginWorld(epoch: number, mySlot: number = this.mySlot): void {
    this.mySlot = mySlot;
```

with:

```ts
   */
  beginWorld(epoch: number, mySlot: number = this.mySlot, arena: ArenaDef = this.arena): void {
    this.mySlot = mySlot;
```

In `src/client/net/prediction.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/prediction.ts"} -->
```ts
    this.mySlot = mySlot;
    this.epoch = epoch & 0xff;
```

with:

```ts
    this.mySlot = mySlot;
    this.arena = arena;
    this.epoch = epoch & 0xff;
```

In `src/client/net/prediction.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/prediction.ts"} -->
```ts
      try {
        next = this.createSimulation(slots); // the current world is untouched if this throws
      } catch (err) {
```

with:

```ts
      try {
        next = this.createSimulation(slots, this.arena); // the current world is untouched if this throws
      } catch (err) {
```

In `src/client/net/predictedWorld.ts`:

<!-- op {"kind": "edit", "path": "src/client/net/predictedWorld.ts"} -->
```ts
import type { CarInput } from '../../shared/input';
```

with:

```ts
import type { ArenaDef } from '../../shared/arenas';
import type { CarInput } from '../../shared/input';
```

In `src/client/net/predictedWorld.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/predictedWorld.ts"} -->
```ts
  /** A new world (welcome or roster message), in which the local car has slot `mySlot`: forget predictions and pending corrections. */
  beginWorld(epoch: number, mySlot: number = this.mySlot): void {
    this.predictor.beginWorld(epoch, mySlot);
    this.stats.mySlot = mySlot;
```

with:

```ts
  /** A new world (welcome or roster message), in which the local car has slot `mySlot`: forget predictions and pending corrections. */
  beginWorld(epoch: number, mySlot: number = this.mySlot, arena?: ArenaDef): void {
    this.predictor.beginWorld(epoch, mySlot, arena);
    this.stats.mySlot = mySlot;
```

In `src/client/net/session.ts`:

<!-- op {"kind": "edit", "path": "src/client/net/session.ts"} -->
```ts
import type { CarInput } from '../../shared/input';
```

with:

```ts
import type { ArenaDef } from '../../shared/arenas';
import type { CarInput } from '../../shared/input';
```

In `src/client/net/session.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/session.ts"} -->
```ts
  /** `slot` is the local car's slot in the running round, or -1 while the player is watching. */
  onWelcome(slot: number, epoch: number, phase: Phase | null = null): void {
    this.epoch = epoch;
```

with:

```ts
  /** `slot` is the local car's slot in the running round, or -1 while the player is watching. */
  onWelcome(slot: number, epoch: number, phase: Phase | null = null, arena?: ArenaDef): void {
    this.epoch = epoch;
```

In `src/client/net/session.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/session.ts"} -->
```ts
      this.world = new PredictedWorld(slot, this.options.world);
      this.world.beginWorld(epoch);
      this.world.setLive(phase === 'live');
```

with:

```ts
      this.world = new PredictedWorld(slot, this.options.world);
      this.world.beginWorld(epoch, slot, arena);
      this.world.setLive(phase === 'live');
```

In `src/client/net/session.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/session.ts"} -->
```ts
  /** A new round's world: every buffered or predicted state belongs to the old one, and the local car may have a new slot. */
  onRoster(epoch: number, you: number): void {
    this.epoch = epoch;
```

with:

```ts
  /** A new round's world: every buffered or predicted state belongs to the old one, and the local car may have a new slot. */
  onRoster(epoch: number, you: number, arena?: ArenaDef): void {
    this.epoch = epoch;
```

In `src/client/net/session.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/session.ts"} -->
```ts
    this.interpolator.reset(epoch);
    this.world?.beginWorld(epoch, you);
    this.world?.setLive(false);
```

with:

```ts
    this.interpolator.reset(epoch);
    this.world?.beginWorld(epoch, you, arena);
    this.world?.setLive(false);
```

In `src/client/game/gameClient.ts`, the session is told the arena of the welcome and of each roster:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
import * as THREE from 'three';

```

with:

```ts
import * as THREE from 'three';
import { getArena } from '../../shared/arenas';

```

and:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
        this.session.onWelcome(m.you, m.epoch, m.phase?.phase ?? null);
```

with:

```ts
        this.session.onWelcome(m.you, m.epoch, m.phase?.phase ?? null, getArena(m.arena));
```

and:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
        this.session.onRoster(m.epoch, m.you); // a new world
```

with:

```ts
        this.session.onRoster(m.epoch, m.you, getArena(m.arena)); // a new world
```

In `tests/helpers/loopback.ts`, the loopback reads the arena of the roster the way the game does:

<!-- op {"kind": "edit", "path": "tests/helpers/loopback.ts"} -->
```ts
import { PredictedWorld, type RenderPose } from '../../src/client/net/predictedWorld';
import { quantizeInput, type CarInput } from '../../src/shared/input';
```

with:

```ts
import { PredictedWorld, type RenderPose } from '../../src/client/net/predictedWorld';
import { getArena, type ArenaId } from '../../src/shared/arenas';
import { quantizeInput, type CarInput } from '../../src/shared/input';
```

In `tests/helpers/loopback.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/helpers/loopback.ts"} -->
```ts

type Down = { kind: 'snapshot'; snapshot: Snapshot } | { kind: 'roster'; epoch: number; you: number } | { kind: 'phase'; live: boolean };
type Up = { seq: number; input: CarInput };
```

with:

```ts

type Down = { kind: 'snapshot'; snapshot: Snapshot } | { kind: 'roster'; epoch: number; you: number; arena: ArenaId } | { kind: 'phase'; live: boolean };
type Up = { seq: number; input: CarInput };
```

In `tests/helpers/loopback.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/helpers/loopback.ts"} -->
```ts
      if (typeof frame === 'string') {
        const msg = JSON.parse(frame) as { t: string; epoch?: number; you?: number; phase?: string };
        if (msg.t === 'roster') this.down.push(now, { kind: 'roster', epoch: msg.epoch!, you: msg.you! });
        else if (msg.t === 'phase') this.down.push(now, { kind: 'phase', live: msg.phase === 'live' });
```

with:

```ts
      if (typeof frame === 'string') {
        const msg = JSON.parse(frame) as { t: string; epoch?: number; you?: number; phase?: string; arena?: ArenaId };
        if (msg.t === 'roster') this.down.push(now, { kind: 'roster', epoch: msg.epoch!, you: msg.you!, arena: msg.arena! });
        else if (msg.t === 'phase') this.down.push(now, { kind: 'phase', live: msg.phase === 'live' });
```

In `tests/helpers/loopback.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/helpers/loopback.ts"} -->
```ts
      if (d.kind === 'roster') {
        this.world.beginWorld(d.epoch, d.you);
        this.world.setLive(false);
```

with:

```ts
      if (d.kind === 'roster') {
        this.world.beginWorld(d.epoch, d.you, getArena(d.arena));
        this.world.setLive(false);
```

- [ ] **Step 4: Run the test, then the whole suite**

Run: `npx vitest run tests/client/arenaPrediction.test.ts`
Expected: all five pass

<!-- check {"cmd": "npx vitest run tests/client/arenaPrediction.test.ts", "outcome": "pass"} -->

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 765} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(client): the local prediction builds its world in the arena the server announced"
```

<!-- commit "feat(client): the local prediction builds its world in the arena the server announced" -->

---

### Task 59: The match screen knows the arena, and the vote panel

**Files:**
- Modify: `src/client/game/matchState.ts`, `src/client/ui/format.ts`, `src/client/ui/hud.ts`, `src/client/index.html`, `src/client/game/gameClient.ts`, `tests/client/matchState.test.ts`, `tests/client/format.test.ts`

**Interfaces:**
- Consumes: `MatchState`, `MatchView`, `Hud`, `boardSignature`, `once` (Plan 5), the `votes` message, `arena` in the welcome and roster (Task 57), `Connection.send`.
- Produces: `MatchView.arena` (`{ id, name }`), `MatchView.vote` (`{ options: VoteOption[] }` while the results show, else `null`), `MatchState.onVotes(m)` and `MatchState.vote(arena): boolean`; `Hud.setVoteHandler(handler)`; `voteLabel`, `voteSignature`; four cards on the results screen (click, or the keys 1 to 4) with the live tally and your own choice; the countdown banner says which arena the round is in.

- [ ] **Step 1: Write the tests**

The state is DOM-free and tested in Node: the arena named in the countdown banner (`Round 2 · Mud Quarry — get ready`), the arena a newcomer is dropped into, the four options offered only while the results show, the tally the server sends and your own choice (changeable), a vote refused outside the results and not remembered, the vote and the tally forgotten when the next round is announced, a newcomer's results phase starting from the welcome's tally, and the results banner telling the player to vote. The panel's two helpers are tested too: the label under a card ("no votes", "1 vote", "3 votes", nonsense counted as none) and the signature that decides when the panel is redrawn.

In `tests/client/matchState.test.ts` (the countdown subtitle now names the arena, and a new `describe` at the end):

<!-- op {"kind": "edit", "path": "tests/client/matchState.test.ts"} -->
```ts
    m.onPhase(phase('countdown', 5000, 3));
    expect(m.view()).toMatchObject({ phase: 'countdown', round: 3, clockLabel: 'Starts in', clock: '5', banner: { kind: 'countdown', title: '5', subtitle: 'Round 3 — get ready' } });
    clock.t += 1200;
```

with:

```ts
    m.onPhase(phase('countdown', 5000, 3));
    expect(m.view()).toMatchObject({ phase: 'countdown', round: 3, clockLabel: 'Starts in', clock: '5', banner: { kind: 'countdown', title: '5', subtitle: 'Round 3 · Stadium — get ready' } });
    clock.t += 1200;
```

In `tests/client/matchState.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/matchState.test.ts"} -->
```ts
    clock.t += 3000;
    expect(m.view().banner).toMatchObject({ title: '2', subtitle: 'Round 2 — get ready' });
    m.onRoster(roster({ round: 2, epoch: 5 })); // somebody joined: the server rebuilds the world and starts the countdown again
```

with:

```ts
    clock.t += 3000;
    expect(m.view().banner).toMatchObject({ title: '2', subtitle: 'Round 2 · Stadium — get ready' });
    m.onRoster(roster({ round: 2, epoch: 5 })); // somebody joined: the server rebuilds the world and starts the countdown again
```

In `tests/client/matchState.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/matchState.test.ts"} -->
```ts
    m.onPhase(phase('countdown', 5000, 2));
    expect(m.view()).toMatchObject({ round: 2, clock: '5', banner: { kind: 'countdown', title: '5', subtitle: 'Round 2 — get ready' } });
  });
```

with:

```ts
    m.onPhase(phase('countdown', 5000, 2));
    expect(m.view()).toMatchObject({ round: 2, clock: '5', banner: { kind: 'countdown', title: '5', subtitle: 'Round 2 · Stadium — get ready' } });
  });
```

In `tests/client/matchState.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/matchState.test.ts"} -->
```ts
    expect(m.view().board[0]).toMatchObject({ name: 'Bob', score: 500, kills: 3 });
  });
});

```

with:

```ts
    expect(m.view().board[0]).toMatchObject({ name: 'Bob', score: 500, kills: 3 });
  });
});

describe('MatchState arena and vote', () => {
  const counts = (over: Partial<Record<'stadium' | 'ice' | 'quarry' | 'port', number>> = {}) => ({ stadium: 0, ice: 0, quarry: 0, port: 0, ...over });

  it('names the arena of the round in the countdown banner', () => {
    const { m } = match();
    m.onRoster(roster({ round: 2, arena: 'quarry' }));
    m.onPhase(phase('countdown', 5000, 2));
    expect(m.view().arena).toEqual({ id: 'quarry', name: 'Mud Quarry' });
    expect(m.view().banner!.subtitle).toBe('Round 2 · Mud Quarry — get ready');
  });

  it('knows the arena a newcomer is dropped into', () => {
    const { m } = match();
    m.onWelcome(welcome({ arena: 'port', phase: phase('live', 60_000, 3) }));
    expect(m.view().arena).toEqual({ id: 'port', name: 'Container Port' });
  });

  it('offers the four arenas to vote on only while the results show', () => {
    const { m } = match();
    m.onRoster(roster());
    for (const p of ['countdown', 'live'] as const) {
      m.onPhase(phase(p, 5000));
      expect(m.view().vote).toBeNull();
    }
    m.onPhase(phase('results', 12_000));
    const vote = m.view().vote!;
    expect(vote.options.map((o) => [o.id, o.name, o.count, o.mine])).toEqual([
      ['stadium', 'Stadium', 0, false],
      ['ice', 'Frozen Lake', 0, false],
      ['quarry', 'Mud Quarry', 0, false],
      ['port', 'Container Port', 0, false],
    ]);
  });

  it('shows the tally the server sends, and your own choice', () => {
    const { m } = match();
    m.onRoster(roster());
    m.onPhase(phase('results', 12_000));
    m.onVotes({ t: 'votes', counts: counts({ ice: 2, port: 1 }) });
    expect(m.view().vote!.options.map((o) => o.count)).toEqual([0, 2, 0, 1]);
    expect(m.vote('port')).toBe(true);
    expect(m.view().vote!.options.map((o) => o.mine)).toEqual([false, false, false, true]);
    expect(m.vote('quarry')).toBe(true); // a vote can be changed
    expect(m.view().vote!.options.map((o) => o.mine)).toEqual([false, false, true, false]);
  });

  it('refuses a vote outside the results, and does not remember it', () => {
    const { m } = match();
    m.onRoster(roster());
    m.onPhase(phase('live', 60_000));
    expect(m.vote('ice')).toBe(false);
    m.onPhase(phase('results', 12_000));
    expect(m.view().vote!.options.some((o) => o.mine)).toBe(false);
  });

  it('forgets the vote and the tally when the next round is announced', () => {
    const { m } = match();
    m.onRoster(roster());
    m.onPhase(phase('results', 12_000));
    m.onVotes({ t: 'votes', counts: counts({ ice: 3 }) });
    m.vote('ice');
    m.onRoster(roster({ epoch: 3, round: 2, arena: 'ice' }));
    m.onPhase(phase('results', 12_000, 2));
    expect(m.view().vote!.options.map((o) => [o.count, o.mine])).toEqual([[0, false], [0, false], [0, false], [0, false]]);
  });

  it('starts a newcomer\'s results phase from the tally in the welcome', () => {
    const { m } = match();
    m.onWelcome(welcome({ phase: phase('results', 7000, 2), votes: counts({ quarry: 2 }) }));
    expect(m.view().vote!.options.map((o) => o.count)).toEqual([0, 0, 2, 0]);
  });

  it('says in the results banner that the vote decides the next round', () => {
    const { m } = match();
    m.onRoster(roster());
    m.onPhase(phase('results', 12_000));
    expect(m.view().banner).toMatchObject({ kind: 'results', hint: 'Vote for the next arena · keys 1 to 4' });
  });
});

```

In `tests/client/format.test.ts`:

<!-- op {"kind": "edit", "path": "tests/client/format.test.ts"} -->
```ts
import type { BoardRow } from '../../src/client/game/matchState';
import { boardSignature, hexColor, hpColor, once, zoneColor } from '../../src/client/ui/format';

```

with:

```ts
import type { BoardRow } from '../../src/client/game/matchState';
import { boardSignature, hexColor, hpColor, once, voteLabel, voteSignature, zoneColor } from '../../src/client/ui/format';

```

In `tests/client/format.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/format.test.ts"} -->
```ts
    expect(base).not.toBe(boardSignature([row()], false));
  });
});

```

with:

```ts
    expect(base).not.toBe(boardSignature([row()], false));
  });
});

describe('the vote panel', () => {
  const option = (id: 'stadium' | 'ice' | 'quarry' | 'port', count: number, mine = false) => ({ id, name: id, count, mine });
  const four = (over: Array<[number, boolean]> = []) => ({
    options: (['stadium', 'ice', 'quarry', 'port'] as const).map((id, i) => option(id, over[i]?.[0] ?? 0, over[i]?.[1] ?? false)),
  });

  it('says how many votes an arena has', () => {
    expect(voteLabel(0)).toBe('no votes');
    expect(voteLabel(1)).toBe('1 vote');
    expect(voteLabel(3)).toBe('3 votes');
    expect(voteLabel(Number.NaN)).toBe('no votes');
    expect(voteLabel(-2)).toBe('no votes');
  });

  it('is rebuilt only when a count, your choice or the panel itself changes', () => {
    expect(voteSignature(null)).toBe('');
    const a = voteSignature(four());
    expect(voteSignature(four())).toBe(a);
    expect(voteSignature(four([[0, false], [1, false]]))).not.toBe(a);
    expect(voteSignature(four([[0, false], [0, true]]))).not.toBe(a);
    expect(a).not.toBe('');
  });
});

```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/client/matchState.test.ts tests/client/format.test.ts`
Expected: FAIL — the state has no arena or vote, `format.ts` has no vote helpers

<!-- check {"cmd": "npx vitest run tests/client/matchState.test.ts tests/client/format.test.ts", "outcome": "fail", "match": "FAIL|\u00d7|failed"} -->

- [ ] **Step 3: Keep the vote in the state and draw the panel**

In `src/client/game/matchState.ts`:

<!-- op {"kind": "edit", "path": "src/client/game/matchState.ts"} -->
```ts
  ScoresMessage,
  WelcomeMessage,
```

with:

```ts
  ScoresMessage,
  VoteCounts,
  VotesMessage,
  WelcomeMessage,
```

In `src/client/game/matchState.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/matchState.ts"} -->
```ts
} from '../../shared/protocol';
import { COMBAT } from '../../shared/constants';
```

with:

```ts
} from '../../shared/protocol';
import { ARENA_IDS, getArena, type ArenaId } from '../../shared/arenas';
import { COMBAT } from '../../shared/constants';
```

In `src/client/game/matchState.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/matchState.ts"} -->
```ts

export interface MatchView {
```

with:

```ts

/** One arena on the vote panel. */
export interface VoteOption {
  id: ArenaId;
  name: string;
  /** Votes for it so far, as the server last counted them. */
  count: number;
  /** True for the one you voted for. */
  mine: boolean;
}

export interface MatchView {
```

In `src/client/game/matchState.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/matchState.ts"} -->
```ts
export interface MatchView {
  phase: Phase | null;
```

with:

```ts
export interface MatchView {
  /** The arena of the running (or coming) round. */
  arena: { id: ArenaId; name: string };
  /** The arenas to vote on (only while the results show; null otherwise). */
  vote: { options: VoteOption[] } | null;
  phase: Phase | null;
```

In `src/client/game/matchState.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/matchState.ts"} -->
```ts

const FEED_MS = 7000;
```

with:

```ts

const NO_VOTES: Readonly<VoteCounts> = { stadium: 0, ice: 0, quarry: 0, port: 0 };

const FEED_MS = 7000;
```

In `src/client/game/matchState.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/matchState.ts"} -->
```ts
  private watching = -1;

```

with:

```ts
  private watching = -1;
  private arena: ArenaId = 'stadium';
  private votes: VoteCounts = { ...NO_VOTES };
  private myVote: ArenaId | null = null;

```

In `src/client/game/matchState.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/matchState.ts"} -->
```ts
    this.feed = [];
    this.resetRoundDamage();
```

with:

```ts
    this.feed = [];
    this.arena = w.arena;
    this.votes = { ...w.votes };
    this.myVote = null;
    this.resetRoundDamage();
```

In `src/client/game/matchState.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/matchState.ts"} -->
```ts
    this.round = r.round;
    this.scores.clear();
```

with:

```ts
    this.round = r.round;
    this.arena = r.arena;
    this.votes = { ...NO_VOTES };
    this.myVote = null;
    this.scores.clear();
```

In `src/client/game/matchState.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/matchState.ts"} -->
```ts

  /** The latest snapshot's cars, every frame. */
```

with:

```ts

  /** The running tally of the vote. */
  onVotes(v: VotesMessage): void {
    this.votes = { ...v.counts };
  }

  /** Casts (or changes) your vote. Returns false, and remembers nothing, when no vote is open: only the results phase has one. */
  vote(arena: ArenaId): boolean {
    if (this.phase !== 'results') return false;
    this.myVote = arena;
    return true;
  }

  /** The latest snapshot's cars, every frame. */
```

In `src/client/game/matchState.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/matchState.ts"} -->
```ts
    return {
      phase: this.phase,
```

with:

```ts
    return {
      arena: { id: this.arena, name: getArena(this.arena).name },
      vote:
        this.phase === 'results'
          ? { options: ARENA_IDS.map((id) => ({ id, name: getArena(id).name, count: this.votes[id], mine: this.myVote === id })) }
          : null,
      phase: this.phase,
```

In `src/client/game/matchState.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/matchState.ts"} -->
```ts
        title: String(seconds),
        subtitle: this.mySlot >= 0 ? `Round ${this.round} — get ready` : 'You join the next round',
        hint: '',
```

with:

```ts
        title: String(seconds),
        subtitle: this.mySlot >= 0 ? `Round ${this.round} · ${getArena(this.arena).name} — get ready` : 'You join the next round',
        hint: '',
```

In `src/client/game/matchState.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/matchState.ts"} -->
```ts
      const gained = mine ? ` · you scored ${mine.gained}` : '';
      return { kind: 'results', title, subtitle: `Next round in ${seconds}${gained}`, hint: '' };
    }
```

with:

```ts
      const gained = mine ? ` · you scored ${mine.gained}` : '';
      return { kind: 'results', title, subtitle: `Next round in ${seconds}${gained}`, hint: 'Vote for the next arena · keys 1 to 4' };
    }
```

In `src/client/ui/format.ts`:

<!-- op {"kind": "edit", "path": "src/client/ui/format.ts"} -->
```ts
import { clamp } from '../../shared/math';
import type { BoardRow } from '../game/matchState';

```

with:

```ts
import { clamp } from '../../shared/math';
import type { BoardRow, MatchView } from '../game/matchState';

```

In `src/client/ui/format.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/format.ts"} -->
```ts
  ]);
}

```

with:

```ts
  ]);
}

/** "no votes", "1 vote", "3 votes" under an arena card. */
export const voteLabel = (count: number): string => {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return n === 0 ? 'no votes' : n === 1 ? '1 vote' : `${n} votes`;
};

/** Everything the vote panel draws, as a string: the panel is rebuilt only when this changes. Empty when there is no vote. */
export function voteSignature(vote: MatchView['vote']): string {
  return vote ? JSON.stringify(vote.options.map((o) => [o.id, o.name, o.count, o.mine])) : '';
}

```

In `src/client/ui/hud.ts` (the panel is rebuilt only when its signature changes, like the board):

<!-- op {"kind": "edit", "path": "src/client/ui/hud.ts"} -->
```ts
import type { Zone } from '../../shared/types';
```

with:

```ts
import type { ArenaId } from '../../shared/arenas';
import type { Zone } from '../../shared/types';
```

In `src/client/ui/hud.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/hud.ts"} -->
```ts
import type { FeedItem, MatchView } from '../game/matchState';
import { boardSignature, hexColor, hpColor, once, zoneColor } from './format';

```

with:

```ts
import type { FeedItem, MatchView } from '../game/matchState';
import { boardSignature, hexColor, hpColor, once, voteLabel, voteSignature, zoneColor } from './format';

```

In `src/client/ui/hud.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/hud.ts"} -->
```ts
  showNotice(text: string): void;
  dispose(): void;
```

with:

```ts
  showNotice(text: string): void;
  /** What to do when the player picks an arena on the vote panel (a click on a card). */
  setVoteHandler(handler: (arena: ArenaId) => void): void;
  dispose(): void;
```

In `src/client/ui/hud.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/hud.ts"} -->
```ts
  const bannerHint = el('div', 'banner-hint', banner);
  const flash = el('div', 'hud-flash', wrap);
```

with:

```ts
  const bannerHint = el('div', 'banner-hint', banner);
  const vote = el('div', 'hud-vote', wrap);
  vote.hidden = true;
  const flash = el('div', 'hud-flash', wrap);
```

In `src/client/ui/hud.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/hud.ts"} -->
```ts

  let boardKey = '';
```

with:

```ts

  let voteHandler: (arena: ArenaId) => void = () => undefined;
  let voteKey = '';
  const drawVote = (view: MatchView): void => {
    const key = voteSignature(view.vote);
    if (key === voteKey) return;
    voteKey = key;
    vote.hidden = view.vote === null;
    vote.replaceChildren();
    if (!view.vote) return;
    el('div', 'vote-title', vote).textContent = 'Vote for the next arena';
    const cards = el('div', 'vote-cards', vote);
    view.vote.options.forEach((o, i) => {
      const card = el('button', `vote-card${o.mine ? ' mine' : ''}`, cards);
      card.type = 'button';
      el('span', 'vote-key', card).textContent = String(i + 1);
      el('span', 'vote-name', card).textContent = o.name;
      el('span', 'vote-count', card).textContent = voteLabel(o.count);
      card.addEventListener('click', () => voteHandler(o.id));
    });
  };

  let boardKey = '';
```

In `src/client/ui/hud.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/hud.ts"} -->
```ts
      }
      setFlash(view.flash.toFixed(2));
```

with:

```ts
      }
      drawVote(view);
      setFlash(view.flash.toFixed(2));
```

In `src/client/ui/hud.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/hud.ts"} -->
```ts
    showNotice: notify,
    dispose() {
```

with:

```ts
    showNotice: notify,
    setVoteHandler(handler) {
      voteHandler = handler;
    },
    dispose() {
```

In `src/client/index.html`, the panel's style (four cards in a row, two by two on a narrow screen):

<!-- op {"kind": "edit", "path": "src/client/index.html"} -->
```html
      }
      .hud-flash {
```

with:

```html
      }
      .hud-vote {
        position: absolute;
        left: 50%;
        top: 52%;
        transform: translateX(-50%);
        width: min(640px, calc(100vw - 32px));
        text-align: center;
        text-shadow: 0 2px 8px #000;
      }
      .vote-title {
        font-size: 15px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .vote-cards {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 10px;
        margin-top: 10px;
      }
      .vote-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        padding: 12px 8px;
        color: var(--ink);
        font: inherit;
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 10px;
        cursor: pointer;
      }
      .vote-card:hover {
        border-color: var(--accent);
      }
      .vote-card.mine {
        border-color: var(--accent);
        box-shadow: 0 0 0 2px var(--accent);
      }
      .vote-key {
        font-size: 12px;
        color: var(--muted);
      }
      .vote-name {
        font-size: 16px;
        font-weight: 700;
      }
      .vote-count {
        font-size: 13px;
        color: var(--muted);
        font-variant-numeric: tabular-nums;
      }
      @media (max-width: 520px) {
        .vote-cards {
          grid-template-columns: repeat(2, 1fr);
        }
      }
      .hud-flash {
```

In `src/client/game/gameClient.ts`, a click or a key from 1 to 4 asks the server for the arena (only when the state says a vote is open), and the tally goes to the state:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
import { getArena } from '../../shared/arenas';
```

with:

```ts
import { ARENA_IDS, getArena, type ArenaId } from '../../shared/arenas';
```

and:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
    this.audio.setVolume(this.settings.volume);
```

with:

```ts
    opts.hud.setVoteHandler((arena) => this.castVote(arena));
    this.audio.setVolume(this.settings.volume);
```

and:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
      case 'phase':
        this.session.onPhase(m.phase);
```

with:

```ts
      case 'votes':
        this.match.onVotes(m);
        break;
      case 'phase':
        this.session.onPhase(m.phase);
```

and:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
  private applyRoster(): void {
```

with:

```ts
  /** A click on an arena card, or a key from 1 to 4: asks the server for it when a vote is open. */
  private castVote(arena: ArenaId): void {
    if (this.match.vote(arena)) this.conn.send({ t: 'vote', arena });
  }

  private applyRoster(): void {
```

and:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
    const direction = cycleDirection(code);
    if (direction !== 0 && !this.driving)
```

with:

```ts
    const digit = /^(?:Digit|Numpad)([1-4])$/.exec(code);
    if (digit) {
      this.castVote(ARENA_IDS[Number(digit[1]) - 1]!);
      return;
    }
    const direction = cycleDirection(code);
    if (direction !== 0 && !this.driving)
```

- [ ] **Step 4: Run the tests, then the whole suite**

Run: `npx vitest run tests/client/matchState.test.ts tests/client/format.test.ts`
Expected: both pass

<!-- check {"cmd": "npx vitest run tests/client/matchState.test.ts tests/client/format.test.ts", "outcome": "pass"} -->

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 775} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(client): the arena in the countdown banner and a vote panel on the results screen \u2014 click or keys 1 to 4"
```

<!-- commit "feat(client): the arena in the countdown banner and a vote panel on the results screen \u2014 click or keys 1 to 4" -->

---

### Task 60: Every arena on screen: the scene is built from the layout

**Files:**
- Create: `src/client/game/arenaView.ts`, `tests/client/arenaView.test.ts`
- Modify: `src/client/game/scene.ts`, `src/client/game/spectator.ts`, `src/client/game/skidMarks.ts`, `src/client/game/fx.ts`, `src/client/game/gameClient.ts`, `tests/client/spectator.test.ts`, `tests/client/skidMarks.test.ts`, `tests/client/fx.test.ts`

**Interfaces:**
- Consumes: `ArenaDef`, `look`, `boundsRadius`, `boundsHalfSize`, `clampToBounds`, `quatFromYawPitch` (Task 54), `createDressing` (Plan 6), `GameScene`, `SpectatorCamera`, `SkidMarks`, `FxDirector`.
- Produces: `createArenaView(def, { crowd, groundTexture? })` → `{ group, setCrowd, dispose }`; `GameScene.setArena(def)`; `computeOrbitView(target, angle, bounds?)` and `SpectatorCamera.setBounds`; `worldToTexture(x, z, extent?)`, `SkidMarks.setExtent`, `MarkSurface.setExtent?`; `FxDirector.setArena(def)`; `window.__derby.debug().arena`.

- [ ] **Step 1: Write the tests**

The arena view is tested in Node with no canvas (the ground texture is a parameter): one mesh per box of the layout, at the collider's place and with the collider's rotation (a ramp's +X end really is the high one), a ground that reaches well past the walls, a crowd, stands and floodlights only in the Stadium, four container colours, one material per kind of box, and everything freed on `dispose`. The spectator camera stays 1.5 m inside the edge of a rectangle (and may go further out over the wider lake); the tyre marks map the world by the extent they are given, draw at the new scale and tell the surface; the effects director sizes them from the arena.

Create `tests/client/arenaView.test.ts`:

<!-- op {"kind": "create", "path": "tests/client/arenaView.test.ts"} -->
```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createArenaView } from '../../src/client/game/arenaView';
import { ARENA_IDS, ARENAS, boundsRadius } from '../../src/shared/arenas';
import { quatFromYawPitch } from '../../src/shared/math';

const boxMeshes = (group: THREE.Group): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  group.traverse((o) => {
    if (o instanceof THREE.Mesh && o.userData.kind !== undefined) out.push(o);
  });
  return out;
};

describe('createArenaView', () => {
  for (const id of ARENA_IDS) {
    const arena = ARENAS[id];
    describe(arena.name, () => {
      it('draws one mesh for every wall and obstacle of the layout, where the collider is', () => {
        const view = createArenaView(arena, { crowd: true });
        const meshes = boxMeshes(view.group);
        expect(meshes).toHaveLength(arena.boxes.length);
        meshes.forEach((m, i) => {
          const b = arena.boxes[i]!;
          expect(m.position.toArray()).toEqual([b.x, b.y, b.z]);
          const q = quatFromYawPitch(b.yaw, b.pitch ?? 0);
          expect(m.quaternion.angleTo(new THREE.Quaternion(q.x, q.y, q.z, q.w))).toBeLessThan(1e-5);
          expect((m.geometry as THREE.BoxGeometry).parameters).toMatchObject({ width: b.hx * 2, height: b.hy * 2, depth: b.hz * 2 });
          expect(m.userData.kind).toBe(b.kind);
        });
        view.dispose();
      });

      it('has a ground that reaches well past the walls', () => {
        const view = createArenaView(arena, { crowd: true });
        const ground = view.group.getObjectByName('ground') as THREE.Mesh;
        expect((ground.geometry as THREE.CircleGeometry).parameters.radius).toBeGreaterThan(boundsRadius(arena.bounds) + 20);
        view.dispose();
      });
    });
  }

  it('lifts the high end of a ramp: a positive pitch raises the +X end of the box', () => {
    const view = createArenaView(ARENAS.port, { crowd: false });
    const ramp = boxMeshes(view.group).find((m) => m.userData.kind === 'ramp' && Math.abs(m.rotation.y) < 0.01)!;
    const along = new THREE.Vector3(1, 0, 0).applyQuaternion(ramp.quaternion);
    expect(along.y).toBeGreaterThan(0.05);
    view.dispose();
  });

  it('dresses only the Stadium with a crowd, which the graphics preset can switch off', () => {
    const stadium = createArenaView(ARENAS.stadium, { crowd: true });
    expect(stadium.group.getObjectByName('dressing')).toBeDefined();
    stadium.setCrowd(false);
    stadium.setCrowd(true);
    stadium.dispose();
    for (const id of ['ice', 'quarry', 'port'] as const) {
      const view = createArenaView(ARENAS[id], { crowd: true });
      expect(view.group.getObjectByName('dressing')).toBeUndefined();
      view.setCrowd(false); // nothing to switch, and no error
      view.dispose();
    }
  });

  it('colours the shipping containers in four colours by their tint', () => {
    const view = createArenaView(ARENAS.port, { crowd: false });
    const colours = new Set(boxMeshes(view.group).filter((m) => m.userData.kind === 'container').map((m) => ((m.material as THREE.MeshStandardMaterial).color.getHex())));
    expect(colours.size).toBe(4);
    view.dispose();
  });

  it('frees its geometry and materials when it is disposed, and shares a material among boxes of one kind', () => {
    const view = createArenaView(ARENAS.ice, { crowd: true });
    const disposed = { geometry: 0, material: 0 };
    const seen = new Set<THREE.Material>();
    view.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.addEventListener('dispose', () => disposed.geometry++);
      for (const m of [o.material].flat()) {
        if (!seen.has(m)) m.addEventListener('dispose', () => disposed.material++);
        seen.add(m);
      }
    });
    const walls = boxMeshes(view.group).filter((m) => m.userData.kind === 'wall');
    expect(new Set(walls.map((m) => m.material)).size).toBe(1);
    view.dispose();
    expect(disposed.geometry).toBeGreaterThan(boxMeshes(view.group).length - 1);
    expect(disposed.material).toBe(seen.size);
  });
});
```

In `tests/client/spectator.test.ts`:

<!-- op {"kind": "edit", "path": "tests/client/spectator.test.ts"} -->
```ts
import { describe, expect, it } from 'vitest';
import { MAX_CAMERA_RADIUS, SpectatorCamera, computeOrbitView, cycleDirection, nextTarget, type Followable } from '../../src/client/game/spectator';
```

with:

```ts
import { describe, expect, it } from 'vitest';
import { ARENAS, boundsClearance } from '../../src/shared/arenas';
import { MAX_CAMERA_RADIUS, SpectatorCamera, computeOrbitView, cycleDirection, nextTarget, type Followable } from '../../src/client/game/spectator';
```

In `tests/client/spectator.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/spectator.test.ts"} -->
```ts

describe('SpectatorCamera', () => {
```

with:

```ts

describe('computeOrbitView in other arenas', () => {
  it('keeps the camera inside a rectangular yard, a metre and a half from its wall', () => {
    for (const target of [{ x: 40, y: 1, z: 0 }, { x: -40, y: 1, z: 28 }, { x: 0, y: 1, z: -30 }]) {
      for (const angle of [0, 1, 2, 3, 4, 5]) {
        const v = computeOrbitView(target, angle, ARENAS.port.bounds);
        expect(boundsClearance(ARENAS.port.bounds, v.position.x, v.position.z)).toBeGreaterThanOrEqual(1.5 - 1e-6);
      }
    }
  });

  it('lets the camera go further out on the wider lake than in the Stadium', () => {
    const target = { x: 44, y: 1, z: 0 };
    const lake = computeOrbitView(target, 0, ARENAS.ice.bounds);
    const stadium = computeOrbitView(target, 0);
    expect(Math.hypot(lake.position.x, lake.position.z)).toBeGreaterThan(Math.hypot(stadium.position.x, stadium.position.z));
  });

  it('is told the arena of each round by the spectator camera', () => {
    const cam = new SpectatorCamera();
    cam.setBounds(ARENAS.port.bounds);
    const cars = [{ slot: 0, alive: true, visible: true, pos: { x: 44, y: 1, z: 0 } }];
    const v = cam.view(cars, 0.1)!;
    expect(boundsClearance(ARENAS.port.bounds, v.position.x, v.position.z)).toBeGreaterThanOrEqual(1.5 - 1e-6);
  });
});

describe('SpectatorCamera', () => {
```

In `tests/client/skidMarks.test.ts`:

<!-- op {"kind": "edit", "path": "tests/client/skidMarks.test.ts"} -->
```ts
    expect(skidStrength({ ...rolling, lateral: Number.NaN, handbrake: false })).toBe(0);
  });
```

with:

```ts
    expect(skidStrength({ ...rolling, lateral: Number.NaN, handbrake: false })).toBe(0);
  });
});

describe('marks on an arena of another size', () => {
  it('maps the world onto the texture by the extent it is given', () => {
    expect(worldToTexture(0, 0, 70)).toEqual({ u: SKID.SIZE / 2, v: SKID.SIZE / 2 });
    expect(worldToTexture(-70, -70, 70)).toEqual({ u: 0, v: 0 });
    expect(worldToTexture(70, 0, 70).u).toBe(SKID.SIZE);
  });

  it('draws with the new scale after the arena changes', () => {
    const surface = new Recorder();
    const marks = new SkidMarks(surface);
    marks.setExtent(70);
    marks.wheel(0, 0, 0, 1);
    marks.wheel(0, 1, 0, 1);
    const [x0, , x1, , width] = surface.lines[0]!;
    expect(x0).toBe(SKID.SIZE / 2);
    expect(x1).toBeCloseTo(SKID.SIZE / 2 + SKID.SIZE / 140, 9);
    expect(width).toBeCloseTo(SKID.WIDTH * (SKID.SIZE / 140), 9);
  });

  it('tells the surface about the new extent and wipes it', () => {
    const surface = new Recorder();
    const seen: number[] = [];
    (surface as MarkSurface).setExtent = (e) => seen.push(e);
    const marks = new SkidMarks(surface);
    marks.setExtent(64);
    expect(seen).toEqual([64]);
    expect(surface.cleared).toBeGreaterThan(0);
  });
```

In `tests/client/fx.test.ts`:

<!-- op {"kind": "edit", "path": "tests/client/fx.test.ts"} -->
```ts
import { SKID, type MarkSurface } from '../../src/client/game/skidMarks';
import type { LocalImpact } from '../../src/client/net/prediction';
```

with:

```ts
import { SKID, type MarkSurface } from '../../src/client/game/skidMarks';
import { ARENAS } from '../../src/shared/arenas';
import type { LocalImpact } from '../../src/client/net/prediction';
```

In `tests/client/fx.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/fx.test.ts"} -->
```ts
  cleared = 0;
  line(): void {
```

with:

```ts
  cleared = 0;
  extents: number[] = [];
  setExtent(extent: number): void {
    this.extents.push(extent);
  }
  line(): void {
```

In `tests/client/fx.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/fx.test.ts"} -->
```ts
    expect(t.ctx.nodes.filter((n) => n.started > 0 && n.stopped > 0)).toHaveLength(2); // the two oscillators of the wreck's engine
  });
});

```

with:

```ts
    expect(t.ctx.nodes.filter((n) => n.started > 0 && n.stopped > 0)).toHaveLength(2); // the two oscillators of the wreck's engine
  });
});

describe('FxDirector in another arena', () => {
  it('lays the tyre marks over the whole arena it is told about, and starts them blank', () => {
    const t = setup();
    const cleared = t.surface.cleared;
    t.fx.setArena(ARENAS.quarry);
    expect(t.surface.extents).toEqual([64]); // the quarry reaches 62 m along its long axis, and the marks have 2 m to spare
    expect(t.surface.cleared).toBeGreaterThan(cleared);
    t.fx.setArena(ARENAS.stadium);
    expect(t.surface.extents).toEqual([64, SKID.EXTENT]);
  });
});

```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/client/arenaView.test.ts tests/client/spectator.test.ts tests/client/skidMarks.test.ts tests/client/fx.test.ts`
Expected: FAIL — `arenaView.ts` does not exist; the camera, the marks and the effects know one arena only

<!-- check {"cmd": "npx vitest run tests/client/arenaView.test.ts tests/client/spectator.test.ts tests/client/skidMarks.test.ts tests/client/fx.test.ts", "outcome": "fail", "match": "Cannot find module|FAIL|not a function|Failed"} -->

- [ ] **Step 3: Build the scene from the layout**

`src/client/game/arenaView.ts` holds everything that stands in one arena (what `createGameScene` built inline for the Stadium): the ground, a mesh per box with the collider's rotation, one material per kind, and for the Stadium its stands, tyre stacks and floodlight masts. The Blender scenery of the next plan replaces the plain boxes; the physics never depends on it.

Create `src/client/game/arenaView.ts`:

<!-- op {"kind": "create", "path": "src/client/game/arenaView.ts"} -->
```ts
import * as THREE from 'three';
import type { BoxSpec } from '../../shared/arena';
import { boundsRadius, type ArenaDef } from '../../shared/arenas';
import { ARENA } from '../../shared/constants';
import { quatFromYawPitch } from '../../shared/math';
import { createDressing } from './dressing';

export interface ArenaViewOptions {
  /** Whether the crowd is drawn (the graphics preset). */
  crowd: boolean;
  /** Makes the texture of the ground (the Stadium's dirt). Without it the ground is the layout's plain colour. */
  groundTexture?: () => THREE.Texture;
}

/** Everything that stands in one arena: the ground, the walls and obstacles drawn from the layout, and the Stadium's dressing. */
export interface ArenaView {
  readonly group: THREE.Group;
  /** Shows or hides the crowd (only the Stadium has one). */
  setCrowd(visible: boolean): void;
  dispose(): void;
}

/** The four colours of a shipping container, indexed by the box's `tint`. */
const CONTAINER_COLOURS = [0xb5532a, 0x2f6aa8, 0x3f8a4f, 0xc9a227] as const;

function boxMesh(b: BoxSpec, material: THREE.Material, geometries: THREE.BufferGeometry[]): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(b.hx * 2, b.hy * 2, b.hz * 2);
  geometries.push(geometry);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(b.x, b.y, b.z);
  const q = quatFromYawPitch(b.yaw, b.pitch ?? 0); // the very rotation the physics collider has
  mesh.quaternion.set(q.x, q.y, q.z, q.w);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.kind = b.kind ?? 'block';
  return mesh;
}

export function createArenaView(def: ArenaDef, options: ArenaViewOptions): ArenaView {
  const group = new THREE.Group();
  group.name = `arena-${def.id}`;
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const texture = options.groundTexture?.();
  if (texture) textures.push(texture);
  const groundMaterial = new THREE.MeshStandardMaterial(texture ? { map: texture, roughness: 1, metalness: 0 } : { color: def.look.ground, roughness: 1, metalness: 0 });
  materials.push(groundMaterial);
  const groundGeometry = new THREE.CircleGeometry(boundsRadius(def.bounds) + 30, 96);
  geometries.push(groundGeometry);
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.name = 'ground';
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // one material per kind of box (and per container colour): the walls are one draw state, not forty
  const byKind = new Map<string, THREE.Material>();
  const materialFor = (b: BoxSpec): THREE.Material => {
    const kind = b.kind ?? 'block';
    const key = kind === 'container' ? `container-${(b.tint ?? 0) % CONTAINER_COLOURS.length}` : kind;
    let m = byKind.get(key);
    if (!m) {
      const colour = kind === 'wall' ? def.look.wall : kind === 'container' ? CONTAINER_COLOURS[(b.tint ?? 0) % CONTAINER_COLOURS.length]! : def.look.block;
      m = new THREE.MeshStandardMaterial({ color: colour, roughness: kind === 'wall' ? 0.9 : 0.85, metalness: kind === 'container' ? 0.3 : 0.05 });
      byKind.set(key, m);
      materials.push(m);
    }
    return m;
  };
  for (const b of def.boxes) group.add(boxMesh(b, materialFor(b), geometries));

  // the Stadium alone has its stands, tyre stacks and floodlight masts (the other arenas get their scenery from Blender, Plan 9)
  let dressing: ReturnType<typeof createDressing> | null = null;
  if (def.id === 'stadium') {
    dressing = createDressing();
    dressing.group.name = 'dressing';
    dressing.setCrowd(options.crowd);
    group.add(dressing.group);
    const poleGeometry = new THREE.CylinderGeometry(0.3, 0.4, 16, 8);
    const lampGeometry = new THREE.BoxGeometry(3, 0.6, 1.2);
    geometries.push(poleGeometry, lampGeometry);
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.8 });
    const lampMaterial = new THREE.MeshStandardMaterial({ color: 0xfff3d0, emissive: 0xfff3d0, emissiveIntensity: 3 });
    materials.push(poleMaterial, lampMaterial);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const r = ARENA.RADIUS + 12;
      const pole = new THREE.Mesh(poleGeometry, poleMaterial);
      pole.position.set(Math.cos(a) * r, 8, Math.sin(a) * r);
      const lamp = new THREE.Mesh(lampGeometry, lampMaterial);
      lamp.position.set(Math.cos(a) * r, 16.3, Math.sin(a) * r);
      lamp.lookAt(0, 0, 0);
      group.add(pole, lamp);
    }
  }

  return {
    group,
    setCrowd: (visible) => dressing?.setCrowd(visible),
    dispose: () => {
      dressing?.dispose();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
      group.removeFromParent();
    },
  };
}
```

In `src/client/game/scene.ts` (the scene keeps the sky, fog, hemisphere light and sun and sets them from the arena's `look`; `setArena` swaps the view; the shadow camera covers the arena; the graphics preset's crowd choice is kept for the next arena):

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { BoxSpec } from '../../shared/arena';
import { DEFAULT_ARENA } from '../../shared/arenas';
import { ARENA } from '../../shared/constants';
import type { QualityProfile } from '../settings';
```

with:

```ts
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { boundsRadius, DEFAULT_ARENA, type ArenaDef } from '../../shared/arenas';
import type { QualityProfile } from '../settings';
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
import { COMPOSER_SAMPLES, createComposerTarget, needsComposer } from './composer';
import { createDressing } from './dressing';
import { needsResize } from './viewport';
```

with:

```ts
import { COMPOSER_SAMPLES, createComposerTarget, needsComposer } from './composer';
import { createArenaView, type ArenaView } from './arenaView';
import { needsResize } from './viewport';
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
  applyQuality(profile: QualityProfile): void;
  dispose(): void;
```

with:

```ts
  applyQuality(profile: QualityProfile): void;
  /** Builds the arena of the coming round (ground, walls, obstacles, scenery) and sets the sky, fog and light to its look. */
  setArena(arena: ArenaDef): void;
  dispose(): void;
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts

function boxMesh(b: BoxSpec, material: THREE.Material, geometries: THREE.BufferGeometry[]): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(b.hx * 2, b.hy * 2, b.hz * 2);
  geometries.push(geometry);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(b.x, b.y, b.z);
  mesh.rotation.y = b.yaw; // same yaw convention as the physics colliders (rotation about +Y)
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createGameScene(canvas: HTMLCanvasElement): GameScene {
```

with:

```ts

export function createGameScene(canvas: HTMLCanvasElement): GameScene {
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
  const scene = new THREE.Scene();
  const night = new THREE.Color(0x0b1226);
  scene.background = night;
  scene.fog = new THREE.Fog(night, 70, 240);

```

with:

```ts
  const scene = new THREE.Scene();
  const sky = new THREE.Color();
  scene.background = sky;
  const fog = new THREE.Fog(sky, 70, 240);
  scene.fog = fog;

```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts

  scene.add(new THREE.HemisphereLight(0x9db4ff, 0x3b2c1c, 0.75));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
  sun.position.set(35, 70, 25);
```

with:

```ts

  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x444444, 0.75);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(35, 70, 25);
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
  sun.shadow.mapSize.set(2048, 2048);
  const extent = ARENA.RADIUS + 8;
  sun.shadow.camera.left = -extent;
  sun.shadow.camera.right = extent;
  sun.shadow.camera.top = extent;
  sun.shadow.camera.bottom = -extent;
  sun.shadow.camera.near = 10;
```

with:

```ts
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
  sun.shadow.camera.far = 180;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
```

with:

```ts
  sun.shadow.camera.far = 180;
  sun.shadow.bias = -0.0004;
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const dirt = dirtTexture();
  textures.push(dirt);
  const groundMaterial = new THREE.MeshStandardMaterial({ map: dirt, roughness: 1, metalness: 0 });
  materials.push(groundMaterial);
  const groundGeometry = new THREE.CircleGeometry(ARENA.RADIUS + 30, 96);
  geometries.push(groundGeometry);
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const concrete = new THREE.MeshStandardMaterial({ color: 0x8a8d91, roughness: 0.9, metalness: 0.05 });
  materials.push(concrete);
  for (const seg of DEFAULT_ARENA.boxes) if (seg.kind === 'wall') scene.add(boxMesh(seg, concrete, geometries));
  const blocks = new THREE.MeshStandardMaterial({ color: 0x9a9da1, roughness: 0.85, metalness: 0.05 });
  materials.push(blocks);
  for (const o of DEFAULT_ARENA.boxes) if (o.kind !== 'wall') scene.add(boxMesh(o, blocks, geometries));

  // The stands with their crowd, the tyre stacks outside the barrier, and a few floodlight masts.
  const dressing = createDressing();
  scene.add(dressing.group);

  const poleGeometry = new THREE.CylinderGeometry(0.3, 0.4, 16, 8);
  const lampGeometry = new THREE.BoxGeometry(3, 0.6, 1.2);
  geometries.push(poleGeometry, lampGeometry);
  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.8 });
  const lampMaterial = new THREE.MeshStandardMaterial({ color: 0xfff3d0, emissive: 0xfff3d0, emissiveIntensity: 3 });
  materials.push(poleMaterial, lampMaterial);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const r = ARENA.RADIUS + 12;
    const pole = new THREE.Mesh(poleGeometry, poleMaterial);
    pole.position.set(Math.cos(a) * r, 8, Math.sin(a) * r);
    const lamp = new THREE.Mesh(lampGeometry, lampMaterial);
    lamp.position.set(Math.cos(a) * r, 16.3, Math.sin(a) * r);
    lamp.lookAt(0, 0, 0);
    scene.add(pole, lamp);
  }

```

with:

```ts

  let crowdVisible = true; // the graphics preset's choice, kept for the next arena
  let view: ArenaView | null = null;
  const setArena = (def: ArenaDef): void => {
    view?.dispose();
    view = createArenaView(def, { crowd: crowdVisible, groundTexture: def.id === 'stadium' ? dirtTexture : undefined });
    scene.add(view.group);
    const look = def.look;
    sky.set(look.sky);
    fog.color.set(look.fog);
    fog.near = look.fogNear;
    fog.far = look.fogFar;
    hemisphere.color.set(look.hemiSky);
    hemisphere.groundColor.set(look.hemiGround);
    sun.color.set(look.sun);
    sun.intensity = look.sunIntensity;
    const extent = boundsRadius(def.bounds) + 8; // the floodlight's shadow covers the whole playable area
    sun.shadow.camera.left = -extent;
    sun.shadow.camera.right = extent;
    sun.shadow.camera.top = extent;
    sun.shadow.camera.bottom = -extent;
    sun.shadow.camera.updateProjectionMatrix();
  };
  setArena(DEFAULT_ARENA);

```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
      bloom.enabled = bloomWanted && !bloomForcedOff;
      dressing.setCrowd(profile.crowd);
    },
```

with:

```ts
      bloom.enabled = bloomWanted && !bloomForcedOff;
      crowdVisible = profile.crowd;
      view?.setCrowd(profile.crowd);
    },
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
    },
    dispose: () => {
```

with:

```ts
    },
    setArena,
    dispose: () => {
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
    dispose: () => {
      dressing.dispose();
      composer.dispose();
```

with:

```ts
    dispose: () => {
      view?.dispose();
      composer.dispose();
```

In `src/client/game/scene.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/scene.ts"} -->
```ts
      composer.dispose();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
      renderer.dispose();
```

with:

```ts
      composer.dispose();
      renderer.dispose();
```

In `src/client/game/spectator.ts`:

<!-- op {"kind": "edit", "path": "src/client/game/spectator.ts"} -->
```ts
import { ARENA } from '../../shared/constants';
```

with:

```ts
import { clampToBounds, DEFAULT_ARENA, type Bounds } from '../../shared/arenas';
import { ARENA } from '../../shared/constants';
```

In `src/client/game/spectator.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/spectator.ts"} -->
```ts
const ORBIT_SPEED = 0.25; // rad/s: a lap every 25 s
/** The camera never goes further from the arena's centre than this: outside the barrier all it would see is the back of the wall. */
```

with:

```ts
const ORBIT_SPEED = 0.25; // rad/s: a lap every 25 s
/** How far inside the playable area's edge the camera stays (m). */
const CAMERA_INSET = 1.5;
/** The camera never goes further from the arena's centre than this: outside the barrier all it would see is the back of the wall. */
```

In `src/client/game/spectator.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/spectator.ts"} -->
```ts
/** The camera never goes further from the arena's centre than this: outside the barrier all it would see is the back of the wall. */
export const MAX_CAMERA_RADIUS = ARENA.RADIUS - 1.5;

```

with:

```ts
/** The camera never goes further from the arena's centre than this: outside the barrier all it would see is the back of the wall. */
export const MAX_CAMERA_RADIUS = ARENA.RADIUS - CAMERA_INSET;

```

In `src/client/game/spectator.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/spectator.ts"} -->
```ts

/** Where to put the camera to look at a car from `angle` radians around it (0 = on the +X side). */
export function computeOrbitView(target: Vec3, angle: number): ChaseView {
  let x = target.x + Math.cos(angle) * ORBIT_RADIUS;
  let z = target.z + Math.sin(angle) * ORBIT_RADIUS;
  const r = Math.hypot(x, z);
  if (r > MAX_CAMERA_RADIUS) {
    x *= MAX_CAMERA_RADIUS / r;
    z *= MAX_CAMERA_RADIUS / r;
  }
  return {
```

with:

```ts

/** Where to put the camera to look at a car from `angle` radians around it (0 = on the +X side), inside `bounds` (the arena's). */
export function computeOrbitView(target: Vec3, angle: number, bounds: Bounds = DEFAULT_ARENA.bounds): ChaseView {
  const { x, z } = clampToBounds(bounds, target.x + Math.cos(angle) * ORBIT_RADIUS, target.z + Math.sin(angle) * ORBIT_RADIUS, CAMERA_INSET);
  return {
```

In `src/client/game/spectator.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/spectator.ts"} -->
```ts
  private lookAt: Vec3 | null = null;

```

with:

```ts
  private lookAt: Vec3 | null = null;
  private bounds: Bounds = DEFAULT_ARENA.bounds;

  /** The playable area of the round's arena, which the camera stays inside. */
  setBounds(bounds: Bounds): void {
    this.bounds = bounds;
  }

```

In `src/client/game/spectator.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/spectator.ts"} -->
```ts
    this.angle += Math.max(0, Number.isFinite(dt) ? dt : 0) * ORBIT_SPEED;
    const want = computeOrbitView(car.pos, this.angle);
    if (!this.position || !this.lookAt) {
```

with:

```ts
    this.angle += Math.max(0, Number.isFinite(dt) ? dt : 0) * ORBIT_SPEED;
    const want = computeOrbitView(car.pos, this.angle, this.bounds);
    if (!this.position || !this.lookAt) {
```

In `src/client/game/skidMarks.ts`:

<!-- op {"kind": "edit", "path": "src/client/game/skidMarks.ts"} -->
```ts
/** Where a world point lands on the marks texture (pixels; x to the right, y down as canvases do), for the plane the marks are drawn on. */
export function worldToTexture(x: number, z: number): { u: number; v: number } {
  const scale = SKID.SIZE / (2 * SKID.EXTENT);
  return { u: (x + SKID.EXTENT) * scale, v: (z + SKID.EXTENT) * scale };
}
```

with:

```ts
/** Where a world point lands on the marks texture (pixels; x to the right, y down as canvases do), for the plane the marks are drawn on. */
export function worldToTexture(x: number, z: number, extent: number = SKID.EXTENT): { u: number; v: number } {
  const scale = SKID.SIZE / (2 * extent);
  return { u: (x + extent) * scale, v: (z + extent) * scale };
}
```

In `src/client/game/skidMarks.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/skidMarks.ts"} -->
```ts
  clear(): void;
}
```

with:

```ts
  clear(): void;
  /** The marks now cover a square of half-width `extent` metres (another arena); the picture on it is wiped. */
  setExtent?(extent: number): void;
}
```

In `src/client/game/skidMarks.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/skidMarks.ts"} -->
```ts
  private dirty = false;

```

with:

```ts
  private dirty = false;
  private extent: number = SKID.EXTENT;

```

In `src/client/game/skidMarks.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/skidMarks.ts"} -->
```ts

  /** A wheel (`slot * 4 + wheel`) is at (x, z) this frame, skidding with `strength` (0 = not skidding). */
```

with:

```ts

  /** Another arena: the texture covers a square of half-width `extent` metres from now on, and starts blank. */
  setExtent(extent: number): void {
    this.extent = extent;
    this.surface.setExtent?.(extent);
    this.clear();
  }

  /** A wheel (`slot * 4 + wheel`) is at (x, z) this frame, skidding with `strength` (0 = not skidding). */
```

In `src/client/game/skidMarks.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/skidMarks.ts"} -->
```ts
    if (!before || Math.hypot(x - before.x, z - before.z) > SKID.MAX_SEGMENT) return;
    const a = worldToTexture(before.x, before.z);
    const b = worldToTexture(x, z);
    this.surface.line(a.u, a.v, b.u, b.v, SKID.WIDTH * (SKID.SIZE / (2 * SKID.EXTENT)), SKID.ALPHA * clamp(strength, 0, 1));
    this.dirty = true;
```

with:

```ts
    if (!before || Math.hypot(x - before.x, z - before.z) > SKID.MAX_SEGMENT) return;
    const a = worldToTexture(before.x, before.z, this.extent);
    const b = worldToTexture(x, z, this.extent);
    this.surface.line(a.u, a.v, b.u, b.v, SKID.WIDTH * (SKID.SIZE / (2 * this.extent)), SKID.ALPHA * clamp(strength, 0, 1));
    this.dirty = true;
```

In `src/client/game/skidMarks.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/skidMarks.ts"} -->
```ts

  /** Uploads the canvas to the GPU. */
```

with:

```ts

  setExtent(extent: number): void {
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.PlaneGeometry(2 * extent, 2 * extent);
  }

  /** Uploads the canvas to the GPU. */
```

In `src/client/game/fx.ts`:

<!-- op {"kind": "edit", "path": "src/client/game/fx.ts"} -->
```ts
import * as THREE from 'three';
import { ARENA, COMBAT } from '../../shared/constants';
```

with:

```ts
import * as THREE from 'three';
import { boundsHalfSize, type ArenaDef } from '../../shared/arenas';
import { ARENA, COMBAT } from '../../shared/constants';
```

In `src/client/game/fx.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/fx.ts"} -->
```ts
    for (const h of log) this.wear(h, false);
  }
```

with:

```ts
    for (const h of log) this.wear(h, false);
  }

  /** The arena of the coming round: the tyre marks cover all of it (a little beyond its walls) and start blank. */
  setArena(arena: ArenaDef): void {
    this.marks.setExtent(boundsHalfSize(arena.bounds) + 2);
    this.options.marks.upload();
  }
```

In `src/client/game/gameClient.ts` (the scene, the marks and the camera are rebuilt for an arena only when the round's arena is not the one already standing):

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
  private statsVisible = false;
  private raf = 0;
```

with:

```ts
  private statsVisible = false;
  /** The arena the scene is built for (the Stadium until a welcome or roster says otherwise). */
  private arenaId: ArenaId = 'stadium';
  private raf = 0;
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
        this.roster = m.players;
        this.session.onWelcome(m.you, m.epoch, m.phase?.phase ?? null, getArena(m.arena));
```

with:

```ts
        this.roster = m.players;
        this.enterArena(m.arena);
        this.session.onWelcome(m.you, m.epoch, m.phase?.phase ?? null, getArena(m.arena));
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
        this.mySlot = m.you; // slots are per round
        this.session.onRoster(m.epoch, m.you, getArena(m.arena)); // a new world: drop everything buffered or predicted
```

with:

```ts
        this.mySlot = m.you; // slots are per round
        this.enterArena(m.arena);
        this.session.onRoster(m.epoch, m.you, getArena(m.arena)); // a new world: drop everything buffered or predicted
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts

  /** A click on an arena card, or a key from 1 to 4: asks the server for it when a vote is open. */
```

with:

```ts

  /** Builds the scene (and the marks, and the spectator's limits) for the arena of the round, when it is not the one already standing. */
  private enterArena(id: ArenaId): void {
    if (id === this.arenaId) return;
    this.arenaId = id;
    const arena = getArena(id);
    this.opts.gs.setArena(arena);
    this.fx.setArena(arena);
    this.spectator.setBounds(arena.bounds);
  }

  /** A click on an arena card, or a key from 1 to 4: asks the server for it when a vote is open. */
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
      epoch: this.epoch,
      joined: this.joined,
```

with:

```ts
      epoch: this.epoch,
      arena: this.arenaId,
      joined: this.joined,
```

- [ ] **Step 4: Run the tests, then the whole suite**

Run: `npx vitest run tests/client`
Expected: all client tests pass

<!-- check {"cmd": "npx vitest run tests/client", "outcome": "pass"} -->

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 794} -->

- [ ] **Step 5: Look at every arena in a real browser**

WebGL only animates in a visible browser: use the Playwright browser, not the app's hidden pane. `npm run build`, then a server of your own on a private port with short rounds so the vote comes round quickly: `PORT=18260 STATIC_DIR=dist/client BOT_FILL=3 COUNTDOWN_SECONDS=3 ROUND_SECONDS=15 RESULTS_SECONDS=12 node dist/server/index.js`. Open `http://localhost:18260/?auto=quick&name=Tester` at 1280x720. Check, and write what you saw in the ledger:

1. `window.__derby.debug().arena` names the arena of the round and the scene is that arena (the first round is drawn from the room's seed, so it can be any of the four).
2. During the results the vote panel shows four cards; pressing `2`, `3` or `4` highlights that card and moves the count to "1 vote"; in the next round `debug().arena` is the one you voted for. Do this once for the Frozen Lake, the Mud Quarry and the Container Port, and take a screenshot of each: the lake is pale with low walls and blocks of ice, the quarry is an oval pit with a mound and four ramps, the port has coloured containers and two ramps facing each other — and **a ramp's high end is the end the picture shows high**.
3. Drive a lap on each (the keys): the ice is slippery, the mud drags, the port grips; a car leaving the area is eliminated, a car in a corner of the port's rectangle is not.
4. `renderer` draw calls and triangles (`debug()`) are in the same range in the Stadium as before (about 440 draw calls on High with eight bots), and after ten arena changes they are not growing.
5. No console errors.

Stop the server.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(client): the scene, the camera and the tyre marks are built for the arena of the round \u2014 ground, walls, ramps, containers and look from the layout"
```

<!-- commit "feat(client): the scene, the camera and the tyre marks are built for the arena of the round \u2014 ground, walls, ramps, containers and look from the layout" -->

---

### Task 61: The retune: a little faster, a bit more robust

**Files:**
- Modify: `src/shared/constants.ts`, `tests/determinism.test.ts`, `tests/combat.test.ts`, `tests/damage.test.ts`, `tests/server/roomCombat.test.ts`, `tests/server/roundCombat.test.ts`, `tests/client/predictedWorld.test.ts`

**Interfaces:**
- Consumes: `DRIVE`, `COMBAT` (Plan 1, Plan 4), the recorded hashes (Task 55).
- Produces: `DRIVE.ENGINE` 8960 (+12 %), `DRIVE.MAX_SPEED` 23.5 (+12 %), `DRIVE.STEER_FADE_SPEED` 22 (the steering curve keeps its shape as a fraction of the top speed), `COMBAT.DAMAGE_SCALE` 0.236 (-20 %: a 10 m/s head-on costs 20 HP instead of 25); the four recorded hashes are new, once. Braking, the handbrake, the suspension and the multipliers are unchanged.

- [ ] **Step 1: Change the tuning and see what moves**

The owner asked for cars that are "a little faster and a bit more robust", the same for all four models. This is its own task so that Tasks 54-57 could prove the refactor moved nothing (`10c3a72a`). Four constants (all in `constants.ts`, the only place tuning lives):

In `src/shared/constants.ts`, `ENGINE: 8000,` becomes `ENGINE: 8960,`:

<!-- op {"kind": "edit", "path": "src/shared/constants.ts"} -->
```ts
  ENGINE: 8000,
```

with:

```ts
  ENGINE: 8960,
```

In `src/shared/constants.ts`, `MAX_SPEED: 21,` becomes `MAX_SPEED: 23.5,`:

<!-- op {"kind": "edit", "path": "src/shared/constants.ts"} -->
```ts
  MAX_SPEED: 21,
```

with:

```ts
  MAX_SPEED: 23.5,
```

In `src/shared/constants.ts`, `STEER_FADE_SPEED: 20,` becomes `STEER_FADE_SPEED: 22,`:

<!-- op {"kind": "edit", "path": "src/shared/constants.ts"} -->
```ts
  STEER_FADE_SPEED: 20,
```

with:

```ts
  STEER_FADE_SPEED: 22,
```

In `src/shared/constants.ts`, `DAMAGE_SCALE: 0.295,` becomes `DAMAGE_SCALE: 0.236,`:

<!-- op {"kind": "edit", "path": "src/shared/constants.ts"} -->
```ts
  DAMAGE_SCALE: 0.295,
```

with:

```ts
  DAMAGE_SCALE: 0.236,
```

Run: `npm test`
Expected: FAIL — the tests that pin a damage number (a head-on is 20 HP now, not 25), the four recorded hashes, and a few prediction tolerances that the higher speed pushes just over their limit

<!-- check {"cmd": "npm test", "outcome": "fail", "match": "FAIL|\u00d7|failed"} -->

- [ ] **Step 2: Update what the new numbers move**

Damage-pinned numbers scale by 0.8 (a front hit of 19.2 kN·s is 20.2 HP instead of 25.2; 100 HP minus that is 80 after a head-on). The prediction tests measure how far the client's car strays from the server's: at +12 % speed the worst frame-to-frame jumps in collision-heavy scripts are 1 cm to 3 cm larger and a few more orientation snaps happen (two walls, not one), so those tolerances widen by about half (0.02 → 0.03 m, 0.05 → 0.08 m, 2 → 4 snaps, 95 → 93 % kept) — the numbers that matter for a player (the 95th percentile error, the 5 cm worst case on a perfect network) did not move. The recorded hashes are re-recorded from `npm run hash -- 600 <arena>`.

In `tests/determinism.test.ts`, the four recorded hashes (the new tuning, in each arena):

<!-- op {"kind": "edit", "path": "tests/determinism.test.ts"} -->
```ts
const RECORDED = { stadium: '10c3a72a', ice: '349f6dd7', quarry: 'c44738de', port: '4037f0e3' } as const;
```

with:

```ts
const RECORDED = { stadium: '8719c2e8', ice: '76ca0746', quarry: '170a27e5', port: '454e9fb5' } as const;
```

In `tests/combat.test.ts`:

<!-- op {"kind": "edit", "path": "tests/combat.test.ts"} -->
```ts
      expect(h.impulse).toBeCloseTo(19.2, 9);
      expect(h.damage).toBeGreaterThan(24); // ~21.8 x 1.15 for a front hit
      expect(h.damage).toBeLessThan(27);
    }
```

with:

```ts
      expect(h.impulse).toBeCloseTo(19.2, 9);
      expect(h.damage).toBeGreaterThan(19); // ~17.6 x 1.15 for a front hit
      expect(h.damage).toBeLessThan(22);
    }
```

In `tests/combat.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/combat.test.ts"} -->
```ts
      expect(h.zone).toBe('front');
      expect(h.damage).toBeGreaterThan(22);
      expect(h.damage).toBeLessThan(29);
    }
```

with:

```ts
      expect(h.zone).toBe('front');
      expect(h.damage).toBeGreaterThan(17.5);
      expect(h.damage).toBeLessThan(23.5);
    }
```

In `tests/combat.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/combat.test.ts"} -->
```ts
    expect(hits[0]!.attacker).toBe(-1);
    expect(hits[0]!.damage).toBeGreaterThan(15);
    expect(hits[0]!.damage).toBeLessThan(28);
  });
```

with:

```ts
    expect(hits[0]!.attacker).toBe(-1);
    expect(hits[0]!.damage).toBeGreaterThan(12);
    expect(hits[0]!.damage).toBeLessThan(22.5);
  });
```

In `tests/combat.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/combat.test.ts"} -->
```ts
    for (const slot of [0, 1, 2]) {
      // the pile-up itself costs the pinned car about 16 HP; ten seconds of shoving used to take 450 HP off it
      expect(hits.filter((h) => h.victim === slot).reduce((sum, h) => sum + h.damage, 0)).toBeLessThan(25);
    }
```

with:

```ts
    for (const slot of [0, 1, 2]) {
      // the pile-up itself costs the pinned car about 13 HP; ten seconds of shoving used to take 450 HP off it
      expect(hits.filter((h) => h.victim === slot).reduce((sum, h) => sum + h.damage, 0)).toBeLessThan(20);
    }
```

In `tests/damage.test.ts`:

<!-- op {"kind": "edit", "path": "tests/damage.test.ts"} -->
```ts
    expect(impactDamage(9.5)).toBeLessThan(8); // a firm hit costs a few percent
    expect(impactDamage(19.2)).toBeGreaterThan(20);
    expect(impactDamage(19.2)).toBeLessThan(24); // a hard head-on is about a fifth of a car
  });
```

with:

```ts
    expect(impactDamage(9.5)).toBeLessThan(8); // a firm hit costs a few percent
    expect(impactDamage(19.2)).toBeGreaterThan(16);
    expect(impactDamage(19.2)).toBeLessThan(19.5); // a hard head-on is about a sixth of a car
  });
```

In `tests/server/roomCombat.test.ts`:

<!-- op {"kind": "edit", "path": "tests/server/roomCombat.test.ts"} -->
```ts
      expect(hits.map((h) => [h.victim, h.attacker, h.zone])).toEqual([[0, 1, 'front'], [1, 0, 'front']]);
      expect(hits[0]!.dmg as number).toBeGreaterThan(22);
    }
```

with:

```ts
      expect(hits.map((h) => [h.victim, h.attacker, h.zone])).toEqual([[0, 1, 'front'], [1, 0, 'front']]);
      expect(hits[0]!.dmg as number).toBeGreaterThan(17.5);
    }
```

In `tests/server/roomCombat.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/roomCombat.test.ts"} -->
```ts
    for (const c of last.cars) {
      expect(c.hp).toBeGreaterThan(70);
      expect(c.hp).toBeLessThan(80);
    }
```

with:

```ts
    for (const c of last.cars) {
      expect(c.hp).toBeGreaterThan(75);
      expect(c.hp).toBeLessThanOrEqual(80);
    }
```

In `tests/server/roomCombat.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/roomCombat.test.ts"} -->
```ts
    for (const r of rows) {
      expect(r.score).toBeGreaterThan(22);
      expect(r.score).toBeLessThan(29);
      expect(r.kills).toBe(0);
```

with:

```ts
    for (const r of rows) {
      expect(r.score).toBeGreaterThan(17.5);
      expect(r.score).toBeLessThan(23.5);
      expect(r.kills).toBe(0);
```

In `tests/server/roomCombat.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/roomCombat.test.ts"} -->
```ts
    expect(rows[1]).toMatchObject({ slot: 1, kills: 0, alive: false, hp: 0 });
    expect(rows[1]!.gained).toBeGreaterThan(22); // the wreck still earned the damage it dealt before it went
    const wreck = snapshots(a.socket).at(-1)!.cars.find((c) => c.slot === 1)!;
```

with:

```ts
    expect(rows[1]).toMatchObject({ slot: 1, kills: 0, alive: false, hp: 0 });
    expect(rows[1]!.gained).toBeGreaterThan(17.5); // the wreck still earned the damage it dealt before it went
    const wreck = snapshots(a.socket).at(-1)!.cars.find((c) => c.slot === 1)!;
```

In `tests/server/roundCombat.test.ts`:

<!-- op {"kind": "edit", "path": "tests/server/roundCombat.test.ts"} -->
```ts
      expect(h.dmg).toBeGreaterThan(22);
```

with:

```ts
      expect(h.dmg).toBeGreaterThan(17.5);
```

In `tests/client/predictedWorld.test.ts`:

<!-- op {"kind": "edit", "path": "tests/client/predictedWorld.test.ts"} -->
```ts
    const kept = applied.filter((r) => !r.resetLocal).length;
    expect(kept / applied.length).toBeGreaterThan(0.95); // the deadband keeps the local prediction
  });
```

with:

```ts
    const kept = applied.filter((r) => !r.resetLocal).length;
    expect(kept / applied.length).toBeGreaterThan(0.93); // the deadband keeps the local prediction
  });
```

In `tests/client/predictedWorld.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/predictedWorld.test.ts"} -->
```ts
    l.run(10);
    expect(l.maxVisualJump(0)).toBeLessThan(0.02);
  });
```

with:

```ts
    l.run(10);
    expect(l.maxVisualJump(0)).toBeLessThan(0.03);
  });
```

In `tests/client/predictedWorld.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/predictedWorld.test.ts"} -->
```ts
    l.run(10);
    expect(l.maxVisualJump(1)).toBeLessThan(0.05);
  });
```

with:

```ts
    l.run(10);
    expect(l.maxVisualJump(1)).toBeLessThan(0.08);
  });
```

In `tests/client/predictedWorld.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/predictedWorld.test.ts"} -->
```ts
    l.run(8);
    expect(l.maxVisualJump(0)).toBeLessThan(0.02);
    expect(l.maxVisualJump(1)).toBeLessThan(0.02);
  });
```

with:

```ts
    l.run(8);
    expect(l.maxVisualJump(0)).toBeLessThan(0.03);
    expect(l.maxVisualJump(1)).toBeLessThan(0.03);
  });
```

In `tests/client/predictedWorld.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/predictedWorld.test.ts"} -->
```ts
    expect(at().stallsTotal).toBeGreaterThan(0);
    expect(at().snapsTotal - snapsBefore).toBeLessThanOrEqual(2); // one honest jump back to the server's state, not a stream of them
    const applied = l.results.filter((r) => r.outcome === 'applied');
```

with:

```ts
    expect(at().stallsTotal).toBeGreaterThan(0);
    expect(at().snapsTotal - snapsBefore).toBeLessThanOrEqual(4); // one honest jump back to the server's state, not a stream of them
    const applied = l.results.filter((r) => r.outcome === 'applied');
```

- [ ] **Step 3: Run the whole suite and record the hashes**

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 794} -->

Run: `npm run hash`
Expected: prints `8719c2e8`

<!-- check {"cmd": "npm run hash", "outcome": "pass", "match": "8719c2e8"} -->

Run: `npm run hash -- 600 ice && npm run hash -- 600 quarry && npm run hash -- 600 port`
Expected: prints `76ca0746`, `170a27e5` and `454e9fb5`

<!-- check {"cmd": "npm run hash -- 600 ice && npm run hash -- 600 quarry && npm run hash -- 600 port", "outcome": "pass", "match": "76ca0746[\\s\\S]*170a27e5[\\s\\S]*454e9fb5"} -->

**In a browser:** open any page of the dev or production build and run `await __derby.simHash()` in the console (it must print `8719c2e8`) and `await __derby.simHash(600, 'ice')`, `'quarry'`, `'port'` (the three above). Write all four in the ledger. If a browser disagrees with Node, stop: the build is not deterministic across engines.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(shared): a little faster (+12 % engine and top speed) and a bit more robust (-20 % damage) \u2014 new recorded hashes"
```

<!-- commit "feat(shared): a little faster (+12 % engine and top speed) and a bit more robust (-20 % damage) \u2014 new recorded hashes" -->

---

### Task 62: Documentation

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `docs/deployment.md`

**Interfaces:**
- Consumes: Everything above.
- Produces: The README describes the four arenas, the vote, the 12 s results and the per-arena hash; `CLAUDE.md` says where the layouts live and that each arena has a recorded hash; the deployment guide's default for `RESULTS_SECONDS` is 12.

- [ ] **Step 1: Update the docs**

In `README.md` (the environment variable, the hash check, the round description and a bullet on the arenas):

<!-- op {"kind": "edit", "path": "README.md"} -->
```markdown
- Play across your network: `npm run build && npm start`, then open `http://<your-LAN-IP>:8080/` on each device.
- Server configuration (environment variables): `PORT` (8080), `ALLOWED_ORIGINS` (comma-separated exact origins; default: same host only), `MAX_ROOMS` (12), `MAX_CONNECTIONS` (200), `STATIC_DIR` (`dist/client`), `BOT_FILL` (bots fill a room up to this many cars; default 4, 0 = none), `COUNTDOWN_SECONDS` (5), `ROUND_SECONDS` (240), `RESULTS_SECONDS` (8), `MAX_CONNECTIONS_PER_IP` (16; 0 = no limit), `TRUST_PROXY` (how many reverse proxies stand in front of the server; default 0).
- Debugging: `window.__derby.debug()` in the browser console prints the connection, phase, roster and every car's pose, hit points and whether it is still running.
```

with:

```markdown
- Play across your network: `npm run build && npm start`, then open `http://<your-LAN-IP>:8080/` on each device.
- Server configuration (environment variables): `PORT` (8080), `ALLOWED_ORIGINS` (comma-separated exact origins; default: same host only), `MAX_ROOMS` (12), `MAX_CONNECTIONS` (200), `STATIC_DIR` (`dist/client`), `BOT_FILL` (bots fill a room up to this many cars; default 4, 0 = none), `COUNTDOWN_SECONDS` (5), `ROUND_SECONDS` (240), `RESULTS_SECONDS` (12), `MAX_CONNECTIONS_PER_IP` (16; 0 = no limit), `TRUST_PROXY` (how many reverse proxies stand in front of the server; default 0).
- Debugging: `window.__derby.debug()` in the browser console prints the connection, phase, roster and every car's pose, hit points and whether it is still running.
```

In `README.md`, replace:

<!-- op {"kind": "edit", "path": "README.md"} -->
```markdown
- `window.__derby.netStats` (summarised in the HUD's bottom-left line) shows snapshot rate and jitter, how large corrections were, how often the local prediction was kept, and the cost of the replay. `window.__derby.debug()` adds the predictor's counters. When the server stops acknowledging your inputs (a dead or badly stalled uplink) the line ends with "connection unstable", and your car coasts the way the server plays it until acknowledgements resume.
- Determinism check: `npm run hash` prints the hash of a scripted 600-tick, 3-car simulation (collisions included) run in Node; `await __derby.simHash()` in a browser console must print the same 8 digits.

```

with:

```markdown
- `window.__derby.netStats` (summarised in the HUD's bottom-left line) shows snapshot rate and jitter, how large corrections were, how often the local prediction was kept, and the cost of the replay. `window.__derby.debug()` adds the predictor's counters. When the server stops acknowledging your inputs (a dead or badly stalled uplink) the line ends with "connection unstable", and your car coasts the way the server plays it until acknowledgements resume.
- Determinism check: `npm run hash` prints the hash of a scripted 600-tick, 3-car simulation (collisions included) run in Node in the Stadium; `npm run hash -- 600 ice` (or `quarry`, `port`) does the same in another arena. `await __derby.simHash()` (or `await __derby.simHash(600, 'ice')`) in a browser console must print the same 8 digits. `tests/determinism.test.ts` records all four.

```

In `README.md`, replace:

<!-- op {"kind": "edit", "path": "README.md"} -->
```markdown

- A room plays in rounds: a 5 s countdown (a fresh arena, every car held still), then the round runs until one car is left, four minutes pass (the most HP wins) or every human is out, then 8 s of results. Whoever is in the room when a round starts gets a car; anyone who joins later watches until the next round. A player who joins during a countdown restarts it (at most eight times per round), so friends who join together play together.
- Bots fill a room up to four cars and step aside as humans join.
```

with:

```markdown

- A room plays in rounds: a 5 s countdown (a fresh arena, every car held still), then the round runs until one car is left, four minutes pass (the most HP wins) or every human is out, then 12 s of results, which are also the vote for the next arena. Whoever is in the room when a round starts gets a car; anyone who joins later watches until the next round. A player who joins during a countdown restarts it (at most eight times per round), so friends who join together play together.
- Bots fill a room up to four cars and step aside as humans join.
```

In `README.md`, replace:

<!-- op {"kind": "edit", "path": "README.md"} -->
```markdown
- Bots fill a room up to four cars and step aside as humans join.
- Damage comes from impacts, measured as the impulse the collision transmits. Walls hurt half as much as cars, the rear of a car is its sturdiest side and the front its weakest, and scraping or pushing does nothing. A car is out at 0 HP, after 3 s upside down, after 8 s without moving, or when it leaves the arena; after 20 s without hitting or being hit it loses 2 HP per second until it is in a hit. Cars that are out stay in the arena as wrecks.
```

with:

```markdown
- Bots fill a room up to four cars and step aside as humans join.
- Four arenas: the Stadium (the round dirt bowl), the Frozen Lake (slippery ice, low snow banks, blocks of ice), the Mud Quarry (an oval pit with a raised mound and ramps; the mud drags at the cars and costs a little top speed) and the Container Port (a rectangular yard of shipping containers and two ramps, with a little more grip). Each is a layout file, `src/shared/arenas/<id>.json`, which the server and the browser both build the physics from; `python3 art/arenas/layouts.py` writes them. A room's first round is in a random arena. During the results every player in the room can vote (click a card or press 1 to 4); the arena with the most votes is played next, a tie or no vote at all is settled by the room's seeded random. Bots do not vote. The server and the client agree on the version of the protocol: it is 4.
- Damage comes from impacts, measured as the impulse the collision transmits. Walls hurt half as much as cars, the rear of a car is its sturdiest side and the front its weakest, and scraping or pushing does nothing. A car is out at 0 HP, after 3 s upside down, after 8 s without moving, or when it leaves the arena; after 20 s without hitting or being hit it loses 2 HP per second until it is in a hit. Cars that are out stay in the arena as wrecks.
```

In `CLAUDE.md`:

<!-- op {"kind": "edit", "path": "CLAUDE.md"} -->
```markdown

- `src/shared` — what server and client must agree on: constants (all tuning), protocol, the simulation (`sim.ts`), vehicle, arena, damage.
- `src/server` — `lobby.ts` and `room.ts` (rounds), `round.ts` and `rules.ts` (damage, eliminations), `bots.ts`, `guard.ts` and `limits.ts` (abuse limits), `app.ts` (HTTP and WebSocket), `config.ts` (environment variables).
```

with:

```markdown

- `src/shared` — what server and client must agree on: constants (all tuning), protocol, the simulation (`sim.ts`), vehicle, arena (`arena.ts` builds the physics from an `ArenaDef`; `arenas.ts` loads the four layouts `arenas/<id>.json`, which `art/arenas/layouts.py` writes), damage.
- `src/server` — `lobby.ts` and `room.ts` (rounds), `round.ts` and `rules.ts` (damage, eliminations), `bots.ts`, `guard.ts` and `limits.ts` (abuse limits), `app.ts` (HTTP and WebSocket), `config.ts` (environment variables).
```

In `CLAUDE.md`, replace:

<!-- op {"kind": "edit", "path": "CLAUDE.md"} -->
```markdown
- Axes: forward is +X, up is +Y, right is +Z. The simulation runs at a fixed 1/60 s. Inputs are quantized before they are applied, on both sides.
- The shared simulation is deterministic: no `Math.random`, `Date.now` or `performance.now` in `src/shared`. `npm run hash` must keep printing the same hash in Node and in a browser (`await __derby.simHash()`); if a change moves it, the change altered the physics on purpose or by mistake, so say so.
- Tuning lives only in `src/shared/constants.ts`; it is frozen at run time except in the offline `?sandbox`.
- Any change to what goes over the wire changes `NET.PROTOCOL_VERSION`; the server refuses other versions, and the scripts read the constant.
```

with:

```markdown
- Axes: forward is +X, up is +Y, right is +Z. The simulation runs at a fixed 1/60 s. Inputs are quantized before they are applied, on both sides.
- The shared simulation is deterministic: no `Math.random`, `Date.now` or `performance.now` in `src/shared`. `npm run hash -- 600 <arena>` must keep printing the same hash in Node and in a browser (`await __derby.simHash(600, '<arena>')`), for each of the four arenas (recorded in `tests/determinism.test.ts`); if a change moves it, the change altered the physics on purpose or by mistake, so say so.
- Tuning lives only in `src/shared/constants.ts`; it is frozen at run time except in the offline `?sandbox`. What an arena changes (grip, drag, power of its ground) is in its layout and is read when the cars are built.
- Arena layouts are data: change `art/arenas/layouts.py`, run it, commit the JSON it writes. `tests/arenas.test.ts` checks every layout (spawns, bounds, walls all round).
- Any change to what goes over the wire changes `NET.PROTOCOL_VERSION`; the server refuses other versions, and the scripts read the constant.
```

In `docs/deployment.md`:

<!-- op {"kind": "edit", "path": "docs/deployment.md"} -->
```markdown
| `BOT_FILL` | 4 | bots fill a room up to this many cars (0 = none) |
| `COUNTDOWN_SECONDS`, `ROUND_SECONDS`, `RESULTS_SECONDS` | 5, 240, 8 | round timing |

```

with:

```markdown
| `BOT_FILL` | 4 | bots fill a room up to this many cars (0 = none) |
| `COUNTDOWN_SECONDS`, `ROUND_SECONDS`, `RESULTS_SECONDS` | 5, 240, 12 | round timing |

```

- [ ] **Step 2: Run the whole suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 794} -->

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: the four arenas, the vote, the 12 s results and the hash per arena"
```

<!-- commit "docs: the four arenas, the vote, the 12 s results and the hash per arena" -->

---

## Plan 8 done when

- [ ] `npm run typecheck`, `npm test` (794 tests) and `npm run build` pass, and `npm run smoke` passes (with the `SMOKE_*_PORT` variables next to a live `npm run dev`).
- [ ] `npm run hash` prints `8719c2e8`, and `-- 600 ice`, `quarry`, `port` print `76ca0746`, `170a27e5`, `454e9fb5` — **in Node and in a browser** (`await __derby.simHash(600, '<arena>')`).
- [ ] The browser check of Task 60 was done on a private port: each arena seen, the vote panel working, no console errors, draw calls steady over ten arena changes.
- [ ] **The owner has played it:** driven on the ice and in the mud, voted, and said whether the grip, drag and power numbers and the retune feel right.

**Known limits of this baseline:** plain boxes for scenery (Plan 9); the tyre marks are one colour; no arena thumbnails on the vote panel; the bots do not plan around containers; a vote is a plain majority with no "random" choice among the four; the numbers of the four ground feels and of the retune are first guesses.

**Next:** Plan 9 (the Blender scenery for each arena, the GLB loader with a box fallback, per-arena looks, tyre-mark colours); Plan 10 (the four car models, protocol 5, the menu picker).
