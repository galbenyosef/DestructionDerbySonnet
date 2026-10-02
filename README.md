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
| `npm run smoke` | after `npm run build`: run the bundle from an empty folder (no `node_modules`) and the dev flow |
| `npm run loadtest` | play many rooms at once against a running server (see *Limits and load test*) |

## Playing

- `npm run dev`, then open http://localhost:5173/ — pick a name and colour, then **Quick Play** or **Create private room**. Share the 4-letter code (or the *Copy invite link* button) with friends.
- Skip the menu with URL parameters: `?auto=quick`, `?auto=create` or `?auto=join:ABCD`, plus `&name=Tester&color=2`. `?room=ABCD` pre-fills the join box. `?sandbox` opens the offline driving sandbox.
- No friends around? The server already fills a room with bots up to four cars. To add a headless *player* that drives around and logs the round, run `npx tsx scripts/bot.ts --mode quick --name Bot` (`--mode join --code ABCD` for a private room).
- Play across your network: `npm run build && npm start`, then open `http://<your-LAN-IP>:8080/` on each device.
- Server configuration (environment variables): `PORT` (8080), `ALLOWED_ORIGINS` (comma-separated exact origins; default: same host only), `MAX_ROOMS` (12), `MAX_CONNECTIONS` (200), `STATIC_DIR` (`dist/client`), `BOT_FILL` (bots fill a room up to this many cars; default 4, 0 = none), `COUNTDOWN_SECONDS` (5), `ROUND_SECONDS` (240), `RESULTS_SECONDS` (12), `MAX_CONNECTIONS_PER_IP` (16; 0 = no limit), `TRUST_PROXY` (how many reverse proxies stand in front of the server; default 0).
- Debugging: `window.__derby.debug()` in the browser console prints the connection, phase, roster and every car's pose, hit points and whether it is still running.
- `npm run smoke` uses ports 18080 (the bundle, run from a temporary folder with no `node_modules`), 8080 (server) and 5173 (Vite). Set `SMOKE_PROD_PORT`, `SMOKE_SERVER_PORT` and `SMOKE_VITE_PORT` to run it next to a live `npm run dev`.

## Netcode

- Your own car is **predicted**: the browser runs the same physics as the server for every car, replays your not-yet-acknowledged inputs on top of each server snapshot, and hides the small corrections. `?net=interp` switches to plain snapshot interpolation — to compare, or if prediction ever misbehaves. If the physics engine cannot load in a browser, the game falls back to interpolation on its own.
- Try bad networks in the browser: `?lag=120&jitter=30&loss=1` adds 120 ms of round trip, ±30 ms of jitter per direction and 1 % lost input/snapshot frames (JSON control messages are never dropped).
- `window.__derby.netStats` (summarised in the HUD's bottom-left line) shows snapshot rate and jitter, how large corrections were, how often the local prediction was kept, and the cost of the replay. `window.__derby.debug()` adds the predictor's counters. When the server stops acknowledging your inputs (a dead or badly stalled uplink) the line ends with "connection unstable", and your car coasts the way the server plays it until acknowledgements resume.
- Determinism check: `npm run hash` prints the hash of a scripted 600-tick, 3-car simulation (collisions included) run in Node in the Stadium; `npm run hash -- 600 ice` (or `quarry`, `port`) does the same in another arena. `await __derby.simHash()` (or `await __derby.simHash(600, 'ice')`) in a browser console must print the same 8 digits. `tests/determinism.test.ts` records all four.

## Rounds and combat

- A room plays in rounds: a 5 s countdown (a fresh arena, every car held still), then the round runs until one car is left, four minutes pass (the most HP wins) or every human is out, then 12 s of results, which are also the vote for the next arena. Whoever is in the room when a round starts gets a car; anyone who joins later watches until the next round. A player who joins during a countdown restarts it (at most eight times per round), so friends who join together play together.
- Bots fill a room up to four cars and step aside as humans join.
- Four arenas: the Stadium (the round dirt bowl), the Frozen Lake (slippery ice, low snow banks, blocks of ice), the Mud Quarry (an oval pit with a raised mound and ramps; the mud drags at the cars and costs a little top speed) and the Container Port (a rectangular yard of shipping containers and two ramps, with a little more grip). Each is a layout file, `src/shared/arenas/<id>.json`, which the server and the browser both build the physics from; `python3 art/arenas/layouts.py` writes them. A room's first round is in a random arena. During the results every player in the room can vote (click a card or press 1 to 4); the arena with the most votes is played next, a tie or no vote at all is settled by the room's seeded random. Bots do not vote. The server and the client agree on the version of the protocol: it is 4.
- Scenery: the Frozen Lake, the Mud Quarry and the Container Port have Blender models (`src/client/assets/arena_<id>.glb`, scenery only, no collision) that `art/arenas/build_arenas.py` builds from the same layouts as the physics: `/Applications/Blender.app/Contents/MacOS/Blender -b --python art/arenas/build_arenas.py` (Blender 5; `ARENA=ice` for one; `PREVIEW=<folder>` also renders pictures). The browser loads the model of the arena leading the vote while the vote is open, so the winner is ready for the countdown; until it arrives, and for good if it never does, the arena is drawn as the plain boxes of its layout. The Low graphics preset drops the props and the backdrop. The Stadium keeps the stands, crowd and floodlights it builds in code. Tyre marks are drawn in the colour of each ground.
- Damage comes from impacts, measured as the impulse the collision transmits. Walls hurt half as much as cars, the rear of a car is its sturdiest side and the front its weakest, and scraping or pushing does nothing. A car is out at 0 HP, after 3 s upside down, after 8 s without moving, or when it leaves the arena; after 20 s without hitting or being hit it loses 2 HP per second until it is in a hit. Cars that are out stay in the arena as wrecks.
- Scoring: 1 point per HP of damage dealt, +50 for the elimination, +100 for winning the round. Running totals stay while you are in the room.
- Tuning lives in `COMBAT` and `ROUND` in `src/shared/constants.ts`.
- The match screen shows the round clock and how many cars still run (top centre), the scoreboard (top right; hold **Tab** for kills and health), a kill feed under it, your health bar with the damage taken on each side of the car and your speed (bottom centre), a red flash when you are hit, and banners for the countdown, GO, being out and the results. Other cars carry their name and a health bar. **F3** shows the network line (mode, ping, frame rate, prediction error); on a Mac keyboard it is **Fn+F3** unless the function keys are set to standard.
- When your car is out, or you joined a round that was already running, a camera orbits a car that is still running; **← → (or A/D, Q/E; the bumpers on a gamepad)** switches car. Your controls keep being sent while you watch, so the server does not drop you as inactive.

## Damage you can see and hear

- Every hit dents the car where it landed. The server tells everyone which car was hit, where and how hard, and each browser crumples the same mesh the same way, so two players see the same wreck. A player who joins mid-round is sent the round's latest hits (up to 64) and sees the cars dented as they are. Parts come off when a side has taken enough damage (bumpers first, then hood or trunk, and doors) and fly away as debris; the next round starts with whole cars.
- Sparks, dust, smoke and fire are particles drawn on the GPU: sparks on impacts and scrapes, dust behind fast cars, smoke from a car under 50 HP and fire under 25, and a wreck burns, then smoulders. Tyre marks are drawn into one texture over the arena while a tyre slides or the handbrake is on, and wiped for the next round.
- The camera shakes with impacts of your own car, felt at once from the local simulation rather than after the round trip, and a little with nearby ones. Bloom makes the lamps, headlights and sparks glow; `?bloom=0` turns it off. The stands have a crowd, and tyre stacks stand outside the barrier.
- Sound is synthesised in the browser, with no sound files: an engine for every running car, crashes by the size of the impact, the countdown beeps and the horn. **H** honks (other players cannot hear it) and **M** mutes. Browsers allow sound only after a click or a key press.
- With `?net=interp` there is no local prediction, so impacts show and sound when the server's hit message arrives.
- F3's line shows the script time per frame; `window.__derby.debug()` reports the draw calls and triangles of the last frame and the number of live particles and pieces of debris.


## Settings

- The menu has a **Graphics** choice, a **Volume** slider and a **Sound** switch. They are remembered in this browser. In a match **G** steps through the graphics presets and **M** mutes.
- **High** is the full look (pixel ratio up to 2, 2048 px shadows, glow, crowd, every effect, 40 pieces of debris). **Medium** draws fewer pixels (up to 1.5), sharpens shadows less, and emits 60 % of the particles and 24 pieces of debris. **Low** draws at pixel ratio 1 with no shadows, no glow and no crowd, 30 % of the particles and 12 pieces of debris.
- If the frame rate stays under 40 for about six seconds the game steps down one preset by itself and says so; it never steps up on its own, so it cannot flap. `?bloom=0` still switches the glow off whatever the preset.

## Limits, hosting and Docker

- Per address, the server allows 16 open sockets (`MAX_CONNECTIONS_PER_IP`), locks an address out for 30 s after 8 failed joins in a minute (a room code that does not exist; trying a full room again is not a guess), and lets it create 6 private rooms a minute. An IPv6 client is limited by its whole /64 prefix, because it controls all of it and could otherwise use a new address every time. Loopback, link-local and private-network addresses are exempt, because behind a reverse proxy on the same machine every player looks like one of them, and a LAN game shares subnets. A socket that floods binary input (far more than the 90 frames a second the server takes) is closed; room codes come from the operating system's random source.
- **Behind a proxy or load balancer, set `TRUST_PROXY` right.** Set it to the exact number of reverse proxies in front of the server that append the address they saw to `X-Forwarded-For` (nginx's `$proxy_add_x_forwarded_for` does; check what yours does); the server then reads the address that many entries from the right, because entries further left can be forged by the client. Left at 0 behind a load balancer with a public address, every player shares that address: the whole game is capped at `MAX_CONNECTIONS_PER_IP` sockets and one player's mistakes lock everybody out (behind a proxy with a private address the limits silently switch off instead). And never set it without a proxy that appends, or a client can write its own `X-Forwarded-For`, claim a private address to be exempt or pose as another player. After deploying, check `/healthz` (`connections`) against what you expect. A carrier-grade NAT or a campus can put many players behind one public address; raise `MAX_CONNECTIONS_PER_IP` for that (0 turns it off).
- Only same-host WebSocket origins are accepted unless `ALLOWED_ORIGINS` lists others (exact origins, comma-separated). `/healthz` answers with the room, player and connection counts, the 99th-percentile step time and the process memory.
- Docker: `docker build -t wreckyard .` then `docker run --rm -p 8080:8080 wreckyard`, and open http://localhost:8080/. The image holds only `dist/` (the bundle carries its own dependencies) and runs as the `node` user with a health check on `/healthz`. Pass the settings above with `-e`. A short deployment guide (HTTPS proxy, `TRUST_PROXY`, checks, updating) is in `docs/deployment.md`.
- Load test: start a server with short rounds and no per-address limit (`MAX_ROOMS=12 BOT_FILL=0 MAX_CONNECTIONS_PER_IP=0 COUNTDOWN_SECONDS=3 ROUND_SECONDS=30 RESULTS_SECONDS=5 npm start`), then `npm run loadtest -- --rooms 10 --per-room 8 --seconds 300`. It seats headless drivers in that many rooms, keeps them driving, samples `/healthz` and prints PASS or the limits it broke (step time, memory growth, snapshot rate, refused or closed sockets); `--help`-style options are listed at the top of `scripts/loadtest.ts`.
