import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './cli-runner.js';

let root: string;
let home: string;
let userHome: string;

/** A hub with foo(前端), bar(金融), baz(uncategorized), plus the manager skill. */
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'preset-lifecycle-'));
  home = path.join(root, 'hub');
  userHome = path.join(root, 'user-home');
  const source = path.join(root, 'source');
  const descriptions: Record<string, string> = {
    foo: 'a frontend skill for building and refactoring user interfaces',
    bar: 'a finance skill for portfolio accounting and reporting',
    baz: 'an uncategorized helper with no domain tag',
    'skills-manager': 'the hub manager skill itself',
  };
  for (const name of Object.keys(descriptions)) {
    mkdirSync(path.join(source, 'skills', name), { recursive: true });
    writeFileSync(path.join(source, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ntitle: ${name}\ndescription: ${descriptions[name]}\n---\n# ${name}\n`);
  }
  run(['add', source, '--skill', 'foo', '--yes']);
  run(['add', source, '--skill', 'bar', '--yes']);
  run(['add', source, '--skill', 'baz', '--yes']);
  run(['add', source, '--skill', 'skills-manager', '--yes']);
  run(['categories', 'set', 'foo', '前端']);
  run(['categories', 'set', 'bar', '金融']);
  run(['preset', 'set', 'dev', '前端']);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(args: string[]) {
  return runCli(home, userHome, args);
}

function runtimeDir(agentDir = '.agents/skills') {
  return path.join(userHome, ...agentDir.split('/'));
}

function runtimeNames(agentDir = '.agents/skills') {
  return readdirSync(runtimeDir(agentDir)).sort();
}

function registryText() {
  return readFileSync(path.join(home, 'registry.yaml'), 'utf8');
}

function indexRecords(): Array<{ id: string; entries: Array<{ skill: string; runtimePath: string; agents: string[] }>; categorySets?: Record<string, unknown> }> {
  return indexText()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function indexText() {
  return readFileSync(path.join(home, '.skills', 'distributions.jsonl'), 'utf8');
}

function userRecord() {
  return indexRecords().find((item) => item.id.startsWith('user:'));
}

function activity(): Array<{ action: string; summary: string; details?: Record<string, unknown> }> {
  return readFileSync(path.join(home, '.skills', 'activity.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Stamp the zed runtime path with the dev preset, the common starting state. */
function stampDev() {
  run(['distribute', '--to', 'user', '--skill', 'foo', '--skill', 'bar', '--agent', 'zed']);
  const result = run(['preset', 'apply', 'dev', '--agent', 'zed']);
  expect(result.status).toBe(0);
}

describe('preset stamp lifecycle', () => {
  it('categories apply --all dissolves the preset stamp along with the filter (the { all: true } variant carries no preset field)', () => {
    stampDev();
    expect(userRecord()?.categorySets?.[runtimeDir()]).toEqual({ categories: ['前端'], preset: 'dev' });
    const result = run(['categories', 'apply', '--all', '--agent', 'zed']);
    expect(result.status).toBe(0);
    expect(userRecord()?.categorySets?.[runtimeDir()]).toEqual({ all: true });
    // The full managed pool returns (the manager skill is exempt — never distributed, only retained).
    expect(runtimeNames()).toEqual(['bar', 'baz', 'foo']);
  });

  it('a bare categories apply keeps its ADR-0015 behavior on never-stamped paths: record has no preset field', () => {
    run(['distribute', '--to', 'user', '--skill', 'foo', '--skill', 'bar', '--agent', 'zed']);
    const result = run(['categories', 'apply', '前端', '--agent', 'zed']);
    expect(result.status).toBe(0);
    // The pre-preset output shape: the plain JSON outcome, no "preset" key anywhere
    // (matched as a JSON key — the tmpdir prefix itself contains "preset").
    const outcome = JSON.parse(result.stdout);
    expect(outcome.categories).toEqual(['前端']);
    expect(JSON.stringify(outcome)).not.toMatch(/"preset"/);
    expect(userRecord()?.categorySets?.[runtimeDir()]).toEqual({ categories: ['前端'] });
  });

  it('user-target rollback restores the runtime content and the preset-stamped record together', () => {
    stampDev();
    // A bare apply rewrites the record without the stamp and takes a snapshot of the stamped state.
    run(['categories', 'apply', '前端', '--agent', 'zed']);
    expect(userRecord()?.categorySets?.[runtimeDir()]).toEqual({ categories: ['前端'] });

    const result = run(['distribute', 'rollback', '--to', 'user']);
    expect(result.status).toBe(0);
    // The pre-bare-apply truth comes back: the runtime serving dev, and the record stamped dev.
    expect(runtimeNames()).toEqual(['foo']);
    expect(userRecord()?.categorySets?.[runtimeDir()]).toEqual({ categories: ['前端'], preset: 'dev' });
  });

  it('rolling back a preset apply restores the pre-preset state: full runtime, no stamp, no applied set', () => {
    run(['distribute', '--to', 'user', '--skill', 'foo', '--skill', 'bar', '--agent', 'zed']);
    run(['preset', 'apply', 'dev', '--agent', 'zed']);
    const result = run(['distribute', 'rollback', '--to', 'user']);
    expect(result.status).toBe(0);
    expect(runtimeNames()).toEqual(['bar', 'foo']);
    expect(userRecord()?.categorySets).toBeUndefined();
  });
});

describe('preset remove', () => {
  it('deletes the registry entry and cascade-clears the stamp on every referencing record (categories kept, runtime untouched), reporting the detached path count', () => {
    stampDev();
    run(['preset', 'set', 'other', '金融']);
    expect(registryText()).toMatch(/^ {2}dev:/m);

    const result = run(['preset', 'remove', 'dev']);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/detached the name from 1 runtime path/i);
    // Registry entry gone; sibling presets untouched.
    expect(registryText()).not.toMatch(/dev:/);
    expect(registryText()).toMatch(/other:/);
    // The stamp is cleared, the applied categories stay, the runtime is untouched.
    expect(userRecord()?.categorySets?.[runtimeDir()]).toEqual({ categories: ['前端'] });
    expect(runtimeNames()).toEqual(['foo']);
    // The removed preset no longer applies.
    const gone = run(['preset', 'apply', 'dev', '--agent', 'zed']);
    expect(gone.status).not.toBe(0);
  });

  it('detaches the name from every referencing path, not just the first', () => {
    stampDev();
    mkdirSync(path.join(userHome, '.claude'), { recursive: true });
    run(['preset', 'apply', 'dev', '--agent', 'claude-code']);
    const stamped = Object.values(userRecord()?.categorySets ?? {}).filter((set) => (set as { preset?: string }).preset === 'dev');
    expect(stamped).toHaveLength(2);

    const result = run(['preset', 'remove', 'dev']);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/detached the name from 2 runtime path/i);
    const remaining = Object.values(userRecord()?.categorySets ?? {}).filter((set) => 'preset' in (set as object));
    expect(remaining).toHaveLength(0);
  });

  it('reports zero detached paths when the preset was never applied anywhere', () => {
    const result = run(['preset', 'remove', 'dev']);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/detached the name from 0 runtime path/i);
  });

  it('refuses an unknown preset name and changes nothing', () => {
    stampDev();
    const before = indexText();
    const result = run(['preset', 'remove', 'nosuch']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/nosuch/);
    expect(result.stderr).toMatch(/no preset/i);
    expect(indexText()).toBe(before);
    expect(registryText()).toMatch(/dev:/);
  });

  it('records an activity log entry like the other preset commands', () => {
    stampDev();
    const result = run(['preset', 'remove', 'dev']);
    expect(result.status).toBe(0);
    const records = activity().filter((record) => record.action === 'cli-preset-remove');
    expect(records).toHaveLength(1);
    expect(records[0].summary).toContain('dev');
    expect(records[0].details?.detached).toBe(1);
  });
});
