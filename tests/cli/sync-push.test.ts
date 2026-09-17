import { mkdirSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { runCli } from './cli-runner.js';
import { GIT_IDENTITY, addSkill, git, makeBareRemote, makeHub, makeSyncRoot } from './sync-fixtures.js';

let root: string;
let home: string;
let userHome: string;

beforeEach(() => {
  ({ root, home, userHome } = makeSyncRoot('sync-push-cli'));
  mkdirSync(userHome, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(args: string[], extraEnv: Record<string, string> = {}) {
  return runCli(home, userHome, args, { ...GIT_IDENTITY, ...extraEnv });
}

describe('sync push (normal flow)', () => {
  it('stages all changes, makes one summary commit, and pushes to the remote (US-6)', () => {
    makeHub(home);
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    addSkill(home, 'pdf');

    const result = run(['sync', 'push']);

    expect(result.status, result.stderr).toBe(0);
    expect(git(remote, ['cat-file', '-e', 'HEAD:skills/pdf/SKILL.md'])).toBe('');
    expect(git(remote, ['cat-file', '-e', 'HEAD:skills/demo/SKILL.md'])).toBe('');
  });

  it('summarizes added skills and registry changes in the commit message (US-7)', () => {
    makeHub(home);
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    addSkill(home, 'pdf');
    writeFileSync(path.join(home, 'registry.yaml'), 'skills: {pdf: canonical}\n');

    const result = run(['sync', 'push']);

    expect(result.status, result.stderr).toBe(0);
    expect(git(home, ['log', '-1', '--pretty=%s'])).toBe('sync: 1 added, registry changed');
    expect(result.stdout).toMatch(/commit: [0-9a-f]{7} sync: 1 added, registry changed/);
  });

  it('counts updated and removed skills per skill, not per file (US-7)', () => {
    makeHub(home, ['demo', 'temp']);
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    writeFileSync(path.join(home, 'skills', 'demo', 'extra.md'), 'another file in the same skill');
    writeFileSync(path.join(home, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ntitle: demo\ndescription: changed\n---\n');
    rmSync(path.join(home, 'skills', 'temp'), { recursive: true });

    const result = run(['sync', 'push']);

    expect(result.status, result.stderr).toBe(0);
    expect(git(home, ['log', '-1', '--pretty=%s'])).toBe('sync: 1 updated, 1 removed');
  });

  it('counts a file renamed within one skill as an update, not a removal (US-7 skill-level counting)', () => {
    makeHub(home);
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    renameSync(path.join(home, 'skills', 'demo', 'SKILL.md'), path.join(home, 'skills', 'demo', 'README.md'));

    const result = run(['sync', 'push']);

    expect(result.status, result.stderr).toBe(0);
    expect(git(home, ['log', '-1', '--pretty=%s'])).toBe('sync: 1 updated');
  });

  it('counts a renamed skill as one added plus one removed (US-7)', () => {
    makeHub(home);
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    renameSync(path.join(home, 'skills', 'demo'), path.join(home, 'skills', 'renamed'));

    const result = run(['sync', 'push']);

    expect(result.status, result.stderr).toBe(0);
    expect(git(home, ['log', '-1', '--pretty=%s'])).toBe('sync: 1 added, 1 removed');
  });
});

describe('sync push (nothing new to send)', () => {
  it('pushes existing local commits without making a new one when the tree is clean', () => {
    makeHub(home);
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);

    const result = run(['sync', 'push']);

    expect(result.status, result.stderr).toBe(0);
    expect(git(home, ['rev-list', '--count', 'HEAD'])).toBe('1'); // init's baseline only
    expect(git(remote, ['rev-parse', 'HEAD'])).toBe(git(home, ['rev-parse', 'HEAD']));
    expect(result.stdout).toMatch(/commit: none .*pushed existing/);
  });

  it('reports already-in-sync with exit 0 and never creates an empty commit (US-8)', () => {
    makeHub(home);
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    run(['sync', 'push']); // the baseline goes up

    const second = run(['sync', 'push']);

    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toMatch(/already in sync/i);
    expect(git(home, ['rev-list', '--count', 'HEAD'])).toBe('1');
    expect(git(remote, ['rev-parse', 'HEAD'])).toBe(git(home, ['rev-parse', 'HEAD']));
    // The activity log must not claim a push happened when nothing was sent.
    const activity = readFileSync(path.join(home, '.skills', 'activity.jsonl'), 'utf8');
    expect(activity).toMatch(/cli-sync-push.*already in sync/);
  });
});

describe('sync push (hard gates)', () => {
  it('exits nonzero with sync init guidance on a hub that is not git-ified (unlike status, which exits 0)', () => {
    makeHub(home);

    const result = run(['sync', 'push']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/sync init/);
    expect(run(['sync', 'status']).status).toBe(0);
  });

  it('exits nonzero with remote guidance when origin is missing, committing nothing (US-9)', () => {
    makeHub(home);
    run(['sync', 'init']);
    addSkill(home, 'pdf');

    const result = run(['sync', 'push']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/sync init --remote/);
    expect(result.stderr).toMatch(/remote add origin/);
    expect(git(home, ['rev-list', '--count', 'HEAD'])).toBe('1'); // gate ran before staging
  });

  it('exits nonzero with git identity guidance when identity is unset, committing nothing (US-10)', () => {
    makeHub(home);
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    addSkill(home, 'pdf');

    const result = runCli(home, userHome, ['sync', 'push']); // no GIT_* env, isolated HOME

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/git config --global/);
    expect(result.stderr).toMatch(/user\.name/);
    expect(git(home, ['log', '-1', '--pretty=%s'])).toBe('sync: baseline commit');
  });

  it('exits nonzero with sync init guidance on a repo with no commits at all (manual init, nothing committed)', () => {
    makeHub(home);
    const remote = makeBareRemote(root);
    git(home, ['init']);
    git(home, ['remote', 'add', 'origin', remote]);

    const result = run(['sync', 'push']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/sync init/);
  });
});

describe('sync push (ignore regression)', () => {
  it('never ships .backups/ or .skills/ to the remote', () => {
    makeHub(home);
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    run(['sync', 'push']);
    mkdirSync(path.join(home, '.backups'), { recursive: true });
    writeFileSync(path.join(home, '.backups', 'snapshot.md'), 'rollback state');
    mkdirSync(path.join(home, '.skills'), { recursive: true });
    writeFileSync(path.join(home, '.skills', 'activity.jsonl'), 'machine local');
    addSkill(home, 'pdf');

    const result = run(['sync', 'push']);

    expect(result.status, result.stderr).toBe(0);
    const tree = git(remote, ['ls-tree', '-r', '--name-only', 'HEAD']);
    expect(tree).toContain('skills/pdf/SKILL.md');
    expect(tree).not.toContain('.backups');
    expect(tree).not.toContain('.skills');
  });
});
