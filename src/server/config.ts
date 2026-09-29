import path from 'node:path';
import { ROUND } from '../shared/constants';
import type { GameServerOptions } from './app';

export interface ServerConfig {
  port: number;
  staticDir: string;
  options: GameServerOptions;
}

/** A positive whole number, or `fallback` for anything else (missing, zero, negative, fractional garbage, NaN). */
const positive = (value: string | undefined, fallback: number): number => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Zero or more, or `fallback`. */
const nonNegative = (value: string | undefined, fallback: number): number => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** How many reverse proxies to trust: "1", "true" or "yes" is one, a whole number is that many, anything else is none. */
const proxies = (value: string | undefined): number => {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'true' || v === 'yes') return 1;
  return /^\d{1,2}$/.test(v) ? Number(v) : 0;
};

/** Seconds (fractions allowed) turned into simulation ticks; anything unusable gives the default. */
const ticks = (value: string | undefined, fallbackTicks: number): number => {
  const n = Number.parseFloat(value ?? '');
  return Number.isFinite(n) && n > 0 ? Math.max(1, Math.round(n * 60)) : fallbackTicks;
};

/** The server's settings from environment variables. Bad values fall back to the defaults instead of stopping the server. */
export function readConfig(env: Record<string, string | undefined>, cwd: string = process.cwd()): ServerConfig {
  return {
    port: positive(env.PORT, 8080),
    staticDir: env.STATIC_DIR ?? path.resolve(cwd, 'dist/client'),
    options: {
      allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      maxRooms: positive(env.MAX_ROOMS, 12),
      maxConnections: positive(env.MAX_CONNECTIONS, 200),
      guard: { maxConnectionsPerIp: nonNegative(env.MAX_CONNECTIONS_PER_IP, 16) },
      trustProxy: proxies(env.TRUST_PROXY),
      botFill: Math.min(nonNegative(env.BOT_FILL, ROUND.BOT_FILL), 8),
      rules: {
        countdownTicks: ticks(env.COUNTDOWN_SECONDS, ROUND.COUNTDOWN_TICKS),
        liveTicks: ticks(env.ROUND_SECONDS, ROUND.LIVE_TICKS),
        resultsTicks: ticks(env.RESULTS_SECONDS, ROUND.RESULTS_TICKS),
      },
    },
  };
}
