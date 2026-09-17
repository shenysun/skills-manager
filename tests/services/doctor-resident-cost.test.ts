import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCoreServices } from '../../src/core/services/index.js';
import { createNodeFileSystem } from '../../src/infra/index.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';

/**
 * Doctor's residentCost integration (ADR-0018): the report always carries the
 * account, sourced from the ledger core — doctor never recomputes cost — and
 * the warnings array mentions resident cost only when scattered duplicates
 * exist. Doctor reports illnesses; the ledger reports accounts.
 */

const fakeGit = { statusShort: () => '', clone: () => ({ repoDir: '', commit: null }), pull: () => null, latestCommit: () => null } as never;
const fakeRunner = { run: () => ({ stdout: '', stderr: '' }) } as never;

let root: string;
let home: string;
let userHome: string;
let sourceRoot: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'doctor-cost-'));
  home = path.join(root, 'home');
  userHome = path.join(root, 'user');
  sourceRoot = path.join(root, 'source');
  for (const [name, description] of Object.entries({ alpha: 'aaaa', beta: 'bbbbbbbb' })) {
    mkdirSync(path.join(sourceRoot, 'skills', name), { recursive: true });
    writeFileSync(path.join(sourceRoot, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ntitle: ${name}\ndescription: ${description}\n---\n# ${name}\n`);
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function services(skills: string[]) {
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
  s.install.installFromSourceSelection({ source: sourceRoot, selectors: skills, overwrite: true });
  return s;
}

describe('doctor residentCost field (US16)', () => {
  it('is always present, even with zero distributions', () => {
    const s = services([]);
    const report = s.doctor.check();
    expect(report.residentCost).toEqual({
      method: 'char-approx',
      totalTokens: 0,
      unmanaged: 0,
      paths: [],
      suggestions: { archived: [], topDescriptions: [], scattered: [] },
      errors: [],
    });
  });

  it('carries the ledger core account unchanged — doctor does not recompute cost', () => {
    const s = services(['alpha', 'beta']);
    s.distribute.apply({ to: 'user', skills: ['alpha', 'beta'], agents: ['zed'] });
    const report = s.doctor.check();
    expect(report.residentCost).toEqual(s.cost.ledger());
    expect(report.residentCost.totalTokens).toBe(5); // 2 + 3
  });
});

describe('doctor warnings mention resident cost only for scattered duplicates (US17)', () => {
  it('emits no resident-cost warning on a clean account — numbers are not illnesses', () => {
    const s = services(['alpha', 'beta']);
    s.distribute.apply({ to: 'user', skills: ['alpha', 'beta'], agents: ['zed'] });
    const warnings = s.doctor.check().warnings.join('\n');
    expect(warnings).not.toMatch(/resident/i);
    expect(warnings).not.toMatch(/scattered/i);
  });

  it('warns once, pointing at the ledger, when one skill spans several physical paths', () => {
    const s = services(['alpha']);
    s.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['zed'] });
    s.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['claude-code'] });
    const { warnings, residentCost } = s.doctor.check();
    const costWarnings = warnings.filter((line) => /resident/i.test(line));
    expect(costWarnings).toHaveLength(1);
    expect(costWarnings[0]).toMatch(/scattered/i);
    expect(costWarnings[0]).toMatch(/skills-manager cost/);
    expect(residentCost.suggestions.scattered).toHaveLength(1);
  });

  it('does not duplicate the existing archived-distributed warning', () => {
    const s = services(['beta']);
    s.distribute.apply({ to: 'user', skills: ['beta'], agents: ['zed'] });
    s.archive.archiveSkills(['beta']);
    const { warnings, residentCost } = s.doctor.check();
    expect(warnings.join('\n')).toMatch(/archived/i); // the pre-existing illness report
    expect(warnings.filter((line) => /resident/i.test(line))).toHaveLength(0);
    expect(residentCost.suggestions.archived).toHaveLength(1); // the ledger carries the recall
  });
});

describe('broken symlinks agree across both surfaces (US26)', () => {
  it('reports the same runtime path in brokenLinks and residentCost.errors', () => {
    const s = services(['alpha', 'beta']);
    s.distribute.apply({ to: 'user', skills: ['alpha', 'beta'], agents: ['zed'], mode: 'symlink' });
    rmSync(path.join(home, 'skills', 'beta'), { recursive: true, force: true });
    const report = s.doctor.check();
    const runtimePath = path.join(userHome, '.agents', 'skills', 'beta');
    expect(report.brokenLinks).toContain(runtimePath);
    expect(report.residentCost.errors).toEqual([{ skill: 'beta', runtimePath, reason: 'broken symlink' }]);
  });
});
