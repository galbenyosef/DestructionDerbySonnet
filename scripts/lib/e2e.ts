// Helpers shared by the end-to-end scripts (smoke check, load test): a minimal protocol client and the packaged-bundle copy.
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { WebSocket, type RawData } from 'ws';
import { NET } from '../../src/shared/constants';
import { parseServerMessage, type HelloMessage, type ServerMessage, type WelcomeMessage } from '../../src/shared/protocol';

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const toBytes = (data: RawData): Uint8Array => {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
};

export const parseText = (data: RawData): ServerMessage | null => parseServerMessage(new TextDecoder().decode(toBytes(data)));

/** Opens a socket, says hello and resolves with the socket and the server's welcome. Rejects on an error message, an early close or a timeout. */
export function joinRoom(url: string, hello: Pick<HelloMessage, 'mode'> & Partial<HelloMessage>, timeoutMs = 10_000): Promise<{ ws: WebSocket; welcome: WelcomeMessage }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const fail = (why: string): void => {
      clearTimeout(timer);
      ws.terminate();
      reject(new Error(why));
    };
    const timer = setTimeout(() => fail(`no welcome from ${url} within ${timeoutMs} ms`), timeoutMs);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: NET.PROTOCOL_VERSION, name: 'e2e', color: 0x2b7fd8, ...hello })));
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const msg = parseText(data);
      if (msg?.t === 'welcome') {
        clearTimeout(timer);
        ws.removeAllListeners('message');
        resolve({ ws, welcome: msg });
      } else if (msg?.t === 'error') {
        fail(`${msg.code}: ${msg.message}`);
      }
    });
    ws.on('close', () => fail('closed before the welcome'));
    ws.on('error', (err) => fail(err.message));
  });
}

/** Creates a private room, leaves it again and returns its code. */
export async function createRoom(url: string): Promise<string> {
  const { ws, welcome } = await joinRoom(url, { mode: 'create' });
  ws.close();
  return welcome.room.code;
}

/**
 * Copies the built game (`dist/server` and `dist/client`) into `into` and nothing else, the way the container image holds it:
 * no `node_modules`, no sources. Running `node dist/server/index.js` from `into` shows whether the bundle stands on its own.
 */
export function copyBundle(distDir: string, into: string): void {
  for (const part of ['server', 'client']) {
    mkdirSync(path.join(into, 'dist'), { recursive: true });
    cpSync(path.join(distDir, part), path.join(into, 'dist', part), { recursive: true });
  }
}
