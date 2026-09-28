# Wreckyard Plan 3 — Client Prediction and Rollback (M3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the player's own car respond instantly however slow the connection is, keep collisions with other cars consistent with the server, and hide every correction — while keeping the interpolation-only client as a one-URL fallback. Adds a latency simulator, live network statistics and a Node-vs-browser determinism check.

**Architecture:** The browser runs the same shared `Simulation` as the server for *every* car. Each local 60 Hz tick numbers an input, applies it to the local world and sends it. When a snapshot arrives, all cars are put back to the server's state for the tick that consumed input `ackSeq`, then the inputs the server has not consumed yet are replayed on top ("rollback and re-simulate"); the local car keeps its own more precise state when it already agrees with the server. Corrections are absorbed by a decaying render offset so nothing visibly jumps. All of this lives in DOM-free classes that are tested in Node against a real server `Room` behind a simulated network; `GameClient` only wires them to WebSocket, keyboard and three.js.

**Tech Stack:** as Plans 1–2. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-28-wreckyard-design.md` — "Netcode → Client rollback", "Debug" and the M3 row. **Prerequisite:** Plan 2 complete and reviewed (branch `plan-2-multiplayer-baseline`, HEAD `d6a07b3`, 200 tests). This plan starts on a new branch cut from it.

**Scope notes:**
- `?net=interp` keeps the Plan 2 behaviour as a fallback; prediction is the default.
- The reviewer of Plan 2 recommended a room-monotonic tick in snapshots/pong plus the world's start tick in `roster`. Prediction does not use ticks (it aligns on input sequence numbers), so that protocol change is **not** made here; it only affects the clock offset of the `?net=interp` fallback, which re-learns it after each rebuild (a small hitch). Plan 4's rounds replace the rebuild policy anyway.
- Plan 4 (combat, rounds, bots) will add `hit`/`ko` events and HP; the predictor already carries `hp` and `flags` through from snapshots.

## Rehearsal findings (measured before this plan was written)

I rehearsed every module below in a scratch copy of the Plan 2 code, driving the *real* server `Room` and `Simulation` through a seeded network simulator, and in headless Chromium against the production build. These numbers explain the constants used later:

- **Algorithm works.** With 100 ms round trip and 20 ms jitter, the local car's present position moves by 0.000 m at the median and ≤ 0.02 m at p95 when a snapshot is applied; remote cars (advanced with their last known input) move ≤ 0.08 m at p95. At 200 ms / 40 ms jitter the local p95 stays ≤ 0.002 m and remote p95 ≈ 0.06 m. Replaying costs ≈ 4 µs per car-tick: ≈ 0.15 ms per snapshot for 2 cars, ≈ 0.7 ms in the browser at 10 replayed steps.
- **Quantisation is harmless but real.** Resetting to the *snapshot-quantised* state leaves about 1e-5 m of error per tick, growing to ~1 cm over 120 ticks when a collision is in between. So the spec's deadband is required: a local prediction within **0.05 m / 0.2 m/s** of the server state is kept (≈ 92–100 % of snapshots), never compared for equality.
- **The deadband must switch off near other cars.** Mixing the client's own local state with the server's remote state is harmless in free driving but adds 0.10–0.13 m of error in a head-on collision. Within **10 m** of another car the exact server state is used everywhere: head-on error drops to 0.01–0.02 m.
- **A protocol gap on the server.** After a world rebuild the server discards the player's input queue but left `ackSeq` stale, so the first snapshot claimed *all* inputs since the connection began were still pending. The client then replayed 34 inputs instead of ~7 and the local car jumped by ~1 m. Fix (Task 13): a queue reset acknowledges everything it discards.
- **Visible smoothness.** With the error smoother (τ = 100 ms, snap above 2 m) the worst frame-to-frame jump not explained by a car's own velocity is ≤ 0.004 m for the local car and ≤ 0.05 m for remote cars at 200 ms RTT (raw prediction: 0.025 m and 0.19 m). Frames within 3 frames of a sudden speed change are excluded — real impacts change motion abruptly.
- **The client must initialise the physics engine.** Plan 2's client never called `initPhysics()`; the first browser rehearsal only worked because a debug call had initialised it. Without it every snapshot was silently ignored ("Cannot read properties of undefined (reading 'rawintegrationparameters_new')"). Task 14 adds a clear guard, Task 17 reports the failure, Task 21 awaits the engine and falls back to interpolation if it cannot load.
- **Headline result (headless Chromium, 120 ms simulated lag, 30 ms jitter, 1 % loss):** a key press moves the drawn car after **46 ms in prediction mode versus 305 ms in interpolation mode**.
- **Cross-runtime determinism:** the scripted 600-tick, 3-car run (collisions included) hashed `10c3a72a` in Node 26 *and* in Chromium.

## Global Constraints

- Everything in Plans 1 and 2's Global Constraints still applies (single package, relative imports, exact pins, axes, deterministic simulation path, quantised inputs, `PCFShadowMap`/`Timer`, commits only because the user opted in).
- The local simulation is the shared `Simulation` — no second physics implementation. Prediction constants: deadband **0.05 m and 0.2 m/s**, switched off within **10 m** of another car; input history **240** entries; render smoothing time constant **100 ms**, snap above **2 m** or **0.6 rad**.
- `ackSeq` means "the newest input the server has consumed **or discarded**"; the client replays exactly the inputs newer than it (u32 wrap-aware). The server clamps at most 6 queued inputs; a client must tolerate inputs it sent never being applied.
- Everything that decides prediction (`prediction.ts`, `predictedWorld.ts`, `smoothing.ts`, `netStats.ts`, `latency.ts`) is DOM-free and tested in Node. Nothing in `src/shared` gains DOM or Node dependencies.
- Latency simulation (`?lag=<round-trip ms, ≤ 2000>&jitter=<± ms per direction, ≤ 500>&loss=<% of binary frames, ≤ 50>`): delivery is FIFO like TCP; only binary frames (inputs, snapshots) can be lost; JSON control messages never are. Garbage values are clamped or ignored.
- `DRIVE`, `TIRE` and `SUSPENSION` are frozen at start-up on every route except `?sandbox`.
- The user's own `npm run dev` may be running on ports 8080/5173: never stop it. Use `SMOKE_PROD_PORT`, `SMOKE_SERVER_PORT`, `SMOKE_VITE_PORT` and `WRECKYARD_SERVER_PORT` (or `PORT`) with other ports for anything that needs a server.

## Review Focus

1. **Hostile or nonsensical snapshots reaching the predictor.** NaN/Infinity, unknown or out-of-range slots, an `ackSeq` ahead of the inputs sent, empty snapshots, wrong epoch, duplicate or older ticks. Expected: ignored or dropped without throwing and without touching the prediction; a world that cannot be built for a *valid* snapshot sets a failure the caller can act on. → Task 17 tests.
2. **World changes mid-flight.** Roster change (epoch bump) while inputs are in flight, a car missing from snapshots (departed player), a car that was never in the world, a client that has no car yet (late joiner), the u32 sequence wrap. Expected: no exception, first snapshot of the new epoch re-syncs, unacknowledged inputs are replayed, missing cars are parked and hidden. → Tasks 17 and 19.
3. **Bad networks.** High round trip, jitter, packet loss, a stalled client that later catches up. Expected: corrections stay bounded, nothing visibly teleports, the replay is capped by the history size. → Task 19 loopback tests, Task 21 lag runs.
4. **Corrections too large to hide.** The server moves a car far away. Expected: the drawn car snaps instead of sliding, the event is counted, and the prediction converges within about a second. → Tasks 15 and 19.
5. **URL parameters.** `?lag`, `?jitter`, `?loss`, `?net` with garbage, negative, huge or missing values. Expected: clamped or ignored, never a crash. → Task 16 tests, Task 21 browser checks.

## File Structure

| File | Responsibility |
|---|---|
| `src/server/player.ts` (modify) | a queue reset acknowledges the inputs it discards |
| `src/shared/physics.ts` (replace), `src/shared/sim.ts` (modify) | `physicsReady()` and a clear error when a `Simulation` is built before `initPhysics()` |
| `src/shared/math.ts` (modify) | `quatMul` |
| `src/shared/constants.ts` (modify) | `freezeTuning()` |
| `src/shared/determinism.ts` | scripted collision-heavy run and its bit-level hash |
| `src/client/net/smoothing.ts` | `ErrorSmoother` — hides corrections |
| `src/client/net/latency.ts` | `mulberry32`, `DelayLine`, `LagSocket`, `parseLagParams` |
| `src/client/net/prediction.ts` | `Predictor` — local world, input history, rollback and replay |
| `src/client/net/interp.ts` (modify) | export `lerpState` |
| `src/client/net/netStats.ts` | rolling network and prediction statistics |
| `src/client/net/predictedWorld.ts` | `PredictedWorld` — predictor + smoother + stats, what the client draws |
| `src/client/game/gameClient.ts` (replace), `src/client/main.ts` (replace) | wiring: prediction by default, `?net=interp`, `?lag`, fallback, debug hooks |
| `scripts/hash.ts`, `package.json`, `README.md` (modify) | Node side of the determinism check, docs |
| `tests/helpers/loopback.ts` | real server `Room` behind a simulated network, driven by a `PredictedWorld` |
| `tests/…` | one test file per module above, plus additions to `tests/server/{player,room}.test.ts` and `tests/math.test.ts` |

---

### Task 13: The server acknowledges the inputs a world reset discards

**Files:**
- Modify: `src/server/player.ts` (`resetInputState`)
- Test: `tests/server/player.test.ts`, `tests/server/room.test.ts` (add tests)

**Interfaces:**
- Consumes: `Player.resetInputState()` (Task 8), `Room.rebuild()` (Task 9).
- Produces: the meaning of `Player.ackSeq` (and so of the snapshot `ackSeq` field) becomes "the newest input the server has consumed **or discarded**". Task 17 relies on it.

- [ ] **Step 1: Add the failing tests**

In `tests/server/player.test.ts`, inside `describe('Player input queue', …)`, add these two tests directly before the test named `counts silent ticks and resets the counter when an input arrives`:

```ts
  it('resetInputState acknowledges the inputs it discards, so clients replay only what is still in flight', () => {
    const { player } = make();
    player.pushInput(5, drive);
    player.pushInput(6, drive);
    player.pushInput(7, drive);
    player.nextInput(); // consumes 5
    player.resetInputState(); // 6 and 7 are thrown away, never applied to the next world
    expect(player.ackSeq).toBe(7);
    expect(player.pushInput(1, drive)).toBe(true); // a fresh stream may start anywhere
  });

  it('resetInputState keeps the acknowledgement when nothing was ever received', () => {
    const { player } = make();
    player.resetInputState();
    expect(player.ackSeq).toBe(0);
  });
```

In `tests/server/room.test.ts`, inside `describe('Room world rebuild and snapshots', …)`, add this test directly before the test named `neutralises the input echo after the input stream stalls`:

```ts
  it('acknowledges inputs received before a rebuild, so the first snapshot does not claim they are still pending', () => {
    const { room } = makeRoom();
    const a = join(room);
    for (let seq = 1; seq <= 10; seq++) a.player.pushInput(seq, drive);
    steps(room, NET.REBUILD_DELAY_TICKS + 2);
    const first = snapshots(a.socket)[0]!;
    expect(first.ackSeq).toBe(10);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/server/player.test.ts tests/server/room.test.ts`
Expected: 2 failures — `expected 5 to be 7` (player) and `expected 0 to be 10` (room); the "nothing was ever received" test already passes (it guards the other branch).

- [ ] **Step 3: Implement**

In `src/server/player.ts`, replace `resetInputState` with:

```ts
  resetInputState(): void {
    // Inputs received before the reset are discarded, never applied to the new world: acknowledge them, so clients
    // replay only the inputs that are genuinely still in flight.
    if (this.newestSeq !== null) this.ackSeq = this.newestSeq;
    this.queue = [];
    this.newestSeq = null;
    this.starved = 0;
    this.ticksSinceInput = 0;
    this.lastInput = { ...NEUTRAL_INPUT };
  }
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/server && npm run typecheck`
Expected: PASS (player 13 tests, room 13 tests, all other server tests unchanged); type-check clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix(server): a world reset acknowledges the inputs it discards"
```

---

### Task 14: A clear error when the physics engine is not initialised

**Files:**
- Replace: `src/shared/physics.ts`
- Modify: `src/shared/sim.ts` (constructor guard)
- Test: `tests/physicsGuard.test.ts`

**Interfaces:**
- Consumes: `initPhysics`, `RAPIER` (Task 3), `Simulation` (Task 4).
- Produces: `physicsReady(): boolean` from `physics.ts`; `new Simulation(...)` throws `Error('Physics is not initialised: await initPhysics() before creating a Simulation.')` when called too early. Closes the earlier "opaque wasm error" findings for both the server and the client.

- [ ] **Step 1: Write the failing test**

`tests/physicsGuard.test.ts` (deliberately has no `beforeAll(initPhysics)`; every test file gets fresh modules, so physics starts uninitialised here):

```ts
import { describe, expect, it } from 'vitest';
import { initPhysics, physicsReady } from '../src/shared/physics';
import { Simulation } from '../src/shared/sim';

// Deliberately no beforeAll(initPhysics): every test file gets a fresh module registry, so physics starts uninitialised here.
describe('physics initialisation guard', () => {
  it('refuses to build a Simulation before initPhysics() and says what to do', () => {
    expect(physicsReady()).toBe(false);
    expect(() => new Simulation([0])).toThrow(/initPhysics/);
  });

  it('works once initialised, and initPhysics can be awaited repeatedly', async () => {
    await initPhysics();
    await initPhysics();
    expect(physicsReady()).toBe(true);
    const sim = new Simulation([0]);
    sim.step();
    sim.dispose();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/physicsGuard.test.ts`
Expected: FAIL — `physicsReady is not a function`.

- [ ] **Step 3: Implement**

Replace `src/shared/physics.ts`:

```ts
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
```

In `src/shared/sim.ts`, change the import to `import { RAPIER, physicsReady } from './physics';` and make the guard the first statement of the constructor:

```ts
  constructor(slots: readonly number[], options: SimOptions = {}) {
    if (!physicsReady()) throw new Error('Physics is not initialised: await initPhysics() before creating a Simulation.');
    const unique = [...new Set(slots)].sort((a, b) => a - b);
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/physicsGuard.test.ts && npm test && npm run typecheck`
Expected: PASS — the whole suite (205 tests) and a clean type-check.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(shared): fail clearly when a Simulation is built before the physics engine is initialised"
```

---

### Task 15: `quatMul` and the `ErrorSmoother`

**Files:**
- Modify: `src/shared/math.ts` (add `quatMul`)
- Create: `src/client/net/smoothing.ts`
- Test: `tests/math.test.ts` (add), `tests/client/smoothing.test.ts`

**Interfaces:**
- Consumes: `QUAT_IDENTITY`, `quatConjugate`, `quatNlerp`, `quatNormalize`, `vadd`, `vlen`, `vscale`, `vsub` (math); `Quat`, `Vec3` (types).
- Produces:
  - `math.ts`: `quatMul(a: Quat, b: Quat): Quat` — Hamilton product; rotating by the result equals rotating by `b` first, then `a`.
  - `smoothing.ts`: `interface SmoothPose {pos: Vec3; quat: Quat}`, `class ErrorSmoother` — `constructor(tauSeconds = 0.1, snapDistance = 2, snapAngle = 0.6)`, `apply(slot, pose): SmoothPose`, `absorb(slot, before, after): 'smoothed' | 'snapped'`, `decay(dtSeconds)`, `offsetMagnitude(slot)`, `forget(slot)`, `clear()`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/math.test.ts` (and add `quatMul` to the import list from `'../src/shared/math'`, after `quatIntegrate`):

```ts
describe('quatMul', () => {
  it('composes rotations: the right operand is applied first', () => {
    const a = quatFromYaw(0.3);
    const b = quatFromYaw(0.5);
    const v = { x: 1, y: 0, z: 0 };
    const composed = quatRotate(quatMul(a, b), v);
    const stepwise = quatRotate(a, quatRotate(b, v));
    expect(composed.x).toBeCloseTo(stepwise.x, 6);
    expect(composed.z).toBeCloseTo(stepwise.z, 6);
  });

  it('has the identity as neutral element and the conjugate as inverse', () => {
    const q = quatNormalize({ x: 0.1, y: 0.7, z: -0.2, w: 0.6 });
    const same = quatMul(QUAT_IDENTITY, q);
    expect(same).toEqual(q);
    const inv = quatMul(q, quatConjugate(q));
    expect(inv.w).toBeCloseTo(1, 9);
    expect(Math.abs(inv.x) + Math.abs(inv.y) + Math.abs(inv.z)).toBeLessThan(1e-9);
  });
});
```

`tests/client/smoothing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ErrorSmoother, type SmoothPose } from '../../src/client/net/smoothing';
import { QUAT_IDENTITY, quatFromYaw, vlen, vsub } from '../../src/shared/math';

const pose = (x: number, y = 0, z = 0, yaw = 0): SmoothPose => ({ pos: { x, y, z }, quat: quatFromYaw(yaw) });
const yawOf = (q: { y: number; w: number }): number => 2 * Math.atan2(q.y, q.w);

describe('ErrorSmoother', () => {
  it('leaves poses untouched until a correction is absorbed', () => {
    const s = new ErrorSmoother();
    const p = pose(1, 2, 3, 0.4);
    expect(s.apply(0, p)).toEqual(p);
    expect(s.offsetMagnitude(0)).toBe(0);
  });

  it('hides a correction: the rendered pose does not jump, then eases onto the new state', () => {
    const s = new ErrorSmoother(0.1, 2);
    expect(s.absorb(0, pose(10), pose(10.2))).toBe('smoothed');
    expect(s.apply(0, pose(10.2)).pos.x).toBeCloseTo(10, 9); // still drawn where it was
    s.decay(0.1); // one time constant
    expect(s.apply(0, pose(10.2)).pos.x).toBeCloseTo(10.2 - 0.2 * Math.exp(-1), 9);
    for (let i = 0; i < 100; i++) s.decay(0.05);
    expect(s.apply(0, pose(10.2)).pos.x).toBeCloseTo(10.2, 9);
    expect(s.offsetMagnitude(0)).toBe(0);
  });

  it('composes successive corrections without a visible jump at either', () => {
    const s = new ErrorSmoother(0.1, 2);
    s.absorb(0, pose(0), pose(0.3));
    s.decay(0.05);
    const seenBefore = s.apply(0, pose(0.5));
    s.absorb(0, pose(0.5), pose(0.8));
    const seenAfter = s.apply(0, pose(0.8));
    expect(seenAfter.pos.x).toBeCloseTo(seenBefore.pos.x, 9);
  });

  it('snaps instead of smoothing a large error and clears any earlier offset', () => {
    const s = new ErrorSmoother(0.1, 2);
    s.absorb(0, pose(0), pose(0.4));
    expect(s.absorb(0, pose(0.4), pose(5))).toBe('snapped');
    expect(s.apply(0, pose(5)).pos.x).toBe(5);
    expect(s.offsetMagnitude(0)).toBe(0);
  });

  it('smooths orientation errors too, and snaps a large turn', () => {
    const s = new ErrorSmoother(0.1, 2, 0.6);
    expect(s.absorb(0, pose(0, 0, 0, 0.0), pose(0, 0, 0, 0.2))).toBe('smoothed');
    expect(yawOf(s.apply(0, pose(0, 0, 0, 0.2)).quat)).toBeCloseTo(0, 6);
    s.decay(0.1);
    expect(yawOf(s.apply(0, pose(0, 0, 0, 0.2)).quat)).toBeCloseTo(0.2 - 0.2 * Math.exp(-1), 2);
    expect(s.absorb(0, pose(0, 0, 0, 0), pose(0, 0, 0, 1.5))).toBe('snapped');
    expect(yawOf(s.apply(0, pose(0, 0, 0, 1.5)).quat)).toBeCloseTo(1.5, 6);
  });

  it('keeps one offset per slot and can forget or clear them', () => {
    const s = new ErrorSmoother();
    s.absorb(0, pose(0), pose(0.1));
    s.absorb(3, pose(0), pose(-0.1));
    expect(s.apply(0, pose(0.1)).pos.x).toBeCloseTo(0, 9);
    expect(s.apply(3, pose(-0.1)).pos.x).toBeCloseTo(0, 9);
    s.forget(0);
    expect(s.apply(0, pose(0.1)).pos.x).toBe(0.1);
    s.clear();
    expect(s.apply(3, pose(-0.1)).pos.x).toBe(-0.1);
  });

  it('never propagates NaN: bad input snaps and ignores non-positive time steps', () => {
    const s = new ErrorSmoother();
    expect(s.absorb(0, pose(Number.NaN), pose(1))).toBe('snapped');
    s.absorb(0, pose(0), pose(0.1));
    s.decay(Number.NaN);
    s.decay(-1);
    const applied = s.apply(0, pose(0.1));
    expect(Number.isFinite(applied.pos.x)).toBe(true);
    expect(applied.pos.x).toBeCloseTo(0, 9);
    expect(vlen(vsub(applied.pos, { x: 0, y: 0, z: 0 }))).toBeLessThan(1e-9);
    expect(s.apply(0, { pos: { x: 0, y: 0, z: 0 }, quat: QUAT_IDENTITY }).quat.w).toBeCloseTo(1, 6);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/math.test.ts tests/client/smoothing.test.ts`
Expected: FAIL — `quatMul is not a function`, and the smoothing test cannot resolve `../../src/client/net/smoothing`.

- [ ] **Step 3: Implement**

In `src/shared/math.ts`, add directly above the `/** Normalised linear interpolation along the shortest path. */` comment:

```ts
/** Hamilton product a ⊗ b: rotating by the result equals rotating by `b` first, then by `a`. */
export const quatMul = (a: Quat, b: Quat): Quat => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});

```

Create `src/client/net/smoothing.ts`:

```ts
import { QUAT_IDENTITY, quatConjugate, quatMul, quatNlerp, quatNormalize, vadd, vlen, vscale, vsub } from '../../shared/math';
import type { Quat, Vec3 } from '../../shared/types';

export interface SmoothPose {
  pos: Vec3;
  quat: Quat;
}

interface Offset {
  pos: Vec3;
  rot: Quat;
}

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
const EPSILON_POS = 1e-4; // metres
const EPSILON_ROT = 1e-4; // 1 - |w| of the offset quaternion (~0.8 milliradians)

const finitePose = (p: SmoothPose): boolean =>
  Number.isFinite(p.pos.x) && Number.isFinite(p.pos.y) && Number.isFinite(p.pos.z) &&
  Number.isFinite(p.quat.x) && Number.isFinite(p.quat.y) && Number.isFinite(p.quat.z) && Number.isFinite(p.quat.w);

/**
 * Hides prediction corrections. When reconciliation moves a car's present pose, the difference between what was
 * on screen and the corrected pose is kept as a render offset that decays exponentially, so the car eases onto
 * the corrected state instead of jumping. Errors beyond `snapDistance` (or `snapAngle`) snap immediately.
 */
export class ErrorSmoother {
  private readonly offsets = new Map<number, Offset>();

  constructor(
    /** Time constant of the decay in seconds. */
    private readonly tauSeconds = 0.1,
    /** Position errors larger than this many metres are not smoothed. */
    private readonly snapDistance = 2,
    /** Orientation errors larger than this many radians are not smoothed. */
    private readonly snapAngle = 0.6,
  ) {}

  /** Adds the current offset to a simulated pose. */
  apply(slot: number, pose: SmoothPose): SmoothPose {
    const off = this.offsets.get(slot);
    if (!off) return pose;
    return { pos: vadd(pose.pos, off.pos), quat: quatNormalize(quatMul(off.rot, pose.quat)) };
  }

  /**
   * Call when reconciliation changed a car's present pose from `before` to `after`. Keeps what the player was
   * seeing continuous by storing the difference as the new offset (including any offset still decaying).
   */
  absorb(slot: number, before: SmoothPose, after: SmoothPose): 'smoothed' | 'snapped' {
    if (!finitePose(before) || !finitePose(after)) {
      this.offsets.delete(slot);
      return 'snapped';
    }
    const seen = this.apply(slot, before);
    const pos = vsub(seen.pos, after.pos);
    const rot = quatNormalize(quatMul(seen.quat, quatConjugate(after.quat)));
    const angle = 2 * Math.acos(Math.min(1, Math.abs(rot.w)));
    if (vlen(pos) > this.snapDistance || angle > this.snapAngle) {
      this.offsets.delete(slot);
      return 'snapped';
    }
    this.offsets.set(slot, { pos, rot });
    return 'smoothed';
  }

  /** Advances the decay by `dtSeconds` (ignored when not a positive finite number). */
  decay(dtSeconds: number): void {
    if (!(dtSeconds > 0) || !Number.isFinite(dtSeconds)) return;
    const k = Math.exp(-dtSeconds / this.tauSeconds);
    for (const [slot, off] of this.offsets) {
      const pos = vscale(off.pos, k);
      const rot = quatNlerp(QUAT_IDENTITY, off.rot, k);
      if (vlen(pos) < EPSILON_POS && 1 - Math.abs(rot.w) < EPSILON_ROT) this.offsets.delete(slot);
      else this.offsets.set(slot, { pos, rot });
    }
  }

  /** Current positional offset in metres (0 when none). */
  offsetMagnitude(slot: number): number {
    return vlen(this.offsets.get(slot)?.pos ?? ZERO);
  }

  forget(slot: number): void {
    this.offsets.delete(slot);
  }

  clear(): void {
    this.offsets.clear();
  }
}
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/math.test.ts tests/client/smoothing.test.ts && npm run typecheck`
Expected: PASS — 21 tests (math 14, smoothing 7); type-check clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(client): ErrorSmoother hides prediction corrections behind a decaying render offset"
```

---

### Task 16: The latency simulator

**Files:**
- Create: `src/client/net/latency.ts`
- Test: `tests/client/latency.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (the browser `WebSocket` type only).
- Produces:
  - `mulberry32(seed: number): () => number` — seeded PRNG in [0, 1).
  - `interface LagOptions {lagMs, jitterMs, lossPct}`, `interface LineOptions {oneWayMs, jitterMs, lossPct}`.
  - `class DelayLine<T>` — `constructor(options: LineOptions, random)`, `push(nowMs, msg, lossy = false): number | null` (delivery time, or null if dropped), `due(nowMs): T[]`, `pending`, `clear()`. FIFO, so jitter bunches messages instead of reordering them.
  - `parseLagParams(params: URLSearchParams): LagOptions | null` — `?lag=&jitter=&loss=`, clamped to 2000 ms / 500 ms / 50 %, `null` when all zero.
  - `class LagSocket` — wraps a real `WebSocket` and implements the surface `Connection` uses (`binaryType`, `readyState`, `send`, `close`, `onopen`, `onmessage`, `onclose`, `onerror`); `constructor(inner: WebSocket, options: LagOptions, env?: LagEnv)`.

- [ ] **Step 1: Write the failing tests**

`tests/client/latency.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DelayLine, LagSocket, mulberry32, parseLagParams } from '../../src/client/net/latency';

describe('mulberry32', () => {
  it('is deterministic per seed and stays within [0, 1)', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const seq = Array.from({ length: 50 }, () => a());
    expect(seq).toEqual(Array.from({ length: 50 }, () => b()));
    expect(seq.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(mulberry32(8)()).not.toBe(seq[0]);
  });
});

describe('DelayLine', () => {
  it('delays every message by the one-way latency', () => {
    const line = new DelayLine<string>({ oneWayMs: 50, jitterMs: 0, lossPct: 0 }, mulberry32(1));
    expect(line.push(1000, 'a')).toBe(1050);
    expect(line.due(1049)).toEqual([]);
    expect(line.due(1050)).toEqual(['a']);
    expect(line.pending).toBe(0);
  });

  it('keeps jitter inside its bounds and never reorders (FIFO like TCP)', () => {
    const line = new DelayLine<number>({ oneWayMs: 50, jitterMs: 30, lossPct: 0 }, mulberry32(2));
    let lastAt = -Infinity;
    for (let i = 0; i < 500; i++) {
      const sentAt = i * 16;
      const at = line.push(sentAt, i)!;
      expect(at).toBeGreaterThanOrEqual(sentAt + 20 - 1e-9); // 50 - 30, unless clamped up by an earlier message
      expect(at).toBeLessThanOrEqual(sentAt + 80 + 1e-9); // 50 + 30; FIFO clamping never exceeds the previous maximum
      expect(at).toBeGreaterThanOrEqual(lastAt);
      lastAt = at;
    }
    const out = line.due(Infinity);
    expect(out).toEqual(Array.from({ length: 500 }, (_, i) => i));
  });

  it('only drops messages flagged lossy, at roughly the configured rate', () => {
    const line = new DelayLine<number>({ oneWayMs: 0, jitterMs: 0, lossPct: 50 }, mulberry32(3));
    for (let i = 0; i < 1000; i++) line.push(0, i, false);
    expect(line.due(0)).toHaveLength(1000); // reliable traffic is never dropped
    let kept = 0;
    for (let i = 0; i < 4000; i++) if (line.push(0, i, true) !== null) kept++;
    expect(kept).toBeGreaterThan(1800);
    expect(kept).toBeLessThan(2200);
  });

  it('is repeatable for a given seed', () => {
    const run = (): number[] => {
      const line = new DelayLine<number>({ oneWayMs: 40, jitterMs: 25, lossPct: 10 }, mulberry32(9));
      return Array.from({ length: 200 }, (_, i) => line.push(i * 16, i, true) ?? -1);
    };
    expect(run()).toEqual(run());
  });
});

describe('parseLagParams', () => {
  const parse = (q: string) => parseLagParams(new URLSearchParams(q));

  it('returns null when nothing is simulated', () => {
    expect(parse('')).toBeNull();
    expect(parse('lag=0&jitter=0&loss=0')).toBeNull();
    expect(parse('lag=abc&jitter=&loss=-3')).toBeNull();
  });

  it('reads the three parameters', () => {
    expect(parse('lag=120&jitter=30&loss=1')).toEqual({ lagMs: 120, jitterMs: 30, lossPct: 1 });
    expect(parse('lag=80')).toEqual({ lagMs: 80, jitterMs: 0, lossPct: 0 });
  });

  it('clamps absurd values', () => {
    expect(parse('lag=999999&jitter=999999&loss=999')).toEqual({ lagMs: 2000, jitterMs: 500, lossPct: 50 });
    expect(parse('lag=-5&jitter=NaN&loss=Infinity')).toEqual({ lagMs: 0, jitterMs: 0, lossPct: 50 });
  });
});

class FakeInner {
  readyState = 1;
  binaryType = 'blob';
  sent: unknown[] = [];
  closedWith: [number?, string?] | null = null;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send(d: unknown): void {
    this.sent.push(d);
  }
  close(code?: number, reason?: string): void {
    this.closedWith = [code, reason];
  }
}

function lagSetup(options: { lagMs: number; jitterMs: number; lossPct: number }) {
  const inner = new FakeInner();
  let now = 0;
  const timers: Array<{ at: number; fn: () => void }> = [];
  const socket = new LagSocket(inner as unknown as WebSocket, options, {
    now: () => now,
    schedule: (fn, ms) => timers.push({ at: now + ms, fn }),
    random: mulberry32(5),
  });
  const received: unknown[] = [];
  const closes: unknown[] = [];
  socket.onmessage = (ev) => received.push(ev.data);
  socket.onclose = (ev) => closes.push([ev.code, ev.reason]);
  const advance = (to: number): void => {
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > to) break;
      timers.shift();
      now = Math.max(now, next.at);
      next.fn();
    }
    now = to;
  };
  return { inner, socket, received, closes, advance, setNow: (t: number) => (now = t) };
}

describe('LagSocket', () => {
  it('delays outgoing and incoming frames by half the added round trip each', () => {
    const { inner, socket, received, advance } = lagSetup({ lagMs: 100, jitterMs: 0, lossPct: 0 });
    socket.send('hello');
    expect(inner.sent).toEqual([]);
    advance(49);
    expect(inner.sent).toEqual([]);
    advance(50);
    expect(inner.sent).toEqual(['hello']);
    inner.onmessage!({ data: 'pong' });
    advance(99);
    expect(received).toEqual([]);
    advance(100);
    expect(received).toEqual(['pong']);
  });

  it('forwards binaryType and the ready state to the real socket', () => {
    const { inner, socket } = lagSetup({ lagMs: 10, jitterMs: 0, lossPct: 0 });
    socket.binaryType = 'arraybuffer';
    expect(inner.binaryType).toBe('arraybuffer');
    inner.readyState = 3;
    expect(socket.readyState).toBe(3);
  });

  it('drops only binary frames when loss is high, never JSON control messages', () => {
    const { inner, socket, received, advance } = lagSetup({ lagMs: 0, jitterMs: 0, lossPct: 50 });
    for (let i = 0; i < 400; i++) socket.send(new Uint8Array([i & 255]));
    for (let i = 0; i < 50; i++) socket.send(JSON.stringify({ t: 'ping', id: i }));
    advance(10);
    const binaries = inner.sent.filter((d) => typeof d !== 'string');
    const texts = inner.sent.filter((d) => typeof d === 'string');
    expect(texts).toHaveLength(50);
    expect(binaries.length).toBeGreaterThan(140);
    expect(binaries.length).toBeLessThan(260);
    for (let i = 0; i < 300; i++) inner.onmessage!({ data: new ArrayBuffer(4) });
    for (let i = 0; i < 20; i++) inner.onmessage!({ data: '{"t":"roster"}' });
    advance(20);
    expect(received.filter((d) => typeof d === 'string')).toHaveLength(20);
    expect(received.filter((d) => typeof d !== 'string').length).toBeLessThan(220);
  });

  it('delivers the close event after the frames that preceded it', () => {
    const { inner, socket, received, closes, advance } = lagSetup({ lagMs: 60, jitterMs: 0, lossPct: 0 });
    inner.onmessage!({ data: 'last words' });
    inner.onclose!({ code: 4001, reason: 'inactive' });
    advance(29);
    expect(received).toEqual([]);
    expect(closes).toEqual([]);
    advance(30);
    expect(received).toEqual(['last words']);
    expect(closes).toEqual([[4001, 'inactive']]);
    void socket;
  });

  it('closes the real socket immediately and drops anything still in flight', () => {
    const { inner, socket, received, advance } = lagSetup({ lagMs: 100, jitterMs: 0, lossPct: 0 });
    socket.send('bye');
    inner.onmessage!({ data: 'late' });
    socket.close(1000, 'done');
    expect(inner.closedWith).toEqual([1000, 'done']);
    advance(500);
    expect(inner.sent).toEqual([]);
    expect(received).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/client/latency.test.ts`
Expected: FAIL — cannot resolve `../../src/client/net/latency`.

- [ ] **Step 3: Implement**

Create `src/client/net/latency.ts`:

```ts
/** Small seeded PRNG so simulated networks are repeatable in tests. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface LagOptions {
  /** Added round-trip time in ms, split evenly between the two directions. */
  lagMs: number;
  /** Each frame is delayed by a further random amount in [-jitterMs, +jitterMs] per direction. */
  jitterMs: number;
  /** Percentage (0-50) of binary frames (inputs and snapshots) that never arrive. JSON control messages are never dropped. */
  lossPct: number;
}

export interface LineOptions {
  oneWayMs: number;
  jitterMs: number;
  lossPct: number;
}

/**
 * One direction of a simulated link. Delivery is FIFO like TCP: a message is never delivered before an earlier one,
 * so jitter shows up as bunching rather than reordering.
 */
export class DelayLine<T> {
  private queue: Array<{ at: number; msg: T }> = [];
  private last = -Infinity;

  constructor(
    private readonly options: LineOptions,
    private readonly random: () => number,
  ) {}

  /** Queues `msg` sent at `nowMs`. Returns its delivery time, or null when it was dropped (only `lossy` messages can be). */
  push(nowMs: number, msg: T, lossy = false): number | null {
    if (lossy && this.options.lossPct > 0 && this.random() * 100 < this.options.lossPct) return null;
    const jitter = this.options.jitterMs > 0 ? (this.random() * 2 - 1) * this.options.jitterMs : 0;
    const at = Math.max(this.last, nowMs + this.options.oneWayMs + jitter);
    this.last = at;
    this.queue.push({ at, msg });
    return at;
  }

  /** Removes and returns every message due at `nowMs`, oldest first. */
  due(nowMs: number): T[] {
    const out: T[] = [];
    while (this.queue.length > 0 && this.queue[0]!.at <= nowMs) out.push(this.queue.shift()!.msg);
    return out;
  }

  get pending(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
  }
}

const readNumber = (raw: string | null, max: number): number => {
  if (raw === null || raw.trim() === '') return 0;
  const n = Number(raw);
  return Number.isNaN(n) ? 0 : Math.min(max, Math.max(0, n));
};

/** `?lag=120&jitter=30&loss=1` (round-trip ms, jitter ms, percent of binary frames lost). Null when nothing is simulated. */
export function parseLagParams(params: URLSearchParams): LagOptions | null {
  const lagMs = readNumber(params.get('lag'), 2000);
  const jitterMs = readNumber(params.get('jitter'), 500);
  const lossPct = readNumber(params.get('loss'), 50);
  if (lagMs === 0 && jitterMs === 0 && lossPct === 0) return null;
  return { lagMs, jitterMs, lossPct };
}

export interface LagEnv {
  now(): number;
  schedule(fn: () => void, ms: number): void;
  random(): number;
}

const realEnv = (): LagEnv => ({
  now: () => performance.now(),
  schedule: (fn, ms) => void setTimeout(fn, ms),
  random: Math.random,
});

type Incoming = { kind: 'message'; ev: MessageEvent } | { kind: 'close'; ev: CloseEvent };
type Outgoing = Parameters<WebSocket['send']>[0];

/**
 * Wraps a real WebSocket and delays (and, for binary frames, drops) traffic in both directions. It implements just
 * the surface `Connection` uses, so it can be handed over through `Connection`'s socket factory.
 */
export class LagSocket {
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  private readonly outgoing: DelayLine<Outgoing>;
  private readonly incoming: DelayLine<Incoming>;
  private closing = false;

  constructor(
    private readonly inner: WebSocket,
    options: LagOptions,
    private readonly env: LagEnv = realEnv(),
  ) {
    const line: LineOptions = { oneWayMs: options.lagMs / 2, jitterMs: options.jitterMs, lossPct: options.lossPct };
    this.outgoing = new DelayLine(line, env.random);
    this.incoming = new DelayLine(line, env.random);
    inner.onopen = (ev) => this.onopen?.(ev);
    inner.onmessage = (ev) => this.enqueue({ kind: 'message', ev }, typeof ev.data !== 'string');
    inner.onclose = (ev) => this.enqueue({ kind: 'close', ev }, false);
    inner.onerror = (ev) => this.onerror?.(ev);
  }

  get readyState(): number {
    return this.inner.readyState;
  }

  get binaryType(): BinaryType {
    return this.inner.binaryType;
  }

  set binaryType(value: BinaryType) {
    this.inner.binaryType = value;
  }

  send(data: Outgoing): void {
    if (this.closing) return;
    const now = this.env.now();
    const at = this.outgoing.push(now, data, typeof data !== 'string');
    if (at !== null) this.env.schedule(() => this.flushOutgoing(), Math.max(0, at - now));
  }

  /** Closes the real socket immediately; frames still in flight are discarded. */
  close(code?: number, reason?: string): void {
    this.closing = true;
    this.outgoing.clear();
    this.incoming.clear();
    this.inner.close(code, reason);
  }

  private flushOutgoing(): void {
    if (this.closing) return;
    for (const data of this.outgoing.due(this.env.now())) {
      try {
        this.inner.send(data);
      } catch {
        /* the real socket is closing */
      }
    }
  }

  private enqueue(item: Incoming, lossy: boolean): void {
    if (this.closing && item.kind === 'message') return;
    const now = this.env.now();
    const at = this.incoming.push(now, item, lossy);
    if (at !== null) this.env.schedule(() => this.flushIncoming(), Math.max(0, at - now));
  }

  private flushIncoming(): void {
    for (const item of this.incoming.due(this.env.now())) {
      if (item.kind === 'message') this.onmessage?.(item.ev);
      else this.onclose?.(item.ev);
    }
  }
}
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/client/latency.test.ts && npm run typecheck`
Expected: PASS — 13 tests; type-check clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(client): latency simulator (delay, jitter, loss) for testing under bad networks"
```

---

### Task 17: The `Predictor` — local world, input history, rollback and replay

**Files:**
- Modify: `src/client/net/interp.ts` (export `lerpState`)
- Create: `src/client/net/prediction.ts`
- Test: `tests/client/prediction.test.ts`

**Interfaces:**
- Consumes: `Simulation` (Task 4, guarded in Task 14); `ARENA` (constants); `NEUTRAL_INPUT`, `quantizeInput`, `CarInput` (input); `vlen`, `vsub` (math); `Snapshot`, `SnapshotCar`, `SNAP_FLAG_ALIVE`, `SNAP_FLAG_HANDBRAKE` (protocol); `CarState`, `Vec3` (types); `lerpState` (interp).
- Produces (`prediction.ts`):
  - types `PredictorOptions {deadbandPos?, deadbandVel?, historySize?, interactionRange?, startSeq?, createSimulation?}`, `Correction {slot, before, after, error}`, `ReconcileOutcome = 'synced' | 'applied' | 'dropped-epoch' | 'dropped-old' | 'ignored'`, `ReconcileResult {outcome, resetLocal, resimSteps, corrections, localError}`, `PredictedPose {slot, state, flags, hp, throttle, steer, visible}`.
  - `class Predictor` — `constructor(mySlot, options?)`, `sequence`, `isSynced`, `worldEpoch`, `hasLocalCar`, `beginWorld(epoch)`, `step(input): number` (returns the sequence number to send), `reconcile(snapshot): ReconcileResult`, `poses(alpha): PredictedPose[]`, `dispose()`, `counters`, `lastIgnored: string | null`, `failure: string | null`.
- Semantics worth knowing: the world is built from the **first snapshot of an epoch** (it lists exactly the cars the server simulates, including the case of a joiner whose car does not exist yet); cars missing from a later snapshot are parked (neutral input) and hidden; inputs numbered before the world exists are kept and replayed at the first sync; a snapshot never mutates state unless it passes validation.

- [ ] **Step 1: Write the failing tests**

`tests/client/prediction.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Predictor } from '../../src/client/net/prediction';
import { NEUTRAL_INPUT, type CarInput } from '../../src/shared/input';
import { initPhysics } from '../../src/shared/physics';
import { SNAP_FLAG_ALIVE, type Snapshot } from '../../src/shared/protocol';
import { Simulation } from '../../src/shared/sim';

beforeAll(async () => {
  await initPhysics();
});

const straight = (): CarInput => ({ throttle: 1, steer: 0, handbrake: false });

const sims: Simulation[] = [];
afterEach(() => {
  while (sims.length) sims.pop()!.dispose();
});

function world(slots: number[]): Simulation {
  const s = new Simulation(slots);
  sims.push(s);
  return s;
}

/** A snapshot of `sim`'s cars (optionally only some of them) as the server would send it. */
function snapshotOf(sim: Simulation, over: Partial<Snapshot> = {}, only?: number[]): Snapshot {
  return {
    epoch: 3,
    tick: 10,
    ackSeq: 0,
    cars: sim.slots
      .filter((slot) => !only || only.includes(slot))
      .map((slot) => ({ slot, flags: SNAP_FLAG_ALIVE, hp: 100, state: sim.getState(slot), throttle: 0, steer: 0 })),
    ...over,
  };
}

const posesOf = (p: Predictor) => JSON.stringify(p.poses(1));

describe('Predictor snapshot handling', () => {
  it('ignores snapshots until a world begins', () => {
    const p = new Predictor(0);
    expect(p.reconcile(snapshotOf(world([0, 1]))).outcome).toBe('dropped-epoch');
    expect(p.isSynced).toBe(false);
    expect(p.poses(1)).toEqual([]);
    p.dispose();
  });

  it('syncs on the first snapshot of an epoch, then applies later ones and replays unacknowledged inputs', () => {
    const p = new Predictor(0);
    const w = world([0, 1]);
    p.beginWorld(3);
    const first = p.reconcile(snapshotOf(w, { tick: 2, ackSeq: 0 }));
    expect(first).toMatchObject({ outcome: 'synced', corrections: [] });
    expect(p.isSynced).toBe(true);
    expect(p.poses(1).map((x) => [x.slot, x.visible])).toEqual([[0, true], [1, true]]);
    for (let i = 0; i < 3; i++) p.step(straight());
    expect(p.sequence).toBe(3);
    const next = p.reconcile(snapshotOf(w, { tick: 4, ackSeq: 1 }));
    expect(next.outcome).toBe('applied');
    expect(next.resimSteps).toBe(2);
    expect(next.corrections.map((c) => c.slot).sort()).toEqual([0, 1]);
    p.dispose();
  });

  it('drops other epochs and stale or duplicate ticks', () => {
    const p = new Predictor(0);
    const w = world([0, 1]);
    p.beginWorld(3);
    expect(p.reconcile(snapshotOf(w, { epoch: 4, tick: 2 })).outcome).toBe('dropped-epoch');
    expect(p.reconcile(snapshotOf(w, { tick: 6 })).outcome).toBe('synced');
    expect(p.reconcile(snapshotOf(w, { tick: 6 })).outcome).toBe('dropped-old');
    expect(p.reconcile(snapshotOf(w, { tick: 4 })).outcome).toBe('dropped-old');
    expect(p.counters).toMatchObject({ droppedEpoch: 1, droppedOld: 2, synced: 1 });
    p.dispose();
  });

  it('rejects nonsense without touching its state', () => {
    const p = new Predictor(0);
    const w = world([0, 1]);
    p.beginWorld(3);
    p.reconcile(snapshotOf(w, { tick: 2 }));
    const before = posesOf(p);
    expect(p.reconcile(snapshotOf(w, { tick: 4, ackSeq: 5 })).outcome).toBe('ignored'); // acknowledges inputs never sent
    const nan = snapshotOf(w, { tick: 6 });
    nan.cars[1]!.state.pos.x = Number.NaN;
    expect(p.reconcile(nan).outcome).toBe('ignored');
    const inf = snapshotOf(w, { tick: 8 });
    inf.cars[0]!.state.linvel.y = Number.POSITIVE_INFINITY;
    expect(p.reconcile(inf).outcome).toBe('ignored');
    expect(p.reconcile(snapshotOf(w, { tick: 10, cars: [] })).outcome).toBe('ignored');
    const outOfRange = snapshotOf(w, { tick: 12 });
    outOfRange.cars[0]!.slot = 99;
    expect(p.reconcile(outOfRange).outcome).toBe('ignored');
    expect(posesOf(p)).toBe(before);
    expect(p.counters.ignored).toBe(5);
    expect(p.failure).toBeNull(); // hostile input is ignored, it is not a reason to give up on prediction
    p.dispose();
  });

  it('reports a failure when it cannot build a local world, so the caller can fall back', () => {
    const p = new Predictor(0, {
      createSimulation: () => {
        throw new Error('WASM unavailable');
      },
    });
    p.beginWorld(3);
    expect(p.reconcile(snapshotOf(world([0, 1]))).outcome).toBe('ignored');
    expect(p.failure).toBe('WASM unavailable');
    expect(p.lastIgnored).toMatch(/WASM unavailable/);
    expect(p.isSynced).toBe(false);
    p.dispose();
  });

  it('numbers inputs before it has a world and replays them once it syncs', () => {
    const p = new Predictor(0);
    for (let i = 1; i <= 10; i++) expect(p.step(straight())).toBe(i);
    p.beginWorld(3);
    const r = p.reconcile(snapshotOf(world([0, 1]), { ackSeq: 4 }));
    expect(r).toMatchObject({ outcome: 'synced', resimSteps: 6 });
    p.dispose();
  });

  it('caps the replay at the history size', () => {
    const p = new Predictor(0, { historySize: 8 });
    p.beginWorld(3);
    for (let i = 0; i < 20; i++) p.step(straight());
    expect(p.reconcile(snapshotOf(world([0, 1]), { ackSeq: 2 })).resimSteps).toBe(8);
    p.dispose();
  });

  it('treats cars missing from a snapshot as parked and hidden', () => {
    const p = new Predictor(0);
    const w = world([0, 1, 2]);
    p.beginWorld(3);
    p.reconcile(snapshotOf(w, { tick: 2 }));
    p.reconcile(snapshotOf(w, { tick: 4 }, [0, 1]));
    expect(p.poses(1).map((x) => [x.slot, x.visible])).toEqual([[0, true], [1, true], [2, false]]);
    p.dispose();
  });

  it('rebuilds its world when a snapshot brings a car it has never seen', () => {
    const p = new Predictor(0);
    p.beginWorld(3);
    p.reconcile(snapshotOf(world([0, 1]), { tick: 2 }));
    const r = p.reconcile(snapshotOf(world([0, 1, 5]), { tick: 4 }));
    expect(r.outcome).toBe('synced');
    expect(p.counters.worldRebuilds).toBe(1);
    expect(p.poses(1).map((x) => x.slot)).toEqual([0, 1, 5]);
    p.dispose();
  });

  it.each([
    ['another car is 5 m away', 5, true],
    ['every other car is far away', 60, false],
  ])('%s: the local car is reset to the server state only when it could be colliding', (_label, gap, expectReset) => {
    const p = new Predictor(0);
    const w = world([0, 1]);
    p.beginWorld(3);
    const first = snapshotOf(w, { tick: 2 });
    first.cars[1]!.state.pos = { ...first.cars[0]!.state.pos, x: first.cars[0]!.state.pos.x - gap };
    p.reconcile(first);
    p.step(NEUTRAL_INPUT);
    p.step(NEUTRAL_INPUT);
    const mine = p.poses(1).find((x) => x.slot === 0)!.state; // exactly what the prediction holds after input 2
    const next = snapshotOf(w, { tick: 4, ackSeq: 2 });
    next.cars[0]!.state = { ...mine, pos: { ...mine.pos, x: mine.pos.x + 0.02 } }; // 2 cm off: inside the deadband
    next.cars[1]!.state.pos = { ...mine.pos, x: mine.pos.x - gap };
    const r = p.reconcile(next);
    expect(r.outcome).toBe('applied');
    expect(r.resetLocal).toBe(expectReset);
    p.dispose();
  });

  it('keeps counting sequence numbers through the u32 wrap', () => {
    const p = new Predictor(0, { startSeq: 0xfffffffd });
    p.beginWorld(3);
    const seqs = Array.from({ length: 5 }, () => p.step(straight()));
    expect(seqs).toEqual([0xfffffffe, 0xffffffff, 0, 1, 2]);
    expect(p.reconcile(snapshotOf(world([0, 1]), { ackSeq: 0xffffffff })).resimSteps).toBe(3);
    p.dispose();
  });

  it('starts a fresh world for a new epoch but keeps the inputs the server has not acknowledged', () => {
    const p = new Predictor(0);
    const w = world([0, 1]);
    p.beginWorld(3);
    for (let i = 0; i < 5; i++) p.step(straight());
    expect(p.reconcile(snapshotOf(w, { tick: 2, ackSeq: 2 })).resimSteps).toBe(3);
    p.beginWorld(4);
    expect(p.isSynced).toBe(false);
    expect(p.poses(1)).toEqual([]);
    for (let i = 0; i < 2; i++) p.step(NEUTRAL_INPUT);
    expect(p.reconcile(snapshotOf(w, { epoch: 4, tick: 2, ackSeq: 4 }))).toMatchObject({ outcome: 'synced', resimSteps: 3 });
    p.dispose();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/client/prediction.test.ts`
Expected: FAIL — cannot resolve `../../src/client/net/prediction`.

- [ ] **Step 3: Implement**

In `src/client/net/interp.ts` change `const lerpState = …` to `export const lerpState = …` (no other change).

Create `src/client/net/prediction.ts`:

```ts
import { ARENA } from '../../shared/constants';
import { NEUTRAL_INPUT, quantizeInput, type CarInput } from '../../shared/input';
import { vlen, vsub } from '../../shared/math';
import { SNAP_FLAG_ALIVE, SNAP_FLAG_HANDBRAKE, type Snapshot, type SnapshotCar } from '../../shared/protocol';
import { Simulation } from '../../shared/sim';
import type { CarState, Vec3 } from '../../shared/types';
import { lerpState } from './interp';

export interface PredictorOptions {
  /** A local prediction within this distance (m) of the server's state is kept rather than reset. */
  deadbandPos?: number;
  /** ... and within this velocity difference (m/s). */
  deadbandVel?: number;
  /** How many of the most recent local inputs are remembered for re-simulation. */
  historySize?: number;
  /** Within this distance (m) of another car the deadband is off: the exact server state is used, since cars can collide. */
  interactionRange?: number;
  /** First sequence number is startSeq + 1 (tests use it to exercise the u32 wrap). */
  startSeq?: number;
  /** Builds the local world for the given slots; tests inject a failing one. Defaults to `new Simulation(slots)`. */
  createSimulation?: (slots: number[]) => Simulation;
}

export interface Correction {
  slot: number;
  /** The car's present state before reconciliation and after it. */
  before: CarState;
  after: CarState;
  /** Metres the car's present position moved. */
  error: number;
}

export type ReconcileOutcome = 'synced' | 'applied' | 'dropped-epoch' | 'dropped-old' | 'ignored';

export interface ReconcileResult {
  outcome: ReconcileOutcome;
  /** True when the local car was reset to the server's state (false when the deadband kept the prediction). */
  resetLocal: boolean;
  /** Local inputs replayed on top of the server's state. */
  resimSteps: number;
  corrections: Correction[];
  /** Metres the local car's present position moved (0 without a local car). */
  localError: number;
}

export interface PredictedPose {
  slot: number;
  state: CarState;
  flags: number;
  hp: number;
  throttle: number;
  steer: number;
  /** False for cars the latest snapshot no longer lists (a departed player's parked car). */
  visible: boolean;
}

interface HistoryEntry {
  input: CarInput;
  /** The local car's state right after this input was applied in the prediction (null until known). */
  after: CarState | null;
}

const DEFAULTS = { deadbandPos: 0.05, deadbandVel: 0.2, historySize: 240, interactionRange: 10 };

const finiteVec = (v: Vec3): boolean => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const finiteState = (s: CarState): boolean =>
  finiteVec(s.pos) && finiteVec(s.linvel) && finiteVec(s.angvel) &&
  Number.isFinite(s.quat.x) && Number.isFinite(s.quat.y) && Number.isFinite(s.quat.z) && Number.isFinite(s.quat.w);
const distance = (a: Vec3, b: Vec3): number => vlen(vsub(a, b));
const inputOf = (c: SnapshotCar): CarInput => ({
  throttle: c.throttle,
  steer: c.steer,
  handbrake: (c.flags & SNAP_FLAG_HANDBRAKE) !== 0,
});

const none = (outcome: ReconcileOutcome): ReconcileResult => ({
  outcome,
  resetLocal: false,
  resimSteps: 0,
  corrections: [],
  localError: 0,
});

/**
 * Client-side prediction with rollback. Every local 60 Hz tick numbers an input, applies it to a local copy of the
 * whole world and steps it. When a server snapshot arrives, every car is put back to the server's state for the
 * tick that consumed input `ackSeq`, and the inputs the server has not consumed yet are replayed on top, so the
 * result is the server's truth pushed forward to the present. The local car keeps its own (more precise) state when
 * it already agrees with the server within the deadband. Remote cars are advanced with their last known input.
 *
 * DOM-free: it only needs the shared Simulation, so it runs in Node tests against a real server room.
 */
export class Predictor {
  private readonly deadbandPos: number;
  private readonly deadbandVel: number;
  private readonly historySize: number;
  private readonly interactionRange: number;
  private readonly createSimulation: (slots: number[]) => Simulation;
  private sim: Simulation | null = null;
  private epoch: number | null = null;
  private synced = false;
  private seq: number;
  private lastTick = -1;
  /** Why the most recent snapshot was ignored (diagnostics for `window.__derby.debug()`). */
  lastIgnored: string | null = null;
  /**
   * Set when a well-formed snapshot could not be turned into a local world (for example the physics engine failed
   * to load). Prediction cannot work then; callers should fall back to interpolation.
   */
  failure: string | null = null;
  private readonly history = new Map<number, HistoryEntry>();
  private readonly remoteInputs = new Map<number, CarInput>();
  private readonly meta = new Map<number, { flags: number; hp: number; throttle: number; steer: number }>();
  private present = new Set<number>();
  private prev = new Map<number, CarState>();
  private curr = new Map<number, CarState>();
  readonly counters = {
    synced: 0,
    applied: 0,
    droppedEpoch: 0,
    droppedOld: 0,
    ignored: 0,
    resets: 0,
    deadbandHits: 0,
    resimSteps: 0,
    worldRebuilds: 0,
  };

  constructor(
    readonly mySlot: number,
    options: PredictorOptions = {},
  ) {
    this.deadbandPos = options.deadbandPos ?? DEFAULTS.deadbandPos;
    this.deadbandVel = options.deadbandVel ?? DEFAULTS.deadbandVel;
    this.historySize = Math.max(1, Math.floor(options.historySize ?? DEFAULTS.historySize));
    this.interactionRange = options.interactionRange ?? DEFAULTS.interactionRange;
    this.createSimulation = options.createSimulation ?? ((slots) => new Simulation(slots));
    this.seq = (options.startSeq ?? 0) >>> 0;
  }

  /** Sequence number of the newest local input. */
  get sequence(): number {
    return this.seq;
  }

  get isSynced(): boolean {
    return this.synced;
  }

  get worldEpoch(): number | null {
    return this.epoch;
  }

  get hasLocalCar(): boolean {
    return this.sim !== null && this.sim.slots.includes(this.mySlot);
  }

  /**
   * Starts accepting snapshots for a new world. The world itself is built from the first snapshot (it lists exactly
   * the cars the server simulates). Inputs not yet acknowledged are kept so they can be replayed.
   */
  beginWorld(epoch: number): void {
    this.epoch = epoch & 0xff;
    if (this.sim) this.counters.worldRebuilds++;
    this.disposeSim();
    this.synced = false;
    this.lastTick = -1;
    this.remoteInputs.clear();
    this.meta.clear();
    this.present = new Set();
    for (const entry of this.history.values()) entry.after = null;
  }

  /** One local 60 Hz tick: numbers `input`, applies it to the prediction and returns its sequence number to send. */
  step(input: CarInput): number {
    const q = quantizeInput(input);
    this.seq = (this.seq + 1) >>> 0;
    const entry: HistoryEntry = { input: q, after: null };
    this.history.set(this.seq, entry);
    this.history.delete((this.seq - this.historySize) >>> 0);
    if (this.sim && this.synced) {
      this.simulate(q);
      if (this.hasLocalCar) entry.after = this.curr.get(this.mySlot) ?? null;
    }
    return this.seq;
  }

  /** Rewinds to the snapshot and replays the unacknowledged inputs. Never throws on hostile or odd snapshots. */
  reconcile(s: Snapshot): ReconcileResult {
    if (this.epoch === null || s.epoch !== this.epoch) {
      this.counters.droppedEpoch++;
      return none('dropped-epoch');
    }
    if (s.tick <= this.lastTick) {
      this.counters.droppedOld++;
      return none('dropped-old');
    }
    const behind = (this.seq - s.ackSeq) >>> 0;
    const problem =
      behind > 0x7fffffff ? `ack ${s.ackSeq} is ahead of the newest input ${this.seq}`
      : s.cars.length === 0 ? 'no cars'
      : !s.cars.every((c) => finiteState(c.state)) ? 'non-finite state'
      : null;
    if (problem !== null) {
      this.counters.ignored++;
      this.lastIgnored = problem;
      return none('ignored');
    }

    const inSnapshot = new Set(s.cars.map((c) => c.slot));
    let fresh = !this.synced;
    if (!this.sim || !s.cars.every((c) => this.sim!.slots.includes(c.slot))) {
      const slots = [...inSnapshot];
      if (!slots.every((slot) => Number.isInteger(slot) && slot >= 0 && slot < ARENA.MAX_CARS)) {
        this.counters.ignored++;
        this.lastIgnored = `slots out of range: [${slots}]`;
        return none('ignored');
      }
      let next: Simulation;
      try {
        next = this.createSimulation(slots); // the current world is untouched if this throws
      } catch (err) {
        this.failure = err instanceof Error ? err.message : String(err);
        this.counters.ignored++;
        this.lastIgnored = `cannot build a world for slots [${slots}]: ${this.failure}`;
        return none('ignored');
      }
      if (this.sim) {
        this.disposeSim();
        this.counters.worldRebuilds++;
        this.remoteInputs.clear();
        this.meta.clear();
        for (const entry of this.history.values()) entry.after = null;
      }
      this.sim = next;
      fresh = true;
    }
    const sim = this.sim;
    this.lastTick = s.tick;
    this.synced = true;
    const hasLocal = sim.slots.includes(this.mySlot);
    const beforeMap = fresh ? new Map<number, CarState>() : this.curr;

    // 1. put every car back to the server's state at the tick that consumed input `ackSeq`
    const mine = s.cars.find((c) => c.slot === this.mySlot);
    const crowded = mine !== undefined && s.cars.some((c) => c.slot !== this.mySlot && distance(c.state.pos, mine.state.pos) < this.interactionRange);
    const kept = !fresh && hasLocal && !crowded ? this.history.get(s.ackSeq)?.after ?? null : null;
    let keptLocal = false;
    for (const c of s.cars) {
      let state = c.state;
      if (c.slot === this.mySlot) {
        if (kept && distance(kept.pos, c.state.pos) < this.deadbandPos && distance(kept.linvel, c.state.linvel) < this.deadbandVel) {
          state = kept;
          keptLocal = true;
        }
      } else {
        this.remoteInputs.set(c.slot, inputOf(c));
      }
      sim.setState(c.slot, state);
      this.meta.set(c.slot, { flags: c.flags, hp: c.hp, throttle: c.throttle, steer: c.steer });
    }
    for (const slot of sim.slots) if (!inSnapshot.has(slot) && slot !== this.mySlot) this.remoteInputs.set(slot, NEUTRAL_INPUT);
    this.present = inSnapshot;
    this.curr = this.readAll();
    this.prev = this.curr;

    // 2. replay the inputs the server has not consumed yet
    const steps = Math.min(behind, this.historySize);
    for (let i = 0; i < steps; i++) {
      const entry = this.history.get((this.seq - steps + 1 + i) >>> 0);
      this.simulate(entry?.input ?? NEUTRAL_INPUT);
      if (entry && hasLocal) entry.after = this.curr.get(this.mySlot) ?? null;
    }

    const corrections: Correction[] = [];
    if (!fresh) {
      for (const [slot, after] of this.curr) {
        const before = beforeMap.get(slot);
        if (before && inSnapshot.has(slot)) corrections.push({ slot, before, after, error: distance(before.pos, after.pos) });
      }
    }
    const local = corrections.find((c) => c.slot === this.mySlot);
    const resetLocal = hasLocal && !keptLocal;
    if (fresh) this.counters.synced++;
    else {
      this.counters.applied++;
      if (resetLocal) this.counters.resets++;
      if (keptLocal) this.counters.deadbandHits++;
    }
    this.counters.resimSteps += steps;
    return { outcome: fresh ? 'synced' : 'applied', resetLocal, resimSteps: steps, corrections, localError: local?.error ?? 0 };
  }

  /** Poses to draw, interpolated between the last two simulation steps by `alpha` in [0, 1]. Empty until synced. */
  poses(alpha: number): PredictedPose[] {
    if (!this.sim || !this.synced) return [];
    const a = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;
    const out: PredictedPose[] = [];
    for (const [slot, curr] of this.curr) {
      const meta = this.meta.get(slot);
      const own = slot === this.mySlot ? this.history.get(this.seq)?.input : undefined;
      out.push({
        slot,
        state: lerpState(this.prev.get(slot) ?? curr, curr, a),
        flags: meta?.flags ?? SNAP_FLAG_ALIVE,
        hp: meta?.hp ?? 100,
        throttle: own?.throttle ?? meta?.throttle ?? 0,
        steer: own?.steer ?? meta?.steer ?? 0,
        visible: this.present.has(slot),
      });
    }
    return out;
  }

  dispose(): void {
    this.disposeSim();
    this.history.clear();
    this.remoteInputs.clear();
    this.meta.clear();
  }

  private simulate(localInput: CarInput): void {
    const sim = this.sim!;
    if (sim.slots.includes(this.mySlot)) sim.setInput(this.mySlot, localInput);
    for (const [slot, input] of this.remoteInputs) if (sim.slots.includes(slot)) sim.setInput(slot, input);
    sim.step();
    this.prev = this.curr;
    this.curr = this.readAll();
  }

  private readAll(): Map<number, CarState> {
    const out = new Map<number, CarState>();
    for (const slot of this.sim!.slots) out.set(slot, this.sim!.getState(slot));
    return out;
  }

  private disposeSim(): void {
    this.sim?.dispose();
    this.sim = null;
    this.prev = new Map();
    this.curr = new Map();
  }
}
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/client/prediction.test.ts && npm run typecheck`
Expected: PASS — 13 tests; type-check clean.

- [ ] **Step 5: Prove the proximity test bites**

Temporarily change `interactionRange: 10` to `interactionRange: 0` in `DEFAULTS` (`prediction.ts`) and run `npx vitest run tests/client/prediction.test.ts`.
Expected: exactly one failure, `another car is 5 m away: the local car is reset to the server state only when it could be colliding`. Revert the change and re-run: 13 tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(client): Predictor with input history, rollback to the server state and replay of unacknowledged inputs"
```

---

### Task 18: `NetStats` — rolling network and prediction statistics

**Files:**
- Create: `src/client/net/netStats.ts`
- Test: `tests/client/netStats.test.ts`

**Interfaces:**
- Consumes: `ReconcileResult` (Task 17).
- Produces: `interface NetStatsSummary {snapshotsPerSecond, intervalMeanMs, intervalMaxMs, localErrorP50, localErrorP95, localErrorMax, remoteErrorP95, remoteErrorMax, deadbandHitRate, resetsTotal, deadbandHitsTotal, resimStepsAvg, resimMsAvg, droppedTotal, snapsTotal}`, `class NetStats` — `constructor(mySlot, capacity = 300)`, `record(arrivalMs, result, resimMs = 0)`, `recordSnap()`, `summary(nowMs)`, `reset()`; `formatNetStats(summary): string` (one HUD line such as `30/s · err 1.2 cm · kept 96% · replay 7`).

- [ ] **Step 1: Write the failing tests**

`tests/client/netStats.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { NetStats, formatNetStats } from '../../src/client/net/netStats';
import type { ReconcileResult } from '../../src/client/net/prediction';

const state = { pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 }, linvel: { x: 0, y: 0, z: 0 }, angvel: { x: 0, y: 0, z: 0 } };
const applied = (localError: number, over: Partial<ReconcileResult> = {}, remoteError = 0): ReconcileResult => ({
  outcome: 'applied',
  resetLocal: false,
  resimSteps: 6,
  localError,
  corrections: [
    { slot: 0, before: state, after: state, error: localError },
    { slot: 1, before: state, after: state, error: remoteError },
  ],
  ...over,
});
const dropped = (outcome: ReconcileResult['outcome']): ReconcileResult => ({ outcome, resetLocal: false, resimSteps: 0, corrections: [], localError: 0 });

describe('NetStats', () => {
  it('is all zeros before anything happened', () => {
    const s = new NetStats(0).summary(1000);
    expect(s).toMatchObject({ snapshotsPerSecond: 0, localErrorP95: 0, deadbandHitRate: 0, resimStepsAvg: 0, droppedTotal: 0 });
  });

  it('measures the snapshot rate and the arrival jitter', () => {
    const n = new NetStats(0);
    for (let i = 0; i < 90; i++) n.record(1000 + i * 33.333 + (i % 3 === 0 ? 8 : 0), applied(0));
    const s = n.summary(1000 + 89 * 33.333 + 8);
    expect(s.snapshotsPerSecond).toBeGreaterThan(28);
    expect(s.snapshotsPerSecond).toBeLessThan(32);
    expect(s.intervalMeanMs).toBeGreaterThan(30);
    expect(s.intervalMeanMs).toBeLessThan(36);
    expect(s.intervalMaxMs).toBeGreaterThan(38); // the 8 ms wobble shows up as jitter
  });

  it('reports percentiles of the local and remote correction sizes', () => {
    const n = new NetStats(0);
    for (let i = 1; i <= 100; i++) n.record(i * 33, applied(i / 1000, {}, i / 500));
    const s = n.summary(3300);
    expect(s.localErrorP50).toBeCloseTo(0.05, 2);
    expect(s.localErrorP95).toBeCloseTo(0.096, 2);
    expect(s.localErrorMax).toBeCloseTo(0.1, 3);
    expect(s.remoteErrorMax).toBeCloseTo(0.2, 3);
    expect(s.remoteErrorP95).toBeGreaterThan(s.localErrorP95);
  });

  it('counts resets against deadband hits and averages the replay work', () => {
    const n = new NetStats(0);
    for (let i = 0; i < 9; i++) n.record(i * 33, applied(0, { resetLocal: false, resimSteps: 4 }), 0.1);
    n.record(300, applied(0.5, { resetLocal: true, resimSteps: 14 }), 0.3);
    const s = n.summary(400);
    expect(s.deadbandHitRate).toBeCloseTo(0.9, 6);
    expect(s.resetsTotal).toBe(1);
    expect(s.deadbandHitsTotal).toBe(9);
    expect(s.resimStepsAvg).toBeCloseTo(5, 6);
    expect(s.resimMsAvg).toBeCloseTo(0.12, 6);
  });

  it('counts dropped and ignored snapshots but keeps them out of the error statistics', () => {
    const n = new NetStats(0);
    n.record(0, dropped('dropped-old'));
    n.record(33, dropped('dropped-epoch'));
    n.record(66, dropped('ignored'));
    n.record(99, applied(0.01));
    const s = n.summary(100);
    expect(s.droppedTotal).toBe(3);
    expect(s.localErrorMax).toBeCloseTo(0.01, 6);
  });

  it('remembers only the most recent corrections', () => {
    const n = new NetStats(0, 50);
    for (let i = 0; i < 50; i++) n.record(i * 33, applied(5));
    for (let i = 50; i < 100; i++) n.record(i * 33, applied(0.01));
    expect(n.summary(3400).localErrorMax).toBeCloseTo(0.01, 6); // the early spikes have rotated out
  });

  it('counts corrections that were too large to smooth, and can be reset', () => {
    const n = new NetStats(0);
    n.recordSnap();
    n.recordSnap();
    n.record(0, applied(0.1));
    expect(n.summary(10).snapsTotal).toBe(2);
    n.reset();
    expect(n.summary(10)).toMatchObject({ snapsTotal: 0, localErrorMax: 0, snapshotsPerSecond: 0 });
  });

  it('formats a compact one-line summary for the HUD', () => {
    const n = new NetStats(0);
    for (let i = 0; i < 60; i++) n.record(1000 + i * 33.3, applied(0.012, { resimSteps: 7 }));
    const text = formatNetStats(n.summary(3000));
    expect(text).toMatch(/30\/s/);
    expect(text).toMatch(/err 1\.2 cm/);
    expect(text).toMatch(/replay 7/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/client/netStats.test.ts`
Expected: FAIL — cannot resolve `../../src/client/net/netStats`.

- [ ] **Step 3: Implement**

Create `src/client/net/netStats.ts`:

```ts
import type { ReconcileResult } from './prediction';

export interface NetStatsSummary {
  /** Snapshots that arrived per second over the last 2 s (any outcome). */
  snapshotsPerSecond: number;
  /** Gap between consecutive arrivals over the last 5 s: mean and worst (jitter shows up as the difference). */
  intervalMeanMs: number;
  intervalMaxMs: number;
  /** How far the local car's present position moved when a snapshot was applied (metres), over the recent history. */
  localErrorP50: number;
  localErrorP95: number;
  localErrorMax: number;
  /** The same for remote cars. */
  remoteErrorP95: number;
  remoteErrorMax: number;
  /** Fraction of applied snapshots that kept the local prediction untouched. */
  deadbandHitRate: number;
  resetsTotal: number;
  deadbandHitsTotal: number;
  /** Average inputs replayed per applied snapshot and the average wall time of the replay. */
  resimStepsAvg: number;
  resimMsAvg: number;
  /** Snapshots ignored as stale, from another world, or malformed. */
  droppedTotal: number;
  /** Corrections too large to smooth, which snapped the car. */
  snapsTotal: number;
}

const percentile = (values: readonly number[], q: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
};
const mean = (values: readonly number[]): number => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);
const max = (values: readonly number[]): number => (values.length === 0 ? 0 : Math.max(...values));

/** Rolling prediction and network statistics, exposed as `window.__derby.netStats` and used by scripted lag checks. */
export class NetStats {
  private arrivals: number[] = [];
  private local: number[] = [];
  private remote: number[] = [];
  private replay: number[] = [];
  private replayMs: number[] = [];
  private totals = { resets: 0, deadband: 0, dropped: 0, snaps: 0 };

  constructor(
    private readonly mySlot: number,
    private readonly capacity = 300,
  ) {}

  /** Records the outcome of one snapshot. `resimMs` is the wall time the reconciliation took. */
  record(arrivalMs: number, result: ReconcileResult, resimMs = 0): void {
    this.arrivals.push(arrivalMs);
    if (this.arrivals.length > 600) this.arrivals.shift();
    if (result.outcome !== 'applied') {
      if (result.outcome !== 'synced') this.totals.dropped++;
      return;
    }
    this.push(this.local, result.localError);
    for (const c of result.corrections) if (c.slot !== this.mySlot) this.push(this.remote, c.error);
    this.push(this.replay, result.resimSteps);
    this.push(this.replayMs, resimMs);
    if (result.resetLocal) this.totals.resets++;
    else this.totals.deadband++;
  }

  /** Call when a correction was too large to smooth. */
  recordSnap(): void {
    this.totals.snaps++;
  }

  summary(nowMs: number): NetStatsSummary {
    const recent = this.arrivals.filter((t) => t >= nowMs - 5000);
    const lastTwoSeconds = recent.filter((t) => t >= nowMs - 2000).length;
    const gaps = recent.slice(1).map((t, i) => t - recent[i]!);
    const applied = this.totals.resets + this.totals.deadband;
    return {
      snapshotsPerSecond: lastTwoSeconds / 2,
      intervalMeanMs: mean(gaps),
      intervalMaxMs: max(gaps),
      localErrorP50: percentile(this.local, 0.5),
      localErrorP95: percentile(this.local, 0.95),
      localErrorMax: max(this.local),
      remoteErrorP95: percentile(this.remote, 0.95),
      remoteErrorMax: max(this.remote),
      deadbandHitRate: applied === 0 ? 0 : this.totals.deadband / applied,
      resetsTotal: this.totals.resets,
      deadbandHitsTotal: this.totals.deadband,
      resimStepsAvg: mean(this.replay),
      resimMsAvg: mean(this.replayMs),
      droppedTotal: this.totals.dropped,
      snapsTotal: this.totals.snaps,
    };
  }

  reset(): void {
    this.arrivals = [];
    this.local = [];
    this.remote = [];
    this.replay = [];
    this.replayMs = [];
    this.totals = { resets: 0, deadband: 0, dropped: 0, snaps: 0 };
  }

  private push(list: number[], value: number): void {
    list.push(value);
    if (list.length > this.capacity) list.shift();
  }
}

/** One compact line for the HUD, e.g. "30/s · err 1.2 cm · kept 96% · replay 7". */
export function formatNetStats(s: NetStatsSummary): string {
  return `${s.snapshotsPerSecond.toFixed(0)}/s · err ${(s.localErrorP95 * 100).toFixed(1)} cm · kept ${(s.deadbandHitRate * 100).toFixed(0)}% · replay ${s.resimStepsAvg.toFixed(0)}`;
}
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/client/netStats.test.ts && npm run typecheck`
Expected: PASS — 8 tests; type-check clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(client): NetStats rolling prediction and network statistics"
```

---

### Task 19: `PredictedWorld` and the loopback tests

**Files:**
- Create: `src/client/net/predictedWorld.ts`, `tests/helpers/loopback.ts`
- Test: `tests/client/predictedWorld.test.ts`

**Interfaces:**
- Consumes: `Predictor`, `ReconcileResult`, `PredictorOptions` (Task 17); `ErrorSmoother` (Task 15); `NetStats` (Task 18); `DelayLine`, `mulberry32` (Task 16); server `Room` (Task 9), `Player` (Task 8), `FakeSocket` (Task 8 helper), `decodeSnapshot`, `Snapshot` (protocol).
- Produces:
  - `predictedWorld.ts`: `interface RenderPose {slot, pos, quat, linvel, flags, hp, throttle, steer, visible}`, `interface PredictedWorldOptions {predictor?, smoothing?, tauSeconds?, snapDistance?}`, `class PredictedWorld` — `constructor(mySlot, options?)`, `predictor`, `smoother`, `stats`, `failure`, `beginWorld(epoch)`, `step(input): number`, `onSnapshot(snapshot, arrivalMs, clock?): ReconcileResult`, `frame(alpha, dtSeconds): RenderPose[]`, `dispose()`.
  - `tests/helpers/loopback.ts`: `class Loopback` — a real `Room` with two players behind a seeded simulated network, stepped in lock step at 60 Hz by a `PredictedWorld`; `run(seconds)`, `tick()`, `results`, `frames`, `localErrors()`, `remoteErrors()`, `maxVisualJump(slot)`, `serverSim`, `serverState(slot)`, `dispose()`; and `percentile(values, q)`.

- [ ] **Step 1: Write the loopback helper and the failing tests**

`tests/helpers/loopback.ts`:

```ts
import { DelayLine, mulberry32 } from '../../src/client/net/latency';
import type { Predictor, PredictorOptions, ReconcileResult } from '../../src/client/net/prediction';
import { PredictedWorld, type RenderPose } from '../../src/client/net/predictedWorld';
import { quantizeInput, type CarInput } from '../../src/shared/input';
import { decodeSnapshot, type Snapshot } from '../../src/shared/protocol';
import type { Simulation } from '../../src/shared/sim';
import type { CarState } from '../../src/shared/types';
import { Player } from '../../src/server/player';
import { Room } from '../../src/server/room';
import { FakeSocket } from './fakeSocket';

export const TICK_MS = 1000 / 60;

type Down = { kind: 'snapshot'; snapshot: Snapshot } | { kind: 'roster'; epoch: number };
type Up = { seq: number; input: CarInput };

export interface LoopbackOptions {
  /** Added round trip and jitter of the simulated link (ms), and the percentage of binary frames lost. */
  rttMs?: number;
  jitterMs?: number;
  lossPct?: number;
  seed?: number;
  /** Scripted input for the local (predicted) player and the remote player, as a function of the 60 Hz tick index. */
  local: (k: number) => CarInput;
  remote: (k: number) => CarInput;
  predictor?: PredictorOptions;
  /** Set false to record the raw, unsmoothed prediction. */
  smoothing?: boolean;
}

/**
 * A real server Room with two players behind a simulated, seeded network, driven in lock step at 60 Hz by a
 * client Predictor. Time is simulated, so runs are fast and repeatable.
 */
export class Loopback {
  readonly room = new Room('LOOP', true, () => undefined);
  readonly local = new Player(1, new FakeSocket());
  readonly remote = new Player(2, new FakeSocket());
  readonly world: PredictedWorld;
  readonly results: ReconcileResult[] = [];
  /** What the client would draw each 60 Hz frame. */
  readonly frames: RenderPose[][] = [];
  k = 0;
  private remoteSeq = 0;
  private sentIndex = 0;
  private readonly up: DelayLine<Up>;
  private readonly upRemote: DelayLine<Up>;
  private readonly down: DelayLine<Down>;

  constructor(private readonly options: LoopbackOptions) {
    const random = mulberry32(options.seed ?? 1);
    const line = { oneWayMs: (options.rttMs ?? 0) / 2, jitterMs: options.jitterMs ?? 0, lossPct: options.lossPct ?? 0 };
    this.up = new DelayLine(line, random);
    this.upRemote = new DelayLine({ ...line, lossPct: 0 }, random);
    this.down = new DelayLine(line, random);
    this.room.addPlayer(this.local);
    this.room.addPlayer(this.remote);
    this.world = new PredictedWorld(this.local.slot, { predictor: options.predictor, smoothing: options.smoothing });
    this.world.beginWorld(this.room.epoch);
  }

  get predictor(): Predictor {
    return this.world.predictor;
  }

  private get socket(): FakeSocket {
    return (this.local as unknown as { socket: FakeSocket }).socket;
  }

  /** The server's simulation for the current world (null before the first rebuild). */
  get serverSim(): Simulation | null {
    return (Reflect.get(this.room, 'sim') as Simulation | null) ?? null;
  }

  serverState(slot: number): CarState {
    return this.serverSim!.getState(slot);
  }

  /** Advances the simulated clock by one 60 Hz tick. */
  tick(): void {
    const now = this.k * TICK_MS;
    for (const m of this.up.due(now)) this.local.pushInput(m.seq, m.input);
    for (const m of this.upRemote.due(now)) this.remote.pushInput(m.seq, m.input);
    this.room.step();
    const frames = this.socket.sent;
    while (this.sentIndex < frames.length) {
      const frame = frames[this.sentIndex++]!;
      if (typeof frame === 'string') {
        const msg = JSON.parse(frame) as { t: string; epoch?: number };
        if (msg.t === 'roster') this.down.push(now, { kind: 'roster', epoch: msg.epoch! });
      } else {
        const snapshot = decodeSnapshot(frame);
        if (snapshot) this.down.push(now, { kind: 'snapshot', snapshot }, true);
      }
    }
    for (const d of this.down.due(now)) {
      if (d.kind === 'roster') this.world.beginWorld(d.epoch);
      else this.results.push(this.world.onSnapshot(d.snapshot, now));
    }
    this.remoteSeq++;
    this.upRemote.push(now, { seq: this.remoteSeq, input: quantizeInput(this.options.remote(this.k)) });
    const input = quantizeInput(this.options.local(this.k));
    const seq = this.world.step(input);
    this.up.push(now, { seq, input }, true);
    this.frames.push(this.world.frame(1, 1 / 60));
    this.k++;
  }

  run(seconds: number): void {
    const n = Math.round((seconds * 1000) / TICK_MS);
    for (let i = 0; i < n; i++) this.tick();
  }

  /** Position errors (m) of the local car's present pose at each applied snapshot. */
  localErrors(): number[] {
    return this.results.filter((r) => r.outcome === 'applied').map((r) => r.localError);
  }

  remoteErrors(): number[] {
    return this.results
      .filter((r) => r.outcome === 'applied')
      .flatMap((r) => r.corrections.filter((c) => c.slot !== this.local.slot).map((c) => c.error));
  }

  /**
   * Largest frame-to-frame jump (m) of a car's drawn position beyond the motion its own velocity explains, ignoring
   * the first `skipFrames` frames (world start) and frames within 3 frames of a sudden speed change (an impact
   * really does change a car's motion abruptly). What remains is what a player would see as a teleport.
   */
  maxVisualJump(slot: number, skipFrames = 90): number {
    const at = (i: number): RenderPose | undefined => this.frames[i]?.find((p) => p.slot === slot);
    const speedAt = (i: number): number => {
      const p = at(i);
      return p ? Math.hypot(p.linvel.x, p.linvel.z) : 0;
    };
    const impactNear = (i: number): boolean => {
      for (let j = i - 3; j <= i + 3; j++) if (j >= 1 && Math.abs(speedAt(j) - speedAt(j - 1)) > 2) return true;
      return false;
    };
    let worst = 0;
    for (let i = Math.max(1, skipFrames); i < this.frames.length; i++) {
      const a = at(i - 1);
      const b = at(i);
      if (!a || !b || !a.visible || !b.visible || impactNear(i)) continue;
      worst = Math.max(worst, Math.hypot(b.pos.x - a.pos.x - b.linvel.x / 60, b.pos.z - a.pos.z - b.linvel.z / 60));
    }
    return worst;
  }

  dispose(): void {
    this.world.dispose();
    this.room.dispose();
  }
}

export const percentile = (values: readonly number[], q: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
};
```

`tests/client/predictedWorld.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../../src/shared/physics';
import type { CarInput } from '../../src/shared/input';
import { Loopback, percentile } from '../helpers/loopback';

beforeAll(async () => {
  await initPhysics();
});

const straight = (): CarInput => ({ throttle: 1, steer: 0, handbrake: false });
const weave = (k: number): CarInput => ({ throttle: 1, steer: Math.sin(k / 20) * 0.9, handbrake: false });
const gentle = (k: number): CarInput => ({ throttle: 0.9, steer: Math.sin(k / 37 + 1) * 0.7, handbrake: false });

const loops: Loopback[] = [];
const loopback = (options: ConstructorParameters<typeof Loopback>[0]): Loopback => {
  const l = new Loopback(options);
  loops.push(l);
  return l;
};
afterEach(() => {
  while (loops.length) loops.pop()!.dispose();
});

describe('Predictor against a real server room', () => {
  it('matches the server almost exactly when the network is perfect', () => {
    const l = loopback({ local: straight, remote: gentle });
    l.run(8);
    const applied = l.results.filter((r) => r.outcome === 'applied');
    expect(applied.length).toBeGreaterThan(200);
    expect(percentile(l.localErrors(), 0.95)).toBeLessThan(0.01);
    expect(Math.max(...l.localErrors())).toBeLessThan(0.05);
    const kept = applied.filter((r) => !r.resetLocal).length;
    expect(kept / applied.length).toBeGreaterThan(0.95); // the deadband keeps the local prediction
  });

  it('stays smooth at 100 ms round trip with 20 ms jitter', () => {
    const l = loopback({ rttMs: 100, jitterMs: 20, local: weave, remote: gentle });
    l.run(10);
    expect(percentile(l.localErrors(), 0.95)).toBeLessThan(0.03);
    expect(Math.max(...l.localErrors())).toBeLessThan(0.35);
    expect(percentile(l.remoteErrors(), 0.95)).toBeLessThan(0.08);
    const resim = l.results.filter((r) => r.outcome === 'applied').map((r) => r.resimSteps);
    expect(Math.max(...resim)).toBeGreaterThan(3); // it really re-simulates the unacknowledged inputs
    expect(Math.max(...resim)).toBeLessThan(30);
  });

  it('predicts a head-on collision about as well as the server plays it', () => {
    const l = loopback({ rttMs: 100, jitterMs: 15, local: straight, remote: straight });
    l.run(9);
    const a = l.serverState(0).pos;
    const b = l.serverState(1).pos;
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(8); // the cars did meet
    expect(Math.max(...l.localErrors())).toBeLessThan(0.35);
  });

  it('survives packet loss and reordering pressure with bounded corrections', () => {
    const l = loopback({ rttMs: 100, jitterMs: 20, lossPct: 3, local: weave, remote: gentle, seed: 7 });
    l.run(10);
    expect(Math.max(...l.localErrors())).toBeLessThan(0.6);
    expect(percentile(l.localErrors(), 0.95)).toBeLessThan(0.2);
  });

  it('snaps back to the server after the authority moves the car, then converges', () => {
    const l = loopback({ rttMs: 60, jitterMs: 5, local: straight, remote: gentle });
    l.run(4);
    const before = l.results.length;
    const sim = l.serverSim!;
    const s = sim.getState(0);
    sim.setState(0, { ...s, pos: { x: s.pos.x, y: s.pos.y, z: s.pos.z + 2 } }); // e.g. a hit the client never saw coming
    l.run(1.5);
    const after = l.results.slice(before);
    expect(after.some((r) => r.outcome === 'applied' && r.resetLocal && r.localError > 1)).toBe(true);
    const tail = after.slice(-20).filter((r) => r.outcome === 'applied');
    expect(Math.max(...tail.map((r) => r.localError))).toBeLessThan(0.1); // converged again
  });

});

describe('PredictedWorld: what the player would see', () => {
  it('never shows a visible teleport on the local car at 100 ms round trip with jitter', () => {
    const l = loopback({ rttMs: 100, jitterMs: 20, local: weave, remote: gentle });
    l.run(10);
    expect(l.maxVisualJump(0)).toBeLessThan(0.02);
  });

  it('never shows a visible teleport on other cars either', () => {
    const l = loopback({ rttMs: 100, jitterMs: 20, local: weave, remote: gentle });
    l.run(10);
    expect(l.maxVisualJump(1)).toBeLessThan(0.05);
  });

  it('stays smooth through a head-on collision under lag', () => {
    const l = loopback({ rttMs: 120, jitterMs: 25, local: straight, remote: straight });
    l.run(9);
    expect(l.maxVisualJump(0)).toBeLessThan(0.03);
    expect(l.maxVisualJump(1)).toBeLessThan(0.03);
  });

  it('is visibly smoother than drawing the raw prediction', () => {
    const smooth = loopback({ rttMs: 120, jitterMs: 25, local: weave, remote: weave, seed: 4 });
    const raw = loopback({ rttMs: 120, jitterMs: 25, local: weave, remote: weave, seed: 4, smoothing: false });
    smooth.run(10);
    raw.run(10);
    const worstSmooth = Math.max(smooth.maxVisualJump(0), smooth.maxVisualJump(1));
    const worstRaw = Math.max(raw.maxVisualJump(0), raw.maxVisualJump(1));
    expect(worstRaw).toBeGreaterThan(worstSmooth * 2);
  });

  it('snaps instead of smoothing when the authority moves a car far away, and counts it', () => {
    const l = loopback({ rttMs: 60, jitterMs: 5, local: straight, remote: gentle });
    l.run(4);
    const sim = l.serverSim!;
    const s = sim.getState(0);
    sim.setState(0, { ...s, pos: { x: s.pos.x, y: s.pos.y, z: s.pos.z + 6 } }); // a 6 m teleport
    l.run(1);
    expect(l.world.stats.summary(l.k * (1000 / 60)).snapsTotal).toBeGreaterThan(0);
  });

  it('reports the network statistics the debug overlay shows', () => {
    const l = loopback({ rttMs: 100, jitterMs: 20, local: weave, remote: gentle });
    l.run(6);
    const s = l.world.stats.summary(l.k * (1000 / 60));
    expect(s.snapshotsPerSecond).toBeGreaterThan(25);
    expect(s.snapshotsPerSecond).toBeLessThan(35);
    expect(s.localErrorP95).toBeLessThan(0.05);
    expect(s.deadbandHitRate).toBeGreaterThan(0.7);
    expect(s.resimStepsAvg).toBeGreaterThan(3);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/client/predictedWorld.test.ts`
Expected: FAIL — cannot resolve `../../src/client/net/predictedWorld`.

- [ ] **Step 3: Implement**

Create `src/client/net/predictedWorld.ts`:

```ts
import type { CarInput } from '../../shared/input';
import type { Snapshot } from '../../shared/protocol';
import type { Quat, Vec3 } from '../../shared/types';
import { NetStats } from './netStats';
import { Predictor, type PredictorOptions, type ReconcileResult } from './prediction';
import { ErrorSmoother } from './smoothing';

export interface RenderPose {
  slot: number;
  /** Position and orientation to draw: the predicted pose plus the decaying correction offset. */
  pos: Vec3;
  quat: Quat;
  linvel: Vec3;
  flags: number;
  hp: number;
  throttle: number;
  steer: number;
  visible: boolean;
}

export interface PredictedWorldOptions {
  predictor?: PredictorOptions;
  /** Set false to draw the raw prediction (used to measure how much the smoothing hides). Default true. */
  smoothing?: boolean;
  tauSeconds?: number;
  snapDistance?: number;
}

/**
 * Everything the client does in prediction mode, without a DOM: numbers and predicts local inputs, reconciles
 * snapshots, hides corrections with the error smoother and keeps the network statistics.
 */
export class PredictedWorld {
  readonly predictor: Predictor;
  readonly smoother: ErrorSmoother;
  readonly stats: NetStats;
  private readonly smoothing: boolean;

  constructor(
    readonly mySlot: number,
    options: PredictedWorldOptions = {},
  ) {
    this.predictor = new Predictor(mySlot, options.predictor);
    this.smoother = new ErrorSmoother(options.tauSeconds, options.snapDistance);
    this.stats = new NetStats(mySlot);
    this.smoothing = options.smoothing ?? true;
  }

  /** Non-null when prediction cannot run at all (see Predictor.failure); the caller should fall back to interpolation. */
  get failure(): string | null {
    return this.predictor.failure;
  }

  /** A new world (welcome or roster message): forget predictions and pending corrections. */
  beginWorld(epoch: number): void {
    this.predictor.beginWorld(epoch);
    this.smoother.clear();
  }

  /** One local 60 Hz tick. Returns the input's sequence number, to send to the server with the same input. */
  step(input: CarInput): number {
    return this.predictor.step(input);
  }

  /** Feeds a decoded snapshot that arrived at `arrivalMs`. */
  onSnapshot(snapshot: Snapshot, arrivalMs: number, clock: () => number = () => performance.now()): ReconcileResult {
    const started = clock();
    const result = this.predictor.reconcile(snapshot);
    this.stats.record(arrivalMs, result, clock() - started);
    if (result.outcome === 'synced') this.smoother.clear();
    else if (result.outcome === 'applied' && this.smoothing) {
      for (const c of result.corrections) {
        const kind = this.smoother.absorb(c.slot, { pos: c.before.pos, quat: c.before.quat }, { pos: c.after.pos, quat: c.after.quat });
        if (kind === 'snapped' && c.error > 0) this.stats.recordSnap();
      }
    }
    return result;
  }

  /** Poses to draw this frame; `alpha` is the fraction of the way to the next fixed step, `dtSeconds` the frame time. */
  frame(alpha: number, dtSeconds: number): RenderPose[] {
    this.smoother.decay(dtSeconds);
    return this.predictor.poses(alpha).map((p) => {
      const drawn = this.smoother.apply(p.slot, { pos: p.state.pos, quat: p.state.quat });
      return {
        slot: p.slot,
        pos: drawn.pos,
        quat: drawn.quat,
        linvel: p.state.linvel,
        flags: p.flags,
        hp: p.hp,
        throttle: p.throttle,
        steer: p.steer,
        visible: p.visible,
      };
    });
  }

  dispose(): void {
    this.predictor.dispose();
    this.smoother.clear();
  }
}
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/client/predictedWorld.test.ts && npm run typecheck`
Expected: PASS — 11 tests (the loopback tests take a few seconds); type-check clean. If a threshold assertion fails on a very slow machine, re-run it alone first; the simulated clock makes the results independent of wall-clock speed, so a failure means a real regression.

- [ ] **Step 5: Run everything**

Run: `npm test`
Expected: PASS — 259 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(client): PredictedWorld ties prediction, smoothing and statistics together, tested against a real server room"
```

---

### Task 20: Determinism hash, tuning freeze and the Node hash script

**Files:**
- Create: `src/shared/determinism.ts`, `scripts/hash.ts`
- Modify: `src/shared/constants.ts` (add `freezeTuning`), `package.json` (add the `hash` script)
- Test: `tests/determinism.test.ts`, `tests/tuning.test.ts`

**Interfaces:**
- Consumes: `Simulation` (Task 4), `CarInput` (input), `initPhysics` (physics), `DRIVE`, `TIRE`, `SUSPENSION` (constants).
- Produces:
  - `determinism.ts`: `scriptedInput(slot, tick): CarInput` (integer-only driving script: everyone charges the arena centre for 5 s, then throttle/coast/reverse/weave/handbrake), `interface ScriptedRun {hash, closestApproach, topSpeed}`, `runScripted(ticks = 600, slots = [0, 1, 2]): ScriptedRun` (FNV-1a over the exact IEEE-754 bits of every car's full state on every tick), `simHash(ticks?, slots?): string` (8 hex digits).
  - `constants.ts`: `freezeTuning(): void` — freezes `DRIVE`, `TIRE`, `SUSPENSION`.
  - `npm run hash` → prints the hash on stdout (and `ticks=… closestApproach=… topSpeed=…` on stderr).

- [ ] **Step 1: Write the failing tests**

`tests/determinism.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../src/shared/physics';
import { runScripted, scriptedInput, simHash } from '../src/shared/determinism';

beforeAll(async () => {
  await initPhysics();
});

describe('scriptedInput', () => {
  it('stays inside the legal range and is a pure function of slot and tick', () => {
    for (let slot = 0; slot < 8; slot++) {
      for (let tick = 0; tick < 1200; tick += 7) {
        const a = scriptedInput(slot, tick);
        expect(a).toEqual(scriptedInput(slot, tick));
        expect(Math.abs(a.throttle)).toBeLessThanOrEqual(1);
        expect(Math.abs(a.steer)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('exercises throttle, reverse, both steering directions and the handbrake', () => {
    const inputs = Array.from({ length: 600 }, (_, t) => scriptedInput(0, t));
    expect(inputs.some((i) => i.throttle === 1)).toBe(true);
    expect(inputs.some((i) => i.throttle === -1)).toBe(true);
    expect(inputs.some((i) => i.steer > 0.5)).toBe(true);
    expect(inputs.some((i) => i.steer < -0.5)).toBe(true);
    expect(inputs.some((i) => i.handbrake)).toBe(true);
  });
});

describe('simHash', () => {
  it('is a fixed-width hex string', () => {
    expect(simHash(60)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is identical across repeated runs in one process', () => {
    expect(simHash(600)).toBe(simHash(600));
  });

  it('does not depend on the order the roster is given in', () => {
    expect(simHash(300, [2, 0, 1])).toBe(simHash(300, [0, 1, 2]));
  });

  it('changes when the run is longer, shorter or has different cars', () => {
    const base = simHash(300);
    expect(simHash(301)).not.toBe(base);
    expect(simHash(299)).not.toBe(base);
    expect(simHash(300, [0, 1])).not.toBe(base);
  });

  it('covers contact dynamics: the scripted cars really collide within 600 ticks', () => {
    const run = runScripted(600, [0, 1, 2]);
    expect(run.closestApproach).toBeLessThan(5);
    expect(run.topSpeed).toBeGreaterThan(10);
  });
});
```

`tests/tuning.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DRIVE, SUSPENSION, TIRE, freezeTuning } from '../src/shared/constants';

describe('freezeTuning', () => {
  it('makes the live-tunable objects read-only so nothing can drift the shared simulation by accident', () => {
    expect(Object.isFrozen(DRIVE)).toBe(false); // the offline sandbox edits these through its tuning panel
    const engine = DRIVE.ENGINE;
    freezeTuning();
    expect(Object.isFrozen(DRIVE) && Object.isFrozen(TIRE) && Object.isFrozen(SUSPENSION)).toBe(true);
    expect(() => {
      DRIVE.ENGINE = 1;
    }).toThrow(TypeError);
    expect(() => {
      TIRE.SLIP = 9;
    }).toThrow(TypeError);
    expect(() => {
      SUSPENSION.STIFFNESS = 9;
    }).toThrow(TypeError);
    expect(DRIVE.ENGINE).toBe(engine);
  });

  it('is safe to call more than once', () => {
    freezeTuning();
    expect(() => freezeTuning()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/determinism.test.ts tests/tuning.test.ts`
Expected: FAIL — cannot resolve `../src/shared/determinism`, and `freezeTuning is not a function`.

- [ ] **Step 3: Implement**

Create `src/shared/determinism.ts`:

```ts
import type { CarInput } from './input';
import { Simulation } from './sim';

/**
 * A fixed, collision-prone driving script: integer arithmetic only, so it is identical on every JavaScript engine.
 * Used to compare the simulation bit for bit between Node and browsers.
 */
export function scriptedInput(slot: number, tick: number): CarInput {
  // First 5 s: full throttle straight at the arena centre, so the cars meet (spawns face the centre). Then a mixed
  // pattern of throttle, coasting, reverse, weaving and handbrake that keeps them colliding with each other and the wall.
  const phase = (tick + slot * 37) % 240;
  const throttle = tick < 300 ? 1 : phase < 170 ? 1 : phase < 200 ? 0 : -1;
  const wave = (tick * (slot + 2) + slot * 11) % 120;
  const steer = tick < 300 ? 0 : (wave < 60 ? wave : 120 - wave) / 30 - 1; // triangle wave in [-1, 1]
  const handbrake = tick >= 300 && (tick + slot * 53) % 300 > 280;
  return { throttle, steer, handbrake };
}

export interface ScriptedRun {
  /** 8 hex digits: FNV-1a over the exact bits of every car's state at every tick. */
  hash: string;
  /** Smallest centre-to-centre distance between two cars during the run (m). */
  closestApproach: number;
  topSpeed: number;
}

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

/** Runs the script for `ticks` steps (Rapier must be initialised) and hashes every car's full state each tick. */
export function runScripted(ticks = 600, slots: readonly number[] = [0, 1, 2]): ScriptedRun {
  const sim = new Simulation(slots);
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    f64[0] = v === 0 ? 0 : v; // fold -0 into 0: engines agree on values, and this keeps the hash about the state
    for (let i = 0; i < 2; i++) {
      h ^= u32[i]!;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  let closest = Infinity;
  let top = 0;
  try {
    for (let t = 0; t < ticks; t++) {
      for (const slot of sim.slots) sim.setInput(slot, scriptedInput(slot, t));
      sim.step();
      const states = sim.slots.map((slot) => sim.getState(slot));
      for (const s of states) {
        mix(s.pos.x); mix(s.pos.y); mix(s.pos.z);
        mix(s.quat.x); mix(s.quat.y); mix(s.quat.z); mix(s.quat.w);
        mix(s.linvel.x); mix(s.linvel.y); mix(s.linvel.z);
        mix(s.angvel.x); mix(s.angvel.y); mix(s.angvel.z);
        top = Math.max(top, Math.hypot(s.linvel.x, s.linvel.z));
      }
      for (let i = 0; i < states.length; i++) {
        for (let j = i + 1; j < states.length; j++) {
          closest = Math.min(closest, Math.hypot(states[i]!.pos.x - states[j]!.pos.x, states[i]!.pos.z - states[j]!.pos.z));
        }
      }
    }
  } finally {
    sim.dispose();
  }
  return { hash: h.toString(16).padStart(8, '0'), closestApproach: closest, topSpeed: top };
}

export const simHash = (ticks = 600, slots: readonly number[] = [0, 1, 2]): string => runScripted(ticks, slots).hash;
```

Append to `src/shared/constants.ts`:

```ts

/**
 * Locks `DRIVE`, `TIRE` and `SUSPENSION`. The offline sandbox edits them live through its tuning panel; every other
 * route calls this at start-up so nothing can change the shared simulation's physics behind the server's back.
 */
export function freezeTuning(): void {
  Object.freeze(DRIVE);
  Object.freeze(TIRE);
  Object.freeze(SUSPENSION);
}
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/determinism.test.ts tests/tuning.test.ts && npm run typecheck`
Expected: PASS — 9 tests (determinism 7, tuning 2); type-check clean.

- [ ] **Step 5: Add the Node hash script**

Create `scripts/hash.ts`:

```ts
// Prints the hash of the scripted determinism run. Compare with the browser: `await __derby.simHash()` on any page.
//   npx tsx scripts/hash.ts [ticks]
import { runScripted } from '../src/shared/determinism';
import { initPhysics } from '../src/shared/physics';

await initPhysics();
const ticks = Number(process.argv[2] ?? 600);
const run = runScripted(Number.isFinite(ticks) && ticks > 0 ? Math.floor(ticks) : 600);
console.log(run.hash);
console.error(`ticks=${ticks} closestApproach=${run.closestApproach.toFixed(2)} m topSpeed=${run.topSpeed.toFixed(1)} m/s`);
```

In `package.json` add to `"scripts"`: `"hash": "tsx scripts/hash.ts"`.

Run: `npm run hash` twice.
Expected: the same 8 hex digits both times on stdout (the rehearsal printed `10c3a72a`), and on stderr a line such as `ticks=600 closestApproach=4.50 m topSpeed=15.9 m/s` — a closest approach near 4.5 m means the cars really collided during the run.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(shared): scripted determinism hash, tuning freeze and the Node hash script"
```

---

### Task 21: Wire prediction into the client; verify in a real browser

**Files:**
- Replace: `src/client/game/gameClient.ts`, `src/client/main.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `PredictedWorld`, `RenderPose` (Task 19); `formatNetStats` (Task 18); `LagSocket`, `LagOptions`, `parseLagParams` (Task 16); `SnapshotInterpolator` (Task 11); `freezeTuning` (Task 20); `simHash` (Task 20); `initPhysics` (Task 14); everything `GameClient` already used (Task 12).
- Produces: `GameClientOptions` gains `net?: 'predict' | 'interp'` and `lag?: LagOptions | null`; `GameClient` predicts by default, falls back to interpolation on `?net=interp` or when the local world cannot be built; `window.__derby` gains `netStats` (getter), `simHash(ticks?)` and `debug()` now reports `mode`, `prediction` counters and `visible` per pose. URL parameters: `?net=interp`, `?lag=&jitter=&loss=`.

- [ ] **Step 1: Replace `src/client/game/gameClient.ts`**

```ts
import * as THREE from 'three';
import { CAR_FORWARD, NET, PHYSICS } from '../../shared/constants';
import { quantizeInput } from '../../shared/input';
import { quatRotate, vdot, vlen } from '../../shared/math';
import type { PlayerInfo, ServerMessage, Snapshot } from '../../shared/protocol';
import type { Quat, Vec3 } from '../../shared/types';
import { steeringAngle } from '../../shared/vehicle';
import { Connection } from '../net/connection';
import { SnapshotInterpolator } from '../net/interp';
import { LagSocket, type LagOptions } from '../net/latency';
import { formatNetStats } from '../net/netStats';
import { PredictedWorld } from '../net/predictedWorld';
import type { Hud } from '../ui/hud';
import type { JoinChoice } from '../ui/menu';
import { ChaseCamera } from './camera';
import { CarView } from './carView';
import { KeyboardInput } from './input';
import { createNameTag, disposeNameTag } from './nameTag';
import type { GameScene } from './scene';
import { FixedStepper } from './stepper';

export interface GameClientOptions {
  gs: GameScene;
  hud: Hud;
  choice: JoinChoice;
  url: string;
  /** Called once when the game ends (server refused, connection lost, ...). */
  onExit(message?: string): void;
  /** 'predict' (default) runs the local simulation with rollback; 'interp' only interpolates server snapshots (?net=interp). */
  net?: 'predict' | 'interp';
  /** Simulated network conditions (?lag=&jitter=&loss=). */
  lag?: LagOptions | null;
}

/** One car as drawn this frame, whichever networking mode produced it. */
interface DrawPose {
  slot: number;
  pos: Vec3;
  quat: Quat;
  linvel: Vec3;
  steer: number;
  visible: boolean;
  extrapolated: boolean;
}

/**
 * Sends inputs at 60 Hz. In 'predict' mode (default) it runs the shared simulation locally for every car, rolls back
 * to each server snapshot and replays the unacknowledged inputs, so your own car reacts instantly; in 'interp' mode
 * (?net=interp) it only draws interpolated server snapshots.
 */
export class GameClient {
  private readonly views = new Map<number, CarView>();
  private readonly tags = new Map<number, THREE.Sprite>();
  private readonly interp = new SnapshotInterpolator();
  private mode: 'predict' | 'interp';
  private world: PredictedWorld | null = null;
  private readonly chase = new ChaseCamera();
  private readonly keyboard = new KeyboardInput();
  private readonly stepper = new FixedStepper(PHYSICS.DT);
  private readonly timer = new THREE.Timer();
  private readonly conn: Connection;
  private mySlot = -1;
  private roomCode = '';
  private joined = false;
  private opened = false;
  private roster: PlayerInfo[] = [];
  private epoch = 0;
  private seq = 0;
  private snapshotsReceived = 0;
  private lastPoses: DrawPose[] = [];
  private raf = 0;
  private stopped = false;
  private frames = 0;
  private fps = 0;
  private fpsAt = performance.now();
  private statsAt = 0;

  constructor(private readonly opts: GameClientOptions) {
    this.mode = opts.net ?? 'predict';
    this.timer.connect(document);
    const lag = opts.lag ?? null;
    this.conn = new Connection(
      opts.url,
      {
        onOpen: () => this.onOpen(),
        onMessage: (m) => this.onMessage(m),
        onSnapshot: (s, at) => {
          if (this.world) {
            const outcome = this.world.onSnapshot(s, at).outcome;
            if (this.world.failure !== null) this.fallBackToInterpolation(this.world.failure, s, at);
            else if (outcome === 'applied' || outcome === 'synced') this.snapshotsReceived++;
          } else if (this.interp.push(s, at)) this.snapshotsReceived++;
        },
        onClose: (info) => this.onClose(info),
      },
      undefined,
      lag ? (u) => new LagSocket(new WebSocket(u), lag) as unknown as WebSocket : undefined,
    );
  }

  start(): void {
    this.conn.connect();
    this.raf = requestAnimationFrame(this.frame);
    const derby = ((window as unknown as { __derby?: Record<string, unknown> }).__derby ??= {});
    Object.defineProperty(derby, 'debug', { value: () => this.debug(), configurable: true, writable: true });
    Object.defineProperty(derby, 'netStats', { get: () => this.world?.stats.summary(performance.now()) ?? null, configurable: true });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    this.keyboard.dispose();
    this.conn.close();
    for (const slot of [...this.tags.keys()]) this.removeTag(slot);
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.timer.dispose();
    this.world?.dispose();
    this.world = null;
    this.opts.hud.dispose();
  }

  private finish(message?: string): void {
    if (this.stopped) return;
    this.stop();
    this.opts.onExit(message);
  }

  /** The local simulation cannot run (for example the physics engine failed to load): draw interpolated snapshots instead. */
  private fallBackToInterpolation(reason: string, snapshot: Snapshot, arrivalMs: number): void {
    console.error('Prediction unavailable, falling back to interpolation:', reason);
    this.world?.dispose();
    this.world = null;
    this.mode = 'interp';
    this.interp.reset(this.epoch);
    if (this.interp.push(snapshot, arrivalMs)) this.snapshotsReceived++;
    this.opts.hud.showNotice('Prediction unavailable — using interpolation.');
  }

  private onOpen(): void {
    this.opened = true;
    const { choice } = this.opts;
    this.conn.send({
      t: 'hello',
      v: NET.PROTOCOL_VERSION,
      name: choice.name,
      color: choice.color,
      mode: choice.mode,
      code: choice.code,
    });
  }

  private onMessage(m: ServerMessage): void {
    switch (m.t) {
      case 'welcome':
        this.mySlot = m.you;
        this.roomCode = m.room.code;
        this.joined = true;
        this.epoch = m.epoch;
        this.roster = m.players;
        this.interp.reset(m.epoch);
        if (this.mode === 'predict') {
          this.world?.dispose();
          this.world = new PredictedWorld(m.you);
          this.world.beginWorld(m.epoch);
        }
        this.applyRoster();
        this.opts.hud.setRoom(m.room.code, m.room.public);
        this.opts.hud.setPlayers(this.roster, this.mySlot);
        break;
      case 'roster':
        this.epoch = m.epoch;
        this.roster = m.players;
        this.interp.reset(m.epoch); // a new world: drop all buffered snapshots
        this.world?.beginWorld(m.epoch);
        this.applyRoster();
        this.opts.hud.setPlayers(this.roster, this.mySlot);
        break;
      case 'error':
        if (this.joined) this.opts.hud.showNotice(m.message);
        else this.finish(m.message);
        break;
      case 'pong':
        break;
    }
  }

  private onClose(info: { code: number; reason: string }): void {
    if (this.stopped) return;
    let message: string;
    if (!this.opened) message = 'Could not reach the game server.';
    else if (info.code === 4001) message = 'You were disconnected for inactivity.';
    else if (info.code === 1002) message = 'The game was updated — reload the page and try again.';
    else message = `Disconnected from the server${info.reason ? `: ${info.reason}` : ''}.`;
    this.finish(message);
  }

  private applyRoster(): void {
    const slots = new Set(this.roster.map((p) => p.slot));
    for (const p of this.roster) {
      const existing = this.views.get(p.slot);
      if (existing) {
        existing.setColor(p.color);
      } else {
        const view = new CarView(p.color);
        view.group.visible = false; // shown once the first snapshot for this world arrives
        this.opts.gs.scene.add(view.group);
        this.views.set(p.slot, view);
      }
      if (p.slot === this.mySlot) this.removeTag(p.slot); // no floating name over your own car
      else this.setTag(p.slot, p.name);
    }
    for (const [slot, view] of this.views) {
      if (!slots.has(slot)) {
        this.removeTag(slot);
        view.dispose();
        this.views.delete(slot);
      }
    }
  }

  private setTag(slot: number, name: string): void {
    const view = this.views.get(slot);
    if (!view) return;
    const existing = this.tags.get(slot);
    if (existing && existing.userData.name === name) return;
    if (existing) disposeNameTag(existing);
    const tag = createNameTag(name);
    tag.userData.name = name;
    view.group.add(tag);
    this.tags.set(slot, tag);
  }

  private removeTag(slot: number): void {
    const tag = this.tags.get(slot);
    if (!tag) return;
    disposeNameTag(tag);
    this.tags.delete(slot);
  }

  private readonly frame = (ts: number): void => {
    if (this.stopped) return;
    this.timer.update(ts);
    const dt = this.timer.getDelta();

    let alpha = 1;
    if (this.joined) {
      alpha = this.stepper.advance(dt, () => {
        const input = quantizeInput(this.keyboard.sample(PHYSICS.DT));
        const seq = this.world ? this.world.step(input) : (this.seq = (this.seq + 1) >>> 0);
        this.conn.sendInput(seq, input);
      });
    }

    const poses = this.drawPoses(alpha, dt);
    this.lastPoses = poses;
    const seen = new Set<number>();
    for (const p of poses) {
      const view = this.views.get(p.slot);
      if (!view || !p.visible) continue;
      seen.add(p.slot);
      view.group.visible = true;
      view.setPose(p.pos, p.quat);
      const vf = vdot(p.linvel, quatRotate(p.quat, CAR_FORWARD));
      view.animateWheels(vf, steeringAngle(p.steer, vf), dt);
    }
    for (const [slot, view] of this.views) if (!seen.has(slot)) view.group.visible = false;

    const me = poses.find((p) => p.slot === this.mySlot && p.visible);
    if (me) {
      this.chase.update(this.opts.gs.camera, { pos: me.pos, quat: me.quat, speed: vlen(me.linvel) }, dt);
    }
    this.opts.gs.resize();
    this.opts.gs.render();
    this.updateStats();
    this.raf = requestAnimationFrame(this.frame);
  };

  private drawPoses(alpha: number, dt: number): DrawPose[] {
    if (this.world) {
      return this.world.frame(alpha, dt).map((p) => ({
        slot: p.slot,
        pos: p.pos,
        quat: p.quat,
        linvel: p.linvel,
        steer: p.steer,
        visible: p.visible,
        extrapolated: false,
      }));
    }
    return this.interp.sample(performance.now()).map((p) => ({
      slot: p.slot,
      pos: p.state.pos,
      quat: p.state.quat,
      linvel: p.state.linvel,
      steer: p.steer,
      visible: true,
      extrapolated: p.extrapolated,
    }));
  }

  private updateStats(): void {
    this.frames++;
    const now = performance.now();
    if (now - this.fpsAt >= 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsAt));
      this.frames = 0;
      this.fpsAt = now;
    }
    if (now - this.statsAt > 250) {
      this.statsAt = now;
      const net = this.world
        ? formatNetStats(this.world.stats.summary(now))
        : `snapshots ${this.snapshotsReceived} · buffer ${this.interp.size}`;
      this.opts.hud.setStats(`${this.mode} · ping ${Math.round(this.conn.rttMs)} ms · ${this.fps} fps · ${net}`);
    }
  }

  /** Read-only snapshot of client state for automated checks: `window.__derby.debug()`. */
  private debug() {
    return {
      mode: this.mode,
      mySlot: this.mySlot,
      roomCode: this.roomCode,
      epoch: this.epoch,
      joined: this.joined,
      roster: this.roster,
      rttMs: Math.round(this.conn.rttMs),
      seq: this.world ? this.world.predictor.sequence : this.seq,
      prediction: this.world
        ? { ...this.world.predictor.counters, synced: this.world.predictor.isSynced, epoch: this.world.predictor.worldEpoch, lastIgnored: this.world.predictor.lastIgnored }
        : null,
      snapshotsReceived: this.snapshotsReceived,
      interpSize: this.interp.size,
      stale: this.interp.stale,
      fps: this.fps,
      poses: this.lastPoses.map((p) => ({
        slot: p.slot,
        x: p.pos.x,
        y: p.pos.y,
        z: p.pos.z,
        speed: vlen(p.linvel),
        extrapolated: p.extrapolated,
        visible: p.visible,
      })),
    };
  }
}
```

- [ ] **Step 2: Replace `src/client/main.ts`**

```ts
import { freezeTuning } from '../shared/constants';
import { initPhysics } from '../shared/physics';
import { simHash } from '../shared/determinism';
import { webglAvailable } from './game/capabilities';
import { GameClient } from './game/gameClient';
import { startSandbox } from './game/sandbox';
import { createGameScene, type GameScene } from './game/scene';
import { serverUrl } from './net/connection';
import { parseLagParams } from './net/latency';
import { createHud } from './ui/hud';
import { automaticChoice } from './ui/autoChoice';
import { showMenu, type JoinChoice } from './ui/menu';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hudEl = document.getElementById('hud') as HTMLElement;
const ui = document.getElementById('ui') as HTMLElement;

/** Slow orbit around the arena behind the menu. Returns a function that stops it. */
function startBackdrop(gs: GameScene): () => void {
  let raf = 0;
  let t = 0;
  let running = true;
  const frame = (): void => {
    if (!running) return;
    t += 0.003;
    gs.camera.position.set(Math.cos(t) * 46, 20, Math.sin(t) * 46);
    gs.camera.lookAt(0, 1, 0);
    gs.resize();
    gs.render();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    running = false;
    cancelAnimationFrame(raf);
  };
}

async function play(gs: GameScene, choice: JoinChoice, params: URLSearchParams): Promise<string | undefined> {
  let net: 'predict' | 'interp' = params.get('net') === 'interp' ? 'interp' : 'predict';
  if (net === 'predict') {
    try {
      await initPhysics(); // the local simulation needs the WASM physics engine
    } catch (err) {
      console.error('Physics engine failed to load, using interpolation:', err);
      net = 'interp';
    }
  }
  const lag = parseLagParams(params);
  const url = serverUrl(location, import.meta.env.VITE_WS_URL as string | undefined);
  return new Promise((resolve) => {
    new GameClient({ gs, hud: createHud(ui), choice, url, onExit: resolve, net, lag }).start();
  });
}

async function boot(): Promise<void> {
  if (!webglAvailable()) {
    hudEl.textContent =
      'WebGL 2 is not available in this browser. Try a current Chrome, Edge, Firefox or Safari with hardware acceleration enabled.';
    return;
  }
  const params = new URLSearchParams(location.search);
  if (!params.has('sandbox')) freezeTuning(); // only the offline sandbox may edit the physics tuning
  try {
    if (params.has('sandbox')) {
      await startSandbox(canvas, hudEl);
      return;
    }
    hudEl.textContent = '';
    const gs = createGameScene(canvas);
    const initialCode = params.get('room') ?? undefined;
    let auto = automaticChoice(params);
    let error: string | undefined;
    for (;;) {
      const stopBackdrop = startBackdrop(gs);
      const choice = auto ?? (await showMenu(ui, { initialCode, error }));
      auto = null;
      stopBackdrop();
      ui.replaceChildren();
      error = await play(gs, choice, params); // resolves when the game ends; loop back to the menu with the reason
    }
  } catch (err) {
    console.error(err);
    hudEl.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// Debug hooks: `await __derby.simHash()` hashes a scripted 600-tick simulation, to compare Node against this browser.
Object.assign((window as unknown as { __derby?: object }).__derby ?? ((window as unknown as { __derby: object }).__derby = {}), {
  simHash: async (ticks = 600): Promise<string> => {
    await initPhysics();
    return simHash(ticks);
  },
});

void boot();
```

- [ ] **Step 3: Type-check, run everything, build, smoke**

Run: `npm run typecheck && npm test && npm run build`
Expected: type-check clean; all 268 tests pass; the build succeeds.

Run: `SMOKE_PROD_PORT=18090 SMOKE_SERVER_PORT=18091 SMOKE_VITE_PORT=15173 npm run smoke`
Expected: two `OK` lines. (These ports keep the check clear of a running `npm run dev`.)

- [ ] **Step 4: Verify in a real browser (headless Chromium via the Playwright MCP; the in-app pane pauses animation when hidden)**

Start a private stack on other ports and a bot as the second driver:

```bash
PORT=18081 npx tsx src/server/index.ts                                             # serves dist/client and /ws
npx tsx scripts/bot.ts --url ws://localhost:18081/ws --mode quick --name Bot --seconds 400
npm run hash                                                                        # note the Node hash
```

Attach `pageerror`, `console` (errors and warnings) and `requestfailed` listeners *before* navigating, and check each of these against `http://localhost:18081/`:

1. **Determinism across runtimes.** Load any page, then `await window.__derby.simHash()` must equal the `npm run hash` output exactly.
2. **Prediction mode (default).** Open `?auto=quick&name=Predict`; after ~4 s `window.__derby.debug()` reports `mode: 'predict'`, a two-name roster, two poses and `prediction.synced: true`. Hold W for 3 s (real key events), then `window.__derby.netStats` must show `snapshotsPerSecond` between 27 and 33, `localErrorP95 < 0.02`, `deadbandHitRate > 0.85`, `droppedTotal: 0`, `resimMsAvg < 3`. The HUD's bottom-left line reads like `predict · ping 1 ms · 120 fps · 30/s · err 0.0 cm · kept 95% · replay 1`.
3. **Under a bad network, prediction vs interpolation.** Open `?auto=quick&name=LagP&lag=120&jitter=30&loss=1` and, separately, the same URL with `&net=interp`. After the world settles (~4.5 s) measure the time from a synthetic W key-down to the drawn car's speed exceeding 0.5 m/s:

```js
await page.evaluate(() => new Promise((resolve) => {
  const t0 = performance.now();
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
  const check = () => {
    const d = window.__derby.debug();
    const me = d.poses.find((p) => p.slot === d.mySlot);
    if (me && me.speed > 0.5) resolve(Math.round(performance.now() - t0));
    else if (performance.now() - t0 > 4000) resolve(null);
    else requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}));
```

   Expected: predict mode ≤ 120 ms and interpolation mode ≥ 200 ms (the rehearsal measured 46 ms and 305 ms). After weaving with A/D for a few seconds in predict mode: `localErrorP95 < 0.05`, `remoteErrorP95 < 0.3`, `resimStepsAvg` between 5 and 20, and the HUD shows a ping near 120–160 ms.
4. **Fallback when the physics engine cannot load.** Add an init script that makes `WebAssembly.instantiate` and `WebAssembly.compile` reject, then open `?auto=quick&name=NoWasm`. Expected: the game still joins and renders (`debug().mode === 'interp'`, two poses), and the console shows exactly one error, `Physics engine failed to load, using interpolation:` — the only console error tolerated anywhere in this step.
5. **Fallback toggle and hostile parameters.** `?auto=quick&net=interp` reports `mode: 'interp'` and `netStats` is `null`. `?auto=quick&lag=abc&jitter=-5&loss=999&net=zzz` joins in predict mode (garbage is clamped or ignored) and stays playable.
6. **Console.** Across steps 1–3 and 5 there are no `pageerror`s, console errors, warnings or failed requests.

Take a screenshot in predict mode showing both cars and the HUD. Then stop the private server and the bot, and remove any `.playwright-mcp/` folder the browser tool created.

- [ ] **Step 5: Extend the README and commit**

Append to `README.md`:

```markdown
## Netcode

- Your own car is **predicted**: the browser runs the same physics as the server for every car, replays your not-yet-acknowledged inputs on top of each server snapshot, and hides the small corrections. `?net=interp` switches to plain snapshot interpolation — to compare, or if prediction ever misbehaves. If the physics engine cannot load in a browser, the game falls back to interpolation on its own.
- Try bad networks in the browser: `?lag=120&jitter=30&loss=1` adds 120 ms of round trip, ±30 ms of jitter per direction and 1 % lost input/snapshot frames (JSON control messages are never dropped).
- `window.__derby.netStats` (summarised in the HUD's bottom-left line) shows snapshot rate and jitter, how large corrections were, how often the local prediction was kept, and the cost of the replay. `window.__derby.debug()` adds the predictor's counters.
- Determinism check: `npm run hash` prints the hash of a scripted 600-tick, 3-car simulation (collisions included) run in Node; `await __derby.simHash()` in a browser console must print the same 8 digits.
```

Commit:

```bash
git add -A
git commit -m "feat(client): client-side prediction with rollback, error smoothing, lag simulation and interpolation fallback"
```

---

## Plan 3 done when

- [ ] `npm run typecheck`, `npm test` (268 tests), `npm run build` and `npm run smoke` all pass.
- [ ] Task 21 Step 4 passes in a real browser: identical Node and Chromium simulation hashes; prediction mode healthy with a bot; a key press moves the car ≥ 2× sooner than interpolation under 120 ms simulated lag; the physics-load fallback works; no console problems.
- [ ] **The user has played it** with a bot or a second window — ideally also with `?lag=120&jitter=30&loss=1` — and confirmed it feels right.

**Known limits of this baseline (each addressed by a later plan):** the arena still resets on every join or leave (rounds replace it in Plan 4); remote cars are predicted with their last known input, so a sudden change of direction by another player is corrected once their next snapshot arrives; the `?net=interp` fallback still re-learns its clock offset after each rebuild; no damage, dents, particles or audio yet (Plans 4–5); no Dockerfile, per-IP limits or load test yet (Plan 6).

**Next plans** (written after this one is verified, against the code as it then stands): Plan 4 — damage, rounds, scoring, server-side bots; Plan 5 — destruction visuals and audio; Plan 6 — polish and packaging.
