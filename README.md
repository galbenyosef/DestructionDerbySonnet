# Wreckyard

Online 3D demolition-derby arena for the browser (working title). Design: `docs/superpowers/specs/`. Plans: `docs/superpowers/plans/`.

## Commands

| Command | What it does |
|---|---|
| `npm install` | install dependencies |
| `npm run dev` | game server on :8080 + Vite client on :5173 (proxies `/ws`) |
| `npm test` | run the Vitest suite |
| `npm run typecheck` | type-check client, server and tests with `tsc` |
| `npm run build` | build `dist/client` and the bundled `dist/server/index.js` |
| `npm start` | run the bundled server (`PORT` env, default 8080) |
| `npm run smoke` | after `npm run build`: check the production bundle and the dev flow |

## Playing

- `npm run dev`, then open http://localhost:5173/ — pick a name and colour, then **Quick Play** or **Create private room**. Share the 4-letter code (or the *Copy invite link* button) with friends.
- Skip the menu with URL parameters: `?auto=quick`, `?auto=create` or `?auto=join:ABCD`, plus `&name=Tester&color=2`. `?room=ABCD` pre-fills the join box. `?sandbox` opens the offline driving sandbox.
- No friends around? The server already fills a room with bots up to four cars. To add a headless *player* that drives around and logs the round, run `npx tsx scripts/bot.ts --mode quick --name Bot` (`--mode join --code ABCD` for a private room).
- Play across your network: `npm run build && npm start`, then open `http://<your-LAN-IP>:8080/` on each device.
- Server configuration (environment variables): `PORT` (8080), `ALLOWED_ORIGINS` (comma-separated exact origins; default: same host only), `MAX_ROOMS` (12), `MAX_CONNECTIONS` (200), `STATIC_DIR` (`dist/client`), `BOT_FILL` (bots fill a room up to this many cars; default 4, 0 = none), `COUNTDOWN_SECONDS` (5), `ROUND_SECONDS` (240), `RESULTS_SECONDS` (8).
- Debugging: `window.__derby.debug()` in the browser console prints the connection, phase, roster and every car's pose, hit points and whether it is still running.
- `npm run smoke` uses ports 18080 (production bundle), 8080 (server) and 5173 (Vite). Set `SMOKE_PROD_PORT`, `SMOKE_SERVER_PORT` and `SMOKE_VITE_PORT` to run it next to a live `npm run dev`.

## Netcode

- Your own car is **predicted**: the browser runs the same physics as the server for every car, replays your not-yet-acknowledged inputs on top of each server snapshot, and hides the small corrections. `?net=interp` switches to plain snapshot interpolation — to compare, or if prediction ever misbehaves. If the physics engine cannot load in a browser, the game falls back to interpolation on its own.
- Try bad networks in the browser: `?lag=120&jitter=30&loss=1` adds 120 ms of round trip, ±30 ms of jitter per direction and 1 % lost input/snapshot frames (JSON control messages are never dropped).
- `window.__derby.netStats` (summarised in the HUD's bottom-left line) shows snapshot rate and jitter, how large corrections were, how often the local prediction was kept, and the cost of the replay. `window.__derby.debug()` adds the predictor's counters. When the server stops acknowledging your inputs (a dead or badly stalled uplink) the line ends with "connection unstable", and your car coasts the way the server plays it until acknowledgements resume.
- Determinism check: `npm run hash` prints the hash of a scripted 600-tick, 3-car simulation (collisions included) run in Node; `await __derby.simHash()` in a browser console must print the same 8 digits.

## Rounds and combat

- A room plays in rounds: a 5 s countdown (a fresh arena, every car held still), then the round runs until one car is left, four minutes pass (the most HP wins) or every human is out, then 8 s of results. Whoever is in the room when a round starts gets a car; anyone who joins later watches until the next round. A player who joins during a countdown restarts it (at most eight times per round), so friends who join together play together.
- Bots fill a room up to four cars and step aside as humans join.
- Damage comes from impacts, measured as the impulse the collision transmits. Walls hurt half as much as cars, the rear of a car is its sturdiest side and the front its weakest, and scraping or pushing does nothing. A car is out at 0 HP, after 3 s upside down, after 8 s without moving, or when it leaves the arena; after 20 s without hitting or being hit it loses 2 HP per second until it is in a hit. Cars that are out stay in the arena as wrecks.
- Scoring: 1 point per HP of damage dealt, +50 for the elimination, +100 for winning the round. Running totals stay while you are in the room.
- Tuning lives in `COMBAT` and `ROUND` in `src/shared/constants.ts`.
- The match screen shows the round clock and how many cars still run (top centre), the scoreboard (top right; hold **Tab** for kills and health), a kill feed under it, your health bar with the damage taken on each side of the car and your speed (bottom centre), a red flash when you are hit, and banners for the countdown, GO, being out and the results. Other cars carry their name and a health bar. **F3** shows the network line (mode, ping, frame rate, prediction error).
- When your car is out, or you joined a round that was already running, a camera orbits a car that is still running; **← → (or A/D, Q/E)** switches car. Your controls keep being sent while you watch, so the server does not drop you as inactive.

## Damage you can see and hear

- Every hit dents the car where it landed. The server tells everyone which car was hit, where and how hard, and each browser crumples the same mesh the same way, so two players see the same wreck. A player who joins mid-round is sent the round's latest hits (up to 64) and sees the cars dented as they are. Parts come off when a side has taken enough damage (bumpers first, then hood or trunk, and doors) and fly away as debris; the next round starts with whole cars.
- Sparks, dust, smoke and fire are particles drawn on the GPU: sparks on impacts and scrapes, dust behind fast cars, smoke from a car under 50 HP and fire under 25, and a wreck burns, then smoulders. Tyre marks are drawn into one texture over the arena while a tyre slides or the handbrake is on, and wiped for the next round.
- The camera shakes with impacts of your own car, felt at once from the local simulation rather than after the round trip, and a little with nearby ones. Bloom makes the lamps, headlights and sparks glow; `?bloom=0` turns it off. The stands have a crowd, and tyre stacks stand outside the barrier.
- Sound is synthesised in the browser, with no sound files: an engine for every running car, crashes by the size of the impact, the countdown beeps and the horn. **H** honks (other players cannot hear it) and **M** mutes. Browsers allow sound only after a click or a key press.
- With `?net=interp` there is no local prediction, so impacts show and sound when the server's hit message arrives.
- F3's line shows the script time per frame; `window.__derby.debug()` reports the draw calls and triangles of the last frame and the number of live particles and pieces of debris.

