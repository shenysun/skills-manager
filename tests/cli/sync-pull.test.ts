import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { runCli } from './cli-runner.js';
import { GIT_IDENTITY, addSkill, git, makeBareRemote, makeHub, makeSyncRoot } from './sync-fixtures.js';

let root: string;
let home: string;
let userHome: string;

beforeEach(() => {
  ({ root, home, userHome } = makeSyncRoot('sync-pull-cli'));
  mkdirSync(userHome, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(args: string[], hub = home) {
  return runCli(hub, userHome, args, GIT_IDENTITY);
}

describe('sync pull (normal flow)', () => {
  it('pulls remote content into a second machine via fetch + merge (US-11)', () => {
    makeHub(home);
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    run(['sync', 'push']);
    const hubB = path.join(root, 'hub-b');
    makeHub(hubB, []);
    run(['sync', 'init', '--remote', remote], hubB);

    const result = run(['sync', 'pull'], hubB);

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path.join(hubB, 'skills', 'demo', 'SKILL.md'))).toBe(true);
  });

  it('merges with a merge commit rather than refusing unrelated histories (new machine baseline, US-11)', () => {
    makeHub(home);
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    run(['sync', 'push']);
    const hubB = path.join(root, 'hub-b');
    makeHub(hubB, []);
    run(['sync', 'init', '--remote', remote], hubB);

    const result = run(['sync', 'pull'], hubB);

    expect(result.status, result.stderr).toBe(0);
    // Two unrelated roots (hub B's baseline vs the remote's history) can only
    // join through a merge commit — pull allows it, ff-only/rebase are out.
    expect(git(hubB, ['rev-list', '--count', 'HEAD'])).toBe('3'); // B baseline + A base + merge
    expect(git(hubB, ['log', '-1', '--pretty=%s'])).toMatch(/merge/i);
  });

  it('reports pull statistics and the plain distribute hint, running nothing (US-14)', () => {
    makeHub(home, ['demo', 'extra']);
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    run(['sync', 'push']);
    const hubB = path.join(root, 'hub-b');
    makeHub(hubB, []);
    run(['sync', 'init', '--remote', remote], hubB);

    const result = run(['sync', 'pull'], hubB);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/2 added \(demo, extra\)/);
    expect(result.stdout).toMatch(/registry: unchanged/);
    expect(result.stdout).toMatch(/distribute --skill/);
    // Purely a hint: no distribution happened, no state changed.
    expect(existsSync(path.join(userHome, '.claude'))).toBe(false);
    const activity = readFileSync(path.join(hubB, '.skills', 'activity.jsonl'), 'utf8');
    expect(activity).toMatch(/cli-sync-pull/);
    expect(activity).not.toMatch(/cli-distribute/);
  });

  it('flags a changed registry in the pull statistics', () => {
    makeHub(home);
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    run(['sync', 'push']);
    const hubB = path.join(root, 'hub-b');
    makeHub(hubB, []);
    run(['sync', 'init', '--remote', remote], hubB);
    run(['sync', 'pull'], hubB);
    // Second leg: A changes the registry after B is on the shared history.
    writeFileSync(path.join(home, 'registry.yaml'), 'skills: {demo: canonical}\n');
    run(['sync', 'push']);

    const result = run(['sync', 'pull'], hubB);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/registry: changed/);
    expect(result.stdout).toMatch(/merged skills: none changed/);
    expect(readFileSync(path.join(hubB, 'registry.yaml'), 'utf8')).toContain('demo: canonical');
  });

  it('reports already up to date with exit 0 and creates no merge commit', () => {
    makeHub(home);
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    run(['sync', 'push']);

    const result = run(['sync', 'pull']);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/already up to date/i);
    expect(git(home, ['rev-list', '--count', 'HEAD'])).toBe('1');
  });
});

describe('sync pull (multi-machine round trip)', () => {
  it('locks the full tracer: A push → B pull → B change push → A pull (ticket 04)', () => {
    makeHub(home);
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    run(['sync', 'push']);
    const hubB = path.join(root, 'hub-b');
    makeHub(hubB, []);
    run(['sync', 'init', '--remote', remote], hubB);
    run(['sync', 'pull'], hubB);

    // B makes machine-local state and a real change, then pushes.
    mkdirSync(path.join(hubB, '.backups'), { recursive: true });
    writeFileSync(path.join(hubB, '.backups', 'snapshot.md'), 'B rollback state');
    writeFileSync(path.join(hubB, '.skills', 'activity.jsonl'), 'B activity');
    addSkill(hubB, 'from-b');
    const pushB = run(['sync', 'push'], hubB);

    expect(pushB.status, pushB.stderr).toBe(0);

    // A pulls B's change down.
    const pullA = run(['sync', 'pull']);

    expect(pullA.status, pullA.stderr).toBe(0);
    expect(existsSync(path.join(home, 'skills', 'from-b', 'SKILL.md'))).toBe(true);
    expect(pullA.stdout).toMatch(/1 added \(from-b\)/);

    // Machine-local state never crossed the wire in either direction.
    const remoteTree = git(remote, ['ls-tree', '-r', '--name-only', 'HEAD']);
    expect(remoteTree).not.toContain('.backups');
    expect(remoteTree).not.toContain('.skills/');
    expect(existsSync(path.join(home, '.backups'))).toBe(false);
    // And B's own local state survived its own pull and push untouched.
    expect(readFileSync(path.join(hubB, '.backups', 'snapshot.md'), 'utf8')).toBe('B rollback state');
    expect(readFileSync(path.join(hubB, '.skills', 'activity.jsonl'), 'utf8')).toContain('B activity');
  });
});

describe('sync pull (hard gates)', () => {
  it('exits nonzero with sync init guidance on a hub that is not git-ified', () => {
    makeHub(home);

    const result = run(['sync', 'pull']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/sync init/);
  });

  it('exits nonzero with remote guidance when origin is missing', () => {
    makeHub(home);
    run(['sync', 'init']);

    const result = run(['sync', 'pull']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/sync init --remote/);
    expect(result.stderr).toMatch(/remote add origin/);
  });

  it('refuses to pull over a dirty tree, never stashing (US-13)', () => {
    makeHub(home);
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    run(['sync', 'push']);
    addSkill(home, 'uncommitted');
    const headBefore = git(home, ['rev-parse', 'HEAD']);

    const result = run(['sync', 'pull']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/sync push/);
    expect(result.stderr).toMatch(/never stashes|does not stash/i);
    // The refusal left everything exactly as it was: no stash, no merge, change intact.
    expect(git(home, ['rev-parse', 'HEAD'])).toBe(headBefore);
    expect(git(home, ['stash', 'list'])).toBe('');
    expect(existsSync(path.join(home, 'skills', 'uncommitted', 'SKILL.md'))).toBe(true);
    expect(git(home, ['status', '--porcelain'])).toContain('skills/uncommitted');
  });

  it('passes merge conflicts through with a nonzero exit and manual-resolution guidance, deciding nothing (US-12)', () => {
    makeHub(home);
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    run(['sync', 'push']);
    const hubB = path.join(root, 'hub-b');
    makeHub(hubB, []);
    run(['sync', 'init', '--remote', remote], hubB);
    run(['sync', 'pull'], hubB);

    // Both machines edit the same file; B pushes, A commits locally, A pulls.
    writeFileSync(path.join(hubB, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\nb side\n---\n');
    run(['sync', 'push'], hubB);
    writeFileSync(path.join(home, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\na side\n---\n');
    git(home, ['add', '-A']);
    git(home, ['commit', '-m', 'a side edit']);

    const result = run(['sync', 'pull']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(new RegExp(`git -C ${home}`));
    expect(result.stderr).toMatch(/resolve|conflict/i);
    // The conflict is left for the operator: git's own UU state is intact.
    expect(git(home, ['status', '--porcelain'])).toContain('UU skills/demo/SKILL.md');
  });
});
