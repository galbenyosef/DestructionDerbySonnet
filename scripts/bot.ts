// Headless bot for manual multiplayer testing (no browser needed).
//   npx tsx scripts/bot.ts [--url ws://localhost:8080/ws] [--mode quick|create|join] [--code ABCD] [--name Bot] [--seconds 120]
import { WebSocket, type RawData } from 'ws';
import { NET } from '../src/shared/constants';
import { decodeSnapshot, encodeInput, parseServerMessage, type JoinMode } from '../src/shared/protocol';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  return value ?? fallback;
}

const url = arg('url', 'ws://localhost:8080/ws');
const mode = arg('mode', 'quick') as JoinMode;
const code = arg('code', '');
const name = arg('name', 'Bot');
const seconds = Number(arg('seconds', '120'));

const toBytes = (d: RawData): Uint8Array =>
  Array.isArray(d)
    ? new Uint8Array(Buffer.concat(d))
    : d instanceof ArrayBuffer
      ? new Uint8Array(d)
      : new Uint8Array(d.buffer, d.byteOffset, d.byteLength);

const ws = new WebSocket(url);
let seq = 0;
let mySlot = -1;
let epoch = -1;
let lastPos = { x: 0, z: 0 };
let lastCheck = Date.now();
let reverseUntil = 0;
const startedAt = Date.now();

/** If the car has barely moved for 1.5 s (stuck on a wall), back out for 1.5 s. */
function trackProgress(pos: { x: number; z: number }): void {
  const now = Date.now();
  if (now - lastCheck < 1500) return;
  if (Math.hypot(pos.x - lastPos.x, pos.z - lastPos.z) < 1.5 && now > reverseUntil) reverseUntil = now + 1500;
  lastPos = { x: pos.x, z: pos.z };
  lastCheck = now;
}

ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'hello', v: NET.PROTOCOL_VERSION, name, color: 0x18b5b5, mode, code: code || undefined }));
});

ws.on('message', (data: RawData, isBinary: boolean) => {
  if (isBinary) {
    const s = decodeSnapshot(toBytes(data));
    if (s && s.epoch === epoch) {
      const me = s.cars.find((c) => c.slot === mySlot);
      if (me) trackProgress(me.state.pos);
    }
    return;
  }
  const msg = parseServerMessage(new TextDecoder().decode(toBytes(data)));
  if (!msg) return;
  if (msg.t === 'welcome') {
    mySlot = msg.you;
    epoch = msg.epoch;
    console.log(`joined ${msg.room.public ? 'public' : 'private'} room ${msg.room.code} as slot ${mySlot}`);
  } else if (msg.t === 'roster') {
    epoch = msg.epoch;
    console.log(`roster (epoch ${msg.epoch}): ${msg.players.map((p) => p.name).join(', ')}`);
  } else if (msg.t === 'error') {
    console.log(`server error: ${msg.message}`);
  }
});

setInterval(() => {
  if (mySlot < 0 || ws.readyState !== WebSocket.OPEN) return;
  const elapsed = (Date.now() - startedAt) / 1000;
  let throttle = 0.8;
  let steer = Math.sin(elapsed * 0.6) * 0.8;
  if (Date.now() < reverseUntil) {
    throttle = -1;
    steer = -steer;
  }
  seq = (seq + 1) >>> 0;
  ws.send(encodeInput(seq, { throttle, steer, handbrake: false }));
}, 16);

ws.on('close', () => process.exit(0));
ws.on('error', (err) => {
  console.error(`connection error: ${err.message}`);
  process.exit(1);
});
setTimeout(() => {
  ws.close();
  process.exit(0);
}, seconds * 1000);
