import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCoreServices } from '../../src/core/services/index.js';
import { createNodeFileSystem } from '../../src/infra/index.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';

/**
 * The cost ledger's counting core (ADR-0018): fixture hub (registry +
 * distribution index) plus real runtime directories; assertions are on the
 * ledger's external values — groups, tokens, unmanaged count — never internal
 * call order. Token expectations are worked by hand from the char-approx rule
 * (CJK ×1, others ÷4).
 */

const fakeGit = { statusShort: () => '', clone: () => ({ repoDir: '', commit: null }), pull: () => null, latestCommit: () => null } as never;
const fakeRunner = { run: () => ({ stdout: '', stderr: '' }) } as never;

let root: string;
let home: string;
let userHome: string;
let project: string;
let sourceRoot: string;

/** Fixture skills with hand-computable resident costs: name tokens then
 *  description tokens under char-approx (ASCII ÷4).
 *  - alpha: name 5 -> 1, desc 'aaaa' 4 -> 1            = 2
 *  - beta:  name 4 -> 1, desc 'bbbbbbbb' 8 -> 2        = 3
 *  - gamma: name 5 -> 1, zh desc 9 CJK + 5 -> 10       = 11
 *  - six ascending descriptions for --top ordering. */
const ZH_DESCRIPTION = '提交代码变更到 git 仓库'; // 9 CJK + 5 others -> 10

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'cost-ledger-'));
  home = path.join(root, 'home');
  userHome = path.join(root, 'user');
  project = path.join(root, 'project');
  sourceRoot = path.join(root, 'source');
  const descriptions: Record<string, string> = {
    alpha: 'aaaa', // 1
    beta: 'bbbbbbbb', // 2
    gamma: ZH_DESCRIPTION, // 10
    one: 'cccccccccccc', // 3
    two: 'dddddddddddddddd', // 4
    three: 'eeeeeeeeeeeeeeeeeeee', // 5
    four: 'ffffffffffffffffffffffff', // 6
    five: 'gggggggggggggggggggggggggggg', // 7
  };
  for (const [name, description] of Object.entries(descriptions)) {
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

describe('ledger grouping and counting', () => {
  it('counts a shared physical path once, noting its agent family (US4)', () => {
    const s = services(['alpha']);
    s.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['zed', 'warp'] });
    const ledger = s.cost.ledger();
    expect(ledger.paths).toHaveLength(1);
    const group = ledger.paths[0];
    expect(group.runtimeDir).toBe(path.join(userHome, '.agents', 'skills'));
    expect(group.agents).toEqual(['warp', 'zed']);
    expect(group.tokens).toBe(2); // alpha counted once, not once per agent
    expect(ledger.totalTokens).toBe(2);
  });

  it('counts user and project runtime paths in one account (US5)', () => {
    const s = services(['alpha', 'gamma']);
    s.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['zed'] });
    s.distribute.apply({ to: 'project', projectRoot: project, skills: ['gamma'], agents: ['eve'] });
    const ledger = s.cost.ledger();
    expect(ledger.paths).toHaveLength(2);
    expect(ledger.paths.map((group) => group.kind).sort()).toEqual(['project', 'user']);
    expect(ledger.totalTokens).toBe(13); // 2 + 11
  });

  it('sizes a zh description by char-approx with a name/description breakdown (US1/US3)', () => {
    const s = services(['gamma']);
    s.distribute.apply({ to: 'user', skills: ['gamma'], agents: ['zed'] });
    const line = s.cost.ledger().paths[0].skills[0];
    expect(line.skill).toBe('gamma');
    expect(line.nameTokens).toBe(1);
    expect(line.descriptionTokens).toBe(10);
    expect(line.tokens).toBe(11);
  });

  it('reports unmanaged (foreign) entries as one count, never per-skill detail (US6)', () => {
    const s = services(['alpha']);
    s.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['zed'] });
    mkdirSync(path.join(userHome, '.agents', 'skills', 'stranger'), { recursive: true });
    const ledger = s.cost.ledger();
    expect(ledger.unmanaged).toBe(1);
    const names = ledger.paths.flatMap((group) => group.skills.map((line) => line.skill));
    expect(names).not.toContain('stranger');
  });

  it('carries method: char-approx on every ledger (US19)', () => {
    const s = services(['alpha']);
    s.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['zed'] });
    expect(s.cost.ledger().method).toBe('char-approx');
  });
});

describe('ledger defect honesty (Round 2 behavior contract)', () => {
  it('counts an unreadable SKILL.md as 0 and lists it in the errors section (US14)', () => {
    const s = services(['alpha', 'beta']);
    s.distribute.apply({ to: 'user', skills: ['alpha', 'beta'], agents: ['zed'], mode: 'copy' });
    rmSync(path.join(userHome, '.agents', 'skills', 'beta', 'SKILL.md'));
    const ledger = s.cost.ledger();
    expect(ledger.errors).toEqual([{ skill: 'beta', runtimePath: path.join(userHome, '.agents', 'skills', 'beta'), reason: 'SKILL.md unreadable' }]);
    expect(ledger.totalTokens).toBe(2); // alpha only
    expect(ledger.paths[0].skills.map((line) => line.skill)).toEqual(['alpha']);
  });

  it('counts a broken symlink as 0 with an error, consistent with doctor broken-link reporting (US26)', () => {
    const s = services(['alpha', 'beta']);
    s.distribute.apply({ to: 'user', skills: ['alpha', 'beta'], agents: ['zed'], mode: 'symlink' });
    rmSync(path.join(home, 'skills', 'beta'), { recursive: true, force: true });
    const ledger = s.cost.ledger();
    expect(ledger.errors).toEqual([{ skill: 'beta', runtimePath: path.join(userHome, '.agents', 'skills', 'beta'), reason: 'broken symlink' }]);
    expect(ledger.totalTokens).toBe(2);
  });

  it('counts a missing description name-only and flags it incomplete (US15)', () => {
    mkdirSync(path.join(sourceRoot, 'skills', 'delta'), { recursive: true });
    writeFileSync(path.join(sourceRoot, 'skills', 'delta', 'SKILL.md'), `---\nname: delta\ntitle: delta\n---\n# delta\n`);
    const s = services(['delta']);
    s.distribute.apply({ to: 'user', skills: ['delta'], agents: ['zed'] });
    const line = s.cost.ledger().paths[0].skills[0];
    expect(line.incomplete).toBe(true);
    expect(line.nameTokens).toBe(1); // 'delta' -> floor(5/4)
    expect(line.descriptionTokens).toBe(0);
    expect(line.tokens).toBe(1);
  });
});

describe('suggestions (report-only downgrade)', () => {
  it('heads zero-controversy recalls: archived-but-distributed counts and suggests undistribute (US11)', () => {
    const s = services(['alpha', 'beta']);
    s.distribute.apply({ to: 'user', skills: ['beta'], agents: ['zed'] });
    s.archive.archiveSkills(['beta']);
    const ledger = s.cost.ledger();
    const line = ledger.paths[0].skills.find((item) => item.skill === 'beta');
    expect(line?.archived).toBe(true);
    expect(line?.tokens).toBe(3); // archived entries still count
    expect(ledger.suggestions.archived).toHaveLength(1);
    const suggestion = ledger.suggestions.archived[0];
    expect(suggestion.skill).toBe('beta');
    expect(suggestion.command).toBe('skills-manager undistribute --to user --agent zed --skill beta');
  });

  it('suggests verbatim undistribute commands with --project for project paths (US9)', () => {
    const s = services(['gamma']);
    s.distribute.apply({ to: 'project', projectRoot: project, skills: ['gamma'], agents: ['eve'] });
    const suggestion = s.cost.ledger().suggestions.topDescriptions[0];
    expect(suggestion.command).toBe(`skills-manager undistribute --to project --project ${project} --agent eve --skill gamma`);
  });

  it('flags scattered distributions with a consolidation hint and per-path commands (US12)', () => {
    const s = services(['alpha']);
    s.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['zed'] });
    s.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['claude-code'] });
    const scattered = s.cost.ledger().suggestions.scattered;
    expect(scattered).toHaveLength(1);
    expect(scattered[0].skill).toBe('alpha');
    expect(scattered[0].runtimeDirs).toEqual([path.join(userHome, '.agents', 'skills'), path.join(userHome, '.claude', 'skills')].sort());
    expect(scattered[0].commands).toHaveLength(2);
    expect(scattered[0].commands[0]).toBe('skills-manager undistribute --to user --agent zed --skill alpha');
    expect(scattered[0].commands[1]).toBe('skills-manager undistribute --to user --agent claude-code --skill alpha');
  });

  it('lists the top-N most expensive descriptions, most expensive first (US7/US8)', () => {
    const s = services(['alpha', 'beta', 'gamma', 'one', 'two', 'three', 'four', 'five']);
    s.distribute.apply({ to: 'user', skills: ['alpha', 'beta', 'gamma', 'one', 'two', 'three', 'four', 'five'], agents: ['zed'] });
    const ledger = s.cost.ledger();
    expect(ledger.suggestions.topDescriptions).toHaveLength(5); // default
    // description tokens: gamma 10 (zh), five 7, four 6, three 5, two 4 — most expensive first
    expect(ledger.suggestions.topDescriptions.map((item) => item.skill)).toEqual(['gamma', 'five', 'four', 'three', 'two']);
    expect(s.cost.ledger(2).suggestions.topDescriptions.map((item) => item.skill)).toEqual(['gamma', 'five']);
  });

  it('suggests nothing to execute when the account is clean', () => {
    const s = services(['alpha']);
    s.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['zed'] });
    const { suggestions } = s.cost.ledger();
    expect(suggestions.archived).toEqual([]);
    expect(suggestions.scattered).toEqual([]);
    expect(suggestions.topDescriptions).toEqual([{ skill: 'alpha', runtimeDir: path.join(userHome, '.agents', 'skills'), tokens: 1, command: 'skills-manager undistribute --to user --agent zed --skill alpha' }]);
  });
});
