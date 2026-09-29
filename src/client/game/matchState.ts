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
import { COMBAT } from '../../shared/constants';
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
    if (w.phase) this.enter(w.phase); // already under way when you arrive: no GO! for a round that started minutes ago
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
    const wasLive = this.phase === 'live';
    this.enter(p);
    if (p.phase === 'live' && !wasLive) this.liveSince = this.now();
  }

  private enter(p: PhaseMessage): void {
    this.phase = p.phase;
    this.round = p.round;
    this.deadline = this.now() + p.remainingMs;
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
    const sane = (v: number, max = Number.POSITIVE_INFINITY): number => (Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : 0);
    for (const c of cars) this.facts.set(c.slot, { slot: c.slot, alive: c.alive, hp: sane(c.hp, COMBAT.MAX_HP), speed: sane(c.speed) });
  }

  /** Slot of the car the camera follows while you are out or watching (-1: none). */
  setWatching(slot: number): void {
    this.watching = slot;
  }

  view(): MatchView {
    const t = this.now();
    const remaining = Math.max(0, this.deadline - t);
    const seconds = Math.max(1, Math.ceil(remaining / 1000)); // never 0 or negative while the phase message is the newest news
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
      clock = String(seconds);
    } else if (this.phase === 'live') {
      clockLabel = 'Time left';
      clock = clockText(remaining);
    } else if (this.phase === 'results') {
      clockLabel = 'Next round in';
      clock = String(seconds);
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
      banner: this.banner(t, seconds, meAlive),
      flash: Math.max(0, 1 - (t - this.flashAt) / FLASH_MS) * this.flashPower,
    };
  }

  private banner(t: number, seconds: number, meAlive: boolean): Banner | null {
    const name = (slot: number): string => this.players.get(slot)?.name ?? `Car ${slot + 1}`;
    if (this.phase === 'countdown') {
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
