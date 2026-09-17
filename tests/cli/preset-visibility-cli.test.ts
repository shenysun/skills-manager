import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './cli-runner.js';

let root: string;
let home: string;
let userHome: string;

/** A hub with foo(前端), bar(金融), baz(uncategorized), plus the manager skill; presets dev(前端) and idle(金融). */
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'preset-visibility-'));
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
  run(['preset', 'set', 'dev', '前端']);
  run(['preset', 'set', 'idle', '金融']);
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

/** Count footprint lines so absence can be asserted per preset, not just globally. */
function mountedLineCount(stdout: string) {
  return stdout.match(/mounted on/g)?.length ?? 0;
}

describe('preset list mount footprint', () => {
  it('shows the footprint (count + dirs) after an apply and omits it for unmounted presets', () => {
    run(['distribute', '--to', 'user', '--skill', 'bar', '--skill', 'baz', '--agent', 'zed']);
    run(['preset', 'apply', 'dev', '--agent', 'zed']);
    const result = run(['preset', 'list']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('dev: 前端');
    expect(result.stdout).toContain(`  mounted on 1 runtime path(s): ${runtimeDir()}`);
    // idle exists in the list but carries no mount: exactly one footprint line total.
    expect(result.stdout).toContain('idle: 金融');
    expect(mountedLineCount(result.stdout)).toBe(1);
    // No resolved-skill accounting on this surface (spec US5: paths, not skill counts).
    expect(result.stdout).not.toMatch(/managed skills|resolves to/);
  });

  it('emits no footprint lines at all when nothing is mounted anywhere', () => {
    const result = run(['preset', 'list']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('dev: 前端');
    expect(result.stdout).toContain('idle: 金融');
    expect(result.stdout).not.toMatch(/mounted on|drift/);
  });

  it('honestly shows drift on a mounted path after later tag edits — without implying the档位 is healthy', () => {
    run(['distribute', '--to', 'user', '--skill', 'bar', '--skill', 'baz', '--agent', 'zed']);
    run(['preset', 'apply', 'dev', '--agent', 'zed']);
    // Tag edits never auto-push: bar joins 前端 on the hub only.
    run(['categories', 'add', 'bar', '前端']);
    const result = run(['preset', 'list']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`  drift on ${runtimeDir()}: 1 skill(s) match the set but are undistributed: bar`);
  });

  it('drops the footprint to zero after preset remove cascades the stamps off (ticket 03 semantics)', () => {
    mkdirSync(path.join(userHome, '.claude'), { recursive: true });
    run(['distribute', '--to', 'user', '--skill', 'foo', '--agent', 'zed']);
    run(['preset', 'apply', 'dev', '--agent', 'zed']);
    run(['preset', 'apply', 'idle', '--agent', 'claude-code']);
    const before = run(['preset', 'list']);
    expect(mountedLineCount(before.stdout)).toBe(2);

    const removed = run(['preset', 'remove', 'dev']);
    expect(removed.status).toBe(0);
    const after = run(['preset', 'list']);
    expect(after.status).toBe(0);
    expect(after.stdout).not.toContain('dev:');
    expect(after.stdout).toContain(`idle: 金融`);
    expect(mountedLineCount(after.stdout)).toBe(1);
    expect(after.stdout).toContain(`mounted on 1 runtime path(s): ${runtimeDir('.claude/skills')}`);
  });
});

describe('categories status preset visibility', () => {
  it('shows the stamped preset name beside the applied set; unstamped paths stay unchanged', () => {
    mkdirSync(path.join(userHome, '.claude'), { recursive: true });
    run(['distribute', '--to', 'user', '--skill', 'foo', '--agent', 'zed', '--agent', 'claude-code']);
    run(['preset', 'apply', 'dev', '--agent', 'zed']);
    const result = run(['categories', 'status']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`${runtimeDir()} (agents: zed) — categories: 前端 (preset: dev)`);
    expect(result.stdout).toContain(`${runtimeDir('.claude/skills')} (agents: claude-code) — no filter (no category set applied)`);
  });

  it('a bare categories apply keeps status preset-free (bare-apply regression lock)', () => {
    run(['distribute', '--to', 'user', '--skill', 'bar', '--skill', 'baz', '--agent', 'zed']);
    run(['preset', 'apply', 'dev', '--agent', 'zed']);
    run(['categories', 'apply', '前端', '--agent', 'zed']);
    const result = run(['categories', 'status']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`${runtimeDir()} (agents: zed) — categories: 前端`);
    expect(result.stdout).not.toContain('(preset:');
  });

  it('preset remove clears the name from status output while the applied categories remain', () => {
    run(['distribute', '--to', 'user', '--skill', 'bar', '--skill', 'baz', '--agent', 'zed']);
    run(['preset', 'apply', 'dev', '--agent', 'zed']);
    run(['preset', 'remove', 'dev']);
    const result = run(['categories', 'status']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`${runtimeDir()} (agents: zed) — categories: 前端`);
    expect(result.stdout).not.toContain('(preset:');
  });
});
