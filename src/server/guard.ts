import type http from 'node:http';

/** Limits on what one address can do. All counts are per address; 0 turns a limit off. */
export interface GuardOptions {
  /** Sockets open at once. */
  maxConnectionsPerIp: number;
  /** Joins that fail (no such room, room full) in `failedJoinWindowMs` before the address is locked out for `lockoutMs`. */
  failedJoinLimit: number;
  failedJoinWindowMs: number;
  lockoutMs: number;
  /** Private rooms created per minute. */
  roomsPerMinute: number;
  /** Clock in milliseconds; injectable for tests. */
  now?: () => number;
}

export const DEFAULT_GUARD: Readonly<GuardOptions> = {
  maxConnectionsPerIp: 16,
  failedJoinLimit: 8,
  failedJoinWindowMs: 60_000,
  lockoutMs: 30_000,
  roomsPerMinute: 6,
};

export type Admission = 'ok' | 'too_many' | 'locked';

/**
 * The address a request really comes from. Behind `trustedProxies` reverse proxies, each of which appends the address it saw to
 * X-Forwarded-For, the entry to believe is the one that many places from the right: everything to its left was written by the
 * client and can say anything. With no proxy (0), or fewer entries than proxies (the request skipped one), it is the socket's peer.
 */
export function clientIp(req: Pick<http.IncomingMessage, 'headers' | 'socket'>, trustedProxies: number): string {
  if (trustedProxies > 0) {
    const header = req.headers['x-forwarded-for'];
    const entries = (Array.isArray(header) ? header.join(',') : (header ?? '')).split(',').map((s) => s.trim()).filter(Boolean);
    const entry = entries.length >= trustedProxies ? entries[entries.length - trustedProxies] : undefined;
    if (entry) return entry.replace(/^::ffff:/, '');
  }
  return (req.socket.remoteAddress ?? 'unknown').replace(/^::ffff:/, '');
}

/**
 * Loopback, link-local and private-network addresses. Behind a reverse proxy on the same host or network every player looks
 * like one of these, so limits are not applied to them (a whole game room would share one address); set TRUST_PROXY to
 * limit the real addresses the proxy reports. LAN players are private addresses too and stay unlimited.
 */
export function isPrivateAddress(ip: string): boolean {
  if (ip === 'unknown' || ip === '::1' || ip === 'localhost') return true;
  if (/^(fc|fd|fe80)/i.test(ip)) return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(ip);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

interface AddressRecord {
  open: number;
  failures: number[];
  lockedUntil: number;
  rooms: number[];
}

/**
 * Remembers what each public address has done and says whether it may do more: open another socket, try another room code,
 * create another room. Memory stays bounded: an address is forgotten once it has no socket, no lockout and nothing recent.
 */
export class ConnectionGuard {
  private readonly records = new Map<string, AddressRecord>();
  private readonly options: GuardOptions;
  private readonly now: () => number;

  constructor(options: Partial<GuardOptions> = {}) {
    this.options = { ...DEFAULT_GUARD, ...options };
    this.now = options.now ?? (() => Date.now());
  }

  /** Addresses being tracked (for tests and stats). */
  get tracked(): number {
    return this.records.size;
  }

  /** A new socket from `ip`. Call `release(ip)` when it closes, but only after an `'ok'`. */
  admit(ip: string): Admission {
    if (isPrivateAddress(ip)) return 'ok';
    const r = this.record(ip);
    if (r.lockedUntil > this.now()) return 'locked';
    if (this.options.maxConnectionsPerIp > 0 && r.open >= this.options.maxConnectionsPerIp) return 'too_many';
    r.open++;
    return 'ok';
  }

  release(ip: string): void {
    if (isPrivateAddress(ip)) return;
    const r = this.records.get(ip);
    if (!r) return;
    r.open = Math.max(0, r.open - 1);
    this.forget(ip, r);
  }

  /** A join that failed. Returns true when the address is now locked out. A join that works does not clear the count: a guesser could interleave those; mistakes expire with the window. */
  failedJoin(ip: string): boolean {
    if (isPrivateAddress(ip) || this.options.failedJoinLimit <= 0) return false;
    const r = this.record(ip);
    const t = this.now();
    r.failures = r.failures.filter((at) => t - at < this.options.failedJoinWindowMs);
    r.failures.push(t);
    if (r.failures.length >= this.options.failedJoinLimit) {
      r.lockedUntil = t + this.options.lockoutMs;
      r.failures = [];
      return true;
    }
    return false;
  }

  /** May `ip` create another private room? Counts the creation when it says yes. */
  mayCreateRoom(ip: string): boolean {
    if (isPrivateAddress(ip) || this.options.roomsPerMinute <= 0) return true;
    const r = this.record(ip);
    const t = this.now();
    r.rooms = r.rooms.filter((at) => t - at < 60_000);
    if (r.rooms.length >= this.options.roomsPerMinute) return false;
    r.rooms.push(t);
    return true;
  }

  private record(ip: string): AddressRecord {
    let r = this.records.get(ip);
    if (!r) {
      r = { open: 0, failures: [], lockedUntil: 0, rooms: [] };
      this.records.set(ip, r);
    }
    return r;
  }

  /** Forgets the addresses that have no socket, no lockout and nothing recent. Call now and then (the server does it once a minute). */
  sweep(): void {
    for (const [ip, r] of this.records) this.forget(ip, r);
  }

  private forget(ip: string, r: AddressRecord): void {
    const t = this.now();
    const recent = r.failures.some((at) => t - at < this.options.failedJoinWindowMs) || r.rooms.some((at) => t - at < 60_000);
    if (r.open === 0 && r.lockedUntil <= t && !recent) this.records.delete(ip);
  }
}
