> **Status:** approved by the user on 2026-09-28 in plan mode. The "Addendum — rehearsal findings" at the end was added afterwards; it records verified facts only and changes no decision.

# Wreckyard — online 3D demolition-derby arena for the browser

## Context

You asked for a 3D destruction-derby clone that people can play online in a browser. The repo is empty (greenfield; the only file is a stray `firebase-debug.log` written by a plugin). You picked **arena mode**: everyone starts in a walled dirt arena, ram each other, the last car running wins, rounds repeat.

**Outcome:** open a URL → Quick Play (or share a private-room link) → drive, ram, dent, wreck, win — against other humans and AI bots that fill empty seats. Working title "Wreckyard"; no assets, names or branding from the original game (all art and audio is generated in code).

**Assumptions I made without asking — correct any at approval:**
desktop browsers with keyboard/gamepad (no mobile touch in v1) · up to 8 cars per room · bots fill rooms to 4 cars · no accounts or persistence · one arena, stylized low-poly night-stadium look · ships as one Node service + Dockerfile · `git init` only, no commits unless you ask · nothing is deployed anywhere without your go-ahead.

## Approaches considered

| Approach | Verdict |
|---|---|
| **A. Own Node `ws` server, server-authoritative Rapier sim; client runs the *same* sim for all cars and rolls back / re-simulates on every server snapshot** | **Chosen.** Rocket-League-style: local car responds instantly and collisions look consistent. Full control of binary protocol and tick. |
| B. Colyseus rooms + schema state sync | Rejected. Schema sync suits board/turn state, not physics snapshots with prediction; adds a framework for ~300 lines of room logic. |
| C. Server-authoritative, snapshot interpolation only | Kept as a fallback (`?net=interp`). Simple, but steering lags by RTT + ~100 ms and cars visibly overlap before a hit resolves. |
| D. P2P WebRTC, host-authoritative | Rejected. Signaling/NAT traversal, host advantage, host migration. |
| E. Rooms on Vercel Functions WebSockets | Rejected. A room needs one long-lived 60 Hz process; function instances scale out and time out. (Serving only the static client from Vercel stays possible.) |

## Stack (versions = today's `latest` on npm)

| Layer | Choice |
|---|---|
| Language / layout | TypeScript, **single npm package** with `src/{shared,server,client}` and relative imports (no workspaces, no path aliases) |
| Render | three **0.186.1** (`@types/three` 0.186.0), `WebGLRenderer` (mature default; WebGPU not needed), vanilla TS + DOM overlay UI, Vite **8.3** |
| Physics | `@dimforge/rapier3d-deterministic-compat` **0.21.0** on server **and** client (same WASM ⇒ prediction matches). Built-in `DynamicRayCastVehicleController` for cars |
| Server | Node + `ws` **8.22**, one process hosting all rooms; 60 Hz sim, 30 Hz snapshots |
| Tooling | Vitest **5.0**, `tsx` 4.23 (dev server), `esbuild` 0.28 (prod server bundle), `concurrently` 10, `@types/node@24`, `@types/ws`; TypeScript **7.0** for type-check only (pin 6.0 — the last JS-based release — if any tool trips). Offline tuning panel uses the lil-gui copy bundled in three's addons |
| Runtime | Local Node 26.8, npm 11, Docker 29 present. Image base `node:24-slim` (Node 24 is LTS; tag verified to exist) |

## Dependency check (Context7 docs + npm + the package's own typings)

I first checked only npm versions plus Rapier and three's renderer choice in Context7. I then checked every remaining tool against its docs and, for Rapier, against the exact package's `.d.ts` files. What it changed:

| Tool | Verified | Consequence for the build |
|---|---|---|
| **Rapier 0.21** (deterministic-compat) | `await RAPIER.init()` required. Typings contain `createVehicleController`, `DynamicRayCastVehicleController.updateVehicle(dt, filterFlags?, …)`, `QueryFilterFlags.ONLY_FIXED`, contact-force events, `contactPair` manifolds, `setMassProperties`, `roundCuboid`, `takeSnapshot`. Forward axis = getter `indexForwardAxis` + a setter **accessor literally named `setIndexForwardAxis`** (assign it; don't call it). `World.restoreSnapshot` builds a *new* World. Contact-force-event and manifold objects are valid only inside their callbacks. 0.21 also ships soft-body types (unused) | M1 spike confirms axis and steer-sign conventions before anything depends on them. Rollback resets bodies with `setTranslation/Rotation/Linvel/Angvel`, not snapshot restore. Copy values out of callbacks. Free `World` and `EventQueue` explicitly. Pin Rapier exactly (`--save-exact`) |
| **three r186** | `PCFSoftShadowMap` deprecated (falls back to `PCFShadowMap`, which is now soft); `THREE.Clock` deprecated since r183 → `THREE.Timer`; post-processing lives at `three/addons/postprocessing/{EffectComposer,RenderPass,UnrealBloomPass,OutputPass}.js`; lil-gui ships at `three/addons/libs/lil-gui.module.min.js`; deprecations last 10 releases | Use `PCFShadowMap` and `Timer`; no separate `lil-gui` dependency; pin `three` + `@types/three` exactly |
| **Vite 8** | Rolldown-based; `build.rollupOptions` → `build.rolldownOptions`; `server.proxy` with `ws: true` unchanged; needs Node ≥ 20.19 / 22.12 | Dev proxy `/ws` → `ws://localhost:8080`; use `rolldownOptions` if build tuning is needed |
| **Vitest 5** | Peer range includes Vite `^8` ✓; `workspace` replaced by `projects`; `@types/node` peer is `^22 \|\| >=24` | One config, no workspace file; install `@types/node@24` |
| **TypeScript 7** | Native (Go) compiler. Defaults now: `strict` on, `types` empty (must list `node`, `vite/client`), bundler-style resolution. Removed: `baseUrl`, `moduleResolution: node10/classic`, `target: ES5`, `esModuleInterop: false`, `outFile`, legacy `module` kinds. Tools importing the `typescript` JS API may not work with 7.x | Relative imports, explicit `types`, explicit `target: ES2022`; use only the `tsc --noEmit` CLI; nothing imports the `typescript` package |
| **ws 8.22** | `perMessageDeflate` off by default ✓; `maxPayload` defaults to 100 MiB; `verifyClient` documented as discouraged; README heartbeat = `ping()` + `isAlive` flag | `noServer: true` + HTTP `upgrade` handler for origin/capacity checks; `maxPayload: 1024`; 30 s heartbeat |
| **esbuild 0.28** | With `--platform=node`, npm packages are **external by default** (since 0.22) | Prod bundle uses `--packages=bundle`, a `createRequire` banner for ESM output, and `--external:bufferutil --external:utf-8-validate` (ws optional native deps) ⇒ image needs no `node_modules` |
| **Node / Docker** | Node 24 = LTS ("Krypton"), 22 = LTS ("Jod"), 26 = Current; `node:24-slim` manifest exists; engine ranges of Vite 8, Vitest 5, concurrently 10 all satisfied | Image `node:24-slim`; local dev on 26 |

## Architecture

```
Browser                                              Node server (one process)
┌───────────────────────────────────┐   WS /ws     ┌────────────────────────────────┐
│ keyboard/gamepad → NetClient ─────┼─ inputs 60Hz▶│ Lobby ─ Room ─ Room …          │
│  ├ Simulation (Rapier, ALL cars,  │◀─ snapshots ─┤  Room: phases, players, bots,  │
│  │  rollback + re-sim per snapshot)│    30 Hz     │  Simulation (same shared code),│
│  └ interp fallback                │◀─ events ────┤  damage · scoring · KO rules   │
│ three.js scene · FX · audio · UI  │   (JSON)     └────────────────────────────────┘
└───────────────────────────────────┘
        shared/: constants · protocol · sim · vehicle · arena · damage · math
```

```
package.json  tsconfig.{client,server}.json  vite.config.ts  vitest.config.ts  Dockerfile  README.md  CLAUDE.md
src/shared/  constants.ts protocol.ts sim.ts vehicle.ts arena.ts damage.ts math.ts
src/server/  index.ts lobby.ts room.ts player.ts bots.ts limits.ts
src/client/  index.html main.ts
             net/   connection.ts prediction.ts interp.ts        (DOM-free ⇒ testable in Node)
             game/  scene.ts carView.ts effects.ts camera.ts input.ts audio.ts
             ui/    menu.ts hud.ts banners.ts
tests/       protocol · vehicle · damage · room · prediction · integration/
scripts/     loadtest.ts (bot clients)
```

Critical files: `src/shared/sim.ts` (Simulation: the one step function both sides run), `src/shared/vehicle.ts`, `src/shared/protocol.ts`, `src/server/room.ts`, `src/client/net/prediction.ts`, `src/client/game/carView.ts`. Tuning lives only in `constants.ts`, so server and client cannot drift.

## Gameplay rules (server-authoritative)

- **Car:** rear-wheel-drive sedan, ~1500 kg, box collider with lowered centre of mass (`setMassProperties`), 100 HP. Controls: throttle/brake-reverse, steer, handbrake. Wheel rays hit fixed geometry only (`QueryFilterFlags.ONLY_FIXED`).
- **Damage:** Rapier contact-force events on chassis colliders (threshold ignores scrapes). Impulse `J = force × dt`, nonlinear above a minimum. Zone (front/rear/left/right) from the contact point in car-local space via `world.contactPair` → `solverContactPoint`. Multipliers front 1.15 / rear 0.9 / sides 1.0 (backing into opponents is the smart move); walls ×0.5. Attacker = the other car in contact; assists credited for 5 s.
- **Eliminated when:** HP ≤ 0 · flipped > 3 s · immobile > 8 s · out of bounds · disconnected. Wrecks stay in the arena as smoking obstacles until the round ends.
- **Anti-stall:** 20 s without hitting or being hit ⇒ 2 HP/s until contact.
- **Rounds:** COUNTDOWN 5 s (cars frozen, fresh world) → LIVE (max 4 min) → RESULTS 8 s → repeat. Ends at ≤1 alive, timeout (most HP wins) or no humans alive. Late joiners spectate until the next round.
- **Score:** 1 pt per HP of damage dealt, +50 KO, +100 round win; running room leaderboard.
- **Rooms:** Quick Play joins the first open public room; private rooms use a 4-letter code / `?room=ABCD` link; capacity 8; bots fill to 4 cars and step aside as humans join.
- **Bots (server-side input producers, same path as humans):** pick nearest/weakest target, lead-pursuit steering, wall avoidance, stuck-recovery (reverse + turn), skill jitter so they are beatable.

## Netcode

- **One step function** (`Simulation.step`): apply inputs → `updateVehicle(dt)` per car in slot order → `world.step(events)`. No `Math.random`/`Date.now`/trig in shared sim code. A fresh world is built at each COUNTDOWN on both sides from the same roster + seed.
- **Input** (client→server, binary, 8 B, 60 Hz): `type u8 · seq u32 · throttle i8 · steer i8 · flags u8`. Client quantizes *before* applying locally so both sides use identical values. Server keeps a small per-player queue, consumes one input per tick, repeats the last on starvation (neutral after 0.5 s), caps depth at 6.
- **Snapshot** (server→client, binary, 30 Hz, ~310 B for 8 cars ≈ 9 KB/s): header `type · epoch · serverTick · ackSeq · carCount`; per car `slot · flags · hp · pos f32×3 · quat i16×4 · linvel i16×3 · angvel i16×3 · throttle i8 · steer i8`. Skip a socket whose `bufferedAmount` > 64 KB.
- **Events** (JSON): `welcome`, `roster`, `phase`, `hit`, `ko`, `results`, `pong`.
- **Client rollback:** local Simulation steps all cars at fixed 60 Hz. On each snapshot: set every car to the server state at tick T, then re-simulate `localTick − ackSeq` steps (local car uses its stored inputs, remote cars their last known input). Local car skips reset when within a small deadband (avoids quantization noise). Render offset error decays (τ ≈ 100 ms, snap above 2 m); render interpolates between fixed steps.
- **Debug:** `?net=interp` (fallback), `?lag=120&jitter=30&loss=1` (client-side latency simulator), `window.__derby.netStats`.
- **Server hygiene:** `noServer` WebSocket attached via the HTTP `upgrade` handler (origin check against `ALLOWED_ORIGINS`, room-capacity check), `maxPayload: 1024`, per-socket rate limit, name sanitising, 30 s ping/pong heartbeat, MAX_ROOMS cap, `world.free()` / `EventQueue.free()` on round rebuild and room disposal.

## Client experience

- **Look:** night stadium — floodlights, fog, dark dirt, concrete barrier ring, tyre stacks, crowd silhouettes; bloom (`EffectComposer` + `UnrealBloomPass` + `OutputPass`) on sparks/fire/headlights; one shadow-casting floodlight (`PCFShadowMap`). Ground marks drawn into one canvas texture (cheap skid marks). Frame timing via `THREE.Timer`.
- **Cars:** procedural low-poly bodies (subdivided grids, flat shading so dents need no normal recompute), painted number, coloured per player, floating name tags.
- **Destruction:** server `hit` events → deterministic vertex dents on both cars (seeded per event; late joiners get a capped dent log). Bumpers/hood/trunk/doors detach by zone damage and become cosmetic debris. GPU particle pools (ring buffer + time uniform) for sparks, smoke, fire, dust. Local-car contacts fire local FX (sparks, sound, shake) immediately; server events drive FX for other cars.
- **Camera:** chase cam with speed FOV and spring lag, trauma-based shake, spectator orbit that cycles alive cars.
- **Audio (WebAudio synthesis, no files):** per-car engine voices (pitch from speed/throttle, panned/attenuated), crash thumps + noise bursts by impact size, horn, countdown beeps. Unlocked on first click; `M` mutes.
- **UI (DOM):** menu (name, colour, Quick Play / Create / Join code), HUD (HP bar + 4-zone damage diagram, speed, alive count, timer, live scoreboard, kill feed), countdown/winner banners, spectator hint, `F3` debug (FPS, ping, net stats). Graphics presets (auto-downgrade on low FPS).
- **Input:** WASD/arrows, Space handbrake, H horn, M mute, Tab scoreboard; gamepad sticks/triggers. Keyboard steering is ramped client-side before sending.

## Milestones (each ends runnable and verified)

| # | Deliverable | Done when |
|---|---|---|
| M0 | Scaffold: npm scripts (`dev`, `build`, `start`, `test`, `typecheck`), tsconfigs (explicit `types`, no `baseUrl`), Vite page + WS echo through the `/ws` dev proxy, Vitest, `.gitignore` (incl. `firebase-debug.log`), `git init` | `npm run dev` serves the page and echoes over `/ws`; `npm test` and `npm run typecheck` pass (proves the TS 7 / Vite 8 / Vitest 5 chain) |
| M1 | Shared sim, vehicle, arena + **offline sandbox** (chase cam, lil-gui tuning). Starts with a Rapier spike confirming forward axis (`setIndexForwardAxis`) and steer-sign conventions | Headless tests: accelerates forward, steers right, no flip in 10 s full-throttle circles, bit-identical after 600 ticks; you can drive it |
| M2 | Multiplayer baseline: lobby, rooms, authoritative loop, binary protocol, interpolation, name tags, spectate-until-next-round | Two clients see each other drive and shove; integration test with real server + `ws` clients |
| M3 | Prediction + rollback re-sim, latency simulator, net stats, cross-runtime determinism check | Scripted lag/jitter run keeps correction stats within limits; `?net=interp` toggle works |
| M4 | Combat & rules: damage/zones, KO/wrecks, rounds, scoring, HUD, kill feed, bots, anti-stall | Full round to a winner with 1 human + bots and with 2 humans; room state-machine tests |
| M5 | Destruction & juice: dents, parts/debris, particles, skid marks, shake, bloom, audio, arena dressing | Screenshots reviewed; dents identical across two clients; ≥ 55 fps with 8 cars on this Mac |
| M6 | Polish & packaging: menu/settings, presets, limits/origin check, README, CLAUDE.md, Dockerfile (esbuild bundle, no `node_modules` in the image), load test | `docker build && docker run` → playable on localhost; load test passes |
| M7 | Deploy — **only with your go-ahead and your hosting account** | Public URL passes a join-and-play smoke test |

M4 (server rules) and M5 (client visuals) are independent once `protocol.ts` is frozen at the end of M2, so they can be built in parallel by separate agents.

## Verification

1. **Vitest:** protocol round-trips and quantization bounds · vehicle behaviour + determinism · damage curve and zone classification (head-on ⇒ front/front) · room state machine (phases, winner, bot fill, join/leave) · prediction against the real `Simulation` through a delayed loopback.
2. **Integration:** start the real server on an ephemeral port, connect several headless `ws` clients running the same `net/` modules, complete a round; assert snapshot rate ≈ 30 Hz and ack progress.
3. **Browser (in-app browser / Playwright):** dev server; one human page plus headless bot clients (or a second page); check console errors, HUD text, screenshots of dents/particles, an FPS probe, and runs under `?lag=…`.
4. **Cross-runtime determinism:** same scripted 600-tick sim hashed in Node and in Chrome — hashes must match.
5. **Load:** `scripts/loadtest.ts` — 10 rooms × 8 bot clients for 5 min; target p99 tick ≤ 4 ms, flat memory.
6. **Packaging:** `docker build` + `docker run`, hit `/healthz`, join and play through a round.

**Definition of done:** tests green; `docker run` playable on localhost; two browsers + bots finish a round with visible dents and a winner banner; ≥ 55 fps at 8 cars; behaviour stays smooth under 120 ms simulated RTT.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Raycast-vehicle handling feel (I can't drive it myself) | M1 sandbox with live tuning panel + numeric tests; all tunables in one file; you playtest early |
| Rollback re-sim bugs / cost | Built after a working interpolation baseline; `?net=interp` fallback; ~3–8 steps × 8 cars per snapshot is cheap; net-stats overlay |
| Server/client physics drift | Same deterministic WASM, fixed dt, ordered iteration, quantized inputs, no trig in shared code; cross-runtime hash test |
| Brand-new tooling (TS 7, Vite 8, Vitest 5) | Compatibility checked (peer ranges, docs, engines); TS 7 used only as `tsc --noEmit`; M0 smoke-tests the whole chain first; pin older majors if anything breaks |
| WebSocket/TCP head-of-line jitter | Newest-wins snapshots at 30 Hz, congestion skipping, rollback hides late data; WebRTC unreliable channel is a future option |
| Hidden tabs stop sending input | Server neutralises input after 0.5 s and drops inactive players to spectator after 30 s |
| Hosting proxies kill idle sockets | Ping/pong keepalive both directions |

## Out of scope for v1

Mobile touch controls · accounts, persistent leaderboards · chat/voice · car customisation beyond colour · multiple arenas · track-racing mode (a later, separate spec) · power-ups · seamless reconnect · WebRTC transport · Rapier soft-body cars.

## After approval

1. Per your brainstorming workflow, I'll turn M0–M2 into a task-level implementation plan (writing-plans skill) and ask how you want it executed (subagents vs inline). Say so if you'd rather skip straight to building.
2. First actions: `git init`, scaffold (M0), then the Rapier vehicle spike inside M1 before anything else depends on it.
3. Nothing external happens (deploy, account creation, pushing) without asking first.


## Addendum — rehearsal findings (2026-09-28, after approval)

Before writing the implementation plans I rehearsed the toolchain and probed the car physics in a throwaway project outside this repo. These facts refine the design; no decision changed.

**Toolchain (pinned versions, scratch project)**

- `tsc` 7.0.2 with three tsconfigs, Vitest 5.0.2, the Vite 8.3.1 client build and the esbuild server bundle (ESM, packages bundled, `createRequire` banner) all pass. The bundled server initialises Rapier in Node and serves `/healthz` plus a WebSocket echo. The dev flow (`tsx` server + Vite + `/ws` proxy) works, and Rapier's embedded WASM initialises in Chromium under Vite dev.
- A deliberate type error is caught (TS2322), so a silent `tsc` run really means clean.
- npm 11.19 blocks dependency install scripts by default (esbuild's postinstall); esbuild works without it.
- Client bundle ≈ 4.4 MB (1.7 MB gzip), dominated by Rapier's embedded WASM. Acceptable; `build.rolldownOptions.output.codeSplitting` is the lever if it ever matters.
- `concurrently "npm:a" "npm:b"` works. three r186 exposes `Timer`, `PCFShadowMap` and every addon path used here.

**Physics (Rapier 0.21 deterministic-compat)**

- Conventions: forward +X, up +Y, right +Z, wheel axle +Z, `controller.setIndexForwardAxis = 0` (an accessor). Positive wheel steering turns left. `currentVehicleSpeed()` is signed forward speed in m/s.
- Tuning that gives arena-scale handling: mass 1500 kg; chassis half-extents (2.3, 0.5, 1.0); centre of mass 0.35 m below centre; wheel hard points (±1.45, −0.3, ±0.95), rest length 0.45, radius 0.4; suspension stiffness 30 / compression 3.0 / relaxation 2.6 / max travel 0.4 / max force 60000; tyre slip 2.0; engine 8000 N; brake 55; max speed 21 m/s; steering 0.55 rad tapering to 0.25 at 20 m/s.
- Measured with that tuning: settles at y = 1.074 on all four wheels; 3 s → 16 m/s, top speed 19.9 m/s; 19.4 m/s → stop in 2.1 s over 20.6 m; reverse −7.8 m/s; full-lock turning radius 14 m at 14 m/s and 19 m at 17 m/s; no rollover in circles, wall hits at 17 m/s or T-bones at 16 m/s.
- Determinism: identical scripted runs are bit-equal. A 3-car, 900-tick run with collisions and handbrake produces the same hash (`4e3b6efe`) in Node 26 and in Chromium. Resetting body state (`setTranslation/Rotation/Linvel/Angvel`) reproduces a run to within 1e-4 m, so rollback re-simulation is sound.
- Cost: 8 cars ≈ 0.02–0.04 ms per tick; world create + free ≈ 0.4 ms.
- Memory: tear a world down with `removeVehicleController` (every car) → `EventQueue.free()` → `world.free()`. Skipping the first leaks ≈ 0.5 MB per world; with it, RSS plateaus (≈ 255 MB total process over 3000 rounds).
- Impacts: a head-on at 10 m/s each gives J = force × dt ≈ 18.6 kN·s per car (= m·Δv); contact points fall on the correct face in the car's local frame (front face x = +2.3; T-bone side z = ∓1.0). A sustained T-bone spreads ≈ 17 kN·s over ~22 ticks, so the combat plan must accumulate impulse per contact pair over a short window rather than threshold each tick. `totalForceMagnitude` can exceed m·Δv on wall hits (it sums magnitudes), so combat should cap it with the measured velocity change.
