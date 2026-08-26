import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCoreServices } from '../../src/core/services/index.js';
import { createNodeFileSystem } from '../../src/infra/index.js';
import { SkillsManagerError } from '../../src/shared/errors.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';

const fakeGit = { statusShort: () => '', clone: () => ({ repoDir: '', commit: null }), pull: () => null, latestCommit: () => null } as never;
const fakeRunner = { run: () => ({ stdout: '', stderr: '' }) } as never;

let root: string;
let home: string;
let userHome: string;
let project: string;
let sourceRoot: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'distribute-lifecycle-'));
  home = path.join(root, 'home');
  userHome = path.join(root, 'user');
  project = path.join(root, 'project');
  sourceRoot = path.join(root, 'source');
  for (const name of ['alpha', 'beta']) {
    mkdirSync(path.join(sourceRoot, 'skills', name), { recursive: true });
    writeFileSync(path.join(sourceRoot, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ntitle: ${name}\ndescription: test\n---\n# ${name}\n`);
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function services() {
  const s = createCoreServices({
    skillHomeRoot: home,
    projectRoot: root,
    fs: createNodeFileSystem(),
    git: fakeGit,
    processRunner: fakeRunner,
    userHome,
    env: {},
    catalogSnapshot: fixtureSnapshot(),
  });
  s.skillHome.ensure();
  s.install.installFromSourceSelection({ source: sourceRoot, selectors: ['alpha', 'beta'], overwrite: true });
  return s;
}

function userRecord(s: ReturnType<typeof services>) {
  return s.distribute.listIndex().find((record) => record.kind === 'user');
}

function codeOf(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    return (error as SkillsManagerError).code;
  }
  throw new Error('expected function to throw');
}

describe('reference counting across skills', () => {
  it('keeps the physical entry while any skill on the shared path still references an agent', () => {
    const s = services();
    s.distribute.apply({ to: 'user', skills: ['alpha', 'beta'], agents: ['zed', 'warp'] });
    const alphaPath = path.join(userHome, '.agents', 'skills', 'alpha');
    const betaPath = path.join(userHome, '.agents', 'skills', 'beta');
    s.distribute.undistribute({ to: 'user', skills: ['alpha'], agents: ['zed'] });
    expect(existsSync(alphaPath)).toBe(true);
    expect(userRecord(s)?.entries.find((entry) => entry.skill === 'alpha')?.agents).toEqual(['warp']);
    s.distribute.undistribute({ to: 'user', skills: ['alpha'], agents: ['warp'] });
    expect(existsSync(alphaPath)).toBe(false);
    expect(existsSync(betaPath)).toBe(true);
    expect(userRecord(s)?.entries.map((entry) => entry.skill)).toEqual(['beta']);
  });

  it('reference-counts project targets in the hub index alone', () => {
    const s = services();
    s.distribute.apply({ to: 'project', projectRoot: project, skills: ['alpha'], agents: ['zed', 'warp'] });
    s.distribute.undistribute({ to: 'project', projectRoot: project, skills: ['alpha'], agents: ['warp'] });
    const record = s.distribute.listIndex().find((item) => item.kind === 'project');
    expect(record?.entries.find((entry) => entry.skill === 'alpha')?.agents).toEqual(['zed']);
    expect(existsSync(path.join(project, '.skills-manager'))).toBe(false);
  });
});

describe('outdated and redistribute', () => {
  it('refreshes outdated copy targets on any agent dir and is idempotent', () => {
    const s = services();
    s.distribute.apply({ to: 'project', projectRoot: project, skills: ['alpha'], agents: ['zed'], mode: 'copy' });
    writeFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), `---\nname: alpha\ntitle: Alpha\ndescription: changed\n---\n# Changed\n`);
    expect(s.distribute.status().outdated).toBe(1);
    const first = s.distribute.redistributeOutdated({ to: 'project', projectRoot: project });
    expect(first.refreshed).toHaveLength(1);
    expect(readFileSync(path.join(project, '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf8')).toMatch(/Changed/);
    expect(s.distribute.status().outdated).toBe(0);
    const second = s.distribute.redistributeOutdated({ to: 'project', projectRoot: project });
    expect(second.refreshed).toHaveLength(0);
    expect(userRecord(s)?.entries).toBeUndefined();
  });

  it('reports symlink targets as outdated for audit and refreshes them without error', () => {
    const s = services();
    s.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['claude-code'], mode: 'symlink' });
    writeFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), `---\nname: alpha\ntitle: Alpha\ndescription: changed\n---\n# Changed\n`);
    expect(s.distribute.status().outdated).toBe(1);
    const refreshed = s.distribute.redistributeOutdated({ to: 'user' });
    expect(refreshed.refreshed).toHaveLength(1);
    expect(s.distribute.status().outdated).toBe(0);
  });
});

describe('rollback', () => {
  it('restores the pre-apply managed state for user targets', () => {
    const s = services();
    s.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['zed'] });
    s.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['claude-code'] });
    const claudePath = path.join(userHome, '.claude', 'skills', 'alpha');
    expect(existsSync(claudePath)).toBe(true);
    s.distribute.rollback('user');
    expect(existsSync(claudePath)).toBe(false);
    expect(existsSync(path.join(userHome, '.agents', 'skills', 'alpha'))).toBe(true);
    expect(userRecord(s)?.entries.map((entry) => entry.agents)).toEqual([['zed']]);
  });

  it('refuses project rollback: git is the restore point for project targets', () => {
    const s = services();
    s.distribute.apply({ to: 'project', projectRoot: project, skills: ['alpha'], agents: ['zed'] });
    expect(codeOf(() => s.distribute.rollback('project', project))).toBe('distribute_project_rollback_unsupported');
    expect(() => s.distribute.rollback('project', project)).toThrow(/git is the restore point/);
    expect(existsSync(path.join(project, '.agents', 'skills', 'alpha'))).toBe(true);
  });
});

describe('doctor boundary', () => {
  it('scans only runtime roots known from the hub index', () => {
    const s = services();
    s.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['zed'] });
    // Untracked dir of another agent: no index entries point there, so doctor ignores it.
    mkdirSync(path.join(userHome, '.cursor', 'skills', 'someone-elses-skill'), { recursive: true });
    const health = s.distribute.status();
    expect(health.foreign).toBe(0);
    // An unmanaged file inside a KNOWN runtime root is counted.
    mkdirSync(path.join(userHome, '.agents', 'skills', 'stray'), { recursive: true });
    expect(s.distribute.status().foreign).toBe(1);
  });

  it('reports broken links and archived/missing-hub warnings on any agent target', () => {
    const s = services();
    s.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['claude-code'], mode: 'symlink' });
    rmSync(path.join(home, 'skills', 'alpha'), { recursive: true, force: true });
    const report = s.doctor.check();
    expect(report.brokenLinks).toContain(path.join(userHome, '.claude', 'skills', 'alpha'));
    expect(report.warnings.join('\n')).toMatch(/missing from the hub: alpha/);
  });
});
