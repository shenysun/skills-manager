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
  root = mkdtempSync(path.join(tmpdir(), 'preset-apply-'));
  home = path.join(root, 'hub');
  userHome = path.join(root, 'user-home');
  const source = path.join(root, 'source');
  const descriptions: Record<string, string> = {
    // Long enough to push foo past 1000 char-approx tokens, so the cost tail line exercises the `k` abbreviation.
    foo: `a frontend skill for building and refactoring user interfaces ${'u'.repeat(4200)}`,
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

function activity(): Array<{ action: string; summary: string }> {
  return readFileSync(path.join(home, '.skills', 'activity.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('preset apply core semantics', () => {
  it('rewrites the runtime dir to the preset\'s category set and stamps the category-set record with the preset name', () => {
    run(['distribute', '--to', 'user', '--skill', 'bar', '--skill', 'baz', '--agent', 'zed']);
    const result = run(['preset', 'apply', 'dev', '--agent', 'zed']);
    expect(result.status).toBe(0);
    expect(runtimeNames()).toEqual(['foo']);
    expect(userRecord()?.categorySets?.[runtimeDir()]).toEqual({ categories: ['前端'], preset: 'dev' });
  });

  it('keeps the manager skill and foreign entries untouched, removes the uncategorized managed skill', () => {
    run(['distribute', '--to', 'user', '--skill', 'foo', '--skill', 'baz', '--skill', 'skills-manager', '--agent', 'zed']);
    mkdirSync(path.join(runtimeDir(), 'hand-placed'));
    const result = run(['preset', 'apply', 'dev', '--agent', 'zed']);
    expect(result.status).toBe(0);
    expect(runtimeNames()).toEqual(['foo', 'hand-placed', 'skills-manager']);
  });

  it('reference-counts shared paths: applying through one family member rewrites the whole shared path once', () => {
    run(['distribute', '--to', 'user', '--skill', 'foo', '--skill', 'bar', '--agent', 'zed', '--agent', 'warp']);
    const result = run(['preset', 'apply', 'dev', '--agent', 'zed']);
    expect(result.status).toBe(0);
    expect(runtimeNames()).toEqual(['foo']);
    const record = userRecord();
    expect(record?.entries.map((entry) => entry.skill)).toEqual(['foo']);
    expect(record?.entries[0]?.agents).toEqual(['warp', 'zed']);
    expect(record?.categorySets?.[runtimeDir()]).toEqual({ categories: ['前端'], preset: 'dev' });
  });

  it('defaults to the detected agent set like distribute', () => {
    mkdirSync(path.join(userHome, '.claude'), { recursive: true });
    run(['distribute', '--to', 'user', '--skill', 'foo', '--skill', 'bar', '--agent', 'claude-code']);
    const result = run(['preset', 'apply', 'dev', '--json']);
    expect(result.status).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary.agents).toContain('claude-code');
    expect(runtimeNames('.claude/skills')).toEqual(['foo']);
  });

  it('is idempotent: a rerun with the same arguments changes neither runtime nor records', () => {
    run(['distribute', '--to', 'user', '--skill', 'foo', '--skill', 'bar', '--agent', 'zed']);
    const first = run(['preset', 'apply', 'dev', '--agent', 'zed']);
    expect(first.status).toBe(0);
    const indexBefore = indexText();
    const backups = path.join(home, '.skills', 'distribute-backups');
    const snapshotsBefore = readdirSync(backups, { recursive: true }).filter((item) => String(item).includes('manifest.yaml')).length;

    const second = run(['preset', 'apply', 'dev', '--agent', 'zed']);
    expect(second.status).toBe(0);
    expect(runtimeNames()).toEqual(['foo']);
    expect(indexText()).toBe(indexBefore);
    const snapshotsAfter = readdirSync(backups, { recursive: true }).filter((item) => String(item).includes('manifest.yaml')).length;
    expect(snapshotsAfter).toBe(snapshotsBefore);
  });

  it('a bare categories apply over a preset-stamped path clears the stamp (categories kept, runtime unchanged)', () => {
    // US12 regression lock: stamp-equality in the kernel means a bare apply rewrites
    // the record without the preset field even when the category list matches.
    run(['distribute', '--to', 'user', '--skill', 'foo', '--agent', 'zed']);
    run(['preset', 'apply', 'dev', '--agent', 'zed']);
    expect(userRecord()?.categorySets?.[runtimeDir()]).toEqual({ categories: ['前端'], preset: 'dev' });
    const result = run(['categories', 'apply', '前端', '--agent', 'zed']);
    expect(result.status).toBe(0);
    expect(runtimeNames()).toEqual(['foo']);
    expect(userRecord()?.categorySets?.[runtimeDir()]).toEqual({ categories: ['前端'] });
  });

  it('records an activity log entry like the categories commands', () => {
    run(['distribute', '--to', 'user', '--skill', 'foo', '--agent', 'zed']);
    const result = run(['preset', 'apply', 'dev', '--agent', 'zed']);
    expect(result.status).toBe(0);
    const records = activity().filter((record) => record.action === 'cli-preset-apply');
    expect(records).toHaveLength(1);
    expect(records[0].summary).toContain('dev');
  });
});

describe('preset apply hard gates', () => {
  it('refuses when the preset resolves to zero managed skills, naming the preset and its categories', () => {
    // A category tagged only on the manager skill is in the vocabulary but resolves to nothing manageable.
    run(['categories', 'set', 'skills-manager', '独占']);
    run(['preset', 'set', 'solo', '独占']);
    run(['distribute', '--to', 'user', '--skill', 'foo', '--agent', 'zed']);
    const before = indexText();
    const result = run(['preset', 'apply', 'solo', '--agent', 'zed']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/solo/);
    expect(result.stderr).toMatch(/独占/);
    expect(result.stderr).toMatch(/0 managed skill/i);
    // Nothing was changed: runtime untouched, index byte-identical.
    expect(runtimeNames()).toEqual(['foo']);
    expect(indexText()).toBe(before);
  });

  it('refuses when a referenced category is absent from the hub vocabulary, naming the preset and the category', () => {
    run(['preset', 'set', 'ghost', '前端', '幽灵']);
    run(['distribute', '--to', 'user', '--skill', 'foo', '--agent', 'zed']);
    const before = indexText();
    const result = run(['preset', 'apply', 'ghost', '--agent', 'zed']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/ghost/);
    expect(result.stderr).toMatch(/幽灵/);
    expect(result.stderr).toMatch(/unknown categor/i);
    expect(indexText()).toBe(before);
  });

  it('refuses an unknown preset name outright', () => {
    run(['distribute', '--to', 'user', '--skill', 'foo', '--agent', 'zed']);
    const result = run(['preset', 'apply', 'nosuch', '--agent', 'zed']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/nosuch/);
    expect(result.stderr).toMatch(/no preset/i);
  });
});

describe('preset apply cost line and --json', () => {
  it('ends the success output with an ≈ char-approx resident-cost line', () => {
    run(['distribute', '--to', 'user', '--skill', 'foo', '--agent', 'zed']);
    const result = run(['preset', 'apply', 'dev', '--agent', 'zed']);
    expect(result.status).toBe(0);
    const lines = result.stdout.trimEnd().split('\n');
    // ≈ prefix plus the `k` abbreviation — foo's fixture description pushes past 1000 tokens.
    expect(lines.at(-1)).toMatch(/^Resident cost: ≈\d+(\.\d+)?k tokens per message \(char-approx\)$/);
    expect(lines[0]).toMatch(/Applied preset dev/);
  });

  it('--json carries the structured outcome: preset, categories, agents, paths, cost', () => {
    run(['distribute', '--to', 'user', '--skill', 'foo', '--skill', 'bar', '--agent', 'zed']);
    const result = run(['preset', 'apply', 'dev', '--agent', 'zed', '--json']);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.preset).toBe('dev');
    expect(parsed.categories).toEqual(['前端']);
    expect(parsed.agents).toEqual(['zed']);
    expect(parsed.paths).toHaveLength(1);
    expect(parsed.paths[0].runtimeDir).toBe(runtimeDir());
    expect(parsed.cost.method).toBe('char-approx');
    expect(parsed.cost.tokens).toBeGreaterThan(1000);
    expect(parsed.cost.paths[0]).toEqual({ runtimeDir: runtimeDir(), tokens: parsed.cost.tokens });
  });
});
