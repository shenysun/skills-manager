import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCoreServices } from '../../src/core/services/index.js';
import { SourceService } from '../../src/core/services/source-service.js';
import { createNodeFileSystem } from '../../src/infra/index.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';
import { skillMarkdown, writeZip } from '../fixtures/archives.js';
import { spyGit } from '../fixtures/spy-git.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'archive-source-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function service() {
  return new SourceService(createNodeFileSystem(), spyGit(), path.join(root, 'tmp'));
}

describe('normalize dispatches a local zip archive (source-formats ticket 02)', () => {
  it('dispatches an existing .zip file to kind archive, transport not local', () => {
    const zipPath = writeZip(root, 'bundle.zip', [{ name: 'skills/alpha/SKILL.md', data: '---\nname: alpha\n---\n# a\n' }]);
    const spec = service().normalize(zipPath);
    expect(spec.kind).toBe('archive');
    expect(spec.isLocal).toBe(false);
    expect(spec.repoUrl).toBe(path.resolve(zipPath));
  });

  it('keeps an existing non-zip path on kind local, unchanged behavior', () => {
    const local = path.join(root, 'local-repo');
    mkdirSync(path.join(local, 'skills', 'alpha'), { recursive: true });
    const spec = service().normalize(local);
    expect(spec.kind).toBe('local');
    expect(spec.isLocal).toBe(true);
  });

  it('keeps a non-existent .zip-shaped input on the git path — existence is the dispatch condition', () => {
    const spec = service().normalize('./definitely-not-here.zip');
    expect(spec.kind).toBe('git');
  });

  it('keeps an existing .zip-suffixed directory on kind local — only a regular file is an archive', () => {
    const dirAsZip = path.join(root, 'looks-like.zip');
    mkdirSync(path.join(dirAsZip, 'skills'), { recursive: true });
    const spec = service().normalize(dirAsZip);
    expect(spec.kind).toBe('local');
    expect(spec.isLocal).toBe(true);
  });
});

describe('zip fixtures written by the helper are real zips', () => {
  it('starts with the PK local-header magic', () => {
    const zipPath = writeZip(root, 'real.zip', [{ name: 'a.txt', data: 'hello' }]);
    const bytes = createNodeFileSystem().readBytes(zipPath);
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
  });
});

describe('checkout extracts an archive into a temp checkout (source-formats ticket 02)', () => {
  it('materializes the archive tree and reports no commit', () => {
    const zipPath = writeZip(root, 'bundle.zip', [
      { name: 'skills/alpha/SKILL.md', data: '---\nname: alpha\ntitle: Alpha\ndescription: a\n---\n# Alpha\n' },
      { name: 'skills/beta/SKILL.md', data: '---\nname: beta\ntitle: Beta\ndescription: b\n---\n# Beta\n' },
    ]);
    const s = service();
    const checkout = s.checkout(zipPath);
    expect(checkout.kind).toBe('archive');
    expect(checkout.commit).toBeNull();
    const discovered = s.discover(checkout);
    expect(discovered.map((skill) => skill.name)).toEqual(['alpha', 'beta']);
    expect(discovered.map((skill) => skill.subpath)).toEqual(['skills/alpha', 'skills/beta']);
    s.release(checkout);
  });

  it('supports the withCheckout lifecycle: temp swept after the callback', () => {
    const zipPath = writeZip(root, 'bundle.zip', [{ name: 'skills/alpha/SKILL.md', data: '---\nname: alpha\n---\n# a\n' }]);
    const fs = createNodeFileSystem();
    const tempRoot = path.join(root, 'tmp');
    const s = new SourceService(fs, spyGit(), tempRoot);
    let repoDir = '';
    s.withCheckout(zipPath, undefined, (checkout) => {
      repoDir = checkout.repoDir;
      expect(fs.kind(path.join(repoDir, 'skills', 'alpha', 'SKILL.md'))).toBe('file');
    });
    expect(fs.kind(path.dirname(repoDir))).toBe('missing');
  });
});

describe('a non-zip payload fails actionably', () => {
  it('rejects a .zip-named file that is not a zip archive', () => {
    const bogus = path.join(root, 'fake.zip');
    writeFileSync(bogus, 'this is definitely not a zip archive');
    const s = service();
    let thrown: Error | undefined;
    try {
      s.checkout(bogus);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as { code?: string }).code).toBe('archive_invalid');
    expect(thrown?.message).toMatch(/not a valid zip/i);
  });
});

function coreServices() {
  const s = createCoreServices({
    skillHomeRoot: path.join(root, 'home'),
    projectRoot: root,
    fs: createNodeFileSystem(),
    git: spyGit(),
    processRunner: { run: () => ({ status: 0, stdout: '', stderr: '' }) } as never,
    tempRoot: path.join(root, 'tmp'),
    userHome: path.join(root, 'user'),
    env: {},
    catalogSnapshot: fixtureSnapshot(),
  });
  s.skillHome.ensure();
  return s;
}

describe('install from an archive source (source-formats ticket 02)', () => {
  it('installs a selected skill and records archive provenance with no update anchors', () => {
    const zipPath = writeZip(root, 'bundle.zip', [
      { name: 'skills/alpha/SKILL.md', data: skillMarkdown('alpha') },
      { name: 'skills/beta/SKILL.md', data: skillMarkdown('beta') },
    ]);
    const s = coreServices();
    const result = s.install.installFromSourceSelection({ source: zipPath, selectors: ['skills/alpha'] });
    expect(result.installed).toEqual(['alpha']);

    const entry = s.registry.load().skills.alpha?.source;
    expect(entry?.type).toBe('archive');
    expect(entry?.url).toBe(path.resolve(zipPath));
    expect(entry?.subpath).toBe('skills/alpha');
    expect(entry?.upstream_commit).toBeNull();
    expect(entry?.upstream_tree).toBeNull();
    expect(entry && 'upstream_digest' in entry).toBe(false);
    expect(createNodeFileSystem().kind(path.join(root, 'home', 'skills', 'alpha', 'SKILL.md'))).toBe('file');
  });

  it('selects by skill name too and rejects unknown selectors — same selection flow as git sources', () => {
    const zipPath = writeZip(root, 'bundle.zip', [{ name: 'skills/alpha/SKILL.md', data: skillMarkdown('alpha') }]);
    const s = coreServices();
    expect(s.install.installFromSourceSelection({ source: zipPath, selectors: ['alpha'] }).installed).toEqual(['alpha']);
    expect(() => s.install.installFromSourceSelection({ source: zipPath, selectors: ['skills/gamma'] })).toThrow(
      expect.objectContaining({ code: 'skill_not_discovered' }),
    );
  });

  it('installs every discovered skill with empty selectors (--all semantics)', () => {
    const zipPath = writeZip(root, 'bundle.zip', [
      { name: 'skills/alpha/SKILL.md', data: skillMarkdown('alpha') },
      { name: 'skills/beta/SKILL.md', data: skillMarkdown('beta') },
    ]);
    const s = coreServices();
    const result = s.install.installFromSourceSelection({ source: zipPath, selectors: [] });
    expect(result.installed.sort()).toEqual(['alpha', 'beta']);
  });
});

describe('archive sources carry no update eligibility (ADR-0016)', () => {
  it('the update plan excludes an archive-installed skill while git sources stay', () => {
    const zipPath = writeZip(root, 'bundle.zip', [{ name: 'skills/alpha/SKILL.md', data: skillMarkdown('alpha') }]);
    const s = coreServices();
    s.install.installFromSourceSelection({ source: zipPath, selectors: ['skills/alpha'] });
    mkdirSync(path.join(root, 'home', 'skills', 'gamma'), { recursive: true });
    writeFileSync(path.join(root, 'home', 'skills', 'gamma', 'SKILL.md'), skillMarkdown('gamma'));
    s.registry.ensureEntries([
      { skill: 'gamma', patch: { source: { type: 'git', url: 'https://github.com/owner/repo.git', subpath: 'skills/gamma' } } },
    ]);

    const plan = s.update.plan();
    const candidates = plan.groups.flatMap((group) => group.skills.map((skill) => skill.skill));
    expect(candidates).toEqual(['gamma']);
  });
});
