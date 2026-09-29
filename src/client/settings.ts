import { clamp } from '../shared/math';

export type Quality = 'low' | 'medium' | 'high';
export const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];

/** What a graphics preset changes. */
export interface QualityProfile {
  /** Highest device pixel ratio the game draws at (a 2x screen at 1.5 draws 44 % fewer pixels). */
  pixelRatio: number;
  /** Samples per pixel of the buffer the scene is drawn into; 0 (with no glow) draws straight to the screen, whose own antialiasing applies. */
  msaa: number;
  /** Whether the floodlight casts shadows, and how sharp they are. */
  shadows: boolean;
  shadowMapSize: number;
  /** The glow around lamps, headlights and sparks. */
  bloom: boolean;
  /** The crowd in the stands. */
  crowd: boolean;
  /** Multiplies how many particles the effects emit (0 to 1). */
  particles: number;
  /** Pieces of debris alive at once. */
  debris: number;
}

export const QUALITY: Readonly<Record<Quality, QualityProfile>> = {
  high: { pixelRatio: 2, msaa: 4, shadows: true, shadowMapSize: 2048, bloom: true, crowd: true, particles: 1, debris: 40 },
  medium: { pixelRatio: 1.5, msaa: 2, shadows: true, shadowMapSize: 1024, bloom: true, crowd: true, particles: 0.6, debris: 24 },
  low: { pixelRatio: 1, msaa: 0, shadows: false, shadowMapSize: 512, bloom: false, crowd: false, particles: 0.3, debris: 12 },
};

/** What the player chose: kept in the browser's storage between visits. */
export interface Settings {
  quality: Quality;
  /** Sound level, 0 to 1. */
  volume: number;
  muted: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = { quality: 'high', volume: 1, muted: false };

const KEY = 'wreckyard.settings';

/** The saved settings; anything missing, damaged or out of range falls back to the defaults, and storage may be absent or throw. */
export function loadSettings(storage: Pick<Storage, 'getItem'> | null | undefined): Settings {
  try {
    const raw = storage?.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Settings> | null;
      return {
        quality: QUALITIES.includes(p?.quality as Quality) ? (p!.quality as Quality) : DEFAULT_SETTINGS.quality,
        volume: typeof p?.volume === 'number' && Number.isFinite(p.volume) ? clamp(p.volume, 0, 1) : DEFAULT_SETTINGS.volume,
        muted: typeof p?.muted === 'boolean' ? p.muted : DEFAULT_SETTINGS.muted,
      };
    }
  } catch {
    /* storage unavailable or corrupt: the defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(storage: Pick<Storage, 'setItem'> | null | undefined, settings: Settings): void {
  try {
    storage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode or full: not fatal */
  }
}

/** The next preset down, or null at the bottom. */
export function lowerQuality(q: Quality): Quality | null {
  const i = QUALITIES.indexOf(q);
  return i > 0 ? QUALITIES[i - 1]! : null;
}

/** The next preset in the cycle low, medium, high, low: what the G key does. */
export function nextQuality(q: Quality): Quality {
  return QUALITIES[(QUALITIES.indexOf(q) + 1) % QUALITIES.length]!;
}

export interface AutoQualityOptions {
  /** Seconds at the start (and after a change) that are not counted: loading and shader compilation make the first frames slow. */
  warmupSeconds: number;
  /** Length of one measuring window in seconds. */
  windowSeconds: number;
  /** A window that averages fewer frames a second than this is a slow one. */
  minFps: number;
  /** Slow windows in a row before the quality is lowered. */
  windows: number;
}

/**
 * Watches frame times and says when to drop one quality level: after `windows` slow measuring windows in a row, once the warm-up is
 * over. A frame longer than half a second (a hidden tab, a stall) is not held against the game and restarts the window.
 * It only ever asks for a step down; going back up is the player's choice, so it cannot flap.
 */
export class AutoQuality {
  private readonly options: AutoQualityOptions;
  private warmup: number;
  private time = 0;
  private frames = 0;
  private slow = 0;

  constructor(options: Partial<AutoQualityOptions> = {}) {
    this.options = { warmupSeconds: 5, windowSeconds: 3, minFps: 40, windows: 2, ...options };
    this.warmup = this.options.warmupSeconds;
  }

  /** Feed the duration of every frame (seconds). True means: lower the quality one step now. */
  frame(dt: number): boolean {
    if (!Number.isFinite(dt) || dt <= 0) return false;
    if (dt > 0.5) {
      this.time = 0;
      this.frames = 0;
      this.slow = 0;
      return false;
    }
    if (this.warmup > 0) {
      this.warmup -= dt;
      return false;
    }
    this.time += dt;
    this.frames++;
    if (this.time < this.options.windowSeconds) return false;
    const fps = this.frames / this.time;
    this.time = 0;
    this.frames = 0;
    this.slow = fps < this.options.minFps ? this.slow + 1 : 0;
    if (this.slow < this.options.windows) return false;
    this.reset();
    return true;
  }

  /** Starts over (after the quality changed): the new setting gets its own warm-up and its own windows. */
  reset(): void {
    this.warmup = Math.min(this.options.warmupSeconds, 2);
    this.time = 0;
    this.frames = 0;
    this.slow = 0;
  }
}
