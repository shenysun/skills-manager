import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { cli, runCli } from './cli-runner.js';
import { GIT_IDENTITY, addSkill, git, makeBareRemote, makeHub, makeSyncRoot } from './sync-fixtures.js';

let root: string;
let home: string;
let userHome: string;

beforeEach(() => {
  ({ root, home, userHome } = makeSyncRoot('sync-status-cli'));
  makeHub(home);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(args: string[], extraEnv: Record<string, string> = {}) {
  return runCli(home, userHome, args, { ...GIT_IDENTITY, ...extraEnv });
}

/** Recursive path+size snapshot of a directory tree — read-only proofs compare
 *  this before and after the command ran. `.git` internals are excluded (git
 *  may rewrite its own index on reads); HEAD and porcelain state are asserted
 *  separately. */
function snapshot(dir: string): string {
  const walk = (current: string): string[] =>
    readdirSync(current, { withFileTypes: true })
      .filter((entry) => entry.name !== '.git')
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((entry) => {
        const full = path.join(current, entry.name);
        return entry.isDirectory() ? walk(full) : [`${path.relative(dir, full)}:${statSync(full).size}`];
      });
  return walk(dir).join('\n');
}

describe('sync status (git-ified hub)', () => {
  it('reports every dimension: hub path, remote, dirty count, ahead/behind with last-fetch basis, last commit short SHA + message', () => {
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    git(home, ['push', '-u', 'origin', 'HEAD']);
    addSkill(home, 'dirty-skill'); // untracked → dirty

    const result = run(['sync', 'status']);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(home);
    expect(result.stdout).toMatch(new RegExp(`remote origin: .*${remote}`));
    expect(result.stdout).toMatch(/dirty files: 1/);
    expect(result.stdout).toMatch(/ahead\/behind: ahead 0, behind 0/);
    expect(result.stdout).toMatch(/last fetch/i); // the basis is stated, never implied
    const sha = git(home, ['rev-parse', '--short', 'HEAD']);
    expect(result.stdout).toMatch(new RegExp(`last sync commit: ${sha} sync: baseline commit`));
  });

  it('shows a clean tree as 0 dirty files', () => {
    run(['sync', 'init']);
    const result = run(['sync', 'status']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/dirty files: 0/);
  });

  it('counts ahead commits that exist only locally', () => {
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    git(home, ['push', '-u', 'origin', 'HEAD']);
    addSkill(home, 'second-skill');
    git(home, ['add', '-A']);
    git(home, ['commit', '-m', 'user: second skill']);

    const result = run(['sync', 'status']);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/ahead 1, behind 0/);
  });

  it('counts behind commits from the remote-tracking ref after a local reset', () => {
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    addSkill(home, 'second-skill');
    git(home, ['add', '-A']);
    git(home, ['commit', '-m', 'user: second skill']);
    git(home, ['push', '-u', 'origin', 'HEAD']);
    git(home, ['reset', '--hard', 'HEAD~1']); // remote-tracking ref stays one ahead

    const result = run(['sync', 'status']);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/ahead 0, behind 1/);
  });

  it('says no upstream tracking ref when the remote is attached but nothing was pushed yet', () => {
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);

    const result = run(['sync', 'status']);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/no upstream/i);
  });

  it('states clearly when no remote is configured', () => {
    run(['sync', 'init']);

    const result = run(['sync', 'status']);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/remote origin: not configured/);
  });

  it('never contacts the remote: a dead remote URL still yields a successful read-only status', () => {
    // Set up tracking against a live remote, then point origin at a dead path —
    // the remote-tracking ref survives, so if status ever fetched, this fails.
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    git(home, ['push', '-u', 'origin', 'HEAD']);
    const deadRemote = path.join(root, 'does-not-exist.git');
    git(home, ['remote', 'set-url', 'origin', deadRemote]);

    const result = run(['sync', 'status']);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/ahead 0, behind 0/);
  });

  it('reports no commits yet for a git-ified hub whose history is empty', () => {
    git(home, ['init']); // git-ified by hand, nothing committed

    const result = run(['sync', 'status']);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/last sync commit: none/);
  });
});

describe('sync status (not git-ified hub)', () => {
  it('hints at sync init and exits 0 (unlike push/pull, absence is not an error)', () => {
    const result = run(['sync', 'status']);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/git: no/);
    expect(result.stdout).toMatch(/sync init/);
  });

  it('stays exit 0 even when system git is missing (the answer needs no git)', () => {
    const result = run(['sync', 'status'], { PATH: '' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/sync init/);
  });
});

describe('sync status --json', () => {
  it('emits the full machine-readable shape for a git-ified hub', () => {
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    git(home, ['push', '-u', 'origin', 'HEAD']);
    addSkill(home, 'dirty-skill');

    const result = run(['sync', 'status', '--json']);

    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload).toEqual({
      home,
      gitified: true,
      remote,
      dirtyFiles: 1,
      aheadBehind: { ahead: 0, behind: 0, basis: 'last-fetch' },
      lastCommit: { sha: expect.stringMatching(/^[0-9a-f]{7,}$/), message: 'sync: baseline commit' },
    });
  });

  it('emits the minimal shape for a not-yet-git-ified hub', () => {
    const result = run(['sync', 'status', '--json']);

    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.gitified).toBe(false);
    expect(payload.home).toBe(home);
    expect(payload.hint).toMatch(/sync init/);
  });

  it('uses null for absent dimensions (no remote, no upstream, no commits) instead of omitting keys', () => {
    git(home, ['init']); // manual init: status never reconciles anything, so nothing is committed or ignored
    const result = run(['sync', 'status', '--json']);

    const payload = JSON.parse(result.stdout);
    expect(payload).toEqual({
      home,
      gitified: true,
      remote: null,
      dirtyFiles: 2, // registry.yaml + skills/demo/SKILL.md, both untracked
      aheadBehind: null,
      lastCommit: null,
    });
  });
});

describe('sync status (read-only guarantee)', () => {
  it('leaves a cold hub git-identical too: HEAD and porcelain unchanged even on the first-ever CLI visit (scaffold dirs are gitignored/invisible)', () => {
    git(home, ['init']);
    git(home, ['add', '-A']);
    git(home, ['commit', '-m', 'user: everything committed']);
    const before = { head: git(home, ['rev-parse', 'HEAD']), porcelain: git(home, ['status', '--porcelain']) };

    const result = run(['sync', 'status']);

    expect(result.status, result.stderr).toBe(0);
    expect(git(home, ['rev-parse', 'HEAD'])).toBe(before.head);
    expect(git(home, ['status', '--porcelain'])).toBe(before.porcelain);
  });

  it('leaves the hub byte-identical: same tree snapshot, same HEAD, same porcelain state', () => {
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    git(home, ['push', '-u', 'origin', 'HEAD']);
    addSkill(home, 'dirty-skill');
    run(['status']); // warm up the machine-local scaffold (.skills/, collections/) every command creates
    const before = {
      tree: snapshot(home),
      head: git(home, ['rev-parse', 'HEAD']),
      porcelain: git(home, ['status', '--porcelain']),
      registry: readFileSync(path.join(home, 'registry.yaml'), 'utf8'),
    };

    const result = run(['sync', 'status']);

    expect(result.status, result.stderr).toBe(0);
    expect(snapshot(home)).toBe(before.tree);
    expect(git(home, ['rev-parse', 'HEAD'])).toBe(before.head);
    expect(git(home, ['status', '--porcelain'])).toBe(before.porcelain);
    expect(readFileSync(path.join(home, 'registry.yaml'), 'utf8')).toBe(before.registry);
  });
});

describe('sync status (scope guarantees)', () => {
  it('honors SKILL_HOME without --home', () => {
    makeHub(home);
    const result = spawnSync(process.execPath, [cli, 'sync', 'status', '--json'], {
      encoding: 'utf8',
      env: { ...GIT_IDENTITY, SKILL_HOME: home, HOME: userHome, SKILLS_MANAGER_USER_HOME: userHome },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).home).toBe(home);
  });
});
