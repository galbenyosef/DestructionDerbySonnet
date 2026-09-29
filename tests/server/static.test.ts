import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStaticHandler } from '../../src/server/static';

let tmp: string;
let server: http.Server;
let base: string;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wreckyard-static-'));
  const root = path.join(tmp, 'root');
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>hello</h1>');
  fs.writeFileSync(path.join(root, 'assets', 'app-abc.js'), 'console.log(1)');
  fs.writeFileSync(path.join(tmp, 'secret.txt'), 'top secret');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET_KEY=1');
  fs.writeFileSync(path.join(root, 'assets', '.hidden.js'), 'hidden');
  fs.mkdirSync(path.join(tmp, 'outside'));
  fs.writeFileSync(path.join(tmp, 'outside', 'leak.txt'), 'leaked');
  fs.symlinkSync(path.join(tmp, 'secret.txt'), path.join(root, 'link.txt'));
  fs.symlinkSync(path.join(tmp, 'outside'), path.join(root, 'outdir'));
  const handler = createStaticHandler(root);
  server = http.createServer((req, res) => {
    if (!handler(req, res)) {
      res.writeHead(404);
      res.end('fallthrough');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('static handler', () => {
  it('serves index.html at / without long-lived caching', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.text()).toBe('<h1>hello</h1>');
  });

  it('serves hashed assets with immutable caching and the right mime type', async () => {
    const res = await fetch(`${base}/assets/app-abc.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(await res.text()).toBe('console.log(1)');
  });

  it('falls through for missing files', async () => {
    const res = await fetch(`${base}/nope.txt`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('fallthrough');
  });

  it('never serves files outside the root', async () => {
    for (const p of ['/..%2fsecret.txt', '/%2e%2e/secret.txt', '/../secret.txt', '/assets/..%2f..%2fsecret.txt']) {
      const res = await fetch(base + p);
      expect(res.status).not.toBe(200);
      expect(await res.text()).not.toContain('top secret');
    }
  });

  it('never serves dotfiles', async () => {
    for (const p of ['/.env', '/assets/.hidden.js', '/.git/config']) {
      const res = await fetch(base + p);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('fallthrough');
    }
  });

  it('does not follow a symlink out of the root, to a file or to a directory', async () => {
    for (const p of ['/link.txt', '/outdir/leak.txt']) {
      const res = await fetch(base + p);
      const body = await res.text();
      expect(res.status).toBe(404);
      expect(body).not.toContain('secret');
      expect(body).not.toContain('leaked');
    }
  });

  it('decides the caching from the file the request resolves to, not from how the path is spelled', async () => {
    const res = await fetch(`${base}/assets/..%2findex.html`); // resolves to /index.html
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<h1>hello</h1>');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('rejects malformed percent-encoding', async () => {
    const res = await fetch(`${base}/%E0%A4%A`);
    expect(res.status).toBe(400);
  });

  it('answers HEAD without a body and ignores other methods', async () => {
    const head = await fetch(`${base}/`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    const post = await fetch(`${base}/`, { method: 'POST', body: 'x' });
    expect(post.status).toBe(404);
    expect(await post.text()).toBe('fallthrough');
  });
});
