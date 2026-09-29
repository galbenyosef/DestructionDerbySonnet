# Wreckyard Plan 4 — Combat, Rounds and Bots (M4, server side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the driving playground into a game. A room plays in rounds (countdown, live, results); impacts cost hit points; cars are eliminated and stay as wrecks; damage, kills and wins score points; bots fill the room and step aside as humans join; players who arrive late watch until the next round. Everything is decided on the server, and the browser client keeps working with it (it learns its slot from each round, holds its car still when the server does, and draws wrecks charred).

**Architecture:** The shared `Simulation` stays untouched except for a read-only `contacts()` that reports the impulse each car received from other cars and from walls during the last step. On the server, a `HitTracker` merges those per-tick contacts into impacts (short windows, a threshold that ignores scraping and pushing), `hitDamage` prices each impact from its impulse and the zone that was hit, a `CarWatch` per car applies the elimination rules (flipped, immobile, out of bounds, anti-stall), a `RoundState` keeps hit points, kills and points, and the `Room` is a small state machine (countdown → live → results) that builds a fresh world every round, feeds each car its driver's input (a `BotBrain` for bots, the player's queue for humans, `PARKED_INPUT` for frozen and wrecked cars) and broadcasts snapshots plus the new `phase`, `hit`, `ko`, `scores` and `results` messages. On the client, the predictor takes its local slot from each roster and applies the same "the server ignores this input" rule the server does, so prediction stays exact through countdowns and wrecks.

**Tech Stack:** as Plans 1-3. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-28-wreckyard-design.md` — "Gameplay rules", "Netcode → Events", the M4 row and the Addendum on impacts. **Prerequisite:** Plan 3 complete and reviewed (branch `plan-3-prediction-rollback`, HEAD `5028320`, 285 tests). This plan starts on a new branch cut from it.

**Scope notes:**
- The spec's M4 is split in two: this plan (server rules, bots, protocol, and the client changes the new protocol forces) and **Plan 5 (the match screen)**: health bar, damage diagram, timer, kill feed, scoreboard, banners, spectator camera controls. Until then the client shows wrecks charred, follows another car when its own is out, and reports the phase and every car's HP through `window.__derby.debug()`. The spec's M5 (destruction and juice) becomes Plan 6 and M6 (packaging) Plan 7.
- Deviations from the spec text, each with its reason: (1) impacts are read from the narrow phase after each step (`contactPair` → `contactImpulse`) instead of from contact-force events — the rehearsal measured both and they agree to the last digit, while polling needs no event queue and leaves the shared simulation, and so the browser, untouched; (2) a `scores` message keeps the running leaderboard current (the spec's event list has none); (3) protocol version 2 makes a browser that still runs the old client reload instead of misreading the new messages; (4) a player who joins during a countdown restarts it (at most eight times per round), so friends who join together play together — the spec says late joiners spectate, which still holds once the round is live; (5) quick play prefers a room where a car comes soon (between rounds) over a fuller one that is mid-round.
- Tuning is a first guess: every number lives in `COMBAT` and `ROUND` in `src/shared/constants.ts`. Nobody has played it yet; expect to adjust `DAMAGE_SCALE`, `WALL_MULTIPLIER` and the bots after the first playtest.

## How a round works (read this first)

```
first human joins ─► COUNTDOWN 5 s ─► LIVE ≤ 4 min ─► RESULTS 8 s ─► COUNTDOWN (a new world) ─► …
                     │ fresh world      │ inputs count      │ world keeps running, cars parked
                     │ cars parked      │ impacts cost HP   │ a joiner is seated in the next round
                     │ a joiner restarts│ a joiner watches
                     │ it (≤ 8×/round)  │
LIVE ends when: one car or none is left · time is up (the most HP wins, level = draw) · no human car is left.
```

- **Slots belong to a round.** When a round starts, everyone in the room gets a car (humans in join order, then bots up to `botFill` cars) and the server sends each human a `roster` with their own `you`. A player who joined later has `you = -1` until the next roster. Cars of players who leave stay in the world as wrecks.
- **Hit points, kills and points belong to `RoundState`;** running totals belong to the room's participants and survive from round to round while the participant stays.
- **The server is the only authority:** the client never sends hit points, eliminations or scores.

## Rehearsal findings (measured before this plan was written)

I rehearsed everything below in a scratch copy of the Plan 3 code — real `Room`, real `Simulation`, real WebSockets and headless Chromium — and then executed this plan text against a fresh copy to check that it reproduces the rehearsal file for file. The numbers explain the constants.

- **Impulses can be read straight from the narrow phase.** For a head-on collision at 10 m/s each, the summed `contactImpulse` of the pair is 19.2 kN·s per car, identical to the contact-force event's `totalForce × dt`, and within 2 % of the momentum change (19.6 kN·s). It lands within one tick. 5 m/s each → 9.5 kN·s, 2 m/s each → 3.7 kN·s; a 15 m/s wall hit → 29.0 kN·s in one tick; a T-bone at 10 m/s → 9.6 kN·s in the first tick, then ~250 N·s per tick of sliding for about 20 ticks.
- **Where the contact is.** Weighted by impulse, the contact point of a head-on averages to the middle of the front face of both cars (x ≈ +2.3 m); a T-bone gives the attacker's front and the victim's long side (|z| ≈ 1.0 m). A car lying on its roof touches the ground with its body, so the ground is left out of the contacts.
- **Pushing is not an impact.** Two cars pushing at full throttle produce a steady 266 N·s per tick per pair (two rear wheels × 8000 N ÷ 60), far below the 350 N·s per tick threshold, while the collision that started it is one tick of 7 kN·s. Grinding along a wall at 13-14 m/s for 7.5 s costs 4-5 HP in total.
- **The damage curve.** `0.295 × (kN·s − 1.5)^1.5`: 3.7 kN·s → 1 HP, 9.5 → 6.7 HP, 19.2 → 21.8 HP (times 1.15 on the front: 25 HP each for a 10 m/s head-on), a 15 m/s wall hit → 21 HP.
- **Pacing.** With the bots as the only drivers, a round of 4 cars ended in 21-89 s and a round of 8 cars in 39-72 s, with 38-67 hits and everybody's HP used up; no round stalled or ended by flipping. Server cost with 8 cars is 0.03-0.06 ms per tick on average, 0.18 ms at the 99th percentile.
- **In the browser** (Chromium, production build, a private server with a 3 s countdown): the local car stays at 0.1 m/s while W is held during the countdown, reaches 16 m/s once the round is live, the prediction error stays under 4 cm, a full-throttle player who ignores the walls and the bots is out within seconds and the next round starts by itself. That is why wall hits and the bots' aggression are tuning candidates.
- **The dry run caught one ordering mistake in this plan:** the new client waits for the server's `phase: live` message before it lets the local car drive, so it must come *after* the room that sends it (Task 29 after Task 28).

## Global Constraints

- Everything in Plans 1-3's Global Constraints still applies (single package, relative imports, exact pins, axes, deterministic simulation path, quantised inputs, prediction constants, `freezeTuning`, commits only because the user opted in).
- The shared simulation's behaviour does not change: `Simulation.contacts()` only reads, and `npm run hash` still prints `10c3a72a` (Node and browser). Server-only code (bots, hit windows, rules, rounds) may use floating-point and `Math.atan2`; nothing of it reaches the simulation except each car's input.
- Server-authoritative gameplay (spec): 100 HP; zone multipliers front 1.15, rear 0.9, sides 1.0; walls and obstacles ×0.5; assists credited for 5 s; eliminated when HP ≤ 0, flipped > 3 s, immobile > 8 s, out of bounds or disconnected; anti-stall 2 HP/s after 20 s without hitting or being hit; countdown 5 s, live at most 4 min, results 8 s; bots fill to 4 cars; score 1 point per HP of damage dealt, +50 for an elimination, +100 for winning the round; at most 8 cars.
- Damage comes from impacts, not from contact over time: a contact under 350 N·s in a tick is a scrape or a push and counts for nothing; contacts of one pair are merged into a window that closes after 3 quiet ticks or 30 ticks; damage is priced once per window from its total impulse (kN·s).
- The wire format changes: `NET.PROTOCOL_VERSION` becomes 2. Binary frames (inputs, snapshots) are unchanged; snapshot `hp` is the car's HP rounded up while it runs (so a running car never shows 0) and 0 for a wreck; `SNAP_FLAG_ALIVE` is cleared for wrecks; frozen and wrecked cars are given `PARKED_INPUT`, so the snapshot echoes `handbrake`.
- Slots are per round; `Player.slot` is -1 until the next roster for a player who is watching. `ackSeq` keeps its meaning (consumed or discarded), and every human's input queue is drained every tick whatever their car is doing.
- Server-side randomness (bot skill and noise) is seeded (`RoomOptions.seed`), so tests are repeatable; production seeds each room randomly.
- The user's own `npm run dev` may be running on ports 8080/5173: never stop it. Use `PORT` (and `SMOKE_*`, `WRECKYARD_SERVER_PORT`) with other ports for anything that needs a server, and do not start a second Vite next to it.

## Review Focus

1. **Odd endings.** Every car out on the same tick, the last human dead while bots still run, a lone car with no opponent, a timeout with level HP, the winner leaving during the results, the last human leaving at any moment. Expected: a sensible result (a draw is `winner = -1`), no exception, an empty room is disposed exactly once. → Task 28 (`room.test.ts`), Task 30 (`roomCombat.test.ts`).
2. **Contact that is not an impact.** Pushing at full throttle, grinding along a wall, resting contact, a car on its roof, absurd values (NaN, Infinity, a teleport). Expected: no damage from pushing or scraping, bounded damage from grinding, a broken body is eliminated instead of poisoning the round. → Tasks 22, 24, 25.
3. **Joining and leaving in every phase.** Joining during the countdown (restart, at most eight times), during the live round (watch), during the results (next round), a ninth player, quick play choosing between rooms, a player leaving during the countdown. Expected: nobody inherits a wreck, nobody holds a room back indefinitely, no message reaches a player before their `welcome`. → Task 28.
4. **Bots in trouble.** Stuck against a wall or a car, no targets, only bots left, dead bots, four bots fighting for a minute, a bot across a world rebuild. Expected: they back out, keep off the wall, never leave the arena and never throw. → Task 27, Task 28.
5. **Messages out of order or out of range.** A roster or phase before there is a world, `you = -1`, slots outside 0-7, negative damage, an unknown zone, an old client (version 1). Expected: parsers reject, sessions ignore, the server answers an old client with `bad_version`. → Tasks 26, 29.

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/constants.ts` (modify), `src/shared/types.ts` (modify) | `COMBAT`, `ROUND`, `Zone`, protocol version 2 |
| `src/shared/damage.ts` | impact → HP curve, the four zones, multipliers |
| `src/shared/arena.ts`, `src/shared/sim.ts` (modify) | `buildArena` returns the ground collider; `Simulation.contacts()` |
| `src/shared/protocol.ts` (replace) | protocol 2: `phase`, `hit`, `ko`, `scores`, `results`, `you` in the roster, strict parsers |
| `src/shared/input.ts` (modify), `src/shared/random.ts` | `PARKED_INPUT`; the seeded PRNG (moved out of the client) |
| `src/server/combat.ts` | `HitTracker` (contacts → impacts), `AttackLog` (who hit whom lately) |
| `src/server/rules.ts` | `CarWatch`: flipped, immobile, out of bounds, anti-stall |
| `src/server/bots.ts` | `BotBrain`, bot names and colours |
| `src/server/round.ts` | `RoundState`: HP, eliminations, kills, points |
| `src/server/room.ts` (replace) | the round state machine: roster, phases, inputs, snapshots, messages |
| `src/server/lobby.ts`, `src/server/app.ts` (modify) | room options; the greeting; quick play prefers a room where a car comes soon |
| `src/server/config.ts`, `src/server/index.ts` (replace) | settings from environment variables |
| `src/client/net/prediction.ts`, `netStats.ts`, `predictedWorld.ts`, `session.ts` | the local slot per round, the parked car, the phase |
| `src/client/game/gameClient.ts`, `carView.ts` | wrecks, camera, debug hook |
| `scripts/bot.ts`, `scripts/smoke-e2e.mjs`, `README.md` | headless player follows rounds; protocol version; docs |
| `tests/…` | one file per module above, plus `tests/helpers/roomKit.ts`, and adaptations of the tests written for the old rebuild-on-every-join policy |

---

### Task 22: Combat constants and the damage model

**Files:**
- Modify: `src/shared/types.ts` (`Zone`), `src/shared/constants.ts` (`COMBAT`, `ROUND`)
- Create: `src/shared/damage.ts`
- Test: `tests/damage.test.ts`

**Interfaces:**
- Consumes: `CAR.HALF` (Plan 1), `Vec3` (types).
- Produces: `Zone`; `COMBAT` and `ROUND` (tuning, in kN·s / HP / ticks); `impactDamage(kns)`, `classifyZone(local)`, `hitDamage(kns, zone, againstWall)`. Tasks 24-30 use them.

- [ ] **Step 1: Write the failing tests**

`tests/damage.test.ts` pins the damage curve to the collisions measured in the rehearsal (3.7, 9.5 and 19.2 kN·s per car), the four zones with their corner rule, and the multipliers.

Create `tests/damage.test.ts`:

<!-- op {"kind": "create", "path": "tests/damage.test.ts"} -->
```ts
import { describe, expect, it } from 'vitest';
import { CAR, COMBAT } from '../src/shared/constants';
import { classifyZone, hitDamage, impactDamage } from '../src/shared/damage';

describe('impactDamage', () => {
  it('ignores impacts under the minimum, including nonsense values', () => {
    expect(impactDamage(0)).toBe(0);
    expect(impactDamage(COMBAT.MIN_IMPULSE)).toBe(0);
    expect(impactDamage(-5)).toBe(0);
    expect(impactDamage(Number.NaN)).toBe(0);
    expect(impactDamage(Number.POSITIVE_INFINITY)).toBe(0); // a broken simulation must not read as a killing blow
  });

  it('is anchored to measured collisions (1500 kg cars, impulse = mass x velocity change)', () => {
    // head-on at 2, 5 and 10 m/s each measured 3.7, 9.5 and 19.2 kN·s per car
    expect(impactDamage(3.7)).toBeGreaterThan(0.5);
    expect(impactDamage(3.7)).toBeLessThan(1.5); // a bump barely scratches
    expect(impactDamage(9.5)).toBeGreaterThan(5);
    expect(impactDamage(9.5)).toBeLessThan(8); // a firm hit costs a few percent
    expect(impactDamage(19.2)).toBeGreaterThan(20);
    expect(impactDamage(19.2)).toBeLessThan(24); // a hard head-on is about a fifth of a car
  });

  it('grows faster than linearly, so hard hits hurt disproportionately', () => {
    expect(impactDamage(20)).toBeGreaterThan(2 * impactDamage(10));
    let last = 0;
    for (let j = 2; j <= 40; j += 2) {
      const d = impactDamage(j);
      expect(d).toBeGreaterThan(last);
      last = d;
    }
  });
});

describe('classifyZone', () => {
  const h = CAR.HALF;
  it('names the side a contact point lies on (forward +X, right +Z)', () => {
    expect(classifyZone({ x: h.x, y: 0, z: 0 })).toBe('front');
    expect(classifyZone({ x: -h.x, y: 0, z: 0.2 })).toBe('rear');
    expect(classifyZone({ x: 0.3, y: 0, z: h.z })).toBe('right');
    expect(classifyZone({ x: -0.3, y: 0, z: -h.z })).toBe('left');
  });

  it('gives corners to the front or rear, and treats the centre as front', () => {
    expect(classifyZone({ x: h.x, y: 0, z: h.z })).toBe('front');
    expect(classifyZone({ x: -h.x, y: 0, z: -h.z })).toBe('rear');
    expect(classifyZone({ x: 0, y: 0, z: 0 })).toBe('front');
  });

  it('compares the two axes relative to the car size, not in metres', () => {
    // 1.5 m forward of centre is less far along the 2.3 m half length than 1.0 m sideways is along the 1.0 m half width
    expect(classifyZone({ x: 1.5, y: 0, z: 0.99 })).toBe('right');
    expect(classifyZone({ x: 2.2, y: 0, z: 0.5 })).toBe('front');
  });
});

describe('hitDamage', () => {
  it('multiplies by the zone that was hit: rear is the safest, front the most exposed', () => {
    const base = impactDamage(15);
    expect(hitDamage(15, 'front', false)).toBeCloseTo(base * 1.15, 9);
    expect(hitDamage(15, 'rear', false)).toBeCloseTo(base * 0.9, 9);
    expect(hitDamage(15, 'left', false)).toBeCloseTo(base, 9);
    expect(hitDamage(15, 'right', false)).toBeCloseTo(base, 9);
    expect(hitDamage(15, 'rear', false)).toBeLessThan(hitDamage(15, 'right', false));
    expect(hitDamage(15, 'right', false)).toBeLessThan(hitDamage(15, 'front', false));
  });

  it('halves damage against walls and obstacles', () => {
    expect(hitDamage(15, 'front', true)).toBeCloseTo(hitDamage(15, 'front', false) * 0.5, 9);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/damage.test.ts`
Expected: FAIL — the test file cannot resolve `../src/shared/damage`.

<!-- check {"cmd": "npx vitest run tests/damage.test.ts", "outcome": "fail"} -->

- [ ] **Step 3: Implement**

Add the `Zone` type to `src/shared/types.ts`:

Append to `src/shared/types.ts`:

<!-- op {"kind": "append", "path": "src/shared/types.ts"} -->
```ts
/** Which side of a car took an impact: front (+X), rear (-X), left (-Z), right (+Z). */
export type Zone = 'front' | 'rear' | 'left' | 'right';
```

In `src/shared/constants.ts`, insert the combat and round tuning directly above `export const NET = {`:

In `src/shared/constants.ts`, replace the line:

<!-- op {"kind": "edit", "path": "src/shared/constants.ts"} -->
```ts
export const NET = {
```

with:

```ts
/** Combat tuning. Impulses are in kN·s (1000 N·s), damage in HP, durations in simulation ticks (60 per second). */
export const COMBAT = {
  MAX_HP: 100,
  /** A contact that transmits less impulse than this (N·s) in one tick is a scrape or a push, not an impact. */
  SCRAPE_IMPULSE: 350,
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
```

Create `src/shared/damage.ts`:

<!-- op {"kind": "create", "path": "src/shared/damage.ts"} -->
```ts
import { CAR, COMBAT } from './constants';
import type { Vec3, Zone } from './types';

/** HP an impact of `impulse` kN·s is worth before any multiplier. Nothing below COMBAT.MIN_IMPULSE, then a power curve. */
export function impactDamage(impulse: number): number {
  const over = impulse - COMBAT.MIN_IMPULSE;
  return Number.isFinite(over) && over > 0 ? COMBAT.DAMAGE_SCALE * over ** COMBAT.DAMAGE_EXPONENT : 0;
}

/** The side of the car that a contact point (in the car's local frame, forward +X, right +Z) lies on. Corners count as front/rear. */
export function classifyZone(local: Vec3): Zone {
  const nx = local.x / CAR.HALF.x;
  const nz = local.z / CAR.HALF.z;
  if (Math.abs(nx) >= Math.abs(nz)) return nx >= 0 ? 'front' : 'rear';
  return nz >= 0 ? 'right' : 'left';
}

/** HP taken by the car that was hit: the impact curve times the zone multiplier, halved against walls and obstacles. */
export function hitDamage(impulse: number, zone: Zone, againstWall: boolean): number {
  return impactDamage(impulse) * COMBAT.ZONE_MULTIPLIER[zone] * (againstWall ? COMBAT.WALL_MULTIPLIER : 1);
}
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/damage.test.ts && npm run typecheck`
Expected: PASS — 8 tests; type-check clean.

<!-- check {"cmd": "npx vitest run tests/damage.test.ts && npm run typecheck", "outcome": "pass", "tests": 8} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(shared): combat tuning and the impact damage model"
```

<!-- commit "feat(shared): combat tuning and the impact damage model" -->

---

### Task 23: The simulation reports contacts

**Files:**
- Modify: `src/shared/arena.ts` (`buildArena` returns the ground collider), `src/shared/sim.ts` (`Simulation.contacts`)
- Test: `tests/contacts.test.ts`

**Interfaces:**
- Consumes: `Simulation` (Plan 1), `classifyZone` (Task 22), `scriptedInput` (Plan 3).
- Produces: `Contact {a, b, impulse, pointA, pointB}` and `Simulation.contacts(minImpulse = 0): Contact[]` — the impulse each car received from other cars and from walls during the last step, and where. Read-only. `ArenaColliders {ground}` from `buildArena`.

- [ ] **Step 1: Write the failing tests**

The tests stage a head-on collision, a T-bone, a wall hit, a hit on the seam between two wall segments, a car lying on its roof, and check that reading contacts every tick never changes the simulation.

Create `tests/contacts.test.ts`:

<!-- op {"kind": "create", "path": "tests/contacts.test.ts"} -->
```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CAR } from '../src/shared/constants';
import { classifyZone } from '../src/shared/damage';
import { scriptedInput } from '../src/shared/determinism';
import { quatFromYaw } from '../src/shared/math';
import { initPhysics } from '../src/shared/physics';
import { Simulation, type Contact } from '../src/shared/sim';
import type { Quat } from '../src/shared/types';

beforeAll(async () => {
  await initPhysics();
});

const sims: Simulation[] = [];
afterEach(() => {
  while (sims.length) sims.pop()!.dispose();
});
function sim(slots: number[]): Simulation {
  const s = new Simulation(slots);
  sims.push(s);
  return s;
}

/** Puts a car at (x, z) facing `yaw` (0 = +X, PI = -X) and moving forward at `speed` m/s. */
function place(s: Simulation, slot: number, x: number, z: number, yaw: number, speed: number): void {
  s.setState(slot, {
    pos: { x, y: 1.07, z },
    quat: quatFromYaw(yaw),
    linvel: { x: Math.cos(yaw) * speed, y: 0, z: -Math.sin(yaw) * speed },
    angvel: { x: 0, y: 0, z: 0 },
  });
}

/** Steps until the first tick with a contact at least `min` N·s strong; returns the ticks stepped and every contact seen. */
function runUntilContact(s: Simulation, max: number, min = 1): { tick: number; contacts: Contact[] } {
  for (let t = 1; t <= max; t++) {
    s.step();
    const contacts = s.contacts(min);
    if (contacts.length > 0) return { tick: t, contacts };
  }
  return { tick: max, contacts: [] };
}

describe('Simulation.contacts', () => {
  it('reports nothing while cars drive on open ground', () => {
    const s = sim([0, 1]);
    place(s, 0, -10, -20, 0, 8);
    place(s, 1, -10, 20, 0, 8);
    for (let t = 0; t < 120; t++) {
      s.step();
      expect(s.contacts()).toEqual([]);
    }
  });

  it('measures a head-on collision as the momentum change of each car, on the front of both', () => {
    const s = sim([0, 1]);
    place(s, 0, -9, 0, 0, 10);
    place(s, 1, 9, 0, Math.PI, 10);
    const { contacts } = runUntilContact(s, 120);
    expect(contacts).toHaveLength(1); // a pair of cars is reported once
    const c = contacts[0]!;
    expect([c.a, c.b]).toEqual([0, 1]);
    // restitution 0.25: each car's velocity changes by 10 x 1.25 = 12.5 m/s, and 1500 kg x 12.5 = 18.75 kN·s
    expect(c.impulse).toBeGreaterThan(17_500);
    expect(c.impulse).toBeLessThan(20_500);
    expect(classifyZone(c.pointA)).toBe('front');
    expect(classifyZone(c.pointB)).toBe('front');
    expect(c.pointA.x).toBeGreaterThan(CAR.HALF.x - 0.2);
    expect(c.pointB.x).toBeGreaterThan(CAR.HALF.x - 0.2);
    expect(Math.abs(c.pointA.z)).toBeLessThan(0.3); // the corner contacts average out across the centre line
  });

  it('puts a T-bone on the side of the car that was hit and the front of the car that hit', () => {
    const s = sim([0, 1]);
    place(s, 0, -10, 0, 0, 10); // drives +X
    place(s, 1, 0, 0, Math.PI / 2, 0); // parked across its path, so it is hit on a long side
    const { contacts } = runUntilContact(s, 120);
    const c = contacts.find((k) => k.a === 0 && k.b === 1)!;
    expect(c).toBeDefined();
    expect(classifyZone(c.pointA)).toBe('front');
    expect(['left', 'right']).toContain(classifyZone(c.pointB));
    expect(Math.abs(c.pointB.z)).toBeGreaterThan(CAR.HALF.z - 0.15);
    expect(c.impulse).toBeGreaterThan(8_000);
  });

  it('reports a wall hit for the car alone (b = -1)', () => {
    const s = sim([0]);
    place(s, 0, 25, 0, 0, 15); // toward the wall ring at x = 45
    const { contacts } = runUntilContact(s, 200);
    expect(contacts).toHaveLength(1);
    const c = contacts[0]!;
    expect([c.a, c.b]).toEqual([0, -1]);
    expect(c.impulse).toBeGreaterThan(25_000); // 1500 kg x 15 m/s x ~1.3 = 29 kN·s
    expect(c.impulse).toBeLessThan(33_000);
    expect(classifyZone(c.pointA)).toBe('front');
    expect(c.pointB).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('merges the contacts with several walls into one entry, so a hit on the seam between two wall segments counts in full', () => {
    const theta = Math.PI / 32; // the seam between wall segment 0 and segment 1
    const s = sim([0]);
    s.setState(0, {
      pos: { x: 30 * Math.cos(theta), y: 1.07, z: 30 * Math.sin(theta) },
      quat: quatFromYaw(-theta),
      linvel: { x: 15 * Math.cos(theta), y: 0, z: 15 * Math.sin(theta) },
      angvel: { x: 0, y: 0, z: 0 },
    });
    let peak = 0;
    for (let t = 0; t < 150; t++) {
      s.step();
      const walls = s.contacts().filter((c) => c.b === -1);
      expect(walls.length).toBeLessThanOrEqual(1);
      for (const w of walls) peak = Math.max(peak, w.impulse);
    }
    expect(peak).toBeGreaterThan(25_000); // both segments' impulses are added up (one alone is about 12 kN·s)
  });

  it('honours the minimum impulse', () => {
    const s = sim([0, 1]);
    place(s, 0, -9, 0, 0, 10);
    place(s, 1, 9, 0, Math.PI, 10);
    const { tick } = runUntilContact(s, 120);
    const t = sim([0, 1]);
    place(t, 0, -9, 0, 0, 10);
    place(t, 1, 9, 0, Math.PI, 10);
    for (let i = 0; i < tick; i++) t.step();
    expect(t.contacts(1e9)).toEqual([]);
    expect(t.contacts(1)).toHaveLength(1);
  });

  it('does not report the ground, even for a car lying on its roof', () => {
    const s = sim([0]);
    const upsideDown: Quat = { x: 1, y: 0, z: 0, w: 0 }; // half a turn about the forward axis
    s.setState(0, { pos: { x: 0, y: 0.7, z: 0 }, quat: upsideDown, linvel: { x: 0, y: 0, z: 0 }, angvel: { x: 0, y: 0, z: 0 } });
    for (let t = 0; t < 120; t++) {
      s.step();
      expect(s.contacts()).toEqual([]);
    }
    expect(s.getState(0).pos.y).toBeLessThan(1.2); // it really did come to rest on the ground
  });

  it('lists contacts in a stable order and never changes the simulation', () => {
    const run = (readContacts: boolean): string[] => {
      const s = sim([0, 1, 2]);
      const trace: string[] = [];
      for (let t = 0; t < 600; t++) {
        for (const slot of s.slots) s.setInput(slot, scriptedInput(slot, t));
        s.step();
        if (readContacts) {
          const cs = s.contacts();
          for (let i = 1; i < cs.length; i++) expect(cs[i - 1]!.a * 8 + cs[i - 1]!.b + 1).toBeLessThan(cs[i]!.a * 8 + cs[i]!.b + 1);
        }
        const st = s.slots.map((slot) => s.getState(slot));
        trace.push(JSON.stringify(st));
      }
      return trace;
    };
    const plain = run(false);
    const observed = run(true);
    expect(observed).toEqual(plain); // bit-identical states every tick
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/contacts.test.ts`
Expected: FAIL — `s.contacts is not a function` in every test that reads contacts (the first, empty-arena test fails the same way).

<!-- check {"cmd": "npx vitest run tests/contacts.test.ts", "outcome": "fail"} -->

- [ ] **Step 3: Implement**

`src/shared/arena.ts` — return the ground collider's handle, so contacts can leave it out:

In `src/shared/arena.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/arena.ts"} -->
```ts
export function buildArena(world: RAPIER.World, options: ArenaOptions = {}): void {
  const walls = options.walls ?? true;
  const half = options.groundHalfExtent ?? ARENA.GROUND_HALF_EXTENT;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(half, 0.5, half).setTranslation(0, -0.5, 0).setFriction(1).setRestitution(0),
    body,
  );
  if (!walls) return;

```

with:

```ts
export interface ArenaColliders {
  /** Handle of the ground collider: the one static surface a car body is not meant to touch (only wheels and a flipped roof do). */
  ground: number;
}

export function buildArena(world: RAPIER.World, options: ArenaOptions = {}): ArenaColliders {
  const walls = options.walls ?? true;
  const half = options.groundHalfExtent ?? ARENA.GROUND_HALF_EXTENT;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const ground = world.createCollider(
    RAPIER.ColliderDesc.cuboid(half, 0.5, half).setTranslation(0, -0.5, 0).setFriction(1).setRestitution(0),
    body,
  );
  const colliders = { ground: ground.handle };
  if (!walls) return colliders;

```

In `src/shared/arena.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/arena.ts"} -->
```ts
        .setFriction(0.3)
        .setRestitution(0.3),
      body,
    );
  }
}

```

with:

```ts
        .setFriction(0.3)
        .setRestitution(0.3),
      body,
    );
  }
  return colliders;
}

```

`src/shared/sim.ts` — the `Contact` type, the lookup tables, and the `contacts` method:

In `src/shared/sim.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/sim.ts"} -->
```ts
import type { CarState, WheelPose } from './types';
```

with:

```ts
import type { CarState, Vec3, WheelPose } from './types';
```

In `src/shared/sim.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/sim.ts"} -->
```ts
export type SimOptions = ArenaOptions;

```

with:

```ts
export type SimOptions = ArenaOptions;

/** One car's contact with another car or with the arena during the last step, as the solver resolved it. */
export interface Contact {
  /** Slot of the car the contact is reported for (for a pair of cars, the lower slot). */
  a: number;
  /** Slot of the other car, or -1 for walls and obstacles (all of them together). */
  b: number;
  /** Sum of the normal impulses at the contact points (N·s). */
  impulse: number;
  /** Impulse-weighted mean contact point in car `a`'s local frame (forward +X, up +Y, right +Z), and in car `b`'s (zero for -1). */
  pointA: Vec3;
  pointB: Vec3;
}

const scratchA: Vec3 = { x: 0, y: 0, z: 0 };
const scratchB: Vec3 = { x: 0, y: 0, z: 0 };

```

In `src/shared/sim.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/sim.ts"} -->
```ts
  private readonly ordered: CarRig[] = [];
  private disposed = false;

```

with:

```ts
  private readonly ordered: CarRig[] = [];
  private readonly slotOfCollider = new Map<number, number>();
  private readonly groundHandle: number;
  private disposed = false;

```

In `src/shared/sim.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/sim.ts"} -->
```ts
    buildArena(this.world, options);
    unique.forEach((slot, index) => {
      const rig = createCarRig(this.world, slot, spawnPose(index, unique.length));
      this.rigs.set(slot, rig);
      this.ordered.push(rig);
    });
```

with:

```ts
    this.groundHandle = buildArena(this.world, options).ground;
    unique.forEach((slot, index) => {
      const rig = createCarRig(this.world, slot, spawnPose(index, unique.length));
      this.rigs.set(slot, rig);
      this.ordered.push(rig);
      this.slotOfCollider.set(rig.collider.handle, slot);
    });
```

Add this method directly above `getWheels`:  replace the line

<!-- op {"kind": "edit", "path": "src/shared/sim.ts"} -->
```ts
  getWheels(slot: number): WheelPose[] {
```

with:

```ts
  /**
   * Contacts of the last step that transmitted at least `minImpulse` N·s: between two cars (reported once, for the lower
   * slot) and between a car and the walls or obstacles (one entry per car, `b` = -1). The ground is never reported: a car
   * body only touches it when it lies on its roof. Read-only; it does not change the simulation, so the server and the
   * browser may call it whenever they like without losing bit-for-bit agreement.
   */
  contacts(minImpulse = 0): Contact[] {
    const out: Contact[] = [];
    const others: RAPIER.Collider[] = [];
    for (const rig of this.ordered) {
      others.length = 0;
      this.world.contactPairsWith(rig.collider, (other) => {
        others.push(other);
      });
      let wall: Contact | null = null;
      for (const other of others) {
        if (other.handle === this.groundHandle) continue;
        const otherSlot = this.slotOfCollider.get(other.handle);
        if (otherSlot !== undefined && otherSlot < rig.slot) continue; // each pair of cars once, from its lower slot
        let impulse = 0;
        let ax = 0, ay = 0, az = 0, bx = 0, by = 0, bz = 0;
        this.world.contactPair(rig.collider, other, (manifold, flipped) => {
          for (let i = 0, n = manifold.numContacts(); i < n; i++) {
            const w = manifold.contactImpulse(i);
            if (!(w > 0)) continue;
            const first = manifold.localContactPoint1(i, scratchA);
            const second = manifold.localContactPoint2(i, scratchB);
            const mine = flipped ? second : first;
            const theirs = flipped ? first : second;
            impulse += w;
            if (mine) { ax += w * mine.x; ay += w * mine.y; az += w * mine.z; }
            if (theirs) { bx += w * theirs.x; by += w * theirs.y; bz += w * theirs.z; }
          }
        });
        if (impulse <= 0) continue;
        if (otherSlot === undefined) {
          if (wall) {
            const total = wall.impulse + impulse;
            wall.pointA = { x: (wall.pointA.x * wall.impulse + ax) / total, y: (wall.pointA.y * wall.impulse + ay) / total, z: (wall.pointA.z * wall.impulse + az) / total };
            wall.impulse = total;
          } else {
            wall = { a: rig.slot, b: -1, impulse, pointA: { x: ax / impulse, y: ay / impulse, z: az / impulse }, pointB: { x: 0, y: 0, z: 0 } };
          }
        } else if (impulse >= minImpulse) {
          out.push({
            a: rig.slot,
            b: otherSlot,
            impulse,
            pointA: { x: ax / impulse, y: ay / impulse, z: az / impulse },
            pointB: { x: bx / impulse, y: by / impulse, z: bz / impulse },
          });
        }
      }
      if (wall && wall.impulse >= minImpulse) out.push(wall);
    }
    return out.sort((p, q) => p.a - q.a || p.b - q.b);
  }

  getWheels(slot: number): WheelPose[] {
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/contacts.test.ts && npm run typecheck && npm run hash`
Expected: PASS — 8 tests; type-check clean; `npm run hash` still prints `10c3a72a` (reading contacts leaves the simulation untouched).

<!-- check {"cmd": "npx vitest run tests/contacts.test.ts && npm run typecheck && npm run hash", "outcome": "pass", "tests": 8, "match": "10c3a72a"} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(shared): Simulation.contacts reports the impulses cars receive from cars and walls"
```

<!-- commit "feat(shared): Simulation.contacts reports the impulses cars receive from cars and walls" -->

---

### Task 24: Hits: merging contacts into impacts, and who hit whom

**Files:**
- Create: `src/server/combat.ts` (`HitTracker`, `AttackLog`)
- Test: `tests/combat.test.ts`

**Interfaces:**
- Consumes: `Contact`, `Simulation` (Task 23); `COMBAT`, `hitDamage`, `classifyZone` (Task 22).
- Produces: `Hit {tick, victim, attacker, impulse, zone, damage, point}`; `HitTracker.update(tick, contacts): Hit[]` and `reset()`; `AttackLog.record(victim, attacker, tick)`, `credit(victim, tick): {killer, assists}`, `reset()`.

- [ ] **Step 1: Write the failing tests**

Pure tests with made-up contacts pin the windowing rules (merge, gap, maximum length, scrape threshold, minimum impact, walls, zones, ordering) and the credit rules; tests on the real simulation pin the prices of a head-on, a wall hit, a gentle bump, seven seconds of grinding along a wall and ten seconds of pushing.

Create `tests/combat.test.ts`:

<!-- op {"kind": "create", "path": "tests/combat.test.ts"} -->
```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { COMBAT } from '../src/shared/constants';
import { quatFromYaw } from '../src/shared/math';
import { initPhysics } from '../src/shared/physics';
import { Simulation, type Contact } from '../src/shared/sim';
import { AttackLog, HitTracker, type Hit } from '../src/server/combat';

beforeAll(async () => {
  await initPhysics();
});

const at = (x: number, z = 0) => ({ x, y: 0, z });
const carCar = (impulse: number, a = 0, b = 1): Contact => ({ a, b, impulse, pointA: at(2.3), pointB: at(2.3) });
const wall = (impulse: number, a = 0): Contact => ({ a, b: -1, impulse, pointA: at(2.3), pointB: at(0) });

/** Feeds `perTick[t]` (or nothing) at ticks 0.. and collects every hit until the windows have certainly closed. */
function run(perTick: Contact[][], extra = COMBAT.WINDOW_MAX_TICKS + 5): Hit[] {
  const tracker = new HitTracker();
  const hits: Hit[] = [];
  for (let t = 0; t < perTick.length + extra; t++) hits.push(...tracker.update(t, perTick[t] ?? []));
  return hits;
}

describe('HitTracker', () => {
  it('turns one hard collision into one hit per car, a few ticks after the impact', () => {
    const tracker = new HitTracker();
    expect(tracker.update(10, [carCar(19_200)])).toEqual([]);
    expect(tracker.update(11, [])).toEqual([]);
    expect(tracker.update(12, [])).toEqual([]);
    const hits = tracker.update(13, []); // WINDOW_GAP_TICKS after the last contact
    expect(hits.map((h) => [h.victim, h.attacker])).toEqual([[0, 1], [1, 0]]);
    for (const h of hits) {
      expect(h.tick).toBe(10);
      expect(h.zone).toBe('front');
      expect(h.impulse).toBeCloseTo(19.2, 9);
      expect(h.damage).toBeGreaterThan(24); // ~21.8 x 1.15 for a front hit
      expect(h.damage).toBeLessThan(27);
    }
  });

  it('merges the ticks of one impact and adds their impulses', () => {
    // a T-bone: a hard first tick, then two lighter ones, then the cars slide apart
    const hits = run([[], [], [carCar(9_600, 0, 1)], [carCar(1_400, 0, 1)], [carCar(900, 0, 1)]]);
    expect(hits).toHaveLength(2);
    expect(hits[0]!.impulse).toBeCloseTo(11.9, 9);
    expect(hits[0]!.tick).toBe(2);
  });

  it('ignores scrapes and pushing: any number of light ticks is never an impact', () => {
    const light = Array.from({ length: 200 }, () => [carCar(COMBAT.SCRAPE_IMPULSE - 1), wall(COMBAT.SCRAPE_IMPULSE - 1, 2)]);
    expect(run(light)).toEqual([]);
  });

  it('starts a new hit after a quiet spell', () => {
    const hits = run([[carCar(9_000)], [], [], [], [], [], [], [], [], [], [carCar(9_000)]]);
    expect(hits.filter((h) => h.victim === 0)).toHaveLength(2);
  });

  it('closes a window that stays open, so long grinding is paid for as it happens', () => {
    const grind = Array.from({ length: 65 }, () => [carCar(COMBAT.SCRAPE_IMPULSE + 150)]);
    const hits = run(grind).filter((h) => h.victim === 0);
    expect(hits).toHaveLength(3); // windows of 30, 30 and 5 ticks
    expect(hits.map((h) => h.tick)).toEqual([0, 30, 60]);
    expect(hits[0]!.impulse).toBeCloseTo((30 * (COMBAT.SCRAPE_IMPULSE + 150)) / 1000, 9);
    expect(hits[2]!.impulse).toBeCloseTo((5 * (COMBAT.SCRAPE_IMPULSE + 150)) / 1000, 9);
  });

  it('gives impacts below the minimum no damage at all', () => {
    expect(run([[carCar(COMBAT.MIN_IMPULSE * 1000 - 10)]])).toEqual([]);
  });

  it('reports a wall hit for the car alone, at half damage', () => {
    const hits = run([[wall(29_000, 3)]]);
    expect(hits).toHaveLength(1);
    const h = hits[0]!;
    expect([h.victim, h.attacker]).toEqual([3, -1]);
    const carHit = run([[carCar(29_000, 3, 4)]]).find((k) => k.victim === 3)!;
    expect(h.damage).toBeCloseTo(carHit.damage * 0.5, 6); // same impulse and front zone in both, wall factor 0.5
  });

  it('measures the zone from the impulse-weighted contact point', () => {
    const side: Contact = { a: 0, b: 1, impulse: 12_000, pointA: at(2.3), pointB: { x: 0.2, y: 0, z: 1.0 } };
    const hits = run([[side]]);
    expect(hits.find((h) => h.victim === 1)!.zone).toBe('right');
    expect(hits.find((h) => h.victim === 0)!.zone).toBe('front');
    const mixed = run([[{ a: 0, b: 1, impulse: 3_000, pointA: at(2.3), pointB: at(2.3) }, { a: 0, b: 1, impulse: 9_000, pointA: at(2.3), pointB: { x: 0, y: 0, z: -1 } }]]);
    expect(mixed.find((h) => h.victim === 1)!.zone).toBe('left'); // most of the impulse came in on the left
  });

  it('reports every hit in a fixed order and forgets open windows on reset', () => {
    const tracker = new HitTracker();
    tracker.update(0, [carCar(9_000, 2, 5), carCar(9_000, 0, 1)]);
    const hits = tracker.update(5, []);
    expect(hits.map((h) => [h.victim, h.attacker])).toEqual([[0, 1], [1, 0], [2, 5], [5, 2]]);
    tracker.update(6, [carCar(9_000)]);
    tracker.reset();
    expect(tracker.update(20, [])).toEqual([]);
  });
});

describe('AttackLog', () => {
  it('names the latest attacker as the killer and the other recent ones as assists', () => {
    const log = new AttackLog();
    log.record(1, 2, 100);
    log.record(1, 3, 200);
    log.record(1, 4, 250);
    expect(log.credit(1, 300)).toEqual({ killer: 4, assists: [2, 3] });
    expect(log.credit(0, 300)).toEqual({ killer: -1, assists: [] });
  });

  it('forgets attackers after the assist window and ignores walls and self-hits', () => {
    const log = new AttackLog();
    log.record(1, 2, 0);
    log.record(1, -1, 10);
    log.record(1, 1, 10);
    expect(log.credit(1, COMBAT.ASSIST_TICKS)).toEqual({ killer: 2, assists: [] });
    expect(log.credit(1, COMBAT.ASSIST_TICKS + 1)).toEqual({ killer: -1, assists: [] });
  });

  it('keeps the most recent hit per attacker and can be reset', () => {
    const log = new AttackLog();
    log.record(1, 2, 0);
    log.record(1, 3, 100);
    log.record(1, 2, 200);
    expect(log.credit(1, 210)).toEqual({ killer: 2, assists: [3] });
    log.reset();
    expect(log.credit(1, 210).killer).toBe(-1);
  });
});

describe('HitTracker on the real simulation', () => {
  const sims: Simulation[] = [];
  afterEach(() => {
    while (sims.length) sims.pop()!.dispose();
  });
  function drive(s: Simulation, ticks: number): Hit[] {
    const tracker = new HitTracker();
    const hits: Hit[] = [];
    for (let t = 0; t < ticks; t++) {
      s.step();
      hits.push(...tracker.update(s.tick, s.contacts(COMBAT.SCRAPE_IMPULSE)));
    }
    return hits;
  }
  const place = (s: Simulation, slot: number, x: number, z: number, yaw: number, speed: number): void =>
    s.setState(slot, {
      pos: { x, y: 1.07, z },
      quat: quatFromYaw(yaw),
      linvel: { x: Math.cos(yaw) * speed, y: 0, z: -Math.sin(yaw) * speed },
      angvel: { x: 0, y: 0, z: 0 },
    });

  it('prices a 10 m/s head-on at about a quarter of a car, on the front of both', () => {
    const s = new Simulation([0, 1]);
    sims.push(s);
    place(s, 0, -9, 0, 0, 10);
    place(s, 1, 9, 0, Math.PI, 10);
    const hits = drive(s, 90);
    expect(hits).toHaveLength(2);
    for (const h of hits) {
      expect(h.zone).toBe('front');
      expect(h.damage).toBeGreaterThan(22);
      expect(h.damage).toBeLessThan(29);
    }
  });

  it('prices a 15 m/s wall hit at about a fifth of a car', () => {
    const s = new Simulation([0]);
    sims.push(s);
    place(s, 0, 25, 0, 0, 15);
    const hits = drive(s, 150);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.attacker).toBe(-1);
    expect(hits[0]!.damage).toBeGreaterThan(15);
    expect(hits[0]!.damage).toBeLessThan(28);
  });

  it('does nothing for a gentle bump', () => {
    const s = new Simulation([0, 1]);
    sims.push(s);
    place(s, 0, -6, 0, 0, 2);
    place(s, 1, 6, 0, Math.PI, 2);
    const hits = drive(s, 150);
    expect(hits.reduce((sum, h) => sum + h.damage, 0)).toBeLessThan(2.5);
  });

  it('costs only a few HP to grind along the wall at full throttle for seven seconds', () => {
    const s = new Simulation([0]);
    sims.push(s);
    const yaw = -Math.PI / 2 - (5 * Math.PI) / 180; // along the wall, five degrees into it
    place(s, 0, 40, 0, yaw, 14);
    const tracker = new HitTracker();
    let total = 0;
    let wallTicks = 0;
    for (let t = 0; t < 600; t++) {
      s.setInput(0, { throttle: 1, steer: 0, handbrake: false });
      s.step();
      if (s.contacts().some((c) => c.b === -1)) wallTicks++;
      for (const h of tracker.update(s.tick, s.contacts(COMBAT.SCRAPE_IMPULSE))) total += h.damage;
    }
    expect(wallTicks).toBeGreaterThan(300); // it really did grind along the wall
    expect(total).toBeLessThan(12);
  });

  it('does not wear cars down when they merely push against each other at full throttle', () => {
    const s = new Simulation([0, 1]);
    sims.push(s);
    place(s, 0, -3, 0, 0, 0.5);
    place(s, 1, 3, 0, Math.PI, 0.5);
    const tracker = new HitTracker();
    const hits: Hit[] = [];
    for (let t = 0; t < 600; t++) {
      s.setInput(0, { throttle: 1, steer: 0, handbrake: false });
      s.setInput(1, { throttle: 1, steer: 0, handbrake: false });
      s.step();
      hits.push(...tracker.update(s.tick, s.contacts(COMBAT.SCRAPE_IMPULSE)));
    }
    // the cars meet within the first second (a tap and a rebound); the following nine seconds of pushing add nothing
    expect(hits.length).toBeGreaterThan(0);
    expect(Math.max(...hits.map((h) => h.tick))).toBeLessThan(90);
    expect(hits.reduce((sum, h) => sum + h.damage, 0)).toBeLessThan(12);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/combat.test.ts`
Expected: FAIL — cannot resolve `../src/server/combat`.

<!-- check {"cmd": "npx vitest run tests/combat.test.ts", "outcome": "fail"} -->

- [ ] **Step 3: Implement**

Create `src/server/combat.ts`:

<!-- op {"kind": "create", "path": "src/server/combat.ts"} -->
```ts
import { COMBAT } from '../shared/constants';
import { classifyZone, hitDamage } from '../shared/damage';
import type { Contact } from '../shared/sim';
import type { Vec3, Zone } from '../shared/types';

/** One impact on one car, after its contact ticks were merged into a single event. */
export interface Hit {
  /** Simulation tick of the first contact of the impact. */
  tick: number;
  /** Slot of the car that was hit. */
  victim: number;
  /** Slot of the car that hit it, or -1 for a wall or obstacle. */
  attacker: number;
  /** Total impulse transmitted (kN·s), as the victim felt it. */
  impulse: number;
  zone: Zone;
  /** HP this impact takes off (zone and wall multipliers included), before capping at the victim's remaining HP. */
  damage: number;
  /** Impulse-weighted contact point in the victim's local frame. */
  point: Vec3;
}

interface Window {
  victim: number;
  attacker: number;
  openedAt: number;
  lastAt: number;
  impulse: number; // N·s
  sx: number;
  sy: number;
  sz: number;
}

/**
 * Turns the per-tick contacts of a simulation into discrete hits. A collision spreads over a few ticks (and a slide along
 * a wall over many), so contacts between the same two bodies are merged into a window that closes after a short quiet
 * spell or a maximum length; damage is computed once per window from its total impulse. Ticks with only a light
 * touch (a scrape, or two cars pushing against each other) are ignored, so pushing and scraping never wear a car down.
 */
export class HitTracker {
  private readonly windows = new Map<number, Window>();

  /** Feed the contacts of one simulation step (ticks must increase); returns the hits whose window closed on this tick. */
  update(tick: number, contacts: readonly Contact[]): Hit[] {
    const hits: Hit[] = [];
    for (const c of contacts) {
      if (!(c.impulse >= COMBAT.SCRAPE_IMPULSE)) continue;
      this.add(tick, c.a, c.b, c.impulse, c.pointA, hits);
      if (c.b >= 0) this.add(tick, c.b, c.a, c.impulse, c.pointB, hits);
    }
    for (const [key, w] of this.windows) {
      if (tick - w.lastAt < COMBAT.WINDOW_GAP_TICKS) continue;
      this.windows.delete(key);
      this.close(w, hits);
    }
    return hits.sort((p, q) => p.victim - q.victim || p.attacker - q.attacker || p.tick - q.tick);
  }

  /** Forgets every open window (the world was rebuilt). */
  reset(): void {
    this.windows.clear();
  }

  private add(tick: number, victim: number, attacker: number, impulse: number, point: Vec3, hits: Hit[]): void {
    const key = victim * 16 + attacker + 1;
    let w = this.windows.get(key);
    if (w && tick - w.openedAt >= COMBAT.WINDOW_MAX_TICKS) {
      this.close(w, hits); // a window that has been open this long is paid out; this contact starts the next one
      w = undefined;
    }
    if (!w) {
      w = { victim, attacker, openedAt: tick, lastAt: tick, impulse: 0, sx: 0, sy: 0, sz: 0 };
      this.windows.set(key, w);
    }
    w.lastAt = tick;
    w.impulse += impulse;
    w.sx += impulse * point.x;
    w.sy += impulse * point.y;
    w.sz += impulse * point.z;
  }

  private close(w: Window, hits: Hit[]): void {
    const kns = w.impulse / 1000;
    const point = { x: w.sx / w.impulse, y: w.sy / w.impulse, z: w.sz / w.impulse };
    const zone = classifyZone(point);
    const damage = hitDamage(kns, zone, w.attacker < 0);
    if (damage > 0) hits.push({ tick: w.openedAt, victim: w.victim, attacker: w.attacker, impulse: kns, zone, damage, point });
  }
}

/** Remembers who hit whom lately, to name a killer and the assisting cars when a car is eliminated. */
export class AttackLog {
  private readonly lastHit = new Map<number, Map<number, number>>();

  record(victim: number, attacker: number, tick: number): void {
    if (attacker < 0 || attacker === victim) return;
    let byAttacker = this.lastHit.get(victim);
    if (!byAttacker) {
      byAttacker = new Map();
      this.lastHit.set(victim, byAttacker);
    }
    byAttacker.set(attacker, tick);
  }

  /** The car that most recently hit `victim` within the assist window is the killer; the others in the window assist. */
  credit(victim: number, tick: number): { killer: number; assists: number[] } {
    const recent = [...(this.lastHit.get(victim) ?? [])]
      .filter(([, at]) => tick - at <= COMBAT.ASSIST_TICKS)
      .sort((p, q) => q[1] - p[1] || p[0] - q[0]);
    if (recent.length === 0) return { killer: -1, assists: [] };
    return { killer: recent[0]![0], assists: recent.slice(1).map(([slot]) => slot).sort((p, q) => p - q) };
  }

  reset(): void {
    this.lastHit.clear();
  }
}
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/combat.test.ts && npm run typecheck`
Expected: PASS — 17 tests; type-check clean.

<!-- check {"cmd": "npx vitest run tests/combat.test.ts && npm run typecheck", "outcome": "pass", "tests": 17} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): HitTracker merges contacts into impacts; AttackLog credits kills and assists"
```

<!-- commit "feat(server): HitTracker merges contacts into impacts; AttackLog credits kills and assists" -->

---

### Task 25: Elimination rules

**Files:**
- Create: `src/server/rules.ts` (`CarWatch`)
- Test: `tests/rules.test.ts`

**Interfaces:**
- Consumes: `COMBAT`, `ARENA` (constants); `quatRotate` (math).
- Produces: `CarWatch.update(state, inHit): {fault: "flipped" | "stuck" | "bounds" | null, drain}` — one instance per car per round, called once per live tick.

- [ ] **Step 1: Write the failing tests**

Create `tests/rules.test.ts`:

<!-- op {"kind": "create", "path": "tests/rules.test.ts"} -->
```ts
import { describe, expect, it } from 'vitest';
import { ARENA, COMBAT } from '../src/shared/constants';
import { quatFromYaw } from '../src/shared/math';
import type { CarState } from '../src/shared/types';
import { CarWatch } from '../src/server/rules';

const rolling = (over: Partial<CarState> = {}): CarState => ({
  pos: { x: 0, y: 1.07, z: 0 },
  quat: quatFromYaw(0.3),
  linvel: { x: 8, y: 0, z: 0 },
  angvel: { x: 0, y: 0, z: 0 },
  ...over,
});
const onSide: CarState = rolling({ quat: { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 } }); // quarter turn about the forward axis
const onRoof: CarState = rolling({ quat: { x: 1, y: 0, z: 0, w: 0 } });
const parked = rolling({ linvel: { x: 0.1, y: 0, z: 0.1 } });

/** Ticks a watch until it reports a fault; returns how many ticks that took (or -1). */
function ticksToFault(state: CarState, max: number, inHit = false): { ticks: number; fault: string | null } {
  const w = new CarWatch();
  for (let t = 1; t <= max; t++) {
    const r = w.update(state, inHit);
    if (r.fault) return { ticks: t, fault: r.fault };
  }
  return { ticks: -1, fault: null };
}

describe('CarWatch elimination rules', () => {
  it('leaves a car that drives around alone', () => {
    expect(ticksToFault(rolling(), 5000, true).fault).toBeNull();
  });

  it('eliminates a car that stays flipped for 3 seconds, on its side or on its roof', () => {
    expect(ticksToFault(onSide, 1000)).toEqual({ ticks: COMBAT.FLIP_TICKS, fault: 'flipped' });
    expect(ticksToFault(onRoof, 1000)).toEqual({ ticks: COMBAT.FLIP_TICKS, fault: 'flipped' });
  });

  it('forgives a flip that rights itself in time, and counts again from zero afterwards', () => {
    const w = new CarWatch();
    for (let t = 0; t < COMBAT.FLIP_TICKS - 1; t++) expect(w.update(onSide, true).fault).toBeNull();
    expect(w.update(rolling(), true).fault).toBeNull(); // back on its wheels
    for (let t = 0; t < COMBAT.FLIP_TICKS - 1; t++) expect(w.update(onSide, true).fault).toBeNull();
    expect(w.update(onSide, true).fault).toBe('flipped');
  });

  it('eliminates a car that does not move for 8 seconds, but not one that keeps rolling', () => {
    expect(ticksToFault(parked, 2000, true)).toEqual({ ticks: COMBAT.IMMOBILE_TICKS, fault: 'stuck' });
    const w = new CarWatch();
    for (let t = 0; t < 3 * COMBAT.IMMOBILE_TICKS; t++) {
      const state = t % (COMBAT.IMMOBILE_TICKS - 1) === 0 ? rolling() : parked; // a nudge every 7.98 s resets the count
      expect(w.update(state, true).fault).toBeNull();
    }
  });

  it('eliminates a car outside the arena or below the floor, at once', () => {
    const w = new CarWatch();
    expect(w.update(rolling({ pos: { x: ARENA.RADIUS + COMBAT.BOUNDS_MARGIN - 0.1, y: 1, z: 0 } }), true).fault).toBeNull();
    expect(w.update(rolling({ pos: { x: 0, y: 1, z: -(ARENA.RADIUS + COMBAT.BOUNDS_MARGIN + 0.1) } }), true).fault).toBe('bounds');
    expect(new CarWatch().update(rolling({ pos: { x: 0, y: COMBAT.BOUNDS_MIN_Y - 0.1, z: 0 } }), true).fault).toBe('bounds');
  });

  it('eliminates a car whose state is not a number, so a broken body cannot linger in the round', () => {
    expect(new CarWatch().update(rolling({ pos: { x: Number.NaN, y: 1, z: 0 } }), true).fault).toBe('bounds');
    expect(new CarWatch().update(rolling({ linvel: { x: Number.POSITIVE_INFINITY, y: 0, z: 0 } }), true).fault).toBe('bounds');
  });

  it('drains HP after 20 quiet seconds, at 2 HP per second, until the car is in a hit', () => {
    const w = new CarWatch();
    let total = 0;
    for (let t = 1; t < COMBAT.STALL_TICKS; t++) total += w.update(rolling(), false).drain;
    expect(total).toBe(0);
    for (let t = 0; t < 60; t++) total += w.update(rolling(), false).drain;
    expect(total).toBeCloseTo(2, 9); // one second of draining
    expect(w.update(rolling(), true).drain).toBe(0); // a hit stops it at once
    expect(w.update(rolling(), false).drain).toBe(0); // and the 20 s start again
  });

  it('does not let a hit-free car hide from the drain by sitting still: it is eliminated as stuck first', () => {
    expect(ticksToFault(parked, COMBAT.STALL_TICKS + 100, false).fault).toBe('stuck');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/rules.test.ts`
Expected: FAIL — cannot resolve `../src/server/rules`.

<!-- check {"cmd": "npx vitest run tests/rules.test.ts", "outcome": "fail"} -->

- [ ] **Step 3: Implement**

Create `src/server/rules.ts`:

<!-- op {"kind": "create", "path": "src/server/rules.ts"} -->
```ts
import { ARENA, COMBAT } from '../shared/constants';
import { quatRotate } from '../shared/math';
import type { CarState } from '../shared/types';

export type Fault = 'flipped' | 'stuck' | 'bounds';

export interface WatchResult {
  /** Set when the car has to be eliminated for what its own state says. */
  fault: Fault | null;
  /** HP the anti-stall rule takes off this tick (0 most of the time). */
  drain: number;
}

const UP = { x: 0, y: 1, z: 0 };
const finite = (v: number): boolean => Number.isFinite(v);

/**
 * Watches one car during a live round for the elimination rules that come from the car's own state (flipped for 3 s,
 * immobile for 8 s, out of bounds) and for the anti-stall rule (20 s without hitting or being hit costs 2 HP per second
 * until the car is in a hit). Create one per car per round and call `update` once per live tick.
 */
export class CarWatch {
  private flippedTicks = 0;
  private stillTicks = 0;
  private quietTicks = 0;

  /** `inHit` is true on ticks where a hit closed for this car, as victim or as attacker. */
  update(state: CarState, inHit: boolean): WatchResult {
    const { pos, quat, linvel } = state;
    const numbers = [pos.x, pos.y, pos.z, quat.x, quat.y, quat.z, quat.w, linvel.x, linvel.y, linvel.z];
    if (!numbers.every(finite)) return { fault: 'bounds', drain: 0 }; // a broken body must not stay in the round
    if (Math.hypot(pos.x, pos.z) > ARENA.RADIUS + COMBAT.BOUNDS_MARGIN || pos.y < COMBAT.BOUNDS_MIN_Y) {
      return { fault: 'bounds', drain: 0 };
    }
    this.flippedTicks = quatRotate(quat, UP).y < COMBAT.FLIP_UP_Y ? this.flippedTicks + 1 : 0;
    if (this.flippedTicks >= COMBAT.FLIP_TICKS) return { fault: 'flipped', drain: 0 };
    this.stillTicks = Math.hypot(linvel.x, linvel.z) < COMBAT.IMMOBILE_SPEED ? this.stillTicks + 1 : 0;
    if (this.stillTicks >= COMBAT.IMMOBILE_TICKS) return { fault: 'stuck', drain: 0 };
    this.quietTicks = inHit ? 0 : this.quietTicks + 1;
    return { fault: null, drain: this.quietTicks >= COMBAT.STALL_TICKS ? COMBAT.STALL_DRAIN_PER_TICK : 0 };
  }
}
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/rules.test.ts && npm run typecheck`
Expected: PASS — 8 tests; type-check clean.

<!-- check {"cmd": "npx vitest run tests/rules.test.ts && npm run typecheck", "outcome": "pass", "tests": 8} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): CarWatch applies the flipped, immobile, out-of-bounds and anti-stall rules"
```

<!-- commit "feat(server): CarWatch applies the flipped, immobile, out-of-bounds and anti-stall rules" -->

---

### Task 26: Protocol version 2: the match messages

**Files:**
- Modify: `src/shared/protocol.ts` (replace), `src/shared/constants.ts` (`PROTOCOL_VERSION`), `scripts/smoke-e2e.mjs`
- Modify (to keep compiling until Task 29): `src/server/app.ts`, `src/server/room.ts`
- Test: `tests/protocol.test.ts`, `tests/client/connection.test.ts`, `tests/server/integration.test.ts` (small edits)

**Interfaces:**
- Consumes: `Zone` (Task 22), `ARENA`, `NET` (constants).
- Produces: `Phase`, `KoReason`, `RoundEnd`; `PhaseMessage`, `HitMessage`, `KoMessage`, `ScoresMessage`, `ResultsMessage`, `ScoreRow`, `ResultRow`; `PlayerInfo.bot?`; `RosterMessage {epoch, round, you, players}`; `WelcomeMessage {…, phase, scores}` (`you` may be -1: watching); strict parsers for all of them; `NET.PROTOCOL_VERSION = 2`.

- [ ] **Step 1: Write the failing tests**

The `parseServerMessage` tests now cover the welcome and roster shapes of protocol 2, every new message, and the values a real server never sends (an out-of-range slot, a negative damage, an unknown zone, more rows than cars).

In `tests/protocol.test.ts`, replace everything from the line containing `describe('parseServerMessage'` up to (not including) the line containing `describe('sanitizeName'` with:

<!-- op {"kind": "between", "path": "tests/protocol.test.ts", "start": "describe('parseServerMessage'", "end": "describe('sanitizeName'"} -->
```ts
describe('parseServerMessage', () => {
  const phase = { t: 'phase', phase: 'live', round: 2, remainingMs: 12_500 };
  const welcome = {
    t: 'welcome', v: NET.PROTOCOL_VERSION, you: 2, epoch: 3, tickRate: 60, snapshotEvery: 2,
    room: { code: 'ABCD', public: true, capacity: 8 },
    players: [{ slot: 2, name: 'Max', color: 255 }, { slot: 3, name: 'Rusty', color: 1, bot: true }],
    phase,
    scores: [{ slot: 2, score: 120, kills: 1 }],
  };
  const hit = { t: 'hit', tick: 500, victim: 1, attacker: -1, dmg: 12.4, hp: 61.2, zone: 'rear', j: 14.8, p: [-2.3, 0, 0.4] };
  const ko = { t: 'ko', tick: 900, victim: 3, killer: 1, assists: [0, 2], reason: 'damage' };
  const row = { slot: 1, name: 'Max', color: 255, bot: false, score: 320, gained: 220, kills: 2, damage: 170.5, hp: 44, alive: true };
  const results = { t: 'results', round: 2, winner: 1, reason: 'last', rows: [row] };

  it('accepts well-formed server messages', () => {
    expect(parseServerMessage(JSON.stringify(welcome))).toEqual(welcome);
    expect(parseServerMessage(JSON.stringify({ ...welcome, you: -1, phase: null, scores: [] }))).toMatchObject({ you: -1, phase: null });
    const roster = { t: 'roster', epoch: 1, round: 4, you: -1, players: [] };
    expect(parseServerMessage(JSON.stringify(roster))).toEqual(roster);
    expect(parseServerMessage(JSON.stringify({ t: 'pong', id: 1, c: 2, tick: 3 }))).toEqual({ t: 'pong', id: 1, c: 2, tick: 3 });
    expect(parseServerMessage(JSON.stringify({ t: 'error', code: 'room_full', message: 'full' }))).toEqual({ t: 'error', code: 'room_full', message: 'full' });
  });

  it('accepts the match messages: phase, hit, ko, scores and results', () => {
    expect(parseServerMessage(JSON.stringify(phase))).toEqual(phase);
    expect(parseServerMessage(JSON.stringify(hit))).toEqual(hit);
    expect(parseServerMessage(JSON.stringify(ko))).toEqual(ko);
    const scores = { t: 'scores', rows: [{ slot: 0, score: 10, kills: 0 }, { slot: 5, score: 260.5, kills: 3 }] };
    expect(parseServerMessage(JSON.stringify(scores))).toEqual(scores);
    expect(parseServerMessage(JSON.stringify(results))).toEqual(results);
    expect(parseServerMessage(JSON.stringify({ ...results, winner: -1, reason: 'draw' }))).toMatchObject({ winner: -1, reason: 'draw' });
  });

  it('rejects malformed server messages', () => {
    for (const raw of [
      'nope',
      '{}',
      JSON.stringify({ t: 'welcome' }),
      JSON.stringify({ ...welcome, you: 'x' }),
      JSON.stringify({ ...welcome, you: 8 }),
      JSON.stringify({ ...welcome, phase: { ...phase, phase: 'warmup' } }),
      JSON.stringify({ ...welcome, phase: undefined }),
      JSON.stringify({ ...welcome, scores: [{ slot: 9, score: 1, kills: 0 }] }),
      JSON.stringify({ ...welcome, players: [{ slot: 1, name: 'x', color: 1, bot: 'yes' }] }),
      JSON.stringify({ t: 'roster', epoch: 1, round: 1, you: 0, players: [{ slot: 'a' }] }),
      JSON.stringify({ t: 'roster', epoch: 1, players: [] }), // no round / you
      JSON.stringify({ t: 'pong', id: 1 }),
      JSON.stringify({ t: 'error', code: 5, message: 'x' }),
    ]) {
      expect(parseServerMessage(raw)).toBeNull();
    }
  });

  it('rejects malformed match messages, including values a real server never sends', () => {
    for (const bad of [
      { ...phase, phase: 'warmup' },
      { ...phase, remainingMs: -1 },
      { ...phase, remainingMs: Number.NaN },
      { ...phase, round: 1.5 },
      { ...hit, zone: 'roof' },
      { ...hit, victim: -1 }, // the victim is always a car
      { ...hit, attacker: 8 },
      { ...hit, dmg: -3 },
      { ...hit, p: [1, 2] },
      { ...hit, p: [1, 2, 'x'] },
      { ...ko, reason: 'boredom' },
      { ...ko, assists: [9] },
      { ...ko, assists: Array.from({ length: 9 }, (_, i) => i % 8) },
      { ...ko, killer: -2 },
      { t: 'scores', rows: 'lots' },
      { t: 'scores', rows: [{ slot: 0, score: 'a', kills: 0 }] },
      { ...results, winner: 8 },
      { ...results, reason: 'quit' },
      { ...results, rows: [{ ...row, alive: 'yes' }] },
      { ...results, rows: Array.from({ length: 9 }, () => row) },
    ]) {
      expect(parseServerMessage(JSON.stringify(bad))).toBeNull();
    }
  });
});

```

The connection test sends a roster in the new shape:

In `tests/client/connection.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/connection.test.ts"} -->
```ts
    fake.receive(JSON.stringify({ t: 'roster', epoch: 2, players: [] }));
```

with:

```ts
    fake.receive(JSON.stringify({ t: 'roster', epoch: 2, round: 1, you: -1, players: [] }));
```

In `tests/client/connection.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/connection.test.ts"} -->
```ts
    expect(events.messages).toEqual([{ t: 'roster', epoch: 2, players: [] }]);
```

with:

```ts
    expect(events.messages).toEqual([{ t: 'roster', epoch: 2, round: 1, you: -1, players: [] }]);
```

And the integration test's hostile hello uses the current protocol version, so it is still rejected for its wrong types rather than for its version:

In `tests/server/integration.test.ts`, replace the first two import lines:

<!-- op {"kind": "edit", "path": "tests/server/integration.test.ts"} -->
```ts
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initPhysics } from '../../src/shared/physics';
```

with:

```ts
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NET } from '../../src/shared/constants';
import { initPhysics } from '../../src/shared/physics';
```

In `tests/server/integration.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/integration.test.ts"} -->
```ts
    evil.sendRaw(JSON.stringify({ t: 'hello', v: 1, name: 5, color: 'red', mode: 'quick' })); // wrong types
```

with:

```ts
    evil.sendRaw(JSON.stringify({ t: 'hello', v: NET.PROTOCOL_VERSION, name: 5, color: 'red', mode: 'quick' })); // wrong types
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/protocol.test.ts`
Expected: FAIL — 2 tests: the new `phase`, `hit`, `ko`, `scores` and `results` messages parse to `null` ("accepts the match messages"), and a welcome with `you: 8` is accepted ("rejects malformed server messages"). The other protocol tests pass.

<!-- check {"cmd": "npx vitest run tests/protocol.test.ts", "outcome": "fail"} -->

- [ ] **Step 3: Implement**

Replace the protocol module. Everything from Plans 1-3 is unchanged (the binary frames, the client messages, the sanitisers); new are the message types and their parsers.

Replace `src/shared/protocol.ts` with:

<!-- op {"kind": "replace", "path": "src/shared/protocol.ts"} -->
```ts
import { ARENA, NET } from './constants';
import { FLAG_HANDBRAKE, packInput, unpackInput, type CarInput } from './input';
import { clamp } from './math';
import type { CarState, Zone } from './types';

// ---- binary frames: first byte is the message type --------------------------------------------
export const MSG_INPUT = 1;
export const MSG_SNAPSHOT = 2;

/** Per-car flag bits inside snapshots (separate namespace from the input flags in input.ts). */
export const SNAP_FLAG_ALIVE = 1;
export const SNAP_FLAG_HANDBRAKE = 2;
export const SNAP_FLAG_GROUNDED = 4;

export const SNAPSHOT_HEADER_BYTES = 11;
export const SNAPSHOT_CAR_BYTES = 37;

// ---- JSON messages ------------------------------------------------------------------------------
export type JoinMode = 'quick' | 'create' | 'join';

export interface HelloMessage {
  t: 'hello';
  v: number;
  name: string;
  color: number;
  mode: JoinMode;
  code?: string;
}
export interface PingMessage {
  t: 'ping';
  id: number;
  c: number;
}
export type ClientMessage = HelloMessage | PingMessage;

export interface PlayerInfo {
  slot: number;
  name: string;
  color: number;
  /** True for server-driven cars. */
  bot?: boolean;
}
export interface RoomInfo {
  code: string;
  public: boolean;
  capacity: number;
}
export type ErrorCode =
  | 'bad_message'
  | 'bad_version'
  | 'already_joined'
  | 'room_full'
  | 'room_not_found'
  | 'server_full'
  | 'rate_limited'
  | 'inactive';

export type Phase = 'countdown' | 'live' | 'results';
export type KoReason = 'damage' | 'flipped' | 'stuck' | 'bounds' | 'stall' | 'disconnected';
export type RoundEnd = 'last' | 'timeout' | 'no_humans' | 'draw';

export interface PhaseMessage {
  t: 'phase';
  phase: Phase;
  round: number;
  /** Time left in this phase when the message was sent. */
  remainingMs: number;
}
export interface ScoreRow {
  slot: number;
  score: number;
  kills: number;
}
export interface ResultRow {
  slot: number;
  name: string;
  color: number;
  bot: boolean;
  /** Running total in this room, and what this round added. */
  score: number;
  gained: number;
  kills: number;
  damage: number;
  hp: number;
  alive: boolean;
}

export interface WelcomeMessage {
  t: 'welcome';
  v: number;
  /** Your car's slot in the running round, or -1 when you are watching until the next round starts. */
  you: number;
  room: RoomInfo;
  epoch: number;
  /** The cars of the running round. */
  players: PlayerInfo[];
  tickRate: number;
  snapshotEvery: number;
  /** Where the room is in its round (null before the first round starts) and the running scores. */
  phase: PhaseMessage | null;
  scores: ScoreRow[];
}
/** A new round's cars. Sent to every player, each with their own `you` (-1 when there is no car for them). */
export interface RosterMessage {
  t: 'roster';
  epoch: number;
  round: number;
  you: number;
  players: PlayerInfo[];
}
export interface HitMessage {
  t: 'hit';
  tick: number;
  victim: number;
  /** Slot of the car that hit, or -1 for a wall or obstacle. */
  attacker: number;
  /** HP taken off, and the victim's HP afterwards. */
  dmg: number;
  hp: number;
  zone: Zone;
  /** Impulse of the impact in kN·s, and the contact point in the victim's local frame (metres). */
  j: number;
  p: [number, number, number];
}
export interface KoMessage {
  t: 'ko';
  tick: number;
  victim: number;
  /** Slot of the car credited with the elimination, or -1. */
  killer: number;
  assists: number[];
  reason: KoReason;
}
export interface ScoresMessage {
  t: 'scores';
  rows: ScoreRow[];
}
export interface ResultsMessage {
  t: 'results';
  round: number;
  /** Slot of the winner, or -1 for a draw. */
  winner: number;
  reason: RoundEnd;
  rows: ResultRow[];
}
export interface PongMessage {
  t: 'pong';
  id: number;
  c: number;
  tick: number;
}
export interface ErrorMessage {
  t: 'error';
  code: ErrorCode;
  message: string;
}
export type ServerMessage =
  | WelcomeMessage
  | RosterMessage
  | PhaseMessage
  | HitMessage
  | KoMessage
  | ScoresMessage
  | ResultsMessage
  | PongMessage
  | ErrorMessage;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Strict parser for anything a browser (or attacker) can send as text. Returns null when invalid. */
export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > NET.MAX_PAYLOAD_BYTES) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v)) return null;
  if (v.t === 'ping') {
    const id = v.id;
    const c = v.c;
    return isNum(id) && isNum(c) ? { t: 'ping', id, c } : null;
  }
  if (v.t === 'hello') {
    const mode = v.mode;
    const version = v.v;
    const name = v.name;
    const color = v.color;
    const code = v.code;
    if (mode !== 'quick' && mode !== 'create' && mode !== 'join') return null;
    if (!isInt(version) || typeof name !== 'string') return null;
    if (!isInt(color) || color < 0 || color > 0xffffff) return null;
    if (mode === 'join' && typeof code !== 'string') return null;
    return { t: 'hello', v: version, name, color, mode, code: typeof code === 'string' ? code : undefined };
  }
  return null;
}

const isSlot = (v: unknown): v is number => isInt(v) && v >= 0 && v < ARENA.MAX_CARS;
const isSlotOrNone = (v: unknown): v is number => isInt(v) && v >= -1 && v < ARENA.MAX_CARS;
const isList = (v: unknown): v is unknown[] => Array.isArray(v) && v.length <= ARENA.MAX_CARS;
const isPlayerInfo = (v: unknown): v is PlayerInfo =>
  isObj(v) && isSlot(v.slot) && typeof v.name === 'string' && isInt(v.color) && (v.bot === undefined || typeof v.bot === 'boolean');
const isScoreRow = (v: unknown): v is ScoreRow => isObj(v) && isSlot(v.slot) && isNum(v.score) && isNum(v.kills);
const isResultRow = (v: unknown): v is ResultRow =>
  isObj(v) && isSlot(v.slot) && typeof v.name === 'string' && isInt(v.color) && typeof v.bot === 'boolean' &&
  isNum(v.score) && isNum(v.gained) && isNum(v.kills) && isNum(v.damage) && isNum(v.hp) && typeof v.alive === 'boolean';
const PHASES: readonly unknown[] = ['countdown', 'live', 'results'];
const ZONES: readonly unknown[] = ['front', 'rear', 'left', 'right'];
const KO_REASONS: readonly unknown[] = ['damage', 'flipped', 'stuck', 'bounds', 'stall', 'disconnected'];
const ROUND_ENDS: readonly unknown[] = ['last', 'timeout', 'no_humans', 'draw'];
const isPhaseMessage = (v: unknown): v is PhaseMessage =>
  isObj(v) && v.t === 'phase' && PHASES.includes(v.phase) && isInt(v.round) && isNum(v.remainingMs) && v.remainingMs >= 0;

/** Defensive parser used by the client (and test clients) for server text frames. */
export function parseServerMessage(raw: string): ServerMessage | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v)) return null;
  switch (v.t) {
    case 'welcome': {
      const room = v.room;
      const players = v.players;
      const scores = v.scores;
      if (
        isInt(v.v) && isSlotOrNone(v.you) && isInt(v.epoch) && isInt(v.tickRate) && isInt(v.snapshotEvery) &&
        isObj(room) && typeof room.code === 'string' && typeof room.public === 'boolean' && isInt(room.capacity) &&
        isList(players) && players.every(isPlayerInfo) &&
        (v.phase === null || isPhaseMessage(v.phase)) &&
        isList(scores) && scores.every(isScoreRow)
      ) {
        return v as unknown as WelcomeMessage;
      }
      return null;
    }
    case 'roster': {
      const players = v.players;
      return isInt(v.epoch) && isInt(v.round) && isSlotOrNone(v.you) && isList(players) && players.every(isPlayerInfo)
        ? (v as unknown as RosterMessage)
        : null;
    }
    case 'phase':
      return isPhaseMessage(v) ? v : null;
    case 'hit': {
      const p = v.p;
      return isInt(v.tick) && isSlot(v.victim) && isSlotOrNone(v.attacker) && isNum(v.dmg) && v.dmg >= 0 && isNum(v.hp) &&
        ZONES.includes(v.zone) && isNum(v.j) && v.j >= 0 && Array.isArray(p) && p.length === 3 && p.every(isNum)
        ? (v as unknown as HitMessage)
        : null;
    }
    case 'ko': {
      const assists = v.assists;
      return isInt(v.tick) && isSlot(v.victim) && isSlotOrNone(v.killer) && isList(assists) && assists.every(isSlot) &&
        KO_REASONS.includes(v.reason)
        ? (v as unknown as KoMessage)
        : null;
    }
    case 'scores':
      return isList(v.rows) && v.rows.every(isScoreRow) ? (v as unknown as ScoresMessage) : null;
    case 'results':
      return isInt(v.round) && isSlotOrNone(v.winner) && ROUND_ENDS.includes(v.reason) && isList(v.rows) && v.rows.every(isResultRow)
        ? (v as unknown as ResultsMessage)
        : null;
    case 'pong':
      return isNum(v.id) && isNum(v.c) && isInt(v.tick) ? (v as unknown as PongMessage) : null;
    case 'error':
      return typeof v.code === 'string' && typeof v.message === 'string' ? (v as unknown as ErrorMessage) : null;
    default:
      return null;
  }
}

/** Removes control / bidi-override / zero-width characters, collapses spaces, caps at NAME_MAX code points. */
export function sanitizeName(raw: string, fallback: string): string {
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const capped = Array.from(cleaned).slice(0, NET.NAME_MAX).join('').trim();
  return capped.length > 0 ? capped : fallback;
}

const ROOM_CODE_RE = new RegExp(`^[${NET.ROOM_CODE_ALPHABET}]{${NET.ROOM_CODE_LENGTH}}$`);

/** Upper-cases and validates a room code; null when it can never exist. */
export function normalizeRoomCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return ROOM_CODE_RE.test(code) ? code : null;
}

// ---- input frame (client -> server): 8 bytes ---------------------------------------------------
export interface InputPacket {
  seq: number;
  input: CarInput;
}

export function encodeInput(seq: number, input: CarInput): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(8);
  const dv = new DataView(out.buffer);
  const p = packInput(input);
  dv.setUint8(0, MSG_INPUT);
  dv.setUint32(1, seq >>> 0, true);
  dv.setInt8(5, p.throttle);
  dv.setInt8(6, p.steer);
  dv.setUint8(7, p.flags);
  return out;
}

export function decodeInput(data: Uint8Array): InputPacket | null {
  if (data.byteLength !== 8) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (dv.getUint8(0) !== MSG_INPUT) return null;
  const throttle = dv.getInt8(5);
  const steer = dv.getInt8(6);
  if (throttle < -127 || steer < -127) return null; // -128 is never produced by packInput
  return {
    seq: dv.getUint32(1, true),
    input: unpackInput({ throttle, steer, flags: dv.getUint8(7) & FLAG_HANDBRAKE }),
  };
}

// ---- snapshot frame (server -> client) ---------------------------------------------------------
export interface SnapshotCar {
  slot: number;
  flags: number;
  hp: number;
  state: CarState;
  /** Echo of the car's current input, -1..1 (used for wheel animation and dead reckoning). */
  throttle: number;
  steer: number;
}

export interface Snapshot {
  epoch: number;
  tick: number;
  /** Highest input sequence number of the recipient that the server has consumed. */
  ackSeq: number;
  cars: SnapshotCar[];
}

const q16 = (v: number, scale: number): number => Math.round(clamp(v * scale, -32767, 32767));
const q8 = (v: number): number => (Number.isFinite(v) ? Math.round(clamp(v, -1, 1) * 127) + 0 : 0);

/** The recipient-independent part of a snapshot; build it once, then prepend a header per recipient. */
export function encodeCarBlock(cars: readonly SnapshotCar[]): Uint8Array {
  const out = new Uint8Array(cars.length * SNAPSHOT_CAR_BYTES);
  const dv = new DataView(out.buffer);
  cars.forEach((c, i) => {
    const o = i * SNAPSHOT_CAR_BYTES;
    const { pos, quat, linvel, angvel } = c.state;
    dv.setUint8(o, c.slot);
    dv.setUint8(o + 1, c.flags);
    dv.setUint8(o + 2, clamp(Math.round(c.hp), 0, 255));
    dv.setFloat32(o + 3, pos.x, true);
    dv.setFloat32(o + 7, pos.y, true);
    dv.setFloat32(o + 11, pos.z, true);
    dv.setInt16(o + 15, q16(quat.x, NET.QUAT_SCALE), true);
    dv.setInt16(o + 17, q16(quat.y, NET.QUAT_SCALE), true);
    dv.setInt16(o + 19, q16(quat.z, NET.QUAT_SCALE), true);
    dv.setInt16(o + 21, q16(quat.w, NET.QUAT_SCALE), true);
    dv.setInt16(o + 23, q16(linvel.x, NET.LINVEL_SCALE), true);
    dv.setInt16(o + 25, q16(linvel.y, NET.LINVEL_SCALE), true);
    dv.setInt16(o + 27, q16(linvel.z, NET.LINVEL_SCALE), true);
    dv.setInt16(o + 29, q16(angvel.x, NET.ANGVEL_SCALE), true);
    dv.setInt16(o + 31, q16(angvel.y, NET.ANGVEL_SCALE), true);
    dv.setInt16(o + 33, q16(angvel.z, NET.ANGVEL_SCALE), true);
    dv.setInt8(o + 35, q8(c.throttle));
    dv.setInt8(o + 36, q8(c.steer));
  });
  return out;
}

export function buildSnapshotPacket(epoch: number, tick: number, ackSeq: number, count: number, block: Uint8Array): Uint8Array {
  const out = new Uint8Array(SNAPSHOT_HEADER_BYTES + block.byteLength);
  const dv = new DataView(out.buffer);
  dv.setUint8(0, MSG_SNAPSHOT);
  dv.setUint8(1, epoch & 0xff);
  dv.setUint32(2, tick >>> 0, true);
  dv.setUint32(6, ackSeq >>> 0, true);
  dv.setUint8(10, count);
  out.set(block, SNAPSHOT_HEADER_BYTES);
  return out;
}

export const encodeSnapshot = (s: Snapshot): Uint8Array =>
  buildSnapshotPacket(s.epoch, s.tick, s.ackSeq, s.cars.length, encodeCarBlock(s.cars));

export function decodeSnapshot(data: Uint8Array): Snapshot | null {
  if (data.byteLength < SNAPSHOT_HEADER_BYTES) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (dv.getUint8(0) !== MSG_SNAPSHOT) return null;
  const count = dv.getUint8(10);
  if (count > ARENA.MAX_CARS || data.byteLength !== SNAPSHOT_HEADER_BYTES + count * SNAPSHOT_CAR_BYTES) return null;
  const cars: SnapshotCar[] = [];
  for (let i = 0; i < count; i++) {
    const o = SNAPSHOT_HEADER_BYTES + i * SNAPSHOT_CAR_BYTES;
    const slot = dv.getUint8(o);
    if (slot >= ARENA.MAX_CARS) return null;
    const qx = dv.getInt16(o + 15, true) / NET.QUAT_SCALE;
    const qy = dv.getInt16(o + 17, true) / NET.QUAT_SCALE;
    const qz = dv.getInt16(o + 19, true) / NET.QUAT_SCALE;
    const qw = dv.getInt16(o + 21, true) / NET.QUAT_SCALE;
    const qn = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) || 1;
    cars.push({
      slot,
      flags: dv.getUint8(o + 1),
      hp: dv.getUint8(o + 2),
      state: {
        pos: { x: dv.getFloat32(o + 3, true), y: dv.getFloat32(o + 7, true), z: dv.getFloat32(o + 11, true) },
        quat: { x: qx / qn, y: qy / qn, z: qz / qn, w: qw / qn },
        linvel: {
          x: dv.getInt16(o + 23, true) / NET.LINVEL_SCALE,
          y: dv.getInt16(o + 25, true) / NET.LINVEL_SCALE,
          z: dv.getInt16(o + 27, true) / NET.LINVEL_SCALE,
        },
        angvel: {
          x: dv.getInt16(o + 29, true) / NET.ANGVEL_SCALE,
          y: dv.getInt16(o + 31, true) / NET.ANGVEL_SCALE,
          z: dv.getInt16(o + 33, true) / NET.ANGVEL_SCALE,
        },
      },
      throttle: dv.getInt8(o + 35) / 127,
      steer: dv.getInt8(o + 36) / 127,
    });
  }
  return { epoch: dv.getUint8(1), tick: dv.getUint32(2, true), ackSeq: dv.getUint32(6, true), cars };
}
```

Raise the protocol version, so a browser that still runs the old client is told to reload instead of misreading the new messages:

In `src/shared/constants.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/constants.ts"} -->
```ts
  PROTOCOL_VERSION: 1,
```

with:

```ts
  /** 2: rounds, hit/ko/scores/results messages, `you` in the roster. */
  PROTOCOL_VERSION: 2,
```

In `scripts/smoke-e2e.mjs`, replace:

<!-- op {"kind": "edit", "path": "scripts/smoke-e2e.mjs"} -->
```js
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 1, name: 'smoke', color: 255, mode: 'create' })));
```

with:

```js
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 2, name: 'smoke', color: 255, mode: 'create' })));
```

The server must keep compiling until Task 29 rebuilds the room. Add the two new welcome fields, and the two new roster fields, in the old code:

In `src/server/app.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts
      tickRate: PHYSICS.TICK_RATE,
      snapshotEvery: NET.SNAPSHOT_EVERY,
    });
```

with:

```ts
      tickRate: PHYSICS.TICK_RATE,
      snapshotEvery: NET.SNAPSHOT_EVERY,
      phase: null,
      scores: [],
    });
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
    const roster = { t: 'roster', epoch: this.epoch, players: this.playerInfos() } as const;
    for (const p of players) p.send(roster);
```

with:

```ts
    const infos = this.playerInfos();
    for (const p of players) p.send({ t: 'roster', epoch: this.epoch, round: 0, you: p.slot, players: infos });
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/protocol.test.ts tests/client/connection.test.ts && npm run typecheck && npm test`
Expected: PASS — the protocol tests (22), the connection tests, then the whole suite (328 tests); type-check clean.

<!-- check {"cmd": "npx vitest run tests/protocol.test.ts tests/client/connection.test.ts && npm run typecheck && npm test", "outcome": "pass", "tests": 328} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(shared): protocol version 2 with the round, hit, ko, scores and results messages"
```

<!-- commit "feat(shared): protocol version 2 with the round, hit, ko, scores and results messages" -->

---

### Task 27: Bots

**Files:**
- Create: `src/shared/random.ts`, `src/server/bots.ts`
- Modify: `src/client/net/latency.ts` (its PRNG moves to `shared`)
- Test: `tests/bots.test.ts`

**Interfaces:**
- Consumes: `CarState`, `CarInput`, `quatRotate`, `clamp` (shared); `ARENA`, `COMBAT`, `CAR_FORWARD` (constants).
- Produces: `mulberry32(seed)` from `src/shared/random.ts` (still re-exported by `latency.ts`); `BotBrain(seed, skill?)` with `think(view: BotView): CarInput` and `target`; `BotView`, `BotTarget`; `BOT_NAMES`, `BOT_COLORS`.

- [ ] **Step 1: Write the failing tests**

Decision tests feed `think` made-up views (steering toward a target, easing off for a sharp turn, preferring the weaker of two targets, retargeting, wall avoidance, backing out when stuck, doing nothing on its side, repeatability for a seed). Driving tests run bots in the real simulation: one drives to a parked car and hits it, two hunt each other for 40 s, four fight for a minute — none may leave the arena or hit the wall at full speed.

Create `tests/bots.test.ts`:

<!-- op {"kind": "create", "path": "tests/bots.test.ts"} -->
```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ARENA, COMBAT } from '../src/shared/constants';
import { quatFromYaw } from '../src/shared/math';
import { initPhysics } from '../src/shared/physics';
import { Simulation } from '../src/shared/sim';
import type { CarState } from '../src/shared/types';
import { BOT_COLORS, BOT_NAMES, BotBrain, type BotTarget, type BotView } from '../src/server/bots';

beforeAll(async () => {
  await initPhysics();
});

const state = (x: number, z: number, yaw: number, speed = 0): CarState => ({
  pos: { x, y: 1.07, z },
  quat: quatFromYaw(yaw),
  linvel: { x: Math.cos(yaw) * speed, y: 0, z: -Math.sin(yaw) * speed },
  angvel: { x: 0, y: 0, z: 0 },
});
const target = (slot: number, x: number, z: number, hp = 100): BotTarget => ({ slot, state: state(x, z, 0), hp });

describe('BotBrain decisions', () => {
  it('steers toward a target on its right and on its left, and straight at one ahead', () => {
    const me = state(0, 0, 0); // facing +X, so +Z is to the right
    const right = new BotBrain(1, 1).think({ state: me, targets: [target(1, 20, 10)] });
    const left = new BotBrain(1, 1).think({ state: me, targets: [target(1, 20, -10)] });
    const ahead = new BotBrain(1, 1).think({ state: me, targets: [target(1, 25, 0)] });
    expect(right.steer).toBeGreaterThan(0.3);
    expect(left.steer).toBeLessThan(-0.3);
    expect(Math.abs(ahead.steer)).toBeLessThan(0.05);
    expect(ahead.throttle).toBeGreaterThan(0.9);
  });

  it('eases off for a sharp turn and rams at full throttle when close and lined up', () => {
    const me = state(0, 0, 0);
    const behind = new BotBrain(1, 1).think({ state: me, targets: [target(1, -20, 3)] });
    expect(behind.throttle).toBeLessThan(0.6);
    const close = new BotBrain(1, 0.6).think({ state: me, targets: [target(1, 6, 0)] });
    expect(close.throttle).toBe(1);
  });

  it('prefers a weakened car over a healthy one at the same distance', () => {
    const me = state(0, 0, 0);
    const brain = new BotBrain(3, 1);
    brain.think({ state: me, targets: [target(1, 20, 20, 100), target(2, 20, -20, 15)] });
    expect(brain.target).toBe(2);
    const other = new BotBrain(3, 1);
    other.think({ state: me, targets: [target(1, 20, 20, 15), target(2, 20, -20, 100)] });
    expect(other.target).toBe(1);
  });

  it('picks another target when its target is gone, and idles when nothing is left', () => {
    const me = state(0, 0, 0);
    const brain = new BotBrain(5, 1);
    brain.think({ state: me, targets: [target(1, 20, 0), target(2, -20, 0)] });
    const first = brain.target;
    const rest: BotView = { state: me, targets: [target(first === 1 ? 2 : 1, 20, 0)] };
    brain.think(rest);
    expect(brain.target).toBe(first === 1 ? 2 : 1);
    const idle = brain.think({ state: me, targets: [] });
    expect(idle).toEqual({ throttle: 0, steer: 0, handbrake: false });
    expect(brain.target).toBe(-1);
  });

  it('turns toward the middle and slows down when the wall is close ahead', () => {
    const nearWall = state(ARENA.RADIUS - 5, 0, 0, 12); // facing the wall at 12 m/s
    const out = new BotBrain(1, 1).think({ state: nearWall, targets: [target(1, ARENA.RADIUS - 5, 20)] });
    expect(Math.abs(out.steer)).toBeGreaterThan(0.6);
    expect(out.throttle).toBeLessThanOrEqual(0.7);
  });

  it('backs out turning the other way after a second of pushing without moving, then drives on', () => {
    const brain = new BotBrain(7, 1);
    const view: BotView = { state: state(0, 0, 0, 0), targets: [target(1, 3, 0)] };
    const throttles: number[] = [];
    for (let t = 0; t < 200; t++) {
      const input = brain.think(view);
      throttles.push(input.throttle);
      if (input.throttle < 0) expect(input.steer).not.toBe(0);
    }
    const first = throttles.findIndex((v) => v < 0);
    expect(first).toBeGreaterThan(55); // about a second of pushing first
    expect(first).toBeLessThan(90);
    let length = 0;
    while (throttles[first + length]! < 0) length++;
    expect(length).toBe(75); // then 75 ticks of reversing
    expect(throttles[first + length]!).toBeGreaterThan(0); // and it tries again
  });

  it('does nothing while it lies on its side', () => {
    const flipped: CarState = { ...state(0, 0, 0), quat: { x: 1, y: 0, z: 0, w: 0 } };
    expect(new BotBrain(1, 1).think({ state: flipped, targets: [target(1, 10, 0)] })).toEqual({ throttle: 0, steer: 0, handbrake: false });
  });

  it('is repeatable for a seed and differs between seeds', () => {
    const script = (seed: number): string => {
      const brain = new BotBrain(seed);
      const out: number[] = [brain.skill];
      for (let t = 0; t < 300; t++) {
        const input = brain.think({ state: state(t * 0.1, (t % 40) - 20, t * 0.01, 5), targets: [target(1, 30, 5), target(2, -20, 15, 60)] });
        out.push(input.throttle, input.steer);
      }
      return JSON.stringify(out);
    };
    expect(script(11)).toBe(script(11));
    expect(script(11)).not.toBe(script(12));
  });

  it('gives every bot a skill between 0.6 and 0.95', () => {
    for (let seed = 0; seed < 50; seed++) {
      const skill = new BotBrain(seed).skill;
      expect(skill).toBeGreaterThanOrEqual(0.6);
      expect(skill).toBeLessThan(0.95);
    }
  });

  it('has a name and colour for every seat', () => {
    expect(BOT_NAMES.length).toBeGreaterThanOrEqual(ARENA.MAX_CARS);
    expect(BOT_COLORS.length).toBeGreaterThanOrEqual(ARENA.MAX_CARS);
    expect(new Set(BOT_NAMES).size).toBe(BOT_NAMES.length);
  });
});

describe('BotBrain driving the real simulation', () => {
  const sims: Simulation[] = [];
  afterEach(() => {
    while (sims.length) sims.pop()!.dispose();
  });

  /** Runs `ticks` steps with a brain per bot slot; `still` slots get no input. Returns the biggest wall impulse seen. */
  function race(slots: number[], brains: Map<number, BotBrain>, ticks: number, setup?: (s: Simulation) => void) {
    const s = new Simulation(slots);
    sims.push(s);
    setup?.(s);
    const stats = { carHits: 0, wallPeak: 0, maxRadius: 0, closest: Infinity };
    for (let t = 0; t < ticks; t++) {
      for (const [slot, brain] of brains) {
        const targets: BotTarget[] = slots.filter((o) => o !== slot).map((o) => ({ slot: o, state: s.getState(o), hp: 100 }));
        s.setInput(slot, brain.think({ state: s.getState(slot), targets }));
      }
      s.step();
      for (const c of s.contacts(COMBAT.SCRAPE_IMPULSE)) {
        if (c.b >= 0) stats.carHits++;
        else stats.wallPeak = Math.max(stats.wallPeak, c.impulse);
      }
      for (const slot of slots) {
        const p = s.getState(slot).pos;
        stats.maxRadius = Math.max(stats.maxRadius, Math.hypot(p.x, p.z));
        for (const o of slots) if (o > slot) stats.closest = Math.min(stats.closest, Math.hypot(p.x - s.getState(o).pos.x, p.z - s.getState(o).pos.z));
      }
    }
    return { sim: s, stats };
  }

  it('drives to a parked car and hits it', () => {
    const { stats } = race([0, 1], new Map([[0, new BotBrain(1, 0.9)]]), 60 * 12, (s) => {
      s.setState(0, { ...state(-30, 0, 0), pos: { x: -30, y: 1.07, z: 0 } });
      s.setState(1, { ...state(10, 8, 1.2), pos: { x: 10, y: 1.07, z: 8 } });
    });
    expect(stats.carHits).toBeGreaterThan(0);
  });

  it('circles the arena hunting another bot without hitting the wall hard, and never leaves', () => {
    const brains = new Map([
      [0, new BotBrain(21, 0.8)],
      [1, new BotBrain(22, 0.8)],
    ]);
    const { stats } = race([0, 1], brains, 60 * 40);
    expect(stats.maxRadius).toBeLessThan(ARENA.RADIUS);
    expect(stats.carHits).toBeGreaterThan(0);
    expect(stats.wallPeak).toBeLessThan(20_000); // scrapes and glancing blows at most, never a full-speed crash
  });

  it('keeps four bots fighting for a minute without anyone escaping the arena', () => {
    const brains = new Map([0, 1, 2, 3].map((slot) => [slot, new BotBrain(100 + slot)] as const));
    const { stats, sim } = race([0, 1, 2, 3], brains, 60 * 60);
    expect(stats.maxRadius).toBeLessThan(ARENA.RADIUS);
    expect(stats.carHits).toBeGreaterThan(3);
    for (const slot of sim.slots) expect(Number.isFinite(sim.getState(slot).pos.x)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/bots.test.ts`
Expected: FAIL — cannot resolve `../src/server/bots`.

<!-- check {"cmd": "npx vitest run tests/bots.test.ts", "outcome": "fail"} -->

- [ ] **Step 3: Implement**

The seeded PRNG moves from the client's latency simulator to `shared`, where the server can use it too; `latency.ts` keeps exporting it, so nothing that imports it changes.

Create `src/shared/random.ts`:

<!-- op {"kind": "create", "path": "src/shared/random.ts"} -->
```ts
/** Small seeded PRNG (mulberry32): repeatable in tests, and never used by the simulation itself. Returns numbers in [0, 1). */
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
```

In `src/client/net/latency.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/latency.ts"} -->
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
```

with:

```ts
import { mulberry32 } from '../../shared/random';

export { mulberry32 };
```

Create `src/server/bots.ts`:

<!-- op {"kind": "create", "path": "src/server/bots.ts"} -->
```ts
import { ARENA, CAR_FORWARD, COMBAT } from '../shared/constants';
import { NEUTRAL_INPUT, type CarInput } from '../shared/input';
import { clamp, quatRotate } from '../shared/math';
import { mulberry32 } from '../shared/random';
import type { CarState } from '../shared/types';

export const BOT_NAMES = ['Rusty', 'Dent', 'Scrap', 'Torque', 'Clunker', 'Rivet', 'Gasket', 'Piston'] as const;
export const BOT_COLORS = [0x8a8f98, 0x6d9c5a, 0xc9a227, 0x7b5ea7, 0x3fa7a3, 0xb5651d, 0x9c4a4a, 0x4b6eaf] as const;

export interface BotTarget {
  slot: number;
  state: CarState;
  hp: number;
}

/** What a bot may look at: its own body and every other car that is still running. */
export interface BotView {
  state: CarState;
  targets: readonly BotTarget[];
}

/** Ticks between looking for a better target, how long stuck before backing out, and how long to back out. */
const RETARGET_TICKS = 45;
const STUCK_TICKS = 60;
const REVERSE_TICKS = 75;
const WOBBLE_TICKS = 20;
const UP: { x: number; y: number; z: number } = { x: 0, y: 1, z: 0 };

/** Unit vector on the ground plane (falls back to +X). */
function flat(x: number, z: number): { x: number; z: number } {
  const len = Math.hypot(x, z);
  return len < 1e-6 ? { x: 1, z: 0 } : { x: x / len, z: z / len };
}

/**
 * The driver behind a server-side bot. It produces the same kind of input a player's keyboard does, once per tick:
 * chase the nearest or weakest car with a lead on its motion, keep away from the wall, back out when stuck. A per-bot
 * skill adds steering noise, aim error and a little caution so bots are beatable. Everything random comes from the
 * seed, so a bot is repeatable in tests. Server-only: never part of the shared simulation.
 */
export class BotBrain {
  readonly skill: number;
  private readonly random: () => number;
  private tick = 0;
  private targetSlot = -1;
  private retargetAt = 0;
  private aimOffset = 0;
  private wobble = 0;
  private wobbleAt = 0;
  private stuck = 0;
  private reversing = 0;
  private reverseSteer = 1;

  constructor(seed: number, skill?: number) {
    this.random = mulberry32(seed);
    this.skill = clamp(skill ?? 0.6 + this.random() * 0.35, 0, 1);
  }

  /** Slot of the car this bot is currently after (-1: none). */
  get target(): number {
    return this.targetSlot;
  }

  think(view: BotView): CarInput {
    this.tick++;
    const { pos, quat, linvel } = view.state;
    const forward = quatRotate(quat, CAR_FORWARD);
    const f = flat(forward.x, forward.z);
    const speed = linvel.x * f.x + linvel.z * f.z;
    if (quatRotate(quat, UP).y < 0.3) return { ...NEUTRAL_INPUT }; // on its side or roof: nothing to do but wait

    if (this.reversing > 0) {
      this.reversing--;
      return { throttle: -1, steer: this.reverseSteer, handbrake: false };
    }

    const target = this.chooseTarget(view);
    if (this.tick >= this.wobbleAt) {
      this.wobble = (this.random() - 0.5) * 2 * (1 - this.skill) * 0.5;
      this.wobbleAt = this.tick + WOBBLE_TICKS;
    }

    let steer = 0;
    let throttle = 0;
    if (target) {
      const tp = target.state.pos;
      const dist = Math.hypot(tp.x - pos.x, tp.z - pos.z);
      const lead = clamp(dist / Math.max(6, speed + 6), 0, 1.2);
      const side = { x: -f.z, z: f.x }; // to the car's right
      const aimX = tp.x + target.state.linvel.x * lead + side.x * this.aimOffset;
      const aimZ = tp.z + target.state.linvel.z * lead + side.z * this.aimOffset;
      const dx = aimX - pos.x;
      const dz = aimZ - pos.z;
      const angle = Math.atan2(dx * side.x + dz * side.z, dx * f.x + dz * f.z); // + = target is to the right
      steer = clamp(angle * 1.8, -1, 1);
      const cap = 0.75 + 0.25 * this.skill;
      throttle = cap * clamp(1.4 - Math.abs(angle) * 0.6, 0.35, 1);
      if (dist < 8 && Math.abs(angle) < 0.5) throttle = 1; // close and lined up: ram
    }
    steer = clamp(steer + this.wobble, -1, 1);

    // keep off the wall: when the road ahead runs out, turn toward the middle and ease off
    const radius = Math.hypot(pos.x, pos.z);
    const look = 5 + Math.max(0, speed) * 0.6;
    const limit = ARENA.RADIUS - 4;
    if (radius > limit || Math.hypot(pos.x + f.x * look, pos.z + f.z * look) > limit) {
      const side = { x: -f.z, z: f.x };
      const toCentre = Math.atan2(-pos.x * side.x - pos.z * side.z, -pos.x * f.x - pos.z * f.z);
      steer = clamp(toCentre * 2, -1, 1);
      throttle = Math.min(throttle || 0.5, radius > limit + 2 ? 0.5 : 0.7);
    }

    // stuck: pushing without getting anywhere for a second, so back out turning the other way
    if (Math.abs(speed) < 1 && Math.abs(throttle) > 0.3) this.stuck++;
    else this.stuck = Math.max(0, this.stuck - 2);
    if (this.stuck > STUCK_TICKS) {
      this.stuck = 0;
      this.reversing = REVERSE_TICKS;
      this.reverseSteer = steer >= 0 ? -1 : 1;
    }
    return { throttle, steer, handbrake: false };
  }

  private chooseTarget(view: BotView): BotTarget | null {
    const current = view.targets.find((t) => t.slot === this.targetSlot);
    if (current && this.tick < this.retargetAt) return current;
    const { pos } = view.state;
    let best: BotTarget | null = null;
    let bestScore = Infinity;
    for (const t of view.targets) {
      const dist = Math.hypot(t.state.pos.x - pos.x, t.state.pos.z - pos.z);
      // nearest, but a hurt car looks closer than it is; a little noise keeps a pack from choosing the same victim
      const score = dist * (0.6 + (0.4 * t.hp) / COMBAT.MAX_HP) * (0.85 + 0.3 * this.random());
      if (score < bestScore) {
        best = t;
        bestScore = score;
      }
    }
    this.targetSlot = best ? best.slot : -1;
    this.retargetAt = this.tick + RETARGET_TICKS + Math.floor(this.random() * 30);
    this.aimOffset = (this.random() - 0.5) * 2 * (1 - this.skill) * 4;
    return best;
  }
}
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/bots.test.ts tests/client/latency.test.ts && npm run typecheck`
Expected: PASS — 13 bot tests plus the unchanged latency tests (26 in all); type-check clean.

<!-- check {"cmd": "npx vitest run tests/bots.test.ts tests/client/latency.test.ts && npm run typecheck", "outcome": "pass", "tests": 26} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): BotBrain drives server-side bots \u2014 chase, keep off the wall, back out when stuck"
```

<!-- commit "feat(server): BotBrain drives server-side bots \u2014 chase, keep off the wall, back out when stuck" -->

---

### Task 28: Rounds in the room

**Files:**
- Create: `src/server/round.ts` (`RoundState`, without the combat step yet), `tests/helpers/roomKit.ts`, `tests/server/round.test.ts`
- Replace: `src/server/room.ts`, `tests/server/room.test.ts`
- Modify: `src/shared/input.ts` (`PARKED_INPUT`), `src/shared/constants.ts`, `src/server/lobby.ts`, `src/server/app.ts`
- Modify (tests written for the old rebuild-on-every-join policy): `tests/server/lobby.test.ts`, `tests/server/integration.test.ts`, `tests/helpers/loopback.ts`, `tests/client/sessionRoom.test.ts`

**Interfaces:**
- Consumes: `BotBrain`, `BOT_NAMES`, `BOT_COLORS` (Task 27); the protocol 2 messages (Task 26); `COMBAT`, `ROUND` (Task 22); `AttackLog` (Task 24). `HitTracker` and `CarWatch` are only used from Task 30.
- Produces: `Room(code, isPublic, onEmpty, options?: RoomOptions)` with `RoomRules {countdownTicks, liveTicks, resultsTicks}`, `botFill`, `seed`; `addPlayer(): boolean`, `removePlayer`, `step`, `greeting(player)`, `phase`, `round`, `epoch`, `carSoon`; `RoundState` (`status`, `isAlive`, `hpOf`, `aliveSlots`, `leader`, `eliminate`, `awardWin`); `PARKED_INPUT`; `GameServerOptions.rules/botFill/seed`; `LobbyOptions.room`.

- [ ] **Step 1: Write the failing tests**

The room tests are rewritten for rounds: joining and greeting, the first round starting on the first tick, bots filling the room and stepping aside, frozen cars that are still acknowledged, going live, a countdown that restarts for latecomers (at most eight times), spectators, winners, draws, timeouts, wrecks that keep their slot, scores that carry over, snapshots, and the lifecycle. `tests/helpers/roomKit.ts` holds the small helpers they share.

Create `tests/helpers/roomKit.ts`:

<!-- op {"kind": "create", "path": "tests/helpers/roomKit.ts"} -->
```ts
import { expect } from 'vitest';
import { decodeSnapshot, type Snapshot } from '../../src/shared/protocol';
import type { Simulation } from '../../src/shared/sim';
import { Player } from '../../src/server/player';
import { Room, type RoomOptions, type RoomRules } from '../../src/server/room';
import { FakeSocket } from './fakeSocket';

/** Rounds that start at once and last long enough not to end by themselves unless a test wants them to. */
export const QUICK: RoomRules = { countdownTicks: 2, liveTicks: 60_000, resultsTicks: 30 };

const rooms: Room[] = [];
/** Call from `afterEach` to free every room the test made. */
export const disposeRooms = (): void => {
  while (rooms.length) rooms.pop()!.dispose();
};

/** A room with no bots and quick rounds unless the test says otherwise. */
export function makeRoom(options: RoomOptions = {}): { room: Room; emptied: Room[] } {
  const emptied: Room[] = [];
  const room = new Room('ABCD', true, (r) => emptied.push(r), { botFill: 0, seed: 7, ...options, rules: { ...QUICK, ...options.rules } });
  rooms.push(room);
  return { room, emptied };
}

let nextId = 1;
export function join(room: Room, name = 'P'): { player: Player; socket: FakeSocket } {
  const socket = new FakeSocket();
  const player = new Player(nextId++, socket);
  player.name = name;
  expect(room.addPlayer(player)).toBe(true);
  return { player, socket };
}

export const steps = (room: Room, n: number): void => {
  for (let i = 0; i < n; i++) room.step();
};
export const snapshots = (socket: FakeSocket): Snapshot[] => socket.binary().map((b) => decodeSnapshot(b)!);
export type Json = Record<string, unknown> & { t: string };
export const messages = (socket: FakeSocket, type?: string): Json[] =>
  (socket.json() as Json[]).filter((m) => type === undefined || m.t === type);
export const drive = { throttle: 1, steer: 0, handbrake: false };

/** The room's current simulation (private; tests reach in to stage collisions). */
export const serverSim = (room: Room): Simulation => Reflect.get(room, 'sim') as Simulation;
```

Replace `tests/server/room.test.ts` with:

<!-- op {"kind": "replace", "path": "tests/server/room.test.ts"} -->
```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ARENA, NET, ROUND } from '../../src/shared/constants';
import { vlen, vsub } from '../../src/shared/math';
import { initPhysics } from '../../src/shared/physics';
import { SNAP_FLAG_ALIVE, SNAP_FLAG_HANDBRAKE } from '../../src/shared/protocol';
import { Player } from '../../src/server/player';
import { DEFAULT_RULES } from '../../src/server/room';
import { FakeSocket } from '../helpers/fakeSocket';
import { disposeRooms, drive, join, makeRoom, messages, serverSim, snapshots, steps } from '../helpers/roomKit';

beforeAll(async () => {
  await initPhysics();
});
afterEach(disposeRooms);

describe('Room joining', () => {
  it('lets eight humans in and turns a ninth away', () => {
    const { room } = makeRoom();
    for (let i = 0; i < ARENA.MAX_CARS; i++) join(room, `P${i}`);
    expect(room.playerCount).toBe(8);
    expect(room.isFull).toBe(true);
    expect(room.addPlayer(new Player(999, new FakeSocket()))).toBe(false);
  });

  it('describes itself, and has no cars before the first round starts', () => {
    const { room } = makeRoom();
    join(room, 'Ann');
    expect(room.info()).toEqual({ code: 'ABCD', public: true, capacity: ARENA.MAX_CARS });
    expect(room.playerInfos()).toEqual([]);
    expect(room.greeting(room.seated()[0]!)).toEqual({ you: -1, players: [], phase: null, scores: [] });
  });

  it('has the documented default round timing', () => {
    expect(DEFAULT_RULES).toEqual({ countdownTicks: 300, liveTicks: 14_400, resultsTicks: 480 });
    expect(ROUND.BOT_FILL).toBe(4);
  });
});

describe('Room rounds', () => {
  it('starts the first round on the first tick: the roster tells each player their slot, then the countdown begins', () => {
    const { room } = makeRoom({ rules: { countdownTicks: 120 } });
    const a = join(room, 'Ann');
    const b = join(room, 'Bob');
    expect(messages(a.socket)).toHaveLength(0);
    room.step();
    expect(room.epoch).toBe(1);
    expect(room.round).toBe(1);
    const [rosterA] = messages(a.socket, 'roster');
    const [rosterB] = messages(b.socket, 'roster');
    expect(rosterA).toMatchObject({ epoch: 1, round: 1, you: 0 });
    expect(rosterB).toMatchObject({ epoch: 1, round: 1, you: 1 });
    expect((rosterA!.players as unknown[]).length).toBe(2);
    expect(messages(a.socket).map((m) => m.t)).toEqual(['roster', 'phase', 'scores']);
    expect(messages(a.socket, 'phase')[0]).toMatchObject({ phase: 'countdown', round: 1, remainingMs: 2000 });
    expect(a.player.slot).toBe(0);
    expect(b.player.slot).toBe(1);
  });

  it('fills the room with bots up to four cars and puts humans first', () => {
    const { room } = makeRoom({ botFill: 4 });
    const a = join(room, 'Ann');
    room.step();
    const infos = room.playerInfos();
    expect(infos.map((p) => p.slot)).toEqual([0, 1, 2, 3]);
    expect(infos.map((p) => Boolean(p.bot))).toEqual([false, true, true, true]);
    expect(new Set(infos.map((p) => p.name)).size).toBe(4);
    expect(snapshots(a.socket).length).toBe(0); // the first snapshot comes on the second tick
    steps(room, 1);
    expect(snapshots(a.socket)[0]!.cars.map((c) => c.slot)).toEqual([0, 1, 2, 3]);
  });

  it('has fewer bots as humans join, and none once four humans are in', () => {
    const { room } = makeRoom({ botFill: 4, rules: { countdownTicks: 200, liveTicks: 10, resultsTicks: 5 } });
    join(room);
    room.step();
    expect(room.playerInfos().filter((p) => p.bot)).toHaveLength(3);
    join(room);
    room.step(); // joined during the countdown: the countdown restarts with two humans
    expect(room.playerInfos().filter((p) => p.bot)).toHaveLength(2);
    join(room);
    join(room);
    room.step();
    expect(room.playerInfos().map((p) => Boolean(p.bot))).toEqual([false, false, false, false]);
    join(room);
    room.step();
    expect(room.playerInfos()).toHaveLength(5);
    expect(room.playerInfos().some((p) => p.bot)).toBe(false);
  });

  it('keeps bots and their scores from one round to the next while they are still needed', () => {
    const { room } = makeRoom({ botFill: 4, rules: { countdownTicks: 2, liveTicks: 30, resultsTicks: 5 } });
    join(room);
    room.step();
    const names = room.playerInfos().map((p) => p.name);
    steps(room, 60);
    expect(room.round).toBeGreaterThan(1);
    expect(room.playerInfos().map((p) => p.name)).toEqual(names);
  });

  it('freezes the cars during the countdown, ignores their inputs, and still acknowledges them', () => {
    const { room } = makeRoom({ rules: { countdownTicks: 120 } });
    const a = join(room);
    room.step();
    const start = serverSim(room).getState(0).pos;
    for (let seq = 1; seq <= 100; seq++) {
      a.player.pushInput(seq, drive);
      room.step();
    }
    const now = serverSim(room).getState(0).pos;
    expect(Math.hypot(now.x - start.x, now.z - start.z)).toBeLessThan(0.3); // settled on its suspension, no driving
    const last = snapshots(a.socket).at(-1)!;
    expect(last.ackSeq).toBeGreaterThanOrEqual(98);
    expect(last.cars[0]!.flags & SNAP_FLAG_HANDBRAKE).toBe(SNAP_FLAG_HANDBRAKE); // parked
    expect(last.cars[0]!.throttle).toBe(0);
  });

  it('goes live when the countdown is over and then applies inputs', () => {
    const { room } = makeRoom({ rules: { countdownTicks: 60 } });
    const a = join(room);
    steps(room, 1);
    let seq = 0;
    for (let t = 0; t < 59; t++) {
      a.player.pushInput(++seq, drive);
      room.step();
    }
    expect(room.phase).toBe('countdown');
    for (let t = 0; t < 90; t++) {
      a.player.pushInput(++seq, drive);
      room.step();
    }
    expect(room.phase).toBe('live');
    expect(messages(a.socket, 'phase').map((m) => m.phase)).toEqual(['countdown', 'live']);
    const cars = snapshots(a.socket).at(-1)!.cars;
    expect(vlen(vsub(cars[0]!.state.pos, serverSim(room).getState(0).pos))).toBeLessThan(2);
    expect(vlen(serverSim(room).getState(0).linvel)).toBeGreaterThan(4); // it is really driving
    expect(cars[0]!.throttle).toBe(1);
  });

  it('restarts the countdown for a player who joins during it, so a burst of joiners plays together', () => {
    const { room } = makeRoom({ rules: { countdownTicks: 100 } });
    const a = join(room, 'Ann');
    steps(room, 10);
    expect(room.epoch).toBe(1);
    const b = join(room, 'Bob');
    expect(room.greeting(b.player).you).toBe(-1); // no car yet
    steps(room, 1);
    expect(room.epoch).toBe(2);
    expect(room.round).toBe(1); // the same round, started over
    expect(messages(b.socket, 'roster')).toHaveLength(1);
    expect(messages(b.socket, 'roster')[0]).toMatchObject({ epoch: 2, round: 1, you: 1 });
    expect(messages(a.socket, 'roster').map((m) => m.epoch)).toEqual([1, 2]);
    expect(messages(a.socket, 'phase').at(-1)).toMatchObject({ phase: 'countdown', remainingMs: 1667 });
  });

  it('stops restarting the countdown after a number of joins, so nobody can hold a room back by joining and leaving', () => {
    const { room } = makeRoom({ rules: { countdownTicks: 100 } });
    join(room);
    steps(room, 2);
    for (let i = 0; i < ROUND.MAX_COUNTDOWN_RESTARTS; i++) {
      const visitor = join(room);
      steps(room, 2);
      room.removePlayer(visitor.player); // in and out again
    }
    expect(room.epoch).toBe(1 + ROUND.MAX_COUNTDOWN_RESTARTS);
    const late = join(room);
    steps(room, 5);
    expect(room.epoch).toBe(1 + ROUND.MAX_COUNTDOWN_RESTARTS); // no more restarts this round
    expect(late.player.slot).toBe(-1);
  });

  it('keeps a player who joins during the live round out of it, but shows them the running round', () => {
    const { room } = makeRoom();
    const a = join(room, 'Ann');
    join(room, 'Bob');
    steps(room, 20);
    expect(room.phase).toBe('live');
    const late = join(room, 'Cy');
    steps(room, 10);
    const greeting = room.greeting(late.player);
    expect(greeting.you).toBe(-1);
    expect(greeting.players.map((p) => p.name)).toEqual(['Ann', 'Bob']);
    expect(greeting.phase).toMatchObject({ phase: 'live', round: 1 });
    expect(messages(late.socket, 'roster')).toHaveLength(0); // no new world for them
    const seen = snapshots(late.socket);
    expect(seen.length).toBeGreaterThan(0); // but they watch
    expect(seen.at(-1)!.cars.map((c) => c.slot)).toEqual([0, 1]);
    expect(seen.at(-1)!.epoch).toBe(room.epoch);
    expect(a.socket.json().some((m) => m.t === 'roster' && (m.players as unknown[]).length === 3)).toBe(false);
  });

  it('keeps draining and acknowledging the inputs of a player who is watching', () => {
    const { room } = makeRoom();
    join(room, 'Ann');
    steps(room, 10);
    const late = join(room, 'Cy');
    for (let seq = 1; seq <= 40; seq++) {
      late.player.pushInput(seq, drive);
      room.step();
    }
    expect(snapshots(late.socket).at(-1)!.ackSeq).toBeGreaterThanOrEqual(38);
  });

  it('turns a player who leaves during the countdown into a wreck for the whole round', () => {
    const { room } = makeRoom({ rules: { countdownTicks: 200 } });
    const a = join(room, 'Ann');
    const b = join(room, 'Bob');
    join(room, 'Cy');
    steps(room, 5);
    room.removePlayer(b.player);
    expect(messages(a.socket, 'ko')).toMatchObject([{ victim: 1, reason: 'disconnected' }]);
    steps(room, 400);
    expect(room.phase).toBe('live'); // Ann and Cy carry on
    expect(snapshots(a.socket).at(-1)!.cars.map((c) => c.slot)).toEqual([0, 1, 2]);
  });

  it('gives a player who joins while the results are showing a car in the next round', () => {
    const { room } = makeRoom({ rules: { resultsTicks: 60 } });
    const a = join(room, 'Ann');
    const b = join(room, 'Bob');
    steps(room, 20);
    room.removePlayer(b.player);
    steps(room, 2);
    expect(room.phase).toBe('results');
    const c = join(room, 'Cy');
    expect(room.greeting(c.player).you).toBe(-1);
    steps(room, 70);
    expect(room.round).toBe(2);
    expect(messages(c.socket, 'roster').at(-1)).toMatchObject({ round: 2, you: 1 });
    expect(room.playerInfos().map((p) => p.name)).toEqual(['Ann', 'Cy']);
    expect(a.player.slot).toBe(0);
  });

  it('does not eliminate anybody who leaves while the results are showing', () => {
    const { room } = makeRoom({ rules: { resultsTicks: 300 } });
    const a = join(room, 'Ann');
    const b = join(room, 'Bob');
    steps(room, 20);
    room.removePlayer(b.player);
    steps(room, 2);
    expect(room.phase).toBe('results');
    const kos = messages(a.socket, 'ko').length;
    room.removePlayer(a.player); // the winner leaves too: the room empties
    expect(messages(a.socket, 'ko').length).toBe(kos);
  });

  it('ends the round when one car is left, names the winner, and starts the next round with a new world', () => {
    const { room } = makeRoom({ rules: { resultsTicks: 40 } });
    const a = join(room, 'Ann');
    const b = join(room, 'Bob');
    steps(room, 20);
    room.removePlayer(b.player); // Bob leaves mid-round: his car is out
    expect(messages(a.socket, 'ko')).toMatchObject([{ victim: 1, killer: -1, assists: [], reason: 'disconnected' }]);
    room.step();
    expect(room.phase).toBe('results');
    const [results] = messages(a.socket, 'results');
    expect(results).toMatchObject({ round: 1, winner: 0, reason: 'last' });
    expect((results!.rows as Array<Record<string, unknown>>).map((r) => [r.slot, r.name, r.alive])).toEqual([[0, 'Ann', true], [1, 'Bob', false]]);
    expect(messages(a.socket, 'phase').at(-1)).toMatchObject({ phase: 'results', remainingMs: 667 });
    steps(room, 41);
    expect(room.phase).toBe('countdown');
    expect(room.round).toBe(2);
    expect(room.epoch).toBe(2);
    expect(messages(a.socket, 'roster').at(-1)).toMatchObject({ epoch: 2, round: 2, you: 0 });
    expect(room.playerInfos().map((p) => p.name)).toEqual(['Ann']);
  });

  it('adds the win bonus to the winner and carries running scores into the next round', () => {
    const { room } = makeRoom({ rules: { resultsTicks: 10 } });
    const a = join(room, 'Ann');
    const b = join(room, 'Bob');
    steps(room, 20);
    room.removePlayer(b.player);
    room.step();
    const results = messages(a.socket, 'results')[0]!;
    const rows = results.rows as Array<Record<string, number>>;
    expect(rows[0]).toMatchObject({ slot: 0, gained: 100, score: 100, kills: 0 });
    expect(rows[1]).toMatchObject({ slot: 1, gained: 0, score: 0 });
    steps(room, 12);
    expect(messages(a.socket, 'scores').at(-1)).toMatchObject({ rows: [{ slot: 0, score: 100, kills: 0 }] });
  });

  it('ends the round when the time runs out; equal HP is a draw', () => {
    const { room } = makeRoom({ rules: { liveTicks: 50 } });
    const a = join(room);
    join(room);
    steps(room, 60);
    const [results] = messages(a.socket, 'results');
    expect(results).toMatchObject({ round: 1, winner: -1, reason: 'draw' });
    expect(room.phase).toBe('results');
  });

  it('plays a lone player without bots until the time runs out, since there is nobody to beat; surviving wins', () => {
    const { room } = makeRoom({ rules: { liveTicks: 200 } });
    const a = join(room);
    steps(room, 100);
    expect(room.phase).toBe('live');
    steps(room, 110);
    expect(messages(a.socket, 'results')[0]).toMatchObject({ winner: 0, reason: 'timeout' });
  });

  it('turns a departed player into a wreck that stays in the world and keeps its slot', () => {
    const { room } = makeRoom({ botFill: 4 });
    const a = join(room, 'Ann');
    const b = join(room, 'Bob');
    steps(room, 20);
    room.removePlayer(b.player);
    steps(room, 10);
    expect(room.phase).toBe('live'); // two bots and Ann are still running
    const snap = snapshots(a.socket).at(-1)!;
    expect(snap.cars.map((c) => c.slot)).toEqual([0, 1, 2, 3]);
    const wreck = snap.cars.find((c) => c.slot === 1)!;
    expect(wreck.flags & SNAP_FLAG_ALIVE).toBe(0);
    expect(wreck.hp).toBe(0);
    expect(room.playerInfos()[1]!.name).toBe('Bob');
    // and a new joiner does not inherit the wreck
    const late = join(room, 'Cy');
    expect(room.greeting(late.player).you).toBe(-1);
  });
});

describe('Room snapshots', () => {
  it('broadcasts snapshots at 30 Hz with every car, its hit points and whether it is running', () => {
    const { room } = makeRoom({ botFill: 4 });
    const a = join(room);
    steps(room, 60);
    const snaps = snapshots(a.socket);
    expect(snaps.length).toBeGreaterThanOrEqual(29);
    expect(snaps.length).toBeLessThanOrEqual(31);
    const last = snaps.at(-1)!;
    expect(last.epoch).toBe(1);
    expect(last.cars.map((c) => c.slot)).toEqual([0, 1, 2, 3]);
    for (const c of last.cars) {
      expect(c.flags & SNAP_FLAG_ALIVE).toBe(SNAP_FLAG_ALIVE);
      expect(c.hp).toBe(100);
    }
  });

  it('applies queued inputs (one per tick), moves the car and acknowledges sequence numbers', () => {
    const { room } = makeRoom();
    const a = join(room);
    steps(room, 3);
    for (let seq = 1; seq <= 90; seq++) {
      a.player.pushInput(seq, drive);
      room.step();
    }
    const snaps = snapshots(a.socket);
    const last = snaps.at(-1)!;
    expect(last.ackSeq).toBeGreaterThanOrEqual(88);
    expect(last.ackSeq).toBeLessThanOrEqual(90);
    expect(vlen(vsub(last.cars[0]!.state.pos, snaps[0]!.cars[0]!.state.pos))).toBeGreaterThan(3);
    expect(last.cars[0]!.throttle).toBe(1);
  });

  it('acknowledges inputs received before a round starts, so the first snapshot does not claim they are still pending', () => {
    const { room } = makeRoom();
    const a = join(room);
    for (let seq = 1; seq <= 10; seq++) a.player.pushInput(seq, drive);
    steps(room, 4);
    expect(snapshots(a.socket)[0]!.ackSeq).toBe(10);
  });

  it('acknowledges the inputs a new round discards', () => {
    const { room } = makeRoom({ rules: { liveTicks: 20, resultsTicks: 5 } });
    const a = join(room);
    let seq = 0;
    for (let t = 0; t < 28; t++) {
      a.player.pushInput(++seq, drive);
      room.step();
    }
    for (let i = 0; i < 6; i++) a.player.pushInput(++seq, drive); // in flight when the next round is built
    steps(room, 1);
    expect(room.epoch).toBe(2);
    const first = snapshots(a.socket).filter((s) => s.epoch === 2)[0];
    steps(room, 2);
    const firstOfNewRound = snapshots(a.socket).find((s) => s.epoch === 2)!;
    expect(first === undefined || first.ackSeq >= 28).toBe(true);
    expect(firstOfNewRound.ackSeq).toBeGreaterThanOrEqual(28);
  });

  it('neutralises the input echo after the input stream stalls', () => {
    const { room } = makeRoom();
    const a = join(room);
    steps(room, 4);
    a.player.pushInput(1, drive);
    steps(room, 120);
    const snaps = snapshots(a.socket);
    expect(snaps.find((s) => s.cars[0]!.throttle === 1)).toBeDefined();
    expect(snaps.at(-1)!.cars[0]!.throttle).toBe(0);
  });

  it('skips snapshots for a backed-up socket but still delivers JSON', () => {
    const { room } = makeRoom();
    const a = join(room);
    a.socket.bufferedAmount = NET.MAX_BUFFERED_BYTES + 1;
    steps(room, 30);
    expect(a.socket.binary()).toHaveLength(0);
    expect(a.player.skippedSnapshots).toBeGreaterThan(0);
    expect(messages(a.socket, 'roster')).toHaveLength(1);
  });
});

describe('Room lifecycle', () => {
  it('disconnects players who stay silent for 30 s', () => {
    const { room } = makeRoom();
    const a = join(room);
    steps(room, 3);
    a.player.ticksSinceInput = NET.INACTIVE_KICK_TICKS + 1;
    room.step();
    expect(a.socket.closed?.code).toBe(4001);
  });

  it('calls onEmpty exactly once when the last player leaves, and stepping a disposed room is a no-op', () => {
    const { room, emptied } = makeRoom();
    const a = join(room);
    const b = join(room);
    steps(room, 5);
    room.removePlayer(a.player);
    expect(emptied).toHaveLength(0);
    room.removePlayer(b.player);
    room.removePlayer(b.player); // second call is harmless
    expect(emptied).toEqual([room]);
    room.dispose();
    room.dispose();
    expect(() => steps(room, 5)).not.toThrow();
  });

  it('does nothing while nobody is in the room', () => {
    const { room } = makeRoom();
    expect(() => steps(room, 10)).not.toThrow();
    expect(room.epoch).toBe(0);
    expect(room.simTick).toBe(0);
  });
});
```

Create `tests/server/round.test.ts`:

<!-- op {"kind": "create", "path": "tests/server/round.test.ts"} -->
```ts
import { describe, expect, it } from 'vitest';
import { COMBAT } from '../../src/shared/constants';
import { RoundState } from '../../src/server/round';

describe('RoundState bookkeeping', () => {
  it('starts every car alive with full hit points', () => {
    const state = new RoundState([0, 1, 2]);
    expect(state.aliveSlots()).toEqual([0, 1, 2]);
    expect(state.hpOf(1)).toBe(COMBAT.MAX_HP);
    expect(state.isAlive(2)).toBe(true);
    expect(state.isAlive(5)).toBe(false); // not in this round
    expect(state.hpOf(5)).toBe(0);
  });

  it('eliminates a car once and says so in a ko message', () => {
    const state = new RoundState([0, 1]);
    expect(state.eliminate(1, 'flipped', 500)).toEqual({ t: 'ko', tick: 500, victim: 1, killer: -1, assists: [], reason: 'flipped' });
    expect(state.isAlive(1)).toBe(false);
    expect(state.hpOf(1)).toBe(0);
    expect(state.aliveSlots()).toEqual([0]);
    expect(state.eliminate(1, 'bounds', 501)).toBeNull(); // already out
    expect(state.eliminate(7, 'bounds', 501)).toBeNull(); // not in this round
  });

  it('names the leader: the alive car with the most HP, or nobody when the best two are level', () => {
    const state = new RoundState([0, 1, 2]);
    expect(state.leader()).toBe(-1); // all level
    state.status.get(1)!.hp = 80;
    state.status.get(0)!.hp = 60;
    state.status.get(2)!.hp = 40;
    expect(state.leader()).toBe(1);
    state.eliminate(1, 'damage', 10);
    expect(state.leader()).toBe(0); // a wreck never leads, whatever it had
    state.eliminate(0, 'damage', 11);
    state.eliminate(2, 'damage', 12);
    expect(state.leader()).toBe(-1);
  });

  it('adds the win bonus to a car\'s points for the round', () => {
    const state = new RoundState([0, 1]);
    state.awardWin(1);
    expect(state.status.get(1)!.gained).toBe(COMBAT.WIN_POINTS);
    expect(state.status.get(0)!.gained).toBe(0);
    state.awardWin(9); // not in this round: ignored
  });
});
```

The tests that assumed the old policy (every join rebuilds the world after half a second) are adapted. Lobby: a joiner has no car yet, and quick play prefers a room where a car comes soon.

In `tests/server/lobby.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/lobby.test.ts"} -->
```ts
import { Player } from '../../src/server/player';
```

with:

```ts
import { Player } from '../../src/server/player';
import type { RoomOptions } from '../../src/server/room';
```

In `tests/server/lobby.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/lobby.test.ts"} -->
```ts
const makeLobby = (maxRooms = 5, random?: () => number): Lobby => {
  const l = new Lobby({ maxRooms, random });
```

with:

```ts
const makeLobby = (maxRooms = 5, random?: () => number, room?: RoomOptions): Lobby => {
  const l = new Lobby({ maxRooms, random, room: { botFill: 0, ...room } });
```

In `tests/server/lobby.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/lobby.test.ts"} -->
```ts
  it('never places quick-play players into private rooms', () => {
```

with:

```ts
  it('prefers a room where a car comes soon (between rounds) over a fuller one that is mid-round', () => {
    const lobby = makeLobby(5, undefined, { rules: { countdownTicks: 2, liveTicks: 30, resultsTicks: 500 } });
    const crowded = ok(lobby.quickPlay(newPlayer())).room;
    for (let i = 1; i < ARENA.MAX_CARS; i++) lobby.quickPlay(newPlayer());
    const quiet = ok(lobby.quickPlay(newPlayer())).room; // the ninth player opens a second public room
    expect(quiet).not.toBe(crowded);
    for (let i = 0; i < 5; i++) crowded.step(); // the crowded room is now mid-round
    for (let i = 0; i < 40; i++) quiet.step(); // the quiet room has finished its round
    expect([crowded.phase, quiet.phase]).toEqual(['live', 'results']);
    for (const p of crowded.seated().slice(0, 5)) lobby.leave(p); // both rooms have space now: 3 humans against 1
    expect(ok(lobby.quickPlay(newPlayer())).room).toBe(quiet);
    for (let i = 0; i < 700 && quiet.phase !== 'live'; i++) quiet.step(); // the quiet room starts its next round
    expect(quiet.phase).toBe('live');
    expect(ok(lobby.quickPlay(newPlayer())).room).toBe(crowded); // both are mid-round now, so the fuller one wins
  });

  it('never places quick-play players into private rooms', () => {
```

In `tests/server/lobby.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/lobby.test.ts"} -->
```ts
    expect(joined.slot).toBe(1);
```

with:

```ts
    expect(joined.slot).toBe(-1); // a car comes with the next roster
```

In `tests/server/lobby.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/lobby.test.ts"} -->
```ts
    for (let i = 0; i < NET.REBUILD_DELAY_TICKS; i++) lobby.tickAll();
    expect(sockets[1]!.json()
```

with:

```ts
    for (let i = 0; i < 3; i++) lobby.tickAll();
    expect(sockets[1]!.json()
```

In `tests/server/lobby.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/lobby.test.ts"} -->
```ts
    for (let i = 0; i < NET.REBUILD_DELAY_TICKS; i++) lobby.tickAll();
    for (const s of sockets)
```

with:

```ts
    for (let i = 0; i < 3; i++) lobby.tickAll();
    for (const s of sockets)
```

Integration: the server under test has no bots and quick rounds; players who join in the same countdown share a round, and slots come from the roster.

In `tests/server/integration.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/integration.test.ts"} -->
```ts
import { encodeInput, type RosterMessage } from '../../src/shared/protocol';
```

with:

```ts
import { encodeInput, type PhaseMessage, type RosterMessage } from '../../src/shared/protocol';
```

In `tests/server/integration.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/integration.test.ts"} -->
```ts
  c.messages.find((m): m is RosterMessage => m.t === 'roster' && m.players.length === n);
```

with:

```ts
  c.messages.find((m): m is RosterMessage => m.t === 'roster' && m.players.length === n);
const goesLive = (c: TestClient) => c.messages.find((m): m is PhaseMessage => m.t === 'phase' && m.phase === 'live');
```

In `tests/server/integration.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/integration.test.ts"} -->
```ts
  app = createGameServer({ maxRooms: 6 });
```

with:

```ts
  app = createGameServer({ maxRooms: 6, botFill: 0, rules: { countdownTicks: 30, liveTicks: 6000, resultsTicks: 60 } });
```

In `tests/server/integration.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/integration.test.ts"} -->
```ts
    expect(wa.room.code).toBe(wb.room.code);
    expect(new Set([wa.you, wb.you])).toEqual(new Set([0, 1]));

    const roster = await b.waitFor(() => rosterWith(b, 2), 4000, 'roster with both players');
    await a.waitFor(() => rosterWith(a, 2), 4000, 'roster for A');
    await b.waitFor(() => b.snapshots.find((s) => s.epoch === roster.epoch && s.cars.length === 2), 3000, 'first snapshot');
```

with:

```ts
    expect(wa.room.code).toBe(wb.room.code);

    // both joined during the first countdown, so both get a car in the same round
    const roster = await b.waitFor(() => rosterWith(b, 2), 4000, 'roster with both players');
    const rosterA = await a.waitFor(() => rosterWith(a, 2), 4000, 'roster for A');
    expect(new Set([rosterA.you, roster.you])).toEqual(new Set([0, 1]));
    expect(rosterA.epoch).toBe(roster.epoch);
    await b.waitFor(() => goesLive(b), 3000, 'the round to go live');
    await b.waitFor(() => b.snapshots.find((s) => s.epoch === roster.epoch && s.cars.length === 2), 3000, 'first snapshot');
```

In `tests/server/integration.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/integration.test.ts"} -->
```ts
    const start = inEpoch[0]!.cars.find((c) => c.slot === wa.you)!.state.pos;
    const end = inEpoch[inEpoch.length - 1]!.cars.find((c) => c.slot === wa.you)!.state.pos;
```

with:

```ts
    const start = inEpoch[0]!.cars.find((c) => c.slot === rosterA.you)!.state.pos;
    const end = inEpoch[inEpoch.length - 1]!.cars.find((c) => c.slot === rosterA.you)!.state.pos;
```

In `tests/server/integration.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/integration.test.ts"} -->
```ts
    expect(wb.you).toBe(1);
```

with:

```ts
    expect(wb.you).toBe(-1); // no car until the next roster
    expect((await b.waitFor(() => rosterWith(b, 2), 4000, 'roster with both')).you).toBe(1);
```

In `tests/server/integration.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/integration.test.ts"} -->
```ts
    await b.waitFor(() => rosterWith(b, 1), 4000, 'roster after A left');
```

with:

```ts
    await b.waitFor(() => b.messages.find((m) => m.t === 'ko' && m.reason === 'disconnected'), 4000, 'A to be eliminated');
```

In `tests/server/integration.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/integration.test.ts"} -->
```ts
    const w = await a.waitFor(() => a.welcome());
```

with:

```ts
    await a.waitFor(() => a.welcome());
```

In `tests/server/integration.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/integration.test.ts"} -->
```ts
    const roster = await a.waitFor(() => rosterWith(a, 1), 4000, 'roster');
```

with:

```ts
    const roster = await a.waitFor(() => rosterWith(a, 1), 4000, 'roster');
    await a.waitFor(() => goesLive(a), 3000, 'the round to go live');
```

In `tests/server/integration.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/server/integration.test.ts"} -->
```ts
    expect(last.cars.find((c) => c.slot === w.you)!.throttle).toBe(0);
```

with:

```ts
    expect(last.cars.find((c) => c.slot === roster.you)!.throttle).toBe(0);
```

The loopback harness and the session-room test build their rooms with the new options (no bots, a one-tick countdown, no end to the round), and the harness expects the first player to get slot 0:

In `tests/helpers/loopback.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/helpers/loopback.ts"} -->
```ts
import { Room } from '../../src/server/room';
```

with:

```ts
import { Room, type RoomRules } from '../../src/server/room';
```

In `tests/helpers/loopback.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/helpers/loopback.ts"} -->
```ts
  clientFirst?: boolean;
}
```

with:

```ts
  clientFirst?: boolean;
  /** Round timing on the server (default: a one-tick countdown, then a live round that never ends). */
  rules?: Partial<RoomRules>;
}
```

In `tests/helpers/loopback.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/helpers/loopback.ts"} -->
```ts
  readonly room = new Room('LOOP', true, () => undefined);
```

with:

```ts
  readonly room: Room;
```

In `tests/helpers/loopback.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/helpers/loopback.ts"} -->
```ts
  constructor(private readonly options: LoopbackOptions) {
```

with:

```ts
  constructor(private readonly options: LoopbackOptions) {
    this.room = new Room('LOOP', true, () => undefined, {
      botFill: 0,
      rules: { countdownTicks: 1, liveTicks: 1e9, resultsTicks: 1e9, ...options.rules },
    });
```

In `tests/helpers/loopback.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/helpers/loopback.ts"} -->
```ts
    this.world = new PredictedWorld(this.local.slot, { predictor: options.predictor, smoothing: options.smoothing });
```

with:

```ts
    this.world = new PredictedWorld(0, { predictor: options.predictor, smoothing: options.smoothing }); // the first player to join gets slot 0
```

In `tests/client/sessionRoom.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/sessionRoom.test.ts"} -->
```ts
    const room = new Room('FALL', true, () => undefined);
```

with:

```ts
    const room = new Room('FALL', true, () => undefined, { botFill: 0, rules: { countdownTicks: 2, liveTicks: 400, resultsTicks: 30 } });
```

In `tests/client/sessionRoom.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/sessionRoom.test.ts"} -->
```ts
    // A third player joins: the server rebuilds the world, and this client cannot build the bigger one.
    canBuildWorlds = false;
    room.addPlayer(new Player(3, new FakeSocket()));
    for (let i = 0; i < 60 && session.mode === 'predict'; i++, k++) tick(k);
```

with:

```ts
    // A third player joins and watches; when the next round starts the world has three cars, which this client cannot build.
    canBuildWorlds = false;
    room.addPlayer(new Player(3, new FakeSocket()));
    for (let i = 0; i < 300 && session.mode === 'predict'; i++, k++) tick(k);
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/server/room.test.ts tests/server/round.test.ts`
Expected: FAIL — `round.test.ts` cannot resolve `../../src/server/round`; the room tests fail because `addPlayer` returns a slot number, not `true`, and nothing produces rounds, phases or bots.

<!-- check {"cmd": "npx vitest run tests/server/room.test.ts tests/server/round.test.ts", "outcome": "fail"} -->

- [ ] **Step 3: Implement**

`PARKED_INPUT` — what the server feeds a car that is frozen or wrecked (no drive, handbrake on so it stays put):

In `src/shared/input.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/input.ts"} -->
```ts
export const NEUTRAL_INPUT: Readonly<CarInput> = { throttle: 0, steer: 0, handbrake: false };
```

with:

```ts
export const NEUTRAL_INPUT: Readonly<CarInput> = { throttle: 0, steer: 0, handbrake: false };

/** What a car that is frozen (countdown, results) or wrecked is given: no drive and the handbrake on, so it stays put. */
export const PARKED_INPUT: Readonly<CarInput> = { throttle: 0, steer: 0, handbrake: true };
```

The rebuild delay of the old policy is gone:

In `src/shared/constants.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/constants.ts"} -->
```ts
  /** Ticks between a roster change and the world rebuild (baseline policy). */
  REBUILD_DELAY_TICKS: 30,

```

with:

```ts

```

Per-round bookkeeping (the combat parts of it arrive in Task 30), and the room itself:

Create `src/server/round.ts`:

<!-- op {"kind": "create", "path": "src/server/round.ts"} -->
```ts
import { COMBAT } from '../shared/constants';
import type { KoMessage, KoReason } from '../shared/protocol';
import { AttackLog } from './combat';

/** How one car is doing in the running round. */
export interface CarStatus {
  slot: number;
  hp: number;
  alive: boolean;
  /** Eliminations credited to this car, HP of damage it dealt, and the points it earned this round. */
  kills: number;
  damage: number;
  gained: number;
}


/**
 * Everything the server tracks about one round's cars: hit points, who is still running, who hit whom, and the points
 * earned. It knows nothing about players, sockets or phases; the Room feeds it the simulation and turns what comes back
 * into messages.
 */
export class RoundState {
  readonly status = new Map<number, CarStatus>();
  private readonly log = new AttackLog();

  constructor(slots: readonly number[]) {
    for (const slot of slots) {
      this.status.set(slot, { slot, hp: COMBAT.MAX_HP, alive: true, kills: 0, damage: 0, gained: 0 });
    }
  }

  isAlive(slot: number): boolean {
    return this.status.get(slot)?.alive ?? false;
  }

  hpOf(slot: number): number {
    return this.status.get(slot)?.hp ?? 0;
  }

  aliveSlots(): number[] {
    return [...this.status.values()].filter((s) => s.alive).map((s) => s.slot);
  }

  /** The alive car with the most HP, or -1 when nobody is alive or the best two are level. */
  leader(): number {
    const alive = [...this.status.values()].filter((s) => s.alive).sort((a, b) => b.hp - a.hp || a.slot - b.slot);
    if (alive.length === 0) return -1;
    if (alive.length > 1 && Math.abs(alive[0]!.hp - alive[1]!.hp) < 1e-9) return -1;
    return alive[0]!.slot;
  }

  /** Takes a car out of the round. Returns the message to send, or null when it was out already. */
  eliminate(slot: number, reason: KoReason, tick: number): KoMessage | null {
    const car = this.status.get(slot);
    if (!car || !car.alive) return null;
    car.alive = false;
    car.hp = 0;
    // a disconnect is nobody's kill; anything else goes to whoever hit the car last, if that was recent
    const { killer, assists } = reason === 'disconnected' ? { killer: -1, assists: [] } : this.log.credit(slot, tick);
    if (killer >= 0) {
      const credited = this.status.get(killer);
      if (credited) {
        credited.kills++;
        credited.gained += COMBAT.KILL_POINTS;
      }
    }
    return { t: 'ko', tick, victim: slot, killer, assists, reason };
  }

  awardWin(slot: number): void {
    const car = this.status.get(slot);
    if (car) car.gained += COMBAT.WIN_POINTS;
  }

}
```

Replace `src/server/room.ts` with:

<!-- op {"kind": "replace", "path": "src/server/room.ts"} -->
```ts
import { ARENA, NET, PHYSICS, ROUND } from '../shared/constants';
import { PARKED_INPUT, type CarInput } from '../shared/input';
import {
  SNAP_FLAG_ALIVE,
  SNAP_FLAG_GROUNDED,
  SNAP_FLAG_HANDBRAKE,
  buildSnapshotPacket,
  encodeCarBlock,
  type Phase,
  type PhaseMessage,
  type PlayerInfo,
  type ResultRow,
  type RoomInfo,
  type RoundEnd,
  type ScoreRow,
  type ServerMessage,
  type SnapshotCar,
} from '../shared/protocol';
import { Simulation } from '../shared/sim';
import type { CarState } from '../shared/types';
import { BOT_COLORS, BOT_NAMES, BotBrain, type BotTarget } from './bots';
import type { Player } from './player';
import { RoundState } from './round';

/** How long each phase of a round lasts, in simulation ticks. */
export interface RoomRules {
  countdownTicks: number;
  liveTicks: number;
  resultsTicks: number;
}

export const DEFAULT_RULES: Readonly<RoomRules> = {
  countdownTicks: ROUND.COUNTDOWN_TICKS,
  liveTicks: ROUND.LIVE_TICKS,
  resultsTicks: ROUND.RESULTS_TICKS,
};

export interface RoomOptions {
  rules?: Partial<RoomRules>;
  /** Bots fill the room up to this many cars (default ROUND.BOT_FILL); humans push them out. 0 = no bots. */
  botFill?: number;
  /** Seeds the bots' randomness (default 1). */
  seed?: number;
}

/** A human or a bot taking part in the room. Running totals live here; hit points and the like live in RoundState. */
interface Participant {
  key: string;
  player: Player | null;
  bot: boolean;
  name: string;
  color: number;
  /** Slot of this participant's car in the running round, or -1 while it waits for the next one. */
  slot: number;
  score: number;
  kills: number;
}

const MS_PER_TICK = 1000 / PHYSICS.TICK_RATE;
const SCORES_EVERY_TICKS = 15;

/**
 * One arena instance, played in rounds: COUNTDOWN (a fresh world, cars frozen) -> LIVE (until one car is left, the time
 * runs out or no human is left) -> RESULTS -> a new round. Everyone in the room at the start of a round gets a car;
 * players who arrive later watch until the next one. Bots fill the room up to `botFill` cars.
 */
export class Room {
  /** Increments on every new world; clients drop snapshots from other epochs. */
  epoch = 0;
  round = 0;
  phase: Phase = 'countdown';
  private readonly rules: RoomRules;
  private readonly botFill: number;
  private readonly seed: number;
  private participants: Participant[] = [];
  /** The cars of the running round; the index is the slot. Includes players who have left since. */
  private roundCars: Participant[] = [];
  private brains = new Map<number, BotBrain>();
  private sim: Simulation | null = null;
  private state: RoundState | null = null;
  private folded = false;
  private restartPending = false;
  private restarts = 0;
  private ticks = 0;
  private phaseTicks = 0;
  private botsMade = 0;
  private scoresDirty = false;
  private scoresSentAt = 0;
  private disposed = false;

  constructor(
    readonly code: string,
    readonly isPublic: boolean,
    private readonly onEmpty: (room: Room) => void,
    options: RoomOptions = {},
  ) {
    this.rules = { ...DEFAULT_RULES, ...options.rules };
    this.botFill = Math.max(0, Math.min(ARENA.MAX_CARS, Math.floor(options.botFill ?? ROUND.BOT_FILL)));
    this.seed = (options.seed ?? 1) >>> 0;
  }

  /** Simulation tick of the current world (0 before the first round starts). */
  get simTick(): number {
    return this.sim?.tick ?? 0;
  }

  /** Humans in the room, whether or not they have a car in the running round. */
  get playerCount(): number {
    return this.humans().length;
  }

  get isFull(): boolean {
    return this.playerCount >= ARENA.MAX_CARS;
  }

  /** True when a player joining now gets a car soon: before the first round, in a countdown, or between rounds. */
  get carSoon(): boolean {
    return this.phase !== 'live';
  }

  /** Every human in the room. */
  seated(): Player[] {
    return this.humans().map((p) => p.player!);
  }

  info(): RoomInfo {
    return { code: this.code, public: this.isPublic, capacity: ARENA.MAX_CARS };
  }

  /** The cars of the running round. */
  playerInfos(): PlayerInfo[] {
    return this.roundCars.map((p, slot) => (p.bot ? { slot, name: p.name, color: p.color, bot: true } : { slot, name: p.name, color: p.color }));
  }

  /** What a player who has just joined needs to know: their slot (-1 = watching), the cars, the phase and the scores. */
  greeting(player: Player): { you: number; players: PlayerInfo[]; phase: PhaseMessage | null; scores: ScoreRow[] } {
    const me = this.participants.find((p) => p.player === player);
    return { you: me?.slot ?? -1, players: this.playerInfos(), phase: this.sim ? this.phaseMessage() : null, scores: this.scoreRows() };
  }

  /** Adds a human. Returns false when the room is full or closed. They get a car when the next round starts. */
  addPlayer(player: Player): boolean {
    if (this.disposed || this.isFull) return false;
    this.participants.push({ key: `p${player.id}`, player, bot: false, name: player.name, color: player.color, slot: -1, score: 0, kills: 0 });
    player.slot = -1;
    player.room = this;
    player.resetInputState();
    // still counting down: start over with this player in the world, unless that has happened too often this round
    if (this.sim && this.phase === 'countdown' && this.restarts < ROUND.MAX_COUNTDOWN_RESTARTS) this.restartPending = true;
    return true;
  }

  removePlayer(player: Player): void {
    const index = this.participants.findIndex((p) => p.player === player);
    if (index < 0) return;
    const leaving = this.participants[index]!;
    if (this.state && leaving.slot >= 0 && this.phase !== 'results') {
      const ko = this.state.eliminate(leaving.slot, 'disconnected', this.simTick);
      if (ko) {
        this.broadcast(ko, player);
        this.scoresDirty = true;
      }
    }
    this.participants.splice(index, 1);
    player.slot = -1;
    player.room = null;
    if (this.humans().length === 0) this.onEmpty(this);
  }

  /** One 60 Hz tick. */
  step(): void {
    if (this.disposed) return;
    this.ticks++;
    const humans = this.humans();
    for (const p of humans) if (p.player!.ticksSinceInput > NET.INACTIVE_KICK_TICKS) p.player!.close(4001, 'inactive');
    if (!this.sim) {
      if (humans.length === 0) return;
      this.startRound(false);
    } else if (this.restartPending && this.phase === 'countdown') {
      this.startRound(true);
    } else if (this.phase === 'results' && this.phaseTicks >= this.rules.resultsTicks) {
      this.startRound(false);
    } else if (this.phase === 'countdown' && this.phaseTicks >= this.rules.countdownTicks) {
      this.enterLive();
    }
    const sim = this.sim!;
    const state = this.state!;
    this.applyInputs(sim, state);
    sim.step();
    this.phaseTicks++;
    if (this.phase === 'live') {
      this.checkEnd(state);
    }
    this.flushScores();
    if (sim.tick % NET.SNAPSHOT_EVERY === 0) this.broadcastSnapshot(sim, state);
  }

  /** Frees the simulation. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sim?.dispose();
    this.sim = null;
  }

  // ---- rounds ------------------------------------------------------------------------------------

  private humans(): Participant[] {
    return this.participants.filter((p) => p.player !== null);
  }

  /** Builds a fresh world. `restart` repeats the current round's countdown with whoever is here now. */
  private startRound(restart: boolean): void {
    this.sim?.dispose();
    this.restartPending = false;
    this.restarts = restart ? this.restarts + 1 : 0;
    if (!restart) this.round++;
    this.epoch = (this.epoch + 1) & 0xff;
    const humans = this.humans();
    const inRound = humans.slice(0, ARENA.MAX_CARS);
    const wantBots = Math.max(0, Math.min(this.botFill - inRound.length, ARENA.MAX_CARS - inRound.length));
    const bots = this.participants.filter((p) => p.bot).slice(0, wantBots); // bots that stay keep their names and scores
    while (bots.length < wantBots) bots.push(this.newBot());
    this.participants = [...humans, ...bots];
    this.roundCars = [...inRound, ...bots];
    for (const p of this.participants) p.slot = -1;
    this.roundCars.forEach((p, slot) => {
      p.slot = slot;
    });
    this.brains = new Map(bots.map((b, i) => [b.slot, new BotBrain((this.seed + this.round * 7919 + i * 104_729) >>> 0)] as const));
    const slots = this.roundCars.map((_, slot) => slot);
    this.sim = new Simulation(slots);
    this.state = new RoundState(slots);
    this.folded = false;
    this.phase = 'countdown';
    this.phaseTicks = 0;
    const cars = this.playerInfos();
    for (const p of humans) {
      p.player!.slot = p.slot;
      p.player!.resetInputState();
      p.player!.send({ t: 'roster', epoch: this.epoch, round: this.round, you: p.slot, players: cars });
    }
    this.broadcast(this.phaseMessage());
    this.scoresDirty = true;
    this.scoresSentAt = -SCORES_EVERY_TICKS;
  }

  private newBot(): Participant {
    const n = this.botsMade++;
    return {
      key: `b${n}`,
      player: null,
      bot: true,
      name: BOT_NAMES[n % BOT_NAMES.length]!,
      color: BOT_COLORS[n % BOT_COLORS.length]!,
      slot: -1,
      score: 0,
      kills: 0,
    };
  }

  private enterLive(): void {
    this.phase = 'live';
    this.phaseTicks = 0;
    this.broadcast(this.phaseMessage());
  }

  private checkEnd(state: RoundState): void {
    const alive = state.aliveSlots();
    const humansAlive = alive.some((slot) => !this.roundCars[slot]!.bot);
    if (this.roundCars.length >= 2 && alive.length <= 1) {
      this.enterResults('last', alive[0] ?? -1);
    } else if (this.roundCars.some((p) => !p.bot) && !humansAlive) {
      this.enterResults('no_humans', state.leader());
    } else if (this.phaseTicks >= this.rules.liveTicks) {
      this.enterResults('timeout', state.leader());
    }
  }

  private enterResults(reason: RoundEnd, winner: number): void {
    const state = this.state!;
    if (winner >= 0) state.awardWin(winner);
    const rows: ResultRow[] = this.roundCars.map((p, slot) => {
      const car = state.status.get(slot)!;
      p.score += car.gained;
      p.kills += car.kills;
      return {
        slot,
        name: p.name,
        color: p.color,
        bot: p.bot,
        score: Math.round(p.score),
        gained: Math.round(car.gained),
        kills: car.kills,
        damage: Math.round(car.damage),
        hp: Math.ceil(car.hp),
        alive: car.alive,
      };
    });
    this.folded = true;
    this.broadcast({ t: 'results', round: this.round, winner, reason: winner < 0 ? 'draw' : reason, rows });
    this.phase = 'results';
    this.phaseTicks = 0;
    this.broadcast(this.phaseMessage());
    this.scoresDirty = false;
  }

  // ---- per tick ----------------------------------------------------------------------------------

  private applyInputs(sim: Simulation, state: RoundState): void {
    // every human's queue is drained every tick, so acknowledgements keep moving whatever the car is doing
    const drained = new Map<Player, CarInput>();
    for (const p of this.humans()) drained.set(p.player!, p.player!.nextInput());
    const live = this.phase === 'live';
    const states = new Map<number, CarState>();
    if (live) for (const slot of sim.slots) states.set(slot, sim.getState(slot));
    for (const slot of sim.slots) {
      const p = this.roundCars[slot]!;
      let input: CarInput = PARKED_INPUT;
      if (live && state.isAlive(slot)) {
        if (p.bot) {
          const targets: BotTarget[] = state
            .aliveSlots()
            .filter((other) => other !== slot)
            .map((other) => ({ slot: other, state: states.get(other)!, hp: state.hpOf(other) }));
          input = this.brains.get(slot)?.think({ state: states.get(slot)!, targets }) ?? PARKED_INPUT;
        } else if (p.player) {
          input = drained.get(p.player) ?? PARKED_INPUT;
        }
      }
      sim.setInput(slot, input);
    }
  }

  private flushScores(): void {
    if (!this.scoresDirty || this.ticks - this.scoresSentAt < SCORES_EVERY_TICKS) return;
    this.scoresDirty = false;
    this.scoresSentAt = this.ticks;
    this.broadcast({ t: 'scores', rows: this.scoreRows() });
  }

  private broadcastSnapshot(sim: Simulation, state: RoundState): void {
    const cars: SnapshotCar[] = [];
    for (const slot of sim.slots) {
      const input = sim.getInput(slot);
      const alive = state.isAlive(slot);
      let flags = alive ? SNAP_FLAG_ALIVE : 0;
      if (input.handbrake) flags |= SNAP_FLAG_HANDBRAKE;
      if (sim.getWheels(slot).some((w) => w.contact)) flags |= SNAP_FLAG_GROUNDED;
      cars.push({ slot, flags, hp: alive ? Math.ceil(state.hpOf(slot)) : 0, state: sim.getState(slot), throttle: input.throttle, steer: input.steer });
    }
    const block = encodeCarBlock(cars);
    for (const p of this.humans()) {
      p.player!.sendSnapshot(buildSnapshotPacket(this.epoch, sim.tick, p.player!.ackSeq, cars.length, block));
    }
  }

  // ---- messages ----------------------------------------------------------------------------------

  private phaseMessage(): PhaseMessage {
    const limit = this.phase === 'countdown' ? this.rules.countdownTicks : this.phase === 'live' ? this.rules.liveTicks : this.rules.resultsTicks;
    return { t: 'phase', phase: this.phase, round: this.round, remainingMs: Math.max(0, Math.round((limit - this.phaseTicks) * MS_PER_TICK)) };
  }

  private scoreRows(): ScoreRow[] {
    return this.roundCars.map((p, slot) => {
      const car = this.state?.status.get(slot);
      const open = car && !this.folded;
      return { slot, score: Math.round(p.score + (open ? car.gained : 0)), kills: p.kills + (open ? car.kills : 0) };
    });
  }

  private broadcast(msg: ServerMessage, except?: Player): void {
    for (const p of this.humans()) if (p.player !== except) p.player!.send(msg);
  }
}
```

The lobby hands its room options to every room, seats a player without a slot, and prefers a room where a car comes soon:

In `src/server/lobby.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/lobby.ts"} -->
```ts
import { Room } from './room';
```

with:

```ts
import { Room, type RoomOptions } from './room';
```

In `src/server/lobby.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/lobby.ts"} -->
```ts
  random?: () => number;
}
```

with:

```ts
  random?: () => number;
  /** Round timing, bot count and bot seed for every room. */
  room?: RoomOptions;
}
```

In `src/server/lobby.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/lobby.ts"} -->
```ts
  /** Joins the fullest public room that still has space, or opens a new public room. */
  quickPlay(player: Player): JoinResult {
    let best: Room | null = null;
    for (const r of this.rooms.values()) {
      if (r.isPublic && !r.isFull && (!best || r.playerCount > best.playerCount)) best = r;
```

with:

```ts
  /**
   * Joins a public room that still has space and where a car is soonest: one that is between rounds or has not started,
   * then the fullest, or opens a new public room.
   */
  quickPlay(player: Player): JoinResult {
    let best: Room | null = null;
    for (const r of this.rooms.values()) {
      if (!r.isPublic || r.isFull) continue;
      if (!best || (r.carSoon && !best.carSoon) || (r.carSoon === best.carSoon && r.playerCount > best.playerCount)) best = r;
```

In `src/server/lobby.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/lobby.ts"} -->
```ts
    const slot = room.addPlayer(player);
    return slot < 0 ? { ok: false, code: 'room_full' } : { ok: true, room, slot };
```

with:

```ts
    return room.addPlayer(player) ? { ok: true, room, slot: player.slot } : { ok: false, code: 'room_full' };
```

In `src/server/lobby.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/lobby.ts"} -->
```ts
    const room = new Room(code, isPublic, (r) => {
      this.rooms.delete(r.code);
      r.dispose();
    });
```

with:

```ts
    const room = new Room(
      code,
      isPublic,
      (r) => {
        this.rooms.delete(r.code);
        r.dispose();
      },
      { seed: (Math.random() * 0x1_0000_0000) >>> 0, ...this.options.room },
    );
```

The server passes the round options on, and greets a newcomer with the running round:

In `src/server/app.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts
import { Player } from './player';
```

with:

```ts
import { Player } from './player';
import type { RoomRules } from './room';
```

In `src/server/app.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts
  helloTimeoutMs?: number;
}
```

with:

```ts
  helloTimeoutMs?: number;
  /** Round timing in simulation ticks (defaults: 5 s countdown, 4 min round, 8 s results). */
  rules?: Partial<RoomRules>;
  /** Bots fill each room up to this many cars (default 4; 0 = none). */
  botFill?: number;
  /** Seeds the bots' randomness (default: random per room). */
  seed?: number;
}
```

In `src/server/app.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts
  const lobby = new Lobby({ maxRooms: options.maxRooms ?? 12 });
```

with:

```ts
  const lobby = new Lobby({
    maxRooms: options.maxRooms ?? 12,
    room: { rules: options.rules, botFill: options.botFill, ...(options.seed === undefined ? {} : { seed: options.seed }) },
  });
```

In `src/server/app.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts
    player.joined = true;
    player.send({
      t: 'welcome',
      v: NET.PROTOCOL_VERSION,
      you: result.slot,
      room: result.room.info(),
      epoch: result.room.epoch,
      players: result.room.playerInfos(),
      tickRate: PHYSICS.TICK_RATE,
      snapshotEvery: NET.SNAPSHOT_EVERY,
      phase: null,
      scores: [],
    });
```

with:

```ts
    player.joined = true;
    const greeting = result.room.greeting(player);
    player.send({
      t: 'welcome',
      v: NET.PROTOCOL_VERSION,
      you: greeting.you,
      room: result.room.info(),
      epoch: result.room.epoch,
      players: greeting.players,
      tickRate: PHYSICS.TICK_RATE,
      snapshotEvery: NET.SNAPSHOT_EVERY,
      phase: greeting.phase,
      scores: greeting.scores,
    });
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/server tests/client/sessionRoom.test.ts tests/client/predictedWorld.test.ts && npm run typecheck && npm test`
Expected: PASS — the server tests, the loopback and session-room tests against the new room, type-check clean, then the whole suite (363 tests).

<!-- check {"cmd": "npx vitest run tests/server tests/client/sessionRoom.test.ts tests/client/predictedWorld.test.ts && npm run typecheck && npm test", "outcome": "pass", "tests": 363} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(server): rooms play in rounds \u2014 countdown, live, results \u2014 with bots, spectators and a new world every round"
```

<!-- commit "feat(server): rooms play in rounds \u2014 countdown, live, results \u2014 with bots, spectators and a new world every round" -->

---

### Task 29: The client follows the rounds

**Files:**
- Modify: `src/client/net/prediction.ts`, `src/client/net/netStats.ts`, `src/client/net/predictedWorld.ts` (replace), `src/client/net/session.ts` (replace), `src/client/game/carView.ts`, `src/client/game/gameClient.ts`
- Test: `tests/client/prediction.test.ts`, `tests/client/session.test.ts` (replace), `tests/client/carView.test.ts`, `tests/client/predictedWorld.test.ts`, `tests/client/sessionRoom.test.ts`, `tests/helpers/loopback.ts`

**Interfaces:**
- Consumes: The protocol 2 messages (Task 26), the room's rounds and `PARKED_INPUT` (Task 28).
- Produces: `Predictor.mySlot` (mutable), `Predictor.setLive/isLive`, `beginWorld(epoch, mySlot?)` on `Predictor`/`PredictedWorld`; `ClientSession.onWelcome(slot, epoch, phase?)`, `onRoster(epoch, you)`, `onPhase(phase)`, `phase`; `DrawPose.alive/hp`; `CarView.setWreck`. `GameClient` learns its slot from each roster, holds the local car still like the server does, draws wrecks charred and follows another car when its own is out.

- [ ] **Step 1: Write the failing tests**

Predictor: the local car is held while the round is not live and once the snapshot says it is out, the replay of inputs typed during a countdown does not drive it, and the local slot changes with every world while input numbering carries on.

Append to `tests/client/prediction.test.ts`:

<!-- op {"kind": "append", "path": "tests/client/prediction.test.ts"} -->
```ts
describe('Predictor while the server holds the car still', () => {
  const travelled = (p: Predictor, slot: number, from: { x: number; z: number }): number => {
    const pos = p.poses(1).find((x) => x.slot === slot)!.state.pos;
    return Math.hypot(pos.x - from.x, pos.z - from.z);
  };

  it('parks the local car while the round is not live, and lets it drive once it is', () => {
    const p = new Predictor(0);
    const w = world([0, 1]);
    p.beginWorld(3);
    p.reconcile(snapshotOf(w, { tick: 2 }));
    p.setLive(false);
    const start = p.poses(1).find((x) => x.slot === 0)!.state.pos;
    for (let i = 0; i < 120; i++) p.step(straight());
    expect(travelled(p, 0, start)).toBeLessThan(0.3); // settled on its suspension, nothing more
    p.setLive(true);
    for (let i = 0; i < 120; i++) p.step(straight());
    expect(travelled(p, 0, start)).toBeGreaterThan(5);
    p.dispose();
  });

  it('parks the local car once the server says it is out of the round', () => {
    const p = new Predictor(0);
    const w = world([0, 1]);
    p.beginWorld(3);
    p.reconcile(snapshotOf(w, { tick: 2 }));
    const wrecked = snapshotOf(w, { tick: 4 });
    wrecked.cars[0]!.flags = 0; // no SNAP_FLAG_ALIVE
    wrecked.cars[0]!.hp = 0;
    p.reconcile(wrecked);
    const start = p.poses(1).find((x) => x.slot === 0)!.state.pos;
    for (let i = 0; i < 120; i++) p.step(straight());
    expect(travelled(p, 0, start)).toBeLessThan(0.3);
    p.dispose();
  });

  it('holds the car still when the replay covers inputs sent during a countdown', () => {
    const p = new Predictor(0);
    const w = world([0, 1]);
    p.beginWorld(3);
    p.setLive(false);
    for (let i = 0; i < 10; i++) p.step(straight()); // pressed while the server was holding the cars
    p.reconcile(snapshotOf(w, { tick: 2, ackSeq: 0 }));
    const start = p.poses(1).find((x) => x.slot === 0)!.state.pos;
    expect(travelled(p, 0, start)).toBeLessThan(0.3); // the ten replayed inputs did not drive it
    p.dispose();
  });

  it('takes a new local slot with each world and keeps numbering inputs', () => {
    const p = new Predictor(-1);
    const w = world([0, 1, 2]);
    p.beginWorld(3);
    expect(p.step(straight())).toBe(1);
    p.beginWorld(4, 2); // a new round: the player now drives slot 2
    expect(p.mySlot).toBe(2);
    expect(p.sequence).toBe(1);
    p.reconcile(snapshotOf(w, { epoch: 4, tick: 2, ackSeq: 1 }));
    expect(p.hasLocalCar).toBe(true);
    expect(p.step(straight())).toBe(2);
    p.beginWorld(5); // no slot given: unchanged
    expect(p.mySlot).toBe(2);
    p.beginWorld(6, -1); // watching
    p.reconcile(snapshotOf(w, { epoch: 6, tick: 2, ackSeq: 2 }));
    expect(p.hasLocalCar).toBe(false);
    p.dispose();
  });
});
```

Session: the slot comes from each roster, every round opens with the car held, a round already under way starts live, input numbering carries across rounds, poses say whether a car is running, and round messages that arrive before there is a world are harmless.

Replace `tests/client/session.test.ts` with:

<!-- op {"kind": "replace", "path": "tests/client/session.test.ts"} -->
```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ClientSession } from '../../src/client/net/session';
import type { CarInput } from '../../src/shared/input';
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

/** A snapshot of `sim`'s cars as the server would send it. */
function snapshotOf(sim: Simulation, over: Partial<Snapshot> = {}): Snapshot {
  return {
    epoch: 3,
    tick: 10,
    ackSeq: 0,
    cars: sim.slots.map((slot) => ({ slot, flags: SNAP_FLAG_ALIVE, hp: 100, state: sim.getState(slot), throttle: 0, steer: 0 })),
    ...over,
  };
}

describe('ClientSession in prediction mode', () => {
  it('predicts after the welcome, numbers inputs and counts the snapshots it applied', () => {
    const session = new ClientSession('predict');
    const w = world([0, 1]);
    session.onWelcome(0, 3);
    expect(session.mode).toBe('predict');
    expect(session.nextInput(straight())).toBe(1);
    expect(session.nextInput(straight())).toBe(2);
    session.onSnapshot(snapshotOf(w, { tick: 2, ackSeq: 0 }), 100);
    session.onSnapshot(snapshotOf(w, { tick: 4, ackSeq: 1 }), 133);
    expect(session.snapshotsReceived).toBe(2);
    expect(session.inputSequence).toBe(2);
    expect(session.poses(1, 1 / 60, 150).map((p) => [p.slot, p.visible])).toEqual([[0, true], [1, true]]);
    session.dispose();
  });

  it('starts a fresh world on a roster message and drops snapshots of the old one', () => {
    const session = new ClientSession('predict');
    const w = world([0, 1]);
    session.onWelcome(0, 3);
    session.onSnapshot(snapshotOf(w, { tick: 2 }), 100);
    session.onRoster(4, 0);
    expect(session.poses(1, 1 / 60, 120)).toEqual([]); // no world until the first snapshot of epoch 4
    session.onSnapshot(snapshotOf(w, { epoch: 3, tick: 4 }), 133); // stale epoch: dropped
    expect(session.snapshotsReceived).toBe(1);
    session.onSnapshot(snapshotOf(w, { epoch: 4, tick: 2 }), 150);
    expect(session.snapshotsReceived).toBe(2);
    session.dispose();
  });

  it('reports a stalled connection through the predictor', () => {
    const session = new ClientSession('predict');
    const w = world([0, 1]);
    session.onWelcome(0, 3);
    session.onSnapshot(snapshotOf(w, { tick: 2 }), 100);
    for (let i = 0; i < 300; i++) session.nextInput(straight());
    expect(session.stalled).toBe(false);
    session.onSnapshot(snapshotOf(w, { tick: 4, ackSeq: 0 }), 133);
    expect(session.stalled).toBe(true);
    session.dispose();
  });
});

describe('ClientSession stall notice', () => {
  it('reports the start of a stall once, and again after a recovery', () => {
    let stalls = 0;
    const session = new ClientSession('predict', { onStall: () => stalls++ });
    const w = world([0, 1]);
    session.onWelcome(0, 3);
    session.onSnapshot(snapshotOf(w, { tick: 2 }), 100);
    for (let i = 0; i < 300; i++) session.nextInput(straight());
    session.onSnapshot(snapshotOf(w, { tick: 4, ackSeq: 0 }), 133); // 300 unacknowledged inputs: the server is not hearing us
    session.onSnapshot(snapshotOf(w, { tick: 6, ackSeq: 0 }), 166); // still stalled: no second report
    expect(stalls).toBe(1);
    session.onSnapshot(snapshotOf(w, { tick: 8, ackSeq: 300 }), 200); // acknowledgements are back
    expect(session.stalled).toBe(false);
    for (let i = 0; i < 300; i++) session.nextInput(straight());
    session.onSnapshot(snapshotOf(w, { tick: 10, ackSeq: 300 }), 233); // dead again
    expect(stalls).toBe(2);
    session.dispose();
  });

  it('reports a stall again when a new world starts out stalled', () => {
    let stalls = 0;
    const session = new ClientSession('predict', { onStall: () => stalls++ });
    const w = world([0, 1]);
    session.onWelcome(0, 3);
    session.onSnapshot(snapshotOf(w, { tick: 2 }), 100);
    for (let i = 0; i < 300; i++) session.nextInput(straight());
    session.onSnapshot(snapshotOf(w, { tick: 4, ackSeq: 0 }), 133);
    expect(stalls).toBe(1);
    session.onRoster(4, 0); // a rebuild while the uplink is still dead: the new world's very first snapshot is stalled too
    session.onSnapshot(snapshotOf(w, { epoch: 4, tick: 2, ackSeq: 0 }), 250);
    expect(session.stalled).toBe(true);
    expect(stalls).toBe(2);
    session.dispose();
  });
});

describe('ClientSession across rounds', () => {
  it('learns its own slot from each roster, and holds the local car until the round is live', () => {
    const session = new ClientSession('predict');
    const w = world([0, 1]);
    session.onWelcome(-1, 3, null); // joined mid-round: watching
    expect(session.phase).toBeNull();
    session.onSnapshot(snapshotOf(w, { tick: 2 }), 100);
    expect(session.predicted!.mySlot).toBe(-1);
    expect(session.predicted!.predictor.hasLocalCar).toBe(false);

    session.onRoster(4, 1); // the next round: this player drives slot 1
    expect(session.predicted!.mySlot).toBe(1);
    expect(session.phase).toBe('countdown');
    expect(session.predicted!.predictor.isLive).toBe(false);
    session.onSnapshot(snapshotOf(w, { epoch: 4, tick: 2 }), 200);
    expect(session.predicted!.predictor.hasLocalCar).toBe(true);
    session.onPhase('live');
    expect(session.phase).toBe('live');
    expect(session.predicted!.predictor.isLive).toBe(true);
    session.onPhase('results');
    expect(session.predicted!.predictor.isLive).toBe(false);
    session.dispose();
  });

  it('holds the car again at the start of every round, even right after a live one', () => {
    const session = new ClientSession('predict');
    session.onWelcome(0, 3, 'live');
    expect(session.predicted!.predictor.isLive).toBe(true);
    session.onRoster(4, 0); // the next round opens with a countdown
    expect(session.predicted!.predictor.isLive).toBe(false);
    session.dispose();
  });

  it('copes with round messages that arrive before there is a world', () => {
    const session = new ClientSession('predict');
    expect(() => {
      session.onPhase('live');
      session.onRoster(2, 0);
      session.onPhase('countdown');
    }).not.toThrow();
    expect(session.phase).toBe('countdown');
    expect(session.predicted).toBeNull();
    expect(session.nextInput(straight())).toBe(1);
    session.dispose();
  });

  it('starts live when it joins a round that is already under way', () => {
    const session = new ClientSession('predict');
    session.onWelcome(0, 3, 'live');
    expect(session.predicted!.predictor.isLive).toBe(true);
    session.dispose();
    const counting = new ClientSession('predict');
    counting.onWelcome(0, 3, 'countdown');
    expect(counting.predicted!.predictor.isLive).toBe(false);
    counting.dispose();
  });

  it('keeps numbering inputs across rounds', () => {
    const session = new ClientSession('predict');
    session.onWelcome(0, 3, 'live');
    for (let i = 0; i < 50; i++) session.nextInput(straight());
    session.onRoster(4, 0);
    expect(session.nextInput(straight())).toBe(51);
    session.dispose();
  });

  it('says whether each car is running and how many hit points it has, in both modes', () => {
    const w = world([0, 1]);
    const snap = snapshotOf(w, { tick: 2 });
    snap.cars[1]!.flags = 0;
    snap.cars[1]!.hp = 0;
    snap.cars[0]!.hp = 61;
    const predicting = new ClientSession('predict');
    predicting.onWelcome(0, 3);
    predicting.onSnapshot(snap, 100);
    expect(predicting.poses(1, 1 / 60, 150).map((p) => [p.slot, p.alive, p.hp])).toEqual([[0, true, 61], [1, false, 0]]);
    predicting.dispose();
    const watching = new ClientSession('interp');
    watching.onWelcome(0, 3);
    watching.onSnapshot(snap, 100);
    watching.onSnapshot({ ...snap, tick: 4 }, 133);
    expect(watching.poses(1, 1 / 60, 300).map((p) => [p.slot, p.alive, p.hp])).toEqual([[0, true, 61], [1, false, 0]]);
  });
});

describe('ClientSession in interpolation mode', () => {
  it('numbers inputs itself and draws interpolated snapshots', () => {
    const session = new ClientSession('interp');
    const w = world([0, 1]);
    session.onWelcome(0, 3);
    expect(session.predicted).toBeNull();
    expect(session.nextInput(straight())).toBe(1);
    expect(session.nextInput(straight())).toBe(2);
    session.onSnapshot(snapshotOf(w, { tick: 2 }), 100);
    session.onSnapshot(snapshotOf(w, { tick: 4 }), 133);
    expect(session.snapshotsReceived).toBe(2);
    expect(session.poses(1, 1 / 60, 300).map((p) => p.slot)).toEqual([0, 1]);
    expect(session.stalled).toBe(false);
  });

  it('resets its buffer on a roster message', () => {
    const session = new ClientSession('interp');
    const w = world([0, 1]);
    session.onWelcome(0, 3);
    session.onSnapshot(snapshotOf(w, { tick: 2 }), 100);
    expect(session.interpolator.size).toBe(1);
    session.onRoster(4, 0);
    expect(session.interpolator.size).toBe(0);
  });
});

describe('ClientSession fallback', () => {
  it('falls back to interpolation when a local world cannot be built, and keeps the input sequence going', () => {
    let builds = 0;
    const reasons: string[] = [];
    const session = new ClientSession('predict', {
      world: {
        predictor: {
          createSimulation: (slots) => {
            if (++builds > 1) throw new Error('out of memory');
            return world(slots);
          },
        },
      },
      onFallback: (reason) => reasons.push(reason),
    });
    session.onWelcome(0, 3);
    session.onSnapshot(snapshotOf(world([0, 1]), { tick: 2 }), 100); // the first world builds fine
    let last = 0;
    for (let i = 0; i < 500; i++) last = session.nextInput(straight());
    expect(last).toBe(500);
    session.onSnapshot(snapshotOf(world([0, 1, 5]), { tick: 4, ackSeq: 490 }), 150); // a car it never had: needs a new world, which fails
    expect(session.mode).toBe('interp');
    expect(reasons).toEqual(['out of memory']);
    expect(session.predicted).toBeNull();
    // The next input must continue where the predictor stopped: the server drops every input that is not newer than
    // the last one it saw, so restarting at 1 would leave the player unable to drive.
    expect(session.nextInput(straight())).toBe(501);
    expect(session.nextInput(straight())).toBe(502);
    expect(session.interpolator.size).toBe(1); // the snapshot that triggered the fallback is already drawable
    expect(session.snapshotsReceived).toBe(2); // the applied first one plus the one handed to the interpolator
  });

  it('does not fall back for hostile snapshots, only for a world it cannot build', () => {
    const reasons: string[] = [];
    const session = new ClientSession('predict', { onFallback: (reason) => reasons.push(reason) });
    const w = world([0, 1]);
    session.onWelcome(0, 3);
    session.onSnapshot(snapshotOf(w, { tick: 2 }), 100);
    const nan = snapshotOf(w, { tick: 4 });
    nan.cars[0]!.state.pos.x = Number.NaN;
    session.onSnapshot(nan, 133);
    session.onSnapshot(snapshotOf(w, { tick: 6, cars: [] }), 166);
    expect(session.mode).toBe('predict');
    expect(reasons).toEqual([]);
    session.dispose();
  });
});
```

Car view and predicted world:

Create `tests/client/carView.test.ts`:

<!-- op {"kind": "create", "path": "tests/client/carView.test.ts"} -->
```ts
import { describe, expect, it } from 'vitest';
import { CarView, WRECK_COLOR } from '../../src/client/game/carView';

const bodyColor = (view: CarView): number => {
  const material = (view as unknown as { bodyMaterial: { color: { getHex(): number } } }).bodyMaterial;
  return material.color.getHex();
};

describe('CarView wreck look', () => {
  it('chars the body of a wreck and restores the paint for the next round', () => {
    const view = new CarView(0xd84a2b);
    expect(bodyColor(view)).toBe(0xd84a2b);
    view.setWreck(true);
    expect(bodyColor(view)).toBe(WRECK_COLOR);
    view.setWreck(true); // idempotent
    expect(bodyColor(view)).toBe(WRECK_COLOR);
    view.setWreck(false);
    expect(bodyColor(view)).toBe(0xd84a2b);
    view.dispose();
  });

  it('remembers a colour change made while the car is a wreck', () => {
    const view = new CarView(0x112233);
    view.setWreck(true);
    view.setColor(0x445566);
    expect(bodyColor(view)).toBe(WRECK_COLOR);
    view.setWreck(false);
    expect(bodyColor(view)).toBe(0x445566);
    view.dispose();
  });
});
```

In `tests/client/predictedWorld.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/predictedWorld.test.ts"} -->
```ts
import { Loopback, percentile } from '../helpers/loopback';
```

with:

```ts
import { PredictedWorld } from '../../src/client/net/predictedWorld';
import { Loopback, percentile } from '../helpers/loopback';
```

At the end of `tests/client/predictedWorld.test.ts` (inside the last `describe`), replace:

<!-- op {"kind": "edit", "path": "tests/client/predictedWorld.test.ts"} -->
```ts
    expect(s.resimStepsAvg).toBeGreaterThan(3);
  });
});
```

with:

```ts
    expect(s.resimStepsAvg).toBeGreaterThan(3);
  });

  it('follows the local slot from world to world, statistics included', () => {
    const world = new PredictedWorld(-1);
    world.beginWorld(1, 2);
    expect(world.mySlot).toBe(2);
    expect(world.stats.mySlot).toBe(2);
    world.beginWorld(2); // no slot given: unchanged
    expect(world.mySlot).toBe(2);
    world.dispose();
  });

  it('does not run ahead of the server during the countdown, when the server ignores the driver', () => {
    const l = loopback({ rules: { countdownTicks: 180 }, rttMs: 60, local: straight, remote: gentle });
    l.run(2.5);
    expect(l.results.filter((r) => r.outcome === 'applied').length).toBeGreaterThan(50);
    expect(Math.max(...l.localErrors())).toBeLessThan(0.05);
    l.run(4); // and once the round is live the car really drives, in step with the server
    const sim = l.serverSim!;
    expect(Math.hypot(sim.getState(0).linvel.x, sim.getState(0).linvel.z)).toBeGreaterThan(8);
    expect(percentile(l.localErrors(), 0.95)).toBeLessThan(0.03);
  });
});
```

The loopback harness (a real server room behind a simulated network) hands the new roster fields and the phase to the predicted world, and the session-room test does the same:

In `tests/helpers/loopback.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/helpers/loopback.ts"} -->
```ts
type Down = { kind: 'snapshot'; snapshot: Snapshot } | { kind: 'roster'; epoch: number };
```

with:

```ts
type Down = { kind: 'snapshot'; snapshot: Snapshot } | { kind: 'roster'; epoch: number; you: number } | { kind: 'phase'; live: boolean };
```

In `tests/helpers/loopback.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/helpers/loopback.ts"} -->
```ts
        const msg = JSON.parse(frame) as { t: string; epoch?: number };
        if (msg.t === 'roster') this.down.push(now, { kind: 'roster', epoch: msg.epoch! });
```

with:

```ts
        const msg = JSON.parse(frame) as { t: string; epoch?: number; you?: number; phase?: string };
        if (msg.t === 'roster') this.down.push(now, { kind: 'roster', epoch: msg.epoch!, you: msg.you! });
        else if (msg.t === 'phase') this.down.push(now, { kind: 'phase', live: msg.phase === 'live' });
```

In `tests/helpers/loopback.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/helpers/loopback.ts"} -->
```ts
      if (d.kind === 'roster') this.world.beginWorld(d.epoch);
```

with:

```ts
      if (d.kind === 'roster') {
        this.world.beginWorld(d.epoch, d.you);
        this.world.setLive(false);
      } else if (d.kind === 'phase') this.world.setLive(d.live);
```

In `tests/client/sessionRoom.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/sessionRoom.test.ts"} -->
```ts
          if (msg.t === 'roster') session.onRoster(msg.epoch!);
```

with:

```ts
          if (msg.t === 'roster') session.onRoster(msg.epoch!, (msg as { you?: number }).you ?? -1);
          else if (msg.t === 'phase') session.onPhase((msg as { phase?: 'countdown' | 'live' | 'results' }).phase!);
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/client`
Expected: FAIL — `setLive` / `onPhase` are not functions, `onRoster` ignores its second argument, `setWreck` is missing, and the type-checker would also complain (run `npm run typecheck` if you want to see it).

<!-- check {"cmd": "npx vitest run tests/client", "outcome": "fail"} -->

- [ ] **Step 3: Implement**

The predictor: a mutable local slot, a live flag, and the rule the server applies to the local car's input.

In `src/client/net/prediction.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/prediction.ts"} -->
```ts
import { NEUTRAL_INPUT, quantizeInput, type CarInput } from '../../shared/input';
```

with:

```ts
import { NEUTRAL_INPUT, PARKED_INPUT, quantizeInput, type CarInput } from '../../shared/input';
```

In `src/client/net/prediction.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/prediction.ts"} -->
```ts
  private synced = false;
  private stalled = false;
```

with:

```ts
  private synced = false;
  private live = true;
  private stalled = false;
```

In `src/client/net/prediction.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/prediction.ts"} -->
```ts
  constructor(
    readonly mySlot: number,
    options: PredictorOptions = {},
  ) {
```

with:

```ts
  constructor(
    /** The slot of the local car in the current world (-1: none, the player is watching). Changes with every round. */
    public mySlot: number,
    options: PredictorOptions = {},
  ) {
```

In `src/client/net/prediction.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/prediction.ts"} -->
```ts
    return this.sim !== null && this.sim.slots.includes(this.mySlot);
  }

  /**
   * Starts accepting snapshots for a new world. The world itself is built from the first snapshot (it lists exactly
   * the cars the server simulates). Inputs not yet acknowledged are kept so they can be replayed.
   */
  beginWorld(epoch: number): void {
    this.epoch = epoch & 0xff;
```

with:

```ts
    return this.sim !== null && this.sim.slots.includes(this.mySlot);
  }

  /** False while the server ignores the driver's input (countdown, results): the local car is then held still like the server's. */
  setLive(live: boolean): void {
    this.live = live;
  }

  get isLive(): boolean {
    return this.live;
  }

  /**
   * Starts accepting snapshots for a new world, in which the local car has slot `mySlot` (default: unchanged, -1 = none).
   * The world itself is built from the first snapshot (it lists exactly the cars the server simulates). Inputs not yet
   * acknowledged are kept so they can be replayed, and the input numbering carries on.
   */
  beginWorld(epoch: number, mySlot: number = this.mySlot): void {
    this.mySlot = mySlot;
    this.epoch = epoch & 0xff;
```

In `src/client/net/prediction.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/prediction.ts"} -->
```ts
  private simulate(localInput: CarInput): void {
    const sim = this.sim!;
    if (sim.slots.includes(this.mySlot)) sim.setInput(this.mySlot, localInput);
```

with:

```ts
  /** What the server does with the driver's input: nothing while the round is not live or once the car is wrecked. */
  private appliedLocal(input: CarInput): CarInput {
    const alive = ((this.meta.get(this.mySlot)?.flags ?? SNAP_FLAG_ALIVE) & SNAP_FLAG_ALIVE) !== 0;
    return this.live && alive ? input : PARKED_INPUT;
  }

  private simulate(localInput: CarInput): void {
    const sim = this.sim!;
    if (sim.slots.includes(this.mySlot)) sim.setInput(this.mySlot, this.appliedLocal(localInput));
```

In `src/client/net/netStats.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/net/netStats.ts"} -->
```ts
    private readonly mySlot: number,
```

with:

```ts
    public mySlot: number,
```

Replace `src/client/net/predictedWorld.ts` with:

<!-- op {"kind": "replace", "path": "src/client/net/predictedWorld.ts"} -->
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
    mySlot: number,
    options: PredictedWorldOptions = {},
  ) {
    this.predictor = new Predictor(mySlot, options.predictor);
    this.smoother = new ErrorSmoother(options.tauSeconds, options.snapDistance);
    this.stats = new NetStats(mySlot);
    this.smoothing = options.smoothing ?? true;
  }

  /** Slot of the local car in the current world (-1: watching). */
  get mySlot(): number {
    return this.predictor.mySlot;
  }

  /** Non-null when prediction cannot run at all (see Predictor.failure); the caller should fall back to interpolation. */
  get failure(): string | null {
    return this.predictor.failure;
  }

  /** A new world (welcome or roster message), in which the local car has slot `mySlot`: forget predictions and pending corrections. */
  beginWorld(epoch: number, mySlot: number = this.mySlot): void {
    this.predictor.beginWorld(epoch, mySlot);
    this.stats.mySlot = mySlot;
    this.smoother.clear();
  }

  /** Whether the server is applying the driver's input (false in the countdown and the results). */
  setLive(live: boolean): void {
    this.predictor.setLive(live);
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

Replace `src/client/net/session.ts` with:

<!-- op {"kind": "replace", "path": "src/client/net/session.ts"} -->
```ts
import type { CarInput } from '../../shared/input';
import { SNAP_FLAG_ALIVE, type Phase, type Snapshot } from '../../shared/protocol';
import type { Quat, Vec3 } from '../../shared/types';
import { SnapshotInterpolator } from './interp';
import { PredictedWorld, type PredictedWorldOptions } from './predictedWorld';

export type NetMode = 'predict' | 'interp';

/** One car as drawn this frame, whichever networking mode produced it. */
export interface DrawPose {
  slot: number;
  pos: Vec3;
  quat: Quat;
  linvel: Vec3;
  steer: number;
  visible: boolean;
  extrapolated: boolean;
  /** False for a wreck. */
  alive: boolean;
  hp: number;
}

export interface ClientSessionOptions {
  world?: PredictedWorldOptions;
  /** Called once when prediction gives up and the session switches to interpolation; `reason` is for the log. */
  onFallback?(reason: string): void;
  /** Called each time the connection becomes stalled (the server stopped acknowledging our inputs), not while it stays so. */
  onStall?(): void;
}

/**
 * The client's networking state without a DOM: numbers local inputs, feeds snapshots to the predicted world (or to the
 * interpolator in `?net=interp` mode) and switches from the former to the latter if the local simulation cannot run.
 * `GameClient` owns the socket, the scene and the HUD and delegates everything else here, so this is testable in Node.
 */
export class ClientSession {
  readonly interpolator = new SnapshotInterpolator();
  private world: PredictedWorld | null = null;
  private current: NetMode;
  private epoch = 0;
  private seq = 0;
  private received = 0;
  private wasStalled = false;
  private currentPhase: Phase | null = null;

  constructor(
    mode: NetMode,
    private readonly options: ClientSessionOptions = {},
  ) {
    this.current = mode;
  }

  get mode(): NetMode {
    return this.current;
  }

  /** The prediction machinery; null in interpolation mode. */
  get predicted(): PredictedWorld | null {
    return this.world;
  }

  /** Snapshots that were used (applied to the local world or buffered for interpolation). */
  get snapshotsReceived(): number {
    return this.received;
  }

  /** Sequence number of the newest input, in either mode. */
  get inputSequence(): number {
    return this.world ? this.world.predictor.sequence : this.seq;
  }

  /** Where the round is (countdown, live, results), as far as the server has told us. */
  get phase(): Phase | null {
    return this.currentPhase;
  }

  /** True while the server is not acknowledging our inputs (dead or badly delayed uplink). */
  get stalled(): boolean {
    return this.world?.predictor.isStalled ?? false;
  }

  /** `slot` is the local car's slot in the running round, or -1 while the player is watching. */
  onWelcome(slot: number, epoch: number, phase: Phase | null = null): void {
    this.epoch = epoch;
    this.currentPhase = phase;
    this.interpolator.reset(epoch);
    if (this.current === 'predict') {
      this.world?.dispose();
      this.world = new PredictedWorld(slot, this.options.world);
      this.world.beginWorld(epoch);
      this.world.setLive(phase === 'live');
    }
  }

  /** A new round's world: every buffered or predicted state belongs to the old one, and the local car may have a new slot. */
  onRoster(epoch: number, you: number): void {
    this.epoch = epoch;
    this.wasStalled = false;
    this.currentPhase = 'countdown'; // a roster always opens with the countdown; the phase message repeats it
    this.interpolator.reset(epoch);
    this.world?.beginWorld(epoch, you);
    this.world?.setLive(false);
  }

  onPhase(phase: Phase): void {
    this.currentPhase = phase;
    this.world?.setLive(phase === 'live');
  }

  /** One local 60 Hz tick: returns the sequence number to send with `input`. */
  nextInput(input: CarInput): number {
    if (this.world) return this.world.step(input);
    this.seq = (this.seq + 1) >>> 0;
    return this.seq;
  }

  onSnapshot(snapshot: Snapshot, arrivalMs: number): void {
    if (!this.world) {
      if (this.interpolator.push(snapshot, arrivalMs)) this.received++;
      return;
    }
    const { outcome } = this.world.onSnapshot(snapshot, arrivalMs);
    if (this.world.failure !== null) {
      this.fallBack(this.world.failure, snapshot, arrivalMs);
      return;
    }
    if (outcome === 'applied' || outcome === 'synced') this.received++;
    const stalled = this.world.predictor.isStalled;
    if (stalled && !this.wasStalled) this.options.onStall?.();
    this.wasStalled = stalled;
  }

  /** Poses to draw this frame. `alpha` is the fraction of the way to the next fixed step, `nowMs` the frame's clock. */
  poses(alpha: number, dtSeconds: number, nowMs: number): DrawPose[] {
    if (this.world) {
      return this.world.frame(alpha, dtSeconds).map((p) => ({
        slot: p.slot,
        pos: p.pos,
        quat: p.quat,
        linvel: p.linvel,
        steer: p.steer,
        visible: p.visible,
        extrapolated: false,
        alive: (p.flags & SNAP_FLAG_ALIVE) !== 0,
        hp: p.hp,
      }));
    }
    return this.interpolator.sample(nowMs).map((p) => ({
      slot: p.slot,
      pos: p.state.pos,
      quat: p.state.quat,
      linvel: p.state.linvel,
      steer: p.steer,
      visible: true,
      extrapolated: p.extrapolated,
      alive: (p.flags & SNAP_FLAG_ALIVE) !== 0,
      hp: p.hp,
    }));
  }

  dispose(): void {
    this.world?.dispose();
    this.world = null;
  }

  private fallBack(reason: string, snapshot: Snapshot, arrivalMs: number): void {
    // The server drops every input that is not newer than the newest one it has seen, so numbering must go on from
    // where the predictor stopped; restarting at 1 would leave the player unable to steer until the count caught up.
    this.seq = this.world!.predictor.sequence;
    this.world!.dispose();
    this.world = null;
    this.current = 'interp';
    this.interpolator.reset(this.epoch);
    if (this.interpolator.push(snapshot, arrivalMs)) this.received++;
    this.options.onFallback?.(reason);
  }
}
```

The car view: a charred body for a wreck.

In `src/client/game/carView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/carView.ts"} -->
```ts
const REST_SUSPENSION = 0.374; // measured settled suspension length
```

with:

```ts
const REST_SUSPENSION = 0.374; // measured settled suspension length
/** Body colour of a car that is out of the round. */
export const WRECK_COLOR = 0x2a2b2e;
```

In `src/client/game/carView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/carView.ts"} -->
```ts
  private readonly disposables: Array<{ dispose(): void }> = [];
```

with:

```ts
  private readonly disposables: Array<{ dispose(): void }> = [];
  private paint: number;
  private wrecked = false;
```

In `src/client/game/carView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/carView.ts"} -->
```ts
  constructor(color: number) {
```

with:

```ts
  constructor(color: number) {
    this.paint = color;
```

In `src/client/game/carView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/carView.ts"} -->
```ts
  setColor(color: number): void {
    this.bodyMaterial.color.setHex(color);
  }
```

with:

```ts
  setColor(color: number): void {
    this.paint = color;
    if (!this.wrecked) this.bodyMaterial.color.setHex(color);
  }

  /** A wreck is charred; it gets its paint back when the next round starts. */
  setWreck(wrecked: boolean): void {
    if (wrecked === this.wrecked) return;
    this.wrecked = wrecked;
    this.bodyMaterial.color.setHex(wrecked ? WRECK_COLOR : this.paint);
  }
```

The game client: the slot and the phase come from the server, the camera restarts with each round and follows another car while yours is out or you have none, wrecks are drawn charred, and the debug hook reports the phase and each car's HP.

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
        this.session.onWelcome(m.you, m.epoch);
```

with:

```ts
        this.session.onWelcome(m.you, m.epoch, m.phase?.phase ?? null);
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
        this.session.onRoster(m.epoch); // a new world: drop everything buffered or predicted
```

with:

```ts
        this.mySlot = m.you; // slots are per round
        this.session.onRoster(m.epoch, m.you); // a new world: drop everything buffered or predicted
        this.chase.reset(); // and start the camera at the new spawn
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
      case 'error':
```

with:

```ts
      case 'phase':
        this.session.onPhase(m.phase);
        break;
      case 'error':
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
      view.setPose(p.pos, p.quat);
```

with:

```ts
      view.setPose(p.pos, p.quat);
      view.setWreck(!p.alive);
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
    const me = poses.find((p) => p.slot === this.mySlot && p.visible);
    if (me) {
      this.chase.update(this.opts.gs.camera, { pos: me.pos, quat: me.quat, speed: vlen(me.linvel) }, dt);
    }
```

with:

```ts
    // follow your own car; when it is a wreck, or you have no car this round, follow the first car still running
    const mine = poses.find((p) => p.slot === this.mySlot && p.visible);
    const watched = mine?.alive ? mine : (poses.find((p) => p.visible && p.alive && p.slot !== this.mySlot) ?? mine);
    if (watched) {
      this.chase.update(this.opts.gs.camera, { pos: watched.pos, quat: watched.quat, speed: vlen(watched.linvel) }, dt);
    }
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
      mode: this.session.mode,
```

with:

```ts
      mode: this.session.mode,
      phase: this.session.phase,
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
        extrapolated: p.extrapolated,
        visible: p.visible,
```

with:

```ts
        extrapolated: p.extrapolated,
        visible: p.visible,
        alive: p.alive,
        hp: p.hp,
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/client && npm run typecheck && npm test`
Expected: PASS — the client tests, the type-check, then the whole suite (377 tests).

<!-- check {"cmd": "npx vitest run tests/client && npm run typecheck && npm test", "outcome": "pass", "tests": 377} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(client): follow rounds \u2014 local slot from the roster, the car held while the server holds it, wrecks drawn charred"
```

<!-- commit "feat(client): follow rounds \u2014 local slot from the roster, the car held while the server holds it, wrecks drawn charred" -->

---

### Task 30: Combat in the room

**Files:**
- Replace: `src/server/round.ts` (adds `RoundState.step`)
- Modify: `src/server/room.ts` (call it every live tick and broadcast the results)
- Test: `tests/server/roundCombat.test.ts`, `tests/server/roomCombat.test.ts`; additions to `tests/helpers/loopback.ts` and `tests/client/predictedWorld.test.ts`

**Interfaces:**
- Consumes: `Simulation.contacts` (Task 23), `HitTracker`, `AttackLog` (Task 24), `CarWatch` (Task 25), `RoundState` and the room (Task 28), the client that holds wrecks still (Task 29).
- Produces: `RoundState.step(tick, sim): {hits: HitMessage[], kos: KoMessage[]}`; the room broadcasts `hit`, `ko` and, at most four times a second, `scores`; HP and the alive flag in every snapshot; rounds that end by elimination.

- [ ] **Step 1: Write the failing tests**

`roundCombat.test.ts` drives a `RoundState` on the real simulation: a head-on becomes a hit on each car with points for the damage dealt, walls hurt less and give no points, damage is capped at the HP left and ignores wrecks, a car at 0 HP is out with its killer and assists credited, a wall kill goes to the last car that hit the victim, a hurt player who disconnects is nobody's kill, and flipping, sitting still, leaving the arena and the anti-stall drain each eliminate a car. `roomCombat.test.ts` stages the same at room level, with spectators listening, and runs a whole round with a driving human and three bots.

Create `tests/server/roundCombat.test.ts`:

<!-- op {"kind": "create", "path": "tests/server/roundCombat.test.ts"} -->
```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { COMBAT } from '../../src/shared/constants';
import { quatFromYaw } from '../../src/shared/math';
import { initPhysics } from '../../src/shared/physics';
import type { HitMessage, KoMessage } from '../../src/shared/protocol';
import { Simulation } from '../../src/shared/sim';
import type { CarState } from '../../src/shared/types';
import { RoundState, type StepEvents } from '../../src/server/round';

beforeAll(async () => {
  await initPhysics();
});

const sims: Simulation[] = [];
afterEach(() => {
  while (sims.length) sims.pop()!.dispose();
});

const still = (x: number, z: number, yaw = 0, speed = 0): CarState => ({
  pos: { x, y: 1.07, z },
  quat: quatFromYaw(yaw),
  linvel: { x: Math.cos(yaw) * speed, y: 0, z: -Math.sin(yaw) * speed },
  angvel: { x: 0, y: 0, z: 0 },
});

/** A round of `slots.length` cars, with a helper that runs it and collects every event. */
function setup(slots: number[], place?: (sim: Simulation) => void) {
  const sim = new Simulation(slots);
  sims.push(sim);
  place?.(sim);
  const state = new RoundState(slots);
  const hits: HitMessage[] = [];
  const kos: KoMessage[] = [];
  const run = (ticks: number, each?: (tick: number) => void): StepEvents => {
    const last: StepEvents = { hits: [], kos: [] };
    for (let t = 0; t < ticks; t++) {
      each?.(sim.tick);
      sim.step();
      const events = state.step(sim.tick, sim);
      hits.push(...events.hits);
      kos.push(...events.kos);
    }
    return last;
  };
  return { sim, state, hits, kos, run };
}

const headOn = (sim: Simulation): void => {
  sim.setState(0, still(-9, 0, 0, 10));
  sim.setState(1, still(9, 0, Math.PI, 10));
};

describe('RoundState.step: impacts', () => {
  it('turns a head-on collision into a hit on each car, HP off, and points for the damage dealt', () => {
    const { state, hits, run } = setup([0, 1], headOn);
    run(90);
    expect(hits).toHaveLength(2);
    for (const h of hits) {
      expect(h.zone).toBe('front');
      expect(h.attacker).toBe(h.victim === 0 ? 1 : 0);
      expect(h.dmg).toBeGreaterThan(22);
      expect(h.dmg).toBeLessThan(29);
      expect(h.hp).toBeCloseTo(100 - h.dmg, 1);
      expect(h.j).toBeGreaterThan(17);
      expect(h.p[0]).toBeGreaterThan(2); // the front face of the car that was hit
    }
    for (const slot of [0, 1]) {
      const car = state.status.get(slot)!;
      expect(car.hp).toBeCloseTo(100 - hits.find((h) => h.victim === slot)!.dmg, 0);
      expect(car.damage).toBeCloseTo(hits.find((h) => h.attacker === slot)!.dmg, 0); // dealt what the other lost
      expect(car.gained).toBeCloseTo(car.damage * COMBAT.POINTS_PER_HP, 9);
    }
  });

  it('hurts less against a wall, gives the wall no points, and reports attacker -1', () => {
    const { state, hits, run } = setup([0], (sim) => sim.setState(0, still(25, 0, 0, 15)));
    run(150);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.attacker).toBe(-1);
    expect(hits[0]!.dmg).toBeGreaterThan(15);
    expect(hits[0]!.dmg).toBeLessThan(28);
    expect(state.status.get(0)!.gained).toBe(0);
  });

  it('does not take more HP than a car has left, nor credit more damage than was done', () => {
    const { state, hits, run } = setup([0, 1], headOn);
    state.status.get(1)!.hp = 5;
    run(90);
    expect(hits.find((h) => h.victim === 1)!.dmg).toBe(5);
    expect(state.status.get(0)!.damage).toBeCloseTo(5, 9);
  });

  it('ignores hits on a wreck', () => {
    const { state, hits, kos, run } = setup([0, 1], headOn);
    state.eliminate(1, 'disconnected', 0);
    run(90);
    expect(hits.map((h) => h.victim)).toEqual([0]); // the wreck still hits back, but is not hurt
    expect(kos).toHaveLength(0);
    expect(state.status.get(1)!.hp).toBe(0);
  });
});

describe('RoundState.step: eliminations', () => {
  it('eliminates a car whose HP runs out, credits the killer with the points, and lists assists', () => {
    const { state, hits, kos, run } = setup([0, 1, 2], (sim) => {
      sim.setState(0, still(-9, 0, 0, 10));
      sim.setState(1, still(9, 0, Math.PI, 10));
      sim.setState(2, still(0, 30, 0, 0));
    });
    state.status.get(1)!.hp = 8;
    // car 2 hit car 1 a moment ago: it should come out as an assist
    (state as unknown as { log: { record(v: number, a: number, t: number): void } }).log.record(1, 2, 0);
    run(90);
    expect(kos).toHaveLength(1);
    expect(kos[0]).toMatchObject({ victim: 1, killer: 0, assists: [2], reason: 'damage' });
    expect(state.isAlive(1)).toBe(false);
    expect(state.status.get(0)!.kills).toBe(1);
    expect(state.status.get(0)!.gained).toBeCloseTo(8 + COMBAT.KILL_POINTS, 6);
    expect(hits.find((h) => h.victim === 1)!.hp).toBe(0);
  });

  it('gives nobody the kill when a player who was hit a moment ago disconnects', () => {
    const { state } = setup([0, 1]);
    (state as unknown as { log: { record(v: number, a: number, t: number): void } }).log.record(0, 1, 5);
    expect(state.eliminate(0, 'disconnected', 10)).toMatchObject({ victim: 0, killer: -1, assists: [], reason: 'disconnected' });
    expect(state.status.get(1)!.kills).toBe(0);
    expect(state.status.get(1)!.gained).toBe(0);
  });

  it('credits a wall kill to the car that hit the victim last, if that was recent', () => {
    const { state, kos, run } = setup([0, 1], (sim) => {
      sim.setState(0, still(25, 0, 0, 15)); // into the wall
      sim.setState(1, still(-30, 30, 0, 0));
    });
    state.status.get(0)!.hp = 10;
    (state as unknown as { log: { record(v: number, a: number, t: number): void } }).log.record(0, 1, 0);
    run(150);
    expect(kos).toMatchObject([{ victim: 0, killer: 1, assists: [], reason: 'damage' }]);
    expect(state.status.get(1)!.kills).toBe(1);
  });

  it('eliminates a car that stays on its roof for three seconds', () => {
    const { kos, run } = setup([0], (sim) =>
      sim.setState(0, { ...still(0, 0), pos: { x: 0, y: 0.7, z: 0 }, quat: { x: 1, y: 0, z: 0, w: 0 } }),
    );
    run(COMBAT.FLIP_TICKS + 30);
    expect(kos).toMatchObject([{ victim: 0, killer: -1, reason: 'flipped' }]);
    expect(kos[0]!.tick).toBeGreaterThanOrEqual(COMBAT.FLIP_TICKS);
    expect(kos[0]!.tick).toBeLessThan(COMBAT.FLIP_TICKS + 5);
  });

  it('eliminates a car that does not move for eight seconds', () => {
    const { kos, run } = setup([0, 1], (sim) => {
      sim.setState(0, still(-20, 0));
      sim.setState(1, still(20, 0));
    });
    run(COMBAT.IMMOBILE_TICKS + 10);
    expect(kos.map((k) => [k.victim, k.reason])).toEqual([[0, 'stuck'], [1, 'stuck']]);
  });

  it('eliminates a car that leaves the arena', () => {
    const { kos, run } = setup([0], (sim) => sim.setState(0, still(60, 0, 0, 0)));
    run(3);
    expect(kos).toMatchObject([{ victim: 0, reason: 'bounds' }]);
  });

  it('drains a car that avoids every fight, and eliminates it when the HP is gone', () => {
    const { state, kos } = setup([0]);
    // drive the anti-stall rule directly: a car that keeps moving but is never in a hit
    const roll = still(0, 0, 0, 8);
    const fake = { getState: () => roll, contacts: () => [] } as unknown as Simulation;
    let tick = 0;
    for (; tick < COMBAT.STALL_TICKS - 1; tick++) state.step(tick, fake); // 19.98 s without a hit: not yet
    expect(state.hpOf(0)).toBe(100);
    for (let t = 0; t < 60; t++) state.step(++tick, fake); // one second of draining
    expect(state.hpOf(0)).toBeCloseTo(100 - 2, 6);
    const events: KoMessage[] = [];
    for (let t = 0; t < 60 * 60; t++) events.push(...state.step(++tick, fake).kos);
    expect(events).toMatchObject([{ victim: 0, killer: -1, assists: [], reason: 'stall' }]);
    expect(kos).toHaveLength(0);
    expect(state.isAlive(0)).toBe(false);
  });
});
```

Create `tests/server/roomCombat.test.ts`:

<!-- op {"kind": "create", "path": "tests/server/roomCombat.test.ts"} -->
```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { COMBAT } from '../../src/shared/constants';
import { quatFromYaw } from '../../src/shared/math';
import { initPhysics } from '../../src/shared/physics';
import type { CarState } from '../../src/shared/types';
import type { Room } from '../../src/server/room';
import type { RoundState } from '../../src/server/round';
import { disposeRooms, join, makeRoom, messages, serverSim, snapshots, steps } from '../helpers/roomKit';

beforeAll(async () => {
  await initPhysics();
});
afterEach(disposeRooms);

const car = (x: number, z: number, yaw = 0, speed = 0): CarState => ({
  pos: { x, y: 1.07, z },
  quat: quatFromYaw(yaw),
  linvel: { x: Math.cos(yaw) * speed, y: 0, z: -Math.sin(yaw) * speed },
  angvel: { x: 0, y: 0, z: 0 },
});
const headOn = (room: Room, a = 0, b = 1): void => {
  serverSim(room).setState(a, car(-9, 0, 0, 10));
  serverSim(room).setState(b, car(9, 0, Math.PI, 10));
};
const roundState = (room: Room): RoundState => Reflect.get(room, 'state') as RoundState;

/** Two humans, Ann and Bob, already in the live phase of round 1. */
function duel(options: Parameters<typeof makeRoom>[0] = {}) {
  const { room } = makeRoom(options);
  const a = join(room, 'Ann');
  const b = join(room, 'Bob');
  steps(room, 6);
  expect(room.phase).toBe('live');
  return { room, a, b };
}

describe('Room combat', () => {
  it('damages both cars in a head-on collision and tells everyone, spectators included', () => {
    const { room, a, b } = duel();
    const late = join(room, 'Cy');
    headOn(room);
    steps(room, 90);
    for (const who of [a, b, late]) {
      const hits = messages(who.socket, 'hit');
      expect(hits).toHaveLength(2);
      expect(hits.map((h) => [h.victim, h.attacker, h.zone])).toEqual([[0, 1, 'front'], [1, 0, 'front']]);
      expect(hits[0]!.dmg as number).toBeGreaterThan(22);
    }
    const last = snapshots(a.socket).at(-1)!;
    for (const c of last.cars) {
      expect(c.hp).toBeGreaterThan(70);
      expect(c.hp).toBeLessThan(80);
    }
    expect(roundState(room).aliveSlots()).toEqual([0, 1]);
  });

  it('shows a car with a sliver of HP as 1 and a wreck as 0, never a running car at 0', () => {
    const { room, a } = duel();
    roundState(room).status.get(0)!.hp = 0.3;
    steps(room, 4);
    const cars = snapshots(a.socket).at(-1)!.cars;
    expect(cars.find((c) => c.slot === 0)!.hp).toBe(1);
    expect(cars.find((c) => c.slot === 1)!.hp).toBe(100);
    roundState(room).eliminate(0, 'flipped', 10);
    steps(room, 4);
    expect(snapshots(a.socket).at(-1)!.cars.find((c) => c.slot === 0)!.hp).toBe(0);
  });

  it('scores 1 point per HP of damage dealt and shares the running scores', () => {
    const { room, a } = duel();
    headOn(room);
    steps(room, 90);
    const rows = (messages(a.socket, 'scores').at(-1)!.rows as Array<{ slot: number; score: number; kills: number }>);
    expect(rows.map((r) => r.slot)).toEqual([0, 1]);
    for (const r of rows) {
      expect(r.score).toBeGreaterThan(22);
      expect(r.score).toBeLessThan(29);
      expect(r.kills).toBe(0);
    }
  });

  it('does not send scores more often than four times a second', () => {
    const { room, a } = duel();
    headOn(room);
    const before = messages(a.socket, 'scores').length;
    steps(room, 120);
    expect(messages(a.socket, 'scores').length - before).toBeLessThanOrEqual(3);
  });

  it('eliminates a car whose HP runs out: ko for everyone, a wreck in the snapshots, and the round goes to the last car', () => {
    const { room, a, b } = duel({ rules: { resultsTicks: 600 } });
    roundState(room).status.get(1)!.hp = 5;
    headOn(room);
    steps(room, 90);
    const [ko] = messages(a.socket, 'ko');
    expect(ko).toMatchObject({ victim: 1, killer: 0, assists: [], reason: 'damage' });
    expect(messages(b.socket, 'ko')).toHaveLength(1);
    expect(room.phase).toBe('results');
    const [results] = messages(a.socket, 'results');
    expect(results).toMatchObject({ round: 1, winner: 0, reason: 'last' });
    const rows = results!.rows as Array<Record<string, number>>;
    expect(rows[0]).toMatchObject({ slot: 0, kills: 1, damage: 5, alive: true });
    expect(rows[0]!.gained).toBeCloseTo(5 + COMBAT.KILL_POINTS + COMBAT.WIN_POINTS, 0); // damage + kill + win
    expect(rows[1]).toMatchObject({ slot: 1, kills: 0, alive: false, hp: 0 });
    expect(rows[1]!.gained).toBeGreaterThan(22); // the wreck still earned the damage it dealt before it went
    const wreck = snapshots(a.socket).at(-1)!.cars.find((c) => c.slot === 1)!;
    expect(wreck.flags & 1).toBe(0);
    expect(wreck.hp).toBe(0);
  });

  it('carries points from one round to the next', () => {
    const { room, a } = duel({ rules: { resultsTicks: 10 } });
    roundState(room).status.get(1)!.hp = 5;
    headOn(room);
    steps(room, 90);
    const scoreOfAnn = (messages(a.socket, 'results')[0]!.rows as Array<Record<string, number>>)[0]!.score!;
    expect(scoreOfAnn).toBeGreaterThan(150);
    steps(room, 30);
    expect(room.round).toBe(2);
    expect(messages(a.socket, 'scores').at(-1)!.rows).toMatchObject([{ slot: 0, score: scoreOfAnn, kills: 1 }, { slot: 1 }]);
  });

  it('ends the round when every human is out even though bots are still running', () => {
    const { room } = makeRoom({ botFill: 4 });
    const a = join(room, 'Ann');
    steps(room, 6);
    const state = roundState(room);
    state.status.get(1)!.hp = 90;
    state.status.get(2)!.hp = 100;
    state.status.get(3)!.hp = 80;
    state.eliminate(0, 'flipped', 10);
    steps(room, 1);
    const [results] = messages(a.socket, 'results');
    expect(results).toMatchObject({ winner: 2, reason: 'no_humans' });
    expect((results!.rows as Array<Record<string, unknown>>).map((r) => r.bot)).toEqual([false, true, true, true]);
    expect(room.phase).toBe('results');
  });

  it('calls it a draw when every car goes out on the same tick', () => {
    const { room, a } = duel();
    steps(room, COMBAT.IMMOBILE_TICKS + 5); // neither player moves: both are eliminated as stuck
    const kos = messages(a.socket, 'ko');
    expect(kos.map((k) => [k.victim, k.reason])).toEqual([[0, 'stuck'], [1, 'stuck']]);
    expect(messages(a.socket, 'results')[0]).toMatchObject({ winner: -1, reason: 'draw' });
  });

  it('does not hurt anybody outside the live phase', () => {
    const { room } = makeRoom({ rules: { countdownTicks: 200 } });
    const a = join(room);
    join(room);
    steps(room, 5);
    expect(room.phase).toBe('countdown');
    headOn(room);
    steps(room, 90);
    expect(messages(a.socket, 'hit')).toHaveLength(0);
    expect(roundState(room).aliveSlots()).toEqual([0, 1]);
  });

  it('runs a whole round with a driving human and three bots: bots chase and hit, and the round ends', () => {
    const { room } = makeRoom({ botFill: 4, seed: 3, rules: { liveTicks: 3600, resultsTicks: 60 } });
    const human = join(room, 'Ann');
    let seq = 0;
    for (let t = 0; t < 3700; t++) {
      // circle the middle of the arena at speed
      human.player.pushInput(++seq, { throttle: 0.8, steer: 0.35, handbrake: false });
      room.step();
      if (room.phase === 'results') break;
    }
    expect(room.phase).toBe('results');
    const hits = messages(human.socket, 'hit');
    expect(hits.length).toBeGreaterThan(2);
    expect(hits.some((h) => (h.attacker as number) >= 1)).toBe(true); // a bot hit somebody
    const [results] = messages(human.socket, 'results');
    expect(results!.rows as unknown[]).toHaveLength(4);
    expect(['last', 'timeout', 'no_humans', 'draw']).toContain(results!.reason);
    for (const r of snapshots(human.socket).at(-1)!.cars) expect(Number.isFinite(r.state.pos.x)).toBe(true);
  });
});
```

The loopback harness can reach the room's round bookkeeping, and the predicted world is shown to stop driving a car the server has wrecked:

In `tests/helpers/loopback.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/helpers/loopback.ts"} -->
```ts
import { Room, type RoomRules } from '../../src/server/room';
```

with:

```ts
import { Room, type RoomRules } from '../../src/server/room';
import type { RoundState } from '../../src/server/round';
```

In `tests/helpers/loopback.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/helpers/loopback.ts"} -->
```ts
  serverState(slot: number): CarState {
    return this.serverSim!.getState(slot);
  }
```

with:

```ts
  serverState(slot: number): CarState {
    return this.serverSim!.getState(slot);
  }

  /** The room's bookkeeping for the running round (hit points, who is out). */
  get round(): RoundState {
    return Reflect.get(this.room, 'state') as RoundState;
  }
```

At the end of `tests/client/predictedWorld.test.ts` (inside the last `describe`), replace:

<!-- op {"kind": "edit", "path": "tests/client/predictedWorld.test.ts"} -->
```ts
    expect(percentile(l.localErrors(), 0.95)).toBeLessThan(0.03);
  });
});
```

with:

```ts
    expect(percentile(l.localErrors(), 0.95)).toBeLessThan(0.03);
  });

  it('stops driving a car the server has taken out of the round', () => {
    const l = loopback({ rttMs: 60, local: straight, remote: gentle });
    l.run(3);
    const sim = l.serverSim!;
    const speed = (): number => Math.hypot(sim.getState(0).linvel.x, sim.getState(0).linvel.z);
    const before = speed();
    l.round.eliminate(0, 'flipped', 0); // the server wrecks the local car
    l.run(4);
    const server = sim.getState(0).pos;
    const drawn = l.frames.at(-1)!.find((p) => p.slot === 0)!;
    expect(Math.hypot(drawn.pos.x - server.x, drawn.pos.z - server.z)).toBeLessThan(0.5); // the client agrees about where the wreck is
    expect(speed()).toBeLessThan(before * 0.6); // handbrake on and no engine: it slows down instead of driving on
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/server/roundCombat.test.ts tests/server/roomCombat.test.ts tests/client/predictedWorld.test.ts`
Expected: FAIL — `state.step is not a function` in the round tests; the room tests see no `hit`, `ko` or elimination messages; the wreck test in `predictedWorld.test.ts` fails because the harness has no `round`.

<!-- check {"cmd": "npx vitest run tests/server/roundCombat.test.ts tests/server/roomCombat.test.ts tests/client/predictedWorld.test.ts", "outcome": "fail"} -->

- [ ] **Step 3: Implement**

`RoundState` gains its combat step (impacts become damage and points; the elimination rules run; every elimination names its killer and assists):

Replace `src/server/round.ts` with:

<!-- op {"kind": "replace", "path": "src/server/round.ts"} -->
```ts
import { COMBAT } from '../shared/constants';
import type { HitMessage, KoMessage, KoReason } from '../shared/protocol';
import type { Simulation } from '../shared/sim';
import { AttackLog, HitTracker } from './combat';
import { CarWatch } from './rules';

/** How one car is doing in the running round. */
export interface CarStatus {
  slot: number;
  hp: number;
  alive: boolean;
  /** Eliminations credited to this car, HP of damage it dealt, and the points it earned this round. */
  kills: number;
  damage: number;
  gained: number;
}

export interface StepEvents {
  hits: HitMessage[];
  kos: KoMessage[];
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * Everything the server tracks about one round's cars: hit points, who is still running, who hit whom, and the points
 * earned. It knows nothing about players, sockets or phases; the Room feeds it the simulation and turns what comes back
 * into messages.
 */
export class RoundState {
  readonly status = new Map<number, CarStatus>();
  private readonly tracker = new HitTracker();
  private readonly log = new AttackLog();
  private readonly watches = new Map<number, CarWatch>();

  constructor(slots: readonly number[]) {
    for (const slot of slots) {
      this.status.set(slot, { slot, hp: COMBAT.MAX_HP, alive: true, kills: 0, damage: 0, gained: 0 });
      this.watches.set(slot, new CarWatch());
    }
  }

  isAlive(slot: number): boolean {
    return this.status.get(slot)?.alive ?? false;
  }

  hpOf(slot: number): number {
    return this.status.get(slot)?.hp ?? 0;
  }

  aliveSlots(): number[] {
    return [...this.status.values()].filter((s) => s.alive).map((s) => s.slot);
  }

  /** The alive car with the most HP, or -1 when nobody is alive or the best two are level. */
  leader(): number {
    const alive = [...this.status.values()].filter((s) => s.alive).sort((a, b) => b.hp - a.hp || a.slot - b.slot);
    if (alive.length === 0) return -1;
    if (alive.length > 1 && Math.abs(alive[0]!.hp - alive[1]!.hp) < 1e-9) return -1;
    return alive[0]!.slot;
  }

  /** Takes a car out of the round. Returns the message to send, or null when it was out already. */
  eliminate(slot: number, reason: KoReason, tick: number): KoMessage | null {
    const car = this.status.get(slot);
    if (!car || !car.alive) return null;
    car.alive = false;
    car.hp = 0;
    // a disconnect is nobody's kill; anything else goes to whoever hit the car last, if that was recent
    const { killer, assists } = reason === 'disconnected' ? { killer: -1, assists: [] } : this.log.credit(slot, tick);
    if (killer >= 0) {
      const credited = this.status.get(killer);
      if (credited) {
        credited.kills++;
        credited.gained += COMBAT.KILL_POINTS;
      }
    }
    return { t: 'ko', tick, victim: slot, killer, assists, reason };
  }

  awardWin(slot: number): void {
    const car = this.status.get(slot);
    if (car) car.gained += COMBAT.WIN_POINTS;
  }

  /**
   * Reads the simulation's contacts for this tick: impacts become damage, and cars are eliminated when they run out of HP,
   * flip, stall, leave the arena or sit still too long. Call once per live tick, after `sim.step()`.
   */
  step(tick: number, sim: Simulation): StepEvents {
    const events: StepEvents = { hits: [], kos: [] };
    const involved = new Set<number>();
    for (const hit of this.tracker.update(tick, sim.contacts(COMBAT.SCRAPE_IMPULSE))) {
      const victim = this.status.get(hit.victim);
      if (!victim || !victim.alive) continue; // a wreck cannot be hurt any more
      const dealt = Math.min(hit.damage, victim.hp);
      victim.hp -= dealt;
      involved.add(hit.victim);
      if (hit.attacker >= 0) {
        involved.add(hit.attacker);
        this.log.record(hit.victim, hit.attacker, tick);
        const attacker = this.status.get(hit.attacker);
        if (attacker) {
          attacker.damage += dealt;
          attacker.gained += dealt * COMBAT.POINTS_PER_HP;
        }
      }
      events.hits.push({
        t: 'hit',
        tick: hit.tick,
        victim: hit.victim,
        attacker: hit.attacker,
        dmg: round1(dealt),
        hp: round1(victim.hp),
        zone: hit.zone,
        j: round1(hit.impulse),
        p: [round2(hit.point.x), round2(hit.point.y), round2(hit.point.z)],
      });
      if (victim.hp <= 1e-9) {
        const ko = this.eliminate(hit.victim, 'damage', tick);
        if (ko) events.kos.push(ko);
      }
    }
    for (const car of this.status.values()) {
      if (!car.alive) continue;
      const watch = this.watches.get(car.slot)!;
      const result = watch.update(sim.getState(car.slot), involved.has(car.slot));
      if (result.drain > 0) car.hp -= result.drain;
      const reason: KoReason | null =
        car.hp <= 1e-9 ? 'stall' : result.fault === 'flipped' ? 'flipped' : result.fault === 'stuck' ? 'stuck' : result.fault === 'bounds' ? 'bounds' : null;
      if (reason) {
        const ko = this.eliminate(car.slot, reason, tick);
        if (ko) events.kos.push(ko);
      }
    }
    return events;
  }
}
```

The room calls it on every live tick and tells everyone what happened:

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
    if (this.phase === 'live') {
      this.checkEnd(state);
    }
```

with:

```ts
    if (this.phase === 'live') {
      const events = state.step(sim.tick, sim);
      for (const hit of events.hits) this.broadcast(hit);
      for (const ko of events.kos) this.broadcast(ko);
      if (events.hits.length + events.kos.length > 0) this.scoresDirty = true;
      this.checkEnd(state);
    }
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/server tests/client && npm run typecheck && npm test`
Expected: PASS — the server and client tests, type-check clean, then the whole suite (399 tests).

<!-- check {"cmd": "npx vitest run tests/server tests/client && npm run typecheck && npm test", "outcome": "pass", "tests": 399} -->

- [ ] **Step 5: Mutation check (do not commit)**

A test suite that cannot fail proves nothing. Make each of these one-line changes, run `npx vitest run tests/server tests/client`, and confirm at least one test fails; then undo the change. (This is the check the review of Plan 3 asked for; it takes a minute.)

- `src/server/round.ts`: in `eliminate`, change `reason === 'disconnected' ? { killer: -1, assists: [] } : this.log.credit(slot, tick)` to `this.log.credit(slot, tick)`.
- `src/server/round.ts`: in `step`, delete `if (!victim || !victim.alive) continue;`.
- `src/server/round.ts`: in `step`, change `Math.min(hit.damage, victim.hp)` to `hit.damage`.
- `src/server/room.ts`: in `broadcastSnapshot`, change `Math.ceil(state.hpOf(slot))` to `Math.floor(state.hpOf(slot))`.
- `src/server/room.ts`: in `checkEnd`, replace the condition `this.roundCars.some((p) => !p.bot) && !humansAlive` by `false`.
- `src/server/room.ts`: in `applyInputs`, start `input` as `{ throttle: 0, steer: 0, handbrake: false }` instead of `PARKED_INPUT`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(server): combat \u2014 impacts cost HP, cars are eliminated, kills and damage score, rounds end by elimination"
```

<!-- commit "feat(server): combat \u2014 impacts cost HP, cars are eliminated, kills and damage score, rounds end by elimination" -->

---

### Task 31: The server end to end: settings, the bot script, documentation

**Files:**
- Create: `src/server/config.ts`, `tests/server/config.test.ts`
- Modify: `src/server/index.ts` (replace), `scripts/bot.ts`, `README.md`, `tests/server/integration.test.ts` (two whole-round tests)

**Interfaces:**
- Consumes: `GameServerOptions` (Task 28), the round messages (Task 26).
- Produces: `readConfig(env, cwd): {port, staticDir, options}` — every setting from environment variables, with garbage falling back to the defaults; `BOT_FILL`, `COUNTDOWN_SECONDS`, `ROUND_SECONDS`, `RESULTS_SECONDS` in addition to the old ones.

- [ ] **Step 1: Write the failing tests**

`config.test.ts` covers the defaults, every setting, bots switched off, and garbage values. The two integration tests play whole rounds over real WebSockets: two humans (one leaves, the other wins, the next round starts) and one human with three bots (countdown, live, results, a second round). They pass as soon as Task 30 is in, and stay as the end-to-end proof.

Create `tests/server/config.test.ts`:

<!-- op {"kind": "create", "path": "tests/server/config.test.ts"} -->
```ts
import { describe, expect, it } from 'vitest';
import { ROUND } from '../../src/shared/constants';
import { readConfig } from '../../src/server/config';

describe('readConfig', () => {
  it('uses the defaults when nothing is set', () => {
    const c = readConfig({}, '/app');
    expect(c.port).toBe(8080);
    expect(c.staticDir).toBe('/app/dist/client');
    expect(c.options).toEqual({
      allowedOrigins: [],
      maxRooms: 12,
      maxConnections: 200,
      botFill: ROUND.BOT_FILL,
      rules: { countdownTicks: ROUND.COUNTDOWN_TICKS, liveTicks: ROUND.LIVE_TICKS, resultsTicks: ROUND.RESULTS_TICKS },
    });
  });

  it('reads every setting', () => {
    const c = readConfig(
      { PORT: '9000', STATIC_DIR: '/srv/www', ALLOWED_ORIGINS: 'https://a.example, https://b.example ,', MAX_ROOMS: '3', MAX_CONNECTIONS: '50', BOT_FILL: '2', COUNTDOWN_SECONDS: '3', ROUND_SECONDS: '45', RESULTS_SECONDS: '2.5' },
      '/app',
    );
    expect(c.port).toBe(9000);
    expect(c.staticDir).toBe('/srv/www');
    expect(c.options.allowedOrigins).toEqual(['https://a.example', 'https://b.example']);
    expect(c.options.maxRooms).toBe(3);
    expect(c.options.maxConnections).toBe(50);
    expect(c.options.botFill).toBe(2);
    expect(c.options.rules).toEqual({ countdownTicks: 180, liveTicks: 2700, resultsTicks: 150 });
  });

  it('allows no bots at all, and never more bots than cars', () => {
    expect(readConfig({ BOT_FILL: '0' }).options.botFill).toBe(0);
    expect(readConfig({ BOT_FILL: '99' }).options.botFill).toBe(8);
  });

  it('falls back to the defaults for garbage instead of refusing to start', () => {
    const c = readConfig({ PORT: 'eighty', MAX_ROOMS: '-3', MAX_CONNECTIONS: '0', BOT_FILL: 'many', COUNTDOWN_SECONDS: 'soon', ROUND_SECONDS: '-1', RESULTS_SECONDS: '0' }, '/app');
    expect(c.port).toBe(8080);
    expect(c.options.maxRooms).toBe(12);
    expect(c.options.maxConnections).toBe(200);
    expect(c.options.botFill).toBe(ROUND.BOT_FILL);
    expect(c.options.rules).toEqual({ countdownTicks: ROUND.COUNTDOWN_TICKS, liveTicks: ROUND.LIVE_TICKS, resultsTicks: ROUND.RESULTS_TICKS });
  });

  it('never rounds a round phase down to nothing', () => {
    expect(readConfig({ COUNTDOWN_SECONDS: '0.001' }).options.rules!.countdownTicks).toBe(1);
  });
});
```

Append to `tests/server/integration.test.ts`:

<!-- op {"kind": "append", "path": "tests/server/integration.test.ts"} -->
```ts
describe('whole rounds over the wire', () => {
  const phases = (c: TestClient): string[] => c.messages.filter((m): m is PhaseMessage => m.t === 'phase').map((m) => m.phase);

  it('plays a round between two humans to a winner, then starts the next round', async () => {
    const a = await connect();
    const b = await connect();
    a.hello({ name: 'Ann' });
    b.hello({ name: 'Bob' });
    const ra = await a.waitFor(() => rosterWith(a, 2), 4000, 'roster for Ann');
    const rb = await b.waitFor(() => rosterWith(b, 2), 4000, 'roster for Bob');
    expect(ra.players.map((p) => p.name).sort()).toEqual(['Ann', 'Bob']);
    await a.waitFor(() => goesLive(a), 3000, 'the round to go live');
    expect(phases(a).slice(0, 2)).toEqual(['countdown', 'live']);

    b.close(); // Bob leaves: Ann is the last car running
    const ko = await a.waitFor(() => a.messages.find((m) => m.t === 'ko'), 3000, 'the ko');
    expect(ko).toMatchObject({ t: 'ko', victim: rb.you, reason: 'disconnected' });
    const results = await a.waitFor(() => a.messages.find((m) => m.t === 'results'), 3000, 'the results');
    expect(results).toMatchObject({ t: 'results', round: 1, winner: ra.you, reason: 'last' });
    expect(phases(a).at(-1)).toBe('results');

    const next = await a.waitFor(() => a.messages.filter((m): m is RosterMessage => m.t === 'roster' && m.round === 2)[0], 4000, 'the next round');
    expect(next.you).toBe(0);
    expect(next.players.map((p) => p.name)).toEqual(['Ann']);
    expect(next.epoch).toBeGreaterThan(ra.epoch);
  });

  it('fills a room with bots, and a round against them runs through countdown, live and results', async () => {
    const withBots = createGameServer({ botFill: 4, seed: 5, rules: { countdownTicks: 20, liveTicks: 150, resultsTicks: 30 } });
    try {
      const p = await withBots.listen(0, '127.0.0.1');
      const c = await TestClient.connect(p);
      clients.push(c);
      c.hello({ name: 'Solo' });
      const roster = await c.waitFor(() => c.messages.find((m): m is RosterMessage => m.t === 'roster'), 4000, 'roster');
      expect(roster.you).toBe(0);
      expect(roster.players.map((q) => Boolean(q.bot))).toEqual([false, true, true, true]);
      await c.waitFor(() => c.messages.find((m) => m.t === 'results'), 6000, 'results');
      expect(phases(c).slice(0, 3)).toEqual(['countdown', 'live', 'results']);
      const snap = c.snapshots.find((s) => s.epoch === roster.epoch && s.cars.length === 4);
      expect(snap).toBeDefined();
      await c.waitFor(() => c.messages.filter((m) => m.t === 'roster').length >= 2, 4000, 'a second round');
    } finally {
      await withBots.close();
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/server/config.test.ts`
Expected: FAIL — cannot resolve `../../src/server/config`.

<!-- check {"cmd": "npx vitest run tests/server/config.test.ts", "outcome": "fail"} -->

- [ ] **Step 3: Implement**

Create `src/server/config.ts`:

<!-- op {"kind": "create", "path": "src/server/config.ts"} -->
```ts
import path from 'node:path';
import { ROUND } from '../shared/constants';
import type { GameServerOptions } from './app';

export interface ServerConfig {
  port: number;
  staticDir: string;
  options: GameServerOptions;
}

/** A positive whole number, or `fallback` for anything else (missing, zero, negative, fractional garbage, NaN). */
const positive = (value: string | undefined, fallback: number): number => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Zero or more, or `fallback`. */
const nonNegative = (value: string | undefined, fallback: number): number => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** Seconds (fractions allowed) turned into simulation ticks; anything unusable gives the default. */
const ticks = (value: string | undefined, fallbackTicks: number): number => {
  const n = Number.parseFloat(value ?? '');
  return Number.isFinite(n) && n > 0 ? Math.max(1, Math.round(n * 60)) : fallbackTicks;
};

/** The server's settings from environment variables. Bad values fall back to the defaults instead of stopping the server. */
export function readConfig(env: Record<string, string | undefined>, cwd: string = process.cwd()): ServerConfig {
  return {
    port: positive(env.PORT, 8080),
    staticDir: env.STATIC_DIR ?? path.resolve(cwd, 'dist/client'),
    options: {
      allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      maxRooms: positive(env.MAX_ROOMS, 12),
      maxConnections: positive(env.MAX_CONNECTIONS, 200),
      botFill: Math.min(nonNegative(env.BOT_FILL, ROUND.BOT_FILL), 8),
      rules: {
        countdownTicks: ticks(env.COUNTDOWN_SECONDS, ROUND.COUNTDOWN_TICKS),
        liveTicks: ticks(env.ROUND_SECONDS, ROUND.LIVE_TICKS),
        resultsTicks: ticks(env.RESULTS_SECONDS, ROUND.RESULTS_TICKS),
      },
    },
  };
}
```

The entry point shrinks to wiring:

Replace `src/server/index.ts` with:

<!-- op {"kind": "replace", "path": "src/server/index.ts"} -->
```ts
import { initPhysics } from '../shared/physics';
import { createGameServer } from './app';
import { readConfig } from './config';

await initPhysics();

const { port, staticDir, options } = readConfig(process.env);
const app = createGameServer({ staticDir, ...options });

const bound = await app.listen(port);
console.log(`wreckyard listening on :${bound} (static files: ${staticDir})`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().finally(() => process.exit(0));
  });
}
```

The headless test player follows the round messages: its slot changes with every round, and it logs what happens to it.

In `scripts/bot.ts`, replace:

<!-- op {"kind": "edit", "path": "scripts/bot.ts"} -->
```ts
    console.log(`joined ${msg.room.public ? 'public' : 'private'} room ${msg.room.code} as slot ${mySlot}`);
  } else if (msg.t === 'roster') {
    epoch = msg.epoch;
    console.log(`roster (epoch ${msg.epoch}): ${msg.players.map((p) => p.name).join(', ')}`);
  } else if (msg.t === 'error') {
```

with:

```ts
    console.log(`joined ${msg.room.public ? 'public' : 'private'} room ${msg.room.code}${mySlot < 0 ? ' (watching until the next round)' : ` as slot ${mySlot}`}`);
  } else if (msg.t === 'roster') {
    epoch = msg.epoch;
    mySlot = msg.you;
    console.log(`round ${msg.round} (epoch ${msg.epoch}), you are ${mySlot < 0 ? 'watching' : `slot ${mySlot}`}: ${msg.players.map((p) => (p.bot ? `${p.name} [bot]` : p.name)).join(', ')}`);
  } else if (msg.t === 'phase') {
    console.log(`phase: ${msg.phase} (${Math.round(msg.remainingMs / 1000)} s)`);
  } else if (msg.t === 'hit') {
    if (msg.victim === mySlot || msg.attacker === mySlot) console.log(`hit: slot ${msg.attacker} -> slot ${msg.victim}, ${msg.dmg} HP on the ${msg.zone}`);
  } else if (msg.t === 'ko') {
    console.log(`out: slot ${msg.victim} (${msg.reason})${msg.killer >= 0 ? `, credited to slot ${msg.killer}` : ''}`);
  } else if (msg.t === 'results') {
    console.log(`results: ${msg.winner < 0 ? 'nobody won' : `slot ${msg.winner} won`} (${msg.reason})`);
  } else if (msg.t === 'error') {
```

Documentation:

In `README.md`, replace:

<!-- op {"kind": "edit", "path": "README.md"} -->
```markdown
- Server configuration (environment variables): `PORT` (8080), `ALLOWED_ORIGINS` (comma-separated exact origins; default: same host only), `MAX_ROOMS` (12), `MAX_CONNECTIONS` (200), `STATIC_DIR` (`dist/client`).
```

with:

```markdown
- Server configuration (environment variables): `PORT` (8080), `ALLOWED_ORIGINS` (comma-separated exact origins; default: same host only), `MAX_ROOMS` (12), `MAX_CONNECTIONS` (200), `STATIC_DIR` (`dist/client`), `BOT_FILL` (bots fill a room up to this many cars; default 4, 0 = none), `COUNTDOWN_SECONDS` (5), `ROUND_SECONDS` (240), `RESULTS_SECONDS` (8).
```

In `README.md`, replace:

<!-- op {"kind": "edit", "path": "README.md"} -->
```markdown
- Debugging: `window.__derby.debug()` in the browser console prints the connection, roster and interpolated poses.
```

with:

```markdown
- Debugging: `window.__derby.debug()` in the browser console prints the connection, phase, roster and every car's pose, hit points and whether it is still running.
```

In `README.md`, replace:

<!-- op {"kind": "edit", "path": "README.md"} -->
```markdown
- No friends around? `npx tsx scripts/bot.ts --mode quick --name Bot` joins the same public room and drives around (`--mode join --code ABCD` for a private room).
```

with:

```markdown
- No friends around? The server already fills a room with bots up to four cars. To add a headless *player* that drives around and logs the round, run `npx tsx scripts/bot.ts --mode quick --name Bot` (`--mode join --code ABCD` for a private room).
```

Append to `README.md`:

<!-- op {"kind": "append", "path": "README.md"} -->
```markdown
## Rounds and combat

- A room plays in rounds: a 5 s countdown (a fresh arena, every car held still), then the round runs until one car is left, four minutes pass (the most HP wins) or every human is out, then 8 s of results. Whoever is in the room when a round starts gets a car; anyone who joins later watches until the next round. A player who joins during a countdown restarts it (at most eight times per round), so friends who join together play together.
- Bots fill a room up to four cars and step aside as humans join.
- Damage comes from impacts, measured as the impulse the collision transmits. Walls hurt half as much as cars, the rear of a car is its sturdiest side and the front its weakest, and scraping or pushing does nothing. A car is out at 0 HP, after 3 s upside down, after 8 s without moving, or when it leaves the arena; after 20 s without hitting or being hit it loses 2 HP per second until it is in a hit. Cars that are out stay in the arena as wrecks.
- Scoring: 1 point per HP of damage dealt, +50 for the elimination, +100 for winning the round. Running totals stay while you are in the room.
- Tuning lives in `COMBAT` and `ROUND` in `src/shared/constants.ts`.
- The match screen (health bar, timer, kill feed, scoreboard, banners) is the next plan; until then follow a round with `window.__derby.debug()` or the server messages `phase`, `hit`, `ko`, `scores` and `results`.
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/server && npm run typecheck && npm test && npm run build`
Expected: PASS — the config and integration tests, the whole suite (406 tests), and a clean production build (client and bundled server).

<!-- check {"cmd": "npx vitest run tests/server && npm run typecheck && npm test && npm run build", "outcome": "pass", "tests": 406} -->

- [ ] **Step 5: Check it in a real browser**

Use the Playwright MCP (the in-app browser pane pauses its animation loop while it is hidden, so it is no good for this) and a private port — your own `npm run dev` stays untouched:

```bash
npm run build:client
PORT=18091 COUNTDOWN_SECONDS=3 ROUND_SECONDS=45 RESULTS_SECONDS=5 npx tsx src/server/index.ts
```

Open `http://127.0.0.1:18091/?auto=quick&name=Tester` and wait until `window.__derby.debug()` reports `joined`, `mySlot` 0, `prediction.synced` and four cars (three of them bots, marked in `roster`). Then check:

- `phase` is `countdown`. Hold W for 1.5 s: your car's speed stays under 1 m/s, and `window.__derby.netStats.localErrorMax` stays under 0.1 m — the client holds the car exactly as the server does.
- When `phase` becomes `live`, the car accelerates (about 16 m/s a few seconds later with W held).
- Keep driving. `debug().poses` shows your `hp` falling when you hit the wall or a bot; a car whose `alive` is false is drawn dark grey in the page.
- When your car is out (`alive` false, `hp` 0) the round ends with `phase` `results`, and a few seconds later `phase` is `countdown` again with a higher `epoch`, your `mySlot` set again and `hp` back at 100.
- No console errors. Stop the server with Ctrl-C. `npm run hash` still prints `10c3a72a`, and `await __derby.simHash()` in the page prints the same.

Also try `http://127.0.0.1:18091/?auto=quick&name=Tester&lag=120&jitter=30&loss=1` for a minute: the local car stays smooth through a countdown, the start of a round and a wreck.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(server): settings from the environment, whole-round tests over WebSockets, bot script and README for rounds and combat"
```

<!-- commit "feat(server): settings from the environment, whole-round tests over WebSockets, bot script and README for rounds and combat" -->

---

## Plan 4 done when

- [ ] `npm run typecheck`, `npm test` (406 tests), `npm run build` pass, and `npm run hash` still prints `10c3a72a`. (`npm run smoke` needs free ports: run it with `SMOKE_PROD_PORT`, `SMOKE_SERVER_PORT` and `SMOKE_VITE_PORT` set to unused ones, or only its production half by hand, if your own `npm run dev` is running.)
- [ ] The browser check of Task 31 passes on a private port: the car is held during the countdown, drives when the round goes live, bots are in the room, a full round ends with a `results` message, the next round starts with a new world, no console errors.
- [ ] **The user has played it** — ideally in two browser windows, or one window against the bots — and said whether the damage, the bots and the round timing feel right. The numbers to change are in `COMBAT` and `ROUND`.

**Known limits of this baseline (each addressed by a later plan):** there is no match screen — no health bar, timer, scoreboard, kill feed or banners — and no spectator controls (Plan 5); wrecks are dark boxes without smoke or debris and nothing dents (Plan 6); a player who joins while a round is live watches until it ends, as the spec says; the damage numbers, wall damage and the bots have not been played by a human; a wreck coasts for several seconds on its handbrake before it stops.

**Next plans** (written after this one is verified, against the code as it then stands): Plan 5 — the match screen (health bar and damage diagram, timer, alive count, scoreboard, kill feed, countdown and winner banners, spectator camera); Plan 6 — destruction and juice (dents, parts, particles, skid marks, camera shake, bloom, audio, arena dressing); Plan 7 — polish and packaging (menu and settings, graphics presets, limits, CLAUDE.md, Dockerfile, load test).
