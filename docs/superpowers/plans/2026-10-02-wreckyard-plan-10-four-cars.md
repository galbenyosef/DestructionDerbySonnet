# Wreckyard Plan 10 — Four Cars (models to choose from, protocol 5, dents that bend them) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each player drive one of four car models — the sedan, the coupe, the wagon and the pickup the owner modelled in Blender — chosen in the menu and seen by everyone: the paint tinted with the player's colour, wheels that steer and spin, bodywork that bends where it is hit and shades again, hoods, bumpers and doors that come off by name, a Low preset that leaves out the small detail, and boxes as the fallback until a model has loaded. The cars differ in looks only: one hitbox, one mass, one tuning.

**Architecture:** `src/shared/cars.ts` names the four cars; protocol 5 carries `hello.car` (the sedan when it names none or one that does not exist) and `PlayerInfo.car`; the room remembers each player's car and draws a model for each bot from its seed. `art/cars/densify_cars.py` (Blender 5) takes the four exported models in `art/cars/src/`, cuts every long edge of the panels a dent can bend to 35 cm, shades them smooth by angle and writes `src/client/assets/car_<id>.glb` plus a menu picture. A generic `ModelCache` (extracted from Plan 9's arena loader) loads the models in the background; `CarView.useModel` takes a copy of a model — its own paint and its own copy of the dentable panels, everything else shared — puts the wheels into the physics wheels' spinners, dents and shades the panels, hides parts by node name, and replays the damage a car took before its model arrived. Nothing in the simulation, the rules or the hitbox changes.

**Tech Stack:** as Plans 1-9; Blender 5 for the build of the models (the models are committed).

**Spec:** `docs/superpowers/specs/2026-10-02-wreckyard-arenas-and-cars-design.md` — "Cars", "Protocol (version 5 for cars)". **Prerequisite:** Plan 9 complete and reviewed (branch `plan-9-arena-scenery`, HEAD `87d6d69`, 835 tests; **not merged to `main` when this plan was written**). This plan starts on a new branch cut from it, so it carries Plans 8 and 9's work if those are merged by then.

**Scope notes:**
- Deviations from the spec text, each with its reason: (1) **the densified models are built from the four exported game models, committed under `art/cars/src/`** (about 1.3 MB), not from the `.blend` scenes, which stay outside the repository (the owner's call); the owner's working copy provides the sources in Task 69's copy step (an absolute path on this machine). (2) **Dent density is 35 cm, not 15 cm:** at 15 cm the models would be about 30 000 triangles; at 35 cm they are 14 000 to 15 900, within the budget for eight cars (about 125 000), and a dent of the sizes the game makes (radius 0.8 to 1.9 m) still bends them smoothly. (3) **The menu shows a picture of each car, not a turntable:** a second WebGL context in the menu would double the cost of the page for a one-time choice; the pictures are rendered by the same script. They show the model's own paint, not the player's colour. (4) **The wreck look, the paint tint and the parts** use node and material names the models were exported with (listed in Task 69); a model without them still plays, it just cannot lose that part. (5) **The glass's transmission is turned off at load:** it makes the renderer draw the whole scene again every frame, and plain transparency looks the same on a car.
- The sedan models' fenders are 2.11 m wide against the 2.0 m hitbox: a car looks 5 cm wider than it is, on each side.
- **Blender is needed only to rebuild the models** (Task 69's build step, `/Applications/Blender.app/Contents/MacOS/Blender`, version 5.x).

## What the rehearsal found (measured before this plan was written)

I rehearsed everything in a scratch copy of the Plan 9 branch, generated this text from the rehearsal, and executed it against a fresh copy to check that it reproduces the rehearsal file for file.

- **The models:** sedan 10 626 → 13 976 triangles (383 KB), coupe 10 538 → 14 002 (388 KB), wagon 10 434 → 14 044 (379 KB), pickup 11 312 → 15 868 (438 KB); the body panels' longest edge was 1.8 m before (the body's mean was 0.28 m, with large flat triangles that a dent would have stretched). All four have their wheels exactly at the physics wheels (±1.45 m, ±0.95 m, one radius above the ground) and a body 4.5 m long.
- **In a real browser** (private port, five cars, the Playwright browser, 1280x720; no console errors): the player's blue coupe with its racing stripes next to a grey sedan wearing the number 73, a wagon and a purple pickup; the renderer reported 392 draw calls and about 130 000 triangles for five cars in the quarry; a hit car throws sparks and loses its hood; the menu shows four cards with pictures and keeps the choice.
- **Four things I changed after looking:** the glass (a `KHR_materials_transmission` material in the file) would have added a whole rendering pass; the asset test of the arena models counted the car files too (it now looks at `arena_` files only); my first width check (under 2.1 m) failed on the fenders (2.114 m); and the menu's cards were first text only.
- **Known limits of this baseline:** the menu pictures show the model's colour, not yours; the wheels are rigid (no tyre deformation); a dent displaces the whole shell by position, so a very deep dent also moves the glass and the lamps with it; the models have only the nodes they were exported with (no separate trunk lid on the wagon and the pickup, so they never lose one); the Low preset does not drop triangles of the body.

## Global Constraints

- Everything in Plans 1-9's Global Constraints still applies (single package, relative imports, exact pins, axes, deterministic simulation path, effects cosmetic, commits only because the user opted in).
- **The cars differ in looks only:** `CAR` (hitbox, mass, wheels) and the tuning are untouched; `npm run hash` still prints `8719c2e8` after every task; only the wire changes (`NET.PROTOCOL_VERSION` 5).
- **A client is never refused for its car:** an unknown or missing car in a hello is the sedan.
- **The models are generated, never edited:** `densify_cars.py` is the source; a test holds them to a size, a triangle budget and the physics wheels' places.
- **A car without its model is a car:** the boxes of Plan 5 stay in `CarView`, drawn until a model arrives and for good if it does not.
- **Never commit a symlink or a build output** (`node_modules` and `dist` are ignored).
- **No new dependency**; nothing in this plan deploys, pushes or creates an account. The user's own `npm run dev` may be running on ports 8080/5173: never stop it; use `PORT` with another port (18000 and up).

## Review Focus

1. **A hello or a roster with a strange car:** missing, unknown, a number, `null`, `"__proto__"`; an old client; a roster whose player has no car. → Task 68 (`protocol.test.ts`, `cars.test.ts`).
2. **A model that comes late, never, or twice:** the car is hurt before its model arrives; the slot is taken by a different model next round; two cars of one model must not share dents or paint. → Tasks 70-72 (`carViewModel.test.ts`, `carModels.test.ts`, the browser check).
3. **Memory and GPU use:** shared geometry and materials freed once and only by their owner, copied panels freed with the view, no transmission pass, eight cars within budget. → Tasks 69 and 71.
4. **Models that do not match the physics:** wheels off the physics wheels, a body bigger than the hitbox, a node that moves the car. → Task 69 (`carAssets.test.ts`).
5. **A damaged profile or a hostile link:** a saved profile from before there were four cars, a corrupt one, `?car=` with nonsense. → Task 68 (`profile.test.ts`, `autoChoice.test.ts`).

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/cars.ts` (new), `constants.ts`, `protocol.ts` (modify) | the four car ids; protocol 5 |
| `src/server/player.ts`, `app.ts`, `room.ts` (modify) | the car of a player and of a bot, in the roster |
| `src/client/profile.ts` (new), `ui/menu.ts`, `ui/autoChoice.ts`, `index.html` (modify) | the saved choice; the picker with pictures |
| `art/cars/densify_cars.py`, `art/cars/src/*.glb` (new) | the Blender step that makes the game models from the exported ones |
| `src/client/assets/car_*.glb`, `car_*.png` (new, generated), `src/client/game/carAssets.ts` (new) | the models, their pictures, their URLs |
| `src/client/game/modelCache.ts`, `carModels.ts` (new), `arenaScenery.ts` (modify) | the shared loader |
| `src/client/game/carView.ts`, `dents.ts` (modify) | drawing a model: paint, wheels, dents, parts, detail |
| `src/client/settings.ts`, `game/gameClient.ts` (modify) | the Low car detail; models loaded in the background |
| `README.md`, `CLAUDE.md` (modify) | the docs |
| `tests/…` | one file per new module and additions to the existing suites |

---

### Task 68: Four cars: the choice in the menu, protocol 5, the car in the room

**Files:**
- Create: `src/shared/cars.ts`, `src/client/profile.ts`, `tests/cars.test.ts`, `tests/server/roomCars.test.ts`, `tests/client/profile.test.ts`
- Modify: `src/shared/constants.ts`, `src/shared/protocol.ts`, `src/server/player.ts`, `src/server/app.ts`, `src/server/room.ts`, `src/client/ui/menu.ts`, `src/client/ui/autoChoice.ts`, `src/client/game/gameClient.ts`, `src/client/index.html`, `tests/protocol.test.ts`, `tests/helpers/roomKit.ts`, `tests/client/autoChoice.test.ts`, `tests/client/matchState.test.ts`

**Interfaces:**
- Consumes: `PlayerInfo`, `HelloMessage`, `parseClientMessage`, `parseServerMessage` (Plan 2-8), `Room` and its bots (Plan 4), `showMenu` and `JoinChoice` (Plan 2), `automaticChoice` (Plan 3), `mulberry32` (Plan 1).
- Produces: `CAR_IDS` (`sedan`, `coupe`, `wagon`, `pickup`), `CarId`, `DEFAULT_CAR`, `CAR_NAMES`, `isCarId`, `carOrDefault` (`src/shared/cars.ts`); `HelloMessage.car` (the sedan when the client names none or one that does not exist: nobody is refused for it) and `PlayerInfo.car` (required, validated); `Player.car`; the room puts each player's car in the roster and gives each bot a model drawn from the room's seed; `NET.PROTOCOL_VERSION` 5; `Profile` (`name`, `color`, `car`) with `loadProfile(storage)` and `saveProfile(storage, profile)` repairing a damaged field at a time; `JoinChoice.car`; the menu's car picker and `?car=` in an `?auto=` link. **The cars differ in looks only:** nothing in the simulation changes and `npm run hash` is untouched.

- [ ] **Step 1: Write the tests**

The wire first: a hello that names a car takes it, and one that names none, an unknown one, a number, `null`, an object or `"__proto__"` gets the sedan (it is a looks-only choice, so it is never an error); a roster or welcome whose player has no car, or one that does not exist, is malformed. Then the room: each player's car is in the roster and in the greeting (the sedan for a player who chose none), and each bot has a model drawn from the room seed — the same for the same seed, all four turning up across seeds. On the client the profile is a small pure module so it can be tested like the settings: a profile saved before there were four cars keeps its name and colour and gets the sedan, a damaged field falls back alone, and storage that is missing, corrupt or throws is survived. `?car=` in an automatic link picks the car by name, the sedan otherwise.

Create `tests/cars.test.ts`:

<!-- op {"kind": "create", "path": "tests/cars.test.ts"} -->
```ts
import { describe, expect, it } from 'vitest';
import { CAR_IDS, CAR_NAMES, DEFAULT_CAR, carOrDefault, isCarId } from '../src/shared/cars';

describe('car ids', () => {
  it('are the four models, the sedan first, each with a name', () => {
    expect([...CAR_IDS]).toEqual(['sedan', 'coupe', 'wagon', 'pickup']);
    expect(DEFAULT_CAR).toBe('sedan');
    for (const id of CAR_IDS) expect(CAR_NAMES[id].length).toBeGreaterThan(2);
  });

  it('are recognised exactly', () => {
    for (const id of CAR_IDS) expect(isCarId(id)).toBe(true);
    for (const bad of ['', 'Sedan', 'tank', 3, null, undefined, {}, ['sedan'], '__proto__', 'constructor']) expect(isCarId(bad)).toBe(false);
  });

  it('fall back to the sedan for anything else, and keep a good one', () => {
    expect(carOrDefault('pickup')).toBe('pickup');
    for (const bad of ['tank', 7, null, undefined, {}, '__proto__']) expect(carOrDefault(bad)).toBe('sedan');
  });
});
```

Create `tests/server/roomCars.test.ts`:

<!-- op {"kind": "create", "path": "tests/server/roomCars.test.ts"} -->
```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CAR_IDS } from '../../src/shared/cars';
import { initPhysics } from '../../src/shared/physics';
import { disposeRooms, join, makeRoom, messages, steps } from '../helpers/roomKit';

beforeAll(async () => {
  await initPhysics();
});
afterEach(disposeRooms);

describe('Room cars', () => {
  it('shows each player\'s car in the roster, the sedan for a player who chose none', () => {
    const { room } = makeRoom();
    const a = join(room, 'Ann', 'pickup');
    const b = join(room, 'Bob');
    steps(room, 2);
    expect(room.playerInfos().map((p) => [p.name, p.car])).toEqual([['Ann', 'pickup'], ['Bob', 'sedan']]);
    expect(messages(a.socket, 'roster').at(-1)!.players).toMatchObject([{ car: 'pickup' }, { car: 'sedan' }]);
    expect(room.greeting(b.player).players.map((p) => p.car)).toEqual(['pickup', 'sedan']);
  });

  it('gives each bot a model, the same ones for the same room seed, and different ones for another', () => {
    const botCars = (seed: number): string[] => {
      const { room } = makeRoom({ botFill: 4, seed });
      join(room, 'Ann');
      steps(room, 2);
      return room.playerInfos().filter((p) => p.bot).map((p) => p.car);
    };
    expect(botCars(5)).toEqual(botCars(5));
    expect(botCars(5)).toHaveLength(3);
    for (const car of botCars(5)) expect(CAR_IDS).toContain(car);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) for (const car of botCars(seed)) seen.add(car);
    expect([...seen].sort()).toEqual([...CAR_IDS].sort());
    disposeRooms();
  });
});
```

Create `tests/client/profile.test.ts`:

<!-- op {"kind": "create", "path": "tests/client/profile.test.ts"} -->
```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE, PALETTE, PROFILE_KEY, loadProfile, saveProfile } from '../../src/client/profile';

const store = (value: string | null) => ({ getItem: (k: string) => (k === PROFILE_KEY ? value : null) });

describe('the saved profile', () => {
  it('starts with a nameless red sedan', () => {
    expect(DEFAULT_PROFILE).toEqual({ name: '', color: PALETTE[0], car: 'sedan' });
    expect(loadProfile(store(null))).toEqual(DEFAULT_PROFILE);
    expect(loadProfile(null)).toEqual(DEFAULT_PROFILE);
  });

  it('keeps what was saved, the car included', () => {
    const mine = { name: 'Max', color: PALETTE[3]!, car: 'pickup' as const };
    const saved: Record<string, string> = {};
    saveProfile({ setItem: (k, v) => void (saved[k] = v) }, mine);
    expect(loadProfile(store(saved[PROFILE_KEY]!))).toEqual(mine);
  });

  it('is repaired one field at a time: a profile saved before there were four cars gets the sedan and keeps its name and colour', () => {
    expect(loadProfile(store(JSON.stringify({ name: 'Ann', color: PALETTE[2] })))).toEqual({ name: 'Ann', color: PALETTE[2], car: 'sedan' });
    expect(loadProfile(store(JSON.stringify({ name: 'Ann', color: 123, car: 'coupe' })))).toEqual({ name: 'Ann', color: PALETTE[0], car: 'coupe' });
    expect(loadProfile(store(JSON.stringify({ name: 5, color: PALETTE[1], car: 'tank' })))).toEqual({ name: '', color: PALETTE[1], car: 'sedan' });
  });

  it('survives storage that is corrupt, holds the wrong thing, or throws', () => {
    for (const raw of ['not json', 'null', '7', '"x"', '[]']) expect(loadProfile(store(raw))).toEqual(DEFAULT_PROFILE);
    expect(loadProfile({ getItem: () => { throw new Error('blocked'); } })).toEqual(DEFAULT_PROFILE);
    expect(() => saveProfile({ setItem: () => { throw new Error('full'); } }, DEFAULT_PROFILE)).not.toThrow();
    expect(() => saveProfile(null, DEFAULT_PROFILE)).not.toThrow();
  });
});
```

In `tests/protocol.test.ts`:

<!-- op {"kind": "edit", "path": "tests/protocol.test.ts"} -->
```ts
  it('accepts valid hello and ping messages', () => {
    expect(parseClientMessage(JSON.stringify(hello))).toEqual({ ...hello, code: undefined });
    expect(parseClientMessage(JSON.stringify({ ...hello, mode: 'join', code: 'ABCD' }))).toMatchObject({ mode: 'join', code: 'ABCD' });
```

with:

```ts
  it('accepts valid hello and ping messages', () => {
    expect(parseClientMessage(JSON.stringify(hello))).toEqual({ ...hello, code: undefined, car: 'sedan' });
    expect(parseClientMessage(JSON.stringify({ ...hello, mode: 'join', code: 'ABCD' }))).toMatchObject({ mode: 'join', code: 'ABCD' });
```

In `tests/protocol.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/protocol.test.ts"} -->
```ts

  it('accepts a vote for each arena and nothing else', () => {
```

with:

```ts

  it('takes the car a player chose, and the sedan from a hello that names none or one that does not exist', () => {
    const base = { t: 'hello', v: NET.PROTOCOL_VERSION, name: 'Max', color: 0xd84a2b, mode: 'quick' };
    expect(parseClientMessage(JSON.stringify({ ...base, car: 'pickup' }))).toMatchObject({ car: 'pickup' });
    for (const car of [undefined, 'tank', 4, null, {}, '__proto__']) expect(parseClientMessage(JSON.stringify({ ...base, car }))).toMatchObject({ car: 'sedan' });
  });

  it('accepts a vote for each arena and nothing else', () => {
```

In `tests/protocol.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/protocol.test.ts"} -->
```ts
    room: { code: 'ABCD', public: true, capacity: 8 },
    players: [{ slot: 2, name: 'Max', color: 255 }, { slot: 3, name: 'Rusty', color: 1, bot: true }],
    arena: 'ice', votes: { stadium: 0, ice: 2, quarry: 1, port: 0 },
```

with:

```ts
    room: { code: 'ABCD', public: true, capacity: 8 },
    players: [{ slot: 2, name: 'Max', color: 255, car: 'coupe' }, { slot: 3, name: 'Rusty', color: 1, car: 'pickup', bot: true }],
    arena: 'ice', votes: { stadium: 0, ice: 2, quarry: 1, port: 0 },
```

In `tests/protocol.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/protocol.test.ts"} -->
```ts

  it('speaks protocol version 4', () => {
    expect(NET.PROTOCOL_VERSION).toBe(4);
  });
```

with:

```ts

  it('speaks protocol version 5', () => {
    expect(NET.PROTOCOL_VERSION).toBe(5);
  });
```

In `tests/protocol.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/protocol.test.ts"} -->
```ts
      JSON.stringify({ ...hit, hp: -3 }),
      JSON.stringify({ ...welcome, players: [{ slot: 1, name: 'x', color: 1, bot: 'yes' }] }),
      JSON.stringify({ ...welcome, dents: undefined }), // a welcome always carries the hit log, empty or not
```

with:

```ts
      JSON.stringify({ ...hit, hp: -3 }),
      JSON.stringify({ ...welcome, players: [{ slot: 1, name: 'x', color: 1, car: 'sedan', bot: 'yes' }] }),
      JSON.stringify({ ...welcome, players: [{ slot: 1, name: 'x', color: 1 }] }), // every car in a roster has a model
      JSON.stringify({ ...welcome, players: [{ slot: 1, name: 'x', color: 1, car: 'tank' }] }),
      JSON.stringify({ t: 'roster', epoch: 1, round: 1, you: 0, arena: 'ice', players: [{ slot: 0, name: 'x', color: 1 }] }),
      JSON.stringify({ ...welcome, dents: undefined }), // a welcome always carries the hit log, empty or not
```

In `tests/helpers/roomKit.ts`, `join` can choose the car:

<!-- op {"kind": "edit", "path": "tests/helpers/roomKit.ts"} -->
```ts
import { expect } from 'vitest';
import { decodeSnapshot, type Snapshot } from '../../src/shared/protocol';
```

with:

```ts
import { expect } from 'vitest';
import type { CarId } from '../../src/shared/cars';
import { decodeSnapshot, type Snapshot } from '../../src/shared/protocol';
```

In `tests/helpers/roomKit.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/helpers/roomKit.ts"} -->
```ts
let nextId = 1;
export function join(room: Room, name = 'P'): { player: Player; socket: FakeSocket } {
  const socket = new FakeSocket();
```

with:

```ts
let nextId = 1;
export function join(room: Room, name = 'P', car?: CarId): { player: Player; socket: FakeSocket } {
  const socket = new FakeSocket();
```

In `tests/helpers/roomKit.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/helpers/roomKit.ts"} -->
```ts
  player.name = name;
  expect(room.addPlayer(player)).toBe(true);
```

with:

```ts
  player.name = name;
  if (car) player.car = car;
  expect(room.addPlayer(player)).toBe(true);
```

In `tests/client/autoChoice.test.ts`:

<!-- op {"kind": "edit", "path": "tests/client/autoChoice.test.ts"} -->
```ts
  it('maps quick and create with the default name and colour', () => {
    expect(choice('auto=quick')).toEqual({ name: 'Guest', color: PALETTE[0], mode: 'quick' });
    expect(choice('auto=create&name=Max')).toEqual({ name: 'Max', color: PALETTE[0], mode: 'create' });
  });
```

with:

```ts
  it('maps quick and create with the default name and colour', () => {
    expect(choice('auto=quick')).toEqual({ name: 'Guest', color: PALETTE[0], car: 'sedan', mode: 'quick' });
    expect(choice('auto=create&name=Max')).toEqual({ name: 'Max', color: PALETTE[0], car: 'sedan', mode: 'create' });
  });
```

In `tests/client/autoChoice.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/autoChoice.test.ts"} -->
```ts
  it('normalises the room code for join', () => {
    expect(choice('auto=join:abcd&name=Ann')).toEqual({ name: 'Ann', color: PALETTE[0], mode: 'join', code: 'ABCD' });
  });
```

with:

```ts
  it('normalises the room code for join', () => {
    expect(choice('auto=join:abcd&name=Ann')).toEqual({ name: 'Ann', color: PALETTE[0], car: 'sedan', mode: 'join', code: 'ABCD' });
  });
```

In `tests/client/autoChoice.test.ts`, replace:

<!-- op {"kind": "edit", "path": "tests/client/autoChoice.test.ts"} -->
```ts

  it('picks the colour by palette index and copes with hostile values', () => {
```

with:

```ts

  it('picks the car by name, and the sedan for a name that is not a car', () => {
    expect(choice('auto=quick&car=pickup')!.car).toBe('pickup');
    expect(choice('auto=quick&car=coupe&name=Max')).toMatchObject({ car: 'coupe', name: 'Max' });
    for (const bad of ['tank', '', 'Pickup', '4', '__proto__']) expect(choice(`auto=quick&car=${bad}`)!.car).toBe('sedan');
  });

  it('picks the colour by palette index and copes with hostile values', () => {
```

In `tests/client/matchState.test.ts`, the cars of the fixtures:

<!-- op {"kind": "edit", "path": "tests/client/matchState.test.ts"} -->
```ts
const players: PlayerInfo[] = [
  { slot: 0, name: 'Ann', color: 0xd84a2b },
  { slot: 1, name: 'Bob', color: 0x2b6fd8 },
  { slot: 2, name: 'Rusty', color: 0x8a8f98, bot: true },
];
```

with:

```ts
const players: PlayerInfo[] = [
  { slot: 0, name: 'Ann', color: 0xd84a2b, car: 'sedan' },
  { slot: 1, name: 'Bob', color: 0x2b6fd8, car: 'coupe' },
  { slot: 2, name: 'Rusty', color: 0x8a8f98, car: 'pickup', bot: true },
];
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/cars.test.ts tests/server/roomCars.test.ts tests/client/profile.test.ts tests/protocol.test.ts tests/client/autoChoice.test.ts`
Expected: FAIL — there are no car ids, no profile module, and the parsers know no car

<!-- check {"cmd": "npx vitest run tests/cars.test.ts tests/server/roomCars.test.ts tests/client/profile.test.ts tests/protocol.test.ts tests/client/autoChoice.test.ts", "outcome": "fail", "match": "Cannot find module|FAIL|not a function|Failed|ENOENT"} -->

- [ ] **Step 3: Add the cars to the wire, the room and the menu**

Create `src/shared/cars.ts`:

<!-- op {"kind": "create", "path": "src/shared/cars.ts"} -->
```ts
/** The car models a player can choose from. They differ in looks only: every one has the physics, hitbox and tuning of `CAR`. */
export const CAR_IDS = ['sedan', 'coupe', 'wagon', 'pickup'] as const;
export type CarId = (typeof CAR_IDS)[number];
export const DEFAULT_CAR: CarId = 'sedan';

export const CAR_NAMES: Readonly<Record<CarId, string>> = { sedan: 'Sedan', coupe: 'Coupe', wagon: 'Wagon', pickup: 'Pickup' };

export const isCarId = (v: unknown): v is CarId => typeof v === 'string' && (CAR_IDS as readonly string[]).includes(v);

/** `v` when it names a car, the sedan otherwise: an old or odd client is never refused for its choice of car. */
export const carOrDefault = (v: unknown): CarId => (isCarId(v) ? v : DEFAULT_CAR);
```

In `src/shared/constants.ts` (protocol 5):

<!-- op {"kind": "edit", "path": "src/shared/constants.ts"} -->
```ts
export const NET = {
  /** 4: arenas: `vote` (client) and `votes` (server), `arena` in the welcome and the roster, `votes` in the welcome. 3: the welcome carries the round's latest hits (`dents`). 2: rounds, hit/ko/scores/results messages, `you` in the roster. */
  PROTOCOL_VERSION: 4,
  /** The welcome message carries this many of the round's latest hits (a newcomer replays them to dent the cars). */
```

with:

```ts
export const NET = {
  /** 5: car models: `hello.car` and `car` in every `PlayerInfo`. 4: arenas: `vote` (client) and `votes` (server), `arena` in the welcome and the roster, `votes` in the welcome. 3: the welcome carries the round's latest hits (`dents`). 2: rounds, hit/ko/scores/results messages, `you` in the roster. */
  PROTOCOL_VERSION: 5,
  /** The welcome message carries this many of the round's latest hits (a newcomer replays them to dent the cars). */
```

In `src/shared/protocol.ts`:

<!-- op {"kind": "edit", "path": "src/shared/protocol.ts"} -->
```ts
import { ARENA_IDS, isArenaId, type ArenaId } from './arenas';
import { ARENA, NET } from './constants';
```

with:

```ts
import { ARENA_IDS, isArenaId, type ArenaId } from './arenas';
import { carOrDefault, isCarId, type CarId } from './cars';
import { ARENA, NET } from './constants';
```

In `src/shared/protocol.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/protocol.ts"} -->
```ts
  code?: string;
}
```

with:

```ts
  code?: string;
  /** The model of the player\'s car; the sedan when the client names none or one that does not exist. */
  car: CarId;
}
```

In `src/shared/protocol.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/protocol.ts"} -->
```ts
  color: number;
  /** True for server-driven cars. */
```

with:

```ts
  color: number;
  /** The model of the car (looks only: every model has the same physics). */
  car: CarId;
  /** True for server-driven cars. */
```

In `src/shared/protocol.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/protocol.ts"} -->
```ts
    if (mode === 'join' && typeof code !== 'string') return null;
    return { t: 'hello', v: version, name, color, mode, code: typeof code === 'string' ? code : undefined };
  }
```

with:

```ts
    if (mode === 'join' && typeof code !== 'string') return null;
    return { t: 'hello', v: version, name, color, mode, code: typeof code === 'string' ? code : undefined, car: carOrDefault(v.car) };
  }
```

In `src/shared/protocol.ts`, replace:

<!-- op {"kind": "edit", "path": "src/shared/protocol.ts"} -->
```ts
const isPlayerInfo = (v: unknown): v is PlayerInfo =>
  isObj(v) && isSlot(v.slot) && typeof v.name === 'string' && isInt(v.color) && (v.bot === undefined || typeof v.bot === 'boolean');
const isScoreRow = (v: unknown): v is ScoreRow => isObj(v) && isSlot(v.slot) && isNum(v.score) && isNum(v.kills);
```

with:

```ts
const isPlayerInfo = (v: unknown): v is PlayerInfo =>
  isObj(v) && isSlot(v.slot) && typeof v.name === 'string' && isInt(v.color) && isCarId(v.car) && (v.bot === undefined || typeof v.bot === 'boolean');
const isScoreRow = (v: unknown): v is ScoreRow => isObj(v) && isSlot(v.slot) && isNum(v.score) && isNum(v.kills);
```

In `src/server/player.ts`:

<!-- op {"kind": "edit", "path": "src/server/player.ts"} -->
```ts
import { NET } from '../shared/constants';
```

with:

```ts
import { DEFAULT_CAR, type CarId } from '../shared/cars';
import { NET } from '../shared/constants';
```

In `src/server/player.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/player.ts"} -->
```ts
  color = 0xd84a2b;
  /** Seat number inside the room; -1 when not seated. */
```

with:

```ts
  color = 0xd84a2b;
  car: CarId = DEFAULT_CAR;
  /** Seat number inside the room; -1 when not seated. */
```

In `src/server/app.ts`:

<!-- op {"kind": "edit", "path": "src/server/app.ts"} -->
```ts
    player.color = msg.color;
    let result: JoinResult;
```

with:

```ts
    player.color = msg.color;
    player.car = msg.car;
    let result: JoinResult;
```

In `src/server/room.ts` (a participant has a car; a bot's is drawn from the room's seed and its number):

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
import { getArena, DEFAULT_ARENA, type ArenaDef, type ArenaId } from '../shared/arenas';
import { ARENA, NET, PHYSICS, ROUND } from '../shared/constants';
```

with:

```ts
import { getArena, DEFAULT_ARENA, type ArenaDef, type ArenaId } from '../shared/arenas';
import { CAR_IDS, type CarId } from '../shared/cars';
import { ARENA, NET, PHYSICS, ROUND } from '../shared/constants';
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
  color: number;
  /** Slot of this participant's car in the running round, or -1 while it waits for the next one. */
```

with:

```ts
  color: number;
  car: CarId;
  /** Slot of this participant's car in the running round, or -1 while it waits for the next one. */
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
  playerInfos(): PlayerInfo[] {
    return this.roundCars.map((p, slot) => (p.bot ? { slot, name: p.name, color: p.color, bot: true } : { slot, name: p.name, color: p.color }));
  }
```

with:

```ts
  playerInfos(): PlayerInfo[] {
    return this.roundCars.map((p, slot) => (p.bot ? { slot, name: p.name, color: p.color, car: p.car, bot: true } : { slot, name: p.name, color: p.color, car: p.car }));
  }
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
    if (this.disposed || this.isFull) return false;
    this.participants.push({ player, bot: false, name: player.name, color: player.color, slot: -1, score: 0, kills: 0 });
    player.slot = -1;
```

with:

```ts
    if (this.disposed || this.isFull) return false;
    this.participants.push({ player, bot: false, name: player.name, color: player.color, car: player.car, slot: -1, score: 0, kills: 0 });
    player.slot = -1;
```

In `src/server/room.ts`, replace:

<!-- op {"kind": "edit", "path": "src/server/room.ts"} -->
```ts
      color: BOT_COLORS[n % BOT_COLORS.length]!,
      slot: -1,
```

with:

```ts
      color: BOT_COLORS[n % BOT_COLORS.length]!,
      car: CAR_IDS[Math.floor(mulberry32((this.seed + n * 104_729) >>> 0)() * CAR_IDS.length)]!, // a model of its own, the same for the same room seed
      slot: -1,
```

`src/client/profile.ts` (what the menu used to do inline, now with the car, and testable):

Create `src/client/profile.ts`:

<!-- op {"kind": "create", "path": "src/client/profile.ts"} -->
```ts
import { DEFAULT_CAR, isCarId, type CarId } from '../shared/cars';

/** The colours a player can paint their car. */
export const PALETTE: readonly number[] = [0xd84a2b, 0x2b7fd8, 0x2fb457, 0xe0b122, 0x9b59d0, 0x18b5b5, 0xe8527d, 0xe9e9e9];

export const PROFILE_KEY = 'wreckyard.profile';

/** What the menu remembers about the player between visits. */
export interface Profile {
  name: string;
  color: number;
  car: CarId;
}

export const DEFAULT_PROFILE: Profile = { name: '', color: PALETTE[0]!, car: DEFAULT_CAR };

/** The saved profile, repaired one field at a time: a damaged field falls back to its default, and storage that is missing or throws is survived. */
export function loadProfile(storage: Pick<Storage, 'getItem'> | null): Profile {
  try {
    const raw = storage?.getItem(PROFILE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Record<string, unknown> | null;
      if (p && typeof p === 'object') {
        return {
          name: typeof p.name === 'string' ? p.name : DEFAULT_PROFILE.name,
          color: typeof p.color === 'number' && PALETTE.includes(p.color) ? p.color : DEFAULT_PROFILE.color,
          car: isCarId(p.car) ? p.car : DEFAULT_PROFILE.car,
        };
      }
    }
  } catch {
    /* storage unavailable or corrupt: fall through to defaults */
  }
  return { ...DEFAULT_PROFILE };
}

export function saveProfile(storage: Pick<Storage, 'setItem'> | null, profile: Profile): void {
  try {
    storage?.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    /* private mode: not fatal */
  }
}
```

In `src/client/ui/menu.ts` (the profile comes from `profile.ts`; a row of four car buttons above the colours; the choice is part of what the menu resolves with):

<!-- op {"kind": "edit", "path": "src/client/ui/menu.ts"} -->
```ts
import { normalizeRoomCode, type JoinMode } from '../../shared/protocol';
import { QUALITIES, type Quality, type Settings } from '../settings';
```

with:

```ts
import { normalizeRoomCode, type JoinMode } from '../../shared/protocol';
import { CAR_IDS, CAR_NAMES, type CarId } from '../../shared/cars';
import { PALETTE, loadProfile, saveProfile } from '../profile';
import { QUALITIES, type Quality, type Settings } from '../settings';
```

In `src/client/ui/menu.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/menu.ts"} -->
```ts
  color: number;
  mode: JoinMode;
```

with:

```ts
  color: number;
  car: CarId;
  mode: JoinMode;
```

In `src/client/ui/menu.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/menu.ts"} -->
```ts

export const PALETTE: readonly number[] = [0xd84a2b, 0x2b7fd8, 0x2fb457, 0xe0b122, 0x9b59d0, 0x18b5b5, 0xe8527d, 0xe9e9e9];

```

with:

```ts

export { PALETTE };

```

In `src/client/ui/menu.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/menu.ts"} -->
```ts

const STORE_KEY = 'wreckyard.profile';
interface Profile {
  name: string;
  color: number;
}

function loadProfile(): Profile {
  try {
```

with:

```ts

/** localStorage, or null where the browser refuses even to name it. */
function safeStorage(): Storage | null {
  try {
```

In `src/client/ui/menu.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/menu.ts"} -->
```ts
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Profile>;
      if (typeof p.name === 'string' && typeof p.color === 'number' && PALETTE.includes(p.color)) {
        return { name: p.name, color: p.color };
      }
    }
  } catch {
```

with:

```ts
  try {
    return localStorage;
  } catch {
```

In `src/client/ui/menu.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/menu.ts"} -->
```ts
  } catch {
    /* storage unavailable or corrupt: fall through to defaults */
  }
  return { name: '', color: PALETTE[0]! };
}

function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(p));
  } catch {
    /* private mode: not fatal */
  }
```

with:

```ts
  } catch {
    return null;
  }
```

In `src/client/ui/menu.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/menu.ts"} -->
```ts
export function showMenu(root: HTMLElement, options: MenuOptions = {}): Promise<JoinChoice> {
  const profile = loadProfile();
  root.replaceChildren();
```

with:

```ts
export function showMenu(root: HTMLElement, options: MenuOptions = {}): Promise<JoinChoice> {
  const profile = loadProfile(safeStorage());
  root.replaceChildren();
```

In `src/client/ui/menu.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/menu.ts"} -->
```ts
    <label>Driver name<input id="m-name" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Your name" /></label>
    <div class="swatches" id="m-colors" role="radiogroup" aria-label="Car colour"></div>
```

with:

```ts
    <label>Driver name<input id="m-name" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Your name" /></label>
    <div class="cars" id="m-cars" role="radiogroup" aria-label="Car model"></div>
    <div class="swatches" id="m-colors" role="radiogroup" aria-label="Car colour"></div>
```

In `src/client/ui/menu.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/menu.ts"} -->
```ts
  const swatches = q<HTMLElement>('#m-colors');
  nameInput.value = profile.name;
```

with:

```ts
  const swatches = q<HTMLElement>('#m-colors');
  const cars = q<HTMLElement>('#m-cars');
  nameInput.value = profile.name;
```

In `src/client/ui/menu.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/menu.ts"} -->
```ts

  let color = profile.color;
```

with:

```ts

  let car = profile.car;
  for (const id of CAR_IDS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'car';
    b.dataset.car = id;
    b.textContent = CAR_NAMES[id];
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(id === car));
    b.addEventListener('click', () => {
      car = id;
      for (const c of cars.children) c.setAttribute('aria-checked', String(c === b));
    });
    cars.append(b);
  }

  let color = profile.color;
```

In `src/client/ui/menu.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/menu.ts"} -->
```ts
      }
      saveProfile({ name, color });
      resolve({ name, color, mode, code });
    };
```

with:

```ts
      }
      saveProfile(safeStorage(), { name, color, car });
      resolve({ name, color, car, mode, code });
    };
```

In `src/client/ui/autoChoice.ts`:

<!-- op {"kind": "edit", "path": "src/client/ui/autoChoice.ts"} -->
```ts
import { normalizeRoomCode } from '../../shared/protocol';
import { PALETTE, type JoinChoice } from './menu';

```

with:

```ts
import { normalizeRoomCode } from '../../shared/protocol';
import { carOrDefault } from '../../shared/cars';
import { PALETTE } from '../profile';
import type { JoinChoice } from './menu';

```

In `src/client/ui/autoChoice.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/autoChoice.ts"} -->
```ts

/** ?auto=quick | create | join:CODE (+ &name= &color=<palette index>) skips the menu — for links and automated checks. */
export function automaticChoice(params: URLSearchParams): JoinChoice | null {
```

with:

```ts

/** ?auto=quick | create | join:CODE (+ &name= &color=<palette index> &car=<sedan|coupe|wagon|pickup>) skips the menu — for links and automated checks. */
export function automaticChoice(params: URLSearchParams): JoinChoice | null {
```

In `src/client/ui/autoChoice.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/autoChoice.ts"} -->
```ts
  const color = PALETTE[Math.floor(Math.abs(Number(params.get('color') ?? 0))) % PALETTE.length] ?? PALETTE[0]!;
  if (auto === 'quick' || auto === 'create') return { name, color, mode: auto };
  if (auto.startsWith('join:')) {
```

with:

```ts
  const color = PALETTE[Math.floor(Math.abs(Number(params.get('color') ?? 0))) % PALETTE.length] ?? PALETTE[0]!;
  const car = carOrDefault(params.get('car'));
  if (auto === 'quick' || auto === 'create') return { name, color, car, mode: auto };
  if (auto.startsWith('join:')) {
```

In `src/client/ui/autoChoice.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/autoChoice.ts"} -->
```ts
    const code = normalizeRoomCode(auto.slice(5));
    if (code) return { name, color, mode: 'join', code };
  }
```

with:

```ts
    const code = normalizeRoomCode(auto.slice(5));
    if (code) return { name, color, car, mode: 'join', code };
  }
```

In `src/client/game/gameClient.ts`, the hello names the car:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
      color: choice.color,
      mode: choice.mode,
```

with:

```ts
      color: choice.color,
      car: choice.car,
      mode: choice.mode,
```

In `src/client/index.html`, the picker's style:

<!-- op {"kind": "edit", "path": "src/client/index.html"} -->
```html
        outline-offset: 2px;
      }
```

with:

```html
        outline-offset: 2px;
      }
      .cars {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 6px;
        margin: 10px 0 6px;
      }
      .car {
        padding: 8px 4px;
        font: inherit;
        font-size: 13px;
        color: var(--ink);
        background: transparent;
        border: 1px solid var(--line);
        border-radius: 8px;
        cursor: pointer;
      }
      .car[aria-checked='true'] {
        border-color: var(--accent);
        box-shadow: 0 0 0 2px var(--accent);
      }
```

- [ ] **Step 4: Run the tests, then the whole suite, then the hash**

Run: `npx vitest run tests/cars.test.ts tests/server/roomCars.test.ts tests/client/profile.test.ts tests/protocol.test.ts tests/client/autoChoice.test.ts`
Expected: all pass

<!-- check {"cmd": "npx vitest run tests/cars.test.ts tests/server/roomCars.test.ts tests/client/profile.test.ts tests/protocol.test.ts tests/client/autoChoice.test.ts", "outcome": "pass"} -->

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 846} -->

Run: `npm run hash`
Expected: prints `8719c2e8`, unchanged

<!-- check {"cmd": "npm run hash", "outcome": "pass", "match": "8719c2e8"} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: four cars to choose from \u2014 the menu picker, protocol 5, the car in the roster, a model for each bot"
```

<!-- commit "feat: four cars to choose from \u2014 the menu picker, protocol 5, the car in the roster, a model for each bot" -->

---

### Task 69: The four car models, densified for dents

**Files:**
- Create: `art/cars/densify_cars.py`, `art/cars/src/derby_{sedan,coupe,wagon,pickup}_game.glb` (copied in), `src/client/assets/car_{sedan,coupe,wagon,pickup}.glb` and `.png` (the script writes them), `src/client/game/carAssets.ts`, `tests/client/carAssets.test.ts`
- Modify: `tests/client/arenaAssets.test.ts`

**Interfaces:**
- Consumes: Blender 5, the four car models the owner modelled (`art/derby-<car>/derby_<car>_game.glb` in the working copy where the car scenes live: about 10 500 triangles each, named nodes, one `paint.001` material), `CAR.WHEEL` (Plan 1).
- Produces: `CAR_MODEL_URLS` and `CAR_PICTURE_URLS` (car id → served URL); four models of 14 000 to 15 900 triangles in which every long edge of a dentable panel is cut to 35 cm or less, shaded smooth with sharp creases kept; four menu pictures (360x200, transparent). The nodes the game uses by name: `body`, `hood`, `trunk` (sedan and coupe only), `door_L`, `door_R`, `bumper_F`, `bumper_R` (and `_rubber`), `wheel_FL/FR/RL/RR`, and the one material named `paint*`.

- [ ] **Step 1: Write the tests**

The models are generated files, so the test holds them to what the game needs: a valid self-contained GLB under 600 KB and 17 000 triangles (eight cars are on screen at once), every named piece present (and a trunk on the sedan and the coupe only), exactly one paint material, **wheels at the physics wheels' places with their centres one radius above the model's origin (so the origin is the ground)**, a body about the size of the physics car (4.2 to 4.9 m long and under 2.25 m wide — the fenders are a few centimetres wider than the 2.0 m hitbox, which every model shares), no transformed node except the wheels and the number decals, and a small picture each. The test of the arena models now looks only at the `arena_` files.

Create `tests/client/carAssets.test.ts`:

<!-- op {"kind": "create", "path": "tests/client/carAssets.test.ts"} -->
```ts
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAR_MODEL_URLS, CAR_PICTURE_URLS } from '../../src/client/game/carAssets';
import { CAR_IDS, type CarId } from '../../src/shared/cars';
import { CAR } from '../../src/shared/constants';

const ASSETS = path.resolve('src/client/assets');
/** The pieces the game moves, hides or tints by name. */
const REQUIRED = ['body', 'hood', 'door_L', 'door_R', 'bumper_F', 'bumper_R', 'wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'];
const HAS_TRUNK: Record<CarId, boolean> = { sedan: true, coupe: true, wagon: false, pickup: false };

interface Accessor {
  count: number;
  min?: number[];
  max?: number[];
}
interface Gltf {
  asset: { version: string };
  nodes: Array<{ name?: string; mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[] }>;
  meshes: Array<{ primitives: Array<{ attributes: { POSITION: number }; indices?: number }> }>;
  materials?: Array<{ name?: string }>;
  accessors: Accessor[];
  images?: unknown[];
  buffers: Array<{ uri?: string }>;
}

function readGlb(file: string): Gltf {
  const data = readFileSync(file);
  expect(data.toString('latin1', 0, 4)).toBe('glTF');
  expect(data.readUInt32LE(8)).toBe(data.length);
  return JSON.parse(data.toString('utf8', 20, 20 + data.readUInt32LE(12))) as Gltf;
}

describe('the car models', () => {
  it('are served from a URL each, with a picture for the menu', () => {
    expect(Object.keys(CAR_MODEL_URLS).sort()).toEqual([...CAR_IDS].sort());
    for (const id of CAR_IDS) {
      expect(CAR_MODEL_URLS[id]).toMatch(/\.glb/);
      expect(CAR_PICTURE_URLS[id]).toMatch(/\.png/);
    }
  });

  for (const id of CAR_IDS) {
    describe(id, () => {
      const file = path.join(ASSETS, `car_${id}.glb`);
      const gltf = readGlb(file);
      const named = (name: string) => gltf.nodes.find((n) => n.name === name);

      it('is small: under 600 KB, a valid GLB with everything inside the file', () => {
        expect(statSync(file).size).toBeLessThan(600 * 1024);
        expect(gltf.asset.version).toBe('2.0');
        expect(gltf.images ?? []).toEqual([]);
        for (const b of gltf.buffers) expect(b.uri).toBeUndefined();
      });

      it('is cheap enough for eight on screen: under 17 000 triangles', () => {
        let triangles = 0;
        for (const mesh of gltf.meshes) for (const p of mesh.primitives) triangles += (p.indices === undefined ? gltf.accessors[p.attributes.POSITION]!.count : gltf.accessors[p.indices]!.count) / 3;
        expect(triangles).toBeGreaterThan(8000);
        expect(triangles).toBeLessThan(17_000);
      });

      it('has the pieces the game moves, hides and tints by name, and one paint material', () => {
        for (const name of REQUIRED) expect(named(name), name).toBeDefined();
        expect(named('trunk') !== undefined).toBe(HAS_TRUNK[id]);
        expect((gltf.materials ?? []).filter((m) => /^paint/.test(m.name ?? ''))).toHaveLength(1);
      });

      it('has its wheels where the physics has them, standing on the ground', () => {
        for (const [name, sx, sz] of [['wheel_FR', 1, 1], ['wheel_FL', 1, -1], ['wheel_RR', -1, 1], ['wheel_RL', -1, -1]] as const) {
          const t = named(name)!.translation!;
          expect(t[0]).toBeCloseTo(sx * CAR.WHEEL.X, 2);
          expect(t[1]).toBeCloseTo(CAR.WHEEL.RADIUS, 2); // the model's origin is on the ground
          expect(t[2]).toBeCloseTo(sz * CAR.WHEEL.Z, 2);
        }
      });

      it('is about the size of the physics car (4.6 x 2.0 m, the fenders a few centimetres wider): every model shares one hitbox', () => {
        const mesh = gltf.meshes[named('body')!.mesh!]!;
        const a = gltf.accessors[mesh.primitives[0]!.attributes.POSITION]!;
        expect(a.max![0]! - a.min![0]!).toBeGreaterThan(4.2);
        expect(a.max![0]! - a.min![0]!).toBeLessThan(4.9);
        expect(a.max![2]! - a.min![2]!).toBeGreaterThan(1.7);
        expect(a.max![2]! - a.min![2]!).toBeLessThan(2.25);
      });

      it('moves, turns and scales nothing but the wheels and the number decals', () => {
        const moved = gltf.nodes.filter((n) => n.translation || n.rotation || n.scale).map((n) => n.name);
        for (const name of moved) expect(name, 'a node with a transform').toMatch(/^(wheel_|number_)/);
      });

      it('has a picture for the menu', () => {
        const png = path.join(ASSETS, `car_${id}.png`);
        expect(readFileSync(png).toString('latin1', 1, 4)).toBe('PNG');
        expect(statSync(png).size).toBeLessThan(120 * 1024);
      });
    });
  }
});
```

In `tests/client/arenaAssets.test.ts`:

<!-- op {"kind": "edit", "path": "tests/client/arenaAssets.test.ts"} -->
```ts
  it('exist for the three arenas that have scenery, and for none other', () => {
    expect(readdirSync(ASSETS).filter((f) => f.endsWith('.glb')).sort()).toEqual(SCENERY.map((id) => `arena_${id}.glb`).sort());
    expect(Object.keys(ARENA_SCENERY_URLS).sort()).toEqual([...SCENERY].sort());
```

with:

```ts
  it('exist for the three arenas that have scenery, and for none other', () => {
    expect(readdirSync(ASSETS).filter((f) => f.startsWith('arena_') && f.endsWith('.glb')).sort()).toEqual(SCENERY.map((id) => `arena_${id}.glb`).sort());
    expect(Object.keys(ARENA_SCENERY_URLS).sort()).toEqual([...SCENERY].sort());
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/client/carAssets.test.ts`
Expected: FAIL — there is no `carAssets.ts` and no model

<!-- check {"cmd": "npx vitest run tests/client/carAssets.test.ts", "outcome": "fail", "match": "Cannot find module|FAIL|not a function|Failed|ENOENT"} -->

- [ ] **Step 3: Bring the sources in and write the Blender script**

The four exported car models (the owner's Blender scenes are outside this repository) are copied into `art/cars/src/` and committed as the sources of this step: about 1.3 MB. The script imports each, cuts the long edges of the panels a dent can bend (body, hood, trunk, doors, bumpers, roof, the pickup's bed and the coupe's stripes) until none is longer than 0.35 m, triangulates, shades smooth by angle (38°), exports the GLB, and renders the menu picture from a three-quarter view on a transparent ground. Everything else is left as modelled; the glass keeps its transmission in the file (the game turns it into plain transparency, see Task 71).

Run: `mkdir -p art/cars/src && for c in sedan coupe wagon pickup; do cp /Users/guilhemduche/Documents/Github/3DTest/art/derby-$c/derby_${c}_game.glb art/cars/src/; done && ls art/cars/src`
Expected: four files, `derby_<car>_game.glb`

<!-- check {"cmd": "mkdir -p art/cars/src && for c in sedan coupe wagon pickup; do cp /Users/guilhemduche/Documents/Github/3DTest/art/derby-$c/derby_${c}_game.glb art/cars/src/; done && ls art/cars/src", "outcome": "pass", "match": "derby_coupe_game\\.glb[\\s\\S]*derby_pickup_game\\.glb[\\s\\S]*derby_sedan_game\\.glb[\\s\\S]*derby_wagon_game\\.glb"} -->

Create `art/cars/densify_cars.py`:

<!-- op {"kind": "create", "path": "art/cars/densify_cars.py"} -->
```
"""Turns the four car models of `art/cars/src` (exported from the Blender car scenes, about 10 000 triangles each) into the models the game
loads: the body panels that a dent can push around are given a vertex about every 0.35 m, so a dent bends them instead of tearing a few
long triangles, and the surface is shaded smooth with sharp creases kept. Everything else is left as modelled.

    /Applications/Blender.app/Contents/MacOS/Blender -b --python art/cars/densify_cars.py
    CAR=sedan PREVIEW=<folder> ...    one car, and a picture of it per car in PREVIEW

Environment: CAR (sedan | coupe | wagon | pickup | all), OUT (default src/client/assets), SRC (default art/cars/src), PREVIEW (folder for
`car_<id>.png`; the menu shows them; default: next to the models), MAXLEN (longest edge left on a dentable panel, default 0.35 m).

The game relies on the node names: body, hood, trunk (not on the wagon or the pickup), door_L, door_R, bumper_F, bumper_R (+ `_rubber`),
wheel_FL/FR/RL/RR, and the one material named `paint*`, which is tinted with the player's colour.
"""
import math
import os

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SRC = os.environ.get('SRC', os.path.join(HERE, 'src'))
OUT = os.environ.get('OUT', os.path.join(ROOT, 'src', 'client', 'assets'))
PREVIEW = os.environ.get('PREVIEW', OUT)
MAXLEN = float(os.environ.get('MAXLEN', '0.35'))
CARS = ['sedan', 'coupe', 'wagon', 'pickup']
# the panels that are long and flat enough to need more vertices; the rest of the car follows the dent by position
DENSIFY = ('body', 'hood', 'trunk', 'door_L', 'door_R', 'bumper_F', 'bumper_R', 'roof', 'bed', 'stripe_hood_1', 'stripe_hood_-1',
           'stripe_deck_1', 'stripe_deck_-1', 'stripe_roof_1', 'stripe_roof_-1')


def densify(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for _ in range(5):
        long_edges = [e for e in bm.edges if e.calc_length() > MAXLEN]
        if not long_edges:
            break
        bmesh.ops.subdivide_edges(bm, edges=long_edges, cuts=1, use_grid_fill=True)
        bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def triangles(objects):
    total = 0
    for ob in objects:
        ob.data.calc_loop_triangles()
        total += len(ob.data.loop_triangles)
    return total


def build(car):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    path = os.path.join(SRC, f'derby_{car}_game.glb')
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    before = triangles(meshes)
    for ob in meshes:
        if ob.name in DENSIFY:
            densify(ob)
            bpy.context.view_layer.objects.active = ob
            bpy.ops.object.select_all(action='DESELECT')
            ob.select_set(True)
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(38))
    after = triangles(meshes)
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, f'car_{car}.glb')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=False, export_yup=True, export_apply=True,
                              export_materials='EXPORT', export_cameras=False, export_lights=False, export_image_format='AUTO')
    print(f'{car}: {before} -> {after} triangles, wrote {out} ({os.path.getsize(out) // 1024} KB)')
    render(car)


def render(car):
    """A three-quarter picture on a transparent ground, for the menu."""
    scn = bpy.context.scene
    scn.render.engine = 'CYCLES'
    scn.cycles.device = 'CPU'
    scn.cycles.samples = 24
    scn.cycles.use_denoising = False
    scn.render.film_transparent = True
    scn.render.resolution_x, scn.render.resolution_y = 360, 200
    scn.view_settings.view_transform = 'AgX'
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.8, 0.85, 1.0, 1.0)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    scn.world = world
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.5
    sob = bpy.data.objects.new('sun', sun)
    sob.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    scn.collection.objects.link(sob)
    cam = bpy.data.cameras.new('cam')
    cam.lens = 48
    cob = bpy.data.objects.new('cam', cam)
    scn.collection.objects.link(cob)
    scn.camera = cob
    pos = Vector((6.4, -5.6, 2.3))
    cob.location = pos
    cob.rotation_euler = (Vector((0, 0, 0.75)) - pos).to_track_quat('-Z', 'Y').to_euler()
    scn.render.filepath = os.path.join(PREVIEW, f'car_{car}.png')
    bpy.ops.render.render(write_still=True)


which = os.environ.get('CAR', 'all')
for name in (CARS if which == 'all' else [which]):
    build(name)
```

- [ ] **Step 4: Build the models**

Run: `/Applications/Blender.app/Contents/MacOS/Blender -b --python art/cars/densify_cars.py`
Expected: for each car `<before> -> <after> triangles, wrote .../car_<id>.glb` (sedan 10626 -> 13976, coupe 10538 -> 14002, wagon 10434 -> 14044, pickup 11312 -> 15868, each 380 to 450 KB) and a `car_<id>.png`

<!-- check {"cmd": "/Applications/Blender.app/Contents/MacOS/Blender -b --python art/cars/densify_cars.py", "outcome": "pass", "match": "sedan: 10626 -> 13976[\\s\\S]*coupe: 10538 -> 14002[\\s\\S]*wagon: 10434 -> 14044[\\s\\S]*pickup: 11312 -> 15868"} -->

`src/client/game/carAssets.ts` (Vite turns each `?url` import into the hashed URL of the file in the build):

Create `src/client/game/carAssets.ts`:

<!-- op {"kind": "create", "path": "src/client/game/carAssets.ts"} -->
```ts
import type { CarId } from '../../shared/cars';
import coupePicture from '../assets/car_coupe.png?url';
import coupeModel from '../assets/car_coupe.glb?url';
import pickupPicture from '../assets/car_pickup.png?url';
import pickupModel from '../assets/car_pickup.glb?url';
import sedanPicture from '../assets/car_sedan.png?url';
import sedanModel from '../assets/car_sedan.glb?url';
import wagonPicture from '../assets/car_wagon.png?url';
import wagonModel from '../assets/car_wagon.glb?url';

/**
 * Where the Blender model of each car is served from (`art/cars/densify_cars.py` writes the files), and the picture of it the menu
 * shows. A car whose model fails to load is drawn as the boxes `CarView` builds itself.
 */
export const CAR_MODEL_URLS: Readonly<Record<CarId, string>> = { sedan: sedanModel, coupe: coupeModel, wagon: wagonModel, pickup: pickupModel };
export const CAR_PICTURE_URLS: Readonly<Record<CarId, string>> = { sedan: sedanPicture, coupe: coupePicture, wagon: wagonPicture, pickup: pickupPicture };
```

- [ ] **Step 5: Run the tests, then the whole suite**

Run: `npx vitest run tests/client/carAssets.test.ts tests/client/arenaAssets.test.ts`
Expected: both pass

<!-- check {"cmd": "npx vitest run tests/client/carAssets.test.ts tests/client/arenaAssets.test.ts", "outcome": "pass"} -->

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 875} -->

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(art): the four car models with a vertex every 35 cm on the panels a dent can bend, and a menu picture of each"
```

<!-- commit "feat(art): the four car models with a vertex every 35 cm on the panels a dent can bend, and a menu picture of each" -->

---

### Task 70: One model cache for arenas and cars

**Files:**
- Create: `src/client/game/modelCache.ts`, `src/client/game/carModels.ts`, `tests/client/carModels.test.ts`
- Modify: `src/client/game/arenaScenery.ts`

**Interfaces:**
- Consumes: `ArenaScenery` (Plan 9: on request, once, `null` on failure, retried later), `CAR_MODEL_URLS` (Task 69).
- Produces: `ModelCache<K>(urls, load, now?, retryMs?)` with `has`, `peek`, `request`, `dispose`, and `loadGltfScenery` (moved from `arenaScenery.ts`, which keeps exporting them); `ArenaScenery extends ModelCache<ArenaId>`; `CarModels extends ModelCache<CarId>` with `preloadAll()`.

- [ ] **Step 1: Write the test**

Plan 9's loader tests keep covering the logic (they pass unchanged through the subclass). New: the car models know all four cars, ask for each file once however often they are told to preload, and one car's failed file does not stop the others.

Create `tests/client/carModels.test.ts`:

<!-- op {"kind": "create", "path": "tests/client/carModels.test.ts"} -->
```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CarModels } from '../../src/client/game/carModels';
import { CAR_IDS } from '../../src/shared/cars';

describe('CarModels', () => {
  it('has a model for each of the four cars', () => {
    const models = new CarModels(() => Promise.resolve(new THREE.Group()));
    for (const id of CAR_IDS) expect(models.has(id)).toBe(true);
  });

  it('asks for every model once when told to preload, however often that is', async () => {
    const asked: string[] = [];
    const models = new CarModels((url) => {
      asked.push(url);
      return Promise.resolve(new THREE.Group());
    });
    models.preloadAll();
    models.preloadAll();
    await Promise.all(CAR_IDS.map((id) => models.request(id)));
    expect(asked).toHaveLength(4);
    expect(new Set(asked).size).toBe(4);
    for (const id of CAR_IDS) expect(models.peek(id)).not.toBeNull();
  });

  it('answers null for a car whose file does not load, and the others still do', async () => {
    const models = new CarModels((url) => (url.includes('coupe') ? Promise.reject(new Error('404')) : Promise.resolve(new THREE.Group())));
    expect(await models.request('coupe')).toBeNull();
    expect(await models.request('sedan')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/client/carModels.test.ts`
Expected: FAIL — the module does not exist

<!-- check {"cmd": "npx vitest run tests/client/carModels.test.ts", "outcome": "fail", "match": "Cannot find module|FAIL|not a function|Failed|ENOENT"} -->

- [ ] **Step 3: Make the cache generic**

Create `src/client/game/modelCache.ts`:

<!-- op {"kind": "create", "path": "src/client/game/modelCache.ts"} -->
```ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Loads one model. Tests give a fake one; the game uses `loadGltfScenery`. */
export type SceneryLoad = (url: string) => Promise<THREE.Object3D>;

export const loadGltfScenery: SceneryLoad = async (url) => (await new GLTFLoader().loadAsync(url)).scene;

/**
 * Blender models by name (arenas, cars): loaded on request, kept for the rest of the session, never asked for twice at once. A name that
 * has no model, or whose model fails to load, answers `null` (the caller draws its plain fallback); a failed file is tried again after
 * `retryMs`. The models are shared: add a clone of one to a scene and never dispose what it holds; `dispose` frees them all.
 */
export class ModelCache<K extends string> {
  private readonly ready = new Map<K, THREE.Object3D>();
  private readonly pending = new Map<K, Promise<THREE.Object3D | null>>();
  private readonly failedAt = new Map<K, number>();
  private disposed = false;

  constructor(
    private readonly urls: Readonly<Partial<Record<K, string>>>,
    private readonly load: SceneryLoad,
    private readonly now: () => number = () => performance.now(),
    private readonly retryMs = 15_000,
  ) {}

  /** True when there is a model to load for this arena. */
  has(id: K): boolean {
    return this.urls[id] !== undefined;
  }

  /** The model, when it is loaded already. Shared: add a clone of it to a scene and never dispose what it holds. */
  peek(id: K): THREE.Object3D | null {
    return this.ready.get(id) ?? null;
  }

  request(id: K): Promise<THREE.Object3D | null> {
    const url = this.urls[id];
    if (url === undefined || this.disposed) return Promise.resolve(null);
    const have = this.ready.get(id);
    if (have) return Promise.resolve(have);
    const pending = this.pending.get(id);
    if (pending) return pending;
    const failed = this.failedAt.get(id);
    if (failed !== undefined && this.now() - failed < this.retryMs) return Promise.resolve(null);
    let loading: Promise<THREE.Object3D>;
    try {
      loading = this.load(url);
    } catch (err) {
      loading = Promise.reject(err); // a loader that throws is a loader that fails
    }
    const started = loading
      .then(
        (model): THREE.Object3D | null => {
          if (this.disposed) {
            freeModel(model);
            return null;
          }
          this.ready.set(id, model);
          this.failedAt.delete(id);
          return model;
        },
        (): null => {
          this.failedAt.set(id, this.now());
          return null;
        },
      )
      .finally(() => this.pending.delete(id)); // always after `pending.set` below: a callback of a promise never runs synchronously
    this.pending.set(id, started);
    return started;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of this.ready.values()) freeModel(model);
    this.ready.clear();
  }
}

function freeModel(model: THREE.Object3D): void {
  const seen = new Set<THREE.Material>();
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    for (const m of [o.material].flat()) {
      if (seen.has(m)) continue;
      seen.add(m);
      m.dispose();
    }
  });
}
```

In `src/client/game/arenaScenery.ts`, the cache moves out and the arena loader is a subclass:

<!-- op {"kind": "edit", "path": "src/client/game/arenaScenery.ts"} -->
```ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ARENA_IDS, type ArenaId } from '../../shared/arenas';
```

with:

```ts
import { ARENA_IDS, type ArenaId } from '../../shared/arenas';
```

In `src/client/game/arenaScenery.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/arenaScenery.ts"} -->
```ts
import type { VoteCounts } from '../../shared/protocol';

```

with:

```ts
import type { VoteCounts } from '../../shared/protocol';
import { ModelCache, loadGltfScenery, type SceneryLoad } from './modelCache';

```

In `src/client/game/arenaScenery.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/arenaScenery.ts"} -->
```ts

/** Loads one model. Tests give a fake one; the game uses `loadGltfScenery`. */
export type SceneryLoad = (url: string) => Promise<THREE.Object3D>;

export const loadGltfScenery: SceneryLoad = async (url) => (await new GLTFLoader().loadAsync(url)).scene;

```

with:

```ts

export { loadGltfScenery, type SceneryLoad };

```

In `src/client/game/arenaScenery.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/arenaScenery.ts"} -->
```ts
 * The Blender scenery of the arenas: loaded on request (the game asks for the arenas leading the vote, so the winner is ready for the
 * countdown), kept for the rest of the session, and never asked for twice at once. An arena that has no model, or whose model fails
 * to load, answers `null` and is drawn as the boxes of its layout; a failed file is tried again after `retryMs`.
 */
```

with:

```ts
 * The Blender scenery of the arenas: loaded on request (the game asks for the arenas leading the vote, so the winner is ready for the
 * countdown). An arena that has no model, or whose model fails to load, is drawn as the boxes of its layout.
 */
```

In `src/client/game/arenaScenery.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/arenaScenery.ts"} -->
```ts
 */
export class ArenaScenery {
  private readonly ready = new Map<ArenaId, THREE.Object3D>();
  private readonly pending = new Map<ArenaId, Promise<THREE.Object3D | null>>();
  private readonly failedAt = new Map<ArenaId, number>();
  private disposed = false;

  constructor(
    private readonly urls: Readonly<Partial<Record<ArenaId, string>>>,
    private readonly load: SceneryLoad,
    private readonly now: () => number = () => performance.now(),
    private readonly retryMs = 15_000,
  ) {}

  /** True when there is a model to load for this arena. */
  has(id: ArenaId): boolean {
    return this.urls[id] !== undefined;
  }

  /** The model, when it is loaded already. Shared: add a clone of it to a scene and never dispose what it holds. */
  peek(id: ArenaId): THREE.Object3D | null {
    return this.ready.get(id) ?? null;
  }

  request(id: ArenaId): Promise<THREE.Object3D | null> {
    const url = this.urls[id];
    if (url === undefined || this.disposed) return Promise.resolve(null);
    const have = this.ready.get(id);
    if (have) return Promise.resolve(have);
    const pending = this.pending.get(id);
    if (pending) return pending;
    const failed = this.failedAt.get(id);
    if (failed !== undefined && this.now() - failed < this.retryMs) return Promise.resolve(null);
    let loading: Promise<THREE.Object3D>;
    try {
      loading = this.load(url);
    } catch (err) {
      loading = Promise.reject(err); // a loader that throws is a loader that fails
    }
    const started = loading
      .then(
        (model): THREE.Object3D | null => {
          if (this.disposed) {
            freeModel(model);
            return null;
          }
          this.ready.set(id, model);
          this.failedAt.delete(id);
          return model;
        },
        (): null => {
          this.failedAt.set(id, this.now());
          return null;
        },
      )
      .finally(() => this.pending.delete(id)); // always after `pending.set` below: a callback of a promise never runs synchronously
    this.pending.set(id, started);
    return started;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of this.ready.values()) freeModel(model);
    this.ready.clear();
  }
}

function freeModel(model: THREE.Object3D): void {
  const seen = new Set<THREE.Material>();
  model.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    for (const m of [o.material].flat()) {
      if (seen.has(m)) continue;
      seen.add(m);
      m.dispose();
    }
  });
}

```

with:

```ts
 */
export class ArenaScenery extends ModelCache<ArenaId> {}

```

Create `src/client/game/carModels.ts`:

<!-- op {"kind": "create", "path": "src/client/game/carModels.ts"} -->
```ts
import { CAR_IDS, type CarId } from '../../shared/cars';
import { CAR_MODEL_URLS } from './carAssets';
import { ModelCache, loadGltfScenery, type SceneryLoad } from './modelCache';

/** The Blender models of the cars, loaded in the background (a `CarView` is drawn as boxes until its model is here). */
export class CarModels extends ModelCache<CarId> {
  constructor(load: SceneryLoad = loadGltfScenery, urls: Readonly<Partial<Record<CarId, string>>> = CAR_MODEL_URLS) {
    super(urls, load);
  }

  /** Asks for every model at once (about 1.6 MB in all, kept for the session). */
  preloadAll(): void {
    for (const id of CAR_IDS) void this.request(id);
  }
}
```

- [ ] **Step 4: Run the tests, then the whole suite**

Run: `npx vitest run tests/client/carModels.test.ts tests/client/arenaScenery.test.ts`
Expected: both pass

<!-- check {"cmd": "npx vitest run tests/client/carModels.test.ts tests/client/arenaScenery.test.ts", "outcome": "pass"} -->

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 878} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(client): one model cache for the arena scenery and the car models"
```

<!-- commit "refactor(client): one model cache for the arena scenery and the car models" -->

---

### Task 71: CarView draws a Blender model: paint, wheels, dents, parts, detail

**Files:**
- Create: `tests/helpers/carModel.ts`, `tests/client/carViewModel.test.ts`
- Modify: `src/client/game/dents.ts`, `src/client/game/carView.ts`

**Interfaces:**
- Consumes: `CarView`, `DentSurface`, `Dent`, `PartId`, `DetachedPart` (Plans 5-6), `CAR.WHEEL`, `REST_SUSPENSION`, `CarId` (Task 68).
- Produces: `new CarView(color, car?)` with `car`; `useModel(model)`, `usesModel`, `setDetail(full)`; `GROUND_Y` (where a model's origin sits in the car's frame: the ground, `CAR.WHEEL.HARD_Y - REST_SUSPENSION - CAR.WHEEL.RADIUS`); `DentSurface(geometry, origin, smooth?)`. A car without a model is drawn as before; with one, the paint, wheels, dents and parts are the model's.

- [ ] **Step 1: Write the tests**

A stand-in model with the structure of the real ones (the nodes found by name, vertices already in the model's coordinates, wheels as nodes at their centres, a `paint.001` material, a glass with transmission) is built in `tests/helpers/carModel.ts`, so the view is tested without a file. The cases: the model replaces the boxes and its ground is the car's ground; **each car gets its own paint and its own copy of the panels, and shares everything else** (a dent on one car leaves another, and the loaded model, as they were); the paint follows `setColor` and the wreck look; the glass loses its transmission (it would cost a whole extra rendering pass every frame) and stays see-through; the wheels sit in the physics wheels' spinners, steer and spin as the boxes' did; a dent bends the bodywork and the panels around it but not the wheels, decals or interior, and the bent surface is shaded again; a part comes off by name with its place, size and colour (a painted part in the player's paint), a car with no trunk has none to lose; **damage taken before the model arrived is put on it** (a newcomer's welcome replays the hits at once, the model comes a moment later); the Low detail leaves out the interior, decals and small trim, also when it was decided before the model came; everything the view made is freed and nothing it shares; and a second model replaces the first.

Create `tests/helpers/carModel.ts`:

<!-- op {"kind": "create", "path": "tests/helpers/carModel.ts"} -->
```ts
import * as THREE from 'three';
import { CAR } from '../../src/shared/constants';

export interface FakeCarOptions {
  /** The wagon and the pickup have no trunk lid. */
  trunk?: boolean;
}

/**
 * A stand-in for a loaded car model with the structure the real ones have (the nodes the game finds by name, the vertices already in
 * the model's own coordinates with its origin on the ground, the wheels as nodes at their centres, one `paint*` material, a glass that
 * asks for transmission), so `CarView.useModel` is tested without a file.
 */
export function fakeCarModel(options: FakeCarOptions = {}): THREE.Group {
  const root = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ name: 'paint.001', color: 0xc08020 });
  const black = new THREE.MeshStandardMaterial({ name: 'black', color: 0x111111 });
  const chrome = new THREE.MeshStandardMaterial({ name: 'chrome', color: 0xcccccc });
  const glass = new THREE.MeshPhysicalMaterial({ name: 'glass', color: 0x223344, transmission: 0.9 });
  const part = (name: string, m: THREE.Material, size: [number, number, number], at: [number, number, number], seg: [number, number, number] = [6, 2, 4]): THREE.Mesh => {
    const g = new THREE.BoxGeometry(size[0], size[1], size[2], seg[0], seg[1], seg[2]);
    g.translate(at[0], at[1], at[2]); // the vertices carry the position, as in an exported model
    const mesh = new THREE.Mesh(g, m);
    mesh.name = name;
    root.add(mesh);
    return mesh;
  };
  part('body', paint, [4.5, 0.6, 1.95], [0, 0.55, 0], [18, 3, 8]);
  part('hood', paint, [1.3, 0.07, 1.85], [1.5, 0.87, 0]);
  if (options.trunk !== false) part('trunk', paint, [1.0, 0.07, 1.85], [-1.75, 0.87, 0]);
  part('door_L', paint, [1.3, 0.5, 0.05], [0.05, 0.7, -1.0], [6, 3, 1]);
  part('door_R', paint, [1.3, 0.5, 0.05], [0.05, 0.7, 1.0], [6, 3, 1]);
  part('bumper_F', chrome, [0.25, 0.32, 2.0], [2.3, 0.45, 0], [1, 2, 8]);
  part('bumper_F_rubber', black, [0.05, 0.1, 1.9], [2.43, 0.4, 0], [1, 1, 4]);
  part('bumper_R', chrome, [0.25, 0.32, 2.0], [-2.3, 0.45, 0], [1, 2, 8]);
  part('bumper_R_rubber', black, [0.05, 0.1, 1.9], [-2.43, 0.4, 0], [1, 1, 4]);
  part('glass', glass, [2.4, 0.5, 1.7], [-0.25, 1.1, 0], [6, 1, 4]);
  part('headlamps', black, [0.06, 0.16, 1.4], [2.3, 0.75, 0], [1, 1, 2]);
  part('interior', black, [2.0, 0.3, 1.5], [-0.2, 0.7, 0], [2, 1, 2]);
  part('roundel_L', black, [0.3, 0.3, 0.02], [0.3, 0.7, -1.03], [1, 1, 1]);
  const decal = part('number_L', black, [0.3, 0.3, 0.02], [0, 0, 0], [1, 1, 1]); // a decal: positioned by its node, turned a little
  decal.position.set(0.27, 0.62, -1.07);
  decal.rotation.y = 0.1;
  for (const [name, sx, sz] of [['wheel_FR', 1, 1], ['wheel_FL', 1, -1], ['wheel_RR', -1, 1], ['wheel_RL', -1, -1]] as const) {
    const wheel = part(name, black, [0.8, 0.8, 0.35], [0, 0, 0], [2, 2, 1]);
    wheel.position.set(sx * CAR.WHEEL.X, CAR.WHEEL.RADIUS, sz * CAR.WHEEL.Z);
  }
  return root;
}
```

Create `tests/client/carViewModel.test.ts`:

<!-- op {"kind": "create", "path": "tests/client/carViewModel.test.ts"} -->
```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CarView, REST_SUSPENSION, WRECK_COLOR } from '../../src/client/game/carView';
import { dentFromHit } from '../../src/client/game/dents';
import { CAR } from '../../src/shared/constants';
import { fakeCarModel } from '../helpers/carModel';

const hit = (over: Partial<Parameters<typeof dentFromHit>[0]> = {}) => dentFromHit({ tick: 90, victim: 1, attacker: 2, dmg: 14, p: [2.3, 0, 0], ...over });
const mesh = (view: CarView, name: string): THREE.Mesh => view.group.getObjectByName(name) as THREE.Mesh;
const positions = (m: THREE.Mesh): number[] => Array.from(m.geometry.getAttribute('position').array as Float32Array);
const paintOf = (view: CarView, name = 'body'): THREE.MeshStandardMaterial => mesh(view, name).material as THREE.MeshStandardMaterial;
/** The ground sits this far below the middle of the chassis when the springs are at rest. */
const GROUND_Y = CAR.WHEEL.HARD_Y - REST_SUSPENSION - CAR.WHEEL.RADIUS;

describe('CarView with a Blender model', () => {
  it('draws the model instead of its own boxes, with the ground of the model at the ground of the car', () => {
    const view = new CarView(0xd84a2b, 'coupe');
    expect(view.car).toBe('coupe');
    expect(view.usesModel).toBe(false);
    const boxes = view.group.children.length;
    view.useModel(fakeCarModel());
    expect(view.usesModel).toBe(true);
    expect(mesh(view, 'body')).toBeDefined();
    expect(mesh(view, 'body').parent!.position.y).toBeCloseTo(GROUND_Y, 6);
    expect(view.group.children.length).toBeLessThan(boxes); // the crumpling boxes are gone (the wheel pivots stay)
    view.dispose();
  });

  it('tints the paint with the player\'s colour, one paint per car, and shares everything else', () => {
    const model = fakeCarModel();
    const a = new CarView(0xd84a2b);
    const b = new CarView(0x2b7fd8);
    a.useModel(model);
    b.useModel(model);
    expect(paintOf(a).color.getHex()).toBe(0xd84a2b);
    expect(paintOf(b).color.getHex()).toBe(0x2b7fd8);
    expect(paintOf(a, 'hood')).toBe(paintOf(a)); // every panel of one car shares its paint
    expect(paintOf(a)).not.toBe(paintOf(b));
    expect(paintOf(a, 'bumper_F')).toBe(paintOf(b, 'bumper_F')); // the chrome is the same material for all
    expect((model.getObjectByName('body') as THREE.Mesh).material).not.toBe(paintOf(a)); // and the loaded model is not painted
    a.dispose();
    b.dispose();
  });

  it('follows setColor and the wreck look through the paint', () => {
    const view = new CarView(0x112233);
    view.useModel(fakeCarModel());
    view.setColor(0x445566);
    expect(paintOf(view).color.getHex()).toBe(0x445566);
    view.setWreck(true);
    expect(paintOf(view).color.getHex()).toBe(WRECK_COLOR);
    view.setColor(0x778899);
    expect(paintOf(view).color.getHex()).toBe(WRECK_COLOR);
    view.setWreck(false);
    expect(paintOf(view).color.getHex()).toBe(0x778899);
    view.dispose();
  });

  it('turns the glass\'s transmission off (it would cost the renderer a whole extra pass) and keeps it see-through', () => {
    const view = new CarView(0xd84a2b);
    view.useModel(fakeCarModel());
    const glass = mesh(view, 'glass').material as THREE.MeshPhysicalMaterial;
    expect(glass.transmission).toBe(0);
    expect(glass.transparent).toBe(true);
    expect(glass.opacity).toBeLessThan(1);
    view.dispose();
  });

  it('puts the wheels on the physics wheels: they steer and spin where the boxes\' wheels did', () => {
    const view = new CarView(0xd84a2b);
    view.useModel(fakeCarModel());
    const wheel = mesh(view, 'wheel_FR');
    expect(wheel.position.toArray()).toEqual([0, 0, 0]); // the node sits at the centre of its spinner, not where the file put it
    const wheels = [0, 1, 2, 3].map((i) => ({ suspensionLength: 0.3 + i * 0.01, rotation: 1.5, steering: 0.2, contact: true, steer: 0, suspensionForce: 0 }));
    view.setWheels(wheels as never);
    const spinner = wheel.parent!;
    const pivot = spinner.parent!;
    expect(Math.abs(spinner.rotation.z)).toBeCloseTo(1.5, 6);
    expect(pivot.rotation.y).toBeCloseTo(0.2, 6); // a front wheel steers
    expect(pivot.position.x).toBeCloseTo(CAR.WHEEL.X, 6);
    expect((mesh(view, 'wheel_RR').parent!.parent as THREE.Object3D).rotation.y).toBe(0); // a rear wheel does not
    view.dispose();
  });

  it('dents the bodywork where it was hit and the neighbouring panels with it, and leaves wheels, decals and interior alone', () => {
    const view = new CarView(0xd84a2b);
    view.useModel(fakeCarModel());
    const before = Object.fromEntries(['body', 'hood', 'bumper_F', 'wheel_FR', 'number_L', 'interior'].map((n) => [n, positions(mesh(view, n))]));
    view.dent(hit());
    for (const n of ['body', 'hood', 'bumper_F']) expect(positions(mesh(view, n)), n).not.toEqual(before[n]);
    for (const n of ['wheel_FR', 'number_L', 'interior']) expect(positions(mesh(view, n)), n).toEqual(before[n]);
    view.restore();
    expect(positions(mesh(view, 'body'))).toEqual(before.body);
    view.dispose();
  });

  it('keeps the dents of one car to itself although they came from one model', () => {
    const model = fakeCarModel();
    const a = new CarView(0xd84a2b);
    const b = new CarView(0x2b7fd8);
    a.useModel(model);
    b.useModel(model);
    const untouched = positions(mesh(b, 'body'));
    a.dent(hit());
    expect(positions(mesh(b, 'body'))).toEqual(untouched);
    expect(positions(model.getObjectByName('body') as THREE.Mesh)).toEqual(untouched);
    a.dispose();
    b.dispose();
  });

  it('shades the bent surface again, so a dent catches the light', () => {
    const view = new CarView(0xd84a2b);
    view.useModel(fakeCarModel());
    const normals = (): number[] => Array.from(mesh(view, 'hood').geometry.getAttribute('normal').array as Float32Array);
    const flat = normals();
    view.dent(hit({ dmg: 30, p: [1.5, 0.8, 0] }));
    expect(normals()).not.toEqual(flat);
    view.dispose();
  });

  it('takes a part off the car by name: its pieces vanish, and the caller is told its place, size and colour', () => {
    const view = new CarView(0xd84a2b);
    view.useModel(fakeCarModel());
    expect(view.hasPart('bumperFront')).toBe(true);
    const part = view.detach('bumperFront')!;
    expect(view.hasPart('bumperFront')).toBe(false);
    expect(mesh(view, 'bumper_F').visible).toBe(false);
    expect(mesh(view, 'bumper_F_rubber').visible).toBe(false);
    expect(mesh(view, 'bumper_R').visible).toBe(true);
    expect(part.id).toBe('bumperFront');
    expect(part.size.z).toBeGreaterThan(1.8);
    expect(part.position.x).toBeGreaterThan(2.0);
    expect(part.position.y).toBeCloseTo(GROUND_Y + 0.45, 1);
    expect(part.outward.x).toBeGreaterThan(0.9);
    expect(view.detach('bumperFront')).toBeNull();
    const hood = view.detach('hood')!;
    expect(hood.color).toBe(0xd84a2b); // a painted part flies off in the player's paint
    view.restore();
    expect(view.hasPart('bumperFront')).toBe(true);
    expect(mesh(view, 'bumper_F_rubber').visible).toBe(true);
    view.dispose();
  });

  it('copes with a car that has no trunk lid', () => {
    const view = new CarView(0xd84a2b);
    view.useModel(fakeCarModel({ trunk: false }));
    expect(view.hasPart('trunk')).toBe(false);
    expect(view.detach('trunk')).toBeNull();
    expect(view.detach('hood')).not.toBeNull();
    view.dispose();
  });

  it('puts the damage back on the model when it arrives after the car was hurt', () => {
    const view = new CarView(0xd84a2b);
    view.dent(hit());
    view.detach('hood');
    view.useModel(fakeCarModel());
    expect(mesh(view, 'hood').visible).toBe(false);
    const fresh = new CarView(0xd84a2b);
    fresh.useModel(fakeCarModel());
    expect(positions(mesh(view, 'body'))).not.toEqual(positions(mesh(fresh, 'body')));
    view.restore();
    expect(positions(mesh(view, 'body'))).toEqual(positions(mesh(fresh, 'body')));
    view.dispose();
    fresh.dispose();
  });

  it('can be told to draw less: the interior, decals and small trim go, the car does not', () => {
    const view = new CarView(0xd84a2b);
    view.useModel(fakeCarModel());
    view.setDetail(false);
    expect([mesh(view, 'interior').visible, mesh(view, 'number_L').visible, mesh(view, 'roundel_L').visible]).toEqual([false, false, false]);
    expect([mesh(view, 'body').visible, mesh(view, 'glass').visible, mesh(view, 'wheel_FR').visible]).toEqual([true, true, true]);
    view.setDetail(true);
    expect(mesh(view, 'interior').visible).toBe(true);
    const later = new CarView(0xd84a2b);
    later.setDetail(false); // decided before the model came
    later.useModel(fakeCarModel());
    expect(mesh(later, 'interior').visible).toBe(false);
    view.dispose();
    later.dispose();
  });

  it('frees what it made (its own geometry and paint) and nothing it shares', () => {
    const model = fakeCarModel();
    const shared = { geometry: 0, material: 0 };
    for (const name of ['wheel_FR', 'bumper_F', 'body']) {
      const m = model.getObjectByName(name) as THREE.Mesh;
      m.geometry.addEventListener('dispose', () => shared.geometry++);
      (m.material as THREE.Material).addEventListener('dispose', () => shared.material++);
    }
    const view = new CarView(0xd84a2b);
    view.useModel(model);
    let own = 0;
    const body = mesh(view, 'body');
    body.geometry.addEventListener('dispose', () => own++);
    (body.material as THREE.Material).addEventListener('dispose', () => own++);
    view.dispose();
    expect(own).toBe(2);
    expect(shared).toEqual({ geometry: 0, material: 0 });
  });

  it('holds one model at a time when it is given another', () => {
    const view = new CarView(0xd84a2b);
    view.useModel(fakeCarModel());
    view.useModel(fakeCarModel({ trunk: false }));
    expect(view.group.getObjectsByProperty('name', 'body')).toHaveLength(1);
    expect(view.hasPart('trunk')).toBe(false);
    view.dispose();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/client/carViewModel.test.ts`
Expected: FAIL — `useModel` does not exist

<!-- check {"cmd": "npx vitest run tests/client/carViewModel.test.ts", "outcome": "fail", "match": "FAIL|\u00d7|failed"} -->

- [ ] **Step 3: Teach the view and the dent surface**

A dent surface can shade its surface again after each change (the models have smooth normals; the boxes are flat-shaded and need none):

In `src/client/game/dents.ts`:

<!-- op {"kind": "edit", "path": "src/client/game/dents.ts"} -->
```ts

  /** `origin` is where the mesh sits in the car frame (meshes are not rotated). */
  constructor(
```

with:

```ts

  /**
   * `origin` is where the mesh sits in the car frame (meshes are not rotated). With `smooth` the surface is shaded again after every change
   * (a model with smooth normals; the flat-shaded boxes need no normals).
   */
  constructor(
```

In `src/client/game/dents.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/dents.ts"} -->
```ts
    private readonly origin: Vec3,
  ) {
```

with:

```ts
    private readonly origin: Vec3,
    private readonly smooth = false,
  ) {
```

In `src/client/game/dents.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/dents.ts"} -->
```ts
    position.needsUpdate = true;
  }
```

with:

```ts
    position.needsUpdate = true;
    if (this.smooth && this.geometry.getAttribute('normal')) this.geometry.computeVertexNormals(); // vertices shared by faces get the average, creases (duplicated vertices) stay
  }
```

In `src/client/game/carView.ts` (the boxes the view builds are remembered, so a model can take their place; the view remembers its last 64 dents and the parts it has lost, to put on a model that arrives late):

<!-- op {"kind": "edit", "path": "src/client/game/carView.ts"} -->
```ts
import * as THREE from 'three';
import { CAR } from '../../shared/constants';
```

with:

```ts
import * as THREE from 'three';
import { DEFAULT_CAR, type CarId } from '../../shared/cars';
import { CAR } from '../../shared/constants';
```

In `src/client/game/carView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/carView.ts"} -->
```ts

export class CarView {
```

with:

```ts

/** The nodes of a Blender model that make up each detachable part, the first being the main piece (its box says where the part is and how big). */
const MODEL_PARTS: Record<PartId, readonly string[]> = {
  bumperFront: ['bumper_F', 'bumper_F_rubber'],
  hood: ['hood', 'hood_scoop', 'hood_scoop_intake', 'stripe_hood_1', 'stripe_hood_-1'],
  bumperRear: ['bumper_R', 'bumper_R_rubber'],
  trunk: ['trunk', 'stripe_deck_1', 'stripe_deck_-1'],
  doorLeft: ['door_L', 'roundel_L', 'number_L'],
  doorRight: ['door_R', 'roundel_R', 'number_R'],
};
/** The wheels of a model in the order of the physics wheels (front right, front left, rear right, rear left). */
const MODEL_WHEELS = ['wheel_FR', 'wheel_FL', 'wheel_RR', 'wheel_RL'] as const;
/** What a dent does not move: the wheels, the decals (their nodes are turned) and the inside. */
const NOT_DENTED = /^(wheel_|number_|interior)/;
/** What the Low graphics preset leaves out of a car. */
const SMALL_DETAIL = new Set(['interior', 'number_L', 'number_R', 'roundel_L', 'roundel_R', 'plates', 'window_trim', 'indicators']);
/** Where the ground is in the car's frame when the springs are at rest: the origin of a model sits on it. */
export const GROUND_Y = CAR.WHEEL.HARD_Y - REST_SUSPENSION - CAR.WHEEL.RADIUS;
/** How many dents a car remembers, to put them on a model that arrives after the car was hurt. */
const DENT_LOG = 64;

interface ModelPart {
  nodes: THREE.Mesh[];
  main: THREE.Mesh;
  center: Vec3;
  size: Vec3;
}

export class CarView {
```

In `src/client/game/carView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/carView.ts"} -->
```ts
  readonly group = new THREE.Group();
  private readonly bodyMaterial: THREE.MeshStandardMaterial;
  private readonly surfaces: DentSurface[] = [];
```

with:

```ts
  readonly group = new THREE.Group();
  private bodyMaterial: THREE.MeshStandardMaterial;
  /** The boxes this view builds for itself: drawn until a model replaces them, and for good if none comes. */
  private proceduralObjects: THREE.Object3D[] = [];
  private modelRoot: THREE.Group | null = null;
  private modelParts = new Map<PartId, ModelPart>();
  private modelNodes: THREE.Mesh[] = [];
  private readonly dentLog: Dent[] = [];
  private readonly lostParts = new Set<PartId>();
  private detailFull = true;
  private readonly surfaces: DentSurface[] = [];
```

In `src/client/game/carView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/carView.ts"} -->
```ts

  constructor(color: number) {
    this.paint = color;
```

with:

```ts

  constructor(
    color: number,
    /** The model of this car (the sedan unless told otherwise); `useModel` draws it once it has been loaded. */
    readonly car: CarId = DEFAULT_CAR,
  ) {
    this.paint = color;
```

In `src/client/game/carView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/carView.ts"} -->
```ts
      this.group.add(mesh);
    };
```

with:

```ts
      this.group.add(mesh);
      this.proceduralObjects.push(mesh);
    };
```

In `src/client/game/carView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/carView.ts"} -->
```ts
    this.group.add(mesh);
    this.surfaces.push(new DentSurface(geometry, { x, y, z }));
```

with:

```ts
    this.group.add(mesh);
    this.proceduralObjects.push(mesh);
    this.surfaces.push(new DentSurface(geometry, { x, y, z }));
```

In `src/client/game/carView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/carView.ts"} -->
```ts
  dent(d: Dent): void {
    for (const surface of this.surfaces) surface.apply(d);
```

with:

```ts
  dent(d: Dent): void {
    this.dentLog.push(d);
    if (this.dentLog.length > DENT_LOG) this.dentLog.shift();
    for (const surface of this.surfaces) surface.apply(d);
```

In `src/client/game/carView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/carView.ts"} -->
```ts
  }

  /**
   * Takes a part off the car (it stops being drawn) and says where it was, so the caller can send it flying. Null when the part is
```

with:

```ts
  }

  /** True once a Blender model has replaced the boxes. */
  get usesModel(): boolean {
    return this.modelRoot !== null;
  }

  /**
   * Draws a loaded Blender model of the car in place of the boxes (or of the model it had). The model is shared by every car of its
   * kind, so this takes a copy: the geometry of the panels a dent can move is copied for this car alone, the paint is a material of this
   * car's own colour, and everything else is shared and never freed here. Damage taken before the model arrived is put on it.
   */
  useModel(model: THREE.Object3D): void {
    this.removeModel();
    for (const o of this.proceduralObjects) o.removeFromParent();
    this.proceduralObjects = [];
    this.surfaces.length = 0;
    this.parts.clear();

    const copy = model.clone(true);
    copy.updateMatrixWorld(true);
    const root = new THREE.Group();
    root.name = 'model';
    root.position.y = GROUND_Y;
    const nodes: THREE.Mesh[] = [];
    let paintMaterial: THREE.MeshStandardMaterial | null = null;
    copy.traverse((o) => {
      if (o instanceof THREE.Mesh) nodes.push(o);
    });
    for (const mesh of nodes) {
      const material = mesh.material as THREE.Material;
      if (/^paint/.test(material.name)) {
        paintMaterial ??= this.track((material as THREE.MeshStandardMaterial).clone());
        mesh.material = paintMaterial;
      } else if (material instanceof THREE.MeshPhysicalMaterial && material.transmission > 0) {
        // transmission makes the renderer draw the whole scene once more for every frame: plain transparency looks the same on a car
        material.transmission = 0;
        material.transparent = true;
        material.opacity = 0.55;
        material.depthWrite = false;
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    if (paintMaterial) {
      (paintMaterial as THREE.MeshStandardMaterial).color.setHex(this.wrecked ? WRECK_COLOR : this.paint);
      this.bodyMaterial = paintMaterial;
    }
    // the wheels go into the spinners of the physics wheels, centred on them
    MODEL_WHEELS.forEach((name, i) => {
      const wheel = copy.getObjectByName(name);
      if (!wheel) return;
      wheel.removeFromParent();
      wheel.position.set(0, 0, 0);
      wheel.rotation.set(0, 0, 0);
      this.spinners[i]!.clear();
      this.spinners[i]!.add(wheel);
    });
    const body = nodes.filter((m) => m.parent !== null && !NOT_DENTED.test(m.name) && !this.spinners.some((s) => s.children.includes(m)));
    for (const mesh of body) {
      mesh.geometry = this.track(mesh.geometry.clone()); // this car's panels, so a dent bends this car only
      this.surfaces.push(new DentSurface(mesh.geometry, { x: 0, y: GROUND_Y, z: 0 }, true));
    }
    for (const id of Object.keys(MODEL_PARTS) as PartId[]) {
      const found = MODEL_PARTS[id].map((n) => copy.getObjectByName(n)).filter((o): o is THREE.Mesh => o instanceof THREE.Mesh);
      if (found.length === 0) continue;
      const main = found[0]!;
      const box = new THREE.Box3().setFromObject(main);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      this.modelParts.set(id, { nodes: found, main, center: { x: center.x, y: center.y + GROUND_Y, z: center.z }, size: { x: size.x, y: size.y, z: size.z } });
    }
    for (const child of [...copy.children]) root.add(child);
    this.group.add(root);
    this.modelRoot = root;
    this.modelNodes = nodes;
    for (const d of this.dentLog) for (const surface of this.surfaces) surface.apply(d);
    this.refreshVisibility();
  }

  private removeModel(): void {
    if (!this.modelRoot) return;
    this.modelRoot.removeFromParent();
    for (const spinner of this.spinners) spinner.clear();
    this.modelRoot = null;
    this.modelParts.clear();
    this.modelNodes = [];
  }

  /** Draws the small things (interior, decals, trim) or leaves them out: the Low graphics preset. */
  setDetail(full: boolean): void {
    this.detailFull = full;
    this.refreshVisibility();
  }

  /** Which pieces of a model are drawn: not the parts that have come off, and not the small things on Low. */
  private refreshVisibility(): void {
    for (const mesh of this.modelNodes) mesh.visible = !(this.detailFull ? false : SMALL_DETAIL.has(mesh.name));
    for (const id of this.lostParts) for (const node of this.modelParts.get(id)?.nodes ?? []) node.visible = false;
  }

  /**
   * Takes a part off the car (it stops being drawn) and says where it was, so the caller can send it flying. Null when the part is
```

In `src/client/game/carView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/carView.ts"} -->
```ts
  detach(id: PartId): DetachedPart | null {
    const mesh = this.parts.get(id);
```

with:

```ts
  detach(id: PartId): DetachedPart | null {
    if (this.modelRoot) {
      const part = this.modelParts.get(id);
      if (!part || !part.main.visible) return null;
      this.lostParts.add(id);
      this.refreshVisibility();
      this.group.updateMatrixWorld(true);
      const centre = this.group.localToWorld(new THREE.Vector3(part.center.x, part.center.y, part.center.z));
      const q = this.group.getWorldQuaternion(new THREE.Quaternion());
      const [ox, oy, oz] = PART_SPECS[id].outward;
      const outward = new THREE.Vector3(ox, oy, oz).normalize().applyQuaternion(q);
      return {
        id,
        position: { x: centre.x, y: centre.y, z: centre.z },
        quaternion: { x: q.x, y: q.y, z: q.z, w: q.w },
        size: { ...part.size },
        color: (part.main.material as THREE.MeshStandardMaterial).color.getHex(),
        outward: { x: outward.x, y: outward.y, z: outward.z },
      };
    }
    const mesh = this.parts.get(id);
```

In `src/client/game/carView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/carView.ts"} -->
```ts
    if (!mesh || !mesh.visible) return null;
    mesh.visible = false;
```

with:

```ts
    if (!mesh || !mesh.visible) return null;
    this.lostParts.add(id);
    mesh.visible = false;
```

In `src/client/game/carView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/carView.ts"} -->
```ts
  restore(): void {
    for (const mesh of this.parts.values()) mesh.visible = true;
```

with:

```ts
  restore(): void {
    this.dentLog.length = 0;
    this.lostParts.clear();
    for (const mesh of this.parts.values()) mesh.visible = true;
```

In `src/client/game/carView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/carView.ts"} -->
```ts
    for (const surface of this.surfaces) surface.reset();
  }
```

with:

```ts
    for (const surface of this.surfaces) surface.reset();
    this.refreshVisibility();
  }
```

In `src/client/game/carView.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/carView.ts"} -->
```ts
  hasPart(id: PartId): boolean {
    return this.parts.get(id)?.visible ?? false;
```

with:

```ts
  hasPart(id: PartId): boolean {
    if (this.modelRoot) return this.modelParts.get(id)?.main.visible ?? false;
    return this.parts.get(id)?.visible ?? false;
```

- [ ] **Step 4: Run the tests, then the whole suite**

Run: `npx vitest run tests/client/carViewModel.test.ts tests/client/carView.test.ts tests/client/fx.test.ts tests/client/dents.test.ts`
Expected: all pass

<!-- check {"cmd": "npx vitest run tests/client/carViewModel.test.ts tests/client/carView.test.ts tests/client/fx.test.ts tests/client/dents.test.ts", "outcome": "pass"} -->

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 892} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(client): CarView draws a Blender model \u2014 own paint, the physics wheels, dents that bend and shade it, parts by name, damage replayed on a late model"
```

<!-- commit "feat(client): CarView draws a Blender model \u2014 own paint, the physics wheels, dents that bend and shade it, parts by name, damage replayed on a late model" -->

---

### Task 72: The cars on screen: loaded in the background, the Low detail, pictures in the menu

**Files:**
- Modify: `src/client/settings.ts`, `src/client/game/gameClient.ts`, `src/client/ui/menu.ts`, `src/client/index.html`, `tests/client/settings.test.ts`

**Interfaces:**
- Consumes: `CarModels` (Task 70), `CarView.useModel` and `setDetail` (Task 71), `CAR_PICTURE_URLS` (Task 69), `QualityProfile` (Plan 7), `PlayerInfo.car` (Task 68).
- Produces: `QualityProfile.carDetail` (high and medium true, low false); the game preloads the four models, gives each car view its model when it is loaded (at once when it is, when it arrives otherwise; the boxes show until then and for good if it never comes), makes a new view when another player's car of another model takes a slot, and applies the Low detail to every view; a picture in each card of the menu's picker.

- [ ] **Step 1: Write the test**

The presets get cheaper step by step (the existing test lists what each step may lose): a car's small detail is one more thing the lower presets drop.

In `tests/client/settings.test.ts`:

<!-- op {"kind": "edit", "path": "tests/client/settings.test.ts"} -->
```ts
      expect(lower.debris).toBeLessThanOrEqual(higher.debris);
      for (const key of ['shadows', 'bloom', 'crowd'] as const) expect(Number(lower[key])).toBeLessThanOrEqual(Number(higher[key]));
    }
```

with:

```ts
      expect(lower.debris).toBeLessThanOrEqual(higher.debris);
      for (const key of ['shadows', 'bloom', 'crowd', 'carDetail'] as const) expect(Number(lower[key])).toBeLessThanOrEqual(Number(higher[key]));
    }
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/client/settings.test.ts`
Expected: FAIL — the profiles have no `carDetail`

<!-- check {"cmd": "npx vitest run tests/client/settings.test.ts", "outcome": "fail", "match": "FAIL|\u00d7|failed"} -->

- [ ] **Step 3: Wire the cars in**

In `src/client/settings.ts`:

<!-- op {"kind": "edit", "path": "src/client/settings.ts"} -->
```ts
  bloom: boolean;
  /** The crowd in the stands. */
  crowd: boolean;
```

with:

```ts
  bloom: boolean;
  /** The crowd in the stands (and, in the other arenas, the props and the backdrop). */
  crowd: boolean;
```

In `src/client/settings.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/settings.ts"} -->
```ts
  crowd: boolean;
  /** Multiplies how many particles the effects emit (0 to 1). */
```

with:

```ts
  crowd: boolean;
  /** The small things on a car: interior, decals, trim. */
  carDetail: boolean;
  /** Multiplies how many particles the effects emit (0 to 1). */
```

In `src/client/settings.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/settings.ts"} -->
```ts
export const QUALITY: Readonly<Record<Quality, QualityProfile>> = {
  high: { pixelRatio: 2, msaa: 4, shadows: true, shadowMapSize: 2048, bloom: true, crowd: true, particles: 1, debris: 40 },
  medium: { pixelRatio: 1.5, msaa: 2, shadows: true, shadowMapSize: 1024, bloom: true, crowd: true, particles: 0.6, debris: 24 },
  low: { pixelRatio: 1, msaa: 0, shadows: false, shadowMapSize: 512, bloom: false, crowd: false, particles: 0.3, debris: 12 },
};
```

with:

```ts
export const QUALITY: Readonly<Record<Quality, QualityProfile>> = {
  high: { pixelRatio: 2, msaa: 4, shadows: true, shadowMapSize: 2048, bloom: true, crowd: true, carDetail: true, particles: 1, debris: 40 },
  medium: { pixelRatio: 1.5, msaa: 2, shadows: true, shadowMapSize: 1024, bloom: true, crowd: true, carDetail: true, particles: 0.6, debris: 24 },
  low: { pixelRatio: 1, msaa: 0, shadows: false, shadowMapSize: 512, bloom: false, crowd: false, carDetail: false, particles: 0.3, debris: 12 },
};
```

In `src/client/game/gameClient.ts` (the models are asked for when the game starts; a car view is built for the car in the roster and dressed when its model is here, only if that slot still holds that view; the Low preset sets the detail of every view):

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
import { ARENA_SCENERY_URLS } from './arenaAssets';
import { ArenaScenery, leadingArenas, loadGltfScenery } from './arenaScenery';
```

with:

```ts
import { ARENA_SCENERY_URLS } from './arenaAssets';
import { CarModels } from './carModels';
import { ArenaScenery, leadingArenas, loadGltfScenery } from './arenaScenery';
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
  private readonly scenery = new ArenaScenery(ARENA_SCENERY_URLS, loadGltfScenery);
  private readonly fx: FxDirector;
```

with:

```ts
  private readonly scenery = new ArenaScenery(ARENA_SCENERY_URLS, loadGltfScenery);
  /** The Blender models of the cars; a car is drawn as boxes until its model is here. */
  private readonly carModels = new CarModels();
  private carDetail = true;
  private readonly fx: FxDirector;
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
    window.addEventListener('pointerdown', this.unlockAudio);
    this.conn.connect();
```

with:

```ts
    window.addEventListener('pointerdown', this.unlockAudio);
    this.carModels.preloadAll();
    this.conn.connect();
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
    this.scenery.dispose();
    this.audio.dispose();
```

with:

```ts
    this.scenery.dispose();
    this.carModels.dispose();
    this.audio.dispose();
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts

  private applyRoster(): void {
```

with:

```ts

  /** Gives a car its Blender model: at once when it is loaded, when it arrives otherwise (the boxes show until then, and for good if it never comes). */
  private dressCar(slot: number, view: CarView): void {
    const have = this.carModels.peek(view.car);
    if (have) {
      view.useModel(have);
      return;
    }
    void this.carModels.request(view.car).then((model) => {
      if (model && !this.stopped && this.views.get(slot) === view) view.useModel(model);
    });
  }

  private applyRoster(): void {
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
    for (const p of this.roster) {
      const existing = this.views.get(p.slot);
      if (existing) {
```

with:

```ts
    for (const p of this.roster) {
      let existing = this.views.get(p.slot);
      if (existing && existing.car !== p.car) {
        existing.dispose(); // another player's car in this slot: another model
        this.views.delete(p.slot);
        existing = undefined;
      }
      if (existing) {
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
      } else {
        const view = new CarView(p.color);
        view.group.visible = false; // shown once the first snapshot for this world arrives
```

with:

```ts
      } else {
        const view = new CarView(p.color, p.car);
        view.setDetail(this.carDetail);
        view.group.visible = false; // shown once the first snapshot for this world arrives
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
        this.views.set(p.slot, view);
      }
```

with:

```ts
        this.views.set(p.slot, view);
        this.dressCar(p.slot, view);
      }
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
    this.opts.gs.applyQuality(profile);
    this.fx.setDensity(profile.particles, profile.debris);
```

with:

```ts
    this.opts.gs.applyQuality(profile);
    this.carDetail = profile.carDetail;
    for (const view of this.views.values()) view.setDetail(profile.carDetail);
    this.fx.setDensity(profile.particles, profile.debris);
```

In `src/client/ui/menu.ts`, a picture in each car card:

<!-- op {"kind": "edit", "path": "src/client/ui/menu.ts"} -->
```ts
import { PALETTE, loadProfile, saveProfile } from '../profile';
```

with:

```ts
import { CAR_PICTURE_URLS } from '../game/carAssets';
import { PALETTE, loadProfile, saveProfile } from '../profile';
```

In `src/client/ui/menu.ts`, a picture in each car card:

<!-- op {"kind": "edit", "path": "src/client/ui/menu.ts"} -->
```ts
    b.textContent = CAR_NAMES[id];

```

with:

```ts
    const picture = document.createElement('img');
    picture.src = CAR_PICTURE_URLS[id];
    picture.alt = '';
    picture.draggable = false;
    const label = document.createElement('span');
    label.textContent = CAR_NAMES[id];
    b.append(picture, label);
    b.title = CAR_NAMES[id];

```

In `src/client/index.html`:

<!-- op {"kind": "edit", "path": "src/client/index.html"} -->
```html
      .car[aria-checked='true'] {
```

with:

```html
      .car {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
      }
      .car img {
        width: 100%;
        height: auto;
        pointer-events: none;
      }
      .car[aria-checked='true'] {
```

- [ ] **Step 4: Run the tests, then the whole suite**

Run: `npx vitest run tests/client/settings.test.ts`
Expected: passes

<!-- check {"cmd": "npx vitest run tests/client/settings.test.ts", "outcome": "pass"} -->

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 892} -->

- [ ] **Step 5: Look at the cars in a real browser**

WebGL only animates in a visible browser: use the Playwright browser, not the app's hidden pane. `npm run build`, then a server of your own on a private port: `PORT=18310 STATIC_DIR=dist/client BOT_FILL=5 COUNTDOWN_SECONDS=3 ROUND_SECONDS=60 RESULTS_SECONDS=8 node dist/server/index.js`. Check, and write what you saw in the ledger:

1. The menu shows four cards, each with a picture of its car; the choice is kept across a reload.
2. `http://localhost:18310/?auto=quick&name=Tester&car=coupe&color=1`: your car is a blue coupe with its racing stripes, and `window.__derby.debug().roster` lists a car for every player, the bots with models of their own; the other cars are the sedan, wagon and pickup models, in their own colours. Take a screenshot.
3. With five cars in a live round the renderer reports about 390 draw calls and about 130 000 triangles; the scene is smooth.
4. After some fighting, a car that has been hit is dented and has lost parts (a hood, a bumper); dents look like bent metal, not torn triangles.
5. Press `G` until Low: the interior and the decals leave the cars; back to High, they return.
6. No console errors.

Stop the server.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(client): the four car models on screen \u2014 loaded in the background, boxes until then, a small detail the Low preset drops, pictures in the menu"
```

<!-- commit "feat(client): the four car models on screen \u2014 loaded in the background, boxes until then, a small detail the Low preset drops, pictures in the menu" -->

---

### Task 73: Documentation

**Files:**
- Modify: `README.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: Everything above.
- Produces: The README describes the four cars, the picker, the models and how they are built; `CLAUDE.md` says the car models are generated, budgeted by a test, and differ in looks only.

- [ ] **Step 1: Update the docs**

In `README.md` (protocol 5, and a bullet on the cars):

<!-- op {"kind": "edit", "path": "README.md"} -->
```markdown
- Bots fill a room up to four cars and step aside as humans join.
- Four arenas: the Stadium (the round dirt bowl), the Frozen Lake (slippery ice, low snow banks, blocks of ice), the Mud Quarry (an oval pit with a raised mound and ramps; the mud drags at the cars and costs a little top speed) and the Container Port (a rectangular yard of shipping containers and two ramps, with a little more grip). Each is a layout file, `src/shared/arenas/<id>.json`, which the server and the browser both build the physics from; `python3 art/arenas/layouts.py` writes them. A room's first round is in a random arena. During the results every player in the room can vote (click a card or press 1 to 4); the arena with the most votes is played next, a tie or no vote at all is settled by the room's seeded random. Bots do not vote. The server and the client agree on the version of the protocol: it is 4.
- Scenery: the Frozen Lake, the Mud Quarry and the Container Port have Blender models (`src/client/assets/arena_<id>.glb`, scenery only, no collision) that `art/arenas/build_arenas.py` builds from the same layouts as the physics: `/Applications/Blender.app/Contents/MacOS/Blender -b --python art/arenas/build_arenas.py` (Blender 5; `ARENA=ice` for one; `PREVIEW=<folder>` also renders pictures). The browser loads the model of the arena leading the vote while the vote is open, so the winner is ready for the countdown; until it arrives, and for good if it never does, the arena is drawn as the plain boxes of its layout. The Low graphics preset drops the props and the backdrop. The Stadium keeps the stands, crowd and floodlights it builds in code. Tyre marks are drawn in the colour of each ground.
```

with:

```markdown
- Bots fill a room up to four cars and step aside as humans join.
- Four arenas: the Stadium (the round dirt bowl), the Frozen Lake (slippery ice, low snow banks, blocks of ice), the Mud Quarry (an oval pit with a raised mound and ramps; the mud drags at the cars and costs a little top speed) and the Container Port (a rectangular yard of shipping containers and two ramps, with a little more grip). Each is a layout file, `src/shared/arenas/<id>.json`, which the server and the browser both build the physics from; `python3 art/arenas/layouts.py` writes them. A room's first round is in a random arena. During the results every player in the room can vote (click a card or press 1 to 4); the arena with the most votes is played next, a tie or no vote at all is settled by the room's seeded random. Bots do not vote. The server and the client agree on the version of the protocol: it is 5.
- Cars: four models (sedan, coupe, wagon, pickup) chosen in the menu (a picture each; the choice is kept with your name and colour; `?car=pickup` in an `?auto=` link). They differ in looks only: one hitbox, one mass, one tuning. The models are Blender exports (`src/client/assets/car_<id>.glb`, built by `art/cars/densify_cars.py` from the sources in `art/cars/src/`, which gives the body panels a vertex about every 35 cm so a dent bends them): the paint is tinted with your colour, dents move the panels' vertices and shade them again, hoods, trunks, doors and bumpers come off as before, and the Low graphics preset leaves out the interior, decals and small trim. A car is drawn as the plain boxes of Plan 5 until its model has loaded, and for good if it never does. Bots get a model of their own, drawn from the room's seed.
- Scenery: the Frozen Lake, the Mud Quarry and the Container Port have Blender models (`src/client/assets/arena_<id>.glb`, scenery only, no collision) that `art/arenas/build_arenas.py` builds from the same layouts as the physics: `/Applications/Blender.app/Contents/MacOS/Blender -b --python art/arenas/build_arenas.py` (Blender 5; `ARENA=ice` for one; `PREVIEW=<folder>` also renders pictures). The browser loads the model of the arena leading the vote while the vote is open, so the winner is ready for the countdown; until it arrives, and for good if it never does, the arena is drawn as the plain boxes of its layout. The Low graphics preset drops the props and the backdrop. The Stadium keeps the stands, crowd and floodlights it builds in code. Tyre marks are drawn in the colour of each ground.
```

In `CLAUDE.md`:

<!-- op {"kind": "edit", "path": "CLAUDE.md"} -->
```markdown
- Tuning lives only in `src/shared/constants.ts`; it is frozen at run time except in the offline `?sandbox`. What an arena changes (grip, drag, power of its ground) is in its layout and is read when the cars are built.
- The arena models in `src/client/assets/*.glb` are generated by `art/arenas/build_arenas.py` (Blender, from the layouts; the export is byte-for-byte repeatable): never edit them, and run the script again after changing a layout's boxes. `tests/client/arenaAssets.test.ts` holds them to a size and triangle budget.
```

with:

```markdown
- Tuning lives only in `src/shared/constants.ts`; it is frozen at run time except in the offline `?sandbox`. What an arena changes (grip, drag, power of its ground) is in its layout and is read when the cars are built.
- The car models in `src/client/assets/car_*.glb` (and the menu pictures `car_*.png`) are generated by `art/cars/densify_cars.py` (Blender) from `art/cars/src/*.glb`; never edit them. `tests/client/carAssets.test.ts` holds them to the size of the physics car, their wheel places and a triangle budget; cars differ in looks only (`src/shared/cars.ts`).
- The arena models in `src/client/assets/*.glb` are generated by `art/arenas/build_arenas.py` (Blender, from the layouts; the export is byte-for-byte repeatable): never edit them, and run the script again after changing a layout's boxes. `tests/client/arenaAssets.test.ts` holds them to a size and triangle budget.
```

- [ ] **Step 2: Run the whole suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean and the whole suite passes

<!-- check {"cmd": "npm run typecheck && npm test", "outcome": "pass", "tests": 892} -->

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: the four cars \u2014 the picker, the models, and the rule that they differ in looks only"
```

<!-- commit "docs: the four cars \u2014 the picker, the models, and the rule that they differ in looks only" -->

---

## Plan 10 done when

- [ ] `npm run typecheck`, `npm test` (892 tests) and `npm run build` pass; the build lists four `car_*.glb` and four `car_*.png`; `npm run hash` still prints `8719c2e8`.
- [ ] The browser check of Task 72 was done on a private port: the picker with its pictures, each model on screen, dents and lost parts, the Low detail, no console errors.
- [ ] **The owner has driven each car** and said whether they look right and whether they want different colours, a bigger picture in the menu, or finer dents.

**Known limits of this baseline:** see the rehearsal findings (menu pictures in the model's colour, rigid wheels, dents that move the glass, no trunk on the wagon and the pickup).

**Next:** the owner's playtest; the open follow-ups listed in the final reports of Plans 8 and 9; M7, the deploy, only with the owner's go-ahead and hosting account.
