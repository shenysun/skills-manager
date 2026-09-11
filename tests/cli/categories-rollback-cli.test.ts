import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './cli-runner.js';

let root: string;
let home: string;
let userHome: string;

/** A hub with foo(前端), bar(金融), plus the manager skill. */
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'categories-rollback-'));
  home = path.join(root, 'hub');
  userHome = path.join(root, 'user-home');
  const source = path.join(root, 'source');
  for (const name of ['foo', 'bar', 'skills-manager']) {
    mkdirSync(path.join(source, 'skills', name), { recursive: true });
    writeFileSync(path.join(source, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ntitle: ${name}\ndescription: cli\n---\n# ${name}\n`);
  }
  run(['add', source, '--skill', 'foo', '--yes']);
  run(['add', source, '--skill', 'bar', '--yes']);
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

function indexRecords(): Array<{ id: string; entries: Array<{ skill: string }>; categorySets?: Record<string, unknown> }> {
  return readFileSync(path.join(home, '.skills', 'distributions.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function userRecord() {
  return indexRecords().find((record) => record.id.startsWith('user:'));
}

describe('rollback restores runtime content and the category-set record together', () => {
  it('after rollback, status shows the pre-apply truth: full runtime back, no applied set, no drift', () => {
    run(['distribute', '--to', 'user', '--skill', 'foo', '--skill', 'bar', '--skill', 'skills-manager', '--agent', 'zed']);
    mkdirSync(path.join(runtimeDir(), 'hand-placed'));
    run(['categories', 'apply', '前端', '--agent', 'zed']);
    expect(runtimeNames()).toEqual(['foo', 'hand-placed', 'skills-manager']);

    const rollback = run(['distribute', 'rollback', '--to', 'user']);
    expect(rollback.status).toBe(0);
    // Runtime content restored from the pre-apply snapshot; foreign untouched.
    expect(runtimeNames()).toEqual(['bar', 'foo', 'hand-placed', 'skills-manager']);
    // The category-set record went back to its pre-apply value: no record.
    expect(userRecord()?.categorySets?.[runtimeDir()]).toBeUndefined();
    expect(userRecord()?.entries.map((entry) => entry.skill).sort()).toEqual(['bar', 'foo', 'skills-manager']);

    const status = run(['categories', 'status']);
    expect(status.status).toBe(0);
    expect(status.stdout).toContain(runtimeDir());
    expect(status.stdout).toContain('no filter (no category set applied)');
    expect(status.stdout).not.toContain('drift');
  });

  it('doctor agrees with the restored state after rollback: no broken links, entry count matches the record', () => {
    run(['distribute', '--to', 'user', '--skill', 'foo', '--skill', 'bar', '--agent', 'zed']);
    run(['categories', 'apply', '前端', '--agent', 'zed']);
    run(['distribute', 'rollback', '--to', 'user']);

    const doctor = run(['doctor']);
    expect(doctor.status).toBe(0);
    const report = JSON.parse(doctor.stdout);
    expect(report.brokenLinks).toEqual([]);
    expect(report.distribution.managedEntries).toBe(2);
    expect(report.warnings.join('\n')).not.toMatch(/archived|missing from the hub/);
  });

  it('rolling back the very first apply restores the record-free state, including a never-recorded set', () => {
    // No prior distribute: apply itself lays down the first entries and snapshot.
    const apply = run(['categories', 'apply', '前端', '--agent', 'zed']);
    expect(apply.status).toBe(0);
    expect(runtimeNames()).toEqual(['foo']);
    expect(userRecord()?.categorySets?.[runtimeDir()]).toEqual({ categories: ['前端'] });

    const rollback = run(['distribute', 'rollback', '--to', 'user']);
    expect(rollback.status).toBe(0);
    expect(runtimeNames()).toEqual([]);
    // The user record is gone entirely — nothing for status to misreport from.
    const status = run(['categories', 'status']);
    expect(status.status).toBe(0);
    expect(status.stdout).toContain('No runtime paths recorded yet');
  });
});

describe('a set-only apply is still a rollback point', () => {
  it('reverting a category-set change with no runtime change rolls the record back one apply, not two', () => {
    run(['distribute', '--to', 'user', '--skill', 'foo', '--agent', 'zed']);
    run(['categories', 'apply', '前端', '--agent', 'zed']);
    // nomatch has no skills: the runtime stays [foo], only the recorded set changes.
    const reapply = run(['categories', 'apply', '前端', 'nomatch', '--agent', 'zed']);
    expect(reapply.status).toBe(0);
    expect(runtimeNames()).toEqual(['foo']);
    expect(userRecord()?.categorySets?.[runtimeDir()]).toEqual({ categories: ['nomatch', '前端'] });

    const rollback = run(['distribute', 'rollback', '--to', 'user']);
    expect(rollback.status).toBe(0);
    expect(runtimeNames()).toEqual(['foo']);
    expect(userRecord()?.categorySets?.[runtimeDir()]).toEqual({ categories: ['前端'] });
    // The restored set is reported as-is, with no false drift against it.
    const status = run(['categories', 'status']);
    expect(status.status).toBe(0);
    expect(status.stdout).toContain('categories: 前端');
    expect(status.stdout).not.toContain('drift');
  });
});
