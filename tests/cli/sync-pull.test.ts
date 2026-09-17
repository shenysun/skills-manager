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

describe('sync pull (placeholder registry reconciliation, ticket 07)', () => {
  it('merges cleanly on a new machine whose baseline carries only the placeholder registry, keeping the remote real one (US-11)', () => {
    // Machine A installed a real skill first — its registry has entries before
    // init baselines it. The fixture's hand-written `skills: {}` hides exactly
    // this divergence (QA's repro path).
    makeHub(home);
    writeFileSync(path.join(home, 'registry.yaml'), 'skills:\n  demo:\n    source: git\n');
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    run(['sync', 'push']);
    const hubB = path.join(root, 'hub-b');
    makeHub(hubB, []);
    run(['sync', 'init', '--remote', remote], hubB);

    const result = run(['sync', 'pull'], hubB);

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(path.join(hubB, 'registry.yaml'), 'utf8')).toContain('demo:');
    expect(result.stdout).toMatch(/registry: changed/);
  });

  it('leaves a real local registry to the operator even when the remote side is the byte-empty placeholder', () => {
    makeHub(home);
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    run(['sync', 'push']);
    // Machine B carries real content before its first pull — a byte-empty
    // remote registry is indistinguishable from a pushed "removed the last
    // skill", so the tool must not pick a winner between two real sides.
    const hubB = path.join(root, 'hub-b');
    makeHub(hubB);
    writeFileSync(path.join(hubB, 'registry.yaml'), 'skills:\n  own:\n    source: git\n');
    run(['sync', 'init', '--remote', remote], hubB);

    const result = run(['sync', 'pull'], hubB);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(new RegExp(`git -C ${hubB}`));
    expect(git(hubB, ['status', '--porcelain'])).toContain('AA registry.yaml');
  });
});

describe('sync pull (placeholder reconciliation discipline guards)', () => {
  it('leaves a both-sides-real registry clash to the operator — no auto-resolution, git state intact (US-12)', () => {
    makeHub(home);
    writeFileSync(path.join(home, 'registry.yaml'), 'skills:\n  a-side:\n    source: git\n');
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    run(['sync', 'push']);
    const hubB = path.join(root, 'hub-b');
    makeHub(hubB);
    writeFileSync(path.join(hubB, 'registry.yaml'), 'skills:\n  b-side:\n    source: git\n');
    run(['sync', 'init', '--remote', remote], hubB);

    const result = run(['sync', 'pull'], hubB);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(new RegExp(`git -C ${hubB}`));
    expect(result.stderr).toMatch(/resolve|conflict/i);
    // Neither real registry was decided over: the AA state is exactly git's.
    expect(git(hubB, ['status', '--porcelain'])).toContain('AA registry.yaml');
  });

  it('never auto-resolves a byte-empty registry on the shared-history arm — a pushed "removed the last skill" is real data', () => {
    // Shared history first: A (real registry) push → B pull.
    makeHub(home);
    writeFileSync(path.join(home, 'registry.yaml'), 'skills:\n  demo:\n    source: git\n');
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    run(['sync', 'push']);
    const hubB = path.join(root, 'hub-b');
    makeHub(hubB, []);
    run(['sync', 'init', '--remote', remote], hubB);
    run(['sync', 'pull'], hubB);
    // A removes its only skill and pushes — the registry serializes back to
    // the byte-exact `skills: {}`, indistinguishable from a placeholder.
    rmSync(path.join(home, 'skills', 'demo'), { recursive: true });
    writeFileSync(path.join(home, 'registry.yaml'), 'skills: {}\n');
    run(['sync', 'push']);
    // B meanwhile commits its own registry edit — the pull must clash and
    // leave it to the operator, because B has an upstream (not a new machine).
    writeFileSync(path.join(hubB, 'registry.yaml'), 'skills:\n  demo:\n    source: marketplace\n');
    git(hubB, ['add', '-A']);
    git(hubB, ['commit', '-m', 'b registry edit']);

    const result = run(['sync', 'pull'], hubB);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(new RegExp(`git -C ${hubB}`));
    // Shared history conflicts read UU (both modified); the point is that the
    // state is exactly git's, untouched by any auto-resolution.
    expect(git(hubB, ['status', '--porcelain'])).toContain('UU registry.yaml');
  });

  it('refuses the whole merge when a real file conflicts alongside the placeholder registry', () => {
    makeHub(home);
    writeFileSync(path.join(home, 'registry.yaml'), 'skills:\n  demo:\n    source: git\n');
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    run(['sync', 'push']);
    const hubB = path.join(root, 'hub-b');
    makeHub(hubB, []);
    // B's baseline carries its own version of A's skill file — the merge
    // clashes there too, so even the reconcilable registry must stay unmerged.
    addSkill(hubB, 'demo');
    writeFileSync(path.join(hubB, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: b side\n---\nB\n');
    run(['sync', 'init', '--remote', remote], hubB);

    const result = run(['sync', 'pull'], hubB);

    expect(result.status).not.toBe(0);
    expect(git(hubB, ['status', '--porcelain'])).toContain('AA skills/demo/SKILL.md');
    expect(git(hubB, ['status', '--porcelain'])).toContain('AA registry.yaml');
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

describe('sync pull (merge-target resolution, ticket 08)', () => {
  it('pulls on a self-built remote whose HEAD symref dangles (default-init bare repo, QA repro)', () => {
    // `git init --bare` without `-b main` symrefs HEAD at master; hubs push
    // their pinned main — the remote HAS content, its HEAD just resolves to
    // nothing. A new machine must still merge origin/main.
    makeHub(home);
    const remote = makeBareRemote(root, 'remote.git', 'master');
    run(['sync', 'init', '--remote', remote]);
    run(['sync', 'push']);
    const hubB = path.join(root, 'hub-b');
    makeHub(hubB, []);
    run(['sync', 'init', '--remote', remote], hubB);

    const result = run(['sync', 'pull'], hubB);

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path.join(hubB, 'skills', 'demo', 'SKILL.md'))).toBe(true);
  });

  it('prefers the branch matching this machine when the remote carries several (pull merges where push pushes)', () => {
    makeHub(home);
    const remote = makeBareRemote(root, 'remote.git', 'master');
    run(['sync', 'init', '--remote', remote]);
    run(['sync', 'push']);
    git(home, ['push', 'origin', 'main:refs/heads/dev']);
    const hubB = path.join(root, 'hub-b');
    makeHub(hubB, []);
    run(['sync', 'init', '--remote', remote], hubB);

    const result = run(['sync', 'pull'], hubB);

    expect(result.status, result.stderr).toBe(0);
    expect(git(hubB, ['log', '-1', '--pretty=%s'])).toMatch(/origin\/main/);
  });

  it('still honors the remote\'s declared HEAD when the local branch is absent (adopted repo)', () => {
    makeHub(home);
    const remote = makeBareRemote(root); // HEAD aligned at main
    run(['sync', 'init', '--remote', remote]);
    run(['sync', 'push']);
    git(home, ['push', 'origin', 'main:refs/heads/dev']);
    // B is an adopted repo on its own branch — the remote's HEAD is its guide.
    const hubB = path.join(root, 'hub-b');
    makeHub(hubB, []);
    git(hubB, ['init', '-b', 'feature-x']);
    run(['sync', 'init', '--remote', remote], hubB);

    const result = run(['sync', 'pull'], hubB);

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(path.join(hubB, 'skills', 'demo', 'SKILL.md'))).toBe(true);
    expect(git(hubB, ['log', '-1', '--pretty=%s'])).toMatch(/origin\/main/);
  });

  it('refuses honestly when nothing can pick: dangling HEAD, several branches, no local match', () => {
    makeHub(home);
    const remote = makeBareRemote(root, 'remote.git', 'master');
    run(['sync', 'init', '--remote', remote]);
    run(['sync', 'push']);
    git(home, ['push', 'origin', 'main:refs/heads/dev']);
    const hubB = path.join(root, 'hub-b');
    makeHub(hubB, []);
    git(hubB, ['init', '-b', 'feature-x']);
    run(['sync', 'init', '--remote', remote], hubB);

    const result = run(['sync', 'pull'], hubB);

    expect(result.status).not.toBe(0);
    // The refusal tells the truth about the remote: content exists (no
    // "nothing pushed" claim), the branches are named, the local branch is named.
    expect(result.stderr).not.toMatch(/nothing has been pushed/i);
    expect(result.stderr).toMatch(/dev, main/); // for-each-ref's alphabetical order
    expect(result.stderr).toMatch(/feature-x/);
    expect(result.stderr).toMatch(/set-upstream-to/);
  });

  it('keeps the accurate nothing-pushed message for a genuinely empty remote', () => {
    makeHub(home);
    const remote = makeBareRemote(root, 'remote.git', 'master');
    const hubB = path.join(root, 'hub-b');
    makeHub(hubB, []);
    run(['sync', 'init', '--remote', remote], hubB);

    const result = run(['sync', 'pull'], hubB);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/nothing has been pushed/i);
    expect(result.stderr).toMatch(/sync push/);
  });

  it('merges the same-named branch even when the remote HEAD names another (pull merges where push pushes)', () => {
    makeHub(home);
    const remote = makeBareRemote(root); // HEAD aligned at main
    run(['sync', 'init', '--remote', remote]);
    run(['sync', 'push']);
    git(home, ['push', 'origin', 'main:refs/heads/dev']);
    // An adopted repo on dev: its own pushes would land on origin/dev, so its
    // pull must merge origin/dev — not the remote's declared HEAD (origin/main).
    const hubB = path.join(root, 'hub-b');
    makeHub(hubB, []);
    git(hubB, ['init', '-b', 'dev']);
    run(['sync', 'init', '--remote', remote], hubB);

    const result = run(['sync', 'pull'], hubB);

    expect(result.status, result.stderr).toBe(0);
    expect(git(hubB, ['log', '-1', '--pretty=%s'])).toMatch(/origin\/dev/);
  });

  it('does not merge a branch the remote has deleted (fetch prunes stale tracking refs)', () => {
    makeHub(home);
    const remote = makeBareRemote(root);
    run(['sync', 'init', '--remote', remote]);
    run(['sync', 'push']);
    git(home, ['push', 'origin', 'main:refs/heads/dev']);
    const hubB = path.join(root, 'hub-b');
    makeHub(hubB, []);
    git(hubB, ['init', '-b', 'dev']);
    run(['sync', 'init', '--remote', remote], hubB);
    run(['sync', 'pull'], hubB); // fetches dev; merge lands B on origin/dev's line
    // The remote drops dev and main moves on; B pulls again — the stale
    // refs/remotes/origin/dev must not survive as a phantom merge target.
    git(home, ['push', 'origin', '--delete', 'dev']);
    expect(git(remote, ['for-each-ref', 'refs/heads/'])).not.toContain('dev');
    addSkill(home, 'post-dev');
    run(['sync', 'push']);

    const result = run(['sync', 'pull'], hubB);

    expect(result.status, result.stderr).toBe(0);
    // Without the same-named branch anymore, the target falls through to the
    // remote's declared HEAD (main) — not to a deleted dev's stale tip.
    expect(git(hubB, ['log', '-1', '--pretty=%s'])).toMatch(/origin\/main/);
    expect(existsSync(path.join(hubB, 'skills', 'post-dev', 'SKILL.md'))).toBe(true);
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
