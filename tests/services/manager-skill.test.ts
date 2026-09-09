import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCoreServices } from '../../src/core/services/index.js';
import { createNodeFileSystem } from '../../src/infra/index.js';
import { compareDateVersions } from '../../src/core/services/manager-skill-service.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';

const fakeGit = { statusShort: () => '', clone: () => ({ repoDir: '', commit: null }), pull: () => null, latestCommit: () => null } as never;
const fakeRunner = { run: () => ({ stdout: '', stderr: '' }) } as never;

let root: string;
let home: string;
let userHome: string;
let bundleRoot: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'manager-skill-'));
  home = path.join(root, 'home');
  userHome = path.join(root, 'user');
  bundleRoot = path.join(root, 'bundle');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function services() {
  return createCoreServices({
    skillHomeRoot: home,
    projectRoot: root,
    fs: createNodeFileSystem(),
    git: fakeGit,
    processRunner: fakeRunner,
    userHome,
    env: {},
    catalogSnapshot: fixtureSnapshot(),
  });
}

const bundle = (version = '2026.9.9') => ({ root: bundleRoot, version, repoUrl: 'https://github.com/shenysun/skills-manager.git' });

/** The npm package's bundled copy: bundleRoot/skills/skills-manager/SKILL.md. */
function makeBundledSkill(body = '# manager v1\n') {
  const dir = path.join(bundleRoot, 'skills', 'skills-manager');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: skills-manager\ntitle: Skills Manager\ndescription: Operate the skills-manager CLI\n---\n${body}`);
  return dir;
}

describe('ManagerSkillService.seed (ADR-0014)', () => {
  it('seeds the bundled copy into an empty hub with a git source and baseline', () => {
    makeBundledSkill();
    const s = services();

    const result = s.managerSkill.seed(bundle());

    expect(result.status).toBe('seeded');
    expect(result.fingerprint).toMatch(/^sha256:/);
    expect(existsSync(path.join(home, 'skills', 'skills-manager', 'SKILL.md'))).toBe(true);
    expect(s.registry.getEntry('skills-manager')).toMatchObject({
      title: 'Skills Manager',
      source: { type: 'git', url: 'https://github.com/shenysun/skills-manager.git', subpath: 'skills/skills-manager', ref: 'v2026.9.9' },
    });
    expect(s.registry.getEntry('skills-manager')?.source?.baseline_hash).toBe(result.fingerprint);
  });

  it('is idempotent: an unchanged bundle reports up-to-date', () => {
    makeBundledSkill();
    const s = services();
    s.managerSkill.seed(bundle());

    expect(s.managerSkill.seed(bundle()).status).toBe('up-to-date');
  });

  it('refreshes a copy it still owns when the bundle changes', () => {
    makeBundledSkill('# manager v1\n');
    const s = services();
    s.managerSkill.seed(bundle());
    makeBundledSkill('# manager v2\n');

    const result = s.managerSkill.seed(bundle('2026.9.10'));

    expect(result.status).toBe('refreshed');
    expect(readFileSync(path.join(home, 'skills', 'skills-manager', 'SKILL.md'), 'utf8')).toContain('manager v2');
    expect(s.registry.getEntry('skills-manager')?.source).toMatchObject({ ref: 'v2026.9.10', baseline_hash: result.fingerprint });
  });

  it('never touches a user-edited copy (baseline no longer matches)', () => {
    makeBundledSkill('# manager v1\n');
    const s = services();
    s.managerSkill.seed(bundle());
    writeFileSync(path.join(home, 'skills', 'skills-manager', 'SKILL.md'), '# hand-tuned\n');
    makeBundledSkill('# manager v2\n');

    const result = s.managerSkill.seed(bundle('2026.9.10'));

    expect(result.status).toBe('user-managed');
    expect(readFileSync(path.join(home, 'skills', 'skills-manager', 'SKILL.md'), 'utf8')).toBe('# hand-tuned\n');
  });

  it('never rolls the hub copy back to an older bundle', () => {
    makeBundledSkill('# manager v1\n');
    const s = services();
    s.managerSkill.seed(bundle('2026.9.10'));
    makeBundledSkill('# manager v0 older\n');

    const result = s.managerSkill.seed(bundle('2026.9.9'));

    expect(result.status).toBe('user-managed');
    expect(readFileSync(path.join(home, 'skills', 'skills-manager', 'SKILL.md'), 'utf8')).toContain('manager v1');
  });

  it('throws when the package ships no bundled copy', () => {
    const s = services();
    expect(() => s.managerSkill.seed(bundle())).toThrow(/Bundled manager skill not found/);
  });
});

describe('ManagerSkillService.selfCheck', () => {
  it('reports null while the hub holds no manager skill — an ordinary command never seeds', () => {
    makeBundledSkill();
    const s = services();
    expect(s.managerSkill.selfCheck(bundle())).toBeNull();
    expect(existsSync(path.join(home, 'skills'))).toBe(false);
  });

  it('delegates to seed once the skill exists', () => {
    makeBundledSkill();
    const s = services();
    s.managerSkill.seed(bundle());
    expect(s.managerSkill.selfCheck(bundle())?.status).toBe('up-to-date');
  });
});

describe('compareDateVersions', () => {
  it('orders date-versioned release tags segment by segment', () => {
    expect(compareDateVersions('2026.9.9', '2026.9.10')).toBeLessThan(0);
    expect(compareDateVersions('2026.10.2', '2026.9.30')).toBeGreaterThan(0);
    expect(compareDateVersions('v2026.9.9', '2026.9.9')).toBe(0);
    expect(compareDateVersions('2026.9.9-2', '2026.9.9')).toBeGreaterThan(0);
    expect(compareDateVersions('2026.9.9-2', '2026.9.9-3')).toBeLessThan(0);
  });
});
