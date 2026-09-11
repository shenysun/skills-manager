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
  root = mkdtempSync(path.join(tmpdir(), 'categories-status-'));
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

/** Install an extra hub skill after an apply, inside a test. */
function installExtra(name: string) {
  const dir = path.join(root, 'source', 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ntitle: ${name}\ndescription: cli\n---\n# ${name}\n`);
  run(['add', path.join(root, 'source'), '--skill', name, '--yes']);
}

describe('categories status', () => {
  it('shows each applied path its current category set, and unapplied paths as no filter', () => {
    mkdirSync(path.join(userHome, '.claude'), { recursive: true });
    run(['distribute', '--to', 'user', '--skill', 'foo', '--skill', 'bar', '--agent', 'zed', '--agent', 'warp', '--agent', 'claude-code']);
    run(['categories', 'apply', '前端', '--agent', 'zed']);
    const result = run(['categories', 'status']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`${runtimeDir()} (agents: warp, zed) — categories: 前端`);
    // The other physical path has distributions but no applied set: no filter, no drift line.
    expect(result.stdout).toContain(`${runtimeDir('.claude/skills')} (agents: claude-code) — no filter (no category set applied)`);
    expect(result.stdout).not.toMatch(/drift/);
  });

  it('reports drift for skills newly matching the set — re-tag or new install — without touching the runtime', () => {
    run(['distribute', '--to', 'user', '--skill', 'foo', '--agent', 'zed']);
    run(['categories', 'apply', '前端', '--agent', 'zed']);
    // Tag edits never auto-push: bar joins the set on the hub only.
    run(['categories', 'add', 'bar', '前端']);
    installExtra('qux');
    run(['categories', 'set', 'qux', '前端']);
    expect(runtimeNames()).toEqual(['foo']);

    const result = run(['categories', 'status']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('drift: 2 skill(s) match the set but are undistributed: bar, qux');
    expect(result.stdout).toContain('categories apply 前端');

    // Re-running apply converges the drift to zero.
    const reapplied = run(['categories', 'apply', '前端', '--agent', 'zed']);
    expect(reapplied.status).toBe(0);
    expect(runtimeNames()).toEqual(['bar', 'foo', 'qux']);
    const after = run(['categories', 'status']);
    expect(after.status).toBe(0);
    expect(after.stdout).not.toMatch(/drift/);
  });

  it('counts a set skill whose runtime entry vanished from disk as drift', () => {
    run(['distribute', '--to', 'user', '--skill', 'foo', '--agent', 'zed']);
    run(['categories', 'apply', '前端', '--agent', 'zed']);
    rmSync(path.join(runtimeDir(), 'foo'), { recursive: true, force: true });
    const result = run(['categories', 'status']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('drift: 1 skill(s) match the set but are undistributed: foo');
  });

  it('treats an --all path as no filter and still reports new managed skills as drift', () => {
    run(['distribute', '--to', 'user', '--skill', 'foo', '--skill', 'bar', '--agent', 'zed']);
    run(['categories', 'apply', '前端', '--agent', 'zed']);
    run(['categories', 'apply', '--all', '--agent', 'zed']);
    installExtra('qux');
    const result = run(['categories', 'status']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`${runtimeDir()} (agents: zed) — no filter (--all applied)`);
    expect(result.stdout).toContain('drift: 1 skill(s) match the set but are undistributed: qux');
    expect(result.stdout).toContain('categories apply --all');
  });

  it('never writes: index bytes and runtime contents are identical before and after status', () => {
    run(['distribute', '--to', 'user', '--skill', 'foo', '--agent', 'zed']);
    run(['categories', 'apply', '前端', '--agent', 'zed']);
    const indexPath = path.join(home, '.skills', 'distributions.jsonl');
    const indexBefore = readFileSync(indexPath, 'utf8');
    const runtimeBefore = runtimeNames();
    const result = run(['categories', 'status']);
    expect(result.status).toBe(0);
    expect(runtimeNames()).toEqual(runtimeBefore);
    expect(readFileSync(indexPath, 'utf8')).toBe(indexBefore);
  });

  it('answers a hub with no runtime paths recorded yet', () => {
    const result = run(['categories', 'status']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No runtime paths recorded');
  });
});
