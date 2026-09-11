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
  root = mkdtempSync(path.join(tmpdir(), 'categories-apply-'));
  home = path.join(root, 'hub');
  userHome = path.join(root, 'user-home');
  const source = path.join(root, 'source');
  for (const name of ['foo', 'bar', 'baz', 'skills-manager']) {
    mkdirSync(path.join(source, 'skills', name), { recursive: true });
    writeFileSync(path.join(source, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ntitle: ${name}\ndescription: cli\n---\n# ${name}\n`);
  }
  run(['add', source, '--skill', 'foo', '--yes']);
  run(['add', source, '--skill', 'bar', '--yes']);
  run(['add', source, '--skill', 'baz', '--yes']);
  run(['add', source, '--skill', 'skills-manager', '--yes']);
  run(['categories', 'set', 'foo', '前端']);
  run(['categories', 'set', 'bar', '金融']);
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
  return readFileSync(path.join(home, '.skills', 'distributions.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('categories apply core semantics', () => {
  it('rewrites the runtime dir to exactly the category set: distributes missing, removes out-of-set and uncategorized', () => {
    run(['distribute', '--to', 'user', '--skill', 'bar', '--skill', 'baz', '--agent', 'zed']);
    const result = run(['categories', 'apply', '前端', '--agent', 'zed']);
    expect(result.status).toBe(0);
    // foo distributed (was missing), bar removed (out of set), baz never there.
    expect(runtimeNames()).toEqual(['foo']);
  });

  it('keeps the manager skill and foreign entries untouched, removes the uncategorized managed skill', () => {
    run(['distribute', '--to', 'user', '--skill', 'foo', '--skill', 'baz', '--skill', 'skills-manager', '--agent', 'zed']);
    mkdirSync(path.join(runtimeDir(), 'hand-placed'));
    const result = run(['categories', 'apply', '前端', '--agent', 'zed']);
    expect(result.status).toBe(0);
    // Manager exempt regardless of tagging; foreign survives; uncategorized baz removed.
    expect(runtimeNames()).toEqual(['foo', 'hand-placed', 'skills-manager']);
  });

  it('keeps the manager skill even when it is tagged outside the applied set', () => {
    run(['categories', 'set', 'skills-manager', '金融']);
    run(['distribute', '--to', 'user', '--skill', 'foo', '--skill', 'skills-manager', '--agent', 'zed']);
    const result = run(['categories', 'apply', '前端', '--agent', 'zed']);
    expect(result.status).toBe(0);
    expect(runtimeNames()).toEqual(['foo', 'skills-manager']);
  });

  it('reference-counts shared paths: a family path is rewritten even when an unselected member references out-of-set skills', () => {
    // zed and warp share ~/.agents/skills: one entry per skill with both agents.
    run(['distribute', '--to', 'user', '--skill', 'foo', '--skill', 'bar', '--agent', 'zed', '--agent', 'warp']);
    // Applying through zed alone still rewrites the whole shared path.
    const result = run(['categories', 'apply', '前端', '--agent', 'zed']);
    expect(result.status).toBe(0);
    expect(runtimeNames()).toEqual(['foo']);
    const record = indexRecords().find((item) => item.id.startsWith('user:'));
    expect(record?.entries.map((entry) => entry.skill)).toEqual(['foo']);
    // The kept entry still covers the whole family, not just the selector.
    expect(record?.entries[0]?.agents).toEqual(['warp', 'zed']);
  });

  it('fails fast on a foreign entry colliding with an in-set skill name, changing nothing', () => {
    run(['distribute', '--to', 'user', '--skill', 'bar', '--skill', 'baz', '--agent', 'zed']);
    mkdirSync(path.join(runtimeDir(), 'foo'), { recursive: true });
    const before = readFileSync(path.join(home, '.skills', 'distributions.jsonl'), 'utf8');
    const result = run(['categories', 'apply', '前端', '--agent', 'zed']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Refusing to overwrite unmanaged/i);
    // Nothing was written: runtime untouched, index byte-identical, no category-set record.
    expect(runtimeNames()).toEqual(['bar', 'baz', 'foo']);
    expect(readFileSync(path.join(home, '.skills', 'distributions.jsonl'), 'utf8')).toBe(before);
  });

  it('records the applied category set per physical runtime path and is idempotent', () => {
    run(['distribute', '--to', 'user', '--skill', 'foo', '--skill', 'bar', '--agent', 'zed', '--agent', 'warp']);
    const first = run(['categories', 'apply', '前端', '--agent', 'zed', '--agent', 'warp']);
    expect(first.status).toBe(0);
    const afterFirst = indexRecords().find((record) => record.id.startsWith('user:'));
    expect(afterFirst?.categorySets?.[runtimeDir()]).toEqual({ categories: ['前端'] });
    // The out-of-set entry is gone from the index.
    expect(afterFirst?.entries.map((entry) => entry.skill)).toEqual(['foo']);

    const indexBefore = readFileSync(path.join(home, '.skills', 'distributions.jsonl'), 'utf8');
    const second = run(['categories', 'apply', '前端', '--agent', 'zed', '--agent', 'warp']);
    expect(second.status).toBe(0);
    expect(runtimeNames()).toEqual(['foo']);
    expect(readFileSync(path.join(home, '.skills', 'distributions.jsonl'), 'utf8')).toBe(indexBefore);
  });

  it('applies per physical path: a shared-path family is rewritten once, another agent family path keeps its entries', () => {
    mkdirSync(path.join(userHome, '.claude'), { recursive: true });
    run(['distribute', '--to', 'user', '--skill', 'foo', '--skill', 'bar', '--agent', 'zed', '--agent', 'warp', '--agent', 'claude-code']);
    // Apply selecting only one member of the shared ~/.agents/skills family.
    const result = run(['categories', 'apply', '前端', '--agent', 'zed']);
    expect(result.status).toBe(0);
    expect(runtimeNames()).toEqual(['foo']);
    // The other physical path is untouched: out-of-set bar still there.
    expect(runtimeNames('.claude/skills')).toEqual(['bar', 'foo']);
    const record = indexRecords().find((item) => item.id.startsWith('user:'));
    expect(record?.categorySets?.[runtimeDir()]).toEqual({ categories: ['前端'] });
    expect(record?.categorySets?.[runtimeDir('.claude/skills')]).toBeUndefined();
  });

  it('defaults to the detected agent set like distribute', () => {
    mkdirSync(path.join(userHome, '.claude'), { recursive: true });
    run(['distribute', '--to', 'user', '--skill', 'foo', '--skill', 'bar', '--agent', 'claude-code']);
    const result = run(['categories', 'apply', '前端']);
    expect(result.status).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary.agents).toContain('claude-code');
    expect(runtimeNames('.claude/skills')).toEqual(['foo']);
  });
});

describe('categories apply --all', () => {
  it('restores the full managed set on the path after a filtered apply: out-of-set and uncategorized return', () => {
    run(['distribute', '--to', 'user', '--skill', 'foo', '--skill', 'bar', '--skill', 'baz', '--agent', 'zed']);
    run(['categories', 'apply', '前端', '--agent', 'zed']);
    expect(runtimeNames()).toEqual(['foo']);
    const result = run(['categories', 'apply', '--all', '--agent', 'zed']);
    expect(result.status).toBe(0);
    expect(runtimeNames()).toEqual(['bar', 'baz', 'foo']);
  });

  it('marks the category-set record as the --all marker, replacing the prior category list', () => {
    run(['distribute', '--to', 'user', '--skill', 'foo', '--skill', 'bar', '--agent', 'zed']);
    run(['categories', 'apply', '前端', '--agent', 'zed']);
    const result = run(['categories', 'apply', '--all', '--agent', 'zed']);
    expect(result.status).toBe(0);
    const record = indexRecords().find((item) => item.id.startsWith('user:'));
    expect(record?.categorySets?.[runtimeDir()]).toEqual({ all: true });
    // The restored entries are back in the index — including previously removed uncategorized ones.
    expect(record?.entries.map((entry) => entry.skill).sort()).toEqual(['bar', 'baz', 'foo']);
  });

  it('keeps the manager skill and foreign entries untouched under --all', () => {
    run(['distribute', '--to', 'user', '--skill', 'foo', '--skill', 'skills-manager', '--agent', 'zed']);
    mkdirSync(path.join(runtimeDir(), 'hand-placed'));
    run(['categories', 'apply', '前端', '--agent', 'zed']);
    const result = run(['categories', 'apply', '--all', '--agent', 'zed']);
    expect(result.status).toBe(0);
    // Manager retained (not removed, not duplicated); foreign survives; full set restored.
    expect(runtimeNames()).toEqual(['bar', 'baz', 'foo', 'hand-placed', 'skills-manager']);
  });

  it('rejects --all together with a category list, and an empty invocation with neither', () => {
    const both = run(['categories', 'apply', '--all', '前端', '--agent', 'zed']);
    expect(both.status).not.toBe(0);
    expect(both.stderr).toMatch(/--all.*category/i);
    const neither = run(['categories', 'apply', '--agent', 'zed']);
    expect(neither.status).not.toBe(0);
    expect(neither.stderr).toMatch(/category list|--all/i);
  });

  it('is idempotent: a second --all changes nothing (index byte-identical, no extra snapshot)', () => {
    run(['distribute', '--to', 'user', '--skill', 'foo', '--skill', 'bar', '--agent', 'zed']);
    run(['categories', 'apply', '前端', '--agent', 'zed']);
    run(['categories', 'apply', '--all', '--agent', 'zed']);
    const indexBefore = readFileSync(path.join(home, '.skills', 'distributions.jsonl'), 'utf8');
    const backups = path.join(home, '.skills', 'distribute-backups');
    const snapshotsBefore = readdirSync(backups, { recursive: true }).filter((item) => String(item).includes('manifest.yaml')).length;
    const second = run(['categories', 'apply', '--all', '--agent', 'zed']);
    expect(second.status).toBe(0);
    expect(runtimeNames()).toEqual(['bar', 'baz', 'foo']);
    expect(readFileSync(path.join(home, '.skills', 'distributions.jsonl'), 'utf8')).toBe(indexBefore);
    const snapshotsAfter = readdirSync(backups, { recursive: true }).filter((item) => String(item).includes('manifest.yaml')).length;
    expect(snapshotsAfter).toBe(snapshotsBefore);
  });
});
