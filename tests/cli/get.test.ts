import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './cli-runner.js';
import { skillMarkdown } from '../fixtures/archives.js';

/**
 * CLI surface for the reference layer (spec provenance-get, US 组 B): `get
 * <name>` streams the hub's SKILL.md verbatim to stdout — raw output under the
 * `status` human-readable precedent, never JSON `print` — and `--path` lends
 * the canonical directory for read-only borrowing. Name misses get an
 * edit-distance suggestion; archived skills stay readable (archive exits the
 * management plane, not readability). No distribution state is required.
 */

let root: string;
let home: string;
let userHome: string;
let localSource: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'get-cli-'));
  home = path.join(root, 'hub');
  userHome = path.join(root, 'user-home');
  localSource = path.join(root, 'local-repo');
  for (const name of ['alpha', 'beta']) {
    mkdirSync(path.join(localSource, 'skills', name), { recursive: true });
    writeFileSync(path.join(localSource, 'skills', name, 'SKILL.md'), skillMarkdown(name, `${name} reference-layer fixture`));
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(args: string[]) {
  return runCli(home, userHome, args);
}

describe('get <skill>', () => {
  it('prints the hub SKILL.md verbatim, hub-only — no distribution ever happened (US18/US25)', () => {
    run(['add', localSource, '--skill', 'alpha']);
    const result = run(['get', 'alpha']);
    expect(result.status, result.stderr).toBe(0);
    const hubFile = readFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), 'utf8');
    expect(result.stdout).toBe(hubFile);
    expect(result.stdout).toMatch(/^---\n/);
  });

  it('shows the provenance mirror riding the frontmatter (US20)', () => {
    run(['add', localSource, '--skill', 'alpha']);
    run(['edit', 'alpha', '--source-url', 'https://github.com/example/upstream', '--subpath', 'skills/alpha']);
    const result = run(['get', 'alpha']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/github-repo: https:\/\/github\.com\/example\/upstream/);
  });
});

describe('get <skill> --path', () => {
  it('prints the canonical absolute dir plus a one-line read-only warning (US19)', () => {
    run(['add', localSource, '--skill', 'alpha']);
    const result = run(['get', 'alpha', '--path']);
    expect(result.status, result.stderr).toBe(0);
    const lines = result.stdout.trimEnd().split('\n');
    expect(lines[0]).toBe(path.join(home, 'skills', 'alpha'));
    expect(lines[1]).toMatch(/read-only/i);
  });
});

describe('name misses', () => {
  it('errors with exit 1 and suggests near names (US21)', () => {
    run(['add', localSource, '--skill', 'alpha']);
    const result = run(['get', 'alpa']);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Skill not found: alpa/);
    expect(result.stderr).toMatch(/alpha/);
  });

  it('stays clear when nothing is close', () => {
    run(['add', localSource, '--skill', 'alpha']);
    const result = run(['get', 'unrelated-name']);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Skill not found/);
    expect(result.stderr).not.toMatch(/Did you mean/);
  });
});

describe('archived skills stay readable (US22)', () => {
  it('prints the archived file verbatim with the notice on stderr — stdout stays the file', () => {
    run(['add', localSource, '--skill', 'alpha']);
    const before = readFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), 'utf8');
    expect(run(['archive', 'alpha']).status).toBe(0);
    const result = run(['get', 'alpha']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(before);
    expect(result.stderr).toMatch(/archived/);
  });

  it('--path points at the archive location and says so in the human-readable output', () => {
    run(['add', localSource, '--skill', 'alpha']);
    run(['archive', 'alpha']);
    const result = run(['get', 'alpha', '--path']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.split('\n')[0]).toMatch(/\.skills[/\\]archive[/\\]/);
    expect(result.stdout).toMatch(/archived/);
  });
});
