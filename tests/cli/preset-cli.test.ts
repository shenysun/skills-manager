import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './cli-runner.js';

let root: string;
let home: string;
let userHome: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'preset-cli-'));
  home = path.join(root, 'hub');
  userHome = path.join(root, 'user-home');
  const source = path.join(root, 'source');
  for (const name of ['foo', 'bar']) {
    mkdirSync(path.join(source, 'skills', name), { recursive: true });
    writeFileSync(path.join(source, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ntitle: ${name}\ndescription: cli\n---\n# ${name}\n`);
  }
  run(['add', source, '--skill', 'foo', '--yes']);
  run(['add', source, '--skill', 'bar', '--yes']);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(args: string[]) {
  return runCli(home, userHome, args);
}

function registry(): { skills: Record<string, unknown>; presets?: Record<string, { categories: string[] }> } {
  return YAML.parse(readFileSync(path.join(home, 'registry.yaml'), 'utf8'));
}

function activity(): Array<{ action: string; summary: string }> {
  return readFileSync(path.join(home, '.skills', 'activity.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('preset set / list CLI surface', () => {
  it('preset set stores an object-shaped presets map at the registry top level', () => {
    const result = run(['preset', 'set', 'frontend', '前端', '后端']);
    expect(result.status).toBe(0);
    expect(registry().presets).toEqual({ frontend: { categories: ['前端', '后端'] } });
    // Skills entries stay beside it, same file, untouched.
    expect(Object.keys(registry().skills)).toContain('foo');
    const entry = JSON.parse(result.stdout);
    expect(entry).toEqual({ categories: ['前端', '后端'] });
  });

  it('preset set replaces the whole member list when the name exists', () => {
    run(['preset', 'set', 'frontend', '前端', '后端']);
    run(['preset', 'set', 'frontend', '金融']);
    expect(registry().presets?.frontend.categories).toEqual(['金融']);
    // A second preset lands beside the first, not over it.
    run(['preset', 'set', 'backend', '后端']);
    expect(Object.keys(registry().presets || {}).sort()).toEqual(['backend', 'frontend']);
  });

  it('normalizes member categories: trim, dedupe, drop empties', () => {
    const result = run(['preset', 'set', 'mixed', ' 前端 ', '', '前端', 'weird/tag ok?']);
    expect(result.status).toBe(0);
    expect(registry().presets?.mixed.categories).toEqual(['weird/tag ok?', '前端']);
  });

  it('storage is unvalidated against the vocabulary: unknown categories store fine (US16)', () => {
    const result = run(['preset', 'set', 'early', 'not-tagged-yet']);
    expect(result.status).toBe(0);
    expect(registry().presets?.early.categories).toEqual(['not-tagged-yet']);
  });

  it('rejects unsafe preset names with a readable error', () => {
    for (const name of ['has space', 'a/b', 'a\\b', 'tab\there', '']) {
      const result = run(['preset', 'set', name, '前端']);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/preset name/i);
    }
    // Nothing leaked into the registry from the rejected writes.
    expect(registry().presets).toBeUndefined();
  });

  it('preset set requires at least one category', () => {
    const result = run(['preset', 'set', 'frontend']);
    expect(result.status).not.toBe(0);
  });

  it('preset set records an activity log entry', () => {
    run(['preset', 'set', 'frontend', '前端']);
    const records = activity().filter((record) => record.action === 'cli-preset-set');
    expect(records).toHaveLength(1);
    expect(records[0].summary).toContain('frontend');
  });

  it('preset list shows each preset with its member categories; empty state says so', () => {
    const empty = run(['preset', 'list']);
    expect(empty.status).toBe(0);
    expect(empty.stdout).toMatch(/no presets yet/i);
    run(['preset', 'set', 'frontend', '前端', '后端']);
    run(['preset', 'set', 'backend', '后端']);
    const result = run(['preset', 'list']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('frontend: 前端, 后端');
    expect(result.stdout).toContain('backend: 后端');
  });

  it('other registry writes round-trip the presets map (no silent drop)', () => {
    run(['preset', 'set', 'frontend', '前端']);
    const result = run(['categories', 'set', 'foo', '金融']);
    expect(result.status).toBe(0);
    expect(registry().presets).toEqual({ frontend: { categories: ['前端'] } });
  });
});
