import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cli, cliEnv } from './cli-runner.js';

let root: string;
let home: string;
let userHome: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'output-shaping-'));
  home = path.join(root, 'hub');
  userHome = path.join(root, 'user-home');
  mkdirSync(userHome, { recursive: true });
  const source = path.join(root, 'source');
  mkdirSync(path.join(source, 'skills', 'alpha'), { recursive: true });
  writeFileSync(path.join(source, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ntitle: Alpha\ndescription: a very long description that would dominate token usage in a conversation\n---\n# Alpha\n');
  run(['add', source, '--skill', 'alpha', '--yes']);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(args: string[]) {
  return spawnSync(process.execPath, [cli, '--home', home, ...args], { encoding: 'utf8', env: cliEnv(userHome) });
}

function json(result: { stdout: string }) {
  const text = result.stdout.trim();
  return JSON.parse(text.startsWith('[') ? text : text.slice(text.indexOf('{')));
}

describe('list --brief (manager-skill-first ticket 04)', () => {
  it('emits compact rows without descriptions, consumers, or source detail', () => {
    const result = run(['list', '--brief']);

    expect(result.status, result.stderr).toBe(0);
    const rows = json(result);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(['category', 'name', 'title', 'updatable']);
    expect(rows[0]).toMatchObject({ name: 'alpha', title: 'Alpha' });
    expect(JSON.stringify(rows)).not.toContain('very long description');
  });

  it('marks source-backed skills updatable', () => {
    const result = run(['list', '--brief']);

    const rows = json(result);
    expect(rows[0].updatable).toBe(true);
  });
});

describe('catalog info detected detail (manager-skill-first ticket 04)', () => {
  it('pairs each detected agent id with its runtime dir instead of a bare name list', () => {
    mkdirSync(path.join(userHome, '.claude'), { recursive: true });
    const result = run(['catalog', 'info']);

    expect(result.status, result.stderr).toBe(0);
    const info = json(result);
    expect(Array.isArray(info.detected)).toBe(true);
    const claude = info.detected.find((agent: { id: string }) => agent.id === 'claude-code');
    expect(claude).toBeDefined();
    expect(claude.runtimeDir).toBe(path.join(userHome, '.claude', 'skills'));
  });
});

describe('update --check (manager-skill-first ticket 03)', () => {
  it('reports a local-source skill as stale after its source changes, fresh otherwise', () => {
    // Local sources hash the source tree against the hub fingerprint — no
    // network, which is exactly why this walkthrough stays hermetic.
    const source = path.join(root, 'source2');
    mkdirSync(path.join(source, 'skills', 'watched'), { recursive: true });
    writeFileSync(path.join(source, 'skills', 'watched', 'SKILL.md'), '---\nname: watched\ndescription: v1\n---\n# v1\n');
    run(['add', source, '--skill', 'watched', '--yes']);

    const fresh = json(run(['update', '--check']));
    expect(fresh.checked).toBeGreaterThan(0);
    expect(fresh.stale.map((row: { skill: string }) => row.skill)).not.toContain('watched');
    expect(fresh.upToDate).toContain('watched');

    writeFileSync(path.join(source, 'skills', 'watched', 'SKILL.md'), '---\nname: watched\ndescription: v2\n---\n# v2\n');
    const stale = json(run(['update', '--check']));
    expect(stale.stale.map((row: { skill: string }) => row.skill)).toContain('watched');
  });

  it('gives each failed row a pointer to the detection log', () => {
    // A local source whose directory vanished fails detection and must point
    // the conversation at the log instead of failing silently.
    const source = path.join(root, 'source3');
    mkdirSync(path.join(source, 'skills', 'ghost'), { recursive: true });
    writeFileSync(path.join(source, 'skills', 'ghost', 'SKILL.md'), '---\nname: ghost\n---\n# g\n');
    run(['add', source, '--skill', 'ghost', '--yes']);
    rmSync(source, { recursive: true, force: true });

    const result = json(run(['update', '--check']));
    const ghost = result.failed.find((row: { skill: string }) => row.skill === 'ghost');
    expect(ghost).toBeDefined();
    expect(ghost.log).toContain('dashboard.log');
  });
});
