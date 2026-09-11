import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './cli-runner.js';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

let root: string;
let home: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'official-skill-'));
  home = path.join(root, 'hub');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(args: string[]) {
  return runCli(home, path.join(root, 'user-home'), args);
}

describe('official skills-manager agent skill', () => {
  it('is discoverable from this repo via source-first add --list', () => {
    const result = run(['add', repoRoot, '--list']);
    expect(result.status).toBe(0);
    const discovered = JSON.parse(result.stdout).discovered;
    const official = discovered.find((skill: { name: string }) => skill.name === 'skills-manager');
    expect(official).toBeDefined();
    expect(official.subpath).toBe('skills/skills-manager');
    expect(official.description).toMatch(/skills-manager/i);
  });

  it('passes metadata validation and installs into a hub', () => {
    const install = run(['add', repoRoot, '--skill', 'skills-manager']);
    expect(install.status).toBe(0);
    expect(JSON.parse(install.stdout).installed).toEqual(['skills-manager']);
    const listed = run(['list']);
    const entry = JSON.parse(listed.stdout).find((skill: { name: string }) => skill.name === 'skills-manager');
    expect(entry.source.type).toBe('local'); // installed from the local checkout
    expect(entry.source.subpath).toBe('skills/skills-manager');
  });

  it('delivers bundled docs covering the categories conversation surface, hub copy identical to the bundle', () => {
    // Seed-path delivery: the every-run refresh semantics (changed bundle → hub
    // copy replaced) are covered at the services seam in manager-skill.test.ts.
    const result = run(['bootstrap']);

    expect(result.status, result.stderr).toBe(0);
    const hubDoc = readFileSync(path.join(home, 'skills', 'skills-manager', 'SKILL.md'), 'utf8');
    const bundleDoc = readFileSync(path.join(repoRoot, 'skills', 'skills-manager', 'SKILL.md'), 'utf8');
    expect(hubDoc).toBe(bundleDoc);
    // The conversation surface stays in step with the CLI (skill-categories ticket 07).
    for (const phrase of [
      'categories set', 'categories add', 'categories remove', 'categories list',
      'categories apply', 'categories status', 'apply --all',
    ]) expect(hubDoc, `missing "${phrase}" in bundled SKILL.md`).toContain(phrase);
    // Strict semantics stated accurately: exemptions + reversibility + idempotence.
    expect(hubDoc).toMatch(/exempt/);
    expect(hubDoc).toMatch(/foreign/);
    expect(hubDoc).toMatch(/uncategorized/i);
    expect(hubDoc).toMatch(/idempotent/i);
  });
});
