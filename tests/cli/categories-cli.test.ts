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
  root = mkdtempSync(path.join(tmpdir(), 'categories-cli-'));
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

function registry(): { skills: Record<string, { category?: string; tags?: string[]; categories?: string[] }> } {
  return YAML.parse(readFileSync(path.join(home, 'registry.yaml'), 'utf8'));
}

describe('categories tagging CLI surface', () => {
  it('categories set replaces the whole category array and persists to registry.yaml', () => {
    const result = run(['categories', 'set', 'foo', '前端', '后端']);
    expect(result.status).toBe(0);
    expect(registry().skills.foo.categories).toEqual(['前端', '后端']);
    // Replace semantics: a second set overwrites, not appends.
    run(['categories', 'set', 'foo', '金融']);
    expect(registry().skills.foo.categories).toEqual(['金融']);
    // The legacy scalar category axis is untouched.
    expect(registry().skills.foo.category).toBe('experimental');
  });

  it('categories add and remove change one tag without restating the full list', () => {
    run(['categories', 'set', 'foo', '前端', '后端']);
    run(['categories', 'add', 'foo', '测试']);
    expect(registry().skills.foo.categories).toEqual(['前端', '后端', '测试']);
    run(['categories', 'remove', 'foo', '后端']);
    expect(registry().skills.foo.categories).toEqual(['前端', '测试']);
    // Removing a tag the skill does not have is a no-op, not an error.
    const result = run(['categories', 'remove', 'foo', '不存在']);
    expect(result.status).toBe(0);
    expect(registry().skills.foo.categories).toEqual(['前端', '测试']);
    // Clearing to empty is the replace-semantics edge the spec leans on
    // ("managed skills with empty categories are treated as not in the set").
    const cleared = run(['categories', 'set', 'foo']);
    expect(cleared.status).toBe(0);
    expect(registry().skills.foo.categories).toEqual([]);
  });

  it('normalizes categories: trim, dedupe, drop empties; no controlled vocabulary', () => {
    const result = run(['categories', 'set', 'foo', ' 前端 ', '', '前端', 'weird/tag ok?']);
    expect(result.status).toBe(0);
    expect(registry().skills.foo.categories).toEqual(['weird/tag ok?', '前端']);
  });

  it('categories list reports deduped tags with per-tag skill counts', () => {
    run(['categories', 'set', 'foo', '前端', '后端']);
    run(['categories', 'set', 'bar', '前端']);
    const result = run(['categories', 'list']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('前端 (2)');
    expect(result.stdout).toContain('后端 (1)');
  });

  it('edit --categories is replace-semantics, equivalent to categories set', () => {
    run(['categories', 'add', 'foo', '前端', '后端']);
    const result = run(['edit', 'foo', '--categories', '金融']);
    expect(result.status).toBe(0);
    expect(registry().skills.foo.categories).toEqual(['金融']);
    const entry = JSON.parse(result.stdout);
    expect(entry.categories).toEqual(['金融']);
  });

  it('leaves the legacy axis untouched: category field, list --category, tags stay idle', () => {
    run(['categories', 'set', 'foo', '前端']);
    const state = registry();
    expect(state.skills.foo.category).toBe('experimental');
    expect(state.skills.foo.tags).toEqual([]);
    // list --category still filters on the legacy scalar axis: the new
    // multi-valued 前端 tag does not leak into it.
    const legacy = run(['list', '--category', 'experimental', '--brief']);
    expect(legacy.status).toBe(0);
    expect(JSON.parse(legacy.stdout).map((row: { name: string }) => row.name)).toEqual(['bar', 'foo']);
    const none = run(['list', '--category', '前端', '--brief']);
    expect(none.status).toBe(0);
    expect(JSON.parse(none.stdout)).toEqual([]);
  });
});
