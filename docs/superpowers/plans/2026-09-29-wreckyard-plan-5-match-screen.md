# Wreckyard Plan 5 — The Match Screen (M4, client side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the player see the game the server now runs. A round panel with the clock and how many cars still run; a scoreboard (Tab for kills and health); a kill feed; your health bar, the damage you took on each side of the car and your speed; a red flash when you are hit; banners for the countdown, GO, being out and the results; a name and a health bar over every other car; and, when you have no car to drive (you are out, or you joined mid-round), a camera that orbits a car that is still running, with keys to switch. F3 shows the network line that used to be always on.

**Architecture:** Nothing on the server or the wire changes. A DOM-free `MatchState` (the view-model) is fed by the server's messages (`welcome`, `roster`, `phase`, `hit`, `ko`, `scores`, `results`) and, every frame, by the latest snapshot's cars; it answers `view()` with everything the screen shows. The HUD (`ui/hud.ts`) draws a `MatchView` and writes to the DOM only when a value changed. A `SpectatorCamera` (pure math plus smoothing, tested in Node) takes over from the chase camera when your car is not running. `NameTag` puts a name and a health bar (two flat sprites) over other cars. `GameClient` only wires them together.

**Tech Stack:** as Plans 1-4. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-28-wreckyard-design.md` — "Client experience" (UI, camera) and the M4 row. **Prerequisite:** Plan 4 complete and reviewed (branch `plan-4-combat-rounds-and-bots`, HEAD `b8b03db`, 422 tests). This plan starts on a new branch cut from it.

**Scope notes:**
- This is the client half of the spec's M4. Audio, particles, dents, skid marks, shake and bloom are Plan 6; a settings menu and graphics presets are Plan 7. The spec's HUD line also lists "spectator hint", "F3 debug" and the countdown/winner banners: all are here.
- The network line (mode, ping, fps, prediction error) is behind **F3** and hidden by default, as the spec says; Plan 3 had it always on.
- The health bar follows the snapshot's HP; the `hit` messages drive only the damage diagram, the flash and the feed. The anti-stall drain sends no message, only falling snapshot HP, so the bar is the one place it shows.
- Spectator keys: ← → (or A/D, Q/E). They steer when you drive, so they are free once you are out.
- Nothing here changes the shared simulation, the protocol or the server: `npm run hash` still prints `10c3a72a`.

## How the match screen gets its data (read this first)

| Server message | Fed to | What it changes on screen |
|---|---|---|
| `welcome` (`you` is always -1, then a `roster` follows) | `MatchState.onWelcome` | the board and scores a newcomer joins; the phase of a round in progress |
| `roster` (new world; also re-sent, with the **same** `round` and a new `epoch`, when a joiner restarts the countdown) | `onRoster`, `SpectatorCamera.reset`, `ChaseCamera.reset` | your slot for this round, the board's rows; feed, flash and damage diagram start empty |
| `phase` (`countdown`, `live`, `results`, with `remainingMs`) | `onPhase` | the round clock and the big banner; `remainingMs` restarts the clock |
| `hit` (only hits on **you** count) | `onHit` | the red flash and the damage per side of your car |
| `ko` | `onKo` | a kill feed line: who wrecked whom (with helpers), or why a car went out |
| `scores` (at most four a second, and once right after `results` with the round folded in) | `onScores` | the scoreboard |
| `results` | `onResults` | the winner banner, `you scored N` |
| every frame: the latest snapshot's cars | `onCars` | your health and speed, who is out, the alive count, health bars over the other cars |

Banners are **derived from state**, never fired from events: a countdown restart re-sends the roster and the phase, and the banner simply reads `Round 2 — get ready` again with a fresh clock. `hit.tick` is the tick the impact began (up to 33 ticks before the message arrives) while `ko.tick` is the current one, so the feed is ordered by arrival.

**Who drives the camera:** while your car runs, the chase camera follows it. Otherwise (`you` is -1, or your car is a wreck) the spectator camera orbits a car that is still running, picks the next one by itself when its car goes out, and stays inside the barrier. The 60 Hz input loop keeps running while you watch: the server drops a player it has heard nothing from for 30 s.

## Rehearsal findings (measured before this plan was written)

I rehearsed everything below in a scratch copy of the Plan 4 code (the reviewed version) with a production build served on a private port, one human in Chromium plus bots and two scripted headless players, and then executed this plan text against a fresh copy to check that it reproduces the rehearsal file for file.

- **All screen states were seen:** the countdown (`Starts in 5`, the big number, `Round 1 — get ready`), GO, live (`Time left 1:28`, speed in km/h), Tab's detailed board (kills and health columns), F3's network line, `You are out` with `Following BotB` and the key hint, `Watching` for a player who joined mid-round, and the results banner. The hit flash was sampled every 8 ms in a round with 23 hits on the player: 556 non-zero samples, starting near 0.8 and decaying to 0 within 450 ms.
- **Four defects the rehearsal caught, now covered by the plan:** (1) the health bar of a name tag was offset in the *car's* space, so it slid sideways as the camera moved — a sprite turns to face the camera, so the bar sits on the car's vertical axis and keeps its left edge with the sprite's `center` (Task 34 pins it); (2) the health panel stayed on screen for a spectator because a panel that sets its own `display` ignores the `hidden` attribute (one rule in the HUD's styles fixes all panels); (3) the orbit camera went outside the barrier for a car near the wall and showed the back of the wall and the black void (Task 33 clamps it inside); (4) the banner's hint line was hidden behind the name tag of the car being followed (the banner sits higher).
- **Server changes made by the Plan 4 review that this plan relies on:** the standings (with the win bonus) are sent right after `results`, so the board matches the results screen; wrecks earn nothing, so the feed never says a wreck wrecked a car.
- **Cost:** the HUD is asked for a view every frame; the board is redrawn only when its data changed (compared as a string), the feed nodes are reused, and text is written only when it differs.

## Global Constraints

- Everything in Plans 1-4's Global Constraints still applies (single package, relative imports, exact pins, axes, deterministic simulation path, quantised inputs, `freezeTuning`, commits only because the user opted in).
- No change to `src/shared` or `src/server`, and none to the wire. `npm run hash` prints `10c3a72a`.
- DOM is touched only in `src/client/ui`, `src/client/index.html` and `gameClient.ts`; the view-model, the colours and the camera maths are DOM-free and tested in Node. three.js objects that need no canvas (sprites with a plain material) are tested in Node too.
- The HUD is asked every frame: it must write to the DOM only when a value changed.
- The input loop keeps running for a player who has no car.
- The user's own `npm run dev` may be running on ports 8080/5173: never stop it. Use `PORT` with another port for anything that needs a server, and do not start a second Vite next to it.

## Review Focus

1. **A player with no car** (joined mid-round with `you = -1`, or out): no health panel, a banner that says what is going on and which keys switch car, a camera that follows a running car, and nothing throws while there is no car of their own. → Task 32 (`view()` tests), Task 33 (camera), Task 35 (browser check).
2. **A countdown that restarts** (the roster arrives again with the same round): the same banner, the clock starts over, no stale feed or damage. → Task 32.
3. **Nobody left to watch, or the watched car goes out:** the camera moves on, or stays where it is when no car is left; never NaN. → Task 33.
4. **Broken numbers:** NaN or negative health and speed, a slot nobody announced, an absurd frame time, health outside 0-100. → Tasks 32, 33, 34.
5. **A long session:** the kill feed does not grow without bound; a name tag releases its GPU resources when its car leaves. → Tasks 32, 34.

## File Structure

| File | Responsibility |
|---|---|
| `src/client/ui/format.ts` (new) | colours for the health bar, the damage diagram and the board |
| `src/client/game/matchState.ts` (new) | the view-model: what the match screen shows, from messages and snapshots |
| `src/client/game/spectator.ts` (new), `src/client/game/camera.ts` (modify) | the orbit camera for a player with no car; `applyChaseView`, shared with the chase camera |
| `src/client/game/nameTag.ts` (modify) | `NameTag`: a name and a health bar over another car |
| `src/client/ui/hud.ts` (replace), `src/client/index.html` (modify) | the DOM: round panel, board, feed, health and damage, banner, flash, network line |
| `src/client/game/input.ts` (modify) | `isDown`; Tab and F3 do not reach the browser |
| `src/client/game/gameClient.ts` (modify), `src/client/ui/menu.ts` (modify), `README.md` (modify) | wiring; the controls hint; docs |
| `tests/client/…` | one file per new module, plus additions to `camera.test.ts` and `controls.test.ts` |

---

### Task 32: The match view-model

**Files:**
- Create: `src/client/ui/format.ts`, `src/client/game/matchState.ts`
- Test: `tests/client/format.test.ts`, `tests/client/matchState.test.ts`

**Interfaces:**
- Consumes: The protocol 2 message types (`WelcomeMessage`, `RosterMessage`, `PhaseMessage`, `HitMessage`, `KoMessage`, `ScoresMessage`, `ResultsMessage`, `PlayerInfo`, `Phase`), `Zone`, `clamp` (Plans 1-4).
- Produces: `hexColor(c)`, `hpColor(hp)`, `zoneColor(damage)` (CSS colours). `MatchState(now?)` with `onWelcome`, `onRoster`, `onPhase`, `onHit`, `onKo`, `onScores`, `onResults`, `onCars(CarFact[])`, `setWatching(slot)` and `view(): MatchView` (round clock, alive count, your health / damage per side / speed, kill feed, scoreboard, banner with a hint line, hit flash). Tasks 34-35 use them.

- [ ] **Step 1: Write the failing tests**

`format.test.ts` pins the three colour helpers. `matchState.test.ts` drives a `MatchState` with a fake clock through a whole round the way the server does: a welcome and a roster, the countdown, GO, hits and the damage diagram, the flash, the kill feed, being out, joining mid-round, the results and a draw, a countdown that restarts, and broken data.

Create `tests/client/format.test.ts`:

<!-- op {"kind": "create", "path": "tests/client/format.test.ts"} -->
```ts
import { describe, expect, it } from 'vitest';
import { hexColor, hpColor, zoneColor } from '../../src/client/ui/format';

describe('hexColor', () => {
  it('writes a 24-bit colour as #rrggbb, padded, and clamps nonsense', () => {
    expect(hexColor(0xd84a2b)).toBe('#d84a2b');
    expect(hexColor(0x0000ff)).toBe('#0000ff');
    expect(hexColor(0)).toBe('#000000');
    expect(hexColor(-5)).toBe('#000000');
    expect(hexColor(0x1ffffff)).toBe('#ffffff');
  });
});

describe('hpColor', () => {
  it('runs from red at 0 through amber to green at 100', () => {
    expect(hpColor(0)).toBe('hsl(0, 80%, 48%)');
    expect(hpColor(50)).toBe('hsl(60, 80%, 48%)');
    expect(hpColor(100)).toBe('hsl(120, 80%, 48%)');
  });

  it('stays within that range whatever it is given', () => {
    expect(hpColor(250)).toBe(hpColor(100));
    expect(hpColor(-20)).toBe(hpColor(0));
    expect(hpColor(Number.NaN)).toBe(hpColor(0));
  });
});

describe('zoneColor', () => {
  it('is a faint tint when nothing hit that side and solid red from 40 HP of damage', () => {
    expect(zoneColor(0)).toBe('hsla(55, 90%, 55%, 0.16)');
    expect(zoneColor(40)).toBe('hsla(0, 90%, 55%, 1.00)');
    expect(zoneColor(400)).toBe(zoneColor(40));
  });

  it('darkens steadily with damage', () => {
    const alpha = (d: number): number => Number(/, ([0-9.]+)\)$/.exec(zoneColor(d))![1]);
    expect(alpha(10)).toBeGreaterThan(alpha(0));
    expect(alpha(20)).toBeGreaterThan(alpha(10));
    expect(alpha(39)).toBeGreaterThan(alpha(20));
    expect(zoneColor(Number.NaN)).toBe(zoneColor(0));
  });
});
```

Create `tests/client/matchState.test.ts`:

<!-- op {"kind": "create", "path": "tests/client/matchState.test.ts"} -->
```ts
import { describe, expect, it } from 'vitest';
import { MatchState } from '../../src/client/game/matchState';
import type { KoMessage, PhaseMessage, PlayerInfo, ResultsMessage, RosterMessage, WelcomeMessage } from '../../src/shared/protocol';

const players: PlayerInfo[] = [
  { slot: 0, name: 'Ann', color: 0xd84a2b },
  { slot: 1, name: 'Bob', color: 0x2b6fd8 },
  { slot: 2, name: 'Rusty', color: 0x8a8f98, bot: true },
];
const welcome = (over: Partial<WelcomeMessage> = {}): WelcomeMessage => ({
  t: 'welcome', v: 2, you: 0, room: { code: 'ABCD', public: true, capacity: 8 }, epoch: 1, players, tickRate: 60, snapshotEvery: 2, phase: null, scores: [], ...over,
});
const roster = (over: Partial<RosterMessage> = {}): RosterMessage => ({ t: 'roster', epoch: 2, round: 1, you: 0, players, ...over });
const phase = (p: PhaseMessage['phase'], remainingMs: number, round = 1): PhaseMessage => ({ t: 'phase', phase: p, round, remainingMs });
const ko = (over: Partial<KoMessage>): KoMessage => ({ t: 'ko', tick: 100, victim: 1, killer: 0, assists: [], reason: 'damage', ...over });

function match() {
  const clock = { t: 10_000 };
  const m = new MatchState(() => clock.t);
  return { m, clock };
}

describe('MatchState before and during the countdown', () => {
  it('has nothing to show before the server says anything', () => {
    const { m } = match();
    expect(m.view()).toMatchObject({ phase: null, banner: null, board: [], feed: [], me: null, speedKmh: 0, aliveCount: 0, carCount: 0, flash: 0 });
  });

  it('counts the countdown down in whole seconds and says which round is starting', () => {
    const { m, clock } = match();
    m.onWelcome(welcome());
    m.onRoster(roster({ round: 3 }));
    m.onPhase(phase('countdown', 5000, 3));
    expect(m.view()).toMatchObject({ phase: 'countdown', round: 3, clockLabel: 'Starts in', clock: '5', banner: { kind: 'countdown', title: '5', subtitle: 'Round 3 — get ready' } });
    clock.t += 1200;
    expect(m.view().banner!.title).toBe('4');
    clock.t += 3700;
    expect(m.view().banner!.title).toBe('1');
    clock.t += 5000;
    expect(m.view().banner!.title).toBe('1'); // never 0 or negative while the phase message is the newest news
  });

  it('treats a roster that repeats the round (a countdown restart) as the same round, with the clock starting over', () => {
    const { m, clock } = match();
    m.onRoster(roster({ round: 2, epoch: 4 }));
    m.onPhase(phase('countdown', 5000, 2));
    clock.t += 3000;
    expect(m.view().banner).toMatchObject({ title: '2', subtitle: 'Round 2 — get ready' });
    m.onRoster(roster({ round: 2, epoch: 5 })); // somebody joined: the server rebuilds the world and starts the countdown again
    m.onPhase(phase('countdown', 5000, 2));
    expect(m.view()).toMatchObject({ round: 2, clock: '5', banner: { kind: 'countdown', title: '5', subtitle: 'Round 2 — get ready' } });
  });

  it('tells a player who has no car yet that they join the next round', () => {
    const { m } = match();
    m.onWelcome(welcome({ you: -1, phase: phase('countdown', 3000) }));
    expect(m.view()).toMatchObject({ me: null, banner: { kind: 'countdown', subtitle: 'You join the next round' } });
  });
});

describe('MatchState while the round is live', () => {
  it('flashes GO! for a moment, then shows the time left as minutes and seconds', () => {
    const { m, clock } = match();
    m.onRoster(roster());
    m.onPhase(phase('live', 240_000));
    expect(m.view().banner).toEqual({ kind: 'go', title: 'GO!', subtitle: '', hint: '' });
    expect(m.view()).toMatchObject({ clockLabel: 'Time left', clock: '4:00' });
    clock.t += 1300;
    expect(m.view().banner).toBeNull();
    clock.t += 64_000;
    expect(m.view().clock).toBe('2:55');
    clock.t += 300_000;
    expect(m.view().clock).toBe('0:00');
  });

  it('shows zero instead of NaN when a car\'s facts are broken', () => {
    const { m, clock } = match();
    m.onRoster(roster());
    m.onPhase(phase('live', 60_000));
    clock.t += 2000;
    m.onCars([{ slot: 0, hp: Number.NaN, alive: true, speed: Number.POSITIVE_INFINITY }, { slot: 1, hp: -5, alive: true, speed: -3 }]);
    const v = m.view();
    expect(v.me).toMatchObject({ hp: 0 });
    expect(v.speedKmh).toBe(0);
    expect(v.board.find((r) => r.slot === 1)!.hp).toBe(0);
  });

  it('shows your hit points and speed from the latest snapshot, and every car\'s state on the board', () => {
    const { m } = match();
    m.onRoster(roster());
    m.onPhase(phase('live', 60_000));
    m.onCars([
      { slot: 0, hp: 64, alive: true, speed: 10 },
      { slot: 1, hp: 0, alive: false, speed: 0 },
      { slot: 2, hp: 100, alive: true, speed: 5 },
    ]);
    const v = m.view();
    expect(v.me).toMatchObject({ slot: 0, hp: 64, alive: true });
    expect(v.speedKmh).toBe(36);
    expect(v.aliveCount).toBe(2);
    expect(v.carCount).toBe(3);
    expect(v.board.map((r) => [r.name, r.alive, r.hp])).toEqual([['Ann', true, 64], ['Bob', false, 0], ['Rusty', true, 100]]);
  });

  it('sorts the board by score, breaking ties by slot, and marks you and the bots', () => {
    const { m } = match();
    m.onRoster(roster());
    m.onScores({ t: 'scores', rows: [{ slot: 0, score: 40, kills: 0 }, { slot: 1, score: 190.4, kills: 2 }, { slot: 2, score: 40, kills: 0 }] });
    const board = m.view().board;
    expect(board.map((r) => [r.name, r.score, r.kills])).toEqual([['Bob', 190, 2], ['Ann', 40, 0], ['Rusty', 40, 0]]);
    expect(board.map((r) => [r.you, r.bot])).toEqual([[false, false], [true, false], [false, true]]);
  });

  it('adds up the damage taken on each side of your car, ignores hits on others, and forgets them next round', () => {
    const { m } = match();
    m.onRoster(roster());
    m.onHit({ t: 'hit', tick: 1, victim: 0, attacker: 1, dmg: 12.5, hp: 87.5, zone: 'front', j: 15, p: [2.3, 0, 0] });
    m.onHit({ t: 'hit', tick: 2, victim: 0, attacker: -1, dmg: 4, hp: 83.5, zone: 'left', j: 8, p: [0, 0, -1] });
    m.onHit({ t: 'hit', tick: 3, victim: 0, attacker: 1, dmg: 6, hp: 77.5, zone: 'front', j: 9, p: [2.3, 0, 0] });
    m.onHit({ t: 'hit', tick: 4, victim: 1, attacker: 0, dmg: 30, hp: 70, zone: 'rear', j: 20, p: [-2.3, 0, 0] });
    expect(m.view().me!.zones).toEqual({ front: 18.5, rear: 0, left: 4, right: 0 });
    m.onRoster(roster({ epoch: 3, round: 2 }));
    expect(m.view().me!.zones).toEqual({ front: 0, rear: 0, left: 0, right: 0 });
  });

  it('flashes when you are hit, harder for a bigger hit, and fades away', () => {
    const { m, clock } = match();
    m.onRoster(roster());
    expect(m.view().flash).toBe(0);
    m.onHit({ t: 'hit', tick: 1, victim: 0, attacker: 1, dmg: 2, hp: 98, zone: 'front', j: 5, p: [2.3, 0, 0] });
    const small = m.view().flash;
    expect(small).toBeGreaterThan(0.3);
    expect(small).toBeLessThan(0.5);
    clock.t += 200;
    expect(m.view().flash).toBeLessThan(small);
    clock.t += 300;
    expect(m.view().flash).toBe(0);
    m.onHit({ t: 'hit', tick: 2, victim: 0, attacker: 1, dmg: 40, hp: 58, zone: 'front', j: 25, p: [2.3, 0, 0] });
    expect(m.view().flash).toBe(1);
    m.onHit({ t: 'hit', tick: 3, victim: 1, attacker: 0, dmg: 40, hp: 60, zone: 'front', j: 25, p: [2.3, 0, 0] });
  });

  it('tells you when you are out, and whom you are watching', () => {
    const { m, clock } = match();
    m.onRoster(roster());
    m.onPhase(phase('live', 60_000));
    clock.t += 2000;
    m.onCars([{ slot: 0, hp: 0, alive: false, speed: 0 }, { slot: 1, hp: 50, alive: true, speed: 9 }, { slot: 2, hp: 80, alive: true, speed: 9 }]);
    expect(m.view().banner).toEqual({ kind: 'out', title: 'You are out', subtitle: 'Waiting for a car to follow', hint: '← → switch car' });
    m.setWatching(2);
    expect(m.view().banner!.subtitle).toBe('Following Rusty');
    expect(m.view().me).toMatchObject({ alive: false, hp: 0 });
  });

  it('tells a player who joined mid-round that they are watching', () => {
    const { m, clock } = match();
    m.onWelcome(welcome({ you: -1, phase: phase('live', 100_000) }));
    clock.t += 2000;
    expect(m.view().banner).toMatchObject({ kind: 'watching', title: 'Watching', subtitle: 'Waiting for a car to follow', hint: 'You join the next round · ← → switch car' });
    m.setWatching(1);
    expect(m.view().banner!.subtitle).toBe('Following Bob');
    expect(m.view().me).toBeNull();
  });
});

describe('MatchState kill feed', () => {
  const names = (m: MatchState) => m.view().feed.map((f) => f.text);

  it('says who wrecked whom, with the helpers, and why cars go out on their own', () => {
    const { m } = match();
    m.onRoster(roster());
    m.onKo(ko({ victim: 1, killer: 2, assists: [0] }));
    m.onKo(ko({ victim: 2, killer: -1, reason: 'damage' }));
    m.onKo(ko({ victim: 2, killer: -1, reason: 'flipped' }));
    m.onKo(ko({ victim: 1, killer: -1, reason: 'stuck' }));
    m.onKo(ko({ victim: 1, killer: -1, reason: 'bounds' }));
    expect(names(m)).toEqual(['Rusty wrecked Bob (with Ann)', 'Rusty crashed', 'Rusty rolled over', 'Bob broke down', 'Bob left the arena']);
    m.onKo(ko({ victim: 0, killer: -1, reason: 'stall' }));
    m.onKo(ko({ victim: 1, killer: -1, reason: 'disconnected' }));
    expect(names(m).slice(-2)).toEqual(['Ann ran out of steam', 'Bob left the game']);
  });

  it('marks your kills and your own elimination, keeps five items and lets them fade after seven seconds', () => {
    const { m, clock } = match();
    m.onRoster(roster());
    m.onKo(ko({ victim: 1, killer: 0 }));
    m.onKo(ko({ victim: 0, killer: 2 }));
    m.onKo(ko({ victim: 2, killer: 1 }));
    expect(m.view().feed.map((f) => f.tone)).toEqual(['mine', 'theirs', 'other']);
    for (let i = 0; i < 6; i++) m.onKo(ko({ victim: 2, killer: 1 }));
    expect(m.view().feed).toHaveLength(5);
    clock.t += 3500;
    expect(m.view().feed[0]!.life).toBeCloseTo(0.5, 2);
    clock.t += 3600;
    expect(m.view().feed).toEqual([]);
  });

  it('never keeps more than a screenful of old news in memory', () => {
    const { m } = match();
    m.onRoster(roster());
    for (let i = 0; i < 100; i++) m.onKo(ko({ victim: 1, killer: 2 }));
    expect((Reflect.get(m, 'feed') as unknown[]).length).toBeLessThanOrEqual(20);
    expect(m.view().feed).toHaveLength(5);
  });

  it('names a car it has not been told about by its slot instead of failing', () => {
    const { m } = match();
    m.onRoster(roster());
    m.onKo(ko({ victim: 6, killer: 5 }));
    expect(names(m)).toEqual(['Car 6 wrecked Car 7']);
  });
});

describe('MatchState results', () => {
  const results = (over: Partial<ResultsMessage> = {}): ResultsMessage => ({
    t: 'results', round: 1, winner: 1, reason: 'last',
    rows: [
      { slot: 0, name: 'Ann', color: 1, bot: false, score: 120, gained: 45, kills: 0, damage: 45, hp: 0, alive: false },
      { slot: 1, name: 'Bob', color: 2, bot: false, score: 310, gained: 230, kills: 2, damage: 80, hp: 40, alive: true },
    ],
    ...over,
  });

  it('names the winner, the seconds to the next round and what you scored', () => {
    const { m, clock } = match();
    m.onRoster(roster());
    m.onResults(results());
    m.onPhase(phase('results', 8000));
    expect(m.view()).toMatchObject({ clockLabel: 'Next round in', clock: '8', banner: { kind: 'results', title: 'Bob wins', subtitle: 'Next round in 8 · you scored 45' } });
    clock.t += 5500;
    expect(m.view().banner!.subtitle).toBe('Next round in 3 · you scored 45');
  });

  it('calls a round with no winner a draw, and copes with results that never arrived', () => {
    const { m } = match();
    m.onRoster(roster());
    m.onResults(results({ winner: -1, reason: 'draw' }));
    m.onPhase(phase('results', 8000));
    expect(m.view().banner!.title).toBe('Draw');
    m.onRoster(roster({ epoch: 3, round: 2 })); // the next round: last round's results are gone
    m.onPhase(phase('results', 8000, 2));
    expect(m.view().banner).toMatchObject({ title: 'Round over', subtitle: 'Next round in 8' });
  });

  it('starts a new round with an empty feed and board', () => {
    const { m } = match();
    m.onRoster(roster());
    m.onKo(ko({}));
    m.onScores({ t: 'scores', rows: [{ slot: 1, score: 99, kills: 1 }] });
    m.onRoster(roster({ epoch: 3, round: 2 }));
    expect(m.view().feed).toEqual([]);
    expect(m.view().board.map((r) => r.score)).toEqual([0, 0, 0]);
  });

  it('starts from the scores and phase a newcomer\'s welcome carries', () => {
    const { m } = match();
    m.onWelcome(welcome({ you: -1, phase: phase('live', 90_000, 4), scores: [{ slot: 1, score: 500, kills: 3 }] }));
    expect(m.view()).toMatchObject({ phase: 'live', round: 4 });
    expect(m.view().board[0]).toMatchObject({ name: 'Bob', score: 500, kills: 3 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/client/format.test.ts tests/client/matchState.test.ts`
Expected: FAIL — both files fail to load: they import `src/client/ui/format` and `src/client/game/matchState`, which do not exist yet.

<!-- check {"cmd": "npx vitest run tests/client/format.test.ts tests/client/matchState.test.ts", "outcome": "fail", "match": "Failed to resolve import|Cannot find module|Does the file exist"} -->

- [ ] **Step 3: Implement**

`src/client/ui/format.ts` — colours for the health bar, the damage diagram and the scoreboard:

Create `src/client/ui/format.ts`:

<!-- op {"kind": "create", "path": "src/client/ui/format.ts"} -->
```ts
import { clamp } from '../../shared/math';

/** "#rrggbb" from a 24-bit colour. */
export const hexColor = (c: number): string => `#${(Math.max(0, Math.min(0xffffff, Math.floor(c))) >>> 0).toString(16).padStart(6, '0')}`;

/** Colour of a hit-point bar or tag: green when healthy, amber when hurt, red when nearly out. */
export function hpColor(hp: number): string {
  const t = clamp(Number.isFinite(hp) ? hp : 0, 0, 100) / 100;
  return `hsl(${Math.round(t * 120)}, 80%, 48%)`;
}

/** Fill of one side of the damage diagram: a faint tint for an untouched side, solid red at 40 HP of damage or more. */
export function zoneColor(damage: number): string {
  const t = clamp(Number.isFinite(damage) ? damage / 40 : 0, 0, 1);
  return `hsla(${Math.round((1 - t) * 55)}, 90%, 55%, ${(0.16 + 0.84 * t).toFixed(2)})`;
}
```

`src/client/game/matchState.ts` — everything the match screen shows, worked out from the server's messages and the latest snapshot. It has no DOM and no three.js, so it is tested in Node; the HUD asks it for a `view()` every frame.

Create `src/client/game/matchState.ts`:

<!-- op {"kind": "create", "path": "src/client/game/matchState.ts"} -->
```ts
import type {
  HitMessage,
  KoMessage,
  Phase,
  PhaseMessage,
  PlayerInfo,
  ResultsMessage,
  RosterMessage,
  ScoresMessage,
  WelcomeMessage,
} from '../../shared/protocol';
import type { Zone } from '../../shared/types';

/** What the match screen needs to know about one car this frame (from the latest snapshot). */
export interface CarFact {
  slot: number;
  hp: number;
  alive: boolean;
  /** Speed in m/s. */
  speed: number;
}

export type BannerKind = 'countdown' | 'go' | 'results' | 'out' | 'watching';
export interface Banner {
  kind: BannerKind;
  title: string;
  subtitle: string;
  /** Small print under the subtitle: what the keys do. */
  hint: string;
}

export interface FeedItem {
  id: number;
  text: string;
  /** `mine`: you did it; `theirs`: it happened to you; `other`: everybody else's news. */
  tone: 'mine' | 'theirs' | 'other';
  /** 1 when new, falling to 0 as it expires. */
  life: number;
}

export interface BoardRow {
  slot: number;
  name: string;
  color: number;
  bot: boolean;
  score: number;
  kills: number;
  alive: boolean;
  hp: number;
  you: boolean;
}

export interface MatchView {
  phase: Phase | null;
  round: number;
  /** Label and value of the round clock: "Starts in 5", "Time left 3:42", "Next round in 6". */
  clockLabel: string;
  clock: string;
  aliveCount: number;
  carCount: number;
  /** Your car, or null while you are watching. `zones` is the damage taken this round on each side, in HP. */
  me: { slot: number; hp: number; alive: boolean; zones: Record<Zone, number> } | null;
  speedKmh: number;
  feed: FeedItem[];
  board: BoardRow[];
  banner: Banner | null;
  /** 0..1: a red flash that fades after you are hit. */
  flash: number;
}

const FEED_MS = 7000;
const FEED_MAX = 5;
const GO_MS = 1200;
const FLASH_MS = 450;

const clockText = (ms: number): string => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/**
 * Everything the match screen shows, worked out from the server's messages and the latest snapshot: no DOM, no
 * three.js, so it is tested in Node. The HUD asks for a `view()` every frame and only draws what changed.
 */
export class MatchState {
  private mySlot = -1;
  private players = new Map<number, PlayerInfo>();
  private phase: Phase | null = null;
  private round = 0;
  private deadline = 0;
  private liveSince = Number.NEGATIVE_INFINITY;
  private scores = new Map<number, { score: number; kills: number }>();
  private facts = new Map<number, CarFact>();
  private zones: Record<Zone, number> = { front: 0, rear: 0, left: 0, right: 0 };
  private feed: Array<{ id: number; text: string; tone: FeedItem['tone']; at: number }> = [];
  private nextId = 1;
  private results: ResultsMessage | null = null;
  private flashAt = Number.NEGATIVE_INFINITY;
  private flashPower = 0;
  private watching = -1;

  constructor(private readonly now: () => number = () => performance.now()) {}

  onWelcome(w: WelcomeMessage): void {
    this.mySlot = w.you;
    this.players = new Map(w.players.map((p) => [p.slot, p]));
    this.scores = new Map(w.scores.map((r) => [r.slot, { score: r.score, kills: r.kills }]));
    this.results = null;
    this.feed = [];
    this.resetRoundDamage();
    if (w.phase) this.onPhase(w.phase);
  }

  /** A new round's cars. */
  onRoster(r: RosterMessage): void {
    this.mySlot = r.you;
    this.players = new Map(r.players.map((p) => [p.slot, p]));
    this.round = r.round;
    this.scores.clear();
    this.facts.clear();
    this.results = null;
    this.feed = [];
    this.watching = -1;
    this.resetRoundDamage();
  }

  onPhase(p: PhaseMessage): void {
    this.phase = p.phase;
    this.round = p.round;
    this.deadline = this.now() + p.remainingMs;
    if (p.phase === 'live') this.liveSince = this.now();
  }

  onHit(h: HitMessage): void {
    if (h.victim !== this.mySlot) return;
    this.zones[h.zone] += h.dmg;
    this.flashAt = this.now();
    this.flashPower = Math.min(1, 0.35 + h.dmg / 25);
  }

  onKo(k: KoMessage): void {
    const name = (slot: number): string => this.players.get(slot)?.name ?? `Car ${slot + 1}`;
    const victim = name(k.victim);
    let text: string;
    if (k.reason === 'disconnected') text = `${victim} left the game`;
    else if (k.killer >= 0) {
      const helpers = k.assists.length > 0 ? ` (with ${k.assists.map(name).join(', ')})` : '';
      text = `${name(k.killer)} wrecked ${victim}${helpers}`;
    } else {
      const why = { damage: 'crashed', flipped: 'rolled over', stuck: 'broke down', bounds: 'left the arena', stall: 'ran out of steam', disconnected: '' }[k.reason];
      text = `${victim} ${why}`;
    }
    const tone = k.killer === this.mySlot && k.killer >= 0 ? 'mine' : k.victim === this.mySlot ? 'theirs' : 'other';
    this.feed.push({ id: this.nextId++, text, tone, at: this.now() });
    if (this.feed.length > 20) this.feed.shift();
  }

  onScores(s: ScoresMessage): void {
    for (const row of s.rows) this.scores.set(row.slot, { score: row.score, kills: row.kills });
  }

  onResults(r: ResultsMessage): void {
    this.results = r;
  }

  /** The latest snapshot's cars, every frame. */
  onCars(cars: readonly CarFact[]): void {
    this.facts.clear();
    const sane = (v: number): number => (Number.isFinite(v) ? Math.max(0, v) : 0);
    for (const c of cars) this.facts.set(c.slot, { slot: c.slot, alive: c.alive, hp: sane(c.hp), speed: sane(c.speed) });
  }

  /** Slot of the car the camera follows while you are out or watching (-1: none). */
  setWatching(slot: number): void {
    this.watching = slot;
  }

  view(): MatchView {
    const t = this.now();
    const remaining = Math.max(0, this.deadline - t);
    const myFact = this.mySlot >= 0 ? this.facts.get(this.mySlot) : undefined;
    const meAlive = myFact ? myFact.alive : this.mySlot >= 0;
    const rows: BoardRow[] = [...this.players.values()].map((p) => {
      const fact = this.facts.get(p.slot);
      const sc = this.scores.get(p.slot);
      return {
        slot: p.slot,
        name: p.name,
        color: p.color,
        bot: p.bot === true,
        score: Math.round(sc?.score ?? 0),
        kills: sc?.kills ?? 0,
        alive: fact ? fact.alive : true,
        hp: fact ? fact.hp : 100,
        you: p.slot === this.mySlot,
      };
    });
    rows.sort((a, b) => b.score - a.score || a.slot - b.slot);
    let clockLabel = '';
    let clock = '';
    if (this.phase === 'countdown') {
      clockLabel = 'Starts in';
      clock = String(Math.max(1, Math.ceil(remaining / 1000)));
    } else if (this.phase === 'live') {
      clockLabel = 'Time left';
      clock = clockText(remaining);
    } else if (this.phase === 'results') {
      clockLabel = 'Next round in';
      clock = String(Math.max(1, Math.ceil(remaining / 1000)));
    }
    return {
      phase: this.phase,
      round: this.round,
      clockLabel,
      clock,
      aliveCount: rows.filter((r) => r.alive).length,
      carCount: rows.length,
      me: this.mySlot >= 0 ? { slot: this.mySlot, hp: myFact ? myFact.hp : 100, alive: meAlive, zones: { ...this.zones } } : null,
      speedKmh: myFact ? Math.round(myFact.speed * 3.6) : 0,
      feed: this.feed
        .filter((f) => t - f.at < FEED_MS)
        .slice(-FEED_MAX)
        .map((f) => ({ id: f.id, text: f.text, tone: f.tone, life: 1 - (t - f.at) / FEED_MS })),
      board: rows,
      banner: this.banner(t, remaining, meAlive),
      flash: Math.max(0, 1 - (t - this.flashAt) / FLASH_MS) * this.flashPower,
    };
  }

  private banner(t: number, remaining: number, meAlive: boolean): Banner | null {
    const name = (slot: number): string => this.players.get(slot)?.name ?? `Car ${slot + 1}`;
    if (this.phase === 'countdown') {
      const seconds = Math.max(1, Math.ceil(remaining / 1000));
      return {
        kind: 'countdown',
        title: String(seconds),
        subtitle: this.mySlot >= 0 ? `Round ${this.round} — get ready` : 'You join the next round',
        hint: '',
      };
    }
    if (this.phase === 'live') {
      if (t - this.liveSince < GO_MS) return { kind: 'go', title: 'GO!', subtitle: '', hint: '' };
      if (this.mySlot >= 0 && meAlive) return null;
      const following = this.watching >= 0 ? `Following ${name(this.watching)}` : 'Waiting for a car to follow';
      return this.mySlot < 0
        ? { kind: 'watching', title: 'Watching', subtitle: following, hint: 'You join the next round · ← → switch car' }
        : { kind: 'out', title: 'You are out', subtitle: following, hint: '← → switch car' };
    }
    if (this.phase === 'results') {
      const r = this.results;
      const seconds = Math.max(1, Math.ceil(remaining / 1000));
      const title = !r ? 'Round over' : r.winner < 0 ? 'Draw' : `${r.rows.find((row) => row.slot === r.winner)?.name ?? name(r.winner)} wins`;
      const mine = r && this.mySlot >= 0 ? r.rows.find((row) => row.slot === this.mySlot) : undefined;
      const gained = mine ? ` · you scored ${mine.gained}` : '';
      return { kind: 'results', title, subtitle: `Next round in ${seconds}${gained}`, hint: '' };
    }
    return null;
  }

  private resetRoundDamage(): void {
    this.zones = { front: 0, rear: 0, left: 0, right: 0 };
    this.flashAt = Number.NEGATIVE_INFINITY;
  }
}
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/client/format.test.ts tests/client/matchState.test.ts && npm run typecheck`
Expected: PASS — 25 tests; type-check clean.

<!-- check {"cmd": "npx vitest run tests/client/format.test.ts tests/client/matchState.test.ts && npm run typecheck", "outcome": "pass", "tests": 25} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(client): the match view-model \u2014 round clock, board, kill feed, health and damage per side, banners"
```

<!-- commit "feat(client): the match view-model \u2014 round clock, board, kill feed, health and damage per side, banners" -->

---

### Task 33: The spectator camera

**Files:**
- Modify: `src/client/game/camera.ts` (`applyChaseView`)
- Create: `src/client/game/spectator.ts`
- Test: `tests/client/spectator.test.ts`, `tests/client/camera.test.ts`

**Interfaces:**
- Consumes: `ChaseView`, `ChaseCamera` (camera.ts, Plan 1), `ARENA.RADIUS`, `clamp`, `vlerp`.
- Produces: `applyChaseView(camera, view)`; `SpectatorCamera` with `watching`, `cycle(cars, ±1)`, `reset()`, `view(cars, dt): ChaseView | null`; `nextTarget(cars, current, direction)`, `computeOrbitView(target, angle)`, `MAX_CAMERA_RADIUS`, `Followable`. Task 35 uses them.

- [ ] **Step 1: Write the failing tests**

`spectator.test.ts` covers picking the next car in slot order (both directions, wrapping, skipping wrecks), the orbit geometry (a fixed distance and height, never outside the barrier), and the camera object (it picks a car by itself, moves on when its car is out, cycles on request, orbits with smoothing, survives odd frame times). `camera.test.ts` gets two tests for `applyChaseView` on a real three.js camera.

Create `tests/client/spectator.test.ts`:

<!-- op {"kind": "create", "path": "tests/client/spectator.test.ts"} -->
```ts
import { describe, expect, it } from 'vitest';
import { MAX_CAMERA_RADIUS, SpectatorCamera, computeOrbitView, nextTarget, type Followable } from '../../src/client/game/spectator';
import { vlen, vsub } from '../../src/shared/math';

const car = (slot: number, over: Partial<Followable> = {}): Followable => ({ slot, pos: { x: slot * 10, y: 1, z: 0 }, alive: true, visible: true, ...over });

describe('nextTarget', () => {
  const cars = [car(0), car(1, { alive: false }), car(2), car(3, { visible: false }), car(5)];

  it('moves up through the cars that are still running, and wraps around', () => {
    expect(nextTarget(cars, -1, 1)).toBe(0);
    expect(nextTarget(cars, 0, 1)).toBe(2);
    expect(nextTarget(cars, 2, 1)).toBe(5);
    expect(nextTarget(cars, 5, 1)).toBe(0);
  });

  it('moves down and wraps the other way', () => {
    expect(nextTarget(cars, 5, -1)).toBe(2);
    expect(nextTarget(cars, 2, -1)).toBe(0);
    expect(nextTarget(cars, 0, -1)).toBe(5);
    expect(nextTarget(cars, -1, -1)).toBe(5);
  });

  it('carries on from a car that has just gone out, in the direction asked', () => {
    expect(nextTarget(cars, 1, 1)).toBe(2);
    expect(nextTarget(cars, 1, -1)).toBe(0);
    expect(nextTarget(cars, 3, 1)).toBe(5);
  });

  it('says -1 when nothing is running', () => {
    expect(nextTarget([], 0, 1)).toBe(-1);
    expect(nextTarget([car(0, { alive: false })], -1, 1)).toBe(-1);
  });

  it('stays on the only car left', () => {
    expect(nextTarget([car(4)], 4, 1)).toBe(4);
    expect(nextTarget([car(4)], 4, -1)).toBe(4);
  });
});

describe('computeOrbitView', () => {
  it('circles the target at a fixed distance and height, looking at it', () => {
    const target = { x: 3, y: 1, z: -2 };
    for (const angle of [0, 1, 2.5, 4]) {
      const v = computeOrbitView(target, angle);
      expect(Math.hypot(v.position.x - target.x, v.position.z - target.z)).toBeCloseTo(13, 9);
      expect(v.position.y).toBeCloseTo(7, 9);
      expect(v.lookAt).toEqual({ x: 3, y: 1.8, z: -2 });
    }
    expect(computeOrbitView(target, 0).position.x).toBeGreaterThan(target.x);
  });

  it('never leaves the arena: beside the barrier the camera slides along the inside of it', () => {
    const target = { x: 43, y: 1, z: 0 };
    for (const angle of [0, 0.5, 1, 2, 3.14, 5]) {
      const v = computeOrbitView(target, angle);
      expect(Math.hypot(v.position.x, v.position.z)).toBeLessThanOrEqual(MAX_CAMERA_RADIUS + 1e-9);
      expect(v.lookAt).toEqual({ x: 43, y: 1.8, z: 0 }); // it still looks at the car
    }
    const outside = computeOrbitView(target, 0); // straight out over the wall: pulled back in
    expect(Math.hypot(outside.position.x, outside.position.z)).toBeCloseTo(MAX_CAMERA_RADIUS, 9);
  });
});

describe('SpectatorCamera', () => {
  it('picks a car by itself, follows it, and keeps it while it runs', () => {
    const cam = new SpectatorCamera();
    const cars = [car(1), car(2)];
    const v = cam.view(cars, 0.016)!;
    expect(cam.watching).toBe(1);
    expect(vlen(vsub(v.lookAt, { x: 10, y: 1.8, z: 0 }))).toBeLessThan(1e-9);
    cam.view([car(0), car(1), car(2)], 0.016);
    expect(cam.watching).toBe(1);
  });

  it('moves to another car when the one it watches goes out, and to none when all are out', () => {
    const cam = new SpectatorCamera();
    cam.view([car(1), car(2)], 0.016);
    expect(cam.watching).toBe(1);
    expect(cam.view([car(1, { alive: false }), car(2)], 0.016)).not.toBeNull();
    expect(cam.watching).toBe(2);
    expect(cam.view([car(1, { alive: false }), car(2, { alive: false })], 0.016)).toBeNull();
  });

  it('cycles on request', () => {
    const cam = new SpectatorCamera();
    const cars = [car(0), car(1), car(2)];
    cam.view(cars, 0.016);
    cam.cycle(cars, 1);
    expect(cam.watching).toBe(1);
    cam.cycle(cars, 1);
    cam.cycle(cars, 1);
    expect(cam.watching).toBe(0);
    cam.cycle(cars, -1);
    expect(cam.watching).toBe(2);
  });

  it('orbits slowly, smoothing the move when the target changes', () => {
    const cam = new SpectatorCamera();
    const cars = [car(0), car(3)];
    const a = cam.view(cars, 0.016)!;
    const b = cam.view(cars, 1)!;
    expect(vlen(vsub(a.position, b.position))).toBeGreaterThan(1); // it went round
    cam.cycle(cars, 1);
    const c = cam.view(cars, 0.016)!;
    expect(vlen(vsub(c.position, b.position))).toBeLessThan(3); // and did not jump the 30 m to the other car in one frame
    expect(c.lookAt.x).toBeGreaterThan(b.lookAt.x);
  });

  it('starts afresh after a reset, and survives odd frame times', () => {
    const cam = new SpectatorCamera();
    cam.view([car(2)], 0.016);
    cam.reset();
    expect(cam.watching).toBe(-1);
    expect(() => cam.view([car(2)], Number.NaN)).not.toThrow();
    expect(() => cam.view([car(2)], -5)).not.toThrow();
    expect(cam.view([car(2)], 0.016)).not.toBeNull();
  });
});
```

`tests/client/camera.test.ts` — replace its first imports:

<!-- op {"kind": "edit", "path": "tests/client/camera.test.ts"} -->
```ts
import { describe, expect, it } from 'vitest';
import { computeChaseView } from '../../src/client/game/camera';

```

with:

```ts
import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { applyChaseView, computeChaseView } from '../../src/client/game/camera';

```

and append to `tests/client/camera.test.ts`:

<!-- op {"kind": "append", "path": "tests/client/camera.test.ts"} -->
```ts
describe('applyChaseView', () => {
  const view = { position: { x: 10, y: 5, z: -3 }, lookAt: { x: 0, y: 1, z: 0 }, fov: 62 };

  it('puts the camera at the position and aims it at the look-at point', () => {
    const camera = new PerspectiveCamera(62, 1.5, 0.1, 500);
    applyChaseView(camera, view);
    expect(camera.position.toArray()).toEqual([10, 5, -3]);
    const towards = new Vector3(-10, -4, 3).normalize();
    expect(camera.getWorldDirection(new Vector3()).distanceTo(towards)).toBeLessThan(1e-6);
  });

  it('changes the field of view and its projection only when it differs', () => {
    const camera = new PerspectiveCamera(62, 1.5, 0.1, 500);
    const before = camera.projectionMatrix.elements[5];
    applyChaseView(camera, view);
    expect(camera.projectionMatrix.elements[5]).toBe(before);
    applyChaseView(camera, { ...view, fov: 78 });
    expect(camera.fov).toBe(78);
    expect(camera.projectionMatrix.elements[5]).toBeCloseTo(1 / Math.tan((39 * Math.PI) / 180), 6);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/client/spectator.test.ts tests/client/camera.test.ts`
Expected: FAIL — `spectator.test.ts` cannot load `src/client/game/spectator`, and the two `applyChaseView` tests fail (`applyChaseView is not a function`); the four older camera tests still pass.

<!-- check {"cmd": "npx vitest run tests/client/spectator.test.ts tests/client/camera.test.ts", "outcome": "fail", "match": "applyChaseView is not a function"} -->

- [ ] **Step 3: Implement**

`src/client/game/camera.ts` — the code that puts a camera where a view says moves out of `ChaseCamera` so the spectator camera can use it too:

In `src/client/game/camera.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/camera.ts"} -->
```ts
/** Smoothing wrapper that applies a ChaseView to a three.js camera. */
export class ChaseCamera {
```

with:

```ts
/** Puts a three.js camera where a view says (the field of view is only touched when it changed). */
export function applyChaseView(camera: PerspectiveCamera, view: ChaseView): void {
  camera.position.set(view.position.x, view.position.y, view.position.z);
  camera.lookAt(view.lookAt.x, view.lookAt.y, view.lookAt.z);
  if (Math.abs(camera.fov - view.fov) > 0.01) {
    camera.fov = view.fov;
    camera.updateProjectionMatrix();
  }
}

/** Smoothing wrapper that applies a ChaseView to a three.js camera. */
export class ChaseCamera {
```

In `src/client/game/camera.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/camera.ts"} -->
```ts
    camera.position.set(this.position.x, this.position.y, this.position.z);
    camera.lookAt(this.lookAt.x, this.lookAt.y, this.lookAt.z);
    if (Math.abs(camera.fov - this.fov) > 0.01) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
  }
```

with:

```ts
    applyChaseView(camera, { position: this.position, lookAt: this.lookAt, fov: this.fov });
  }
```

`src/client/game/spectator.ts` — what the camera does while you have no car to drive: orbit a car that is still running, move on when it is out, and stay inside the barrier (outside it all you would see is the back of the wall).

Create `src/client/game/spectator.ts`:

<!-- op {"kind": "create", "path": "src/client/game/spectator.ts"} -->
```ts
import { ARENA } from '../../shared/constants';
import { clamp, vlerp } from '../../shared/math';
import type { Vec3 } from '../../shared/types';
import type { ChaseView } from './camera';

/** A car the spectator camera may follow. */
export interface Followable {
  slot: number;
  pos: Vec3;
  alive: boolean;
  visible: boolean;
}

/** The next car to watch after `current`, in slot order (`direction` 1 = up, -1 = down), skipping cars that are out. -1 when none is left. */
export function nextTarget(cars: readonly Followable[], current: number, direction: 1 | -1): number {
  const running = cars.filter((c) => c.alive && c.visible).sort((a, b) => a.slot - b.slot);
  if (running.length === 0) return -1;
  if (direction > 0) return (running.find((c) => c.slot > current) ?? running[0]!).slot;
  return (running.findLast((c) => c.slot < current) ?? running[running.length - 1]!).slot;
}

const ORBIT_RADIUS = 13;
const ORBIT_HEIGHT = 6;
const ORBIT_SPEED = 0.25; // rad/s: a lap every 25 s
/** The camera never goes further from the arena's centre than this: outside the barrier all it would see is the back of the wall. */
export const MAX_CAMERA_RADIUS = ARENA.RADIUS - 1.5;

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
    position: { x, y: target.y + ORBIT_HEIGHT, z },
    lookAt: { x: target.x, y: target.y + 0.8, z: target.z },
    fov: 62,
  };
}

/** What the camera does while you have no car to drive: orbit a car that is still running, and move on when it is out. */
export class SpectatorCamera {
  private target = -1;
  private angle = Math.PI;
  private position: Vec3 | null = null;
  private lookAt: Vec3 | null = null;

  /** Slot of the car being watched (-1: none). */
  get watching(): number {
    return this.target;
  }

  /** Switches to the next (1) or previous (-1) car that is still running. */
  cycle(cars: readonly Followable[], direction: 1 | -1): void {
    this.target = nextTarget(cars, this.target, direction);
  }

  /** Forgets everything (a new round). */
  reset(): void {
    this.target = -1;
    this.position = null;
    this.lookAt = null;
  }

  /** Advances the orbit by `dt` seconds and returns the smoothed view, or null when no car is left to watch. */
  view(cars: readonly Followable[], dt: number): ChaseView | null {
    if (!cars.some((c) => c.slot === this.target && c.alive && c.visible)) this.target = nextTarget(cars, this.target, 1);
    const car = cars.find((c) => c.slot === this.target);
    if (!car) return null;
    this.angle += Math.max(0, Number.isFinite(dt) ? dt : 0) * ORBIT_SPEED;
    const want = computeOrbitView(car.pos, this.angle);
    if (!this.position || !this.lookAt) {
      this.position = want.position;
      this.lookAt = want.lookAt;
    } else {
      const k = clamp(1 - Math.exp(-Math.max(dt, 0) * 5), 0, 1);
      this.position = vlerp(this.position, want.position, k);
      this.lookAt = vlerp(this.lookAt, want.lookAt, k);
    }
    return { position: this.position, lookAt: this.lookAt, fov: want.fov };
  }
}
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/client/spectator.test.ts tests/client/camera.test.ts && npm run typecheck`
Expected: PASS — 18 tests (12 spectator, 6 camera); type-check clean.

<!-- check {"cmd": "npx vitest run tests/client/spectator.test.ts tests/client/camera.test.ts && npm run typecheck", "outcome": "pass", "tests": 18} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(client): the spectator camera \u2014 orbit a running car inside the barrier, cycle on request"
```

<!-- commit "feat(client): the spectator camera \u2014 orbit a running car inside the barrier, cycle on request" -->

---

### Task 34: Name tags with health bars

**Files:**
- Modify: `src/client/game/nameTag.ts`
- Test: `tests/client/nameTag.test.ts`

**Interfaces:**
- Consumes: `hpColor` (Task 32), `clamp`, three.js sprites.
- Produces: `NameTag(name, makeLabel?)` with `group`, `name`, `update(hp, alive)` (cheap every frame; hides the tag while the car is out) and `dispose()`; `HP_BAR` (the bar's size and height). The existing `createNameTag`/`disposeNameTag` stay. Task 35 replaces the client's use of them.

- [ ] **Step 1: Write the failing tests**

Node has no canvas, so the tests hand `NameTag` a stand-in that draws the name (a plain sprite). They pin what matters: the bar starts full and green, shrinks and reddens with health, keeps its **left edge** where it is in the camera-facing plane of the sprite (a sprite turns to face the camera, so an offset in the car's own space would slide it sideways — the first version of this class did), stays inside its frame for absurd values, hides while the car is out, and releases its materials on `dispose`.

Create `tests/client/nameTag.test.ts`:

<!-- op {"kind": "create", "path": "tests/client/nameTag.test.ts"} -->
```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HP_BAR, NameTag } from '../../src/client/game/nameTag';

// Node has no canvas: the name is drawn by a stand-in that returns a plain sprite.
const plainLabel = (): THREE.Sprite => new THREE.Sprite(new THREE.SpriteMaterial());
const bar = (tag: NameTag): THREE.Sprite => tag.group.children[2] as THREE.Sprite;

describe('NameTag', () => {
  it('starts with a full green bar as wide as the bar is', () => {
    const tag = new NameTag('Rex', plainLabel);
    expect(bar(tag).scale.x).toBeCloseTo(HP_BAR.width, 6);
    const c = bar(tag).material.color;
    expect(c.g).toBeGreaterThan(c.r);
  });

  it('shortens the bar from the right and turns it red as the car loses health', () => {
    const tag = new NameTag('Rex', plainLabel);
    tag.update(25, true);
    expect(bar(tag).scale.x).toBeCloseTo(HP_BAR.width / 4, 6);
    const c = bar(tag).material.color;
    expect(c.r).toBeGreaterThan(c.g);
  });

  it('keeps the left edge of the bar where it is whatever the health, in the camera-facing plane of the sprite', () => {
    const tag = new NameTag('Rex', plainLabel);
    for (const hp of [100, 80, 33, 5, 0]) {
      tag.update(hp, true);
      const b = bar(tag);
      expect(b.position.x).toBe(0); // a sprite turns to the camera: an offset in the car's own space would slide sideways
      expect(-b.center.x * b.scale.x).toBeCloseTo(-HP_BAR.width / 2, 6);
    }
  });

  it('keeps the bar inside its frame for out-of-range or broken health values', () => {
    const tag = new NameTag('Rex', plainLabel);
    tag.update(250, true);
    expect(bar(tag).scale.x).toBeCloseTo(HP_BAR.width, 6);
    tag.update(-40, true);
    expect(bar(tag).scale.x).toBeGreaterThan(0);
    expect(bar(tag).scale.x).toBeLessThan(0.01);
    tag.update(Number.NaN, true);
    expect(bar(tag).scale.x).toBeLessThan(0.01);
  });

  it('hides the whole tag while the car is out and shows it again in the next round', () => {
    const tag = new NameTag('Rex', plainLabel);
    tag.update(0, false);
    expect(tag.group.visible).toBe(false);
    tag.update(100, true);
    expect(tag.group.visible).toBe(true);
  });

  it('releases its materials and leaves the car when disposed', () => {
    const car = new THREE.Group();
    const tag = new NameTag('Rex', plainLabel);
    car.add(tag.group);
    let disposed = 0;
    for (const child of tag.group.children) (child as THREE.Sprite).material.addEventListener('dispose', () => disposed++);
    tag.dispose();
    expect(disposed).toBe(3);
    expect(car.children).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/client/nameTag.test.ts`
Expected: FAIL — 6 failing tests: `NameTag` is not exported yet (`is not a constructor`).

<!-- check {"cmd": "npx vitest run tests/client/nameTag.test.ts", "outcome": "fail", "match": "is not a constructor"} -->

- [ ] **Step 3: Implement**

In `src/client/game/nameTag.ts`, add the imports:

replace the first line:

<!-- op {"kind": "edit", "path": "src/client/game/nameTag.ts"} -->
```ts
import * as THREE from 'three';

```

with:

```ts
import * as THREE from 'three';
import { clamp } from '../../shared/math';
import { hpColor } from '../ui/format';

```

and append the class at the end of the file:

<!-- op {"kind": "append", "path": "src/client/game/nameTag.ts"} -->
```ts
/** Width and height of the health bar under a name, in metres. */
export const HP_BAR = { width: 2.2, height: 0.2, y: 1.85 } as const;

const solidSprite = (color: number, opacity: number, renderOrder: number): THREE.Sprite => {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ color, opacity, transparent: true, depthWrite: false }));
  sprite.renderOrder = renderOrder;
  return sprite;
};

/**
 * What floats above another car: its name and, under it, a health bar that shrinks and goes from green to red as the
 * car is hurt. The bar is two flat sprites (no canvas), so following the car's health costs nothing per frame.
 */
export class NameTag {
  readonly group = new THREE.Group();
  private readonly label: THREE.Sprite;
  private readonly back = solidSprite(0x000000, 0.6, 10);
  private readonly fill = solidSprite(0xffffff, 1, 11);
  private hp = Number.NaN;
  private alive = true;

  /** `makeLabel` draws the name; it defaults to the canvas label and is replaced in Node, where there is no canvas. */
  constructor(
    readonly name: string,
    makeLabel: (text: string) => THREE.Sprite = createNameTag,
  ) {
    this.label = makeLabel(name);
    const pad = 0.05;
    // both sit on the car's vertical axis: a sprite always faces the camera, so an offset in the car's own space would slide sideways
    this.back.position.set(0, HP_BAR.y, 0);
    this.back.scale.set(HP_BAR.width + 2 * pad, HP_BAR.height + 2 * pad, 1);
    this.fill.position.set(0, HP_BAR.y, 0);
    this.group.add(this.label, this.back, this.fill);
    this.update(100, true);
  }

  /** Shows `hp` (0..100); a car that is out has no tag at all. Cheap to call every frame. */
  update(hp: number, alive: boolean): void {
    if (alive !== this.alive) {
      this.alive = alive;
      this.group.visible = alive;
    }
    const value = clamp(Number.isFinite(hp) ? hp : 0, 0, 100);
    if (value === this.hp) return;
    this.hp = value;
    const fraction = Math.max(1e-3, value / 100);
    this.fill.scale.set(HP_BAR.width * fraction, HP_BAR.height, 1);
    this.fill.center.set(0.5 / fraction, 0.5); // the sprite spans [-center, 1 - center] of its width: this pins its left edge at -width/2
    this.fill.material.color.set(hpColor(value));
  }

  dispose(): void {
    this.label.material.map?.dispose();
    this.label.material.dispose();
    this.back.material.dispose();
    this.fill.material.dispose();
    this.group.removeFromParent();
  }
}
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/client/nameTag.test.ts && npm run typecheck`
Expected: PASS — 6 tests; type-check clean.

<!-- check {"cmd": "npx vitest run tests/client/nameTag.test.ts && npm run typecheck", "outcome": "pass", "tests": 6} -->

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(client): name tags carry a health bar"
```

<!-- commit "feat(client): name tags carry a health bar" -->

---

### Task 35: The match screen

**Files:**
- Modify: `src/client/game/input.ts` (`isDown`, Tab and F3), `src/client/ui/hud.ts` (replaced), `src/client/index.html` (HUD styles), `src/client/game/gameClient.ts`, `src/client/ui/menu.ts` (hint), `README.md`
- Test: `tests/client/controls.test.ts`

**Interfaces:**
- Consumes: `MatchState`, `hexColor`/`hpColor`/`zoneColor` (Task 32), `SpectatorCamera`, `applyChaseView` (Task 33), `NameTag` (Task 34), `ClientSession`/`DrawPose` (Plans 3-4), the `hit`, `ko`, `scores` and `results` messages (Plan 4).
- Produces: The new `Hud` interface: `setRoom`, `setMatch(view, detailed)`, `setStats`, `setStatsVisible`, `showNotice`, `dispose` (`setPlayers` is gone). `KeyboardInput.isDown(code)`. Tab holds the detailed scoreboard, F3 toggles the network line, ← → / A D / Q E switch the watched car while you are out. Nothing on the server or the wire changes.

- [ ] **Step 1: Write the failing tests**

Two keyboard tests in `tests/client/controls.test.ts`: `isDown` reports held keys and forgets them on release and on blur, and Tab and F3 are default-prevented (Tab would move focus, F3 would open the browser's find bar). The HUD and the wiring are DOM and canvas code; they are checked by the type-check, the whole suite and the browser check below.

In `tests/client/controls.test.ts`, replace the line that starts the gamepad test:

<!-- op {"kind": "edit", "path": "tests/client/controls.test.ts"} -->
```ts
  it('lets an active gamepad override the keyboard', () => {
```

with:

```ts
  it('says which keys are held right now, and forgets them on release and on blur', () => {
    const target = new EventTarget();
    const kb = new KeyboardInput(target, () => null);
    expect(kb.isDown('Tab')).toBe(false);
    target.dispatchEvent(keyEvent('keydown', 'Tab'));
    expect(kb.isDown('Tab')).toBe(true);
    target.dispatchEvent(keyEvent('keyup', 'Tab'));
    expect(kb.isDown('Tab')).toBe(false);
    target.dispatchEvent(keyEvent('keydown', 'Tab'));
    target.dispatchEvent(new Event('blur'));
    expect(kb.isDown('Tab')).toBe(false);
    kb.dispose();
  });

  it('keeps the browser from moving focus on Tab or opening find on F3', () => {
    const target = new EventTarget();
    const kb = new KeyboardInput(target, () => null);
    for (const code of ['Tab', 'F3']) {
      const e = keyEvent('keydown', code);
      target.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    }
    kb.dispose();
  });

  it('lets an active gamepad override the keyboard', () => {
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/client/controls.test.ts`
Expected: FAIL — the `isDown` test (`kb.isDown is not a function`) and the Tab/F3 test (`defaultPrevented` is false); the other keyboard tests pass.

<!-- check {"cmd": "npx vitest run tests/client/controls.test.ts", "outcome": "fail", "match": "isDown is not a function"} -->

- [ ] **Step 3: Implement the keys**

In `src/client/game/input.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/input.ts"} -->
```ts
const PREVENT_DEFAULT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
```

with:

```ts
const PREVENT_DEFAULT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab', 'F3']);
```

and add the method above `sample`:

<!-- op {"kind": "edit", "path": "src/client/game/input.ts"} -->
```ts
  /** Samples the current input; advances the steering ramp by `dt` seconds. */
```

with:

```ts
  /** True while the key with this `KeyboardEvent.code` is held (the scoreboard shows while Tab is down). */
  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** Samples the current input; advances the steering ramp by `dt` seconds. */
```

- [ ] **Step 4: Run to verify success**

Run: `npx vitest run tests/client/controls.test.ts`
Expected: PASS — 23 tests.

<!-- check {"cmd": "npx vitest run tests/client/controls.test.ts", "outcome": "pass", "tests": 23} -->

- [ ] **Step 5: Draw the match screen**

`src/client/ui/hud.ts` — the HUD is rewritten to draw a `MatchView`: round panel, scoreboard (compact, or detailed while Tab is held), kill feed, your health bar with the damage per side and your speed, the banner with its hint line, the red hit flash, the network line behind F3, and the notice line. It writes to the DOM only when something changed, because it is asked every frame.

Replace `src/client/ui/hud.ts` with:

<!-- op {"kind": "replace", "path": "src/client/ui/hud.ts"} -->
```ts
import type { Zone } from '../../shared/types';
import type { FeedItem, MatchView } from '../game/matchState';
import { hexColor, hpColor, zoneColor } from './format';

export interface Hud {
  setRoom(code: string, isPublic: boolean): void;
  /** Draws the match screen: round clock, health, damage per side, scoreboard, kill feed, banner. `detailed` shows the full scoreboard (Tab). */
  setMatch(view: MatchView, detailed: boolean): void;
  setStats(text: string): void;
  /** F3: the network and frame-rate line at the bottom left. */
  setStatsVisible(visible: boolean): void;
  /** Shows a short message near the bottom of the screen for a few seconds. */
  showNotice(text: string): void;
  dispose(): void;
}

const ZONES: readonly Zone[] = ['front', 'left', 'right', 'rear'];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent?.append(node);
  return node;
};
/** Writes only when the value changed: the HUD is refreshed every frame and most frames change nothing. */
const setText = (node: HTMLElement, text: string): void => {
  if (node.textContent !== text) node.textContent = text;
};

export function createHud(root: HTMLElement): Hud {
  root.replaceChildren();
  const wrap = el('div', 'hud');
  const room = el('div', 'hud-room', wrap);

  const round = el('div', 'hud-round', wrap);
  const roundTitle = el('div', 'hud-round-title', round);
  const roundClock = el('div', 'hud-round-clock', round);
  const roundAlive = el('div', 'hud-round-alive', round);

  const board = el('div', 'hud-board', wrap);
  const feed = el('ul', 'hud-feed', wrap);

  const me = el('div', 'hud-me', wrap);
  const zones = el('div', 'hud-zones', me);
  const zoneCells = new Map<Zone, HTMLElement>();
  for (const z of ZONES) zoneCells.set(z, el('i', `zone zone-${z}`, zones));
  el('b', 'zone-car', zones);
  const hpBox = el('div', 'hud-hp', me);
  const hpBar = el('div', 'hp-bar', hpBox);
  const hpFill = el('div', 'hp-fill', hpBar);
  const hpNum = el('div', 'hp-num', hpBox);
  const speed = el('div', 'hud-speed', me);

  const banner = el('div', 'hud-banner', wrap);
  const bannerTitle = el('div', 'banner-title', banner);
  const bannerSub = el('div', 'banner-sub', banner);
  const bannerHint = el('div', 'banner-hint', banner);
  const flash = el('div', 'hud-flash', wrap);
  const stats = el('div', 'hud-stats', wrap);
  stats.hidden = true;
  const notice = el('div', 'hud-notice', wrap);
  notice.setAttribute('role', 'status');
  root.append(wrap);

  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  const notify = (text: string): void => {
    notice.textContent = text;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      notice.textContent = '';
    }, 4000);
  };

  let boardKey = '';
  const feedNodes = new Map<number, HTMLElement>();

  const drawBoard = (view: MatchView, detailed: boolean): void => {
    const key = JSON.stringify([detailed, view.board]);
    if (key === boardKey) return;
    boardKey = key;
    board.replaceChildren();
    board.classList.toggle('detailed', detailed);
    view.board.forEach((r, i) => {
      const row = el('div', `row${r.you ? ' you' : ''}${r.alive ? '' : ' out'}`, board);
      el('span', 'rank', row).textContent = String(i + 1);
      const chip = el('span', 'chip', row);
      chip.style.background = hexColor(r.color);
      el('span', 'name', row).textContent = r.bot ? `${r.name} · bot` : r.name;
      if (detailed) {
        el('span', 'stat', row).textContent = `${r.kills} K`;
        el('span', 'stat', row).textContent = r.alive ? `${Math.ceil(r.hp)} HP` : 'out';
      }
      el('span', 'score', row).textContent = String(r.score);
    });
  };

  const drawFeed = (items: readonly FeedItem[]): void => {
    const live = new Set(items.map((f) => f.id));
    for (const [id, node] of feedNodes) {
      if (!live.has(id)) {
        node.remove();
        feedNodes.delete(id);
      }
    }
    for (const f of items) {
      let node = feedNodes.get(f.id);
      if (!node) {
        node = el('li', `feed-${f.tone}`, feed);
        node.textContent = f.text;
        feedNodes.set(f.id, node);
      }
      node.style.opacity = String(Math.min(1, f.life * 3).toFixed(2));
    }
  };

  return {
    setRoom(code, isPublic) {
      room.replaceChildren();
      const label = document.createElement('span');
      label.textContent = `${isPublic ? 'Public' : 'Private'} room ${code}`;
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.textContent = 'Copy invite link';
      copy.addEventListener('click', () => {
        const url = new URL(location.href);
        url.search = '';
        url.searchParams.set('room', code);
        const link = url.toString();
        const clipboard = navigator.clipboard; // undefined on plain-http origins such as a LAN address
        if (!clipboard) {
          notify(link);
          return;
        }
        void clipboard.writeText(link).then(
          () => notify('Invite link copied'),
          () => notify(link),
        );
      });
      room.append(label, copy);
    },
    setMatch(view, detailed) {
      round.hidden = view.phase === null;
      setText(roundTitle, `Round ${view.round}`);
      setText(roundClock, `${view.clockLabel} ${view.clock}`);
      setText(roundAlive, `Alive ${view.aliveCount}/${view.carCount}`);
      drawBoard(view, detailed);
      drawFeed(view.feed);
      me.hidden = view.me === null;
      if (view.me) {
        const hp = Math.max(0, view.me.hp);
        hpFill.style.width = `${hp}%`;
        hpFill.style.background = hpColor(hp);
        setText(hpNum, view.me.alive ? String(Math.ceil(hp)) : 'OUT');
        for (const z of ZONES) zoneCells.get(z)!.style.background = zoneColor(view.me.zones[z]);
        setText(speed, `${view.speedKmh} km/h`);
      }
      banner.hidden = view.banner === null;
      banner.dataset.kind = view.banner?.kind ?? '';
      if (view.banner) {
        setText(bannerTitle, view.banner.title);
        setText(bannerSub, view.banner.subtitle);
        setText(bannerHint, view.banner.hint);
      }
      flash.style.opacity = view.flash.toFixed(2);
    },
    setStats(text) {
      setText(stats, text);
    },
    setStatsVisible(visible) {
      stats.hidden = !visible;
    },
    showNotice: notify,
    dispose() {
      if (noticeTimer) clearTimeout(noticeTimer);
      root.replaceChildren();
    },
  };
}
```

`src/client/index.html` — the styles. First a rule that makes the `hidden` attribute work on the HUD's panels (several of them set their own `display`, which would otherwise override it):

In `src/client/index.html`, replace:

<!-- op {"kind": "edit", "path": "src/client/index.html"} -->
```html
      .hud {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }

```

with:

```html
      .hud {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      .hud [hidden] {
        display: none !important; /* panels that set their own display would otherwise ignore the attribute */
      }

```

and replace the old player-list styles, from `.hud-players {` up to (not including) `.hud-stats {`, with the styles of the match screen:

<!-- op {"kind": "between", "path": "src/client/index.html", "start": ".hud-players {", "end": ".hud-stats {"} -->
```html
      .hud-round {
        position: absolute;
        left: 50%;
        top: 12px;
        transform: translateX(-50%);
        min-width: 190px;
        padding: 6px 14px;
        text-align: center;
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        font-size: 13px;
      }
      .hud-round-title {
        color: var(--muted);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
      }
      .hud-round-clock {
        font-size: 20px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .hud-round-alive {
        color: var(--muted);
        font-size: 12px;
      }
      .hud-board {
        position: absolute;
        right: 16px;
        top: 12px;
        min-width: 190px;
        padding: 6px 10px;
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        font-size: 13px;
      }
      .hud-board.detailed {
        min-width: 300px;
      }
      .hud-board .row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 2px 0;
      }
      .hud-board .row.you {
        color: var(--accent);
        font-weight: 700;
      }
      .hud-board .row.out {
        opacity: 0.45;
        text-decoration: line-through;
      }
      .hud-board .rank {
        width: 1.2em;
        color: var(--muted);
        text-align: right;
      }
      .hud-board .chip {
        flex: none;
        width: 10px;
        height: 10px;
        border-radius: 50%;
      }
      .hud-board .name {
        flex: 1;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .hud-board .stat {
        color: var(--muted);
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }
      .hud-board .score {
        min-width: 2.6em;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .hud-feed {
        position: absolute;
        right: 16px;
        top: 190px;
        margin: 0;
        padding: 0;
        list-style: none;
        text-align: right;
        font-size: 13px;
        text-shadow: 0 1px 3px #000;
      }
      .hud-feed li {
        margin-top: 3px;
      }
      .hud-feed .feed-mine {
        color: #7dff9b;
        font-weight: 700;
      }
      .hud-feed .feed-theirs {
        color: #ff8a8a;
        font-weight: 700;
      }
      .hud-me {
        position: absolute;
        left: 50%;
        bottom: 26px;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 8px 14px;
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 10px;
      }
      .hud-zones {
        display: grid;
        grid-template: 12px 22px 12px / 12px 22px 12px;
        gap: 2px;
      }
      .hud-zones .zone {
        border-radius: 3px;
      }
      .hud-zones .zone-front {
        grid-area: 1 / 2;
      }
      .hud-zones .zone-left {
        grid-area: 2 / 1;
      }
      .hud-zones .zone-right {
        grid-area: 2 / 3;
      }
      .hud-zones .zone-rear {
        grid-area: 3 / 2;
      }
      .hud-zones .zone-car {
        grid-area: 2 / 2;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.35);
      }
      .hud-hp {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .hp-bar {
        width: 200px;
        height: 14px;
        background: rgba(0, 0, 0, 0.45);
        border: 1px solid var(--line);
        border-radius: 7px;
        overflow: hidden;
      }
      .hp-fill {
        height: 100%;
        width: 100%;
        transition: width 120ms linear;
      }
      .hp-num {
        min-width: 2.4em;
        font-size: 22px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .hud-speed {
        min-width: 5.5em;
        text-align: right;
        color: var(--muted);
        font-variant-numeric: tabular-nums;
      }
      .hud-banner {
        position: absolute;
        left: 50%;
        top: 26%;
        transform: translate(-50%, -50%);
        text-align: center;
        text-shadow: 0 2px 8px #000;
      }
      .banner-title {
        font-size: 72px;
        font-weight: 800;
        letter-spacing: 0.06em;
        line-height: 1;
      }
      .hud-banner[data-kind='go'] .banner-title {
        color: #7dff9b;
      }
      .hud-banner[data-kind='out'] .banner-title,
      .hud-banner[data-kind='watching'] .banner-title {
        font-size: 40px;
      }
      .hud-banner[data-kind='results'] .banner-title {
        font-size: 52px;
        color: var(--accent);
      }
      .banner-sub {
        margin-top: 8px;
        font-size: 18px;
        color: var(--ink);
      }
      .banner-hint {
        margin-top: 6px;
        font-size: 13px;
        color: var(--muted);
      }
      .hud-flash {
        position: absolute;
        inset: 0;
        opacity: 0;
        background: radial-gradient(ellipse at center, rgba(255, 0, 0, 0) 45%, rgba(255, 30, 30, 0.7) 100%);
      }
```

- [ ] **Step 6: Wire the client**

`src/client/game/gameClient.ts` — the client feeds the match state from the server's messages and from every frame's cars, draws the HUD from its view, keeps the name tags' health bars current, and chooses between the chase camera (your car runs) and the spectator camera (you are out, or you have no car). Imports first:

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
import { ChaseCamera } from './camera';
```

with:

```ts
import { applyChaseView, ChaseCamera } from './camera';
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
import { createNameTag, disposeNameTag } from './nameTag';
```

with:

```ts
import { MatchState } from './matchState';
import { NameTag } from './nameTag';
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
import { FixedStepper } from './stepper';
```

with:

```ts
import { SpectatorCamera } from './spectator';
import { FixedStepper } from './stepper';
```

The keys that switch the watched car, above the class:

replace the start of the class comment:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
/**
 * Sends inputs at 60 Hz.
```

with:

```ts
/** Keys that switch the car the spectator camera follows (they steer when you drive, so they are free once you are out). */
const CYCLE_KEYS: Readonly<Record<string, 1 | -1>> = {
  ArrowLeft: -1,
  KeyA: -1,
  KeyQ: -1,
  ArrowRight: 1,
  KeyD: 1,
  KeyE: 1,
};

/**
 * Sends inputs at 60 Hz.
```

The fields:

replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
  private readonly tags = new Map<number, THREE.Sprite>();
```

with:

```ts
  private readonly tags = new Map<number, NameTag>();
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
  private readonly chase = new ChaseCamera();
  private readonly keyboard = new KeyboardInput();
```

with:

```ts
  private readonly chase = new ChaseCamera();
  private readonly spectator = new SpectatorCamera();
  private readonly match = new MatchState();
  private readonly keyboard = new KeyboardInput(undefined, undefined, (code) => this.onKey(code));
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
  private lastPoses: DrawPose[] = [];
```

with:

```ts
  private lastPoses: DrawPose[] = [];
  /** True while your own car is running: the chase camera follows it; otherwise the spectator camera orbits another car. */
  private driving = false;
  private statsVisible = false;
```

The messages. The welcome and the roster feed the match state (and the roster resets the spectator camera); `phase`, `hit`, `ko`, `scores` and `results` were ignored until now:

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
        this.session.onWelcome(m.you, m.epoch, m.phase?.phase ?? null);
        this.applyRoster();
        this.opts.hud.setRoom(m.room.code, m.room.public);
        this.opts.hud.setPlayers(this.roster, this.mySlot);
        break;
```

with:

```ts
        this.session.onWelcome(m.you, m.epoch, m.phase?.phase ?? null);
        this.match.onWelcome(m);
        this.applyRoster();
        this.opts.hud.setRoom(m.room.code, m.room.public);
        break;
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
        this.chase.reset(); // and start the camera at the new spawn
        this.applyRoster();
        this.opts.hud.setPlayers(this.roster, this.mySlot);
        break;
      case 'phase':
        this.session.onPhase(m.phase);
        break;
```

with:

```ts
        this.chase.reset(); // and start the camera at the new spawn
        this.spectator.reset();
        this.match.onRoster(m);
        this.applyRoster();
        break;
      case 'phase':
        this.session.onPhase(m.phase);
        this.match.onPhase(m);
        break;
      case 'hit':
        this.match.onHit(m);
        break;
      case 'ko':
        this.match.onKo(m);
        break;
      case 'scores':
        this.match.onScores(m);
        break;
      case 'results':
        this.match.onResults(m);
        break;
```

The name tags become `NameTag`s, and the client learns what F3 and the cycle keys do:

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
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

```

with:

```ts
    if (existing && existing.name === name) return;
    existing?.dispose();
    const tag = new NameTag(name);
    view.group.add(tag.group);
    this.tags.set(slot, tag);
  }

  private removeTag(slot: number): void {
    const tag = this.tags.get(slot);
    if (!tag) return;
    tag.dispose();
    this.tags.delete(slot);
  }

  /** F3 shows the network line; while you are out, the cycle keys pick the next car to watch. */
  private onKey(code: string): void {
    if (code === 'F3') {
      this.statsVisible = !this.statsVisible;
      this.opts.hud.setStatsVisible(this.statsVisible);
      return;
    }
    const direction = CYCLE_KEYS[code];
    if (direction && !this.driving) this.spectator.cycle(this.lastPoses, direction);
  }

```

And every frame: each visible car's tag shows its health, the camera is chosen, the match state gets the latest cars, and the HUD draws the view:

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
      view.setWreck(!p.alive);
      const vf
```

with:

```ts
      view.setWreck(!p.alive);
      this.tags.get(p.slot)?.update(p.hp, p.alive);
      const vf
```

In `src/client/game/gameClient.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/game/gameClient.ts"} -->
```ts
    // follow your own car; when it is a wreck, or you have no car this round, follow the first car still running
    const mine = poses.find((p) => p.slot === this.mySlot && p.visible);
    const watched = mine?.alive ? mine : (poses.find((p) => p.visible && p.alive && p.slot !== this.mySlot) ?? mine);
    if (watched) {
      this.chase.update(this.opts.gs.camera, { pos: watched.pos, quat: watched.quat, speed: vlen(watched.linvel) }, dt);
    }

```

with:

```ts
    // chase your own car while it runs; once it is a wreck (or you have none this round) orbit a car that still runs
    const mine = poses.find((p) => p.slot === this.mySlot && p.visible);
    this.driving = mine?.alive === true;
    const orbit = this.driving ? null : this.spectator.view(poses, dt);
    if (orbit) applyChaseView(this.opts.gs.camera, orbit);
    else if (mine) this.chase.update(this.opts.gs.camera, { pos: mine.pos, quat: mine.quat, speed: vlen(mine.linvel) }, dt);
    this.match.setWatching(this.driving ? -1 : this.spectator.watching);
    this.match.onCars(poses.filter((p) => p.visible).map((p) => ({ slot: p.slot, hp: p.hp, alive: p.alive, speed: vlen(p.linvel) })));
    this.opts.hud.setMatch(this.match.view(), this.keyboard.isDown('Tab'));

```

The menu's hint line and the README:

In `src/client/ui/menu.ts`, replace:

<!-- op {"kind": "edit", "path": "src/client/ui/menu.ts"} -->
```ts
W/S throttle · A/D steer · Space handbrake</p>`;
```

with:

```ts
W/S throttle · A/D steer · Space handbrake · Tab scoreboard · F3 network</p>`;
```

In `README.md`, replace the last bullet of "Rounds and combat":

<!-- op {"kind": "edit", "path": "README.md"} -->
```markdown
- The match screen (health bar, timer, kill feed, scoreboard, banners) is the next plan; until then follow a round with `window.__derby.debug()` or the server messages `phase`, `hit`, `ko`, `scores` and `results`.

```

with:

```markdown
- The match screen shows the round clock and how many cars still run (top centre), the scoreboard (top right; hold **Tab** for kills and health), a kill feed under it, your health bar with the damage taken on each side of the car and your speed (bottom centre), a red flash when you are hit, and banners for the countdown, GO, being out and the results. Other cars carry their name and a health bar. **F3** shows the network line (mode, ping, frame rate, prediction error).
- When your car is out, or you joined a round that was already running, a camera orbits a car that is still running; **← → (or A/D, Q/E)** switches car. Your controls keep being sent while you watch, so the server does not drop you as inactive.

```

- [ ] **Step 7: Run the whole suite**

Run: `npm run typecheck && npm test && npm run build`
Expected: Type-check clean, 469 tests pass, the production build succeeds (the chunk-size warning is the same as before).

<!-- check {"cmd": "npm run typecheck && npm test && npm run build", "outcome": "pass", "tests": 469} -->

- [ ] **Step 8: Look at it in a browser**

Build is done, so serve it on a private port (never stop your own `npm run dev`), with short phases so you do not wait:

```bash
PORT=18092 STATIC_DIR=dist/client COUNTDOWN_SECONDS=5 ROUND_SECONDS=90 RESULTS_SECONDS=10 node dist/server/index.js
```

Open `http://localhost:18092/?auto=quick&name=Tester`. Check, in this order (each was seen in the rehearsal):

- **Countdown:** the round panel (top centre) says `Round 1`, `Starts in 5` and `Alive 4/4`; a big `5` counts down under it with `Round 1 — get ready`; the scoreboard (top right) lists you in the accent colour and the three bots marked `· bot`; the health bar, the four-square damage diagram and `0 km/h` sit at the bottom centre; the other cars carry a name and a green bar.
- **Live:** `GO!` flashes green for a second, then `Time left 1:30` counts down. Hold W: the speed reads in km/h. When you are hit the screen edge flashes red for half a second, the side of the diagram that took it goes orange to red, and the health bar shrinks and changes colour. **Hold Tab:** the scoreboard grows a kills and health column; release it and it shrinks back. **F3** shows and hides the network line at the bottom left.
- **Kill feed:** under the scoreboard, lines like `Rusty wrecked Dent` appear for a few seconds; your own kills are green and your own elimination is red.
- **Out:** stop driving (or wait for the bots). When your car is out, the health panel says `OUT`, a banner says `You are out` / `Following <name>` / `← → switch car`, the camera orbits a car that is still running (start `npx tsx scripts/bot.ts --url ws://localhost:18092/ws --name BotA` twice first, so that the round goes on after you are out), and ← → (or A/D, Q/E) switch cars.
- **Watching:** in a second tab, join the same room by its code once the round is live: `Watching` / `Following <name>` / `You join the next round · ← → switch car`, no health panel.
- **Results:** `<Name> wins` in the accent colour with `Next round in N · you scored G`, the scoreboard shows the round's points including the winner's +100, then the next round starts.
- No console errors. Stop your server with Ctrl-C, and any bots.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(client): the match screen \u2014 round clock, scoreboard, kill feed, health and damage diagram, banners, spectator camera, health bars on name tags"
```

<!-- commit "feat(client): the match screen \u2014 round clock, scoreboard, kill feed, health and damage diagram, banners, spectator camera, health bars on name tags" -->

---

## Plan 5 done when

- [ ] `npm run typecheck`, `npm test` (469 tests), `npm run build` pass, and `npm run hash` still prints `10c3a72a`.
- [ ] The browser check of Task 35 passes on a private port: countdown, GO, health and damage diagram, hit flash, Tab board, F3 line, the kill feed, `You are out` with a working spectator camera, `Watching` for a late joiner, the results banner; no console errors.
- [ ] **The user has looked at it** — the layout, the colours and the banner timings — and said what to change. The styles are in `src/client/index.html`; the timings are `FEED_MS`, `FEED_MAX`, `GO_MS` and `FLASH_MS` in `matchState.ts`.

**Known limits of this baseline (each addressed by a later plan):** there is no sound, no smoke, sparks or debris, no dents and no skid marks (Plan 6); the local car's wheels are still drawn from an approximation although the local simulation knows them exactly (a Plan 6 change in `carView.ts`); the spectator camera orbits at a fixed distance and can see through an obstacle; the HUD is a fixed desktop layout with no settings menu or graphics presets (Plan 7); a player who leaves during the countdown still becomes a wreck for the whole round (a Plan 4 minor).

**Next plans** (written after this one is verified, against the code as it then stands): Plan 6 — destruction and juice (dents, parts, particles, skid marks, camera shake, bloom, audio, arena dressing); Plan 7 — polish and packaging (menu and settings, graphics presets, limits, CLAUDE.md, Dockerfile, load test).
