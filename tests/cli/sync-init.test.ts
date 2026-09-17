import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { cli, runCli } from './cli-runner.js';
import { GIT_IDENTITY, addSkill, git, makeBareRemote, makeHub, makeSyncRoot } from './sync-fixtures.js';

let root: string;
let home: string;
let userHome: string;

beforeEach(() => {
  ({ root, home, userHome } = makeSyncRoot('sync-init-cli'));
  makeHub(home);
  mkdirSync(userHome, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(args: string[], extraEnv: Record<string, string> = {}) {
  return runCli(home, userHome, args, { ...GIT_IDENTITY, ...extraEnv });
}

describe('sync init (fresh hub)', () => {
  it('git-initializes the hub, writes the canonical .gitignore, and makes exactly one baseline commit', () => {
    const result = run(['sync', 'init']);

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path.join(home, '.git'))).toBe(true);
    const ignore = readFileSync(path.join(home, '.gitignore'), 'utf8');
    expect(ignore).toContain('.backups/');
    expect(ignore).toContain('.skills/');
    expect(git(home, ['rev-list', '--count', 'HEAD'])).toBe('1');
    expect(git(home, ['log', '-1', '--pretty=%s'])).toBe('sync: baseline commit');
    // Zero-omission list: mode, ignore lines, baseline commit, remote state.
    expect(result.stdout).toMatch(/initialized/);
    expect(result.stdout).toMatch(/appended 2 line\(s\): .*backups.*\.skills/);
    expect(result.stdout).toMatch(/baseline commit: [0-9a-f]{7,}/);
    expect(result.stdout).toMatch(/remote origin: not set/);
  });

  it('tracks hub content but ignores machine-local state (.backups/, .skills/)', () => {
    mkdirSync(path.join(home, '.backups'), { recursive: true });
    writeFileSync(path.join(home, '.backups', 'snapshot.md'), 'rollback state');
    mkdirSync(path.join(home, '.skills'), { recursive: true });
    writeFileSync(path.join(home, '.skills', 'activity.jsonl'), 'machine local');

    const result = run(['sync', 'init']);

    expect(result.status, result.stderr).toBe(0);
    expect(git(home, ['status', '--porcelain'])).toBe('');
    expect(git(home, ['ls-files'])).toContain('skills/demo/SKILL.md');
    expect(git(home, ['ls-files'])).toContain('registry.yaml');
    expect(git(home, ['ls-files'])).not.toContain('.backups');
    expect(git(home, ['ls-files'])).not.toContain('.skills');
  });

  it('attaches --remote as origin', () => {
    const remote = makeBareRemote(root);

    const result = run(['sync', 'init', '--remote', remote]);

    expect(result.status, result.stderr).toBe(0);
    expect(git(home, ['remote', 'get-url', 'origin'])).toBe(remote);
    expect(result.stdout).toMatch(new RegExp(`remote origin: attached .*${remote}`));
  });

  it('attaches --remote on adopt too (existing repo, no re-init)', () => {
    git(home, ['init']);
    git(home, ['add', '-A']);
    git(home, ['commit', '-m', 'user: everything committed']);
    const remote = makeBareRemote(root);

    const result = run(['sync', 'init', '--remote', remote]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/adopted/);
    expect(git(home, ['rev-list', '--count', 'HEAD'])).toBe('2'); // ignore append dirtied the tree → one baseline commit
    expect(git(home, ['remote', 'get-url', 'origin'])).toBe(remote);
  });

  it('tracks collections/ content alongside skills/ and registry.yaml', () => {
    mkdirSync(path.join(home, 'collections', 'pdf'), { recursive: true });
    writeFileSync(path.join(home, 'collections', 'pdf', 'SKILL.md'), 'category view fixture');

    const result = run(['sync', 'init']);

    expect(result.status, result.stderr).toBe(0);
    expect(git(home, ['ls-files'])).toContain('collections/pdf/SKILL.md');
  });

  it('always carries the secrets reminder (US-5)', () => {
    const result = run(['sync', 'init']);
    expect(result.stdout).toMatch(/secret/i);
    expect(result.stdout).toMatch(/push/i);
  });
});

describe('sync init (adopt)', () => {
  it('keeps existing history, appends missing ignore lines without touching user lines, and baselines untracked content', () => {
    // The user was a step ahead: manual git init, a commit, and a custom ignore entry.
    git(home, ['init']);
    writeFileSync(path.join(home, '.gitignore'), 'my-private-dir/\n');
    git(home, ['add', '.gitignore']);
    git(home, ['commit', '-m', 'user: initial commit']);
    addSkill(home, 'untracked-skill');

    const result = run(['sync', 'init']);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/adopted/);
    // History kept: the user's commit is still the root, our baseline rides on top.
    expect(git(home, ['rev-list', '--count', 'HEAD'])).toBe('2');
    expect(git(home, ['log', '--pretty=%s'])).toContain('user: initial commit');
    expect(git(home, ['log', '-1', '--pretty=%s'])).toBe('sync: baseline commit');
    const ignore = readFileSync(path.join(home, '.gitignore'), 'utf8');
    expect(ignore).toBe('my-private-dir/\n.backups/\n.skills/\n');
    expect(result.stdout).toMatch(/appended 2 line\(s\)/);
  });

  it('makes no baseline commit when the adopted tree is clean (canonical lines already present)', () => {
    git(home, ['init']);
    writeFileSync(path.join(home, '.gitignore'), 'my-private-dir/\n.backups/\n.skills/\n');
    git(home, ['add', '-A']);
    git(home, ['commit', '-m', 'user: everything committed']);

    const result = run(['sync', 'init']);

    expect(result.status, result.stderr).toBe(0);
    expect(git(home, ['rev-list', '--count', 'HEAD'])).toBe('1');
    expect(result.stdout).toMatch(/baseline commit: none/);
  });
});

describe('sync init (idempotency)', () => {
  it('a second run changes nothing: no re-init, no ignore growth, no duplicate commits', () => {
    const first = run(['sync', 'init']);
    expect(first.status, first.stderr).toBe(0);
    const ignoreAfterFirst = readFileSync(path.join(home, '.gitignore'), 'utf8');

    const second = run(['sync', 'init']);

    expect(second.status, second.stderr).toBe(0);
    expect(readFileSync(path.join(home, '.gitignore'), 'utf8')).toBe(ignoreAfterFirst);
    expect(git(home, ['rev-list', '--count', 'HEAD'])).toBe('1');
    expect(second.stdout).toMatch(/nothing to append/);
    expect(second.stdout).toMatch(/baseline commit: none/);
  });

  it('re-attaching the same --remote is a no-op, not a duplicate', () => {
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);

    const second = run(['sync', 'init', '--remote', remote]);

    expect(second.status, second.stderr).toBe(0);
    expect(git(home, ['remote'])).toBe('origin');
    expect(second.stdout).toMatch(/remote origin: already/);
  });
});

describe('sync init (boundary errors)', () => {
  it('fails with guidance when git identity is not configured', () => {
    const result = runCli(home, userHome, ['sync', 'init']); // no GIT_* env, isolated HOME

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/user\.name|user\.email/);
    expect(result.stderr).toMatch(/git config --global/);
  });

  it('fails with guidance when system git is missing', () => {
    const result = run(['sync', 'init'], { PATH: '' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/git/i);
    expect(result.stderr).toMatch(/install/i);
  });

  it('refuses a conflicting --remote when origin already points elsewhere', () => {
    const remoteA = makeBareRemote(root, 'a.git');
    const remoteB = makeBareRemote(root, 'b.git');
    run(['sync', 'init', '--remote', remoteA]);

    const result = run(['sync', 'init', '--remote', remoteB]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/origin/);
    expect(result.stderr).toMatch(/remote set-url|git -C/);
    expect(git(home, ['remote', 'get-url', 'origin'])).toBe(remoteA);
  });
});

describe('sync init (scope guarantees)', () => {
  it('bootstrap never git-initializes the hub (US-26)', () => {
    rmSync(home, { recursive: true, force: true }); // let bootstrap create it
    const result = spawnSync(process.execPath, [cli, '--home', home, 'bootstrap'], {
      encoding: 'utf8',
      env: { ...GIT_IDENTITY, HOME: userHome, SKILLS_MANAGER_USER_HOME: userHome },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path.join(home, '.git'))).toBe(false);
  });

  it('honors SKILL_HOME without --home', () => {
    const result = spawnSync(process.execPath, [cli, 'sync', 'init'], {
      encoding: 'utf8',
      env: { ...GIT_IDENTITY, SKILL_HOME: home },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path.join(home, '.git'))).toBe(true);
  });

  it('leaves doctor and status untouched (still exit 0 after git-ification)', () => {
    run(['sync', 'init']);
    expect(run(['doctor']).status).toBe(0);
    expect(run(['status']).status).toBe(0);
  });
});
