import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
};

/**
 * Serves files from `rootDir`. Returns true when it answered the request, false to let the caller fall through
 * (missing file, or a method other than GET/HEAD).
 */
export function createStaticHandler(rootDir: string): (req: http.IncomingMessage, res: http.ServerResponse) => boolean {
  const root = path.resolve(rootDir);
  return (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('bad request');
      return true;
    }
    if (pathname.includes('\0')) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('bad request');
      return true;
    }
    const rel = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
    const file = path.resolve(root, `.${rel}`);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('forbidden');
      return true;
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      return false;
    }
    if (!stat.isFile()) return false;
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': String(stat.size),
      'x-content-type-options': 'nosniff',
      'cache-control': rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
    return true;
  };
}
