import { describe, expect, it } from 'vitest';
import { ConnectionGuard, DEFAULT_GUARD, clientIp, guardKey, isPrivateAddress } from '../../src/server/guard';

const PUBLIC = '203.0.113.7';
const OTHER = '198.51.100.20';
const clock = (start = 1_000_000) => {
  const c = { t: start };
  return { c, now: () => c.t };
};

describe('isPrivateAddress and clientIp', () => {
  it('knows loopback, private, link-local and unknown addresses from public ones', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '172.31.255.1', '192.168.1.20', '169.254.3.3', '::1', 'fd12::1', 'fe80::1', 'unknown']) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of [PUBLIC, OTHER, '172.32.0.1', '172.15.0.1', '11.0.0.1', '2001:db8::1']) expect(isPrivateAddress(ip)).toBe(false);
  });

  it('takes the socket peer, without the IPv6 prefix of an IPv4 address', () => {
    expect(clientIp({ headers: {}, socket: { remoteAddress: '::ffff:203.0.113.7' } } as never, 0)).toBe(PUBLIC);
    expect(clientIp({ headers: {}, socket: { remoteAddress: undefined } } as never, 0)).toBe('unknown');
  });

  it('believes X-Forwarded-For only behind proxies it was told to trust, and only the entries they wrote', () => {
    const SPOOFED = '192.0.2.99';
    const req = (header: string | string[] | undefined) => ({ headers: header === undefined ? {} : { 'x-forwarded-for': header }, socket: { remoteAddress: '10.0.0.1' } }) as never;
    expect(clientIp(req(`${OTHER}, 10.0.0.1`), 0)).toBe('10.0.0.1'); // no proxy trusted: the header is ignored
    // one proxy that appends what it saw: the last entry is its own, everything before it came from the client and may be a lie
    expect(clientIp(req(`${SPOOFED}, ${OTHER}`), 1)).toBe(OTHER);
    expect(clientIp(req(OTHER), 1)).toBe(OTHER);
    expect(clientIp(req(`${SPOOFED}, ${OTHER}, 10.0.0.7`), 2)).toBe(OTHER); // two proxies: the second from the right
    expect(clientIp(req(['::ffff:198.51.100.20']), 1)).toBe(OTHER);
    // fewer entries than proxies, or none: the request skipped a proxy, so the peer is the client
    expect(clientIp(req(OTHER), 2)).toBe('10.0.0.1');
    expect(clientIp(req(undefined), 1)).toBe('10.0.0.1');
  });
});

describe('guardKey', () => {
  it('is the address for IPv4, and the /64 prefix for IPv6, because one client controls a whole /64 and could use a new address every time', () => {
    expect(guardKey('203.0.113.7')).toBe('203.0.113.7');
    expect(guardKey('2001:db8:1:2:aaaa::1')).toBe(guardKey('2001:db8:1:2:bbbb:0:0:2'));
    expect(guardKey('2001:db8:1:2:aaaa::1')).toBe(guardKey('2001:0DB8:1:2::9')); // upper case and compression do not matter
    expect(guardKey('2001:db8:1:2::1')).not.toBe(guardKey('2001:db8:1:3::1'));
    expect(guardKey('2001:db8:1:2::1')).not.toBe(guardKey('2001:db9:1:2::1'));
    expect(guardKey('2001:db8::1')).toBe(guardKey('2001:db8:0:0:5::1')); // "::" fills the zero groups
    expect(guardKey('not an address')).toBe('not an address');
  });
});

describe('ConnectionGuard and IPv6 clients', () => {
  it('counts every address of one /64 as one client for sockets, failed guesses and rooms, and keeps other prefixes apart', () => {
    const { c, now } = clock();
    const g = new ConnectionGuard({ maxConnectionsPerIp: 2, failedJoinLimit: 3, lockoutMs: 30_000, roomsPerMinute: 2, now });
    const a1 = '2001:db8:1:2:1::1';
    const a2 = '2001:db8:1:2:2::1';
    const a3 = '2001:db8:1:2:3::1';
    const other = '2001:db8:1:9::1';
    expect([g.admit(a1), g.admit(a2), g.admit(a3)]).toEqual(['ok', 'ok', 'too_many']); // rotating inside the prefix gains nothing
    expect(g.admit(other)).toBe('ok');
    g.release(a1);
    expect(g.admit(a3)).toBe('ok');
    expect([g.failedJoin(a1), g.failedJoin(a2), g.failedJoin(a3)]).toEqual([false, false, true]);
    expect(g.admit('2001:db8:1:2:4::1')).toBe('locked');
    expect(g.admit(other)).toBe('ok'); // another prefix is not locked out with them, and has its own second socket...
    expect(g.admit(other)).toBe('too_many'); // ...but not a third
    expect([g.mayCreateRoom(a1), g.mayCreateRoom(a2), g.mayCreateRoom(a3)]).toEqual([true, true, false]);
    c.t += 61_000;
    expect(g.mayCreateRoom(a3)).toBe(true);
  });

  it('still exempts private IPv6 addresses (unique local and link-local)', () => {
    const g = new ConnectionGuard({ maxConnectionsPerIp: 1 });
    for (let i = 0; i < 4; i++) expect(g.admit(`fd12:3456:789a:1::${i + 1}`)).toBe('ok');
    for (let i = 0; i < 4; i++) expect(g.admit(`fe80::${i + 1}`)).toBe('ok');
  });
});

describe('ConnectionGuard sockets', () => {
  it('lets an address keep a few sockets open, refuses the next, and lets it back in when one closes', () => {
    const g = new ConnectionGuard({ maxConnectionsPerIp: 3 });
    expect([g.admit(PUBLIC), g.admit(PUBLIC), g.admit(PUBLIC)]).toEqual(['ok', 'ok', 'ok']);
    expect(g.admit(PUBLIC)).toBe('too_many');
    expect(g.admit(OTHER)).toBe('ok'); // another address is not affected
    g.release(PUBLIC);
    expect(g.admit(PUBLIC)).toBe('ok');
  });

  it('never limits private addresses (a proxy or a LAN game would share one) and can be switched off', () => {
    const g = new ConnectionGuard({ maxConnectionsPerIp: 1 });
    for (let i = 0; i < 50; i++) expect(g.admit('127.0.0.1')).toBe('ok');
    const off = new ConnectionGuard({ maxConnectionsPerIp: 0 });
    for (let i = 0; i < 50; i++) expect(off.admit(PUBLIC)).toBe('ok');
  });

  it('forgets an address when its last socket closes, so memory does not grow with the crowd', () => {
    const g = new ConnectionGuard({ maxConnectionsPerIp: 4 });
    for (let i = 0; i < 100; i++) {
      const ip = `203.0.113.${i}`;
      g.admit(ip);
      g.release(ip);
    }
    expect(g.tracked).toBe(0);
  });
});

describe('ConnectionGuard failed joins', () => {
  it('locks an address out for a while after too many failed joins in a minute, and then lets it back', () => {
    const { c, now } = clock();
    const g = new ConnectionGuard({ failedJoinLimit: 3, failedJoinWindowMs: 60_000, lockoutMs: 30_000, now });
    expect(g.admit(PUBLIC)).toBe('ok');
    expect([g.failedJoin(PUBLIC), g.failedJoin(PUBLIC)]).toEqual([false, false]);
    expect(g.failedJoin(PUBLIC)).toBe(true);
    expect(g.admit(PUBLIC)).toBe('locked');
    expect(g.admit(OTHER)).toBe('ok');
    c.t += 29_000;
    expect(g.admit(PUBLIC)).toBe('locked');
    c.t += 2_000;
    expect(g.admit(PUBLIC)).toBe('ok');
  });

  it('forgets failures that are older than the window', () => {
    const { c, now } = clock();
    const g = new ConnectionGuard({ failedJoinLimit: 3, failedJoinWindowMs: 60_000, now });
    g.failedJoin(PUBLIC);
    g.failedJoin(PUBLIC);
    c.t += 61_000;
    expect(g.failedJoin(PUBLIC)).toBe(false); // the first two are old
    expect(g.failedJoin(PUBLIC)).toBe(false);
    expect(g.failedJoin(PUBLIC)).toBe(true); // three inside one window
  });

  it('does not count failures of private addresses', () => {
    const g = new ConnectionGuard({ failedJoinLimit: 1 });
    expect(g.failedJoin('127.0.0.1')).toBe(false);
    expect(g.admit('127.0.0.1')).toBe('ok');
  });
});

describe('ConnectionGuard room creation', () => {
  it('allows a few new private rooms a minute per address and then says no until the minute is up', () => {
    const { c, now } = clock();
    const g = new ConnectionGuard({ roomsPerMinute: 3, now });
    expect([g.mayCreateRoom(PUBLIC), g.mayCreateRoom(PUBLIC), g.mayCreateRoom(PUBLIC)]).toEqual([true, true, true]);
    expect(g.mayCreateRoom(PUBLIC)).toBe(false);
    expect(g.mayCreateRoom(OTHER)).toBe(true);
    c.t += 61_000;
    expect(g.mayCreateRoom(PUBLIC)).toBe(true);
  });
});

describe('ConnectionGuard.sweep', () => {
  it('forgets addresses whose failures and rooms have aged out, and keeps those still locked out or connected', () => {
    const { c, now } = clock();
    const g = new ConnectionGuard({ failedJoinLimit: 2, lockoutMs: 30_000, now });
    g.failedJoin('203.0.113.1'); // one failure, no socket
    g.mayCreateRoom('203.0.113.2');
    g.failedJoin('203.0.113.3');
    g.failedJoin('203.0.113.3'); // locked out
    g.admit('203.0.113.4'); // connected
    expect(g.tracked).toBe(4);
    c.t += 20_000;
    g.sweep();
    expect(g.tracked).toBe(4);
    c.t += 45_000; // failures and rooms are older than a minute, the lockout is over
    g.sweep();
    expect(g.tracked).toBe(1); // only the connected one
    expect(DEFAULT_GUARD.maxConnectionsPerIp).toBeGreaterThan(8); // a full room of one household fits
  });
});
