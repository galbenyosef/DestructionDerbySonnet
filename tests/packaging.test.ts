import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The container image cannot be built in every environment, so these tests read the Dockerfile and hold it to what the game needs.
const dockerfile = readFileSync('Dockerfile', 'utf8');
const ignore = readFileSync('.dockerignore', 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string>; engines: { node: string } };

/** The instructions of each stage, with line continuations joined. */
function stages(): Array<{ name: string; from: string; lines: string[] }> {
  const joined = dockerfile.replace(/\\\n\s*/g, ' ').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const out: Array<{ name: string; from: string; lines: string[] }> = [];
  for (const line of joined) {
    const from = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
    if (from) out.push({ name: from[2] ?? '', from: from[1]!, lines: [] });
    else out.at(-1)?.lines.push(line);
  }
  return out;
}

/** True when `.dockerignore` would keep `file` out of the build context (patterns: names, directories and `*` globs). */
function ignored(file: string): boolean {
  return ignore.some((pattern) => {
    const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}(/.*)?$`);
    return re.test(file);
  });
}

const copies = (lines: string[]): Array<{ from: string | null; sources: string[]; dest: string }> =>
  lines
    .filter((l) => /^COPY\s/i.test(l))
    .map((l) => {
      const parts = l.split(/\s+/).slice(1);
      const flag = parts[0]!.startsWith('--from=') ? parts.shift()!.slice('--from='.length) : null;
      return { from: flag, sources: parts.slice(0, -1), dest: parts.at(-1)! };
    });

describe('Dockerfile', () => {
  const [build, run] = stages();

  it('has a build stage and a run stage on the Node version the package supports', () => {
    expect(stages()).toHaveLength(2);
    expect(build!.name).toBe('build');
    expect(build!.from).toBe('node:24-slim');
    expect(run!.from).toBe('node:24-slim');
    expect(pkg.engines.node).toMatch(/22/); // 24 satisfies ">=22.12"
  });

  it('copies into the build only files that exist and that .dockerignore lets through', () => {
    const sources = copies(build!.lines).flatMap((c) => c.sources);
    expect(sources.length).toBeGreaterThan(5);
    for (const source of sources) {
      const file = source.replace(/\/$/, '');
      expect(existsSync(file), `${source} exists`).toBe(true);
      expect(ignored(file), `${source} is not ignored`).toBe(false);
    }
  });

  it('copies everything the build scripts read', () => {
    const sources = copies(build!.lines).flatMap((c) => c.sources);
    expect(pkg.scripts['build:client']).toBe('vite build');
    expect(pkg.scripts['build:server']).toBe('node scripts/build-server.mjs');
    for (const needed of ['package.json', 'package-lock.json', 'vite.config.ts', 'scripts/build-server.mjs', 'src']) expect(sources, needed).toContain(needed);
    expect(sources.filter((s) => s.startsWith('tsconfig')).length).toBeGreaterThanOrEqual(1);
  });

  it('installs dependencies from the lock file before the sources arrive, so a code change keeps that layer cached', () => {
    const lines = build!.lines;
    const install = lines.findIndex((l) => /^RUN\s+npm ci/i.test(l));
    const sourcesCopied = lines.findIndex((l) => /^COPY\s+src\b/i.test(l));
    expect(install).toBeGreaterThan(0);
    expect(sourcesCopied).toBeGreaterThan(install);
    expect(lines.some((l) => /^RUN\s+npm run build/i.test(l))).toBe(true);
  });

  it('runs the bundle alone: the run stage takes dist from the build and installs nothing', () => {
    const c = copies(run!.lines);
    expect(c).toEqual([{ from: 'build', sources: ['/app/dist'], dest: './dist' }]);
    expect(run!.lines.some((l) => /npm|node_modules/i.test(l.replace(/HEALTHCHECK.*/i, '')))).toBe(false);
    expect(run!.lines).toContain('CMD ["node", "dist/server/index.js"]');
  });

  it('runs as the unprivileged node user, listens on 8080 and checks /healthz', () => {
    expect(run!.lines).toContain('USER node');
    expect(run!.lines).toContain('EXPOSE 8080');
    expect(run!.lines.some((l) => /^ENV .*PORT=8080/.test(l))).toBe(true);
    expect(run!.lines.some((l) => /^HEALTHCHECK\b.*\/healthz/.test(l))).toBe(true);
  });
});

describe('.dockerignore', () => {
  it('keeps out dependencies, build output, history, secrets and the working notes', () => {
    for (const file of ['node_modules', 'dist', '.git', '.superpowers', '.playwright-mcp', '.env', '.env.local', 'debug.log', 'docs/x.md', 'tests/a.test.ts']) {
      expect(ignored(file), file).toBe(true);
    }
  });

  it('lets through everything the image build reads', () => {
    for (const file of ['package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.base.json', 'scripts/build-server.mjs', 'src/client/index.html', 'src/server/index.ts']) {
      expect(ignored(file), file).toBe(false);
    }
  });
});
