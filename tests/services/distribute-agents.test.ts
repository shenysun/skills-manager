import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
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
  root = mkdtempSync(path.join(tmpdir(), 'distribute-agents-'));
  home = path.join(root, 'home');
  userHome = path.join(root, 'user');
  project = path.join(root, 'project');
  sourceRoot = path.join(root, 'source');
  mkdirSync(path.join(sourceRoot, 'skills', 'alpha'), { recursive: true });
  writeFileSync(path.join(sourceRoot, 'skills', 'alpha', 'SKILL.md'), `---\nname: alpha\ntitle: Alpha\ndescription: test\n---\n# Alpha\n`);
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
  s.install.installFromSourceSelection({ source: sourceRoot, selectors: ['alpha'], overwrite: true });
  return s;
}

function codeOf(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    return (error as SkillsManagerError).code;
  }
  throw new Error('expected function to throw');
}

describe('distribute apply with catalog agents', () => {
  it('writes a shared runtime path once and records all motivating agent ids in the logical layer', () => {
    const s = services();
    const result = s.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['zed', 'warp'] });
    const shared = path.join(userHome, '.agents', 'skills', 'alpha');
    expect(existsSync(shared)).toBe(true);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ skill: 'alpha', runtimePath: shared, mode: 'symlink', managed: true, agents: ['warp', 'zed'] });
    expect(result.entries[0].fingerprint).toMatch(/^sha256:/);
    const record = s.distribute.listIndex().find((item) => item.kind === 'user');
    expect(record?.entries).toHaveLength(1);
    expect(record?.entries[0].agents.sort()).toEqual(['warp', 'zed']);
  });

  it('applies to the detected set when no agents are given', () => {
    const s = services();
    mkdirSync(path.join(userHome, '.claude'), { recursive: true });
    mkdirSync(path.join(userHome, '.cursor'), { recursive: true });
    const result = s.distribute.apply({ to: 'user', skills: ['alpha'] });
    expect(result.agents).toEqual(['claude-code', 'cursor']);
    expect(existsSync(path.join(userHome, '.claude', 'skills', 'alpha'))).toBe(true);
    expect(existsSync(path.join(userHome, '.cursor', 'skills', 'alpha'))).toBe(true);
  });

  it('defaults user to symlink and project to copy, overridable per apply', () => {
    const s = services();
    expect(s.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['claude-code'] }).mode).toBe('symlink');
    expect(s.distribute.apply({ to: 'project', projectRoot: project, skills: ['alpha'], agents: ['cursor'] }).mode).toBe('copy');
    expect(s.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['claude-code'], mode: 'copy' }).mode).toBe('copy');
    expect(existsSync(path.join(userHome, '.claude', 'skills', 'alpha', 'SKILL.md'))).toBe(true);
  });

  it('writes a dual-layer project receipt at .skills-manager/distribute.yaml', () => {
    const s = services();
    s.distribute.apply({ to: 'project', projectRoot: project, skills: ['alpha'], agents: ['zed', 'warp'] });
    const receipt = YAML.parse(readFileSync(path.join(project, '.skills-manager', 'distribute.yaml'), 'utf8')) as {
      version: number;
      skills: Record<string, { entries: Array<{ path: string; mode: string; fingerprint: string; managed: boolean; agents: string[] }> }>;
    };
    expect(receipt.version).toBe(2);
    const entries = receipt.skills.alpha.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ path: path.join(project, '.agents', 'skills', 'alpha'), mode: 'copy', managed: true });
    expect(entries[0].agents.sort()).toEqual(['warp', 'zed']);
    expect(entries[0].fingerprint).toMatch(/^sha256:/);
  });

  it('refuses foreign targets by default and overwrites with force', () => {
    const s = services();
    const foreign = path.join(userHome, '.claude', 'skills', 'alpha');
    mkdirSync(foreign, { recursive: true });
    writeFileSync(path.join(foreign, 'SKILL.md'), '# foreign\n');
    expect(codeOf(() => s.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['claude-code'] }))).toBe('distribute_foreign_exists');
    s.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['claude-code'], force: true });
    expect(existsSync(path.join(foreign, 'SKILL.md'))).toBe(true);
    expect(s.distribute.listIndex().find((item) => item.kind === 'user')?.entries).toHaveLength(1);
  });

  it('rejects project-only agents on user scope with an actionable reason', () => {
    const s = services();
    const code = codeOf(() => s.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['eve'] }));
    expect(code).toBe('distribute_agent_project_only');
    try {
      s.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['eve'] });
    } catch (error) {
      expect((error as Error).message).toMatch(/project-only/i);
    }
    s.distribute.apply({ to: 'project', projectRoot: project, skills: ['alpha'], agents: ['eve'] });
    expect(existsSync(path.join(project, 'agent', 'skills', 'alpha'))).toBe(true);
  });

  it('rejects unknown agent ids and empty detection with actionable errors', () => {
    const s = services();
    expect(codeOf(() => s.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['not-an-agent'] }))).toBe('distribute_unknown_agent');
    expect(codeOf(() => s.distribute.apply({ to: 'user', skills: ['alpha'] }))).toBe('distribute_no_agents');
  });

  it('reference-counts shared paths on undistribute: dropping one agent keeps the physical entry', () => {
    const s = services();
    s.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['zed', 'warp'] });
    const shared = path.join(userHome, '.agents', 'skills', 'alpha');
    const afterOne = s.distribute.undistribute({ to: 'user', skills: ['alpha'], agents: ['warp'] });
    expect(afterOne.removed).toHaveLength(0);
    expect(existsSync(shared)).toBe(true);
    const entry = s.distribute.listIndex().find((item) => item.kind === 'user')?.entries[0];
    expect(entry?.agents).toEqual(['zed']);
    const afterLast = s.distribute.undistribute({ to: 'user', skills: ['alpha'], agents: ['zed'] });
    expect(afterLast.removed).toHaveLength(1);
    expect(existsSync(shared)).toBe(false);
  });

  it('keeps exactly one mode per apply across a whole agent family', () => {
    const s = services();
    const result = s.distribute.apply({ to: 'project', projectRoot: project, skills: ['alpha'], agents: ['zed', 'warp', 'claude-code'], mode: 'copy' });
    expect(new Set(result.entries.map((entry) => entry.mode))).toEqual(new Set(['copy']));
    expect(result.entries).toHaveLength(2);
    expect(result.entries.find((entry) => entry.runtimePath.endsWith(path.join('.agents', 'skills', 'alpha')))?.agents.sort()).toEqual(['warp', 'zed']);
    expect(result.entries.find((entry) => entry.runtimePath.endsWith(path.join('.claude', 'skills', 'alpha')))?.agents).toEqual(['claude-code']);
  });
});
