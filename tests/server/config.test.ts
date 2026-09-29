import { describe, expect, it } from 'vitest';
import { ROUND } from '../../src/shared/constants';
import { readConfig } from '../../src/server/config';

describe('readConfig', () => {
  it('uses the defaults when nothing is set', () => {
    const c = readConfig({}, '/app');
    expect(c.port).toBe(8080);
    expect(c.staticDir).toBe('/app/dist/client');
    expect(c.options).toEqual({
      allowedOrigins: [],
      maxRooms: 12,
      maxConnections: 200,
      botFill: ROUND.BOT_FILL,
      rules: { countdownTicks: ROUND.COUNTDOWN_TICKS, liveTicks: ROUND.LIVE_TICKS, resultsTicks: ROUND.RESULTS_TICKS },
    });
  });

  it('reads every setting', () => {
    const c = readConfig(
      { PORT: '9000', STATIC_DIR: '/srv/www', ALLOWED_ORIGINS: 'https://a.example, https://b.example ,', MAX_ROOMS: '3', MAX_CONNECTIONS: '50', BOT_FILL: '2', COUNTDOWN_SECONDS: '3', ROUND_SECONDS: '45', RESULTS_SECONDS: '2.5' },
      '/app',
    );
    expect(c.port).toBe(9000);
    expect(c.staticDir).toBe('/srv/www');
    expect(c.options.allowedOrigins).toEqual(['https://a.example', 'https://b.example']);
    expect(c.options.maxRooms).toBe(3);
    expect(c.options.maxConnections).toBe(50);
    expect(c.options.botFill).toBe(2);
    expect(c.options.rules).toEqual({ countdownTicks: 180, liveTicks: 2700, resultsTicks: 150 });
  });

  it('allows no bots at all, and never more bots than cars', () => {
    expect(readConfig({ BOT_FILL: '0' }).options.botFill).toBe(0);
    expect(readConfig({ BOT_FILL: '99' }).options.botFill).toBe(8);
  });

  it('falls back to the defaults for garbage instead of refusing to start', () => {
    const c = readConfig({ PORT: 'eighty', MAX_ROOMS: '-3', MAX_CONNECTIONS: '0', BOT_FILL: 'many', COUNTDOWN_SECONDS: 'soon', ROUND_SECONDS: '-1', RESULTS_SECONDS: '0' }, '/app');
    expect(c.port).toBe(8080);
    expect(c.options.maxRooms).toBe(12);
    expect(c.options.maxConnections).toBe(200);
    expect(c.options.botFill).toBe(ROUND.BOT_FILL);
    expect(c.options.rules).toEqual({ countdownTicks: ROUND.COUNTDOWN_TICKS, liveTicks: ROUND.LIVE_TICKS, resultsTicks: ROUND.RESULTS_TICKS });
  });

  it('never rounds a round phase down to nothing', () => {
    expect(readConfig({ COUNTDOWN_SECONDS: '0.001' }).options.rules!.countdownTicks).toBe(1);
  });
});
