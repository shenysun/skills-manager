import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GitPort } from '../../src/core/ports/git.js';
import { createCoreServices } from '../../src/core/services/index.js';
import { createNodeFileSystem } from '../../src/infra/index.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';

const COMMIT_1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const COMMIT_2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const TREE_ALPHA = '1111111111111111111111111111111111111111';
const TREE_ALPHA_2 = '2222222222222222222222222222222222222222';
const TREE_BETA = '3333333333333333333333333333333333333333';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'upstream-anchor-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * Fake transport after ticket 01: "clone" materializes the upstream working
 * tree (a shallow clone has no history to fake) and rev-parse answers from
 * mutable state, so an update run can move upstream between two states.
 */
function fakeGit(upstreamDir: string) {
  const cloneDirs: string[] = [];
  const revParseTreeCalls: Array<{ repoDir: string; subpath: string }> = [];
  const state = { commit: COMMIT_1, trees: { 'skills/alpha': TREE_ALPHA, 'skills/beta': TREE_BETA } };
  const git: GitPort = {
    clone: (_repoUrl, destination) => {
      cloneDirs.push(destination);
      cpSync(upstreamDir, destination, { recursive: true });
    },
    revParseHead: () => state.commit,
    revParseTree: (repoDir, subpath) => {
      revParseTreeCalls.push({ repoDir, subpath });
      return state.trees[subpath] ?? 'unmapped';
    },
    listRemoteHeads: () => [],
    statusShort: () => '',
    log: () => [],
  };
  return { git, state, cloneDirs, revParseTreeCalls };
}

function services(git: GitPort, homeName = 'home') {
  const s = createCoreServices({
    skillHomeRoot: path.join(root, homeName),
    projectRoot: root,
    fs: createNodeFileSystem(),
    git,
    processRunner: { run: () => ({ status: 0, stdout: '', stderr: '' }) } as never,
    tempRoot: path.join(root, 'tmp'),
    userHome: path.join(root, 'user'),
    env: {},
    catalogSnapshot: fixtureSnapshot(),
  });
  s.skillHome.ensure();
  return s;
}

function writeUpstream(names: readonly string[]) {
  const upstream = path.join(root, 'upstream');
  for (const name of names) {
    mkdirSync(path.join(upstream, 'skills', name), { recursive: true });
    writeFileSync(path.join(upstream, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ntitle: ${name}\ndescription: d\n---\n# ${name}\n`);
  }
  return upstream;
}

function registryYaml(homeName = 'home') {
  return readFileSync(path.join(root, homeName, 'registry.yaml'), 'utf8');
}

describe('source anchor persistence (ADR-0013)', () => {
  it('records upstream_commit and upstream_tree together on install from a git source', () => {
    const upstream = writeUpstream(['alpha']);
    const { git } = fakeGit(upstream);
    const s = services(git);

    s.install.installFromSourceSelection({ source: 'https://github.com/owner/repo.git', selectors: ['skills/alpha'] });

    expect(registryYaml()).toContain(`upstream_commit: ${COMMIT_1}`);
    // All-digit tree SHAs are YAML-quoted (a bare digits scalar would read as a number).
    expect(registryYaml()).toContain(`upstream_tree: "${TREE_ALPHA}"`);
    expect(s.registry.load().skills.alpha?.source).toMatchObject({
      upstream_commit: COMMIT_1,
      upstream_tree: TREE_ALPHA,
    });
  });

  it('anchors each skill on its own sub-directory tree SHA', () => {
    const upstream = writeUpstream(['alpha', 'beta']);
    const { git, revParseTreeCalls } = fakeGit(upstream);
    const s = services(git);

    s.install.installFromSourceSelection({ source: 'https://github.com/owner/repo.git', selectors: ['skills/alpha', 'skills/beta'] });

    expect(revParseTreeCalls.map((call) => call.subpath).sort()).toEqual(['skills/alpha', 'skills/beta']);
    expect(s.registry.load().skills.alpha?.source?.upstream_tree).toBe(TREE_ALPHA);
    expect(s.registry.load().skills.beta?.source?.upstream_tree).toBe(TREE_BETA);
  });

  it('anchors a repo-root skill on the commit SHA — what the GitHub Trees API reports for the root', () => {
    const upstream = path.join(root, 'upstream-root');
    mkdirSync(upstream, { recursive: true });
    writeFileSync(path.join(upstream, 'SKILL.md'), '---\nname: rooted\ntitle: rooted\ndescription: d\n---\n# rooted\n');
    const { git } = fakeGit(upstream);
    const s = services(git);

    s.install.installFromSourceSelection({ source: 'https://github.com/owner/repo.git', selectors: ['rooted'] });

    expect(s.registry.load().skills.rooted?.source?.subpath).toBe('');
    expect(s.registry.load().skills.rooted?.source?.upstream_tree).toBe(COMMIT_1);
  });

  it('refreshes both anchors after an update — the update path reuses the install write point', () => {
    const upstream = writeUpstream(['alpha']);
    const { git, state } = fakeGit(upstream);
    const s = services(git);
    s.install.installFromSourceSelection({ source: 'https://github.com/owner/repo.git', selectors: ['skills/alpha'] });

    state.commit = COMMIT_2;
    state.trees['skills/alpha'] = TREE_ALPHA_2;
    s.update.updateSkills(['alpha']);

    expect(s.registry.load().skills.alpha?.source).toMatchObject({
      upstream_commit: COMMIT_2,
      upstream_tree: TREE_ALPHA_2,
    });
    expect(registryYaml()).toContain(`upstream_tree: "${TREE_ALPHA_2}"`);
  });

  it('writes no git anchor for local sources', () => {
    const local = writeUpstream(['alpha']);
    const { git, revParseTreeCalls } = fakeGit(local);
    const s = services(git);

    s.install.installFromSourceSelection({ source: local, selectors: ['skills/alpha'] });

    expect(s.registry.load().skills.alpha?.source?.type).toBe('local');
    expect(s.registry.load().skills.alpha?.source?.upstream_tree).toBeNull();
    expect(revParseTreeCalls).toEqual([]);
  });

  it('treats a legacy registry entry without the field as uncalibrated (null)', () => {
    const home = path.join(root, 'legacy-home');
    const skillsDir = path.join(home, 'skills', 'alpha');
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(path.join(skillsDir, 'SKILL.md'), '---\nname: alpha\n---\n# a\n');
    writeFileSync(path.join(home, 'registry.yaml'), [
      'skills:',
      '  alpha:',
      '    path: skills/alpha',
      '    title: alpha',
      '    source:',
      '      type: git',
      `      url: https://github.com/owner/repo.git`,
      '      subpath: skills/alpha',
      `      upstream_commit: ${COMMIT_1}`,
      '      baseline_hash: null',
      '    update_policy: manual',
      '    description: ""',
      '    tags: []',
      '    consumers: []',
      '    category: experimental',
      '    archived: false',
      '    imported: false',
      '    imported_at: null',
      ''
    ].join('\n'));

    const { git } = fakeGit(path.join(root, 'unused'));
    const s = services(git, 'legacy-home');

    // Missing field loads as null-equivalent: "not calibrated", never a crash.
    expect(s.registry.load().skills.alpha?.source?.upstream_tree ?? null).toBeNull();
    expect(s.registry.load().skills.alpha?.source?.upstream_commit).toBe(COMMIT_1);
  });
});
