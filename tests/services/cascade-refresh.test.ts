import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCoreServices } from '../../src/core/services/index.js';
import { createNodeFileSystem } from '../../src/infra/index.js';
import { UpdateService } from '../../src/core/services/update-service.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';

const fakeGit = { statusShort: () => '', clone: () => ({ repoDir: '', commit: null }), pull: () => null, latestCommit: () => null } as never;
const fakeRunner = { run: () => ({ stdout: '', stderr: '' }) } as never;

let root: string;
let home: string;
let userHome: string;
let project: string;
let sourceRoot: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'cascade-refresh-'));
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
  return s;
}

describe('cascade refresh on hub writes', () => {
  it('updates project copy targets when installFromSourceSelection overwrites', () => {
    const s = services();
    s.install.installFromSourceSelection({ source: sourceRoot, selectors: ['alpha'], overwrite: true });
    s.distribute.apply({ to: 'project', projectRoot: project, skills: ['alpha'], agents: ['zed'], mode: 'copy' });
    // Now overwrite hub content.
    writeFileSync(path.join(sourceRoot, 'skills', 'alpha', 'SKILL.md'), `---\nname: alpha\n---\n# v2\n`);
    s.install.installFromSourceSelection({ source: sourceRoot, selectors: ['alpha'], overwrite: true });
    expect(readFileSync(path.join(project, '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf8')).toMatch(/v2/);
    expect(s.distribute.status().outdated).toBe(0);
  });

  it('skips symlink targets on cascade (they never go stale)', () => {
    const s = services();
    s.install.installFromSourceSelection({ source: sourceRoot, selectors: ['alpha'], overwrite: true });
    s.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['claude-code'], mode: 'symlink' });
    // Snapshot the symlink entry BEFORE the hub write so we can prove the cascade
    // did NOT re-apply it. apply() would mint a new appliedAt and fingerprint.
    const before = s.distribute
      .listIndex()
      .flatMap((record) => record.entries)
      .find((entry) => entry.skill === 'alpha' && entry.mode === 'symlink');
    expect(before).toBeDefined();
    writeFileSync(path.join(sourceRoot, 'skills', 'alpha', 'SKILL.md'), `---\nname: alpha\n---\n# v2\n`);
    s.install.installFromSourceSelection({ source: sourceRoot, selectors: ['alpha'], overwrite: true });
    const after = s.distribute
      .listIndex()
      .flatMap((record) => record.entries)
      .find((entry) => entry.skill === 'alpha' && entry.mode === 'symlink');
    // symlink target reads the new content via the link — no refresh needed.
    expect(s.distribute.status().outdated).toBe(0);
    // The cascade must leave the symlink entry untouched: same fingerprint, same appliedAt.
    expect(after?.fingerprint).toBe(before?.fingerprint);
    expect(after?.appliedAt).toBe(before?.appliedAt);
  });
});

describe('update cascade', () => {
  it('refreshes stale project copy targets after updateCandidates writes the hub', () => {
    const s = services();
    s.install.installFromSourceSelection({ source: sourceRoot, selectors: ['alpha'], overwrite: true });
    s.distribute.apply({ to: 'project', projectRoot: project, skills: ['alpha'], agents: ['zed'], mode: 'copy' });
    // Simulate a newer upstream by rewriting the source.
    writeFileSync(path.join(sourceRoot, 'skills', 'alpha', 'SKILL.md'), `---\nname: alpha\nsource: { url: "git+x", subpath: alpha }\n---\n# v2\n`);
    // Build a fake candidate and call updateCandidates directly.
    const fakeSource = {
      checkout: () => ({ repoDir: sourceRoot, repoUrl: 'local', isLocal: true, ref: null, commit: null }),
    } as never;
    const update = new UpdateService(s.registry, fakeSource, s.install);
    update.updateCandidates([{ skill: 'alpha', url: 'local', subpath: 'skills/alpha', title: 'alpha', description: '', consumers: [] }]);
    expect(readFileSync(path.join(project, '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf8')).toMatch(/v2/);
    expect(s.distribute.status().outdated).toBe(0);
  });
});
