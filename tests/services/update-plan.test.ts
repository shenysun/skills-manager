import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCoreServices } from '../../src/core/services/index.js';
import { createNodeFileSystem } from '../../src/infra/index.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';
import { skillMarkdown } from '../fixtures/archives.js';
import { fakeHttp, type FakeHttpRoutes } from '../fixtures/fake-http.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'update-plan-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function services() {
  const s = createCoreServices({
    skillHomeRoot: path.join(root, 'home'),
    projectRoot: root,
    fs: createNodeFileSystem(),
    git: { statusShort: () => '', clone: () => {}, revParseHead: () => 'a', revParseTree: () => 'b', listRemoteHeads: () => [], log: () => [] } as never,
    processRunner: { run: () => ({ status: 0, stdout: '', stderr: '' }) } as never,
    tempRoot: path.join(root, 'tmp'),
    userHome: path.join(root, 'user'),
    env: {},
    catalogSnapshot: fixtureSnapshot(),
  });
  s.skillHome.ensure();
  return s;
}

describe('update plan output shape (manager-skill-first ticket 04)', () => {
  it('is grouped only — no duplicated flat candidate list beside the groups', () => {
    const s = services();
    for (const name of ['alpha', 'beta']) {
      const dir = path.join(root, 'home', 'skills', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\n---\n# ${name}\n`);
    }
    s.registry.ensureEntries([
      { skill: 'alpha', patch: { source: { type: 'git', url: 'https://github.com/owner/repo.git', subpath: 'skills/alpha' } } },
      { skill: 'beta', patch: { source: { type: 'git', url: 'https://github.com/owner/repo.git', subpath: 'skills/beta' } } },
    ]);

    const plan = s.update.plan();

    expect('candidates' in plan).toBe(false);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].skills.map((skill) => skill.skill).sort()).toEqual(['alpha', 'beta']);
  });
});

describe('url sources join the update flow (source-formats ticket 05)', () => {
  let serving: { body: string; etag: string };

  function urlServices() {
    serving = { body: skillMarkdown('alpha', 'a url skill'), etag: '"v1"' };
    const routes: FakeHttpRoutes = () => [{ kind: 'bytes', body: serving.body, headers: { etag: serving.etag } }];
    const s = createCoreServices({
      skillHomeRoot: path.join(root, 'home'),
      projectRoot: root,
      fs: createNodeFileSystem(),
      git: { statusShort: () => '', clone: () => {}, revParseHead: () => 'a', revParseTree: () => 'b', listRemoteHeads: () => [], log: () => [] } as never,
      processRunner: { run: () => ({ status: 0, stdout: '', stderr: '' }) } as never,
      tempRoot: path.join(root, 'tmp'),
      userHome: path.join(root, 'user'),
      env: {},
      catalogSnapshot: fixtureSnapshot(),
      http: fakeHttp(routes),
    });
    s.skillHome.ensure();
    return s;
  }

  it('appears in the update plan next to git candidates (ADR-0016)', () => {
    const s = urlServices();
    s.install.installFromSourceSelection({ source: 'https://example.com/SKILL.md', selectors: ['alpha'] });
    const dir = path.join(root, 'home', 'skills', 'beta');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), skillMarkdown('beta', 'a git skill'));
    s.registry.ensureEntry('beta', { source: { type: 'git', url: 'https://github.com/owner/repo.git', subpath: 'skills/beta' } });

    const plan = s.update.plan();

    expect(plan.groups.map((group) => group.url).sort()).toEqual(['https://example.com/SKILL.md', 'https://github.com/owner/repo.git']);
  });

  it('update re-downloads through the source dispatch and refreshes the registry record', () => {
    const s = urlServices();
    s.install.installFromSourceSelection({ source: 'https://example.com/SKILL.md', selectors: ['alpha'] });
    expect(s.registry.load().skills.alpha?.source?.upstream_etag).toBe('"v1"');
    serving.body = skillMarkdown('alpha', 'a url skill, renewed');
    serving.etag = '"v2"';

    const result = s.update.updateSkills(['alpha']);

    expect(result.updated).toEqual(['alpha']);
    const entry = s.registry.load().skills.alpha;
    // Title/description stay as first installed — update candidates are
    // registry-shaped for every kind (git parity), so only the skill payload
    // and the source record refresh (validators included — the next probe
    // compares against what this install actually downloaded).
    expect(entry?.description).toBe('a url skill');
    expect(entry?.source?.upstream_etag).toBe('"v2"');
    // The payload refreshes and carries the frontmatter mirror (ADR-0017): the
    // served body plus the projected provenance block — the mirror rides the
    // same install, never a second pass.
    expect(entry?.source?.upstream_content_sha).toMatch(/^sha256:[0-9a-f]{64}$/);
    const skillMd = createNodeFileSystem().readText(path.join(root, 'home', 'skills', 'alpha', 'SKILL.md'));
    expect(skillMd).toContain('a url skill, renewed');
    expect(skillMd).toContain(`skills-manager-content-sha: ${entry?.source?.upstream_content_sha}\n`);
    expect(skillMd).toContain('skills-manager-source-url: https://example.com/SKILL.md\n');
    expect(entry?.source?.type).toBe('url');
    expect(entry?.source?.subpath).toBe('skills/alpha');
  });
});
