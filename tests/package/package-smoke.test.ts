import { execSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Verifies the shipped artifact end-to-end: pack → install tarball → bin → dashboard HTTP.
 *  Replaces scripts/smoke-package.mjs. The tsc side of dist comes from global-setup;
 *  only the web assets are built here — a full `pnpm run build` would clean dist and
 *  race the parallel cli-bin test that spawns dist/cli.js. */

type PackEntry = { filename: string; files: Array<{ path: string }> };

let temp: string;
let dashboard: ReturnType<typeof spawn> | null = null;

beforeAll(() => {
  execSync('pnpm run build:web', { stdio: 'inherit' });
  temp = mkdtempSync(path.join(tmpdir(), 'skills-package-'));
});

afterAll(() => {
  dashboard?.kill('SIGTERM');
  rmSync(temp, { recursive: true, force: true });
});

/** npm prints a JSON array; pnpm prints a single object — normalize both. */
function packEntry(stdout: string): PackEntry {
  const parsed = JSON.parse(stdout) as PackEntry | PackEntry[];
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

async function waitForDashboard(cli: string, args: string[], url: string) {
  const child = spawn(cli, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout?.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr?.on('data', (chunk) => { output += chunk.toString(); });
  const deadline = Date.now() + 6000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return { child, body: await res.json() };
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  child.kill('SIGTERM');
  throw new Error(`Dashboard did not respond: ${lastError instanceof Error ? lastError.message : output}`);
}

describe('package artifact (pack → install → bin → dashboard)', () => {
  it('declares the expected package name and bin', () => {
    const pkg = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')) as { name: string; bin?: Record<string, string> };
    expect(pkg.name).toBe('agent-skills-manager');
    expect(pkg.bin?.['skills-manager']).toBe('./dist/cli.js');
  });

  it('packs the CLI build and dashboard assets', () => {
    const pack = spawnSync('pnpm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' });
    expect(pack.status, pack.stderr || pack.stdout).toBe(0);
    const files = packEntry(pack.stdout).files.map((f) => f.path);
    expect(files.some((f) => f.startsWith('dist/dashboard-web/')), 'dashboard assets missing from pack dry run').toBe(true);
    expect(files).toContain('dist/cli.js');
  }, 60_000);

  it('installs the tarball, boots the bin doctor, and serves the dashboard API', async () => {
    const tar = spawnSync('pnpm', ['pack', '--json'], { encoding: 'utf8' });
    expect(tar.status, tar.stderr || tar.stdout).toBe(0);
    const filename = packEntry(tar.stdout).filename;
    const install = spawnSync('pnpm', ['add', path.resolve(filename), '-C', temp], { encoding: 'utf8' });
    expect(install.status, install.stderr || install.stdout).toBe(0);

    const cli = path.join(temp, 'node_modules', '.bin', 'skills-manager');
    const home = path.join(temp, 'home');
    const run = spawnSync(cli, ['--home', home, 'doctor'], { encoding: 'utf8' });
    expect(run.status, run.stderr || run.stdout).toBe(0);
    expect(JSON.parse(run.stdout).skillHome).toBe(home);

    const port = 4899;
    const started = await waitForDashboard(cli, ['--home', path.join(temp, 'dashboard-home'), 'web', '--no-open', '--port', String(port)], `http://127.0.0.1:${port}/api/state`);
    dashboard = started.child;
    expect(started.body.ok).toBe(true);
    expect(Array.isArray(started.body.data.skills)).toBe(true);
    expect(Array.isArray(started.body.data.activity)).toBe(true);
    expect(typeof started.body.data.updateCount).toBe('number');
    expect(Array.isArray(started.body.data.knownProjects)).toBe(true);
    expect(existsSync(cli)).toBe(true);
  }, 120_000);
});
