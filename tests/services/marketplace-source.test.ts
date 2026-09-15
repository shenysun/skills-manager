import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GitHubApiPort } from '../../src/core/ports/github-api.js';
import { DetectionService } from '../../src/core/services/detection-service.js';
import { createCoreServices } from '../../src/core/services/index.js';
import { createNodeFileSystem } from '../../src/infra/index.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';
import { FAKE_COMMIT as SHA, FAKE_TREE as TREE, materializingGit } from '../fixtures/git-transport.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'marketplace-source-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function marketplaceUpstream(): string {
  const upstream = path.join(root, 'upstream');
  mkdirSync(path.join(upstream, '.claude-plugin'), { recursive: true });
  writeFileSync(
    path.join(upstream, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'test-mp',
      plugins: [
        { name: 'core', source: './plugins/core', description: 'core plugin', skills: ['./skills/alpha', './skills/beta'] },
        { name: 'linked', source: { source: 'git-subdir', repo: 'other/repo', path: 'skills' } },
        { name: 'remote', source: { source: 'url', url: 'https://example.com/plugin' } },
        { name: 'bare', source: './plugins/bare' },
      ],
    }),
  );
  for (const skill of ['alpha', 'beta']) {
    const dir = path.join(upstream, 'plugins', 'core', 'skills', skill);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${skill}\ntitle: ${skill} title\ndescription: ${skill} desc\n---\n# ${skill}\n`);
  }
  mkdirSync(path.join(upstream, 'plugins', 'bare'), { recursive: true });
  return upstream;
}

function servicesWithMarketplace(upstream = marketplaceUpstream()) {
  const git = materializingGit(upstream);
  const fakeRunner = { run: () => ({ status: 0, stdout: '', stderr: '' }) } as never;
  const s = createCoreServices({
    skillHomeRoot: path.join(root, 'home'),
    projectRoot: root,
    fs: createNodeFileSystem(),
    git,
    processRunner: fakeRunner,
    tempRoot: path.join(root, 'tmp'),
    userHome: path.join(root, 'user'),
    env: {},
    catalogSnapshot: fixtureSnapshot(),
  });
  s.skillHome.ensure();
  return { s };
}

describe('marketplace install (source-formats ticket 06)', () => {
  it('installs a whole plugin selected by plugin name (two-level selection, US-16)', () => {
    const { s } = servicesWithMarketplace();
    const result = s.install.installFromSourceSelection({ source: 'https://github.com/owner/repo.git', selectors: ['core'] });
    expect(result.installed.sort()).toEqual(['alpha', 'beta']);
  });

  it('installs a single skill selected by name within a plugin', () => {
    const { s } = servicesWithMarketplace();
    const result = s.install.installFromSourceSelection({ source: 'https://github.com/owner/repo.git', selectors: ['alpha'] });
    expect(result.installed).toEqual(['alpha']);
  });

  it('fails with an explicit not-supported error when naming a form-2/3 plugin (US-17)', () => {
    const { s } = servicesWithMarketplace();
    expect(() => s.install.installFromSourceSelection({ source: 'https://github.com/owner/repo.git', selectors: ['linked'] }))
      .toThrow(/not supported yet/);
    expect(() => s.install.installFromSourceSelection({ source: 'https://github.com/owner/repo.git', selectors: ['remote'] }))
      .toThrow(/not supported yet/);
  });

  it('records type marketplace with the skill subtree tree SHA in the registry', () => {
    const { s } = servicesWithMarketplace();
    s.install.installFromSourceSelection({ source: 'https://github.com/owner/repo.git', selectors: ['alpha'] });
    const source = s.registry.load().skills.alpha?.source;
    expect(source?.type).toBe('marketplace');
    expect(source?.upstream_tree).toBe(TREE);
    expect(source?.upstream_commit).toBe(SHA);
    expect(source?.subpath).toBe('plugins/core/skills/alpha');
  });

  it('keeps installed marketplace skills full update candidates (US-26, ADR-0013 pipeline)', () => {
    const { s } = servicesWithMarketplace();
    s.install.installFromSourceSelection({ source: 'https://github.com/owner/repo.git', selectors: ['alpha'] });
    const candidates = s.update.plan().groups.flatMap((group) => group.skills);
    expect(candidates.map((candidate) => candidate.skill)).toContain('alpha');
    expect(candidates.find((candidate) => candidate.skill === 'alpha')?.subpath).toBe('plugins/core/skills/alpha');
  });

  it('reinstalls through the existing git pipeline on update, keeping marketplace provenance', () => {
    const { s } = servicesWithMarketplace();
    const upstream = marketplaceUpstream();
    s.install.installFromSourceSelection({ source: 'https://github.com/owner/repo.git', selectors: ['alpha'] });
    writeFileSync(
      path.join(upstream, 'plugins', 'core', 'skills', 'alpha', 'SKILL.md'),
      '---\nname: alpha\ntitle: alpha title\ndescription: alpha desc renewed\n---\n# alpha\n',
    );

    const result = s.update.updateSkills(['alpha']);

    expect(result.updated).toEqual(['alpha']);
    const source = s.registry.load().skills.alpha?.source;
    expect(source?.type).toBe('marketplace');
    expect(source?.upstream_tree).toBe(TREE);
    const installed = readFileSync(path.join(s.registry.skillDir('alpha'), 'SKILL.md'), 'utf8');
    expect(installed).toContain('renewed');
  });

  it('detects freshness through the GitHub Trees API pipeline exactly like a git source', async () => {
    const { s } = servicesWithMarketplace();
    s.install.installFromSourceSelection({ source: 'https://github.com/owner/repo.git', selectors: ['alpha'] });
    const listed = s.registry.listSkills({ includeArchived: false });
    const tree = (trees: Record<string, string>): GitHubApiPort => ({
      fetchRepoTree: async () => ({ commitSha: SHA, trees }),
    });
    const upToDate = new DetectionService({ githubApi: tree({ 'plugins/core/skills/alpha': TREE }), fs: createNodeFileSystem() });
    const changed = new DetectionService({ githubApi: tree({ 'plugins/core/skills/alpha': '1aaaaaaa1aaaaaaa1aaaaaaa1aaaaaaa1aaaaaaa' }), fs: createNodeFileSystem() });

    const same = await upToDate.detect({ ...s, resolution: { root: path.join(root, 'home') } }, listed);
    const diff = await changed.detect({ ...s, resolution: { root: path.join(root, 'home') } }, listed);

    expect(same.get('alpha')).toEqual({ detection: 'ok', hasUpdate: false });
    expect(diff.get('alpha')).toEqual({ detection: 'ok', hasUpdate: true });
  });
});
