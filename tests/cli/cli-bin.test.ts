import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Verifies the compiled bin entry (dist/cli.js) — the layer only a real subprocess exercises. */

const cli = path.resolve('dist/cli.js');
let temp: string;

beforeAll(() => {
  temp = mkdtempSync(path.join(tmpdir(), 'skills-cli-bin-'));
});

afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
});

function runCli(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  expect(result.status, result.stderr || result.stdout).toBe(0);
  return result.stdout;
}

describe('compiled CLI bin (dist/cli.js)', () => {
  it('resolves an explicit --home and initializes the hub layout without views/', () => {
    const home = path.join(temp, 'home');
    const stdout = runCli(['--home', home, 'doctor']);
    expect(JSON.parse(stdout).skillHome).toBe(home);
    for (const file of ['skills', 'collections', 'registry.yaml']) {
      expect(existsSync(path.join(home, file)), `${file} was not initialized`).toBe(true);
    }
    expect(existsSync(path.join(home, 'views')), 'views/ should not be required or created').toBe(false);
  }, 15_000);

  it('resolves SKILL_HOME from the environment', () => {
    const envHome = path.join(temp, 'env-home');
    const stdout = runCli(['doctor'], { SKILL_HOME: envHome });
    expect(JSON.parse(stdout).skillHome).toBe(envHome);
  }, 15_000);

  it('exposes doctor --migrate-views and distributes help without errors', () => {
    expect(spawnSync(process.execPath, [cli, 'doctor', '--help'], { encoding: 'utf8' }).stdout).toMatch(/migrate-views/);
    const rollbackHelp = spawnSync(process.execPath, [cli, 'distribute', 'rollback', '--help'], { encoding: 'utf8' });
    expect(rollbackHelp.status, rollbackHelp.stderr || rollbackHelp.stdout).toBe(0);
    expect(rollbackHelp.stdout).toMatch(/Restore the last distribute snapshot/);
  }, 15_000);

  it('runs doctor --migrate-views against an explicit home', () => {
    const home = path.join(temp, 'home');
    const stdout = runCli(['--home', home, 'doctor', '--migrate-views']);
    expect(JSON.parse(stdout).doctor.skillHome).toBe(home);
  }, 15_000);
});
