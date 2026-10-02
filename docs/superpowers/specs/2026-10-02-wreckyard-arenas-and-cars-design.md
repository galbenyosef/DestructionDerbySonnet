# Wreckyard — four arenas with a vote, and four cars to choose from (design)

Date: 2026-10-02. Extends `2026-09-28-wreckyard-design.md`. Status: for review.

## What this adds

1. **Four arenas** in very different settings, each with its own **shape, obstacles and ground feel** as well as its own scenery, built in Blender.
2. **A vote each round:** between rounds the players in a room vote for the arena of the next round.
3. **Four car models** (sedan, coupe, wagon, pickup, already modelled in Blender: `art/`) that a player picks in the menu. The choice is cosmetic: **all cars share one hitbox, mass and tuning**.

3. **A small retune for every car** (owner request): a little faster and a bit more robust (see Tuning below).

Out of scope: different car stats per model, car choice per round, vote for anything but the arena, mobile layout, new game modes.

## Decisions taken with the owner

| Question | Decision |
|---|---|
| How different are the arenas? | Look, layout **and ground feel** (grip, drag) |
| How is the arena chosen? | **Vote each round** among the players in the room |
| The four arenas | Stadium (today's), Frozen Lake, Mud Quarry, Container Port |
| How is scenery made? | **Modelled in Blender**, exported as GLB |
| Do cars differ in physics? | **No.** Same physics, different look |
| Any change to the shared car? | **Yes, one global retune:** a little faster, a bit more robust |

## The four arenas

| Arena | Shape and obstacles | Ground feel (relative to today) | Mood |
|---|---|---|---|
| **Stadium** | Round, 32-segment wall, radius 45 m, 4 concrete blocks (exactly today's numbers) | grip 1.0, drag 0, power 1.0 | night stadium, floodlights, crowd, tyre stacks |
| **Frozen Lake** | Round, wide, low snow-bank walls, a few ice blocks | grip about 0.4, drag 0 | pale blue ice, snow, cold dusk |
| **Mud Quarry** | Oval pit with a raised central mound and ramps | grip 0.9, extra drag, lower top speed | dusty orange, dust haze |
| **Container Port** | Rectangular yard of stacked containers forming lanes and a cross, a few ramps | grip 1.15 | sodium floodlights, concrete, cramped |

The numbers are first guesses, set in the layout files and tuned in playtest.

## Architecture

### One source of truth per arena

A Blender script (`art/arenas/build_arenas.py`) builds each arena and writes two files from the same description:

- `arena_<id>.glb`: the scenery (no collision).
- `arena_<id>.json`: the **layout**: wall and obstacle boxes (position, yaw, pitch, half extents; ramps are tilted boxes), the playable **boundary** polygon, eight **spawn poses**, the **ground feel** (`grip`, `drag`, `power`), and the **look** (sky, fog, sun, ambient).

The layout JSON is bundled into the shared code. The server and the browser build the physics from it, so collision and scenery cannot drift apart. A test validates every layout (spawns inside the boundary and clear of obstacles, boxes inside the ground, eight spawns facing the middle).

### Shared code (`src/shared`)

- `ArenaDef` (from the JSON) replaces the circle constants: `wallSegments()`, `obstacleBoxes()` and `spawnPose()` take an arena. Boxes gain a `pitch` for ramps.
- `Simulation(slots, arena)` builds the world from an arena; the ground feel is applied when the cars are built (wheel friction scaled by `grip`, linear damping plus `drag`, engine force times `power`). Tuning stays frozen at run time.
- **Invariant (refactor step):** with tuning untouched, the Stadium layout reproduces today's geometry and numbers exactly, so `npm run hash` still prints `10c3a72a`. Only afterwards does the separate retune step (below) change the numbers and record a new baseline hash. Each other arena gets its own hash, checked in Node and in a browser.
- Out of bounds becomes a point-in-polygon test against the arena's boundary.

### Server (`src/server`)

- A room has a current arena. `RoundState` (out of bounds), bots (wall avoidance, which uses the circle radius today) and the spawn code take it from the arena.
- **Vote:** the results phase (default 12 s, up from 8) is also the voting window. Humans vote; bots do not. The most votes wins; a tie is broken by the server's seeded random; no votes picks a random arena. The first round of a room uses a random arena. A vote can be changed until the phase ends; a player who leaves loses their vote; a newcomer in the room may vote.
- The next countdown builds the world for the winning arena.

### Protocol (version 4 for arenas, version 5 for cars)

- Arenas (v4): `vote {arena}` (client to server, accepted only during results); `votes {counts}` (server to clients, when a vote changes, at most four a second); `arena` in `welcome` and `roster`; `nextArena` in the last `phase` of the results.
- Cars (v5): `hello.car`, and `car` in each `PlayerInfo`. Unknown ids fall back to the sedan; bots get a seeded random car.
- Both bump `NET.PROTOCOL_VERSION`; an old cached client is told to reload.

### Client (`src/client`)

- **Arena loader:** loads `arena_<id>.glb` for the voted arena during the vote, so it is ready for the countdown; caches loaded arenas; if loading fails the arena is drawn as plain boxes from the layout. The physics never depends on the GLB.
- **Look:** sky, fog, sun and ambient come from the layout's `look`; the floodlight shadow, crowd and tyre stacks of today's stadium become part of that arena's scenery. Tyre-mark colour follows the ground (white on ice, dark in mud).
- **Vote panel** on the results screen: four arena cards with live tallies and the player's own choice; the winner is announced for the countdown. `MatchState` holds the vote state (DOM-free and tested in Node).
- **Graphics presets** keep working: Low lightens the scenery (fewer props, no extra lights).

### Cars

- **Models:** `derby_<car>_game.glb` nodes: `body`, `hood`, optional `trunk`, `door_L`, `door_R`, `bumper_F`, `bumper_R`, `wheel_FL/FR/RL/RR`, glass, lamps, trim. The player's colour tints the `paint` material; wrecks are charred as today.
- **`CarView`** loads the model of each car's `car` id instead of building boxes. Damage keeps working: dents move vertices, parts detach by `PART_RULES` (a car without a trunk lid skips that rule).
- **Dent density:** dents move vertices, so dentable panels need vertices about every 0.15 m. The Blender export subdivides the body, hood, trunk and doors to that density; smooth-shaded panels have their normals recomputed after a dent (only the touched meshes).
- **Hitbox and wheels** are unchanged: every model matches the physics car (wheel positions and radius), and sits on the same chassis.
- **Menu:** a car picker with a turntable preview next to the colour swatches; the choice is remembered with the profile.
- **Triangle budget:** at most about 16 000 triangles a car (eight cars on screen), measured with the existing draw-call and triangle counters; the Low preset can hide trim and interior.

## Tuning: a little faster, a bit more robust

One global change for all four cars, applied as its own step after the arena refactor so the hash invariant above can be proved first:

- **Faster:** engine force and top speed about +12 % (`DRIVE` constants), with the steering and suspension rechecked so handling stays controllable at the higher speed.
- **More robust:** damage taken about -20 % (`COMBAT.DAMAGE_SCALE`), so a car lasts a bit longer; the anti-stall drain and wall multiplier are unchanged. Walls and cars keep their ratio.
- These are starting values: they are constants, changed in one place, confirmed by the owner's playtest. Tests that pin first-guess damage numbers are updated, and the Stadium hash is re-recorded once.

## Delivery in three plans

1. **Plan 8, the arena engine:** first the tuning-neutral refactor and `ArenaDef`, the layout files (the Blender script writes the JSON first, scenery comes in Plan 9), `Simulation(slots, arena)`, ground feel, bounds, spawns, bots, the vote, protocol 4, the vote panel, box visuals drawn from the layout, and last the retune step. Playable end to end with plain boxes.
2. **Plan 9, arena scenery:** the four Blender scenes, the GLB loader and cache, the per-arena looks, tyre-mark colours, presets.
3. **Plan 10, car models:** protocol 5, the menu picker, `CarView` from GLB, dent density in the Blender export, parts per model.

The order of Plans 8-10 can change; Plan 10 does not depend on Plans 8-9.

## Testing

- Layout validation per arena; the Stadium layout equals today's geometry; one determinism hash per arena (Node equals browser).
- Vote rules: majority, tie, no votes, change of vote, a leaver, a newcomer, a vote outside the results phase (ignored), the first round.
- Protocol round trips and rejection of malformed votes and unknown ids.
- Server: out of bounds in a non-circular arena, spawns, bots do not drive through walls or into the pit.
- Client: `MatchState` vote state, the loader's cache and fallback (with a fake loader), the car picker, `CarView` from a test GLB (parts, paint, dents on dense panels).
- Browser checks, one per arena and per car, with `window.__derby.debug()` (draw calls, triangles) on a full room of eight.
- A load test with mixed arenas and cars.

## Risks

- **Handling on ice and in mud** must stay controllable: grip, drag and power are tunable constants and need a real playtest.
- **Size:** four arena GLBs plus four car GLBs; arenas are loaded on demand and cached; GLBs are optimised (shared materials, no unused data).
- **Performance** with GLB cars and richer scenery on a full room: measured against the 55 fps target; presets give levers.
- **Dents on smooth GLB cars** look different from today's flat-shaded boxes; panel density and normal recomputation need a visual check.
- **Blender work:** four hand-built scenes are the largest piece of effort; the layout JSON lets the game run with boxes meanwhile.
