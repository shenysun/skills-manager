import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'migrate-consumers-'));
  home = path.join(root, 'home');
  userHome = path.join(root, 'user');
  project = path.join(root, 'project');
  // A legacy hub: canonical skill + registry with legacy tags + v1 index + v1 project receipt.
  mkdirSync(path.join(home, 'skills', 'alpha'), { recursive: true });
  writeFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), '# Alpha\n');
  writeFileSync(path.join(home, 'registry.yaml'), YAML.stringify({
    skills: { alpha: { title: 'Alpha', consumers: ['agents', 'claude'] } },
  }));
  mkdirSync(path.join(home, '.skills'), { recursive: true });
  const agentsRuntime = path.join(userHome, '.agents', 'skills', 'alpha');
  const claudeRuntime = path.join(userHome, '.claude', 'skills', 'alpha');
  mkdirSync(path.dirname(agentsRuntime), { recursive: true });
  mkdirSync(path.dirname(claudeRuntime), { recursive: true });
  symlinkSync(path.join(home, 'skills', 'alpha'), agentsRuntime);
  symlinkSync(path.join(home, 'skills', 'alpha'), claudeRuntime);
  writeFileSync(path.join(home, '.skills', 'distributions.jsonl'), `${JSON.stringify({
    id: `user:${userHome}`,
    kind: 'user',
    targetRoot: userHome,
    updatedAt: '2026-01-01T00:00:00.000Z',
    entries: [
      { skill: 'alpha', consumer: 'agents', mode: 'symlink', fingerprint: 'sha256:old', runtimePath: agentsRuntime },
      { skill: 'alpha', consumer: 'claude', mode: 'symlink', fingerprint: 'sha256:old', runtimePath: claudeRuntime },
    ],
  })}\n${JSON.stringify({
    id: `project:${project}`,
    kind: 'project',
    targetRoot: project,
    updatedAt: '2026-01-01T00:00:00.000Z',
    entries: [
      { skill: 'alpha', consumer: 'agents', mode: 'symlink', fingerprint: 'sha256:old', runtimePath: path.join(project, '.agents', 'skills', 'alpha') },
    ],
  })}\n`);
  mkdirSync(path.join(project, '.agents', 'skills'), { recursive: true });
  symlinkSync(path.join(home, 'skills', 'alpha'), path.join(project, '.agents', 'skills', 'alpha'));
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

const SHARED_FAMILY = ['warp', 'zed'];

describe('legacy data hard-fails the loader before migration', () => {
  it('registry load rejects legacy tags with an actionable error', () => {
    const s = services();
    expect(() => s.registry.load()).toThrow(SkillsManagerError);
    try {
      s.registry.load();
    } catch (error) {
      expect((error as SkillsManagerError).code).toBe('legacy_consumer_tags');
      expect((error as Error).message).toMatch(/migrate-consumers/);
    }
  });

  it('the v1 hub index rejects entry reads with an actionable error', () => {
    const s = services();
    expect(() => s.distribute.status()).toThrow(/migrate-consumers/);
  });
});

describe('migrate-consumers', () => {
  it('dry-run reports the plan without touching disk', () => {
    const s = services();
    const before = {
      registry: readFileSync(path.join(home, 'registry.yaml'), 'utf8'),
      index: readFileSync(path.join(home, '.skills', 'distributions.jsonl'), 'utf8'),
    };
    const plan = s.migration.plan();
    expect(plan.agentMapping).toEqual({ claude: ['claude-code'], agents: SHARED_FAMILY });
    expect(plan.registryChanges).toEqual([{ skill: 'alpha', from: ['agents', 'claude'], to: ['claude-code', ...SHARED_FAMILY] }]);
    expect(plan.indexEntries).toBe(3);
    expect(readFileSync(path.join(home, 'registry.yaml'), 'utf8')).toBe(before.registry);
    expect(readFileSync(path.join(home, '.skills', 'distributions.jsonl'), 'utf8')).toBe(before.index);
  });

  it('migrates registry and index to catalog ids with identical physical placement', () => {
    const s = services();
    const agentsRuntime = path.join(userHome, '.agents', 'skills', 'alpha');
    const claudeRuntime = path.join(userHome, '.claude', 'skills', 'alpha');
    const result = s.migration.apply();
    expect(result.migrated.registrySkills).toEqual(['alpha']);
    expect(result.migrated.indexEntries).toBe(3);

    const registry = s.registry.load();
    expect(registry.skills.alpha.consumers?.sort()).toEqual([...SHARED_FAMILY, 'claude-code'].sort());

    const record = s.distribute.listIndex().find((item) => item.kind === 'user');
    expect(record?.entries).toHaveLength(2);
    const shared = record?.entries.find((entry) => entry.runtimePath === agentsRuntime);
    expect(shared?.agents.sort()).toEqual(SHARED_FAMILY);
    expect(shared?.managed).toBe(true);
    const claude = record?.entries.find((entry) => entry.runtimePath === claudeRuntime);
    expect(claude?.agents).toEqual(['claude-code']);

    // Identity: physical placement unchanged, byte-for-byte the same link targets.
    expect(existsSync(agentsRuntime)).toBe(true);
    expect(existsSync(claudeRuntime)).toBe(true);
    expect((s.distribute.listIndex()[0].entries[0] as { runtimePath: string }).runtimePath).toBe(agentsRuntime);

    // Lifecycle works directly on migrated data.
    const health = s.distribute.status();
    expect(health.managedEntries).toBe(3);
    expect(health.agentCoverage).toBe(SHARED_FAMILY.length + 1);
    s.distribute.undistribute({ to: 'user', skills: ['alpha'], agents: ['claude-code'] });
    expect(existsSync(claudeRuntime)).toBe(false);
    expect(existsSync(agentsRuntime)).toBe(true);
  });

  it('rollback restores the pre-migration files', () => {
    const s = services();
    const before = {
      registry: readFileSync(path.join(home, 'registry.yaml'), 'utf8'),
      index: readFileSync(path.join(home, '.skills', 'distributions.jsonl'), 'utf8'),
    };
    s.migration.apply();
    expect(() => s.registry.load()).not.toThrow();
    s.migration.rollback();
    expect(readFileSync(path.join(home, 'registry.yaml'), 'utf8')).toBe(before.registry);
    expect(readFileSync(path.join(home, '.skills', 'distributions.jsonl'), 'utf8')).toBe(before.index);
    expect(() => s.registry.load()).toThrow(/migrate-consumers/);
  });
});
