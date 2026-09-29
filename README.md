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
- The match screen (health bar, timer, kill feed, scoreboard, banners) is the next plan; until then follow a round with `window.__derby.debug()` or the server messages `phase`, `hit`, `ko`, `scores` and `results`.
