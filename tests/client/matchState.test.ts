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
