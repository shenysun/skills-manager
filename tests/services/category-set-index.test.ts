import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCoreServices } from '../../src/core/services/index.js';
import { createNodeFileSystem } from '../../src/infra/index.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';

const fakeGit = { statusShort: () => '', clone: () => ({ repoDir: '', commit: null }), pull: () => null, latestCommit: () => null } as never;
const fakeRunner = { run: () => ({ stdout: '', stderr: '' }) } as never;

let root: string;
let home: string;
let userHome: string;
let sourceRoot: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'category-set-index-'));
  home = path.join(root, 'home');
  userHome = path.join(root, 'user');
  sourceRoot = path.join(root, 'source');
  mkdirSync(path.join(sourceRoot, 'skills', 'alpha'), { recursive: true });
  writeFileSync(path.join(sourceRoot, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ntitle: alpha\ndescription: test\n---\n# alpha\n');
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

/** zed/warp share one physical runtime dir — the family case the record is keyed for (ADR-0015). */
const familyDir = () => path.join(userHome, '.agents', 'skills');

describe('category-set record on the distribution index', () => {
  it('records and reads back the applied set per physical runtime dir', () => {
    const s = services();
    s.distribute.recordCategorySet('user', familyDir(), { categories: ['前端', '金融'] });
    expect(s.distribute.readCategorySet('user', familyDir())).toEqual({ categories: ['前端', '金融'] });
  });

  it('reads no record for a path that was never applied', () => {
    const s = services();
    expect(s.distribute.readCategorySet('user', familyDir())).toBeNull();
  });

  it('persists inside distributions.jsonl, not a parallel store', () => {
    const s = services();
    s.distribute.recordCategorySet('user', familyDir(), { categories: ['前端'] });
    const index = readFileSync(path.join(home, '.skills', 'distributions.jsonl'), 'utf8');
    const userRecord = index.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>).find((record) => record.kind === 'user');
    expect(userRecord?.categorySets).toEqual({ [familyDir()]: { categories: ['前端'] } });
  });

  it('survives unrelated index writes (apply and undistribute rewrite the same record)', () => {
    const s = services();
    s.distribute.recordCategorySet('user', familyDir(), { categories: ['前端'] });
    s.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['zed'] });
    s.distribute.undistribute({ to: 'user', skills: ['alpha'], agents: ['zed'] });
    expect(s.distribute.readCategorySet('user', familyDir())).toEqual({ categories: ['前端'] });
  });

  it('records the --all marker distinctly from a concrete list', () => {
    const s = services();
    s.distribute.recordCategorySet('user', familyDir(), { all: true });
    expect(s.distribute.readCategorySet('user', familyDir())).toEqual({ all: true });
  });

  it('clears one path without touching sibling paths', () => {
    const s = services();
    const claudeDir = path.join(userHome, '.claude', 'skills');
    s.distribute.recordCategorySet('user', familyDir(), { categories: ['前端'] });
    s.distribute.recordCategorySet('user', claudeDir, { all: true });
    s.distribute.clearCategorySet('user', familyDir());
    expect(s.distribute.readCategorySet('user', familyDir())).toBeNull();
    expect(s.distribute.readCategorySet('user', claudeDir)).toEqual({ all: true });
  });

  it('restores the category-set record together with the runtime state on rollback', () => {
    const s = services();
    s.distribute.recordCategorySet('user', familyDir(), { categories: ['前端'] });
    s.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['zed'] }); // snapshot carries the set
    s.distribute.clearCategorySet('user', familyDir());
    expect(s.distribute.readCategorySet('user', familyDir())).toBeNull();
    s.distribute.rollback('user');
    expect(s.distribute.readCategorySet('user', familyDir())).toEqual({ categories: ['前端'] });
  });

  it('drops the record when rolling back to a snapshot taken before it existed', () => {
    const s = services();
    s.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['zed'] }); // restore point predates the set
    s.distribute.recordCategorySet('user', familyDir(), { categories: ['前端'] });
    s.distribute.rollback('user');
    expect(s.distribute.readCategorySet('user', familyDir())).toBeNull();
  });
});
