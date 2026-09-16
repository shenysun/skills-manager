import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './cli-runner.js';

/**
 * CLI seam of the frontmatter mirror at the remaining registry source write
 * points (provenance-get ticket 02, ADR-0017): update refreshes the mirror
 * with the new anchor, `edit --source-*` projects a backfilled source
 * immediately, `provenance adopt` lands registry and SKILL.md in one motion,
 * a dirty mirror never survives a write point (US11), and reprojection is
 * idempotent.
 */

let root: string;
let home: string;
let userHome: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'mirror-write-'));
  home = path.join(root, 'hub');
  userHome = path.join(root, 'user-home');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { cwd });
}

const upstreamSkillMd = (name: string, description: string) =>
  `---\nname: ${name}\ntitle: ${name}\ndescription: ${description}\n---\n# ${name}\n`;

/** A file:// git upstream whose skills/alpha content moves across commits. */
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

function installedSkillMd(skill = 'alpha'): string {
  return readFileSync(path.join(home, 'skills', skill, 'SKILL.md'), 'utf8');
}

function registrySource(skill = 'alpha') {
  return JSON.parse(run(['list']).stdout).find((item: { name: string }) => item.name === skill).source;
}

describe('update write point', () => {
  it('refreshes the mirror to the new tree-sha along with the content (US2)', () => {
    const repo = upstreamRepo();
    run(['add', `file://${repo}`, '--skill', 'alpha', '--yes']);
    const before = installedSkillMd();
    const oldTree = registrySource().upstream_tree;
    expect(before).toContain(`github-tree-sha: ${oldTree}\n`);

    writeFileSync(path.join(repo, 'skills', 'alpha', 'SKILL.md'), upstreamSkillMd('alpha', 'from upstream, renewed'));
    git(repo, 'add', '.');
    git(repo, 'commit', '-m', 'renew');

    const update = run(['update', '--skill', 'alpha']);
    expect(update.status, update.stderr).toBe(0);

    const newTree = registrySource().upstream_tree;
    const after = installedSkillMd();
    expect(after).toContain('from upstream, renewed');
    expect(after).toContain(`github-tree-sha: ${newTree}\n`);
    expect(newTree).not.toBe(oldTree);
    expect(after).not.toContain(oldTree);
  });

  it('silently overwrites a hand-corrupted mirror (US11): the registry stays the SoT', () => {
    const repo = upstreamRepo();
    run(['add', `file://${repo}`, '--skill', 'alpha', '--yes']);
    const truth = installedSkillMd();
    const tree = registrySource().upstream_tree;

    // Dirty the mirror anchors without touching anything else.
    const hubSkillMd = path.join(home, 'skills', 'alpha', 'SKILL.md');
    writeFileSync(hubSkillMd, truth
      .replace(/github-tree-sha: [0-9a-f]+/, `github-tree-sha: ${'0'.repeat(40)}`)
      .replace(/github-repo: .*/, 'github-repo: https://github.com/fake/repo'));

    const update = run(['update', '--skill', 'alpha']);
    expect(update.status, update.stderr).toBe(0);
    // No upstream change: the only difference from `truth` is nothing — the
    // dirty mirror was reprojected back to the registry's evidence.
    expect(installedSkillMd()).toBe(truth);
    expect(installedSkillMd()).toContain(`github-tree-sha: ${tree}\n`);
    expect(installedSkillMd()).toContain(`github-repo: file://${repo}\n`);
  });

  it('reprojects idempotently: repeated write points add no keys and no diff noise', () => {
    const repo = upstreamRepo();
    run(['add', `file://${repo}`, '--skill', 'alpha', '--yes']);

    const first = run(['update', '--skill', 'alpha']);
    expect(first.status, first.stderr).toBe(0);
    const afterFirst = installedSkillMd();
    const second = run(['update', '--skill', 'alpha']);
    expect(second.status, second.stderr).toBe(0);

    expect(installedSkillMd()).toBe(afterFirst);
    for (const key of ['github-repo:', 'github-tree-sha:', 'github-path:', 'skills-manager-written-by:']) {
      expect(afterFirst.match(new RegExp(key, 'g'))?.length, key).toBe(1);
    }
  });

  it('survives a structurally broken frontmatter: the registry write succeeds, the file waits for repair', () => {
    const repo = upstreamRepo();
    run(['add', `file://${repo}`, '--skill', 'alpha', '--yes']);
    // Hand-mangle the YAML beyond parsing — reprojection must skip, not kill
    // the write point (the registry SoT still lands).
    const hubSkillMd = path.join(home, 'skills', 'alpha', 'SKILL.md');
    writeFileSync(hubSkillMd, `---\nname: [unclosed\n  broken yaml\n---\n# alpha\n`);

    const edit = run(['edit', 'alpha', '--title', 'Still Editable']);
    expect(edit.status, edit.stderr).toBe(0);
    expect(JSON.parse(edit.stdout).title).toBe('Still Editable');
    // The broken file is left exactly as it was — no destructive rewrite.
    expect(installedSkillMd()).toBe(`---\nname: [unclosed\n  broken yaml\n---\n# alpha\n`);
  });
});

describe('edit --source-* write point', () => {
  it('projects the mirror the moment a source is backfilled (US3)', () => {
    // A source-less local install first: no mirror until a real source lands.
    const local = path.join(root, 'local-source');
    mkdirSync(path.join(local, 'skills', 'alpha'), { recursive: true });
    writeFileSync(path.join(local, 'skills', 'alpha', 'SKILL.md'), upstreamSkillMd('alpha', 'locally added'));
    run(['add', local, '--skill', 'alpha', '--yes']);
    expect(installedSkillMd()).not.toContain('github-repo:');

    const edit = run(['edit', 'alpha', '--source-git', 'vercel-labs/skills', '--subpath', 'skills/find-skills', '--source-ref', 'v1.2.3']);
    expect(edit.status, edit.stderr).toBe(0);

    const skillMd = installedSkillMd();
    expect(skillMd).toContain('github-repo: https://github.com/vercel-labs/skills.git\n');
    expect(skillMd).toContain('github-path: skills/find-skills\n');
    expect(skillMd).toContain('github-ref: v1.2.3\n');
    expect(skillMd).toContain('skills-manager-written-by: skills-manager-cli\n');
    // No anchor exists yet (edit does not check out upstream) — no fake tree-sha.
    expect(skillMd).not.toContain('github-tree-sha');
  });

  it('treats an edited skill exactly like an installed one: values correspond 1:1 to the registry', () => {
    const local = path.join(root, 'local-source');
    mkdirSync(path.join(local, 'skills', 'alpha'), { recursive: true });
    writeFileSync(path.join(local, 'skills', 'alpha', 'SKILL.md'), upstreamSkillMd('alpha', 'locally added'));
    run(['add', local, '--skill', 'alpha', '--yes']);
    run(['edit', 'alpha', '--source-git', 'vercel-labs/skills', '--subpath', 'skills/find-skills']);

    const source = registrySource();
    const skillMd = installedSkillMd();
    expect(skillMd).toContain(`github-repo: ${source.url}\n`);
    expect(skillMd).toContain(`github-path: ${source.subpath}\n`);
  });
});

describe('provenance adopt write point', () => {
  /** Imported-without-source fixture + lockfile evidence, as in provenance.test.ts. */
  function importedFixture() {
    const dir = path.join(home, 'skills', 'legacy');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: legacy\ntitle: legacy\ndescription: fixture\n---\n# legacy\n`);
    const registryFile = path.join(home, 'registry.yaml');
    writeFileSync(registryFile, [
      'skills:',
      '  legacy:',
      '    path: skills/legacy',
      '    title: legacy',
      '    category: experimental',
      '    tags: []',
      '    consumers: []',
      '    source: {type: local, url: null, subpath: null, ref: null, upstream_commit: null, baseline_hash: null}',
      '    update_policy: manual',
      '    description: fixture',
      "    imported: true",
      "    imported_at: '2026-08-01T00:00:00.000Z'",
      '',
    ].join('\n'));
    mkdirSync(path.join(userHome, '.agents'), { recursive: true });
    writeFileSync(path.join(userHome, '.agents', '.skill-lock.json'), JSON.stringify({
      version: 3,
      skills: {
        legacy: { sourceType: 'github', sourceUrl: 'https://github.com/owner/repo.git', skillPath: 'skills/legacy/SKILL.md', skillFolderHash: 'tree-sha-legacy' },
      },
    }));
  }

  it('lands registry and SKILL.md in one motion: the adopted evidence mirrors immediately (US4)', () => {
    importedFixture();
    const adopt = run(['provenance', 'adopt']);
    expect(adopt.status, adopt.stderr).toBe(0);

    const source = registrySource('legacy');
    expect(source).toMatchObject({ type: 'git', url: 'https://github.com/owner/repo.git', subpath: 'skills/legacy' });

    const skillMd = installedSkillMd('legacy');
    expect(skillMd).toContain('github-repo: https://github.com/owner/repo.git\n');
    expect(skillMd).toContain('github-path: skills/legacy\n');
    expect(skillMd).toContain('skills-manager-written-by: skills-manager-cli\n');
    // baseline_hash is not a tree anchor — the mirror invents no tree-sha.
    expect(skillMd).not.toContain('github-tree-sha');
  });

  it('leaves nothing behind on --dry-run: no adoption, no mirror', () => {
    importedFixture();
    const dry = run(['provenance', 'adopt', '--dry-run']);
    expect(dry.status, dry.stderr).toBe(0);
    expect(installedSkillMd('legacy')).not.toContain('github-repo');
  });
});
