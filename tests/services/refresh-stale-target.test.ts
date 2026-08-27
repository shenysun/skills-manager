import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
let project: string;
let sourceRoot: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'refresh-stale-'));
  home = path.join(root, 'home');
  userHome = path.join(root, 'user');
  project = path.join(root, 'project');
  sourceRoot = path.join(root, 'source');
  for (const name of ['alpha']) {
    mkdirSync(path.join(sourceRoot, 'skills', name), { recursive: true });
    writeFileSync(path.join(sourceRoot, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n# ${name}\n`);
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function services() {
  const s = createCoreServices({
    skillHomeRoot: home, projectRoot: root,
    fs: createNodeFileSystem(), git: fakeGit, processRunner: fakeRunner,
    userHome, env: {}, catalogSnapshot: fixtureSnapshot(),
  });
  s.skillHome.ensure();
  s.install.installFromSourceSelection({ source: sourceRoot, selectors: ['alpha'], overwrite: true });
  return s;
}

describe('refreshStaleEntry — atomic per entry', () => {
  it('records error on the entry when the target path is gone, without throwing', () => {
    const s = services();
    s.distribute.apply({ to: 'project', projectRoot: project, skills: ['alpha'], agents: ['zed'], mode: 'copy' });
    writeFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), `---\nname: alpha\n---\n# Changed\n`);
    // Simulate the project runtime dir having been deleted out from under us.
    rmSync(path.join(project, '.agents'), { recursive: true, force: true });
    const result = s.distribute.redistributeOutdated({ to: 'project', projectRoot: project });
    expect(result.errored).toHaveLength(1);
    expect(result.refreshed).toHaveLength(0);
    const record = s.distribute.listIndex().find((r) => r.kind === 'project');
    const entry = record?.entries.find((e) => e.skill === 'alpha');
    expect(entry?.error?.code).toBeTruthy();
    expect(entry?.error?.at).toMatch(/T/);
    expect(entry?.error?.message).toContain('.agents/skills/alpha');
  });

  it('refreshes surviving entries when a sibling target is missing', () => {
    const s = services();
    s.distribute.apply({ to: 'project', projectRoot: project, skills: ['alpha'], agents: ['zed', 'claude-code'], mode: 'copy' });
    writeFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), `---\nname: alpha\n---\n# Changed\n`);
    // Delete only the zed family runtime dir; claude-code still exists.
    rmSync(path.join(project, '.agents'), { recursive: true, force: true });
    const result = s.distribute.redistributeOutdated({ to: 'project', projectRoot: project });
    expect(result.refreshed).toHaveLength(1);
    expect(result.errored).toHaveLength(1);
    expect(readFileSync(path.join(project, '.claude', 'skills', 'alpha', 'SKILL.md'), 'utf8')).toMatch(/Changed/);
  });

  it('clears a previous error on the next successful refresh', () => {
    const s = services();
    s.distribute.apply({ to: 'project', projectRoot: project, skills: ['alpha'], agents: ['zed'], mode: 'copy' });
    writeFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), `---\nname: alpha\n---\n# v2\n`);
    rmSync(path.join(project, '.agents'), { recursive: true, force: true });
    s.distribute.redistributeOutdated({ to: 'project', projectRoot: project }); // first pass errors
    // Restore target dir so the next refresh can succeed.
    mkdirSync(path.join(project, '.agents', 'skills'), { recursive: true });
    s.distribute.redistributeOutdated({ to: 'project', projectRoot: project });
    const entry = s.distribute.listIndex().find((r) => r.kind === 'project')?.entries.find((e) => e.skill === 'alpha');
    expect(entry?.error).toBeUndefined();
    expect(readFileSync(path.join(project, '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf8')).toMatch(/v2/);
  });

  it('re-applies an errored entry whose fingerprint matches again (no dead-end badge)', () => {
    const s = services();
    const original = readFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), 'utf8');
    s.distribute.apply({ to: 'project', projectRoot: project, skills: ['alpha'], agents: ['zed'], mode: 'copy' });
    writeFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), `---\nname: alpha\n---\n# Changed\n`);
    rmSync(path.join(project, '.agents'), { recursive: true, force: true });
    const first = s.distribute.redistributeOutdated({ to: 'project', projectRoot: project });
    expect(first.errored).toHaveLength(1);
    // Hub content reverts to the recorded fingerprint: fingerprint-stale is now
    // false, but the entry still carries an error — the badge predicate
    // (staleSummary) keeps counting it, so refresh admission must too.
    writeFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), original);
    expect(s.distribute.staleSummary()['alpha']).toBe(1);
    mkdirSync(path.join(project, '.agents', 'skills'), { recursive: true });
    const second = s.distribute.redistributeOutdated({ to: 'project', projectRoot: project });
    expect(second.refreshed).toHaveLength(1);
    expect(second.errored).toHaveLength(0);
    const entry = s.distribute.listIndex().find((r) => r.kind === 'project')?.entries.find((e) => e.skill === 'alpha');
    expect(entry?.error).toBeUndefined();
    expect(readFileSync(path.join(project, '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf8')).toBe(original);
  });
});
