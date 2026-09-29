import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GUARD } from '../src/server/guard';
import { readConfig } from '../src/server/config';

// The README is what an operator reads before deploying: what it says about the limits must be what the code does.
const readme = readFileSync('README.md', 'utf8');

describe('README', () => {
  it('states the limits the code has', () => {
    const config = readConfig({}, '/app');
    expect(readme).toContain(`allows ${DEFAULT_GUARD.maxConnectionsPerIp} open sockets`);
    expect(config.options.guard?.maxConnectionsPerIp).toBe(DEFAULT_GUARD.maxConnectionsPerIp);
    expect(readme).toContain(`after ${DEFAULT_GUARD.failedJoinLimit} failed joins in a minute`);
    expect(readme).toContain(`for ${DEFAULT_GUARD.lockoutMs / 1000} s`);
    expect(readme).toContain(`create ${DEFAULT_GUARD.roomsPerMinute} private rooms a minute`);
    expect(readme).toContain('`MAX_ROOMS` (12)');
    expect(config.options.maxRooms).toBe(12);
  });

  it('warns about both ways to get TRUST_PROXY wrong: a public load balancer left at 0, and a count with no proxy that appends', () => {
    expect(readme).toMatch(/load balancer/i);
    expect(readme).toMatch(/every player shares that address/i);
    expect(readme).toMatch(/append/i);
    expect(readme).toMatch(/never set it without/i);
    expect(readme).toMatch(/\/healthz/);
  });

  it('says an IPv6 client is limited by its whole /64 prefix', () => {
    expect(readme).toContain('/64');
  });
});
