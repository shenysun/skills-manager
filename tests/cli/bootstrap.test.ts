import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cli, cliEnv } from './cli-runner.js';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

let root: string;
let home: string;
let userHome: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'bootstrap-cli-'));
  home = path.join(root, 'hub');
  userHome = path.join(root, 'user-home');
  mkdirSync(userHome, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(args: string[]) {
  return spawnSync(process.execPath, [cli, '--home', home, ...args], { encoding: 'utf8', env: cliEnv(userHome) });
}

/** No --home: exercises the default-hub path under a hermetic HOME. */
function runDefault(args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: cliEnv(userHome) });
}

describe('bootstrap (ADR-0014)', () => {
  it('seeds the manager skill from the bundled copy and mounts nothing when no agent is detected', () => {
    const result = run(['bootstrap']);

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path.join(home, 'skills', 'skills-manager', 'SKILL.md'))).toBe(true);
    // Seeded from the bundle the package actually ships, stamped as a git source.
    expect(readlinkOrFalse(path.join(userHome, '.claude', 'skills', 'skills-manager'))).toBe(false);
    expect(result.stdout).toMatch(/mounted nowhere yet/);
    expect(result.stdout).toMatch(/帮我看看我的 skills/);
  });

  it('mounts to detected agents as a managed symlink', () => {
    mkdirSync(path.join(userHome, '.claude'), { recursive: true }); // installProbe: path-exists on $claudeHome
    const result = run(['bootstrap']);

    expect(result.status, result.stderr).toBe(0);
    const mounted = path.join(userHome, '.claude', 'skills', 'skills-manager');
    expect(lstatSync(mounted).isSymbolicLink()).toBe(true);
    expect(readlinkSync(mounted)).toBe(path.join(home, 'skills', 'skills-manager'));
    expect(result.stdout).toMatch(/mounted to: /);
  });

  it('reports existing runtime skills instead of importing them', () => {
    mkdirSync(path.join(userHome, '.claude'), { recursive: true });
    const existing = path.join(userHome, '.claude', 'skills', 'hand-made');
    mkdirSync(existing, { recursive: true });
    writeFileSync(path.join(existing, 'SKILL.md'), `---\nname: hand-made\ntitle: Hand made\ndescription: x\n---\n`);
    const result = run(['bootstrap']);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/found 1 existing skill/);
    // Bootstrap imports nothing: the hand-made skill is still a real directory.
    expect(lstatSync(existing).isSymbolicLink()).toBe(false);
  });

  it('is idempotent on re-run', () => {
    mkdirSync(path.join(userHome, '.claude'), { recursive: true });
    run(['bootstrap']);
    const second = run(['bootstrap']);

    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toMatch(/already current/);
  });

  it('runs as the no-arg default and creates the default hub', () => {
    const result = runDefault([]);

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path.join(userHome, '.skills-manager', 'skills', 'skills-manager', 'SKILL.md'))).toBe(true);
    expect(result.stdout).toMatch(/帮我看看我的 skills/);
  });

  it('refuses to clobber an unmanaged runtime copy without --force', () => {
    mkdirSync(path.join(userHome, '.claude', 'skills', 'skills-manager'), { recursive: true });
    writeFileSync(path.join(userHome, '.claude', 'skills', 'skills-manager', 'SKILL.md'), '# foreign\n');
    const result = run(['bootstrap']);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--force/);
    const forced = run(['bootstrap', '--force']);
    expect(forced.status, forced.stderr).toBe(0);
    expect(lstatSync(path.join(userHome, '.claude', 'skills', 'skills-manager')).isSymbolicLink()).toBe(true);
  });
});

describe('single entry point (ADR-0014): only bootstrap creates the default hub', () => {
  it('other commands prompt to bootstrap instead of creating the hub', () => {
    const result = runDefault(['list']);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Run `npx skills-manager-cli` first/);
    expect(existsSync(path.join(userHome, '.skills-manager'))).toBe(false);
  });

  it('web prompts to bootstrap instead of creating the hub', () => {
    const result = runDefault(['web', '--no-open']);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Run `npx skills-manager-cli` first/);
    expect(existsSync(path.join(userHome, '.skills-manager'))).toBe(false);
  });

  it('an explicit --home is still operator intent and ensures the hub', () => {
    const result = run(['doctor']);

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path.join(home, 'registry.yaml'))).toBe(true);
  });
});

function readlinkOrFalse(target: string): string | false {
  try {
    return readlinkSync(target);
  } catch {
    return false;
  }
}
