import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { NET, PHYSICS } from '../shared/constants';
import { decodeInput, normalizeRoomCode, parseClientMessage, sanitizeName, type ErrorCode } from '../shared/protocol';
import { TokenBucket } from './limits';
import { Lobby, type JoinResult } from './lobby';
import { Player } from './player';
import { createStaticHandler } from './static';

export interface GameServerOptions {
  /** Directory with the built client (dist/client). Omit to serve only /healthz and /ws. */
  staticDir?: string;
  /** Exact allowed Origin values (e.g. "https://play.example.com"). Empty or omitted = same-host only. */
  allowedOrigins?: readonly string[];
  maxRooms?: number;
  maxConnections?: number;
  /** Milliseconds a new socket may stay silent before it is closed; defaults to NET.HELLO_TIMEOUT_MS. */
  helloTimeoutMs?: number;
}

export interface ServerStats {
  rooms: number;
  players: number;
  connections: number;
  tickMsP99: number;
  uptimeSec: number;
}

export interface GameServer {
  readonly server: http.Server;
  readonly wss: WebSocketServer;
  readonly lobby: Lobby;
  /** Starts listening and the 60 Hz loop; resolves with the bound port. */
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
  stats(): ServerStats;
}

const ERROR_TEXT: Record<ErrorCode, string> = {
  bad_message: 'Unrecognised or invalid message.',
  bad_version: `Client and server protocol versions differ (the server speaks version ${NET.PROTOCOL_VERSION}).`,
  already_joined: 'You are already in a room.',
  room_full: 'That room is full.',
  room_not_found: 'No room with that code.',
  server_full: 'The server is full — try again in a moment.',
  rate_limited: 'Too many messages.',
  inactive: 'Disconnected for inactivity.',
};

/** Browsers always send Origin on WebSocket upgrades; scripts and tests usually do not. */
export function originAllowed(origin: string | undefined, host: string | undefined, allowed?: readonly string[]): boolean {
  if (!origin) return true;
  if (allowed && allowed.length > 0) return allowed.includes(origin);
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

const DT_MS = 1000 / PHYSICS.TICK_RATE;

export function createGameServer(options: GameServerOptions = {}): GameServer {
  const lobby = new Lobby({ maxRooms: options.maxRooms ?? 12 });
  const staticHandler = options.staticDir ? createStaticHandler(options.staticDir) : null;
  const maxConnections = options.maxConnections ?? 200;
  const helloTimeoutMs = options.helloTimeoutMs ?? NET.HELLO_TIMEOUT_MS;
  const startedAt = Date.now();
  const tickTimes: number[] = [];
  let connections = 0;
  let nextPlayerId = 1;
  let loop: ReturnType<typeof setInterval> | null = null;

  const stats = (): ServerStats => {
    const sorted = [...tickTimes].sort((a, b) => a - b);
    const p99 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))]! : 0;
    return {
      rooms: lobby.roomCount,
      players: lobby.playerCount,
      connections,
      tickMsP99: Math.round(p99 * 1000) / 1000,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    };
  };

  const server = http.createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0];
    if (pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, ...stats() }));
      return;
    }
    if (staticHandler?.(req, res)) return;
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: NET.MAX_PAYLOAD_BYTES, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    const refuse = (status: string): void => {
      socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if ((req.url ?? '').split('?')[0] !== '/ws') return refuse('404 Not Found');
    if (!originAllowed(req.headers.origin, req.headers.host, options.allowedOrigins)) return refuse('403 Forbidden');
    if (connections >= maxConnections) return refuse('503 Service Unavailable');
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  function onBinary(player: Player, data: RawData, bucket: TokenBucket): void {
    if (!player.joined || !player.room) return; // inputs before a seat exists are ignored
    if (!bucket.take()) return; // silently drop input floods
    const pkt = decodeInput(toBytes(data));
    if (pkt) player.pushInput(pkt.seq, pkt.input);
  }

  function onText(player: Player, ws: WebSocket, text: string, bucket: TokenBucket): void {
    if (!bucket.take()) {
      player.sendError('rate_limited', ERROR_TEXT.rate_limited);
      ws.close(1008, 'rate limited');
      return;
    }
    const msg = parseClientMessage(text);
    if (!msg) {
      player.sendError('bad_message', ERROR_TEXT.bad_message);
      return;
    }
    if (msg.t === 'ping') {
      player.send({ t: 'pong', id: msg.id, c: msg.c, tick: player.room?.simTick ?? 0 });
      return;
    }
    if (player.joined) {
      player.sendError('already_joined', ERROR_TEXT.already_joined);
      return;
    }
    if (msg.v !== NET.PROTOCOL_VERSION) {
      player.sendError('bad_version', ERROR_TEXT.bad_version);
      ws.close(1002, 'bad version');
      return;
    }
    player.name = sanitizeName(msg.name, `Driver ${player.id}`);
    player.color = msg.color;
    let result: JoinResult;
    if (msg.mode === 'quick') result = lobby.quickPlay(player);
    else if (msg.mode === 'create') result = lobby.createPrivate(player);
    else {
      const code = normalizeRoomCode(msg.code ?? '');
      result = code ? lobby.join(player, code) : { ok: false, code: 'room_not_found' };
    }
    if (!result.ok) {
      player.sendError(result.code, ERROR_TEXT[result.code]);
      return;
    }
    player.joined = true;
    player.send({
      t: 'welcome',
      v: NET.PROTOCOL_VERSION,
      you: result.slot,
      room: result.room.info(),
      epoch: result.room.epoch,
      players: result.room.playerInfos(),
      tickRate: PHYSICS.TICK_RATE,
      snapshotEvery: NET.SNAPSHOT_EVERY,
    });
  }

  wss.on('connection', (ws: WebSocket) => {
    connections++;
    const player = new Player(nextPlayerId++, ws);
    const textBucket = new TokenBucket(20, 10);
    const inputBucket = new TokenBucket(120, 90);
    let alive = true;
    ws.on('pong', () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      try {
        ws.ping();
      } catch {
        /* closing */
      }
    }, NET.HEARTBEAT_MS);
    const helloTimer = setTimeout(() => {
      if (!player.joined) ws.close(1008, 'no hello');
    }, helloTimeoutMs);
    ws.on('message', (data: RawData, isBinary: boolean) => {
      try {
        if (isBinary) onBinary(player, data, inputBucket);
        else onText(player, ws, new TextDecoder().decode(toBytes(data)), textBucket);
      } catch (err) {
        console.error('message handler failed', err);
        ws.close(1011, 'internal error');
      }
    });
    ws.on('close', () => {
      clearInterval(heartbeat);
      clearTimeout(helloTimer);
      connections--;
      lobby.leave(player);
    });
    // 'error' must have a listener or Node crashes; ws closes the socket itself (e.g. 1009 for oversize frames)
    // and always emits 'close' afterwards, where cleanup happens.
    ws.on('error', () => undefined);
  });

  function startLoop(): void {
    let last = performance.now();
    let acc = 0;
    loop = setInterval(() => {
      const now = performance.now();
      acc += Math.min(now - last, 250); // never try to catch up more than 250 ms
      last = now;
      let steps = 0;
      while (acc >= DT_MS && steps < 5) {
        const t0 = performance.now();
        lobby.tickAll();
        tickTimes.push(performance.now() - t0);
        if (tickTimes.length > 600) tickTimes.shift();
        acc -= DT_MS;
        steps++;
      }
      if (steps === 5) acc = 0;
    }, 4);
  }

  return {
    server,
    wss,
    lobby,
    stats,
    listen: (port, host) =>
      new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          startLoop();
          resolve((server.address() as AddressInfo).port);
        });
      }),
    close: async () => {
      if (loop) clearInterval(loop);
      loop = null;
      for (const client of wss.clients) client.terminate();
      lobby.dispose();
      wss.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
