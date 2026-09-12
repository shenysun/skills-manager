import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './cli-runner.js';
import { skillMarkdown, writeZip } from '../fixtures/archives.js';

/**
 * CLI surface for local zip archive sources (source-formats ticket 02): the
 * add flow, registry provenance, brief status, update-plan exclusion, and hub
 * citizenship — an archive-installed skill behaves like any other.
 */

let root: string;
let home: string;
let userHome: string;
let zipPath: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'archive-add-cli-'));
  home = path.join(root, 'hub');
  userHome = path.join(root, 'user-home');
  zipPath = writeZip(root, 'bundle.zip', [
    { name: 'skills/alpha/SKILL.md', data: skillMarkdown('alpha') },
    { name: 'skills/beta/SKILL.md', data: skillMarkdown('beta') },
  ]);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(args: string[]) {
  return runCli(home, userHome, args);
}

describe('add with a local zip archive', () => {
  it('lists discovered skills with --list, same shape as any source', () => {
    const result = run(['add', zipPath, '--list']);
    expect(result.status, result.stderr).toBe(0);
    const discovered = JSON.parse(result.stdout).discovered;
    expect(discovered.map((skill: { name: string }) => skill.name)).toEqual(['alpha', 'beta']);
  });

  it('installs a selected skill and records archive provenance with no update anchors', () => {
    const install = run(['add', zipPath, '--skill', 'skills/alpha']);
    expect(install.status, install.stderr).toBe(0);
    expect(JSON.parse(install.stdout).installed).toEqual(['alpha']);

    const entry = JSON.parse(run(['list']).stdout).find((skill: { name: string }) => skill.name === 'alpha');
    expect(entry.source.type).toBe('archive');
    expect(entry.source.url).toBe(zipPath);
    expect(entry.source.upstream_commit).toBeNull();
    expect(entry.source.upstream_tree).toBeNull();
  });

  it('installs every discovered skill with --all', () => {
    const result = run(['add', zipPath, '--all']);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).installed.sort()).toEqual(['alpha', 'beta']);
  });

  it('list --brief shows the archive skill as not updatable', () => {
    run(['add', zipPath, '--skill', 'skills/alpha']);
    const row = JSON.parse(run(['list', '--brief']).stdout).find((skill: { name: string }) => skill.name === 'alpha');
    expect(row.updatable).toBe(false);
  });

  it('update --plan excludes the archive skill while other sources stay candidates', () => {
    run(['add', zipPath, '--skill', 'skills/alpha']);
    const localSource = path.join(root, 'local-repo');
    mkdirSync(path.join(localSource, 'skills', 'gamma'), { recursive: true });
    writeFileSync(path.join(localSource, 'skills', 'gamma', 'SKILL.md'), skillMarkdown('gamma'));
    run(['add', localSource, '--skill', 'gamma']);

    const plan = JSON.parse(run(['update', '--plan']).stdout);
    const candidates = plan.groups.flatMap((group: { skills: Array<{ skill: string }> }) => group.skills.map((skill) => skill.skill));
    expect(candidates).toContain('gamma');
    expect(candidates).not.toContain('alpha');
  });

  it('distributes an archive-installed skill like any hub skill', () => {
    run(['add', zipPath, '--skill', 'skills/alpha']);
    const result = run(['distribute', '--to', 'user', '--skill', 'alpha', '--agent', 'zed']);
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path.join(userHome, '.agents', 'skills', 'alpha'))).toBe(true);
  });

  it('tags and untags an archive-installed skill through categories like any hub skill', () => {
    run(['add', zipPath, '--skill', 'skills/alpha']);
    expect(run(['categories', 'set', 'alpha', 'dev']).status).toBe(0);
    const row = JSON.parse(run(['list']).stdout).find((skill: { name: string }) => skill.name === 'alpha');
    expect(row.categories).toEqual(['dev']);
    expect(run(['categories', 'remove', 'alpha', 'dev']).status).toBe(0);
    const cleared = JSON.parse(run(['list']).stdout).find((skill: { name: string }) => skill.name === 'alpha');
    expect(cleared.categories).toEqual([]);
  });
});
