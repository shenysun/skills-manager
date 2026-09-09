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
