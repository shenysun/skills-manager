import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './cli-runner.js';

/**
 * CLI seam of the frontmatter provenance mirror (provenance-get ticket 01,
 * ADR-0017): a git-source install grows the `metadata:` mirror block in the
 * installed SKILL.md, unknown frontmatter keys ride along untouched, the
 * mirror counts into the content fingerprint (copy targets auto-refresh), and
 * no user lockfile is ever written (ADR-0011).
 */

let root: string;
let home: string;
let userHome: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'mirror-cli-'));
  home = path.join(root, 'hub');
  userHome = path.join(root, 'user-home');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { cwd });
}

/** Upstream SKILL.md carrying keys we do not own: a top-level unknown key and
 *  a gh-written metadata.local-path — both must survive our install (US15). */
const upstreamSkillMd = (name: string, description: string) =>
  `---\nname: ${name}\ntitle: ${name}\ndescription: ${description}\nallowed-tools: Bash, Read\nmetadata:\n    local-path: /home/monalisa/skills/${name}\n---\n# ${name}\n`;

function upstreamRepo(): string {
  const repo = path.join(root, 'upstream');
  const dir = path.join(repo, 'skills', 'alpha');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), upstreamSkillMd('alpha', 'from upstream'));
  git(repo, 'init', '--initial-branch=main');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'init');
  return repo;
}

function run(args: string[]) {
  return runCli(home, userHome, args);
}

function installedSkillMd(): string {
  return readFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), 'utf8');
}

function registryEntry() {
  return JSON.parse(run(['list']).stdout).find((skill: { name: string }) => skill.name === 'alpha');
}

describe('git-source install mirror', () => {
  it('grows a metadata mirror whose fields correspond 1:1 to the registry entry source', () => {
    const repo = upstreamRepo();
    const install = run(['add', `file://${repo}`, '--skill', 'alpha', '--yes']);
    expect(install.status, install.stderr).toBe(0);

    const entry = registryEntry();
    const skillMd = installedSkillMd();
    expect(skillMd).toContain(`github-repo: file://${repo}\n`);
    expect(skillMd).toContain(`github-tree-sha: ${entry.source.upstream_tree}\n`);
    expect(skillMd).toContain('github-path: skills/alpha\n');
    expect(skillMd).toContain('skills-manager-written-by: skills-manager-cli\n');
    expect(skillMd).toMatch(/github-tree-sha: [0-9a-f]{40}\n/);
    // Default clone resolves no explicit ref: the anchor-less key set omits github-ref.
    expect(skillMd).not.toContain('github-ref');
  });

  it('preserves unknown frontmatter keys and gh-written metadata (US15)', () => {
    const repo = upstreamRepo();
    run(['add', `file://${repo}`, '--skill', 'alpha', '--yes']);
    const skillMd = installedSkillMd();
    expect(skillMd).toContain('allowed-tools: Bash, Read');
    expect(skillMd).toContain('local-path: /home/monalisa/skills/alpha');
    expect(skillMd).toContain('# alpha\n');
  });

  it('never writes a user skill lockfile (ADR-0011 red line)', () => {
    const repo = upstreamRepo();
    run(['add', `file://${repo}`, '--skill', 'alpha', '--yes']);
    expect(existsSync(path.join(userHome, '.agents', '.skill-lock.json'))).toBe(false);
  });

  it('counts the mirror into the fingerprint: a changed upstream auto-refreshes copy targets (US17)', () => {
    const repo = upstreamRepo();
    run(['add', `file://${repo}`, '--skill', 'alpha', '--yes']);
    run(['distribute', '--to', 'user', '--skill', 'alpha', '--agent', 'zed', '--mode', 'copy']);
    const copyBefore = readFileSync(path.join(userHome, '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf8');

    // New upstream commit: the skill content and its tree-sha anchor move together.
    writeFileSync(path.join(repo, 'skills', 'alpha', 'SKILL.md'), upstreamSkillMd('alpha', 'from upstream, renewed'));
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'renew');
    const reinstall = run(['add', `file://${repo}`, '--skill', 'alpha', '--yes']);
    expect(reinstall.status, reinstall.stderr).toBe(0);

    const skillMd = installedSkillMd();
    const copyAfter = readFileSync(path.join(userHome, '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf8');
    expect(skillMd).toContain('from upstream, renewed');
    // The redistribution during install carried the fingerprint change out.
    expect(copyAfter).not.toBe(copyBefore);
    expect(copyAfter).toBe(skillMd);
  });

  it('marks a copy target stale on a mirror-only byte change — the mirror gets no fingerprint exemption (US17)', () => {
    const repo = upstreamRepo();
    run(['add', `file://${repo}`, '--skill', 'alpha', '--yes']);
    run(['distribute', '--to', 'user', '--skill', 'alpha', '--agent', 'zed', '--mode', 'copy']);
    const fresh = JSON.parse(run(['doctor']).stdout);
    expect(fresh.distribution.outdated).toBe(0);

    // Rewrite ONLY the mirror anchor line in the hub file — body and every
    // other byte identical, so any fingerprint delta is the mirror's alone.
    const hubSkillMd = path.join(home, 'skills', 'alpha', 'SKILL.md');
    const before = readFileSync(hubSkillMd, 'utf8');
    writeFileSync(hubSkillMd, before.replace(/github-tree-sha: [0-9a-f]+/, `github-tree-sha: ${'0'.repeat(40)}`));
    expect(readFileSync(hubSkillMd, 'utf8')).not.toBe(before);

    const stale = JSON.parse(run(['doctor']).stdout);
    expect(stale.distribution.outdated).toBe(1);
    const refreshed = run(['redistribute', '--refresh']);
    expect(refreshed.status, refreshed.stderr).toBe(0);
    expect(readFileSync(path.join(userHome, '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf8')).toBe(readFileSync(hubSkillMd, 'utf8'));
    expect(JSON.parse(run(['doctor']).stdout).distribution.outdated).toBe(0);
  });
});
