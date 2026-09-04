import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'init-service-'));
  home = path.join(root, 'home');
  userHome = path.join(root, 'user');
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

/** A real (non-symlink) runtime skill directory, as a pre-skills-manager machine would have it. */
function makeRuntimeSkill(agentRelativeDir: string, name: string, body = `---\nname: ${name}\ntitle: ${name} title\ndescription: ${name} description\n---\n# ${name}\n`) {
  const dir = path.join(userHome, agentRelativeDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), body);
  return dir;
}

describe('init run (reverse import)', () => {
  it('imports a runtime skill into the hub and back-symlinks its origin', () => {
    const runtimeDir = makeRuntimeSkill('.claude/skills', 'alpha');
    const s = services();

    const result = s.init.run();

    expect(result.imported).toEqual(['alpha']);
    // Hub holds the entity (skill home auto-created; no explicit ensure() above).
    expect(existsSync(path.join(home, 'skills', 'alpha', 'SKILL.md'))).toBe(true);
    expect(readFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), 'utf8')).toContain('alpha title');
    // Origin became a symlink back to the hub entity.
    expect(lstatSync(runtimeDir).isSymbolicLink()).toBe(true);
    expect(readlinkSync(runtimeDir)).toBe(path.join(home, 'skills', 'alpha'));
    // Registry marks provenance honestly.
    expect(s.registry.getEntry('alpha')).toMatchObject({ imported: true, title: 'alpha title', consumers: ['claude-code'] });
    // The back-symlink is a managed distribution entry, not foreign.
    const record = s.distribute.listIndex().find((item) => item.kind === 'user');
    expect(record?.entries).toHaveLength(1);
    expect(record?.entries[0]).toMatchObject({ skill: 'alpha', runtimePath: runtimeDir, mode: 'symlink', managed: true, agents: ['claude-code'] });
    // The displaced original is preserved as a backup.
    const backups = s.backups.list();
    expect(backups.map((item) => item.skill)).toEqual(['alpha']);
    expect(existsSync(path.join(backups[0].dir, 'SKILL.md'))).toBe(true);
  });

  it('is idempotent: a second run skips the managed symlink and adds no backups', () => {
    makeRuntimeSkill('.claude/skills', 'alpha');
    const s = services();
    s.init.run();

    const second = s.init.run();

    expect(second.imported).toEqual([]);
    expect(second.skippedManaged).toEqual(['alpha']);
    expect(s.backups.list()).toHaveLength(1);
  });

  it('reports a multi-runtime clash and imports the resolved copy everywhere', () => {
    const claudeDir = makeRuntimeSkill('.claude/skills', 'alpha', `---\nname: alpha\ntitle: claude copy\n---\n# alpha\n`);
    const cursorDir = makeRuntimeSkill('.cursor/skills', 'alpha', `---\nname: alpha\ntitle: cursor copy\n---\n# alpha\n`);
    const s = services();

    const report = s.init.run();
    expect(report.imported).toEqual([]);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]).toMatchObject({ skill: 'alpha', kind: 'multi-runtime' });
    expect(existsSync(claudeDir) && lstatSync(claudeDir).isSymbolicLink()).toBe(false);

    const resolved = s.init.run({ resolve: { alpha: 'cursor' } });
    expect(resolved.imported).toEqual(['alpha']);
    // The chosen copy (cursor's) is what the hub holds.
    expect(readFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), 'utf8')).toContain('cursor copy');
    // Both clashing origins now point at the hub entity.
    for (const dir of [claudeDir, cursorDir]) {
      expect(lstatSync(dir).isSymbolicLink()).toBe(true);
      expect(readlinkSync(dir)).toBe(path.join(home, 'skills', 'alpha'));
    }
    expect(s.backups.list().map((item) => item.skill).sort()).toEqual(['alpha', 'alpha']);
  });

  it('identifies clash locations by runtime dir (all member agents) and resolves by dir path', () => {
    const claudeRuntimeDir = path.dirname(makeRuntimeSkill('.claude/skills', 'alpha', `---\nname: alpha\ntitle: claude copy\n---\n# alpha\n`));
    const sharedRuntimeDir = path.dirname(makeRuntimeSkill('.agents/skills', 'alpha', `---\nname: alpha\ntitle: shared copy\n---\n# alpha\n`));
    const agents = ['claude-code', 'zed', 'warp'];
    const s = services();

    const report = s.init.run({ agents });

    const conflict = report.conflicts[0];
    expect(conflict.locations).toHaveLength(2);
    expect(conflict.locations.map((location) => location.runtimeDir)).toEqual(expect.arrayContaining([claudeRuntimeDir, sharedRuntimeDir]));
    // A dir shared by several agents reports every member, not an arbitrary first one.
    const sharedLocation = conflict.locations.find((location) => location.runtimeDir === sharedRuntimeDir);
    expect(sharedLocation?.agentIds).toEqual(['warp', 'zed']);

    // The runtime dir itself — what the UI shows — is an accepted resolution choice.
    const resolved = s.init.run({ agents, resolve: { alpha: sharedRuntimeDir } });
    expect(resolved.imported).toEqual(['alpha']);
    expect(readFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), 'utf8')).toContain('shared copy');
    for (const runtimeDir of [claudeRuntimeDir, sharedRuntimeDir]) {
      expect(lstatSync(path.join(runtimeDir, 'alpha')).isSymbolicLink()).toBe(true);
    }
  });

  it('treats symlink-linked runtime entries as one origin: no conflict, links replaced by hub', () => {
    // Entity lives in the zed/warp shared dir; claude-code holds a symlink to it.
    const entityDir = makeRuntimeSkill('.agents/skills', 'alpha');
    const linkDir = path.join(userHome, '.claude', 'skills', 'alpha');
    mkdirSync(path.dirname(linkDir), { recursive: true });
    symlinkSync(entityDir, linkDir);
    const s = services();

    const report = s.init.run({ agents: ['claude-code', 'zed', 'warp'] });

    // One physical copy — not a multi-runtime clash.
    expect(report.conflicts).toEqual([]);
    expect(report.imported).toEqual(['alpha']);
    expect(readFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), 'utf8')).toContain('alpha title');
    // Every position now links to the hub entity.
    for (const dir of [linkDir, entityDir]) {
      expect(lstatSync(dir).isSymbolicLink()).toBe(true);
      expect(readlinkSync(dir)).toBe(path.join(home, 'skills', 'alpha'));
    }
    // The real directory is preserved as the single backup; the old symlink is gone (replaced).
    const backups = s.backups.list();
    expect(backups).toHaveLength(1);
    expect(existsSync(path.join(backups[0].dir, 'SKILL.md'))).toBe(true);
    expect(s.registry.getEntry('alpha')).toMatchObject({ consumers: ['claude-code', 'warp', 'zed'] });
  });

  it('resolves a clash by any location of a group, including a symlinked one', () => {
    // Group 1: claude entity. Group 2: cursor entity + an .agents symlink pointing at it.
    makeRuntimeSkill('.claude/skills', 'beta', `---\nname: beta\ntitle: claude copy\n---\n# beta\n`);
    const cursorEntity = makeRuntimeSkill('.cursor/skills', 'beta', `---\nname: beta\ntitle: cursor copy\n---\n# beta\n`);
    const agentsLinkDir = path.join(userHome, '.agents', 'skills', 'beta');
    mkdirSync(path.dirname(agentsLinkDir), { recursive: true });
    symlinkSync(cursorEntity, agentsLinkDir);
    const agents = ['claude-code', 'cursor', 'zed'];
    const s = services();

    const report = s.init.run({ agents });
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0].locations).toHaveLength(2);

    // Picking the .agents runtime dir (a non-representative member of group 2) selects that group's copy.
    const resolved = s.init.run({ agents, resolve: { beta: path.join(userHome, '.agents', 'skills') } });
    expect(resolved.imported).toEqual(['beta']);
    expect(readFileSync(path.join(home, 'skills', 'beta', 'SKILL.md'), 'utf8')).toContain('cursor copy');
  });

  it('keeps the hub copy on resolve=hub and only back-symlinks the origin', () => {
    const runtimeDir = makeRuntimeSkill('.claude/skills', 'alpha', `---\nname: alpha\ntitle: runtime copy\n---\n# alpha\n`);
    const s = services();
    s.skillHome.ensure();
    mkdirSync(path.join(home, 'skills', 'alpha'), { recursive: true });
    writeFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), `---\nname: alpha\ntitle: hub copy\n---\n# alpha\n`);
    s.registry.ensureEntry('alpha', { title: 'hub copy' });

    const report = s.init.run();
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]).toMatchObject({ skill: 'alpha', kind: 'hub-vs-runtime' });

    const resolved = s.init.run({ resolve: { alpha: 'hub' } });
    expect(resolved.imported).toEqual(['alpha']);
    expect(readFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), 'utf8')).toContain('hub copy');
    expect(lstatSync(runtimeDir).isSymbolicLink()).toBe(true);
    // The hub entry keeps its identity — no imported stamp on a hub-authored skill.
    expect(s.registry.getEntry('alpha')?.imported).toBeUndefined();
  });

  it('lets the runtime copy win on resolve=<agent>: hub entity is backed up and replaced', () => {
    const runtimeDir = makeRuntimeSkill('.claude/skills', 'alpha', `---\nname: alpha\ntitle: runtime copy\n---\n# alpha\n`);
    const s = services();
    s.skillHome.ensure();
    mkdirSync(path.join(home, 'skills', 'alpha'), { recursive: true });
    writeFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), `---\nname: alpha\ntitle: hub copy\n---\n# alpha\n`);
    s.registry.ensureEntry('alpha', { title: 'hub copy' });

    const resolved = s.init.run({ resolve: { alpha: 'claude-code' } });
    expect(resolved.imported).toEqual(['alpha']);
    expect(readFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), 'utf8')).toContain('runtime copy');
    expect(lstatSync(runtimeDir).isSymbolicLink()).toBe(true);
    const backups = s.backups.list();
    expect(backups).toHaveLength(2);
    const backupBodies = backups.map((item) => readFileSync(path.join(item.dir, 'SKILL.md'), 'utf8'));
    expect(backupBodies.some((body) => body.includes('hub copy'))).toBe(true);
    expect(backupBodies.some((body) => body.includes('runtime copy'))).toBe(true);
  });

  it('dry-run reports the full plan with zero side effects', () => {
    const runtimeDir = makeRuntimeSkill('.claude/skills', 'alpha');
    makeRuntimeSkill('.cursor/skills', 'beta');
    const s = services();

    const plan = s.init.run({ dryRun: true });

    expect(plan.dryRun).toBe(true);
    expect(plan.discovered.map((skill) => skill.name)).toEqual(['alpha', 'beta']);
    expect(plan.conflicts.map((conflict) => conflict.skill)).toEqual([]);
    expect(plan.imported).toEqual(['alpha', 'beta']);
    expect(plan.choices).toMatchObject({ alpha: path.join(userHome, '.claude', 'skills'), beta: path.join(userHome, '.cursor', 'skills') });
    expect(lstatSync(runtimeDir).isSymbolicLink()).toBe(false);
    expect(existsSync(path.join(home, 'skills'))).toBe(false);
    expect(s.backups.list()).toHaveLength(0);
  });

  it('skips clashing skills and imports the rest when no priority is declared', () => {
    makeRuntimeSkill('.claude/skills', 'alpha', `---\nname: alpha\ntitle: claude copy\n---\n# alpha\n`);
    makeRuntimeSkill('.cursor/skills', 'alpha', `---\nname: alpha\ntitle: cursor copy\n---\n# alpha\n`);
    makeRuntimeSkill('.cursor/skills', 'beta');
    const s = services();
    s.skillHome.ensure();

    const result = s.init.run();

    expect(result.imported).toEqual(['beta']);
    expect(result.conflicts.map((conflict) => conflict.skill)).toEqual(['alpha']);
    expect(result.failed).toEqual([]);
    expect(existsSync(path.join(home, 'skills', 'beta', 'SKILL.md'))).toBe(true);
    expect(existsSync(path.join(home, 'skills', 'alpha'))).toBe(false);
  });

  it('prefer picks the first listed source that holds a copy', () => {
    const claudeDir = makeRuntimeSkill('.claude/skills', 'alpha', `---\nname: alpha\ntitle: claude copy\n---\n# alpha\n`);
    const cursorDir = makeRuntimeSkill('.cursor/skills', 'alpha', `---\nname: alpha\ntitle: cursor copy\n---\n# alpha\n`);
    const s = services();

    const preferred = s.init.run({ prefer: ['claude-code', 'cursor'] });
    expect(preferred.imported).toEqual(['alpha']);
    expect(preferred.choices).toEqual({ alpha: path.join(userHome, '.claude', 'skills') });
    expect(readFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), 'utf8')).toContain('claude copy');
    for (const dir of [claudeDir, cursorDir]) {
      expect(lstatSync(dir).isSymbolicLink()).toBe(true);
    }
  });

  it('per-skill resolve overrides prefer', () => {
    makeRuntimeSkill('.claude/skills', 'alpha', `---\nname: alpha\ntitle: claude copy\n---\n# alpha\n`);
    makeRuntimeSkill('.cursor/skills', 'alpha', `---\nname: alpha\ntitle: cursor copy\n---\n# alpha\n`);
    const s = services();

    const overridden = s.init.run({ prefer: ['claude-code'], resolve: { alpha: 'cursor' } });
    expect(readFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), 'utf8')).toContain('cursor copy');
    expect(overridden.choices).toEqual({ alpha: path.join(userHome, '.cursor', 'skills') });
  });

  it('prefer hub keeps the hub copy; identical trees are not a conflict', () => {
    makeRuntimeSkill('.claude/skills', 'alpha', `---\nname: alpha\ntitle: runtime copy\n---\n# alpha\n`);
    const s = services();
    s.skillHome.ensure();
    mkdirSync(path.join(home, 'skills', 'alpha'), { recursive: true });
    writeFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), `---\nname: alpha\ntitle: hub copy\n---\n# alpha\n`);
    s.registry.ensureEntry('alpha', { title: 'hub copy' });

    const kept = s.init.run({ prefer: ['hub'] });
    expect(kept.imported).toEqual(['alpha']);
    expect(kept.choices).toEqual({ alpha: 'hub' });
    expect(readFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), 'utf8')).toContain('hub copy');

    const same = `---\nname: twin\ntitle: twin\n---\n# twin\n`;
    makeRuntimeSkill('.claude/skills', 'twin', same);
    makeRuntimeSkill('.cursor/skills', 'twin', same);
    const merged = s.init.run();
    expect(merged.conflicts.map((conflict) => conflict.skill)).not.toContain('twin');
    expect(merged.imported).toEqual(['twin']);
    expect(readFileSync(path.join(home, 'skills', 'twin', 'SKILL.md'), 'utf8')).toContain('# twin');
  });

  it('rejects a prefer item that is not hub and not a directory scanned this run', () => {
    makeRuntimeSkill('.cursor/skills', 'alpha');
    const s = services();
    expect(() => s.init.run({ agents: ['cursor'], prefer: ['claude-code'] })).toThrow(/prefer/i);
    expect(() => s.init.run({ prefer: ['not-an-agent'] })).toThrow(/prefer/i);
  });

  it('reports a failing skill and keeps processing the rest', () => {
    makeRuntimeSkill('.claude/skills', 'good');
    const badDir = makeRuntimeSkill('.claude/skills', 'baddir', `---\nname: ../evil\ntitle: x\n---\n# evil\n`);
    const s = services();

    const result = s.init.run();

    expect(result.imported).toEqual(['good']);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({ skill: 'baddir' });
    expect(result.failed[0].reason).toMatch(/path separators/);
    // The failing skill's origin is untouched; the good one is fully imported.
    expect(existsSync(badDir) && lstatSync(badDir).isSymbolicLink()).toBe(false);
    expect(lstatSync(path.join(userHome, '.claude', 'skills', 'good')).isSymbolicLink()).toBe(true);
    expect(s.registry.getEntry('good')?.imported).toBe(true);
  });
});

describe('backups (init recovery aid)', () => {
  it('restore rolls one skill fully back: origin directory, hub entity, registry, index', () => {
    const runtimeDir = makeRuntimeSkill('.claude/skills', 'alpha', `---\nname: alpha\ntitle: original\n---\n# alpha\n`);
    const s = services();
    s.init.run();
    expect(lstatSync(runtimeDir).isSymbolicLink()).toBe(true);

    const restore = s.backups.restore('alpha');

    expect(restore.restored).toBe(true);
    // The origin is a real directory again, holding the displaced original.
    expect(lstatSync(runtimeDir).isSymbolicLink()).toBe(false);
    expect(readFileSync(path.join(runtimeDir, 'SKILL.md'), 'utf8')).toContain('original');
    // Hub entity, registry entry and managed index entries are gone.
    expect(existsSync(path.join(home, 'skills', 'alpha'))).toBe(false);
    expect(s.registry.getEntry('alpha')).toBeUndefined();
    expect(s.distribute.listIndex().find((item) => item.kind === 'user')?.entries ?? []).toHaveLength(0);
    // The consumed backup is gone.
    expect(s.backups.list().filter((item) => item.skill === 'alpha')).toHaveLength(0);
  });

  it('restore of an unknown skill fails with an actionable error', () => {
    const s = services();
    expect(() => s.backups.restore('ghost')).toThrow(/no backup/i);
  });

  it('init prunes backups older than 30 days', () => {
    makeRuntimeSkill('.claude/skills', 'alpha');
    const s = services();
    s.init.run();
    const stale = path.join(home, '.backups', 'old-skill-2026-07-01T00-00-00-000Z');
    mkdirSync(stale, { recursive: true });
    writeFileSync(path.join(stale, 'SKILL.md'), '# old\n');

    s.init.run();

    expect(existsSync(stale)).toBe(false);
    expect(s.backups.list().filter((item) => item.skill === 'alpha')).toHaveLength(1);
  });
});

describe('doctor imported-staleness visibility', () => {
  it('lists imported skills without a source and stops listing once the source is supplied', () => {
    makeRuntimeSkill('.claude/skills', 'alpha');
    makeRuntimeSkill('.cursor/skills', 'beta');
    const s = services();
    s.init.run();

    const report = s.doctor.check();
    expect(report.importedWithoutSource.map((item) => item.skill).sort()).toEqual(['alpha', 'beta']);
    expect(report.importedWithoutSource[0].importedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.warnings.join('\n')).toMatch(/skills-manager edit/);

    // Supplying the upstream truth moves the skill into the normal update flow.
    s.registry.editSafeFields('alpha', { source: { type: 'git', url: 'https://github.com/example/alpha' } });
    const after = s.doctor.check();
    expect(after.importedWithoutSource.map((item) => item.skill)).toEqual(['beta']);
  });
});
